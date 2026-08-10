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
