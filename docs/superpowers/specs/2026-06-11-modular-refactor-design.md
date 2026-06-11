# Design: codebase-wide modular/OO refactor

Date: 2026-06-11. Goal (user): modular structure, OO so methods/attributes are
transferable, significantly fewer lines, dead code gone. Behavior unchanged.

## Done criteria (declared before work)

All eight verify suites green after every commit; type-checks and production
build clean; live smoke passes; no API/behavior change; total source lines
measured before and after.

## Approaches considered

1. OO everywhere, including React class components -- rejected: class
   components are legacy React; it would add code and fight the framework.
2. Pure module-splitting without classes -- rejected: misses the transferable
   methods/attributes the user asked for where classes genuinely help.
3. Chosen: classes where they deduplicate or make logic portable (providers,
   importers, client, tree math, routing, key store); plain modules for
   Express routes; React components stay functions.

## What shipped

- Providers: BaseChatProvider template (guards, key resolution, retry, time
  budgets) + OpenAIDialectProvider serving groq/openai/local as three trait
  configs + AnthropicProvider subclass. The groq-sdk dependency is GONE (Groq
  speaks the OpenAI dialect); transcription uses the same SDK.
- Server routes: app.ts (283 lines) split into sessionRoutes/messageRoutes
  with a wrap() helper replacing per-handler try/catch; app.ts is 102 lines.
- Importers: BaseImporter owns the chain builder three importers duplicated.
- Shared client: TracebackClient class with one auth-header helper.
- React: ConversationTree, ModelRouter, KeyStore extracted as framework-free
  classes (exported for embedders -- the transferability payoff); useTraceback
  530 -> 397 with a single shared send() core; ChatPanel 450 -> 126 by
  splitting into NavHeader + Composer; ChatMessage derived from
  MessageResponse via Pick so the types cannot drift.
- Dead code removed: react.svg, test-tree.ts (superseded by the verify
  suites; README updated), keys.ts (absorbed into KeyStore).

## Shipped-vs-plan delta (the honest part)

Plan promised "significantly less code". MISSED on raw totals: 4,952 -> 5,056
lines (+2%). Logic duplication genuinely shrank and the worst files collapsed
(283->102, 530->397, 450->126), but module boundaries cost declaration lines
(imports, props interfaces) and the codebase carries ~680 comment lines by
deliberate policy (plain-language comments for a non-coding reader). The two
standing instructions -- rich explanatory comments and minimal line count --
pull against each other; resolving that is a user decision, not an engineering
one. Reversal trigger: if transferability never gets used by an embedder and
the structure feels like ceremony, fold lib/ classes back into the hook.

RESOLVED by user (2026-06-11): functionality and UI appearance are never to be
compromised for fewer lines. "Less code" means no duplication and no dead
code, not raw-line minimization; the plain-language comments stay. The +2%
total is accepted.
