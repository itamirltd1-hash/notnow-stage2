import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';
import { sendMediaMessage, sendAudioMessage } from './sendHandler.js';
import { senderSignature, sign } from './attribution.js';
import { isSuppressed } from '../privacy/erasure.js';

/**
 * Deliver files that were promised but could not be sent at the time.
 *
 * A template cannot carry a photo, so a message scheduled to someone outside
 * the 24-hour window goes out as text saying a file is waiting and to reply.
 * Their reply opens the window — this is the part that keeps that promise.
 *
 * Called on every inbound message, so a recipient who answers anything at all
 * gets what they were told they would get.
 */
export async function deliverDeferredMedia(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return;

  // Someone who asked to be erased is owed nothing, including a file we said
  // was coming. The promise was made before they withdrew; it does not survive.
  if (await isSuppressed(normalized)) return;

  let rows;
  try {
    // "Reply and I'll send it" was addressed to someone who had not yet said
    // no. A row stays flagged after its recipient declines, and the next thing
    // they typed — including the refusal itself — delivered the file anyway.
    const result = await pool.query(
      `SELECT q.queue_id, q.user_id, q.media_id, q.media_type, q.media_filename, q.message_body
         FROM active_queue q
        WHERE q.recipient_phone = $1
          AND q.media_deferred = TRUE
          AND q.media_id IS NOT NULL
          AND q.status <> 'cancelled'
          AND NOT EXISTS (
                SELECT 1 FROM contacts c
                 WHERE c.phone_number = q.recipient_phone
                   AND c.consent_status = 'declined'
              )
        ORDER BY q.queue_id ASC
        LIMIT 5`,
      [normalized]
    );
    rows = result.rows;
  } catch (error) {
    console.error('Error looking up deferred media:', error.message);
    return;
  }

  if (rows.length === 0) return;

  console.log(`📎 ${rows.length} file(s) were waiting for ${normalized} to reply`);

  for (const row of rows) {
    try {
      if (['image', 'video', 'document'].includes(row.media_type)) {
        const signature = await senderSignature(row.user_id, normalized);
        await sendMediaMessage(normalized, row.media_id, row.media_type, sign(row.message_body, signature), row.media_filename);
      } else {
        await sendAudioMessage(normalized, row.media_id);
      }

      await pool.query(
        'UPDATE active_queue SET media_deferred = FALSE, updated_at = NOW() WHERE queue_id = $1',
        [row.queue_id]
      );
    } catch (error) {
      // Meta keeps a file for about a month; past that there is nothing to
      // send and retrying on every message would be pointless noise.
      console.error(`Could not deliver deferred media for queue_id=${row.queue_id}:`, error.message);
      await pool.query(
        'UPDATE active_queue SET media_deferred = FALSE, updated_at = NOW() WHERE queue_id = $1',
        [row.queue_id]
      );
    }
  }
}

/**
 * Remember that this row's file still owes the recipient a delivery.
 */
export async function markMediaDeferred(queueId) {
  try {
    await pool.query(
      'UPDATE active_queue SET media_deferred = TRUE WHERE queue_id = $1',
      [queueId]
    );
  } catch (error) {
    console.error('Error marking media deferred:', error.message);
  }
}
