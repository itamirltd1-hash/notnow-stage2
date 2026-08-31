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
// Read-only, so a loose match costs nothing: at worst it names a group that
// does not exist and falls through. Destructive commands stay strict.
// "מי בטסטרים" and "תוכל להראות לי מי מקבוצת בדיקה?" are the same question.
const MEMBERS_PHRASED =
  /(?:מי|תראה|תראי|הראה|הצג|תציג|רשימת|רשימה)\s.*?קבוצ(?:ת|ה)\s+(.+?)\s*[?？.]?\s*$/;
const MEMBERS_SHORT = /^\s*מי\s+ב(.+?)\s*[?？.]?\s*$/;
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

  const members = line.match(MEMBERS_SHORT) || line.match(MEMBERS_PHRASED);
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

// "קבוצת <שם>" names one group; the plural on its own means the collection.
// That distinction, rather than a list of phrasings, is what separates
// "תשלח לקבוצת צוות מחר" from "כמה קבוצות יש לי".
const NAMES_A_GROUP = /קבוצ(?:ת|ה)\s+\S/;
const ASKS_ABOUT_GROUPS = /קבוצ/;
const LISTING_WORD =
  /אילו|איזה|איזו|כמה|מה\s|מהן|מהם|יש\s+לי|תראה|תראי|הראה|הצג|תציג|רשימ|כל\s+ה/;

/**
 * Is this a question about which groups exist, rather than about one of them?
 */
export function isGroupsListQuestion(text) {
  const t = text.trim();

  // Bare "קבוצות" / "קבוצה" / "הקבוצות שלי".
  if (/^(?:ה)?(?:קבוצות|קבוצה)(?:\s+שלי)?\s*[?？.]?$/.test(t)) return true;
  if (/^groups\s*[?？.]?$/i.test(t)) return true;

  if (!ASKS_ABOUT_GROUPS.test(t)) return false;
  if (NAMES_A_GROUP.test(t)) return false;      // asking about one group
  if (MANAGEMENT_VERB.test(t)) return false;    // creating or changing one

  return LISTING_WORD.test(t);
}

/**
 * Answer both "which groups" and "how many" in one line, since people ask it
 * either way and both want the same picture.
 */
export async function describeGroups(userId) {
  const groups = await listGroups(userId);

  if (groups.length === 0) {
    return 'אין לך קבוצות שמורות. ליצירה: צור קבוצה טסטרים';
  }

  const count = groups.length === 1 ? 'קבוצה אחת' : `${groups.length} קבוצות`;
  const lines = groups.map(g => {
    const n = Number(g.member_count);
    const members = n === 0 ? 'ריקה' : n === 1 ? 'איש אחד' : `${n} אנשים`;
    return `• ${g.name} — ${members}`;
  });

  return `יש לך ${count}:\n${lines.join('\n')}`;
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
      return `הקבוצה "${group.name}" נוצרה.\n\nאפשר להוסיף אליה אנשים כך:\nהוסף ל${group.name} 0501111111 דנה`;
    }

    case 'add': {
      const { match } = await findGroupsByName(userId, a);
      if (!match) return `אין לי קבוצה בשם "${a}". אפשר ליצור אותה קודם:\nצור קבוצה ${a}`;

      const phone = normalizePhoneNumber(b);
      if (!phone) return `"${b}" לא נראה לי כמו מספר טלפון. אפשר לכתוב אותו שוב?`;

      const name = c || 'איש קשר';
      await addGroupMember(userId, match.group_id, phone, name);
      const members = await getGroupMembers(userId, match.group_id);
      return `הוספתי את ${name} ${phone} לקבוצה "${match.name}". יש בה עכשיו ${members.length}.`;
    }

    case 'members': {
      const { match, candidates } = await findGroupsByName(userId, a);
      if (!match) {
        if (candidates.length > 1) {
          return `יש לי כמה קבוצות בשם דומה:\n${candidates.map(g => `• ${g.name}`).join('\n')}`;
        }
        return null; // probably not a group question at all
      }

      const members = await getGroupMembers(userId, match.group_id);
      if (members.length === 0) return `אין עדיין אף אחד בקבוצה "${match.name}".`;

      const label = {
        granted: 'מאושר', declined: 'סורב',
        requested: 'ממתין לאישור', unknown: 'טרם נשלחה בקשה'
      };
      return `בקבוצה "${match.name}" יש ${members.length}:\n` +
        members.map(m => `• ${m.name} ${m.phone_number} — ${label[m.consent_status] || ''}`).join('\n');
    }

    case 'remove': {
      const { match } = await findGroupsByName(userId, a);
      if (!match) return `אין לי קבוצה בשם "${a}". אפשר לראות את כולן עם "קבוצות".`;

      const members = await getGroupMembers(userId, match.group_id);
      const phone = normalizePhoneNumber(b);
      const target = members.filter(m =>
        m.phone_number === phone || m.name.toLowerCase() === b.trim().toLowerCase()
      );

      if (target.length === 0) return `לא מצאתי את "${b}" בקבוצה "${match.name}".`;

      if (target.length > 1) {
        return {
          reply: `יש כמה אנשים בשם "${b}" בקבוצה "${match.name}". את מי להסיר?\n` +
            formatOptions(target, m => `${m.name} ${m.phone_number}`) +
            `\n\nלהשיב באות.`,
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
      return `הסרתי את ${target[0].name} ${target[0].phone_number} מהקבוצה "${match.name}".`;
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

/**
 * Someone who receives messages through this service on another person's
 * behalf, whatever they answered.
 *
 * They arrived because a friend scheduled something, not because they came
 * looking for a scheduling product — so an unrecognised reply from them
 * should not be answered with a tour of features they never asked about.
 */
export async function isKnownRecipient(phone) {
  const normalized = normalizePhoneNumber(phone);
  const result = await pool.query(
    `SELECT 1 FROM contacts
      WHERE phone_number = $1 AND is_owner = FALSE
        AND consent_status IN ('requested', 'granted', 'declined')
      LIMIT 1`,
    [normalized]
  );
  return result.rowCount > 0;
}

export { listGroups };
