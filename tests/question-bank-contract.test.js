const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ITEM_KEYS = ['aliases', 'answer', 'id', 'meta', 'question'];
const META_KEYS = ['category', 'era', 'source'];
const ERAS = new Set(['', '01', '02', '03', '04', '05', '06', '07']);

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

function canonicalQuestion(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function validateQuestionSet(payload, label) {
  assert.deepEqual(Object.keys(payload).sort(), ['categories', 'id', 'items', 'name'], `${label} root schema`);
  assert.ok(Array.isArray(payload.categories) && payload.categories.length > 0, `${label} categories`);
  assert.ok(Array.isArray(payload.items) && payload.items.length > 0, `${label} items`);
  const categories = new Set(payload.categories);
  const ids = new Set();
  const questions = new Set();
  payload.items.forEach((item, index) => {
    assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS, `${label} item ${index} schema`);
    assert.deepEqual(Object.keys(item.meta || {}).sort(), META_KEYS, `${label} item ${index} meta schema`);
    assert.equal(typeof item.id, 'string', `${label} item ${index} id`);
    assert.ok(item.id.trim(), `${label} item ${index} non-empty id`);
    assert.equal(typeof item.question, 'string', `${label} item ${index} question`);
    assert.ok(canonicalQuestion(item.question), `${label} item ${index} usable question`);
    assert.equal(typeof item.answer, 'string', `${label} item ${index} answer`);
    assert.ok(item.answer.trim(), `${label} item ${index} usable answer`);
    assert.ok(Array.isArray(item.aliases), `${label} item ${index} aliases`);
    assert.ok(categories.has(item.meta.category), `${label} item ${index} category`);
    assert.ok(ERAS.has(item.meta.era), `${label} item ${index} era`);
    assert.equal(item.meta.source, 'original', `${label} item ${index} source`);
    assert.ok(!ids.has(item.id), `${label} duplicate id ${item.id}`);
    ids.add(item.id);
    const questionKey = canonicalQuestion(item.question);
    assert.ok(!questions.has(questionKey), `${label} repeated question at item ${index}`);
    questions.add(questionKey);
  });
  return questions;
}

test('new and merged question banks keep the exact app schema without repeats', () => {
  const mergedQuestions = validateQuestionSet(loadJson('questions.json'), 'questions.json');
  const newQuestions = validateQuestionSet(loadJson('new_questions.json'), 'new_questions.json');
  newQuestions.forEach((question) => {
    assert.ok(mergedQuestions.has(question), 'every new question is present in the merged bank');
  });
});

test('the built-in bank still loads automatically and large libraries are paginated', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(app, /fetch\('\.\/questions\.json', \{ cache: 'no-cache' \}\)/);
  assert.match(app, /const LIBRARY_PAGE_SIZE = 100;/);
  assert.match(app, /matchingEntries\.slice\(pageStart, pageStart \+ LIBRARY_PAGE_SIZE\)/);
  assert.match(index, /id="lib-pagination"/);
  assert.match(index, /id="lib-page-prev"/);
  assert.match(index, /id="lib-page-next"/);
});
