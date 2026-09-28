// A key term in a reply with a Wikipedia-style preview card.
//
// Mouse: hover for ~350ms to open; the card stays while the pointer is on the
// term or the card. Touch: tap to open or close. The card shows the article's
// summary and offers "Branch on this", which starts a branch that digs into the
// term. It's rendered in a portal on <body> (which carries the theme), so it
// escapes the reply's paragraph and prose styles.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fetchTermSummary, type TermSummary } from '../lib/termPreview';

interface HoverTermProps {
  title: string;
  children: ReactNode;
  onBranch: (termText: string) => void;
}

const CARD_W = 300;
type Pos = { left: number; top?: number; bottom?: number };

export function HoverTerm({ title, children, onBranch }: HoverTermProps) {
  const termRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pos, setPos] = useState<Pos | null>(null);
  // undefined = loading, null = nothing found
  const [data, setData] = useState<TermSummary | null | undefined>(undefined);

  const show = useCallback(() => {
    const el = termRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(r.left + r.width / 2 - CARD_W / 2, 8), window.innerWidth - CARD_W - 8);
    setPos(r.bottom > window.innerHeight - 280 ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 });
    fetchTermSummary(title).then(setData);
  }, [title]);

  const hide = useCallback(() => setPos(null), []);
  const clearTimers = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };
  const scheduleClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(hide, 200);
  };

  // Close on an outside tap, Escape, or scroll; clear timers on unmount.
  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (termRef.current?.contains(t) || cardRef.current?.contains(t)) return;
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

  const readable = title;
  const termText = () => termRef.current?.textContent?.trim() || readable;

  return (
    <>
      <span
        ref={termRef}
        className="tb-term"
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
          // A term that is also a passage you branched from opens that branch.
          if ((e.target as HTMLElement).closest('[data-branch-children]')) return;
          if ((e.nativeEvent as PointerEvent).pointerType === 'mouse') return;
          if (pos) hide();
          else show();
        }}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            ref={cardRef}
            role="dialog"
            aria-label={`About ${readable}`}
            onPointerEnter={() => clearTimeout(closeTimer.current)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && scheduleClose()}
            className="fixed z-[120] rounded-xl border border-gray-700 bg-gray-900 shadow-2xl p-3 text-left"
            style={{ width: CARD_W, ...pos }}
          >
            {data === undefined ? (
              <div className="space-y-2 animate-pulse" aria-label="Loading">
                <div className="h-3.5 w-2/5 rounded bg-gray-800" />
                <div className="h-2.5 w-full rounded bg-gray-800" />
                <div className="h-2.5 w-4/5 rounded bg-gray-800" />
              </div>
            ) : data ? (
              <>
                <div className="flex gap-3">
                  {data.thumbnail && (
                    <img src={data.thumbnail} alt="" className="h-14 w-14 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-gray-100 leading-snug">{data.title}</div>
                    {data.description && (
                      <div className="text-[11px] text-gray-500 leading-snug mt-0.5">{data.description}</div>
                    )}
                  </div>
                </div>
                <div className="mt-2 text-[12px] leading-relaxed text-gray-300 line-clamp-5">{data.extract}</div>
              </>
            ) : (
              <div className="text-[12px] text-gray-400">No quick summary found for “{readable}”.</div>
            )}
            <div className="mt-2.5 flex items-center justify-between gap-2">
              <a
                href={data?.url ?? `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(readable)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-gray-400 hover:text-gray-100 transition-colors"
              >
                {data ? 'Read on Wikipedia' : 'Search Wikipedia'}
              </a>
              <button
                type="button"
                onClick={() => {
                  hide();
                  onBranch(termText());
                }}
                className="text-[11px] px-2 py-1 rounded-md border border-gray-600 text-gray-200 hover:border-gray-400 transition-colors flex items-center gap-1"
              >
                <span>⎇</span>
                <span>Branch on this</span>
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
