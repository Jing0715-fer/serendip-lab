// 证据墙自动布局（Task 2-b）
// 思路：用 dagre（LR）跑一遍拓扑布局拿到「同层内的先后顺序」，
// 再按 kind 语义 rank 固定分列（question 最左 → source 最右），
// 列内垂直堆叠并整体绕 0 居中，保证任意数据下都不重叠、层次清晰。

import dagre from '@dagrejs/dagre';
import type { BoardEdge, BoardNode, NodeKind } from '@/lib/types';

export type NodePosition = { x: number; y: number };

/** 语义分层：question=0, hypothesis=1, gap=1.5, insight=2, evidence=2, source=3, topic=4（最右课题栏：引擎最终产出） */
const RANK_BY_KIND: Record<NodeKind, number> = {
  question: 0,
  hypothesis: 1,
  gap: 1.5,
  insight: 2,
  evidence: 2,
  source: 3,
  topic: 4,
};

// 节点包围盒估算：卡片宽 244px（Task 13 详情增强）+ 出入把手余量；高度取卡片典型渲染高度（含解读节选）
// topic 课题卡更宽（300px 金箔卡）→ 按类型取宽，避免课题栏重叠
const NODE_W_BY_KIND: Record<NodeKind, number> = {
  question: 284,
  hypothesis: 284,
  gap: 284,
  insight: 284,
  evidence: 284,
  source: 284,
  topic: 356,
};
const NODE_W = 284;
const NODE_H = 232;
const NODESEP = 36;
const RANKSEP = 140;

export function layoutBoard(
  nodes: BoardNode[],
  edges: BoardEdge[]
): Record<string, NodePosition> {
  const positions: Record<string, NodePosition> = {};
  if (nodes.length === 0) return positions;

  // 1) dagre 布局：取其拓扑顺序（同 rank 内的 y 次序）作为列内排序依据
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: NODESEP, ranksep: RANKSEP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W_BY_KIND[n.kind] ?? NODE_W, height: NODE_H });
  for (const e of edges) {
    if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) {
      g.setEdge(e.source, e.target);
    }
  }
  dagre.layout(g);

  // 2) 按 kind 分列，列内按 dagre 的 y 序堆叠，整列绕 0 垂直居中（列宽随最宽卡片自适应）
  const pitch = NODE_H + NODESEP;
  const byRank = new Map<number, BoardNode[]>();
  for (const n of nodes) {
    const rank = RANK_BY_KIND[n.kind] ?? 2;
    const bucket = byRank.get(rank);
    if (bucket) bucket.push(n);
    else byRank.set(rank, [n]);
  }

  let cursorX = 0;
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const group = byRank.get(rank)!;
    const colW = Math.max(...group.map((n) => NODE_W_BY_KIND[n.kind] ?? NODE_W));
    const ordered = [...group].sort((a, b) => {
      const ya = (g.node(a.id) as { y?: number } | undefined)?.y ?? 0;
      const yb = (g.node(b.id) as { y?: number } | undefined)?.y ?? 0;
      return ya - yb;
    });
    const x = cursorX;
    const stackHeight = ordered.length * NODE_H + Math.max(0, ordered.length - 1) * NODESEP;
    const startY = -stackHeight / 2;
    ordered.forEach((n, i) => {
      // 课题卡更宽：以列左缘对齐，卡身居中微偏移让它视觉上更挺拔
      positions[n.id] = { x, y: startY + i * pitch };
    });
    cursorX = x + colW + RANKSEP;
  }

  return positions;
}
