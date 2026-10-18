// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// SCORING
// ----------------------------------------------------------------------------
//   score = (W_RELEVANCE · relevance + W_VALUE · value) × freshness × novelty × recency × unseen_new
//
// Pure functions: no database, no clock except the `now` passed in. Every
// number here can be reproduced from the inputs, which is what makes the
// ?debug=1 breakdown trustworthy and the tests exact.
// ============================================================================

const C = require('./config');

const DAY_MS = 86400000;

/** What kind of card a thought renders as. Only 'thought' may sit next to itself. */
function kindOf(t) {
  if (t.type === 'quote_feature') return 'spotlight';
  if (t.curiosity_id) return 'curiosity';
  if (t.type === 'poll') return 'poll';
  return 'thought';
}

/** Half-life for a thought's category. Timeless child names win over the parent. */
function halfLifeFor(t) {
  for (const name of [t.child_name, t.parent_name]) {
    const hit = name && C.HALF_LIFE_BY_NAME[String(name).trim().toLowerCase()];
    if (hit) return hit;
  }
  return C.HALF_LIFE_BY_PARENT[t.parent_id] || C.HALF_LIFE_DEFAULT;
}

/**
 * The viewer's relationship to one thought.
 *
 *   read        they spent READ_MS+ on its article
 *   revived     read, AND a reply has arrived since they read it
 *   settled     read, and nothing new since — excluded from the feed entirely
 *   impressions how many times it has been served to them
 */
function viewerState(t, readState, exposure) {
  const r = readState && readState.get(t.url_key);
  // Read means read THIS thought's article while this thought existed. A thought
  // posted after the viewer last read the article is new to them however long they
  // read before it, so a friend's thought on an article you have already read still reaches your feed.
  const postedAfterRead = !!(r && t.created_ms != null && r.at_ms != null && t.created_ms > r.at_ms);
  const read = !!(r && r.ms >= C.READ_MS) && !postedAfterRead;
  const exp = exposure && exposure.get(String(t.comment_id));
  const repliedSinceRead = read && t.last_reply_ms != null && t.last_reply_ms > r.at_ms;
  // A new reply revives a card ONCE: only if it arrived after the last time the
  // card was shown. ("Any reply after the read" would be satisfied forever by an active discussion,
  // pinning one thought to the top.) Once shown, a replied-to card decays like any other seen card
  // until another new reply arrives.
  const revived = repliedSinceRead && t.last_reply_ms > (exp ? exp.last_ms : 0);
  const impressions = (exp && exp.impressions) || 0;
  // Seen = reported by the app. If that source could not be read, a serve is all there is, so fall
  // back to treating a serve as a sighting rather than call everything unseen.
  const seenTrusted = !(exposure && exposure.sources) || exposure.sources.app_seen !== false;
  const seen = !!exp && (exp.seen === true || !seenTrusted);
  return {
    read,
    revived,
    // Replies you have not opened yet keep it out of "settled"; it just decays.
    settled: read && !repliedSinceRead,
    read_at_ms: r ? r.at_ms : null,
    last_shown_ms: exp ? exp.last_ms : null,
    impressions,
    seen,
    // Unseen first, always: 2 never seen and not read · 1 revived · 0 seen. A card that was only
    // served, never looked at, is still unseen: it keeps its place ahead of the archive.
    tier: revived ? 1 : (!seen && !read ? 2 : 0),
  };
}

/**
 * freshness = max(floor, 0.5 ^ (age / half_life))
 *
 * Age runs from the later of: when the thought was posted, or the newest reply
 * the viewer has not seen. So a new reply revives an old thought — the best
 * evergreen supply a small corpus has.
 */
function freshness(t, state, now) {
  let anchor = t.created_ms;
  if (t.last_reply_ms != null) {
    const unseenReply = state.read_at_ms == null || t.last_reply_ms > state.read_at_ms;
    if (unseenReply) anchor = Math.max(anchor, t.last_reply_ms);
  }
  const ageDays = Math.max(0, (now - anchor) / DAY_MS);
  const { days, floor } = halfLifeFor(t);
  return Math.max(floor, Math.pow(0.5, ageDays / days));
}

