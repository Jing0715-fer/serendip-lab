'use client';

// top-bar.tsx — 顶栏：品牌 / 会话 / Agent 状态与控制 / 简报导出 / 明暗切换 / 语言切换
import { useState, useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  ChevronDown,
  Download,
  FilePlus2,
  FlaskConical,
  Languages,
  Loader2,
  Moon,
  Pause,
  Play,
  Plus,
  Settings2,
  Square,
  Sun,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogoMark } from './logo';
import { LlmSettingsDialog } from './llm-settings-dialog';
import { useStudio, isAgentWorking, fmtElapsed } from '@/store/studio';
import { EDGE_RELATION_LABEL, NODE_KIND_LABEL, PHASE_LABEL, fmt, localeOf, useI18n, useT } from '@/lib/i18n';
import type { AgentStatus } from '@/lib/types';

function statusTone(status: AgentStatus | undefined): string {
  switch (status) {
    case 'running':
    case 'thinking':
      return 'bg-emerald-100 text-emerald-900 border-emerald-300';
    case 'awaiting_user':
      return 'bg-amber-100 text-amber-900 border-amber-300';
    case 'paused':
    case 'interrupted':
      return 'bg-stone-200 text-stone-700 border-stone-400';
    case 'error':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'done':
      return 'bg-stone-100 text-stone-600 border-stone-300';
    default:
      return 'bg-stone-100 text-stone-700 border-stone-300';
  }
}

/** 语言切换：桌面为 中/EN 分段控件，移动端为单按钮点切 */
function LangToggle() {
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  return (
    <>
      <div
        className="hidden h-8 items-center rounded-lg border border-stone-300 bg-white/70 p-0.5 dark:border-stone-700 dark:bg-stone-900/60 sm:flex"
        role="group"
        aria-label={lang === 'zh' ? 'Switch language' : '切换语言'}
      >
        {(['zh', 'en'] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            className={
              'flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold transition-colors ' +
              (lang === l
                ? 'bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-amber-50 shadow-sm'
                : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200')
            }
          >
            {l === 'zh' ? '中' : 'EN'}
            {l === 'zh' ? null : <Languages size={10} className="opacity-70" />}
          </button>
        ))}
      </div>
      <Button
        size="icon"
        variant="outline"
        className="h-8 w-8 border-stone-300 gap-0 px-0 sm:hidden"
        onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
        title={lang === 'zh' ? 'Switch to English' : '切换到中文'}
        aria-label={lang === 'zh' ? 'Switch to English' : '切换到中文'}
      >
        <span className="text-[10.5px] font-bold tracking-tight">{lang === 'zh' ? 'EN' : '中'}</span>
      </Button>
    </>
  );
}

