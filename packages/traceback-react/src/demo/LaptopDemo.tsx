// Landing-page proof of concept: a pinned MacBook whose screen runs the REAL
// Traceback app on scripted data, stepping through beats as you scroll, then
// releasing into the rest of the page.
//
// Plain-English big picture:
// The hero pins a laptop in place. While it is pinned, your scrolling is "spent"
// advancing the steps INSIDE the screen -- the real chat starts as one straight
// thread, then forks into branches. Cards beside the laptop name each step. Once
// the last step is reached, the section releases and the page scrolls on into the
// normal content below (features, footer). The laptop screen is the actual
// product on canned data, so the demo can never drift from the live app.

import { useEffect, useMemo, useRef, useState } from 'react';
import { TracebackChat } from '../TracebackChat';
import type { UseTracebackReturn } from '../useTraceback';
import { MockTracebackClient } from './mockClient';

// Logical size the real app is rendered at, then scaled down into the screen.
const APP_W = 1180;
const APP_H = 740;
// Each step gets roughly one viewport of scroll; +1 viewport of lead-in room.
const STEPS = 4;

interface Beat {
  title: string;
  body: string;
  side: 'left' | 'right';
  top: number;
}
// Cards flank the laptop (two per side) so the active one always sits beside the
// screen, never above or below it.
const BEATS: Beat[] = [
  { title: 'One linear thread', body: 'Ask a question, get an answer — a normal chat, top to bottom.', side: 'left', top: 210 },
  { title: 'Ask follow-ups', body: 'Keep the conversation going in the same thread… though it can play a little coy 😏.', side: 'right', top: 210 },
  { title: 'Any model, per message', body: 'A reply falls flat? Switch to a sharper model and ask again — the badge shows exactly who answered.', side: 'right', top: 430 },
  { title: 'Branch any reply', body: 'Fork a tangent off any earlier point. Your main thread stays exactly where it was.', side: 'left', top: 430 }
];

// A hand-authored MacBook SVG frame: vector, crisp at any size, no external
// asset. We control the screen-cutout coordinates, so the live app overlays it
// perfectly (no eyeballing insets on a photo). Swap in a photo later if you want
// full photorealism.
const VB = { w: 1000, h: 620 };
const SCREEN = { x: 82, y: 52, w: 836, h: 494 };

