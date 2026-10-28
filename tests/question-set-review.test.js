const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const review = require('../question-set-review');

const set = { id: 'set-one', questions: [
    { id: 'q1', question: 'First question', answer: 'First answer' },
    { id: 'q2', question: 'Second question', answer: 'Second answer', aliases: ['Other answer'] }
] };
const session = (rows = set.questions) => ({
    user_id: 'alice', total: rows.length, results: rows.map(() => false),
    meta: rows.map(row => ({ question_text: row.question, expected_answer: row.answer }))
});
const storage = data => ({ getItem: key => data[key] || null });

test('one full attempt unlocks review regardless of score or question order', () => {
    assert.equal(review.completed(set, session(), 'alice'), true);
    assert.equal(review.completed(set, session([...set.questions].reverse()), 'alice'), true);
    assert.equal(review.completed(set, session(), 'bob'), false);
    assert.equal(review.completed(set, session(), ''), false);
    assert.equal(review.completed(set, { ...session(), results: [true] }, 'alice'), false);
    assert.equal(review.completed(set, session(set.questions.slice(0, 1)), 'alice'), false);
    assert.equal(review.completed(set, { ...session(), results: [true, null] }, 'alice'), false);
});

test('changed content, duplicate mismatches, and another tagged set stay locked', () => {
    const changed = { ...set, questions: [set.questions[0], { ...set.questions[1], answer: 'New answer' }] };
    assert.equal(review.completed(changed, session(), 'alice'), false);
    assert.equal(review.completed(set, session([set.questions[0], set.questions[0]]), 'alice'), false);
    const tagged = session(); tagged.meta.forEach(row => { row.set_id = 'another-set'; });
    assert.equal(review.completed(set, tagged, 'alice'), false);
    tagged.meta.forEach(row => { row.set_id = set.id; });
    assert.equal(review.completed(set, tagged, 'alice'), true);
    assert.equal(review.completed({ id: 'empty', questions: [] }, session([]), 'alice'), false);
    assert.equal(review.completed(set, { ...session(), meta: [{ category: 'Europe' }, {}] }, 'alice'), false);
});

test('local completions use only the current account storage and survive a cloud failure', async () => {
    const local = storage({ ihbb_v2_sessions_bob: JSON.stringify([session()]) });
    const failing = { from() { throw Error('Offline'); } };
    assert.deepEqual([...((await review.loadCompletedSets(failing, 'alice', [set], local)).ids)], []);
    const own = storage({ ihbb_v2_sessions_alice: JSON.stringify([{ ...session(), user_id: undefined }]) });
    const result = await review.loadCompletedSets(failing, 'alice', [set], own);
    assert.deepEqual([...result.ids], ['set-one']);
    assert.equal(result.unavailable, false);
    const locked = await review.loadCompletedSets(failing, 'alice', [set], storage({}));
    assert.equal(locked.ids.size, 0);
    assert.equal(locked.unavailable, true);
});

test('cloud lookup is scoped to the student and finds completions beyond the first page', async () => {
    const queries = [];
    const cloud = { from(table) {
        const query = { table, filters: [], orders: [] }; queries.push(query);
        const builder = {
            select(columns) { query.columns = columns; return builder; },
            eq(...filter) { query.filters.push(filter); return builder; },
            order(...order) { query.orders.push(order); return builder; },
            range(start, end) {
                query.range = [start, end];
                return Promise.resolve({ data: start === 0 ? Array.from({ length: 200 }, () => session([])) : [session()], error: null });
            }
        };
        return builder;
    } };
    const result = await review.loadCompletedSets(cloud, 'alice', [set], { getItem() { throw Error('Storage blocked'); } });
    assert.deepEqual([...result.ids], ['set-one']);
    assert.equal(result.unavailable, false);
    assert.equal(queries.length, 2);
    assert.deepEqual(queries[1].range, [200, 399]);
    for (const query of queries) {
        assert.equal(query.table, 'user_drill_sessions');
        assert.deepEqual(query.filters, [['user_id', 'alice']]);
    }
});

test('question parsing accepts legacy q/a records without treating markup as HTML', () => {
    const rows = review.questions({ questions: JSON.stringify([{ q: '<img src=x>', a: '<script>alert(1)</script>' }]) });
    assert.equal(rows[0].question, '<img src=x>');
    assert.equal(rows[0].answer, '<script>alert(1)</script>');
    assert.equal(review.questions({ questions: 'invalid' }).length, 0);
    assert.equal(review.questions({ questions: [{ prompt: 'A year?', response: 0 }] })[0].answer, '0');
});

test('completion compares the same normalized text that Practice Hub actually records', () => {
    const original = { id: 'formatted', questions: [{ question: 'A question\n with   spacing?', answer: '"Answer" [accept Alias]' }] };
    const saved = session([{ question: 'A question with spacing?', answer: 'Answer' }]);
    assert.equal(review.completed(original, saved, 'alice'), true);
});

test('practice set identity survives cloud normalization with question snapshots', () => {
    const app = fs.readFileSync(require.resolve('../app.js'), 'utf8');
    const fn = app.slice(app.indexOf('function normalizeSessionRecordForSync('), app.indexOf('\nfunction syncSessionRecord('));
    const context = {};
    vm.runInNewContext(fn, context);
    const raw = session(); raw.meta.forEach(row => { row.set_id = set.id; }); raw.items = ['q1', 'q2'];
    const normalized = context.normalizeSessionRecordForSync(raw);
    assert.equal(normalized.meta[0].set_id, set.id);
    assert.equal(review.completed(set, normalized, 'alice'), true);
});
