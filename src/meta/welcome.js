import { BRAND } from '../brand.js';
import { t } from '../i18n/messages.js';

// A first message used to cost a model call and come back as "לא הבנתי" —
// the worst possible introduction. These are matched before anything else.
const GREETING = /^\s*(היי|הי|שלום|הלו|אהלן|start|hi|hello|hey)\s*[!.?]?\s*$/i;
const HELP = /^\s*(עזרה|עזרו|פקודות|מה\s+אתה\s+יודע|מה\s+אפשר|help|\?)\s*[!.?]?\s*$/i;

export function isGreeting(text) {
  return GREETING.test(text);
}

export function isHelpRequest(text) {
  return HELP.test(text);
}

// "תודה" was being classified as a question about the product and answered
// with two paid model calls. Courtesy deserves courtesy, not an explanation.
const COURTESY =
  /^\s*(תודה|תודה\s+רבה|מעולה|מצוין|יופי|סבבה|אחלה|מגניב|כל\s+הכבוד|thanks|thank\s+you|thx|great|nice|perfect|👍)\s*[!.]*\s*$/i;

export function isCourtesy(text) {
  return COURTESY.test(text);
}

export function courtesyReply(lang = 'he') {
  return t('courtesy.reply', lang);
}

/**
 * Shown once, the first time a number ever writes to the bot.
 */
export function welcomeMessage(profileName = null, lang = 'he') {
  // Say up front which name recipients will see. Finding that out only after
  // five clients received "BOSS asked..." is too late.
  const naming = profileName ? t('welcome.naming', lang, { name: profileName }) : '';

  return t('welcome', lang, { brand: BRAND }) + naming
    + `\n\n${t('language.hint', lang)}`;
}

/**
 * The fuller reference, for someone who already knows what the bot is.
 */
export function helpMessage(lang = 'he') {
  return t('help', lang);
}

/**
 * For someone who reached the bot only because a friend scheduled something
 * for them. A tour of scheduling features answers a question they never
 * asked — but they should still learn how to stop, and how to start if they
 * do want it.
 */
export function recipientGreeting(lang = 'he') {
  return t('recipient.greeting', lang, { brand: BRAND });
}

/**
 * For a recipient who was asked for consent and replied with something else.
 * They are mid-conversation about one specific question — a product tour here
 * would answer a question they never asked.
 */
export function consentClarification(lang = 'he') {
  return t('consent.clarify', lang, { brand: BRAND });
}
