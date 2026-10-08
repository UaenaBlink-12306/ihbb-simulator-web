const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const core = require('../coach-context');
const { coachPreviewReply } = require('../api/_coach-preview');

const now = Date.parse('2026-10-08T08:00:00Z');
const bank = Array.from({ length: 20 }, (_, index) => ({
  id: `q${index}`, question: index < 10 ? 'This event during the French Revolution changed France.' : 'This emperor ruled China during the Qing dynasty.',
  answer: `Answer ${index}`, meta: { category: index < 10 ? 'Europe' : 'East Asia', era: '05', source: 'original' }
}));
const sourceStatus = { classes: 'ready', assignments: 'ready', submissions: 'ready', sessions: 'ready', notebook: 'ready', mistakes: 'ready', sets: 'ready', games: 'ready', goals: 'ready' };
const snapshot = (extra = {}) => core.buildSnapshot({ uid: 'codex-test', bank, sources: sourceStatus, ...extra }, now);
const note = (id, extra = {}) => ({ client_attempt_id: id, created_at: new Date(now - 1000).toISOString(), correct: false, mastered: false, question_text: bank[0].question, expected_answer: bank[0].answer, category: 'Europe', era: '05', coach: { summary: 'Confused the revolution with a later event.', study_focus: { region: 'Europe', era: '05', topic: 'French Revolution' } }, ...extra });

test('loads every page, preserving useful rows and reporting a partial/error boundary', async () => {
  const data = Array.from({ length: 1201 }, (_, id) => ({ id }));
  let calls = 0;
  const all = await core.readAllPages(() => ({ range: async (start, end) => { calls++; return { data: data.slice(start, end + 1) }; } }));
  assert.equal(all.data.length, 1201);
  assert.equal(calls, 3);
  assert.equal(all.status, 'ready');
  const partial = await core.readAllPages(() => ({ range: async start => start ? { error: new Error('offline') } : { data: data.slice(0, 500) } }));
  assert.equal(partial.status, 'partial');
  assert.equal(partial.data.length, 500);
  const capped = await core.readAllPages(() => ({ range: async () => ({ data: data.slice(0, 500) }) }), { maxPages: 1 });
  assert.equal(capped.status, 'partial');
});

test('aggregates the full history, deduplicates local/cloud sessions, and weights accuracy by question count', () => {
  const sessions = Array.from({ length: 25 }, (_, index) => ({ sid: `s${index}`, ts: now - index * 60000, total: 1, correct: 0, items: ['q0'], results: [false], meta: [bank[0].meta] }));
  sessions.push({ sid: 'large', ts: now, total: 100, correct: 100 });
  const context = snapshot({ local_sessions: sessions, cloud_sessions: [{ ...sessions[0], client_session_id: sessions[0].sid }] });
  assert.equal(context.performance.total_sessions, 26);
  assert.equal(context.performance.total_attempts, 125);
  assert.equal(context.performance.accuracy, 80);
  assert.equal(context.performance.recent_sessions.length, 8);
  assert.equal(context.performance.dimensions.find(row => row.key === 'region:Europe').attempts, 25);
});

test('mastered lessons contribute to context but do not create weak-area recommendations', () => {
  const context = snapshot({ local_notebook: [note('same'), note('mastered', { mastered: true })], cloud_notebook: [note('same', { mastered: true })] });
  assert.equal(context.notebook.total, 2);
  assert.equal(context.notebook.mastered, 2);
  assert.equal(context.notebook.focuses.length, 0);
  assert.equal(core.plan(context).primary.id, 'start_baseline');
});

test('nearest unfinished assignment beats due review and unrelated latest misses; completed work is excluded', () => {
  const context = snapshot({
    assignments: [{ id: 'submitted', title: 'Finished', due_date: new Date(now - 2000).toISOString() }, { id: 'urgent', title: 'Revolutions', due_date: new Date(now + 3600000).toISOString() }, { id: 'later', title: 'Later work', due_date: new Date(now + 10 * 86400000).toISOString() }],
    submissions: [{ assignment_id: 'submitted', total: 5, correct: 5 }],
    checkpoints: { urgent: { answered: 3, total: 10 } }, local_notebook: [note('miss')],
    local_wrong: { q0: { dueAt: now - 1000 } }
  });
  const plan = core.plan(context);
  assert.equal(plan.primary.id, 'start_assignment');
  assert.equal(plan.primary.target_id, 'urgent');
  assert.match(plan.primary.label, /^Continue/);
  assert.match(plan.primary.evidence, /3\/10 answered/);
  assert.equal(plan.alternative.id, 'start_due_review');
});

