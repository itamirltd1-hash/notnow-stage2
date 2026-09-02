import test from 'node:test';
import assert from 'node:assert/strict';

import { parseQueueCommand } from '../src/queue/queueCommands.js';
import { isErasureRequest } from '../src/privacy/erasure.js';
import { isAbandonment } from '../src/scheduling/pendingRequest.js';
import { parseNameCommand } from '../src/auth/displayName.js';
import { isQuotaQuestion } from '../src/billing/quotaCommands.js';
import { isGreeting, isHelpRequest, isCourtesy } from '../src/meta/welcome.js';
import { isTermsAcceptance } from '../src/legal/terms.js';

/**
 * Every command has to answer to both languages.
 *
 * The negative cases matter more than the positive ones here. A pattern that
 * fails to match is a command that quietly does nothing; a pattern that
 * matches too much swallows a message someone meant to send. The second is
 * worse, and it is the one a list of happy-path examples never catches — an
 * earlier version of looksLikeGroupCommand matched nothing at all and its
 * tests passed, because they only checked things that should not match.
 */

test('the queue is listed in either language', () => {
  for (const text of [
    'מה בתור', 'בתור', 'רשימה', 'מה מתוזמן',
    'queue', 'the queue', "what's in the queue", 'what is in the queue',
    "what's scheduled", 'scheduled', 'pending', 'list', 'What Is Pending?'
  ]) {
    assert.deepEqual(parseQueueCommand(text), { action: 'list' }, text);
  }
});

test('a queued message is cancelled by number in either language', () => {
  assert.deepEqual(parseQueueCommand('בטל 2'), { action: 'cancel', target: 2 });
  assert.deepEqual(parseQueueCommand('cancel 2'), { action: 'cancel', target: 2 });
  assert.deepEqual(parseQueueCommand('delete 3'), { action: 'cancel', target: 3 });
  assert.deepEqual(parseQueueCommand('בטל הכל'), { action: 'cancel', target: 'all' });
  assert.deepEqual(parseQueueCommand('cancel all'), { action: 'cancel', target: 'all' });
  assert.deepEqual(parseQueueCommand('cancel everything'), { action: 'cancel', target: 'all' });
  assert.deepEqual(parseQueueCommand('cancel'), { action: 'cancel', target: null });
});

test('a message being scheduled is never read as a queue command', () => {
  for (const text of [
    'שלח לדני מחר "בטל את הפגישה"',
    'send to Dan tomorrow "cancel the meeting"',
    'remind me to cancel the subscription',
    'תזכיר לי לבטל את החדר'
  ]) {
    assert.equal(parseQueueCommand(text), null, text);
  }
});

// Being forgotten and being left alone are different requests, and only one
// of them is reversible.
test('erasure is asked for in either language', () => {
  for (const text of [
    'מחק אותי', 'תמחק את המידע שלי', 'מחק את כל הפרטים שלי',
    'delete me', 'Delete my data', 'erase me', 'forget me',
    'forget about me', 'remove my account', 'delete my information'
  ]) {
    assert.equal(isErasureRequest(text), true, text);
  }
});

test('an opt-out is not an erasure request', () => {
  // These belong to consent, which runs immediately after and handles them.
  for (const text of ['stop', 'remove', 'unsubscribe', 'הסר', 'לא', 'no']) {
    assert.equal(isErasureRequest(text), false, text);
  }
});

test('a half-finished request is abandoned in either language', () => {
  for (const text of [
    'לא משנה', 'עזוב', 'שכח מזה', 'בטל את זה',
    'never mind', 'nevermind', 'forget it', 'drop it', 'leave it'
  ]) {
    assert.equal(isAbandonment(text), true, text);
  }
});

// The queue command matches "cancel" first, so listing it in ABANDON as well
// would be a dead alternative — the kind that reads as working and is not.
test('a bare cancel belongs to the queue, in both languages', () => {
  assert.deepEqual(parseQueueCommand('cancel'), { action: 'cancel', target: null });
  assert.deepEqual(parseQueueCommand('בטל'), { action: 'cancel', target: null });
});

test('the display name is set and read in either language', () => {
  assert.deepEqual(parseNameCommand('קרא לי דנה'), { action: 'set', name: 'דנה' });
  assert.deepEqual(parseNameCommand('call me Dana'), { action: 'set', name: 'Dana' });
  assert.deepEqual(parseNameCommand('My name is Dana'), { action: 'set', name: 'Dana' });
  assert.deepEqual(parseNameCommand('שנה את השם שלי לדנה'), { action: 'set', name: 'דנה' });
  assert.deepEqual(parseNameCommand('change my name to Dana'), { action: 'set', name: 'Dana' });
  assert.deepEqual(parseNameCommand('set my name to Dana'), { action: 'set', name: 'Dana' });

  assert.deepEqual(parseNameCommand('מה השם שלי'), { action: 'get' });
  assert.deepEqual(parseNameCommand("what's my name"), { action: 'get' });
  assert.deepEqual(parseNameCommand('what is my name?'), { action: 'get' });
});

