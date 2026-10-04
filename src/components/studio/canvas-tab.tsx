'use client';

// canvas-tab.tsx — 证据墙标签页：EvidenceBoard + 添加素材 + 节点检视
// Task 13 双语 → Task 14 一键整理 → Task 17 卡片搜索（命中高亮/未命中压暗）+ 类型筛选
// Task 20：证据等级筛选（第二组 chip，只作用于带等级的 evidence 卡，允许全部隐藏）
import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { LayoutGrid, MapPin, Microscope, Plus, RotateCcw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';
import { EVIDENCE_LEVEL_LABEL, fmt, NODE_KIND_LABEL, useI18n, useT } from '@/lib/i18n';
import type { EvidenceLevel, NodeKind } from '@/lib/types';
import { AddClueDialog } from './add-clue-dialog';
import { NodeInspector } from './node-inspector';
import { EVIDENCE_LEVEL_COLOR, KIND_COLOR } from '@/components/canvas/board-nodes';
import { nodeMatchesSearch } from '@/components/canvas/node-search';

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

/** 类型筛选 chip：色点 + 类型名；被隐藏的类型降透明度 + 虚线边 */
function KindChip({
  kind,
  hidden,
  onToggle,
}: {
  kind: NodeKind;
  hidden: boolean;
  onToggle: () => void;
}) {
  const lang = useI18n((s) => s.lang);
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      title={t('canvas.filterHint')}
      aria-pressed={!hidden}
      className={cn(
        'flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[10.5px] font-medium transition-all',
        hidden
          ? 'border-dashed border-stone-300/70 bg-transparent text-stone-400 opacity-55 dark:border-stone-600/70 dark:text-stone-500'
          : 'border-stone-400/70 bg-white/80 text-stone-700 shadow-sm hover:border-[#a3450f]/50 dark:border-stone-500/70 dark:bg-stone-800/80 dark:text-stone-200 dark:hover:border-amber-500/50'
      )}
    >
      <span
        className="h-2 w-2 rounded-full border border-stone-500/30"
        style={{ background: hidden ? 'transparent' : KIND_COLOR[kind] }}
        aria-hidden="true"
      />
      {NODE_KIND_LABEL[kind][lang]}
    </button>
  );
}

