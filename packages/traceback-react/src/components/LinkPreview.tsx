// Every link in a reply, Wikipedia-style: a plain dotted underline (no blue),
// and a glimpse of the page it points to.
// - Laptop: hover to see the glimpse; click the link (or the card) to open it.
// - Phone: the first tap shows the glimpse; tapping the link again (or the
//   card) opens it.
// A passage you branched from that sits inside a link opens its branch instead.
// The card renders in a portal on <body> (which carries the theme).

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fetchGlimpse, hostOf, linkTarget, type Glimpse, type RemotePreview } from '../lib/linkGlimpse';

// How the server previews non-Wikipedia pages; provided by TracebackChat.
export const LinkPreviewContext = createContext<RemotePreview | null>(null);

const CARD_W = 320;
type Pos = { left: number; top?: number; bottom?: number };

export function LinkPreview({ href, children }: { href: string; children: ReactNode }) {
  const remote = useContext(LinkPreviewContext);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const pointer = useRef('');
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pos, setPos] = useState<Pos | null>(null);
  // undefined = loading, null = no preview available
  const [data, setData] = useState<Glimpse | null | undefined>(undefined);

  const show = useCallback(() => {
    const el = linkRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(r.left + r.width / 2 - CARD_W / 2, 8), window.innerWidth - CARD_W - 8);
    setPos(r.bottom > window.innerHeight - 280 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
    fetchGlimpse(href, remote).then(setData);
  }, [href, remote]);
  const hide = useCallback(() => setPos(null), []);
  const clearTimers = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(hide, 200);
  };

  // Close on an outside tap, Escape, or scroll.
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (linkRef.current?.contains(t) || cardRef.current?.contains(t)) return;
      hide();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, [pos, hide]);
  useEffect(() => clearTimers, []);

  const url = data?.url ?? linkTarget(href);
  const site = data?.site ?? hostOf(url);

  return (
    <>
      <a
        ref={linkRef}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(e) => {
          pointer.current = e.pointerType;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return;
          clearTimers();
          openTimer.current = setTimeout(show, 350);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== 'mouse') return;
          clearTimeout(openTimer.current);
          scheduleClose();
        }}
        onClick={(e) => {
          const kind = pointer.current;
          pointer.current = '';
          // A branched-from passage inside the link opens its branch instead.
          if ((e.target as HTMLElement).closest('[data-branch-children]')) {
            e.preventDefault();
            return;
          }
          // Touch: first tap shows the glimpse; a second tap follows the link.
          if (kind && kind !== 'mouse' && !pos) {
            e.preventDefault();
            clearTimers();
            show();
            return;
          }
          hide();
        }}
      >
        {children}
      </a>
      {pos &&
        createPortal(
          <a
            ref={cardRef}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={hide}
            onPointerEnter={() => clearTimeout(closeTimer.current)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && scheduleClose()}
            className="fixed z-[120] block rounded-xl border border-gray-700 bg-gray-900 shadow-2xl p-3 text-left no-underline hover:border-gray-600 transition-colors"
            style={{ width: CARD_W, ...pos }}
          >
            {data === undefined ? (
              <div className="space-y-2 animate-pulse" aria-label="Loading preview">
                <div className="h-2.5 w-1/4 rounded bg-gray-800" />
                <div className="h-3.5 w-3/5 rounded bg-gray-800" />
                <div className="h-2.5 w-full rounded bg-gray-800" />
                <div className="h-2.5 w-4/5 rounded bg-gray-800" />
              </div>
            ) : (
              <>
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-gray-500 truncate">{site}</div>
                    <div className="text-[13px] font-semibold text-gray-100 leading-snug line-clamp-2">
                      {data?.title ?? prettyPath(url)}
                    </div>
                    {data?.subtitle && <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{data.subtitle}</div>}
                  </div>
                  {data?.image && <img src={data.image} alt="" className="h-14 w-14 rounded-lg object-cover flex-shrink-0" />}
                </div>
                {data?.text && <div className="mt-2 text-[12px] leading-relaxed text-gray-300 line-clamp-5">{data.text}</div>}
              </>
            )}
          </a>,
          document.body
        )}
    </>
  );
}

// "example.com/a/b?c" -> "example.com › a › b" for links without a preview.
function prettyPath(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p).replace(/[-_]/g, ' '));
    return [u.hostname.replace(/^www\./, ''), ...parts].join(' › ');
  } catch {
    return url;
  }
}
