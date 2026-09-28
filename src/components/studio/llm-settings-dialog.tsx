'use client';

// llm-settings-dialog.tsx — LLM 供应商配置（Task 11 → Task 12 升级）
// 参照 pdb-tracker-web-v5 的供应商目录设计：目录卡片选择 → 模型 → Key →
// Base URL 覆盖 → 温度 → 分面孔 thinking 开关；支持连接测试。
// Task 12：① 填写 API Key 后自动拉取远端模型列表（GET /models，OpenAI 兼容）；
//          ② 手动「获取模型列表」按钮；③ 跨供应商 Key 状态修复（切换供应商时
//             不再把旧供应商的已存 Key 当作当前供应商的 Key）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Brain,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  Thermometer,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { agentApi } from '@/lib/agent-api';
import {
  AGENT_FACE_LABEL,
  fmt,
  useI18n,
  useT,
  type Lang,
} from '@/lib/i18n';
import type {
  AgentFace,
  LlmSettingsView,
  ProviderModelInfo,
  ProviderProfileInfo,
  LlmTestResult,
} from '@/lib/types';

const FACE_ORDER: AgentFace[] = ['interviewer', 'planner', 'investigator', 'synthesizer'];
const FACE_HINT: Record<AgentFace, Record<Lang, string>> = {
  interviewer: { zh: '对话延迟优先', en: 'Latency-sensitive dialogue' },
  planner: { zh: '任务分解与假说设计', en: 'Task decomposition & hypotheses' },
  investigator: { zh: 'ReAct 循环主脑', en: 'ReAct loop core' },
  synthesizer: { zh: '综述叙事与评分', en: 'Review narrative & scoring' },
};

