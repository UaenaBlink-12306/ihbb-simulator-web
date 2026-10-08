'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const reports = require('../teacher-results.js');

const questions = [
    { question_id: 'q1', question_text: 'Name the empire.', answer_text: 'Roman Empire', aliases: ['Rome'], category: 'Europe', era: '02' },
    { question_id: 'q2', question_text: 'Name the dynasty.', answer_text: 'Han', category: 'Asia', era: '02' },
    { question_id: 'q3', question_text: 'Name the treaty.', answer_text: 'Treaty of Versailles', category: 'Europe', era: '06' }
];

test('homework reviews join shuffled attempts by question ID and follow server answer matching', () => {
    const rows = reports.homeworkRows(questions, { attempts: [
        { question_id: 'q2', answer: 'Tang', buzz_seconds: 4.25 },
        { question_id: 'q1', answer: '  rOmE  ', buzz_seconds: 0 },
        { question_id: 'q3', answer: '  treaty of Versailles  ' }
    ] });
    assert.deepEqual(rows.map(row => [row.id, row.answer, row.correct]), [
        ['q2', 'Tang', false], ['q1', '  rOmE  ', true], ['q3', '  treaty of Versailles  ', true]
    ]);
    assert.equal(rows[0].expected, 'Han');
    assert.equal(rows[0].buzz, 4.25);
    assert.equal(rows[1].buzz, null);
    assert.deepEqual(reports.rowSummary(rows), { correct: 2, missed: 1, unknown: 0, noAnswer: 0, averageBuzz: 4.25 });
    const whitespace = reports.homeworkRows(questions, { attempts: [{ question_id: 'q1', answer: 'Roman   Empire' }] });
    assert.equal(whitespace[0].correct, false, 'the deployed homework grader keeps internal whitespace significant');
});

test('legacy, incomplete, and removed homework details stay unknown rather than becoming misses', () => {
    const legacy = reports.homeworkRows(questions, { correct: 2, total: 3 });
    assert.equal(reports.rowSummary(legacy).unknown, 3);
    assert.ok(legacy.every(row => row.answer === null && row.correct === null));
    const rows = reports.homeworkRows(questions, { attempts: [{ question_id: 'q2', answer: '' }, { question_id: 'removed', answer: 'old answer' }] });
    assert.equal(rows[0].correct, false);
    assert.equal(rows[0].answer, '');
    assert.equal(rows[1].correct, null);
    assert.equal(reports.rowSummary(rows).noAnswer, 1);
});

test('teacher corrections supersede automatic matching without changing the saved answer', () => {
    const submission = { attempts: [{ question_id: 'q2', answer: 'Han Dynasty' }], grading_overrides: {
        q2: { active: true, correct: true, original_correct: false, reviewed_at: '2026-10-08T01:00:00Z' }
    } };
    const row = reports.homeworkRows(questions.slice(1, 2), submission)[0];
    assert.equal(row.correct, true);
    assert.equal(row.systemCorrect, false);
    assert.equal(row.teacherCorrected, true);
    assert.equal(row.answer, 'Han Dynasty');
    assert.equal(row.reviewedAt, '2026-10-08T01:00:00Z');
    assert.equal(reports.breakdown([row], 'category')[0].accuracy, 100);
    submission.grading_overrides.q2.active = false;
    const restored = reports.homeworkRows(questions.slice(1, 2), submission)[0];
    assert.equal(restored.correct, false);
    assert.equal(restored.teacherCorrected, false);
});

test('practice snapshots preserve custom question text and answers independently of the current bank', () => {
    const session = {
        items: ['custom', 'q1'], results: [false, true], buzz: [null, 2.5],
        meta: [{ question_text: 'A custom question', expected_answer: 'Custom answer', user_answer: '', category: 'Asia', era: '02' }]
    };
    const bank = new Map([['q1', { question: 'Current bank question', answer: 'Rome', meta: { category: 'Europe' } }]]);
    const rows = reports.practiceRows(session, bank);
    assert.equal(rows[0].question, 'A custom question');
    assert.equal(rows[0].answer, '');
    assert.equal(rows[0].expected, 'Custom answer');
    assert.equal(rows[0].buzz, null);
    assert.equal(rows[1].answer, null);
    assert.equal(rows[1].buzz, 2.5);
    assert.equal(rows[1].correct, true);
});

