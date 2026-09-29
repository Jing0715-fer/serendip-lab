'use client';

// explore-dialog.tsx — 课题探索闭环（Task 16）
// 单张深研课题卡的「探索方案 → 反馈结果 → 继续推导」循环面板：
//  · 方案：目标 / 待验证假说 / 分阶段实验设计（含决策点）/ 方法 / 判读标准 / 预期产出；
//  · 反馈：用户带着实验结果回来 → AI 继续推导 → 重整证据墙逻辑 → 修正方案（v2、v3…）；
//  · 每轮给出 verdict 徽章 + 下一步方向（按优先级）。
// 数据流：POST 立即返回 → SSE explore 事件更新；反馈应用的证据墙变更经独立 state 事件到达。
import { useState } from 'react';
import {
  ArrowRight,
  ClipboardList,
  FlaskConical,
  GitBranch,
  Lightbulb,
  Loader2,
  MessageSquareQuote,
  RefreshCw,
  Send,
  Sparkles,
  Target,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';
import { fmt, localeOf, useI18n, useT, type TKey } from '@/lib/i18n';
import type { ExploreVerdict, FeedbackRound, TopicPlan } from '@/lib/types';

const VERDICT_STYLE: Record<ExploreVerdict, { chip: string; dot: string; tKey: TKey }> = {
  supports: { chip: 'border-emerald-600/40 bg-emerald-100/80 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-300', dot: 'bg-emerald-500', tKey: 'explore.verdict.supports' },
  contradicts: { chip: 'border-red-600/40 bg-red-100/80 text-red-900 dark:border-red-500/40 dark:bg-red-950/50 dark:text-red-300', dot: 'bg-red-500', tKey: 'explore.verdict.contradicts' },
  mixed: { chip: 'border-amber-600/40 bg-amber-100/80 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-300', dot: 'bg-amber-500', tKey: 'explore.verdict.mixed' },
  inconclusive: { chip: 'border-stone-400/50 bg-stone-100/80 text-stone-700 dark:border-stone-600/50 dark:bg-stone-800/80 dark:text-stone-300', dot: 'bg-stone-400', tKey: 'explore.verdict.inconclusive' },
  refined: { chip: 'border-teal-600/40 bg-teal-100/80 text-teal-900 dark:border-teal-500/40 dark:bg-teal-950/50 dark:text-teal-300', dot: 'bg-teal-500', tKey: 'explore.verdict.refined' },
};

function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-semibold text-stone-500 dark:text-stone-400">
      {icon}
      {children}
    </div>
  );
}

