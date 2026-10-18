// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { assemble, violations } = require('../src/assembly/layout');

const NOW = Date.UTC(2026, 9, 12);
const H = 3600000;
let n = 0;
const card = (hoursAgo, over = {}) => {
  n += 1;
  return { kind: 'thought', comment_id: n, article_id: n, author_id: `a${n}`, created_ms: NOW - hoursAgo * H,
    score: 0.5, tier: 0, explore: false, ...over };
};
const rand = () => 0.5;

test('chronological: newest first, whatever the score or tier', () => {
  const old = card(100, { score: 0.9, tier: 2 });
  const mid = card(10, { score: 0.1, tier: 0 });
  const fresh = card(1, { score: 0.05, tier: 0 });    // below the usual score floor, still listed
  const { cards } = assemble({ thoughts: [old, mid, fresh], rand, chronological: true });
  assert.deepEqual(cards.map((c) => c.comment_id), [fresh.comment_id, mid.comment_id, old.comment_id]);
});

test('ranked mode is unchanged: the unseen tier still leads', () => {
  const seenNew = card(1, { score: 0.9, tier: 0 });
  const unseenOld = card(100, { score: 0.5, tier: 2 });
  const { cards } = assemble({ thoughts: [seenNew, unseenOld], rand });
  assert.equal(cards[0].comment_id, unseenOld.comment_id);
});

test('chronological: the layout rules still hold', () => {
  const a = card(1, { kind: 'spotlight', author_id: 'x' });
  const b = card(2, { kind: 'spotlight', author_id: 'y' });   // may not sit next to another spotlight
  const c = card(3, { author_id: 'z' });
  const { cards } = assemble({ thoughts: [a, b, c], rand, chronological: true });
  assert.deepEqual(violations(cards), []);
  assert.equal(cards[0].comment_id, a.comment_id);
});
