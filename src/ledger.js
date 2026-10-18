// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// THE SEEN LEDGER
// ----------------------------------------------------------------------------
// "Seen" means the app reported the card on screen long enough to count (config SEEN_MIN_*). A card
// the server merely served is NOT seen and can be served again: that is what removes the
// served-and-lost-to-a-timeout problem.
//
// An item comes back only when something NEW happened on it after the viewer last saw it:
//
//   never seen ........................................ eligible, new
//   seen, newest activity later than that sighting .... eligible, resurfaced
//   seen, nothing newer ............................... not eligible
//
// Only the rules are here. Where the rows live (a table, a key-value store) is up to the deployment: each row is
// { first_seen_ms, last_seen_ms, last_activity_seen_ms, seen_count }.
// ============================================================================

const C = require('./assembly/config');

const DAY_MS = 86400000;

/**
 * The newest moment something new happened on an item, in ms (0 when nothing did).
 *
 * A spotlight comes back ONLY for a reply: a friend's action on it is not new to a
 * spotlight. Every other card comes back for a reply, a friend's resonate / insightful / reply / star,
 * an award or an invite.
 */
function activityMs(item) {
  const replied = Number(item.last_reply_ms) || 0;
  if (item.kind === 'spotlight') return replied;
  return Math.max(
    replied,
    Number(item.friend_react_ms) || 0,
    Number(item.friend_action_ms) || 0,
    Number(item.award_ms) || 0,
    Number(item.invite_ms) || 0,
  );
}

/**
 * @param item  { kind, last_reply_ms?, friend_react_ms?, friend_action_ms?, award_ms?, invite_ms? }
 * @param row   the ledger row for this item, { last_activity_seen_ms }, or undefined when never seen
 * @returns { eligible, resurfaced, activity_ms }
 */
function eligibility(item, row) {
  const activity = activityMs(item);
  if (!row) return { eligible: true, resurfaced: false, activity_ms: activity };
  if (activity > (Number(row.last_activity_seen_ms) || 0)) {
    return { eligible: true, resurfaced: true, activity_ms: activity };
  }
  return { eligible: false, resurfaced: false, activity_ms: activity };
}

/** A reported sighting time, clamped: never in the future, never older than SEEN_MAX_AGE_MS. */
function clampSeenAt(reportedMs, nowMs = Date.now()) {
  // A missing time means "now". Number(null) is 0, which would clamp to the oldest allowed time instead.
  if (reportedMs == null || reportedMs === '') return nowMs;
  const t = Number(reportedMs);
  if (!Number.isFinite(t)) return nowMs;
  return Math.min(nowMs, Math.max(nowMs - C.SEEN_MAX_AGE_MS, t));
}

module.exports = { activityMs, eligibility, clampSeenAt };
