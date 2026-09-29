'use client';

// 证据墙画布 · ReactFlow 完整封装（Task 2-b → Task 13 双语）
// 软木板 + 图钉便签 + 红绳连线；契约见 docs/ARCHITECTURE.md §10.2 / §10.3

import '@xyflow/react/dist/style.css';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  Controls,
  MiniMap,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import { toast } from 'sonner';
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
import { nodeMatchesSearch } from './node-search';

export type EvidenceBoardProps = {
  nodes: BoardNode[];
  edges: BoardEdge[];
  liveIds?: string[];
  onNodeClick?: (node: BoardNode) => void;
  onPositionsChange?: (positions: { id: string; x: number; y: number }[]) => void;
  /** 递增触发一次「一键整理」：全部卡片按语义分列重新排布（带动画） */
  organizeSignal?: number;
  /** 卡片搜索词（Task 17）：非空时未命中卡压暗去饱和、命中卡加琥珀光晕；命中判定与工具条计数共用 */
  search?: string;
  /** 隐藏的卡片类型集合（空/未传 = 全部显示）；连线随端点自动隐藏 */
  hiddenKinds?: ReadonlySet<NodeKind>;
  className?: string;
};

/** 搜索命中判定真源在 ./node-search（工具条计数与画布高亮共用）；此处 re-export 保持旧引用兼容 */
export { nodeMatchesSearch } from './node-search';

/* ---------------- 图例（左上角，可折叠） ---------------- */

/* 视口宽度探针（水合安全）：SSR / 水合首帧固定返回 true，与服务端渲染一致；
 * 挂载后由 matchMedia 客户端快照接管真实宽度。
 * 不能用 useState(() => window.innerWidth >= 640) 这类惰性初始化——窄视口下
 * 客户端首帧树与服务端 HTML 分叉，会导致整棵树的 radix useId 水合错位
 * （React 19.2 的 _R_ 树路径 id 全体漂移）。 */
function useViewportAtLeast(px: number): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(`(min-width: ${px}px)`);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [px]
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(`(min-width: ${px}px)`).matches,
    () => true
  );
}

