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
import { Maximize2, Minimize2, X } from 'lucide-react';
import { TreeNode } from './TreeNode';

const nodeTypes = { custom: TreeNode };

type Theme = 'dark' | 'blue' | 'light';

const themeTokens: Record<Theme, {
  canvasBg: string; dots: string; edgeDefault: string; edgeActive: string;
  controlBg: string; controlBorder: string; confirmBg: string;
  nodeBg: string; nodeBorder: string; nodeText: string;
  nodePathBg: string; nodePathBorder: string; nodePathText: string;
  nodeActiveBg: string; nodeActiveBorder: string; nodeActiveText: string;
}> = {
  dark: {
    canvasBg: '#0d0d0d', dots: '#1a1a1a', edgeDefault: '#2a2a2a', edgeActive: '#fafafa',
    controlBg: '#111111', controlBorder: '#2a2a2a', confirmBg: 'rgba(17,17,17,0.96)',
    nodeBg: '#1a1a1a', nodeBorder: '#2a2a2a', nodeText: '#525252',
    nodePathBg: '#262626', nodePathBorder: '#3a3a3a', nodePathText: '#a3a3a3',
    // The active "flow" reads white in dark mode rather than a stray green.
    nodeActiveBg: '#2a2a2a', nodeActiveBorder: '#fafafa', nodeActiveText: '#fafafa',
  },
  blue: {
    canvasBg: '#040a18', dots: '#0a1228', edgeDefault: '#1a2a4a', edgeActive: '#3b82f6',
    controlBg: '#060c1a', controlBorder: '#1a2a4a', confirmBg: 'rgba(6,12,26,0.96)',
    nodeBg: '#0d1a30', nodeBorder: '#1a2a4a', nodeText: '#3d6499',
    nodePathBg: '#152440', nodePathBorder: '#2a4870', nodePathText: '#5b87c5',
    nodeActiveBg: '#10243f', nodeActiveBorder: '#3b82f6', nodeActiveText: '#dbeafe',
  },
  light: {
    canvasBg: '#f0f2f5', dots: '#dde0e8', edgeDefault: '#d4d4d4', edgeActive: '#3b82f6',
    controlBg: '#e8ecf0', controlBorder: '#d1d5db', confirmBg: 'rgba(240,242,245,0.96)',
    nodeBg: '#e5e5e5', nodeBorder: '#d4d4d4', nodeText: '#a3a3a3',
    nodePathBg: '#d4d4d4', nodePathBorder: '#a3a3a3', nodePathText: '#525252',
    nodeActiveBg: '#dbeafe', nodeActiveBorder: '#2563eb', nodeActiveText: '#1e3a8a',
  },
};

// The color of the lines connecting nodes in the graph, per theme. Reused by
// the panel dividers so they match the graph instead of a stray accent color.
export function treeConnectorColor(theme: Theme): string {
  return themeTokens[theme].edgeDefault;
}

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
  // Close the panel entirely (used by the mobile full-screen overlay).
  onClose: () => void;
  theme: Theme;
}

function layoutTree(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80 });
  nodes.forEach((n) => g.setNode(n.id, { width: 200, height: 50 }));
  [...edges].reverse().forEach((e) => g.setEdge(e.source, e.target));
  Dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 100, y: pos.y - 25 } };
  });
}

