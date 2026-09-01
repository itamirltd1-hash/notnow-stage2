/**
 * Every user-facing string, in every language the bot speaks.
 *
 * The alternative — an `if (lang === 'he')` at each of the ~56 places that
 * send a message — puts the two languages far enough apart that they drift,
 * and nothing can tell you they have. Here a missing translation is one
 * absent key, which `missingTranslations()` can find and a test can fail on.
 */

export const SUPPORTED_LANGUAGES = ['he', 'en'];
export const DEFAULT_LANGUAGE = 'he';

const STRINGS = {
  // ── Language ──────────────────────────────────────────────────────────
  // Written in the language they announce: switching to English should be
  // confirmed in English, or the confirmation is not evidence of anything.
  'language.switched': {
    he: 'מעכשיו אני עונה בעברית.',
    en: "From now on I'll reply in English."
  },
  'language.already': {
    he: 'אני כבר עונה בעברית.',
    en: "I'm already replying in English."
  },
  'language.unsupported': {
    he: 'אני עובד בעברית ובאנגלית בלבד. {language} עדיין לא נתמכת.',
    en: 'I work in Hebrew and English only. {language} is not supported yet.'
  },

  // The escape hatch is deliberately in the *other* language: if the first
  // message was read wrong, this is the one line the user can still read.
  'language.hint': {
    he: 'אני עונה בעברית. To switch to English, write "speak English".',
    en: 'I reply in English. למעבר לעברית — לכתוב "דבר עברית".'
  }
};

/**
 * Look up a string. Falls back to Hebrew when a translation is missing, so a
 * gap shows up as the wrong language rather than as a crash or a blank reply.
 */
export function t(key, lang = DEFAULT_LANGUAGE, vars = {}) {
  const entry = STRINGS[key];
  if (!entry) {
    console.warn(`⚠️  Missing string key: ${key}`);
    return key;
  }

  const template = entry[lang] || entry[DEFAULT_LANGUAGE];
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    vars[name] === undefined ? whole : String(vars[name])
  );
}

/** Does a key exist? For call sites that want to branch rather than fall back. */
export function hasString(key) {
  return Object.prototype.hasOwnProperty.call(STRINGS, key);
}

/**
 * Keys that are missing a translation, as [key, language] pairs.
 * The point of the catalogue is that this question has an answer.
 */
export function missingTranslations() {
  const gaps = [];
  for (const [key, entry] of Object.entries(STRINGS)) {
    for (const lang of SUPPORTED_LANGUAGES) {
      if (!entry[lang]) gaps.push([key, lang]);
    }
  }
  return gaps;
}

export function allKeys() {
  return Object.keys(STRINGS);
}
