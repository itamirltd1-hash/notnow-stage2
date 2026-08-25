import axios from 'axios';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Parse user message intent using Claude Haiku 4.5 with Structured Outputs.
 * Extracts: intent, recipient, message body, scheduled timestamp, language.
 */
export async function parseSchedulingIntent(userMessage, language = 'he') {
  try {
    const systemPrompt = buildSystemPrompt(language);

    const response = await axios.post(
      CLAUDE_API_URL,
      {
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userMessage
          }
        ]
      },
      {
        headers: {
          'anthropic-version': '2023-06-01',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'content-type': 'application/json'
        }
      }
    );

    const responseText = response.data.content[0].text;
    const parsed = JSON.parse(stripCodeFence(responseText));

    return {
      success: true,
      intent: parsed.intent,
      confidence: parsed.confidence,
      entities: parsed.entities,
      language: parsed.language,
      confirmationText: parsed.confirmation_text,
      error: parsed.error_text || null
    };
  } catch (error) {
    console.error('Error parsing intent:', error.message);
    console.error('   Raw Claude response:', error.response?.data
      ? JSON.stringify(error.response.data)
      : 'n/a');
    return {
      success: false,
      error: 'Failed to parse message intent',
      intent: null,
      confidence: 0
    };
  }
}

/**
 * Claude often wraps JSON in a ```json fence despite instructions.
 * Strip it before parsing, and fall back to the outermost {...} block.
 */
function stripCodeFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1];

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) return trimmed.slice(first, last + 1);

  return trimmed;
}

/**
 * Build the system prompt for Claude to parse scheduling intents.
 * Tailored to Hebrew-first, but handles Hebrew/English mix.
 */
function buildSystemPrompt(language) {
  const nowUtc = new Date();
  const nowLocal = nowUtc.toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' });

  return `You are an expert message scheduling assistant. Your job is to parse user messages and extract scheduling intent.

CURRENT TIME REFERENCE (use this to resolve relative times like "tomorrow", "in 2 hours", "מחר"):
- Current time in Israel (Asia/Jerusalem): ${nowLocal}
- Current time in UTC: ${nowUtc.toISOString()}
The user speaks in Israel local time. Convert to UTC for "scheduled_timestamp".

The user will send messages in Hebrew or English asking to schedule messages, cancel messages, list queue, or upgrade tier.

For each message, respond ONLY with a valid JSON object in this exact format:

{
  "intent": "SCHEDULE_MESSAGE" | "CANCEL_SCHEDULED" | "LIST_QUEUE" | "UPGRADE_TIER",
  "confidence": 0.0 to 1.0,
  "language": "he" | "en",
  "entities": {
    "recipient_phone": "+972..." or null (the person to send the message to),
    "recipient_name": "Name" or null,
    "message_body": "The exact message to send" or null,
    "scheduled_timestamp": "2026-08-01T17:00:00Z" (ISO 8601) or null,
    "delivery_channel": "whatsapp" | "gmail" (default: whatsapp)
  },
  "confirmation_text": "A friendly confirmation message in the user's language",
  "error_text": null or "An error message if parsing failed"
}

Examples:

User (Hebrew): "תזמן הודעה לדן מחר בשעה 5 בערב: 'היי דן, בחזרה מהפגישה'"
Response: {
  "intent": "SCHEDULE_MESSAGE",
  "confidence": 0.95,
  "language": "he",
  "entities": {
    "recipient_name": "Dan",
    "message_body": "היי דן, בחזרה מהפגישה",
    "scheduled_timestamp": "2026-07-30T17:00:00Z"
  },
  "confirmation_text": "קיבלתי! תזמנתי הודעה לדן לשעה 17:00 מחר עם הטקסט 'היי דן, בחזרה מהפגישה'",
  "error_text": null
}

User (English): "Schedule a message to +972501234567 saying 'Updated quote' in 2 hours"
Response: {
  "intent": "SCHEDULE_MESSAGE",
  "confidence": 0.92,
  "language": "en",
  "entities": {
    "recipient_phone": "+972501234567",
    "message_body": "Updated quote",
    "scheduled_timestamp": "2026-07-29T15:30:00Z"
  },
  "confirmation_text": "Got it! Scheduled message to +972501234567 for 15:30 with text 'Updated quote'",
  "error_text": null
}

User (Hebrew, no quotes around the message): "שלח לדני 0508765480 מחר ב9:00 פגישה"
Response: {
  "intent": "SCHEDULE_MESSAGE",
  "confidence": 0.9,
  "language": "he",
  "entities": {
    "recipient_phone": "+972508765480",
    "recipient_name": "דני",
    "message_body": "פגישה",
    "scheduled_timestamp": "2026-08-26T06:00:00Z",
    "delivery_channel": "whatsapp"
  },
  "confirmation_text": "קיבלתי! תזמנתי לדני (0508765480) מחר ב-09:00 את ההודעה: פגישה",
  "error_text": null
}

RULES:
- The message is NOT always in quotes. Whatever text remains after removing
  the recipient and the time IS the message body. Never return null for
  message_body when any such text exists.
- Convert Israeli local numbers (0XXXXXXXXX) to international form (+972XXXXXXXXX).
- Always resolve relative times against the CURRENT TIME REFERENCE above and
  output UTC. Israel is UTC+3 in summer.

Always return ONLY valid JSON, no markdown fences, no extra text.`;
}

/**
 * Detect the language of the input message.
 * Returns 'he' for Hebrew, 'en' for English.
 */
export function detectLanguage(text) {
  if (!text) return 'en';

  const hebrewRegex = /[֐-׿]/g;
  const hebrewMatches = (text.match(hebrewRegex) || []).length;
  const totalChars = text.length;

  return hebrewMatches / totalChars > 0.3 ? 'he' : 'en';
}
