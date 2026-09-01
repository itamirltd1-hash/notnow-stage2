import pool from '../db/pool.js';
import { SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from './messages.js';

const HEBREW_CHAR = /[֐-׿]/;

/**
 * Decide the language for a number we have never seen before.
 *
 * Run once, at registration. Re-running it per message means a user who
 * answers "ok" gets English and their next sentence gets Hebrew back — the
 * language has to be a property of the user, not of the last thing they typed.
 *
 * Hebrew is the default because an ambiguous message ("123", "👍") is far more
 * likely to come from a Hebrew speaker here than from an English one.
 */
export function detectInitialLanguage(text) {
  if (!text) return DEFAULT_LANGUAGE;
  if (HEBREW_CHAR.test(text)) return 'he';

  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return latin >= 2 ? 'en' : DEFAULT_LANGUAGE;
}

/**
 * The language to address a recipient in.
 *
 * A recipient never chose one — they never signed up. The country code is the
 * only signal available before they answer, and it is a better guess than
 * always reaching for Hebrew: an Israeli number gets Hebrew, anyone else gets
 * English, which more people abroad can read than can read Hebrew.
 */
export function languageForPhone(phone) {
  if (!phone) return DEFAULT_LANGUAGE;

  // Callers hand this every shape the codebase holds: +972…, 972…, 0…, and
  // the same again with dashes. Requiring one of them is how a Hebrew
  // speaker gets addressed in English.
  const digits = String(phone)
    .replace(/[^\d+]/g, '')
    .replace(/^\+/, '')
    .replace(/^00/, '');

  if (digits.startsWith('0')) return 'he'; // a local Israeli number
  return digits.startsWith('972') ? 'he' : 'en';
}

export async function getLanguage(userId) {
  if (!userId) return DEFAULT_LANGUAGE;

  try {
    const result = await pool.query(
      'SELECT language FROM users WHERE user_id = $1',
      [userId]
    );
    const stored = result.rows[0]?.language;
    return SUPPORTED_LANGUAGES.includes(stored) ? stored : DEFAULT_LANGUAGE;
  } catch (error) {
    console.error('Error reading language:', error.message);
    return DEFAULT_LANGUAGE;
  }
}

export async function setLanguage(userId, language) {
  if (!userId || !SUPPORTED_LANGUAGES.includes(language)) return false;

  try {
    await pool.query(
      'UPDATE users SET language = $1, updated_at = NOW() WHERE user_id = $2',
      [language, userId]
    );
    return true;
  } catch (error) {
    console.error('Error storing language:', error.message);
    return false;
  }
}

// ── Recognising a request to change language ───────────────────────────────
//
// The request has to be understood in *any* language, including the one the
// bot is not currently speaking — someone stuck in the wrong language cannot
// ask in the language they are stuck in.

const HEBREW_NAME = /עברית|עיברית|hebrew|ivrit/i;
const ENGLISH_NAME = /אנגלית|אינגלית|english/i;

// Language names in Hebrew, in English, and in themselves — because someone
// who wants Russian is likely to ask for it in Russian.
const OTHER_LANGUAGES = [
  [/ערבית|arabic|العرب/i,                        { he: 'ערבית', en: 'Arabic' }],
  [/רוסית|russian|русск/i,                       { he: 'רוסית', en: 'Russian' }],
  [/ספרדית|spanish|español|espanol/i,            { he: 'ספרדית', en: 'Spanish' }],
  [/צרפתית|french|français|francais/i,           { he: 'צרפתית', en: 'French' }],
  [/אמהרית|amharic|አማርኛ/i,                       { he: 'אמהרית', en: 'Amharic' }],
  [/גרמנית|german|deutsch/i,                     { he: 'גרמנית', en: 'German' }],
  [/איטלקית|italian|italiano/i,                  { he: 'איטלקית', en: 'Italian' }],
  [/פורטוגזית|portuguese|português|portugues/i,  { he: 'פורטוגזית', en: 'Portuguese' }],
  [/אוקראינית|ukrainian|українськ/i,             { he: 'אוקראינית', en: 'Ukrainian' }],
  [/רומנית|romanian|român/i,                     { he: 'רומנית', en: 'Romanian' }],
  [/יידיש|yiddish/i,                             { he: 'יידיש', en: 'Yiddish' }],
  [/סינית|chinese|mandarin|中文/i,                { he: 'סינית', en: 'Chinese' }],
  [/יפנית|japanese|日本語/i,                      { he: 'יפנית', en: 'Japanese' }],
  [/הודית|הינדי|hindi|हिन्दी/i,                    { he: 'הינדי', en: 'Hindi' }],
  [/טורקית|turkish|türkçe|turkce/i,              { he: 'טורקית', en: 'Turkish' }],
  [/תאילנדית|thai|ไทย/i,                          { he: 'תאילנדית', en: 'Thai' }]
];

// \b never matches after a Hebrew letter — it is ASCII-only — so Hebrew verbs
// are bounded with an explicit lookahead instead.
const REQUEST_VERB = new RegExp(
  '(?:^|\\s)(?:' +
  'דבר|תדבר|תדברי|דברי|תענה|תעני|ענה|כתוב|תכתוב|תכתבי|עבור|תעבור|תעברי|' +
  'speak|talk|answer|reply|respond|write|switch|change|use|translate|' +
  'habla|hablas|parle|parlez|sprichst|parli|говорит|تتكلم' +
  ')(?=\\s|$)',
  'i'
);

// A quoted body, a phone number or a scheduling verb means the language name
// belongs to a message being scheduled — not to a request aimed at the bot.
// Without this, `שלח לדני "תדבר איתי באנגלית"` would switch the interface.
const SCHEDULING_CONTEXT =
  /["'״“”]|\d{7,}|(?:^|\s)(?:שלח|תשלח|שלחי|תשלחי|תזכיר|תזכירי|הזכר|send|remind|schedule)(?=\s|$)/i;

// "עברית", "in English", "אנגלית בבקשה" — a bare name is a request on its own.
const BARE_REQUEST =
  /^\s*(?:in\s+|ב)?(?:עברית|עיברית|hebrew|אנגלית|אינגלית|english)\s*(?:בבקשה|please)?\s*[!.?]?\s*$/i;

const MAX_COMMAND_LENGTH = 60;

/**
 * Is this a request to be answered in a different language?
 *
 * Returns { language } for one we speak, { unsupported } for one we do not,
 * or null when the message is about something else entirely.
 */
export function parseLanguageCommand(text) {
  if (!text) return null;

  const trimmed = text.trim();
  if (trimmed.length > MAX_COMMAND_LENGTH) return null;
  if (SCHEDULING_CONTEXT.test(trimmed)) return null;

  const asked = BARE_REQUEST.test(trimmed) || REQUEST_VERB.test(trimmed);
  if (!asked) return null;

  // Hebrew and English first: "translate this to English" is about English,
  // even if the sentence happens to mention another language too.
  if (ENGLISH_NAME.test(trimmed)) return { language: 'en' };
  if (HEBREW_NAME.test(trimmed)) return { language: 'he' };

  for (const [pattern, names] of OTHER_LANGUAGES) {
    if (pattern.test(trimmed)) return { unsupported: names };
  }

  return null;
}
