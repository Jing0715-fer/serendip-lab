'use client';

// workspace.tsx — 右侧工作区：证据墙 / 案情综述 / 问题清单 / 活动日志
import { Activity, FileSearch, Map, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';
import { CanvasTab } from './canvas-tab';
import { NarrativeTab } from './narrative-tab';
import { QuestionsTab } from './questions-tab';
import { ActivityTab } from './activity-tab';

const TABS = [
  { key: 'canvas', label: '证据墙', en: 'EVIDENCE WALL', icon: Map },
  { key: 'narrative', label: '案情综述', en: 'CASE BRIEF', icon: ScrollText },
  { key: 'questions', label: '问题清单', en: 'QUESTIONS', icon: FileSearch },
  { key: 'activity', label: '活动日志', en: 'ACTIVITY', icon: Activity },
] as const;

export function Workspace() {
  const tab = useStudio((s) => s.workspaceTab);
  const setTab = useStudio((s) => s.setWorkspaceTab);
  const liveCount = useStudio((s) => s.liveIds.length);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#efeae0] dark:bg-[#131110]">
      {/* 标签栏 */}
      <div className="flex items-center gap-1 border-b border-stone-300/70 bg-[#f7f4ee]/90 px-2 py-1.5 dark:border-stone-800 dark:bg-[#171411]/90">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                active
                  ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-800 dark:text-stone-100'
                  : 'text-stone-500 hover:bg-white/60 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-200'
              )}
            >
              <t.icon size={13} />
              {t.label}
              {t.key === 'canvas' && liveCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-ping rounded-full bg-red-600" />
              )}
              {active && (
                <span className="absolute -bottom-[7px] left-1/2 h-[2.5px] w-8 -translate-x-1/2 rounded-full bg-[#a3450f]" />
              )}
            </button>
          );
        })}
      </div>

      {/* 内容区 */}
      <div className="relative min-h-0 flex-1">
        <div className={cn('absolute inset-0', tab === 'canvas' ? 'block' : 'hidden')}>
          <CanvasTab />
        </div>
        {tab === 'narrative' && <NarrativeTab />}
        {tab === 'questions' && <QuestionsTab />}
        {tab === 'activity' && <ActivityTab />}
      </div>
    </div>
  );
}
