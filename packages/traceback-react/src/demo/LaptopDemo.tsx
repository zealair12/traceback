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
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { TracebackChat } from '../TracebackChat';
import { BrandIcon } from '../components/BrandIcon';
import { MockTracebackClient } from './mockClient';

// Logical size the real app is rendered at, then scaled into the screen. The
// height is chosen so the app's aspect ratio matches the SVG screen cutout
// (836:494), so it fills the screen edge-to-edge with nothing clipped.
const APP_W = 1180;
const APP_H = Math.round((1180 * 502) / 860); // matches the screen-cutout aspect
// Each step gets roughly one viewport of scroll; +1 viewport of lead-in room.
const STEPS = 4;

interface Beat {
  body: string;
  side: 'left' | 'right';
  row: 'upper' | 'lower';
}
// Terminal-style cards flank the laptop (two per side, one upper + one lower)
// so the active one always sits beside the screen. On narrow screens where they
// cannot flank without colliding with the laptop, only the active card shows,
// placed just below the laptop instead.
const BEATS: Beat[] = [
  { body: 'Your whole conversation is saved as a tree, so nothing gets lost in scroll.', side: 'left', row: 'upper' },
  { body: 'Take any reply in a new direction without starting a new chat.', side: 'right', row: 'upper' },
  { body: 'The model only reads the branch you are on, not every unrelated tangent, so it stays focused on what matters.', side: 'right', row: 'lower' },
  { body: 'Keep several answers side by side and compare them instead of asking again.', side: 'left', row: 'lower' }
];
// Card geometry, shared by the flank/stack math below.
const CARD_W = 236;
const CARD_GAP = 28;

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
  { appTheme: 'light', pageBg: '#eceff4', logo: '#000000', logoIcon: '#2563eb', cardBg: '#ffffff', cardBorder: '#d5dae2', cardTitle: '#2563eb', cardBody: '#5b6472', signinBg: '#1c1c1e', signinFg: '#ffffff', signinGlow: 'rgba(0,0,0,0.28)' }
];

