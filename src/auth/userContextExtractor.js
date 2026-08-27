import { getUserContacts } from '../db/multitenancyHelpers.js';
import pool from '../db/pool.js';

/**
 * Identify the tenant a phone number belongs to.
 *
 * Only a user's own contact row (is_owner) may identify them. Matching any
 * contact would authenticate every recipient as the tenant who saved them,
 * letting them schedule from that tenant's quota to that tenant's contacts.
 */
export async function getUserByPhone(phoneNumber) {
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    const result = await pool.query(
      `SELECT u.user_id, u.email, u.tier
       FROM users u
       JOIN contacts c ON u.user_id = c.user_id
       WHERE c.phone_number = $1 AND c.is_owner = TRUE
       LIMIT 1`,
      [normalizedPhone]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error('Error extracting user context:', error.message);
    return null;
  }
}

/**
 * Auto-onboard a WhatsApp sender we've never seen before.
 * Creates a user (identified by phone) plus a self-contact so future
 * lookups in getUserByPhone succeed.
 */
export async function autoRegisterSender(phoneNumber) {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhone) return null;

  const email = `${normalizedPhone.replace('+', '')}@whatsapp.notnow.local`;

  const userResult = await pool.query(
    `INSERT INTO users (email, tier) VALUES ($1, 'FREE')
     ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
     RETURNING user_id, email, tier`,
    [email]
  );
  const user = userResult.rows[0];

  await pool.query(
    `INSERT INTO subscriptions (user_id, tier, message_count_this_month, month_reset_date)
     VALUES ($1, 'FREE', 0, CURRENT_DATE)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.user_id]
  );

  // This one row is what proves the number is the tenant, not a recipient.
  await pool.query(
    `INSERT INTO contacts (user_id, name, phone_number, is_owner)
     VALUES ($1, 'Me', $2, TRUE)
     ON CONFLICT (user_id, phone_number) DO UPDATE SET is_owner = TRUE`,
    [user.user_id, normalizedPhone]
  );

  return user;
}

/**
 * Normalize phone number to consistent format.
 * Handles various formats: +972..., 0..., 972...
 */
export function normalizePhoneNumber(phone) {
  if (!phone) return null;

  let normalized = phone.toString().trim();

  // Remove common separators
  normalized = normalized.replace(/[\s\-().]/g, '');

  // Handle Israeli numbers starting with 0 → +972
  if (normalized.startsWith('0') && !normalized.startsWith('00')) {
    normalized = '+972' + normalized.substring(1);
  }

  // Handle 972 without +
  if (normalized.startsWith('972') && !normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }

  return normalized;
}

/**
 * Get the contact name for a user's phone number (for confirmation messages).
 */
export async function getContactNameByPhone(userId, phoneNumber) {
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    const result = await pool.query(
      'SELECT name FROM contacts WHERE user_id = $1 AND phone_number = $2 LIMIT 1',
      [userId, normalizedPhone]
    );

    return result.rows[0]?.name || 'Recipient';
  } catch (error) {
    console.error('Error getting contact name:', error.message);
    return 'Recipient';
  }
}

/**
 * Strip the Hebrew dative prefix the parser often keeps on a name:
 * "למירית" → "מירית". Only removed when a plausible name remains.
 */
function stripHebrewPrefix(name) {
  const cleaned = name.trim().replace(/^ל[־-]?/, '');
  return cleaned.length >= 2 ? cleaned : name.trim();
}

/**
 * Resolve a spoken name ("מירית") to one of the user's saved contacts.
 * Returns { match } for exactly one hit, { candidates } when ambiguous,
 * or { candidates: [] } when nothing matched — the caller decides what to ask.
 */
export async function findContactsByName(userId, name) {
  if (!name) return { candidates: [] };

  const bare = stripHebrewPrefix(name);

  try {
    // Exact name first, then a prefix match, so "דני" doesn't lose to "דניאל".
    for (const pattern of [bare, `${bare}%`, `%${bare}%`]) {
      const result = await pool.query(
        `SELECT contact_id, name, phone_number
           FROM contacts
          WHERE user_id = $1 AND name ILIKE $2
          ORDER BY name
          LIMIT 5`,
        [userId, pattern]
      );

      if (result.rows.length === 1) return { match: result.rows[0], candidates: result.rows };
      if (result.rows.length > 1) return { candidates: result.rows };
    }

    return { candidates: [] };
  } catch (error) {
    console.error('Error looking up contact by name:', error.message);
    return { candidates: [] };
  }
}

/**
 * Register or update a contact for a user based on incoming message.
 * If the phone is unknown, optionally auto-create a contact entry.
 */
export async function registerOrUpdateContact(userId, phoneNumber, senderName = null) {
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    if (!normalizedPhone) {
      throw new Error('Invalid phone number');
    }

    // Check if contact already exists
    const existing = await pool.query(
      'SELECT contact_id FROM contacts WHERE user_id = $1 AND phone_number = $2',
      [userId, normalizedPhone]
    );

    if (existing.rows.length > 0) {
      return existing.rows[0].contact_id;
    }

    // Create new contact
    const result = await pool.query(
      `INSERT INTO contacts (user_id, phone_number, name)
       VALUES ($1, $2, $3)
       RETURNING contact_id`,
      [userId, normalizedPhone, senderName || 'Contact']
    );

    return result.rows[0].contact_id;
  } catch (error) {
    console.error('Error registering contact:', error.message);
    return null;
  }
}
