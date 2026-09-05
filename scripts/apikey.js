import crypto from 'crypto';
import pool from '../src/db/pool.js';

/**
 * Issue, list and revoke API keys.
 *
 * A script rather than an HTTP route, for the same reason phone.js is one: an
 * endpoint that mints credentials is not something to leave reachable, and
 * there is no session or dashboard to protect it with yet.
 *
 * The key is shown once. Only its SHA-256 hash is stored, so a lost key is
 * revoked and reissued rather than recovered.
 *
 *   npm run apikey issue 19
 *   npm run apikey list 19
 *   npm run apikey revoke cue_a1b2c3
 */
const [command, argument] = process.argv.slice(2);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function issue(userId) {
  if (!/^\d+$/.test(userId || '')) {
    fail('Pass the tenant id:  npm run apikey issue 19');
  }

  const user = await pool.query('SELECT user_id, email, tier FROM users WHERE user_id = $1', [userId]);
  if (user.rowCount === 0) fail(`No user ${userId}`);

  // 32 bytes of randomness. The prefix is stored in the clear so a key can be
  // named in a log or revoked without ever holding the secret again.
  const secret = crypto.randomBytes(24).toString('base64url');
  const key = `cue_${secret}`;
  const prefix = key.slice(0, 10);
  const hash = crypto.createHash('sha256').update(key).digest('hex');

  await pool.query(
    'INSERT INTO api_keys (user_id, key_hash, key_prefix) VALUES ($1, $2, $3)',
    [userId, hash, prefix]
  );

  console.log(`\n✅ Key issued for user ${userId} (${user.rows[0].email}, ${user.rows[0].tier})\n`);
  console.log(`   ${key}\n`);
  console.log('   Shown once. Only its hash is stored — a lost key is reissued, not recovered.');
  console.log(`   Send it as the X-Api-Key header to POST /api/external/schedule.`);
  console.log(`   Messages scheduled with it count against the tenant's monthly quota,`);
  console.log('   and a recipient who has not agreed is asked before anything is sent.\n');
}

async function list(userId) {
  const rows = await pool.query(
    `SELECT key_prefix, created_at, last_used_at, revoked_at
       FROM api_keys ${userId ? 'WHERE user_id = $1' : ''}
      ORDER BY created_at DESC`,
    userId ? [userId] : []
  );

  if (rows.rowCount === 0) return console.log('No keys.');

  for (const k of rows.rows) {
    const state = k.revoked_at ? 'revoked' : 'active';
    const used = k.last_used_at ? k.last_used_at.toISOString() : 'never used';
    console.log(`${k.key_prefix}…  ${state.padEnd(8)}  issued ${k.created_at.toISOString().slice(0, 10)}  ${used}`);
  }
}

async function revoke(prefix) {
  if (!prefix) fail('Pass the key prefix shown by list:  npm run apikey revoke cue_a1b2c3');

  const result = await pool.query(
    `UPDATE api_keys SET revoked_at = NOW()
      WHERE key_prefix = $1 AND revoked_at IS NULL
      RETURNING api_key_id, user_id`,
    [prefix]
  );

  if (result.rowCount === 0) return console.log('No active key with that prefix.');
  console.log(`✅ Revoked key ${prefix}… (user ${result.rows[0].user_id}). It stops working immediately.`);
}

const commands = { issue, list, revoke };

if (!commands[command]) {
  console.log('Usage:\n' +
    '  npm run apikey issue <user id>\n' +
    '  npm run apikey list [user id]\n' +
    '  npm run apikey revoke <key prefix>');
  process.exit(1);
}

commands[command](argument)
  .then(() => pool.end())
  .catch(error => { console.error('❌', error.message); process.exit(1); });
