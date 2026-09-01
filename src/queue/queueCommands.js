import pool from '../db/pool.js';
import { getLanguage } from '../i18n/language.js';
import { t, mediaLabel, formatWhen } from '../i18n/messages.js';

// Both languages in one pattern rather than one per language: a message is
// tested against every alternative anyway, and two patterns drift apart the
// moment someone adds a synonym to only one of them.
const LIST = /^\s*(?:מה\s+בתור|מה\s+מתוזמן|בתור|התור|תור|רשימה|queue|the\s+queue|what(?:'?s|\s+is)?\s+(?:in\s+)?(?:the\s+)?queue|what(?:'?s|\s+is)\s+scheduled|what(?:'?s|\s+is)\s+pending|scheduled|pending|list)\s*[?？]?\s*$/i;

// A bare "cancel" reaches here before it reaches isAbandonment, exactly as a
// bare "בטל" does — the queue is what people mean by the word on its own, and
// abandoning a half-finished request has its own words below.
const CANCEL = /^\s*(?:בטל|תבטל|בטלי|ביטול|cancel|delete)\s*(?:את\s+)?(\d+|הכל|הכול|all|everything)?\s*[!.]?\s*$/i;

export function parseQueueCommand(text) {
  if (LIST.test(text)) return { action: 'list' };

  const cancel = text.match(CANCEL);
  if (cancel) {
    const target = cancel[1];
    if (!target) return { action: 'cancel', target: null };
    if (/^(הכל|הכול|all|everything)$/i.test(target)) return { action: 'cancel', target: 'all' };
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
            scheduled_at, status, group_id, media_id, media_type
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
        mediaId: row.media_id,
        mediaType: row.media_type
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
      mediaId: row.media_id,
      mediaType: row.media_type
    });
  }

  return entries;
}

async function groupName(groupId, lang) {
  const result = await pool.query('SELECT name FROM groups WHERE group_id = $1', [groupId]);
  return result.rows[0]?.name || t('groups.unnamed', lang);
}

function describeContent(entry, lang) {
  if (!entry.mediaId) return `"${entry.messageBody}"`;
  const label = mediaLabel(entry.mediaType, lang);
  return entry.messageBody ? `${label} + "${entry.messageBody}"` : label;
}

async function describeEntry(entry, lang) {
  const who = entry.groupId
    ? t('queue.toGroup', lang, {
        name: await groupName(entry.groupId, lang), count: entry.recipientCount
      })
    : t('queue.toPerson', lang, {
        who: `${entry.recipientName || entry.recipientPhone}` +
             (entry.recipientName ? ` ${entry.recipientPhone}` : '')
      });

  const waiting = entry.awaiting > 0
    ? (entry.groupId
        ? t('queue.awaitingGroup', lang, { count: entry.awaiting })
        : t('queue.awaitingOne', lang))
    : '';

  return t('queue.entry', lang, {
    who, when: formatWhen(entry.scheduledAt, lang), what: describeContent(entry, lang), waiting
  });
}

export async function runQueueCommand(userId, command) {
  const lang = await getLanguage(userId);
  const entries = await getPendingEntries(userId);
  const numbered = () => Promise.all(
    entries.map(async (e, i) => `${i + 1}. ${await describeEntry(e, lang)}`)
  );

  if (command.action === 'list') {
    if (entries.length === 0) return t('queue.empty', lang);
    const lines = await numbered();
    return t('queue.list', lang, { count: entries.length, lines: lines.join('\n') });
  }

  // Cancelling
  if (entries.length === 0) return t('queue.nothingToCancel', lang);

  if (command.target === null) {
    const lines = await numbered();
    // The list is numbered, so a bare number is the natural answer. Returned
    // as a question the caller can park, rather than plain text.
    return {
      reply: t('queue.whichToCancel', lang, { lines: lines.join('\n') }),
      choice: {
        kind: 'cancel_queue',
        payload: {
          allowDigits: true,
          options: entries.map(e => ({ queueIds: e.queueIds }))
        }
      }
    };
  }

  if (command.target === 'all') {
    const ids = entries.flatMap(e => e.queueIds);
    await cancelIds(userId, ids);
    return t('queue.cancelledAll', lang, { count: entries.length });
  }

  const index = command.target;
  if (index < 1 || index > entries.length) {
    return t('queue.noSuchNumber', lang, { index, count: entries.length });
  }

  const entry = entries[index - 1];
  await cancelIds(userId, entry.queueIds);
  return t('queue.cancelledOne', lang, { entry: await describeEntry(entry, lang) });
}

/**
 * Scoped by user_id as well as id — an index is easy to guess, and cancelling
 * must never reach another tenant's queue.
 */
/**
 * Cancel the entry a number picked out of the list shown a moment ago.
 */
export async function cancelChosenEntry(userId, queueIds) {
  await cancelIds(userId, queueIds);
  return t('queue.cancelled', await getLanguage(userId));
}

async function cancelIds(userId, queueIds) {
  await pool.query(
    `UPDATE active_queue
        SET status = 'cancelled', updated_at = NOW()
      WHERE user_id = $1 AND queue_id = ANY($2::int[])
        AND status IN ('pending', 'awaiting_consent')`,
    [userId, queueIds]
  );
}
