# Security: API keys and "bring your own key" (BYOK)

This document explains how Traceback handles API keys today and the plan for the
account-based version.

## Two ways keys get to the model

1. **Operator keys (`server/.env`)** — you, the person running the server, set
   `GROQ_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`. These are never
   exposed to end users and are used when a request does not bring its own key.

2. **Bring your own key (BYOK)** — an end user supplies their own key in the UI.
   It is held only in their browser, sent with each request, used once, and then
   discarded. A user-supplied key always takes precedence over the operator key.

## How BYOK works (current model: per-request, never stored)

- **In the browser:** the key is kept in `sessionStorage`, which is wiped when the
  browser tab closes. It is shown only masked (last 4 characters). There is a
  "Clear" button to remove it immediately.
- **In transit:** the key is sent in a request **header** (`x-provider-key`, or
  the standard `Authorization: Bearer` for the OpenAI-compatible proxy) — never
  in the URL or request body, so it cannot land in access logs.
- **On the server:** a single function, `server/src/auth/apiKey.ts` →
  `resolveApiKey(req)`, reads the key, and it is used for that one request only.
  It is **never written to a database, a file, or a log**, and **never returned**
  in any response.
- **Production transport:** when `NODE_ENV=production`, the server **refuses** a
  key that arrives over plain HTTP (returns 400). Run behind HTTPS in production.

## What this protects against

| Threat | Protection |
|---|---|
| Another user/attacker reading a key | Keys are never stored server-side or shared; each stays in its own browser |
| Keys leaking into logs | Header transport (not URL/body); key never logged; not echoed in responses |
| Interception on the network | HTTPS required in production (enforced for key requests) |
| Keys lingering after use | `sessionStorage` is cleared on tab close; "Clear" button; nothing persisted server-side |

## The honest limitation

BYOK means the user supplies their own key, and their browser uses it. **That
user can always see their own key** in their own browser's devtools/network tab.
That is inherent to BYOK and is not a vulnerability — it is *their* key. Hiding a
key from the very person who entered it is impossible; the only model where users
never see a key is the operator-keys model (`.env`), where you provide the keys.

## Planned next step: accounts + encryption at rest

When user accounts/logins are added, keys can optionally be stored on the server
**encrypted at rest** (e.g. AES-GCM with a server-held master key or a KMS),
tied to the signed-in user. The codebase already has the seam for this: only
`resolveApiKey(req)` needs to change — instead of reading the header it would look
up the authenticated user's encrypted key. Nothing in the providers, the message
service, or the proxy has to change.

## Reporting

If you find a security issue, please open a private report to the repository
owner rather than a public issue.