test('the quota is asked about in either language', () => {
  for (const text of [
    'כמה הודעות נשארו לי', 'מה המצב עם החבילה', 'מכסה', 'יתרה',
    'how many messages do i have left', 'how many are left',
    'how many messages remaining', 'balance', 'usage', 'my plan', 'quota'
  ]) {
    assert.equal(isQuotaQuestion(text), true, text);
  }
});

// This pattern matches inside a sentence, so a common English noun in a
// message being scheduled must not trigger it.
test('a scheduled message mentioning a balance is not a quota question', () => {
  for (const text of [
    'send to Dan tomorrow "check the balance"',
    'remind me to check my plan for the trip',
    'תזכיר לי לבדוק את היתרה בבנק'
  ]) {
    assert.equal(isQuotaQuestion(text), false, text);
  }
});

test('greetings, help and courtesy answer to both languages', () => {
  for (const text of ['שלום', 'היי', 'hi', 'hello', 'hey there', 'Good morning']) {
    assert.equal(isGreeting(text), true, text);
  }
  for (const text of ['עזרה', 'פקודות', 'help', 'commands', 'what can you do', '?']) {
    assert.equal(isHelpRequest(text), true, text);
  }
  for (const text of ['תודה', 'מעולה', 'thanks', 'thank you', 'cheers', 'cool', 'perfect']) {
    assert.equal(isCourtesy(text), true, text);
  }
});

test('terms are accepted in either language', () => {
  for (const text of ['מאשר', 'אני מאשרת', 'מסכים', 'accept', 'agree']) {
    assert.equal(isTermsAcceptance(text), true, text);
  }
});

// ── Groups ────────────────────────────────────────────────────────────────
import {
  parseGroupCommand, looksLikeGroupCommand, isGroupsListQuestion
} from '../src/groups/groupCommands.js';

test('a group is created in either language', () => {
  for (const text of ['צור קבוצה טסטרים', 'create group testers',
                      'make a new group called testers', 'start a group testers']) {
    assert.deepEqual(parseGroupCommand(text).action, 'create', text);
  }
});

// English says the person first and the group last; Hebrew says it the other
// way round. Both have to end up as the same command.
test('a member is added in either language and either word order', () => {
  const expected = { action: 'add', args: ['testers', '0501111111', 'Dana'] };
  assert.deepEqual(parseGroupCommand('add to testers 0501111111 Dana'), expected);
  assert.deepEqual(parseGroupCommand('add Dana 0501111111 to testers'), expected);
  assert.deepEqual(parseGroupCommand('put 0501111111 Dana into testers'), expected);
  assert.deepEqual(
    parseGroupCommand('הוסף לטסטרים 0501111111 דנה'),
    { action: 'add', args: ['טסטרים', '0501111111', 'דנה'] }
  );
});

test('a member is removed in either language and either word order', () => {
  const expected = { action: 'remove', args: ['testers', 'Dana'] };
  assert.deepEqual(parseGroupCommand('remove Dana from testers'), expected);
  assert.deepEqual(parseGroupCommand('delete Dana from the group testers'), expected);
  assert.deepEqual(
    parseGroupCommand('מחק מטסטרים דנה'),
    { action: 'remove', args: ['טסטרים', 'דנה'] }
  );
});

test('members are listed in either language', () => {
  for (const text of ['who is in testers', "who's in testers",
                      'show me the group testers', 'members of the group testers']) {
    assert.deepEqual(parseGroupCommand(text), { action: 'members', args: ['testers'] }, text);
  }
  assert.deepEqual(parseGroupCommand('מי בטסטרים'), { action: 'members', args: ['טסטרים'] });
});

// One line names the group and the rest inherit it — people write the list
// that way, and dropping the inheritance silently loses everyone after line 1.
test('a group named on the first line carries to the rest', () => {
  const batch = parseGroupCommand(
    'add to testers 0501111111 Dana\nadd 0502222222 Roni\nadd Yossi 0503333333'
  );
  assert.equal(batch.action, 'batch');
  assert.deepEqual(batch.commands.map(c => c.args[0]), ['testers', 'testers', 'testers']);
});

test('which groups exist is asked in either language', () => {
  for (const text of ['קבוצות', 'כמה קבוצות יש לי', 'אילו קבוצות יש לי',
                      'groups', 'my groups', 'how many groups do i have',
                      'which groups do i have', 'show my groups']) {
    assert.equal(isGroupsListQuestion(text), true, text);
  }
});

