// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// SEEN REPORTS
// ----------------------------------------------------------------------------
// The app reports what the viewer actually saw (on screen at least SEEN_MIN_DWELL_MS with at least
// SEEN_MIN_VISIBLE of the card showing). Every card carries a `key`; the app sends those keys
// back. This file only validates and normalises the request: ledger.recordSeen writes it.
// ============================================================================

const MAX_ITEMS = 100;
const KEY_RE = /^[a-z_]{2,20}:[A-Za-z0-9:_|.\-]{1,160}$/;

/**
 * @param body  { items: [{ key, kind?, seen_at? }] }  seen_at: epoch ms or an ISO string
 * @returns { events: [{ key, kind, seen_at_ms }], rejected }
 */
function parseSeenBody(body) {
  const items = body && Array.isArray(body.items) ? body.items : [];
  const events = []; let rejected = 0;
  const seen = new Set();
  for (const it of items.slice(0, MAX_ITEMS)) {
    const key = it && typeof it.key === 'string' ? it.key.trim() : '';
    if (!KEY_RE.test(key) || seen.has(key)) { rejected++; continue; }
    seen.add(key);
    let ms = null;
    if (it.seen_at != null) {
      const t = typeof it.seen_at === 'number' ? it.seen_at : Date.parse(it.seen_at);
      if (Number.isFinite(t)) ms = t;
    }
    const kind = typeof it.kind === 'string' && it.kind ? it.kind.slice(0, 40) : key.split(':')[0];
    events.push({ key, kind, seen_at_ms: ms });
  }
  rejected += Math.max(0, items.length - MAX_ITEMS);
  return { events, rejected };
}

module.exports = { parseSeenBody, MAX_ITEMS, KEY_RE };
