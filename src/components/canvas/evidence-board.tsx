'use client';

// 证据墙画布 · ReactFlow 完整封装（Task 2-b → Task 13 双语）
// 软木板 + 图钉便签 + 红绳连线；契约见 docs/ARCHITECTURE.md §10.2 / §10.3

import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  applyNodeChanges,
  Controls,
  MiniMap,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  EDGE_RELATION_LABEL,
  NODE_KIND_LABEL,
  useI18n,
  useT,
} from '@/lib/i18n';
import type {
  BoardEdge,
  BoardNode,
  EdgeRelation,
  NodeKind,
} from '@/lib/types';

import { KIND_COLOR, nodeTypes, type BoardNodeData, type EvidenceFlowNode } from './board-nodes';
import { edgeTypes, STRING_STYLE, type EvidenceFlowEdge } from './string-edge';
import { layoutBoard } from './board-layout';

export type EvidenceBoardProps = {
  nodes: BoardNode[];
  edges: BoardEdge[];
  liveIds?: string[];
  onNodeClick?: (node: BoardNode) => void;
  onPositionsChange?: (positions: { id: string; x: number; y: number }[]) => void;
  className?: string;
};

/* ---------------- 图例（左上角，可折叠） ---------------- */

function BoardLegend() {
  // 窄屏默认折叠，避免遮住画布
  const [open, setOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 640
  );
  const t = useT();
  const lang = useI18n((s) => s.lang);

  return (
    <aside className="ev-legend" aria-label={t('canvas.legend')}>
      <button type="button" className="ev-legend__toggle" onClick={() => setOpen((v) => !v)}>
        <span className="ev-legend__pin" aria-hidden="true" />
        <span className="ev-legend__title">{t('canvas.legend')}</span>
        {open ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
      </button>

      {open && (
        <div className="ev-legend__body">
          <ul className="ev-legend__list">
            {(Object.keys(NODE_KIND_LABEL) as NodeKind[]).map((kind) => (
              <li key={kind}>
                <span className="ev-swatch" style={{ background: KIND_COLOR[kind] }} />
                {NODE_KIND_LABEL[kind][lang]}
              </li>
            ))}
          </ul>
          <div className="ev-legend__rule" aria-hidden="true" />
          <ul className="ev-legend__list">
            {(Object.keys(EDGE_RELATION_LABEL) as EdgeRelation[]).map((rel) => {
              const s = STRING_STYLE[rel];
              return (
                <li key={rel}>
                  <svg width="22" height="6" viewBox="0 0 22 6" aria-hidden="true">
                    <line
                      x1="1"
                      y1="3"
                      x2="21"
                      y2="3"
                      stroke={s.color}
                      strokeWidth={s.width}
                      strokeDasharray={s.dash ?? '0'}
                      strokeLinecap="round"
                    />
                  </svg>
                  {EDGE_RELATION_LABEL[rel][lang]}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}

/* 节点增长时平滑 refit：Agent 新钉卡片可能落在当前视口外，自动拉回全景 */
function AutoFitOnGrow({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  const prevCount = useRef(count);
  useEffect(() => {
    if (count > prevCount.current) {
      const t = setTimeout(() => {
        void fitView({ padding: 0.18, duration: 650, maxZoom: 1 });
      }, 400);
      prevCount.current = count;
      return () => clearTimeout(t);
    }
    prevCount.current = count;
  }, [count, fitView]);
  return null;
}

/* ---------------- 主组件 ---------------- */

export function EvidenceBoard({
  nodes,
  edges,
  liveIds,
  onNodeClick,
  onPositionsChange,
  className,
}: EvidenceBoardProps) {
  const t = useT();
  // position 为 null 的节点用 dagre 布局兜底
  const layout = useMemo(() => layoutBoard(nodes, edges), [nodes, edges]);
  const liveSet = useMemo(() => new Set(liveIds ?? []), [liveIds]);

  const rfNodes = useMemo<EvidenceFlowNode[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: n.position ?? layout[n.id] ?? { x: 0, y: 0 },
        data: { ...n, live: liveSet.has(n.id) },
      })),
    [nodes, layout, liveSet]
  );

  const rfEdges = useMemo<EvidenceFlowEdge[]>(() => {
    // 锚点分散：同一张卡上的多根绳沿边均匀散开，避免全部挤在卡片中点
    const count = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const e of edges) {
      count.set(e.source, (count.get(e.source) ?? 0) + 1);
      count.set(e.target, (count.get(e.target) ?? 0) + 1);
    }
    const spread = (i: number, total: number): number =>
      total <= 1 ? 0.5 : 0.28 + (0.44 * (i - 1)) / (total - 1);

    return edges.map((e) => {
      const s = (seen.get(e.source) ?? 0) + 1;
      seen.set(e.source, s);
      const t = (seen.get(e.target) ?? 0) + 1;
      seen.set(e.target, t);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'string',
        data: {
          relation: e.relation,
          label: e.label,
          ratio: [spread(s, count.get(e.source) ?? 1), spread(t, count.get(e.target) ?? 1)] as [
            number,
            number,
          ],
        },
      };
    });
  }, [edges]);

  // 受控节点 + 本地拖拽状态：拖动即时生效，结束后上报全部位置
  const [flowNodes, setFlowNodes] = useState<EvidenceFlowNode[]>(rfNodes);
  useEffect(() => {
    setFlowNodes(rfNodes);
  }, [rfNodes]);

  const handleNodesChange = useCallback((changes: NodeChange<EvidenceFlowNode>[]) => {
    setFlowNodes((nds) => applyNodeChanges(changes, nds));
  }, []);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: EvidenceFlowNode) => {
      const { live: _live, ...boardNode } = node.data;
      onNodeClick?.(boardNode);
    },
    [onNodeClick]
  );

  const handleNodeDragStop = useCallback(() => {
    onPositionsChange?.(
      flowNodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))
    );
  }, [flowNodes, onPositionsChange]);

  return (
    <div className={cn('corkboard-frame', className)}>
      <div className="corkboard">
        <ReactFlow<EvidenceFlowNode, EvidenceFlowEdge>
          nodes={flowNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onNodeClick={handleNodeClick}
          onNodeDragStop={handleNodeDragStop}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={1.75}
          proOptions={{ hideAttribution: true }}
        >
          <MiniMap
            className="ev-minimap"
            nodeColor={(n) =>
              KIND_COLOR[(n.data as BoardNodeData | undefined)?.kind ?? 'question']
            }
            nodeStrokeColor="rgba(90,62,28,.55)"
            maskColor="rgba(70,48,22,.24)"
            maskStrokeColor="rgba(70,48,22,.6)"
            nodeBorderRadius={2}
            pannable
            zoomable
          />
          <Controls className="ev-controls" showInteractive={false} position="bottom-left" />
          <AutoFitOnGrow count={nodes.length} />
        </ReactFlow>

        <BoardLegend />

        {/* 装饰：右下角落款橡皮章（非交互） */}
        <div className="ev-case-stamp" aria-hidden="true">
          <span className="ev-case-stamp__line1">SERENDIP LAB</span>
          <span className="ev-case-stamp__line2">{t('canvas.stamp')}</span>
        </div>
      </div>
    </div>
  );
}
