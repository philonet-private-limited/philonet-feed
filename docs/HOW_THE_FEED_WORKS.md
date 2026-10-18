# How the Philonet feed works

This is the plain-language version of the rules the code in `src/` implements. The numbers quoted here are the defaults
in the config files; each can be overridden by an environment variable named in the config.

## The idea

Show each thing **once**. It comes back only when something **new** happened on it. When there is nothing new left, say
so honestly ("You're all caught up") and offer to pick up where the person left off. Age is a scoring input, never a hard
filter, so the feed does not run out; it reaches lower scores and stops when they stop being worth showing.

## 1. Scoring a thought

Every eligible thought is scored for the viewer:

```
score = (0.55 × relevance + 0.45 × value) × freshness × novelty × recency × unseen-new boost
```

(`src/scoring/config.js`, `src/scoring/score.js`)

- **Relevance** is personal fit: 50% topic affinity, 20% author affinity, 30% social (friends who read the article).
- **Value** is quality: a prior times smoothed engagement. Engagement is a weighted count (a read 1, a reply 3, a
  resonate 1, an award 4, a bookmark 2), pulled toward the platform average by a prior of 10 "average viewers", so a
  tiny sample is not taken at face value. Thoughts with few viewers are held at half quality.
- **Freshness** is a half-life by category with a floor, so a news thought fades in days and a philosophy thought
  fades over years but is never erased: `max(floor, 0.5 ^ (age / half_life))`.
- **Recency** is a boost for new thoughts: ×2.5 today, about ×1.25 at 8 days, ×0.75 at a month, settling at 0.732.
- **Unseen-new** adds up to ×2 for a new thought this reader has not been shown yet, fading over a few days.
- **Novelty** is "the one definition of seen":
  - never shown: 1.0
  - served but never seen on screen (a prefetch, a refresh): still new, so only a small flat discount, 0.92 per serving,
    never below 0.6
  - seen but not read: 0.9 per showing, never below 0.3, multiplied by **rotation** (below)
  - read, with new replies since: revived at 0.7
  - read, with nothing new: excluded
- **Rotation** keeps seen cards taking turns. A card's weight recovers with the time since it was last shown,
  `1 − 0.5 ^ (hours since shown / 12)`: a card shown a minute ago goes to the back, after 12 hours it is back at half
  weight, after two days it is nearly whole. What you saw on the last refresh cannot lead the next one.
- **Freshness anchor**: a thought's age counts from when it was posted, or from the newest reply the viewer has not
  seen, so a quiet old thought that gets a new reply is fresh again for the people who have not seen it.
- **Windows**: news categories are shown for 14 days, most others for 90, and Science and Spirituality are exempt.
  An article's shelf life can only shorten that window, never lengthen it.

## 2. Taste

(`src/scoring/affinity.js`)

Taste is built from what the person **did**, expressed as minutes of reading on a topic: reading itself, and everything
else at a stated exchange rate (an insightful mark ≈ 4 minutes, an award ≈ 8, their own thought ≈ 6, a reply ≈ 3, a
bookmark ≈ 3, following a topic ≈ 20, "not interested in this topic" ≈ −40). Two decayed sums are kept, a long one
(30-day half-life) for settled taste and a short one (3-day) for what they are into now, blended 55/45. Declared
interests are a prior whose weight shrinks as real activity grows, so a new account runs on what it said it likes and a
heavy reader on what it did. Muted authors are scored down to a tenth.

## 3. Showing things once: the seen ledger

(`src/ledger.js`, `src/seen.js`)

A card counts as **seen** only when the app reports it was on screen for at least 1 second with at least half of it
visible. A card the server merely served can be served again. An item comes back only when the newest activity on it is
later than the last time it was seen:

| State | Result |
|---|---|
| never seen | eligible, new |
| seen, newer activity since | eligible, resurfaced |
| seen, nothing newer | not eligible |

What counts as new activity: a reply, a friend's reaction (when the topic matches the viewer's interests), an award or
an invite. A spotlight comes back **only** for a reply. Resurfaced cards are capped at 30% of a page (3 of 10) so
reactions cannot crowd out new thoughts. (`src/activity.js` folds raw friend events into the per-thought summary.)

## 4. Building a page

(`src/assembly/page.js`, `src/assembly/layout.js`, `src/assembly/config.js`)

The viewer's own new thought is pinned first for ten minutes. A first page scores everything eligible and freezes a list of up to 150 cards; later pages walk it. Choosing within a
band of near-equal scores uses a softmax sample (temperature 0.03 over the top 50), so refreshes differ a little without
the best cards sinking. Items below a score floor (0.10) are not shown at all.

Hard layout rules, never relaxed:

1. Only plain thoughts may sit next to each other. Friend reads, suggestions, reposts, spotlights, curiosity cards and
   polls never touch another non-thought.
2. The same person never appears back to back.
3. One card per article across the list.
4. At most two thoughts by one author per page of ten.
5. When nothing fits, the list ends shorter rather than breaking a rule.

Best-effort slot preferences: friend reads at positions 1, 4 and 7; up to two extra cards per page (curiosity, invites,
topic, identity, milestones), only between two thoughts, at least two items apart, and a type is not repeated back to
back; the viewer's own new thought is pinned first for ten minutes. A friend's identity or milestone card is
time-sensitive, so if a viewer has run out of thoughts, up to three are placed at the end.

**Explore card.** Roughly one card in seven is an "explore" pick: a high-value thought on a topic where the viewer has
little history. It widens taste, and it never jumps ahead of better cards that are still on offer.

A thread with four or more people and a long quote is shown compact, at most 30% of a page (`src/assembly/collapse.js`).

### The end of the list: caught up, pick up, worth another look

When the candidates run out, the list ends honestly with a **"You're all caught up"** header. After it come, in order:

1. **Pick up where you left off**: up to 15 thoughts the viewer recently began, within the last 30 days.
2. **Worth another look**: once everything new has been seen, up to 10 already-seen thoughts that scored above the
   floor and were last seen at least 48 hours ago, best first, so the end of the feed is never empty.

Both follow the same layout rules as the rest of the list (one card per article, no author back to back, at most two
thoughts by an author per page of ten). An article already placed earlier in the list is not repeated.

## 5. Friend cards

A friend-read card ("Sam started reading this") appears only for a read that is recent: a first showing needs the read to
be within the last 30 minutes, an article already shown can return only for a different friend within 10 minutes, and
the read must be at least 30 seconds, not incognito, and from a non-private account. Once per friend and article.

A friend's **topic milestone** (30 minutes, 1 hour, 2 hours … on one topic) becomes a card for their friends for 48
hours, at most two per friend and eight in all (`src/milestones.js`).

## 6. The five reactions

(`src/reactions.js`)

insightful, agree, support, like, love: one per person per thought. Every reaction is one engagement whatever its kind,
so counts, ranking and activity are unchanged by there being five. The kind is extra information; a person with an
engagement and no recorded kind has the default, insightful. The feed shows one count and the viewer's own reaction;
who reacted with what is one tap away.

## What is not in this repository

This repository is the rules. It deliberately leaves out the parts that depend on Philonet's database and
infrastructure, and the parts that exist to defend the platform against abuse:

- **Candidate retrieval**: the queries that fetch thoughts, reads, friends and reactions from a store.
- **Verification, boosts and moderation**: how reading expertise and verification are earned, and the tools that
  keep spam and manipulation out. Publishing exact thresholds there would only help people game them.
- **Rollout and operations**: who gets which version, kill switches, timeouts, caches and the push or notification
  pipeline.