test('naming one group is not asking which groups exist', () => {
  for (const text of ['תשלח לקבוצת צוות מחר', 'send to the group testers tomorrow',
                      'create group testers', 'צור קבוצה טסטרים']) {
    assert.equal(isGroupsListQuestion(text), false, text);
  }
});

// The English verbs are ordinary sentence openers. Treating a bare "add" as a
// malformed group command would answer a scheduling request with group syntax.
test('an English sentence that merely starts with a verb is not a group command', () => {
  for (const text of ['add a reminder for tomorrow', 'make a note',
                      'delete the meeting', 'put the kettle on']) {
    assert.equal(looksLikeGroupCommand(text), false, text);
  }
  assert.equal(looksLikeGroupCommand('add Dana to the group testers'), true);
  assert.equal(looksLikeGroupCommand('הוסף משהו'), true);
});

// ── Ambiguous hours ───────────────────────────────────────────────────────
import { detectAmbiguousHour } from '../src/scheduling/ambiguousHour.js';

test('a bare hour is ambiguous in either language', () => {
  for (const text of ['שלח לדני מחר ב-8', 'send to Dan tomorrow at 8',
                      'at 8:30', "at 8 o'clock", '@8']) {
    assert.ok(detectAmbiguousHour(text), text);
  }
  assert.deepEqual(detectAmbiguousHour('send to Dan tomorrow at 8'),
    { hour: 8, minutes: 0, morning: 8, evening: 20 });
});

test('an hour that says which half of the day is not asked about', () => {
  for (const text of [
    'מחר ב-8 בבוקר', 'tomorrow at 8 in the morning', 'tomorrow at 8pm',
    'tonight at 8', 'tomorrow morning at 8', 'tomorrow at 22:34',
    'send at 12', 'remind me in 2 hours', 'at noon'
  ]) {
    assert.equal(detectAmbiguousHour(text), null, text);
  }
});

// A time inside the message is one the sender is telling someone else about.
// Reading it as the schedule sends the message twelve hours from where they
// meant, or asks about an hour they never mentioned.
test('a time inside the message body is not the schedule', () => {
  assert.deepEqual(
    detectAmbiguousHour('שלח לדני מחר ב-9 "נתראה ב-8"'),
    { hour: 9, minutes: 0, morning: 9, evening: 21 }
  );
  assert.deepEqual(
    detectAmbiguousHour('send to Dan "meet me at 8" tomorrow at 9'),
    { hour: 9, minutes: 0, morning: 9, evening: 21 }
  );
  // "good morning" is the message; it does not mean the send is in the morning.
  assert.ok(detectAmbiguousHour('send "good morning" tomorrow at 8'));
});

// ── The questions people ask ──────────────────────────────────────────────
import { answerServiceQuestion } from '../src/meta/faq.js';

test('the same question is answered in whichever language it was asked', () => {
  const pairs = [
    ['איך עובד מנגנון ההסכמה', 'how does consent work'],
    ['למה ההודעה עדיין ממתינה', 'why is my message still waiting'],
    ['מה זה קבוצה, זה צאט קבוצתי?', 'is a group a whatsapp group chat'],
    ['איך אני מבטל הודעה', 'how can i cancel a scheduled message'],
    ['האם הנמען יראה שזה בוט', 'will the recipient know it is automated']
  ];

  for (const [he, en] of pairs) {
    const hebrew = answerServiceQuestion(he, 'he');
    const english = answerServiceQuestion(en, 'en');
    assert.ok(hebrew, he);
    assert.ok(english, en);
    assert.doesNotMatch(english, /[֐-׿]/, en);
  }
});

test('an ordinary request is not mistaken for a question about the service', () => {
  for (const text of [
    'שלח לדני 0501234567 מחר ב-9:00 "נתראה"',
    'send to Danny 0501234567 tomorrow at 9:00 "see you"',
    'תודה'
  ]) {
    assert.equal(answerServiceQuestion(text, 'he'), null, text);
  }
});

// ── Short input ───────────────────────────────────────────────────────────
import { isAcknowledgement, looksLikeNoise } from '../src/meta/welcome.js';

// "ok" is not "thanks", and neither is a question. Lumping them together
// answers half the cases wrong.
test('an acknowledgement is told apart from thanks and from noise', () => {
  for (const text of ['ok', 'OK', 'okay', 'k', 'כן', 'אוקיי', 'בסדר',
                      'הבנתי', 'sure', 'got it', 'noted', 'yeah']) {
    assert.equal(isAcknowledgement(text), true, text);
    assert.equal(isCourtesy(text), false, `${text} is not thanks`);
  }
  for (const text of ['תודה', 'thanks', 'perfect', '👍']) {
    assert.equal(isCourtesy(text), true, text);
  }
});

test('noise is a bare digit, a lone letter or punctuation', () => {
  for (const text of ['1', '2', '12', '1234', '.', '..', '??', '!', 'א', 'a', '', '   ']) {
    assert.equal(looksLikeNoise(text), true, JSON.stringify(text));
  }
});

