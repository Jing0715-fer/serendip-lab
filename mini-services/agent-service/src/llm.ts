// llm.ts — 统一 LLM 调用封装（§6.5 → Task 11 升级）
//
// 两条通道：
//  1) builtin（z-ai 网关）：z-ai-web-dev-sdk，支持 thinking 参数（R1 式长链推理）
//  2) 自定义 OpenAI 兼容供应商：直连 fetch /chat/completions（参照 pdb-tracker-web-v5
//     的 openai-compat-adapter：目录驱动的 baseURL / 认证头 / 模型）
//
// thinking 按 agent 面孔独立开关（设置持久化，PUT 后热生效）：
//  - 规划师/调查员/综合师默认开启（推理密集）
//  - 访谈者默认关闭（对话延迟优先）
// 空响应/异常 → 退避重试；429 限流 → 长退避。
import ZAI from 'z-ai-web-dev-sdk'
import { extractJson, sleep } from './util'
import {
  getLlmSettings,
  findProvider,
  resolveApiKey,
  resolveBaseUrl,
  type AgentFace,
  type ProviderModel,
} from './llm-config'

let zai: any = null

export async function getZai() {
  zai ??= await ZAI.create()
  return zai
}

export type LlmOpts = { face?: AgentFace }

/** 面孔 → thinking 开关（设置驱动，缺省兜底） */
function thinkingFor(face: AgentFace | undefined): boolean {
  const s = getLlmSettings()
  return s.thinking[face ?? 'interviewer'] ?? false
}

/** 自定义供应商：OpenAI 兼容直连 */
async function llmOnceCustom(
  systemPrompt: string,
  userPrompt: string,
  face: AgentFace | undefined
): Promise<string> {
  const s = getLlmSettings()
  const profile = findProvider(s.providerId)
  if (!profile || profile.id === 'builtin') throw new Error('LLM 配置无效：未知供应商')

  const apiKey = resolveApiKey(profile, s)
  if (!apiKey && !profile.keyless) {
    throw new Error(`未配置 ${profile.displayName} 的 API Key（设置面板或环境变量 ${profile.apiKeyEnv}）`)
  }
  const base = resolveBaseUrl(profile, s)
  if (!base) throw new Error(`未配置 ${profile.displayName} 的 Base URL`)

  const authHeader = profile.authHeader ?? 'Authorization'
  const authPrefix = profile.authPrefix ?? 'Bearer '
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [authHeader]: `${authPrefix}${apiKey}`,
    ...(profile.extraHeaders ?? {}),
  }

  const body: Record<string, unknown> = {
    model: s.model || profile.defaultModel,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    stream: false,
  }
  if (s.temperature != null) body.temperature = s.temperature
  // DeepSeek R1 等推理模型由服务端原生推理；非内置网关不透传 thinking 参数
  void face

  // 单次调用硬超时 120s（防挂死驱动循环）
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 120_000)
  try {
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText)
      throw new Error(`API ${resp.status}: ${errText.slice(0, 300)}`)
    }
    const json: any = await resp.json()
    return json.choices?.[0]?.message?.content ?? ''
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('LLM 请求超时（120s）')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** 单次调用硬超时包装（Promise.race）：不中断底层请求，但解除循环阻塞，防挂死驱动循环 */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let tid: ReturnType<typeof setTimeout> | undefined
  const timer = new Promise<never>((_, reject) => {
    tid = setTimeout(() => reject(new Error(`${label}（${Math.round(ms / 1000)}s）`)), ms)
  })
  try {
    return (await Promise.race([p, timer])) as T
  } finally {
    if (tid) clearTimeout(tid)
  }
}

/** z-ai 网关补全返回结构：SDK d.ts 将 create 声明为 Promise<any>，经 withTimeout 泛型推断为 unknown，
 *  此处按 OpenAI 兼容 choices 形态断言收窄（choices 恒为数组，可能为空） */
type ChatCompletionLike = { choices: { message?: { content?: string } }[] }

