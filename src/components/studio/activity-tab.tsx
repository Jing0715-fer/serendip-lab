'use client';

// activity-tab.tsx — 活动日志：Agent 每一步思考与工具调用的全程记录
import { Activity, BrainCircuit, CheckCircle2, ChevronRight, Wrench, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStudio, fmtTime, fmtElapsed } from '@/store/studio';
import type { ActivityEvent } from '@/lib/types';

const TOOL_LABEL: Record<string, string> = {
  pubmed_search: 'PubMed 检索',
  pubmed_fetch: 'PubMed 摘要精读',
  europepmc_search: 'Europe PMC 检索',
  openalex_search: 'OpenAlex 检索',
  uniprot_search: 'UniProt 蛋白查询',
  ncbi_gene: 'NCBI 基因查询',
  pdb_search: 'PDB 结构检索',
  taxonomy_search: 'Taxonomy 物种查询',
  clinvar_search: 'ClinVar 变异检索',
  web_search: 'Web 搜索',
  web_read: '网页精读',
  add_evidence: '钉上证据',
  link_evidence: '连接红绳',
  update_evidence: '更新证据',
  note_gap: '记录空白',
  ask_user: '向用户提问',
  finish_task: '任务小结',
};

function EventRow({ ev }: { ev: ActivityEvent }) {
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

  const toolLabel = ev.tool ? (TOOL_LABEL[ev.tool] ?? ev.tool) : null;

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

  const list = [...activity].reverse(); // 最新在上

  return (
    <div className="studio-scroll h-full overflow-y-auto bg-[#f7f4ee] px-4 py-4 dark:bg-[#171411] sm:px-6">
      <div className="mx-auto max-w-[720px]">
        {stats && (
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-stone-300/70 bg-white/60 p-3 text-center dark:border-stone-700 dark:bg-stone-800/50 sm:grid-cols-4">
            {[
              { label: '调查步数', value: `${stats.stepsUsed}/${stats.maxSteps}` },
              { label: '工具调用', value: String(stats.toolCalls) },
              { label: 'LLM 推理', value: String(stats.llmCalls) },
              { label: '证据节点', value: String(stats.evidenceCount + stats.sourceCount) },
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
            <div className="font-display text-[15px] font-bold text-stone-600 dark:text-stone-300">暂无活动记录</div>
            <p className="max-w-[340px] text-[12.5px] leading-relaxed text-stone-400">
              Agent 的每一步思考、每一次数据库检索、每一条证据落墙，都会在这里留下完整的时间线。
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
