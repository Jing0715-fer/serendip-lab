'use client';

// activity-tab.tsx — 活动日志：Agent 每一步思考与工具调用的全程记录（Task 13 双语）
import { Activity, BrainCircuit, CheckCircle2, ChevronRight, Wrench, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStudio, fmtTime, fmtElapsed } from '@/store/studio';
import { TOOL_LABEL, useI18n, useT } from '@/lib/i18n';
import type { ActivityEvent } from '@/lib/types';

function EventRow({ ev }: { ev: ActivityEvent }) {
  const lang = useI18n((s) => s.lang);
  let icon;
  let tone = 'text-stone-500';
  switch (ev.type) {
    case 'thought':
      icon = <BrainCircuit size={13} />;
      tone = 'text-stone-400';
      break;
    case 'tool_call':
      icon = <Wrench size={12} />;
      tone = 'text-amber-700 dark:text-amber-500';
      break;
    case 'tool_result':
      icon = ev.ok === false ? <XCircle size={13} /> : <CheckCircle2 size={13} />;
      tone = ev.ok === false ? 'text-red-600' : 'text-emerald-600';
      break;
    case 'phase':
      icon = <ChevronRight size={13} />;
      tone = 'text-[#a3450f]';
      break;
    default:
      icon = <Activity size={12} />;
  }

  const toolLabel = ev.tool ? (TOOL_LABEL[ev.tool]?.[lang] ?? ev.tool) : null;

  return (
    <div className="flex gap-2.5 py-1.5">
      <div className="flex w-12 shrink-0 flex-col items-end">
        <span className="text-[9.5px] tabular-nums text-stone-400">{fmtTime(ev.ts)}</span>
      </div>
      <div className={cn('mt-0.5 shrink-0', tone)}>{icon}</div>
      <div className="min-w-0 flex-1">
        {ev.type === 'tool_call' && toolLabel && (
          <span className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">{toolLabel}</span>
        )}
        {ev.type === 'tool_result' && toolLabel && (
          <span className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
            {toolLabel}
            {ev.durationMs != null && (
              <span className="ml-1.5 text-[10px] tabular-nums text-stone-400">{fmtElapsed(ev.durationMs)}</span>
            )}
          </span>
        )}
        <p
          className={cn(
            'break-words text-[11.5px] leading-relaxed',
            ev.ok === false ? 'text-red-600/90' : 'text-stone-500 dark:text-stone-400'
          )}
        >
          {ev.summary}
        </p>
      </div>
    </div>
  );
}

export function ActivityTab() {
  const activity = useStudio((s) => s.activity);
  const stats = useStudio((s) => s.stats);
  const t = useT();

  const list = [...activity].reverse(); // 最新在上

  return (
    <div className="studio-scroll h-full overflow-y-auto bg-[#f7f4ee] px-4 py-4 dark:bg-[#171411] sm:px-6">
      <div className="mx-auto max-w-[720px]">
        {stats && (
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-stone-300/70 bg-white/60 p-3 text-center dark:border-stone-700 dark:bg-stone-800/50 sm:grid-cols-4">
            {[
              { label: t('act.steps'), value: `${stats.stepsUsed}/${stats.maxSteps}` },
              { label: t('act.toolCalls'), value: String(stats.toolCalls) },
              { label: t('act.llmCalls'), value: String(stats.llmCalls) },
              { label: t('act.evidence'), value: String(stats.evidenceCount + stats.sourceCount) },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-[16px] font-bold tabular-nums text-stone-800 dark:text-stone-100">{s.value}</div>
                <div className="text-[10.5px] text-stone-400">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-stone-300 text-stone-300 dark:border-stone-700">
              <Activity size={22} />
            </div>
            <div className="font-display text-[15px] font-bold text-stone-600 dark:text-stone-300">{t('act.emptyTitle')}</div>
            <p className="max-w-[340px] text-[12.5px] leading-relaxed text-stone-400">
              {t('act.emptyBody')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-stone-200/70 rounded-2xl border border-stone-300/70 bg-white/50 px-3 py-2 dark:divide-stone-700/60 dark:border-stone-700 dark:bg-stone-800/40">
            {list.map((ev) => (
              <EventRow key={ev.id} ev={ev} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
