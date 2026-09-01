import pool from '../db/pool.js';
import { getLanguage } from '../i18n/language.js';
import { t } from '../i18n/messages.js';

// Two shapes, because Hebrew attaches the preposition to the word: "קרא לי דנה"
// separates the name, while "שנה את השם שלי לדנה" glues ל to it.
const SET_NAME_SPACED =
  /^\s*(?:(?:קרא|תקרא|קראי)\s+לי|השם\s+שלי(?:\s+הוא)?|שמי)\s+(.+?)\s*[!.]?\s*$/;
const SET_NAME_PREFIXED =
  /^\s*(?:שנה|תשנה|שני)\s+(?:את\s+)?השם\s+שלי\s+ל\s*(.+?)\s*[!.]?\s*$/;

const ASK_NAME = /^\s*(?:איך\s+קוראים\s+לי|מה\s+השם\s+שלי|איך\s+אתה\s+קורא\s+לי)\s*[?？]?\s*$/;

const MAX_LENGTH = 40;

export function parseNameCommand(text) {
  if (ASK_NAME.test(text)) return { action: 'get' };

  const set = text.match(SET_NAME_SPACED) || text.match(SET_NAME_PREFIXED);
  if (set) return { action: 'set', name: set[1] };

  return null;
}

/**
 * Remember the profile name WhatsApp sends with every inbound message, unless
 * the user has already chosen something else. Silent: this is a default, not
 * a decision the user made.
 */
export async function rememberProfileName(userId, profileName) {
  if (!profileName || !userId) return;

  const clean = profileName.trim().slice(0, MAX_LENGTH);
  if (!clean) return;

  try {
    await pool.query(
      `UPDATE users SET display_name = $1, updated_at = NOW()
        WHERE user_id = $2 AND display_name_is_custom = FALSE
          AND (display_name IS DISTINCT FROM $1)`,
      [clean, userId]
    );
  } catch (error) {
    console.error('Error storing profile name:', error.message);
  }
}

export async function getDisplayName(userId) {
  try {
    const result = await pool.query(
      'SELECT display_name FROM users WHERE user_id = $1',
      [userId]
    );
    return result.rows[0]?.display_name || null;
  } catch (error) {
    console.error('Error reading display name:', error.message);
    return null;
  }
}

export async function setDisplayName(userId, name) {
  const clean = name.trim().slice(0, MAX_LENGTH);
  if (!clean) return null;

  await pool.query(
    `UPDATE users SET display_name = $1, display_name_is_custom = TRUE, updated_at = NOW()
      WHERE user_id = $2`,
    [clean, userId]
  );
  return clean;
}

export async function runNameCommand(userId, command) {
  const lang = await getLanguage(userId);

  if (command.action === 'get') {
    const name = await getDisplayName(userId);
    return name ? t('name.current', lang, { name }) : t('name.none', lang);
  }

  const saved = await setDisplayName(userId, command.name);
  return saved ? t('name.saved', lang, { name: saved }) : t('name.saveFailed', lang);
}
