import express from 'express';
import { requireUser } from '../middleware/requireUser.js';
import { getUserMessages, userQuery } from '../db/multitenancyHelpers.js';

const router = express.Router();

/**
 * GET /api/messages
 * Get all scheduled messages for the authenticated user.
 */
router.get('/', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const { status, limit } = req.query;

    const result = await getUserMessages(userId, {
      status: status || undefined,
      limit: Math.min(parseInt(limit, 10) || 50, 500)
    });

    res.json({
      success: true,
      data: {
        count: result.rows.length,
        messages: result.rows
      }
    });
  } catch (error) {
    console.error('Error fetching messages:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
});

/**
 * GET /api/messages/:queueId
 * Get a specific message by queue ID (scoped to user).
 */
router.get('/:queueId', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const queueId = parseInt(req.params.queueId, 10);

    const result = await userQuery(
      userId,
      'SELECT * FROM active_queue WHERE queue_id = $2 AND user_id = $1',
      [queueId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error fetching message:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch message' });
  }
});

/**
 * POST /api/messages
 * Create a new scheduled message (queueing flow).
 * Cycle 3 will parse intent via LLM; this is the base structure.
 */
router.post('/', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const {
      recipient_phone,
      recipient_name,
      message_body,
      channel = 'whatsapp',
      recipient_email,
      subject,
      scheduled_at
    } = req.body;

    // Validation (Cycle 2 - basic; Cycle 3 will add LLM validation)
    if (!recipient_phone || !message_body || !scheduled_at) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: recipient_phone, message_body, scheduled_at'
      });
    }

    const result = await userQuery(
      userId,
      `INSERT INTO active_queue
       (user_id, recipient_phone, recipient_name, message_body, channel, recipient_email, subject, scheduled_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [recipient_phone, recipient_name, message_body, channel, recipient_email, subject, scheduled_at]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating message:', error.message);
    res.status(500).json({ success: false, error: 'Failed to create message' });
  }
});

/**
 * DELETE /api/messages/:queueId
 * Cancel a pending scheduled message.
 */
router.delete('/:queueId', requireUser, async (req, res) => {
  try {
    const userId = req.userId;
    const queueId = parseInt(req.params.queueId, 10);

    const result = await userQuery(
      userId,
      'DELETE FROM active_queue WHERE queue_id = $2 AND user_id = $1 AND status = $3 RETURNING *',
      [queueId, 'pending']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Message not found or already sent' });
    }

    res.json({
      success: true,
      data: { message: 'Message cancelled', deleted: result.rows[0] }
    });
  } catch (error) {
    console.error('Error deleting message:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete message' });
  }
});

export default router;