/**
 * never shown 1.0 · revived 0.7 · settled null (not shown) · seen:
 *
 *   max(NOVELTY_FLOOR, DECAY ^ impressions) × rotation(time since last shown)
 *
 * Counting showings alone never rotated anything: every seen card lost the same
 * amount per showing, so the strongest seen cards kept winning, in the same
 * order, every refresh. Rotation is about WHEN — a card just shown goes to the
 * back and recovers over ROTATION_HALF_LIFE_HOURS.
 */
function novelty(state, now = Date.now()) {
  if (state.settled) return null;
  if (state.revived) return C.NOVELTY_REVIVED;
  // Served but never seen: still new to them, so a small, flat discount, not the rotation of a seen card.
  if (state.impressions > 0 && !state.seen) {
    return Math.max(C.NOVELTY_SERVED_FLOOR, Math.pow(C.NOVELTY_SERVED_DECAY, state.impressions));
  }
  if (state.impressions > 0) {
    const hours = state.last_shown_ms ? Math.max(0, (now - state.last_shown_ms) / 3600000) : 1e6;
    const rotation = 1 - Math.pow(0.5, hours / C.ROTATION_HALF_LIFE_HOURS);
    return Math.max(C.NOVELTY_FLOOR, Math.pow(C.NOVELTY_UNREAD_DECAY, state.impressions)) * rotation;
  }
  return 1;
}

/**
 * The hard shelf-life rules, which no exemption widens: news types never live past two weeks,
 * high-freshness material only as long as its shelf life (at least a month), and politics / world
 * news only SHORT_WINDOW_DAYS. True when the thought has expired by any of them.
 */
function shelfExpired(t, now) {
  const ageDays = (now - t.created_ms) / DAY_MS;
  const names = [t.child_name, t.parent_name].filter(Boolean).map(String);
  // Shelf life, in any category. News types: never past two weeks.
  // High-freshness anything else: its shelf life, but at least a month.
  const shelf = t.shelf_life_hours > 0 ? t.shelf_life_hours : null;
  const typeCap = C.NEWS_TYPE_MAX_HOURS[String(t.content_type || '').toLowerCase()];
  let maxHours = null;
  if (typeCap != null) maxHours = shelf ? Math.min(shelf, typeCap) : typeCap;
  else if (String(t.freshness_dependency || '').toLowerCase() === 'high' && shelf) {
    maxHours = Math.max(shelf, C.HIGH_FRESHNESS_MIN_HOURS);
  }
  if (maxHours != null && ageDays * 24 > maxHours) return true;
  // Politics / world news: two weeks.
  if (C.SHORT_WINDOW_PARENTS.has(Number(t.parent_id)) || names.some((n) => C.SHORT_WINDOW_NAME.test(n))) {
    return ageDays > C.SHORT_WINDOW_DAYS;
  }
  return false;
}

/** Posted in the last WINDOW_DAYS — or Science / Spirituality, which are exempt. */
function inWindow(t, now) {
  if (shelfExpired(t, now)) return false;
  const ageDays = (now - t.created_ms) / DAY_MS;
  const names = [t.child_name, t.parent_name].filter(Boolean).map(String);
  // Politics / world news inside their two weeks are in the window whatever the 90-day rule says.
  if (C.SHORT_WINDOW_PARENTS.has(Number(t.parent_id)) || names.some((n) => C.SHORT_WINDOW_NAME.test(n))) {
    return true;
  }
  if (ageDays <= C.WINDOW_DAYS) return true;
  // The thought's own category decides. The parent is only a fallback for a
  // thought filed directly under a parent with no child category.
  if (t.child_name) return C.WINDOW_EXEMPT_NAME.test(String(t.child_name));
  if (C.WINDOW_EXEMPT_PARENTS.has(Number(t.parent_id))) return true;
  return !!t.parent_name && C.WINDOW_EXEMPT_NAME.test(String(t.parent_name));
}

/** Recent thoughts weigh more: ×2.5 today, ×1.25 at 8 days, ×0.75 at a month. */
function recencyBoost(t, now) {
  const ageDays = Math.max(0, (now - t.created_ms) / DAY_MS);
  const decay = Math.pow(0.5, ageDays / C.RECENCY_HALF_LIFE_DAYS);
  const peak = 1 + C.RECENCY_BOOST;
  return C.RECENCY_FLOOR + (peak - C.RECENCY_FLOOR) * decay;
}

