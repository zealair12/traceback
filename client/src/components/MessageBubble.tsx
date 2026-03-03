import { useState, useRef, useEffect } from 'react';
import type { Message } from '../types';
import { BranchPopup } from './BranchPopup';

interface MessageBubbleProps {
  message: Message;
  onBranchFromMessage: (messageId: string) => void;
}

/**
 * Single message in the chat feed.
 *
 * Responsibilities:
 * - Render user vs assistant styling.
 * - Detect text selections within this bubble and surface a
 *   "Branch from here" popup via the `BranchPopup` component.
 * - Notify the parent (`ChatPanel`) when the branch action is chosen.
 */
export function MessageBubble({ message, onBranchFromMessage }: MessageBubbleProps) {
  const [popupPosition, setPopupPosition] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickAnywhere = () => {
      setPopupPosition(null);
    };
    window.addEventListener('click', handleClickAnywhere);
    return () => window.removeEventListener('click', handleClickAnywhere);
  }, []);

  const handleMouseUp = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setPopupPosition(null);
      return;
    }

    // Ensure selection is inside this bubble only.
    const anchorNode = selection.anchorNode;
    if (!anchorNode || !containerRef.current) {
      setPopupPosition(null);
      return;
    }
    const isInside = containerRef.current.contains(anchorNode);
    if (!isInside) {
      setPopupPosition(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect) {
      setPopupPosition(null);
      return;
    }

    setPopupPosition({
      x: rect.left + rect.width / 2,
      y: rect.top
    });
  };

  const handleBranch = () => {
    setPopupPosition(null);
    onBranchFromMessage(message.id);
  };

  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          ref={containerRef}
          onMouseUp={handleMouseUp}
          className="max-w-xl rounded-3xl bg-bubbleUser px-4 py-3 text-sm text-white"
        >
          {message.content}
        </div>
        {popupPosition && <BranchPopup x={popupPosition.x} y={popupPosition.y} onBranch={handleBranch} />}
      </div>
    );
  }

  // Assistant / system messages: left-aligned text with a simple avatar.
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-[10px] text-gray-200 mt-1">
        TB
      </div>
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="flex-1 text-sm text-gray-100 leading-relaxed"
      >
        {message.content}
      </div>
      {popupPosition && <BranchPopup x={popupPosition.x} y={popupPosition.y} onBranch={handleBranch} />}
    </div>
  );
}

