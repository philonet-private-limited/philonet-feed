// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// SCORING — every tunable in one place
// ----------------------------------------------------------------------------
// The whole algorithm, in one line:
//
//   score = (W_RELEVANCE · relevance + W_VALUE · value) × freshness × novelty
//
// Every request scores EVERY eligible thought (the candidate set is small enough for that) and then
// assembles a page under hard rules. There are no lanes, no time windows, no
// fallback tier and no recycling: age is a scoring input, never a filter, so
// the feed cannot "run out" — it only reaches lower scores, and ends honestly
// with a caught-up card when those scores stop being worth showing.
// ============================================================================

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
};

// ── Score blend ─────────────────────────────────────────────────────────────
// Personal fit vs. quality. The single weight that most shapes the feed.
const W_RELEVANCE = num('FEED_W_RELEVANCE', 0.55);
const W_VALUE = 1 - W_RELEVANCE;

// Inside relevance.
const W_TOPIC = 0.5;
const W_AUTHOR = 0.2;
const W_SOCIAL = 0.3;

// ── Engagement ──────────────────────────────────────────────────────────────
// Weighted events per viewer, Bayesian-smoothed toward the platform mean.
// ENGAGEMENT_PRIOR is how many "average viewers" every thought starts with, so
// a tiny sample is not taken at face value: 2 resonates from 3 viewers reads as
// ~30%, not 67%, while 40 from 200 stays close to its own 20%. The small sample
// can still rank higher — it IS evidence of a higher rate — just not wildly.
const ENGAGEMENT_WEIGHTS = { read: 1, reply: 3, resonate: 1, award: 4, bookmark: 2 };
const ENGAGEMENT_PRIOR = 10;

// A read is 30s on the article. Same bar the rest of the platform uses.
const READ_MS = 30000;

// ── Freshness: half-lives by category, not windows ──────────────────────────
//
// freshness = max(floor, 0.5 ^ (age_days / half_life))
//
// Keyed by PARENT category id. The ids are Philonet's own category ids; the
// groupings say which subjects are "fast" and which are "timeless".
//
// The floor is what keeps evergreen material alive: a Philosophy thought from
// two years ago is discounted, never erased.
const HALF_LIFE_BY_PARENT = {
  1:  { days: 3,   floor: 0.02 },  // Politics
  10: { days: 3,   floor: 0.02 },  // World News
  11: { days: 2,   floor: 0.02 },  // Sports
  4:  { days: 14,  floor: 0.05 },  // Finance
  7:  { days: 14,  floor: 0.05 },  // Entertainment & Media
  3:  { days: 21,  floor: 0.05 },  // Business
  5:  { days: 30,  floor: 0.08 },  // Technology
  6:  { days: 90,  floor: 0.15 },  // Health
  12: { days: 90,  floor: 0.15 },  // Lifestyle
  8:  { days: 120, floor: 0.15 },  // Science
  9:  { days: 365, floor: 0.35 },  // Education
  2:  { days: 730, floor: 0.40 },  // Spirituality & Philosophy
};

// Child categories that are timeless whatever their parent says. Matched on the
// lowercased child or parent NAME, because several of these sit under parents
// whose own half-life is short.
const HALF_LIFE_BY_NAME = {
  'spirituality':        { days: 730, floor: 0.40 },
  'philosophy & ethics': { days: 730, floor: 0.40 },
  'historical':          { days: 365, floor: 0.35 },
  'art & culture':       { days: 365, floor: 0.35 },
};

const HALF_LIFE_DEFAULT = { days: 30, floor: 0.08 };

// ── Novelty: the ONE definition of "seen" ───────────────────────────────────
// never shown ................................ 1.0
// shown, never read .......................... NOVELTY_UNREAD_DECAY ^ impressions
// read, and it has new replies since ......... NOVELTY_REVIVED
// read, nothing new since ("settled") ........ excluded outright
const NOVELTY_UNREAD_DECAY = 0.9;
const NOVELTY_REVIVED = 0.7;
// Served but never seen on screen (a prefetch, a refresh): still new to the viewer, so it only
// loses a little. max(NOVELTY_SERVED_FLOOR, NOVELTY_SERVED_DECAY ^ serves), with no rotation wait.
const NOVELTY_SERVED_DECAY = 0.92;
const NOVELTY_SERVED_FLOOR = 0.6;
// Seen cards never drop below this on count alone — rotation (below) is what
// keeps them from repeating, so a much-seen card can still resurface days later.
const NOVELTY_FLOOR = 0.3;

