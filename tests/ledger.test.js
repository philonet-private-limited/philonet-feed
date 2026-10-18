// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { activityMs, eligibility, clampSeenAt } = require('../src/ledger');

const NOW = Date.UTC(2026, 9, 13);
const DAY = 86400000;
const HOUR = 3600000;

test('a card never seen is eligible and is not a resurface', () => {
  const r = eligibility({ kind: 'thought' }, undefined);
  assert.deepEqual([r.eligible, r.resurfaced], [true, false]);
});

test('a seen card with no newer activity is not eligible', () => {
  const row = { last_activity_seen_ms: NOW };
  assert.equal(eligibility({ kind: 'thought', last_reply_ms: NOW - HOUR }, row).eligible, false);
  assert.equal(eligibility({ kind: 'thought' }, row).eligible, false);
});

test('a seen card comes back for each kind of new activity, and is marked resurfaced', () => {
  const row = { last_activity_seen_ms: NOW - DAY };
  for (const field of ['last_reply_ms', 'friend_react_ms', 'friend_action_ms', 'award_ms', 'invite_ms']) {
    const r = eligibility({ kind: 'thought', [field]: NOW - HOUR }, row);
    assert.deepEqual([field, r.eligible, r.resurfaced], [field, true, true]);
  }
});

test('activity at the very moment of the sighting is already seen', () => {
  const row = { last_activity_seen_ms: NOW };
  assert.equal(eligibility({ kind: 'thought', friend_react_ms: NOW }, row).eligible, false);
  assert.equal(eligibility({ kind: 'thought', friend_react_ms: NOW + 1 }, row).eligible, true);
});

test('a spotlight comes back only for a reply, never for a friend action', () => {
  const row = { last_activity_seen_ms: NOW - DAY };
  for (const field of ['friend_react_ms', 'friend_action_ms', 'award_ms', 'invite_ms']) {
    assert.equal(eligibility({ kind: 'spotlight', [field]: NOW - HOUR }, row).eligible, false, field);
  }
  assert.equal(eligibility({ kind: 'spotlight', last_reply_ms: NOW - HOUR }, row).eligible, true);
  assert.equal(activityMs({ kind: 'spotlight', friend_react_ms: NOW }), 0);
});

test('a thought takes the newest of its activity kinds', () => {
  assert.equal(activityMs({ kind: 'thought', last_reply_ms: 5, friend_react_ms: 9, award_ms: 7 }), 9);
  assert.equal(activityMs({ kind: 'thought' }), 0);
});

test('a reported sighting time is clamped: not in the future, not older than two days', () => {
  assert.equal(clampSeenAt(NOW + DAY, NOW), NOW);
  assert.equal(clampSeenAt(NOW - 10 * DAY, NOW), NOW - 2 * DAY);
  assert.equal(clampSeenAt(NOW - HOUR, NOW), NOW - HOUR);
  assert.equal(clampSeenAt(undefined, NOW), NOW);
  assert.equal(clampSeenAt('x', NOW), NOW);
});

test('a sighting reported without a time is stamped now, not two days ago', () => {
  assert.equal(clampSeenAt(null, NOW), NOW);
  assert.equal(clampSeenAt('', NOW), NOW);
  assert.equal(clampSeenAt(0, NOW), NOW - 2 * DAY, 'an explicit epoch time is genuinely old and is clamped');
});
