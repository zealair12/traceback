import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Trash2 } from 'lucide-react';

export interface TreeNodeData {
  label: string;
  timestamp?: string;
  isActive: boolean;
  isOnActivePath: boolean;
  nodeBg?: string;
  nodeBorder?: string;
  nodeText?: string;
  nodePathBg?: string;
  nodePathBorder?: string;
  nodePathText?: string;
  // True for the placeholder demo tree shown in an empty session: rendered
  // muted and non-interactive so it reads as an illustration, not real data.
  isExample?: boolean;
  onDeleteRequest?: (x: number, y: number) => void;
}

function TreeNodeComponent({ data, id: _id }: NodeProps) {
  const {
    label, timestamp, isActive, isOnActivePath,
    nodeBg = '#1a1a1a', nodeBorder = '#2a2a2a', nodeText = '#525252',
    nodePathBg = '#262626', nodePathBorder = '#3a3a3a', nodePathText = '#a3a3a3',
    isExample, onDeleteRequest,
  } = data as unknown as TreeNodeData;

  const activeStyle = {
    background: '#064e3b',
    border: '1.5px solid #10b981',
    color: '#ecfdf5',
  };
  const pathStyle = {
    background: nodePathBg,
    border: `1px solid ${nodePathBorder}`,
    color: nodePathText,
  };
  const defaultStyle = {
    background: nodeBg,
    border: `1px solid ${nodeBorder}`,
    color: nodeText,
  };

  const baseStyle = isActive ? activeStyle : isOnActivePath ? pathStyle : defaultStyle;
  // The example tree is drawn dashed + slightly faded so it reads as a hint.
  const nodeStyle = isExample ? { ...baseStyle, borderStyle: 'dashed' as const, opacity: 0.85 } : baseStyle;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div
        className={`
          group relative px-3 py-2 rounded-lg text-[11px] leading-snug
          max-w-[200px] transition-all duration-200 select-none
          ${isExample ? 'cursor-default' : 'cursor-pointer'}
          ${isActive
            ? 'ring-2 ring-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.25)] scale-[1.04]'
            : 'hover:opacity-90'
          }
        `}
        style={nodeStyle}
      >
        <div className="line-clamp-2 pr-3">{label}</div>
        {timestamp && (
          <div className="text-[8px] mt-0.5 opacity-40">{timestamp}</div>
        )}
        {onDeleteRequest && (
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteRequest(e.clientX, e.clientY);
            }}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-red-400 p-0.5 rounded hover:bg-red-400/10"
            title="Delete branch"
          >
            <Trash2 size={9} />
          </button>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
    </>
  );
}

export const TreeNode = memo(TreeNodeComponent);