test('practice legacy answers use only a coach attempt belonging to the same session', () => {
    const session = { client_session_id: 'session-a', items: ['q1', 'q2', 'q3'], results: [false, true] };
    const rows = reports.practiceRows(session, new Map(), [
        { client_session_id: 'session-b', question_id: 'q1', user_answer: 'wrong session' },
        { client_session_id: 'session-a', question_id: 'q1', user_answer: 'same session', question_text: 'Saved question' }
    ]);
    assert.equal(rows[0].answer, 'same session');
    assert.equal(rows[1].answer, null);
    assert.equal(rows[2].correct, null);
});

test('topic breakdowns exclude unknown outcomes from accuracy', () => {
    const stats = reports.breakdown([{ category: 'Asia', correct: true }, { category: 'Asia', correct: null }, { category: 'Asia', correct: false }], 'category');
    assert.deepEqual(stats, [{ name: 'Asia', total: 3, correct: 1, unknown: 1, accuracy: 50 }]);
});

test('date-only homework deadlines include the whole local due day', () => {
    const midday = new Date('2026-10-08T12:00:00').getTime();
    assert.equal(reports.dueStatus('2026-10-08', '', midday), 'Pending');
    assert.equal(reports.dueStatus('2026-10-08', '2026-10-08T23:59:00'), 'On time');
    assert.equal(reports.dueStatus('2026-10-08', '2026-10-09T00:00:00'), 'Submitted late');
    assert.equal(reports.dueStatus('2026-10-07', '', midday), 'Overdue');
});

test('homework retries stay distinct from original homework and independent practice', () => {
    assert.equal(reports.sessionKind({ meta: [{ activity_type: 'homework', retry_mode: 'missed' }] }), 'retry');
    assert.equal(reports.sessionKind({ meta: [{ activity_type: 'homework', retry_mode: 'first' }] }), 'homework');
    assert.equal(reports.sessionKind({ meta: [{ activity_type: 'practice' }] }), 'practice');
    assert.equal(reports.sessionKind({ meta: [{ category: 'Asia' }] }), 'legacy');
    assert.match(reports.sessionTitle({ meta: [{ activity_type: 'homework', retry_mode: 'missed', assignment_title: 'Week 1' }] }), /Week 1.*Missed-question retry/);
});

test('actual Practice Hub recording and cloud normalization retain detailed snapshots in question order', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
    const functions = source.slice(source.indexOf('function pushSession('), source.indexOf('function syncSessionRecord('));
    let saved;
    const context = {
        localStorage: { getItem: () => '[]', setItem() {} }, KEY_SESS: 'sessions',
        App: { submittedAnswers: ['Han', 'Rome'] }, AssignmentSessionActive: true,
        ASSIGNMENT_ID: 'assignment-1', ActiveAssignmentLaunch: { title: 'Week 1', retryMode: 'missed' },
        getActiveSet: () => ({ name: 'Week 1 retry' }),
        syncSessionRecord: value => { saved = JSON.parse(JSON.stringify(value)); }
    };
    vm.createContext(context);
    vm.runInContext(functions, context);
    context.pushSession(2, 1, 30, [4, 0], [
        { id: 'q1', question: 'Empire?', answer: 'Rome', meta: { category: 'Europe' } },
        { id: 'q2', question: 'Dynasty?', answer: 'Han', meta: { category: 'Asia' } }
    ], [1, 0], [true, false], 'test-session');
    const normalized = JSON.parse(JSON.stringify(context.normalizeSessionRecordForSync(saved)));
    assert.deepEqual(normalized.items, ['q2', 'q1']);
    assert.deepEqual(normalized.meta.map(row => [row.question_text, row.expected_answer, row.user_answer]), [['Dynasty?', 'Han', 'Han'], ['Empire?', 'Rome', 'Rome']]);
    assert.equal(normalized.meta[0].assignment_id, 'assignment-1');
    assert.equal(reports.sessionKind(normalized), 'retry');
    saved.buzz = ['invalid', 4];
    assert.deepEqual(JSON.parse(JSON.stringify(context.normalizeSessionRecordForSync(saved))).buzz, [0, 4]);
    let warned = false;
    context.toast = () => { warned = true; };
    context.localStorage.setItem = () => { throw new Error('Storage full'); };
    assert.doesNotThrow(() => context.pushSession(1, 1, 5, [2], [{ id: 'q1', question: 'Empire?', answer: 'Rome' }], [0], [true], 'storage-full-session'));
    assert.equal(saved.sid, 'storage-full-session', 'cloud sync must still receive the complete record');
    assert.equal(warned, true);
});
