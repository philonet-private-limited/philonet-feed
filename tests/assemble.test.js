// SPDX-License-Identifier: Apache-2.0
const test = require('node:test');
const assert = require('node:assert/strict');
const { assemble, violations, seededRandom } = require('../src/assembly/page');

let n = 0;
const thought = (over = {}) => {
  n++;
  return { key: `thought:${n}`, kind: 'thought', article_id: 1000 + n, author_id: `a${n}`, score: 0.5, ...over };
};
const many = (count, over = {}) => Array.from({ length: count }, () => thought(typeof over === 'function' ? over() : over));
const friendRead = (over = {}) => {
  n++;
  return { key: `fr:${n}`, kind: 'friend_read', article_id: 2000 + n, reader_ids: [`f${n}`], score: 0.5, ...over };
};
const extra = (kind, over = {}) => {
  n++;
  return { key: `${kind}:${n}`, kind, article_id: 3000 + n, people: [`x${n}`], score: 0.5, ...over };
};
const run = (input, seed = 7) => assemble({ rand: seededRandom(seed), ...input });
const mainOf = (r) => r.items.filter((c) => c.section === 'main');
const base = (r) => mainOf(r).filter((c) => !c.extra);

test('a plain list of thoughts breaks no rule and uses every candidate', () => {
  const r = run({ thoughts: many(25) });
  assert.deepEqual(violations(r.items), []);
  assert.equal(base(r).length, 25);
  assert.equal(r.exhausted, true);
});

test('E1: spotlights, curiosity and polls never touch another non-thought card', () => {
  const odd = ['spotlight', 'curiosity', 'poll'];
  const pool = [...many(12), ...odd.flatMap((kind) => many(4, { kind }))];
  for (let seed = 1; seed <= 30; seed++) {
    const r = run({ thoughts: pool }, seed);
    assert.deepEqual(violations(r.items), [], `seed ${seed}`);
  }
});

test('E2: the same person is never in two adjacent cards', () => {
  const pool = [...many(6, { author_id: 'same' }), ...many(10)];
  const r = run({ thoughts: pool });
  assert.deepEqual(violations(r.items), []);
  const items = mainOf(r);
  for (let i = 1; i < items.length; i++) assert.notEqual(items[i].author_id, items[i - 1].author_id);
});

test('E3: one card per article across the whole list, extras included', () => {
  const dup = [thought({ article_id: 7 }), thought({ article_id: 7 }), thought({ article_id: 7 }), ...many(12)];
  const r = run({ thoughts: dup, extras: [extra('invite', { article_id: 7 }), extra('curiosity_question')] });
  assert.deepEqual(violations(r.items), []);
  assert.equal(r.items.filter((c) => String(c.article_id) === '7').length, 1);
});

test('E4: at most two thoughts by one author per page of ten', () => {
  const pool = [...many(8, { author_id: 'busy' }), ...many(30)];
  const r = run({ thoughts: pool });
  assert.deepEqual(violations(r.items), []);
  const perPage = new Map();
  for (const c of base(r)) if (c.author_id === 'busy') perPage.set(c.page, (perPage.get(c.page) || 0) + 1);
  for (const v of perPage.values()) assert.ok(v <= 2);
});

test('items below the score floor are never shown, whatever else is left', () => {
  const r = run({ thoughts: [...many(5, { score: 0.5 }), ...many(5, { score: 0.05 })] });
  assert.equal(base(r).length, 5);
  assert.ok(base(r).every((c) => c.score >= 0.10));
  const strict = run({ thoughts: many(5, { score: 0.12 }), options: { floor: 0.15 } });
  assert.equal(base(strict).length, 0);
});

test('friend reads take the 1st, 4th and 7th positions when they exist', () => {
  const r = run({ thoughts: many(30), friends: [friendRead(), friendRead(), friendRead()] });
  const items = base(r);
  assert.deepEqual([0, 3, 6].map((i) => items[i].kind), ['friend_read', 'friend_read', 'friend_read']);
  assert.deepEqual(violations(r.items), []);
});

