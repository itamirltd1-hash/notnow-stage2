import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveTemplate, templateWarnings } from '../src/meta/templates.js';
import { SUPPORTED_LANGUAGES } from '../src/i18n/messages.js';

const JOBS = ['delivery', 'consent'];

// A missing template is not a wrong language — it is a send that Meta rejects
// and a recipient who gets nothing at all.
test('every job and language resolves to a real template', () => {
  for (const job of JOBS) {
    for (const lang of SUPPORTED_LANGUAGES) {
      const template = resolveTemplate(job, lang);
      assert.ok(template, `${job}/${lang}`);
      assert.ok(template.name, `${job}/${lang} has no name`);
      assert.ok(template.language, `${job}/${lang} has no language code`);
    }
  }
});

test('an unknown job or language still resolves rather than throwing', () => {
  assert.ok(resolveTemplate('nonsense', 'he').name);
  assert.ok(resolveTemplate('consent', 'fr').name);
  assert.ok(resolveTemplate('delivery').name);
});

// A consent request passes either the sender's name or the whole question,
// depending on whether the template asks anything itself. Get it backwards and
// the recipient receives a stranger's name with no question and no way to
// refuse — or the question twice, in two different wordings.
test('every consent template says whether it asks the question itself', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(
      typeof resolveTemplate('consent', lang).carriesTheQuestion, 'boolean', lang
    );
  }
});

test('consent never resolves to a template that asks nothing', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    assert.equal(resolveTemplate('consent', lang).carriesTheQuestion, true, lang);
  }
});

test('every gap is reported in terms of what a recipient would see', () => {
  for (const warning of templateWarnings()) {
    assert.match(warning, /^META_[A-Z_]+ is not set, so /, warning);
  }
});