/**
 * Extra lift for a new card this viewer has never been shown. 1 once it has
 * been shown (or revived / friend-triggered, which have their own rules).
 */
function unseenNewBoost(t, state, now) {
  if (state.seen || state.revived) return 1;
  const ageDays = Math.max(0, (now - t.created_ms) / DAY_MS);
  return 1 + C.UNSEEN_NEW_BOOST * Math.pow(0.5, ageDays / C.UNSEEN_NEW_HALF_LIFE_DAYS);
}

/** Quality prior in [0.3, 1] from the article's own metadata and the thought's shape. */
function qualityPrior(t) {
  const density = Number(t.information_density);
  let q = Number.isFinite(density) ? 0.35 + 0.13 * (Math.min(5, Math.max(1, density)) - 1) : 0.55;
  if (t.has_quote) q += 0.05;
  if (t.has_visual || t.has_table) q += 0.05;
  if (t.text_len >= 120) q += 0.05;
  return Math.min(1, Math.max(0.3, q));
}

/** Weighted engagement events for one thought. */
function engagementEvents(t) {
  const w = C.ENGAGEMENT_WEIGHTS;
  return w.read * (t.readers || 0) + w.reply * (t.replies || 0)
    + w.resonate * (t.resonates || 0) + w.award * (t.awards || 0)
    + w.bookmark * (t.bookmarks || 0);
}

/**
 * Smoothed per-viewer engagement. Every thought starts with ENGAGEMENT_PRIOR
 * "average viewers", so a small sample is pulled strongly toward the platform
 * mean and a large one barely moves.
 */
function engagementRate(t, platformMean) {
  return (engagementEvents(t) + C.ENGAGEMENT_PRIOR * platformMean)
    / ((t.viewers || 0) + C.ENGAGEMENT_PRIOR);
}

/**
 * Corpus-level constants, computed once per corpus load rather than per viewer:
 * the platform mean the smoothing pulls toward, and the rate that normalises
 * engagement into [0, 1] (the 95th percentile, so one viral thought does not
 * flatten everyone else to zero).
 */
function corpusStats(thoughts) {
  let events = 0; let viewers = 0;
  for (const t of thoughts) { events += engagementEvents(t); viewers += t.viewers || 0; }
  const platformMean = viewers > 0 ? events / viewers : 0.5;
  const rates = thoughts.map((t) => engagementRate(t, platformMean)).sort((a, b) => a - b);
  const p95 = rates.length ? rates[Math.floor(rates.length * 0.95)] || rates[rates.length - 1] : 1;
  return { platformMean, p95: p95 > 0 ? p95 : 1 };
}

/**
 * value = sqrt(quality) · normalised engagement, with a first-audience floor.
 *
 * A brand-new thought has no engagement, so without the floor it could never
 * earn the impressions that would give it some. Thoughts with fewer than five
 * viewers are held at half their quality instead — enough to reach the people
 * it is relevant to, not enough to jump ahead of proven material.
 */
function value(t, stats) {
  const q = Math.sqrt(qualityPrior(t));
  const eng = Math.min(1, engagementRate(t, stats.platformMean) / stats.p95);
  const v = q * eng;
  return (t.viewers || 0) < 5 ? Math.max(v, q * 0.5) : v;
}

/** relevance = W_TOPIC·topic + W_AUTHOR·author + W_SOCIAL·social, each in [0, 1]. */
function relevanceParts(t, profile) {
  const topic = Math.max(
    profile.topics.get(`p:${t.parent_id}`) || 0,
    t.child_name ? (profile.topics.get(`n:${String(t.child_name).toLowerCase()}`) || 0) : 0,
  );
  const author = profile.authors.get(String(t.author_id)) || 0;
  // Diminishing, not capped. A linear sum hit 1.0 on every card in a small
  // community where most people are friends, which made the term useless for
  // ranking: 2 friend engagers → 0.26, 5 → 0.53, 10 → 0.78.
  const friendReaders = profile.friendReads.get(t.url_key) || 0;
  const friendEngagers = (t.engager_ids || []).filter((id) => profile.friends.has(id)).length;
  const social = 1 - Math.exp(-(0.3 * friendReaders + 0.15 * friendEngagers));
  return { topic, author, social };
}