test('a friend read is kept away from the same person and the same article', () => {
  const fr = friendRead({ reader_ids: ['pal'], article_id: 55 });
  const pool = [thought({ author_id: 'pal' }), thought({ article_id: 55 }), ...many(20)];
  const r = run({ thoughts: pool, friends: [fr] });
  assert.deepEqual(violations(r.items), []);
  assert.equal(r.items.filter((c) => String(c.article_id) === '55').length, 1);
});

test('the viewer\'s own new thought is placed first', () => {
  const mine = thought({ key: 'mine', pinned: true });
  const r = run({ thoughts: many(15), pinned: mine });
  assert.equal(mainOf(r)[0].key, 'mine');
});

test('E6: at most three resurfaced cards per page', () => {
  const pool = [...many(10, { resurfaced: true, score: 0.9 }), ...many(30, { score: 0.3 })];
  const r = run({ thoughts: pool });
  assert.deepEqual(violations(r.items), []);
  const perPage = new Map();
  for (const c of base(r)) if (c.resurfaced) perPage.set(c.page, (perPage.get(c.page) || 0) + 1);
  for (const v of perPage.values()) assert.ok(v <= 3, `a page had ${v}`);
  assert.equal(base(r).length, 40, 'capped, not dropped: they take later pages');
});

test('friend-triggered cards lead, newest first, and only five of them', () => {
  const trig = Array.from({ length: 8 }, (_, i) => thought({ priority: 1, event_ms: 1000 + i, score: 0.2, resurfaced: false }));
  const r = run({ thoughts: [...trig, ...many(20, { score: 0.9 })] });
  const lead = base(r).slice(0, 5);
  assert.ok(lead.every((c) => c.priority > 0));
  assert.deepEqual(lead.map((c) => c.event_ms), [1007, 1006, 1005, 1004, 1003]);
  assert.equal(base(r).filter((c) => c.priority > 0).length, 5, 'the other three rank as ordinary cards');
  assert.deepEqual(violations(r.items), []);
});

test('F4/F5: extra cards sit between two thoughts, two per page, kinds rotating', () => {
  const extras = [extra('curiosity_question'), extra('curiosity_question'), extra('invite'), extra('topic_friend'), extra('identity_share'), extra('invite')];
  const r = run({ thoughts: many(30), extras });
  assert.deepEqual(violations(r.items), []);
  const ex = mainOf(r).filter((c) => c.extra);
  assert.equal(ex.length, 6, 'two per page across three pages');
  const items = mainOf(r);
  items.forEach((c, i) => {
    if (!c.extra) return;
    assert.equal(items[i - 1].kind, 'thought');
    assert.equal(items[i + 1].kind, 'thought');
  });
  for (let i = 1; i < ex.length; i++) assert.notEqual(ex[i].kind, ex[i - 1].kind, 'kinds rotate where another is available');
});

test('an extra card is never placed beside the person it names', () => {
  const pool = [thought({ author_id: 'ann' }), ...many(25)];
  const r = run({ thoughts: pool, extras: [extra('invite', { people: ['ann'] }), extra('curiosity_question')] });
  assert.deepEqual(violations(r.items), []);
});

test('no extra card means no extra card, and the list is unharmed', () => {
  const r = run({ thoughts: many(12), extras: [] });
  assert.equal(mainOf(r).filter((c) => c.extra).length, 0);
});

test('when the candidates run out: a caught-up header, then the pick-up cards', () => {
  const pickup = [thought({ label: 'invited' }), thought({ label: 'waiting' }), thought({ label: 'own thread' })];
  const r = run({ thoughts: many(12), pickup });
  assert.equal(r.exhausted, true);
  const at = r.items.findIndex((c) => c.section === 'header');
  assert.equal(at, r.caught_up_at);
  assert.equal(r.items[at].kind, 'caught_up_header');
  const after = r.items.slice(at + 1);
  assert.equal(after.length, 3);
  assert.ok(after.every((c) => c.section === 'pickup' && c.label));
  assert.deepEqual(violations(r.items), []);
});

