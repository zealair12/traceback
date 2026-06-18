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
        vh * 0.75              // never taller than 75 % of the viewport
      ) - MARGIN);
      // Horizontal: default to trigger-left/right, then clamp to viewport.
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

  // Close on click outside (delayed so the trigger's own click doesn't fire it).
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const id = setTimeout(() => document.addEventListener('mousedown', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', close);
    };
  }, [open, onClose, triggerRef]);

  if (!open || !style) return null;

  return createPortal(
    <div
      style={style}
      className={`overflow-y-auto rounded-xl border border-gray-700/60 bg-gray-950/95 backdrop-blur-xl shadow-2xl ${className}`}
    >
      {children}
    </div>,
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
        className={`max-h-[90vh] overflow-y-auto rounded-xl border border-gray-800 bg-gray-900 text-gray-100 ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
