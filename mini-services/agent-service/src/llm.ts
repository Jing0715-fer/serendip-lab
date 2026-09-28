// llm.ts — z-ai-web-dev-sdk 统一封装（§6.5）
// 空响应/异常 → 退避重试（1s/3s）共 2 次；提供容错 JSON 提取调用
// v2：支持 thinking 模式（R1 式长链推理）——规划师/调查员/综合师等
// 推理密集型面孔开启，访谈者保持关闭以降低对话延迟。
import ZAI from 'z-ai-web-dev-sdk'
import { extractJson, sleep } from './util'

let zai: any = null

export async function getZai() {
  zai ??= await ZAI.create()
  return zai
}

export type LlmOpts = { thinking?: boolean }

/** 底层单次调用 */
async function llmOnce(systemPrompt: string, userPrompt: string, opts?: LlmOpts): Promise<string> {
  const z = await getZai()
  const completion = await z.chat.completions.create({
    messages: [
      { role: 'assistant', content: systemPrompt }, // SDK 约定：系统提示用 assistant 角色
      { role: 'user', content: userPrompt },
    ],
    thinking: { type: opts?.thinking ? 'enabled' : 'disabled' },
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
