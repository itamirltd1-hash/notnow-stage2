import express from 'express';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './src/db/pool.js';
import messagesRouter from './src/routes/messages.js';
import contactsRouter from './src/routes/contacts.js';
import groupsRouter from './src/routes/groups.js';
import metaRouter from './src/routes/meta.js';
import billingRouter from './src/routes/billing.js';
import externalApiRouter from './src/routes/externalApi.js';
import { enforceQuota } from './src/billing/quotaMiddleware.js';
import { exemptCount, listExempt } from './src/billing/exemptions.js';
import { reportTemplateStatus, reportPhoneStatus, reportAccountLimits } from './src/meta/sendHandler.js';
import { ensureWebhookSubscription } from './src/meta/webhookSubscription.js';
import { dispatchPendingMessages, getDispatcherMetrics } from './src/dispatcher/batchDispatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Validate required environment variables
function validateEnvironment() {
  const required = [
    'DATABASE_URL',
    'META_API_TOKEN',
    'META_APP_SECRET',
    'META_VERIFY_TOKEN',
    'META_PHONE_NUMBER_ID',
  ];

  const optional = [
    'ANTHROPIC_API_KEY',
    'STRIPE_API_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'APP_URL'
  ];

  const missing = [];
  const warnings = [];

  required.forEach(key => {
    if (!process.env[key] || process.env[key].startsWith('your_')) {
      missing.push(key);
    }
  });

  optional.forEach(key => {
    if (!process.env[key] || process.env[key].startsWith('your_')) {
      warnings.push(key);
    }
  });

  if (missing.length > 0) {
    console.warn('⚠️  WARNING: Missing environment variables:', missing.join(', '));
    console.warn('Server will start but some features may not work');
  }

  if (warnings.length > 0) {
    console.warn('⚠️  WARNING: Missing optional environment variables:', warnings.join(', '));
    console.warn('Some features may not work without these values');
  }

  // Diagnostic: report shape of each credential without leaking its value.
  const shape = (key) => {
    const v = process.env[key];
    if (!v) return `${key}=MISSING`;
    if (v.startsWith('your_')) return `${key}=PLACEHOLDER`;
    return `${key}=len:${v.length} start:${v.slice(0, 4)}`;
  };
  console.log('🔧 Credential shapes:');
  ['META_APP_SECRET', 'META_API_TOKEN', 'WEBHOOK_VERIFY_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY']
    .forEach(k => console.log(`   ${shape(k)}`));
  console.log(`   META_PHONE_NUMBER_ID=${process.env.META_PHONE_NUMBER_ID || 'MISSING'}`);
  console.log(`   EXEMPT_PHONES=${exemptCount()} number(s): ${listExempt().join(', ') || '(none)'}`);

  if (process.env.ALLOW_TEST_AUTH === 'true') {
    console.warn('🚨 ALLOW_TEST_AUTH is on — the X-User-ID header can impersonate');
    console.warn('   any account. Turn this off before real users exist.');
  }

  console.log('✅ Environment validation passed');
}

// Run migrations on startup
async function runMigrations() {
  try {
    console.log('🔄 Running database migrations...');
    const dir = path.join(__dirname, 'src/db/migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf-8');
      await pool.query(sql);
      console.log(`   ✓ ${file}`);
    }
    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('⚠️  Migration warning (tables may already exist):', error.message);
  }
}

// Rate limiting middleware for webhooks and sends
const rateLimits = new Map();

function checkRateLimit(key, maxRequests, windowMs) {
  const now = Date.now();

  if (!rateLimits.has(key)) {
    rateLimits.set(key, []);
  }

  const requests = rateLimits.get(key).filter(t => now - t < windowMs);
  requests.push(now);
  rateLimits.set(key, requests);

  return requests.length <= maxRequests;
}

