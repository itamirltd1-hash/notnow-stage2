import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

// Long enough to look something up mid-sentence, short enough that an answer
// never attaches itself to a question from hours ago.
const TTL_MINUTES = 20;

// "cancel" is deliberately absent: the queue command matches it first, the
// same way "בטל" does, so listing it here would be a dead alternative.
const ABANDON = /^\s*(?:לא\s+משנה|עזוב|עזבי|בטל\s+את\s+זה|שכח\s+מזה|תשכח\s+מזה|nevermind|never\s+mind|forget\s+it|forget\s+that|drop\s+it|leave\s+it|scrap\s+that)\s*[!.]?\s*$/i;

export function isAbandonment(text) {
  return ABANDON.test(text);
}

/**
 * Park what has been understood so far, so the answer to the bot's question
 * has somewhere to land.
 */
export async function storePendingRequest(userId, senderPhone, entities, mediaId = null, mediaType = null) {
  const phone = normalizePhoneNumber(senderPhone);

  await pool.query('DELETE FROM pending_request WHERE sender_phone = $1', [phone]);
  await pool.query(
    `INSERT INTO pending_request (user_id, sender_phone, entities, media_id, media_type)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, phone, JSON.stringify(entities || {}), mediaId, mediaType]
  );
}

/**
 * The half-finished request, and whether it is still current.
 *
 * Expired rows are returned too, flagged: a person answering a question the
 * bot has forgotten deserves to be told that, not asked the same thing again.
 */
export async function peekPendingRequest(senderPhone) {
  const phone = normalizePhoneNumber(senderPhone);

  const result = await pool.query(
    `SELECT *, created_at > NOW() - INTERVAL '${TTL_MINUTES} minutes' AS is_fresh
       FROM pending_request
      WHERE sender_phone = $1
      ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );

  return result.rows[0] || null;
}

export async function clearPendingRequest(senderPhone) {
  await pool.query(
    'DELETE FROM pending_request WHERE sender_phone = $1',
    [normalizePhoneNumber(senderPhone)]
  );
}

/**
 * Fold a new answer into what was already understood.
 *
 * Anything the new message states wins — someone correcting themselves means
 * the correction — but a field it says nothing about keeps its earlier value,
 * which is the whole point.
 */
export function mergeEntities(stored = {}, fresh = {}) {
  const merged = { ...stored };

  for (const [key, value] of Object.entries(fresh)) {
    if (value !== null && value !== undefined && value !== '') {
      merged[key] = value;
    }
  }

  // A recipient named a second way replaces the first rather than joining it.
  if (fresh.recipient_phone) merged.recipient_group = null;
  if (fresh.recipient_group) {
    merged.recipient_phone = null;
    merged.recipient_name = null;
  }

  return merged;
}

/**
 * Does this have everything needed to be scheduled?
 */
export function isComplete(entities = {}, hasMedia = false) {
  const hasRecipient = Boolean(
    entities.recipient_phone || entities.recipient_name || entities.recipient_group
  );
  const hasContent = Boolean(entities.message_body) || hasMedia;
  return hasRecipient && hasContent && Boolean(entities.scheduled_timestamp);
}
