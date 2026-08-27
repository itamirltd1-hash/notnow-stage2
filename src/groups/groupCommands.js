import {
  createGroup, addGroupMember, removeGroupMember,
  getGroupMembers, findGroupsByName, listGroups
} from './groupService.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';
import pool from '../db/pool.js';

// Management commands are matched by pattern rather than sent to the model.
// Scheduling is fuzzy and benefits from a model; management is precise and
// destructive — "מחק מטסטרים דנה" must never remove a different person because
// a parse came back at 0.6 confidence.
const PATTERNS = [
  {
    action: 'create',
    re: /^\s*(?:צור|תצור|תיצור|פתח|תפתח|הוסף)\s+קבוצ(?:ה|ת)\s+(.+?)\s*$/
  },
  {
    action: 'add',
    re: /^\s*(?:הוסף|תוסיף|צרף|תצרף)\s+ל(?:קבוצת\s+)?(\S+)\s+([+\d][\d\-\s()]{6,})\s*(.*?)\s*$/
  },
  {
    action: 'members',
    re: /^\s*(?:מי\s+ב|תראה\s+את\s+)(?:קבוצת\s+)?(.+?)\s*[?？]?\s*$/
  },
  {
    action: 'remove',
    re: /^\s*(?:מחק|תמחק|הסר|תסיר|הוצא)\s+מ(?:קבוצת\s+)?(\S+)\s+(.+?)\s*$/
  }
];

// Tells "meant a group command but got the wording wrong" apart from "meant
// something else". Anchored on a management verb at the start: merely
// mentioning a group is what a scheduling request does too
// ("תשלח לקבוצת צוות מחר"), and that must reach the scheduler untouched.
const LOOKS_LIKE_GROUP_COMMAND =
  /^\s*(?:צור|תצור|תיצור|פתח|תפתח|הוסף|תוסיף|צרף|תצרף|מחק|תמחק|הסר|תסיר|הוצא)\b/;

/**
 * Recognise a group management command. Returns null when the message is
 * something else, so it falls through to the scheduler.
 */
export function parseGroupCommand(text) {
  for (const { action, re } of PATTERNS) {
    const match = text.match(re);
    if (match) {
      return { action, args: match.slice(1) };
    }
  }
  return null;
}

export function looksLikeGroupCommand(text) {
  return LOOKS_LIKE_GROUP_COMMAND.test(text);
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
        return `יש כמה בשם "${b}" ב"${match.name}". ציין מספר טלפון:\n` +
          target.map(m => `• ${m.name} ${m.phone_number}`).join('\n');
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
