// llm-config.ts — LLM 供应商目录与运行时配置（Task 11）
//
// 设计参照 pdb-tracker-web-v5 的 PROVIDER_CATALOG / openai-compat-adapter：
//  - 目录内置常用 OpenAI 兼容供应商（baseURL / 认证头 / 默认模型 / 文档链接）
//  - 'builtin' = 本环境 z-ai 网关（无需 key，走 z-ai-web-dev-sdk，支持 thinking 参数）
//  - 其余供应商走通用 OpenAI 兼容 fetch 适配（直连 /chat/completions）
//  - 配置持久化在 SQLite settings 表（key='llm'），热更新（PUT 后立即生效）
//  - thinking（R1 式长链推理）按 agent 面孔独立开关

import { db } from './db'

// ---------- 供应商目录 ----------

export type ProviderModel = { id: string; name: string; contextWindow?: number }

export type ProviderProfile = {
  id: string
  displayName: string
  /** UI 短标签（1-2 字符） */
  label: string
  baseURL: string
  apiKeyEnv: string
  authHeader?: string
  authPrefix?: string
  defaultModel: string
  models: ProviderModel[]
  docsUrl: string
  /** 无需 API key（本沙箱内置网关） */
  keyless?: boolean
  extraHeaders?: Record<string, string>
}

export const PROVIDER_CATALOG: ProviderProfile[] = [
  {
    id: 'builtin',
    displayName: '内置网关（Z.ai GLM）',
    label: 'Z',
    baseURL: '',
    apiKeyEnv: '',
    defaultModel: 'glm-4-plus',
    models: [{ id: 'glm-4-plus', name: 'GLM-4 Plus' }],
    docsUrl: '',
    keyless: true,
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    label: 'DS',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3 (Chat)', contextWindow: 64000 },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoner)', contextWindow: 64000 },
    ],
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    label: 'AI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
      { id: 'o4-mini', name: 'o4-mini', contextWindow: 200000 },
    ],
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic Claude',
    label: 'AN',
    baseURL: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    authHeader: 'x-api-key',
    authPrefix: '',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000 },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', contextWindow: 200000 },
    ],
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'qwen',
    displayName: '通义千问 Qwen',
    label: 'QW',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
    models: [
      { id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: 262144 },
      { id: 'qwen-plus', name: 'Qwen Plus' },
    ],
    docsUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'moonshot',
    displayName: '月之暗面 Kimi',
    label: 'KI',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'kimi-latest',
    models: [{ id: 'kimi-latest', name: 'Kimi Latest' }],
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'siliconflow',
    displayName: 'SiliconFlow 硅基流动',
    label: 'SF',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3' },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1' },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B' },
    ],
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'ollama',
    displayName: 'Ollama（本地）',
    label: 'OL',
    baseURL: 'http://127.0.0.1:11434/v1',
    apiKeyEnv: '',
    defaultModel: 'qwen3',
    models: [{ id: 'qwen3', name: 'qwen3' }, { id: 'llama3.3', name: 'llama3.3' }],
    docsUrl: 'https://ollama.com/library',
    keyless: true,
  },
  {
    id: 'custom',
    displayName: '自定义 OpenAI 兼容端点',
    label: '…',
    baseURL: '',
    apiKeyEnv: '',
    defaultModel: '',
    models: [],
    docsUrl: '',
  },
]

export function findProvider(id: string): ProviderProfile | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id)
}

// ---------- 配置 ----------

export type AgentFace = 'interviewer' | 'planner' | 'investigator' | 'synthesizer'

export type LlmSettings = {
  providerId: string
  model: string
  apiKey: string
  baseUrlOverride: string
  /** 采样温度（null = 用供应商默认） */
  temperature: number | null
  /** R1 式长链推理 · 按 agent 面孔独立开关（仅内置网关生效） */
  thinking: Record<AgentFace, boolean>
}

const DEFAULT_SETTINGS: LlmSettings = {
  providerId: 'builtin',
  model: '',
  apiKey: '',
  baseUrlOverride: '',
  temperature: null,
  thinking: { interviewer: false, planner: true, investigator: true, synthesizer: true },
}

let cached: LlmSettings | null = null

export function getLlmSettings(): LlmSettings {
  if (cached) return cached
  try {
    const row = db.query('SELECT value FROM settings WHERE key=?').get('llm') as
      | { value: string }
      | undefined
    if (row) {
      const parsed = JSON.parse(row.value) as Partial<LlmSettings>
      cached = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        thinking: { ...DEFAULT_SETTINGS.thinking, ...(parsed.thinking ?? {}) },
      }
      return cached
    }
  } catch (e) {
    console.error('[llm-config] read settings failed:', e)
  }
  cached = { ...DEFAULT_SETTINGS }
  return cached
}

export function saveLlmSettings(next: Partial<LlmSettings>): LlmSettings {
  const cur = getLlmSettings()
  const merged: LlmSettings = {
    ...cur,
    ...next,
    thinking: { ...cur.thinking, ...(next.thinking ?? {}) },
  }
  // model 归一：空 → 供应商默认
  const profile = findProvider(merged.providerId)
  if (!merged.model && profile?.defaultModel) merged.model = profile.defaultModel
  db.run(
    `INSERT INTO settings(key,value,updated_at) VALUES('llm',?,${Date.now()})
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    [JSON.stringify(merged)]
  )
  cached = merged
  console.log(`[llm-config] saved: provider=${merged.providerId} model=${merged.model || '(default)'} thinking=${Object.entries(merged.thinking).filter(([, v]) => v).map(([k]) => k).join('/') || 'off'}`)
  return merged
}

/** 给前端的安全视图：抹掉 API key（只保留尾 4 位） */
export function maskedSettings(s: LlmSettings): LlmSettings & { apiKeyMasked: string; hasKey: boolean } {
  const hasKey = s.apiKey.length > 0
  return {
    ...s,
    apiKey: '',
    apiKeyMasked: hasKey ? `****${s.apiKey.slice(-4)}` : '',
    hasKey,
  }
}

/** 环境变量兜底：未存 key 时读供应商对应 env */
export function resolveApiKey(profile: ProviderProfile, settings: LlmSettings): string {
  if (settings.apiKey) return settings.apiKey
  if (profile.apiKeyEnv) return process.env[profile.apiKeyEnv] ?? ''
  return 'sk-no-key'
}

export function resolveBaseUrl(profile: ProviderProfile, settings: LlmSettings): string {
  const url = (settings.baseUrlOverride || profile.baseURL || '').trim()
  return url.replace(/\/+$/, '')
}
