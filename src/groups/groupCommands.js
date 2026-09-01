import {
  createGroup, addGroupMember, removeGroupMember,
  getGroupMembers, findGroupsByName, listGroups
} from './groupService.js';
import { normalizePhoneNumber } from '../auth/userContextExtractor.js';
import { formatOptions } from '../meta/pendingChoice.js';
import pool from '../db/pool.js';
import { t } from '../i18n/messages.js';
import { getLanguage } from '../i18n/language.js';

// Management commands are matched by pattern rather than sent to the model.
// Scheduling is fuzzy and benefits from a model; management is precise and
// destructive — "מחק מטסטרים דנה" must never remove a different person because
// a parse came back at 0.6 confidence.
const CREATE = /^\s*(?:צור|תצור|תיצור|פתח|תפתח)\s+קבוצ(?:ה|ת)\s+(.+?)\s*$/;
const CREATE_EN = /^\s*(?:create|make|start|new)\s+(?:a\s+)?(?:new\s+)?group\s+(?:called\s+|named\s+)?(.+?)\s*$/i;
// Read-only, so a loose match costs nothing: at worst it names a group that
// does not exist and falls through. Destructive commands stay strict.
// "מי בטסטרים" and "תוכל להראות לי מי מקבוצת בדיקה?" are the same question.
const MEMBERS_PHRASED =
  /(?:מי|תראה|תראי|הראה|הצג|תציג|רשימת|רשימה)\s.*?קבוצ(?:ת|ה)\s+(.+?)\s*[?？.]?\s*$/;
const MEMBERS_SHORT = /^\s*מי\s+ב(.+?)\s*[?？.]?\s*$/;
const REMOVE = /^\s*(?:מחק|תמחק|הסר|תסיר|הוצא)\s+מ(?:קבוצת\s+)?(\S+)\s+(?:את\s+)?(.+?)\s*$/;

// English says it the other way round — the person first, the group after —
// so these capture (person, group) and parseLine swaps them.
const REMOVE_EN =
  /^\s*(?:remove|delete|drop|take)\s+(.+?)\s+(?:out\s+)?(?:of|from)\s+(?:the\s+)?(?:group\s+)?(\S+)\s*$/i;
