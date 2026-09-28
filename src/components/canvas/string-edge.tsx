'use client';

// 红绳边 · v2 —— 浮动锚点 + 垂坠绳 + 邻接聚焦
//
// v1 的问题：所有绳子都从卡片「右侧把手」出发、连到对方「左侧把手」，
// 视觉上左进右出、千线一面，且绕行交叉严重。
// v2 的解法：
// 1) 浮动锚点：不再依赖固定把手，而是把每张卡视为软木板上的一个矩形，
//    绳端吸附到「朝向对方最近的那条边」上——同列卡片走竖绳、跨列走横绳，
//    路径长度和交叉都大幅下降；
// 2) 锚点分散：同一张卡上钉的多根绳，沿卡片边缘按序均匀散开，
//    不会挤在同一个点形成"绳结"；
// 3) 绳索物理：水平绳带二次贝塞尔垂坠（绳子自重），竖直绳带轻微 S 型
//    摆动（像没绷直的松绳），保持证据墙的松弛手感；
// 4) 邻接聚焦：选中任一张卡片时，与它无关的绳淡化为"幽灵绳"，
//    邻接绳保持醒目——信息墙一眼读出"这张卡连着谁"。

import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  useStore,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { EdgeRelation } from '@/lib/types';

export type StringEdgeData = {
  relation: EdgeRelation;
  label?: string | null;
  /** 两端锚点在卡片边上的分散比例 [source, target]，由布局层预算 */
  ratio?: [number, number];
};
export type EvidenceFlowEdge = Edge<StringEdgeData>;

/** 五种关系 → 绳子颜色 / 粗细 / 虚线节奏（图例与边共用同一份真源）
 *  v2.1：最小线宽提高到 2.2（用户反馈部分线太细看不清），
 *  关系区分主要靠颜色与虚线节奏而非粗细；配合 non-scaling-stroke
 *  （屏幕恒定线宽）保证任何缩放下绳子都清晰可辨。 */
export const STRING_STYLE: Record<
  EdgeRelation,
  { color: string; width: number; dash?: string; ring?: boolean }
> = {
  // 颜色走 CSS 变量：暗色模式下暗色绳（碳黑/麻灰）在深胡桃木板上对比度不足，
  // 由 globals.css 的 .dark 覆盖为亮色变体（VLM 视觉审查发现）
  supports: { color: 'var(--string-supports)', width: 2.6, ring: true },
  contradicts: { color: 'var(--string-contradicts)', width: 2.4, dash: '7 4' },
  relates: { color: 'var(--string-relates)', width: 2.2 },
  derives: { color: 'var(--string-derives)', width: 2.2, dash: '2 5' },
  answers: { color: 'var(--string-answers)', width: 2.6 },
};

/** 边标签小纸条的稳定微旋转 */
function tiltOf(id: string): number {
  let h = 11;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 81) / 10) - 4;
}

/* ---------------- 节点包围盒 ---------------- */

type Box = { x: number; y: number; w: number; h: number };

/** 从 React Flow 内部节点解析包围盒；measured 未就绪时用把手包围盒兜底 */
function nodeBox(internal: ReturnType<typeof useInternalNode>): Box | null {
  const node = internal?.node;
  if (!node) return null;
  const pos = node.internals.positionAbsolute;
  let w = node.measured?.width;
  let h = node.measured?.height;
  if ((!w || !h) && node.internals.handleBounds) {
    const hb = node.internals.handleBounds;
    const all = [...(hb.source ?? []), ...(hb.target ?? [])];
    if (all.length) {
      w = Math.max(...all.map((b) => b.x + b.width)) + 10;
      h = Math.max(...all.map((b) => b.y + b.height)) + 10;
    }
  }
  if (!w || !h) return null;
  return { x: pos.x, y: pos.y, w, h };
}

/* ---------------- 浮动锚点：就近面吸附 ---------------- */

type Pt = { x: number; y: number };

/**
 * 从 from 卡片上找一个「朝向 to 最近」的锚点。
 * t ∈ (0,1)：锚点沿所选边的位置（用于多绳分散）。
 */
function sideAnchor(from: Box, to: Box, t: number): Pt {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const dx = to.x + to.w / 2 - cx;
  const dy = to.y + to.h / 2 - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // 水平主导 → 从左/右边缘出绳
    return { x: dx >= 0 ? from.x + from.w : from.x, y: from.y + from.h * t };
  }
  // 垂直主导 → 从上/下边缘出绳（同列卡片之间的竖绳）
  return { x: from.x + from.w * t, y: dy >= 0 ? from.y + from.h : from.y };
}

/* ---------------- 绳索路径：垂坠 + 摆动 ---------------- */

