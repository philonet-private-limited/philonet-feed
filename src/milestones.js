// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// A FRIEND'S TOPIC MILESTONE AS A FEED CARD
// ----------------------------------------------------------------------------
// When a reader reaches a topic rung (30 minutes, 1 hour, 2 hours ... in one topic) every friend of theirs gets one card
// about it, for MILESTONE_HOURS after it was reached. The card shows the articles behind it as a stack, and says how
// the viewer stands on the topic: a new topic for them, or the time they have read it for.
//
// Only topic rungs; never from incognito reading, never for a private account, never to the owner. Selecting the rows
// (which friends, which window) is the store's job; this file turns a row into a card and caps the list.
// ============================================================================

const C = require('./milestones.config');

const HOUR = 3600000;
const MIN = 60000;

function rungLabel(ms) {
  if (ms < HOUR) { const m = Math.round(ms / MIN); return m === 1 ? '1 minute' : `${m} minutes`; }
  const h = Math.round(ms / HOUR);
  return h === 1 ? '1 hour' : `${h} hours`;
}

function humanDuration(ms) {
  // Rounded, not floored. Flooring turned 9m58s into "9m", which reads as an
  // understatement next to a credibility sheet showing the real figure.
  const minutes = Math.round(ms / 60000);
  // "mins" and "hrs", not "m" and "h". A single letter next to a number reads as
  // a unit symbol — the register of a measurement — where this line is prose the
  // reader is meant to take in at a glance. Singular where the number is 1, or
  // "1 mins" undoes the point.
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'min' : 'mins'}`;

  // Past an hour, snap to the nearest HALF hour: "1.5h", "2h", "9.5h".
  //
  // "1h 28m" is a measurement, not a claim. Nobody reads a subtitle for the 28,
  // and the precision invites the reader to check it against a sheet that
  // rounds differently. Half-hours keep the sense of scale — the difference
  // between 1.5h and 9.5h is the whole point of the line — while dropping
  // digits that carry no meaning.
  const halves = Math.round(minutes / 30);
  const hours = halves / 2;
  // Trailing ".0" is never printed: 2 renders as "2 hrs", not "2.0 hrs".
  const value = Number.isInteger(hours) ? hours : hours.toFixed(1);
  return `${value} ${hours === 1 ? 'hr' : 'hrs'}`;
}

const expertisePhrase = (ms, tail) => `Read ${humanDuration(ms)} ${tail}`;

const titleCase = (t) => { const x = String(t || '').trim(); return x ? x[0].toUpperCase() + x.slice(1) : x; };

const siteOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/**
 * The card's data from the pieces the queries return. Pure, so it is tested without a database.
 * @param row        a milestone row (CANDIDATES_SQL)
 * @param articleRows [{ url, ms, title, thumbnail_url }] for this owner and topic, longest first
 * @param viewerMs   the viewer's ms on the topic (0 when new to them)
 * @param category   { parent_id, parent_name } or null
 */
function buildCandidate(row, articleRows, viewerMs, category, now = Date.now()) {
  const reachedMs = new Date(row.achieved_at).getTime();
  const ageHours = Math.max(0, (now - reachedMs) / HOUR);
  const articles = (articleRows || []).slice(0, C.MILESTONE_ARTICLES).map((a) => ({
    title: String(a.title || '').trim(), site: siteOf(a.url), ms: Number(a.ms) || 0, image: a.thumbnail_url || '',
    // What the app needs to open the article for reading.
    url: a.url || '', article_id: a.article_id != null ? Number(a.article_id) : 0,
  })).filter((a) => a.title && a.url);
  // A stack needs something to stack. A milestone whose articles cannot be drawn is not worth a card.
  if (!articles.length) return null;
  return {
    kind: 'milestone',
    key: `milestone:${row.milestone_id}`,
    article_id: null,
    // Above ordinary extras, newest first: a milestone is an event, and it is gone in two days.
    score: 3 + Math.pow(0.5, ageHours / C.MILESTONE_HALF_LIFE_HOURS),
    data: {
      milestone_id: Number(row.milestone_id),
      owner: { user_id: String(row.user_id), name: row.name || '', display_pic: row.display_pic || '' },
      topic: row.topic_label || row.topic_key,
      // The line every feed card shows under a name ("Read 31 mins in Paleontology"), worded by the same function.
      reading_line: expertisePhrase(Number(row.ms_at_reach), `in ${titleCase(row.topic_label || row.topic_key)}`),
      topic_key: row.topic_key,
      category_id: category ? Number(category.parent_id) : null,
      category_name: category ? category.parent_name : null,
      rung_ms: Number(row.rung_ms),
      rung_label: rungLabel(Number(row.rung_ms)),
      ms_at_reach: Number(row.ms_at_reach),
      achieved_at: new Date(row.achieved_at).toISOString(),
      article_count: (articleRows || []).length,
      articles,
      // 0 is "a new topic for you"; anything else is "you have read this topic for N mins".
      viewer_ms: Number(viewerMs) || 0,
    },
  };
}

/** Newest first, at most MILESTONES_PER_FRIEND from one friend and MILESTONES_TOTAL in all. */
function capCandidates(list) {
  const perOwner = new Map();
  const out = [];
  for (const c of [...list].sort((a, b) => b.score - a.score)) {
    const n = perOwner.get(c.data.owner.user_id) || 0;
    if (n >= C.MILESTONES_PER_FRIEND) continue;
    perOwner.set(c.data.owner.user_id, n + 1);
    out.push(c);
    if (out.length >= C.MILESTONES_TOTAL) break;
  }
  return out;
}

/** The card body the app reads (card_type "milestone"). */
function cardOf(candidate) {
  const d = candidate.data;
  return { card_type: 'milestone', key: candidate.key, ...d };
}


module.exports = { buildCandidate, capCandidates, cardOf, rungLabel, MIN };
