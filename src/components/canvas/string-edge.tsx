'use client';

// 红绳边（Task 2-b）
// supports=红实线(末端小圆环) / contradicts=碳黑虚线 / relates=麻绳细线
// derives=赭点线 / answers=绿实线；四层描边（投影→同色底衬→主绳→高光）营造绳子体积感，
// 贝塞尔 curvature 略松，绳子带一点垂坠感；label 是挂在绳中点下方的小纸条

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import type { EdgeRelation } from '@/lib/types';

export type StringEdgeData = { relation: EdgeRelation; label?: string | null };
export type EvidenceFlowEdge = Edge<StringEdgeData>;

/** 五种关系 → 绳子颜色 / 粗细 / 虚线节奏（图例与边共用同一份真源） */
export const STRING_STYLE: Record<
  EdgeRelation,
  { color: string; width: number; dash?: string; ring?: boolean }
> = {
  supports: { color: '#b91c1c', width: 2, ring: true },
  contradicts: { color: '#26221c', width: 2, dash: '7 4' },
  relates: { color: '#8a7a64', width: 1.5 },
  derives: { color: '#b45309', width: 1.5, dash: '2 5' },
  answers: { color: '#15803d', width: 2 },
};

/** 边标签小纸条的稳定微旋转 */
function tiltOf(id: string): number {
  let h = 11;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 81) / 10) - 4;
}

function StringEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<EvidenceFlowEdge>) {
  const style = STRING_STYLE[data?.relation ?? 'relates'];

  // curvature 略大于默认值：绳子别绷太直，带一点垂坠的松弛感
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.5,
  });

  const label = data?.label ?? null;

  return (
    <>
      {/* 第 1 层：绳子投在软木板上的软影（整体下移 1.5px） */}
      <path
        d={path}
        fill="none"
        stroke="rgba(52,32,10,.28)"
        strokeWidth={style.width + 1}
        strokeLinecap="round"
        transform="translate(0, 1.5)"
        pointerEvents="none"
      />
      {/* 第 2 层：同色 15% 透明度底衬，绳子的体积轮廓 */}
      <path
        d={path}
        fill="none"
        stroke={style.color}
        strokeOpacity={0.15}
        strokeWidth={style.width + 2.5}
        strokeLinecap="round"
        pointerEvents="none"
      />
      {/* 第 3 层：主绳 */}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={14}
        style={{
          stroke: style.color,
          strokeWidth: selected ? style.width + 0.75 : style.width,
          strokeDasharray: style.dash,
          strokeLinecap: 'round',
        }}
      />
      {/* 第 4 层：上缘细高光，受光的绳股 */}
      <path
        d={path}
        fill="none"
        stroke="rgba(255,242,214,.32)"
        strokeWidth={Math.max(0.6, style.width - 1.25)}
        strokeLinecap="round"
        transform="translate(0, -0.75)"
        pointerEvents="none"
      />

      {/* supports 两端的小圆环：像绳环挂在图钉上 */}
      {style.ring && (
        <>
          <circle cx={sourceX} cy={sourceY} r={3} fill="#f6efdd" stroke={style.color} strokeWidth={1.4} />
          <circle cx={targetX} cy={targetY} r={3} fill="#f6efdd" stroke={style.color} strokeWidth={1.4} />
        </>
      )}

      {label && (
        <EdgeLabelRenderer>
          <div
            className="ev-edge-tag nodrag nopan"
            style={{
              transform: `translate(-50%, 0) translate(${labelX}px, ${labelY + 7}px) rotate(${tiltOf(id)}deg)`,
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
