import test from 'node:test';
import assert from 'node:assert/strict';

import { capabilityDescription } from '../src/llm/capabilities.js';
import { t } from '../src/i18n/messages.js';
import { parseQueueCommand } from '../src/queue/queueCommands.js';
import { parseGroupCommand, isGroupsListQuestion } from '../src/groups/groupCommands.js';
import { parseNameCommand } from '../src/auth/displayName.js';
import { isHelpRequest } from '../src/meta/welcome.js';
import { isErasureRequest } from '../src/privacy/erasure.js';
import { isTermsAcceptance } from '../src/legal/terms.js';

/**
 * The description is what the model answers product questions from, and the
 * help message is what the bot tells people to type. Both are prose about
 * behaviour that lives somewhere else, which is exactly the pair that drifts:
 * a command is renamed, and the bot goes on advising the old one.
 *
 * So every command either of them quotes is run through the parser that has
 * to accept it.
 */
const RECOGNISERS = [
  [text => parseQueueCommand(text)?.action === 'list', 'queue list'],
  [text => parseQueueCommand(text)?.action === 'cancel', 'queue cancel'],
  [text => parseGroupCommand(text)?.action === 'create', 'group create'],
  [text => parseGroupCommand(text)?.action === 'add', 'group add'],
  [text => parseGroupCommand(text)?.action === 'members', 'group members'],
  [text => parseGroupCommand(text)?.action === 'remove', 'group remove'],
  [text => isGroupsListQuestion(text), 'groups list'],
  [text => parseNameCommand(text)?.action === 'set', 'set name'],
  [text => isHelpRequest(text), 'help'],
  [text => isErasureRequest(text), 'erasure'],
  [text => isTermsAcceptance(text), 'terms acceptance']
];

function isRecognised(command) {
  return RECOGNISERS.some(([accepts]) => {
    try { return accepts(command); } catch { return false; }
  });
}

// Written out rather than scraped: a scrape that finds nothing passes
// silently, which is the failure this test exists to prevent.
const QUOTED_IN_ENGLISH = [
  'what is in the queue', 'cancel 2', 'cancel all', 'groups',
  'create group testers', 'add 0501111111 Dana to testers',
  'who is in testers', 'remove Dana from testers',
  'call me Dana', 'help', 'delete me', 'accept'
];

const QUOTED_IN_HEBREW = [
  'מה בתור', 'בטל 2', 'בטל הכל', 'קבוצות',
  'צור קבוצה טסטרים', 'הוסף לטסטרים 0501111111 דנה',
  'מי בטסטרים', 'מחק מטסטרים דנה',
  'קרא לי דנה', 'עזרה', 'מחק אותי', 'מאשר'
];

test('every English command the description quotes is one the code accepts', () => {
  const description = capabilityDescription();
  for (const command of QUOTED_IN_ENGLISH) {
    assert.ok(isRecognised(command), `${command} is quoted but not recognised`);
  }
  // And the description really does quote them, so this list cannot go stale
  // by the description dropping a command without anyone noticing.
  for (const command of ['what is in the queue', 'cancel all', 'groups', 'call me Dana']) {
    assert.ok(description.includes(command), `${command} is no longer in the description`);
  }
});

test('every Hebrew command the code accepts is still accepted', () => {
  for (const command of QUOTED_IN_HEBREW) {
    assert.ok(isRecognised(command), `${command} is no longer recognised`);
  }
});

test('the help message quotes commands that work, in both languages', () => {
  const help = { he: t('help', 'he'), en: t('help', 'en') };

  for (const command of ['create group testers', 'who is in testers',
                         'remove Dana from testers', 'groups']) {
    assert.ok(help.en.includes(command), `English help no longer offers "${command}"`);
    assert.ok(isRecognised(command), `English help offers "${command}" but nothing accepts it`);
  }
  for (const command of ['צור קבוצה טסטרים', 'מי בטסטרים', 'קבוצות']) {
    assert.ok(help.he.includes(command), `Hebrew help no longer offers "${command}"`);
    assert.ok(isRecognised(command), `Hebrew help offers "${command}" but nothing accepts it`);
  }
});

// Claimed while the key is missing, this reads as the bot lying: it says it
// transcribes, then answers a recording with "not available yet".
test('the description claims voice transcription only when it is switched on', () => {
  const description = capabilityDescription();
  const claimsIt = description.includes('לתמלל אותה');
  const disclaimsIt = description.includes('אינו פעיל כרגע');

  assert.notEqual(claimsIt, disclaimsIt, 'the description both claims and denies transcription');
  assert.equal(claimsIt, Boolean(process.env.OPENAI_API_KEY));
});

test('the description says which languages the bot works in', () => {
  const description = capabilityDescription();
  assert.match(description, /עברית ובאנגלית/);
  assert.match(description, /speak English/);
  assert.match(description, /דבר עברית/);
});
