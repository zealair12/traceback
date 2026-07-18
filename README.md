# tracebackai.com

A chat interface that models conversations as trees instead of linear transcripts, allowing you to branch from any response, compare paths side-by-side, and prune context dynamically to keep model interactions focused and cost-effective.

---

## Inspiration

Every traditional chat tool forces thinking into a straight line, but real thinking branches. When researching, drafting, or weighing a decision, you want to try one direction, back up, try another, and keep them side by side. In a normal transcript, the moment you follow one path, every other path you considered gets buried below an endless scroll.

There is a second, quieter problem. To continue any of those directions, most apps resend the entire history to the model every turn, including the tangents that have nothing to do with what you are asking now. That is slower, more expensive, and it dilutes the model's focus.

---

## What It Does

Traceback stores every conversation as a tree. You can:

* Branch from any earlier reply into a new direction.
* Switch between branches and compare their answers side-by-side.
* Return to the exact point you left, with nothing lost.

The key move happens on the backend. When you continue from a branch, Traceback sends the model only that branch's root-to-node lineage (the direct line of ancestors) instead of the whole tree.

For a node $n$ at depth $d$ in a conversation of $N$ total messages, a linear chat pays for every message it has ever seen:

$$\text{cost}_{\text{linear}} \propto \sum_{i=1}^{N} t_i$$

Traceback pays only for the active lineage $A(n)$, where $\vert{}A(n)\vert{} = d + 1 \ll N$:

$$\text{cost}_{\text{traceback}} \propto \sum_{m \in A(n)} t_m$$

You keep your full exploration history, but each reply stays focused and cheap.

---

## Architecture & Tech Stack

Traceback is built as a TypeScript monorepo:

* **Server:** Express, Prisma, and PostgreSQL (hosted on Neon). Messages self-reference via a `parentId`, making the table the tree. Fetching a branch's context happens in a single recursive CTE that walks root-to-node, so the pruned lineage never has to be reassembled in application code.
* **Web:** React, Vite, and Tailwind CSS. React Flow renders the live conversation graph. A shared client package speaks to the server so the same engine drives both the app and the landing-page demo.
* **Models:** An OpenAI-compatible provider layer routes to OpenRouter (for chat and web search) and Groq (for fast speech-to-text). Switching models is a matter of configuration, not code.
* **Realtime:** Replies and agent steps stream token-by-token over Server-Sent Events (SSE).
* **Auth & Sessions:** Google OAuth via Passport with Postgres-backed sessions so a user's tree survives restarts.

The landing page renders the real application inside a scroll-driven MacBook frame using canned data, ensuring the demo matches what actually ships.

---

## Technical Challenges

* **Modeling a Tree in a Relational DB:** Getting lineage queries right and fast using a recursive CTE, avoiding $N$ round-trips per branch.
* **Pruning Context Safely:** Sending only the ancestry required precision around what "the conversation so far" means on a fork without breaking model coherence.
* **Persistent Sessions:** An in-memory session store silently wiped user logins on each redeploy. Moving to a Postgres-backed store resolved this unexpected behavior.
* **Responsive Layouts:** The tree canvas, branch controls, and landing demo had to scale from a 375px phone to ultra-wide desktops, including forcing the in-frame app to render its desktop layout when viewed on a mobile device.

---

## Project Status

URL: tracebackai.com

---

## Note for Hackathon Reviewers: LLM Usage & Tooling

This project was built with the assistance of advanced language models, primarily utilizing OpenAI Codex and GPT-5.6 for initial architectural planning, scaffolding the monorepo, and drafting the complex recursive CTEs needed for tree traversal.

During development, the initial API credits provided for the frontier models were exhausted rapidly (essentially burned through in about three prompts due to heavy context windows during large-file code generation). While the generation finished well and set up a solid foundation, the remainder of the development, refinement, and edge-case debugging had to be completed using Anthropic Claude (Opus 4.8) to bring the project to its final state.
