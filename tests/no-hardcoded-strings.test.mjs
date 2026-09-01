import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEBREW = /[֐-׿]/;

/**
 * Files whose every outgoing message has been moved into the catalogue.
 *
 * A string written inline is not wrong because inline is wrong — it is wrong
 * because nothing can tell you the other language is missing. This list is the
 * record of which files that is already true for, and it only grows.
 */
const CONVERTED = [
  'src/routes/meta.js',
  'src/meta/consent.js',
  'src/meta/welcome.js',
  'src/dispatcher/batchDispatcher.js',
  'src/privacy/erasure.js',
  'src/queue/queueCommands.js',
  'src/billing/quotaCommands.js',
  'src/legal/terms.js',
  'src/auth/displayName.js'
];

// Comments explain the Hebrew the code handles; they are not sent to anyone.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

for (const file of CONVERTED) {
  test(`${file} sends no Hebrew that is not in the catalogue`, () => {
    const source = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));

    // Sent directly, or returned to a caller that will send it. Both are a
    // reply; only the last hop differs.
    const offenders = source
      .split('\n')
      .map((line, i) => [i + 1, line.trim()])
      .filter(([, line]) =>
        /sendWhatsAppMessage\(|sendTemplateMessage\(/.test(line)
        || /^return |^\? |^: |reply: /.test(line))
      .filter(([, line]) => HEBREW.test(line));

    assert.deepEqual(
      offenders, [],
      `${file}: a reply is built from a literal instead of t()`
    );
  });
}

// The regexes that read Hebrew input are a different thing entirely and must
// stay: this guards the reply side only.
test('the catalogue is where the replies live', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/i18n/messages.js'), 'utf8');
  assert.ok(HEBREW.test(source), 'messages.js should hold the Hebrew');
  assert.ok(source.includes("'welcome'"), 'the welcome message should be catalogued');
  assert.ok(source.includes("'help'"), 'the help message should be catalogued');
});
