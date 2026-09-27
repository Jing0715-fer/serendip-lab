'use client';

// questions-tab.tsx — 问题清单：哪些科学问题值得被进一步研究（新颖性/可行性/影响力打分）
import { Crown, FileSearch, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';
import type { ResearchQuestion } from '@/lib/types';

function ScoreBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 shrink-0 text-[10.5px] text-stone-500 dark:text-stone-400">{label}</span>
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={cn('h-1.5 w-3.5 rounded-sm', i < value ? tone : 'bg-stone-200 dark:bg-stone-700')}
          />
        ))}
      </div>
      <span className="text-[10px] tabular-nums text-stone-400">{value}/5</span>
    </div>
  );
}

function QuestionCard({ q, rank }: { q: ResearchQuestion; rank: number }) {
  const nodes = useStudio((s) => s.nodes);
  const openInspector = useStudio((s) => s.openInspector);

  const refs = q.evidenceRefs
    .map((ref) => nodes.find((n) => n.title === ref || n.title.includes(ref) || ref.includes(n.title)))
    .filter((n): n is NonNullable<typeof n> => Boolean(n));

  return (
    <div
      className={cn(
        'relative rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md',
        q.recommended
          ? 'border-amber-600/50 bg-gradient-to-b from-[#fdf3d7] to-[#faecc8] dark:border-amber-600/40 dark:from-amber-950/40 dark:to-amber-900/25'
          : 'border-stone-300/70 bg-white/60 dark:border-stone-700 dark:bg-stone-800/50'
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold tabular-nums',
            q.recommended
              ? 'bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-amber-50'
              : 'bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300'
          )}
        >
          {rank}
        </span>
        {q.recommended && (
          <Badge variant="outline" className="gap-1 border-amber-700/50 bg-amber-100 text-[10.5px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-900/40 dark:text-amber-200">
            <Crown size={10} /> 推荐深挖
          </Badge>
        )}
      </div>
      <h3 className="mb-2 font-display text-[14.5px] font-bold leading-snug text-stone-800 dark:text-stone-100">
        {q.text}
      </h3>
      {q.rationale && (
        <p className="mb-3 text-[12.5px] leading-relaxed text-stone-600 dark:text-stone-300">{q.rationale}</p>
      )}
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5">
        <ScoreBar label="新颖性" value={q.scores.novelty} tone="bg-[#b45309]" />
        <ScoreBar label="可行性" value={q.scores.feasibility} tone="bg-emerald-600" />
        <ScoreBar label="影响力" value={q.scores.impact} tone="bg-[#b91c1c]" />
      </div>
      {refs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-stone-200/70 pt-2 dark:border-stone-700/60">
          <Link2 size={11} className="text-stone-400" />
          <span className="text-[10.5px] text-stone-400">证据支撑：</span>
          {refs.map((n) => (
            <button
              key={n.id}
              onClick={() => openInspector(n.id)}
              className="max-w-[160px] truncate rounded-full border border-stone-300 px-2 py-0.5 text-[10.5px] text-stone-600 underline-offset-2 hover:border-amber-700/40 hover:text-amber-800 dark:border-stone-600 dark:text-stone-300 dark:hover:text-amber-400"
            >
              {n.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuestionsTab() {
  const questions = useStudio((s) => s.questions);

  if (questions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-stone-300 text-stone-300 dark:border-stone-700">
          <FileSearch size={22} />
        </div>
        <div className="font-display text-[15px] font-bold text-stone-600 dark:text-stone-300">问题清单还是空的</div>
        <p className="max-w-[360px] text-[12.5px] leading-relaxed text-stone-400">
          调查进行到检查点时，Serendip 会评估当前证据，挑出值得进一步研究的科学问题——按新颖性、可行性、影响力打分，并标出最值得深挖的一个。
        </p>
      </div>
    );
  }

  const sorted = [...questions].sort(
    (a, b) =>
      Number(b.recommended) - Number(a.recommended) ||
      b.scores.novelty + b.scores.feasibility + b.scores.impact -
      (a.scores.novelty + a.scores.feasibility + a.scores.impact)
  );

  return (
    <div className="studio-scroll h-full overflow-y-auto bg-[#f7f4ee] px-4 py-4 dark:bg-[#171411] sm:px-6">
      <div className="mx-auto max-w-[720px]">
        <div className="mb-1 text-[11px] font-semibold tracking-wider text-stone-500 dark:text-stone-400">
          SERENDIP 的推荐 · 供参考，最终判断权在你
        </div>
        <div className="grid gap-3">
          {sorted.map((q, i) => (
            <QuestionCard key={q.id} q={q} rank={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}
