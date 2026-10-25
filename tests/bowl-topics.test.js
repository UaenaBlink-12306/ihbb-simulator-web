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
    assert.ok(group.topic && /\.(pdf|docx)$/i.test(group.packet));
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

test('Library set searches return complete packages, even when only one clue matches a metadata filter', () => {
  const items = [
    { id: 'other', question: 'Ungrouped short question.', answer: 'Other', meta: { category: 'Europe', era: '05' } },
    { id: 'b', question: 'Satellite clue.', answer: 'Sputnik', meta: { category: 'World', era: '06' } },
    { id: 'a', question: 'Vice president clue.', answer: 'Nixon', meta: { category: 'North America', era: '06' } }
  ];
  const group = { id: 'g', topic: 'Eisenhower Administration', prompt: 'Name the...', packet: 'Canada/Bowl-Round-1.pdf', questionIds: ['a', 'b', 'a'] };
  const variant = { ...group, id: 'g2', packet: 'US/Bowl-Round-2.pdf', questionIds: ['b', 'a'] };
  const set = { items, bowlThirdQuarterGroups: [group, variant] };
  const results = topics.librarySets(set, { query: 'Eisenhower', category: 'World', era: '06' });
  assert.equal(results.length, 2, 'results count packages, not individual clues');
  assert.deepEqual(results[0].items.map(item => item.id), ['a', 'b', 'a'], 'all original slots stay together');
  assert.equal(topics.librarySets(set, { query: 'Canada' })[0].group.id, 'g');
  assert.equal(topics.librarySets(set, { query: 'Nixon' }).length, 0, 'package search uses topic and packet, not loose answers');
  assert.equal(topics.librarySets(set, { topicId: 'g2' })[0].items.length, 2);
  assert.deepEqual(topics.librarySets(set, { topicId: 'missing' }), []);
  assert.deepEqual(topics.librarySets({ items }), []);
  assert.equal(topics.libraryEntries(set, { query: 'Nixon' }).length, 1, 'ordinary question browsing still works');
});

test('the official topic catalog exposes one full package for every original group', () => {
  const sets = topics.librarySets(bank);
  assert.equal(sets.length, bank.bowlThirdQuarterGroups.length);
  for (const entry of sets) assert.deepEqual(entry.items.map(item => item.id), entry.group.questionIds);
});


test('the official Asia archive contributes every complete Bowl topic alongside existing divisions', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/ASIA_ARCHIVE_IMPORT.json'), 'utf8'));
  const asia = bank.bowlThirdQuarterGroups.filter(group => group.packet.startsWith('Asia/'));
  assert.equal(asia.length, 615);
  assert.equal(new Set(asia.map(group => group.packet)).size, 205);
  assert.equal(asia.filter(group => group.packet.endsWith('.docx')).length, 42);
  assert.equal(inventory.packets.filter(packet => packet.status === 'imported').length, 308);
  assert.equal(inventory.packets.filter(packet => packet.status === 'unavailable').length, 2);
  const grouped = new Map();
  for (const group of asia) {
    const list = grouped.get(group.packet) || [];
    list.push(group);
    grouped.set(group.packet, list);
  }
  for (const packet of inventory.packets.filter(packet => packet.status === 'imported')) {
    assert.equal(packet.unmatchedAnswerMarkers, 0, packet.path);
    assert.deepEqual((grouped.get(packet.path) || []).map(group => [group.topic, group.questionIds.length]), packet.thirdQuarterTopics.map(topic => [topic.topic, topic.questionCount]));
  }
});

test('Asia Boxer Rebellion packets retain the first clue despite a printed ANSWR typo', () => {
  const group = bank.bowlThirdQuarterGroups.find(group => group.packet === 'Asia/2020-2021-question-sets/VarsityJV_Bowl-Round-2.pdf' && group.topic === 'Boxer Rebellion');
  const questions = topics.groupItems(bank, group.id);
  assert.equal(questions.length, 8);
  assert.match(questions[0].answer, /Christianity/);
  assert.match(questions[7].answer, /Cixi/);
});

test('native Asia Word packets expose their original complete topic order', () => {
  const group = bank.bowlThirdQuarterGroups.find(group => group.packet === 'Asia/2019-2020-question-sets/2019-2020-IHBB-Alpha_Bowl-Round-1.docx' && group.topic === 'Andrew Carnegie');
  const questions = topics.groupItems(bank, group.id);
  assert.equal(questions.length, 8);
  assert.match(questions[0].answer, /steel/i);
  assert.match(questions[1].answer, /Pittsburgh/);
});
