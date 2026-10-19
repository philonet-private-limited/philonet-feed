// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// TASTE: what the viewer cares about, from what they did.
// Pure functions. The inputs (reads, signal events, declared interests) come from whatever store you keep them in.
// ============================================================================

const C = require('./config');

const DAY_MS = 86400000;

/**
 * Author affinity in [0, 1], RELATIVE to the viewer's most-engaged author.
 *
 * Was n / (n + 3), which approaches 1 for anyone engaged with a handful of
 * times — and an active reader has engaged with nearly everyone a handful of
 * times, so every author scored 0.91–0.998 and the term ranked nothing.
 * Relative scaling keeps it discriminating: the top author is 1, one with a
 * quarter of that engagement is 0.5 (square root, so the tail is not crushed).
 */
function authorAffinity(rows) {
  const max = Math.max(0, ...rows.map((r) => Number(r.n) || 0));
  return new Map(rows.map((r) => [String(r.author_id), max > 0 ? Math.sqrt((Number(r.n) || 0) / max) : 0]));
}

/**
 * Topic affinity in [0, 1] per topic, keyed `p:<parent_id>` and `n:<child name>`.
 *
 * Every signal is turned into minutes of reading on its topic: reading itself (its thinking time), and the
 * other things the viewer did (C.SIGNAL_MINUTES: an insightful mark, a star, their own thought or reply, an
 * opened discussion, a bookmark). Two decayed sums are kept:
 *   long   AFFINITY_HALF_LIFE_DAYS (30), the viewer's settled taste
 *   short  SHORT_HALF_LIFE_DAYS (3), what they are into right now
 * each scaled so the strongest topic is 1, then blended (SHORT_BLEND of the short one). A topic read or marked
 * today therefore lifts at once, and one a month of history built does not vanish overnight.
 * Declared interests are blended in as a prior whose weight shrinks as real activity accumulates:
 *   λ = DECLARED_PRIOR_HOURS / (DECLARED_PRIOR_HOURS + hours of activity)
 * so a new account runs on what they said they like, and a heavy reader on what they actually did.
 *
 * @param events  [{ kind, at, raw_category }] from SIGNALS_SQL; empty when that could not be read.
 */
function topicAffinity(reads, declared, resolve, now, events = []) {
  const long = new Map(); const short = new Map();
  let totalMs = 0;
  const add = (map, k, w) => map.set(k, (map.get(k) || 0) + w);
  const credit = (rawCategory, ms, atMs) => {
    const cat = resolve(rawCategory);
    const ageDays = Math.max(0, (now - atMs) / DAY_MS);
    const wl = ms * Math.pow(0.5, ageDays / C.AFFINITY_HALF_LIFE_DAYS);
    const ws = ms * Math.pow(0.5, ageDays / C.SHORT_HALF_LIFE_DAYS);
    if (cat.parent_id != null) { add(long, `p:${cat.parent_id}`, wl); add(short, `p:${cat.parent_id}`, ws); }
    if (cat.child_name) {
      const k = `n:${String(cat.child_name).toLowerCase()}`;
      add(long, k, wl); add(short, k, ws);
    }
  };
  for (const r of reads) {
    totalMs += r.thinking_time;
    credit(r.raw_category, r.thinking_time, new Date(r.updated_at).getTime());
  }
  for (const e of events) {
    const minutes = C.SIGNAL_MINUTES[e.kind];
    if (!minutes) continue;
    const ms = minutes * 60000;
    if (ms > 0) totalMs += ms;                       // only real interest counts toward how much activity there is
    credit(e.raw_category, ms, new Date(e.at).getTime());
  }
  // A topic can go negative ("not interested"): it is scaled against the strongest positive one and floored at 0.
  const scaled = (map) => {
    const max = Math.max(0, ...map.values());
    return (k) => (max > 0 ? Math.max(0, map.get(k) || 0) / max : 0);
  };
  const longOf = scaled(long); const shortOf = scaled(short);
  const topics = new Map();
  for (const k of new Set([...long.keys(), ...short.keys()])) {
    topics.set(k, (1 - C.SHORT_BLEND) * longOf(k) + C.SHORT_BLEND * shortOf(k));
  }

  const hours = totalMs / 3600000;
  const lambda = C.DECLARED_PRIOR_HOURS / (C.DECLARED_PRIOR_HOURS + hours);
  const keys = new Set([...topics.keys(), ...[...declared].map((id) => `p:${id}`)]);
  const blended = new Map();
  for (const k of keys) {
    const fromActivity = topics.get(k) || 0;
    const fromDeclared = k.startsWith('p:') && declared.has(Number(k.slice(2))) ? 1 : 0;
    blended.set(k, (1 - lambda) * fromActivity + lambda * fromDeclared);
  }
  return { topics: blended, readHours: hours };
}

/**
 * True while the viewer has too little reading to have a taste yet: fewer than NEW_VIEWER_MAX_READS reads of at
 * least READ_MS. Set `profile.newViewer` from this; the new-viewer rules (a reply prior and a referrer lift in
 * scoring, the interest floor and reply quota in assembly) key off it.
 *
 * Declared interests must be read fresh on every request, not from a profile cached earlier: a new viewer saves them
 * seconds before their first feed, and a stale profile would score that whole first page as if they had declared
 * nothing.
 */
function isNewViewer(qualifyingReads) {
  return C.NEW_VIEWER_REPLY_PRIOR_ON && Number(qualifyingReads) < C.NEW_VIEWER_MAX_READS;
}

module.exports = { topicAffinity, authorAffinity, isNewViewer };
