/**
 * Answers to the questions people actually ask about how the bot behaves.
 * Plain language: someone asking why their message is waiting does not want
 * the words "opt-in", "template" or "24-hour window".
 *
 * Matching requires terms to be present, not to appear in a given order:
 * "איך פועל מנגנון ההסכמה" and "מנגנון ההסכמה — איך זה עובד" are one question,
 * and Hebrew word order is loose enough that ordered patterns miss half of it.
 */
const ANSWERS = [
  {
    all: [/הסכמ|אישור|מאשר|מסכים/, /איך|למה|מה\b|פועל|עובד|צריך|נדרש|זה/],
    answer:
      'לפני שאני שולח למישהו בפעם הראשונה, אני שולח לו הודעה קצרה ושואל אם הוא מסכים לקבל.\n\n' +
      'ההודעה שתזמנת ממתינה עד שהוא עונה. אם הוא מאשר — היא נשלחת במועד שקבעת. ' +
      'אם הוא מסרב — היא לא נשלחת, ולא נפנה אליו יותר.\n\n' +
      'זה מגן גם עליו וגם על המספר שממנו אני שולח.'
  },
  {
    all: [/הודעה|הודעות/, /לא\s+נשלח|ממתינ|תקוע|מחכ|מה\s+קורה|למה/],
    answer:
      'הודעה יכולה להמתין משתי סיבות:\n\n' +
      'המועד שקבעת עוד לא הגיע — אפשר לראות הכל עם "מה בתור".\n\n' +
      'או שהנמען עדיין לא אישר לקבל ממני הודעות. במקרה כזה מופיע לידה ' +
      '"ממתינה לאישור הנמען".'
  },
  {
    all: [/קבוצ/, /צ'?אט|וואטסאפ|whatsapp|איך|מה\b|עובד|פועל|זה/i],
    answer:
      'קבוצה אצלי היא רשימה שמורה, לא צ\'אט קבוצתי בוואטסאפ.\n\n' +
      'כשמתזמנים לקבוצה, כל אחד מקבל הודעה אישית נפרדת. הם לא רואים זה את זה ' +
      'ולא יודעים שההודעה נשלחה לעוד מישהו.'
  },
  {
    all: [/לבטל|למחוק|ביטול/, /הודעה|תזמון|איך|אפשר/],
    answer:
      'כותבים "מה בתור" כדי לראות את כל מה שממתין, ואז "בטל 2" לפי המספר ברשימה.\n\n' +
      '"בטל הכל" מבטל את כל מה שתוזמן. הודעה שכבר נשלחה אי אפשר להחזיר.'
  },
  {
    all: [/בוט|אוטומט|מתוזמנ|מראש/, /יראה|רואה|יודע|ידע|יבין|מזהה|האם|יראו/],
    answer:
      'ההודעה מגיעה מהמספר העסקי שלנו, לא מהמספר הפרטי שלך.\n\n' +
      'הנמען רואה הודעה רגילה בוואטסאפ. אין שום סימן שהיא תוזמנה מראש.'
  }
];

/**
 * Returns a plain-language answer, or null when this is not one of these
 * questions and should carry on to the model.
 */
export function answerServiceQuestion(text) {
  for (const { all, answer } of ANSWERS) {
    if (all.every(re => re.test(text))) return answer;
  }
  return null;
}
