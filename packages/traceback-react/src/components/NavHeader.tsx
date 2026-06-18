import { ChevronLeft, ChevronRight, PanelLeft, Ghost, GitBranch } from 'lucide-react';
import type { ChatMessage } from '../types';
import type { SiblingInfo } from '../lib/conversationTree';
import { stripMarkdown } from '../utils/text';

interface NavHeaderProps {
  threadPath: ChatMessage[];
  siblingInfo: SiblingInfo | null;
  onNavigateToParent: () => void;
  onNavigateToSibling: (offset: number) => void;
  onNavigateToNode: (nodeId: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  treePanelVisible: boolean;
  onToggleTreePanel: () => void;
  incognito: boolean;
  onToggleIncognito: () => void;
}

const iconButton =
  'h-7 w-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-100 hover:bg-gray-800 transition-colors disabled:opacity-20 disabled:cursor-default flex-shrink-0';

export function NavHeader({
  threadPath,
  siblingInfo,
  onNavigateToSibling,
  onNavigateToNode,
  sidebarOpen,
  onToggleSidebar,
  treePanelVisible,
  onToggleTreePanel,
  incognito,
  onToggleIncognito
}: NavHeaderProps) {
  // Show only user messages as breadcrumb items (Q-A pairs).
  // Clicking a pair navigates to the assistant's reply so both Q and A are visible.
  const pairs = threadPath.reduce<{ id: string; content: string; navigateToId: string }[]>(
    (acc, msg, i) => {
      if (msg.role === 'user') {
        const answer = threadPath[i + 1];
        acc.push({
          id: msg.id,
          content: msg.content,
          navigateToId: answer ? answer.id : msg.id
        });
      }
      return acc;
    },
    []
  );

  return (
    <header className="px-3 py-1.5 flex-shrink-0 flex items-center gap-2">
      <button
        type="button"
        onClick={onToggleSidebar}
        className={iconButton}
        title={sidebarOpen ? 'Close sidebar  ⌘B' : 'Open sidebar  ⌘B'}
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        <PanelLeft size={15} />
      </button>

      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="flex items-center gap-1 text-[11px] min-w-0">
          {pairs.length === 0 ? (
            <span className="text-gray-600">No messages yet</span>
          ) : (
            pairs.map((pair, i) => {
              const isLast = i === pairs.length - 1;
              const clean = stripMarkdown(pair.content);
              const label = clean.length > 24 ? clean.slice(0, 24) + '…' : clean;
              return (
                <span key={pair.id} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <span className="text-gray-700 flex-shrink-0">›</span>}
                  <button
                    type="button"
                    onClick={() => onNavigateToNode(pair.navigateToId)}
                    className={`truncate max-w-[150px] transition-colors ${
                      isLast
                        ? 'text-gray-200 font-medium'
                        : 'text-gray-500 hover:text-gray-300'
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

      <div className="flex items-center gap-1 ml-auto flex-shrink-0">
        <button
          type="button"
          onClick={onToggleTreePanel}
          className={`${iconButton} ${treePanelVisible ? 'text-gray-200 bg-gray-800' : ''}`}
          title={treePanelVisible ? 'Hide tree' : 'Show tree'}
          aria-label="Toggle tree panel"
        >
          <GitBranch size={15} />
        </button>
        <button
          type="button"
          onClick={onToggleIncognito}
          className={`${iconButton} ${incognito ? 'text-blue-400 bg-blue-400/10' : ''}`}
          title={incognito ? 'Incognito on — session deleted on exit' : 'Incognito mode'}
          aria-label="Toggle incognito mode"
        >
          <Ghost size={15} />
        </button>
      </div>
    </header>
  );
}
