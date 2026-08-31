import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

// Hebrew letters are what the sender's keyboard is already on; the Latin
// equivalents are accepted so an English keyboard is never a dead end.
const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];
const LATIN = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

const TTL_MINUTES = 30;

/**
 * Which option did this reply pick? Returns the index, or -1.
 * Deliberately not accepting digits: those already address the queue
 * ("בטל 2"), and a bare number would be ambiguous between the two.
 */
export function letterToIndex(text, { allowDigits = false } = {}) {
  const trimmed = text.trim().replace(/[.'"׳!]/g, '').toLowerCase();
  if (trimmed.length !== 1) return -1;

  const hebrew = LETTERS.indexOf(trimmed);
  if (hebrew !== -1) return hebrew;

  const latin = LATIN.indexOf(trimmed);
  if (latin !== -1) return latin;

  // Only where the question itself was numbered. A bare digit is ambiguous in
  // general — "2" could mean the second option or the second queued message —
  // but not when the list on screen is the numbered one being answered.
  if (allowDigits && /^[1-9]$/.test(trimmed)) return Number(trimmed) - 1;

  return -1;
}

export function letterFor(index) {
  return LETTERS[index] || String(index + 1);
}

/**
 * Render options as a labelled list the sender can answer with one letter.
 */
export function formatOptions(options, describe) {
  return options.map((o, i) => `${letterFor(i)}. ${describe(o)}`).join('\n');
}

/**
 * Remember an open question. Only one per sender — a newer question replaces
 * the older one rather than leaving two live meanings for the letter "ב".
 */
export async function storeChoice(userId, senderPhone, kind, payload) {
  const phone = normalizePhoneNumber(senderPhone);

  await pool.query('DELETE FROM pending_choice WHERE sender_phone = $1', [phone]);
  // A voice question is also answered by a letter, so it cannot stay open.
  await pool.query('DELETE FROM pending_voice WHERE sender_phone = $1', [phone]);

  await pool.query(
    `INSERT INTO pending_choice (user_id, sender_phone, kind, payload)
     VALUES ($1, $2, $3, $4)`,
    [userId, phone, kind, JSON.stringify(payload)]
  );
}

/**
 * Resolve a reply against the open question, if there is one and the reply is
 * a letter. Returns { kind, payload, option, index } or null.
 */
export async function resolveChoice(senderPhone, text) {
  // Whether a digit counts depends on how the question was asked, so the
  // stored question has to be read before the answer can be interpreted.
  if (letterToIndex(text, { allowDigits: true }) === -1) return null;

  const phone = normalizePhoneNumber(senderPhone);

  const result = await pool.query(
    `SELECT * FROM pending_choice
      WHERE sender_phone = $1
        AND created_at > NOW() - INTERVAL '${TTL_MINUTES} minutes'
      ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  const options = row.payload.options || [];

  const index = letterToIndex(text, { allowDigits: row.payload.allowDigits === true });
  if (index === -1) return null;

  if (index >= options.length) {
    return { kind: 'out_of_range', optionCount: options.length };
  }

  await pool.query('DELETE FROM pending_choice WHERE choice_id = $1', [row.choice_id]);

  return {
    kind: row.kind,
    userId: row.user_id,
    payload: row.payload,
    option: options[index],
    index
  };
}

export async function clearChoice(senderPhone) {
  await pool.query(
    'DELETE FROM pending_choice WHERE sender_phone = $1',
    [normalizePhoneNumber(senderPhone)]
  );
}