/** 证据等级筛选 chip（Task 20）：等级色点 + 等级名，仅作用于带等级的 evidence 卡 */
function LevelChip({
  level,
  hidden,
  onToggle,
}: {
  level: EvidenceLevel;
  hidden: boolean;
  onToggle: () => void;
}) {
  const lang = useI18n((s) => s.lang);
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
      title={t('canvas.levelFilterHint')}
      aria-pressed={!hidden}
      className={cn(
        'flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[10.5px] font-medium transition-all',
        hidden
          ? 'border-dashed border-stone-300/70 bg-transparent text-stone-400 opacity-55 dark:border-stone-600/70 dark:text-stone-500'
          : 'border-stone-400/70 bg-white/80 text-stone-700 shadow-sm hover:border-[#a3450f]/50 dark:border-stone-500/70 dark:bg-stone-800/80 dark:text-stone-200 dark:hover:border-amber-500/50'
      )}
    >
      <span
        className="h-2 w-2 rounded-full border border-stone-500/30"
        style={{ background: hidden ? 'transparent' : EVIDENCE_LEVEL_COLOR[level] }}
        aria-hidden="true"
      />
      {EVIDENCE_LEVEL_LABEL[level][lang]}
    </button>
  );
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

  // 搜索 + 类型/等级筛选（Task 17 / Task 20）：与 EvidenceBoard 共用 nodeMatchesSearch 命中真源
  const [search, setSearch] = useState('');
  const [hiddenKinds, setHiddenKinds] = useState<ReadonlySet<NodeKind>>(() => new Set());
  const [hiddenLevels, setHiddenLevels] = useState<ReadonlySet<EvidenceLevel>>(() => new Set());
  const q = search.trim();

  // 只为墙上实际存在的类型出 chip
  const presentKinds = useMemo(() => {
    const seen = new Set(nodes.map((n) => n.kind));
    return (Object.keys(NODE_KIND_LABEL) as NodeKind[]).filter((k) => seen.has(k));
  }, [nodes]);

  // 只为墙上 evidence 卡实际出现过的等级出 chip（Task 20）
  const presentLevels = useMemo(() => {
    const seen = new Set<EvidenceLevel>();
    for (const n of nodes) {
      if (n.kind === 'evidence' && n.level) seen.add(n.level);
    }
    return (Object.keys(EVIDENCE_LEVEL_LABEL) as EvidenceLevel[]).filter((l) => seen.has(l));
  }, [nodes]);

  const hits = useMemo(
    () => (q ? nodes.filter((n) => nodeMatchesSearch(n, q)).length : -1),
    [nodes, q]
  );

  function toggleKind(k: NodeKind) {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      // 不允许把所有类型都藏掉（画布不能清空）
      if (next.size >= presentKinds.length) return prev;
      return next;
    });
  }

  function toggleLevel(l: EvidenceLevel) {
    // 等级筛选允许全部隐藏（其他类型卡不受影响），无需 kind 那种守卫
    setHiddenLevels((prev) => {
      const next = new Set(prev);
      if (next.has(l)) next.delete(l);
      else next.add(l);
      return next;
    });
  }

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

      {/* 搜索 + 类型筛选（Task 17）：墙上有卡才出现 */}
      {nodes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-stone-300/50 bg-[#f7f4ee]/60 px-3 py-1.5 dark:border-stone-800/60 dark:bg-[#171411]/60">
          <div className="relative order-1 min-w-[150px] flex-1 basis-[180px] sm:max-w-[300px]">
            <Search
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('canvas.searchPh')}
              aria-label={t('canvas.searchPh')}
              className="h-7 w-full rounded-lg border border-stone-300 bg-white/70 pl-7 pr-3 text-[12px] text-stone-700 shadow-sm outline-none transition-colors placeholder:text-stone-400 focus:border-[#a3450f]/60 focus:ring-2 focus:ring-[#a3450f]/15 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-200 [&::-webkit-search-cancel-button]:hidden"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                title={t('canvas.searchClear')}
                aria-label={t('canvas.searchClear')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-600 dark:hover:bg-stone-700/70 dark:hover:text-stone-200"
              >
                <X size={11} />
              </button>
            )}
          </div>

          {q && (
            <span
              className={cn(
                'order-2 shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium tabular-nums',
                hits > 0
                  ? 'border-[#a3450f]/40 bg-[#fdf3d7]/80 text-[#8a380c] dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-stone-300 bg-stone-100/80 text-stone-500 dark:border-stone-600 dark:bg-stone-800/80 dark:text-stone-400'
              )}
            >
              {hits > 0
                ? fmt(t('canvas.searchHits'), { n: hits, m: nodes.length })
                : t('canvas.searchNoHit')}
            </span>
          )}

          <div className="order-3 flex flex-1 flex-wrap items-center gap-1 overflow-x-auto">
            <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wider text-stone-400 lg:inline">
              {t('canvas.filterLabel')}
            </span>
            {presentKinds.map((k) => (
              <KindChip
                key={k}
                kind={k}
                hidden={hiddenKinds.has(k)}
                onToggle={() => toggleKind(k)}
              />
            ))}
            {/* 证据等级第二组 chip（Task 20）：与类型 chip 同一行的后半段，竖线分隔 */}
            {presentLevels.length > 0 && (
              <>
                <span
                  className="mx-1 hidden h-4 w-px shrink-0 bg-stone-300/70 sm:block dark:bg-stone-600/70"
                  aria-hidden="true"
                />
                <span className="hidden shrink-0 text-[10px] font-semibold uppercase tracking-wider text-stone-400 lg:inline">
                  {t('canvas.levelLabel')}
                </span>
                {presentLevels.map((l) => (
                  <LevelChip
                    key={l}
                    level={l}
                    hidden={hiddenLevels.has(l)}
                    onToggle={() => toggleLevel(l)}
                  />
                ))}
              </>
            )}
            {(hiddenKinds.size > 0 || hiddenLevels.size > 0) && (
              <button
                type="button"
                onClick={() => {
                  setHiddenKinds(new Set());
                  setHiddenLevels(new Set());
                }}
                title={t('canvas.filterReset')}
                aria-label={t('canvas.filterReset')}
                className="flex h-6 shrink-0 items-center gap-1 rounded-full border border-[#a3450f]/40 bg-[#fdf3d7]/70 px-2 text-[10.5px] font-medium text-[#8a380c] transition-colors hover:bg-[#fdf3d7] dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/70"
              >
                <RotateCcw size={10} />
                <span className="hidden sm:inline">{t('canvas.filterReset')}</span>
              </button>
            )}
          </div>
        </div>
      )}

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
            search={search}
            hiddenKinds={hiddenKinds}
            hiddenLevels={hiddenLevels}
          />
        )}
      </div>

      <AddClueDialog />
      <NodeInspector />
    </div>
  );
}
