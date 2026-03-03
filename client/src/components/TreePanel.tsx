import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  useReactFlow,
  type Edge,
  type Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Dagre from '@dagrejs/dagre';
import { TreeNode } from './TreeNode';

const nodeTypes = { custom: TreeNode };

interface TreePanelProps {
  nodes: Node[];
  edges: Edge[];
  activeNodeId: string | null;
  activePathIds: Set<string>;
  onSelectNode: (nodeId: string) => void;
  onDeleteSubtree: (nodeId: string) => void;
  width: number;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

function layoutTree(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });
  nodes.forEach((n) => g.setNode(n.id, { width: 200, height: 50 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  Dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 100, y: pos.y - 25 } };
  });
}

function TreeFlowInner({
  nodes,
  edges,
  activeNodeId,
  onSelectNode,
  onDeleteSubtree
}: {
  nodes: Node[];
  edges: Edge[];
  activeNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onDeleteSubtree: (nodeId: string) => void;
}) {
  const reactFlow = useReactFlow();
  const prevActiveRef = useRef<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  useEffect(() => {
    if (!activeNodeId || activeNodeId === prevActiveRef.current) return;
    prevActiveRef.current = activeNodeId;
    const timer = setTimeout(() => {
      reactFlow.fitView({ nodes: [{ id: activeNodeId }], duration: 400, padding: 1.5 });
    }, 80);
    return () => clearTimeout(timer);
  }, [activeNodeId, reactFlow]);

  useEffect(() => {
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    return () => {
      window.removeEventListener('click', close);
    };
  }, []);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => onSelectNode(node.id),
    [onSelectNode]
  );

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    []
  );

  const handleDelete = useCallback(() => {
    if (!ctxMenu) return;
    onDeleteSubtree(ctxMenu.nodeId);
    setCtxMenu(null);
  }, [ctxMenu, onDeleteSubtree]);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        fitView
        fitViewOptions={{ padding: 0.4 }}
        nodesDraggable
        proOptions={{ hideAttribution: true }}
        style={{ background: '#080810' }}
        minZoom={0.05}
        maxZoom={3}
      >
        <Background gap={30} size={0.3} color="#141428" />
        <Controls
          showInteractive={false}
          position="bottom-center"
          orientation="horizontal"
          style={{
            background: '#0f0f1a',
            border: '1px solid #2a2a40',
            borderRadius: 10,
            padding: '2px 4px',
            display: 'flex',
            gap: 2
          }}
        />
      </ReactFlow>
      {ctxMenu && (
        <div
          className="fixed z-[100] min-w-[160px] py-1 rounded-lg shadow-2xl border border-gray-700/80 backdrop-blur-xl"
          style={{ top: ctxMenu.y, left: ctxMenu.x, background: 'rgba(17,17,27,0.96)' }}
        >
          <button
            type="button"
            onClick={handleDelete}
            className="w-full text-left px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-600/20 hover:text-red-300 flex items-center gap-2"
          >
            <span>✕</span>
            <span>Delete subtree</span>
          </button>
        </div>
      )}
    </>
  );
}

export function TreePanel({
  nodes,
  edges,
  activeNodeId,
  activePathIds,
  onSelectNode,
  onDeleteSubtree,
  width,
  isFullscreen,
  onToggleFullscreen
}: TreePanelProps) {
  const nodeIds = useMemo(() => nodes.map((n) => n.id).join(','), [nodes]);
  const edgeIds = useMemo(() => edges.map((e) => e.id).join(','), [edges]);

  const layoutNodes = useMemo(
    () => layoutTree(nodes, edges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeIds, edgeIds]
  );

  const styledNodes: Node[] = useMemo(
    () =>
      layoutNodes.map((n) => ({
        ...n,
        type: 'custom',
        data: {
          ...n.data,
          isActive: n.id === activeNodeId,
          isOnActivePath: activePathIds.has(n.id)
        }
      })),
    [layoutNodes, activeNodeId, activePathIds]
  );

  const styledEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const onPath = activePathIds.has(e.source) && activePathIds.has(e.target);
        return {
          ...e,
          type: 'smoothstep',
          animated: onPath,
          style: { stroke: onPath ? '#10b981' : '#1e293b', strokeWidth: onPath ? 2 : 1 }
        };
      }),
    [edges, activePathIds]
  );

  return (
    <aside
      className={`h-full bg-tree flex flex-col flex-shrink-0 ${isFullscreen ? '' : 'border-l border-gray-800'}`}
      style={{ width: isFullscreen ? '100%' : width }}
    >
      <div className="px-4 py-2.5 border-b border-gray-800 flex items-center justify-between flex-shrink-0">
        <p className="text-[10px] text-gray-500 uppercase tracking-widest">Conversation Tree</p>
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="text-[10px] text-gray-500 hover:text-white transition-colors px-2 py-0.5 rounded border border-gray-700 hover:border-gray-500"
        >
          {isFullscreen ? '← Back to chat' : '⛶ Expand'}
        </button>
      </div>
      <div className="flex-1 h-0">
        <ReactFlowProvider>
          <TreeFlowInner
            nodes={styledNodes}
            edges={styledEdges}
            activeNodeId={activeNodeId}
            onSelectNode={onSelectNode}
            onDeleteSubtree={onDeleteSubtree}
          />
        </ReactFlowProvider>
      </div>
    </aside>
  );
}