function ropePath(a: Pt, b: Pt): { d: string; mx: number; my: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = Math.hypot(dx, dy);

  if (Math.abs(dx) < 3) {
    // 竖直绳：轻微 S 型摆动，像没绷直的松绳
    const sway = Math.min(7, span * 0.05);
    const d = `M ${a.x} ${a.y} C ${a.x + sway} ${a.y + dy * 0.34}, ${a.x - sway} ${a.y + dy * 0.66}, ${b.x} ${b.y}`;
    return { d, mx: a.x, my: a.y + dy / 2 };
  }
  if (Math.abs(dy) < 3) {
    // 纯水平绳：直连 + 极轻垂坠中点
    const d = `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${a.y + 3} ${b.x} ${b.y}`;
    return { d, mx: (a.x + b.x) / 2, my: a.y + 2 };
  }
  // 一般斜向绳：中点垂坠（绳自重），垂坠量随跨度增长、上限 40px
  const sag = Math.min(40, span * 0.12);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 + sag;
  const d = `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`;
  return { d, mx, my };
}

/* ---------------- 边组件 ---------------- */

function StringEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps<EvidenceFlowEdge>) {
  const style = STRING_STYLE[data?.relation ?? 'relates'];

  // 两端节点的实时包围盒（含拖拽中的位置）
  const srcNode = useInternalNode(source);
  const tgtNode = useInternalNode(target);

  // 邻接聚焦：任一卡片被选中时，无关绳淡化为幽灵绳
  const selectedKey = useStore((s) => {
    const sel = s.nodes.filter((n) => n.selected).map((n) => n.id);
    return sel.length ? sel.join('|') : '';
  });
  const focused =
    selectedKey === '' ||
    selectedKey.split('|').some((nid) => nid === source || nid === target);

  // 浮动锚点（包围盒就绪前退回 React Flow 提供的把手坐标）
  const srcBox = nodeBox(srcNode);
  const tgtBox = nodeBox(tgtNode);
  const ratio = data?.ratio ?? [0.5, 0.5];
  const a: Pt = srcBox && tgtBox ? sideAnchor(srcBox, tgtBox, ratio[0]) : { x: sourceX, y: sourceY };
  const b: Pt = srcBox && tgtBox ? sideAnchor(tgtBox, srcBox, ratio[1]) : { x: targetX, y: targetY };

  const { d: path, mx, my } = ropePath(a, b);
  const label = data?.label ?? null;

  // 幽灵绳：整体近乎隐没；正常绳：完全可见；选中绳：加粗
  const opacity = focused ? 1 : 0.1;
  const width = selected ? style.width + 0.75 : style.width;

  return (
    <>
      {/* 第 1 层：绳子投在软木板上的软影（整体下移 1.5px） */}
      <path
        d={path}
        fill="none"
        stroke="rgba(52,32,10,.28)"
        strokeWidth={width + 1}
        strokeLinecap="round"
        transform="translate(0, 1.5)"
        opacity={opacity}
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />
      {/* 第 2 层：同色 15% 透明度底衬，绳子的体积轮廓 */}
      <path
        d={path}
        fill="none"
        stroke={style.color}
        strokeOpacity={0.15 * opacity}
        strokeWidth={width + 2.5}
        strokeLinecap="round"
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />
      {/* 第 3 层：主绳 */}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        style={{
          stroke: style.color,
          strokeWidth: width,
          strokeDasharray: style.dash,
          strokeLinecap: 'round',
          opacity,
          vectorEffect: 'non-scaling-stroke',
        } as CSSProperties}
      />
      {/* 第 4 层：上缘细高光，受光的绳股 */}
      <path
        d={path}
        fill="none"
        stroke="rgba(255,242,214,.32)"
        strokeWidth={Math.max(1, width - 1.25)}
        strokeLinecap="round"
        transform="translate(0, -0.75)"
        opacity={opacity}
        pointerEvents="none"
        vectorEffect="non-scaling-stroke"
      />

      {/* supports 两端的小圆环：像绳环挂在图钉上（吸附在真实绳端） */}
      {style.ring && focused && (
        <>
          <circle cx={a.x} cy={a.y} r={3} fill="#f6efdd" stroke={style.color} strokeWidth={1.4} />
          <circle cx={b.x} cy={b.y} r={3} fill="#f6efdd" stroke={style.color} strokeWidth={1.4} />
        </>
      )}

      {label && focused && (
        <EdgeLabelRenderer>
          <div
            className="ev-edge-tag nodrag nopan"
            style={{
              transform: `translate(-50%, 0) translate(${mx}px, ${my + 7}px) rotate(${tiltOf(id)}deg)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** 模块级常量：避免每次渲染重建导致 React Flow 报错 */
export const edgeTypes = {
  string: StringEdge,
} as const;
