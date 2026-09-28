import { useState, useRef, useEffect, useCallback, useMemo, type ComponentProps, type MouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ChatMessage } from '../types';
import { normalizeLatex } from '../utils/text';
import { FileText, Pencil, RotateCcw, Copy, Check } from 'lucide-react';
import { BrandIcon } from './BrandIcon';
import { splitAskQuote, type BranchAnchorGroup } from '../lib/branchAnchors';
import { rehypeBranchAnchors } from '../lib/rehypeBranchAnchors';

interface MessageBubbleProps {
  message: ChatMessage;
  onBranchFromMessage: (messageId: string, selectedText: string, action: 'dig' | 'ask') => void;
  onResendMessage: (messageId: string) => void;
  onEditMessage: (messageId: string, newContent: string) => void;
  // Providers the user added their own key for. The model label is shown only
  // for a backend the user explicitly chose, and hidden for the built-in
  // default (whatever provider powers "Auto").
  keyedProviders: Set<string>;
  // Passages in this reply that branches grew from; clicking one opens its branch.
  branchAnchors?: BranchAnchorGroup[];
  onOpenBranch?: (childId: string) => void;
}

interface PopoverState {
  x: number;
  top: number;
  bottom: number;
  text: string;
}

// Where to show the "which branch?" menu when one passage has several branches.
interface AnchorMenuState {
  x: number;
  top: number;
  bottom: number;
  branches: BranchAnchorGroup['branches'];
}

type RehypePlugins = NonNullable<ComponentProps<typeof ReactMarkdown>['rehypePlugins']>;

