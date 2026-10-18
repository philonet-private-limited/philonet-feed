// SPDX-License-Identifier: Apache-2.0
// Milestone-card tunables.
const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
};

module.exports = {
  /** A friend's milestone is a feed card for this long after it was reached, once the friend has seen it. */
  MILESTONE_HOURS: num('FEED_MILESTONE_HOURS', 48),
  MAX_MILESTONES: num('FEED_MAX_MILESTONES', 30),
  /** One friend reaching several rungs in a day is not several cards: this many per friend, newest first. */
  MILESTONES_PER_FRIEND: num('FEED_MILESTONES_PER_FRIEND', 2),
  /** And this many in all, so a busy day among friends cannot fill the feed. */
  MILESTONES_TOTAL: num('FEED_MILESTONES_TOTAL', 8),
  /** Articles on a milestone card's stack. */
  MILESTONE_ARTICLES: num('FEED_MILESTONE_ARTICLES', 5),
  /** Friends shown on the card's "who else reads this" line. */
  MILESTONE_FRIENDS: num('FEED_MILESTONE_FRIENDS', 3),
  /** The recency half-life of a milestone card's score, in hours. */
  MILESTONE_HALF_LIFE_HOURS: num('FEED_MILESTONE_HALF_LIFE_HOURS', 24),
};
