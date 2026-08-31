import pool from '../db/pool.js';
import { sendWhatsAppMessage, sendTemplateMessage, sendAudioMessage, sendMediaMessage } from '../meta/sendHandler.js';
import { isWithinServiceWindow } from '../meta/serviceWindow.js';
import { markMediaDeferred } from '../meta/deferredMedia.js';
import { senderSignature, sign, signInline } from '../meta/attribution.js';
import { isSuppressed } from '../privacy/erasure.js';

const BATCH_SIZE = 100;
const RETRY_DELAYS = [5000, 15000, 60000]; // 5s, 15s, 60s backoff

// Must match the template approved in Meta exactly, or every send is rejected.
// Body: "שלום {{1}}, תזכורת להודעה: {{2}} (נשלח מ-Cue)"
// The brand appears inside that approved body, so renaming it means
// re-submitting the template — see src/brand.js.
const TEMPLATE_NAME = process.env.META_TEMPLATE_NAME || 'scheduled_message_reminder';
const TEMPLATE_LANGUAGE = process.env.META_TEMPLATE_LANGUAGE || 'he';

/**
 * Main dispatcher: Batch process all pending messages due for delivery.
 * Run this periodically (every minute via cron).
 */
export async function dispatchPendingMessages() {
  try {
    const now = new Date().toISOString();
    console.log(`⏰ Dispatcher running at ${now}`);

    // Fetch pending messages that are due for delivery
    console.log(`🔍 Querying active_queue for pending messages...`);
    const result = await pool.query(
      `SELECT * FROM active_queue
       WHERE status = 'pending' AND scheduled_at <= $1
       ORDER BY scheduled_at ASC
       LIMIT $2`,
      [now, BATCH_SIZE]
    );
    console.log(`✅ Query successful, found ${result.rows.length} messages`);

    const messages = result.rows;

    if (messages.length === 0) {
      return { processed: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    for (const message of messages) {
      // An erasure is final, so this is cancelled rather than retried — three
      // attempts to contact someone who asked not to be is exactly wrong.
      if (await isSuppressed(message.recipient_phone)) {
        await pool.query(
          `UPDATE active_queue SET status = 'cancelled', updated_at = NOW()
            WHERE queue_id = $1`,
          [message.queue_id]
        );
        console.log(`🚫 queue_id=${message.queue_id} cancelled — recipient asked to be removed`);
        continue;
      }

      try {
        const sendResult = await sendMessage(message);
        sent++;

        // 'sent' here means Meta accepted it, not that it arrived. The real
        // outcome comes back later on the statuses webhook, matched by this id.
        await pool.query(
          `UPDATE active_queue
              SET status = 'sent',
                  provider_message_id = $1,
                  sent_at = NOW(),
                  updated_at = NOW()
            WHERE queue_id = $2`,
          [sendResult?.messageId || null, message.queue_id]
        );

        // Log to activity log
        await logActivity(message.user_id, 'message_sent', {
          queue_id: message.queue_id,
          recipient: message.recipient_phone,
          channel: message.channel,
          provider_message_id: sendResult?.messageId || null
        });
      } catch (error) {
        failed++;
        await handleFailedMessage(message, error);
      }
    }

    console.log(
      `📤 Dispatcher batch: processed=${messages.length}, ` +
      `accepted=${sent}, rejected=${failed} (delivery confirmed separately)`
    );

    return { processed: messages.length, sent, failed };
  } catch (error) {
    console.error('❌ Error in batch dispatcher:', error.message);
    console.error('   Stack:', error.stack);
    console.error('   Full error:', error);
    return { processed: 0, sent: 0, failed: 0, error: error.message };
  }
}

/**
 * Send a single message via the appropriate channel.
 * Returns success or throws error.
 */
async function sendMessage(message) {
  const { channel, recipient_phone, recipient_name, message_body, media_id, media_type, media_filename } = message;

  if (channel === 'whatsapp') {
    // Someone who asked to be erased stays erased, even if a message to them
    // was queued before the request or they were re-added afterwards.
    if (await isSuppressed(recipient_phone)) {
      throw new Error(`${recipient_phone} asked to be removed and is not contacted`);
    }

    // The recipient sees the business number, not the person who wrote this,
    // so the name travels in the text. Null for a message to oneself.
    const signature = await senderSignature(message.user_id, recipient_phone);

    // Free-form text reaches only people who wrote to us in the last 24 hours.
    // Everyone else must be reached through the approved template.
    if (await isWithinServiceWindow(recipient_phone)) {
      if (media_id) {
        // media_type was added later; rows from before it default to audio,
        // which is the only kind that existed then.
        return ['image', 'video', 'document'].includes(media_type)
          ? await sendMediaMessage(recipient_phone, media_id, media_type, sign(message_body, signature), media_filename)
          : await sendAudioMessage(recipient_phone, media_id);
      }
      return await sendWhatsAppMessage(recipient_phone, sign(message_body, signature));
    }

    if (media_id) {
      // No approved template carries a file, so the words go without it — and
      // the file is owed to them the moment their reply opens the window.
      console.log(`   ${recipient_phone} is outside the window — text now, file when they reply`);
      await markMediaDeferred(message.queue_id);
    }

    console.log(`   ${recipient_phone} is outside the 24h window — using template`);
    // A media-only message has no text, and the template needs both slots
    // filled — an empty parameter is rejected outright.
    const body = message_body || 'נשלח אליך קובץ. אפשר להשיב כאן כדי לקבל אותו.';
    return await sendTemplateMessage(
      recipient_phone,
      TEMPLATE_NAME,
      TEMPLATE_LANGUAGE,
      // The template's own sentence wraps this, so the signature goes inline.
      [recipient_name || 'שלום', signInline(body, signature)]
    );
  } else if (channel === 'email') {
    // TODO: Implement email sending via Resend
    throw new Error('Email channel not yet implemented');
  } else {
    throw new Error(`Unknown channel: ${channel}`);
  }
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
        `UPDATE active_queue
            SET status = 'failed', error_message = $1, updated_at = NOW()
          WHERE queue_id = $2`,
        [error.message?.slice(0, 500) || null, message.queue_id]
      );

      await logActivity(message.user_id, 'message_failed', {
        queue_id: message.queue_id,
        error: error.message,
        retries: retryCount
      });

      console.error(`❌ Message ${message.queue_id} failed after ${retryCount} retries`);

      // Silence here means the sender believes the message went out. Tell them.
      await notifySenderOfFailure(message);
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
 * Tell the person who scheduled a message that it never arrived.
 *
 * Without this the queue row turns to 'failed' and nothing else happens — the
 * sender is left believing it went out. Best effort: if this notification
 * itself cannot be delivered, the failure is already in the log.
 */
async function notifySenderOfFailure(message) {
  try {
    const owner = await pool.query(
      `SELECT phone_number FROM contacts
        WHERE user_id = $1 AND is_owner = TRUE LIMIT 1`,
      [message.user_id]
    );
    const senderPhone = owner.rows[0]?.phone_number;
    if (!senderPhone) return;

    // Only reachable while the sender's own window is open, which is the
    // common case: they were talking to the bot when they scheduled it.
    if (!(await isWithinServiceWindow(senderPhone))) {
      console.log(`   Cannot notify ${senderPhone} of the failure — outside their window`);
      return;
    }

    const when = new Date(message.scheduled_at).toLocaleString('he-IL', {
      timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
    const who = message.recipient_name || message.recipient_phone;

    await sendWhatsAppMessage(
      senderPhone,
      `ההודעה ל${who} שתוזמנה ל-${when} לא נשלחה.\n\n` +
      `אפשר לנסות לתזמן אותה שוב.`
    );
  } catch (error) {
    console.error('Could not notify sender of failure:', error.message);
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
        (SELECT COUNT(*) FROM active_queue WHERE retry_count > 0) as retried_count,
        (SELECT COUNT(*) FROM active_queue WHERE delivered_at IS NOT NULL) as delivered_count,
        (SELECT COUNT(*) FROM active_queue WHERE read_at IS NOT NULL) as read_count,
        (SELECT COUNT(*) FROM active_queue WHERE error_code IS NOT NULL) as delivery_error_count
    `);

    return result.rows[0];
  } catch (error) {
    console.error('Error fetching metrics:', error.message);
    return null;
  }
}
