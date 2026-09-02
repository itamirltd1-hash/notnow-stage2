import pool from '../db/pool.js';
import { notifySenderOfFailure } from '../dispatcher/failureNotice.js';

/**
 * Apply one Meta delivery-status event to its queued message.
 *
 * Meta returns 200 OK on send and reports the outcome asynchronously here,
 * so this is the only place that knows whether a message actually arrived.
 * Status events also arrive for the bot's own conversational replies, which
 * are never queued — those simply match no row and are ignored.
 */
export async function recordDeliveryStatus(event) {
  const { messageId, status, timestamp, errorCode, errorMessage } = event;
  if (!messageId) return;

  const at = timestamp
    ? new Date(Number(timestamp) * 1000).toISOString()
    : new Date().toISOString();

  try {
    let result;

    if (status === 'failed') {
      result = await pool.query(
        `UPDATE active_queue
            SET status = 'failed',
                error_code = $1,
                error_message = $2,
                updated_at = NOW()
          WHERE provider_message_id = $3
          RETURNING queue_id, user_id, recipient_phone, recipient_name, scheduled_at`,
        [errorCode, errorMessage, messageId]
      );
    } else if (status === 'delivered' || status === 'read') {
      const column = status === 'read' ? 'read_at' : 'delivered_at';
      result = await pool.query(
        `UPDATE active_queue
            SET ${column} = $1, updated_at = NOW()
          WHERE provider_message_id = $2
          RETURNING queue_id`,
        [at, messageId]
      );
    } else {
      return; // 'sent' adds nothing beyond what the dispatcher already recorded
    }

    if (result.rowCount === 0) {
      return; // not a queued message (e.g. a conversational reply)
    }

    const row = result.rows[0];

    if (status === 'failed') {
      console.error(
        `❌ Delivery FAILED for queue_id=${row.queue_id} → ${row.recipient_phone}: ` +
        `[${errorCode}] ${errorMessage}`
      );
      await pool.query(
        'INSERT INTO activity_log (user_id, action, details) VALUES ($1, $2, $3)',
        [row.user_id, 'message_delivery_failed', JSON.stringify({
          queue_id: row.queue_id,
          error_code: errorCode,
          error_message: errorMessage
        })]
      );

      // This is the quiet failure. Meta returned 200 on send, the dispatcher
      // reported success, and the row only turns to 'failed' here — minutes
      // later, in a webhook nobody is watching. Without this the sender goes
      // on believing the message went out, which is worse than an error
      // because nothing ever looked wrong.
      await notifySenderOfFailure({
        userId: row.user_id,
        recipientName: row.recipient_name,
        recipientPhone: row.recipient_phone,
        scheduledAt: row.scheduled_at,
        errorCode: Number(errorCode)
      });
    } else {
      console.log(`📬 queue_id=${row.queue_id} → ${status}`);
    }
  } catch (error) {
    console.error('Error recording delivery status:', error.message);
  }
}

/**
 * Apply a batch of status events from one webhook call.
 */
export async function recordDeliveryStatuses(events) {
  for (const event of events) {
    await recordDeliveryStatus(event);
  }
}
