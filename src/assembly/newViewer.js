// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// NEW VIEWERS: the first thoughts they see
// ----------------------------------------------------------------------------
// A viewer with almost no reading has no taste to rank by, so the opening of their feed is arranged, not left to
// the score alone:
//
//   interest floor  most of the first thoughts are on a topic they said they like
//   reply quota     most of the first thoughts are conversations that already have replies
//
// Both are TARGETS. Each slot takes the best-scoring card that helps whichever target is further behind, and when
// no card can, the best card overall, so the list is never shortened. Cards keep their score order inside each
// group, friend-triggered cards and non-plain cards (spotlights, curiosity, polls) are not moved, and after
// `window` thoughts the ordinary score order resumes.
//
// Pure: no database, no clock, no randomness. Used by page.js when `assemble` is told the viewer is new.
// ============================================================================

/** A thought a new viewer will take as "a conversation": it has replies, or its author is the one who invited them. */
const isAnswered = (c) => c.replies > 0 || !!c.referrer;
const isOnInterest = (c) => c.on_interest === true;
const isPlain = (c) => c.kind === 'thought' && !(c.priority > 0);

/**
 * @param ordered  cards in the order the assembler would take them (score order, sampling already applied)
 * @param opts     { replyRatio, interestRatio, window }  ratios in [0, 1]; 0 or missing turns that target off
 * @returns        a new array: the same cards, plain thoughts rearranged among their own positions
 */
function applyNewViewerOrder(ordered, { replyRatio = 0, interestRatio = 0, window = 30 } = {}) {
  const useReplies = replyRatio > 0;
  const useInterest = interestRatio > 0;
  if (!useReplies && !useInterest) return ordered;

  const slots = []; const remaining = [];
  ordered.forEach((c, i) => { if (isPlain(c)) { slots.push(i); remaining.push(c); } });
  if (remaining.length < 2) return ordered;

  const out = ordered.slice();
  let answered = 0; let onInterest = 0;
  slots.forEach((slot, n) => {
    let idx = 0;
    if (n < window) {
      const behindA = useReplies ? replyRatio * (n + 1) - answered : 0;
      const behindI = useInterest ? interestRatio * (n + 1) - onInterest : 0;
      const needA = behindA > 0; const needI = behindI > 0;
      const find = (pred) => remaining.findIndex(pred);
      let found = -1;
      if (needA && needI) {
        found = find((c) => isAnswered(c) && isOnInterest(c));
        // No card does both: serve whichever target is further behind, then the other.
        if (found < 0) found = find(behindA >= behindI ? isAnswered : isOnInterest);
        if (found < 0) found = find(behindA >= behindI ? isOnInterest : isAnswered);
      } else if (needA) {
        found = find(isAnswered);
      } else if (needI) {
        found = find(isOnInterest);
      }
      idx = found < 0 ? 0 : found;
    }
    const c = remaining.splice(idx, 1)[0];
    if (isAnswered(c)) answered++;
    if (isOnInterest(c)) onInterest++;
    out[slot] = c;
  });
  return out;
}

module.exports = { applyNewViewerOrder, isAnswered, isOnInterest };
