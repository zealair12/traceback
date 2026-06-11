import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ChatMessage } from '../types';
import { normalizeLatex } from '../utils/text';
import { FileText } from 'lucide-react';
import { BrandIcon } from './BrandIcon';

interface MessageBubbleProps {
  message: ChatMessage;
  onBranchFromMessage: (messageId: string, selectedText: string, action: 'dig' | 'ask') => void;
}

// Where the selection toolbar should appear, in screen coordinates.
interface PopoverState {
  x: number;
  top: number;
  bottom: number;
  text: string;
}

/**
 * Renders a single chat message with markdown formatting.
 *
 * Branching from an assistant reply works two ways, both designed to feel like
 * familiar editor behavior (no right-click needed):
 * - Select any text in the reply and a small floating toolbar appears at the
 *   selection: dig deeper, ask about it, or copy it.
 * - Hover the reply and a subtle "Branch" button appears, to fork the
 *   conversation from this point without picking a specific passage.
 */
export function MessageBubble({ message, onBranchFromMessage }: MessageBubbleProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Show the toolbar when the user finishes selecting text inside this bubble.
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    if (!containerRef.current?.contains(sel.anchorNode)) return;
    // Read the text from the range rather than the selection: it is identical
    // for a normal click-drag, but keeps working when the window lacks focus.
    const range = sel.getRangeAt(0);
    const text = range.toString().trim();
    if (!text) return;
    const rect = range.getBoundingClientRect();
    setPopover({ x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom, text });
  }, []);

  // Hide the toolbar whenever the selection goes away (click elsewhere, Escape).
  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPopover(null);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  const actAndDismiss = useCallback((action: () => void) => {
    action();
    window.getSelection()?.removeAllRanges();
    setPopover(null);
  }, []);

  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl rounded-3xl bg-bubbleUser px-4 py-3 text-sm text-white whitespace-pre-wrap">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {message.attachments.map((att, i) =>
                att.type === 'image' ? (
                  <img
                    key={i}
                    src={att.dataUrl}
                    alt={`attached image ${i + 1}`}
                    className="max-h-44 max-w-[240px] rounded-xl object-contain"
                  />
                ) : (
                  <span
                    key={i}
                    className="px-2.5 py-1.5 rounded-lg bg-black/20 text-[11px] text-gray-200 flex items-center gap-1.5"
                  >
                    <FileText size={13} className="flex-shrink-0" />
                    <span className="truncate max-w-[160px]">{att.name ?? 'document.pdf'}</span>
                  </span>
                )
              )}
            </div>
          )}
          {message.content}
        </div>
      </div>
    );
  }

  // Place the toolbar above the selection, or below it when too close to the
  // top of the window to fit.
  const placeAbove = popover ? popover.top > 70 : true;

  const toolbarButton =
    'px-2.5 py-1 text-[12px] text-gray-200 hover:bg-gray-700/70 transition-colors flex items-center gap-1.5 whitespace-nowrap';

  return (
    <div className="group flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-blue-400 mt-1 flex-shrink-0">
        <BrandIcon size={15} />
      </div>
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="flex-1 text-sm text-gray-100 leading-relaxed min-w-0 prose-tb"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {normalizeLatex(message.content)}
        </ReactMarkdown>
        {/* Small "answered by" badge so you can see which model produced
            this reply -- useful when branches use different models. */}
        {message.model && (
          <div className="mt-1.5 text-[10px] text-gray-600">
            {message.provider ? `${message.provider} · ${message.model}` : message.model}
          </div>
        )}
      </div>

      {/* Fork the conversation from this reply without selecting text.
          Appears when hovering the message. */}
      <button
        type="button"
        onClick={() => onBranchFromMessage(message.id, '', 'ask')}
        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-1 text-[11px] text-gray-500 hover:text-emerald-400 border border-gray-800 hover:border-emerald-700 rounded-md px-2 py-0.5"
        title="Branch the conversation from this reply"
      >
        ⎇ Branch
      </button>

      {/* Floating toolbar at the text selection. */}
      {popover && (
        <div
          className="fixed z-[100] flex rounded-lg shadow-2xl border border-gray-700/80 backdrop-blur-xl overflow-hidden"
          style={{
            top: placeAbove ? popover.top - 8 : popover.bottom + 8,
            left: popover.x,
            transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            background: 'rgba(17,17,27,0.96)'
          }}
          onMouseDown={(e) => e.preventDefault() /* keep the selection alive while clicking */}
        >
          <button
            type="button"
            className={toolbarButton}
            onClick={() => actAndDismiss(() => onBranchFromMessage(message.id, popover.text, 'dig'))}
          >
            <span className="text-emerald-400">↳</span>
            <span>Dig deeper</span>
          </button>
          <div className="w-px bg-gray-700/60" />
          <button
            type="button"
            className={toolbarButton}
            onClick={() => actAndDismiss(() => onBranchFromMessage(message.id, popover.text, 'ask'))}
          >
            <span className="text-emerald-400">?</span>
            <span>Ask about this</span>
          </button>
          <div className="w-px bg-gray-700/60" />
          <button
            type="button"
            className={toolbarButton}
            onClick={() => actAndDismiss(() => navigator.clipboard.writeText(popover.text))}
          >
            <span>⎘</span>
            <span>Copy</span>
          </button>
        </div>
      )}
    </div>
  );
}
