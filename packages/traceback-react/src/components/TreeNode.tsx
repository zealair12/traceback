import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

export interface TreeNodeData {
  label: string;
  timestamp?: string;
  isActive: boolean;
  isOnActivePath: boolean;
  // Theme-derived colors passed in from TreePanel via node data.
  nodeBg?: string;
  nodeBorder?: string;
  nodeText?: string;
  nodePathBg?: string;
  nodePathBorder?: string;
  nodePathText?: string;
}

function TreeNodeComponent({ data }: NodeProps) {
  const {
    label, timestamp, isActive, isOnActivePath,
    nodeBg = '#1a1a1a', nodeBorder = '#2a2a2a', nodeText = '#525252',
    nodePathBg = '#262626', nodePathBorder = '#3a3a3a', nodePathText = '#a3a3a3',
  } = data as unknown as TreeNodeData;

  // Active node keeps the green glow — it marks the current position in the flow.
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

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div
        className={`
          relative px-3 py-2 rounded-lg text-[11px] leading-snug
          max-w-[200px] cursor-pointer transition-all duration-200 select-none
          ${isActive
            ? 'ring-2 ring-emerald-400 shadow-[0_0_14px_rgba(16,185,129,0.25)] scale-[1.04]'
            : 'hover:opacity-90'
          }
        `}
        style={isActive ? activeStyle : isOnActivePath ? pathStyle : defaultStyle}
      >
        <div className="line-clamp-2">{label}</div>
        {timestamp && (
          <div className="text-[8px] mt-0.5 opacity-40">{timestamp}</div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
    </>
  );
}

export const TreeNode = memo(TreeNodeComponent);
