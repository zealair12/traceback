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

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { TracebackChat } from '../TracebackChat';
import { BrandIcon } from '../components/BrandIcon';
import { MockTracebackClient } from './mockClient';

// Logical size the real app is rendered at, then scaled into the screen. The
// height is chosen so the app's aspect ratio matches the SVG screen cutout
// (836:494), so it fills the screen edge-to-edge with nothing clipped.
const APP_W = 1180;
const APP_H = Math.round((1180 * 494) / 836); // ~697
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

// One rhythm, three modes. Each beat recolors EVERYTHING to a mode -- the app's
// real theme, the page background, the cards, the logo, and the sign-in button
// (white -> blue -> black) -- while only the button changes size.
interface Scheme {
  appTheme: 'dark' | 'blue' | 'light';
  pageBg: string;
  logo: string;
  logoIcon: string;
  cardBg: string;
  cardBorder: string;
  cardTitle: string;
  cardBody: string;
  signinBg: string;
  signinFg: string;
  signinGlow: string;
}
const SCHEMES: Scheme[] = [
  { appTheme: 'dark', pageBg: '#07070a', logo: '#eef0f2', logoIcon: '#3b82f6', cardBg: '#0f1117', cardBorder: '#1e2330', cardTitle: '#60a5fa', cardBody: '#9aa6b8', signinBg: '#ffffff', signinFg: '#3c4043', signinGlow: 'rgba(255,255,255,0.4)' },
  { appTheme: 'blue', pageBg: '#04070f', logo: '#dbeafe', logoIcon: '#3b82f6', cardBg: '#0a1526', cardBorder: '#1a2a4a', cardTitle: '#7cb0ff', cardBody: '#9db4d8', signinBg: '#2563eb', signinFg: '#ffffff', signinGlow: 'rgba(59,130,246,0.55)' },
  { appTheme: 'light', pageBg: '#eceff4', logo: '#1e293b', logoIcon: '#2563eb', cardBg: '#ffffff', cardBorder: '#d5dae2', cardTitle: '#2563eb', cardBody: '#5b6472', signinBg: '#1c1c1e', signinFg: '#ffffff', signinGlow: 'rgba(0,0,0,0.28)' }
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

export function LaptopDemo({ authUrl }: { authUrl?: string }) {
  const mock = useMemo(() => new MockTracebackClient(authUrl ?? ''), [authUrl]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stepRef = useRef(0);

  const [beat, setBeat] = useState(0);
  // The node to focus for the current step. Changing it re-runs the app's real
  // message-load (via the hook), so the shown branch tracks the scroll position
  // in both directions -- no remount needed.
  const [stepActiveId, setStepActiveId] = useState('d1');
  const [laptopW, setLaptopW] = useState(820);
  // The color rhythm: advances every beat, recoloring everything to that mode.
  const [phase, setPhase] = useState(0);
  const scheme = SCHEMES[phase];

  useEffect(() => {
    const id = window.setInterval(() => setPhase((p) => (p + 1) % SCHEMES.length), 2500);
    return () => window.clearInterval(id);
  }, []);

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

  // Size the laptop to the viewport, capped by BOTH width and height so the
  // logo + laptop fit in one screen (nothing needs to scroll to see it all).
  useEffect(() => {
    const fit = () => {
      const wCap = window.innerWidth - 100;
      const hCap = (window.innerHeight - 190) / (VB.h / VB.w); // room for the logo
      setLaptopW(Math.max(320, Math.min(1120, wCap, hCap)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Scroll position maps to a step. Whenever the step changes -- scrolling DOWN
  // or UP -- rebuild the conversation to that step's exact state and reload the
  // app IN PLACE (changing the focused node re-runs the real message-load), so
  // the shown branch always matches the scroll: it reverts on the way up and
  // advances on the way down.
  useEffect(() => {
    const onScroll = () => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const progress = Math.max(0, Math.min(1, -rect.top / (total || 1)));
      const step = progress < 0.24 ? 0 : progress < 0.46 ? 1 : progress < 0.7 ? 2 : 3;
      setBeat(step);
      if (step !== stepRef.current) {
        stepRef.current = step;
        setStepActiveId(mock.buildTo(step));
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [mock]);

  const rootStyle = {
    background: scheme.pageBg,
    color: scheme.logo,
    fontFamily: 'Inter, system-ui, sans-serif',
    transition: 'background-color 1.8s ease, color 1.8s ease',
    '--tb-si-bg': scheme.signinBg,
    '--tb-si-fg': scheme.signinFg,
    '--tb-si-glow': scheme.signinGlow
  } as CSSProperties;

  return (
    <div className="tb-demo-root" style={rootStyle}>
      {/* Sign-in is the only clickable element (the rest is pointer-events:none).
          It pulses in SIZE and takes its colors from the current mode; the page,
          cards, logo and in-frame app only change color, in the same rhythm. */}
      <style>{`
        .tb-demo-root [data-tb-signin]{
          pointer-events:auto !important; cursor:pointer !important;
          background: var(--tb-si-bg) !important; color: var(--tb-si-fg) !important;
          transition: background-color 1.8s ease, color 1.8s ease, transform .6s ease, box-shadow .8s ease;
          animation: tb-pulse 2.5s ease-in-out infinite;
        }
        .tb-demo-root [data-tb-signin] *{ cursor:pointer !important; }
        @keyframes tb-pulse{
          0%,100%{ transform: scale(1.06); box-shadow: 0 0 24px 4px var(--tb-si-glow); }
          50%{ transform: scale(1); box-shadow: 0 0 0 0 transparent; }
        }
      `}</style>

      {/* Everything lives in ONE pinned viewport: the logo and laptop never move
          as you scroll -- scrolling only advances the demo steps, so "traceback"
          stays at the top the whole time. */}
      <div ref={scrollRef} style={{ position: 'relative', height: `${(STEPS + 1) * 100}vh` }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden' }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 18, paddingTop: 'clamp(20px, 4vh, 52px)', paddingBottom: 6, flexShrink: 0 }}>
            <span style={{ color: scheme.logoIcon, display: 'inline-flex', transform: 'translateY(3px)', transition: 'color 1.8s ease' }}><BrandIcon size={70} /></span>
            <span style={{ fontSize: 'clamp(42px, 7vw, 84px)', fontWeight: 400, letterSpacing: 8, lineHeight: 1, color: scheme.logo, transition: 'color 1.8s ease' }}>traceback</span>
          </header>
          <div style={{ position: 'relative', flex: 1, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {BEATS.map((b, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                [b.side]: 'max(16px, 4vw)',
                top: b.top,
                width: 224,
                background: scheme.cardBg,
                border: `1px solid ${scheme.cardBorder}`,
                borderRadius: 14,
                padding: '14px 16px',
                opacity: beat === i ? 1 : 0.32,
                transform: beat === i ? 'translateY(0)' : `translateY(${b.side === 'left' ? '-' : ''}6px)`,
                transition: 'opacity .5s ease, transform .5s ease, background-color 1.8s ease, border-color 1.8s ease'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: scheme.cardTitle, marginBottom: 4, transition: 'color 1.8s ease' }}>{b.title}</div>
              <div style={{ fontSize: 13.5, color: scheme.cardBody, lineHeight: 1.5, transition: 'color 1.8s ease' }}>{b.body}</div>
            </div>
          ))}

            <div style={{ zIndex: 2 }}>
              <LaptopFrame width={laptopW}>
                <TracebackChat client={mock} initialActiveNodeId={stepActiveId} themeOverride={scheme.appTheme} />
              </LaptopFrame>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