test('pick-up cards obey the hard rules and the cap, and skip articles already shown', () => {
  const shown = thought({ article_id: 99 });
  const pickup = [thought({ article_id: 99, label: 'dup' }), ...many(30, () => ({ label: 'x' }))];
  const r = run({ thoughts: [shown, ...many(5)], pickup });
  const after = r.items.filter((c) => c.section === 'pickup');
  assert.equal(after.length, 15, 'capped at PICKUP_MAX');
  assert.ok(!after.some((c) => String(c.article_id) === '99'));
  assert.deepEqual(violations(r.items), []);
});

test('no caught-up header while the list was only cut short by the session size', () => {
  const r = run({ thoughts: many(60), options: { maxCards: 20 } });
  assert.equal(r.exhausted, false);
  assert.equal(r.caught_up_at, null);
  assert.ok(!r.items.some((c) => c.section === 'header' || c.section === 'pickup'));
});

test('an empty feed still says it is caught up', () => {
  const r = run({ thoughts: [] });
  assert.equal(r.exhausted, true);
  assert.deepEqual(r.items.map((c) => c.kind), ['caught_up_header']);
});

test('the same seed gives the same list; another seed can differ', () => {
  const pool = many(40, () => ({ score: 0.2 + Math.random() * 0 }));
  const a = run({ thoughts: pool }, 5).items.map((c) => c.key);
  const b = run({ thoughts: pool }, 5).items.map((c) => c.key);
  assert.deepEqual(a, b);
});

test('the validator catches each kind of violation', () => {
  const t = (i, over = {}) => ({ kind: 'thought', article_id: i, author_id: `a${i}`, page: 0, section: 'main', ...over });
  assert.ok(violations([t(1, { kind: 'spotlight' }), t(2, { kind: 'poll' })]).some((v) => v.startsWith('E1')));
  assert.ok(violations([t(1, { author_id: 'z' }), t(2, { author_id: 'z' })]).some((v) => v.startsWith('E2')));
  assert.ok(violations([t(1), t(1)]).some((v) => v.startsWith('E3')));
  assert.ok(violations([t(1, { author_id: 'z' }), t(2), t(3, { author_id: 'z' }), t(4), t(5, { author_id: 'z' })]).some((v) => v.startsWith('E4')));
  assert.ok(violations([t(1, { resurfaced: true }), t(2, { resurfaced: true }), t(3, { resurfaced: true }), t(4, { resurfaced: true })]).some((v) => v.startsWith('E6')));
  assert.deepEqual(violations([t(1), t(2)]), []);
});

test('property: a large random mixed pool never breaks a rule, whatever the seed', () => {
  const kinds = ['thought', 'thought', 'thought', 'thought', 'spotlight', 'curiosity', 'poll'];
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = seededRandom(seed * 31);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const thoughts = Array.from({ length: 80 }, (_, i) => ({
      key: `t${seed}-${i}`, kind: pick(kinds), article_id: 1 + Math.floor(rnd() * 70),
      author_id: `a${Math.floor(rnd() * 12)}`, score: 0.05 + rnd(), explore: rnd() < 0.1,
      resurfaced: rnd() < 0.3, priority: rnd() < 0.15 ? 1 : 0, event_ms: Math.floor(rnd() * 1e6),
    }));
    const friends = Array.from({ length: 6 }, (_, i) => ({
      key: `f${seed}-${i}`, kind: 'friend_read', article_id: 100 + Math.floor(rnd() * 70),
      reader_ids: [`a${Math.floor(rnd() * 12)}`, `a${Math.floor(rnd() * 12)}`], score: rnd(),
    }));
    const extras = Array.from({ length: 10 }, (_, i) => ({
      key: `e${seed}-${i}`, kind: pick(['curiosity_question', 'invite', 'topic_friend', 'identity_share']),
      article_id: 1 + Math.floor(rnd() * 170), people: [`a${Math.floor(rnd() * 12)}`], score: rnd(),
    }));
    const suggestion = { key: `s${seed}`, kind: 'friend_suggestion', reader_ids: [`a${Math.floor(rnd() * 12)}`], score: 0.5 };
    const pickup = Array.from({ length: 20 }, (_, i) => ({
      key: `p${seed}-${i}`, kind: 'thought', article_id: 1 + Math.floor(rnd() * 170),
      author_id: `a${Math.floor(rnd() * 12)}`, label: 'x',
    }));
    const r = assemble({ thoughts, friends, suggestion, extras, pickup, rand: seededRandom(seed) });
    assert.deepEqual(violations(r.items), [], `seed ${seed}`);
  }
});

