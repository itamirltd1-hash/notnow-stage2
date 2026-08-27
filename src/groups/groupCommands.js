import {
  createGroup, addGroupMember, removeGroupMember,
  getGroupMembers, findGroupsByName, listGroups
} from './groupService.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';
import { formatOptions } from '../meta/pendingChoice.js';
import pool from '../db/pool.js';

// Management commands are matched by pattern rather than sent to the model.
// Scheduling is fuzzy and benefits from a model; management is precise and
// destructive — "מחק מטסטרים דנה" must never remove a different person because
// a parse came back at 0.6 confidence.
const CREATE = /^\s*(?:צור|תצור|תיצור|פתח|תפתח)\s+קבוצ(?:ה|ת)\s+(.+?)\s*$/;
const MEMBERS = /^\s*(?:מי\s+ב|תראה\s+את\s+)(?:קבוצת\s+)?(.+?)\s*[?？]?\s*$/;
const REMOVE = /^\s*(?:מחק|תמחק|הסר|תסיר|הוצא)\s+מ(?:קבוצת\s+)?(\S+)\s+(?:את\s+)?(.+?)\s*$/;

// "הוסף [לקבוצת X] [את] <the rest>" — the rest holds a phone and a name in
// whichever order the person happened to say them, which is why it is pulled
// apart afterwards rather than by more alternatives here.
const ADD = /^\s*(?:הוסף|תוסיף|צרף|תצרף)\s+(?:ל(?:קבוצת\s+)?(\S+)\s+)?(?:את\s+)?(.+?)\s*$/;
const PHONE_IN_TEXT = /([+\d][\d\-\s()]{6,}\d)/;

// \b is ASCII-only in JavaScript, so it never matches after a Hebrew letter —
// this must use a lookahead for whitespace or end of line instead.
const MANAGEMENT_VERB =
  /^\s*(?:צור|תצור|תיצור|פתח|תפתח|הוסף|תוסיף|צרף|תצרף|מחק|תמחק|הסר|תסיר|הוצא)(?=\s|$)/;

/**
 * Split "הוסף" arguments into a phone and a name, in either order.
 */
function splitContact(rest) {
  const phoneMatch = rest.match(PHONE_IN_TEXT);
  if (!phoneMatch) return null;

  const phone = phoneMatch[1].trim();
  const name = rest.replace(phoneMatch[1], ' ').replace(/\s+/g, ' ').trim();
  return { phone, name };
}

function parseLine(line) {
  const create = line.match(CREATE);
  if (create) return { action: 'create', args: [create[1]] };

  const remove = line.match(REMOVE);
  if (remove) return { action: 'remove', args: [remove[1], remove[2]] };

  const add = line.match(ADD);
  if (add) {
    const contact = splitContact(add[2]);
    if (contact) return { action: 'add', args: [add[1] || null, contact.phone, contact.name] };
  }

  const members = line.match(MEMBERS);
  if (members) return { action: 'members', args: [members[1]] };

  return null;
}

/**
 * Recognise group management, one command per line.
 *
 * People add several people in one message and name the group only on the
 * first line ("הוסף לקבוצת בדיקה את חגי 05… / הוסף את מירית 05…"), so a line
 * without a group inherits the one above it.
 */
export function parseGroupCommand(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const commands = [];
  let lastGroup = null;

  for (const line of lines) {
    const parsed = parseLine(line);
    if (!parsed) {
      // One unrecognised line among several is still a failed batch: acting on
      // part of it would silently drop people the sender believes were added.
      return lines.length > 1 && commands.length > 0 ? { action: 'batch', commands, incomplete: line } : null;
    }

    if (parsed.action === 'add') {
      parsed.args[0] = parsed.args[0] || lastGroup;
      if (!parsed.args[0]) return null;
      lastGroup = parsed.args[0];
    } else if (parsed.action === 'create' || parsed.action === 'remove') {
      lastGroup = parsed.args[0];
    }

    commands.push(parsed);
  }

  if (commands.length === 0) return null;
  if (commands.length === 1) return commands[0];
  return { action: 'batch', commands };
}

export function looksLikeGroupCommand(text) {
  return text.split('\n').some(line => MANAGEMENT_VERB.test(line));
}

export const SYNTAX_HELP =
  'פקודות קבוצות:\n' +
  '• צור קבוצה טסטרים\n' +
  '• הוסף לטסטרים 0501111111 דנה\n' +
  '• מי בטסטרים\n' +
  '• מחק מטסטרים דנה\n' +
  '• קבוצות — כל הקבוצות שלך';

