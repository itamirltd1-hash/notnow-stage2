import pool from './pool.js';

/**
 * Execute a query with automatic user_id scoping.
 * Enforces that all queries include WHERE user_id = $1.
 */
export async function userQuery(userId, sql, params = []) {
  if (!userId || typeof userId !== 'number') {
    throw new Error('Invalid userId: multitenancy scoping requires a valid user_id');
  }
  return pool.query(sql, [userId, ...params]);
}

/**
 * Execute multiple queries in a transaction, all scoped to the same user.
 */
export async function userTransaction(userId, queries) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const { sql, params } of queries) {
      const result = await client.query(sql, [userId, ...(params || [])]);
      results.push(result);
    }
    await client.query('COMMIT');
    return results;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getUserMessages(userId, filters = {}) {
  let sql = 'SELECT * FROM active_queue WHERE user_id = $1';
  const params = [userId];

  if (filters.status) {
    sql += ` AND status = $${params.length + 1}`;
    params.push(filters.status);
  }
  if (filters.limit) {
    sql += ` LIMIT $${params.length + 1}`;
    params.push(filters.limit);
  }

  return pool.query(sql, params);
}

export async function getUserContacts(userId) {
  return pool.query(
    'SELECT * FROM contacts WHERE user_id = $1 ORDER BY name ASC',
    [userId]
  );
}

export async function getUserTemplates(userId) {
  return pool.query(
    'SELECT * FROM templates WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
}

export async function getUserSubscription(userId) {
  return pool.query(
    'SELECT * FROM subscriptions WHERE user_id = $1',
    [userId]
  );
}

export async function getUserMonthlyUsage(userId, month = null) {
  const targetMonth = month || new Date().toISOString().split('T')[0].slice(0, 7) + '-01';
  return pool.query(
    'SELECT * FROM monthly_usage WHERE user_id = $1 AND month = $2',
    [userId, targetMonth]
  );
}

export async function getUserActivityLog(userId, limit = 50) {
  return pool.query(
    'SELECT * FROM activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
}
