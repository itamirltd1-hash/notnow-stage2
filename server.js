import express from 'express';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './src/db/pool.js';
import messagesRouter from './src/routes/messages.js';
import contactsRouter from './src/routes/contacts.js';
import metaRouter from './src/routes/meta.js';
import billingRouter from './src/routes/billing.js';
import externalApiRouter from './src/routes/externalApi.js';
import { enforceQuota } from './src/billing/quotaMiddleware.js';
import { dispatchPendingMessages, getDispatcherMetrics } from './src/dispatcher/batchDispatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Run migrations on startup
async function runMigrations() {
  try {
    console.log('🔄 Running database migrations...');
    const migrationFile = path.join(__dirname, 'src/db/migrations/001-multitenancy.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');
    await pool.query(sql);
    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('⚠️  Migration warning (tables may already exist):', error.message);
  }
}

// Rate limiting middleware for webhooks (5 requests per 60 seconds per IP)
const webhookRateLimits = new Map();
const WEBHOOK_RATE_LIMIT = { max: 100, window: 60000 }; // 100 req/min per IP

app.use((req, res, next) => {
  if (req.path === '/api/meta/webhook') {
    const ip = req.ip;
    const now = Date.now();
    const key = `${ip}:webhook`;

    if (!webhookRateLimits.has(key)) {
      webhookRateLimits.set(key, []);
    }

    const requests = webhookRateLimits.get(key).filter(t => now - t < WEBHOOK_RATE_LIMIT.window);
    requests.push(now);
    webhookRateLimits.set(key, requests);

    if (requests.length > WEBHOOK_RATE_LIMIT.max) {
      return res.status(429).json({ success: false, error: 'Too many requests' });
    }
  }
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS & Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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
  await runMigrations();
  app.listen(PORT, () => {
    console.log(`🚀 NOTNOW Stage 2 server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  });
})();
