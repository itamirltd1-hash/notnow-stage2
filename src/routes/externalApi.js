import express from 'express';
import crypto from 'crypto';
import pool from '../db/pool.js';
import { userQuery } from '../db/multitenancyHelpers.js';

const router = express.Router();

/**
 * Middleware: Validate API Key from request header.
 */
async function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ success: false, error: 'Missing X-Api-Key header' });
  }

  try {
    // Hash the key to look up in database
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const result = await pool.query(
      `SELECT user_id FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid or revoked API key' });
    }

    req.userId = result.rows[0].user_id;

    // Update last_used_at
    await pool.query(
      'UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = $1',
      [keyHash]
    );

    next();
  } catch (error) {
    console.error('Error validating API key:', error.message);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /api/external/schedule
 * Queue a message from an external system (CRM, bot, etc.).
 * Requires: X-Api-Key header.
 */
router.post('/schedule', validateApiKey, async (req, res) => {
  try {
    const userId = req.userId;
    const {
      recipient_phone,
      recipient_name,
      message_body,
      scheduled_at,
      channel = 'whatsapp',
      recipient_email,
      subject,
      metadata = {}
    } = req.body;

    // Validation
    if (!recipient_phone || !message_body || !scheduled_at) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: recipient_phone, message_body, scheduled_at (ISO 8601)'
      });
    }

    // Validate scheduled_at is future
    const scheduledDate = new Date(scheduled_at);
    if (scheduledDate < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'scheduled_at must be in the future'
      });
    }

    // Queue the message
    const result = await userQuery(
      userId,
      `INSERT INTO active_queue
       (user_id, recipient_phone, recipient_name, message_body, channel, recipient_email, subject, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING queue_id, created_at`,
      [recipient_phone, recipient_name, message_body, channel, recipient_email, subject, scheduled_at]
    );

    const queueId = result.rows[0].queue_id;

    // Log activity
    await pool.query(
      'INSERT INTO activity_log (user_id, action, details) VALUES ($1, $2, $3)',
      [
        userId,
        'external_api_scheduled',
        JSON.stringify({
          queue_id: queueId,
          source: 'external_api',
          metadata
        })
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        queue_id: queueId,
        status: 'pending',
        scheduled_at,
        estimated_delivery: scheduledDate.toISOString()
      }
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'Duplicate message (unique constraint)' });
    }
    console.error('Error scheduling message via external API:', error.message);
    res.status(500).json({ success: false, error: 'Failed to schedule message' });
  }
});

/**
 * GET /api/external/status/:queueId
 * Check the delivery status of a message.
 */
router.get('/status/:queueId', validateApiKey, async (req, res) => {
  try {
    const userId = req.userId;
    const queueId = parseInt(req.params.queueId, 10);

    const result = await userQuery(
      userId,
      'SELECT queue_id, status, scheduled_at, created_at, retry_count FROM active_queue WHERE queue_id = $2 AND user_id = $1',
      [queueId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    const message = result.rows[0];

    res.json({
      success: true,
      data: {
        queue_id: message.queue_id,
        status: message.status,
        scheduled_at: message.scheduled_at,
        created_at: message.created_at,
        retry_count: message.retry_count
      }
    });
  } catch (error) {
    console.error('Error fetching message status:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch status' });
  }
});

/**
 * GET /api/external/quota
 * Check current usage and quota.
 */
router.get('/quota', validateApiKey, async (req, res) => {
  try {
    const userId = req.userId;

    // Get user tier
    const userResult = await pool.query('SELECT tier FROM users WHERE user_id = $1', [userId]);
    const tier = userResult.rows[0]?.tier || 'FREE';

    // Get current month's usage
    const currentMonth = new Date().toISOString().split('T')[0].slice(0, 7) + '-01';
    const usageResult = await pool.query(
      'SELECT message_count FROM monthly_usage WHERE user_id = $1 AND month = $2',
      [userId, currentMonth]
    );

    const TIER_LIMITS = { FREE: 10, BASIC: 100, PRO: 400, ENTERPRISE: 3000 };
    const limit = TIER_LIMITS[tier] || 10;
    const used = usageResult.rows[0]?.message_count || 0;

    res.json({
      success: true,
      data: {
        tier,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        reset_date: currentMonth
      }
    });
  } catch (error) {
    console.error('Error fetching quota:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch quota' });
  }
});

export default router;
