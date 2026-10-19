# TODO

What is built is in [How the feed works](HOW_THE_FEED_WORKS.md). This file is what comes next.

## Phase 1: critical mass

**Goal:** personalization a reader can see, on enough readers and conversations for it to work.

The feed today ranks by topic, freshness and engagement with hand-set weights. It does not understand what a thought is
about (a "Technology" card is one bucket whether it is about chips or phones), and it does not learn from what readers
do. Phase 1 changes both.

- [ ] **Semantic embeddings.** Embed every article and thought with an internal embedding service, current for all new
      content, backfilled for the old.
- [ ] **A reader vector.** A decayed average of the embeddings of what a person read and reacted to, weighted by the
      same minutes-of-reading values as taste (section 2), updated within the session. Never built from incognito
      reads, private accounts or friend-only content; deleted with the account.
- [ ] **A similarity term in relevance,** next to the category term, so "chips" and "phones" separate.
- [ ] **Cold start from meaning.** Seed a new reader's vector from their declared interests, and score by how similar
      readers responded, with a minimum cohort size so a small group never exposes one person's reading.
- [ ] **Re-score between pages,** so a long dwell on page 1 changes page 2.
- [ ] **Exploration slots,** a small randomized share of slots, logged as such, so position bias can be corrected.
- [ ] **One source of truth for "shown".** The app's own card events decide what a person saw; any server-side log of
      what was served is separate and must not be mistaken for it.
- [ ] **Offline replay, then a learned weighting.** Replay logged impressions through the scoring terms, fit a simple
      model on opens, dwell and replies, and replace a hand-set weight only where it wins offline and in an A/B test.
- [ ] **Measure per impression,** not retention: impressions give a test enough power to detect a real difference
      much sooner.
