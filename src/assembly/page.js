// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// PAGE ASSEMBLY
// ----------------------------------------------------------------------------
// One pure function that turns every candidate (thoughts, friend reads, reposts, the friend
// suggestion, extra cards, pick-up cards) into the ordered list a scroll walks through. Thoughts and
// extra cards are placed by one module under one set of rules and checked by one validator.
// (layout.js holds the sampling and the adjacency rules this module builds on.)
//
// HARD rules, checked on every placement and never relaxed. When nothing satisfies them the list
// ends (or the page gets fewer extras): a shorter feed is the accepted cost.
//
//   E1  Only plain thoughts may sit next to each other. A spotlight, friend read, curiosity, poll,
//       repost, suggestion or extra card never touches another non-thought card.
//   E2  No two adjacent cards involve the same person (author, any reader on a friend read, or the
//       person an extra card names).
//   E3  One card per article across the whole list, extras and pick-up included.
//   E4  At most MAX_PER_AUTHOR_PER_PAGE thoughts by one author in a page.
//   E6  At most RESURFACE_PAGE_CAP resurfaced cards (new activity on something already seen) in a
//       page, so reactions cannot crowd out new thoughts.
//
// Preferences, applied only where the hard rules allow:
//   friend reads at 1st, 4th, 7th ... · the suggestion at slot 7 · the viewer's own new
//   thought first · extra cards: EXTRAS_PER_PAGE per page at the preferred slots, only between
//   two thoughts, spaced apart · extra kinds rotate · explore card about every 7th.
//
// What is NOT here: what counts as eligible or resurfaced (ledger.js decides that before this runs)
// and how a card scores (scoring/score.js). The list ends when the candidates do: `exhausted` says so,
// and a "caught up" header follows, then the pick-up cards.
//
// Pure: the only randomness is the `rand` passed in, so the same seed always yields the same list.
// ============================================================================

const C = require('./config');
const { sampleOrder, seededRandom, hashSeed } = require('./layout');
const { applyNewViewerOrder } = require('./newViewer');

const isThought = (c) => !!c && c.kind === 'thought';

/** Everyone a card involves: friend-read readers, an extra card's named people, else the author. */
function peopleOf(c) {
  const ids = (c.reader_ids && c.reader_ids.length) ? c.reader_ids
    : (c.people && c.people.length) ? c.people : [c.author_id];
  return ids.filter(Boolean).map(String);
}
const sharesPerson = (a, b) => {
  const s = new Set(peopleOf(a));
  return peopleOf(b).some((id) => s.has(id));
};

function options(over = {}) {
  return {
    pageSize: C.PAGE_SIZE,
    maxCards: C.MAX_CARDS,
    floor: C.SCORE_FLOOR,
    authorCap: C.MAX_PER_AUTHOR_PER_PAGE,
    resurfaceCap: C.RESURFACE_PAGE_CAP,
    maxLead: C.MAX_LEAD_TRIGGERED,
    friendEvery: C.FRIEND_READ_EVERY,
    suggestionSlot: C.SUGGESTION_SLOT,
    suggestionEarliest: C.SUGGESTION_EARLIEST_SLOT,
    exploreEvery: C.EXPLORE_EVERY,
    extrasPerPage: C.EXTRAS_PER_PAGE,
    extraSlots: C.EXTRA_SLOTS,
    extraMinGap: C.EXTRA_MIN_GAP,
    socialTailMax: C.SOCIAL_TAIL_MAX,
    socialTailKinds: C.SOCIAL_TAIL_KINDS,
    pickupMax: C.PICKUP_MAX,
    // New viewers only (assemble's `newViewer` flag turns these on): see newViewer.js.
    replyQuota: 0,
    interestFloor: 0,
    newViewerWindow: C.NEW_VIEWER_WINDOW,
    ...over,
  };
}

// ── The base list: thoughts and friend reads ────────────────────────────────

