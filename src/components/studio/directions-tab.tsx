'use client';

// directions-tab.tsx — 深研方向（Task 12）
// 从证据链提炼值得深入研究的方向 + 每个方向的完整研究计划：
// 目标 / 关键问题 / 分阶段路线（含时长）/ 方法 / 预期产出 / 风险 / 可点击文献。
import { Compass, ExternalLink, FlaskConical, Link2, Loader2, RefreshCw, Sparkles, Target } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { citationLabel, resolveCitationUrl } from '@/lib/citation';
import { useStudio } from '@/store/studio';
import { fmt, localeOf, useI18n, useT } from '@/lib/i18n';
import type { ResearchDirection } from '@/lib/types';

function ScoreDots({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-stone-500 dark:text-stone-400">{label}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span key={i} className={cn('h-1.5 w-3 rounded-sm', i < value ? tone : 'bg-stone-200 dark:bg-stone-700')} />
        ))}
      </div>
    </div>
  );
}

function DirectionCard({ d, rank }: { d: ResearchDirection; rank: number }) {
  const nodes = useStudio((s) => s.nodes);
  const openInspector = useStudio((s) => s.openInspector);
  const t = useT();

  const refNodes = d.evidenceRefs
    .map((ref) => nodes.find((n) => n.title === ref || n.title.includes(ref) || ref.includes(n.title)))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  return (
    <article className="relative rounded-2xl border border-stone-300/70 bg-white/70 p-4 shadow-sm transition-shadow hover:shadow-md dark:border-stone-700 dark:bg-stone-800/50">
      {/* 头部：编号 + 评分 + 标题 */}
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[12px] font-bold tabular-nums text-amber-50">
          {rank}
        </span>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <ScoreDots label={t('dir.novelty')} value={d.scores.novelty} tone="bg-[#b45309]" />
          <ScoreDots label={t('dir.feasibility')} value={d.scores.feasibility} tone="bg-emerald-600" />
          <ScoreDots label={t('dir.impact')} value={d.scores.impact} tone="bg-[#b91c1c]" />
        </div>
      </div>
      <h3 className="mb-1.5 font-display text-[15px] font-bold leading-snug text-stone-800 dark:text-stone-100">{d.title}</h3>
      {d.why && (
        <p className="mb-3 text-[12.5px] leading-relaxed text-stone-600 dark:text-stone-300">{d.why}</p>
      )}

      {/* 证据链锚点 */}
      {refNodes.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 border-t border-stone-200/70 pt-2 dark:border-stone-700/60">
          <Link2 size={11} className="text-stone-400" />
          <span className="text-[10.5px] text-stone-400">{t('dir.anchors')}</span>
          {refNodes.map((n) => (
            <button
              key={n.id}
              onClick={() => openInspector(n.id)}
              className="max-w-[170px] truncate rounded-full border border-stone-300 px-2 py-0.5 text-[10.5px] text-stone-600 underline-offset-2 hover:border-amber-700/40 hover:text-amber-800 dark:border-stone-600 dark:text-stone-300 dark:hover:text-amber-400"
            >
              {n.title}
            </button>
          ))}
        </div>
      )}

      {/* 研究计划 */}
      {d.plan && (
        <div className="space-y-3 rounded-xl border border-amber-800/15 bg-[#faf5ea]/80 p-3 dark:border-amber-500/15 dark:bg-amber-950/15">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#8a380c] dark:text-amber-400">
            <Target size={11} /> {t('dir.plan')}
          </div>

          {d.plan.objective && (
            <div>
              <div className="mb-0.5 text-[10.5px] font-semibold text-stone-500 dark:text-stone-400">{t('dir.objective')}</div>
              <p className="text-[12.5px] font-medium leading-relaxed text-stone-800 dark:text-stone-100">{d.plan.objective}</p>
            </div>
          )}

          {d.plan.keyQuestions.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] font-semibold text-stone-500 dark:text-stone-400">{t('dir.keyQuestions')}</div>
              <ul className="space-y-1">
                {d.plan.keyQuestions.map((q, i) => (
                  <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-stone-700 dark:text-stone-200">
                    <span className="shrink-0 font-semibold text-[#a3450f] dark:text-amber-500">Q{i + 1}</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.plan.approach.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-semibold text-stone-500 dark:text-stone-400">{t('dir.approach')}</div>
              <ol className="relative space-y-2.5 border-l-2 border-dashed border-amber-800/25 pl-4 dark:border-amber-500/25">
                {d.plan.approach.map((s, i) => (
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

          {d.plan.methods.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] font-semibold text-stone-500 dark:text-stone-400">{t('dir.methods')}</div>
              <div className="flex flex-wrap gap-1.5">
                {d.plan.methods.map((m, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-stone-300/80 bg-white/70 px-2 py-0.5 text-[10.5px] text-stone-600 dark:border-stone-600 dark:bg-stone-800/70 dark:text-stone-300"
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}

          {d.plan.expectedOutcome && (
            <div className="rounded-lg border border-emerald-700/20 bg-emerald-50/60 px-2.5 py-2 dark:border-emerald-700/30 dark:bg-emerald-950/20">
              <div className="mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-emerald-800 dark:text-emerald-400">
                <FlaskConical size={10} /> {t('dir.outcome')}
              </div>
              <p className="text-[12px] leading-relaxed text-emerald-900 dark:text-emerald-200">{d.plan.expectedOutcome}</p>
            </div>
          )}

          {d.plan.risks && (
            <div>
              <div className="mb-0.5 text-[10.5px] font-semibold text-stone-500 dark:text-stone-400">{t('dir.risks')}</div>
              <p className="text-[11.5px] leading-relaxed text-stone-600 dark:text-stone-300">{d.plan.risks}</p>
            </div>
          )}
        </div>
      )}

      {/* 文献（可点击打开原文） */}
      {d.literature.length > 0 && (
        <div className="mt-3 border-t border-stone-200/70 pt-2.5 dark:border-stone-700/60">
          <div className="mb-1.5 text-[10.5px] font-semibold text-stone-500 dark:text-stone-400">{t('dir.literature')}</div>
          <ul className="space-y-1.5">
            {d.literature.map((l, i) => {
              const url = resolveCitationUrl(l.ref, null);
              return (
                <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-relaxed">
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-1 rounded border border-stone-300/70 bg-white/60 px-1.5 py-0.5 font-mono text-[10.5px] text-emerald-800 underline-offset-2 hover:border-emerald-600/50 hover:text-emerald-700 hover:underline dark:border-stone-600 dark:bg-stone-800/60 dark:text-emerald-400"
                    >
                      <span className="truncate">{citationLabel(l.ref)}</span>
                      <ExternalLink size={9} className="shrink-0" />
                    </a>
                  ) : (
                    <span className="rounded border border-stone-300/70 bg-white/60 px-1.5 py-0.5 font-mono text-[10.5px] text-stone-500 dark:border-stone-600 dark:bg-stone-800/60 dark:text-stone-400">
                      {citationLabel(l.ref)}
                    </span>
                  )}
                  {l.note && <span className="min-w-0 flex-1 text-stone-500 dark:text-stone-400">{l.note}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}

export function DirectionsTab() {
  const directions = useStudio((s) => s.directions);
  const directionsBusy = useStudio((s) => s.directionsBusy);
  const nodeCount = useStudio((s) => s.nodes.length);
  const generate = useStudio((s) => s.generateDirections);
  const t = useT();
  const lang = useI18n((s) => s.lang);

  // 生成中：审阅动画
  if (directionsBusy && !directions) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-[#a3450f]/40">
          <Compass size={26} className="animate-pulse text-[#a3450f] dark:text-amber-500" />
          <span className="absolute inset-0 animate-ping rounded-full border border-[#a3450f]/20" />
        </div>
        <div className="font-display text-[15px] font-bold text-stone-600 dark:text-stone-300">{t('dir.busyTitle')}</div>
        <p className="max-w-[360px] text-[12.5px] leading-relaxed text-stone-400">
          {t('dir.busyBody')}
        </p>
        <Loader2 size={16} className="animate-spin text-stone-400" />
      </div>
    );
  }

  // 空态
  if (!directions) {
    const tooFew = nodeCount < 3;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-stone-300 text-stone-300 dark:border-stone-700">
          <Compass size={22} />
        </div>
        <div className="font-display text-[15px] font-bold text-stone-600 dark:text-stone-300">{t('dir.emptyTitle')}</div>
        <p className="max-w-[380px] text-[12.5px] leading-relaxed text-stone-400">
          {t('dir.emptyBody')}
        </p>
        <Button
          onClick={() => void generate()}
          disabled={tooFew}
          className="mt-1 gap-1.5 bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[13px] text-amber-50 hover:from-[#8f3c0c]"
        >
          <Sparkles size={13} />
          {tooFew ? fmt(t('dir.tooFew'), { n: nodeCount }) : t('dir.emptyButton')}
        </Button>
        {tooFew && (
          <p className="max-w-[300px] text-[10.5px] leading-relaxed text-stone-400">{t('dir.tooFewHint')}</p>
        )}
      </div>
    );
  }

  // 结果
  return (
    <div className="studio-scroll h-full overflow-y-auto bg-[#f7f4ee] px-4 py-4 dark:bg-[#171411] sm:px-6">
      <div className="mx-auto max-w-[720px]">
        <div className="mb-4 rounded-2xl border border-amber-700/25 bg-gradient-to-b from-[#fdf3d7]/90 to-[#faecc8]/70 p-3.5 shadow-sm dark:border-amber-600/25 dark:from-amber-950/40 dark:to-amber-900/20">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-[#8a380c] dark:text-amber-400">
            <Compass size={12} /> {t('dir.resultHeader')}
            <span className="ml-auto font-normal text-stone-500 dark:text-stone-400">
              {new Date(directions.generatedAt).toLocaleString(localeOf(lang), { hour12: false })}
            </span>
          </div>
          {directions.summary && (
            <p className="text-[12.5px] leading-relaxed text-stone-700 dark:text-stone-200">{directions.summary}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void generate()}
            disabled={directionsBusy}
            className="mt-2 h-7 gap-1 border-amber-700/30 bg-white/60 text-[11.5px] text-stone-700 hover:bg-white dark:border-amber-600/30 dark:bg-stone-800/60 dark:text-stone-200"
          >
            {directionsBusy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {t('dir.regenerate')}
          </Button>
        </div>

        <div className="mb-1 text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">
          {t('dir.disclaimer')}
        </div>
        <div className="grid gap-3 pb-6">
          {directions.directions.map((d, i) => (
            <DirectionCard key={i} d={d} rank={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}
