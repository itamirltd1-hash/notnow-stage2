import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

// WhatsApp allows free-form text only within 24h of the recipient's last
// inbound message. A small margin keeps a send from landing just past the edge.
const WINDOW_MS = 24 * 60 * 60 * 1000;
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Record that a number just messaged the business, opening its service window.
 */
export async function recordInboundMessage(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return;

  try {
    await pool.query(
      `INSERT INTO whatsapp_inbound (phone_number, last_message_at)
       VALUES ($1, NOW())
       ON CONFLICT (phone_number)
       DO UPDATE SET last_message_at = NOW()`,
      [normalized]
    );
  } catch (error) {
    console.error('Error recording inbound message:', error.message);
  }
}

/**
 * Can we still send free-form text to this number?
 * Returns false when unknown — a template send always works, so the safe
 * default is the one that cannot be rejected for being out of window.
 */
export async function isWithinServiceWindow(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return false;

  try {
    const result = await pool.query(
      'SELECT last_message_at FROM whatsapp_inbound WHERE phone_number = $1',
      [normalized]
    );

    if (result.rows.length === 0) return false;

    const age = Date.now() - new Date(result.rows[0].last_message_at).getTime();
    return age < WINDOW_MS - SAFETY_MARGIN_MS;
  } catch (error) {
    console.error('Error checking service window:', error.message);
    return false;
  }
}
