import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';
import { sendWhatsAppMessage, sendTemplateMessage } from './sendHandler.js';
import { isWithinServiceWindow } from './serviceWindow.js';

const TEMPLATE_NAME = process.env.META_TEMPLATE_NAME || 'scheduled_message_reminder';
const TEMPLATE_LANGUAGE = process.env.META_TEMPLATE_LANGUAGE || 'he';

// The words always count: "הסר" and "stop" are the opt-out keywords people
// already expect, and dropping them would break a convention Meta relies on.
const AGREE = /^\s*(כן|מאשר|מאשרת|אישור|אוקיי|אוקי|בסדר|yes|y|ok|start)\s*[!.]?\s*$/i;
const REFUSE = /^\s*(לא|הסר|הסירו|תסיר|בטל|הפסק|די|stop|unsubscribe|no)\s*[!.]?\s*$/i;

// A bare letter only answers a consent question that is actually open. A
// tenant whose own contact row is already 'granted' answers letters to the
// bot's other questions all the time — those must not land here.
const LETTER_YES = /^\s*(א|a)\s*[!.]?\s*$/i;
const LETTER_NO = /^\s*(ב|b)\s*[!.]?\s*$/i;

/**
 * Does this recipient have an answer on file, one way or the other?
 */
export async function getConsentStatus(userId, phone) {
  const normalized = normalizePhoneNumber(phone);
  const result = await pool.query(
    'SELECT consent_status FROM contacts WHERE user_id = $1 AND phone_number = $2',
    [userId, normalized]
  );
  return result.rows[0]?.consent_status || 'unknown';
}

/**
 * Ask a recipient for permission before anything is ever scheduled to them.
 *
 * Meta permits a template for exactly this purpose, and asking once is far
 * cheaper than being reported: reports are what drive quality rating down and
 * get a number restricted.
 */
export async function requestConsent(userId, phone, senderName = null) {
  const normalized = normalizePhoneNumber(phone);

  // Naming the sender is the difference between a message a recipient
  // recognises and one that reads like an unsolicited approach.
  const who = senderName ? `${senderName} ביקש` : 'התקבלה בקשה';

  const ask =
    `${who} לתזמן עבורך הודעות דרך NotNow. ` +
    `להסכמה להשיב א, לסירוב ב — ואז לא נפנה אליך שוב.`;

  try {
    // A recipient who wrote to us recently can be asked in plain text.
    if (await isWithinServiceWindow(normalized)) {
      await sendWhatsAppMessage(normalized, ask);
    } else {
      await sendTemplateMessage(normalized, TEMPLATE_NAME, TEMPLATE_LANGUAGE, ['שלום', ask]);
    }

    await pool.query(
      `UPDATE contacts
          SET consent_status = 'requested',
              consent_requested_at = NOW(),
              consent_updated_at = NOW(),
              updated_at = NOW()
        WHERE user_id = $1 AND phone_number = $2`,
      [userId, normalized]
    );

    console.log(`🤝 Consent requested from ${normalized}`);
    return true;
  } catch (error) {
    console.error(`Failed to request consent from ${normalized}:`, error.message);
    return false;
  }
}

/**
 * Interpret an inbound message as a consent answer.
 *
 * Runs before any other handling, so a recipient answering "כן" is never
 * mistaken for a tenant issuing a scheduling command. Returns true when the
 * message was consumed as an answer.
 */
export async function handleConsentReply(phone, text) {
  const normalized = normalizePhoneNumber(phone);

  // Is a consent question actually open for this number right now?
  const asked = await pool.query(
    `SELECT 1 FROM contacts WHERE phone_number = $1 AND consent_status = 'requested' LIMIT 1`,
    [normalized]
  );
  const questionIsOpen = asked.rowCount > 0;

  const agreed = AGREE.test(text) || (questionIsOpen && LETTER_YES.test(text));
  const refused = REFUSE.test(text) || (questionIsOpen && LETTER_NO.test(text));

  if (!agreed && !refused) {
    // "הסר" always wins, even from someone who never got an explicit ask.
    return false;
  }

  // Deliberately not scoped by user_id: a person's refusal must bind every
  // tenant, not only the one who happened to ask. This is the single place
  // in the codebase where crossing tenants is the correct behaviour.
  const pending = await pool.query(
    `SELECT contact_id, user_id FROM contacts
      WHERE phone_number = $1 AND consent_status IN ('requested', 'granted')`,
    [normalized]
  );

  // A refusal is honoured even with nothing pending; a "yes" needs a question.
  if (pending.rows.length === 0 && !refused) return false;
  if (pending.rows.length === 0 && refused) {
    await pool.query(
      `UPDATE contacts SET consent_status = 'declined', consent_updated_at = NOW()
        WHERE phone_number = $1`,
      [normalized]
    );
    await sendWhatsAppMessage(normalized, 'הוסרת. לא נשלח אליך הודעות נוספות.');
    return true;
  }

  const status = agreed ? 'granted' : 'declined';

  await pool.query(
    `UPDATE contacts
        SET consent_status = $1, consent_updated_at = NOW(), updated_at = NOW()
      WHERE phone_number = $2 AND consent_status IN ('requested', 'granted')`,
    [status, normalized]
  );

  if (agreed) {
    // Release everything that was waiting on this answer.
    const released = await pool.query(
      `UPDATE active_queue SET status = 'pending', updated_at = NOW()
        WHERE recipient_phone = $1 AND status = 'awaiting_consent'
        RETURNING queue_id`,
      [normalized]
    );
    console.log(`✅ Consent granted by ${normalized}; released ${released.rowCount} message(s)`);
    await sendWhatsAppMessage(normalized, 'תודה! ההודעות שתוזמנו עבורך יישלחו במועדן.');
  } else {
    const cancelled = await pool.query(
      `UPDATE active_queue SET status = 'cancelled', updated_at = NOW()
        WHERE recipient_phone = $1 AND status IN ('awaiting_consent', 'pending')
        RETURNING queue_id`,
      [normalized]
    );
    console.log(`🚫 Consent declined by ${normalized}; cancelled ${cancelled.rowCount} message(s)`);
    await sendWhatsAppMessage(normalized, 'הוסרת. לא נשלח אליך הודעות נוספות.');
  }

  return true;
}
