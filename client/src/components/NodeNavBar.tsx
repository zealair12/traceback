interface SiblingInfo {
  parentId: string | null;
  currentIndex: number;
  total: number;
}

interface NodeNavBarProps {
  siblingInfo: SiblingInfo | null;
  onNavigateToParent: () => void;
  onNavigateToSibling: (offset: number) => void;
}

/**
 * Navigation bar shown below the breadcrumbs in the chat panel.
 * Lets users traverse the tree without switching to the tree panel:
 * - Go up to the parent node
 * - Cycle through sibling branches (prev / next)
 */
export function NodeNavBar({
  siblingInfo,
  onNavigateToParent,
  onNavigateToSibling
}: NodeNavBarProps) {
  if (!siblingInfo) return null;

  const { parentId, currentIndex, total } = siblingInfo;
  const hasParent = parentId !== null;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < total - 1;
  const hasSiblings = total > 1;

  return (
    <div className="flex items-center gap-3 px-6 py-1.5 border-b border-gray-800/50 bg-gray-900/30 flex-shrink-0">
      {/* Parent button */}
      <button
        type="button"
        disabled={!hasParent}
        onClick={onNavigateToParent}
        className="text-[11px] text-gray-400 hover:text-white disabled:opacity-20 disabled:cursor-default transition-colors flex items-center gap-1"
      >
        <span>↑</span>
        <span>Parent</span>
      </button>

      {/* Divider */}
      <div className="w-px h-3 bg-gray-700" />

      {/* Sibling navigation */}
      {hasSiblings ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!hasPrev}
            onClick={() => onNavigateToSibling(-1)}
            className="text-[11px] text-gray-400 hover:text-white disabled:opacity-20 disabled:cursor-default transition-colors"
          >
            ←
          </button>
          <span className="text-[10px] text-gray-500 tabular-nums">
            {currentIndex + 1}/{total}
          </span>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => onNavigateToSibling(1)}
            className="text-[11px] text-gray-400 hover:text-white disabled:opacity-20 disabled:cursor-default transition-colors"
          >
            →
          </button>
          <span className="text-[10px] text-gray-600 ml-1">branches</span>
        </div>
      ) : (
        <span className="text-[10px] text-gray-600">no branches</span>
      )}
    </div>
  );
}
