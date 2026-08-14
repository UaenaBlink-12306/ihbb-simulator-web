const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pages = ['index.html', 'student.html', 'teacher.html'];

test('Coach is a full tab surface on every app entry point', () => {
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /data-coach-surface="tab"/, `${page} should expose the Coach as a tab surface`);
    assert.match(html, /<script src="coach-tab-ui\.js"(?: defer)?><\/script>/, `${page} should load the shared Coach tab UI`);
    assert.doesNotMatch(html, /id="coach-chat-launcher"/, `${page} should not expose a floating Coach launcher`);
    assert.doesNotMatch(html, /id="coach-chat-backdrop"/, `${page} should not use an overlay backdrop`);
    assert.doesNotMatch(html, /<aside[^>]+id="coach-chat-sidebar"/, `${page} should not render Coach as an aside`);
  }
});

test('Coach is directly reachable from student and teacher dashboard tabs', () => {
  for (const page of ['student.html', 'teacher.html']) {
    const html = read(page);
    assert.match(html, /<button class="dash-tab coach-direct-tab"[^>]+data-tab="coach"[^>]*>Coach<\/button>/);
    assert.match(html, /<section id="tab-coach" class="view">/);
  }
  assert.match(read('index.html'), /id="nav-coach"[^>]*>Coach<\/a>/);
  assert.match(read('index.html'), /<section id="view-coach" class="view">/);
});

test('Coach tab removes advanced drawer controls and keeps one simple composer', () => {
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(html, /id="coach-chat-fullscreen"/);
    assert.doesNotMatch(html, /id="coach-chat-resize-handle"/);
    assert.doesNotMatch(html, /id="coach-chat-thinking-toggle"/);
    assert.equal((html.match(/id="coach-chat-form"/g) || []).length, 1, `${page} should have one Coach composer`);
    assert.equal((html.match(/id="coach-chat-input"/g) || []).length, 1, `${page} should have one Coach input`);
  }
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

test("student and teacher What's New sections describe the Coach redesign", () => {
  for (const page of ['student.html', 'teacher.html']) {
    const html = read(page);
    assert.match(html, /<h3[^>]*>Simpler Coach Tab<\/h3>\s*<div class="pill">August 10, 2026<\/div>/);
  }
});
