import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

// Phrased as people phrase it, not as a policy names it.
const ERASE = /^\s*(?:מחק|תמחק|מחקו|תמחקו|הסר\s+לגמרי|למחוק)\s*(?:אותי|את\s+(?:כל\s+)?(?:המידע|הפרטים|הנתונים)\s*(?:שלי)?)\s*[!.]?\s*$/;

export function isErasureRequest(text) {
  return ERASE.test(text);
}

/**
 * Erase everything held about a phone number, and remember not to contact it.
 *
 * A recipient never agreed to anything with this service — their number and
 * the messages sent to them were stored because someone else scheduled them.
 * Stopping messages is not the same as deleting the record, and only one of
 * those is what a person means when they ask to be removed.
 *
 * The number itself stays in suppressed_phones. That is the single piece that
 * makes the request stick: without it the next person to save them as a
 * contact would restart the whole conversation.
 */
export async function eraseByPhone(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO suppressed_phones (phone_number) VALUES ($1)
       ON CONFLICT (phone_number) DO NOTHING`,
      [normalized]
    );

    const queued = await client.query(
      'DELETE FROM active_queue WHERE recipient_phone = $1 RETURNING queue_id',
      [normalized]
    );

    // Their own account, if messaging the bot ever created one for them.
    const owned = await client.query(
      `SELECT user_id FROM contacts WHERE phone_number = $1 AND is_owner = TRUE`,
      [normalized]
    );
    for (const row of owned.rows) {
      // Everything else cascades from users.
      await client.query('DELETE FROM users WHERE user_id = $1', [row.user_id]);
    }

    const contacts = await client.query(
      'DELETE FROM contacts WHERE phone_number = $1 RETURNING contact_id',
      [normalized]
    );

    await client.query('DELETE FROM whatsapp_inbound WHERE phone_number = $1', [normalized]);
    await client.query('DELETE FROM pending_choice WHERE sender_phone = $1', [normalized]);
    await client.query('DELETE FROM pending_media WHERE sender_phone = $1', [normalized]);
    await client.query('DELETE FROM pending_voice WHERE sender_phone = $1', [normalized]);

    await client.query('COMMIT');

    console.log(
      `🗑️  Erased ${normalized}: ${contacts.rowCount} contact(s), ` +
      `${queued.rowCount} queued message(s), ${owned.rowCount} account(s)`
    );

    return { contacts: contacts.rowCount, queued: queued.rowCount, accounts: owned.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erasure failed:', error.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Has this number asked never to be contacted again?
 * Checked before every send, so an erasure cannot be undone by someone
 * re-adding them as a contact.
 */
export async function isSuppressed(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return false;

  try {
    const result = await pool.query(
      'SELECT 1 FROM suppressed_phones WHERE phone_number = $1 LIMIT 1',
      [normalized]
    );
    return result.rowCount > 0;
  } catch (error) {
    console.error('Error checking suppression list:', error.message);
    return false;
  }
}

export const ERASURE_CONFIRMATION =
  'נמחקת. כל המידע שהוחזק עליך — מספר, שם, והודעות שתוזמנו אליך — הוסר.\n\n' +
  'שמרנו רק את המספר עצמו ברשימת חסימה, כדי שלא נפנה אליך שוב — גם אם ' +
  'ינסו להוסיף אותך מחדש.';