function PlanView({ plan, version }: { plan: TopicPlan; version: number }) {
  const t = useT();
  return (
    <div className="space-y-3 rounded-xl border border-amber-800/15 bg-[#faf5ea]/80 p-3 dark:border-amber-500/15 dark:bg-amber-950/15">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#8a380c] dark:text-amber-400">
        <FlaskConical size={11} /> {fmt(t('explore.planHeader'), { n: String(version) })}
      </div>

      {plan.objective && (
        <div>
          <SectionLabel icon={<Target size={10} />}>{t('explore.objective')}</SectionLabel>
          <p className="text-[12.5px] font-medium leading-relaxed text-stone-800 dark:text-stone-100">{plan.objective}</p>
        </div>
      )}

      {plan.hypothesis && (
        <div className="rounded-lg border border-amber-700/20 bg-white/60 px-2.5 py-2 dark:border-amber-600/20 dark:bg-stone-800/50">
          <SectionLabel icon={<Lightbulb size={10} />}>{t('explore.hypothesis')}</SectionLabel>
          <p className="text-[12px] leading-relaxed text-stone-700 dark:text-stone-200">{plan.hypothesis}</p>
        </div>
      )}

      {plan.keyQuestions.length > 0 && (
        <div>
          <SectionLabel>{t('explore.keyQuestions')}</SectionLabel>
          <ul className="space-y-1">
            {plan.keyQuestions.map((q, i) => (
              <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-stone-700 dark:text-stone-200">
                <span className="shrink-0 font-semibold text-[#a3450f] dark:text-amber-500">Q{i + 1}</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.design.length > 0 && (
        <div>
          <SectionLabel icon={<GitBranch size={10} />}>{t('explore.design')}</SectionLabel>
          <ol className="relative space-y-2.5 border-l-2 border-dashed border-amber-800/25 pl-4 dark:border-amber-500/25">
            {plan.design.map((s, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[21px] top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[#a3450f]/50 bg-[#fdf3d7] text-[8px] font-bold text-[#8a380c] dark:border-amber-500/50 dark:bg-amber-950 dark:text-amber-300">
                  {i + 1}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-stone-800 dark:text-stone-100">{s.step}</span>
                  {s.duration && (
                    <Badge variant="outline" className="h-4 px-1.5 text-[9.5px] font-normal text-stone-500 dark:border-stone-600 dark:text-stone-400">
                      {s.duration}
                    </Badge>
                  )}
                </div>
                {s.detail && <p className="mt-0.5 text-[11.5px] leading-relaxed text-stone-600 dark:text-stone-300">{s.detail}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {plan.metrics.length > 0 && (
        <div className="rounded-lg border border-emerald-700/20 bg-emerald-50/60 px-2.5 py-2 dark:border-emerald-700/30 dark:bg-emerald-950/20">
          <SectionLabel icon={<ClipboardList size={10} />}>{t('explore.metrics')}</SectionLabel>
          <ul className="space-y-1">
            {plan.metrics.map((m, i) => (
              <li key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed text-emerald-900 dark:text-emerald-200">
                <span className="shrink-0 text-emerald-700 dark:text-emerald-400">▸</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.methods.length > 0 && (
        <div>
          <SectionLabel>{t('explore.methods')}</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {plan.methods.map((m, i) => (
              <span key={i} className="rounded-full border border-stone-300/80 bg-white/70 px-2 py-0.5 text-[10.5px] text-stone-600 dark:border-stone-600 dark:bg-stone-800/70 dark:text-stone-300">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {plan.expectedOutcome && (
        <div>
          <SectionLabel icon={<Sparkles size={10} />}>{t('explore.outcome')}</SectionLabel>
          <p className="text-[12px] leading-relaxed text-stone-700 dark:text-stone-200">{plan.expectedOutcome}</p>
        </div>
      )}

      {plan.risks && (
        <div>
          <SectionLabel>{t('explore.risks')}</SectionLabel>
          <p className="text-[11.5px] leading-relaxed text-stone-600 dark:text-stone-300">{plan.risks}</p>
        </div>
      )}
    </div>
  );
}

function RoundView({ r }: { r: FeedbackRound }) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const verdict = VERDICT_STYLE[r.verdict];
  return (
    <article className="rounded-xl border border-stone-300/70 bg-white/60 p-3 dark:border-stone-700 dark:bg-stone-800/50">
      {/* 轮次头 */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">{fmt(t('explore.round'), { n: String(r.n) })}</span>
        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium', verdict.chip)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', verdict.dot)} />
          {t(verdict.tKey)}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-stone-400">
          {new Date(r.createdAt).toLocaleString(localeOf(lang), { hour12: false })}
        </span>
      </div>

      {/* 用户反馈 */}
      <div className="mb-2 rounded-lg border-l-[3px] border-stone-400 bg-stone-100/70 px-2.5 py-2 dark:border-stone-500 dark:bg-stone-800/80">
        <div className="mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
          <MessageSquareQuote size={10} /> {t('explore.roundFeedback')}
        </div>
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-stone-700 dark:text-stone-200">{r.feedback}</p>
      </div>

      {/* 推导分析 */}
      {r.analysis && (
        <div className="mb-2">
          <SectionLabel icon={<Sparkles size={10} />}>{t('explore.analysis')}</SectionLabel>
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-stone-700 dark:text-stone-200">{r.analysis}</p>
        </div>
      )}

      {/* 证据墙整理 */}
      {r.logicUpdates.length > 0 && (
        <div className="mb-2 rounded-lg border border-stone-200/80 bg-stone-50/80 px-2.5 py-2 dark:border-stone-700/60 dark:bg-stone-900/40">
          <SectionLabel icon={<Wrench size={10} />}>{t('explore.logicUpdates')}</SectionLabel>
          <ul className="space-y-0.5">
            {r.logicUpdates.map((u, i) => (
              <li key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed text-stone-600 dark:text-stone-300">
                <span className="shrink-0 text-stone-400">·</span>
                <span>{u}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 下一步方向（本轮最重要的产出） */}
      {r.nextSteps.length > 0 && (
        <div className="rounded-lg border border-[#a3450f]/25 bg-gradient-to-b from-[#fdf3d7]/90 to-[#faecc8]/60 px-2.5 py-2 dark:border-amber-600/25 dark:from-amber-950/40 dark:to-amber-900/20">
          <SectionLabel icon={<ArrowRight size={10} />}>{t('explore.nextSteps')}</SectionLabel>
          <ol className="space-y-1.5">
            {r.nextSteps.map((s, i) => (
              <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-amber-950 dark:text-amber-100">
                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9.5px] font-bold', i === 0 ? 'bg-[#a3450f] text-amber-50' : 'bg-[#a3450f]/15 text-[#8a380c] dark:bg-amber-500/20 dark:text-amber-300')}>
                  {i + 1}
                </span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          {r.planPatch && (
            <div className="mt-1.5 border-t border-amber-700/20 pt-1.5 text-[10.5px] font-medium text-[#8a380c] dark:border-amber-600/20 dark:text-amber-400">
              <GitBranch size={10} className="mr-1 inline" />
              {fmt(t('explore.planUpdated'), { n: String(r.n + 1) })}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function BusyPanel({ kind }: { kind: 'plan' | 'feedback' }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[#a3450f]/35 bg-[#fdf3d7]/40 px-4 py-6 text-center dark:border-amber-600/35 dark:bg-amber-950/20">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-[#a3450f]/40">
        <FlaskConical size={22} className="animate-pulse text-[#a3450f] dark:text-amber-500" />
        <span className="absolute inset-0 animate-ping rounded-full border border-[#a3450f]/20" />
      </div>
      <div className="font-display text-[14px] font-bold text-stone-600 dark:text-stone-300">
        {kind === 'plan' ? t('explore.busyTitle') : t('explore.feedbackBusyTitle')}
      </div>
      <p className="max-w-[400px] text-[12px] leading-relaxed text-stone-400">
        {kind === 'plan' ? t('explore.busyBody') : t('explore.feedbackBusyBody')}
      </p>
      <Loader2 size={15} className="animate-spin text-stone-400" />
    </div>
  );
}

export function ExploreDialog() {
  const open = useStudio((s) => s.exploreOpen);
  const setOpen = useStudio((s) => s.setExploreOpen);
  const nodeId = useStudio((s) => s.exploreNodeId);
  const node = useStudio((s) => (s.exploreNodeId ? s.nodes.find((n) => n.id === s.exploreNodeId) ?? null : null));
  const exploration = useStudio((s) => (s.exploreNodeId ? s.explorations[s.exploreNodeId] ?? null : null));
  const busy = useStudio((s) => (s.exploreNodeId ? s.exploreBusy[s.exploreNodeId] ?? null : null));
  const generate = useStudio((s) => s.generateExplorePlan);
  const regenerate = useStudio((s) => s.regenerateExplorePlan);
  const submitFeedback = useStudio((s) => s.submitExploreFeedback);
  const [text, setText] = useState('');
  const t = useT();

  if (!nodeId || !node) return null;

  const version = (exploration?.rounds.length ?? 0) + 1;

  async function submit() {
    if (!text.trim() || !nodeId) return;
    await submitFeedback(nodeId, text);
    setText('');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setText('');
      }}
    >
      <DialogContent className="flex max-h-[86vh] w-[calc(100vw-2rem)] max-w-[660px] flex-col border-stone-300 bg-[#f7f4ee] dark:border-stone-700 dark:bg-[#171411] sm:w-[660px]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-start gap-2 text-left font-display text-[15px] leading-snug text-stone-800 dark:text-stone-100">
            <FlaskConical size={15} className="mt-0.5 shrink-0 text-[#a3450f] dark:text-amber-500" />
            <span className="min-w-0">
              <span className="block">{t('explore.title')}</span>
              <span className="mt-0.5 block truncate text-[12px] font-normal text-stone-500 dark:text-stone-400">{node.title}</span>
            </span>
            {exploration && (
              <Badge
                variant="outline"
                className="ml-auto shrink-0 border-amber-700/40 bg-amber-100/70 text-[10.5px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-300"
              >
                {fmt(t('explore.badge'), { n: String(version) })}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="studio-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {/* 空态：还没有方案 */}
          {!exploration && busy !== 'plan' && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center dark:border-stone-700">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-stone-300 text-stone-300 dark:border-stone-700">
                <FlaskConical size={22} />
              </div>
              <div className="font-display text-[14px] font-bold text-stone-600 dark:text-stone-300">{t('explore.emptyTitle')}</div>
              <p className="max-w-[420px] text-[12px] leading-relaxed text-stone-400">{t('explore.emptyBody')}</p>
              <Button
                onClick={() => void generate(nodeId)}
                className="mt-1 gap-1.5 bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[13px] text-amber-50 hover:from-[#8f3c0c]"
              >
                <FlaskConical size={13} />
                {t('explore.emptyButton')}
              </Button>
            </div>
          )}

          {/* 生成中 */}
          {busy === 'plan' && <BusyPanel kind="plan" />}

          {/* 方案 + 历史轮次 */}
          {exploration && busy !== 'plan' && (
            <>
              <div className="relative">
                <PlanView plan={exploration.plan} version={version} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void regenerate(nodeId)}
                  disabled={busy !== null}
                  className="absolute right-2 top-2 h-6 gap-1 border-amber-700/30 bg-white/70 text-[10.5px] text-stone-600 hover:bg-white dark:border-amber-600/30 dark:bg-stone-800/70 dark:text-stone-300"
                >
                  <RefreshCw size={10} />
                  {t('explore.regenerate')}
                </Button>
              </div>

              {exploration.rounds.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">
                    <MessageSquareQuote size={11} /> {t('explore.history')}
                  </div>
                  {exploration.rounds.map((r) => (
                    <RoundView key={r.n} r={r} />
                  ))}
                </div>
              )}
            </>
          )}

          {/* 反馈推导中 */}
          {busy === 'feedback' && <BusyPanel kind="feedback" />}
        </div>

        {/* 反馈输入：方案就绪后常驻底部（闭环入口） */}
        {exploration && (
          <div className="shrink-0 space-y-1.5 border-t border-stone-200/80 pt-3 dark:border-stone-700/60">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-stone-700 dark:text-stone-200">
              <Send size={12} className="text-amber-700" /> {t('explore.feedbackLabel')}
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('explore.feedbackPh')}
              rows={3}
              disabled={busy !== null}
              className="studio-scroll min-h-[64px] border-stone-300 bg-white/70 text-[12.5px] dark:border-stone-700 dark:bg-stone-800/70"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[10.5px] leading-relaxed text-stone-400">{t('explore.feedbackHint')}</p>
              <Button
                onClick={() => void submit()}
                disabled={busy !== null || !text.trim()}
                className="h-8 gap-1.5 bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[12.5px] text-amber-50 hover:from-[#8f3c0c]"
              >
                {busy === 'feedback' ? <Loader2 size={12} className="animate-spin" /> : <Send size={11} />}
                {t('explore.submit')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