function TreeFlowInner({
  layoutNodes,
  edges,
  activeNodeId,
  activePathIds,
  onSelectNode,
  onDeleteSubtree,
  tokens
}: {
  layoutNodes: Node[];
  edges: Edge[];
  activeNodeId: string | null;
  activePathIds: Set<string>;
  onSelectNode: (nodeId: string) => void;
  onDeleteSubtree: (nodeId: string) => void;
  tokens: typeof themeTokens['dark'];
}) {
  const reactFlow = useReactFlow();
  const prevActiveRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);

  // Confirmation popup: position + which node is pending
  const [confirm, setConfirm] = useState<{ x: number; y: number; nodeId: string } | null>(null);

  useEffect(() => {
    if (!activeNodeId || activeNodeId === prevActiveRef.current) return;
    const isFirst = prevActiveRef.current === null;
    // A new branch (the node count grew) re-frames the WHOLE graph, so the fork
    // is always brought into frame in the context of the full tree. Plain
    // navigation between existing nodes zooms to the node you moved to.
    const grew = layoutNodes.length > prevCountRef.current;
    prevActiveRef.current = activeNodeId;
    prevCountRef.current = layoutNodes.length;
    const timer = setTimeout(() => {
      if (isFirst || grew) {
        reactFlow.fitView({ duration: 500, padding: 0.35 });
      } else {
        reactFlow.fitView({ nodes: [{ id: activeNodeId }], duration: 400, padding: 1.5 });
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [activeNodeId, layoutNodes, reactFlow]);

  useEffect(() => {
    const close = () => setConfirm(null);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }, []);

  // Stable callback passed into each node's data so it can open the confirm popup.
  const handleDeleteRequest = useCallback((x: number, y: number, nodeId: string) => {
    setConfirm({ x, y, nodeId });
  }, []);

  const styledNodes: Node[] = useMemo(
    () =>
      layoutNodes.map((n) => ({
        ...n,
        type: 'custom',
        data: {
          ...n.data,
          isActive: n.id === activeNodeId,
          isOnActivePath: activePathIds.has(n.id),
          onDeleteRequest: (x: number, y: number) => handleDeleteRequest(x, y, n.id),
          nodeBg: tokens.nodeBg,
          nodeBorder: tokens.nodeBorder,
          nodeText: tokens.nodeText,
          nodePathBg: tokens.nodePathBg,
          nodePathBorder: tokens.nodePathBorder,
          nodePathText: tokens.nodePathText,
          nodeActiveBg: tokens.nodeActiveBg,
          nodeActiveBorder: tokens.nodeActiveBorder,
          nodeActiveText: tokens.nodeActiveText,
        }
      })),
    [layoutNodes, activeNodeId, activePathIds, tokens, handleDeleteRequest]
  );

  const styledEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => {
        const onPath = activePathIds.has(e.source) && activePathIds.has(e.target);
        return {
          ...e,
          type: 'smoothstep',
          animated: onPath,
          style: { stroke: onPath ? tokens.edgeActive : tokens.edgeDefault, strokeWidth: onPath ? 2 : 1 }
        };
      }),
    [edges, activePathIds, tokens]
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => onSelectNode(node.id),
    [onSelectNode]
  );

  // Right-click on a node opens the same confirm popup at cursor position.
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      setConfirm({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    []
  );

  const handleConfirmDelete = useCallback(() => {
    if (!confirm) return;
    onDeleteSubtree(confirm.nodeId);
    setConfirm(null);
  }, [confirm, onDeleteSubtree]);

  return (
    <>
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        fitView
        fitViewOptions={{ padding: 0.4 }}
        nodesDraggable
        proOptions={{ hideAttribution: true }}
        style={{ background: tokens.canvasBg }}
        minZoom={0.05}
        maxZoom={3}
      >
        <Background gap={30} size={0.3} color={tokens.dots} />
        <Controls
          showInteractive={false}
          position="bottom-center"
          orientation="horizontal"
          style={{
            background: tokens.controlBg,
            border: `1px solid ${tokens.controlBorder}`,
            borderRadius: 10,
            padding: '2px 4px',
            display: 'flex',
            gap: 2
          }}
        />
      </ReactFlow>

      {confirm && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setConfirm(null)} />
          <div
            className="fixed z-[100] min-w-[152px] rounded-xl shadow-2xl border border-gray-700/60 backdrop-blur-xl py-2.5 px-3"
            style={{ top: confirm.y, left: confirm.x, background: tokens.confirmBg }}
          >
            <p className="text-[11px] text-gray-400 mb-2">Delete this branch?</p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-1 rounded-md text-[11px] font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="flex-1 py-1 rounded-md text-[11px] text-gray-400 bg-gray-800/40 hover:bg-gray-700/60 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
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
  onToggleFullscreen,
  onClose,
  theme
}: TreePanelProps) {
  const tokens = themeTokens[theme];

  const nodeIds = useMemo(() => nodes.map((n) => n.id).join(','), [nodes]);
  const edgeIds = useMemo(() => edges.map((e) => e.id).join(','), [edges]);

  const layoutNodes = useMemo(
    () => layoutTree(nodes, edges),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeIds, edgeIds]
  );

  return (
    <aside
      className={`h-full bg-tree flex flex-col flex-shrink-0 ${isFullscreen ? '' : 'border-l border-gray-800'}`}
      style={{ width: isFullscreen ? '100%' : width }}
    >
      <div className="flex-1 h-0 relative">
        {/* Close the tree — always available so the mobile full-screen overlay
            is never a trap (the dim backdrop sits behind it and can't be tapped). */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2.5 left-2.5 z-10 h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-100 bg-gray-900/60 hover:bg-gray-800/80 backdrop-blur-md border border-gray-800/80 transition-colors md:hidden"
          title="Close the tree"
          aria-label="Close the tree"
        >
          <X size={16} />
        </button>
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="absolute top-2.5 right-2.5 z-10 h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-100 bg-gray-900/60 hover:bg-gray-800/80 backdrop-blur-md border border-gray-800/80 transition-colors"
          title={isFullscreen ? 'Back to chat' : 'Expand the tree'}
          aria-label={isFullscreen ? 'Back to chat' : 'Expand the tree'}
        >
          {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
        <ReactFlowProvider>
          <TreeFlowInner
            layoutNodes={layoutNodes}
            edges={edges}
            activeNodeId={activeNodeId}
            activePathIds={activePathIds}
            onSelectNode={onSelectNode}
            onDeleteSubtree={onDeleteSubtree}
            tokens={tokens}
          />
        </ReactFlowProvider>
      </div>
    </aside>
  );
}
