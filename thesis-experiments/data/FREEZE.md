# Dataset freeze: thesis-freeze-v1

Frozen 2026-11-20, before any full-run model call. Git tag: `thesis-freeze-v1`.

- Scenarios: 720 (144 cells x 5 instances), 19,680 messages, all valid.
- Balanced: 120 per domain, 180 per sibling type, 240 per depth and per sibling count.
- Seed: 20261120. The generator is deterministic; the 20 pilot scenarios are byte-identical in this set.
- Reference tokenizer: o200k_base (js-tiktoken 1.0.21).

Verify the dataset:

```bash
cd thesis-experiments && shasum -a 256 -c data/scenarios.sha256
```

Regenerate and compare (must print the same hash):

```bash
cd thesis-experiments && npm run gen -- --all --out /tmp/check.jsonl && shasum -a 256 /tmp/check.jsonl
```

## sha256 of the frozen inputs

| file | sha256 |
|---|---|
| `data/scenarios.jsonl` | `4c3e538057514b9d0df693eade18ccc2c2d615888581080bc0d43160e8c9c37d` |
| `config/experiment.yaml` | `dd7620f91e8b9c347478fa8f183eb0a6a482bfe8e88bfcf2a875a69ed333c78e` |
| `runner/system_prompt.ts` | `db7890b7711942275bf29215f773cc009240d3bf59904ae243c56b7719c1be13` |
| `generator/build.ts` | `d3b875be44c642fbc733f4a42aaae0d70f8d574994756f184e5827d62bc367cf` |
| `generator/content/domains.ts` | `65331ed7e29aabac30beeb11d57c1132250526d6f3fbc5a64d717c0f8fab3195` |
| `generator/content/irrelevant.ts` | `ae33415c8f6fc810c976fd0c40d9699f6ae59bb1301d601cd08177022bb16026` |
| `generator/validate.ts` | `77f70c4580bf4b3daaf7729e3e425265acc613ab1750a46e3f77f0f4bab618ea` |
| `builders/context.ts` | `3adf27ea934ab9693a03a1bdf625a469e779b94ded406b898158cee5d61994df` |
| `builders/tokens.ts` | `fcee2fe2479565166b3e07aefc937f8295374d9cd2283052e5e02ec8be6a9ae0` |
| `lib/match.ts` | `053056daa98ffb761ca4451cc6c885450587cd637530557a450d284aeceea40e` |
