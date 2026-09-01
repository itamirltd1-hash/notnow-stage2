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
  },

  // ── Scheduling confirmations ──────────────────────────────────────────
  // Written here rather than asked of the model, which stated the same
  // scheduled time as 20:14 in one message and 17:15 in the next — the
  // second in UTC — and reads to the user as a bot on the wrong clock.
  'schedule.confirmed': {
    he: 'קיבלתי. {subject} {verb} {who} ב-{when}.',
    en: 'Got it. {subject} {verb} {who} at {when}.'
  },
  'schedule.confirmed.body': {
    he: 'קיבלתי. {subject} {verb} {who} ב-{when}:\n"{body}"',
    en: 'Got it. {subject} {verb} {who} at {when}:\n"{body}"'
  },
  'schedule.group': {
    he: 'קבוצת "{name}": {count} הודעות אישיות נפרדות תוזמנו.',
    en: 'Group "{name}": {count} separate personal messages scheduled.'
  },
  'schedule.awaiting': {
    he: '\nממתין לאישור מ־{names} — שלחתי להם בקשת הצטרפות. ההודעה תישלח רק אחרי שיאשרו.',
    en: '\nWaiting for {names} to agree — I have sent them a request. The message goes out only once they approve.'
  },
  'schedule.declined': {
    he: '\nלא נשלח ל־{names} — הם ביקשו לא לקבל הודעות.',
    en: '\nNot sent to {names} — they asked not to receive messages.'
  },

  // ── What a recipient reads ────────────────────────────────────────────
  // Addressed to someone who never signed up for anything, so it says who is
  // asking and how to refuse, and nothing else. The two options are 1 and 2
  // because that is what the approved template tells them to answer.
  'consent.ask': {
    he: '{who} לתזמן עבורך הודעות דרך {brand}.\n\n1 — להסכמה וקבלת ההודעה\n2 — לסירוב והסרה',
    en: '{who} to schedule messages for you through {brand}.\n\n1 — agree and receive the message\n2 — refuse and be removed'
  },
  'consent.ask.by': {
    he: '{name} ביקש',
    en: '{name} has asked'
  },
  'consent.ask.anonymous': {
    he: 'התקבלה בקשה',
    en: 'A request was made'
  },
  'consent.granted': {
    he: 'תודה! ההודעות שתוזמנו עבורך יישלחו במועדן.',
    en: 'Thank you. The messages scheduled for you will arrive at their time.'
  },
  'consent.declined': {
    he: 'הוסרת. לא נשלח אליך הודעות נוספות.',
    en: 'You have been removed. No further messages will be sent to you.'
  },
  'erasure.confirmed': {
    he: 'נמחקת. כל המידע שהוחזק עליך — מספר, שם, והודעות שתוזמנו אליך — הוסר.\n\n' +
        'שמרנו רק את המספר עצמו ברשימת חסימה, כדי שלא נפנה אליך שוב — גם אם ינסו להוסיף אותך מחדש.',
    en: 'You have been erased. Everything held about you — your number, your name, and any messages scheduled to you — is gone.\n\n' +
        'We kept only the number itself, on a block list, so that we never contact you again — even if someone tries to add you back.'
  },
  'recipient.greeting': {
    he: 'שלום! אני {brand}.\nמישהו תזמן עבורך הודעה דרכי, ולכן אנחנו בקשר.\n\n' +
        'להפסקת הודעות ממני — להשיב "הסר".\n\n' +
        'ואם בא לך גם לתזמן הודעות בעצמך, אפשר לכתוב "עזרה" ואסביר.',
    en: 'Hello. I am {brand}.\nSomeone scheduled a message for you through me, which is why we are in touch.\n\n' +
        'To stop hearing from me, reply "stop".\n\n' +
        'And if you would like to schedule messages yourself, write "help" and I will explain.'
  },
  'consent.clarify': {
    he: 'התקבלה בקשה לתזמן עבורך הודעה דרך {brand}.\n\n1 — מאשר/ת, אפשר לשלוח לי\n2 — לא מעוניין/ת, אל תפנו אליי שוב',
    en: 'Someone asked to schedule a message for you through {brand}.\n\n1 — yes, you may send to me\n2 — no, do not contact me again'
  }
};

/**
 * What is being sent, and the verb that agrees with it.
 *
 * Hebrew verbs agree with the gender of their subject, so each noun carries
 * its own — one shared verb is how "הסרטון תישלח" happens. English needs no
 * such table, but keeping the same shape means the call site has no idea
 * which language it is building.
 */
const MEDIA_SUBJECT = {
  he: {
    text:     { subject: 'ההודעה', verb: 'תישלח' },
    image:    { subject: 'התמונה', verb: 'תישלח' },
    video:    { subject: 'הסרטון', verb: 'יישלח' },
    audio:    { subject: 'ההקלטה', verb: 'תישלח' },
    document: { subject: 'המסמך',  verb: 'יישלח' },
    other:    { subject: 'הקובץ',  verb: 'יישלח' }
  },
  en: {
    text:     { subject: 'The message',  verb: 'will be sent' },
    image:    { subject: 'The photo',    verb: 'will be sent' },
    video:    { subject: 'The video',    verb: 'will be sent' },
    audio:    { subject: 'The recording', verb: 'will be sent' },
    document: { subject: 'The document', verb: 'will be sent' },
    other:    { subject: 'The file',     verb: 'will be sent' }
  }
};

export function mediaSubject(mediaType, lang = DEFAULT_LANGUAGE) {
  const table = MEDIA_SUBJECT[lang] || MEDIA_SUBJECT[DEFAULT_LANGUAGE];
  return table[mediaType || 'text'] || table.other;
}

/**
 * A date the user will read as their own clock. Israel time in both
 * languages — the user is here, whichever language they read in.
 */
export function formatWhen(iso, lang = DEFAULT_LANGUAGE) {
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

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