test('explicit assignment skip and topic/time constraints override the default deadline policy', () => {
  const prefs = core.requestPreferences({}, 'I have 5 minutes. Practice only the French Revolution. Skip assignments.');
  const context = snapshot({ preferences: prefs, assignments: [{ id: 'a', title: 'Class work', due_date: new Date(now).toISOString() }] });
  const plan = core.plan(context, 'Skip assignments.');
  assert.equal(plan.primary.id, 'start_focus_drill');
  assert.equal(plan.primary.filters.topic, 'the French Revolution');
  assert.equal(plan.primary.count, 3);
  assert.equal(plan.preferences.minutes, 5);
  assert.equal(core.requestPreferences(prefs, 'Why this tool?').topic, prefs.topic);
  assert.equal(core.requestPreferences(prefs, 'Why is this the right practice tool for me?').topic, prefs.topic);
});

test('due review contains only playable due cards, excluding future and unknown cloud schedules', () => {
  const context = snapshot({ local_wrong: { q0: { dueAt: now - 1 }, q1: { dueAt: now + 100000 }, missing: { dueAt: now - 1 } }, cloud_wrong: [{ question_id: 'q2' }] });
  const action = core.plan(context).primary;
  assert.equal(action.id, 'start_due_review');
  assert.deepEqual(action.question_ids, ['q0']);
  assert.equal(context.mistakes.unknown_schedule, 1);
  const unknownOnly = snapshot({ cloud_wrong: [{ question_id: 'q2' }] });
  assert.equal(core.plan(unknownOnly).primary.id, 'start_baseline');
  const custom = snapshot({ bank: [], preferences: { region: 'Europe', era: '05' }, local_wrong: { custom: { dueAt: now - 1, q: 'A clue from an imported set.', answer: 'Custom answer', category: 'Europe', era: '05' } } });
  assert.deepEqual(core.plan(custom).primary.question_ids, ['custom']);
});

test('one miss does not establish an analytics weakness; multiple recent attempts can', () => {
  const session = { sid: 's', ts: now, total: 1, correct: 0, items: ['q0'], results: [false], meta: [bank[0].meta] };
  assert.equal(core.plan(snapshot({ local_sessions: [session] })).primary.id, 'start_baseline');
  const repeated = { ...session, total: 6, correct: 1, items: Array(6).fill('q0'), results: [true, false, false, false, false, false], meta: Array(6).fill(bank[0].meta) };
  const plan = core.plan(snapshot({ local_sessions: [repeated] }));
  assert.equal(plan.primary.id, 'start_focus_drill');
  assert.equal(plan.primary.filters.region, 'Europe');
  assert.match(plan.evidence, /6 attempts/);
  assert.equal(core.plan(snapshot({ local_sessions: [{ ...repeated, ts: now - 40 * 86400000 }] })).primary.id, 'start_baseline');
});

test('requested topic never silently widens to an unrelated region or to the entire bank', () => {
  const context = snapshot({ preferences: { topic: 'Mughal Empire', allow_generated: false } });
  const plan = core.plan(context);
  assert.equal(context.bank.matching_count, 0);
  assert.equal(plan.primary.id, 'open_library');
  assert.equal(plan.primary.query, 'Mughal Empire');
  assert.equal(core.matchesQuestion(bank[10], { topic: 'French Revolution' }), false);
  assert.equal(core.matchesQuestion(bank[0], { topic: 'French Revolution', region: 'East Asia' }), false);
  assert.equal(core.matchesQuestion(bank[0], { topic: 'French Revolution', region: 'Europe' }), true);
  assert.equal(core.matchesQuestion(null, { topic: 'French Revolution' }), false);
});

test('missing source is surfaced while local history and scoped notebook evidence remain usable', () => {
  const context = snapshot({ local_notebook: [note('miss')], sources: { ...sourceStatus, assignments: 'unavailable', notebook: 'unavailable' } });
  const plan = core.plan(context);
  assert.equal(plan.primary.id, 'start_focus_drill');
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /assignments, notebook/);
});

test('saved sets and remaining weekly goal narrow the selected practice block', () => {
  const context = snapshot({ local_sets: [{ id: 'study_later', name: 'Study Later', items: bank.slice(0, 4) }], weekly_goals: [{ week_start: '2026-10-05', target_questions: 12, target_accuracy: 80 }], local_sessions: [{ sid: 's', ts: now, total: 10, correct: 10 }] });
  const plan = core.plan(context, 'Use Study Later');
  assert.equal(plan.primary.id, 'practice_saved_set');
  assert.equal(plan.primary.target_id, 'study_later');
  assert.equal(plan.primary.count, 2);
  assert.equal(context.weekly_goal.answered, 10);
});

