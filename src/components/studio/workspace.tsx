'use client';

// workspace.tsx — 右侧工作区：证据墙 / 研究综述 / 问题清单 / 深研方向 / 活动日志（Task 13 双语）
import { Activity, Compass, FileSearch, Map, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';
import { useI18n, useT } from '@/lib/i18n';
import { CanvasTab } from './canvas-tab';
import { NarrativeTab } from './narrative-tab';
import { QuestionsTab } from './questions-tab';
import { DirectionsTab } from './directions-tab';
import { ActivityTab } from './activity-tab';

const TAB_KEYS = ['canvas', 'narrative', 'questions', 'directions', 'activity'] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_META: Record<TabKey, { icon: typeof Map; tKey: 'tab.canvas' | 'tab.narrative' | 'tab.questions' | 'tab.directions' | 'tab.activity' }> = {
  canvas: { icon: Map, tKey: 'tab.canvas' },
  narrative: { icon: ScrollText, tKey: 'tab.narrative' },
  questions: { icon: FileSearch, tKey: 'tab.questions' },
  directions: { icon: Compass, tKey: 'tab.directions' },
  activity: { icon: Activity, tKey: 'tab.activity' },
};

export function Workspace() {
  const tab = useStudio((s) => s.workspaceTab);
  const setTab = useStudio((s) => s.setWorkspaceTab);
  const liveCount = useStudio((s) => s.liveIds.length);
  const t = useT();
  useI18n((s) => s.lang); // 订阅语言变化以刷新标签文案

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#efeae0] dark:bg-[#131110]">
      {/* 标签栏 */}
      <div className="flex items-center gap-1 border-b border-stone-300/70 bg-[#f7f4ee]/90 px-2 py-1.5 dark:border-stone-800 dark:bg-[#171411]/90">
        {TAB_KEYS.map((key) => {
          const active = tab === key;
          const { icon: Icon, tKey } = TAB_META[key];
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                active
                  ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-800 dark:text-stone-100'
                  : 'text-stone-500 hover:bg-white/60 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-800/50 dark:hover:text-stone-200'
              )}
            >
              <Icon size={13} />
              {t(tKey)}
              {key === 'canvas' && liveCount > 0 && (
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
        {tab === 'directions' && <DirectionsTab />}
        {tab === 'activity' && <ActivityTab />}
      </div>
    </div>
  );
}
