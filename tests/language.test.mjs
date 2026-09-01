import test from 'node:test';
import assert from 'node:assert/strict';

import { parseLanguageCommand, detectInitialLanguage } from '../src/i18n/language.js';
import { t, missingTranslations, SUPPORTED_LANGUAGES } from '../src/i18n/messages.js';

const SPANISH = { he: 'ספרדית', en: 'Spanish' };

test('recognises a request to switch to English, in either language', () => {
  for (const text of [
    'speak English', 'Speak english', 'English', 'english please', 'in English',
    'switch to English', 'talk to me in english', 'can you answer in English?',
    'דבר אנגלית', 'תדבר אנגלית', 'באנגלית', 'אנגלית', 'תענה באנגלית',
    'עבור לאנגלית', 'אנגלית בבקשה'
  ]) {
    assert.deepEqual(parseLanguageCommand(text), { language: 'en' }, text);
  }
});

test('recognises a request to switch to Hebrew, in either language', () => {
  for (const text of [
    'דבר עברית', 'תדבר עברית', 'תדברי עברית', 'עברית', 'בעברית',
    'עברית בבקשה', 'תענה בעברית', 'speak Hebrew', 'hebrew', 'switch to hebrew'
  ]) {
    assert.deepEqual(parseLanguageCommand(text), { language: 'he' }, text);
  }
});

test('names the language it cannot speak, rather than ignoring the request', () => {
  assert.deepEqual(parseLanguageCommand('דבר ספרדית'), { unsupported: SPANISH });
  assert.deepEqual(parseLanguageCommand('hablas español?'), { unsupported: SPANISH });
  assert.deepEqual(parseLanguageCommand('speak Russian'),
    { unsupported: { he: 'רוסית', en: 'Russian' } });
  assert.deepEqual(parseLanguageCommand('תדבר ערבית'),
    { unsupported: { he: 'ערבית', en: 'Arabic' } });
});

// The expensive failure: a language name inside a message being scheduled
// silently switching the interface instead of being sent.
test('a language named inside a scheduling request is not a command', () => {
  for (const text of [
    'שלח לדני 0501234567 מחר ב-9 "תדבר איתי באנגלית"',
    'send to Dan tomorrow "speak English"',
    'תזכיר לי מחר שיעור ספרדית',
    'שלח לדנה מחר "עברית זה קשה"',
    'תזכיר לי לתרגם לאנגלית',
    'תזמן לרונית מחר ב-10 שיעור אנגלית'
  ]) {
    assert.equal(parseLanguageCommand(text), null, text);
  }
});

test('ordinary commands are left alone', () => {
  for (const text of [
    'מה בתור', 'שלום', 'צור קבוצה אנגלית', 'כמה הודעות נשארו לי',
    'איך אני מבטל הודעה', 'מה שלומך', 'בטל 2', 'עזרה'
  ]) {
    assert.equal(parseLanguageCommand(text), null, text);
  }
});

test('the first message decides the language, and ambiguity means Hebrew', () => {
  assert.equal(detectInitialLanguage('שלום'), 'he');
  assert.equal(detectInitialLanguage('hi'), 'en');
  assert.equal(detectInitialLanguage('Hello there'), 'en');
  assert.equal(detectInitialLanguage('send tomorrow שלום'), 'he');
  assert.equal(detectInitialLanguage('123'), 'he');
  assert.equal(detectInitialLanguage('👍'), 'he');
  assert.equal(detectInitialLanguage(''), 'he');
  assert.equal(detectInitialLanguage(null), 'he');
});

// The whole reason the strings live in one catalogue.
test('every string exists in every supported language', () => {
  assert.deepEqual(missingTranslations(), []);
});

test('t() interpolates, falls back, and never throws', () => {
  assert.equal(
    t('language.unsupported', 'he', { language: 'ספרדית' }),
    'אני עובד בעברית ובאנגלית בלבד. ספרדית עדיין לא נתמכת.'
  );
  assert.equal(t('language.switched', 'fr'), 'מעכשיו אני עונה בעברית.');
  assert.equal(t('nope.nope', 'he'), 'nope.nope');
  assert.equal(t('language.unsupported', 'en'), 'I work in Hebrew and English only. {language} is not supported yet.');
});

// A user whose language was guessed wrong cannot read a hint written in it.
test('the language hint names the escape route in the other language', () => {
  assert.match(t('language.hint', 'he'), /speak English/);
  assert.match(t('language.hint', 'en'), /דבר עברית/);
});

test('supported languages are exactly Hebrew and English', () => {
  assert.deepEqual(SUPPORTED_LANGUAGES, ['he', 'en']);
});
