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
  // ── Who a message is going to ─────────────────────────────────────────
  // The preposition belongs to the language, not to the call site: Hebrew
  // glues it to the name, English needs a word of its own.
  'recipient.group':   { he: 'לקבוצת {name}', en: 'to the group "{name}"' },
  'recipient.person':  { he: 'ל{name}',       en: 'to {name}' },
  'recipient.unnamed': { he: 'נמען',          en: 'the recipient' },

  // ── The queue ─────────────────────────────────────────────────────────
  // A group send is many rows collapsed into one entry, so the list reads the
  // way the sender thinks about it: one message to a group, not eight rows.
  'queue.empty': {
    he: 'אין כרגע הודעות שממתינות לשליחה.',
    en: 'Nothing is waiting to be sent.'
  },
  'queue.list': {
    he: '{count} הודעות ממתינות:\n{lines}\n\nלביטול אחת מהן — למשל "בטל 1".',
    en: '{count} messages are waiting:\n{lines}\n\nTo cancel one — for example "cancel 1".'
  },
  'queue.nothingToCancel': {
    he: 'אין כרגע הודעות שממתינות, אז אין מה לבטל.',
    en: 'Nothing is waiting, so there is nothing to cancel.'
  },
  'queue.whichToCancel': {
    he: 'איזו מהן לבטל?\n{lines}\n\nאפשר להשיב במספר, או "בטל הכל".',
    en: 'Which one should I cancel?\n{lines}\n\nReply with a number, or "cancel all".'
  },
  'queue.cancelledAll': {
    he: 'ביטלתי את כל {count} ההודעות שהמתינו.',
    en: 'Cancelled all {count} waiting messages.'
  },
  'queue.noSuchNumber': {
    he: 'אין הודעה מספר {index} — יש {count} בתור. "מה בתור" יציג את הרשימה.',
    en: 'There is no message {index} — there are {count} in the queue. "what is in the queue" shows the list.'
  },
  'queue.cancelledOne': { he: 'ביטלתי. {entry}', en: 'Cancelled. {entry}' },
  'queue.cancelled':    { he: 'ביטלתי.',        en: 'Cancelled.' },
  'queue.entry':        { he: '{who} — {when} — {what}{waiting}', en: '{who} — {when} — {what}{waiting}' },
  'queue.toGroup': {
    he: 'לקבוצת {name} ({count} אנשים)',
    en: 'to the group {name} ({count} people)'
  },
  'queue.toPerson': { he: 'ל{who}', en: 'to {who}' },
  'queue.awaitingGroup': {
    he: ' — {count} עדיין לא אישרו',
    en: ' — {count} have not agreed yet'
  },
  'queue.awaitingOne': {
    he: ' — ממתינה לאישור הנמען',
    en: ' — waiting for the recipient to agree'
  },
  'groups.unnamed': { he: 'קבוצה', en: 'group' },

  // ── Quota ─────────────────────────────────────────────────────────────
  'quota.unlimited': { he: 'המנוי שלך ללא הגבלה.', en: 'Your plan has no limit.' },
  'quota.checkFailed': {
    he: 'לא הצלחתי לבדוק את המכסה כרגע. אפשר לנסות שוב בעוד רגע.',
    en: 'I could not check your quota just now. Please try again in a moment.'
  },
  'quota.exhausted': {
    he: 'המכסה החודשית נוצלה במלואה — {used} מתוך {limit}. היא מתחדשת ב-{date}.',
    en: 'The monthly quota is fully used — {used} of {limit}. It renews on {date}.'
  },
  'quota.remaining': {
    he: 'נשארו {remaining} הודעות מתוך {limit} החודש. המכסה מתחדשת ב-{date}.',
    en: '{remaining} of {limit} messages remain this month. The quota renews on {date}.'
  },
  'quota.warn.last': {
    he: '\n\nזו הייתה ההודעה האחרונה במכסה החודשית. היא מתחדשת ב-{date}.',
    en: '\n\nThat was the last message in this month’s quota. It renews on {date}.'
  },
  'quota.warn.remaining': {
    he: '\n\nנותרו {remaining} הודעות במכסה החודשית, שמתחדשת ב-{date}.',
    en: '\n\n{remaining} messages remain in this month’s quota, which renews on {date}.'
  },

  // ── Terms ─────────────────────────────────────────────────────────────
  // A wall of legal text in a chat window is read by nobody, so the document
  // lives on a page and the chat carries the link and the decision.
  'terms.prompt': {
    he: 'לפני שאתזמן הודעות בשמך, צריך אישור לתנאי השימוש ולמדיניות הפרטיות:\n{url}\n\n' +
        'בקצרה: {brand} שומר את ההודעות שתזמנת עד שהן נשלחות, ומוחק אותן שבוע לאחר מכן. ' +
        'לפני שליחה למישהו חדש, נבקש את אישורו.\n\nלהמשך — להשיב "מאשר".',
    en: 'Before I schedule messages on your behalf, you need to accept the terms of use and privacy policy:\n{url}\n\n' +
        'In short: {brand} keeps the messages you schedule until they are sent, and deletes them a week later. ' +
        'Before writing to someone new, we ask their permission.\n\nTo continue — reply "accept".'
  },
  'terms.accepted': {
    he: 'תודה. אפשר להתחיל — למשל: שלח לדני 0501234567 מחר ב-9:00 "נתראה בפגישה"',
    en: 'Thank you. You can start — for example: send to Danny 0501234567 tomorrow at 9:00 "see you at the meeting"'
  },

  // ── The display name recipients see ───────────────────────────────────
  'name.current': {
    he: 'כשאני מבקש אישור מנמען חדש, אני מציג אותך בשם "{name}".\nלשינוי — "קרא לי [שם]".',
    en: 'When I ask a new recipient for permission, I introduce you as "{name}".\nTo change it — "call me [name]".'
  },
  'name.none': {
    he: 'עדיין אין לי שם עבורך. אפשר לקבוע אותו: "קרא לי דנה".',
    en: 'I have no name for you yet. You can set one: "call me Dana".'
  },
  'name.saved': {
    he: 'מעכשיו אציג אותך בשם "{name}" כשאבקש אישור מנמען חדש.',
    en: 'From now on I will introduce you as "{name}" when I ask a new recipient for permission.'
  },
  'name.saveFailed': {
    he: 'לא הצלחתי לשמור את השם. אפשר לנסות שוב?',
    en: 'I could not save that name. Could you try again?'
  },

  // ── First impressions ─────────────────────────────────────────────────
  'welcome': {
    he: 'שלום! אני {brand} 👋\n' +
        'אני מתזמן הודעות WhatsApp — אומרים לי מה, למי ומתי, ואני שולח בזמן.\n\n' +
        'אפשר פשוט לכתוב לי במילים חופשיות:\n' +
        '• שלח לדני 0501234567 מחר ב-9:00 "נתראה בפגישה"\n' +
        '• תזכיר לי עוד שעתיים לחזור ללקוח\n\n' +
        'אפשר גם להקליט הודעה קולית ואני אתמלל אותה.\n\n' +
        'לשליחה לכמה אנשים בבת אחת — אפשר ליצור קבוצה. כל אחד יקבל הודעה אישית נפרדת:\n' +
        '• צור קבוצה טסטרים\n' +
        '• הוסף לטסטרים 0501111111 דנה\n' +
        '• תשלח לקבוצת טסטרים מחר ב-10 "בוקר טוב"\n\n' +
        'לרשימת הפקודות המלאה — לכתוב "עזרה".',
    en: 'Hello. I am {brand} 👋\n' +
        'I schedule WhatsApp messages — tell me what, to whom and when, and I send it on time.\n\n' +
        'You can write to me in plain words:\n' +
        '• send to Danny 0501234567 tomorrow at 9:00 "see you at the meeting"\n' +
        '• remind me in two hours to call the client back\n\n' +
        'You can also record a voice note and I will transcribe it.\n\n' +
        'To reach several people at once you can save a group — each person gets ' +
        'their own separate message, never a group chat.\n\n' +
        'For the full list of commands, write "help".'
  },
  'welcome.naming': {
    he: '\n\nכשאבקש אישור מנמען חדש, אציג אותך בשם "{name}". לשינוי — "קרא לי [שם]".',
    en: '\n\nWhen I ask a new recipient for permission, I will introduce you as "{name}". To change it — "call me [name]".'
  },
  'help': {
    he: 'הפקודות שלי:\n\n' +
        '📅 תזמון\n' +
        '• שלח לדני 0501234567 מחר ב-9:00 "נתראה"\n' +
        '• שלח לדני עוד שעתיים "בדרך"\n' +
        '  (אם דני שמור אצלי, אין צורך במספר)\n\n' +
        '📋 מה מתוזמן\n' +
        '• מה בתור — כל ההודעות שטרם נשלחו\n' +
        '• בטל 2 — מבטל את מספר 2 ברשימה\n' +
        '• בטל הכל\n\n' +
        '👥 קבוצות — הודעה אישית לכל חבר, לא צ\'אט קבוצתי\n' +
        '• צור קבוצה טסטרים\n' +
        '• הוסף לטסטרים 0501111111 דנה\n' +
        '• מי בטסטרים\n' +
        '• מחק מטסטרים דנה\n' +
        '• קבוצות\n\n' +
        '🎙️ קולי\n' +
        'אפשר להקליט הודעה ואתמלל אותה. אשאל אם לשלוח את הטקסט או את ההקלטה עצמה.\n\n' +
        'לתשומת לבכם: לפני שליחה למישהו בפעם הראשונה, אני מבקש את אישורו. ' +
        'ההודעה ממתינה עד שהוא מאשר.',
    // The group syntax is deliberately absent here: those commands are matched
    // by Hebrew patterns and do not yet answer to English words. Listing them
    // would be advertising something that does not work.
    en: 'What I can do:\n\n' +
        '📅 Scheduling\n' +
        '• send to Danny 0501234567 tomorrow at 9:00 "see you there"\n' +
        '• send to Danny in two hours "on my way"\n' +
        '  (if Danny is already saved, the number is not needed)\n\n' +
        '📋 What is scheduled\n' +
        '• what is in the queue — everything not yet sent\n' +
        '• cancel — I will show the list and you pick a number\n\n' +
        '🎙️ Voice\n' +
        'Record a message and I will transcribe it. I will ask whether to send the ' +
        'words or the recording itself.\n\n' +
        '👥 Groups let one message reach several people, each as their own private ' +
        'message. Managing them still needs Hebrew wording for now.\n\n' +
        'Note: before I write to someone for the first time, I ask their permission. ' +
        'The message waits until they agree.'
  },
  'courtesy.reply': { he: 'בשמחה.', en: 'Any time.' },

  // Group commands are matched by Hebrew patterns, so the English version
  // says which words to use rather than pretending there are English ones.
  'groups.syntax': {
    he: 'פקודות קבוצות:\n' +
        '• צור קבוצה טסטרים\n' +
        '• הוסף לטסטרים 0501111111 דנה\n' +
        '• מי בטסטרים\n' +
        '• מחק מטסטרים דנה\n' +
        '• קבוצות — כל הקבוצות שלך',
    en: 'Groups are managed with Hebrew wording for now:\n' +
        '• צור קבוצה טסטרים — create a group called טסטרים\n' +
        '• הוסף לטסטרים 0501111111 דנה — add someone to it\n' +
        '• מי בטסטרים — who is in it\n' +
        '• מחק מטסטרים דנה — remove someone\n' +
        '• קבוצות — list all your groups'
  },

  // ── Scheduling: what is missing, and what cannot be done ──────────────
  'schedule.missing': {
    he: 'חסר לי {missing}.{hint}',
    en: 'I still need {missing}.{hint}'
  },
  'schedule.missing.recipient': { he: 'מספר הנמען', en: 'the recipient’s number' },
  'schedule.missing.content':   { he: 'תוכן ההודעה', en: 'the message itself' },
  'schedule.missing.time':      { he: 'מועד השליחה', en: 'the time to send it' },
  'schedule.missing.join':      { he: ' ו', en: ' and ' },
  'schedule.missing.hint': {
    he: '\n\nאין לי מספר שמור עבור {name}. אפשר לשלוח פעם אחת עם המספר, ואשמור אותו.',
    en: '\n\nI have no number saved for {name}. Send it once with the number and I will keep it.'
  },
  'schedule.failed': {
    he: 'לא הצלחתי לתזמן את ההודעה. אפשר לנסות שוב.',
    en: 'I could not schedule the message. Please try again.'
  },
  'schedule.quotaShort': {
    he: 'המכסה החודשית לא מספיקה: נדרשות {needed} הודעות ונשארו {left} מתוך {limit} ({tier}).',
    en: 'Not enough monthly quota: {needed} messages are needed and {left} of {limit} remain ({tier}).'
  },

  // ── Time ──────────────────────────────────────────────────────────────
  'time.unparseable': {
    he: 'לא הצלחתי להבין את המועד. אפשר למשל "מחר ב-9:00" או "עוד שעתיים".',
    en: 'I could not read the time. Try something like "tomorrow at 9:00" or "in two hours".'
  },
  'time.past': {
    he: 'המועד שביקשת ({when}) כבר עבר. מתי לשלוח?',
    en: 'The time you asked for ({when}) has already passed. When should I send it?'
  },
  // "מחר ב-8" is eight in the morning to some people and eight at night to
  // others, and guessing wrong sends the message twelve hours off.
  'time.morningOrEvening': {
    he: '{hour} בבוקר או בערב?\n1. {morning}\n2. {evening}',
    en: 'Is {hour} in the morning or the evening?\n1. {morning}\n2. {evening}'
  },
  'time.whichExactly': {
    he: 'באיזו שעה בדיוק?\n{options}\n\nלהשיב במספר.',
    en: 'What time exactly?\n{options}\n\nReply with a number.'
  },

  // ── Choices ───────────────────────────────────────────────────────────
  'choice.replyWithLetter': { he: '\n\nלהשיב באות.', en: '\n\nReply with a letter.' },
  'choice.outOfRange': {
    he: 'יש {count} אפשרויות. להשיב באות שמופיעה ברשימה.',
    en: 'There are {count} options. Reply with one of the letters listed.'
  },
  'choice.failed': {
    he: 'לא הצלחתי להשלים את הבחירה. אפשר לשלוח את הבקשה שוב.',
    en: 'I could not complete that choice. Please send the request again.'
  },
  'contact.ambiguous': {
    he: 'יש לי כמה אנשי קשר בשם הזה. למי מהם?\n\n{options}',
    en: 'I have more than one contact by that name. Which of them?\n\n{options}'
  },
  'group.ambiguous': {
    he: 'יש לי כמה קבוצות בשם הזה. לאיזו?\n\n{options}',
    en: 'I have more than one group by that name. Which one?\n\n{options}'
  },
  'group.notFound': {
    he: 'אין לי קבוצה בשם "{name}". לכתוב "קבוצות" כדי לראות מה שמור אצלי.',
    en: 'I have no group called "{name}". Write "groups" to see what I have saved.'
  },
  'group.empty': {
    he: 'הקבוצה "{name}" ריקה. צריך להוסיף אליה אנשי קשר קודם.',
    en: 'The group "{name}" is empty. Add contacts to it first.'
  },
  'group.memberRemoved': {
    he: 'הסרתי את {name} ({phone}) מ"{group}".',
    en: 'I removed {name} ({phone}) from "{group}".'
  },
  'group.removeFailed': {
    he: 'לא הצלחתי להסיר את {name}.',
    en: 'I could not remove {name}.'
  },

  // ── Files and contact cards ───────────────────────────────────────────
  // {what} comes from mediaSubject(), which capitalises for English because
  // its other use starts a sentence — so this one starts with it too.
  'media.received': {
    he: 'קיבלתי את {what}. למי ומתי לשלוח?\nלמשל: תשלח את זה לדני 0501234567 מחר ב-9:00',
    en: '{what} is here. Who should it go to, and when?\nFor example: send this to Danny 0501234567 tomorrow at 9:00'
  },
  'media.namedFile': { he: 'הקובץ {name}', en: 'the file {name}' },
  'media.horizon': {
    he: 'קבצים נשמרים אצל וואטסאפ לזמן מוגבל, ולכן אפשר לתזמן אותם עד {days} ימים קדימה בלבד.\n\n' +
        'אפשר לתזמן את הקובץ למועד קרוב יותר, או לשלוח עכשיו הודעת טקסט בלבד למועד הרחוק.',
    en: 'WhatsApp keeps a file for a limited time, so a file can only be scheduled up to {days} days ahead.\n\n' +
        'Schedule the file for a nearer time, or send a text-only message for the later one.'
  },
  'media.captionTooLong': {
    he: 'הכיתוב לקובץ ארוך מדי — עד {max} תווים. אפשר לקצר אותו?',
    en: 'The caption is too long — {max} characters at most. Could you shorten it?'
  },
  'contact.noPhone': {
    he: 'קיבלתי כרטיס איש קשר אבל בלי מספר טלפון. אפשר לכתוב את המספר?',
    en: 'That contact card has no phone number on it. Could you type the number?'
  },
  'contact.saved': {
    he: 'שמרתי את {name} ({phone}).\n\nמה לשלוח, ומתי?',
    en: 'Saved {name} ({phone}).\n\nWhat should I send, and when?'
  },

  // ── Voice notes ───────────────────────────────────────────────────────
  'voice.readFailed': {
    he: 'לא הצלחתי לקרוא את ההקלטה. אפשר לשלוח שוב.',
    en: 'I could not read that recording. Please send it again.'
  },
  'voice.unavailable': {
    he: 'תמלול הודעות קוליות עדיין לא זמין. אפשר לשלוח את הבקשה כטקסט.',
    en: 'Voice transcription is not available yet. Please send the request as text.'
  },
  'voice.transcribeFailed': {
    he: 'לא הצלחתי לתמלל את ההקלטה. אפשר לנסות שוב, או לכתוב את הבקשה.',
    en: 'I could not transcribe that recording. Try again, or write the request out.'
  },
  'voice.empty': {
    he: 'ההקלטה יצאה ריקה. אפשר להקליט שוב.',
    en: 'That recording came out empty. Please record it again.'
  },
  'voice.whichToSend': {
    he: 'תמללתי: "{transcript}"\n\nמה לשלוח לנמען?\nא. את המילים כהודעת טקסט\nב. את ההקלטה המקורית\n\n' +
        'להשיב באות. לתשומת לבכם: הקלטה מגיעה רק למי שכתב לבוט ב-24 השעות האחרונות — אחרת תישלח גרסת הטקסט.',
    en: 'I transcribed: "{transcript}"\n\nWhat should the recipient get?\na. The words, as a text message\nb. The original recording\n\n' +
        'Reply with a letter. Note: a recording only reaches someone who wrote to the bot in the last 24 hours — otherwise the text version is sent.'
  },
  'voice.label.text':  { he: 'טקסט',  en: 'text' },
  'voice.label.audio': { he: 'הקלטה', en: 'recording' },

  // ── Message types that cannot be scheduled ────────────────────────────
  'unsupported.sticker': {
    he: 'מדבקות לא ניתנות לתזמון. אפשר לשלוח טקסט, תמונה, סרטון, מסמך או הקלטה קולית.',
    en: 'Stickers cannot be scheduled. You can send text, a photo, a video, a document or a voice note.'
  },
  'unsupported.location': {
    he: 'אני לא יודע לתזמן לפי מיקום. אפשר לתזמן לפי שעה — למשל "שלח לדני מחר ב-9:00".',
    en: 'I cannot schedule by location. I can schedule by time — for example "send to Danny tomorrow at 9:00".'
  },
  'unsupported.order': {
    he: 'הזמנות אינן נתמכות. אפשר לתזמן טקסט, תמונה, סרטון, מסמך או הקלטה קולית.',
    en: 'Orders are not supported. You can schedule text, a photo, a video, a document or a voice note.'
  },
  'unsupported.default': {
    he: 'אני יודע לתזמן טקסט, תמונות, סרטונים, מסמכים והקלטות קוליות. את זה לא.',
    en: 'I can schedule text, photos, videos, documents and voice notes. Not this.'
  },

  // ── Everything else the webhook says ──────────────────────────────────
  'register.failed': {
    he: 'לא הצלחתי לרשום את המספר שלך. אפשר לנסות שוב בעוד רגע.',
    en: 'I could not register your number. Please try again in a moment.'
  },
  'command.unrecognised': {
    he: 'לא זיהיתי את הפקודה.\n\n{help}',
    en: 'I did not recognise that command.\n\n{help}'
  },
  'request.abandoned': {
    he: 'בסדר, שכחתי מזה.',
    en: 'All right, forgotten.'
  },
  'parse.failed': {
    he: 'לא הבנתי. אפשר למשל: שלח לדני 0501234567 מחר ב-9:00 "נתראה בפגישה"',
    en: 'I did not follow. For example: send to Danny 0501234567 tomorrow at 9:00 "see you at the meeting"'
  },
  'request.expired': {
    he: 'עבר קצת זמן מאז ששוחחנו, ואני שומר בקשה פתוחה לזמן קצר בלבד — אז איבדתי את ההקשר.\n\n' +
        'אפשר לכתוב את הבקשה במלואה? למשל:\nשלח לדני 0501234567 מחר ב-9:00 "נתראה בפגישה"',
    en: 'It has been a while, and I only hold an open request for a short time — so I have lost the thread.\n\n' +
        'Could you write the whole request out? For example:\nsend to Danny 0501234567 tomorrow at 9:00 "see you at the meeting"'
  },
  'upgrade.soon': {
    he: 'שדרוג המנוי עדיין לא זמין כאן. בקרוב.',
    en: 'Upgrading your plan is not available here yet. Soon.'
  },

  // A file cannot travel inside a template, so the words go alone and the file
  // follows the moment their reply opens the window.
  'delivery.fileWaiting': {
    he: 'נשלח אליך קובץ. אפשר להשיב כאן כדי לקבל אותו.',
    en: 'A file was sent to you. Reply here and I will send it.'
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

// The same nouns without the definite article, for a list where each line is
// an item rather than a sentence: "photo + caption", not "The photo".
const MEDIA_LABEL = {
  he: { image: 'תמונה', video: 'סרטון', audio: 'הקלטה', document: 'מסמך', other: 'קובץ' },
  en: { image: 'photo', video: 'video', audio: 'recording', document: 'document', other: 'file' }
};

export function mediaLabel(mediaType, lang = DEFAULT_LANGUAGE) {
  const table = MEDIA_LABEL[lang] || MEDIA_LABEL[DEFAULT_LANGUAGE];
  return table[mediaType] || table.other;
}

/**
 * A date without a time — for a renewal or a deadline, where the hour would
 * be noise. Israel time, as everywhere else the user reads a date.
 */
export function formatDate(date, lang = DEFAULT_LANGUAGE) {
  return new Date(date).toLocaleDateString(lang === 'en' ? 'en-GB' : 'he-IL', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long'
  });
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
