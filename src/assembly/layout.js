// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// LAYOUT (sampling and adjacency rules)
// ----------------------------------------------------------------------------
// Turns scored candidates into the ordered list a scroll walks through.
//
// HARD rules. Checked on every placement, never relaxed — when no candidate
// satisfies them the list ends, and a shorter feed is the accepted cost:
//
//   1. Only plain thoughts may sit next to each other. A spotlight, friend
//      read, curiosity or poll must never touch another non-thought card.
//   2. No two adjacent cards involve the same person — author of a thought,
//      or any reader named on a friend-read card.
//   3. One card per article across the whole list.
//   4. At most MAX_PER_AUTHOR_PER_PAGE thoughts by one author per page.
//
// Preferences, applied only where the hard rules allow:
//   friend reads at 1st, 4th, 7th … · one explore card every EXPLORE_EVERY ·
//   the viewer's own just-published thought pinned first.
//
// Pure: the only randomness comes from the `rand` passed in, so the same seed
// always yields the same list.
// ============================================================================

const C = require('../scoring/config');

/** Seeded PRNG (mulberry32). */
function seededRandom(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string, for seeding from a session id. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Order candidates by sampling rather than strict sort, so two refreshes are
 * not identical while the best cards stay near the top.
 *
 * Plackett–Luce over a sliding window of the top SAMPLE_POOL: each next card is
 * drawn with weight exp((s − s_max) / (T · s_max)). At T = 0.15 a card scoring
 * 10% below the leader is drawn about half as often; one scoring 50% below,
 * almost never.
 */
function sampleOrder(cards, rand, { pool = C.SAMPLE_POOL, temperature = C.SAMPLE_TEMPERATURE, limit = Infinity } = {}) {
  const rest = [...cards].sort((a, b) => b.score - a.score);
  const out = [];
  while (rest.length > 0 && out.length < limit) {
    const n = Math.min(pool, rest.length);
    const top = rest[0].score > 0 ? rest[0].score : 1;
    let total = 0;
    const w = new Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = Math.exp((rest[i].score - top) / (temperature * top));
      total += w[i];
    }
    let r = rand() * total;
    let pick = 0;
    for (; pick < n - 1; pick++) { r -= w[pick]; if (r <= 0) break; }
    out.push(rest.splice(pick, 1)[0]);
  }
  return out.concat(rest);
}

const isFriendSlot = (p) => p % 3 === 0;
const isExploreSlot = (p) => p % C.EXPLORE_EVERY === C.EXPLORE_EVERY - 2;

/**
 * Builds the session's ordered card list.
 *
 * @param thoughts  [{ kind, article_id, author_id, score, explore, ... }]
 * @param friends   [{ kind: 'friend_read', article_id, reader_ids, score, ... }]
 * @param pinned    optional thought card to place first
 * @returns { cards, caught_up }
 */