/**
 * Run a recognised command and return the reply to send back.
 * Every reply names exactly what changed: "בוצע" leaves the sender guessing
 * whether the right person was removed.
 */
export async function runGroupCommand(userId, command) {
  // Several commands in one message: report every line, so a member that
  // failed to add is visible instead of assumed.
  if (command.action === 'batch') {
    const lines = [];
    for (const single of command.commands) {
      const result = await runGroupCommand(userId, single);
      if (typeof result === 'object' && result?.reply) {
        // A line needing a follow-up question cannot be answered mid-batch.
        lines.push(result.reply.split('\n')[0]);
      } else if (result) {
        lines.push(result.split('\n')[0]);
      }
    }
    if (command.incomplete) {
      lines.push(`\nלא הבנתי את השורה: "${command.incomplete}"\n\n${SYNTAX_HELP}`);
    }
    return lines.join('\n');
  }

  const [a, b, c] = command.args;

  switch (command.action) {
    case 'create': {
      const group = await createGroup(userId, a);
      return `נוצרה קבוצה "${group.name}".\nעכשיו הוסף אליה אנשים:\nהוסף ל${group.name} 0501111111 דנה`;
    }

    case 'add': {
      const { match } = await findGroupsByName(userId, a);
      if (!match) return `אין לי קבוצה בשם "${a}". צור אותה קודם: צור קבוצה ${a}`;

      const phone = normalizePhoneNumber(b);
      if (!phone) return `"${b}" לא נראה כמו מספר טלפון תקין.`;

      const name = c || 'איש קשר';
      await addGroupMember(userId, match.group_id, phone, name);
      const members = await getGroupMembers(userId, match.group_id);
      return `${name} (${phone}) נוסף ל"${match.name}".\nבקבוצה עכשיו ${members.length} אנשים.`;
    }

    case 'members': {
      const { match, candidates } = await findGroupsByName(userId, a);
      if (!match) {
        if (candidates.length > 1) {
          return `יש כמה קבוצות בשם הזה:\n${candidates.map(g => `• ${g.name}`).join('\n')}`;
        }
        return null; // probably not a group question at all
      }

      const members = await getGroupMembers(userId, match.group_id);
      if (members.length === 0) return `הקבוצה "${match.name}" ריקה.`;

      const label = { granted: '✓ אישר', declined: '✗ סירב', requested: '⏳ ממתין', unknown: '– טרם נשאל' };
      return `"${match.name}" — ${members.length} אנשים:\n` +
        members.map(m => `• ${m.name} ${m.phone_number} ${label[m.consent_status] || ''}`).join('\n');
    }

    case 'remove': {
      const { match } = await findGroupsByName(userId, a);
      if (!match) return `אין לי קבוצה בשם "${a}".`;

      const members = await getGroupMembers(userId, match.group_id);
      const phone = normalizePhoneNumber(b);
      const target = members.filter(m =>
        m.phone_number === phone || m.name.toLowerCase() === b.trim().toLowerCase()
      );

      if (target.length === 0) return `לא מצאתי את "${b}" ב"${match.name}".`;

      if (target.length > 1) {
        return {
          reply: `יש כמה בשם "${b}" ב"${match.name}". את מי להסיר?\n` +
            formatOptions(target, m => `${m.name} ${m.phone_number}`) +
            `\n\nהשב באות.`,
          choice: {
            kind: 'remove_member',
            payload: {
              groupId: match.group_id,
              groupName: match.name,
              options: target.map(m => ({
                contact_id: m.contact_id, name: m.name, phone: m.phone_number
              }))
            }
          }
        };
      }

      await removeGroupMember(userId, match.group_id, target[0].contact_id);
      return `${target[0].name} (${target[0].phone_number}) הוסר מ"${match.name}".`;
    }

    default:
      return null;
  }
}

/**
 * Has this number been asked for consent by someone, without answering yet?
 * Such a sender is a recipient mid-conversation, not a new customer, and
 * greeting them with a product tour would be baffling.
 */
export async function isPendingRecipient(phone) {
  const normalized = normalizePhoneNumber(phone);
  const result = await pool.query(
    `SELECT 1 FROM contacts
      WHERE phone_number = $1 AND is_owner = FALSE AND consent_status = 'requested'
      LIMIT 1`,
    [normalized]
  );
  return result.rowCount > 0;
}

export { listGroups };
