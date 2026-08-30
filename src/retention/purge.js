import pool from '../db/pool.js';

// Counted from when a message actually went out, not from when it was
// scheduled — something scheduled six months ahead has to survive until then.
const MESSAGE_DAYS = Number(process.env.RETENTION_DAYS || 7);

// The audit trail records who was messaged and when, so it cannot outlive the
// messages themselves by much.
const ACTIVITY_DAYS = Number(process.env.ACTIVITY_RETENTION_DAYS || 30);

// Abandoned half-conversations: a question nobody answered, a photo nobody
// used. Their in-memory TTLs stop them being *acted* on; nothing deleted them.
const SCRATCH_HOURS = 24;

/**
 * Delete what is no longer needed.
 *
 * The messages this service holds are private by definition, and the surest
 * protection is not keeping them: what has been deleted cannot leak, cannot
 * be subpoenaed, and cannot be read by a future bug.
 */
export async function purgeExpiredData() {
  const removed = {};

  try {
    // Only rows that have reached an end state. A pending message is still
    // owed to someone, however old the request.
    const messages = await pool.query(
      `DELETE FROM active_queue
        WHERE status IN ('sent', 'failed', 'cancelled')
          AND COALESCE(sent_at, updated_at) < NOW() - INTERVAL '${MESSAGE_DAYS} days'
        RETURNING queue_id`
    );
    removed.messages = messages.rowCount;

    const activity = await pool.query(
      `DELETE FROM activity_log
        WHERE created_at < NOW() - INTERVAL '${ACTIVITY_DAYS} days'
        RETURNING log_id`
    );
    removed.activity = activity.rowCount;

    for (const [table, column] of [
      ['pending_choice', 'sender_phone'],
      ['pending_media', 'sender_phone'],
      ['pending_voice', 'sender_phone']
    ]) {
      const result = await pool.query(
        `DELETE FROM ${table} WHERE created_at < NOW() - INTERVAL '${SCRATCH_HOURS} hours'
         RETURNING ${column}`
      );
      removed[table] = result.rowCount;
    }

    // The service window is 24 hours; a record of an inbound message from
    // last month says only that someone once wrote to us.
    const inbound = await pool.query(
      `DELETE FROM whatsapp_inbound
        WHERE last_message_at < NOW() - INTERVAL '${ACTIVITY_DAYS} days'
        RETURNING phone_number`
    );
    removed.inbound = inbound.rowCount;

    const total = Object.values(removed).reduce((a, b) => a + b, 0);
    if (total > 0) {
      console.log('🧹 Retention purge:',
        Object.entries(removed).filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}=${n}`).join(', '));
    }

    return removed;
  } catch (error) {
    console.error('Retention purge failed:', error.message);
    return removed;
  }
}
