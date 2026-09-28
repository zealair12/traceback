// Wikipedia-style previews for key terms in replies.
//
// The model marks a few key terms as [term](term:Wikipedia_Title). On hover (or
// tap on phones) we fetch that article's summary straight from Wikipedia's
// public, CORS-enabled REST API, the same data Wikipedia's own page previews
// use. If the exact title misses (404 or a disambiguation page) we fall back to
// Wikipedia search and take the top hit. Results are cached for the session, so
// a term is fetched at most once.

export interface TermSummary {
  title: string;
  description?: string;
  extract: string;
  thumbnail?: string;
  url: string;
}

const TERM_PREFIX = 'term:';

export const isTermHref = (href: string | undefined): href is string => !!href && href.startsWith(TERM_PREFIX);

// "term:Latency_(engineering)" -> "Latency (engineering)"
export function termTitle(href: string): string {
  const raw = href.slice(TERM_PREFIX.length);
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  return decoded.replace(/_/g, ' ').trim();
}

// [latency](term:Latency_(engineering)) -> latency, for copying a reply as
// plain markdown. Allows one level of parentheses inside the title.
const TERM_LINK = /\[([^\]]+)\]\(term:(?:[^()\s]|\([^()\s]*\))*\)/g;
export const stripTermLinks = (markdown: string) => markdown.replace(TERM_LINK, '$1');

const cache = new Map<string, Promise<TermSummary | null>>();

async function summary(title: string): Promise<TermSummary | null> {
  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`
  );
  if (!res.ok) return null;
  const j = await res.json();
  if (j.type === 'disambiguation' || !j.extract) return null;
  return {
    title: j.title,
    description: j.description,
    extract: j.extract,
    thumbnail: j.thumbnail?.source,
    url: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
  };
}

async function searchThenSummary(query: string): Promise<TermSummary | null> {
  const res = await fetch(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&origin=*&srsearch=${encodeURIComponent(query)}`
  );
  if (!res.ok) return null;
  const top: string | undefined = (await res.json())?.query?.search?.[0]?.title;
  return top ? summary(top) : null;
}

export function fetchTermSummary(title: string): Promise<TermSummary | null> {
  const key = title.toLowerCase();
  let pending = cache.get(key);
  if (!pending) {
    pending = summary(title)
      .then((s) => s ?? searchThenSummary(title))
      .catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}
