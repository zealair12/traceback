# traceback

How can we utilize relational database structures to enable non-linear, tree-based conversations that optimize LLM memory usage?

## Repositories

This repo is the **Traceback** stack: `server/` (Express + Prisma + Groq), `client/` (standalone tree UI), and `packages/traceback-shared` (HTTP client types).

**River** ([zealair12/river](https://github.com/zealair12/river)) is a separate project. For local development, clone both next to each other (same parent folder), for example:

```text
your-workspace/
  traceback/    ← this repo
  river/        ← River UI + market stack
```

River’s client embeds Traceback chat via `VITE_TRACEBACK_API_URL` (see `river/.env.example`) and vendors a copy of `@traceback/shared` under `river/packages/traceback-shared` so the River repo builds on its own. Keep that package in sync with `traceback/packages/traceback-shared` when the API changes.

## Backend setup

The backend lives in the `server/` directory and is built with:

- **Node.js / Express**
- **PostgreSQL** with **Prisma ORM**
- **Groq** for LLM chat completions

### 1. Install dependencies

```bash
cd server
npm install
```

### 2. Configure environment

Copy `server/.env.example` to `server/.env` and set:

- `PORT` – API port (default `4000`)
- `DATABASE_URL` – PostgreSQL connection string
- `GROQ_API_KEY` – your Groq API key
- `CLIENT_ORIGIN` – frontend origin (e.g. `http://localhost:5173`)

### 3. Run Prisma migrations

Generate the Prisma client and create/update the database schema:

```bash
cd server
npm run prisma:generate
npm run prisma:migrate
```

This will apply the `Session` and `Message` models used to represent the non-linear conversation tree.

### 4. Start the backend

```bash
cd server
npm run dev
```

The Express server will start on `http://localhost:4000` (or the port you configured).

### 5. Verification suites

Eight headless scripts under `server/scripts/` prove the system end to end --
no API key needed (they run against the local database and a built-in mock
model). Each prints PASSED or FAILED:

```bash
cd server
npx tsx scripts/verify-lineage.ts        # core context pruning (recursive CTE)
npx tsx scripts/verify-delete.ts         # subtree deletion
npx tsx scripts/verify-message-flow.ts   # providers + per-message model choice
npx tsx scripts/verify-openai-proxy.ts   # the /v1/chat/completions proxy
npx tsx scripts/verify-byok.ts           # bring-your-own-key handling
npx tsx scripts/verify-import.ts         # chat-history importers
npx tsx scripts/verify-multimodal.ts     # image and PDF attachments
npx tsx scripts/verify-transcribe.ts     # speech-to-text endpoint
```

## Universal OpenAI-compatible proxy

Traceback also speaks the OpenAI API format, so existing apps that talk to
OpenAI can route through it with no code changes -- just point their base URL at
the Traceback server. The endpoint is `POST /v1/chat/completions`.

- The `model` field selects the backend and model as `provider/model`
  (e.g. `groq/llama-3.3-70b-versatile` or `openai/gpt-4o`). A bare model name
  uses the default provider (`LLM_PROVIDER`).
- **Drop-in:** send a normal OpenAI request. Traceback stores the conversation
  as a tree and answers the last message, replying in the standard
  `chat.completion` shape.
- **Branch-aware (opt-in):** include `session_id` (and optionally `parent_id`)
  to attach the new turn at a specific point in an existing tree. Traceback then
  forwards only the pruned root-to-node lineage to the model -- this is where the
  context-saving really pays off. The response includes a `traceback` object
  with `session_id`, `user_message_id`, and `assistant_message_id` so a
  branch-aware client can continue the tree.

Example:

```bash
curl http://localhost:4000/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"groq/llama-3.3-70b-versatile","messages":[{"role":"user","content":"Hello"}]}'
```

Notes: streaming (`stream: true`) is not supported yet; the proxy currently adds
Traceback's own brief system instruction to the context.

