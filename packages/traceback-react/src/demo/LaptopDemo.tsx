// Landing-page proof of concept: a pinned MacBook whose screen runs the REAL
// Traceback app on scripted data, with the conversation branching as you scroll.
//
// Plain-English big picture:
// This is the "show, don't tell" hero. The laptop screen is not a picture -- it
// is the actual product, fed by a fake in-memory client (MockTracebackClient),
// so it always matches the live app. As the visitor scrolls, we drive the same
// actions a real user would: the tree starts as one straight thread, then forks
// into branches. Cards beside the laptop light up to name what just happened.
// A real landing page would swap this scroll math for a scroll library; the
// mechanics (one progress value drives the screen + the cards) are identical.

import { useEffect, useMemo, useRef, useState } from 'react';
import { TracebackChat } from '../TracebackChat';
import type { UseTracebackReturn } from '../useTraceback';
import { MockTracebackClient } from './mockClient';

// Logical size the real app is rendered at, then scaled down into the screen.
const APP_W = 1180;
const APP_H = 740;

interface Beat {
  title: string;
  body: string;
  side: 'left' | 'right';
  top: number;
}
const BEATS: Beat[] = [
  { title: 'One linear thread', body: 'Ask a question, get an answer — a normal chat, top to bottom.', side: 'left', top: 90 },
  { title: 'Branch any reply', body: 'Fork a new line of thought. The tree splits; your original thread stays intact.', side: 'right', top: 150 },
  { title: 'Only the path is sent', body: 'The model receives just the active branch — not the whole tree. That is the token saving.', side: 'right', top: 360 }
];

export function LaptopDemo() {
  const mock = useMemo(() => new MockTracebackClient(), []);
  const engineRef = useRef<UseTracebackReturn | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef<Set<number>>(new Set());

  const [beat, setBeat] = useState(0);
  const [demoKey, setDemoKey] = useState(0);
  const [scale, setScale] = useState(0.76);

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

  // Fit the screen to the viewport (leave room for the side cards on desktop).
  useEffect(() => {
    const fit = () => {
      const avail = Math.min(940, Math.max(320, window.innerWidth - 96));
      setScale(avail / APP_W);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Scroll progress across the tall section drives both the screen and the cards.
  useEffect(() => {
    const onScroll = () => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = Math.max(0, Math.min(1, -rect.top / (total || 1)));

      const next = progress < 0.4 ? 0 : progress < 0.72 ? 1 : 2;
      setBeat(next);

      // Fire each branch once, and only when the engine is idle so a fast scroll
      // can't drop a message mid-stream.
      const tb = engineRef.current;
      if (!tb) return;
      const fire = (threshold: number, parentId: string, text: string) => {
        if (progress >= threshold && !firedRef.current.has(threshold) && !tb.sending && tb.allMessages.length > 0) {
          firedRef.current.add(threshold);
          tb.handleBranchFromMessage(parentId, text, 'dig');
        }
      };
      fire(0.42, 'd1', 'crack each other up');
      fire(0.74, 'd1', "eggs don't tell jokes");
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
      <header style={{ textAlign: 'center', padding: '64px 24px 8px' }}>
        <div style={{ fontSize: 13, letterSpacing: 2, textTransform: 'uppercase', color: '#60a5fa' }}>TraceBack</div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 46px)', fontWeight: 500, margin: '14px 0 10px', color: '#f8fafc' }}>
          Conversations that branch, not scroll.
        </h1>
        <p style={{ maxWidth: 520, margin: '0 auto', color: '#94a3b8', fontSize: 17, lineHeight: 1.6 }}>
          Scroll to watch a real chat fork into a tree — and send only the path that matters to the model.
        </p>
        <div style={{ marginTop: 26, color: '#475569', fontSize: 13 }}>↓ scroll</div>
      </header>

      <div ref={scrollRef} style={{ position: 'relative', height: '300vh' }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>

          {BEATS.map((b, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                [b.side]: 'max(16px, 5vw)',
                top: b.top,
                width: 232,
                background: '#0f1117',
                border: '1px solid #1e2330',
                borderRadius: 14,
                padding: '14px 16px',
                opacity: beat === i ? 1 : 0.22,
                transform: beat === i ? 'translateY(0)' : `translateY(${b.side === 'left' ? '-' : ''}6px)`,
                transition: 'opacity .5s ease, transform .5s ease'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: '#60a5fa', marginBottom: 4 }}>{b.title}</div>
              <div style={{ fontSize: 13.5, color: '#9aa6b8', lineHeight: 1.5 }}>{b.body}</div>
            </div>
          ))}

          <div style={{ zIndex: 2 }}>
            <div style={{ background: '#1c1c1e', padding: '10px 10px 12px', borderRadius: '18px 18px 5px 5px', border: '1px solid #2a2a2e' }}>
              <div style={{ width: screenW, height: screenH, borderRadius: 8, overflow: 'hidden', background: '#0d0d0d', position: 'relative' }}>
                <div
                  style={{
                    width: APP_W,
                    height: APP_H,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    pointerEvents: 'none'
                  }}
                >
                  <TracebackChat
                    key={demoKey}
                    client={mock}
                    onEngineReady={(tb) => {
                      engineRef.current = tb;
                    }}
                  />
                </div>
              </div>
            </div>
            <div style={{ width: screenW + 60, marginLeft: -30, height: 12, background: '#c4c8ce', borderRadius: '0 0 14px 14px', border: '1px solid #a9adb3' }} />
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '10px 0 80px' }}>
        <button
          onClick={replay}
          style={{ background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 24, padding: '11px 22px', fontSize: 14, cursor: 'pointer' }}
        >
          Replay
        </button>
      </div>
    </div>
  );
}
