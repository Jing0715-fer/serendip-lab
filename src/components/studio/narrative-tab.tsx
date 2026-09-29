'use client';

// narrative-tab.tsx — 研究综述（markdown）+ 研究计划进度 + 深研方向 CTA（Task 13 双语）
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2, Circle, Compass, ScrollText, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';
import { fmt, useT } from '@/lib/i18n';

export function NarrativeTab() {
  const narrative = useStudio((s) => s.narrative);
  const plan = useStudio((s) => s.plan);
  const directions = useStudio((s) => s.directions);
  const directionsBusy = useStudio((s) => s.directionsBusy);
  const setWorkspaceTab = useStudio((s) => s.setWorkspaceTab);
  const generateDirections = useStudio((s) => s.generateDirections);
  const t = useT();

  return (
    <div className="studio-scroll h-full overflow-y-auto bg-[#f7f4ee] px-4 py-4 dark:bg-[#171411] sm:px-6">
      {/* 研究计划 */}
      {plan && plan.tasks.length > 0 && (
        <section className="mb-5 rounded-2xl border border-stone-300/70 bg-white/60 p-4 shadow-sm dark:border-stone-700 dark:bg-stone-800/50">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">
              {fmt(t('narrative.planTitle'), { n: plan.round })}
            </span>
          </div>
          <div className="mb-3 font-display text-[14px] font-bold leading-snug text-stone-800 dark:text-stone-100">
            {plan.focusQuestion}
          </div>
          <div className="space-y-1.5">
            {plan.tasks.map((t) => (
              <div
                key={t.id}
                className={cn(
                  'flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]',
                  t.done ? 'bg-emerald-50/70 text-stone-500 dark:bg-emerald-950/20 dark:text-stone-400' : 'bg-white/70 text-stone-700 dark:bg-stone-800/60 dark:text-stone-200'
                )}
              >
                {t.done ? (
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                ) : (
                  <Circle size={14} className="mt-0.5 shrink-0 text-stone-400" />
                )}
                <div className="min-w-0 flex-1">
                  <div className={cn('leading-snug', t.done && 'line-through decoration-stone-400/60')}>{t.goal}</div>
                  {t.done && t.summary && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-stone-400">{t.summary}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {plan.hypotheses.length > 0 && (
            <div className="mt-3 border-t border-stone-200/70 pt-2.5 dark:border-stone-700/60">
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">{t('narrative.hypotheses')}</div>
              <ul className="space-y-1 text-[12px] leading-relaxed text-stone-600 dark:text-stone-300">
                {plan.hypotheses.map((h, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="shrink-0 font-semibold text-[#a3450f] dark:text-amber-500">H{i + 1}</span>
                    <span>{h.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* 研究综述 */}
      <section>
        {narrative ? (
          <article className="case-brief mx-auto max-w-[720px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
          </article>
        ) : (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-stone-300 text-stone-300 dark:border-stone-700">
              <ScrollText size={22} />
            </div>
            <div className="font-display text-[15px] font-bold text-stone-600 dark:text-stone-300">{t('narrative.emptyTitle')}</div>
            <p className="max-w-[340px] text-[12.5px] leading-relaxed text-stone-400">
              {t('narrative.emptyBody')}
            </p>
          </div>
        )}
      </section>

      {/* 深研方向 CTA：有综述但还没有方向时引导 */}
      {narrative && !directions && (
        <div className="mx-auto mt-6 mb-4 flex max-w-[720px] flex-col items-start gap-2 rounded-2xl border border-amber-700/25 bg-gradient-to-r from-[#fdf3d7]/90 to-[#faecc8]/60 p-4 shadow-sm sm:flex-row sm:items-center dark:border-amber-600/25 dark:from-amber-950/40 dark:to-amber-900/20">
          <Compass size={20} className="shrink-0 text-[#a3450f] dark:text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">{t('narrative.ctaTitle')}</div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              {t('narrative.ctaBody')}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setWorkspaceTab('directions');
              void generateDirections();
            }}
            disabled={directionsBusy}
            className="shrink-0 gap-1.5 bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[12.5px] text-amber-50 hover:from-[#8f3c0c]"
          >
            <Sparkles size={12} />
            {t('narrative.ctaButton')}
          </Button>
        </div>
      )}
    </div>
  );
}
