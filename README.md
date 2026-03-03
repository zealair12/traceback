# traceback

How can we utilize relational database structures to enable non-linear, tree-based conversations that optimize LLM memory usage?

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

Copy or edit `server/.env` (a template is already checked in) and set:

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

