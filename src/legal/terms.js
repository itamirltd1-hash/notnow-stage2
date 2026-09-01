import pool from '../db/pool.js';
import { BRAND } from '../brand.js';
import { t } from '../i18n/messages.js';

// Bump when the terms change in a way that needs agreeing to again. Storing
// "accepted" without which document was accepted proves very little.
export const TERMS_VERSION = '1.0';

const ACCEPT = /^\s*(?:מאשר|מאשרת|אני\s+מאשר(?:ת)?|מסכים|מסכימה|אישור|קראתי\s+ואני\s+מאשר(?:ת)?|accept|agree)\s*[!.]?\s*$/i;

export function isTermsAcceptance(text) {
  return ACCEPT.test(text);
}

function termsUrl() {
  const base = (process.env.APP_URL || '').replace(/\/+$/, '');
  return `${base}/terms`;
}

export async function hasAcceptedTerms(userId) {
  try {
    const result = await pool.query(
      'SELECT terms_version FROM users WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.terms_version === TERMS_VERSION;
  } catch (error) {
    console.error('Error reading terms acceptance:', error.message);
    // Never block someone because a lookup failed.
    return true;
  }
}

export async function recordAcceptance(userId) {
  await pool.query(
    `UPDATE users SET terms_accepted_at = NOW(), terms_version = $1, updated_at = NOW()
      WHERE user_id = $2`,
    [TERMS_VERSION, userId]
  );
  console.log(`📜 User ${userId} accepted terms ${TERMS_VERSION}`);
}

/**
 * The ask. A wall of legal text in a chat window is not read by anyone, so
 * the document lives on a page and the chat carries only the link and the
 * decision.
 */
export function termsPrompt(lang = 'he') {
  return t('terms.prompt', lang, { url: termsUrl(), brand: BRAND });
}

export function acceptanceConfirmation(lang = 'he') {
  return t('terms.accepted', lang);
}
