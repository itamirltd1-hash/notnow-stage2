import { getUserContacts } from '../db/multitenancyHelpers.js';
import pool from '../db/pool.js';

/**
 * Extract user context from a phone number.
 * Returns user_id if the phone is registered to a user, or null if unknown.
 */
export async function getUserByPhone(phoneNumber) {
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);

    const result = await pool.query(
      `SELECT DISTINCT u.user_id, u.email, u.tier
       FROM users u
       JOIN contacts c ON u.user_id = c.user_id
       WHERE c.phone_number = $1
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

  await pool.query(
    `INSERT INTO contacts (user_id, name, phone_number)
     VALUES ($1, 'Me', $2)
     ON CONFLICT (user_id, phone_number) DO NOTHING`,
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
