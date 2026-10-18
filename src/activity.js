// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// FRIEND ACTIVITY: what the viewer's friends did to thoughts lately (replied, starred, resonated, found insightful).
// This is the input to "new activity brings a thought back". The rows come from your own store: each is
//   { comment_id, uid, action: 'reply' | 'research' | 'star' | 'resonate' | 'insightful', at, scope?, name?, pic? }
// ============================================================================

/** Folds raw rows into the per-thought summary. Pure, so it is tested without a database. */
function summarise(rows) {
  const out = new Map();
  for (const r of rows) {
    const id = String(r.comment_id);
    const ms = new Date(r.at).getTime();
    if (!Number.isFinite(ms)) continue;
    let e = out.get(id);
    if (!e) {
      e = {
        action_ms: 0, react_ms: 0, actors: new Map(), reactors: new Map(), actorActions: new Map(), pics: new Map(), lastByAction: new Map(),
        counts: { reply: 0, research: 0, star: 0, resonate: 0, insightful: 0 }, latest: null,
      };
      out.set(id, e);
    }
    const name = r.name || '';
    // An award on a reply is kept apart from one on the thought itself, so the card can say which it was.
    const action = r.action === 'star' && r.scope === 'discussion' ? 'star_discussion' : r.action;
    const isReaction = r.action === 'resonate' || r.action === 'insightful';
    if (isReaction) { e.react_ms = Math.max(e.react_ms, ms); e.reactors.set(String(r.uid), name); }
    else e.action_ms = Math.max(e.action_ms, ms);
    e.actors.set(String(r.uid), name);
    if (r.pic) e.pics.set(String(r.uid), r.pic);
    if (!e.actorActions.has(String(r.uid))) e.actorActions.set(String(r.uid), new Set());
    e.actorActions.get(String(r.uid)).add(action);
    if (e.counts[r.action] != null) e.counts[r.action]++;
    const prev = e.lastByAction.get(action);
    if (!prev || ms > prev.ms) e.lastByAction.set(action, { action, user_id: String(r.uid), name, pic: r.pic || '', ms });
    if (!e.latest || ms > e.latest.ms) e.latest = { action, user_id: String(r.uid), name, pic: r.pic || '', ms };
  }
  return out;
}

module.exports = { summarise };
