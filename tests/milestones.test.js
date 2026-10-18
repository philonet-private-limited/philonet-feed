// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const ms = require('../src/milestones');

const HOUR = 3600000; const MIN = 60000;
const NOW = Date.UTC(2026, 9, 16, 6, 0, 0);
const row = (over = {}) => ({ milestone_id: 1, user_id: 'owner', topic_key: 'paleontology', topic_label: 'paleontology', category_id: 8,
  rung_ms: 30 * MIN, ms_at_reach: 1847732, achieved_at: new Date(NOW - 2 * HOUR), name: 'Alex Morgan', display_pic: 'p', ...over });
const art = (i, min) => ({ url: `https://site${i}.com/a`, ms: min * MIN, article_id: 100 + i, title: `Article ${i}`, thumbnail_url: `img${i}` });

test('a milestone card carries the owner, the rung, the stack and what the viewer has read', () => {
  const c = ms.buildCandidate(row(), [1, 2, 3, 4, 5, 6, 7].map((i) => art(i, 10 - i)), 12 * MIN, { parent_id: 8, parent_name: 'Science' }, NOW);
  assert.equal(c.kind, 'milestone');
  assert.equal(c.key, 'milestone:1');
  const d = ms.cardOf(c);
  assert.equal(d.card_type, 'milestone');
  assert.equal(d.key, 'milestone:1');
  assert.equal(d.rung_label, '30 minutes');
  assert.equal(d.category_name, 'Science');
  assert.equal(d.articles.length, 5);                  // the stack
  assert.equal(d.article_count, 7);                    // everything behind it
  assert.equal(d.articles[0].site, 'site1.com');
  assert.equal(d.articles[0].url, 'https://site1.com/a');    // so the app can open it
  assert.match(d.reading_line, /^Read .* in Paleontology$/);
  assert.equal(d.viewer_ms, 12 * MIN);
  assert.equal(d.friends, undefined);                  // no friends line on this card
});

test('a topic the viewer has not read has viewer_ms 0 ("a new topic for you")', () => {
  const c = ms.buildCandidate(row(), [art(1, 5)], 0, null, NOW);
  assert.equal(c.data.viewer_ms, 0);
});

test('a milestone with nothing to stack is not a card', () => {
  assert.equal(ms.buildCandidate(row(), [], 0, null, NOW), null);
  assert.equal(ms.buildCandidate(row(), [{ url: 'https://x.com', ms: 1, title: '   ' }], 0, null, NOW), null);
  assert.equal(ms.buildCandidate(row(), [{ ms: 1, title: 'No link' }], 0, null, NOW), null);   // cannot be opened
});

test('a newer milestone outranks an older one', () => {
  const fresh = ms.buildCandidate(row({ achieved_at: new Date(NOW - HOUR) }), [art(1, 5)], 0, null, NOW);
  const old = ms.buildCandidate(row({ achieved_at: new Date(NOW - 40 * HOUR) }), [art(1, 5)], 0, null, NOW);
  assert.ok(fresh.score > old.score);
  assert.ok(old.score > 3);                            // still above an ordinary extra
});

test('one friend reaching many rungs is capped, and so is the total', () => {
  const mk = (owner, n, age) => ms.buildCandidate(row({ milestone_id: n, user_id: owner, achieved_at: new Date(NOW - age * HOUR) }), [art(1, 5)], 0, null, NOW);
  const list = [];
  for (let i = 0; i < 6; i++) list.push(mk('busy', 100 + i, i + 1));            // six rungs from one friend
  for (let i = 0; i < 10; i++) list.push(mk(`f${i}`, 200 + i, i + 2));          // ten friends, one each
  const capped = ms.capCandidates(list);
  assert.equal(capped.filter((c) => c.data.owner.user_id === 'busy').length, 2);
  assert.equal(capped.length, 8);
});