// ── The question on the article read last ───────────────────────────────────

const lastReadCard = (over = {}) => extra('curiosity_question', { source_kind: 'curiosity', variant: 'ai_open', last_read: true, score: 10, ...over });

test('last read question: lands in the top three, between two thoughts, and breaks no rule', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const q = lastReadCard();
    const r = run({ thoughts: many(25), extras: [extra('invite'), extra('topic_friend')], lastRead: q }, seed);
    const items = mainOf(r);
    const at = items.findIndex((c) => c.key === q.key);
    assert.ok(at >= 0 && at <= 2, `seed ${seed}: at ${at}`);
    assert.equal(items[at].last_read, true);
    assert.equal(items[at - 1] && items[at - 1].kind, 'thought');
    assert.equal(items[at + 1].kind, 'thought');
    assert.deepEqual(violations(r.items), [], `seed ${seed}`);
  }
});

test('last read question: shown even when a thought on the same article is in the feed, and only once', () => {
  const t = thought({ article_id: 777 });
  const q = lastReadCard({ article_id: 777 });
  const r = run({ thoughts: [t, ...many(20)], lastRead: q });
  const items = mainOf(r);
  assert.equal(items.filter((c) => c.key === q.key).length, 1);
  assert.equal(items.filter((c) => c.key === t.key).length, 1);
  assert.deepEqual(violations(r.items), []);
});

test('last read question: counts toward the two extras on page one', () => {
  const q = lastReadCard();
  const r = run({ thoughts: many(25), extras: [extra('invite'), extra('topic_friend'), extra('identity_share')], lastRead: q });
  const page1 = mainOf(r).filter((c) => c.page === 0 && c.extra);
  assert.ok(page1.length <= 2, `extras on page 1: ${page1.length}`);
  assert.ok(page1.some((c) => c.key === q.key));
});

test('no last read question, no change', () => {
  const r = run({ thoughts: many(25), extras: [extra('invite')], lastRead: null });
  assert.deepEqual(violations(r.items), []);
});

test('last read question: still in the top three when spotlights fill the feed', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const q = lastReadCard();
    const pool = [...many(14, () => ({ kind: 'spotlight' })), ...many(14)];
    const r = run({ thoughts: pool, extras: [extra('invite')], lastRead: q }, seed);
    const items = mainOf(r);
    const at = items.findIndex((c) => c.key === q.key);
    assert.ok(at >= 0 && at <= 2, `seed ${seed}: at ${at}`);
    assert.deepEqual(violations(r.items), [], `seed ${seed}`);
  }
});

test('after "caught up", seen thoughts worth another look come round, capped, with the pick-up first', () => {
  const recycle = many(30, () => ({ label: { type: 'revisit' } }));
  const pickup = [thought({ label: 'invited' })];
  const r = run({ thoughts: many(5), pickup, recycle });
  const after = r.items.filter((c) => c.section === 'pickup');
  assert.equal(after[0].label, 'invited');
  assert.ok(!after[0].recycled);
  const again = after.filter((c) => c.recycled);
  assert.ok(again.length > 0 && again.length <= 10);
  assert.deepEqual(violations(r.items), []);
});

