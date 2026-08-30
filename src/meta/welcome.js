import { BRAND } from '../brand.js';

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

/**
 * Shown once, the first time a number ever writes to the bot.
 */
export function welcomeMessage(profileName = null) {
  // Say up front which name recipients will see. Finding that out only after
  // five clients received "🔥BOSS🔥 ביקש..." is too late.
  const naming = profileName
    ? `\n\nכשאבקש אישור מנמען חדש, אציג אותך בשם "${profileName}". ` +
      `לשינוי — "קרא לי [שם]".`
    : '';

  return (
    `שלום! אני ${BRAND} 👋\n` +
    'אני מתזמן הודעות WhatsApp — אומרים לי מה, למי ומתי, ואני שולח בזמן.\n\n' +
    'אפשר פשוט לכתוב לי במילים חופשיות:\n' +
    '• שלח לדני 0501234567 מחר ב-9:00 "נתראה בפגישה"\n' +
    '• תזכיר לי עוד שעתיים לחזור ללקוח\n\n' +
    'אפשר גם להקליט הודעה קולית ואני אתמלל אותה.\n\n' +
    'לשליחה לכמה אנשים בבת אחת — אפשר ליצור קבוצה. כל אחד יקבל הודעה אישית נפרדת:\n' +
    '• צור קבוצה טסטרים\n' +
    '• הוסף לטסטרים 0501111111 דנה\n' +
    '• תשלח לקבוצת טסטרים מחר ב-10 "בוקר טוב"\n\n' +
    'לרשימת הפקודות המלאה — לכתוב "עזרה".' + naming
  );
}

/**
 * The fuller reference, for someone who already knows what the bot is.
 */
export function helpMessage() {
  return (
    'הפקודות שלי:\n\n' +
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
    'ההודעה ממתינה עד שהוא מאשר.'
  );
}

/**
 * For someone who reached the bot only because a friend scheduled something
 * for them. A tour of scheduling features answers a question they never
 * asked — but they should still learn how to stop, and how to start if they
 * do want it.
 */
export function recipientGreeting() {
  return (
    'שלום! אני Cue.\n' +
    'מישהו תזמן עבורך הודעה דרכי, ולכן אנחנו בקשר.\n\n' +
    'להפסקת הודעות ממני — להשיב "הסר".\n\n' +
    'ואם בא לך גם לתזמן הודעות בעצמך, אפשר לכתוב "עזרה" ואסביר.'
  );
}

/**
 * For a recipient who was asked for consent and replied with something else.
 * They are mid-conversation about one specific question — a product tour here
 * would answer a question they never asked.
 */
export function consentClarification() {
  return (
    `התקבלה בקשה לתזמן עבורך הודעה דרך ${BRAND}.\n\n` +
    'א. מאשר/ת — אפשר לשלוח לי\n' +
    'ב. לא מעוניין/ת — אל תפנו אליי שוב\n\n' +
    'להשיב באות.'
  );
}