function LaptopFrame({ width, children }: { width: number; children: React.ReactNode }) {
  const H = (width * VB.h) / VB.w;
  const sw = (width * SCREEN.w) / VB.w;
  const sh = (H * SCREEN.h) / VB.h;
  // Cover-scale the app so it fills the screen with no letterbox, then clip.
  const appScale = Math.max(sw / APP_W, sh / APP_H);
  const appW = APP_W * appScale;
  const appH = APP_H * appScale;
  return (
    <div style={{ position: 'relative', width, filter: 'drop-shadow(0 34px 46px rgba(0,0,0,0.55))' }}>
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} width="100%" style={{ display: 'block' }} aria-label="MacBook">
        <defs>
          <linearGradient id="tb-alu" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#46474c" />
            <stop offset="0.5" stopColor="#34353a" />
            <stop offset="1" stopColor="#25262b" />
          </linearGradient>
          <linearGradient id="tb-deck" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3c3d43" />
            <stop offset="1" stopColor="#212227" />
          </linearGradient>
        </defs>
        {/* thin base deck (front lip), slightly wider than the lid */}
        <rect x="44" y="577" width="912" height="20" rx="9" fill="url(#tb-deck)" />
        {/* front thumb scoop */}
        <rect x="460" y="577" width="80" height="6" rx="3" fill="#3a3b41" />
        {/* hinge seam (thin, narrower than the lid) */}
        <rect x="96" y="571" width="808" height="5" fill="#4a4b51" />
        {/* lid (dark grey / space-gray) with a subtle rim so it stands apart
            from the near-black page background */}
        <rect x="56" y="16" width="888" height="556" rx="26" fill="url(#tb-alu)" stroke="#54555b" strokeWidth="1" />
        {/* screen bezel */}
        <rect x="70" y="30" width="860" height="528" rx="15" fill="#0b0b0d" />
        {/* camera notch */}
        <rect x="468" y="34" width="64" height="9" rx="4.5" fill="#0b0b0d" />
        <circle cx="500" cy="38.5" r="2.1" fill="#1b1b20" />
        {/* screen cutout — the app overlays exactly here */}
        <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h} rx="5" fill="#0d0d0d" />
      </svg>
      {/* Live screen overlay, clipped to the cutout */}
      <div
        style={{
          position: 'absolute',
          top: `${(SCREEN.y / VB.h) * 100}%`,
          left: `${(SCREEN.x / VB.w) * 100}%`,
          width: `${(SCREEN.w / VB.w) * 100}%`,
          height: `${(SCREEN.h / VB.h) * 100}%`,
          overflow: 'hidden',
          background: '#0d0d0d',
          borderRadius: 4
        }}
      >
        <div style={{ position: 'absolute', top: (sh - appH) / 2, left: (sw - appW) / 2, width: APP_W, height: APP_H, transform: `scale(${appScale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LaptopDemo() {
  const mock = useMemo(() => new MockTracebackClient(), []);
  const engineRef = useRef<UseTracebackReturn | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef<Set<number>>(new Set());

  const [beat, setBeat] = useState(0);
  const [demoKey, setDemoKey] = useState(0);
  const [laptopW, setLaptopW] = useState(820);

  // The standalone app locks the page (html, body, #root are height:100% /
  // overflow:hidden so the chat fills the viewport). This demo needs the PAGE to
  // scroll, so unlock those three while it is mounted and restore them on exit.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const targets = [html, body, root].filter(Boolean) as HTMLElement[];
    const saved = targets.map((el) => ({ el, overflow: el.style.overflow, height: el.style.height }));
    // overflow:visible (not auto) so no ancestor breaks position:sticky.
    targets.forEach((el) => {
      el.style.overflow = 'visible';
      el.style.height = 'auto';
    });
    return () => {
      saved.forEach((s) => {
        s.el.style.overflow = s.overflow;
        s.el.style.height = s.height;
      });
    };
  }, []);

  // Size the laptop to the viewport (leave room for the side cards).
  useEffect(() => {
    const fit = () => setLaptopW(Math.min(920, Math.max(320, window.innerWidth - 140)));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Scroll progress across the pinned section drives the steps. Past the section,
  // the sticky stage releases and the page scrolls on into the content below.
  useEffect(() => {
    const onScroll = () => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = Math.max(0, Math.min(1, -rect.top / (total || 1)));

      setBeat(progress < 0.24 ? 0 : progress < 0.46 ? 1 : progress < 0.7 ? 2 : 3);

      // Scrolled back to the very top after playing some steps: reset to the
      // linear starter so the demo replays cleanly instead of showing a
      // half-finished conversation under a "linear thread" caption.
      if (progress < 0.02 && firedRef.current.size > 0) {
        firedRef.current = new Set();
        mock.reset();
        setDemoKey((k) => k + 1);
        return;
      }

      // Fire each scripted step once, only when the engine is idle so a fast
      // scroll can't drop a message mid-stream. The steps chain: a coy dodge, the
      // user pushing back (answered by a sharper model), then a branch off the
      // original joke to show the tree fork.
      const tb = engineRef.current;
      if (!tb) return;
      const act = (threshold: number, run: (e: UseTracebackReturn) => void) => {
        if (progress >= threshold && !firedRef.current.has(threshold) && !tb.sending && tb.allMessages.length > 0) {
          firedRef.current.add(threshold);
          run(tb);
        }
      };
      act(0.24, (e) => e.handleSendMessage('Explain it'));
      act(0.46, (e) => e.handleSendMessage('yo — answer the question man 🤣'));
      act(0.7, (e) => e.handleBranchFromMessage('d1', 'crack each other up', 'dig'));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [demoKey]);

  return (
    <div style={{ background: '#07070a', color: '#e5e7eb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Pinned section: the laptop steps through beats while this scrolls past. */}
      <div ref={scrollRef} style={{ position: 'relative', height: `${(STEPS + 1) * 100}vh` }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {BEATS.map((b, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                [b.side]: 'max(16px, 4vw)',
                top: b.top,
                width: 224,
                background: '#0f1117',
                border: '1px solid #1e2330',
                borderRadius: 14,
                padding: '14px 16px',
                opacity: beat === i ? 1 : 0.2,
                transform: beat === i ? 'translateY(0)' : `translateY(${b.side === 'left' ? '-' : ''}6px)`,
                transition: 'opacity .5s ease, transform .5s ease'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: '#60a5fa', marginBottom: 4 }}>{b.title}</div>
              <div style={{ fontSize: 13.5, color: '#9aa6b8', lineHeight: 1.5 }}>{b.body}</div>
            </div>
          ))}

          <div style={{ zIndex: 2 }}>
            <LaptopFrame width={laptopW}>
              <TracebackChat key={demoKey} client={mock} onEngineReady={(tb) => { engineRef.current = tb; }} />
            </LaptopFrame>
          </div>
        </div>
      </div>
    </div>
  );
}