test('Live Bee context uses personal attempts and never attributes another player or room score to the learner', () => {
  const context = snapshot({ preferences: { goal: 'tournament' }, games: [{ id: 'g', created_at: new Date(now).toISOString(), summary: { totalQuestions: 20, solved: 20 }, review: [
    { ...bank[0], attempts: [{ userId: 'someone-else', correct: false }], solvedBy: { userId: 'codex-test' } },
    { ...bank[1], attempts: [{ userId: 'codex-test', correct: false }], solvedBy: { userId: 'someone-else' } },
    { ...bank[2], attempts: [{ userId: 'codex-test', correct: true }] }
  ] }] });
  assert.equal(context.live_bee.personal_attempts, 2);
  assert.equal(context.live_bee.accuracy, 50);
  assert.deepEqual(context.live_bee.recent_misses.map(item => item.id), ['q1']);
  assert.equal(core.plan(context).primary.id, 'review_live_bee');
});

test('action validation returns the canonical offer and handoffs reject stale/other-account launches', () => {
  const action = core.plan(snapshot()).primary;
  const poisoned = { ...action, label: 'Delete everything', question_ids: ['other-user-question'] };
  assert.equal(core.validAction(poisoned, [action]), action);
  assert.equal(core.validAction({ ...action, id: 'delete_account' }, [action]), null);
  const launch = { mode: 'coach_preview_drill', user_id: 'codex-test', ts: now, title: 'Targeted', items: bank.slice(0, 3) };
  assert.equal(core.validateHandoff(launch, 'codex-test', now).items.length, 3);
  assert.equal(core.validateHandoff(launch, 'someone-else', now), null);
  assert.equal(core.validateHandoff(launch, 'codex-test', now + 11 * 60000), null);
  assert.equal(core.validateHandoff({ ...launch, ts: now + 120000 }, 'codex-test', now), null);
});

test('compact AI context includes all history totals, constraints and patterns without auth data or raw bank', () => {
  const context = snapshot({ profile: { display_name: 'Codex', email: 'private@example.com', access_token: 'secret' }, private_token: 'secret', bank });
  const compact = core.compactContext(context);
  assert.equal(compact.bank.total, 20);
  assert.equal(compact.performance.total_sessions, 0);
  assert.equal('seen_ids' in compact.performance, false);
  assert.equal(JSON.stringify(compact).includes('private@example.com'), false);
  assert.equal(JSON.stringify(compact).includes('secret'), false);
  assert.equal('items' in compact.bank, false);
});

test('compact context keeps urgent unfinished work ahead of historical completed assignments', () => {
  const history = Array.from({ length: 160 }, (_, index) => ({ id: `old${index}`, title: 'Finished work' }));
  const context = snapshot({ assignments: [...history, { id: 'urgent', title: 'Due now', due_date: new Date(now).toISOString() }], submissions: history.map(row => ({ assignment_id: row.id, total: 5, correct: 5 })) });
  const compact = core.compactContext(context);
  assert.equal(compact.assignment_count, 161);
  assert.equal(compact.assignments[0].id, 'urgent');
  assert.equal(core.plan(compact).primary.target_id, 'urgent');
});

test('hosted and local Coach keep the same deterministic fallback and malformed context is recoverable', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const context = core.compactContext(snapshot({ local_notebook: [note('miss')] }));
    const reply = await coachPreviewReply({ study_context: context, message: 'What next?' });
    assert.equal(reply.request_type, 'coach_preview');
    assert.equal(reply.source, 'fallback');
    assert.equal(reply.quick_actions.length, 1);
    assert.equal(reply.quick_actions[0].id, 'start_focus_drill');
    assert.equal((await coachPreviewReply({ study_context: null })).quick_actions.length, 0);
    const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../api/_coach-preview.js')], { input: JSON.stringify({ study_context: context, message: 'What next?' }), encoding: 'utf8', env: { ...process.env, DEEPSEEK_API_KEY: '' } });
    assert.equal(cli.status, 0);
    assert.equal(JSON.parse(cli.stdout).quick_actions[0].key, reply.quick_actions[0].key);
  } finally { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous; }
});

test('AI explanations cannot introduce new executable tools or override the selected focus', async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const originalFetch = global.fetch;
  process.env.DEEPSEEK_API_KEY = 'test-only';
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Review this supported focus.' } }], quick_actions: [{ id: 'delete_account' }] }) });
  try {
    const result = await coachPreviewReply({ study_context: core.compactContext(snapshot({ local_notebook: [note('miss')] })), message: 'What next?' });
    assert.equal(result.source, 'deepseek');
    assert.equal(result.quick_actions[0].id, 'start_focus_drill');
    assert.equal(result.quick_actions[0].filters.topic, 'French Revolution');
  } finally { global.fetch = originalFetch; if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previousKey; }
});
