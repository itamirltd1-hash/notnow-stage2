import pool from '../db/pool.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';

/**
 * Strip the Hebrew prefixes a spoken group name arrives with:
 * "לקבוצת צוות" → "צוות".
 */
function normalizeGroupName(name) {
  if (!name) return '';
  return name
    .trim()
    .replace(/^ל?קבוצ(?:ת|ה)\s+/, '')
    .replace(/^ל[־-]?/, '')
    .trim();
}

/**
 * Resolve a spoken group name to one of the user's saved groups.
 * Mirrors findContactsByName: one hit resolves, several ask, none falls through.
 */
export async function findGroupsByName(userId, name) {
  const bare = normalizeGroupName(name);
  if (!bare) return { candidates: [] };

  try {
    for (const pattern of [bare, `${bare}%`, `%${bare}%`]) {
      const result = await pool.query(
        `SELECT group_id, name FROM groups
          WHERE user_id = $1 AND name ILIKE $2
          ORDER BY name LIMIT 5`,
        [userId, pattern]
      );

      if (result.rows.length === 1) return { match: result.rows[0], candidates: result.rows };
      if (result.rows.length > 1) return { candidates: result.rows };
    }
    return { candidates: [] };
  } catch (error) {
    console.error('Error looking up group by name:', error.message);
    return { candidates: [] };
  }
}

/**
 * Members of a group, with the consent state that decides whether each one
 * can actually be messaged.
 */
export async function getGroupMembers(userId, groupId) {
  const result = await pool.query(
    `SELECT c.contact_id, c.name, c.phone_number, c.consent_status
       FROM group_members gm
       JOIN contacts c ON c.contact_id = gm.contact_id
       JOIN groups g   ON g.group_id = gm.group_id
      WHERE gm.group_id = $1 AND g.user_id = $2 AND c.user_id = $2
      ORDER BY c.name`,
    [groupId, userId]
  );
  return result.rows;
}

/**
 * Create a group, or return the existing one with that name.
 */
export async function createGroup(userId, name) {
  const clean = normalizeGroupName(name) || name.trim();
  const result = await pool.query(
    `INSERT INTO groups (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, name) DO UPDATE SET updated_at = NOW()
     RETURNING group_id, name`,
    [userId, clean]
  );
  return result.rows[0];
}

/**
 * Add a contact to a group, creating the contact if this is a new number.
 */
export async function addGroupMember(userId, groupId, phone, contactName = null) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) throw new Error('Invalid phone number');

  const contact = await pool.query(
    `INSERT INTO contacts (user_id, phone_number, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, phone_number)
     DO UPDATE SET name = COALESCE(NULLIF($3, ''), contacts.name)
     RETURNING contact_id`,
    [userId, normalized, contactName || 'Contact']
  );

  await pool.query(
    `INSERT INTO group_members (group_id, contact_id) VALUES ($1, $2)
     ON CONFLICT (group_id, contact_id) DO NOTHING`,
    [groupId, contact.rows[0].contact_id]
  );

  return contact.rows[0].contact_id;
}

export async function removeGroupMember(userId, groupId, contactId) {
  const result = await pool.query(
    `DELETE FROM group_members gm
      USING groups g
      WHERE gm.group_id = $1 AND gm.contact_id = $2
        AND g.group_id = gm.group_id AND g.user_id = $3`,
    [groupId, contactId, userId]
  );
  return result.rowCount > 0;
}

export async function listGroups(userId) {
  const result = await pool.query(
    `SELECT g.group_id, g.name, COUNT(gm.group_member_id) AS member_count
       FROM groups g
       LEFT JOIN group_members gm ON gm.group_id = g.group_id
      WHERE g.user_id = $1
      GROUP BY g.group_id, g.name
      ORDER BY g.name`,
    [userId]
  );
  return result.rows;
}
