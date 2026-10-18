// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { topicAffinity } = require('../src/scoring/affinity');

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 15);
const CATS = { physics: { parent_id: 8, parent_name: 'Science', child_name: 'Physics' },
  business: { parent_id: 3, parent_name: 'Business', child_name: 'Markets' },
  history: { parent_id: 2, parent_name: 'History', child_name: 'Ancient' } };
const resolve = (raw) => CATS[raw] || { parent_id: null, parent_name: null, child_name: null };
const read = (cat, minutes, daysAgo) => ({ raw_category: cat, thinking_time: minutes * 60000, updated_at: new Date(NOW - daysAgo * DAY) });
const ev = (kind, cat, daysAgo = 0) => ({ kind, raw_category: cat, at: new Date(NOW - daysAgo * DAY) });
const topicOf = (r, k) => r.topics.get(k) || 0;

// A month of business reading, nothing in physics.
const history = [read('business', 120, 10), read('business', 90, 20), read('history', 40, 25)];

test('reading a physics article today lifts physics straight away', () => {
  const before = topicAffinity(history, new Set(), resolve, NOW);
  const after = topicAffinity([...history, read('physics', 15, 0)], new Set(), resolve, NOW);
  assert.ok(topicOf(after, 'p:8') > topicOf(before, 'p:8') + 0.25, `${topicOf(before, 'p:8')} -> ${topicOf(after, 'p:8')}`);
  assert.ok(topicOf(after, 'n:physics') > 0.3);
});

test('an insightful mark on a physics thought lifts physics even with no reading on it', () => {
  const before = topicAffinity(history, new Set(), resolve, NOW);
  const after = topicAffinity(history, new Set(), resolve, NOW, [ev('insightful', 'physics')]);
  assert.ok(topicOf(after, 'p:8') > topicOf(before, 'p:8'));
});

test('a star counts for more than an insightful mark, which counts for more than a resonate', () => {
  const score = (kind) => topicOf(topicAffinity(history, new Set(), resolve, NOW, [ev(kind, 'physics')]), 'p:8');
  assert.ok(score('star') > score('insightful'));
  assert.ok(score('insightful') > score('resonate'));
});

test('writing your own thought on a topic is a strong signal', () => {
  const score = (kind) => topicOf(topicAffinity(history, new Set(), resolve, NOW, [ev(kind, 'physics')]), 'p:8');
  assert.ok(score('thought') > score('reply'));
  assert.ok(score('reply') > score('resonate'));
});

test('the same signal today counts for more than a month ago', () => {
  const at = (days) => topicOf(topicAffinity(history, new Set(), resolve, NOW, [ev('star', 'physics', days)]), 'p:8');
  assert.ok(at(0) > at(30));
  assert.ok(at(30) > at(100));
});

test('unknown signal kinds and unresolved categories are ignored, not fatal', () => {
  const r = topicAffinity(history, new Set(), resolve, NOW, [ev('mystery', 'physics'), ev('star', 'nowhere')]);
  assert.ok(topicOf(r, 'p:3') > 0);
});

test('with no signals the result is still built from reading, and values stay in [0, 1]', () => {
  const r = topicAffinity(history, new Set([8]), resolve, NOW, []);
  for (const v of r.topics.values()) assert.ok(v >= 0 && v <= 1);
  assert.ok(topicOf(r, 'p:3') > topicOf(r, 'p:2'));
});

test('"not interested in this topic" pulls the topic down, never below zero', () => {
  const liked = [read('physics', 30, 2)];
  const base = topicAffinity([...liked, ...history], new Set(), resolve, NOW);
  const after = topicAffinity([...liked, ...history], new Set(), resolve, NOW,
    [ev('not_interested_topic', 'physics', 0), ev('not_interested_topic', 'physics', 0)]);
  assert.ok(topicOf(after, 'p:8') < topicOf(base, 'p:8'));
  assert.ok(topicOf(after, 'p:8') >= 0);
});

test('following a topic is a standing interest, read later and go deeper add to it', () => {
  const none = topicAffinity(history, new Set(), resolve, NOW);
  const followed = topicAffinity(history, new Set(), resolve, NOW, [ev('follow', 'physics')]);
  assert.ok(topicOf(followed, 'p:8') > topicOf(none, 'p:8') + 0.15);
  const later = topicAffinity(history, new Set(), resolve, NOW, [ev('read_later', 'physics'), ev('go_deeper', 'physics')]);
  assert.ok(topicOf(later, 'p:8') > topicOf(none, 'p:8'));
});

test('the author of a muted thought is scored down by the configured factor', () => {
  const { scoreThought } = require('../src/scoring/score');
  const t = { comment_id: 1, article_id: 1, author_id: 'au1', url_key: 'k', created_ms: NOW - DAY, parent_id: 8,
    type: 'text', readers: 3, viewers: 20, text_len: 200 };
  const profile = (muted) => ({ topics: new Map([['p:8', 1]]), authors: new Map(), friendReads: new Map(),
    friends: new Set(), declared: new Set(), blocked: new Set(), dismissed: new Set(), readState: new Map(),
    mutedAuthors: new Set(muted) });
  const stats = { platformMean: 0.5, p95: 1 };
  const run = (muted) => scoreThought(t, { profile: profile(muted), readState: new Map(), exposure: new Map(), stats, now: NOW, ignoreWindow: true });
  const normal = run([]).score; const mutedScore = run(['au1']).score;
  assert.ok(Math.abs(mutedScore - normal * 0.1) < 1e-9, `${normal} vs ${mutedScore}`);
});
