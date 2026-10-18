// SPDX-License-Identifier: Apache-2.0
// ============================================================================
// CARD DISPLAY — full or compact
// ----------------------------------------------------------------------------
// Decides whether an article card renders as the full card (headline, thought,
// quote carousel, media, actions) or the compact row (stacked avatars, headline,
// byline, actions).
//
// WHY THE DECISION IS HERE AND NOT ON THE CLIENT
//
// The honest test for "this quote is too long" is whether it TRUNCATES, which is
// a layout fact only the device knows. But measuring it on-device means
// rendering the card expanded, measuring, then collapsing — a visible jump on
// every qualifying card, on every scroll.
//
// So it is approximated by character count instead. The client clamps a
// collapsed quote to REPOST_COLLAPSED_QUOTE_LINES (6) at REPOST_COLLAPSED_QUOTE_FONT
// (15sp), which on a ~340dp card is roughly 240 characters — though the quote
// gate now sits below that deliberately; see MIN_QUOTE_CHARS. That number is the
// approximation, and it is deliberately a tunable rather than a constant: it is
// a guess about a font metric, and the first real device will disagree with it.
//
// NO RUN/ADJACENCY RULE. A first version grouped qualifying cards and only
// collapsed runs of two or more, so a lone compact row could not look like a
// glitch. It was dropped because runs straddle page boundaries: a qualifier in
// the last slot of page 1 pairs with the first slot of page 2, which arrives in
// a different response, and re-collapsing a card already on screen is worse than
// either outcome. Adding it later is additive and touches only this file.
// ============================================================================

const CARD_TYPES = {
  ARTICLE: 'article',
  FRIEND_READ: 'friend_read',
  REPOSTED_REPLY: 'reposted_reply',
  ARTICLE_SUGGESTION: 'article_suggestion',
  CURIOSITY: 'curiosity',
};

