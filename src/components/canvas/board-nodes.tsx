'use client';

// 证据墙七种卡片节点 + nodeTypes 映射（Task 2-b → Task 13 卡片详情增强 + 双语 → Task 14 深研课题卡）
// 视觉契约：docs/ARCHITECTURE.md §10.3 —— 纸质卡片 + 图钉 + 按 id 哈希微旋转 + live 钉上动画
// Task 13：卡面承载更多内容——类型小签 / 标题 3 行 / 正文 4 行 / 深度解读节选 /
// 标签 chips / 置信度迷你条 / 来源 chip，仍保持拍立得质感。
// Task 14：topic「深研课题卡」——综合分析师提炼的科学问题，金箔质感 + 光晕 + 评分 chips +
// 推荐徽标，钉在证据墙最右侧课题栏，是整个引擎的最终产出，视觉权重最高。

import type { CSSProperties } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import {
  CircleHelp,
  FileQuestion,
  FlaskConical,
  Lightbulb,
  Microscope,
  Newspaper,
  Sparkles,
  Star,
  Telescope,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmt, NODE_KIND_LABEL, useI18n, useT } from '@/lib/i18n';
import { useStudio } from '@/store/studio';
import type { BoardNode, NodeKind } from '@/lib/types';

/** 节点 data：把 BoardNode 整体塞进 React Flow 的 data，外加 live/dimmed/hit 标记
 *  dimmed/hit（Task 17）：搜索时未命中卡压暗、命中卡高亮 */
export type BoardNodeData = BoardNode & { live?: boolean; dimmed?: boolean; hit?: boolean };
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
  topic: Telescope,
};

const PIN_CLASS: Record<NodeKind, string> = {
  question: 'ev-pin--red',
  hypothesis: 'ev-pin--copper',
  evidence: 'ev-pin--darkred',
  insight: 'ev-pin--brass',
  source: 'ev-pin--gray',
  gap: 'ev-pin--brass',
  topic: 'ev-pin--gold',
};

/** 七种卡片的主题色（MiniMap 与图例共用）；topic 用重琥珀，在软木板上最醒目 */
export const KIND_COLOR: Record<NodeKind, string> = {
  question: '#f5d98a',
  hypothesis: '#bfe3d0',
  evidence: '#fdfaf1',
  insight: '#f6c9a0',
  source: '#eceae4',
  gap: '#fffdf6',
  topic: '#d97706',
};

