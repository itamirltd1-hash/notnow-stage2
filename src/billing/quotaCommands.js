import { checkUserQuota } from './quotaMiddleware.js';
import { isExempt } from './exemptions.js';

const ASK_QUOTA =
  /(?:כמה\s+(?:הודעות\s+)?(?:נשאר|נשארו|יש\s+לי|נותר|נותרו)|מה\s+(?:המצב\s+עם\s+)?(?:ה)?(?:חבילה|מכסה|מנוי)|מצב\s+(?:ה)?(?:חבילה|מכסה|מנוי)|^\s*מכסה\s*$|^\s*יתרה\s*$|quota)/i;

// Warn only once the month is nearly spent — earlier is noise, later is
// useless. Sits alongside a confirmation rather than arriving on its own.
const WARN_AT = 0.9;

export function isQuotaQuestion(text) {
  return ASK_QUOTA.test(text);
}

/**
 * First day of next month, which is when a monthly_usage row stops applying.
 */
function renewalDate() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleDateString('he-IL', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long'
  });
}

export async function describeQuota(userId, senderPhone) {
  if (isExempt(senderPhone)) {
    return 'המנוי שלך ללא הגבלה.';
  }

  const quota = await checkUserQuota(userId);
  if (quota.error) {
    return 'לא הצלחתי לבדוק את המכסה כרגע. אפשר לנסות שוב בעוד רגע.';
  }

  if (quota.remaining === 0) {
    return `המכסה החודשית נוצלה במלואה — ${quota.used} מתוך ${quota.limit}. ` +
      `היא מתחדשת ב-${renewalDate()}.`;
  }

  return `נשארו ${quota.remaining} הודעות מתוך ${quota.limit} החודש. ` +
    `המכסה מתחדשת ב-${renewalDate()}.`;
}

/**
 * A line to append to a scheduling confirmation when the month is nearly out.
 *
 * Deliberately computed after the usage is recorded, not before: the warning
 * describes what is left now, and a send that was blocked for lack of quota
 * never gets here at all.
 */
export async function quotaWarningLine(userId, senderPhone) {
  if (isExempt(senderPhone)) return null;

  const quota = await checkUserQuota(userId);
  if (quota.error || !quota.limit) return null;

  const used = quota.used / quota.limit;
  if (used < WARN_AT) return null;

  if (quota.remaining === 0) {
    return `\n\nזו הייתה ההודעה האחרונה במכסה החודשית. היא מתחדשת ב-${renewalDate()}.`;
  }

  return `\n\nנותרו ${quota.remaining} הודעות במכסה החודשית, שמתחדשת ב-${renewalDate()}.`;
}
