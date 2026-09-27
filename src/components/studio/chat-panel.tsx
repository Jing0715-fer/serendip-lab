'use client';

// chat-panel.tsx — 左侧对谈面板：苏格拉底访谈 + 调查直播 + steering 输入
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BrainCircuit,
  ChevronRight,
  FlaskConical,
  Loader2,
  Pin,
  Search,
  SendHorizontal,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useStudio, isAgentWorking, fmtTime } from '@/store/studio';
import type { ChatMessage } from '@/lib/types';

const SAMPLE_TOPICS = [
  '为什么线粒体保留了自己的基因组？',
  '肠道菌群如何影响神经退行性疾病？',
  '衰老细胞为何能逃避免疫清除？',
  '肿瘤细胞代谢重编程的可逆性如何？',
];

function MessageItem({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'system') {
    return (
      <div className="my-1 flex justify-center px-6">
        <span className="rounded-full border border-stone-300/70 bg-stone-100/80 px-3 py-1 text-[11px] leading-relaxed text-stone-500 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-400">
          {msg.content}
        </span>
      </div>
    );
  }

  const isUser = msg.role === 'user';
  const isQuestion = msg.kind === 'question';
  const isSynthesis = msg.kind === 'synthesis';
  const isSteer = msg.kind === 'steer';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn('flex w-full gap-2.5', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser && (
        <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-amber-800/30 bg-gradient-to-b from-[#f3e2c0] to-[#e4cd9e] text-[13px] shadow-sm dark:border-amber-700/40">
          🔍
        </div>
      )}
      <div
        className={cn(
          'max-w-[86%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm',
          isUser
            ? 'rounded-br-sm border border-[#7c3a12]/30 bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-amber-50'
            : isQuestion
              ? 'rounded-bl-sm border border-amber-400/70 bg-[#fdf3d7] text-stone-800 dark:bg-amber-950/40 dark:text-amber-100'
              : isSynthesis
                ? 'rounded-bl-sm border border-emerald-600/40 bg-[#eef6ee] text-stone-800 dark:bg-emerald-950/30 dark:text-emerald-50'
                : 'rounded-bl-sm border border-stone-300/80 bg-[#fdfaf1] text-stone-800 dark:border-stone-700 dark:bg-stone-800/80 dark:text-stone-100'
        )}
      >
        {isQuestion && (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold tracking-wide text-amber-700 dark:text-amber-400">
            <Sparkles size={11} /> 侦探需要你的线索
          </div>
        )}
        {isSynthesis && (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold tracking-wide text-emerald-700 dark:text-emerald-400">
            <BrainCircuit size={11} /> 结案汇报
          </div>
        )}
        {isSteer && (
          <div className="mb-0.5 text-[10.5px] font-medium tracking-wide text-amber-200/90">线索补充 · Agent 将在检查点纳入</div>
        )}
        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
        <div className={cn('mt-1 text-right text-[10px] tabular-nums', isUser ? 'text-amber-100/60' : 'text-stone-400')}>
          {fmtTime(msg.createdAt)}
        </div>
      </div>
    </motion.div>
  );
}

