import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

// Long enough to send a photo, get distracted, and come back; short enough
// that a picture from this morning never attaches itself to tonight's request.
const TTL_MINUTES = 60;

// Meta keeps inbound media for about 30 days. Scheduling beyond that would
// queue a message that is guaranteed to fail on a day nobody is watching.
export const MAX_MEDIA_DAYS = 25;

// Captions are capped well below the 4096 characters a plain message allows.
export const MAX_CAPTION = 1024;

/**
 * Hold the file a sender just posted until they say what to do with it.
 * Only the newest is kept: a second photo replaces the first, which is what
 * someone who sends two in a row means.
 */
export async function storePendingMedia(userId, senderPhone, mediaId, mediaType, caption = null) {
  const phone = normalizePhoneNumber(senderPhone);

  await pool.query('DELETE FROM pending_media WHERE sender_phone = $1', [phone]);
  await pool.query(
    `INSERT INTO pending_media (user_id, sender_phone, media_id, media_type, caption)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, phone, mediaId, mediaType, caption]
  );
}

/**
 * The file this sender is still holding, if any. Read without consuming —
 * the caller only clears it once the media is actually attached to a message.
 */
export async function peekPendingMedia(senderPhone) {
  const result = await pool.query(
    `SELECT * FROM pending_media
      WHERE sender_phone = $1
        AND created_at > NOW() - INTERVAL '${TTL_MINUTES} minutes'
      ORDER BY created_at DESC LIMIT 1`,
    [normalizePhoneNumber(senderPhone)]
  );
  return result.rows[0] || null;
}

export async function clearPendingMedia(senderPhone) {
  await pool.query(
    'DELETE FROM pending_media WHERE sender_phone = $1',
    [normalizePhoneNumber(senderPhone)]
  );
}

/**
 * Is this send date within the life of a Meta media id?
 */
export function isWithinMediaHorizon(scheduledAt) {
  const days = (new Date(scheduledAt).getTime() - Date.now()) / 86_400_000;
  return days <= MAX_MEDIA_DAYS;
}
