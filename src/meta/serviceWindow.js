import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

// WhatsApp allows free-form text only within 24h of the recipient's last
// inbound message. A small margin keeps a send from landing just past the edge.
const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * The number we are sending from right now.
 *
 * Read per call rather than captured at import, so a number change takes
 * effect on the next send rather than on the next restart.
 */
function currentBusinessNumber() {
  return process.env.META_PHONE_NUMBER_ID || 'unknown';
}

/**
 * Record that a number just messaged one of our business numbers, opening its
 * service window with that number.
 *
 * The window is a property of the pair, not of the recipient: writing to the
 * old number says nothing about whether we may write from the new one.
 */
export async function recordInboundMessage(phone, businessPhoneId = null) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return;

  try {
    await pool.query(
      `INSERT INTO whatsapp_inbound (phone_number, business_phone_id, last_message_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (phone_number, business_phone_id)
       DO UPDATE SET last_message_at = NOW()`,
      [normalized, businessPhoneId || currentBusinessNumber()]
    );
  } catch (error) {
    console.error('Error recording inbound message:', error.message);
  }
}

/**
 * Can we still send free-form text to this number, from the number we are
 * sending from now?
 *
 * Returns false when unknown — a template send always works, so the safe
 * default is the one that cannot be rejected for being out of window. That is
 * also what makes changing the sending number survivable: every window reads
 * as closed until the recipient writes to the new number, which costs a
 * template and never costs a failed send.
 */
export async function isWithinServiceWindow(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return false;

  try {
    const result = await pool.query(
      `SELECT last_message_at FROM whatsapp_inbound
        WHERE phone_number = $1 AND business_phone_id = $2`,
      [normalized, currentBusinessNumber()]
    );

    if (result.rows.length === 0) return false;

    const age = Date.now() - new Date(result.rows[0].last_message_at).getTime();
    return age < WINDOW_MS - SAFETY_MARGIN_MS;
  } catch (error) {
    console.error('Error checking service window:', error.message);
    return false;
  }
}
