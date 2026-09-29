'use client';

// node-inspector.tsx — 证据卡详情抽屉：详细说明 / 可点击引用 / 置信度 / 关系网络（Task 13 双语）
import { BookOpenText, ExternalLink, Star, Tag, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useStudio, selectInspectorNode, fmtTime } from '@/store/studio';
import { EDGE_RELATION_LABEL, NODE_KIND_LABEL, fmt, useI18n, useT } from '@/lib/i18n';
import type { EdgeRelation } from '@/lib/types';
import { resolveCitationUrl, citationLabel } from '@/lib/citation';

const REL_STYLE: Record<EdgeRelation, string> = {
  supports: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  contradicts: 'border-stone-500 bg-stone-200 text-stone-800 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-200',
  relates: 'border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300',
  derives: 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  answers: 'border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
};

export function NodeInspector() {
  const node = useStudio(selectInspectorNode);
  const edges = useStudio((s) => s.edges);
  const nodes = useStudio((s) => s.nodes);
  const openInspector = useStudio((s) => s.openInspector);
  const toggleStar = useStudio((s) => s.toggleStar);
  const t = useT();
  const lang = useI18n((s) => s.lang);

  if (!node) return <Sheet open={false} onOpenChange={(v) => !v && openInspector(null)}><SheetContent /></Sheet>;

  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;
  const outgoing = edges.filter((e) => e.source === node.id);
  const incoming = edges.filter((e) => e.target === node.id);
  const citationUrl = resolveCitationUrl(node.sourceRef, node.sourceUrl);

  return (
    <Sheet open onOpenChange={(v) => !v && openInspector(null)}>
      <SheetContent side="right" className="studio-scroll w-[min(92vw,400px)] overflow-y-auto border-stone-300 bg-[#f7f4ee] p-0 dark:border-stone-700 dark:bg-[#171411]">
        <SheetHeader className="space-y-2 border-b border-stone-300/70 px-4 py-3 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-amber-800/40 bg-amber-100 text-[11px] text-amber-900">
              {NODE_KIND_LABEL[node.kind][lang]}
            </Badge>
            <span className="text-[10.5px] text-stone-400">{fmt(t('ins.pinnedAt'), { time: fmtTime(node.createdAt) })}</span>
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto h-7 w-7"
              onClick={() => void toggleStar(node.id, !node.starred)}
              title={node.starred ? t('ins.unstar') : t('ins.star')}
            >
              <Star size={15} className={cn(node.starred ? 'fill-amber-500 text-amber-500' : 'text-stone-400')} />
            </Button>
          </div>
          <SheetTitle className="text-left font-display text-[15px] leading-snug text-stone-800 dark:text-stone-100">
            {node.title}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 py-4 text-[13px]">
          {/* 内容 */}
          <div className="rounded-xl border border-stone-300/70 bg-[#fdfaf1] p-3 leading-relaxed text-stone-700 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-200">
            {node.content || t('ins.noContent')}
          </div>

          {/* 深度解读（agent 生成的深度解读） */}
          {node.detail && node.detail.trim() && (
            <div className="rounded-xl border border-amber-700/25 bg-[#fbf5e4] p-3 dark:border-amber-600/25 dark:bg-amber-950/25">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-amber-800 dark:text-amber-300">
                <BookOpenText size={12} aria-hidden="true" />
                {t('ins.detail')}
              </div>
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-stone-700 dark:text-stone-200">
                {node.detail}
              </p>
            </div>
          )}

          {/* 引用（可点击打开原文） */}
          {(node.sourceRef || citationUrl) && (
            <div className="rounded-xl border border-emerald-700/20 bg-emerald-50/60 p-2.5 dark:border-emerald-700/30 dark:bg-emerald-950/20">
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-emerald-800 dark:text-emerald-400">
                {t('ins.citation')}
              </div>
              {citationUrl ? (
                <a
                  href={citationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/cite flex items-center gap-1.5 rounded-lg border border-emerald-700/30 bg-white/80 px-2.5 py-1.5 font-mono text-[11.5px] text-emerald-900 transition-colors hover:border-emerald-600 hover:bg-white dark:border-emerald-700/40 dark:bg-stone-900/60 dark:text-emerald-300 dark:hover:bg-stone-900"
                  title={fmt(t('ins.openSource'), { url: citationUrl })}
                >
                  <span className="truncate">{node.sourceRef ? citationLabel(node.sourceRef) : citationUrl}</span>
                  <ExternalLink size={11} className="shrink-0 opacity-60 transition-opacity group-hover/cite:opacity-100" aria-hidden="true" />
                </a>
              ) : (
                node.sourceRef && (
                  <div className="px-1 font-mono text-[11.5px] text-stone-600 dark:text-stone-300">
                    {node.sourceRef}
                  </div>
                )
              )}
            </div>
          )}

          {/* 元信息 */}
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-stone-500 dark:text-stone-400">
            {node.sourceUrl && citationUrl && (
            <a
              href={citationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-emerald-800 underline-offset-2 hover:underline dark:border-stone-600 dark:text-emerald-400"
            >
              {t('ins.sourceLink')} <ExternalLink size={10} />
            </a>
          )}
            {node.confidence != null && (
              <span className="flex items-center gap-1.5">
                {t('ins.confidence')}
                <span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                  <span
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full',
                      node.confidence >= 0.75 ? 'bg-emerald-600' : node.confidence >= 0.5 ? 'bg-amber-600' : 'bg-stone-400'
                    )}
                    style={{ width: `${Math.round(node.confidence * 100)}%` }}
                  />
                </span>
                <span className="tabular-nums">{node.confidence.toFixed(2)}</span>
              </span>
            )}
            {node.status && node.status !== 'new' && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px]',
                  node.status === 'strong' && 'border-emerald-400/60 text-emerald-700 dark:text-emerald-400',
                  node.status === 'weak' && 'border-amber-400/60 text-amber-700 dark:text-amber-400',
                  node.status === 'contradicted' && 'border-red-400/60 text-red-700 dark:text-red-400'
                )}
              >
                {node.status === 'strong' ? t('ins.statusStrong') : node.status === 'weak' ? t('ins.statusWeak') : t('ins.statusContradicted')}
              </Badge>
            )}
          </div>

          {/* 标签 */}
          {node.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag size={11} className="text-stone-400" />
              {node.tags.map((t) => (
                <Badge key={t} variant="secondary" className="rounded-full bg-stone-200/70 text-[10.5px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                  {t}
                </Badge>
              ))}
            </div>
          )}

          {/* 关系网 */}
          {(outgoing.length > 0 || incoming.length > 0) && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">{t('ins.relations')}</div>
              <div className="space-y-1.5">
                {outgoing.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => openInspector(e.target)}
                    className="flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-white/60 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500"
                  >
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', REL_STYLE[e.relation])}>
                      {EDGE_RELATION_LABEL[e.relation][lang]}
                    </span>
                    <span className="flex-1 truncate text-stone-700 dark:text-stone-200">{titleOf(e.target)}</span>
                  </button>
                ))}
                {incoming.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => openInspector(e.source)}
                    className="flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-white/60 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500"
                  >
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', REL_STYLE[e.relation])}>
                      {EDGE_RELATION_LABEL[e.relation][lang]}
                    </span>
                    <span className="flex-1 truncate text-stone-500 dark:text-stone-400">← {titleOf(e.source)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {node.pinnedBy === 'user' && (
            <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
              <X size={10} /> {t('ins.userNote')}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