function buildBase({ thoughts, friends, suggestion, pinned, rand, o }) {
  const eligible = thoughts.filter((c) => c.score >= o.floor);

  // Friend-triggered cards lead, newest event first, and only the newest few: a very active friend
  // must not turn the top of the feed into their activity log. The rest rank like any other card.
  const trig = eligible.filter((c) => c.priority > 0)
    .sort((a, b) => (b.event_ms || 0) - (a.event_ms || 0));
  const lead = trig.slice(0, o.maxLead);
  const leadSet = new Set(lead);
  // A friend-triggered card past the lead cap is an ordinary card from here on.
  const rest = eligible.filter((c) => !leadSet.has(c)).map((c) => (c.priority > 0 ? { ...c, priority: 0 } : c));
  const sampled = sampleOrder(rest, rand);
  const arranged = (o.replyQuota > 0 || o.interestFloor > 0)
    ? applyNewViewerOrder(sampled, { replyRatio: o.replyQuota, interestRatio: o.interestFloor, window: o.newViewerWindow })
    : sampled;
  const ordered = [...lead, ...arranged];
  const friendOrder = [...friends].sort((a, b) => b.score - a.score);

  const used = new Set();
  const articles = new Set();
  const placed = [];

  const pageWindow = () => {
    const start = Math.floor(placed.length / o.pageSize) * o.pageSize;
    return placed.slice(start);
  };

  const fits = (c) => {
    if (used.has(c)) return false;
    if (c.article_id != null && articles.has(String(c.article_id))) return false;             // E3
    const prev = placed[placed.length - 1];
    if (prev) {
      if (!isThought(c) && !isThought(prev)) return false;                                    // E1
      if (sharesPerson(c, prev)) return false;                                                // E2
    }
    if (c.kind !== 'friend_read' && c.author_id != null) {                                    // E4
      const n = pageWindow().filter((p) => p.kind !== 'friend_read'
        && String(p.author_id) === String(c.author_id)).length;
      if (n >= o.authorCap) return false;
    }
    if (c.resurfaced && pageWindow().filter((p) => p.resurfaced).length >= o.resurfaceCap) {  // E6
      return false;
    }
    return true;
  };
  const firstFit = (list, pred = () => true) => list.find((c) => pred(c) && fits(c)) || null;
  const place = (c) => {
    used.add(c);
    if (c.article_id != null) articles.add(String(c.article_id));
    placed.push(c);
  };

  const isFriendSlot = (p) => p % o.friendEvery === 0;
  const isExploreSlot = (p) => p % o.exploreEvery === o.exploreEvery - 2;

  if (pinned) place(pinned);

  let exhausted = false;
  while (placed.length < o.maxCards) {
    const p = placed.length;
    const friendsLeft = friendOrder.some((c) => !used.has(c));
    let pick = null;

    // The suggestion takes a friend slot: its own, or an earlier one no friend read is using.
    const suggestionDue = suggestion && !used.has(suggestion) && isFriendSlot(p)
      && (p === o.suggestionSlot || (p >= o.suggestionEarliest && !friendsLeft));
    if (suggestionDue && fits(suggestion)) pick = suggestion;
    if (!pick && isFriendSlot(p) && friendsLeft) pick = firstFit(friendOrder);

    // Protect the next friend slot one step early: this card is what the friend read will sit next
    // to, so it must be a plain thought that shares no person and no article with it.
    const suggestionNext = suggestion && !used.has(suggestion) && isFriendSlot(p + 1)
      && (p + 1 === o.suggestionSlot || (p + 1 >= o.suggestionEarliest && !friendsLeft));
    if (!pick && (friendsLeft || suggestionNext) && isFriendSlot(p + 1)) {
      const next = suggestionNext ? suggestion
        : friendOrder.find((f) => !used.has(f)
          && !(f.article_id != null && articles.has(String(f.article_id))));
      const clashes = (c) => next && (
        (c.article_id != null && String(c.article_id) === String(next.article_id))
        || sharesPerson(c, next));
      pick = firstFit(ordered, (c) => isThought(c) && !clashes(c))
        || firstFit(ordered, (c) => isThought(c));
    }

    // Explore stays within the best priority still on offer.
    if (!pick && isExploreSlot(p)) {
      const head = firstFit(ordered);
      const floorPriority = head ? (head.priority || 0) : 0;
      pick = firstFit(ordered, (c) => c.explore && (c.priority || 0) >= floorPriority);
    }
    if (!pick) pick = firstFit(ordered);
    // With a last-read question to place, cards 2 and 3 are plain thoughts so it can sit between them, inside the
    // top three, without two special cards touching. A spotlight that would have been there comes a little later.
    if (o.thoughtPair && (p === 1 || p === 2)) pick = firstFit(ordered, isThought) || pick;
    if (!pick && friendsLeft) pick = firstFit(friendOrder);

    if (!pick) { exhausted = true; break; }
    place(pick);
  }
  return { placed, exhausted };
}

