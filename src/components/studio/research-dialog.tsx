'use client';

// research-dialog.tsx — 启动自主研究：聚焦点 + 预算设置（Task 13 双语）
// Task 20：探索反馈续研飞轮 —— store.researchPreset 非空时预填聚焦点（琥珀提示条说明来源），
// 预填只消费一次（立即置回 null，用户后续输入不会被覆盖）；launch 成功后同样清空。
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FlaskConical, Loader2, Timer, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useStudio } from '@/store/studio';
import { fmt, useI18n, useT } from '@/lib/i18n';

const STEP_OPTIONS: { value: number; label: { zh: string; en: string }; hint: { zh: string; en: string } }[] = [
  { value: 24, label: { zh: '快速摸底', en: 'Quick scan' }, hint: { zh: '约 24 步 · 5 分钟', en: '~24 steps · 5 min' } },
  { value: 48, label: { zh: '标准调研', en: 'Standard' }, hint: { zh: '约 48 步 · 20 分钟', en: '~48 steps · 20 min' } },
  { value: 80, label: { zh: '深度调研', en: 'Deep dive' }, hint: { zh: '约 80 步 · 30 分钟', en: '~80 steps · 30 min' } },
];

export function ResearchDialog() {
  const open = useStudio((s) => s.researchDialogOpen);
  const setOpen = useStudio((s) => s.setResearchDialog);
  const startResearch = useStudio((s) => s.startResearch);
  const narrative = useStudio((s) => s.narrative);
  const nodes = useStudio((s) => s.nodes);
  const researchPreset = useStudio((s) => s.researchPreset);
  const setResearchPreset = useStudio((s) => s.setResearchPreset);
  const [focus, setFocus] = useState('');
  const [steps, setSteps] = useState(48);
  const [minutes, setMinutes] = useState(20);
  const [busy, setBusy] = useState(false);
  const [presetApplied, setPresetApplied] = useState(false);
  const t = useT();
  const lang = useI18n((s) => s.lang);

  const continuing = nodes.length > 0 || narrative.length > 0;

  // 预填探索反馈聚焦点（Task 20）：仅当 researchPreset 非空时写入输入框，随即消费置 null，
  // 避免用户已输入的内容被后续 preset 变化覆盖（setResearchPreset 为 zustand 稳定引用）。
  useEffect(() => {
    if (open && researchPreset) {
      setFocus(researchPreset);
      setPresetApplied(true);
      setResearchPreset(null);
    }
  }, [open, researchPreset, setResearchPreset]);

  async function launch() {
    setBusy(true);
    try {
      await startResearch({
        focus: focus.trim() || undefined,
        maxSteps: steps,
        maxMinutes: minutes,
      });
      toast.success(continuing ? t('rd.continued') : t('rd.started'));
      setFocus('');
      setPresetApplied(false);
      setResearchPreset(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('rd.failed'));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setOpen(false);
    setPresetApplied(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setOpen(true);
        else close();
      }}
    >
      <DialogContent className="max-w-[480px] border-stone-300 bg-[#f7f4ee] dark:border-stone-700 dark:bg-[#171411]">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-[15px] text-stone-800 dark:text-stone-100">
            <FlaskConical size={15} className="text-[#a3450f]" />
            {continuing ? t('rd.continue') : t('rd.start')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {continuing && (
            <p className="rounded-xl border border-amber-700/30 bg-[#fdf3d7] px-3 py-2.5 text-[12px] leading-relaxed text-amber-900 dark:border-amber-600/30 dark:bg-amber-950/40 dark:text-amber-200">
              {fmt(t('rd.continuingNote'), { n: nodes.length })}
            </p>
          )}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
              <Zap size={12} className="text-amber-700" /> {t('rd.focus')}
            </div>
            {presetApplied && (
              <p className="rounded-lg border border-amber-600/30 bg-amber-100/70 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/50 dark:text-amber-300">
                {t('rd.presetNote')}
              </p>
            )}
            <Textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder={t('rd.focusPh')}
              rows={3}
              className="studio-scroll min-h-[64px] border-stone-300 bg-white/70 text-[13px] dark:border-stone-700 dark:bg-stone-800/70"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
              <Timer size={12} className="text-amber-700" /> {t('rd.budget')}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {STEP_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => {
                    setSteps(o.value);
                    setMinutes(o.value === 24 ? 5 : o.value === 48 ? 20 : 30);
                  }}
                  className={cn(
                    'rounded-xl border px-2 py-2 text-center transition-all',
                    steps === o.value
                      ? 'border-[#a3450f] bg-[#fdf3d7] shadow-sm dark:border-amber-600 dark:bg-amber-950/40'
                      : 'border-stone-300 bg-white/60 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500'
                  )}
                >
                  <div className={cn('text-[12.5px] font-semibold', steps === o.value ? 'text-[#8a380c] dark:text-amber-300' : 'text-stone-700 dark:text-stone-200')}>
                    {o.label[lang]}
                  </div>
                  <div className="text-[10.5px] text-stone-400">{o.hint[lang]}</div>
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-stone-400">
              {t('rd.budgetNote')}
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={close} className="border-stone-300 text-[13px]">
            {t('rd.cancel')}
          </Button>
          <Button
            onClick={() => void launch()}
            disabled={busy}
            className="bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[13px] text-amber-50 hover:from-[#8f3c0c]"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={13} />}
            {t('rd.launch')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
