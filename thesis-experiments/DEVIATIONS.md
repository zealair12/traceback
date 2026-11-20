# Protocol deviations

Every change to the planned protocol after the freeze (`thesis-freeze-v1`), with
its reason and scope. Analysis scripts must apply these exactly as stated.

## D1. Mistral calls cut off by the output cap were re-run at 4096 tokens (2026-11-20)

- **What happened:** in the full run, 107 of 2,598 Mistral Large 4 calls ended
  with `finish_reason = length` at `max_tokens = 1024`. Reasoning used almost all
  of the budget (mean 976 reasoning tokens vs 260 normally); 62 returned an
  empty answer. Rates were similar across conditions (ancestor 4.6%, full-tree
  3.9%, window 3.8%). Gemini 4 Argon and GPT-6.2 Sol had no cut-offs.
- **What was done:** exactly those 107 calls were replayed with the same logged
  messages (byte-identical prompts, verified) and `max_tokens = 4096`, all other
  parameters unchanged (`runner/rerun.ts`). Keys:
  `results/reruns/open_weights.maxtokens4096.keys.json`. Output:
  `results/raw/open_weights.rerun-maxtokens4096.jsonl`; each line has a
  `rerun.supersedes_key` and `rerun.supersedes_generation_id`.
- **Result:** 106 of 107 finished normally; 48 needed more than 1,024 output
  tokens. One call still hit 4,096 (reasoning did not terminate) and is treated
  as *no answer*. Cost $0.30.
- **Rule for analysis:** for these 107 keys, use the re-run line and ignore the
  original line. All other calls are unaffected, since they finished below the
  1,024-token cap.
- **Side observation:** 59 of the 107 re-runs finished below 1,024 tokens even
  though the identical prompt had not, so Mistral is not deterministic at
  temperature 0 with a fixed seed. The planned variance repeats quantify this.
