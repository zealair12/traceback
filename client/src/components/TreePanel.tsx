import React, { useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  type Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface TreePanelProps {
  nodes: Node[];
  edges: Edge[];
  onSelectNode: (nodeId: string) => void;
}

/**
 * Right-hand column: React Flow canvas that visualizes the
 * conversation as a directed tree. The parent (`App.tsx`)
 * prepares React Flow nodes/edges and marks which node is active.
 */
export function TreePanel({ nodes, edges, onSelectNode }: TreePanelProps) {
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectNode(node.id);
    },
    [onSelectNode]
  );

  return (
    <aside className="w-80 h-full bg-tree border-l border-gray-800 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Conversation Tree</p>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          onNodeClick={handleNodeClick}
          className="bg-[#111111]"
        >
          <Background gap={16} size={0.5} color="#1f2933" />
          <MiniMap
            nodeColor={(n) => (n.data?.isActive ? '#10b981' : '#4b5563')}
            maskColor="#050505"
          />
          <Controls />
        </ReactFlow>
      </div>
    </aside>
  );
}