// ── Extra cards, injected page by page into the base list ───────────────────

function injectExtras(base, extras, o, lastRead = null) {
  const pageOf = (i) => Math.floor(i / o.pageSize);
  if ((!extras.length && !lastRead) || !o.extrasPerPage) return base.map((c, i) => ({ ...c, page: pageOf(i) }));

  // One card per article across the whole list: the base list's articles are claimed up front.
  const claimed = new Set(base.map((c) => c.article_id).filter((v) => v != null).map(String));
  const takenKeys = new Set();
  let lastKind = null; let lastVariant = null;
  const counts = {};
  const out = [];

  for (let start = 0; start < base.length; start += o.pageSize) {
    const pi = pageOf(start);
    const items = base.slice(start, start + o.pageSize);
    const prevTail = start === 0 ? null : base[start - 1];
    const leftOf = (g) => (g === 0 ? prevTail : items[g - 1]);
    // A gap g sits before items[g]; the end of the page is never used (the next page's first card is
    // not known yet). Both neighbours must be plain thoughts.
    const gapOk = (g) => {
      const l = leftOf(g);
      return (l == null || isThought(l)) && isThought(items[g]);
    };
    const usedGaps = [];
    const farEnough = (g) => usedGaps.every((u) => Math.abs(u - g) > o.extraMinGap);
    const findGap = (want) => {
      for (let d = 0; d < items.length; d++) {
        for (const g of d === 0 ? [want] : [want + d, want - d]) {
          if (g >= 0 && g < items.length && gapOk(g) && farEnough(g)) return g;
        }
      }
      return -1;
    };

    const chosen = [];
    // The question on the article read last leads page 1, inside the top three, between two thoughts. It may
    // share an article with a thought (E3 does not apply to it): the viewer has read that article.
    if (start === 0 && lastRead) {
      for (const g of [2, 1, 0]) {
        if (g >= items.length || !gapOk(g)) continue;
        const l = leftOf(g); const r = items[g];
        if ((l && sharesPerson(lastRead, l)) || (r && sharesPerson(lastRead, r))) continue;
        chosen.push({ c: lastRead, gap: g });
        usedGaps.push(g);
        takenKeys.add(lastRead.key);
        counts[lastRead.kind] = (counts[lastRead.kind] || 0) + 1;
        lastKind = lastRead.kind; lastVariant = lastRead.variant || null;
        break;
      }
    }
    for (const want of o.extraSlots.slice(0, o.extrasPerPage)) {
      if (chosen.length >= o.extrasPerPage) break;
      const gap = findGap(want);
      if (gap < 0) continue;
      const l = leftOf(gap); const r = items[gap];

      // Rotate kinds: the kind used least goes first, and not the kind just placed unless nothing else has one.
      const kinds = [...new Set(extras.map((c) => c.kind))]
        .sort((a, b) => (counts[a] || 0) - (counts[b] || 0));
      const order = [...kinds.filter((k) => k !== lastKind), ...kinds.filter((k) => k === lastKind)];
      let pick = null;
      for (const kind of order) {
        const pool = extras
          .filter((c) => c.kind === kind && !takenKeys.has(c.key)
            && !(c.article_id != null && claimed.has(String(c.article_id)))                  // E3
            && !(l && sharesPerson(c, l)) && !(r && sharesPerson(c, r)))                      // E2
          .sort((a, b) => ((b.variant !== lastVariant) - (a.variant !== lastVariant)) || (b.score - a.score));
        if (pool.length) { pick = pool[0]; break; }
      }
      if (!pick) break;
      chosen.push({ c: pick, gap });
      usedGaps.push(gap);
      takenKeys.add(pick.key);
      if (pick.article_id != null) claimed.add(String(pick.article_id));
      counts[pick.kind] = (counts[pick.kind] || 0) + 1;
      lastKind = pick.kind;
      lastVariant = pick.variant || null;
    }

    const page = items.map((c) => ({ ...c, page: pi }));
    [...chosen].sort((a, b) => b.gap - a.gap)
      .forEach(({ c, gap }) => page.splice(gap, 0, { ...c, extra: true, page: pi }));
    out.push(...page);
  }
  return out;
}

