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

/** 底层单次调用（按配置分流） */
async function llmOnce(systemPrompt: string, userPrompt: string, opts?: LlmOpts): Promise<string> {
  const s = getLlmSettings()
  if (s.providerId !== 'builtin') {
    return llmOnceCustom(systemPrompt, userPrompt, opts?.face)
  }
  // builtin：z-ai 网关（系统提示按 SDK 约定走 assistant 角色）
  const z = await getZai()
  const completion = await z.chat.completions.create({
    messages: [
      { role: 'assistant', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    thinking: { type: thinkingFor(opts?.face) ? 'enabled' : 'disabled' },
    ...(s.temperature != null ? { temperature: s.temperature } : {}),
  })
  return completion.choices[0]?.message?.content ?? ''
}

/** 带重试的 LLM 调用：指数退避，共 2 次重试；返回体为空视为失败；429 限流用更长退避 */
export async function llm(systemPrompt: string, userPrompt: string, opts?: LlmOpts): Promise<string> {
  const delays = [0, 1000, 3000]
  let lastErr: unknown = null
  let attempt = 0
  for (const d of delays) {
    if (d > 0) {
      // 上一轮错误若为 429 限流 → 改用长退避（5s / 15s）
      const is429 = lastErr instanceof Error && /429|too many requests/i.test(lastErr.message)
      await sleep(is429 ? (attempt === 1 ? 5000 : 15000) : d)
    }
    try {
      const out = await llmOnce(systemPrompt, userPrompt, opts)
      if (out && out.trim()) return out
      lastErr = new Error('empty completion')
    } catch (e) {
      lastErr = e
    }
    attempt++
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * LLM + JSON 提取 + 失败重试（Reflexion：错误信息回灌重试 1 次）
 * 返回 null 表示彻底失败
 */
export async function llmJson<T = any>(
  systemPrompt: string,
  userPrompt: string,
  onLlmCall?: () => void,
  opts?: LlmOpts
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  let raw = ''
  try {
    raw = await llm(systemPrompt, userPrompt, opts)
  } catch (e) {
    return { ok: false, error: `LLM 调用失败: ${e instanceof Error ? e.message : String(e)}` }
  }
  onLlmCall?.()

  let parsed = extractJson<T>(raw)
  if (parsed) return { ok: true, value: parsed }

  // 第一次失败 → 附加错误信息重试 1 次
  const retryPrompt =
    userPrompt +
    `\n\n【重要】你的上一次输出无法解析为 JSON（原文开头 300 字符如下）：\n${raw.slice(0, 300)}\n请重新输出严格 JSON（无代码块、无多余文本）。`

  try {
    const raw2 = await llm(systemPrompt, retryPrompt, opts)
    onLlmCall?.()
    parsed = extractJson<T>(raw2)
    if (parsed) return { ok: true, value: parsed }
    return { ok: false, error: '输出仍无法解析为 JSON' }
  } catch (e) {
    return { ok: false, error: `LLM 重试调用失败: ${e instanceof Error ? e.message : String(e)}` }
  }
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
