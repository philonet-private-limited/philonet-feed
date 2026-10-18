// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarise } = require('../src/activity');

const at = (min) => new Date(Date.UTC(2026, 0, 1, 12, min));
const row = (over) => ({ comment_id: 1, uid: 'u1', action: 'reply', at: at(0), name: 'Alex', pic: '', ...over });

test('a reply is an action, a resonate is a reaction, and the two are kept apart', () => {
  const m = summarise([row({ action: 'reply', at: at(5) }), row({ uid: 'u2', action: 'resonate', at: at(9), name: 'Sam' })]);
  const e = m.get('1');
  assert.equal(e.action_ms, at(5).getTime());
  assert.equal(e.react_ms, at(9).getTime());
  assert.deepEqual([...e.reactors.keys()], ['u2']);
  assert.equal(e.counts.reply, 1);
  assert.equal(e.counts.resonate, 1);
  assert.equal(e.latest.user_id, 'u2');
});

test('an award inside the discussion is kept apart from one on the thought', () => {
  const m = summarise([row({ action: 'star', scope: 'discussion' }), row({ uid: 'u2', action: 'star', scope: 'thought' })]);
  const e = m.get('1');
  assert.ok(e.lastByAction.has('star_discussion'));
  assert.ok(e.lastByAction.has('star'));
});

test('rows with no usable time are skipped', () => {
  assert.equal(summarise([row({ at: 'not a time' })]).size, 0);
});
