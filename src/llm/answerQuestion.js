import axios from 'axios';
import { capabilityDescription } from './capabilities.js';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Answer a question about the product, from the description and nothing else.
 *
 * Kept as a separate call rather than folded into the scheduling prompt: the
 * description is long, questions are rare, and every scheduling message would
 * otherwise pay for it.
 *
 * The grounding rule is the whole point. Left to itself the model invents
 * confident answers about a product it has never seen — it once refused to
 * list group members, which is a thing this bot does.
 */
export async function answerProductQuestion(question, lang = 'he') {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  // The description stays in one language on purpose. Two descriptions drift,
  // and then the bot describes two different products depending on who asks.
  // The model reads the Hebrew and answers in whichever language was asked.
  const answerIn = lang === 'en'
    ? `- ענה באנגלית בלבד, באנגלית תקנית וטבעית. אל תשאיר מילים בעברית בתשובה.
- אין הבחנת מין באנגלית, ולכן אין צורך בהתאם — אבל אל תניח את מינו של השואל.`
    : `- ענה בעברית תקנית.
- הקפד על התאם מין: התמונה תישלח, הסרטון יישלח, ההודעה תישלח, המסמך יישלח.
- מינו של השואל אינו ידוע. פנה בלשון סתמית — "אפשר לתזמן" ולא "תזמן",
  "כדאי לכתוב" ולא "כתוב".`;

  const helpWord = lang === 'en' ? '"help"' : '"עזרה"';

  const system =
    `אתה עונה על שאלות של משתמשים לגבי שירות בשם Cue. להלן תיאור מלא של השירות.

${capabilityDescription()}

כללים:
- ענה אך ורק על סמך התיאור שלמעלה. אל תסיק, אל תשער, ואל תמציא יכולות או מגבלות.
- אם התשובה לא נמצאת בתיאור, אמור בפשטות שאינך יודע והצע לכתוב ${helpWord}.
- אל תמציא מגבלה. אם משהו לא מוזכר, זה לא אומר שהוא בלתי אפשרי — זה אומר שאינך יודע.
- שתיים-שלוש שורות לכל היותר, בטון ענייני וללא אימוג'ים.
${answerIn}
- אל תפתח בברכת שלום ואל תסיים בשאלה מנומסת. תשובה בלבד.
- אם השאלה אינה על השירות, אמור שאתה עונה רק על שאלות לגבי Cue.`;

  try {
    const response = await axios.post(
      CLAUDE_API_URL,
      {
        model: MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: 'user', content: question }]
      },
      {
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'content-type': 'application/json'
        },
        timeout: 20000
      }
    );

    const answer = (response.data.content?.[0]?.text || '').trim();
    return answer || null;
  } catch (error) {
    console.error('Product question failed:', error.response?.data?.error?.message || error.message);
    return null;
  }
}
