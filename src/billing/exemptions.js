import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

/**
 * Numbers that neither consume quota nor get billed — staff, testers, and the
 * owner's own lines.
 *
 * Deliberately an environment variable rather than a table with a chat
 * command: anything editable from WhatsApp is editable by any user, and a
 * user who can add themselves here has granted themselves unlimited quota.
 * Only someone with access to the deployment can change this list.
 *
 * Format: EXEMPT_PHONES=0507575860,0507467974,+972525053164
 */
let cache = null;
let cachedRaw = null;

function load() {
  const raw = process.env.EXEMPT_PHONES || '';
  if (cache && cachedRaw === raw) return cache;

  cache = new Set(
    raw
      .split(',')
      .map(p => normalizePhoneNumber(p.trim()))
      .filter(Boolean)
  );
  cachedRaw = raw;
  return cache;
}

/**
 * Exempt as a sender (unlimited scheduling) and as a recipient (messages to
 * them cost the sender nothing). One list covers both directions.
 */
export function isExempt(phone) {
  const normalized = normalizePhoneNumber(phone);
  return normalized ? load().has(normalized) : false;
}

export function exemptCount() {
  return load().size;
}

export function listExempt() {
  return [...load()];
}
