import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';
import { sendMediaMessage, sendAudioMessage } from './sendHandler.js';

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

  let rows;
  try {
    const result = await pool.query(
      `SELECT queue_id, media_id, media_type, message_body
         FROM active_queue
        WHERE recipient_phone = $1 AND media_deferred = TRUE AND media_id IS NOT NULL
        ORDER BY queue_id ASC
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
      if (row.media_type === 'image' || row.media_type === 'video') {
        await sendMediaMessage(normalized, row.media_id, row.media_type, row.message_body);
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
