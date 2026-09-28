// Link previews ("glimpses") for links in replies: fetch a page and read its
// title, description, image and site name from standard meta tags.
//
// The server fetches URLs a model wrote, so it's guarded against SSRF:
// - http(s) only, default ports only, no credentials in the URL;
// - every connection's resolved IP is checked AT CONNECT TIME (a custom DNS
//   lookup), so private/loopback/link-local/cloud-metadata addresses are refused
//   even via redirects or DNS rebinding;
// - at most 3 redirects, a 5 s timeout, and only the first 512 KB of HTML read.

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

export interface LinkPreview {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;

// True for addresses a public link must never resolve to.
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, incl. cloud metadata 169.254.169.254
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7)); // IPv4-mapped
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') || // unique local
    v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || // link-local
    v6.startsWith('ff') // multicast
  );
}

// dns.lookup that refuses private addresses; used by the socket itself.
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return (callback as any)(err);
    const list = addresses as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || list.length === 0) return (callback as any)(new Error('Blocked address'));
    if ((options as dns.LookupOptions).all) return (callback as any)(null, list);
    (callback as any)(null, list[0].address, list[0].family);
  });
};

export function checkPublicUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  // Literal IPs are checked here too (no DNS lookup happens for them).
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateAddress(host)) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return null;
  return u;
}

interface Fetched {
  url: URL;
  html: string;
}

function fetchOnce(u: URL): Promise<{ status: number; location?: string; html?: string }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(
      u,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': 'tracebackBot/1.0 (+https://tracebackai.com; link previews)',
          Accept: 'text/html,application/xhtml+xml'
        }
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location });
        }
        if (status !== 200 || !/html/i.test(String(res.headers['content-type'] ?? ''))) {
          res.resume();
          return resolve({ status });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          size += c.length;
          chunks.push(c);
          if (size >= MAX_BYTES) res.destroy();
        });
        const done = () => resolve({ status, html: Buffer.concat(chunks).toString('utf8') });
        res.on('end', done);
        res.on('close', done);
        res.on('error', done);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
  });
}

async function fetchPage(start: URL): Promise<Fetched | null> {
  let u = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await fetchOnce(u);
    if (r.location) {
      const next = checkPublicUrl(new URL(r.location, u).toString());
      if (!next) return null;
      u = next;
      continue;
    }
    return r.html ? { url: u, html: r.html } : null;
  }
  return null;
}

const NAMED: Record<string, string> = {
  mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·', copy: '©', reg: '®', trade: '™'
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&(mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|middot|copy|reg|trade);/g, (_m, n: string) => NAMED[n])
    .replace(/&amp;/g, '&');
}

// Read <meta property|name="key" content="..."> in either attribute order.
function meta(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
    const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i').exec(html);
    const v = (a?.[1] ?? b?.[1])?.trim();
    if (v) return decodeEntities(v);
  }
  return undefined;
}

export function parsePreview(html: string, pageUrl: URL): LinkPreview {
  const head = html.slice(0, MAX_BYTES);
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(head)?.[1];
  const title = meta(head, ['og:title', 'twitter:title']) ?? (titleTag ? decodeEntities(titleTag).trim() : '');
  const description = meta(head, ['og:description', 'twitter:description', 'description']);
  let image = meta(head, ['og:image', 'og:image:url', 'twitter:image']);
  if (image) {
    try {
      const abs = new URL(image, pageUrl);
      image = abs.protocol === 'https:' ? abs.toString() : undefined;
    } catch {
      image = undefined;
    }
  }
  const siteName = meta(head, ['og:site_name', 'application-name']);
  const clip = (s: string | undefined, n: number) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  return {
    url: pageUrl.toString(),
    title: clip(title, 200) || pageUrl.hostname.replace(/^www\./, ''),
    description: clip(description, 400),
    image,
    siteName: clip(siteName, 80)
  };
}

// Small in-memory cache: a link is fetched at most once per day per server.
const cache = new Map<string, { at: number; value: LinkPreview | null }>();
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;

export async function getLinkPreview(raw: string): Promise<LinkPreview | null> {
  const u = checkPublicUrl(raw);
  if (!u) return null;
  const key = u.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: LinkPreview | null = null;
  try {
    const page = await fetchPage(u);
    value = page ? parsePreview(page.html, page.url) : null;
  } catch {
    value = null;
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}
