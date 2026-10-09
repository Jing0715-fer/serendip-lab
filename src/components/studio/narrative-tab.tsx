'use client';

// narrative-tab.tsx — 研究综述（markdown）+ 研究计划进度 + 深研方向 CTA（Task 13 双语）
// Task 20：综述重梳理 —— 证据墙变化后（steer/素材/反馈）可按当前墙上内容重新生成综述
// Task 23：延迟收官横幅 —— 最终综述因配额受限丢失时，展示自动重试状态 + 手动补收官 CTA
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, CheckCircle2, Circle, Compass, History, Loader2, RefreshCw, ScrollText, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStudio, isAgentWorking } from '@/store/studio';
import { fmt, useT } from '@/lib/i18n';

export function NarrativeTab() {
  const narrative = useStudio((s) => s.narrative);
  const plan = useStudio((s) => s.plan);
  const taskHistory = useStudio((s) => s.taskHistory);
  const directions = useStudio((s) => s.directions);
  const directionsBusy = useStudio((s) => s.directionsBusy);
  const session = useStudio((s) => s.session);
  const nodes = useStudio((s) => s.nodes);
  const resyncBusy = useStudio((s) => s.resyncBusy);
  const resynthesize = useStudio((s) => s.resynthesize);
  const setWorkspaceTab = useStudio((s) => s.setWorkspaceTab);
  const generateDirections = useStudio((s) => s.generateDirections);
  const finalizeBusy = useStudio((s) => s.finalizeBusy);
  const finalizeNow = useStudio((s) => s.finalizeNow);
  const t = useT();

  const working = isAgentWorking(session?.status);
  const pendingFinal = session?.pendingFinal ?? null;

  // Task 30 P1-①：跨轮任务历史——排除当前轮（当前轮任务在上方「研究计划」区实时展示，避免重复）
  const currentRound = plan?.round ?? -1;
  const history = taskHistory.filter((r) => r.round !== currentRound);
  const historyRounds = [...new Set(history.map((r) => r.round))].sort((a, b) => a - b);

  return (
    <div className="studio-scroll h-full overflow-y-auto bg-[#f7f4ee] px-4 py-4 dark:bg-[#171411] sm:px-6">
      {/* 延迟收官横幅（Task 23）：最终综述因模型服务受限丢失——自动重试中，也可手动补齐 */}
      {pendingFinal && !working && (
        <div
          role="alert"
          className="mx-auto mb-5 flex max-w-[720px] flex-col items-start gap-3 rounded-2xl border border-amber-700/30 bg-[#fdf3d7]/80 p-4 shadow-sm sm:flex-row sm:items-center dark:border-amber-600/30 dark:bg-amber-950/30"
        >
          <AlertTriangle size={20} className="shrink-0 text-[#a3450f] dark:text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">{t('narrative.pendingTitle')}</div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              {fmt(t('narrative.pendingBody'), { n: pendingFinal.attempts })}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => void finalizeNow()}
            disabled={finalizeBusy}
            className="shrink-0 gap-1.5 bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[12.5px] text-amber-50 hover:from-[#8f3c0c]"
          >
            {finalizeBusy ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
            {finalizeBusy ? t('narrative.finalizeBusy') : t('narrative.finalizeButton')}
          </Button>
        </div>
      )}
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

      {/* 跨轮任务历史（Task 30 P1-①）：savePlan 每轮整体覆盖，前轮已完成任务连同轨迹小结
          曾从视图永久丢失——这里从追加式 task_records 表渲染累积视图 */}
      {history.length > 0 && (
        <section className="mb-5 rounded-2xl border border-stone-300/70 bg-white/60 p-4 shadow-sm dark:border-stone-700 dark:bg-stone-800/50">
          <div className="mb-3 flex items-center gap-2">
            <History size={13} className="text-stone-400" />
            <span className="text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">
              {t('narrative.historyTitle')}
            </span>
            <span className="rounded-full bg-stone-200/80 px-1.5 py-0.5 text-[10px] tabular-nums text-stone-500 dark:bg-stone-700 dark:text-stone-400">
              {history.length}
            </span>
          </div>
          <div className="space-y-3">
            {historyRounds.map((round) => (
              <div key={round}>
                <div className="mb-1.5 text-[10.5px] font-semibold tracking-wider text-amber-800/80 dark:text-amber-500/70">
                  {fmt(t('narrative.historyRound'), { n: String(round) })}
                </div>
                <div className="space-y-1.5">
                  {history
                    .filter((r) => r.round === round)
                    .map((r) => (
                      <div
                        key={r.id}
                        className="rounded-lg bg-stone-50/80 px-2.5 py-1.5 text-[12.5px] dark:bg-stone-800/60"
                      >
                        <div className="flex items-start gap-2">
                          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                          <div className="min-w-0 flex-1">
                            <div className="leading-snug text-stone-600 line-through decoration-stone-400/60 dark:text-stone-300">
                              {r.goal}
                            </div>
                            {r.summary && (
                              <div className="mt-0.5 line-clamp-3 text-[11px] leading-relaxed text-stone-400">{r.summary}</div>
                            )}
                            <div className="mt-1 text-[10px] tabular-nums text-stone-400 dark:text-stone-500">
                              {fmt(t('narrative.historyMeta'), { pinned: String(r.pinned), searches: String(r.searches) })}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 研究综述 */}
      <section>
        {/* 重梳理操作条（Task 20）：有综述且 Agent 闲时可用；重梳理进行中保持可见展示 busy 态 */}
        {narrative && (!working || resyncBusy) && (
          <div className="mx-auto mb-3 flex max-w-[720px] items-center justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={resyncBusy || nodes.length < 1}
              title={t('narrative.resyncHint')}
              onClick={() => void resynthesize()}
              className="h-7 gap-1 border-stone-300 bg-white/70 text-[12px] dark:border-stone-700 dark:bg-stone-800/70"
            >
              {resyncBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {resyncBusy ? t('narrative.resyncBusy') : t('narrative.resync')}
            </Button>
          </div>
        )}
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
