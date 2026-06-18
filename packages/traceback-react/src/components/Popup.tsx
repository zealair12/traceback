// Reusable popup primitives.
//
// Float — an anchored dropdown. Measures the trigger's position at open time,
//   opens toward whichever side has more available space (flips above/below),
//   clamps horizontally so it never exits the viewport, and makes its content
//   scrollable when it is taller than the available room.
//
// Modal — a centered overlay card. Always contained within the viewport with
//   internal scrolling when content is tall.
//
// Both render via React portals so they are never clipped by overflow:hidden
// ancestors (sidebar, chat panel, etc.).

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

// ─── Float ────────────────────────────────────────────────────────────────────

interface FloatStyle {
  position: 'fixed';
  width: number;
  maxHeight: number;
  left: number;
  zIndex: number;
  top?: number;
  bottom?: number;
}

interface FloatProps {
  open: boolean;
  onClose: () => void;
  /** Ref pointing at the element the popup should anchor to. */
  triggerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Pixel width of the popup (default 240). */
  width?: number;
  /** Align popup's left or right edge to the trigger's (default 'left'). */
  align?: 'left' | 'right';
  className?: string;
}

export function Float({
  open,
  onClose,
  triggerRef,
  children,
  width = 240,
  align = 'left',
  className = ''
}: FloatProps) {
  const [style, setStyle] = useState<FloatStyle | null>(null);

  // Re-measure whenever open/size/alignment changes, and on resize/scroll.
  useEffect(() => {
    if (!open) { setStyle(null); return; }
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r  = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const GAP    = 6;
      const MARGIN = 8;
      const spaceBelow = vh - r.bottom - GAP;
      const spaceAbove = r.top - GAP;
      const above    = spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(
        above ? spaceAbove : spaceBelow,
        vh * 0.75
      ) - MARGIN);
      let left = align === 'right' ? r.right - width : r.left;
      left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));
      setStyle({
        position: 'fixed',
        width,
        maxHeight,
        left,
        zIndex: 9999,
        ...(above ? { bottom: vh - r.top + GAP } : { top: r.bottom + GAP })
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, triggerRef, width, align]);

  // Escape key closes the popup.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !style) return null;

  // Backdrop pattern: an invisible full-screen div sits behind the popup at
  // z-9998. Clicking anywhere outside the popup hits the backdrop → onClose.
  // Clicking inside the popup hits the popup (z-9999) first — the backdrop
  // never receives those events, so button onClick handlers fire normally.
  // This is more reliable than document mousedown listeners + ref containment
  // checks, and works correctly with React portals on both desktop and mobile.
  return createPortal(
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onMouseDown={onClose}
      />
      <div
        style={style}
        className={`overflow-y-auto rounded-xl border border-gray-700/50 bg-gray-900/95 text-gray-100 backdrop-blur-xl shadow-2xl ${className}`}
      >
        {children}
      </div>
    </>,
    document.body
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  onClose: () => void;
  children: ReactNode;
  /** Max pixel width (capped to viewport − 32 px padding). Default 440. */
  width?: number;
  className?: string;
}

export function Modal({ onClose, children, width = 440, className = '' }: ModalProps) {
  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const inner = useRef<HTMLDivElement>(null);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => { if (!inner.current?.contains(e.target as Node)) onClose(); }}
    >
      <div
        ref={inner}
        style={{ width: Math.min(width, window.innerWidth - 32) }}
        className={`max-h-[90vh] overflow-y-auto rounded-xl border border-gray-700/60 bg-gray-900 text-gray-100 ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
