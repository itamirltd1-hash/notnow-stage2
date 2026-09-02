import pool from '../db/pool.js';
import { sendWhatsAppMessage } from '../meta/sendHandler.js';
import { isWithinServiceWindow } from '../meta/serviceWindow.js';
import { getLanguage } from '../i18n/language.js';
import { t, formatWhen } from '../i18n/messages.js';

/**
 * Which sentence a failure deserves.
 *
 * The distinction that matters to the sender is not the error code — it is
 * whose problem it is, and therefore whether trying again would help. Billing
 * is ours and retrying wastes their time; a wrong number is theirs and only
 * they can fix it.
 */
const REASON = {
  131042: 'delivery.reason.billing',
  131026: 'delivery.reason.unreachable',
  131031: 'delivery.reason.restricted',
  131047: 'delivery.reason.window'
};

/**
 * Tell the person who scheduled a message that it never arrived.
 *
 * Reached from two places, because a message can fail in two: rejected at
 * send time, or accepted with a 200 and failed minutes later in a status
 * webhook. The second is the quiet one — the queue row turns to 'failed' and
 * the sender goes on believing it went out, which is worse than an error
 * because nothing looks wrong.
 *
 * Best effort. If this notice cannot itself be delivered, the failure is
 * already in the log and the activity table.
 */
export async function notifySenderOfFailure({
  userId, recipientName, recipientPhone, scheduledAt, errorCode = null
}) {
  try {
    const owner = await pool.query(
      `SELECT phone_number FROM contacts
        WHERE user_id = $1 AND is_owner = TRUE LIMIT 1`,
      [userId]
    );
    const senderPhone = owner.rows[0]?.phone_number;
    if (!senderPhone) return;

    // Only reachable while the sender's own window is open, which is the
    // common case: they were talking to the bot when they scheduled it.
    if (!(await isWithinServiceWindow(senderPhone))) {
      console.log(`   Cannot notify ${senderPhone} of the failure — outside their window`);
      return;
    }

    const lang = await getLanguage(userId);
    const who = recipientName || recipientPhone;

    await sendWhatsAppMessage(senderPhone, t('delivery.failed', lang, {
      who,
      when: formatWhen(scheduledAt, lang),
      reason: t(REASON[errorCode] || 'delivery.reason.unknown', lang, { who })
    }));
  } catch (error) {
    console.error('Could not notify sender of failure:', error.message);
  }
}
