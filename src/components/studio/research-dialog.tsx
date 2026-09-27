'use client';

// research-dialog.tsx — 启动自主调查：聚焦点 + 预算设置
import { useState } from 'react';
import { toast } from 'sonner';
import { FlaskConical, Loader2, Timer, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';

const STEP_OPTIONS = [
  { value: 24, label: '快速摸底', hint: '约 24 步 · 5 分钟' },
  { value: 40, label: '标准调查', hint: '约 40 步 · 15 分钟' },
  { value: 80, label: '深挖模式', hint: '约 80 步 · 30 分钟' },
];

export function ResearchDialog() {
  const open = useStudio((s) => s.researchDialogOpen);
  const setOpen = useStudio((s) => s.setResearchDialog);
  const startResearch = useStudio((s) => s.startResearch);
  const narrative = useStudio((s) => s.narrative);
  const nodes = useStudio((s) => s.nodes);
  const [focus, setFocus] = useState('');
  const [steps, setSteps] = useState(40);
  const [minutes, setMinutes] = useState(15);
  const [busy, setBusy] = useState(false);

  const continuing = nodes.length > 0 || narrative.length > 0;

  async function launch() {
    setBusy(true);
    try {
      await startResearch({
        focus: focus.trim() || undefined,
        maxSteps: steps,
        maxMinutes: minutes,
      });
      toast.success(continuing ? '新一轮调查已启动，侦探正在部署…' : '调查已启动，侦探正在部署…');
      setFocus('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '启动失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => setOpen(v)}>
      <DialogContent className="max-w-[480px] border-stone-300 bg-[#f7f4ee] dark:border-stone-700 dark:bg-[#171411]">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-[15px] text-stone-800 dark:text-stone-100">
            <FlaskConical size={15} className="text-[#a3450f]" />
            {continuing ? '继续自主调查' : '启动自主调查'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {continuing && (
            <p className="rounded-xl border border-amber-700/30 bg-[#fdf3d7] px-3 py-2.5 text-[12px] leading-relaxed text-amber-900 dark:border-amber-600/30 dark:bg-amber-950/40 dark:text-amber-200">
              侦探将基于当前证据墙（{nodes.length} 张卡片）与既有结论继续排查，而不是从头再来。
            </p>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
              <Zap size={12} className="text-amber-700" /> 本轮聚焦点（可选）
            </div>
            <Textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="留给侦探的指示，如：重点验证 H1 假说 / 检索近三年 CRISPR 脱靶研究 / 我的实验室有帕金森患者宏基因组数据可接入…"
              rows={3}
              className="studio-scroll min-h-[64px] border-stone-300 bg-white/70 text-[13px] dark:border-stone-700 dark:bg-stone-800/70"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
              <Timer size={12} className="text-amber-700" /> 调查预算
            </div>
            <div className="grid grid-cols-3 gap-2">
              {STEP_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => {
                    setSteps(o.value);
                    setMinutes(o.value === 24 ? 5 : o.value === 40 ? 15 : 30);
                  }}
                  className={cn(
                    'rounded-xl border px-2 py-2 text-center transition-all',
                    steps === o.value
                      ? 'border-[#a3450f] bg-[#fdf3d7] shadow-sm dark:border-amber-600 dark:bg-amber-950/40'
                      : 'border-stone-300 bg-white/60 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500'
                  )}
                >
                  <div className={cn('text-[12.5px] font-semibold', steps === o.value ? 'text-[#8a380c] dark:text-amber-300' : 'text-stone-700 dark:text-stone-200')}>
                    {o.label}
                  </div>
                  <div className="text-[10.5px] text-stone-400">{o.hint}</div>
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-stone-400">
              调查期间你可随时补充线索（steering）或暂停；侦探遇到只有你知道的关键信息时会主动提问。
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} className="border-stone-300 text-[13px]">
            取消
          </Button>
          <Button
            onClick={() => void launch()}
            disabled={busy}
            className="bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[13px] text-amber-50 hover:from-[#8f3c0c]"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={13} />}
            派出侦探
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
