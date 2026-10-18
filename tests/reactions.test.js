// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarise, after, KINDS } = require('../src/reactions');

test('five kinds, insightful the default', () => {
  assert.deepEqual(KINDS, ['insightful', 'agree', 'support', 'like', 'love']);
});

test('people with no recorded kind count as insightful, and the kinds add up to the total', () => {
  const s = summarise({ total: 4, otherKinds: { love: 1, agree: 1 } });
  assert.deepEqual(s.kinds, { agree: 1, love: 1, insightful: 2 });
  assert.equal(Object.values(s.kinds).reduce((a, b) => a + b, 0), s.total);
});

test('the viewer with an engagement and no kind has the default', () => {
  assert.equal(summarise({ total: 1, engaged: true }).my_reaction, 'insightful');
  assert.equal(summarise({ total: 1, engaged: true, mine: 'love', otherKinds: { love: 1 } }).my_reaction, 'love');
  assert.equal(summarise({ total: 1, engaged: false }).my_reaction, null);
});

test('tapping gives, switches and takes back a reaction', () => {
  let s = summarise({ total: 3, otherKinds: { like: 1 } });
  s = after(s, 'love');
  assert.deepEqual(s, { total: 4, my_reaction: 'love', kinds: { like: 1, love: 1, insightful: 2 } });
  s = after(s, 'agree');                                  // a switch does not add a person
  assert.equal(s.total, 4);
  assert.deepEqual(s.kinds, { like: 1, agree: 1, insightful: 2 });
  s = after(s, 'agree');                                  // the same again takes it back
  assert.deepEqual(s, { total: 3, my_reaction: null, kinds: { like: 1, insightful: 2 } });
});

test('an unknown kind changes nothing', () => {
  const s = summarise({ total: 2 });
  assert.equal(after(s, 'funny'), s);
});