export function LlmSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const [catalog, setCatalog] = useState<ProviderProfileInfo[]>([]);
  const [providerId, setProviderId] = useState('builtin');
  const [model, setModel] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  /** 打开面板时已保存配置所属的供应商（跨供应商 Key 修复） */
  const savedProviderId = useRef('builtin');
  const [baseUrlOverride, setBaseUrlOverride] = useState('');
  const [temperature, setTemperature] = useState('');
  const [thinking, setThinking] = useState<Record<AgentFace, boolean>>({
    interviewer: false,
    planner: true,
    investigator: true,
    synthesizer: true,
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null);

  // ---- 远端模型列表发现（Task 12） ----
  const [remoteModels, setRemoteModels] = useState<ProviderModelInfo[] | null>(null);
  const [remoteModelsNote, setRemoteModelsNote] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  /** 上一次自动获取的签名（provider|key|url），防抖去重 */
  const lastAutoSig = useRef('');

  // 打开时拉取配置
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setTestResult(null);
    setRemoteModels(null);
    setRemoteModelsNote(null);
    lastAutoSig.current = '';
    agentApi
      .getLlmConfig()
      .then(({ settings, catalog }) => {
        setCatalog(catalog);
        setProviderId(settings.providerId);
        setModel(settings.model);
        setModelInput('');
        setHasKey(settings.hasKey);
        savedProviderId.current = settings.providerId;
        setApiKey('');
        setBaseUrlOverride(settings.baseUrlOverride);
        setTemperature(settings.temperature == null ? '' : String(settings.temperature));
        setThinking(settings.thinking);
      })
      .catch((e) => toast.error(fmt(t('llm.readFailed'), { msg: e.message })))
      .finally(() => setLoading(false));
  }, [open, t]);

  const profile = catalog.find((p) => p.id === providerId);
  const isBuiltin = providerId === 'builtin';
  const effectiveModel = modelInput.trim() || model || profile?.defaultModel || '';
  const catalogModels = profile?.models ?? [];
  const models = remoteModels ?? catalogModels;
  /** 已存 Key 只对它所属的供应商有效（切换供应商后必须重新填写） */
  const keyConfigured = hasKey && providerId === savedProviderId.current;

  // ---- 模型列表拉取（自动 + 手动共用） ----
  const fetchModels = useCallback(
    async (opts: { manual?: boolean } = {}) => {
      if (!profile || isBuiltin || profile.supportsModelList === false) return;
      if (providerId === 'custom' && !baseUrlOverride.trim()) {
        if (opts.manual) toast.error(t('llm.customUrlFirst'));
        return;
      }
      if (!apiKey.trim() && !keyConfigured && !profile.keyless) {
        if (opts.manual) toast.error(t('llm.needKeyFirst'));
        return;
      }
      setFetchingModels(true);
      setRemoteModelsNote(null);
      try {
        const r = await agentApi.fetchLlmModels({
          providerId,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseUrlOverride.trim() ? { baseUrlOverride: baseUrlOverride.trim() } : {}),
        });
        if (r.ok && r.models.length > 0) {
          setRemoteModels(r.models);
          setRemoteModelsNote(r.discovered ? fmt(t('llm.fetchedNote'), { name: profile.displayName, n: r.count }) : null);
          // 当前选中模型不在列表中 → 切到列表第一个
          const cur = modelInput.trim() || model || profile.defaultModel;
          if (cur && !r.models.some((m) => m.id === cur)) {
            setModel(r.models[0].id);
            setModelInput('');
            toast.info(fmt(t('llm.notInList'), { model: r.models[0].id }));
          }
        } else {
          setRemoteModels(null);
          setRemoteModelsNote(r.error ?? t('llm.noList'));
          if (opts.manual) toast.error(fmt(t('llm.fetchFailed'), { msg: r.error ?? 'unknown' }));
        }
      } catch (e) {
        setRemoteModels(null);
        setRemoteModelsNote(e instanceof Error ? e.message : String(e));
        if (opts.manual) toast.error(fmt(t('llm.fetchFailed'), { msg: e instanceof Error ? e.message : String(e) }));
      } finally {
        setFetchingModels(false);
      }
    },
    [profile, isBuiltin, providerId, apiKey, keyConfigured, baseUrlOverride, model, modelInput, t]
  );

  // 自动获取：填完 Key（停止输入 900ms）或切换到无 Key 供应商时触发
  useEffect(() => {
    if (loading || !profile || isBuiltin || profile.supportsModelList === false) return;
    const keyReady = apiKey.trim().length >= 8 || (profile.keyless && providerId !== 'custom');
    const urlReady = providerId !== 'custom' || baseUrlOverride.trim().length > 8;
    if (!keyReady || !urlReady) return;
    const sig = `${providerId}|${apiKey.trim()}|${baseUrlOverride.trim()}|${keyConfigured ? 'saved' : 'nosaved'}`;
    if (sig === lastAutoSig.current) return;
    lastAutoSig.current = sig;
    const timer = setTimeout(() => void fetchModels(), 900);
    return () => clearTimeout(timer);
  }, [loading, providerId, apiKey, baseUrlOverride, catalog, keyConfigured, fetchModels]);

  const save = useCallback(async () => {
    if (!isBuiltin && !profile?.keyless && !keyConfigured && !apiKey.trim()) {
      toast.error(t('llm.needKey'));
      return;
    }
    if (!isBuiltin && providerId === 'custom' && !baseUrlOverride.trim()) {
      toast.error(t('llm.needUrl'));
      return;
    }
    setSaving(true);
    try {
      await agentApi.saveLlmConfig({
        providerId,
        model: effectiveModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        baseUrlOverride,
        ...(temperature.trim() === '' || !Number.isFinite(Number(temperature))
          ? { temperature: null }
          : { temperature: Number(temperature) }),
        thinking,
      });
      savedProviderId.current = providerId;
      setApiKey('');
      setHasKey(true);
      toast.success(t('llm.saved'));
      onOpenChange(false);
    } catch (e) {
      toast.error(fmt(t('llm.saveFailed'), { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSaving(false);
    }
  }, [isBuiltin, profile, keyConfigured, apiKey, providerId, baseUrlOverride, effectiveModel, temperature, thinking, onOpenChange, t]);

  const runTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // 测试前先把当前表单状态保存（后端按持久化配置测试）
      await agentApi.saveLlmConfig({
        providerId,
        model: effectiveModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        baseUrlOverride,
        ...(temperature.trim() === '' || !Number.isFinite(Number(temperature))
          ? { temperature: null }
          : { temperature: Number(temperature) }),
        thinking,
      });
      savedProviderId.current = providerId;
      setHasKey(true);
      setApiKey('');
      const r = await agentApi.testLlmConfig();
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, latencyMs: 0, model: effectiveModel, provider: providerId, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }, [providerId, effectiveModel, apiKey, baseUrlOverride, temperature, thinking]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="studio-scroll max-h-[92dvh] max-w-[560px] overflow-y-auto border-stone-300 bg-[#f7f4ee] dark:border-stone-700 dark:bg-[#171411]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display text-[15px] text-stone-800 dark:text-stone-100">
            <PlugZap size={15} className="text-[#a3450f]" />
            {t('llm.title')}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-stone-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* 供应商目录 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                <PlugZap size={12} className="text-amber-700" /> {t('llm.provider')}
                <span className="text-[10.5px] font-normal text-stone-400">（{fmt(t('llm.providerCount'), { n: catalog.length })}）</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {catalog.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProviderId(p.id);
                      setModel(p.defaultModel || '');
                      setModelInput('');
                      setTestResult(null);
                      setRemoteModels(null);
                      setRemoteModelsNote(null);
                    }}
                    className={cn(
                      'rounded-xl border px-2 py-2 text-center transition-all',
                      providerId === p.id
                        ? 'border-[#a3450f] bg-[#fdf3d7] shadow-sm dark:border-amber-600 dark:bg-amber-950/40'
                        : 'border-stone-300 bg-white/60 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500'
                    )}
                  >
                    <div className={cn('text-[12px] font-semibold leading-tight', providerId === p.id ? 'text-[#8a380c] dark:text-amber-300' : 'text-stone-700 dark:text-stone-200')}>
                      {p.displayName}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-stone-400">
                      {p.keyless ? t('llm.keyless') : p.models.length ? fmt(t('llm.modelsCount'), { n: p.models.length }) : t('llm.urlKey')}
                    </div>
                  </button>
                ))}
              </div>
              {profile?.docsUrl && (
                <a
                  href={profile.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-emerald-800 underline-offset-2 hover:underline dark:text-emerald-400"
                >
                  {t('llm.getKey')} <ExternalLink size={10} />
                </a>
              )}
              {profile?.note && (
                <p className="text-[10.5px] leading-relaxed text-amber-700 dark:text-amber-500">{profile.note}</p>
              )}
            </div>

            {/* 模型 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                {t('llm.model')} {isBuiltin && <span className="text-[10.5px] font-normal text-stone-400">（{t('llm.builtinNote')}）</span>}
              </div>
              <div className="flex gap-2">
                {models.length > 0 ? (
                  <Select value={model || profile?.defaultModel || ''} onValueChange={(v) => { setModel(v); setModelInput(''); }}>
                    <SelectTrigger className="h-9 min-w-0 flex-1 border-stone-300 bg-white/70 text-[13px] dark:border-stone-700 dark:bg-stone-800/70">
                      <SelectValue placeholder={t('llm.selectModel')} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 border-stone-300 bg-[#fdfaf1] dark:border-stone-700 dark:bg-stone-900">
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-[13px]">
                          <span className="max-w-[300px] truncate">{m.name}</span>
                          {m.contextWindow ? <span className="ml-1 shrink-0 text-[10px] text-stone-400">{Math.round(m.contextWindow / 1000)}k ctx</span> : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={modelInput || model}
                    onChange={(e) => setModelInput(e.target.value)}
                    placeholder={t('llm.modelPh')}
                    className="h-9 min-w-0 flex-1 border-stone-300 bg-white/70 text-[12.5px] font-mono dark:border-stone-700 dark:bg-stone-800/70"
                  />
                )}
                {!isBuiltin && profile?.supportsModelList !== false && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 gap-1 border-stone-300 px-2.5 text-[11.5px] text-stone-700 dark:border-stone-600 dark:text-stone-200"
                    onClick={() => void fetchModels({ manual: true })}
                    disabled={fetchingModels}
                  >
                    {fetchingModels ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    {t('llm.fetchList')}
                  </Button>
                )}
              </div>
              <Input
                value={models.length > 0 ? modelInput : ''}
                onChange={(e) => setModelInput(e.target.value)}
                placeholder={models.length > 0 ? t('llm.manualModel') : ''}
                className={cn(
                  'h-9 border-stone-300 bg-white/70 text-[12.5px] font-mono dark:border-stone-700 dark:bg-stone-800/70',
                  models.length === 0 && 'hidden'
                )}
              />
              {remoteModelsNote && (
                <p className={cn('text-[10.5px] leading-relaxed', remoteModels ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-400')}>
                  {remoteModels ? remoteModelsNote : `⚠ ${remoteModelsNote}`}
                </p>
              )}
            </div>

            {/* API Key */}
            {!isBuiltin && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                  <KeyRound size={12} className="text-amber-700" /> {t('llm.apiKey')}
                  {keyConfigured && <span className="text-[10.5px] font-normal text-emerald-700 dark:text-emerald-400">{t('llm.keyConfigured')}</span>}
                </div>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={profile?.keyless ? t('llm.keyPhKeyless') : fmt(t('llm.keyPh'), { env: profile?.apiKeyEnv || (lang === 'zh' ? '环境变量兜底' : 'env fallback') })}
                  className="h-9 border-stone-300 bg-white/70 text-[12.5px] font-mono dark:border-stone-700 dark:bg-stone-800/70"
                  autoComplete="off"
                />
                <p className="text-[10.5px] leading-relaxed text-stone-400">
                  {fmt(t('llm.keyNote'), { env: profile?.apiKeyEnv || '—' })}
                </p>
              </div>
            )}

            {/* Base URL 覆盖 */}
            {!isBuiltin && (
              <div className="space-y-1.5">
                <div className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">{t('llm.baseUrl')}</div>
                <Input
                  value={baseUrlOverride}
                  onChange={(e) => setBaseUrlOverride(e.target.value)}
                  placeholder={profile?.baseURL || 'https://…/v1'}
                  className="h-9 border-stone-300 bg-white/70 text-[12.5px] font-mono dark:border-stone-700 dark:bg-stone-800/70"
                />
                <p className="text-[10.5px] leading-relaxed text-stone-400">
                  {providerId === 'custom' ? t('llm.urlNoteCustom') : t('llm.urlNoteDefault')}
                </p>
              </div>
            )}

            {/* 温度 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                <Thermometer size={12} className="text-amber-700" /> {t('llm.temperature')}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  placeholder={t('llm.tempPh')}
                  inputMode="decimal"
                  className="h-9 w-36 border-stone-300 bg-white/70 text-[12.5px] dark:border-stone-700 dark:bg-stone-800/70"
                />
                <p className="text-[10.5px] leading-relaxed text-stone-400">{t('llm.tempHint')}</p>
              </div>
            </div>

            {/* thinking 分面孔开关 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                <Brain size={12} className="text-amber-700" /> {t('llm.thinking')}
                {!isBuiltin && <span className="text-[10.5px] font-normal text-stone-400">（{t('llm.thinkingNote')}）</span>}
              </div>
              <div className="rounded-xl border border-stone-300/70 bg-white/50 p-1 dark:border-stone-700 dark:bg-stone-800/40">
                {FACE_ORDER.map((face, i) => (
                  <div
                    key={face}
                    className={cn(
                      'flex items-center justify-between px-2.5 py-2',
                      i > 0 && 'border-t border-stone-200/70 dark:border-stone-700/50'
                    )}
                  >
                    <div className="leading-tight">
                      <div className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">{AGENT_FACE_LABEL[face][lang]}</div>
                      <div className="text-[10.5px] text-stone-400">{FACE_HINT[face][lang]}</div>
                    </div>
                    <Switch
                      checked={thinking[face]}
                      onCheckedChange={(v) => setThinking((tt) => ({ ...tt, [face]: v }))}
                      disabled={!isBuiltin}
                      aria-label={`${AGENT_FACE_LABEL[face][lang]} thinking`}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 连接测试 */}
            <div className="space-y-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 border-stone-300 text-[12.5px]"
                onClick={() => void runTest()}
                disabled={testing}
              >
                {testing ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} className="text-amber-700" />}
                {t('llm.test')}
              </Button>
              {testResult && (
                <div
                  className={cn(
                    'flex items-start gap-1.5 rounded-lg border px-2.5 py-2 text-[11.5px] leading-relaxed',
                    testResult.ok
                      ? 'border-emerald-400/60 bg-emerald-50/70 text-emerald-800 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'border-red-400/60 bg-red-50/70 text-red-800 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300'
                  )}
                  role="status"
                >
                  {testResult.ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <XCircle size={13} className="mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    {testResult.ok ? (
                      <>
                        {fmt(t('llm.testOk'), { model: testResult.model, ms: testResult.latencyMs })}
                        {testResult.reply ? <span className="text-stone-400">{fmt(t('llm.testReply'), { reply: testResult.reply.slice(0, 20) })}</span> : null}
                      </>
                    ) : (
                      <>
                        {fmt(t('llm.testFailed'), { provider: testResult.provider, model: testResult.model })}
                        {testResult.error ? <div className="break-all text-red-700 dark:text-red-400">{testResult.error}</div> : null}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-stone-300 text-[13px]">
            {t('llm.cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || loading}
            className="bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[13px] text-amber-50 hover:from-[#8f3c0c]"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {t('llm.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