// ── Friend news at the end of the list ─────────────────────────────────────

/**
 * Extra cards go between two thoughts, so a viewer with few or no thoughts left would never see a friend's new
 * identity card or milestone. At the end of the list (the feed is exhausted) up to `socialTailMax` of the newest
 * friend-news extras not already placed are added, even though no thought sits between them. Different kinds may touch
 * (an identity card then a milestone), but never two of one kind, never one person twice in a row (E2), and never a
 * repeated article (E3).
 */
function buildSocialTail(extras, claimedArticles, prev, o, offset) {
  const claimed = new Set(claimedArticles);
  const pool = extras.filter((c) => o.socialTailKinds.includes(c.kind)).sort((a, b) => b.score - a.score);
  const out = [];
  let last = prev;
  for (const c of pool) {
    if (out.length >= o.socialTailMax) break;
    if (c.article_id != null && claimed.has(String(c.article_id))) continue;           // E3
    if (last && sharesPerson(c, last)) continue;                                       // E2
    if (last && last.kind === c.kind) continue;                                        // never two of a kind together
    out.push({ ...c, extra: true, social_tail: true, page: Math.floor((offset + out.length) / o.pageSize) });
    if (c.article_id != null) claimed.add(String(c.article_id));
    last = c;
  }
  return out;
}

// ── Pick-up: after "you're all caught up" ───────────────────────────────────

/** `pickup` arrives ordered by the caller (newest activity first); this only applies the hard rules. */
function buildPickup(pickup, claimedArticles, o) {
  const articles = new Set(claimedArticles);
  const used = new Set();
  const placed = [];
  const fits = (c) => {
    if (used.has(c)) return false;
    if (c.article_id != null && articles.has(String(c.article_id))) return false;             // E3
    const prev = placed[placed.length - 1];
    if (prev) {
      if (!isThought(c) && !isThought(prev)) return false;                                    // E1
      if (sharesPerson(c, prev)) return false;                                                // E2
    }
    if (c.author_id != null) {                                                                // E4
      const start = Math.floor(placed.length / o.pageSize) * o.pageSize;
      const n = placed.slice(start).filter((p) => String(p.author_id) === String(c.author_id)).length;
      if (n >= o.authorCap) return false;
    }
    return true;
  };
  while (placed.length < o.pickupMax) {
    const pick = pickup.find(fits);
    if (!pick) break;
    used.add(pick);
    if (pick.article_id != null) articles.add(String(pick.article_id));
    placed.push(pick);
  }
  return placed.map((c, i) => ({ ...c, section: 'pickup', page: `pickup:${Math.floor(i / o.pageSize)}` }));
}

/**
 * @param thoughts    [{ key, kind, article_id, author_id, score, explore?, resurfaced?, priority?, event_ms? }]
 *                    kind: thought | spotlight | curiosity | poll | reposted_reply
 * @param friends     [{ key, kind:'friend_read', article_id, reader_ids, score }]
 * @param suggestion  one { key, kind:'friend_suggestion', reader_ids, score } or null
 * @param extras      [{ key, kind, article_id, people, score, variant? }] curiosity_question | invite | topic_friend | identity_share
 * @param pickup      [{ key, kind, article_id, author_id, label, ... }] already ordered
 * @param pinned      the viewer's own new thought, placed first
 * @param lastRead    the AI question on the article the viewer read last, placed in the top three (marked last_read)
 * @param newViewer   true while the viewer has too little reading to have a taste (affinity.isNewViewer): the opening is
 *                    arranged by newViewer.js. Thoughts then carry `replies`, `on_interest` and, for the person who
 *                    invited the viewer, `referrer: true` (scoreThought returns `onInterest` and `referrer`).
 * @returns { items, exhausted, caught_up_at }
 *   items carry `section` ('main' | 'header' | 'pickup'), `page`, and `extra: true` on extra cards.
 */
