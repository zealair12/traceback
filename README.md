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

### 5. Headless recursive CTE test

Before wiring up the React UI, you can verify that the recursive CTE correctly prunes context (only returning the lineage from the root to the active node).

With the server running:

```bash
cd server
npx ts-node-dev scripts/test-tree.ts
```

The script will:

- Create a new session via `POST /sessions`
- Send a root message and two child messages branching from the root via `POST /message/send`
- Assert that:
  - The lineage for Child A is `[Root, Child A]`
  - The lineage for Child B is `[Root, Child B]`

If everything is configured correctly, you should see:

```text
✅ Recursive CTE lineage validation PASSED.
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