export function TopBar() {
  const session = useStudio((s) => s.session);
  const sessions = useStudio((s) => s.sessions);
  const stats = useStudio((s) => s.stats);
  const connected = useStudio((s) => s.connected);
  const createSession = useStudio((s) => s.createSession);
  const deleteSession = useStudio((s) => s.deleteSession);
  const loadSession = useStudio((s) => s.loadSession);
  const control = useStudio((s) => s.control);
  const setResearchDialog = useStudio((s) => s.setResearchDialog);
  const nodes = useStudio((s) => s.nodes);
  const narrative = useStudio((s) => s.narrative);
  const questions = useStudio((s) => s.questions);
  const { theme, setTheme } = useTheme();
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const [creating, setCreating] = useState(false);
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false);
  // next-themes：SSR 时 theme 为 undefined，挂载后才能按真实主题渲染图标（防水合不匹配）
  // useSyncExternalStore 的 server/client 快照差 = 无副作用的「已挂载」探针
  const themeMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const working = isAgentWorking(session?.status);
  const paused = session?.status === 'paused' || session?.status === 'interrupted';
  const awaiting = session?.status === 'awaiting_user';
  const canResearch = !!session && !working && !awaiting && session.status !== 'paused';

  const elapsed = stats?.elapsedMs ?? 0;

  function exportBrief() {
    if (!session) return;
    const lines: string[] = [];
    lines.push(fmt(t('export.docTitle'), { title: session.title }));
    lines.push('');
    lines.push(fmt(t('export.byline'), { time: new Date().toLocaleString(localeOf(lang), { hour12: false }) }));
    lines.push('');
    if (narrative.trim()) {
      lines.push(t('export.review'));
      lines.push('');
      lines.push(narrative);
      lines.push('');
    }
    if (questions.length) {
      lines.push(t('export.questions'));
      lines.push('');
      const sorted = [...questions].sort((a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        (b.scores.novelty + b.scores.feasibility + b.scores.impact) -
        (a.scores.novelty + a.scores.feasibility + a.scores.impact)
      );
      sorted.forEach((q, i) => {
        lines.push(`${i + 1}. ${q.text}${q.recommended ? ` ${t('export.recommended')}` : ''}`);
        lines.push(
          `   - ${fmt(t('export.scores'), { n: q.scores.novelty, f: q.scores.feasibility, i: q.scores.impact })}`
        );
        if (q.rationale) lines.push(`   - ${fmt(t('export.rationale'), { text: q.rationale })}`);
      });
      lines.push('');
    }
    if (nodes.length) {
      lines.push(t('export.wall'));
      lines.push('');
      for (const n of nodes) {
        const src = n.sourceRef ? `（${n.sourceRef}）` : n.sourceUrl ? `（${n.sourceUrl}）` : '';
        lines.push(`- **[${NODE_KIND_LABEL[n.kind][lang]}]** ${n.title} — ${n.content}${src}`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Serendip-${session.title.slice(0, 24)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('export.downloaded'));
  }

  return (
    <header className="z-30 flex items-center gap-2 border-b border-stone-300/70 bg-[#f7f4ee]/95 px-3 py-2 backdrop-blur dark:border-stone-800 dark:bg-[#171411]/95 sm:gap-3 sm:px-4">
      {/* 品牌 */}
      <div className="flex min-w-0 items-center gap-2.5">
        <LogoMark size={32} />
        <div className="min-w-0 leading-tight">
          <div className="font-display truncate text-[15px] font-bold tracking-tight text-stone-800 dark:text-stone-100">
            Serendip Lab
          </div>
          <div className="hidden max-w-[220px] truncate text-[10.5px] tracking-wide text-stone-500 dark:text-stone-400 sm:block">
            {t('brand.tagline')}
          </div>
        </div>
      </div>

      {/* 会话选择 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="ml-1 h-8 max-w-[38vw] gap-1.5 border-stone-300 bg-white/70 font-normal dark:border-stone-700 dark:bg-stone-900/60 sm:max-w-[220px]">
            <span className="truncate text-[13px]">{session?.title ?? t('session.newProject')}</span>
            <ChevronDown size={14} className="shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 border-stone-300 bg-[#fdfaf1] dark:border-stone-700 dark:bg-stone-900">
          <DropdownMenuLabel className="text-xs tracking-wider text-stone-500">{t('menu.projects')}</DropdownMenuLabel>
          {sessions.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onClick={() => void loadSession(s.id)}
              className="gap-2 text-[13px]"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.id === session?.id ? '#b45309' : 'transparent' }} />
              <span className="truncate">{s.title}</span>
              <span className="ml-auto shrink-0 text-[10px] text-stone-400">
                {fmt(t('menu.evidenceCount'), { n: s.counts.nodes })}
              </span>
            </DropdownMenuItem>
          ))}
          {sessions.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-stone-400">{t('menu.noProjects')}</div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setCreating(true);
              void createSession()
                .then(() => toast.success(t('toast.projectCreated')))
                .catch((e) => toast.error(fmt(t('toast.createFailed'), { msg: e.message })))
                .finally(() => setCreating(false));
            }}
            disabled={creating}
            className="gap-2 text-[13px]"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {t('menu.newProject')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setCreating(true);
              void createSession({ demo: true })
                .then(() => toast.success(t('toast.demoLoaded')))
                .catch((e) => toast.error(fmt(t('toast.loadFailed'), { msg: e.message })))
                .finally(() => setCreating(false));
            }}
            disabled={creating}
            className="gap-2 text-[13px]"
          >
            <FilePlus2 size={14} />
            {t('menu.loadDemo')}
          </DropdownMenuItem>
          {session && sessions.length > 0 && (
            <DropdownMenuItem
              onClick={() => {
                if (confirm(fmt(t('menu.confirmDelete'), { title: session.title }))) {
                  void deleteSession(session.id).then(() => toast.success(t('toast.deleted')));
                }
              }}
              className="gap-2 text-[13px] text-red-700 focus:text-red-700"
            >
              <Trash2 size={14} />
              {t('menu.delete')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {/* Agent 状态 */}
        {session && (
          <div className="mr-1 hidden items-center gap-2 md:flex">
            <Badge variant="outline" className={`gap-1.5 border text-[11px] ${statusTone(session.status)}`}>
              {working && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" />}
              {awaiting && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />}
              {session.phase === 'done' ? t('phase.done') : PHASE_LABEL[session.phase][lang]}
            </Badge>
            {stats && stats.maxSteps > 0 && (working || paused) && (
              <div className="flex items-center gap-1.5" title={fmt(t('steps.title'), { used: stats.stepsUsed, max: stats.maxSteps })}>
                <Progress value={(stats.stepsUsed / stats.maxSteps) * 100} className="h-1.5 w-16 bg-stone-200 dark:bg-stone-800" />
                <span className="text-[10.5px] tabular-nums text-stone-500">
                  {stats.stepsUsed}/{stats.maxSteps} · {fmtElapsed(elapsed)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* SSE 连接指示 */}
        <span
          title={connected ? t('sse.ok') : t('sse.down')}
          className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-emerald-500' : 'bg-stone-400 animate-pulse'}`}
        />

        {/* 研究控制 */}
        {canResearch && (
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[13px] font-medium text-amber-50 shadow-sm hover:from-[#8f3c0c] hover:to-[#752f09]"
            onClick={() => setResearchDialog(true)}
          >
            <FlaskConical size={14} />
            <span className="hidden sm:inline">{(stats?.round ?? 0) > 0 || session?.phase === 'done' ? t('research.continue') : t('research.start')}</span>
          </Button>
        )}
        {working && (
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1 border-stone-300 text-[13px]" onClick={() => void control('pause').catch((e) => toast.error(e.message))}>
              <Pause size={14} />
              <span className="hidden sm:inline">{t('control.pause')}</span>
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 border-stone-300 text-[13px] text-red-700" onClick={() => void control('stop').catch((e) => toast.error(e.message))}>
              <Square size={13} />
              <span className="hidden sm:inline">{t('control.stop')}</span>
            </Button>
          </>
        )}
        {paused && (
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1 border-stone-300 text-[13px]" onClick={() => void control('resume').catch((e) => toast.error(e.message))}>
              <Play size={14} />
              <span className="hidden sm:inline">{t('control.resume')}</span>
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 border-stone-300 text-[13px] text-red-700" onClick={() => void control('stop').catch((e) => toast.error(e.message))}>
              <Square size={13} />
              <span className="hidden sm:inline">{t('control.stop')}</span>
            </Button>
          </>
        )}

        {/* 简报导出 */}
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1 border-stone-300 text-[13px]"
          onClick={exportBrief}
          disabled={!session || (!narrative && nodes.length === 0)}
          title={t('export.title')}
        >
          <Download size={14} />
          <span className="hidden lg:inline">{t('export.brief')}</span>
        </Button>

        {/* 语言切换 */}
        <LangToggle />

        {/* LLM 设置 */}
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 border-stone-300"
          onClick={() => setLlmSettingsOpen(true)}
          title={t('settings.llmTitle')}
        >
          <Settings2 size={14} />
        </Button>

        {/* 明暗切换（mounted 守卫防 next-themes SSR 水合不匹配） */}
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 border-stone-300"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={t('theme.toggle')}
        >
          {themeMounted ? (theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />) : <Sun size={14} />}
        </Button>
      </div>

      <LlmSettingsDialog open={llmSettingsOpen} onOpenChange={setLlmSettingsOpen} />
    </header>
  );
}
