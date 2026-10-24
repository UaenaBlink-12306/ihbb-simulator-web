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
