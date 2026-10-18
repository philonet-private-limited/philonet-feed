// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// THE FIVE REACTIONS ON A THOUGHT: insightful, agree, support, like, love.
// One per person per thought; the same one again takes it back; another switches.
//
// Every reaction is ONE engagement, whatever its kind, so counts, ranking and activity see the same thing they
// saw before there were five. Which kind it was is extra information: a person with an engagement and no
// recorded kind has the default, "insightful".
// ============================================================================

const KINDS = ['insightful', 'agree', 'support', 'like', 'love'];
const DEFAULT_KIND = 'insightful';

/**
 * The summary shown on a card.
 * @param total      how many people engaged (the single count shown on the card)
 * @param otherKinds { agree: n, support: n, like: n, love: n }, the people who recorded a kind other than insightful
 * @param mine       the viewer's recorded kind, or null
 * @param engaged    whether the viewer has an engagement at all
 * @returns { total, my_reaction, kinds }, where the kinds always add up to the total
 */
function summarise({ total = 0, otherKinds = {}, mine = null, engaged = false } = {}) {
  const kinds = {};
  let others = 0;
  for (const k of KINDS) {
    if (k === DEFAULT_KIND) continue;
    const n = Math.max(0, Number(otherKinds[k]) || 0);
    if (n) { kinds[k] = n; others += n; }
  }
  const t = Math.max(0, Number(total) || 0);
  if (t - others > 0) kinds[DEFAULT_KIND] = t - others;
  const my = engaged ? (KINDS.includes(mine) ? mine : DEFAULT_KIND) : null;
  return { total: t, my_reaction: my, kinds };
}

/** What the summary becomes when the viewer taps [kind]: the same one takes it back, another switches. */
function after(summary, kind) {
  if (!KINDS.includes(kind)) return summary;
  const mine = summary.my_reaction;
  const k = { ...summary.kinds };
  const bump = (key, by) => { const n = (k[key] || 0) + by; if (n <= 0) delete k[key]; else k[key] = n; };
  if (mine === kind) { bump(kind, -1); return { total: Math.max(0, summary.total - 1), my_reaction: null, kinds: k }; }
  if (mine == null) { bump(kind, 1); return { total: summary.total + 1, my_reaction: kind, kinds: k }; }
  bump(mine, -1); bump(kind, 1);
  return { total: summary.total, my_reaction: kind, kinds: k };
}

module.exports = { KINDS, DEFAULT_KIND, summarise, after };
