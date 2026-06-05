import { useEffect, useRef, type MouseEvent } from 'react';

export interface ContextMenuAction {
  label: string;
  icon: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  actions: ContextMenuAction[];
  selectedText: string;
  onClose: () => void;
}

/**
 * Custom right-click context menu that appears when text is highlighted
 * in an AI response. Shows available actions for the selected text.
 */
export function ContextMenu({ x, y, actions, selectedText, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as HTMLElement)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Keep menu within viewport bounds
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menuRef.current.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menuRef.current.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }, [x, y]);

  const truncated = selectedText.length > 60
    ? selectedText.slice(0, 60) + '…'
    : selectedText;

  const handleAction = (e: MouseEvent, action: ContextMenuAction) => {
    e.preventDefault();
    e.stopPropagation();
    if (!action.disabled) {
      action.onClick();
      onClose();
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[200px] max-w-[280px] py-1.5 rounded-lg shadow-2xl border border-gray-700/80 backdrop-blur-xl"
      style={{
        top: y,
        left: x,
        background: 'rgba(17, 17, 27, 0.96)'
      }}
    >
      <div className="px-3 py-1.5 border-b border-gray-800/60 mb-1">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Selected</p>
        <p className="text-[11px] text-gray-300 truncate">"{truncated}"</p>
      </div>

      {actions.map((action, i) => (
        <button
          key={i}
          type="button"
          onClick={(e) => handleAction(e, action)}
          disabled={action.disabled}
          className={`
            w-full text-left px-3 py-1.5 flex items-center gap-2.5 text-[12px] transition-colors
            ${action.disabled
              ? 'text-gray-600 cursor-not-allowed'
              : 'text-gray-200 hover:bg-emerald-600/20 hover:text-white'
            }
          `}
        >
          <span className="text-[14px] w-5 text-center flex-shrink-0">{action.icon}</span>
          <span className="flex-1">{action.label}</span>
          {action.shortcut && (
            <span className="text-[10px] text-gray-600 ml-auto">{action.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
}
