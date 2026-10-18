// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreThought } = require('../src/scoring/score');

const NOW = Date.UTC(2026, 9, 12);
const DAY = 86400000;
const profile = { topics: new Map(), authors: new Map(), friendReads: new Map(), friends: new Set() };
const stats = { platformMean: 0.5, p95: 1 };

const thought = (over = {}) => ({
  comment_id: 1, url_key: 'u1', type: 'quote_feature', created_ms: NOW - 2 * DAY,
  author_id: 'a', parent_id: 1, last_reply_ms: null, ...over,
});
// `seen` is the app having reported the card on screen; without it a card was only served.
const score = (t, { shown, impressions = 1, read, seen = true, sources } = {}) => {
  const exposure = new Map(shown == null ? [] : [[String(t.comment_id), { impressions, last_ms: shown, seen }]]);
  if (sources) exposure.sources = sources;
  return scoreThought(t, {
    profile, stats, now: NOW,
    readState: new Map(read ? [[t.url_key, read]] : []),
    exposure,
  });
};

test('a spotlight never shown is eligible', () => {
  assert.ok(score(thought()));
});

test('a spotlight already shown is not shown again, however long ago', () => {
  assert.equal(score(thought(), { shown: NOW - 60 * 60 * 1000 }), null);
  assert.equal(score(thought(), { shown: NOW - 30 * DAY }), null);
  assert.equal(score(thought(), { shown: NOW - 30 * DAY, impressions: 6 }), null);
});

test('a shown spotlight returns for a reply that arrived after it was shown', () => {
  const shown = NOW - DAY;
  assert.equal(score(thought({ last_reply_ms: shown - 1000 }), { shown }), null);
  assert.ok(score(thought({ last_reply_ms: shown + 1000 }), { shown }));
});

test('a plain thought is still rotated back, not hidden', () => {
  assert.ok(score(thought({ type: 'text' }), { shown: NOW - 60 * 60 * 1000 }));
});

test('served but never seen is still unseen: top tier, and a spotlight is not removed', () => {
  const served = { shown: NOW - 60 * 60 * 1000, impressions: 5, seen: false };
  const sp = score(thought(), served);
  assert.ok(sp, 'a spotlight that was only served is still eligible');
  assert.equal(sp.tier, 2);
  const th = score(thought({ type: 'text' }), served);
  assert.equal(th.tier, 2);
  assert.ok(th.breakdown.novelty >= 0.6, 'only a small discount for having been served');
});

test('seen on screen: a thought drops to the seen tier and decays', () => {
  const th = score(thought({ type: 'text' }), { shown: NOW - 60 * 60 * 1000, seen: true });
  assert.equal(th.tier, 0);
  assert.ok(th.breakdown.novelty < 0.1);
});

test('if the app-seen source cannot be read, a serve counts as a sighting', () => {
  assert.equal(score(thought(), { shown: NOW - 3600000, seen: false, sources: { app_seen: false } }), null);
  assert.ok(score(thought(), { shown: NOW - 3600000, seen: false, sources: { app_seen: true } }));
});
