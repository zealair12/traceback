// A "glimpse" of whatever a link in a reply points to, Wikipedia-preview style.
// - Key terms (term:Title) and English Wikipedia article links use Wikipedia's
//   summary API directly from the browser (see termPreview.ts).
// - Any other web page is fetched by the server's /link-preview endpoint (most
//   sites block cross-origin reads from the browser), passed in as `remote`.
// Results are cached per link for the session.

import type { LinkPreview } from '@traceback/shared';
import { fetchTermSummary, isTermHref, termTitle } from './termPreview';

export interface Glimpse {
  url: string;
  site: string;
  title: string;
  subtitle?: string;
  text?: string;
  image?: string;
}

export type RemotePreview = (url: string) => Promise<LinkPreview | null>;

// Where a link opens. A key term opens Wikipedia's search with "go", which lands
// directly on the article when the title matches.
export function linkTarget(href: string): string {
  if (!isTermHref(href)) return href;
  return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(termTitle(href))}&go=Go`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// en.wikipedia.org/wiki/Latency_(engineering) -> "Latency (engineering)"; not
// Special:, File:, Talk: and similar pages.
function wikiTitle(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'en.wikipedia.org' && u.hostname !== 'en.m.wikipedia.org') return null;
    const m = /^\/wiki\/(.+)$/.exec(u.pathname);
    if (!m || m[1].includes(':')) return null;
    return decodeURIComponent(m[1]).replace(/_/g, ' ');
  } catch {
    return null;
  }
}

async function load(href: string, remote: RemotePreview | null): Promise<Glimpse | null> {
  const title = isTermHref(href) ? termTitle(href) : wikiTitle(href);
  if (title) {
    const s = await fetchTermSummary(title);
    return s ? { url: s.url, site: 'Wikipedia', title: s.title, subtitle: s.description, text: s.extract, image: s.thumbnail } : null;
  }
  if (!remote || !/^https?:/i.test(href)) return null;
  const p = await remote(href);
  return p
    ? { url: p.url || href, site: p.siteName || hostOf(href), title: p.title, text: p.description, image: p.image }
    : null;
}

const cache = new Map<string, Promise<Glimpse | null>>();

export function fetchGlimpse(href: string, remote: RemotePreview | null): Promise<Glimpse | null> {
  let pending = cache.get(href);
  if (!pending) {
    pending = load(href, remote).catch(() => null);
    cache.set(href, pending);
  }
  return pending;
}