const num = (envName, fallback) => {
  const parsed = Number(process.env[envName]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Distinct people in the discussion, author included.
 *
 * Counted as a union rather than read from `memberCount`, because `members` is
 * inconsistent about the author: it holds whoever has a message in the thread,
 * so an author who replied to their own thought appears and one who did not
 * does not. One thread can list its author while another does not.
 * Using that field directly would make the rule depend
 * on whether someone happened to reply to themselves.
 */
function participantCount(starter) {
  if (!starter) return 0;
  const ids = new Set();
  if (starter.user_id) ids.add(String(starter.user_id));
  if (starter.starter?.user_id) ids.add(String(starter.starter.user_id));
  for (const m of starter.members || []) {
    if (m?.user_id) ids.add(String(m.user_id));
  }
  return ids.size;
}

/**
 * The headline the compact row prints.
 *
 * Falls back to the article title, which is what the client does when
 * quote_headline is blank — so the bar is applied to the string that will
 * actually be rendered rather than to one that may be empty.
 */
function headlineLength(starter, article) {
  const h = starter?.quote_headline;
  if (typeof h === 'string' && h.trim()) return h.trim().length;
  const t = article?.headline || article?.title;
  return typeof t === 'string' ? t.trim().length : 0;
}

/** The quote the card actually shows first — the rest are behind the pager. */
function leadQuoteLength(starter) {
  if (!starter) return 0;
  const first = Array.isArray(starter.quotes) && starter.quotes.length > 0
    ? starter.quotes[0]?.text
    : starter.quote;
  return typeof first === 'string' ? first.trim().length : 0;
}

// Three people (it was briefly four). Override with the env var.
const MIN_PARTICIPANTS = num('UNIFIED_FEED_COMPACT_MIN_PARTICIPANTS', 3);

/**
 * The author's own thought, as the full card would print it. A long one is the content of the card, not
 * something a headline can stand in for, so only short thoughts collapse (see MAX_THOUGHT_CHARS).
 */
function thoughtLength(starter) {
  if (!starter) return 0;
  const t = starter.original_content ?? starter.content ?? starter.message;
  return typeof t === 'string' ? t.trim().length : 0;
}

/** A thought of this many characters or more stays a full card. */
const MAX_THOUGHT_CHARS = num('UNIFIED_FEED_COMPACT_MAX_THOUGHT_CHARS', 250);
/**
 * How much quote a card must carry before collapsing is justified.
 *
 * LOWERED from 280, and the rule it expresses has CHANGED with it.
 *
 * 280 approximated the point at which a collapsed quote truncates: the old
 * argument was "collapse a card whose quote would be cut off anyway, because a
 * truncated quote looks worse than none". On the current client — six lines at
 * 15sp — that point is nearer 240 than 280, so the gate had drifted stricter
 * than its own reasoning even before this change.
 *
 * 180 is a different claim, deliberately. A 180-character quote still displays
 * whole — roughly four and a half of the six available lines — so the test is
 * no longer "this will not fit" but "this card carries a substantial quote, and
 * on a page of ten the discussion is worth more than the passage". Quotes are
 * what make the feed heavy to read; this is the lever that acts on that
 * directly.
 *
 * Settled at 180 after trying 120. 120 is only two or three lines, which is a
 * quote a reader takes in at a glance — collapsing those spends the page's
 * compact budget on cards that were not costing much to begin with. 180 keeps
 * the budget for passages that genuinely weigh the page down, while still
 * sitting well below the ~240 truncation point.
 *
 * Read together with MAX_COMPACT_RATIO, which is what stops it going too far:
 * this decides which cards MAY collapse, that decides how many actually do.
 */
const MIN_QUOTE_CHARS = num('UNIFIED_FEED_COMPACT_MIN_QUOTE_CHARS', 180);

/**
 * The headline has to fill about two lines.
 *
 * On a collapsed card the headline is the ONLY content — the thought and the
 * quote carousel are gone. A one-line headline next to a 38dp avatar stack
 * leaves a card that is mostly empty space and a footer, which reads as broken
 * rather than as compact.
 *
 * LOWERED from 60. That figure was two lines at 14sp in a ~262dp text column.
 * The compact row has since been redrawn: the headline is 16sp and runs to five
 * lines, beside a 54dp thumbnail. Larger type in a narrower column means fewer
 * characters per line, so 60 had come to buy nearly three lines rather than two
 * — the gate turned stricter without anyone changing it.
 *
 * 42 is about two lines at the row's current metrics. Like the quote threshold
 * it approximates a font metric, so it is a tunable, not a constant.
 */
const MIN_HEADLINE_CHARS = num('UNIFIED_FEED_COMPACT_MIN_HEADLINE_CHARS', 42);

/**
 * How much of a page may be collapsed.
 *
 * Expressed as a FRACTION rather than a flat count so it survives a pageSize
 * change: 0.3 is exactly three cards on the default page of ten, and still
 * three tenths of the page if that default moves. A flat "3" would silently
 * become a different rule the moment anyone paged by twenty.
 *
 * Raised from 0.2. This matters more now than it did: MIN_QUOTE_CHARS dropped
 * to 120, so many more cards QUALIFY, and this is the only thing deciding how
 * many of them are actually collapsed. It has gone from a rarely-hit safety
 * valve to the rule that shapes the page.
 *
 * The cap exists because the per-card test cannot see the page. Three cards can
 * each independently deserve collapsing and still add up to a page that reads as
 * a list of links rather than a feed — and on an exhausted feed, where the
 * recycled cards are the ones with the most replies, they arrive together.
 */
const MAX_COMPACT_RATIO = num('UNIFIED_FEED_COMPACT_MAX_RATIO', 0.3);

const DISPLAY = { FULL: 'full', COMPACT: 'compact' };

/**
 * Which treatment this card gets.
 *
 * Returns 'full' for anything it does not understand: a card that renders at
 * full weight by mistake is a card that is merely too tall, whereas one
 * collapsed by mistake has had its content taken away.
 */
function resolveDisplay(item) {
  if (!item || item.type !== CARD_TYPES.ARTICLE) return DISPLAY.FULL;

  const starter = item.payload?.conversation_starters?.[0];
  if (!starter) return DISPLAY.FULL;

  // A spotlight IS its quote — content and quote are the same string — so the
  // card is already the lightest on the page and collapsing it would leave a
  // headline and nothing else.
  if (starter.is_quote_feature || starter.type === 'quote_feature') return DISPLAY.FULL;

  // A poll needs its options visible to be answerable, and a curiosity's
  // generated slides ARE the content. Neither is an author's take that a
  // headline can stand in for.
  if (starter.is_poll || starter.type === 'poll') return DISPLAY.FULL;
  if (starter.curiosity || starter.curiosity_id) return DISPLAY.FULL;

  if (participantCount(starter) < MIN_PARTICIPANTS) return DISPLAY.FULL;
  if (thoughtLength(starter) >= MAX_THOUGHT_CHARS) return DISPLAY.FULL;
  if (leadQuoteLength(starter) < MIN_QUOTE_CHARS) return DISPLAY.FULL;
  if (headlineLength(starter, item.payload?.article) < MIN_HEADLINE_CHARS) return DISPLAY.FULL;

  return DISPLAY.COMPACT;
}

/**
 * The display for a whole page, with the cap applied.
 *
 * When more cards qualify than the cap allows, the EARLIEST survive. They are
 * already in rank order, so keeping the first is keeping the ones the ranker
 * placed highest; demoting by position would otherwise have needed a second,
 * unrelated notion of which collapse matters more.
 *
 * Returns an array parallel to `items`, never mutating them.
 */
function resolvePageDisplays(items, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const size = Number.isFinite(pageSize) && pageSize > 0 ? pageSize : list.length;
  const cap = Math.max(1, Math.floor(size * MAX_COMPACT_RATIO));

  let used = 0;
  return list.map((item) => {
    if (resolveDisplay(item) !== DISPLAY.COMPACT) return DISPLAY.FULL;
    if (used >= cap) return DISPLAY.FULL;
    used += 1;
    return DISPLAY.COMPACT;
  });
}

module.exports = {
  resolveDisplay,
  resolvePageDisplays,
  participantCount,
  leadQuoteLength,
  headlineLength,
  thoughtLength,
  MAX_THOUGHT_CHARS,
  DISPLAY,
  MIN_PARTICIPANTS,
  MIN_QUOTE_CHARS,
  MIN_HEADLINE_CHARS,
  MAX_COMPACT_RATIO,
};
