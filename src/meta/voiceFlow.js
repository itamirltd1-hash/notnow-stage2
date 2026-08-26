import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

// A choice the sender never answers should not resurface hours later attached
// to an unrelated message.
const PENDING_TTL_MINUTES = 30;

const CHOOSE_TEXT = /^\s*(טקסט|כתוב|1|text)\s*[!.]?\s*$/i;
const CHOOSE_AUDIO = /^\s*(קול|קולי|הקלטה|הקליט|2|audio|voice)\s*[!.]?\s*$/i;

/**
 * Park a parsed voice request until the sender says how to deliver it.
 * Only the newest request per sender is kept, so a second voice note simply
 * replaces the question rather than stacking another one behind it.
 */
export async function storePendingVoice(userId, senderPhone, mediaId, transcript, entities, confirmationText) {
  const phone = normalizePhoneNumber(senderPhone);

  await pool.query('DELETE FROM pending_voice WHERE sender_phone = $1', [phone]);

  const result = await pool.query(
    `INSERT INTO pending_voice
       (user_id, sender_phone, media_id, transcript, entities, confirmation_text)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING pending_id`,
    [userId, phone, mediaId, transcript, JSON.stringify(entities || {}), confirmationText || null]
  );

  return result.rows[0].pending_id;
}

/**
 * Read the sender's answer to the delivery question.
 * Returns null when there is nothing pending or the reply is not an answer,
 * letting the message fall through to normal handling.
 */
export async function resolvePendingVoice(senderPhone, text) {
  const wantsText = CHOOSE_TEXT.test(text);
  const wantsAudio = CHOOSE_AUDIO.test(text);
  if (!wantsText && !wantsAudio) return null;

  const phone = normalizePhoneNumber(senderPhone);

  const result = await pool.query(
    `SELECT * FROM pending_voice
      WHERE sender_phone = $1
        AND created_at > NOW() - INTERVAL '${PENDING_TTL_MINUTES} minutes'
      ORDER BY created_at DESC
      LIMIT 1`,
    [phone]
  );

  if (result.rows.length === 0) return null;

  const pending = result.rows[0];
  await pool.query('DELETE FROM pending_voice WHERE sender_phone = $1', [phone]);

  return {
    userId: pending.user_id,
    entities: pending.entities || {},
    confirmationText: pending.confirmation_text,
    transcript: pending.transcript,
    mediaId: wantsAudio ? pending.media_id : null,
    choice: wantsAudio ? 'audio' : 'text'
  };
}

/**
 * Clear anything expired. Cheap enough to run alongside the dispatcher.
 */
export async function purgeExpiredPendingVoice() {
  try {
    await pool.query(
      `DELETE FROM pending_voice
        WHERE created_at < NOW() - INTERVAL '${PENDING_TTL_MINUTES} minutes'`
    );
  } catch (error) {
    console.error('Error purging pending voice requests:', error.message);
  }
}