// ── Rotation: least-recently-shown first ────────────────────────────────────
// A seen card's weight recovers with the time since it was last shown:
//   rotation = 1 − 0.5 ^ (hours since last shown / ROTATION_HALF_LIFE_HOURS)
// Shown a minute ago → ~0.001 (to the back); 12h → 0.5; 2 days → ~0.94.
// What you saw on the last refresh cannot lead the next one, and seen cards
// take turns instead of returning in the same order.
const ROTATION_HALF_LIFE_HOURS = num('FEED_ROTATION_HALF_LIFE_HOURS', 12);

// ── Window: last 3 months, except Science and Spirituality ──────────────────
// Measured from when the thought was posted. Exempt: parent 8 (Science),
// parent 2 (Spirituality & Philosophy), or any category NAMED either.
const WINDOW_DAYS = num('FEED_WINDOW_DAYS', 90);
const WINDOW_EXEMPT_PARENTS = new Set([8, 2]);
// Matched on the thought's OWN category, not its parent: Environment and
// Animals & Wildlife sit under the Science parent, and matching the parent
// let eight-month-old environment news through as "science".
const WINDOW_EXEMPT_NAME = /science|spiritual|philosoph|astronom/i;
// News goes stale fast: Politics (1) and World News (10) — and any category
// named geopolitics / world news / politics — only show for SHORT_WINDOW_DAYS.
const SHORT_WINDOW_DAYS = num('FEED_SHORT_WINDOW_DAYS', 14);
const SHORT_WINDOW_PARENTS = new Set([1, 10]);
const SHORT_WINDOW_NAME = /geopolitic|world news|politic/i;

// ── Shelf life: news is short whatever category it sits in ───────────────────
// Calibrated on article metadata:
//
//   News TYPES (breaking_news, developing_story, press_release):
//   shelf_life_hours typically runs 72–168h but can reach 4320h, so trusting
//   it alone let a six-month "breaking news" piece live the full window. They
//   live min(shelf life, NEWS_TYPE_MAX_HOURS) — never longer than two weeks.
//
//   freshness_dependency = 'high' on other types (analysis, feature,
//   investigation, explainer …): shelf life is mostly 168h. Applied as-is it
//   would kill every timely analysis after a week, so it is floored at
//   HIGH_FRESHNESS_MIN_HOURS. Medium / low freshness: category window only.
//
// Shelf life only ever SHORTENS the category window, never lengthens it.
const NEWS_TYPE_MAX_HOURS = {
  breaking_news: 336, developing_story: 336, press_release: 336, satire: 168,
};
const HIGH_FRESHNESS_MIN_HOURS = num('FEED_HIGH_FRESHNESS_MIN_HOURS', 720);

// ── Recency: recent thoughts weigh more ─────────────────────────────────────
// recency = FLOOR + (1 + RECENCY_BOOST − FLOOR) × 0.5 ^ (age_days / HALF_LIFE)
// Today stays ×2.5. Floor and half-life are set so the two anchors hold at once:
// an 8-day-old thought is ×1.25, a month-old one is ×0.75. Older than that
// settles on the 0.732 floor.
// Today ×2.5 · 4 days ×1.69 · 8 days ×1.25 · a month ×0.75.
const RECENCY_FLOOR = num('FEED_RECENCY_FLOOR', 0.732);
const RECENCY_BOOST = num('FEED_RECENCY_BOOST', 1.5);
const RECENCY_HALF_LIFE_DAYS = num('FEED_RECENCY_HALF_LIFE_DAYS', 4.52);

// ── Unseen-new: new AND never shown to this viewer ──────────────────────────
// unseen_new = 1 + UNSEEN_NEW_BOOST × 0.5 ^ (age_days / UNSEEN_NEW_HALF_LIFE_DAYS)
// On top of recency, and only while the viewer has never been shown the card:
// once it is shown, it competes on recency alone. Today ×2 · 3 days ×1.5 ·
// a week ≈ ×1.2. Recency lifts new cards for everyone; this lifts the new
// cards THIS reader has not met yet over the new ones they already scrolled past.
const UNSEEN_NEW_BOOST = num('FEED_UNSEEN_NEW_BOOST', 1.0);
const UNSEEN_NEW_HALF_LIFE_DAYS = num('FEED_UNSEEN_NEW_HALF_LIFE_DAYS', 3);

