import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ChatMessage } from '../App';
import { ContextMenu, type ContextMenuAction } from './ContextMenu';
import { normalizeLatex } from '../utils/text';

interface MessageBubbleProps {
  message: ChatMessage;
  onBranchFromMessage: (messageId: string, selectedText: string, action: 'dig' | 'ask') => void;
}

/**
 * Renders a single chat message with markdown formatting.
 * Assistant messages support right-click context menu for branching.
 */
export function MessageBubble({ message, onBranchFromMessage }: MessageBubbleProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<string>('');

  // Track current selection within this bubble
  useEffect(() => {
    const trackSelection = () => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && containerRef.current?.contains(sel.anchorNode)) {
        selectionRef.current = sel.toString().trim();
      } else {
        selectionRef.current = '';
      }
    };
    document.addEventListener('selectionchange', trackSelection);
    return () => document.removeEventListener('selectionchange', trackSelection);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (message.role !== 'assistant') return;

    const text = selectionRef.current || window.getSelection()?.toString().trim() || '';
    if (!text) return;

    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, text });
  }, [message.role]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const getActions = (): ContextMenuAction[] => {
    if (!contextMenu) return [];
    const text = contextMenu.text;
    return [
      {
        label: 'Dig deeper',
        icon: '↳',
        onClick: () => onBranchFromMessage(message.id, text, 'dig')
      },
      {
        label: 'Ask about this…',
        icon: '?',
        onClick: () => onBranchFromMessage(message.id, text, 'ask')
      },
      {
        label: 'Copy',
        icon: '⎘',
        shortcut: '⌘C',
        onClick: () => navigator.clipboard.writeText(text)
      }
    ];
  };

  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-xl rounded-3xl bg-bubbleUser px-4 py-3 text-sm text-white whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-[10px] text-gray-200 mt-1 flex-shrink-0">
        TB
      </div>
      <div
        ref={containerRef}
        onContextMenu={handleContextMenu}
        className="flex-1 text-sm text-gray-100 leading-relaxed min-w-0 prose-tb"
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {normalizeLatex(message.content)}
        </ReactMarkdown>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          actions={getActions()}
          selectedText={contextMenu.text}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
