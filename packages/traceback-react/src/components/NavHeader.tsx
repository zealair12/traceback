// The single navigation line above the chat: up to the parent, the breadcrumb
// path so far, and -- only when the current point has sibling branches -- a
// compact pager through them.

import { ChevronLeft, ChevronRight, CornerLeftUp } from 'lucide-react';
import type { ChatMessage } from '../types';
import type { SiblingInfo } from '../lib/conversationTree';
import { stripMarkdown } from '../utils/text';

interface NavHeaderProps {
  threadPath: ChatMessage[];
  siblingInfo: SiblingInfo | null;
  onNavigateToParent: () => void;
  onNavigateToSibling: (offset: number) => void;
  onNavigateToNode: (nodeId: string) => void;
}

const iconButton =
  'h-7 w-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-100 hover:bg-gray-800 transition-colors disabled:opacity-20 disabled:cursor-default flex-shrink-0';

export function NavHeader({
  threadPath,
  siblingInfo,
  onNavigateToParent,
  onNavigateToSibling,
  onNavigateToNode
}: NavHeaderProps) {
  return (
    <header className="px-3 py-1.5 border-b border-gray-800 flex-shrink-0 flex items-center gap-2">
      <button
        type="button"
        disabled={!siblingInfo?.parentId}
        onClick={onNavigateToParent}
        className={iconButton}
        title="Go to the parent message"
        aria-label="Go to the parent message"
      >
        <CornerLeftUp size={14} />
      </button>

      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="flex items-center gap-1 text-[11px] min-w-0">
          {threadPath.length === 0 ? (
            <span className="text-gray-600">No messages yet</span>
          ) : (
            threadPath.map((msg, i) => {
              const isLast = i === threadPath.length - 1;
              const clean = stripMarkdown(msg.content);
              const label = clean.length > 20 ? clean.slice(0, 20) + '…' : clean;
              return (
                <span key={msg.id} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <span className="text-gray-700 flex-shrink-0">›</span>}
                  <button
                    type="button"
                    onClick={() => onNavigateToNode(msg.id)}
                    className={`truncate max-w-[140px] transition-colors ${
                      isLast ? 'text-gray-200 font-medium' : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                </span>
              );
            })
          )}
        </div>
      </div>

      {siblingInfo && siblingInfo.total > 1 && (
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            disabled={siblingInfo.currentIndex <= 0}
            onClick={() => onNavigateToSibling(-1)}
            className={iconButton}
            title="Previous branch"
            aria-label="Previous branch"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="text-[11px] text-gray-500 tabular-nums px-0.5">
            {siblingInfo.currentIndex + 1}/{siblingInfo.total}
          </span>
          <button
            type="button"
            disabled={siblingInfo.currentIndex >= siblingInfo.total - 1}
            onClick={() => onNavigateToSibling(1)}
            className={iconButton}
            title="Next branch"
            aria-label="Next branch"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </header>
  );
}