function assemble({
  thoughts = [], friends = [], suggestion = null, extras = [], pickup = [], recycle = [], pinned = null, lastRead = null, rand, options: over,
  newViewer = false,
}) {
  const o = options({
    ...(newViewer ? { replyQuota: C.NEW_VIEWER_REPLY_QUOTA, interestFloor: C.NEW_VIEWER_INTEREST_FLOOR } : {}),
    ...over,
  });
  const { placed, exhausted } = buildBase({ thoughts, friends, suggestion, pinned, rand, o: { ...o, thoughtPair: !!lastRead } });
  const main = injectExtras(placed, extras, o, lastRead).map((c) => ({ ...c, section: 'main' }));
  // Only after a regular thought (or on an empty list): a tail card must not touch a spotlight, a question or another extra.
  if (exhausted && (!main.length || isThought(main[main.length - 1]))) {
    const placedKeys = new Set(main.filter((c) => c.extra).map((c) => c.key));
    const claimed = main.map((c) => c.article_id).filter((v) => v != null).map(String);
    const tail = buildSocialTail(extras.filter((c) => !placedKeys.has(c.key)), claimed, main[main.length - 1] || null, o, main.length);
    main.push(...tail.map((c) => ({ ...c, section: 'main' })));
  }
  const items = [...main];
  let caughtUpAt = null;
  if (exhausted) {
    caughtUpAt = main.length;
    items.push({ kind: 'caught_up_header', key: 'caught_up:header', section: 'header' });
    const claimed = items.map((c) => c.article_id).filter((v) => v != null).map(String);
    const picked = buildPickup(pickup, claimed, o);
    items.push(...picked);
    // Nothing new left, so the best of what was seen before comes round again rather than an empty end.
    if (recycle.length) {
      const taken = [...claimed, ...picked.map((c) => c.article_id).filter((v) => v != null).map(String)];
      const again = buildPickup(recycle, taken, { ...o, pickupMax: C.RECYCLE_MAX });
      items.push(...again.map((c, i) => ({ ...c, recycled: true, page: `pickup:${Math.floor((picked.length + i) / o.pageSize)}` })));
    }
  }
  return { items, exhausted, caught_up_at: caughtUpAt };
}

/** Checks a finished list against the hard rules. Used by tests and by debug mode. */
function violations(items, over) {
  const o = options(over);
  const out = [];
  const articles = new Set();
  let prev = null;
  const byPage = new Map();
  items.forEach((c, i) => {
    if (c.section === 'header') { prev = null; return; }
    if (prev) {
      if (!isThought(c) && !isThought(prev) && !(c.social_tail && prev.social_tail && c.kind !== prev.kind)) out.push(`E1@${i}:${prev.kind}+${c.kind}`);
      if (sharesPerson(c, prev)) out.push(`E2@${i}`);
    }
    // The last-read question may sit beside a thought on the same article, so it neither checks nor claims one.
    if (c.article_id != null && !c.last_read) {
      if (articles.has(String(c.article_id))) out.push(`E3@${i}:${c.article_id}`);
      articles.add(String(c.article_id));
    }
    const page = byPage.get(c.page) || { authors: new Map(), resurfaced: 0, extras: [] };
    if (!c.extra && c.kind !== 'friend_read' && c.author_id != null) {
      const k = String(c.author_id);
      page.authors.set(k, (page.authors.get(k) || 0) + 1);
    }
    if (c.resurfaced && c.section === 'main') page.resurfaced++;
    if (c.extra && !c.social_tail) page.extras.push(i);
    byPage.set(c.page, page);
    prev = c;
  });
  for (const [pg, page] of byPage) {
    for (const [a, n] of page.authors) if (n > o.authorCap) out.push(`E4@page${pg}:${a}=${n}`);
    if (page.resurfaced > o.resurfaceCap) out.push(`E6@page${pg}:${page.resurfaced}`);
    if (page.extras.length > o.extrasPerPage) out.push(`extras@page${pg}:extras=${page.extras.length}`);
    for (let j = 1; j < page.extras.length; j++) {
      if (page.extras[j] - page.extras[j - 1] <= o.extraMinGap) out.push(`extras@page${pg}:gap`);
    }
  }
  const lead = items.filter((c) => c.section === 'main' && c.priority > 0).length;
  if (lead > o.maxLead) out.push(`lead:${lead}`);
  return out;
}

module.exports = { assemble, violations, options, peopleOf, seededRandom, hashSeed };
