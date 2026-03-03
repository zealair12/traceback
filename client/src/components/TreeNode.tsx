import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface TreeNodeData {
  label: string;
  isActive: boolean;
  childCount: number;
  isOnActivePath: boolean;
}

/**
 * Minimal tree node: just the truncated message text.
 * Active node gets a green glow. Branch points show a small count badge.
 * Clicking a node switches the chat panel to that node's lineage.
 */
function TreeNodeComponent({ data }: NodeProps) {
  const { label, isActive, childCount, isOnActivePath } = data as unknown as TreeNodeData;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />

      <div
        className={`
          relative px-3 py-2 rounded-lg text-[11px] leading-snug
          max-w-[200px] cursor-pointer transition-all duration-200 select-none
          ${isActive
            ? 'ring-2 ring-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.25)] scale-[1.04]'
            : isOnActivePath
              ? 'ring-1 ring-emerald-900/60'
              : 'hover:ring-1 hover:ring-gray-600'
          }
        `}
        style={{
          background: isActive ? '#064e3b' : isOnActivePath ? '#0c1a2e' : '#111827',
          border: isActive
            ? '1.5px solid #10b981'
            : isOnActivePath
              ? '1px solid #1e3a5f'
              : '1px solid #1e293b',
          color: isActive ? '#ecfdf5' : isOnActivePath ? '#94a3b8' : '#64748b'
        }}
      >
        <div className="line-clamp-2">{label}</div>

        {childCount > 1 && (
          <div className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-indigo-500 text-white text-[8px] flex items-center justify-center font-bold px-1">
            {childCount}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
    </>
  );
}

export const TreeNode = memo(TreeNodeComponent);
