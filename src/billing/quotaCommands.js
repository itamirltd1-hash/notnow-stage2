import { checkUserQuota } from './quotaMiddleware.js';
import { isExempt } from './exemptions.js';
import { getLanguage } from '../i18n/language.js';
import { t, formatDate } from '../i18n/messages.js';

// This one matches inside a sentence rather than the whole of it, which is
// safe for the Hebrew phrases and not for a common English noun. So the
// English single words are anchored to the whole message; only the phrases
// that could not be part of a message being scheduled are left loose.
const ASK_QUOTA =
  /(?:כמה\s+(?:הודעות\s+)?(?:נשאר|נשארו|יש\s+לי|נותר|נותרו)|מה\s+(?:המצב\s+עם\s+)?(?:ה)?(?:חבילה|מכסה|מנוי)|מצב\s+(?:ה)?(?:חבילה|מכסה|מנוי)|^\s*מכסה\s*$|^\s*יתרה\s*$|quota|how\s+many\s+(?:messages\s+)?(?:do\s+i\s+have\s+|are\s+)?(?:left|remaining)|how\s+much\s+(?:do\s+i\s+have\s+)?left|^\s*(?:balance|usage|my\s+plan)\s*[?？]?\s*$)/i;

// Warn only once the month is nearly spent — earlier is noise, later is
// useless. Sits alongside a confirmation rather than arriving on its own.
const WARN_AT = 0.9;

export function isQuotaQuestion(text) {
  return ASK_QUOTA.test(text);
}

/**
 * First day of next month, which is when a monthly_usage row stops applying.
 */
function renewalDate(lang) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return formatDate(next, lang);
}

export async function describeQuota(userId, senderPhone) {
  const lang = await getLanguage(userId);

  if (isExempt(senderPhone)) return t('quota.unlimited', lang);

  const quota = await checkUserQuota(userId);
  if (quota.error) return t('quota.checkFailed', lang);

  const date = renewalDate(lang);

  if (quota.remaining === 0) {
    return t('quota.exhausted', lang, { used: quota.used, limit: quota.limit, date });
  }

  return t('quota.remaining', lang, {
    remaining: quota.remaining, limit: quota.limit, date
  });
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

  const lang = await getLanguage(userId);
  const date = renewalDate(lang);

  return quota.remaining === 0
    ? t('quota.warn.last', lang, { date })
    : t('quota.warn.remaining', lang, { remaining: quota.remaining, date });
}