// ── Assembly ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 10;

// Refreshes should differ without the best cards drifting down. Sampling is a
// softmax over the top SAMPLE_POOL scores; lower temperature = closer to a
// strict sort.
//
// 0.03, not 0.15. Real scores cluster tightly (0.5–0.87 on the first live
// page), and at 0.15 a card 30% below the leader still drew ~14% as often —
// across fifty candidates that is close to uniform, and the page came out
// highest-score LAST. At 0.03 the leading card comes from the top ~10% about
// three times in four, still varies between refreshes among near-ties, and a
// card 10% below the leader is drawn ~3% as often; 30% below, never.
const SAMPLE_POOL = 50;
const SAMPLE_TEMPERATURE = num('FEED_TEMPERATURE', 0.03);

// Hard caps. Adjacency rules live in page.js and are not tunable.
const MAX_PER_AUTHOR_PER_PAGE = 2;

// The shared-read friend suggestion. Friend reads own every third slot and a
// non-thought card may not touch another, so every other slot borders one: the
// suggestion therefore TAKES a friend slot — the 7th card of page 1, after the
// reader has scrolled a little, or the first friend slot from the 4th on that
// no friend read is using. One per session.
const SUGGESTION_SLOT = 6;
const SUGGESTION_EARLIEST_SLOT = 3;

// Friend reads go at these positions (0-based: 1st, 4th, 7th).
const FRIEND_READ_SLOTS = [0, 3, 6];

// One explore card in roughly every EXPLORE_EVERY: high value, topic the
// viewer has little history in. Widens taste and stretches a small corpus.
const EXPLORE_EVERY = 7;

// Below this score a card is not worth showing; the feed ends with a
// caught-up card instead of padding with weak or repeated material.
const CAUGHT_UP_SCORE = num('FEED_CAUGHT_UP_SCORE', 0.02);

// Topic affinity decays with a 30-day half-life, so taste can move.
const AFFINITY_HALF_LIFE_DAYS = 30;

// ── Signals beyond reading time ─────────────────────────────────────────────
// Reading is the strongest taste signal there is, but not the only one. Marking a thought insightful, starring
// one, writing your own thought or reply, opening a discussion or saving an article all say what you care about,
// so they count toward topic affinity too. Each is worth some minutes of reading ("reading
// equivalents"), so one scale carries them all: an insightful mark ≈ 4 minutes on that topic, a star ≈ 8.
const SIGNAL_MINUTES = {
  insightful: num('FEED_SIG_INSIGHTFUL_MIN', 4),
  star: num('FEED_SIG_STAR_MIN', 8),
  thought: num('FEED_SIG_THOUGHT_MIN', 6),
  reply: num('FEED_SIG_REPLY_MIN', 3),
  discussion_open: num('FEED_SIG_OPEN_MIN', 2),
  bookmark: num('FEED_SIG_BOOKMARK_MIN', 3),
  // The light-touch reaction: very frequent, so each one counts for little.
  resonate: num('FEED_SIG_RESONATE_MIN', 0.5),
  read_later: num('FEED_SIG_READ_LATER_MIN', 2),
  go_deeper: num('FEED_SIG_GO_DEEPER_MIN', 3),
  // A topic the viewer follows is a standing interest: no decay (it is dated now), a good deal of weight.
  follow: num('FEED_SIG_FOLLOW_MIN', 20),
  // "Not interested in this topic": minus minutes on that topic, decaying like everything else.
  not_interested_topic: num('FEED_SIG_NOT_TOPIC_MIN', -40),
};
const SIGNAL_DAYS = num('FEED_SIG_DAYS', 120);
// Author affinity, in the same units as before (resonate 1, reply 2): what else says "I want more from this person".
const AUTHOR_SIGNAL_WEIGHTS = { resonate: 1, reply: 2, insightful: 2, star: 4, discussion_open: 1 };
// Someone the viewer said "not interested in this author" about: their thoughts are scored down to this fraction.
const MUTED_AUTHOR_FACTOR = num('FEED_MUTED_AUTHOR_FACTOR', 0.1);
// What you are into right now: the same signals again with a short half-life, blended in so a topic you read or
// marked today lifts straight away instead of waiting for it to outweigh a month of history.
const SHORT_HALF_LIFE_DAYS = num('FEED_SHORT_HALF_LIFE_DAYS', 3);
const SHORT_BLEND = num('FEED_SHORT_BLEND', 0.45);
// How many hours of reading it takes before declared interests stop mattering.
const DECLARED_PRIOR_HOURS = 3;

