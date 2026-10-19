// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// PAGE ASSEMBLY — TUNABLES
// ----------------------------------------------------------------------------
// See docs/HOW_THE_FEED_WORKS.md. Every number the page-level rules depend on is here, overridable by an
// environment variable so a value can be tried without a code change.
// ============================================================================

const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
};

module.exports = {
  /** Cards per page, and per-page rules (author cap, extras, resurfaced cap) count within it. */
  PAGE_SIZE: 10,
  /** The most cards one session's list holds; the next refresh continues from the ledger. */
  MAX_CARDS: num('FEED_MAX_CARDS', 150),

  /** Below this score an item is not shown at all. */
  SCORE_FLOOR: num('FEED_SCORE_FLOOR', 0.10),

  /** At most this many thoughts by one author in one page. */
  MAX_PER_AUTHOR_PER_PAGE: 2,

  /** A friend read at every third position (1st, 4th, 7th ...). */
  FRIEND_READ_EVERY: 3,
  /** The shared-read friend suggestion: slot 7 of page 1, or the first free friend slot from the 4th. */
  SUGGESTION_SLOT: 6,
  SUGGESTION_EARLIEST_SLOT: 3,

  /** One explore card in roughly every N. */
  EXPLORE_EVERY: 7,

  /**
   * A new viewer's opening (newViewer.js): over their first NEW_VIEWER_WINDOW thoughts, this share are on a topic
   * they declared and this share are conversations that already have replies. Targets, not guarantees: when too few
   * cards qualify the rest fill in. 0 turns one off (FEED_NEW_VIEWER_INTEREST_FLOOR, FEED_NEW_VIEWER_REPLY_QUOTA).
   */
  NEW_VIEWER_INTEREST_FLOOR: num('FEED_NEW_VIEWER_INTEREST_FLOOR', 0.8),
  NEW_VIEWER_REPLY_QUOTA: num('FEED_NEW_VIEWER_REPLY_QUOTA', 0.8),
  NEW_VIEWER_WINDOW: num('FEED_NEW_VIEWER_WINDOW', 30),

  /** Extra cards (curiosity, invite, topic, identity): per page, where they prefer to land, spacing. */
  /**
   * Friend news (a friend's identity card, a friend's milestone, a friend on a topic) is time-sensitive and shown
   * once, but extra cards only go between two thoughts, so a viewer who has run out of thoughts would never see
   * them. When the list ends ("you're all caught up"), up to this many of the newest are placed at the end.
   */
  SOCIAL_TAIL_MAX: num('FEED_SOCIAL_TAIL_MAX', 3),
  SOCIAL_TAIL_KINDS: ['identity_share', 'milestone', 'topic_friend'],
  EXTRAS_PER_PAGE: num('FEED_EXTRAS_PER_PAGE', 2),
  EXTRA_SLOTS: [3, 7],
  EXTRA_MIN_GAP: 2,

  /** Resurfaced cards (new activity on something already seen) per page: 30% of ten. */
  RESURFACE_PAGE_CAP: num('FEED_RESURFACE_PAGE_CAP', 3),
  /** How many friend-triggered cards may lead a list; the rest rank normally. */
  MAX_LEAD_TRIGGERED: 5,
  /** How far back a friend's resonate / insightful / reply / star brings a thought back. */
  FRIEND_ACTIVITY_DAYS: num('FEED_FRIEND_ACTIVITY_DAYS', 7),

  /**
   * A reply on a thought already seen brings it back only if the reply is this recent. A reply from months
   * ago is not "new activity", even if the viewer's last sighting is older still.
   */
  RESURFACE_DAYS: num('FEED_RESURFACE_DAYS', 14),

  /**
   * A friend's resonate or insightful brings a thought back only if it is of the viewer's interest:
   * the thought's topic affinity is at least this, or one of the reactors is a close friend (the
   * viewer has engaged with them: author affinity at least CLOSE_FRIEND_MIN).
   */
  INTEREST_MIN_TOPIC: num('FEED_INTEREST_MIN_TOPIC', 0.10),
  CLOSE_FRIEND_MIN: num('FEED_CLOSE_FRIEND_MIN', 2),

  /** How many days of the pick-up section after "you're all caught up": the viewer's recently read thoughts. */
  PICKUP_MAX: num('FEED_PICKUP_MAX', 15),
  PICKUP_DAYS: num('FEED_PICKUP_DAYS', 30),

  /**
   * "Worth another look": once the viewer has seen everything new, thoughts they have already seen that were
   * worth it (score at or above the floor) come round again, best first, so the end of the feed is never
   * empty. One must have been last seen at least this long ago, and at most this many are placed.
   */
  RECYCLE_MAX: num('FEED_RECYCLE_MAX', 10),
  RECYCLE_MIN_AGE_HOURS: num('FEED_RECYCLE_MIN_AGE_HOURS', 48),

  /** What the app counts as "seen": on screen this long with this much of the card visible. */
  SEEN_MIN_DWELL_MS: num('FEED_SEEN_MIN_DWELL_MS', 1000),
  SEEN_MIN_VISIBLE: num('FEED_SEEN_MIN_VISIBLE', 0.5),
  /** A report older than this is not trusted as "now"; a report from the future is clamped to now. */
  SEEN_MAX_AGE_MS: 2 * 24 * 60 * 60 * 1000,
};
