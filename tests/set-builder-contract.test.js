'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

test('student AI generator consumes the shared API items contract', () => {
  const student = read('student.js');
  const endpoint = read('api/generate-questions.js');

  assert.match(endpoint, /items\s*\n?\s*}\);/);
  assert.match(student, /Array\.isArray\(data\.items\) \? data\.items/);
  assert.match(student, /source:\s*'generated'/);
});

test('student and teacher builders expose explicit bank and AI source states', () => {
  for (const file of ['student.html', 'teacher.html']) {
    const html = read(file);
    assert.match(html, /data-builder-source="bank"/);
    assert.match(html, /data-builder-source="ai"/);
    assert.match(html, /QUESTION BANK • CURATED/);
    assert.match(html, /AI GENERATED • REVIEW REQUIRED/);
    assert.match(html, /set-builder-source\.js/);
  }
});

test('source summary treats unlabeled legacy questions as Question Bank items', () => {
  const sourceUi = require(path.join(ROOT, 'set-builder-source.js'));
  assert.deepEqual(sourceUi.sourceCounts([
    { meta: { source: 'original' } },
    { meta: { source: 'generated' } },
    { source: 'deepseek' },
    {}
  ]), { bank: 2, ai: 2 });
});

test('identical Question Bank rows keep separate selection identities', () => {
  const sourceUi = require(path.join(ROOT, 'set-builder-source.js'));
  const first = { id: 'duplicate-source-id', question: 'Same clue', answer: 'Same answer', meta: { bank_key: 'duplicate-source-id:10' } };
  const second = { id: 'duplicate-source-id', question: 'Same clue', answer: 'Same answer', meta: { bank_key: 'duplicate-source-id:11' } };

  assert.notEqual(sourceUi.questionIdentity(first), sourceUi.questionIdentity(second));
  assert.match(read('student.js'), /bank_key:[\s\S]*\$\{index\}/);
  assert.match(read('teacher.js'), /item\.meta\.bank_key[\s\S]*\$\{index\}/);
});

test('random Question Bank picks exclude selected and duplicate-content rows', () => {
  const sourceUi = require(path.join(ROOT, 'set-builder-source.js'));
  const candidates = [
    { id: 'a1', question: 'Repeated clue', answer: 'Repeated answer' },
    { id: 'a2', question: 'Repeated clue', answer: 'Repeated answer' },
    { id: 'b', question: 'Already selected clue', answer: 'Selected answer' },
    { id: 'c', question: 'Fresh clue', answer: 'Fresh answer' }
  ];
  const picked = sourceUi.randomUniqueQuestions(candidates, 10, [candidates[2]], () => 0.5);

  assert.equal(picked.length, 2);
  assert.equal(new Set(picked.map(sourceUi.questionContentFingerprint)).size, 2);
  assert.ok(!picked.some(question => question.id === 'b'));
  assert.match(read('student.html'), /id="btn-bank-random-pick"/);
  assert.match(read('student.js'), /randomUniqueQuestions\(candidates, requested, selectedQuestions\)/);
});