/** 底层单次调用（按配置分流） */
async function llmOnce(systemPrompt: string, userPrompt: string, opts?: LlmOpts): Promise<string> {
  const s = getLlmSettings()
  if (s.providerId !== 'builtin') {
    return llmOnceCustom(systemPrompt, userPrompt, opts?.face)
  }
  // builtin：z-ai 网关（系统提示按 SDK 约定走 assistant 角色）
  // P1 修复：SDK 默认超时可达 10 分钟，叠加退避会把整轮 Agent 循环挂死 → 与 custom 通道同标准的硬超时
  const z = await getZai()
  const completion = (await withTimeout(
    z.chat.completions.create({
      messages: [
        { role: 'assistant', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      thinking: { type: thinkingFor(opts?.face) ? 'enabled' : 'disabled' },
      ...(s.temperature != null ? { temperature: s.temperature } : {}),
    }),
    150_000,
    'LLM 请求超时'
  )) as ChatCompletionLike
  return completion.choices[0]?.message?.content ?? ''
}

/** 带重试的 LLM 调用：普通错误短退避；一旦命中 429 限流切换长指数退避（8s/25s/60s/120s），总耐心 ≈3.5 分钟；返回体为空视为失败 */
export async function llm(systemPrompt: string, userPrompt: string, opts?: LlmOpts): Promise<string> {
  const MAX_TRIES = 5
  const NORMAL_DELAYS = [1000, 3000, 5000, 8000] // 首次尝试不等待
  const RATE_DELAYS = [8000, 25000, 60000, 120000] // 429 限流专用长退避
  let rateLimited = false
  let delayIdx = 0
  let lastErr: unknown = null
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    if (attempt > 0) {
      const table = rateLimited ? RATE_DELAYS : NORMAL_DELAYS
      const d = table[Math.min(delayIdx, table.length - 1)]
      delayIdx++
      await sleep(d)
    }
    try {
      const out = await llmOnce(systemPrompt, userPrompt, opts)
      if (out && out.trim()) return out
      lastErr = new Error('empty completion')
    } catch (e) {
      lastErr = e
      if (e instanceof Error && /\b429\b|too many requests|rate.?limit/i.test(e.message)) {
        if (!rateLimited) {
          rateLimited = true
          delayIdx = 0 // 进入限流轨道，从 8s 起退避
        }
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * LLM + JSON 提取 + 失败重试（Reflexion：错误信息回灌重试 2 次；Task 12 加固）
 * 返回 null 表示彻底失败
 */
export async function llmJson<T = any>(
  systemPrompt: string,
  userPrompt: string,
  onLlmCall?: () => void,
  opts?: LlmOpts
): Promise<{ ok: true; value: T } | { ok: false; kind: 'llm' | 'parse'; error: string }> {
  let raw = ''
  try {
    raw = await llm(systemPrompt, userPrompt, opts)
  } catch (e) {
    return { ok: false, kind: 'llm', error: `LLM 调用失败: ${e instanceof Error ? e.message : String(e)}` }
  }
  onLlmCall?.()

  let parsed = extractJson<T>(raw)
  if (parsed) return { ok: true, value: parsed }

  // 解析失败 → 附加错误信息重试（最多 2 次）
  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryPrompt =
    userPrompt +
    `\n\n【重要】你的上一次输出无法解析为 JSON（原文开头 300 字符如下）：\n${raw.slice(0, 300)}\n请重新输出严格 JSON（无代码块、无多余文本、字符串内不要出现裸换行、不要出现尾随逗号）。`

    try {
      const raw2 = await llm(systemPrompt, retryPrompt, opts)
      onLlmCall?.()
      parsed = extractJson<T>(raw2)
      if (parsed) return { ok: true, value: parsed }
      raw = raw2
    } catch (e) {
      return { ok: false, kind: 'llm', error: `LLM 重试调用失败: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  return { ok: false, kind: 'parse', error: '输出仍无法解析为 JSON' }
}

/**
 * 外层耐心重试（Task 20：directions / explore 独立 LLM 链路共用）。
 * 背景：llm() 内部退避（429 共 8/25/60/120s ≈3.5 分钟耐心）在限流持续超过
 * 3.5 分钟时仍会耗尽——研究主循环有 investigate 级递增等待自愈，但这些
 * 单发链路（深研方向 / 探索方案 / 反馈推导）此前无外层重试，一次 429 风暴
 * 即静默失败。此包装在 llmJson 之上再加 2 轮：429 类失败等 60s/90s，
 * 其他失败等 12s/20s；parse 类失败不重试（llmJson 内已有 Reflexion 2 轮）。
 */
export async function llmJsonSteady<T = any>(
  systemPrompt: string,
  userPrompt: string,
  opts: {
    face?: AgentFace
    /** 每次进入外层等待前回调（写活动日志提示用户） */
    onRetry?: (attempt: number, waitMs: number, error: string) => void
  } = {}
): Promise<{ ok: true; value: T } | { ok: false; kind: 'llm' | 'parse'; error: string }> {
  const llmOpts: LlmOpts | undefined = opts.face ? { face: opts.face } : undefined
  let out = await llmJson<T>(systemPrompt, userPrompt, undefined, llmOpts)
  if (out.ok) return out
  for (let i = 1; i <= 2; i++) {
    const isRate = /\b429\b|too many requests|rate.?limit/i.test(out.error)
    const wait = isRate ? (i === 1 ? 60_000 : 90_000) : i === 1 ? 12_000 : 20_000
    opts.onRetry?.(i, wait, out.error)
    await sleep(wait)
    out = await llmJson<T>(systemPrompt, userPrompt, undefined, llmOpts)
    if (out.ok) return out
  }
  return out
}

/** 连接测试：一次极小调用，返回延迟与模型名（设置面板"测试连接"用） */
export async function testLlmConnection(): Promise<{ ok: boolean; latencyMs: number; model: string; provider: string; reply?: string; error?: string }> {
  const t0 = Date.now()
  const s = getLlmSettings()
  const profile = findProvider(s.providerId)
  const model = s.model || profile?.defaultModel || '(default)'
  try {
    const out = await llmOnce('你是连接测试助手。', '请原样回复两个字符: OK', { face: 'interviewer' })
    return {
      ok: !!(out && out.trim()),
      latencyMs: Date.now() - t0,
      model,
      provider: s.providerId,
      reply: out.slice(0, 60),
      error: out && out.trim() ? undefined : '空响应',
    }
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      model,
      provider: s.providerId,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * 远端模型列表发现（Task 12）：GET {base}/models
 * - OpenAI 兼容供应商返回 {data:[{id,...}]}；Anthropic 返回 {data:[{id,display_name}]}；
 *   Ollama /v1/models 同样兼容
 * - 显式传入的 apiKey/baseUrlOverride 优先于已保存配置（用户未保存前即可发现）
 * - 内置网关不支持 /models → 返回目录静态模型（标记 discovered:false）
 * - 过滤 embedding/TTS/图像等非对话模型，按 id 排序，去重，上限 200
 */
export async function listRemoteModels(opts: {
  providerId?: string
  apiKey?: string
  baseUrlOverride?: string
}): Promise<{ ok: boolean; provider: string; models: ProviderModel[]; discovered: boolean; count: number; error?: string }> {
  const s = getLlmSettings()
  const providerId = (opts.providerId || s.providerId || '').trim()
  const profile = findProvider(providerId)
  if (!profile) return { ok: false, provider: providerId, models: [], discovered: false, count: 0, error: '未知供应商' }

  // 内置网关：z-ai 网关不暴露 /models → 直接给静态目录
  if (profile.supportsModelList === false || providerId === 'builtin') {
    return { ok: true, provider: providerId, models: profile.models, discovered: false, count: profile.models.length }
  }

  // Key 解析优先级：显式传入 > 已保存（同供应商）> 环境变量
  const explicitKey = (opts.apiKey || '').trim()
  const savedKey = providerId === s.providerId ? s.apiKey : ''
  const apiKey = explicitKey || savedKey || (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] ?? '' : '')
  if (!apiKey && !profile.keyless) {
    return { ok: false, provider: providerId, models: [], discovered: false, count: 0, error: `未填写 ${profile.displayName} 的 API Key` }
  }

  // Base URL 解析优先级：显式传入 > 已保存（同供应商）> 目录默认
  const explicitBase = (opts.baseUrlOverride || '').trim()
  const savedBase = providerId === s.providerId ? s.baseUrlOverride : ''
  const base = (explicitBase || savedBase || profile.baseURL || '').trim().replace(/\/+$/, '')
  if (!base) {
    return { ok: false, provider: providerId, models: [], discovered: false, count: 0, error: `未配置 ${profile.displayName} 的 Base URL` }
  }

  const headers: Record<string, string> = {}
  if (apiKey) {
    const authHeader = profile.authHeader ?? 'Authorization'
    const authPrefix = profile.authPrefix ?? 'Bearer '
    headers[authHeader] = `${authPrefix}${apiKey}`
  }
  Object.assign(headers, profile.extraHeaders ?? {})

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const resp = await fetch(`${base}/models`, { headers, signal: ctrl.signal })
    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText)
      return { ok: false, provider: providerId, models: [], discovered: false, count: 0, error: `API ${resp.status}: ${errText.slice(0, 200)}` }
    }
    const json: any = await resp.json()
    const raw: any[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.models)
        ? json.models
        : Array.isArray(json)
          ? json
          : []
    if (!raw.length) {
      return { ok: false, provider: providerId, models: [], discovered: false, count: 0, error: '接口未返回任何模型' }
    }

    // 归一化 + 过滤非对话模型 + 去重 + 排序
    const NON_CHAT = /embed|whisper|tts|audio|moderation|rerank|dall-?e|image|vision-?(?:encoder|tower)|guard|safety|clip|bge-|gte-|voice|realtime|video-?gen|sora|flux|stable-?diffusion/i
    const seen = new Set<string>()
    const models: ProviderModel[] = []
    for (const m of raw) {
      let id = ''
      let name = ''
      let contextWindow: number | undefined
      if (typeof m === 'string') {
        id = m
        name = m
      } else if (m && typeof m === 'object') {
        id = String(m.id ?? m.model ?? m.name ?? '')
        name = String(m.display_name ?? m.displayName ?? m.name ?? m.id ?? '')
        const cw = Number(m.context_window ?? m.context_length ?? m.contextLength ?? m.top_provider?.context_length)
        if (Number.isFinite(cw) && cw > 0) contextWindow = cw
      }
      if (!id || seen.has(id) || NON_CHAT.test(id)) continue
      seen.add(id)
      models.push({ id, name: name || id, ...(contextWindow ? { contextWindow } : {}) })
    }
    models.sort((a, b) => a.id.localeCompare(b.id))
    const capped = models.slice(0, 200)
    return { ok: true, provider: providerId, models: capped, discovered: true, count: capped.length }
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { ok: false, provider: providerId, models: [], discovered: false, count: 0, error: '请求超时（15s）——请检查 Base URL 是否可达' }
    }
    return { ok: false, provider: providerId, models: [], discovered: false, count: 0, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(timer)
  }
}
