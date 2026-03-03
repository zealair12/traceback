import type { MouseEvent } from 'react';

interface BranchPopupProps {
  x: number;
  y: number;
  onBranch: () => void;
}

/**
 * Small floating popup shown when the user selects text inside
 * a message bubble. The parent (`MessageBubble`) is responsible
 * for positioning and deciding when to show this component.
 */
export function BranchPopup({ x, y, onBranch }: BranchPopupProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onBranch();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="fixed z-30 -translate-x-1/2 -translate-y-full bg-gray-800 text-white text-xs rounded-lg px-3 py-1 shadow-lg border border-gray-700 flex items-center gap-1"
      style={{ top: y, left: x }}
    >
      <span className="text-[10px]">⎇</span>
      <span>Branch from here</span>
    </button>
  );
}