export function MessageBubble({
  message,
  onBranchFromMessage,
  onResendMessage,
  onEditMessage,
  keyedProviders,
  branchAnchors,
  onOpenBranch
}: MessageBubbleProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [anchorMenu, setAnchorMenu] = useState<AnchorMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Mark the passages branched from, after math renders so matching sees the
  // same text the user highlighted.
  const rehypePlugins = useMemo(
    () => [rehypeKatex, [rehypeBranchAnchors, branchAnchors ?? []]] as RehypePlugins,
    [branchAnchors]
  );

  // Clicking a marked passage opens its branch (or asks which, if several).
  const handleAnchorClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-branch-children]');
    if (!el || !onOpenBranch) return;
    // A drag that ends on a marked passage is a new selection, not a click.
    if (window.getSelection()?.isCollapsed === false) return;
    const ids = (el.dataset.branchChildren ?? '').split(' ').filter(Boolean);
    if (ids.length === 1) {
      onOpenBranch(ids[0]);
      return;
    }
    const group = branchAnchors?.find((g) => g.branches.some((b) => ids.includes(b.childId)));
    if (!group) return;
    const r = el.getBoundingClientRect();
    setAnchorMenu({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom, branches: group.branches });
  };

  // Close the branch menu on an outside click, Escape, or scroll.
  useEffect(() => {
    if (!anchorMenu) return;
    const close = (e: Event) => {
      if (e.type === 'mousedown' && menuRef.current?.contains(e.target as Node)) return;
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      setAnchorMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [anchorMenu]);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Open a non-image attachment (e.g. a PDF) in a new tab. data: URLs are often
  // blocked there, so convert to a blob URL first.
  const openFile = (dataUrl: string) => {
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((b) => window.open(URL.createObjectURL(b), '_blank'))
      .catch(() => {});
  };

  const showToolbar = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    if (!containerRef.current?.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    const text = range.toString().trim();
    if (!text) return;
    const rect = range.getBoundingClientRect();
    setPopover({ x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom, text });
  }, []);

  // Desktop: mouseup fires immediately after selection ends.
  const handleMouseUp = showToolbar;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onSelectionChange = () => {
      clearTimeout(timer);
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setPopover(null);
        return;
      }
      // On mobile, selectionchange fires continuously while dragging handles.
      // Debounce so the toolbar appears only once the selection stabilises.
      timer = setTimeout(showToolbar, 300);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [showToolbar]);

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
          <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center gap-1 mt-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => { setEditValue(message.content); setIsEditing(true); }}
              className="h-6 w-6 rounded flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={() => onResendMessage(message.id)}
              className="h-6 w-6 rounded flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
              title="Resend"
            >
              <RotateCcw size={12} />
            </button>
          </div>
        )}

        <div className="max-w-[85%] md:max-w-[70%] rounded-3xl bg-bubbleUser px-4 py-3 text-sm text-white whitespace-pre-wrap">
          {message.attachments && message.attachments.length > 0 && (
            <div className="flex gap-2 flex-wrap mb-2">
              {message.attachments.map((att, i) =>
                att.type === 'image' ? (
                  <img
                    key={i}
                    src={att.dataUrl}
                    alt={`attached image ${i + 1}`}
                    onClick={() => setLightbox(att.dataUrl)}
                    className="max-h-44 max-w-[240px] rounded-xl object-contain cursor-zoom-in"
                  />
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => openFile(att.dataUrl)}
                    className="px-2.5 py-1.5 rounded-lg bg-black/20 text-[11px] text-gray-200 flex items-center gap-1.5 hover:bg-black/30 transition-colors"
                    title="Open file"
                  >
                    <FileText size={13} className="flex-shrink-0" />
                    <span className="truncate max-w-[160px]">{att.name ?? 'document.pdf'}</span>
                  </button>
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
            (() => {
              const { quote, body } = splitAskQuote(message.content);
              return (
                <>
                  {quote && (
                    <div className="mb-2 flex items-start gap-2 rounded-lg bg-black/15 py-1.5 pl-2 pr-2.5">
                      <div className="w-[3px] self-stretch rounded-full bg-blue-400 flex-shrink-0" />
                      <p className="flex-1 min-w-0 text-xs opacity-70 line-clamp-3 break-words py-0.5">{quote}</p>
                    </div>
                  )}
                  {body}
                </>
              );
            })()
          )}
        </div>
        {lightbox && (
          <div
            className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4 cursor-zoom-out"
            onClick={() => setLightbox(null)}
          >
            <img src={lightbox} alt="attachment" className="max-h-full max-w-full rounded-lg object-contain" />
          </div>
        )}
      </div>
    );
  }

  // ── Assistant message ─────────────────────────────────────────
  const placeAbove = popover ? popover.top > 70 : true;

  const toolbarButton =
    'px-2.5 py-1 text-[12px] text-gray-100 hover:bg-gray-700/60 transition-colors flex items-center gap-1.5 whitespace-nowrap';

  return (
    // Phone: the text takes the whole row (avatar aside) and the actions wrap
    // onto their own line beneath it. Desktop: actions sit in a hover column.
    <div className="group flex flex-wrap md:flex-nowrap items-start gap-2 md:gap-3">
      <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-blue-400 mt-1 flex-shrink-0">
        <BrandIcon size={15} />
      </div>
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        onClick={handleAnchorClick}
        className="grow basis-[calc(100%-2.25rem)] md:basis-0 text-sm text-gray-100 leading-relaxed min-w-0 prose-tb"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={rehypePlugins}
          components={{
            // Open links in a new tab so a cited source never replaces the app.
            // Drop react-markdown's internal `node` prop so it isn't rendered as
            // a stray DOM attribute.
            a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />
          }}
        >
          {normalizeLatex(message.content)}
        </ReactMarkdown>
        {/* Show the model label only for a provider the user chose with their
            own key; hide it for the built-in default so users never see which
            backend powers "Auto" (works whatever that backend is). */}
        {message.model && message.provider && keyedProviders.has(message.provider) && (
          <div className="mt-1.5 text-[10px] text-gray-600">
            {message.provider} · {message.model}
          </div>
        )}
      </div>

      {/* Copy + Branch actions */}
      <div className="w-full pl-9 md:w-auto md:pl-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center gap-1 md:mt-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => handleCopy(message.content)}
          className="h-6 w-6 rounded flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-gray-700 transition-colors"
          title="Copy"
        >
          {copied ? <Check size={12} className="text-gray-200" /> : <Copy size={12} />}
        </button>
        <button
          type="button"
          onClick={() => onBranchFromMessage(message.id, '', 'ask')}
          className="text-[11px] text-gray-400 hover:text-gray-100 border border-gray-600 hover:border-gray-400 rounded-md px-2 py-0.5 transition-colors flex items-center gap-1"
          title="Branch the conversation from this reply"
        >
          <span>⎇</span>
          <span>Branch</span>
        </button>
      </div>

      {/* Several branches grew from this passage: pick one */}
      {anchorMenu && (
        <div
          ref={menuRef}
          className="fixed z-[100] w-64 rounded-lg shadow-2xl border border-gray-600/60 bg-gray-800 py-1"
          style={{
            left: Math.min(Math.max(anchorMenu.x - 128, 8), window.innerWidth - 264),
            ...(anchorMenu.bottom > window.innerHeight - 200
              ? { bottom: window.innerHeight - anchorMenu.top + 6 }
              : { top: anchorMenu.bottom + 6 })
          }}
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-500">Branches from here</div>
          {anchorMenu.branches.map((b) => (
            <button
              key={b.childId}
              type="button"
              onClick={() => {
                setAnchorMenu(null);
                onOpenBranch?.(b.childId);
              }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-gray-200 hover:bg-gray-700 truncate"
            >
              {b.label || 'Untitled branch'}
            </button>
          ))}
        </div>
      )}

      {/* Floating selection toolbar */}
      {popover && (
        <div
          className="fixed z-[100] flex rounded-lg shadow-2xl border border-gray-600/60 bg-gray-700 overflow-hidden"
          style={{
            top: placeAbove ? popover.top - 8 : popover.bottom + 8,
            left: popover.x,
            transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
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
          <div className="w-px bg-gray-600/50" />
          <button
            type="button"
            className={toolbarButton}
            onClick={() => actAndDismiss(() => onBranchFromMessage(message.id, popover.text, 'ask'))}
          >
            <span>?</span>
            <span>Ask</span>
          </button>
          <div className="w-px bg-gray-600/50" />
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
