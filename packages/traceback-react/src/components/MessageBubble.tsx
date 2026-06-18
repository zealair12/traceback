import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ChatMessage } from '../types';
import { normalizeLatex } from '../utils/text';
import { FileText, Pencil, RotateCcw, Copy, Check } from 'lucide-react';
import { BrandIcon } from './BrandIcon';

interface MessageBubbleProps {
  message: ChatMessage;
  onBranchFromMessage: (messageId: string, selectedText: string, action: 'dig' | 'ask') => void;
  onResendMessage: (messageId: string) => void;
  onEditMessage: (messageId: string, newContent: string) => void;
}

interface PopoverState {
  x: number;
  top: number;
  bottom: number;
  text: string;
}

export function MessageBubble({ message, onBranchFromMessage, onResendMessage, onEditMessage }: MessageBubbleProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    if (!containerRef.current?.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const text = range.toString().trim();
    if (!text) return;
    const rect = range.getBoundingClientRect();
    setPopover({ x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom, text });
  }, []);

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

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const isUser = message.role === 'user';

  // ── User message ──────────────────────────────────────────────
  if (isUser) {
    return (
      <div className="group flex justify-end items-start gap-2">
        {/* Edit / resend — shown on hover, hidden while editing */}
        {!isEditing && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 mt-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => { setEditValue(message.content); setIsEditing(true); }}
              className="h-6 w-6 rounded flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={() => onResendMessage(message.id)}
              className="h-6 w-6 rounded flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
              title="Resend"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        )}

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

          {isEditing ? (
            <div>
              <textarea
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (editValue.trim()) {
                      onEditMessage(message.id, editValue.trim());
                      setIsEditing(false);
                    }
                  } else if (e.key === 'Escape') {
                    setIsEditing(false);
                  }
                }}
                className="w-full bg-transparent resize-none outline-none text-sm leading-relaxed"
                rows={Math.max(2, editValue.split('\n').length)}
              />
              <div className="flex gap-2 mt-2.5">
                <button
                  type="button"
                  disabled={!editValue.trim()}
                  onClick={() => {
                    if (editValue.trim()) {
                      onEditMessage(message.id, editValue.trim());
                      setIsEditing(false);
                    }
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-white text-black hover:bg-gray-200 disabled:opacity-40"
                >
                  Send ↑
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="text-[11px] px-2.5 py-1 rounded-full border border-white/20 text-gray-300 hover:bg-white/10"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            message.content
          )}
        </div>
      </div>
    );
  }

  // ── Assistant message ─────────────────────────────────────────
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
        {message.model && (
          <div className="mt-1.5 text-[10px] text-gray-600">
            {message.provider ? `${message.provider} · ${message.model}` : message.model}
          </div>
        )}
      </div>

      {/* Copy + Branch actions */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 mt-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => handleCopy(message.content)}
          className="h-6 w-6 rounded flex items-center justify-center text-gray-500 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          title="Copy"
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
        <button
          type="button"
          onClick={() => onBranchFromMessage(message.id, '', 'ask')}
          className="text-[11px] text-gray-500 hover:text-gray-200 border border-gray-800 hover:border-gray-600 rounded-md px-2 py-0.5 transition-colors"
          title="Branch the conversation from this reply"
        >
          ⎇
        </button>
      </div>

      {/* Floating selection toolbar */}
      {popover && (
        <div
          className="fixed z-[100] flex rounded-lg shadow-2xl border border-gray-700/80 backdrop-blur-xl overflow-hidden"
          style={{
            top: placeAbove ? popover.top - 8 : popover.bottom + 8,
            left: popover.x,
            transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            background: 'rgba(17,17,27,0.96)'
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className={toolbarButton}
            onClick={() => actAndDismiss(() => onBranchFromMessage(message.id, popover.text, 'dig'))}
          >
            <span>↳</span>
            <span>Explain</span>
          </button>
          <div className="w-px bg-gray-700/60" />
          <button
            type="button"
            className={toolbarButton}
            onClick={() => actAndDismiss(() => onBranchFromMessage(message.id, popover.text, 'ask'))}
          >
            <span>?</span>
            <span>Ask</span>
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