// The damage is asymmetric: a guard that misses costs one model call, a guard
// that swallows costs the sender their request. So it errs towards missing.
test('anything that could mean something is not noise', () => {
  for (const text of [
    'מחר', 'בוא', 'דני', 'אא', 'היי', 'yes', 'now',
    '0501234567', '+972501234567', '09:00', 'שלח לדני מחר'
  ]) {
    assert.equal(looksLikeNoise(text), false, text);
  }
});

// Emoji are how people acknowledge things in WhatsApp. They match the noise
// shape, so courtesy has to catch them first — which is where they sit in the
// handler chain.
test('a bare emoji is courtesy, and courtesy is checked before the guard', () => {
  for (const emoji of ['👍', '🙏', '❤️', '😊', '👏', '✅']) {
    assert.equal(isCourtesy(emoji), true, emoji);
  }
});

// ── Group commands take either word order ─────────────────────────────────
//
// Hebrew allows both as naturally as English does: "הסר מצוות דנה" and
// "הסר את דנה מצוות" are the same sentence. Only one was accepted, so the
// phrasing that mirrors the English order fell through to the scheduler and
// was answered as though it were a request to send something.

const GROUP = 'צוות';

test('a member is added in either Hebrew word order', () => {
  const expected = { action: 'add', args: [GROUP, '0501111111', 'דנה'] };
  for (const text of [
    'הוסף לצוות 0501111111 דנה',
    'הוסף לקבוצת צוות את דנה 0501111111',
    'הוסף את דנה 0501111111 לצוות',
    'תוסיף את דנה 0501111111 לקבוצת צוות',
    'צרף את דנה 0501111111 לצוות'
  ]) {
    assert.deepEqual(parseGroupCommand(text), expected, text);
  }
});

test('a member is removed in either Hebrew word order', () => {
  const expected = { action: 'remove', args: [GROUP, 'דנה'] };
  for (const text of [
    'מחק מצוות דנה',
    'הסר מקבוצת צוות דנה',
    'תסיר את דנה מצוות',
    'תסיר את דנה מקבוצת צוות',
    'תוציא את דנה מצוות',
    'הסר את דנה מהקבוצה צוות'
  ]) {
    assert.deepEqual(parseGroupCommand(text), expected, text);
  }
});

test('the same in English, both ways round', () => {
  const add = { action: 'add', args: ['Team', '0501111111', 'Dana'] };
  for (const text of [
    'add to Team 0501111111 Dana',
    'add Dana 0501111111 to Team',
    'add Dana 0501111111 to the group Team',
    'put Dana 0501111111 in Team'
  ]) {
    assert.deepEqual(parseGroupCommand(text), add, text);
  }

  const remove = { action: 'remove', args: ['Team', 'Dana'] };
  for (const text of [
    'remove Dana from Team',
    'delete Dana from the group Team',
    'take Dana out of Team'
  ]) {
    assert.deepEqual(parseGroupCommand(text), remove, text);
  }
});

test('a group is created however the sentence is phrased', () => {
  for (const text of [
    'צור קבוצה צוות', 'צור לי קבוצה צוות', 'תפתח קבוצה בשם צוות',
    'פתח קבוצה חדשה צוות'
  ]) {
    assert.deepEqual(parseGroupCommand(text), { action: 'create', args: [GROUP] }, text);
  }
  for (const text of [
    'create group Team', 'make a group Team', 'open a new group Team',
    'create a group called Team'
  ]) {
    assert.deepEqual(parseGroupCommand(text), { action: 'create', args: ['Team'] }, text);
  }
});

// "מי בקבוצת צוות" was capturing "קבוצת צוות" and looking a group up by that
// whole string, which matches nothing — so the question fell through to the
// scheduler. The construct-state word has to come off the name.
test('the word "group" is not part of the group name', () => {
  for (const text of [
    'מי בצוות', 'מי בקבוצת צוות', 'מי חבר בקבוצה צוות', 'מי נמצא בצוות'
  ]) {
    assert.deepEqual(parseGroupCommand(text), { action: 'members', args: [GROUP] }, text);
  }
});

// The forward pattern's group is optional, so without the reversed one first
// it reads the whole tail as a name and adds "דנה לצוות" to whichever group
// the previous line named.
test('the reversed order is matched before the one with an optional group', () => {
  const batch = parseGroupCommand(
    'הוסף לצוות 0501111111 דנה\nהוסף את רוני 0502222222 לצוות'
  );
  assert.equal(batch.action, 'batch');
  assert.deepEqual(batch.commands.map(c => c.args[2]), ['דנה', 'רוני']);
  assert.deepEqual(batch.commands.map(c => c.args[0]), [GROUP, GROUP]);
});
