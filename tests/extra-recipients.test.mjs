import test from 'node:test';
import assert from 'node:assert/strict';
import { unusedNumbers } from '../src/scheduling/extraRecipients.js';

const SENDER = '+972507575860';

// The request that prompted this: two people named, one scheduled, nothing
// said about the other.
test('a second recipient in the request is noticed', () => {
  const text = 'Mirit 050-7467974\nCue +972525053164\nHii good night\nAt 22:34';
  assert.deepEqual(
    unusedNumbers(text, ['+972507467974'], SENDER, 'Hii good night'),
    ['+972525053164']
  );
});

test('the recipient actually scheduled to is not reported as left out', () => {
  assert.deepEqual(
    unusedNumbers('send to Danny 0501234567 tomorrow at 9:00', ['+972501234567'], SENDER),
    []
  );
  // Written in local form in the text, international form in the entities.
  assert.deepEqual(
    unusedNumbers('שלח לדני 050-123-4567 מחר', ['+972501234567'], SENDER),
    []
  );
});

// The number is the point of the message, not a recipient. Reporting it would
// be noise; sending to it would be a message to a stranger.
test('a number inside the message body is content, not a recipient', () => {
  assert.deepEqual(
    unusedNumbers(
      'שלח לדני 0501234567 מחר ב-9:00 "תתקשר אליי ל-0509999999"',
      ['+972501234567'], SENDER, 'תתקשר אליי ל-0509999999'
    ),
    []
  );
});

test('the sender is never reported as a recipient they missed', () => {
  assert.deepEqual(unusedNumbers(`remind me at 9 ${SENDER}`, [], SENDER), []);
});

test('times, dates and short numbers are not phone numbers', () => {
  for (const text of [
    'remind me in 2 hours to call back',
    'שלח לדני מחר ב-9:00',
    'send tomorrow at 22:34',
    'meeting on 01/09/2026 at 14:30'
  ]) {
    assert.deepEqual(unusedNumbers(text, [], SENDER), [], text);
  }
});

test('nothing is reported when there is nothing to read', () => {
  assert.deepEqual(unusedNumbers(null, [], SENDER), []);
  assert.deepEqual(unusedNumbers('', [], SENDER), []);
});
