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
export function welcomeMessage() {
  return (
    'שלום! אני NotNow 👋\n' +
    'אני מתזמן הודעות WhatsApp — אתה אומר לי מה, למי ומתי, ואני שולח בזמן.\n\n' +
    'פשוט תכתוב לי במילים שלך:\n' +
    '• שלח לדני 0501234567 מחר ב-9:00 "נתראה בפגישה"\n' +
    '• תזכיר לי עוד שעתיים לחזור ללקוח\n\n' +
    'אפשר גם להקליט הודעה קולית ואני אתמלל אותה.\n\n' +
    'רוצה לשלוח לכמה אנשים בבת אחת? צור קבוצה — כל אחד יקבל הודעה אישית נפרדת:\n' +
    '• צור קבוצה טסטרים\n' +
    '• הוסף לטסטרים 0501111111 דנה\n' +
    '• תשלח לקבוצת טסטרים מחר ב-10 "בוקר טוב"\n\n' +
    'לרשימת הפקודות המלאה כתוב "עזרה".'
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
    'הקלט הודעה ואתמלל אותה. אשאל אם לשלוח את הטקסט או את ההקלטה עצמה.\n\n' +
    'שים לב: לפני שאני שולח למישהו בפעם הראשונה, אני מבקש את אישורו. ' +
    'ההודעה ממתינה עד שהוא מאשר.'
  );
}

/**
 * For a recipient who was asked for consent and replied with something else.
 * They are mid-conversation about one specific question — a product tour here
 * would answer a question they never asked.
 */
export function consentClarification() {
  return (
    'שלחו לך בקשה לתזמן עבורך הודעה דרך NotNow.\n\n' +
    'להסכים — השב "כן".\n' +
    'לא מעוניין — השב "הסר", ולא נפנה אליך שוב.'
  );
}
