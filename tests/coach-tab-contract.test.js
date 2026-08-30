const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
test('student notebook remains while teacher and Practice Hub Coach tabs are removed', () => {
  const student = read('student.html');
  const teacher = read('teacher.html');
  const practice = read('index.html');
  assert.match(student, /<button class="dash-tab coach-direct-tab"[^>]+data-tab="coach"[^>]*>Mistake Notebook<\/button>/);
  assert.match(student, /<section id="tab-coach" class="view">/);
  assert.match(student, /data-notebook-surface="primary"/);
  assert.doesNotMatch(teacher, /data-tab="coach"/);
  assert.doesNotMatch(teacher, /<section id="tab-coach"/);
  assert.doesNotMatch(teacher, /<script src="coach-tab-ui\.js"/);
  assert.doesNotMatch(practice, /id="nav-coach"/);
  assert.doesNotMatch(practice, /id="view-coach"/);
  assert.doesNotMatch(practice, /<script src="coach-tab-ui\.js"/);
});

test('student chat is removed and the future Coach rail opens from a top-right drawer', () => {
  const html = read('student.html');
  assert.doesNotMatch(html, /id="coach-chat-form"/);
  assert.doesNotMatch(html, /id="coach-chat-input"/);
  assert.doesNotMatch(html, /id="coach-chat-send"/);
  assert.doesNotMatch(html, /data-coach-surface="tab"/);
  assert.doesNotMatch(html, /<script src="coach-tab-ui\.js"(?: defer)?><\/script>/);
  assert.match(html, /<aside class="mistake-notebook-future"/);
  assert.match(html, /id="coach-preview-drawer"/);
  assert.match(html, /<button id="btn-coach-preview"/);
  assert.match(html, /<strong>Coming Soon<\/strong>/);
  assert.match(html, /Understands your notebook/);
  assert.match(html, /Uses the right practice tools/);
  assert.match(html, /Keeps recommendations focused/);
  // The Coming Soon rail must live outside the notebook tab, not inside it.
  assert.doesNotMatch(html, /<section id="tab-coach"[\s\S]*?<\/aside>[\s\S]*?<\/section>/);
  assert.match(read('student.js'), /hasChatSurface/);
});

test('Practice Hub review is simplified and Study Later is an automatic set', () => {
  const html = read('index.html');
  const practice = read('app.js');
  assert.match(html, /id="nav-session">Advanced Options<\/a>/);
  assert.doesNotMatch(html, />Top Focus</);
  assert.doesNotMatch(html, /id="review-remediation-card"/);
  assert.doesNotMatch(html, /<h2 class="card-title">Study Later<\/h2>/);
  assert.match(html, /id="chart-acc-era"[^>]+aria-label="Accuracy by era"/);
  assert.ok(html.indexOf('<h2 class="card-title">History</h2>') < html.indexOf('<h2 class="card-title">Mistake Notebook</h2>'));
  assert.match(practice, /const STUDY_LATER_SET_ID = 'study_later'/);
  assert.match(practice, /function migrateLegacyStudyBookmarks\(\)/);
  assert.match(practice, /function saveQuestionToStudyLaterSet\(item\)/);
  assert.match(practice, /function removeQuestionFromStudyLaterSet\(id\)/);
  assert.doesNotMatch(practice, /study-bookmark-save/);
  assert.doesNotMatch(read('student.html'), /id="acc-setting-practice-hub-auto-open"/);
});

test('shared Coach UI supports the simplified interaction contract', () => {
  const ui = require(path.join(root, 'coach-tab-ui.js'));
  assert.equal(ui.isSendKey({ key: 'Enter', shiftKey: false, isComposing: false }), true);
  assert.equal(ui.isSendKey({ key: 'Enter', shiftKey: true, isComposing: false }), false);
  assert.equal(typeof ui.renderPrimaryAction, 'function');
  assert.equal(typeof ui.renderMessages, 'function');
  assert.equal(typeof ui.syncState, 'function');
});

test('Coach era labels stay readable while Guided Drill keeps the bank code', () => {
  const era = require(path.join(root, 'coach-era.js'));
  assert.equal(era.toName('07'), '1991 – Present');
  assert.equal(era.toName('7'), '1991 – Present');
  assert.equal(era.toCode('1991 – Present'), '07');
  assert.equal(era.toCode('1991 - Present'), '07');

  const student = read('student.js');
  const practice = read('app.js');
  const studentPage = read('student.html');
  const practicePage = read('index.html');
  assert.match(student, /era_code:\s*eraCode/);
  assert.match(practice, /coachEraToCode\(pending\.era_code \|\| pending\.era/);
  assert.ok(studentPage.indexOf('coach-era.js') < studentPage.indexOf('student.js'));
  assert.ok(practicePage.indexOf('coach-era.js') < practicePage.indexOf('app.js'));
});

test('Coach separates recommended study areas from region and readable era', () => {
  const practice = read('app.js');
  const student = read('student.js');
  const api = read('api/coach-chat.js');

  assert.match(practice, /const structured = \[focus\?\.region, getEraName\(focus\?\.era_code \|\| focus\?\.era \|\| ''\)\]/);
  assert.match(student, /const structured = \[focus\?\.region, coachEraName\(focus\?\.era\)\]/);
  assert.match(practice, /Recommended study area:<\/b>/);
  assert.match(student, /Recommended study area:<\/b>/);
  assert.doesNotMatch(practice, /\[entry\.region, entry\.era, entry\.topic\]/);
  assert.doesNotMatch(student, /\[recordFocus\.region, recordFocus\.era, recordFocus\.topic\]/);
  assert.match(api, /Recommended study area for top focus/);
});

test("student and teacher What's New sections describe the Mistake Notebook rebrand", () => {
  assert.match(read('student.html'), /<h3[^>]*>Mistake Notebook Takes Center Stage<\/h3>\s*<div class="pill">August 14, 2026<\/div>/);
  assert.match(read('teacher.html'), /<h3[^>]*>Student Mistake Notebook Rebrand<\/h3>\s*<div class="pill">August 14, 2026<\/div>/);
});
