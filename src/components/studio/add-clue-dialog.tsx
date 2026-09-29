'use client';

// add-clue-dialog.tsx — 用户手动添加素材卡（同步进入 Agent 上下文）（Task 13 双语）
import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useStudio } from '@/store/studio';
import { NODE_KIND_LABEL, useI18n, useT } from '@/lib/i18n';
import type { NodeKind } from '@/lib/types';

const KINDS: NodeKind[] = ['evidence', 'insight', 'question', 'hypothesis', 'source', 'gap', 'topic'];

export function AddClueDialog() {
  const open = useStudio((s) => s.addClueOpen);
  const setOpen = useStudio((s) => s.setAddClue);
  const addNote = useStudio((s) => s.addNote);
  const [kind, setKind] = useState<NodeKind>('evidence');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const t = useT();
  const lang = useI18n((s) => s.lang);

  function reset() {
    setKind('evidence');
    setTitle('');
    setContent('');
    setSourceUrl('');
    setTags('');
  }

  async function submit() {
    if (!title.trim()) {
      toast.error(t('note.needTitle'));
      return;
    }
    setBusy(true);
    try {
      await addNote({
        kind,
        title: title.trim(),
        content: content.trim(),
        sourceUrl: sourceUrl.trim() || undefined,
        tags: tags.trim() ? tags.split(/[,，、\s]+/).filter(Boolean).slice(0, 6) : undefined,
      });
      toast.success(t('note.added'));
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('note.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => setOpen(v)}>
      <DialogContent className="max-w-[440px] border-stone-300 bg-[#f7f4ee] dark:border-stone-700 dark:bg-[#171411]">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 text-[15px] text-stone-800 dark:text-stone-100">
            <Pin size={15} className="rotate-45 text-[#b91c1c]" />
            {t('note.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <span className="text-[12.5px] text-stone-600 dark:text-stone-300">{t('note.kind')}</span>
            <Select value={kind} onValueChange={(v) => setKind(v as NodeKind)}>
              <SelectTrigger className="h-9 border-stone-300 bg-white/70 text-[13px] dark:border-stone-700 dark:bg-stone-800/70">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-stone-300 bg-[#fdfaf1] dark:border-stone-700 dark:bg-stone-900">
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k} className="text-[13px]">
                    {NODE_KIND_LABEL[k][lang]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <span className="text-[12.5px] text-stone-600 dark:text-stone-300">{t('note.titleLabel')}</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('note.phTitle')}
              className="h-9 border-stone-300 bg-white/70 text-[13px] dark:border-stone-700 dark:bg-stone-800/70"
            />
          </div>
          <div className="grid grid-cols-[110px_1fr] items-start gap-3">
            <span className="mt-2 text-[12.5px] text-stone-600 dark:text-stone-300">{t('note.details')}</span>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t('note.phDetails')}
              rows={3}
              className="studio-scroll min-h-[60px] border-stone-300 bg-white/70 text-[13px] dark:border-stone-700 dark:bg-stone-800/70"
            />
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <span className="text-[12.5px] text-stone-600 dark:text-stone-300">{t('note.source')}</span>
            <Input
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder={t('note.phUrl')}
              className="h-9 border-stone-300 bg-white/70 text-[13px] dark:border-stone-700 dark:bg-stone-800/70"
            />
          </div>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3">
            <span className="text-[12.5px] text-stone-600 dark:text-stone-300">{t('note.tags')}</span>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t('note.phTags')}
              className="h-9 border-stone-300 bg-white/70 text-[13px] dark:border-stone-700 dark:bg-stone-800/70"
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} className="border-stone-300 text-[13px]">
            {t('note.cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy}
            className="bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[13px] text-amber-50 hover:from-[#8f3c0c]"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Pin size={13} className="rotate-45" />}
            {t('note.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