app.use((req, res, next) => {
  // Rate limit webhook endpoint (100 req/min per IP)
  if (req.path === '/api/meta/webhook') {
    const ip = req.ip;
    const key = `${ip}:webhook`;

    if (!checkRateLimit(key, 100, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many requests' });
    }
  }

  // Rate limit WhatsApp send endpoint (50 sends/min per user to prevent spam)
  if (req.path === '/api/meta/send' && req.userId) {
    const key = `user:${req.userId}:send`;

    if (!checkRateLimit(key, 50, 60000)) {
      return res.status(429).json({ success: false, error: 'Too many send requests - rate limited' });
    }
  }

  next();
});

// Middleware - parse raw body for webhook signature verification
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding);
  }
}));
app.use(express.urlencoded({ extended: true }));

// CORS & Security headers
app.use((req, res, next) => {
  // CORS - restrict to trusted origins only
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://notnow.app',
    process.env.APP_URL || 'http://localhost:3000'
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key,X-User-ID');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'");

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Legal pages (for Meta app compliance)
app.get('/privacy', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Privacy Policy - NOTNOW</title>
      <style>body { font-family: Arial; max-width: 800px; margin: 40px auto; line-height: 1.6; }</style>
    </head>
    <body>
      <h1>Privacy Policy</h1>
      <p><strong>Last Updated: August 21, 2026</strong></p>
      <h2>1. Information We Collect</h2>
      <p>We collect information you provide directly to us, including:</p>
      <ul>
        <li>Contact information (phone numbers, email addresses)</li>
        <li>WhatsApp messages and scheduling preferences</li>
        <li>Account credentials</li>
      </ul>
      <h2>2. How We Use Your Information</h2>
      <p>We use your information to:</p>
      <ul>
        <li>Provide and improve our scheduling service</li>
        <li>Send messages via WhatsApp</li>
        <li>Process billing and support requests</li>
      </ul>
      <h2>3. Data Security</h2>
      <p>We implement industry-standard security measures to protect your data.</p>
      <h2>4. Contact Us</h2>
      <p>For privacy concerns, contact us at itamirltd1@gmail.com</p>
    </body>
    </html>
  `);
});

app.get('/terms', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Terms of Service - NOTNOW</title>
      <style>body { font-family: Arial; max-width: 800px; margin: 40px auto; line-height: 1.6; }</style>
    </head>
    <body>
      <h1>Terms of Service</h1>
      <p><strong>Last Updated: August 21, 2026</strong></p>
      <h2>1. Acceptance of Terms</h2>
      <p>By using NOTNOW, you agree to these terms and conditions.</p>
      <h2>2. Use License</h2>
      <p>We grant you a limited, non-exclusive license to use our service for personal scheduling purposes.</p>
      <h2>3. Limitations of Liability</h2>
      <p>NOTNOW is provided "as is" without warranties. We are not liable for any indirect damages.</p>
      <h2>4. Governing Law</h2>
      <p>These terms are governed by applicable laws.</p>
      <h2>5. Contact Us</h2>
      <p>For questions about these terms, contact itamirltd1@gmail.com</p>
    </body>
    </html>
  `);
});

// API Routes (Cycle 2+)
app.use('/api/messages', enforceQuota, messagesRouter);
app.use('/api/contacts', contactsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/meta', metaRouter);
app.use('/api/billing', billingRouter);
app.use('/api/external', externalApiRouter);

// Background dispatcher (run every 60 seconds)
setInterval(async () => {
  const metrics = await dispatchPendingMessages();
  if (metrics.processed > 0) {
    console.log(`Dispatcher: ${metrics.processed} messages processed`);
  }
}, 60000);

// Dispatcher metrics endpoint (for monitoring)
app.get('/api/dispatcher/metrics', async (req, res) => {
  const metrics = await getDispatcherMetrics();
  res.json({ success: true, data: metrics });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Start server with migrations
(async () => {
  validateEnvironment();
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`🚀 NOTNOW Stage 2 server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🔒 Security: Webhook signature validation enabled`);
    console.log(`🔒 Security: Rate limiting enabled`);

    // Not awaited: a misconfiguration should be reported, not block the
    // service from accepting webhooks. Order matches the path a message
    // takes — can Meta reach us, can we send, is the template there.
    (async () => {
      await ensureWebhookSubscription();
      await reportPhoneStatus();
      await reportAccountLimits();
      await reportTemplateStatus();
    })();
  });
})();
