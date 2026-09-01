import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

// Loose on purpose: this is looking for numbers the parser may have passed
// over, so it should over-collect and let the filtering below decide.
const PHONE_IN_TEXT = /(?:\+|\b00)?\d[\d\-\s().]{6,}\d/g;

/**
 * Phone numbers the sender wrote that nothing was scheduled to.
 *
 * A request naming two people is parsed into one recipient — the schema has a
 * single recipient_phone — and the other number is dropped without a word.
 * The sender reads a confirmation that names one person and has no reason to
 * think anything is missing, which is the part that costs them.
 *
 * Numbers are only reported, never scheduled to. A message body can contain a
 * phone number that is not a recipient at all ("call me on 050-1234567"), and
 * sending to it would be worse than saying nothing.
 */
export function unusedNumbers(text, usedPhones = [], senderPhone = null, messageBody = null) {
  if (!text) return [];

  const used = new Set(
    [...usedPhones, senderPhone].map(normalizePhoneNumber).filter(Boolean)
  );

  const found = [];
  for (const raw of text.match(PHONE_IN_TEXT) || []) {
    const digits = raw.replace(/\D/g, '');
    // A clock time, a date or a house number is not a phone number.
    if (digits.length < 9) continue;

    // A number inside the message being sent is content, not a recipient:
    // "call me on 050-1234567" is the point of the message.
    if (messageBody && messageBody.includes(raw.trim())) continue;

    const normalized = normalizePhoneNumber(raw.trim());
    if (!normalized || used.has(normalized)) continue;

    used.add(normalized);
    found.push(normalized);
  }

  return found;
}
