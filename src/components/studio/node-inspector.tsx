'use client';

// node-inspector.tsx — 证据卡片详情抽屉：内容 / 来源 / 置信度 / 关系网
import { ExternalLink, Star, Tag, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useStudio, selectInspectorNode, fmtTime } from '@/store/studio';
import { EDGE_RELATION_LABEL, NODE_KIND_LABEL, type EdgeRelation } from '@/lib/types';

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

  if (!node) return <Sheet open={false} onOpenChange={(v) => !v && openInspector(null)}><SheetContent /></Sheet>;

  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title ?? id;
  const outgoing = edges.filter((e) => e.source === node.id);
  const incoming = edges.filter((e) => e.target === node.id);

  return (
    <Sheet open onOpenChange={(v) => !v && openInspector(null)}>
      <SheetContent side="right" className="studio-scroll w-[min(92vw,400px)] overflow-y-auto border-stone-300 bg-[#f7f4ee] p-0 dark:border-stone-700 dark:bg-[#171411]">
        <SheetHeader className="space-y-2 border-b border-stone-300/70 px-4 py-3 dark:border-stone-800">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-amber-800/40 bg-amber-100 text-[11px] text-amber-900">
              {NODE_KIND_LABEL[node.kind]}
            </Badge>
            <span className="text-[10.5px] text-stone-400">钉上于 {fmtTime(node.createdAt)}</span>
            <Button
              size="icon"
              variant="ghost"
              className="ml-auto h-7 w-7"
              onClick={() => void toggleStar(node.id, !node.starred)}
              title={node.starred ? '取消星标' : '星标这条线索'}
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
            {node.content || '（无详细内容）'}
          </div>

          {/* 元信息 */}
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-stone-500 dark:text-stone-400">
            {node.sourceRef && (
              <Badge variant="outline" className="border-stone-300 font-mono text-[10.5px] dark:border-stone-600">
                {node.sourceRef}
              </Badge>
            )}
            {node.sourceUrl && (
              <a
                href={node.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-emerald-800 underline-offset-2 hover:underline dark:border-stone-600 dark:text-emerald-400"
              >
                原文链接 <ExternalLink size={10} />
              </a>
            )}
            {node.confidence != null && (
              <span className="flex items-center gap-1.5">
                置信度
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
                {node.status === 'strong' ? '证据扎实' : node.status === 'weak' ? '证据偏弱' : '存在矛盾'}
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
              <div className="text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">线索关系网</div>
              <div className="space-y-1.5">
                {outgoing.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => openInspector(e.target)}
                    className="flex w-full items-center gap-2 rounded-lg border border-stone-200 bg-white/60 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500"
                  >
                    <span className={cn('rounded border px-1.5 py-0.5 text-[10px]', REL_STYLE[e.relation])}>
                      {EDGE_RELATION_LABEL[e.relation]}
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
                      {EDGE_RELATION_LABEL[e.relation]}
                    </span>
                    <span className="flex-1 truncate text-stone-500 dark:text-stone-400">← {titleOf(e.source)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {node.pinnedBy === 'user' && (
            <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
              <X size={10} /> 该线索由你手动钉上，Agent 会将其纳入调查上下文
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