// A hand-authored MacBook SVG frame: vector, crisp at any size, no external
// asset. We control the screen-cutout coordinates, so the live app overlays it
// perfectly (no eyeballing insets on a photo). Swap in a photo later if you want
// full photorealism.
const VB = { w: 1000, h: 620 };
const SCREEN = { x: 70, y: 54, w: 860, h: 502 };

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
        {/* base deck: sits directly under the lid; the lid is drawn on top of
            the join, so from the front there is no visible hinge gap */}
        <rect x="44" y="572" width="912" height="26" rx="11" fill="url(#tb-deck)" />
        {/* the dark opening dent (finger notch): a wide, shallow U -- square top
            corners, only the bottom two rounded */}
        <path d="M440 575 L560 575 L560 578 Q560 584 554 584 L446 584 Q440 584 440 578 Z" fill="#141519" />
        {/* rubber feet: short cylinders, so thin rectangles from the front.
            Their top overlaps just 2 units INTO the deck bottom (deck ends at
            y=598) -- enough that no background sliver shows between deck and
            foot at any scale/DPI or in light theme -- while the rest protrudes
            clearly below, so the foot reads as a pad under the base, not buried
            half-inside it. */}
        <rect x="98" y="596" width="64" height="12" rx="1.5" fill="#16171b" />
        <rect x="838" y="596" width="64" height="12" rx="1.5" fill="#16171b" />
        {/* lid: rounded top corners only; bottom corners square (that edge sits
            into the keyboard deck and is not visible). Its top radius is exactly
            the bezel radius + 6 so the grey border is a uniform 6px, corners
            included. The bottom grey is a thin cut. */}
        <path d="M56 38 Q56 16 78 16 L922 16 Q944 16 944 38 L944 572 L56 572 Z" fill="url(#tb-alu)" stroke="#54555b" strokeWidth="1" />
        {/* black bezel: thin at the sides and bottom, taller at the top; bottom
            corners sharp (square), extended down so only a thin grey cut remains */}
        <path d="M62 38 Q62 22 78 22 L922 22 Q938 22 938 38 L938 570 L62 570 Z" fill="#0a0a0c" />
        {/* webcam, centered in the top edge (no on-light, to avoid implying the
            camera is required) */}
        <circle cx="500" cy="38" r="3.4" fill="#111116" stroke="#2a2a30" strokeWidth="0.8" />
        <circle cx="500" cy="38" r="1.2" fill="#2c2c34" />
        {/* screen cutout (rounded top, square bottom): the app overlays here */}
        <path d={`M${SCREEN.x} ${SCREEN.y + 5} Q${SCREEN.x} ${SCREEN.y} ${SCREEN.x + 5} ${SCREEN.y} L${SCREEN.x + SCREEN.w - 5} ${SCREEN.y} Q${SCREEN.x + SCREEN.w} ${SCREEN.y} ${SCREEN.x + SCREEN.w} ${SCREEN.y + 5} L${SCREEN.x + SCREEN.w} ${SCREEN.y + SCREEN.h} L${SCREEN.x} ${SCREEN.y + SCREEN.h} Z`} fill="#0d0d0d" />
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
          borderRadius: '4px 4px 0 0'
        }}
      >
        <div style={{ position: 'absolute', top: (sh - appH) / 2, left: (sw - appW) / 2, width: APP_W, height: APP_H, transform: `scale(${appScale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// The mobile card: one persistent terminal box whose body text animates when
// the beat changes -- the current line highlights (a visible selection), gets
// deleted, then the new line types in with a blinking caret.
//
// Fast-scroll handling: a debounce. When the text prop changes, we wait ~150ms
// for the scroll to SETTLE before animating, and every new target cancels the
// pending/in-flight sequence. So blowing through beats does not fire a
// highlight/delete/type for each one -- the box holds its last line, then plays
// exactly one clean animation to the beat you land on.
function TypeCard({ text, width }: { text: string; width: number }) {
  const [shown, setShown] = useState(text);
  const [highlight, setHighlight] = useState(false);
  const shownRef = useRef(text);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);

  useEffect(() => {
    let cancelled = false;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) =>
      timers.push(window.setTimeout(() => { if (!cancelled) fn(); }, ms));

    at(150, () => {
      if (shownRef.current === text) return; // already showing the settled line
      setHighlight(true); // 1) select the whole current line
      at(240, () => {
        setHighlight(false);
        setShown(''); // 2) delete it
        let i = 0;
        const type = () => {
          i += 1;
          setShown(text.slice(0, i));
          if (i < text.length) at(18, type); // 3) type the new line out
        };
        at(110, type);
      });
    });

    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [text]);

  return (
    <div style={{ width, background: '#0e1117', border: '1px solid #262b36', borderRadius: 12, overflow: 'hidden' }}>
      {/* Terminal chrome: traffic lights left, the traceback mark right. */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 13px', borderBottom: '1px solid #1b1f27' }}>
        <div style={{ display: 'flex', gap: 7 }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f56' }} />
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ffbd2e' }} />
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#27c93f' }} />
        </div>
        <span aria-hidden="true" style={{ color: '#6ea8fe', display: 'inline-flex' }}><BrandIcon size={16} /></span>
      </div>
      {/* Fixed min-height so the box never resizes as the line length changes. */}
      <div style={{ padding: '14px 16px', minHeight: 92, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13.5, lineHeight: 1.6, color: '#c9d1d9' }}>
        <span style={{ background: highlight ? 'rgba(96,165,250,0.4)' : 'transparent', borderRadius: 2, WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone', transition: 'background .12s ease' }}>{shown}</span>
        <span className="tb-caret" aria-hidden="true" />
      </div>
    </div>
  );
}

// A one-shot confetti burst. Mounting it fires a batch of pieces that fall,
// drift, and spin over ~2s; the parent unmounts it after the celebration.
const CONFETTI_COLORS = ['#3b82f6', '#ffffff', '#ff5f56', '#ffbd2e', '#27c93f', '#a78bfa'];
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 90 }, () => ({
        left: Math.random() * 100,
        bg: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        delay: Math.random() * 0.25,
        dur: 1.5 + Math.random() * 1.1,
        w: 6 + Math.random() * 6,
        drift: (Math.random() - 0.5) * 260,
        spin: 600 + Math.random() * 800
      })),
    []
  );
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 60, overflow: 'hidden' }} aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              position: 'absolute',
              top: '-6vh',
              left: `${p.left}%`,
              width: p.w,
              height: p.w * 1.6,
              background: p.bg,
              borderRadius: 2,
              '--tb-drift': `${p.drift}px`,
              '--tb-spin': `${p.spin}deg`,
              animation: `tb-confetti ${p.dur}s ${p.delay}s cubic-bezier(.2,.6,.4,1) forwards`
            } as CSSProperties
          }
        />
      ))}
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
  const [vw, setVw] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  // The color rhythm: advances every beat, recoloring everything to that mode.
  const [phase, setPhase] = useState(0);
  const scheme = SCHEMES[phase];

  // Card placement. When the space beside the laptop can hold a card without
  // colliding with it, the cards flank the laptop (hugging its edges with a
  // fixed gap). Otherwise (narrow/mobile) they cannot flank, so only the active
  // card shows, placed just below the laptop where it never overlaps.
  const halfLaptop = laptopW / 2;
  // Flank on desktop/laptop widths (the laptop is sized above to leave room);
  // stack below on narrower screens where the typewriter box sits under it.
  const canFlank = vw >= 1024;
  // Mobile box: near the screen width, matched under the laptop.
  const boxW = Math.min(vw - 36, 440);

  // Feedback easter egg: thumbs up shakes the laptop + fires confetti for ~2s
  // (everything on the screen stays intact, it just shakes); thumbs down... well.
  const [celebrating, setCelebrating] = useState(false);
  const [burst, setBurst] = useState(0);
  const handleThumbsUp = () => {
    setBurst((b) => b + 1);
    setCelebrating(true);
    window.setTimeout(() => setCelebrating(false), 2000);
  };
  const handleThumbsDown = () => {
    window.location.href = 'https://youtu.be/dQw4w9WgXcQ?si=YBKjSgfe-2JFBjll&t=44';
  };

  useEffect(() => {
    const id = window.setInterval(() => setPhase((p) => (p + 1) % SCHEMES.length), 5000);
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
      const W = window.innerWidth;
      const Hh = window.innerHeight;
      setVw(W);
      if (W >= 1024) {
        // Flank: reserve a card's width on each side so the laptop is sized to
        // leave space for the cards (never overlapping).
        const wCap = W - (2 * (CARD_W + CARD_GAP) + 48);
        // Reserve vertical room for the logo above AND the "use traceback"
        // button below, so both fit in one screen and the laptop sits higher.
        const hCap = (Hh - 320) / (VB.h / VB.w);
        setLaptopW(Math.max(300, Math.min(1120, wCap, hCap)));
      } else {
        // Stacked (mobile): laptop near the screen width with small margins;
        // reserve vertical room for the logo above and the typewriter box below.
        const wCap = W - 36;
        // Reserve room for the logo, the typewriter box, AND the CTA button.
        const hCap = (Hh - 440) / (VB.h / VB.w);
        setLaptopW(Math.max(280, Math.min(620, wCap, hCap)));
      }
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
    transition: 'background-color 2.5s ease, color 2.5s ease',
    '--tb-si-bg': scheme.signinBg,
    '--tb-si-fg': scheme.signinFg,
    '--tb-si-glow': scheme.signinGlow
  } as CSSProperties;

  // The bold call to action + a plain thumbs up/down row. Same width as the
  // laptop; on desktop it pins to the bottom of the screen, on mobile it tucks
  // into the centered stack. The button runs the same sign-in as the in-laptop
  // easter-egg button.
  const ctaBlock = (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        width: laptopW,
        flexShrink: 0,
        marginTop: canFlank ? 24 : 0,
        marginBottom: canFlank ? 'clamp(18px, 4vh, 48px)' : 0
      }}
    >
      <button
        type="button"
        data-tb-cta
        onClick={() => mock.signIn()}
        style={{
          width: '100%',
          border: 'none',
          borderRadius: 18,
          padding: 'clamp(15px, 2.2vh, 24px) 0',
          background: scheme.signinBg,
          color: scheme.signinFg,
          fontFamily: 'inherit',
          fontSize: 'clamp(19px, 2.3vw, 30px)',
          fontWeight: 500,
          letterSpacing: 3,
          lineHeight: 1
        }}
      >
        use traceback
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <button type="button" data-tb-thumb aria-label="I like this" onClick={handleThumbsUp}>
          <ThumbsUp size={22} />
        </button>
        <button type="button" data-tb-thumb aria-label="I do not like this" onClick={handleThumbsDown}>
          <ThumbsDown size={22} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="tb-demo-root" style={rootStyle}>
      {/* Sign-in is the only clickable element (the rest is pointer-events:none).
          It pulses in SIZE and takes its colors from the current mode; the page,
          cards, logo and in-frame app only change color, in the same rhythm. */}
      <style>{`
        .tb-demo-root [data-theme], .tb-demo-root [data-theme] *{
          transition: background-color 2.5s ease, border-color 2.5s ease, fill 2.5s ease, stroke 2.5s ease, color 2.5s ease;
        }
        .tb-demo-root [data-tb-signin]{
          pointer-events:auto !important; cursor:pointer !important;
          background: var(--tb-si-bg) !important; color: var(--tb-si-fg) !important;
          transition: background-color 2.5s ease, color 2.5s ease, transform .6s ease, box-shadow .8s ease;
          animation: tb-pulse 5s ease-in-out infinite;
        }
        .tb-demo-root [data-tb-signin] *{ cursor:pointer !important; }
        @keyframes tb-pulse{
          0%,100%{ transform: scale(1.06); box-shadow: 0 0 24px 4px var(--tb-si-glow); }
          50%{ transform: scale(1); box-shadow: 0 0 0 0 transparent; }
        }
        .tb-caret{
          display:inline-block; width:7px; height:1.05em; margin-left:2px;
          vertical-align:-2px; background:#6ea8fe; animation: tb-blink 1s step-end infinite;
        }
        @keyframes tb-blink{ 0%,100%{opacity:1} 50%{opacity:0} }
        .tb-demo-root [data-tb-cta]{
          cursor:pointer; pointer-events:auto;
          transition: background-color 2.5s ease, color 2.5s ease, transform .2s ease;
        }
        .tb-demo-root [data-tb-cta]:hover{ transform: scale(1.035); }
        .tb-demo-root [data-tb-thumb]{
          background:none; border:none; padding:6px; cursor:pointer; color:inherit;
          opacity:.5; display:inline-flex; transition: opacity .2s ease, transform .2s ease;
        }
        .tb-demo-root [data-tb-thumb]:hover{ opacity:1; transform: scale(1.18); }
        @keyframes tb-shake{
          0%,100%{ transform: translate(0,0) rotate(0deg); }
          10%{ transform: translate(-7px,3px) rotate(-1.6deg); }
          20%{ transform: translate(8px,-3px) rotate(1.6deg); }
          30%{ transform: translate(-8px,2px) rotate(-1.4deg); }
          40%{ transform: translate(8px,-2px) rotate(1.4deg); }
          50%{ transform: translate(-6px,3px) rotate(-1.2deg); }
          60%{ transform: translate(7px,-3px) rotate(1.2deg); }
          70%{ transform: translate(-6px,2px) rotate(-1deg); }
          80%{ transform: translate(6px,-2px) rotate(1deg); }
          90%{ transform: translate(-4px,1px) rotate(-0.6deg); }
        }
        .tb-shake{ animation: tb-shake 0.5s linear 4; }
        @keyframes tb-confetti{
          0%{ transform: translate(0,-6vh) rotate(0deg); opacity:1; }
          100%{ transform: translate(var(--tb-drift), 112vh) rotate(var(--tb-spin)); opacity:1; }
        }
      `}</style>

      {celebrating && <Confetti key={burst} />}

      {/* Everything lives in ONE pinned viewport: the logo and laptop never move
          as you scroll -- scrolling only advances the demo steps, so "traceback"
          stays at the top the whole time. */}
      <div ref={scrollRef} style={{ position: 'relative', height: `${(STEPS + 1) * 100}vh` }}>
        <div style={{ position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'hidden' }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 18, paddingTop: 'clamp(20px, 4vh, 52px)', paddingBottom: 6, flexShrink: 0 }}>
            <span style={{ color: scheme.logoIcon, display: 'inline-flex', transform: 'translateY(3px)', transition: 'color 2.5s ease' }}><BrandIcon size={70} /></span>
            <span style={{ fontSize: 'clamp(42px, 7vw, 84px)', fontWeight: 400, letterSpacing: 8, lineHeight: 1, color: scheme.logo, transition: 'color 2.5s ease' }}>traceback</span>
          </header>
          <div style={{ position: 'relative', flex: 1, width: '100%', display: 'flex', justifyContent: 'center', alignItems: canFlank ? 'center' : 'stretch', paddingTop: canFlank ? 0 : 'clamp(8px, 2vh, 24px)', paddingBottom: canFlank ? 0 : 'clamp(16px, 3vh, 32px)' }}>
          {/* Desktop: four terminal cards flank the laptop, the active one lit. */}
          {canFlank &&
            BEATS.map((b, i) => {
              const active = beat === i;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    zIndex: 3,
                    background: '#0e1117',
                    border: '1px solid #262b36',
                    borderRadius: 10,
                    overflow: 'hidden',
                    transition: 'opacity .5s ease, transform .5s ease',
                    top: b.row === 'upper' ? 'calc(50% - 168px)' : 'calc(50% + 6px)',
                    left:
                      b.side === 'left'
                        ? `calc(50% - ${halfLaptop + CARD_GAP + CARD_W}px)`
                        : `calc(50% + ${halfLaptop + CARD_GAP}px)`,
                    width: CARD_W,
                    opacity: active ? 1 : 0.32,
                    transform: active ? 'translateY(0)' : `translateY(${b.side === 'left' ? '-' : ''}6px)`
                  }}
                >
                  {/* Terminal chrome: traffic lights left, the traceback mark right. */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', borderBottom: '1px solid #1b1f27' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff5f56' }} />
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ffbd2e' }} />
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#27c93f' }} />
                    </div>
                    <span aria-hidden="true" style={{ color: '#6ea8fe', display: 'inline-flex' }}><BrandIcon size={15} /></span>
                  </div>
                  <div style={{ padding: '11px 13px 13px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12.5, lineHeight: 1.55, color: '#c9d1d9' }}>{b.body}</div>
                </div>
              );
            })}

            {/* Centered unit: the laptop, and on mobile the persistent typewriter
                box directly below it (both near the screen width). */}
            <div style={{ zIndex: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: canFlank ? 'flex-start' : 'space-between', gap: 0 }}>
              {/* Wrapper takes the shake so the whole laptop (app intact) jitters. */}
              <div style={{ display: 'flex' }} className={celebrating ? 'tb-shake' : undefined}>
                <LaptopFrame width={laptopW}>
                  <TracebackChat client={mock} initialActiveNodeId={stepActiveId} themeOverride={scheme.appTheme} forceDesktop />
                </LaptopFrame>
              </div>
              {!canFlank && <TypeCard text={BEATS[beat].body} width={boxW} />}
              {/* Mobile: the CTA tucks into the centered stack under the box. */}
              {!canFlank && ctaBlock}
            </div>
          </div>

          {/* Desktop: the CTA pins to the bottom of the screen, laptop-wide. */}
          {canFlank && ctaBlock}
        </div>
      </div>
    </div>
  );
}
