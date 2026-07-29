import pool from '../db/pool.js';

const BATCH_SIZE = 100;
const RETRY_DELAYS = [5000, 15000, 60000]; // 5s, 15s, 60s backoff

/**
 * Main dispatcher: Batch process all pending messages due for delivery.
 * Run this periodically (every minute via cron).
 */
export async function dispatchPendingMessages() {
  try {
    const now = new Date().toISOString();

    // Fetch pending messages that are due for delivery
    const result = await pool.query(
      `SELECT * FROM active_queue
       WHERE status = 'pending' AND scheduled_at <= $1
       ORDER BY scheduled_at ASC
       LIMIT $2`,
      [now, BATCH_SIZE]
    );

    const messages = result.rows;

    if (messages.length === 0) {
      return { processed: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        // Send the message (placeholder for Cycle 3+ actual sends)
        await sendMessage(message);
        sent++;

        // Mark as sent
        await pool.query(
          'UPDATE active_queue SET status = $1, updated_at = NOW() WHERE queue_id = $2',
          ['sent', message.queue_id]
        );

        // Log to activity log
        await logActivity(message.user_id, 'message_sent', {
          queue_id: message.queue_id,
          recipient: message.recipient_phone,
          channel: message.channel
        });
      } catch (error) {
        failed++;
        await handleFailedMessage(message, error);
      }
    }

    console.log(`📤 Dispatcher batch: processed=${messages.length}, sent=${sent}, failed=${failed}`);

    return { processed: messages.length, sent, failed };
  } catch (error) {
    console.error('Error in batch dispatcher:', error.message);
    return { processed: 0, sent: 0, failed: 0, error: error.message };
  }
}

/**
 * Send a single message via the appropriate channel.
 * Returns success or throws error.
 */
async function sendMessage(message) {
  // TODO: Implement actual send logic based on channel
  // For now, simulate success with small delay
  return new Promise((resolve) => {
    setTimeout(() => {
      console.log(`✅ Sent ${message.channel} to ${message.recipient_phone}`);
      resolve();
    }, 100);
  });
}

/**
 * Handle a failed message: retry with exponential backoff.
 */
async function handleFailedMessage(message, error) {
  try {
    const retryCount = (message.retry_count || 0) + 1;
    const maxRetries = 3;

    if (retryCount > maxRetries) {
      // Give up after max retries
      await pool.query(
        'UPDATE active_queue SET status = $1, updated_at = NOW() WHERE queue_id = $2',
        ['failed', message.queue_id]
      );

      await logActivity(message.user_id, 'message_failed', {
        queue_id: message.queue_id,
        error: error.message,
        retries: retryCount
      });

      console.error(`❌ Message ${message.queue_id} failed after ${retryCount} retries`);
      return;
    }

    // Schedule retry with exponential backoff
    const delayMs = RETRY_DELAYS[Math.min(retryCount - 1, RETRY_DELAYS.length - 1)];
    const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

    await pool.query(
      'UPDATE active_queue SET retry_count = $1, scheduled_at = $2, updated_at = NOW() WHERE queue_id = $3',
      [retryCount, nextRetryAt, message.queue_id]
    );

    await logActivity(message.user_id, 'message_retry_scheduled', {
      queue_id: message.queue_id,
      retry_count: retryCount,
      next_attempt_at: nextRetryAt,
      error: error.message
    });

    console.log(`🔄 Scheduled retry ${retryCount} for message ${message.queue_id} at ${nextRetryAt}`);
  } catch (retryError) {
    console.error('Error handling failed message:', retryError.message);
  }
}

/**
 * Log an activity event for audit trail.
 */
async function logActivity(userId, action, details) {
  try {
    await pool.query(
      'INSERT INTO activity_log (user_id, action, details) VALUES ($1, $2, $3)',
      [userId, action, JSON.stringify(details)]
    );
  } catch (error) {
    console.error('Error logging activity:', error.message);
  }
}

/**
 * Get dispatcher metrics (for monitoring).
 */
export async function getDispatcherMetrics() {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM active_queue WHERE status = 'pending') as pending_count,
        (SELECT COUNT(*) FROM active_queue WHERE status = 'sent') as sent_count,
        (SELECT COUNT(*) FROM active_queue WHERE status = 'failed') as failed_count,
        (SELECT COUNT(*) FROM active_queue WHERE retry_count > 0) as retried_count
    `);

    return result.rows[0];
  } catch (error) {
    console.error('Error fetching metrics:', error.message);
    return null;
  }
}
