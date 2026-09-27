'use client';

// top-bar.tsx — 顶栏：品牌 / 会话 / Agent 状态与控制 / 简报导出 / 明暗切换
import { useState } from 'react';
import { useTheme } from 'next-themes';
import { toast } from 'sonner';
import {
  ChevronDown,
  Download,
  FilePlus2,
  FlaskConical,
  Loader2,
  Moon,
  Pause,
  Play,
  Plus,
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
import { useStudio, isAgentWorking, fmtElapsed } from '@/store/studio';
import { PHASE_LABEL } from '@/lib/types';
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
  const [creating, setCreating] = useState(false);

  const working = isAgentWorking(session?.status);
  const paused = session?.status === 'paused' || session?.status === 'interrupted';
  const awaiting = session?.status === 'awaiting_user';
  const canResearch = !!session && !working && !awaiting && session.status !== 'paused';

  const elapsed = stats?.elapsedMs ?? 0;

  function exportBrief() {
    if (!session) return;
    const lines: string[] = [];
    lines.push(`# ${session.title} · 调查简报`);
    lines.push('');
    lines.push(`> 由 Serendip Lab（生物科研灵感侦探）生成 · ${new Date().toLocaleString('zh-CN')}`);
    lines.push('');
    if (narrative.trim()) {
      lines.push('## 案情综述');
      lines.push('');
      lines.push(narrative);
      lines.push('');
    }
    if (questions.length) {
      lines.push('## 值得进一步研究的问题');
      lines.push('');
      const sorted = [...questions].sort((a, b) =>
        Number(b.recommended) - Number(a.recommended) ||
        (b.scores.novelty + b.scores.feasibility + b.scores.impact) -
        (a.scores.novelty + a.scores.feasibility + a.scores.impact)
      );
      sorted.forEach((q, i) => {
        lines.push(
          `${i + 1}. ${q.text}${q.recommended ? ' ⭐ 推荐深挖' : ''}`
        );
        lines.push(
          `   - 新颖性 ${q.scores.novelty}/5 · 可行性 ${q.scores.feasibility}/5 · 影响力 ${q.scores.impact}/5`
        );
        if (q.rationale) lines.push(`   - 理由：${q.rationale}`);
      });
      lines.push('');
    }
    if (nodes.length) {
      lines.push('## 证据墙档案');
      lines.push('');
      for (const n of nodes) {
        const src = n.sourceRef ? `（${n.sourceRef}）` : n.sourceUrl ? `（${n.sourceUrl}）` : '';
        lines.push(`- **[${n.kind}]** ${n.title} — ${n.content}${src}`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Serendip简报-${session.title.slice(0, 24)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('简报已下载');
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
          <div className="hidden text-[10.5px] tracking-wide text-stone-500 dark:text-stone-400 sm:block">
            生物科研灵感侦探 · EVIDENCE WALL
          </div>
        </div>
      </div>

      {/* 会话选择 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="ml-1 h-8 max-w-[38vw] gap-1.5 border-stone-300 bg-white/70 font-normal dark:border-stone-700 dark:bg-stone-900/60 sm:max-w-[220px]">
            <span className="truncate text-[13px]">{session?.title ?? '新调查'}</span>
            <ChevronDown size={14} className="shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 border-stone-300 bg-[#fdfaf1] dark:border-stone-700 dark:bg-stone-900">
          <DropdownMenuLabel className="text-xs tracking-wider text-stone-500">案件档案</DropdownMenuLabel>
          {sessions.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onClick={() => void loadSession(s.id)}
              className="gap-2 text-[13px]"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: s.id === session?.id ? '#b45309' : 'transparent' }} />
              <span className="truncate">{s.title}</span>
              <span className="ml-auto shrink-0 text-[10px] text-stone-400">
                {s.counts.nodes} 证据
              </span>
            </DropdownMenuItem>
          ))}
          {sessions.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-stone-400">暂无档案</div>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setCreating(true);
              void createSession()
                .then(() => toast.success('新调查已创建'))
                .catch((e) => toast.error(`创建失败：${e.message}`))
                .finally(() => setCreating(false));
            }}
            disabled={creating}
            className="gap-2 text-[13px]"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            新建调查
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setCreating(true);
              void createSession({ demo: true })
                .then(() => toast.success('示例案件已载入'))
                .catch((e) => toast.error(`载入失败：${e.message}`))
                .finally(() => setCreating(false));
            }}
            disabled={creating}
            className="gap-2 text-[13px]"
          >
            <FilePlus2 size={14} />
            载入示例案件（线粒体之谜）
          </DropdownMenuItem>
          {session && sessions.length > 0 && (
            <DropdownMenuItem
              onClick={() => {
                if (confirm(`确认删除「${session.title}」？此操作不可撤销。`)) {
                  void deleteSession(session.id).then(() => toast.success('已删除'));
                }
              }}
              className="gap-2 text-[13px] text-red-700 focus:text-red-700"
            >
              <Trash2 size={14} />
              删除当前案件
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
              {session.phase === 'done' ? '已结案' : PHASE_LABEL[session.phase]}
            </Badge>
            {stats && stats.maxSteps > 0 && (working || paused) && (
              <div className="flex items-center gap-1.5" title={`步骤 ${stats.stepsUsed}/${stats.maxSteps}`}>
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
          title={connected ? '实时连接正常' : '实时连接断开，正在重连…'}
          className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-emerald-500' : 'bg-stone-400 animate-pulse'}`}
        />

        {/* 调查控制 */}
        {canResearch && (
          <Button
            size="sm"
            className="h-8 gap-1.5 bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[13px] font-medium text-amber-50 shadow-sm hover:from-[#8f3c0c] hover:to-[#752f09]"
            onClick={() => setResearchDialog(true)}
          >
            <FlaskConical size={14} />
            <span className="hidden sm:inline">{(stats?.round ?? 0) > 0 || session?.phase === 'done' ? '继续调查' : '开始调查'}</span>
          </Button>
        )}
        {working && (
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1 border-stone-300 text-[13px]" onClick={() => void control('pause').catch((e) => toast.error(e.message))}>
              <Pause size={14} />
              <span className="hidden sm:inline">暂停</span>
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 border-stone-300 text-[13px] text-red-700" onClick={() => void control('stop').catch((e) => toast.error(e.message))}>
              <Square size={13} />
              <span className="hidden sm:inline">终止</span>
            </Button>
          </>
        )}
        {paused && (
          <>
            <Button size="sm" variant="outline" className="h-8 gap-1 border-stone-300 text-[13px]" onClick={() => void control('resume').catch((e) => toast.error(e.message))}>
              <Play size={14} />
              <span className="hidden sm:inline">继续</span>
            </Button>
            <Button size="sm" variant="outline" className="h-8 gap-1 border-stone-300 text-[13px] text-red-700" onClick={() => void control('stop').catch((e) => toast.error(e.message))}>
              <Square size={13} />
              <span className="hidden sm:inline">终止</span>
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
          title="导出 Markdown 调查简报"
        >
          <Download size={14} />
          <span className="hidden lg:inline">简报</span>
        </Button>

        {/* 明暗切换 */}
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 border-stone-300"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="切换明暗模式"
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </Button>
      </div>
    </header>
  );
}
