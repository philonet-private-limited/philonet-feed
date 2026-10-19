# philonet-feed

The rules behind the Philonet feed: how a thought is scored for a reader, how a page is built, how the app makes sure you
see each thing once, and how things come back when something new happens on them.

This is a **reference implementation**. It is plain Node.js with no dependencies, and every module is a pure function of
its inputs, so you can read it, run it and test it without a database. It is not a drop-in server: the queries that fetch
thoughts, reads and friends from Philonet's store are not part of it.

Start with **[How the feed works](docs/HOW_THE_FEED_WORKS.md)**, which explains every rule in plain language. What comes
next is in **[TODO](docs/TODO.md)**.

## What is here

| Path | What it does |
|---|---|
| `src/scoring/config.js` | Every scoring tunable in one place: the blend, engagement weights, half-lives, windows, recency, signals |
| `src/scoring/score.js` | Scores one thought for one viewer |
| `src/scoring/affinity.js` | Turns what a person did into topic and author affinity |
| `src/assembly/page.js` | Builds a page under the hard layout rules |
| `src/assembly/layout.js` | Sampling and the adjacency rules the assembler builds on |
| `src/assembly/config.js` | Page-level tunables: page size, score floor, extra-card slots, resurfacing caps |
| `src/assembly/newViewer.js` | A new reader's opening: most of the first thoughts on a declared interest and with replies |
| `src/assembly/collapse.js` | Which cards render compact |
| `src/ledger.js` | The "seen, and what counts as new activity" rules |
| `src/seen.js` | Validates the app's "I saw these cards" reports |
| `src/activity.js` | Folds friends' actions into a per-thought summary |
| `src/milestones.js` | Turns a friend's topic milestone into a feed card |
| `src/reactions.js` | The five reactions and how they roll up into one count |

## Running the tests

```bash
npm test
```

Needs Node 18 or later. The tests use made-up names and numbers only.

## Using it

```js
const { scoring, assembly, ledger } = require('./src');

const score = scoring.score.scoreThought(thought, { profile, readState, exposure, stats, now });
```

The shape of `thought`, `profile`, `readState` and `exposure` is documented in the comments at the top of each file and
shown in the tests. Tunables can also be overridden with the environment variables named in the config files
(for example `FEED_W_RELEVANCE`; the `FEED_` prefix is shared by every tunable).

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
