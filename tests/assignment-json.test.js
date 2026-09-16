const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../assignment-json');
test('assignment JSON accepts exported formats and preserves numeric answers and metadata', () => {
  for (const wrap of [items => items, items => ({items}), questions => ({questions})]) {
    const result = parse(JSON.stringify(wrap([{q:'How many?', a:0, aliases:['zero'], category:'History', source:'Packet'}])), 'Quiz.json');
    assert.equal(result.items[0].answer, '0');
    assert.deepEqual(result.items[0].aliases, ['zero']);
    assert.equal(result.items[0].meta.source, 'Packet');
    assert.equal(result.title, 'Quiz');
  }
  assert.equal(parse('\uFEFF{"title":"Homework","items":[{"question_text":"Q","answer_text":"A"}]}').title, 'Homework');
});
test('assignment JSON rejects malformed, empty, oversized and incomplete question lists', () => {
  for (const input of ['{', '{}', '[]', '[{"question":"Q"}]', '[{"question":{},"answer":"A"}]', '[{"question":"Q","answer":"A","aliases":[{}]}]', JSON.stringify(Array(201).fill({q:'Q',a:'A'}))]) {
    assert.throws(() => parse(input));
  }
});
test('uploaded rows with repeated external IDs remain individually selectable', () => {
  const {items} = parse('[{"id":1,"q":"One","a":"A"},{"id":1,"q":"Two","a":"B"}]');
  assert.notEqual(items[0].id, items[1].id);
});
