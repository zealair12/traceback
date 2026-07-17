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

// The real MacBook photo as the device frame. The live app is overlaid onto the
// screen rectangle (cover-scaled + clipped), so it looks like the app is running
// on an actual Mac. Save the provided image to client/public/macbook.png; until
// it exists, a plain dark frame stands in so the demo still works.
const FRAME_SRC = '/macbook.png';
const IMG_ASPECT = 731 / 487; // width / height of the provided photo
// The display (wallpaper) rectangle as a % of the photo. Tuned by eye; easy to
// nudge once the file is committed and I can measure it precisely.
const SCREEN = { topPct: 6.6, leftPct: 12.6, widthPct: 74.8, heightPct: 72.4 };

function LaptopFrame({ width, children }: { width: number; children: React.ReactNode }) {
  const [imgOk, setImgOk] = useState(true);
  const imgH = width / IMG_ASPECT;
  const screenW = (width * SCREEN.widthPct) / 100;
  const screenH = (imgH * SCREEN.heightPct) / 100;
  // Cover-scale the app so it fills the screen with no letterbox, then clip.
  const appScale = Math.max(screenW / APP_W, screenH / APP_H);
  const appW = APP_W * appScale;
  const appH = APP_H * appScale;
  return (
    <div style={{ position: 'relative', width, filter: 'drop-shadow(0 34px 46px rgba(0,0,0,0.55))' }}>
      {imgOk ? (
        <img src={FRAME_SRC} alt="MacBook" onError={() => setImgOk(false)} draggable={false} style={{ width: '100%', display: 'block', userSelect: 'none' }} />
      ) : (
        <div style={{ width, height: imgH, borderRadius: 18, background: '#1b1b1d', border: '1px solid #2a2a2e' }} />
      )}
      {/* Live screen overlay, clipped to the display rectangle */}
      <div style={{ position: 'absolute', top: `${SCREEN.topPct}%`, left: `${SCREEN.leftPct}%`, width: `${SCREEN.widthPct}%`, height: `${SCREEN.heightPct}%`, overflow: 'hidden', background: '#0d0d0d' }}>
        <div style={{ position: 'absolute', top: (screenH - appH) / 2, left: (screenW - appW) / 2, width: APP_W, height: APP_H, transform: `scale(${appScale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
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

  const replay = () => {
    mock.reset();
    firedRef.current = new Set();
    setDemoKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div style={{ background: '#07070a', color: '#e5e7eb', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <header style={{ textAlign: 'center', padding: '72px 24px 8px' }}>
        <div style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: '#60a5fa' }}>TraceBack</div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 500, margin: '14px 0 10px', color: '#f8fafc' }}>
          Conversations that branch, not scroll.
        </h1>
        <p style={{ maxWidth: 520, margin: '0 auto', color: '#94a3b8', fontSize: 17, lineHeight: 1.6 }}>
          Scroll to watch a real chat fork into a tree — and send only the path that matters to the model.
        </p>
        <div style={{ marginTop: 26, color: '#475569', fontSize: 13 }}>↓ scroll</div>
      </header>

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

      {/* Released content: normal page scroll resumes here after the last step. */}
      <section style={{ maxWidth: 960, margin: '0 auto', padding: '40px 24px 20px' }}>
        <h2 style={{ textAlign: 'center', fontSize: 30, fontWeight: 500, color: '#f8fafc', margin: '0 0 8px' }}>
          Why a tree beats a scroll
        </h2>
        <p style={{ textAlign: 'center', color: '#94a3b8', maxWidth: 560, margin: '0 auto 36px', lineHeight: 1.6 }}>
          Every branch keeps its own context. Explore tangents without derailing the main thread — and never re-send a whole conversation to the model.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
          {[
            { h: 'Branch anything', p: 'Fork any reply into a new line of thought. The old one stays exactly where it was.' },
            { h: 'Pruned context', p: 'Only the active path travels to the model, so long trees stay cheap to continue.' },
            { h: 'Any model', p: 'Continue a branch with Groq, OpenAI, or Claude — pick per message.' }
          ].map((c) => (
            <div key={c.h} style={{ background: '#0f1117', border: '1px solid #1e2330', borderRadius: 14, padding: '20px 20px' }}>
              <div style={{ fontSize: 16, fontWeight: 500, color: '#f1f5f9', marginBottom: 6 }}>{c.h}</div>
              <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.55 }}>{c.p}</div>
            </div>
          ))}
        </div>
      </section>

      <footer style={{ textAlign: 'center', padding: '30px 0 90px' }}>
        <button onClick={replay} style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 24, padding: '12px 24px', fontSize: 14, cursor: 'pointer' }}>
          Replay the demo
        </button>
      </footer>
    </div>
  );
}
