import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

/**
 * Who a scheduled message should be signed by, if anyone.
 *
 * Every message leaves from the business number, so the recipient sees Cue and
 * not the person who wrote it — the name has to travel inside the text or it
 * is lost. A reminder someone scheduled for themselves needs no signature and
 * reads oddly with one, so this returns null for those.
 */
export async function senderSignature(userId, recipientPhone) {
  if (!userId || !recipientPhone) return null;

  try {
    const normalized = normalizePhoneNumber(recipientPhone);

    const self = await pool.query(
      `SELECT 1 FROM contacts
        WHERE user_id = $1 AND is_owner = TRUE AND phone_number = $2
        LIMIT 1`,
      [userId, normalized]
    );
    if (self.rowCount > 0) return null;

    const user = await pool.query(
      'SELECT display_name FROM users WHERE user_id = $1',
      [userId]
    );
    return user.rows[0]?.display_name || null;
  } catch (error) {
    console.error('Error resolving sender signature:', error.message);
    return null;
  }
}

/**
 * A dash and a name, rather than "מ" plus the name — the preposition has to
 * agree with names this service cannot predict, including Latin ones.
 */
export function sign(body, signature) {
  if (!signature) return body;
  return body ? `${body}\n\n— ${signature}` : `— ${signature}`;
}

/**
 * The template body has its own sentence around it, so the signature goes
 * inline rather than on a line of its own.
 */
export function signInline(body, signature) {
  if (!signature) return body;
  return body ? `${body} — ${signature}` : `— ${signature}`;
}
