import pool from '../db/pool.js';

const LIST = /^\s*(?:מה\s+בתור|מה\s+מתוזמן|בתור|התור|תור|רשימה|queue)\s*[?？]?\s*$/i;
const CANCEL = /^\s*(?:בטל|תבטל|בטלי|ביטול)\s*(?:את\s+)?(\d+|הכל|הכול|all)?\s*[!.]?\s*$/i;

export function parseQueueCommand(text) {
  if (LIST.test(text)) return { action: 'list' };

  const cancel = text.match(CANCEL);
  if (cancel) {
    const target = cancel[1];
    if (!target) return { action: 'cancel', target: null };
    if (/^(הכל|הכול|all)$/i.test(target)) return { action: 'cancel', target: 'all' };
    return { action: 'cancel', target: Number(target) };
  }

  return null;
}

/**
 * Everything this user has scheduled and not yet sent, oldest first.
 *
 * A group send is many rows sharing one group_id; they are collapsed into a
 * single entry so the list reads the way the user thinks about it, and
 * cancelling that entry cancels the whole fan-out.
 */
export async function getPendingEntries(userId) {
  const result = await pool.query(
    `SELECT queue_id, recipient_phone, recipient_name, message_body,
            scheduled_at, status, group_id, media_id
       FROM active_queue
      WHERE user_id = $1 AND status IN ('pending', 'awaiting_consent')
      ORDER BY scheduled_at ASC, queue_id ASC`,
    [userId]
  );

  const entries = [];
  const groupIndex = new Map();

  for (const row of result.rows) {
    if (row.group_id) {
      const key = `${row.group_id}|${row.scheduled_at.toISOString()}|${row.message_body}`;
      const existing = groupIndex.get(key);
      if (existing) {
        existing.queueIds.push(row.queue_id);
        existing.recipientCount += 1;
        if (row.status === 'awaiting_consent') existing.awaiting += 1;
        continue;
      }
      const entry = {
        queueIds: [row.queue_id],
        groupId: row.group_id,
        recipientCount: 1,
        awaiting: row.status === 'awaiting_consent' ? 1 : 0,
        scheduledAt: row.scheduled_at,
        messageBody: row.message_body,
        mediaId: row.media_id
      };
      groupIndex.set(key, entry);
      entries.push(entry);
      continue;
    }

    entries.push({
      queueIds: [row.queue_id],
      groupId: null,
      recipientName: row.recipient_name,
      recipientPhone: row.recipient_phone,
      recipientCount: 1,
      awaiting: row.status === 'awaiting_consent' ? 1 : 0,
      scheduledAt: row.scheduled_at,
      messageBody: row.message_body,
      mediaId: row.media_id
    });
  }

  return entries;
}

function formatWhen(date) {
  return new Date(date).toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

async function groupName(groupId) {
  const result = await pool.query('SELECT name FROM groups WHERE group_id = $1', [groupId]);
  return result.rows[0]?.name || 'קבוצה';
}

async function describeEntry(entry) {
  const who = entry.groupId
    ? `לקבוצת ${await groupName(entry.groupId)} (${entry.recipientCount} אנשים)`
    : `ל${entry.recipientName || entry.recipientPhone}${entry.recipientName ? ` ${entry.recipientPhone}` : ''}`;

  const what = entry.mediaId ? 'הקלטה' : `"${entry.messageBody}"`;
  const waiting = entry.awaiting > 0
    ? (entry.groupId ? ` — ${entry.awaiting} עדיין לא אישרו` : ' — ממתין לאישור הנמען')
    : '';

  return `${who} — ${formatWhen(entry.scheduledAt)} — ${what}${waiting}`;
}

export async function runQueueCommand(userId, command) {
  const entries = await getPendingEntries(userId);

  if (command.action === 'list') {
    if (entries.length === 0) return 'אין כרגע הודעות שממתינות לשליחה.';
    const lines = await Promise.all(entries.map(async (e, i) => `${i + 1}. ${await describeEntry(e)}`));
    return `${entries.length} הודעות ממתינות:\n${lines.join('\n')}\n\nלביטול אחת מהן — למשל "בטל 1".`;
  }

  // Cancelling
  if (entries.length === 0) return 'אין כרגע הודעות שממתינות, אז אין מה לבטל.';

  if (command.target === null) {
    const lines = await Promise.all(entries.map(async (e, i) => `${i + 1}. ${await describeEntry(e)}`));
    return `איזו מהן לבטל?\n${lines.join('\n')}\n\nלמשל "בטל 1", או "בטל הכל".`;
  }

  if (command.target === 'all') {
    const ids = entries.flatMap(e => e.queueIds);
    await cancelIds(userId, ids);
    return `ביטלתי את כל ${entries.length} ההודעות שהמתינו.`;
  }

  const index = command.target;
  if (index < 1 || index > entries.length) {
    return `אין הודעה מספר ${index} — יש ${entries.length} בתור. "מה בתור" יציג את הרשימה.`;
  }

  const entry = entries[index - 1];
  await cancelIds(userId, entry.queueIds);
  return `ביטלתי. ${await describeEntry(entry)}`;
}

/**
 * Scoped by user_id as well as id — an index is easy to guess, and cancelling
 * must never reach another tenant's queue.
 */
async function cancelIds(userId, queueIds) {
  await pool.query(
    `UPDATE active_queue
        SET status = 'cancelled', updated_at = NOW()
      WHERE user_id = $1 AND queue_id = ANY($2::int[])
        AND status IN ('pending', 'awaiting_consent')`,
    [userId, queueIds]
  );
}
