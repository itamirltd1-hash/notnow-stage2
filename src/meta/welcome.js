import { BRAND } from '../brand.js';
import { t } from '../i18n/messages.js';
import { isTranscriptionAvailable } from '../llm/transcriber.js';

// A first message used to cost a model call and come back as "לא הבנתי" —
// the worst possible introduction. These are matched before anything else.
const GREETING = /^\s*(היי|הי|שלום|הלו|אהלן|start|hi|hiya|hello|hey|hey\s+there|good\s+(?:morning|afternoon|evening))\s*[!.?]?\s*$/i;
const HELP = /^\s*(עזרה|עזרו|פקודות|מה\s+אתה\s+יודע|מה\s+אפשר|help|commands|what\s+can\s+you\s+do|what\s+do\s+you\s+do|what\s+can\s+i\s+do|\?)\s*[!.?]?\s*$/i;

export function isGreeting(text) {
  return GREETING.test(text);
}

export function isHelpRequest(text) {
  return HELP.test(text);
}

// "תודה" was being classified as a question about the product and answered
// with two paid model calls. Courtesy deserves courtesy, not an explanation.
const COURTESY =
  /^\s*(תודה|תודה\s+רבה|מעולה|מצוין|יופי|סבבה|אחלה|מגניב|כל\s+הכבוד|thanks|thanks\s+a\s+lot|thank\s+you|thx|ty|cheers|great|nice|perfect|cool|awesome|excellent|lovely|👍|🙏|❤️|😊|👏|💪|✅|🔥)\s*[!.]*\s*$/i;

export function isCourtesy(text) {
  return COURTESY.test(text);
}

// Someone closing an exchange, not thanking and not asking. It reaches here
// only when no consent question is open — a recipient answering "כן" is
// resolved long before this.
const ACKNOWLEDGEMENT =
  /^\s*(כן|אוקיי|אוקי|בסדר|בסדר\s+גמור|הבנתי|ברור|נכון|ok|okay|k|kk|sure|fine|alright|right|noted|yep|yeah|got\s+it|understood)\s*[!.]*\s*$/i;

export function isAcknowledgement(text) {
  return ACKNOWLEDGEMENT.test(text);
}

/**
 * Is there nothing here for the model to find?
 *
 * A bare digit, a lone letter or a row of punctuation cannot name a recipient,
 * a time or a message, so parsing it costs a paid call and two seconds to
 * arrive at "I didn't understand".
 *
 * Deliberately narrow, and by shape rather than by length: "מחר", "בוא" and
 * "דני" are short and mean a great deal. The damage is asymmetric — a guard
 * that misses costs one model call, a guard that swallows costs the sender
 * their request — so anything with a letter in it beyond a single character
 * goes on to the model.
 */
export function looksLikeNoise(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;

  // Four characters is already generous for something meaningless. A phone
  // number is all digits too, and is far longer than this.
  if (trimmed.length > 4) return false;

  if (/^\p{L}$/u.test(trimmed)) return true;
  return /^[\d\p{P}\p{S}\s]+$/u.test(trimmed);
}

export function courtesyReply(lang = 'he') {
  return t('courtesy.reply', lang);
}

export function acknowledgementReply(lang = 'he') {
  return t('acknowledged', lang);
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
  // The description follows the deployment rather than the intent, so the
  // line flips on its own the day the key is added.
  const voice = t(isTranscriptionAvailable() ? 'help.voice.on' : 'help.voice.off', lang);
  return t('help', lang, { voice });
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
