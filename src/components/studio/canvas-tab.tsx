'use client';

// canvas-tab.tsx — 证据墙标签页：EvidenceBoard + 添加素材 + 节点检视（Task 13 双语 → Task 14 一键整理）
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { LayoutGrid, MapPin, Microscope, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStudio } from '@/store/studio';
import { fmt, useT } from '@/lib/i18n';
import { AddClueDialog } from './add-clue-dialog';
import { NodeInspector } from './node-inspector';

const EvidenceBoard = dynamic(
  () => import('@/components/canvas/evidence-board').then((m) => m.EvidenceBoard),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-[#d9c3a5]">
        <div className="flex flex-col items-center gap-2 text-stone-600">
          <MapPin size={22} className="animate-bounce" />
          <span className="text-[12px] tracking-wider"><CanvasLoadingText /></span>
        </div>
      </div>
    ),
  }
);

function CanvasLoadingText() {
  const t = useT();
  return <>{t('canvas.loading')}</>;
}

export function CanvasTab() {
  const nodes = useStudio((s) => s.nodes);
  const edges = useStudio((s) => s.edges);
  const liveIds = useStudio((s) => s.liveIds);
  const openInspector = useStudio((s) => s.openInspector);
  const saveLayout = useStudio((s) => s.saveLayout);
  const setAddClue = useStudio((s) => s.setAddClue);
  const t = useT();
  const [organizeTick, setOrganizeTick] = useState(0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 画布工具条 */}
      <div className="flex items-center gap-2 border-b border-stone-300/60 bg-[#f7f4ee]/80 px-3 py-1.5 dark:border-stone-800 dark:bg-[#171411]/80">
        <span className="text-[11px] tracking-wider text-stone-500 dark:text-stone-400">
          {fmt(t('canvas.count'), { n: nodes.length, m: edges.length })}
        </span>
        <span className="hidden text-[10.5px] text-stone-400 sm:inline">
          {t('canvas.hint')}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={nodes.length < 2}
          className="ml-auto h-7 gap-1 border-stone-300 bg-white/70 text-[12px] dark:border-stone-700 dark:bg-stone-800/70"
          onClick={() => setOrganizeTick((v) => v + 1)}
          title={t('canvas.organizeHint')}
        >
          <LayoutGrid size={13} />
          {t('canvas.organize')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 border-stone-300 bg-white/70 text-[12px] dark:border-stone-700 dark:bg-stone-800/70"
          onClick={() => setAddClue(true)}
        >
          <Plus size={13} />
          {t('canvas.addNote')}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 p-2 sm:p-3">
        {nodes.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#b09468] bg-[#d9c3a5]/60 dark:border-[#4d4030] dark:bg-[#241d15]/60">
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-[#8a6f45] text-2xl">
                <Microscope size={24} className="text-[#8a6f45]" />
              </div>
              <div className="font-display text-[16px] font-bold text-[#6b522e] dark:text-[#c9b28a]">
                {t('canvas.emptyTitle')}
              </div>
              <p className="max-w-[380px] text-[12.5px] leading-relaxed text-[#8a6f45] dark:text-[#a08b66]">
                {t('canvas.emptyBody')}
              </p>
            </div>
          </div>
        ) : (
          <EvidenceBoard
            nodes={nodes}
            edges={edges}
            liveIds={liveIds}
            onNodeClick={(n) => openInspector(n.id)}
            onPositionsChange={(positions) => saveLayout(positions)}
            organizeSignal={organizeTick}
          />
        )}
      </div>

      <AddClueDialog />
      <NodeInspector />
    </div>
  );
}