/**
 * Scores one thought for one viewer. Returns null when the thought must not be
 * shown to them at all; otherwise the score and every term that produced it.
 */
function scoreThought(t, { profile, readState, exposure, stats, now, triggers = null, ignoreWindow = false }) {
  const state = viewerState(t, readState, exposure);

  // A friend acted on this since the viewer last saw it (friendTriggers.js).
  // It goes to the top tier whatever its age or read state — a friend's reply
  // on an old thought is exactly the thing worth seeing — and only once: after
  // the card is shown, last_shown_ms passes triggered_ms and it is ordinary again.
  const trig = triggers && triggers.get(String(t.comment_id));
  const triggered = !!(trig && trig.triggered_ms > (state.last_shown_ms || 0));

  // A spotlight is shown to a viewer ONCE. Once seen is enough: unlike a thought it is not rotated back
  // by the novelty decay or replayed by the revisit stage, whether or not they read the article. It
  // returns only for what is genuinely new about it: a reply since it was last shown, a reply since
  // they read it (revived), or a friend's action (triggered).
  if (kindOf(t) === 'spotlight' && state.seen && !triggered && !state.revived
      && !(t.last_reply_ms != null && t.last_reply_ms > (state.last_shown_ms || 0))) {
    return null;
  }

  // ignoreWindow is the archive stage (index.js): scored only once the fresh
  // list is exhausted, so the window still decides everything else.
  if (!triggered && !ignoreWindow && !inWindow(t, now)) return null;
  const nov = triggered ? 1 : novelty(state, now);
  if (nov == null) return null;
  if (triggered) state.tier = 3;

  const rel = relevanceParts(t, profile);
  const relevance = C.W_TOPIC * rel.topic + C.W_AUTHOR * rel.author + C.W_SOCIAL * rel.social;
  const val = value(t, stats);
  const fresh = freshness(t, state, now);
  const recency = recencyBoost(t, now);
  const unseenNew = triggered ? 1 : unseenNewBoost(t, state, now);
  // "Not interested in this author": their thoughts are scored down, not hidden, so a friend's own reply to the
  // viewer (a trigger) still gets through.
  const muted = !triggered && profile.mutedAuthors && profile.mutedAuthors.has(String(t.author_id)) ? C.MUTED_AUTHOR_FACTOR : 1;
  const score = (C.W_RELEVANCE * relevance + C.W_VALUE * val) * fresh * nov * recency * unseenNew * muted;

  return {
    score,
    kind: kindOf(t),
    explore: rel.topic < 0.15 && val >= 0.5,
    revived: state.revived,
    tier: state.tier,
    trigger: triggered ? trig : null,
    last_shown_ms: state.last_shown_ms || 0,
    breakdown: {
      tier: state.tier,
      ...(triggered ? { friend_trigger: `${trig.trigger_type}:${trig.trigger_user_name}` } : {}),
      relevance: +relevance.toFixed(4), topic: +rel.topic.toFixed(4),
      author: +rel.author.toFixed(4), social: +rel.social.toFixed(4),
      value: +val.toFixed(4), freshness: +fresh.toFixed(4), novelty: +nov.toFixed(4),
      recency: +recency.toFixed(4), unseen_new: +unseenNew.toFixed(4),
      // For revived cards, the two times the decision compared — so a reply
      // that only LOOKS newer (a timezone mismatch between reply timestamps and
      // serve timestamps) is visible in ?debug=1 instead of guessed at.
      ...(state.tier === 1 ? {
        last_reply_at: t.last_reply_ms ? new Date(t.last_reply_ms).toISOString() : null,
        last_shown_at: state.last_shown_ms ? new Date(state.last_shown_ms).toISOString() : null,
      } : {}),
      impressions: state.impressions, half_life_days: halfLifeFor(t).days,
    },
  };
}

module.exports = {
  kindOf, halfLifeFor, viewerState, freshness, novelty, inWindow, shelfExpired, recencyBoost, unseenNewBoost, qualityPrior,
  engagementRate, corpusStats, value, relevanceParts, scoreThought,
};
