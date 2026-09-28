'use client';

// studio.tsx — 工作台编排器：布局骨架 + 会话引导 + SSE 订阅 + 移动端底部导航
import { useEffect } from 'react';
import { toast } from 'sonner';
import { Compass, MessagesSquare, Network, ScrollText, Search } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';
import { useAgentStream } from '@/hooks/use-agent-stream';
import { TopBar } from './top-bar';
import { ChatPanel } from './chat-panel';
import { Workspace } from './workspace';
import { ResearchDialog } from './research-dialog';

function BootSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-[#f7f4ee] dark:bg-[#171411]">
      <div className="flex items-center gap-3 border-b border-stone-300/70 px-4 py-2.5 dark:border-stone-800">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="ml-auto h-8 w-40" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[400px] space-y-3 border-r border-stone-300/70 p-4 dark:border-stone-800 lg:block">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-12 w-2/3 rounded-xl" />
        </div>
        <div className="flex-1 p-4">
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

const MOBILE_TABS = [
  { key: 'chat', label: '对谈', icon: MessagesSquare },
  { key: 'canvas', label: '证据墙', icon: Network },
  { key: 'narrative', label: '综述', icon: ScrollText },
  { key: 'directions', label: '深研', icon: Compass },
  { key: 'questions', label: '问题', icon: Search },
] as const;

export function Studio() {
  const init = useStudio((s) => s.init);
  const bootstrapping = useStudio((s) => s.bootstrapping);
  const loadingSession = useStudio((s) => s.loadingSession);
  const session = useStudio((s) => s.session);
  const mobileView = useStudio((s) => s.mobileView);
  const setMobileView = useStudio((s) => s.setMobileView);
  const workspaceTab = useStudio((s) => s.workspaceTab);
  const setWorkspaceTab = useStudio((s) => s.setWorkspaceTab);

  useAgentStream();

  useEffect(() => {
    void init().catch((e) => {
      toast.error(`初始化失败：${e instanceof Error ? e.message : String(e)}（请确认 agent-service 正在运行）`);
    });
  }, []);

  if (bootstrapping && !session) return <BootSkeleton />;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#f7f4ee] text-stone-900 dark:bg-[#171411] dark:text-stone-100">
      <TopBar />

      {/* 桌面双栏 */}
      <main className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'w-full shrink-0 border-r border-stone-300/70 dark:border-stone-800 lg:w-[404px]',
            mobileView === 'chat' ? 'block' : 'hidden lg:block'
          )}
        >
          {loadingSession && !session ? <BootSkeleton /> : <ChatPanel />}
        </aside>
        <section
          className={cn(
            'min-w-0 flex-1',
            mobileView === 'workspace' ? 'block' : 'hidden lg:block'
          )}
        >
          <Workspace />
        </section>
      </main>

      {/* 移动端底部导航 */}
      <nav className="z-30 flex items-stretch border-t border-stone-300/70 bg-[#f7f4ee]/95 backdrop-blur dark:border-stone-800 dark:bg-[#171411]/95 lg:hidden">
        {MOBILE_TABS.map((t) => {
          const active =
            t.key === 'chat'
              ? mobileView === 'chat'
              : mobileView === 'workspace' && workspaceTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => {
                if (t.key === 'chat') setMobileView('chat');
                else {
                  setMobileView('workspace');
                  if (t.key !== 'canvas' || workspaceTab !== 'canvas') {
                    setWorkspaceTab(t.key as 'canvas' | 'narrative' | 'questions' | 'activity' | 'directions');
                  }
                }
              }}
              className={cn(
                'flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium transition-colors',
                active ? 'text-[#a3450f] dark:text-amber-500' : 'text-stone-400'
              )}
            >
              <t.icon size={19} />
              {t.label}
              {active && <span className="h-0.5 w-6 rounded-full bg-[#a3450f] dark:bg-amber-500" />}
            </button>
          );
        })}
      </nav>

      {/* 页脚（固定底部） */}
      <footer className="z-20 flex items-center gap-2 border-t border-stone-300/70 bg-[#f2eee5] px-4 py-1.5 text-[10.5px] text-stone-500 dark:border-stone-800 dark:bg-[#141110] dark:text-stone-400">
        <span className="font-display font-semibold tracking-tight">Serendip Lab</span>
        <span className="hidden sm:inline">· 生物科研灵感侦探</span>
        <span className="ml-auto hidden items-center gap-3 md:flex">
          <span>证据墙数据来自 PubMed / Europe PMC / OpenAlex / UniProt / NCBI / PDB</span>
        </span>
        <span className="ml-auto md:ml-3">AI 生成内容仅供研究启发，请以原始文献为准</span>
      </footer>

      <ResearchDialog />
      <Toaster position="top-center" richColors />
    </div>
  );
}