function BoardLegend() {
  // 窄屏默认折叠，避免遮住画布；userOpen=null 表示用户未干预，跟随视口默认值
  const wide = useViewportAtLeast(640);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? wide;
  const t = useT();
  const lang = useI18n((s) => s.lang);

  return (
    <aside className="ev-legend" aria-label={t('canvas.legend')}>
      <button type="button" className="ev-legend__toggle" onClick={() => setUserOpen(!open)}>
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

// 外层：ReactFlowProvider 必须包住所有 useReactFlow() 消费者
// （一键整理在 ReactFlow 外层调用 fitView，没有 Provider 会抛 error#001 导致整页崩溃）
export function EvidenceBoard(props: EvidenceBoardProps) {
  const t = useT();
  return (
    <div className={cn('corkboard-frame', props.className)}>
      <ReactFlowProvider>
        <div className="corkboard">
          <EvidenceBoardInner {...props} />

          <BoardLegend />

          {/* 装饰：右下角落款橡皮章（非交互） */}
          <div className="ev-case-stamp" aria-hidden="true">
            <span className="ev-case-stamp__line1">SERENDIP LAB</span>
            <span className="ev-case-stamp__line2">{t('canvas.stamp')}</span>
          </div>
        </div>
      </ReactFlowProvider>
    </div>
  );
}

function EvidenceBoardInner({
  nodes,
  edges,
  liveIds,
  onNodeClick,
  onPositionsChange,
  organizeSignal,
  search,
  hiddenKinds,
}: EvidenceBoardProps) {
  const t = useT();
  // position 为 null 的节点用 dagre 布局兜底
  const layout = useMemo(() => layoutBoard(nodes, edges), [nodes, edges]);
  const liveSet = useMemo(() => new Set(liveIds ?? []), [liveIds]);

  // 搜索（Task 17）：命中卡 is-hit 高亮，未命中 is-dimmed 压暗（不隐藏，保留空间布局）
  const q = (search ?? '').trim();
  const matchOf = useCallback((n: BoardNode) => nodeMatchesSearch(n, q), [q]);

  // 类型筛选：被隐藏类型的卡片 hidden；连线端点任一隐藏则连线隐藏
  const hiddenIdSet = useMemo(() => {
    const s = new Set<string>();
    if (hiddenKinds && hiddenKinds.size > 0) {
      for (const n of nodes) if (hiddenKinds.has(n.kind)) s.add(n.id);
    }
    return s;
  }, [nodes, hiddenKinds]);

  const rfNodes = useMemo<EvidenceFlowNode[]>(
    () =>
      nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: n.position ?? layout[n.id] ?? { x: 0, y: 0 },
        hidden: hiddenIdSet.has(n.id),
        data: {
          ...n,
          live: liveSet.has(n.id),
          dimmed: q ? !matchOf(n) : false,
          hit: q ? matchOf(n) : false,
        },
      })),
    [nodes, layout, liveSet, hiddenIdSet, q, matchOf]
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

    // 搜索时：两端都命中的绳保持醒目，其余绳退为幽灵绳
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const hitOf = (id: string): boolean => {
      if (!q) return true;
      const n = nodeById.get(id);
      return n ? matchOf(n) : false;
    };

    return edges.map((e) => {
      const s = (seen.get(e.source) ?? 0) + 1;
      seen.set(e.source, s);
      const t = (seen.get(e.target) ?? 0) + 1;
      seen.set(e.target, t);
      const bothHit = hitOf(e.source) && hitOf(e.target);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'string',
        hidden: hiddenIdSet.has(e.source) || hiddenIdSet.has(e.target),
        data: {
          relation: e.relation,
          label: e.label,
          dimmed: !bothHit,
          ratio: [spread(s, count.get(e.source) ?? 1), spread(t, count.get(e.target) ?? 1)] as [
            number,
            number,
          ],
        },
      };
    });
  }, [edges, nodes, hiddenIdSet, q, matchOf]);

  // 受控节点 + 本地拖拽状态：拖动即时生效，结束后上报全部位置
  const [flowNodes, setFlowNodes] = useState<EvidenceFlowNode[]>(rfNodes);

  /* ---------------- 一键整理：dagre 语义分列 + rAF 平滑动画 ---------------- */
  const rafRef = useRef(0);
  // 动画进行中：跳过 props 快照重置，避免 SSE 全量 state 把卡片拉回旧坐标来回跳动
  const organizingRef = useRef(false);
  // 拖拽中：被拖卡片保留本地坐标，其余照吃快照（防 Agent 运行时快照覆盖拖拽位置）
  const dragIdRef = useRef<string | null>(null);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setFlowNodes((prev) => {
      if (organizingRef.current) return prev;
      const dragId = dragIdRef.current;
      if (dragId) {
        const dragged = prev.find((n) => n.id === dragId);
        if (dragged) {
          return rfNodes.map((n) => (n.id === dragId ? { ...n, position: dragged.position } : n));
        }
      }
      return rfNodes;
    });
  }, [rfNodes]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
    },
    []
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<EvidenceFlowNode>[]) => {
      // 记录拖拽中的卡片（position change 携带 dragging 标记）
      const pos = changes.find((c): c is NodeChange<EvidenceFlowNode> & { type: 'position'; dragging?: boolean } => c.type === 'position');
      if (pos) dragIdRef.current = pos.dragging ? pos.id : null;
      // 用户拖拽时立即终止进行中的整理动画，避免两者互相覆盖
      if (rafRef.current > 0 && pos) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        organizingRef.current = false;
      }
      setFlowNodes((nds) => applyNodeChanges(changes, nds));
    },
    []
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: EvidenceFlowNode) => {
      const { live: _live, ...boardNode } = node.data;
      onNodeClick?.(boardNode);
    },
    [onNodeClick]
  );

  const handleNodeDragStop = useCallback(() => {
    dragIdRef.current = null;
    onPositionsChange?.(
      flowNodes.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))
    );
  }, [flowNodes, onPositionsChange]);

  const { fitView } = useReactFlow();

  const runOrganize = useCallback(() => {
    if (nodes.length === 0) return;
    // 打断上一场动画，从当前位置接着整
    cancelAnimationFrame(rafRef.current);
    organizingRef.current = true;
    const target = layoutBoard(nodes, edges);
    const snapshot = new Map(flowNodes.map((n) => [n.id, n.position]));

    const DURATION = 620;
    const t0 = performance.now();
    const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

    const step = (ts: number) => {
      const p = Math.min(1, (ts - t0) / DURATION);
      const e = easeOutCubic(p);
      setFlowNodes((prev) =>
        prev.map((n) => {
          const to = target[n.id];
          const from = snapshot.get(n.id) ?? n.position;
          if (!to) return n;
          return {
            ...n,
            position: { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e },
          };
        })
      );
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }
      // 完成：烘焙最终位置（乐观更新 + 落库）并拉回全景
      rafRef.current = 0;
      organizingRef.current = false;
      onPositionsChange?.(
        nodes.map((n) => {
          const to = target[n.id] ?? n.position ?? { x: 0, y: 0 };
          return { id: n.id, x: to.x, y: to.y };
        })
      );
      fitTimerRef.current = setTimeout(() => void fitView({ padding: 0.18, duration: 650, maxZoom: 1 }), 80);
      toast.success(t('canvas.organized'));
    };
    rafRef.current = requestAnimationFrame(step);
  }, [nodes, edges, flowNodes, onPositionsChange, fitView, t]);

  // 触发器走 ref，避免 organizeSignal 每次递增都重建回调依赖
  const runOrganizeRef = useRef(runOrganize);
  useEffect(() => {
    runOrganizeRef.current = runOrganize;
  });
  useEffect(() => {
    if (organizeSignal != null && organizeSignal > 0) runOrganizeRef.current();
  }, [organizeSignal]);

  return (
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
  );
}
