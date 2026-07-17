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
const BEATS: Beat[] = [
  { title: 'One linear thread', body: 'Ask a question, get an answer — a normal chat, top to bottom.', side: 'left', top: 96 },
  { title: 'Ask follow-ups', body: 'Keep the conversation going in the same thread… though it can play a little coy 😏.', side: 'right', top: 130 },
  { title: 'Any model, per message', body: 'A reply falls flat? Switch to a sharper model and ask again — the badge shows exactly who answered.', side: 'right', top: 340 },
  { title: 'Branch any reply', body: 'Fork a tangent off any earlier point. Your main thread stays exactly where it was.', side: 'left', top: 360 }
];

// A straight-on MacBook, hand-built so the live app renders crisply inside it.
function Laptop({ screenW, screenH, children }: { screenW: number; screenH: number; children: React.ReactNode }) {
  const bezelSide = 11;
  const bezelTop = 20;
  const lidPad = 12;
  const lidW = screenW + bezelSide * 2 + lidPad * 2;
  const baseW = lidW * 1.06;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 30px 40px rgba(0,0,0,0.55))' }}>
      {/* Screen lid: aluminum body */}
      <div
        style={{
          padding: lidPad,
          borderRadius: 22,
          background: 'linear-gradient(150deg,#dfe2e6 0%,#c2c6cb 45%,#aeb2b7 100%)',
          border: '1px solid #9fa3a8'
        }}
      >
        {/* Dark bezel with the camera notch */}
        <div style={{ position: 'relative', padding: `${bezelTop}px ${bezelSide}px ${bezelSide}px`, borderRadius: 13, background: '#0a0a0c' }}>
          <div style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', width: 118, height: 9, borderRadius: 6, background: '#0a0a0c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#15151a', boxShadow: '0 0 0 1px #1e1e24' }} />
          </div>
          {/* The live screen */}
          <div style={{ width: screenW, height: screenH, borderRadius: 5, overflow: 'hidden', background: '#0d0d0d' }}>{children}</div>
        </div>
      </div>
      {/* Hinge */}
      <div style={{ width: lidW, height: 9, background: 'linear-gradient(180deg,#b4b8bd,#8d9196)', borderRadius: '0 0 3px 3px' }} />
      {/* Base deck (tapered), with the front-lip notch */}
      <div style={{ position: 'relative', width: baseW, height: 15, background: 'linear-gradient(180deg,#d2d6da,#a6aab0)', borderRadius: '0 0 14px 14px', borderTop: '1px solid #c6cace' }}>
        <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 90, height: 7, background: '#92979d', borderRadius: '0 0 8px 8px' }} />
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
  const [scale, setScale] = useState(0.72);

  // The standalone app locks the page (html, body, #root are height:100% /
  // overflow:hidden so the chat fills the viewport). This demo needs the PAGE to
  // scroll, so unlock those three while it is mounted and restore them on exit.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const targets = [html, body, root].filter(Boolean) as HTMLElement[];
    const saved = targets.map((el) => ({ el, overflow: el.style.overflow, height: el.style.height }));
    targets.forEach((el) => {
      el.style.overflow = el === root ? 'visible' : 'auto';
      el.style.height = 'auto';
    });
    return () => {
      saved.forEach((s) => {
        s.el.style.overflow = s.overflow;
        s.el.style.height = s.height;
      });
    };
  }, []);

  // Fit the screen to the viewport (leave room for the side cards + base overhang).
  useEffect(() => {
    const fit = () => {
      const avail = Math.min(900, Math.max(300, window.innerWidth - 120));
      setScale(avail / APP_W);
    };
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

  const screenW = APP_W * scale;
  const screenH = APP_H * scale;

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
            <Laptop screenW={screenW} screenH={screenH}>
              <div style={{ width: APP_W, height: APP_H, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
                <TracebackChat key={demoKey} client={mock} onEngineReady={(tb) => { engineRef.current = tb; }} />
              </div>
            </Laptop>
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