function CardBase({ id, data, selected }: NodeProps<EvidenceFlowNode>) {
  const kind: NodeKind = data.kind;
  const lang = useI18n((s) => s.lang);
  const t = NODE_KIND_LABEL[kind][lang];
  const Icon = KIND_ICON[kind];
  const tilt = tiltOf(id);
  const live = data.live === true;

  const tags = (data.tags ?? []).filter(Boolean).slice(0, 3);
  const detail = data.detail?.trim() ?? '';
  const confTone =
    (data.confidence ?? 0) >= 0.75 ? 'ev-conf-bar--hi' : (data.confidence ?? 0) >= 0.5 ? 'ev-conf-bar--md' : 'ev-conf-bar--lo';
  const contradicted = data.status === 'contradicted';

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
          live && 'is-live',
          data.dimmed && 'is-dimmed',
          data.hit && 'is-hit'
        )}
      >
        {/* 图钉：顶部中央，径向渐变圆点 + 微投影 */}
        <span className={cn('ev-pin', PIN_CLASS[kind])} aria-hidden="true" />

        {/* 把手：左右两个 6px 半透明棕圆点 */}
        <Handle type="target" position={Position.Left} className="ev-handle" />
        <Handle type="source" position={Position.Right} className="ev-handle" />

        {/* 底纹水印：右下角淡图标 */}
        <Icon className="ev-card__watermark" aria-hidden="true" />

        <div className="ev-card__inner">
          <header className="ev-card__head">
            <Icon className="ev-card__glyph" size={13} strokeWidth={2.2} aria-hidden="true" />
            <h4 className="ev-card__title">{data.title}</h4>
            <span className="ev-kind-chip">{t}</span>
          </header>
          <p className="ev-card__body">{data.content}</p>

          {/* 深度解读节选：点击卡片可在检视器中读全文 */}
          {detail && (
            <p className="ev-card__detail">
              <span className="ev-card__detail-mark" aria-hidden="true">❝</span>
              {detail}
            </p>
          )}

          {/* 标签 */}
          {tags.length > 0 && (
            <div className="ev-card__tags">
              {tags.map((tag) => (
                <span key={tag} className="ev-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <footer className="ev-card__meta">
          {data.sourceRef ? <span className="ev-chip">{data.sourceRef}</span> : null}
          {data.confidence != null && (
            <span className={cn('ev-conf', contradicted && 'ev-conf--warn')}>
              <span className={cn('ev-conf-bar', confTone)} aria-hidden="true">
                <span className="ev-conf-bar__fill" style={{ width: `${Math.round(data.confidence * 100)}%` }} />
              </span>
              <span className="ev-conf__num">{data.confidence.toFixed(2)}</span>
            </span>
          )}
          {contradicted && <span className="ev-warn-flag" title={data.status}>⚠</span>}
          {data.starred ? (
            <span className="ev-star" title="★">
              <Star size={11} strokeWidth={0} fill="currentColor" aria-hidden="true" />
            </span>
          ) : null}
        </footer>

        {/* 待查角标（gap 专属） */}
        {kind === 'gap' && <span className="ev-gap-flag">{NODE_KIND_LABEL.gap[lang]}</span>}
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

/* 深研课题卡（Task 14）：引擎的最终产出，视觉权重最高。
 * 金箔质感 + 琥珀光晕 + 望远镜图钉 + 评分 chips（tags 承载）+ 推荐徽标（starred），
 * 卡面更宽更醒目；tags 由后端写入（新颖/可行/影响评分）。 */
export function TopicNode({ id, data, selected }: NodeProps<EvidenceFlowNode>) {
  const lang = useI18n((s) => s.lang);
  const t = useT();
  const exploration = useStudio((s) => s.explorations[id] ?? null);
  const exploreBusy = useStudio((s) => s.exploreBusy[id] ?? null);
  const openExplore = useStudio((s) => s.openExplore);
  const kindLabel = NODE_KIND_LABEL.topic[lang];
  const Icon = KIND_ICON.topic;
  const tilt = tiltOf(id);
  const live = data.live === true;
  const tags = (data.tags ?? []).filter(Boolean).slice(0, 3);
  const detail = data.detail?.trim() ?? '';
  const recommended = data.starred === true;

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
          'ev-card--topic',
          selected && 'is-selected',
          live && 'is-live',
          data.dimmed && 'is-dimmed',
          data.hit && 'is-hit'
        )}
      >
        {/* 金色大图钉 */}
        <span className={cn('ev-pin', PIN_CLASS.topic)} aria-hidden="true" />

        <Handle type="target" position={Position.Left} className="ev-handle" />
        <Handle type="source" position={Position.Right} className="ev-handle" />

        {/* 底纹水印：望远镜 */}
        <Icon className="ev-card__watermark" aria-hidden="true" />

        <div className="ev-card__inner">
          <header className="ev-card__head">
            <Icon className="ev-card__glyph" size={13} strokeWidth={2.2} aria-hidden="true" />
            <h4 className="ev-card__title ev-topic-title">{data.title}</h4>
            <span className="ev-kind-chip ev-kind-chip--topic">{kindLabel}</span>
          </header>
          <p className="ev-card__body ev-topic-body">{data.content}</p>

          {detail && (
            <p className="ev-card__detail">
              <span className="ev-card__detail-mark" aria-hidden="true">❝</span>
              {detail}
            </p>
          )}

          {/* 评分 chips（后端写入 tags：新颖 n / 可行 n / 影响 n） */}
          {tags.length > 0 && (
            <div className="ev-card__tags ev-topic-tags">
              {tags.map((tag) => (
                <span key={tag} className="ev-tag ev-tag--topic">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 推荐深挖徽标（starred 由后端在 recommended=true 时置位） */}
        {recommended && (
          <span className="ev-topic-ribbon" title={t('topic.recommended')}>
            <Star size={10} strokeWidth={0} fill="currentColor" aria-hidden="true" />
            {t('topic.recommended')}
          </span>
        )}

        {/* 探索方案入口（Task 16）：生成具体方案 → 反馈结果 → 继续推导闭环 */}
        <div className="ev-topic-explore">
          <button
            type="button"
            title={t('topic.exploreOpen')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openExplore(id);
            }}
            className="ev-topic-explore-btn"
          >
            {exploreBusy ? (
              <span className="ev-explore-spin" aria-hidden="true">⏳</span>
            ) : (
              <FlaskConical size={10} strokeWidth={2.4} aria-hidden="true" />
            )}
            {exploration && exploration.rounds.length > 0
              ? fmt(t('topic.exploreRounds'), { n: exploration.rounds.length })
              : t('topic.explore')}
          </button>
        </div>
      </article>
    </motion.div>
  );
}

/** 模块级常量：避免每次渲染重建导致 React Flow 报错 */
export const nodeTypes = {
  question: QuestionNode,
  hypothesis: HypothesisNode,
  evidence: EvidenceNode,
  insight: InsightNode,
  source: SourceNode,
  gap: GapNode,
  topic: TopicNode,
} as const;
