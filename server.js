import express from 'express';
import 'dotenv/config';
import messagesRouter from './src/routes/messages.js';
import contactsRouter from './src/routes/contacts.js';
import metaRouter from './src/routes/meta.js';
import billingRouter from './src/routes/billing.js';
import externalApiRouter from './src/routes/externalApi.js';
import { enforceQuota } from './src/billing/quotaMiddleware.js';
import { dispatchPendingMessages, getDispatcherMetrics } from './src/dispatcher/batchDispatcher.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 NOTNOW Stage 2 server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});