function LiveInvestigation() {
  const session = useStudio((s) => s.session);
  const toolRunning = useStudio((s) => s.toolRunning);
  const lastThought = useStudio((s) => s.lastThought);
  const stats = useStudio((s) => s.stats);
  const setWorkspaceTab = useStudio((s) => s.setWorkspaceTab);
  const setMobileView = useStudio((s) => s.setMobileView);

  return (
    <div className="mx-2 mb-2 overflow-hidden rounded-xl border border-stone-300/80 bg-white/70 shadow-sm dark:border-stone-700 dark:bg-stone-800/60">
      <div className="flex items-center gap-2 border-b border-stone-200/80 px-3 py-1.5 dark:border-stone-700/60">
        <Loader2 size={12} className="animate-spin text-emerald-700 dark:text-emerald-400" />
        <span className="text-[11px] font-semibold tracking-wider text-stone-600 dark:text-stone-300">
          侦探工作中
        </span>
        {stats && (
          <span className="ml-auto text-[10px] tabular-nums text-stone-400">
            {stats.stepsUsed}/{stats.maxSteps} 步
          </span>
        )}
        <button
          className="ml-1 flex items-center gap-0.5 text-[10.5px] text-stone-500 underline-offset-2 hover:underline dark:text-stone-400"
          onClick={() => {
            setWorkspaceTab('activity');
            setMobileView('workspace');
          }}
        >
          全程记录 <ChevronRight size={10} />
        </button>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        {lastThought && (
          <div className="flex gap-1.5 text-[12px] leading-snug text-stone-600 dark:text-stone-300">
            <BrainCircuit size={13} className="mt-0.5 shrink-0 text-stone-400" />
            <p className="line-clamp-3">{lastThought.text}</p>
          </div>
        )}
        {toolRunning && (
          <div className="flex items-center gap-1.5 text-[12px] text-stone-600 dark:text-stone-300">
            <Wrench size={12} className="shrink-0 text-amber-700 dark:text-amber-500" />
            <Badge variant="outline" className="h-5 rounded-sm border-stone-300 px-1.5 font-mono text-[10px] text-stone-600 dark:border-stone-600 dark:text-stone-300">
              {toolRunning.tool}
            </Badge>
            <span className="truncate text-[11px] text-stone-400">
              {typeof toolRunning.args?.query === 'string'
                ? toolRunning.args.query
                : typeof toolRunning.args?.term === 'string'
                  ? toolRunning.args.term
                  : typeof toolRunning.args?.title === 'string'
                    ? toolRunning.args.title
                    : ''}
            </span>
            <Loader2 size={11} className="ml-auto shrink-0 animate-spin text-stone-400" />
          </div>
        )}
        {!toolRunning && !lastThought && (
          <div className="flex items-center gap-1.5 text-[12px] text-stone-400">
            <Search size={12} /> 正在部署下一步行动…
          </div>
        )}
        {session?.status === 'awaiting_user' && null}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const session = useStudio((s) => s.session);
  const messages = useStudio((s) => s.messages);
  const interviewBusy = useStudio((s) => s.interviewBusy);
  const sendChat = useStudio((s) => s.sendChat);
  const setResearchDialog = useStudio((s) => s.setResearchDialog);
  const connected = useStudio((s) => s.connected);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const working = isAgentWorking(session?.status);
  const awaiting = session?.status === 'awaiting_user';
  const investigating = session && ['planning', 'investigating', 'synthesizing'].includes(session.phase);
  const ready = session?.ready ?? false;
  const showResearchCTA = ready && !working && !awaiting && session && (session.phase === 'interview' || session.phase === 'done' || session.phase === 'idle');
  const empty = messages.filter((m) => m.role !== 'system').length === 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, interviewBusy]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function send() {
    const text = draft.trim();
    if (!text || interviewBusy) return;
    setDraft('');
    stickToBottom.current = true;
    try {
      await sendChat(text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '发送失败');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f7f4ee] dark:bg-[#171411]">
      {/* 面板头 */}
      <div className="flex items-center gap-2 border-b border-stone-300/70 px-4 py-2.5 dark:border-stone-800">
        <span className="font-display text-[14px] font-bold tracking-tight text-stone-800 dark:text-stone-100">对谈室</span>
        <span className="text-[10px] tracking-[0.18em] text-stone-400">SOCRATIC ROOM</span>
        {!connected && (
          <span className="ml-auto rounded-full bg-stone-200 px-2 py-0.5 text-[10px] text-stone-500 dark:bg-stone-800">
            离线重连中
          </span>
        )}
      </div>

      {/* 消息流 */}
      <div ref={scrollRef} onScroll={onScroll} className="studio-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-2 py-3 sm:px-3">
        {empty && !working && (
          <div className="px-2 pt-4 pb-2 sm:pt-8">
            <div className="mb-4 rounded-2xl border border-stone-300/70 bg-[#fdfaf1] p-4 shadow-sm dark:border-stone-700 dark:bg-stone-800/70">
              <div className="font-display mb-1 text-[15px] font-bold text-stone-800 dark:text-stone-100">
                你好，我是 Serendip 🔍
              </div>
              <p className="text-[12.5px] leading-relaxed text-stone-600 dark:text-stone-300">
                一位生物科研灵感侦探。告诉我最近让你好奇的现象——哪怕只是一团模糊的直觉。我会通过追问帮你把它磨成值得研究的科学问题，然后自主检索文献与数据库，把证据钉上右边的证据墙。
              </p>
            </div>
            <div className="mb-2 px-1 text-[11px] font-medium tracking-wider text-stone-400">从这些谜题开始，或直接说出你的好奇心：</div>
            <div className="grid gap-2">
              {SAMPLE_TOPICS.map((t) => (
                <button
                  key={t}
                  onClick={() => void sendChat(t).catch((e) => toast.error(e.message))}
                  className="group flex items-center gap-2 rounded-xl border border-stone-300/70 bg-white/60 px-3 py-2.5 text-left text-[12.5px] text-stone-700 shadow-sm transition-all hover:border-amber-700/40 hover:bg-[#fdf3d7] dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-200 dark:hover:border-amber-600/40 dark:hover:bg-amber-950/30"
                >
                  <Sparkles size={13} className="shrink-0 text-amber-700 dark:text-amber-500" />
                  <span className="flex-1">{t}</span>
                  <ArrowRight size={13} className="shrink-0 text-stone-300 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-700 dark:text-stone-600" />
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageItem key={m.id} msg={m} />
        ))}

        {interviewBusy && !working && (
          <div className="flex items-center gap-2.5 px-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-800/30 bg-gradient-to-b from-[#f3e2c0] to-[#e4cd9e] text-[13px]">
              🔍
            </div>
            <div className="flex items-center gap-1.5 rounded-xl rounded-bl-sm border border-stone-300/80 bg-[#fdfaf1] px-3.5 py-2.5 shadow-sm dark:border-stone-700 dark:bg-stone-800/80">
              <span className="dot-flash" />
              <span className="dot-flash [animation-delay:150ms]" />
              <span className="dot-flash [animation-delay:300ms]" />
              <span className="ml-1 text-[11px] text-stone-400">Serendip 正在思考…</span>
            </div>
          </div>
        )}

        {(working || investigating) && <LiveInvestigation />}
      </div>

      {/* 进入调查 CTA */}
      <AnimatePresence>
        {showResearchCTA && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="mx-3 mb-2"
          >
            <button
              onClick={() => setResearchDialog(true)}
              className="group flex w-full items-center gap-2.5 rounded-xl border border-amber-700/40 bg-gradient-to-b from-[#fdf3d7] to-[#f7e5b5] px-4 py-3 text-left shadow-sm transition-all hover:shadow-md dark:border-amber-600/40 dark:from-amber-950/50 dark:to-amber-900/40"
            >
              <FlaskConical size={17} className="shrink-0 text-amber-800 dark:text-amber-400" />
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-stone-800 dark:text-amber-100">
                  {session?.phase === 'done' || (useStudio.getState().stats?.round ?? 0) > 0 ? '继续自主调查' : '进入自主调查'}
                </div>
                <div className="text-[11px] text-stone-500 dark:text-amber-200/70">
                  侦探将检索 PubMed / OpenAlex / UniProt 等数据库，把证据钉上证据墙
                </div>
              </div>
              <ArrowRight size={15} className="shrink-0 text-amber-800 transition-transform group-hover:translate-x-1 dark:text-amber-400" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 输入区 */}
      <div className="border-t border-stone-300/70 px-3 py-2.5 dark:border-stone-800">
        {awaiting && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            <Pin size={11} className="rotate-45" /> 侦探在等你的回答——你的回复将直接推进调查
          </div>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              investigating
                ? '可随时补充线索或纠正方向，Agent 将在检查点纳入…'
                : awaiting
                  ? '回答侦探的问题…'
                  : '说说让你好奇的生物现象…（Enter 发送）'
            }
            disabled={interviewBusy}
            rows={2}
            className={cn(
              'studio-scroll min-h-[44px] resize-none rounded-xl border-stone-300 bg-[#fdfaf1] text-[13px] leading-relaxed shadow-inner placeholder:text-stone-400 focus-visible:ring-amber-700/30 dark:border-stone-700 dark:bg-stone-800/70',
              awaiting && 'border-amber-500/60 bg-[#fdf3d7] dark:bg-amber-950/30'
            )}
          />
          <Button
            size="icon"
            onClick={() => void send()}
            disabled={!draft.trim() || interviewBusy}
            className="h-[44px] w-[44px] shrink-0 rounded-xl bg-gradient-to-b from-[#a3450f] to-[#8a380c] shadow-sm hover:from-[#8f3c0c]"
            aria-label="发送"
          >
            {interviewBusy ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
