'use client';

// llm-settings-dialog.tsx — LLM 供应商配置（Task 11）
// 参照 pdb-tracker-web-v5 的供应商目录设计：目录卡片选择 → 模型 → Key →
// Base URL 覆盖 → 温度 → 分面孔 thinking 开关；支持连接测试。
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Brain,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Loader2,
  PlugZap,
  Thermometer,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { agentApi } from '@/lib/agent-api';
import {
  AGENT_FACE_LABEL,
  type AgentFace,
  type LlmSettingsView,
  type ProviderProfileInfo,
  type LlmTestResult,
} from '@/lib/types';

const FACE_ORDER: AgentFace[] = ['interviewer', 'planner', 'investigator', 'synthesizer'];
const FACE_HINT: Record<AgentFace, string> = {
  interviewer: '对话延迟优先',
  planner: '任务分解与假说设计',
  investigator: 'ReAct 循环主脑',
  synthesizer: '结案叙事与评分',
};

export function LlmSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [catalog, setCatalog] = useState<ProviderProfileInfo[]>([]);
  const [providerId, setProviderId] = useState('builtin');
  const [model, setModel] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
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

  // 打开时拉取配置
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setTestResult(null);
    agentApi
      .getLlmConfig()
      .then(({ settings, catalog }) => {
        setCatalog(catalog);
        setProviderId(settings.providerId);
        setModel(settings.model);
        setModelInput('');
        setHasKey(settings.hasKey);
        setApiKey('');
        setBaseUrlOverride(settings.baseUrlOverride);
        setTemperature(settings.temperature == null ? '' : String(settings.temperature));
        setThinking(settings.thinking);
      })
      .catch((e) => toast.error(`读取配置失败：${e.message}`))
      .finally(() => setLoading(false));
  }, [open]);

  const profile = catalog.find((p) => p.id === providerId);
  const isBuiltin = providerId === 'builtin';
  const effectiveModel = modelInput.trim() || model || profile?.defaultModel || '';
  const models = profile?.models ?? [];

  const save = useCallback(async () => {
    if (!isBuiltin && !profile?.keyless && !hasKey && !apiKey.trim()) {
      toast.error('请填写 API Key，或切回内置网关');
      return;
    }
    if (!isBuiltin && providerId === 'custom' && !baseUrlOverride.trim()) {
      toast.error('自定义端点需要填写 Base URL');
      return;
    }
    setSaving(true);
    try {
      await agentApi.saveLlmConfig({
        providerId,
        model: effectiveModel,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        baseUrlOverride,
        ...(temperature.trim() === '' ? { temperature: null } : { temperature: Number(temperature) }),
        thinking,
      });
      setApiKey('');
      toast.success('LLM 配置已保存，下次调用即生效');
      onOpenChange(false);
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [isBuiltin, profile, hasKey, apiKey, providerId, baseUrlOverride, effectiveModel, temperature, thinking, onOpenChange]);

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
        ...(temperature.trim() === '' ? { temperature: null } : { temperature: Number(temperature) }),
        thinking,
      });
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
            LLM 配置
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
                <PlugZap size={12} className="text-amber-700" /> 供应商
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
                    }}
                    className={cn(
                      'rounded-xl border px-2 py-2 text-center transition-all',
                      providerId === p.id
                        ? 'border-[#a3450f] bg-[#fdf3d7] shadow-sm dark:border-amber-600 dark:bg-amber-950/40'
                        : 'border-stone-300 bg-white/60 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500'
                    )}
                  >
                    <div className={cn('text-[12px] font-semibold', providerId === p.id ? 'text-[#8a380c] dark:text-amber-300' : 'text-stone-700 dark:text-stone-200')}>
                      {p.displayName}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-stone-400">
                      {p.keyless ? '无需 Key' : p.models.length ? `${p.models.length} 个模型` : '填 URL + Key'}
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
                  获取 API Key <ExternalLink size={10} />
                </a>
              )}
            </div>

            {/* 模型 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                模型 {isBuiltin && <span className="text-[10.5px] font-normal text-stone-400">（内置网关由环境固定）</span>}
              </div>
              {models.length > 0 ? (
                <div className="flex gap-2">
                  <Select value={model || profile?.defaultModel || ''} onValueChange={(v) => { setModel(v); setModelInput(''); }}>
                    <SelectTrigger className="h-9 flex-1 border-stone-300 bg-white/70 text-[13px] dark:border-stone-700 dark:bg-stone-800/70">
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent className="border-stone-300 bg-[#fdfaf1] dark:border-stone-700 dark:bg-stone-900">
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-[13px]">
                          {m.name}
                          {m.contextWindow ? <span className="ml-1 text-[10px] text-stone-400">{Math.round(m.contextWindow / 1000)}k ctx</span> : null}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={modelInput}
                    onChange={(e) => setModelInput(e.target.value)}
                    placeholder="或手填模型 ID"
                    className="h-9 w-[42%] border-stone-300 bg-white/70 text-[12.5px] font-mono dark:border-stone-700 dark:bg-stone-800/70"
                  />
                </div>
              ) : (
                <Input
                  value={modelInput || model}
                  onChange={(e) => setModelInput(e.target.value)}
                  placeholder="模型 ID，如 deepseek-chat / gpt-4o"
                  className="h-9 border-stone-300 bg-white/70 text-[12.5px] font-mono dark:border-stone-700 dark:bg-stone-800/70"
                />
              )}
            </div>

            {/* API Key */}
            {!isBuiltin && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                  <KeyRound size={12} className="text-amber-700" /> API Key
                  {hasKey && <span className="text-[10.5px] font-normal text-emerald-700 dark:text-emerald-400">已配置（填写可覆盖）</span>}
                </div>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={profile?.keyless ? '本地服务无需 Key，可留空' : `sk-…（${profile?.apiKeyEnv || '环境变量兜底'}）`}
                  className="h-9 border-stone-300 bg-white/70 text-[12.5px] font-mono dark:border-stone-700 dark:bg-stone-800/70"
                  autoComplete="off"
                />
                <p className="text-[10.5px] leading-relaxed text-stone-400">
                  Key 只保存在本机 agent-service 的 SQLite 中，不经过任何第三方；留空时读取环境变量 {profile?.apiKeyEnv || '—'}。
                </p>
              </div>
            )}

            {/* Base URL 覆盖 */}
            {!isBuiltin && (
              <div className="space-y-1.5">
                <div className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">Base URL</div>
                <Input
                  value={baseUrlOverride}
                  onChange={(e) => setBaseUrlOverride(e.target.value)}
                  placeholder={profile?.baseURL || 'https://…/v1'}
                  className="h-9 border-stone-300 bg-white/70 text-[12.5px] font-mono dark:border-stone-700 dark:bg-stone-800/70"
                />
                <p className="text-[10.5px] leading-relaxed text-stone-400">
                  {providerId === 'custom' ? '必填：任何 OpenAI 兼容端点（/chat/completions）' : '留空使用默认地址；支持代理或私有部署'}
                </p>
              </div>
            )}

            {/* 温度 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                <Thermometer size={12} className="text-amber-700" /> 采样温度
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  placeholder="留空 = 供应商默认"
                  inputMode="decimal"
                  className="h-9 w-36 border-stone-300 bg-white/70 text-[12.5px] dark:border-stone-700 dark:bg-stone-800/70"
                />
                <p className="text-[10.5px] leading-relaxed text-stone-400">0–2；调查类建议 0.2–0.7</p>
              </div>
            </div>

            {/* thinking 分面孔开关 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                <Brain size={12} className="text-amber-700" /> 长链推理（thinking）
                {!isBuiltin && <span className="text-[10.5px] font-normal text-stone-400">（内置网关专属；DeepSeek R1 类模型由服务端原生推理）</span>}
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
                      <div className="text-[12.5px] font-medium text-stone-700 dark:text-stone-200">{AGENT_FACE_LABEL[face]}</div>
                      <div className="text-[10.5px] text-stone-400">{FACE_HINT[face]}</div>
                    </div>
                    <Switch
                      checked={thinking[face]}
                      onCheckedChange={(v) => setThinking((t) => ({ ...t, [face]: v }))}
                      disabled={!isBuiltin}
                      aria-label={`${AGENT_FACE_LABEL[face]} thinking 开关`}
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
                测试连接
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
                        连接正常 · {testResult.model} · {testResult.latencyMs}ms
                        {testResult.reply ? <span className="text-stone-400"> · 回复「{testResult.reply.slice(0, 20)}」</span> : null}
                      </>
                    ) : (
                      <>
                        连接失败 · {testResult.provider}/{testResult.model}
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
            取消
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || loading}
            className="bg-gradient-to-b from-[#a3450f] to-[#8a380c] text-[13px] text-amber-50 hover:from-[#8f3c0c]"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
