'use client';

// narrative-tab.tsx — 案情综述（结案陈词 markdown）+ 调查计划进度
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CheckCircle2, Circle, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';

export function NarrativeTab() {
  const narrative = useStudio((s) => s.narrative);
  const plan = useStudio((s) => s.plan);

  return (
    <div className="studio-scroll h-full overflow-y-auto bg-[#f7f4ee] px-4 py-4 dark:bg-[#171411] sm:px-6">
      {/* 调查计划 */}
      {plan && plan.tasks.length > 0 && (
        <section className="mb-5 rounded-2xl border border-stone-300/70 bg-white/60 p-4 shadow-sm dark:border-stone-700 dark:bg-stone-800/50">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">
              调查计划 · 第 {plan.round} 轮
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
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">在办假说</div>
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

      {/* 案情综述 */}
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
            <div className="font-display text-[15px] font-bold text-stone-600 dark:text-stone-300">尚无案情综述</div>
            <p className="max-w-[340px] text-[12.5px] leading-relaxed text-stone-400">
              进入自主调查后，Serendip 会定期把碎片化的证据梳理成有逻辑的叙事——像侦探的结案陈词一样，从迷雾讲到证据链，再讲到值得深挖的问题。
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
