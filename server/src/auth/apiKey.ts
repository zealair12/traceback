// Where a per-request "bring your own key" is resolved from.
//
// Plain-English big picture:
// This is the SINGLE place the server figures out which API key to use for a
// request. Today it reads a key the user's browser sent in a header, uses it for
// that one request, and never stores or logs it. This is also the natural seam
// for the future "accounts" version: when logins exist, this function will
// instead look up the signed-in user's encrypted, stored key -- and nothing
// else in the app has to change.

import type { Request } from 'express';
import { InsecureKeyTransportError } from '../providers/index.js';

// Pull the caller-supplied key out of the request headers, or return undefined
// if none was sent (in which case the provider falls back to the server's own
// env key). Throws if a key is sent insecurely in production.
export function resolveApiKey(req: Request): string | undefined {
  let key: string | undefined;

  // Standard OpenAI clients send the key as "Authorization: Bearer <key>".
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    key = auth.slice(7).trim() || undefined;
  }
  // Our own web client uses a dedicated header instead.
  if (!key) {
    const header = req.headers['x-provider-key'];
    if (typeof header === 'string' && header.trim()) key = header.trim();
  }
  if (!key) return undefined;

  // In production, never accept a key that arrived over plain HTTP -- it would
  // have travelled in the clear. (Locally this check is skipped: nothing leaves
  // your machine.)
  if (process.env.NODE_ENV === 'production') {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    if (!isHttps) {
      throw new InsecureKeyTransportError(
        'Refusing to accept an API key over a non-HTTPS connection. Use https.'
      );
    }
  }

  return key;
}
