'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const security = require('../lib/client-security');
const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('safeWikipediaUrl accepts only HTTPS English Wikipedia URLs', () => {
  assert.equal(security.safeWikipediaUrl('javascript:alert(1)'), '');
  assert.equal(security.safeWikipediaUrl('https://evil.example/wiki/Rome'), '');
  assert.equal(security.safeWikipediaUrl('https://en.wikipedia.org/wiki/Rome'), 'https://en.wikipedia.org/wiki/Rome');
});

test('csvCell neutralizes spreadsheet formulas and preserves quotes', () => {
  assert.equal(security.csvCell('=WEBSERVICE("https://evil")'), '"\'=WEBSERVICE(""https://evil"")"');
  assert.equal(security.csvCell('Ada "Ace"'), '"Ada ""Ace"""');
});

test('all paid AI handlers enforce authenticated quota access', () => {
  for (const file of ['grade.js', 'coach-chat.js', 'generate-questions.js', 'analytics-insights.js', 'teacher-feedback.js']) {
    const source = read(`api/${file}`);
    assert.match(source, /requireAiAccess/);
    assert.match(source, /if \(!access\) return/);
  }
});

test('local server denies secret paths and untrusted browser origins', () => {
  const source = read('server.py');
  assert.match(source, /def is_public_static_path/);
  assert.match(source, /def is_trusted_browser_origin/);
  assert.match(source, /if not is_public_static_path\(rel\)/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin", "\*"/);
});

test('security migration closes direct-write and public definer paths', () => {
  const source = read('migrations/20260810023453_security_report_remediation.sql');
  assert.match(source, /tablename in \('class_students','assignments','assignment_questions','assignment_submissions','question_sets'\)/i);
  assert.match(source, /tablename in \('bee_rooms','bee_participants','livebee_game_reviews'\)/i);
  assert.match(source, /revoke insert, update on public\.assignment_submissions from anon, authenticated/i);
  assert.match(source, /revoke insert, update on public\.bee_participants from anon, authenticated/i);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.get_leaderboard_global\(\) FROM PUBLIC, anon/i);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.get_leaderboard_class\(UUID\) FROM PUBLIC, anon/i);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.get_user_practice_streak\(UUID\) FROM PUBLIC, anon/i);
  assert.match(source, /CREATE POLICY "LiveBee host sends authority"/i);
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.submit_assignment_attempts/i);
  assert.match(source, /CREATE OR REPLACE FUNCTION public\.finish_bee_game/i);
});

test('untrusted rendered and exported values use URL, DOM, number, and CSV guards', () => {
  const app = read('app.js');
  const student = read('student.js');
  const teacher = read('teacher.js');
  const wrongBank = app.slice(app.indexOf('function renderWrongBank()'), app.indexOf('function reviewMissedNow()'));
  assert.match(app, /IHBBSecurity\.safeWikipediaUrl\(coach\?\.wiki_link\)/);
  assert.match(student, /IHBBSecurity\.safeWikipediaUrl\(coach\?\.wiki_link\)/);
  assert.match(wrongBank, /td\.textContent = String\(value\)/);
  assert.doesNotMatch(wrongBank, /tr\.innerHTML/);
  assert.match(teacher, /IHBBSecurity\.finiteNumber\(s\.score\)/);
  assert.match(teacher, /\.map\(IHBBSecurity\.csvCell\)/);
});

test('question generation cannot skip validation or persist into the shared bank', () => {
  const server = read('server.py');
  const start = server.indexOf('def generate_questions_with_deepseek');
  const end = server.indexOf('\ndef ', start + 10);
  const handler = server.slice(start, end);
  assert.doesNotMatch(handler, /skip_validation/);
  assert.doesNotMatch(handler, /persist_generated_items\(/);
  assert.match(handler, /review_required/);
});

test('assignment and Live Bee clients use verified RPCs and private split channels', () => {
  const app = read('app.js');
  const bee = read('livebee.js');
  assert.match(app, /rpc\('submit_assignment_attempts'/);
  assert.doesNotMatch(app, /from\('assignment_submissions'\)[\s\S]{0,120}\.insert\(/);
  assert.match(bee, /bee-host:' \+ room\.id/);
  assert.match(bee, /bee-player:' \+ room\.id/);
  assert.match(bee, /private: true/);
  assert.match(bee, /rpc\('finish_bee_game'/);
  assert.doesNotMatch(bee, /from\('bee_participants'\)[\s\S]{0,120}\.update\(/);
  assert.doesNotMatch(bee, /from\('livebee_game_reviews'\)[\s\S]{0,120}\.insert\(/);
});
