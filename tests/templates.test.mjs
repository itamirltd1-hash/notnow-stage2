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

// The delivery template asks nothing, so falling back to it for consent means
// passing the question in. A bare sender name there reads to the recipient as
// a message from a stranger, with no question and no way to refuse.
test('a template that does not ask the question says so', () => {
  for (const lang of SUPPORTED_LANGUAGES) {
    const consent = resolveTemplate('consent', lang);
    const delivery = resolveTemplate('delivery', lang);

    assert.equal(typeof consent.carriesTheQuestion, 'boolean', lang);
    assert.equal(delivery.carriesTheQuestion, false, `delivery/${lang}`);

    // Falling back to the delivery template must never claim otherwise.
    if (consent.name === delivery.name && consent.language === delivery.language) {
      assert.equal(consent.carriesTheQuestion, false, `consent/${lang} fell back but claims to ask`);
    }
  }
});

test('every gap is reported in terms of what a recipient would see', () => {
  for (const warning of templateWarnings()) {
    assert.match(warning, /^META_[A-Z_]+ is not set, so /, warning);
  }
});
