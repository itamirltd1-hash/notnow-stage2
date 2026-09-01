import { t } from '../i18n/messages.js';

/**
 * Answers to the questions people actually ask about how the bot behaves.
 *
 * Matching requires terms to be present, not to appear in a given order:
 * "איך פועל מנגנון ההסכמה" and "מנגנון ההסכמה — איך זה עובד" are one question,
 * and word order in both languages is loose enough that an ordered pattern
 * misses half of it.
 *
 * Each entry needs every one of its patterns to match. That pairing is what
 * keeps a single common word from answering the wrong question: "group" alone
 * says nothing, "group" plus "how does it work" says a great deal.
 */
const ANSWERS = [
  {
    key: 'faq.consent',
    all: [
      /הסכמ|אישור|מאשר|מסכים|consent|permission|approve|agree|opt.?in/i,
      /איך|למה|מה\b|פועל|עובד|צריך|נדרש|זה|how|why|what|work|need|does/i
    ]
  },
  {
    key: 'faq.waiting',
    all: [
      /הודעה|הודעות|message|messages/i,
      /לא\s+נשלח|ממתינ|תקוע|מחכ|מה\s+קורה|למה|waiting|stuck|pending|not\s+sent|why|held/i
    ]
  },
  {
    key: 'faq.groups',
    all: [
      /קבוצ|group/i,
      /צ'?אט|וואטסאפ|whatsapp|איך|מה\b|עובד|פועל|זה|chat|how|what|work|mean|does/i
    ]
  },
  {
    key: 'faq.cancel',
    all: [
      // Hebrew verbs carry their prefix, so "לבטל" and "מבטל" are different
      // strings for the same act — both have to be here.
      /לבטל|למחוק|ביטול|מבטל|מוחק|תבטל|cancel|delete|undo|stop\s+a/i,
      /הודעה|תזמון|איך|אפשר|message|scheduled|how|can\s+i/i
    ]
  },
  {
    key: 'faq.automated',
    all: [
      /בוט|אוטומט|מתוזמנ|מראש|bot|automated|automatic|scheduled|robot/i,
      /יראה|רואה|יודע|ידע|יבין|מזהה|האם|יראו|see|know|tell|notice|realise|realize|does|will/i
    ]
  }
];

/**
 * Returns a plain-language answer, or null when this is not one of these
 * questions and should carry on to the model.
 */
export function answerServiceQuestion(text, lang = 'he') {
  for (const { all, key } of ANSWERS) {
    if (all.every(re => re.test(text))) return t(key, lang);
  }
  return null;
}
