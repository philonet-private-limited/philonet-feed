// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreThought, replyPrior, referrerPrior } = require('../src/scoring/score');
const { isNewViewer } = require('../src/scoring/affinity');

const NOW = Date.UTC(2026, 9, 12);
const DAY = 86400000;
const stats = { platformMean: 0.5, p95: 1 };
const base = { topics: new Map(), authors: new Map(), friendReads: new Map(), friends: new Set() };
const newcomer = { ...base, newViewer: true };
const regular = { ...base, newViewer: false };

const thought = (over = {}) => ({
  comment_id: 1, url_key: 'u1', type: 'text', created_ms: NOW - 2 * DAY,
  author_id: 'a', parent_id: 1, last_reply_ms: null, replies: 0, ...over,
});
const score = (t, profile) => scoreThought(t, { profile, stats, now: NOW, readState: new Map(), exposure: new Map() });

test('a new viewer scores a thread with replies above the same thought with none', () => {
  const none = score(thought({ replies: 0 }), newcomer).score;
  const one = score(thought({ replies: 1 }), newcomer).score;
  const three = score(thought({ replies: 3 }), newcomer).score;
  assert.ok(one > none, `${one} > ${none}`);
  assert.ok(three > one, `${three} > ${one}`);
});

test('more replies than the table covers count as the last entry', () => {
  assert.equal(score(thought({ replies: 40 }), newcomer).score, score(thought({ replies: 3 }), newcomer).score);
});

test('an established viewer gets no reply prior; the ratio between the two viewers is exactly the prior', () => {
  assert.equal(replyPrior(thought({ replies: 5 }), regular), 1);
  for (const replies of [0, 1, 2, 5]) {
    const t = thought({ replies });
    const ratio = score(t, newcomer).score / score(t, regular).score;
    assert.ok(Math.abs(ratio - replyPrior(t, newcomer)) < 1e-9, `replies=${replies} ratio=${ratio}`);
  }
});

test('with no replies a new viewer is marked down, not hidden', () => {
  assert.ok(replyPrior(thought({ replies: 0 }), newcomer) < 1);
  assert.ok(score(thought({ replies: 0 }), newcomer));
});

test('the referrer gets a small lift while the viewer is new, and only their own thoughts', () => {
  const withReferrer = { ...newcomer, referrerId: 'ref1' };
  const mine = thought({ author_id: 'ref1', replies: 1 });
  const other = thought({ author_id: 'someone', replies: 1 });
  const lift = score(mine, withReferrer).score / score(mine, newcomer).score;
  assert.ok(lift > 1 && lift <= 1.5, `lift ${lift}`);
  assert.equal(score(other, withReferrer).score, score(other, newcomer).score);
  assert.equal(referrerPrior(mine, { ...regular, referrerId: 'ref1' }), 1);
  assert.equal(referrerPrior(mine, newcomer), 1);
});

test('the debug breakdown names the priors, only when they applied', () => {
  const bd = score(thought({ author_id: 'ref1', replies: 2 }), { ...newcomer, referrerId: 'ref1' }).breakdown;
  assert.equal(bd.replies, 2);
  assert.ok(bd.reply_prior > 1);
  assert.ok(bd.referrer_prior > 1);
  const plain = score(thought({ replies: 2 }), regular).breakdown;
  assert.equal(plain.reply_prior, undefined);
  assert.equal(plain.referrer_prior, undefined);
});

test('the result says whether a thought is on the viewer\'s interest', () => {
  const interested = { ...newcomer, topics: new Map([['p:1', 1]]) };
  assert.equal(score(thought({ parent_id: 1 }), interested).onInterest, true);
  assert.equal(score(thought({ parent_id: 2 }), interested).onInterest, false);
});

test('a viewer is new with fewer than five qualifying reads', () => {
  assert.equal(isNewViewer(0), true);
  assert.equal(isNewViewer(4), true);
  assert.equal(isNewViewer(5), false);
  assert.equal(isNewViewer(10136), false);
});
