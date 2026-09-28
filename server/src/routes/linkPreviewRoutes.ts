// GET /link-preview?url=...: title/description/image for a link in a reply, so
// hovering it shows a glimpse of the page. Signed-in users only (the app
// requires sign-in anyway); the fetch itself is SSRF-guarded in the service.

import type { Express } from 'express';
import { wrap } from './wrap.js';
import { getLinkPreview } from '../services/linkPreview.js';

export function registerLinkPreviewRoutes(app: Express) {
  app.get(
    '/link-preview',
    wrap(async (req, res) => {
      if (!req.isAuthenticated()) {
        res.status(401).json({ error: 'Sign in to preview links.' });
        return;
      }
      const url = typeof req.query.url === 'string' ? req.query.url : '';
      if (!url || url.length > 2048) {
        res.status(400).json({ error: 'url is required.' });
        return;
      }
      const preview = await getLinkPreview(url);
      res.set('Cache-Control', 'private, max-age=86400');
      res.json({ preview });
    })
  );
}
