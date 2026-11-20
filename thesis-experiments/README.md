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

## Phase 2: loading into the experiment database

All database scripts read only `.env.experiment` and run a safety guard first:
the `DATABASE_URL` host must equal `EXPERIMENT_DB_HOST`, the deny list must be
non-empty, and any deny-listed endpoint (including its `-pooler` form) is
refused. Passwords are never printed.

```bash
npm run migrate -- status      # Traceback's own migrations, against the experiment DB
npm run migrate -- deploy
npm run load                   # data/sample.jsonl -> Traceback tables (idempotent)
npm run verify-load            # compare DB rows with the file
npm run load -- --reset        # delete ONLY experiment rows (ids start with "exp-")
npm run load -- --assign-owner latest   # after logging in to local Traceback once, to view trees in the UI
```

Rows: session `exp-<scenario id>`, messages `exp-<scenario id>-<mNN>`, owned by
a dedicated experiment user; `branch_label` holds `active` / `s1..sk`;
`created_at` = 2026-01-01T00:00Z + t minutes.

## Phase 3: context builders and the no-model dry run

```bash
npm run test:db                # ancestor builder == production SQL + app function; window invariants
npm run dryrun                 # tokens, efficiency, window/budget ratio, exposure -> results/dryrun/
```

`builders/context.ts` builds `ancestor` (production recursive CTE),
`full_tree` (all session messages before the question, by created_at) and
`window` (whole messages backward from the question until the ancestor token
budget would be exceeded). Each returns the messages with the question last,
token counts, and exposure (sibling messages, canaries and conflicting values
present, whether the required-fact message survived).

### Design decision after the dry run (2026-11-20)

The sliding window contained sibling messages in every sample scenario, but
only 18% of canaries (planted in each sibling's first exchange, which the
window tends to cut) and never the required fact in `root` cells. Planting is
kept as designed. Window leakage is analysed conditional on exposure (the
canary or conflicting value actually being in the built context), and
correctness is reported alongside `required_fact_present`. See `analysis` in
`config/experiment.yaml`.

## Phase 4: runner and pilot

```bash
npx tsx runner/run.ts --model open_weights --out results/raw/pilot-mistral.jsonl --dry   # contexts + cost projection, no API calls
npx tsx runner/run.ts --model open_weights --out results/raw/pilot-mistral.jsonl         # resumes; skips calls already logged ok
npx tsx scoring/pilot_report.ts --log results/raw/pilot-mistral.jsonl --full <all-scenarios.jsonl>
```

`--model` takes a role from `config/experiment.yaml` (`frontier`, `mid`,
`open_weights`) or a model id. Every call uses the same system prompt
(`runner/system_prompt.ts`, sha256 logged), the pinned provider with fallbacks
off, and is logged as one JSON line with the exact messages, response, usage,
OpenRouter-reported cost, reference-tokenizer tokens, window/budget ratio and
exposure. The cost cap counts all spend already in `results/raw/`; a run refuses
to start if spend + projection exceeds it and stops scheduling before crossing it.

Pilot (2026-11-20, Mistral Large 4, 20 scenarios x 3 conditions): 60/60 calls
ok, $0.081 total, canary false-positive rate on ancestor-only 0/20, window/budget
mean 0.944, actual/estimated cost 1.06. String matching over-counts leaks when an
answer lists or debunks sibling items, so flagged leaks that also state the
correct value are marked ambiguous for the Phase 6 judge.

## Phase 5: freeze and full run

The dataset is frozen at git tag `thesis-freeze-v1`; see `data/FREEZE.md` for the
hashes of the dataset and every input that shapes it.

```bash
shasum -a 256 -c data/scenarios.sha256                 # verify the frozen dataset
npm run load -- --file data/scenarios.jsonl            # load all 720 into the experiment DB
npm run verify-load -- --file data/scenarios.jsonl
npx tsx runner/run.ts --model <role> --file data/scenarios.jsonl --out results/raw/<role>.jsonl \
  --repeat-fraction 0.1 --repeats 3                    # resumes; stops at the cost cap
```

## Phase 6: scoring

```bash
npx tsx scoring/score.ts                         # deterministic scoring -> results/scored/deterministic.jsonl
npx tsx scoring/judge.ts --task quality [--pilot 30] [--dry]   # blind quality judge (active path + answer only)
npx tsx scoring/judge.ts --task leak    [--pilot 18] [--dry]   # used / alternative / rejected for flagged terms
npx tsx scoring/human_sample.ts --n 150          # blind, stratified sample for human scoring -> results/human/
```

`scoring/merge.ts` applies DEVIATIONS.md (D1 re-runs replace the originals).
Leakage counts only items present in the built context; items found but not in
the context are chance hits. The quality judge sees only the active path, the
final message and the answer, so it cannot tell which condition produced the
answer. The transcript uses plain speaker labels because OpenRouter's guardrail
blocks bracketed role tags such as `[USER]` ("bracketed_role_spoofing").
