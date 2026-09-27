'use client';

// 证据墙六种卡片节点 + nodeTypes 映射（Task 2-b）
// 视觉契约：docs/ARCHITECTURE.md §10.3 —— 纸质卡片 + 图钉 + 按 id 哈希微旋转 + live 钉上动画

import type { CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import {
  CircleHelp,
  FileQuestion,
  Lightbulb,
  Microscope,
  Newspaper,
  Sparkles,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BoardNode, NodeKind } from '@/lib/types';

/** 节点 data：把 BoardNode 整体塞进 React Flow 的 data，外加 live 标记 */
export type BoardNodeData = BoardNode & { live?: boolean };
export type EvidenceFlowNode = Node<BoardNodeData>;

/** id → 稳定微旋转（-3° ~ 3°），让每张卡像随手钉上去的 */
function tiltOf(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 61) / 10 - 3;
}

const KIND_ICON: Record<NodeKind, LucideIcon> = {
  question: CircleHelp,
  hypothesis: Lightbulb,
  evidence: Microscope,
  insight: Sparkles,
  source: Newspaper,
  gap: FileQuestion,
};

const PIN_CLASS: Record<NodeKind, string> = {
  question: 'ev-pin--red',
  hypothesis: 'ev-pin--copper',
  evidence: 'ev-pin--darkred',
  insight: 'ev-pin--brass',
  source: 'ev-pin--gray',
  gap: 'ev-pin--brass',
};

/** 六种卡片的主题色（MiniMap 与图例共用） */
export const KIND_COLOR: Record<NodeKind, string> = {
  question: '#f5d98a',
  hypothesis: '#bfe3d0',
  evidence: '#fdfaf1',
  insight: '#f6c9a0',
  source: '#eceae4',
  gap: '#fffdf6',
};

function CardBase({ id, data, selected }: NodeProps<EvidenceFlowNode>) {
  const kind: NodeKind = data.kind;
  const Icon = KIND_ICON[kind];
  const tilt = tiltOf(id);
  const live = data.live === true;
  const hasMeta = Boolean(data.sourceRef || data.confidence != null || data.starred);

  return (
    <motion.div
      className="ev-node"
      initial={live ? { scale: 0.6, rotate: -9, opacity: 0, y: -14 } : false}
      animate={{ scale: 1, rotate: 0, opacity: 1, y: 0 }}
      transition={
        live
          ? { type: 'spring', stiffness: 260, damping: 15, mass: 0.9 }
          : { duration: 0 }
      }
    >
      <article
        style={{ '--tilt': `${tilt.toFixed(2)}deg` } as CSSProperties}
        className={cn(
          'ev-card',
          `ev-card--${kind}`,
          selected && 'is-selected',
          live && 'is-live'
        )}
      >
        {/* 图钉：顶部中央，径向渐变圆点 + 微投影 */}
        <span className={cn('ev-pin', PIN_CLASS[kind])} aria-hidden="true" />

        {/* 把手：左右两个 6px 半透明棕圆点 */}
        <Handle type="target" position={Position.Left} className="ev-handle" />
        <Handle type="source" position={Position.Right} className="ev-handle" />

        {/* 底纹水印：右下角淡图标，戏剧感 */}
        <Icon className="ev-card__watermark" aria-hidden="true" />

        <div className="ev-card__inner">
          <header className="ev-card__head">
            <Icon className="ev-card__glyph" size={13} strokeWidth={2.2} aria-hidden="true" />
            <h4 className="ev-card__title">{data.title}</h4>
          </header>
          <p className="ev-card__body">{data.content}</p>
        </div>

        {hasMeta && (
          <footer className="ev-card__meta">
            {data.sourceRef ? <span className="ev-chip">{data.sourceRef}</span> : null}
            {data.confidence != null ? (
              <span className="ev-conf">置信 {data.confidence.toFixed(2)}</span>
            ) : null}
            {data.starred ? (
              <span className="ev-star" title="星标">
                <Star size={11} strokeWidth={0} fill="currentColor" aria-hidden="true" />
              </span>
            ) : null}
          </footer>
        )}

        {/* 待查角标（gap 专属） */}
        {kind === 'gap' && <span className="ev-gap-flag">待查</span>}
      </article>
    </motion.div>
  );
}

/* 六种节点组件（行为一致、外观由 .ev-card--{kind} 驱动），保持独立命名便于后续按 kind 定制 */
export function QuestionNode(props: NodeProps<EvidenceFlowNode>) {
  return <CardBase {...props} />;
}
export function HypothesisNode(props: NodeProps<EvidenceFlowNode>) {
  return <CardBase {...props} />;
}
export function EvidenceNode(props: NodeProps<EvidenceFlowNode>) {
  return <CardBase {...props} />;
}
export function InsightNode(props: NodeProps<EvidenceFlowNode>) {
  return <CardBase {...props} />;
}
export function SourceNode(props: NodeProps<EvidenceFlowNode>) {
  return <CardBase {...props} />;
}
export function GapNode(props: NodeProps<EvidenceFlowNode>) {
  return <CardBase {...props} />;
}

/** 模块级常量：避免每次渲染重建导致 React Flow 报错 */
export const nodeTypes = {
  question: QuestionNode,
  hypothesis: HypothesisNode,
  evidence: EvidenceNode,
  insight: InsightNode,
  source: SourceNode,
  gap: GapNode,
} as const;