test('nothing is recycled while there is still something new to show', () => {
  const r = run({ thoughts: many(400), recycle: many(5) });
  assert.equal(r.exhausted, false);
  assert.ok(!r.items.some((c) => c.recycled));
});

test('a milestone extra is placed like any other extra and breaks no rule', () => {
  const extras = [extra('milestone', { people: ['friend1'] }), extra('milestone', { people: ['friend2'] }), extra('curiosity_question')];
  const r = run({ thoughts: many(40), extras });
  assert.deepEqual(violations(r.items), []);
  assert.ok(r.items.some((c) => c.kind === 'milestone'));
});

test('friend news still shows when there are no thoughts: up to three, newest first, curiosity left out', () => {
  const extras = [
    extra('identity_share', { people: ['sam'], score: 3.99 }),
    extra('milestone', { people: ['kim'], score: 3.97 }),
    extra('milestone', { people: ['lee'], score: 3.95 }),
    extra('milestone', { people: ['anu'], score: 3.9 }),
    extra('curiosity_question', { people: ['x'], score: 5 }),
  ];
  const r = run({ thoughts: [], extras });
  assert.equal(r.exhausted, true);
  const main = mainOf(r);
  // an identity card, a milestone, and then no second milestone straight after it
  assert.deepEqual(main.map((c) => c.kind), ['identity_share', 'milestone']);
  assert.ok(main.every((c) => c.social_tail && c.extra));
  assert.deepEqual(violations(r.items), []);
  // the caught-up line follows them
  assert.equal(r.items[main.length].section, 'header');
});

test('the friend-news tail never puts one person twice in a row, nor repeats an article', () => {
  const extras = [
    extra('milestone', { people: ['same'], score: 4 }),
    extra('milestone', { people: ['same'], score: 3.9 }),
    extra('identity_share', { people: ['other'], score: 3.8 }),
    extra('topic_friend', { people: ['third'], article_id: 777, score: 3.7 }),
    extra('topic_friend', { people: ['fourth'], article_id: 777, score: 3.6 }),
  ];
  const r = run({ thoughts: [], extras });
  const main = mainOf(r);
  for (let i = 1; i < main.length; i++) {
    assert.ok(!main[i].people.some((p) => main[i - 1].people.includes(p)), `adjacent ${i}`);
  }
  assert.equal(main.filter((c) => c.article_id === 777).length, 1);
  assert.deepEqual(violations(r.items), []);
});

test('a card already placed between thoughts is not added again at the end, and a long feed gets no tail', () => {
  const placed = run({ thoughts: many(14), extras: [extra('milestone', { people: ['m1'], score: 4 })] });
  const ms = placed.items.filter((c) => c.kind === 'milestone');
  assert.equal(ms.length, 1);
  const long = run({ thoughts: many(400), extras: [extra('identity_share', { people: ['id1'], score: 4 })] });
  assert.equal(long.exhausted, false);
  assert.ok(!long.items.some((c) => c.social_tail));
});

test('the friend-news tail never puts two of one kind together', () => {
  const extras = [
    extra('milestone', { people: ['a'], score: 4 }), extra('milestone', { people: ['b'], score: 3.9 }),
    extra('milestone', { people: ['c'], score: 3.8 }), extra('identity_share', { people: ['d'], score: 3.7 }),
    extra('topic_friend', { people: ['e'], article_id: 801, score: 3.6 }),
  ];
  const r = run({ thoughts: [], extras });
  const main = mainOf(r);
  for (let i = 1; i < main.length; i++) assert.notEqual(main[i].kind, main[i - 1].kind, `adjacent ${i}`);
  assert.deepEqual(violations(r.items), []);
  // only milestones to choose from: one card, not three in a row
  const only = run({ thoughts: [], extras: [extra('milestone', { people: ['a'], score: 4 }), extra('milestone', { people: ['b'], score: 3 })] });
  assert.equal(mainOf(only).length, 1);
});