const MEMBERS_SHORT_EN = /^\s*who(?:'?s|\s+is|\s+are)?\s+in\s+(?:the\s+)?(.+?)\s*[?？.]?\s*$/i;
// The looser one insists on the word "group", because "show me the queue"
// would otherwise be read as asking who is in a group called "queue".
const MEMBERS_PHRASED_EN =
  /^\s*(?:show|list|members\s+of|who(?:'?s|\s+is|\s+are)?\s+in)\s+(?:me\s+)?(?:the\s+)?group\s+(.+?)\s*[?？.]?\s*$/i;

// "הוסף [לקבוצת X] [את] <the rest>" — the rest holds a phone and a name in
// whichever order the person happened to say them, which is why it is pulled
// apart afterwards rather than by more alternatives here.
const ADD = /^\s*(?:הוסף|תוסיף|צרף|תצרף)\s+(?:ל(?:קבוצת\s+)?(\S+)\s+)?(?:את\s+)?(.+?)\s*$/;

// Three shapes, tried in this order because the first two are more specific
// and the third would swallow them: "add X to Y" ends up as a person called
// "X to Y" if the bare form is tried first.
const ADD_EN_TO_FIRST =
  /^\s*(?:add|put)\s+(?:in)?to\s+(?:the\s+)?(?:group\s+)?(\S+)\s+(.+?)\s*$/i;
const ADD_EN_TO_LAST =
  /^\s*(?:add|put)\s+(.+?)\s+(?:in)?to\s+(?:the\s+)?(?:group\s+)?(\S+)\s*$/i;
const ADD_EN_BARE = /^\s*(?:add|put)\s+(.+?)\s*$/i;
const PHONE_IN_TEXT = /([+\d][\d\-\s()]{6,}\d)/;

// \b is ASCII-only in JavaScript, so it never matches after a Hebrew letter —
// this must use a lookahead for whitespace or end of line instead. The same
// lookahead is used on the English side rather than \b, so both halves of the
// rule read the same way and neither can be copied wrong later.
const MANAGEMENT_VERB =
  /^\s*(?:צור|תצור|תיצור|פתח|תפתח|הוסף|תוסיף|צרף|תצרף|מחק|תמחק|הסר|תסיר|הוצא)(?=\s|$)/;

// The English verbs are ordinary sentence openers — "add a reminder", "make a
// note", "delete the meeting" — so on their own they say nothing. They count
// as management only when the word "group" is actually present. Falling
// through to the model costs one parse; claiming a malformed group command
// costs the sender the message they were writing.
const MANAGEMENT_VERB_EN =
  /^\s*(?:create|make|start|new|add|put|remove|delete|drop|take)(?=\s|$).*\bgroups?\b/i;

function looksLikeManagement(line) {
  return MANAGEMENT_VERB.test(line) || MANAGEMENT_VERB_EN.test(line);
}

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
  const create = line.match(CREATE) || line.match(CREATE_EN);
  if (create) return { action: 'create', args: [create[1]] };

  const remove = line.match(REMOVE);
  if (remove) return { action: 'remove', args: [remove[1], remove[2]] };

  // (person, group) in English, (group, person) in Hebrew.
  const removeEn = line.match(REMOVE_EN);
  if (removeEn) return { action: 'remove', args: [removeEn[2], removeEn[1]] };

  const add = line.match(ADD_EN_TO_FIRST);
  if (add) {
    const contact = splitContact(add[2]);
    if (contact) return { action: 'add', args: [add[1], contact.phone, contact.name] };
  }

  const addLast = line.match(ADD_EN_TO_LAST);
  if (addLast) {
    const contact = splitContact(addLast[1]);
    if (contact) return { action: 'add', args: [addLast[2], contact.phone, contact.name] };
  }

  const addHe = line.match(ADD) || line.match(ADD_EN_BARE);
  if (addHe) {
    // The Hebrew pattern captures the group in group 1 and the rest in 2; the
    // bare English one has only the rest.
    const rest = addHe[2] === undefined ? addHe[1] : addHe[2];
    const group = addHe[2] === undefined ? null : addHe[1];
    const contact = splitContact(rest);
    if (contact) return { action: 'add', args: [group || null, contact.phone, contact.name] };
  }

  const members = line.match(MEMBERS_SHORT) || line.match(MEMBERS_PHRASED)
    || line.match(MEMBERS_PHRASED_EN) || line.match(MEMBERS_SHORT_EN);
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
  return text.split('\n').some(line => looksLikeManagement(line));
}

// "קבוצת <שם>" names one group; the plural on its own means the collection.
// That distinction, rather than a list of phrasings, is what separates
// "תשלח לקבוצת צוות מחר" from "כמה קבוצות יש לי".
const NAMES_A_GROUP = /קבוצ(?:ת|ה)\s+\S/;
const ASKS_ABOUT_GROUPS = /קבוצ/;
const LISTING_WORD =
  /אילו|איזה|איזו|כמה|מה\s|מהן|מהם|יש\s+לי|תראה|תראי|הראה|הצג|תציג|רשימ|כל\s+ה/;

// The same rule in English, where the singular and plural do the separating:
// "group testers" names one, "groups do I have" asks about the collection.
// \bgroup\b does not match inside "groups", which is what makes that work.
const NAMES_A_GROUP_EN = /\bgroup\b\s+\S/i;
const ASKS_ABOUT_GROUPS_EN = /\bgroups?\b/i;
const LISTING_WORD_EN =
  /\b(?:which|what|how\s+many|my|all|list|show|any|do\s+i\s+have)\b/i;

/**
 * Is this a question about which groups exist, rather than about one of them?
 */
export function isGroupsListQuestion(text) {
  const t = text.trim();

  // Bare "קבוצות" / "קבוצה" / "הקבוצות שלי" / "groups" / "my groups".
  if (/^(?:ה)?(?:קבוצות|קבוצה)(?:\s+שלי)?\s*[?？.]?$/.test(t)) return true;
  if (/^(?:my\s+)?groups?\s*[?？.]?$/i.test(t)) return true;

  if (looksLikeManagement(t)) return false;     // creating or changing one

  if (ASKS_ABOUT_GROUPS.test(t)) {
    if (NAMES_A_GROUP.test(t)) return false;    // asking about one group
    return LISTING_WORD.test(t);
  }

  if (ASKS_ABOUT_GROUPS_EN.test(t)) {
    if (NAMES_A_GROUP_EN.test(t)) return false;
    return LISTING_WORD_EN.test(t);
  }

  return false;
}

/**
 * Answer both "which groups" and "how many" in one line, since people ask it
 * either way and both want the same picture.
 */
/**
 * "one person" and "12 people" are different words in both languages, and
 * "1 people" is the sort of thing a reader notices immediately.
 */
function groupSize(n, lang) {
  if (n === 0) return t('group.size.empty', lang);
  return n === 1 ? t('group.size.one', lang) : t('group.size.many', lang, { n });
}

export async function describeGroups(userId) {
  const lang = await getLanguage(userId);
  const groups = await listGroups(userId);

  if (groups.length === 0) return t('group.none', lang);

  const count = groups.length === 1
    ? t('group.count.one', lang)
    : t('group.count.many', lang, { n: groups.length });

  const lines = groups.map(g => t('group.line', lang, {
    name: g.name, members: groupSize(Number(g.member_count), lang)
  }));

  return t('group.list', lang, { count, lines: lines.join('\n') });
}

export function SYNTAX_HELP(lang = 'he') {
  return t('groups.syntax', lang);
}

/**
 * Run a recognised command and return the reply to send back.
 * Every reply names exactly what changed: "בוצע" leaves the sender guessing
 * whether the right person was removed.
 */
export async function runGroupCommand(userId, command) {
  const lang = await getLanguage(userId);

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
      lines.push(t('group.batchUnclear', lang, {
        line: command.incomplete, help: SYNTAX_HELP(lang)
      }));
    }
    return lines.join('\n');
  }

  const [a, b, c] = command.args;

  switch (command.action) {
    case 'create': {
      const group = await createGroup(userId, a);
      return t('group.created', lang, { name: group.name });
    }

    case 'add': {
      const { match } = await findGroupsByName(userId, a);
      if (!match) return t('group.createFirst', lang, { name: a });

      const phone = normalizePhoneNumber(b);
      if (!phone) return t('group.notAPhone', lang, { text: b });

      const name = c || t('contact.fallbackName', lang);
      await addGroupMember(userId, match.group_id, phone, name);
      const members = await getGroupMembers(userId, match.group_id);
      return t('group.memberAdded', lang, {
        name, phone, group: match.name, count: groupSize(members.length, lang)
      });
    }

    case 'members': {
      const { match, candidates } = await findGroupsByName(userId, a);
      if (!match) {
        if (candidates.length > 1) {
          return t('group.similarNames', lang, {
            names: candidates.map(g => `• ${g.name}`).join('\n')
          });
        }
        return null; // probably not a group question at all
      }

      const members = await getGroupMembers(userId, match.group_id);
      if (members.length === 0) return t('group.noMembers', lang, { name: match.name });

      return t('group.memberList', lang, {
        name: match.name,
        count: groupSize(members.length, lang),
        lines: members.map(m => t('group.member', lang, {
          name: m.name,
          phone: m.phone_number,
          status: t(`consent.status.${m.consent_status || 'unknown'}`, lang)
        })).join('\n')
      });
    }

    case 'remove': {
      const { match } = await findGroupsByName(userId, a);
      if (!match) return t('group.seeAll', lang, { name: a });

      const members = await getGroupMembers(userId, match.group_id);
      const phone = normalizePhoneNumber(b);
      const target = members.filter(m =>
        m.phone_number === phone || m.name.toLowerCase() === b.trim().toLowerCase()
      );

      if (target.length === 0) {
        return t('group.memberNotFound', lang, { who: b, group: match.name });
      }

      if (target.length > 1) {
        return {
          reply: t('group.whichMember', lang, {
            who: b, group: match.name,
            options: formatOptions(target, m => `${m.name} ${m.phone_number}`)
          }) + t('choice.replyWithLetter', lang),
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
      return t('group.removedFrom', lang, {
        name: target[0].name, phone: target[0].phone_number, group: match.name
      });
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
