const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const topics = require('../bowl-topics');
const bank = JSON.parse(fs.readFileSync(path.join(__dirname, '../questions.json'), 'utf8'));

test('packet groups reference existing questions in source order, with stable topic IDs', () => {
  const groups = bank.bowlThirdQuarterGroups;
  assert.ok(groups.length > 1800, 'the complete packet collection is indexed');
  assert.equal(new Set(groups.map(g => g.id)).size, groups.length);
  assert.deepEqual(topics.normalizeGroups(groups, bank.items), groups);
  const itemIds = new Set(bank.items.map(item => item.id));
  for (const group of groups) {
    assert.ok(group.topic && group.packet.endsWith('.pdf'));
    assert.ok([6, 8].includes(group.questionIds.length), group.topic + ' retains its packet group size');
    assert.ok(group.questionIds.every(id => itemIds.has(id)));
  }
});

test('an original Eisenhower topic retains all eight questions, including its year answer', () => {
  const group = bank.bowlThirdQuarterGroups.find(g => g.topic === 'Eisenhower Administration' && g.packet.includes('High-School'));
  const items = topics.groupItems(bank, group.id);
  assert.equal(items.length, 8);
  assert.match(items[0].question, /year in which Eisenhower/i);
  assert.equal(items[0].answer, '1952');
  assert.match(items[7].question, /town that Eisenhower retired/i);
});

test('bad or stale topic selections never fall back to unrelated questions', () => {
  const items = [{ id: 'a', question: 'A?' }, { id: 'b', question: 'B?' }];
  const group = { id: 'g', topic: 'Topic', prompt: 'Name the...', packet: 'source.pdf', questionIds: ['b', 'a'] };
  const set = { items, bowlThirdQuarterGroups: [group] };
  assert.deepEqual(topics.groupItems(set, 'g'), [items[1], items[0]]);
  assert.deepEqual(topics.groupItems(set, 'missing'), []);
  assert.deepEqual(topics.groupItems({ ...set, items: items.slice(1) }, 'g'), []);
  assert.deepEqual(topics.normalizeGroups([null, { ...group, questionIds: ['missing'] }], items), []);
  assert.equal(topics.normalizeGroups([{ ...group, questionIds: ['a', 'a'] }], items)[0].questionIds.length, 2, 'retain repeated slots printed in an original packet');
  assert.equal(topics.normalizeGroups([group, group], items).length, 1);
  assert.deepEqual(topics.normalizeGroups(undefined, items), []);
});

test('shared prompts are read without changing the stored clue', () => {
  const question = 'Empire that it ruled.';
  const group = { topic: 'Julio-Claudian Dynasty', prompt: 'Concerning the Julio-Claudian dynasty, name the...' };
  assert.equal(topics.spokenQuestion(group, question), group.topic + '. ' + group.prompt + ' ' + question);
  assert.equal(topics.spokenQuestion(group, group.prompt + ' ' + question), group.prompt + ' ' + question);
  assert.equal(topics.spokenQuestion(null, question), question);
});

test('Library third-quarter browsing uses packet membership, preserves slots, and keeps set indices', () => {
  const items = [
    { id: 'long', question: 'An ungrouped short clue.', answer: 'Other', meta: { category: 'Europe', era: '05' } },
    { id: 'b', question: 'Second clue.', answer: 'Two', meta: { category: 'Europe', era: '06' } },
    { id: 'a', question: 'First clue.', answer: 'One', meta: { category: 'North America', era: '06' } }
  ];
  const group = { id: 'g', topic: 'Eisenhower', prompt: 'Name the...', packet: 'Bowl-Round-1.pdf', questionIds: ['a', 'b', 'a'] };
  const set = { items, bowlThirdQuarterGroups: [group] };
  const entries = topics.libraryEntries(set, { thirdQuarterOnly: true });
  assert.deepEqual(entries.map(e => [e.it.id, e.idx, e.number]), [['a', 2, 1], ['b', 1, 2], ['a', 2, 3]]);
  assert.equal(topics.libraryEntries(set).length, 3, 'ordinary browsing retains ungrouped questions');
  assert.equal(topics.libraryEntries(set, { thirdQuarterOnly: true, topicId: 'missing' }).length, 0);
  assert.equal(topics.libraryEntries({ items }, { thirdQuarterOnly: true }).length, 0);
  assert.equal(topics.libraryEntries(set, { thirdQuarterOnly: true, query: 'eisenhower' }).length, 3, 'search finds topic headings');
  assert.equal(topics.libraryEntries(set, { thirdQuarterOnly: true, query: 'round-1', category: 'Europe', era: '06' }).length, 1);
  assert.equal(topics.libraryEntries(set, { thirdQuarterOnly: true, query: 'Two' })[0].it.id, 'b');
});
