// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyNewViewerOrder } = require('../src/assembly/newViewer');
const { assemble, violations, seededRandom } = require('../src/assembly/page');

let n = 0;
const card = (over = {}) => {
  n++;
  return { key: `thought:${n}`, kind: 'thought', article_id: 5000 + n, author_id: `a${n}`, score: 0.9, replies: 0, on_interest: false, ...over };
};
// Scores fall strictly with position in the list, so earlier cards are "better" and the list is in score order.
const build = (spec) => spec
  .flatMap(([count, over]) => Array.from({ length: count }, () => card(over)))
  .map((c, i) => (c.score === 0.9 ? { ...c, score: 0.9 - i * 0.004 } : c));
const first = (cards, k = 10) => cards.filter((c) => c.kind === 'thought' && !c.extra).slice(0, k);
const share = (cards, pred) => cards.filter(pred).length / cards.length;
const OPEN = { replyRatio: 0.8, interestRatio: 0.8, window: 30 };

// Off-interest, unanswered cards score best, then the cards a new viewer should see.
const world = () => build([[15, {}], [10, { on_interest: true }], [10, { replies: 2 }], [15, { on_interest: true, replies: 2 }]]);

test('the first ten are boosted toward interests and conversations', () => {
  const top = first(applyNewViewerOrder(world(), OPEN));
  assert.ok(share(top, (c) => c.on_interest) >= 0.7);
  assert.ok(share(top, (c) => c.replies > 0) >= 0.7);
});

test('a card that does both is taken before one that does only one', () => {
  const c = first(applyNewViewerOrder(world(), OPEN))[0];
  assert.ok(c.on_interest && c.replies > 0);
});

test('the referrer\'s own post counts as a conversation', () => {
  const mine = card({ referrer: true, score: 0.2 });
  const out = applyNewViewerOrder([...build([[8, {}]]), mine], { replyRatio: 0.8, window: 30 });
  assert.equal(out[0], mine);
});

test('nothing is lost or duplicated, and cards stay in score order inside each group', () => {
  const input = world();
  const out = applyNewViewerOrder(input, OPEN);
  assert.equal(out.length, input.length);
  assert.equal(new Set(out).size, input.length);
  const both = out.filter((c) => c.on_interest && c.replies > 0);
  for (let i = 1; i < both.length; i++) assert.ok(both[i - 1].score >= both[i].score);
});

test('past the window the ordinary score order resumes', () => {
  const tail = applyNewViewerOrder(world(), { ...OPEN, window: 10 }).slice(10);
  for (let i = 1; i < tail.length; i++) assert.ok(tail[i - 1].score >= tail[i].score);
});

test('when no card qualifies the opening still fills with the best cards', () => {
  const input = build([[20, {}]]);
  assert.deepEqual(applyNewViewerOrder(input, OPEN), input);
});

test('friend-triggered cards and non-plain cards are not moved', () => {
  const lead = card({ priority: 1 });
  const spot = card({ kind: 'spotlight' });
  const out = applyNewViewerOrder([lead, spot, ...world()], OPEN);
  assert.equal(out[0], lead);
  assert.equal(out[1], spot);
});

test('both targets off leaves the list untouched', () => {
  const input = world();
  assert.equal(applyNewViewerOrder(input, {}), input);
});

test('page assembly for a new viewer keeps every hard rule and opens with conversations on interest', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const r = assemble({ thoughts: world(), rand: seededRandom(seed), newViewer: true });
    assert.deepEqual(violations(r.items), [], `seed ${seed}`);
    const top = first(r.items.filter((c) => c.section === 'main'));
    assert.ok(share(top, (c) => c.replies > 0) >= 0.6, `seed ${seed}: replies ${share(top, (c) => c.replies > 0)}`);
    assert.ok(share(top, (c) => c.on_interest) >= 0.6, `seed ${seed}: interest ${share(top, (c) => c.on_interest)}`);
  }
});

test('page assembly for an established viewer is unchanged', () => {
  const input = world();
  const a = assemble({ thoughts: input, rand: seededRandom(3) }).items.map((c) => c.key);
  const b = assemble({ thoughts: input, rand: seededRandom(3), newViewer: false }).items.map((c) => c.key);
  assert.deepEqual(a, b);
});