function assemble({ thoughts, friends = [], suggestion = null, fallback = [], pinned = null, rand, maxCards = 150, pageSize = C.PAGE_SIZE, chronological = false }) {
  // Chronological: the pool is the thoughts already filtered by the caller (a recency window), and
  // the order is simply newest first. No score floor, tiers, sampling or explore picks; the hard
  // rules below still decide what may sit where.
  const eligible = chronological ? thoughts : thoughts.filter((c) => c.score >= C.CAUGHT_UP_SCORE);
  // Unseen first, always. Tiers are placed in order — never shown, then revived
  // by a new reply, then already seen — and score/sampling only decide order
  // WITHIN a tier. A multiplicative novelty penalty alone was not enough: a
  // strong card seen several times still outscored most unseen ones, so a
  // refresh kept leading with cards the viewer had already scrolled past.
  const tierOf = (c) => (c.tier == null ? 0 : c.tier);
  const tiers = [...new Set(eligible.map(tierOf))].sort((a, b) => b - a);
  const ordered = chronological
    ? [...eligible].sort((a, b) => (b.created_ms || 0) - (a.created_ms || 0))
    : tiers.flatMap((t) => sampleOrder(eligible.filter((c) => tierOf(c) === t), rand));
  const friendOrder = [...friends].sort((a, b) => b.score - a.score);

  const used = new Set();          // card identity
  const articles = new Set();      // rule 3
  const placed = [];

  const peopleOf = (c) => (c.reader_ids ? c.reader_ids : [c.author_id]).filter(Boolean).map(String);

  const fits = (c) => {
    if (used.has(c)) return false;
    if (c.article_id != null && articles.has(String(c.article_id))) return false;           // 3
    const prev = placed[placed.length - 1];
    if (prev) {
      if (c.kind !== 'thought' && prev.kind !== 'thought') return false;                     // 1
      const prevPeople = new Set(peopleOf(prev));
      if (peopleOf(c).some((id) => prevPeople.has(id))) return false;                        // 2
    }
    if (c.kind !== 'friend_read' && c.author_id != null) {                                   // 4
      const pageStart = Math.floor(placed.length / pageSize) * pageSize;
      let n = 0;
      for (let i = pageStart; i < placed.length; i++) {
        if (placed[i].kind !== 'friend_read' && String(placed[i].author_id) === String(c.author_id)) n++;
      }
      if (n >= C.MAX_PER_AUTHOR_PER_PAGE) return false;
    }
    return true;
  };

  const firstFit = (list, pred = () => true) => list.find((c) => pred(c) && fits(c)) || null;

  const place = (c) => {
    used.add(c);
    if (c.article_id != null) articles.add(String(c.article_id));
    placed.push(c);
  };

  if (pinned) place(pinned);

  let caughtUp = false;
  let caughtUpAt = null;
  while (placed.length < maxCards) {
    const p = placed.length;
    const friendsLeft = friendOrder.some((c) => !used.has(c));
    let pick = null;

    // The suggestion takes a friend slot (see SUGGESTION_SLOT): its own slot,
    // or an earlier friend slot no friend read is using.
    const suggestionDue = suggestion && !used.has(suggestion) && isFriendSlot(p)
      && (p === C.SUGGESTION_SLOT || (p >= C.SUGGESTION_EARLIEST_SLOT && !friendsLeft));
    if (suggestionDue && fits(suggestion)) pick = suggestion;
    if (!pick && isFriendSlot(p) && friendsLeft) pick = firstFit(friendOrder);

    // ── Protect the next friend slot ─────────────────────────────────────────
    //
    // Friend reads sit at 1st, 4th, 7th … whenever one exists: a fixed rhythm
    // is easier to read than cards that wander. The slot is decided here, one
    // step EARLY, because this is the card the friend read will sit next to.
    // It must be a plain thought (rule 1) and must not involve any reader of
    // the friend read that will follow (rule 2) — otherwise the rules would
    // correctly refuse the friend read and the rhythm would break, as it did
    // when a friend's own thought landed just before their
    // friend-read card.
    const suggestionNext = suggestion && !used.has(suggestion) && isFriendSlot(p + 1)
      && (p + 1 === C.SUGGESTION_SLOT || (p + 1 >= C.SUGGESTION_EARLIEST_SLOT && !friendsLeft));
    if (!pick && (friendsLeft || suggestionNext) && isFriendSlot(p + 1)) {
      const next = suggestionNext ? suggestion : friendOrder.find((f) => !used.has(f)
        && !(f.article_id != null && articles.has(String(f.article_id))));
      const clashes = (c) => next && (
        (c.article_id != null && String(c.article_id) === String(next.article_id))
        || peopleOf(c).some((id) => next.reader_ids.map(String).includes(id)));
      pick = firstFit(ordered, (c) => c.kind === 'thought' && !clashes(c))
        || firstFit(ordered, (c) => c.kind === 'thought');
    }

    // Explore stays within the best tier still on offer, so a seen card never leads
    // ahead of unseen ones purely because it is an explore pick.
    if (!pick && !chronological && isExploreSlot(p)) {
      const head = firstFit(ordered);
      const floorTier = head ? tierOf(head) : 0;
      pick = firstFit(ordered, (c) => c.explore && tierOf(c) >= floorTier);
    }
    if (!pick) pick = firstFit(ordered);
    // A friend read may fill an ordinary slot when no thought fits it.
    if (!pick && friendsLeft) pick = firstFit(friendOrder);

    // The fresh list is spent: keep going from the fallback (archive, then
    // revisit — ordered by the caller), under the same hard rules. Where this
    // starts is recorded so the page can say "you're caught up" at that point
    // instead of ending the feed.
    if (!pick && fallback.length) {
      pick = firstFit(fallback);
      if (pick && caughtUpAt == null) caughtUpAt = placed.length;
    }

    if (!pick) { caughtUp = true; break; }
    place(pick);
  }

  return { cards: placed, caught_up: caughtUp, caught_up_at: caughtUpAt };
}

/** Checks a finished list against the hard rules. Used by tests and by debug mode. */
function violations(cards, pageSize = C.PAGE_SIZE) {
  const out = [];
  const people = (c) => (c.reader_ids ? c.reader_ids : [c.author_id]).filter(Boolean).map(String);
  const seenArticles = new Set();
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const prev = cards[i - 1];
    if (prev && c.kind !== 'thought' && prev.kind !== 'thought') out.push(`kind@${i}:${prev.kind}+${c.kind}`);
    if (prev) {
      const pp = new Set(people(prev));
      if (people(c).some((id) => pp.has(id))) out.push(`person@${i}`);
    }
    if (c.article_id != null) {
      if (seenArticles.has(String(c.article_id))) out.push(`article@${i}:${c.article_id}`);
      seenArticles.add(String(c.article_id));
    }
  }
  for (let s = 0; s < cards.length; s += pageSize) {
    const counts = new Map();
    for (const c of cards.slice(s, s + pageSize)) {
      if (c.kind === 'friend_read' || c.author_id == null) continue;
      const k = String(c.author_id);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    for (const [k, n] of counts) if (n > C.MAX_PER_AUTHOR_PER_PAGE) out.push(`cap@page${s / pageSize}:${k}=${n}`);
  }
  return out;
}

module.exports = { assemble, sampleOrder, seededRandom, hashSeed, violations };