// How long a newly published thought by the viewer stays pinned to the top.
const OWN_POST_PIN_MINUTES = 10;

// ── New viewers ─────────────────────────────────────────────────────────────
// A viewer with fewer than NEW_VIEWER_MAX_READS qualifying reads (affinity.isNewViewer) has no taste to rank by yet.
// For them a thought nobody has answered is a weak first impression and one with a live thread is a strong one, so
// the score is multiplied by the factor for the thought's reply count (the last entry covers that many replies or
// more). Off for everyone else, and off entirely with FEED_NEW_VIEWER_REPLY_PRIOR=0.
const NEW_VIEWER_MAX_READS = num('FEED_NEW_VIEWER_MAX_READS', 5);
const NEW_VIEWER_REPLY_PRIOR_ON = num('FEED_NEW_VIEWER_REPLY_PRIOR', 1) !== 0;
const NEW_VIEWER_REPLY_FACTORS = [
  num('FEED_NEW_VIEWER_REPLY_0', 0.75),
  num('FEED_NEW_VIEWER_REPLY_1', 1.15),
  num('FEED_NEW_VIEWER_REPLY_2', 1.25),
  num('FEED_NEW_VIEWER_REPLY_3', 1.35),
];
// The person whose invite code a new viewer joined with is a known face: while the viewer is new, that person's
// thoughts score this much higher, but only if the caller says the referrer is active (profile.referrerId is set
// only then; the reference uses "posted a thought in the last 21 days"). Off with FEED_NEW_VIEWER_REFERRER_BOOST=1.
const NEW_VIEWER_REFERRER_BOOST = num('FEED_NEW_VIEWER_REFERRER_BOOST', 1.2);
// A thought counts as "on interest" for the opening (assembly/newViewer.js) when its topic affinity is at least this.
const NEW_VIEWER_INTEREST_MIN = num('FEED_NEW_VIEWER_INTEREST_MIN', 0.5);

module.exports = {
  W_RELEVANCE, W_VALUE, W_TOPIC, W_AUTHOR, W_SOCIAL,
  ENGAGEMENT_WEIGHTS, ENGAGEMENT_PRIOR, READ_MS,
  HALF_LIFE_BY_PARENT, HALF_LIFE_BY_NAME, HALF_LIFE_DEFAULT,
  NOVELTY_UNREAD_DECAY, NOVELTY_REVIVED, NOVELTY_FLOOR, ROTATION_HALF_LIFE_HOURS,
  NOVELTY_SERVED_DECAY, NOVELTY_SERVED_FLOOR,
  WINDOW_DAYS, WINDOW_EXEMPT_PARENTS, WINDOW_EXEMPT_NAME,
  SHORT_WINDOW_DAYS, SHORT_WINDOW_PARENTS, SHORT_WINDOW_NAME,
  NEWS_TYPE_MAX_HOURS, HIGH_FRESHNESS_MIN_HOURS,
  RECENCY_FLOOR, RECENCY_BOOST, RECENCY_HALF_LIFE_DAYS,
  UNSEEN_NEW_BOOST, UNSEEN_NEW_HALF_LIFE_DAYS,
  PAGE_SIZE, SAMPLE_POOL, SAMPLE_TEMPERATURE, MAX_PER_AUTHOR_PER_PAGE,
  FRIEND_READ_SLOTS, EXPLORE_EVERY, CAUGHT_UP_SCORE,
  SUGGESTION_SLOT, SUGGESTION_EARLIEST_SLOT,
  AFFINITY_HALF_LIFE_DAYS, DECLARED_PRIOR_HOURS, OWN_POST_PIN_MINUTES,
  SIGNAL_MINUTES, SIGNAL_DAYS, AUTHOR_SIGNAL_WEIGHTS, MUTED_AUTHOR_FACTOR, SHORT_HALF_LIFE_DAYS, SHORT_BLEND,
  NEW_VIEWER_MAX_READS, NEW_VIEWER_REPLY_PRIOR_ON, NEW_VIEWER_REPLY_FACTORS, NEW_VIEWER_REFERRER_BOOST,
  NEW_VIEWER_INTEREST_MIN,
};
