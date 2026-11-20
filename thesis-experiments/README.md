# Thesis experiments: ancestor-only context selection

Experimental harness for "The Only Path That Matters? Ancestor-Only Context
Selection in Branched LLM Conversations". It lives outside Traceback's app code
and only reuses the server's Prisma schema and client (from Phase 2 on).

Setup (once):

```bash
cd thesis-experiments && npm install
```

Secrets go in `.env.experiment` (gitignored); see `.env.experiment.example`.

## Phase 1: generator and validator

```bash
npm run gen -- --sample 20      # balanced sample -> data/sample.jsonl (validated before writing)
npm run gen -- --all            # all cells x instances -> data/scenarios.jsonl
npm run validate                # validate data/sample.jsonl (or pass files)
npm run render -- <id> ...      # readable text of chosen scenarios (default: first 3)
npm test                        # validator acceptance tests, incl. deliberate corruptions
```

Design levels, seed, and token targets/bands are in `config/experiment.yaml`.

### How a scenario is built

- **Active path**: `depth` user/assistant exchanges. The required fact (one of
  seven forced-choice options per domain) is stated in exchange 1 (`root`) or
  exchange `depth` (`current`), and nowhere else on the path.
- **Siblings**: `siblings` branches of 3 exchanges each, all forking from the
  assistant message of active exchange `floor(depth/2)`. So a `root` fact is in
  the siblings' ancestry and a `current` fact is not.
- **Recency** (logical clock `t`, one tick per message): `early` = siblings are
  explored between the fork and the rest of the active path; `late` = after
  the last active turn. The question is asked at `ask_t = max(t) + 1`, so the
  full-tree condition contains every message, late siblings included.
- **Sibling types**: `conflicting` = a different option for the same slot plus a
  canary; `consistent` = an extra true detail (canary) that agrees with the
  active value; `misleading` = a plausible false claim carrying a canary;
  `irrelevant` = an unrelated topic carrying a canary.
- **Canaries** are random identifiers (`orbit_k3q`), 4-digit numbers, hex colors
  or versions, each appearing exactly once.
- **Text** comes from templates (`generator/content/`) and is padded into a token
  band with neutral sentences using the reference tokenizer (`o200k_base`).
- Domains: `db`, `http`, `cache`, `flaky`, `queue`, `auth`.

### Validator checks

Tree structure, role alternation, child-after-parent clock, the active set being
exactly the root-to-ask path, fork position, sibling shape, recency timestamps,
each canary exactly once and only in its own branch, no leak value anywhere on
the active path or in the question, no overlap between correct and leak terms,
the required fact being present at the stated exchange and only there, and the
message length band.
