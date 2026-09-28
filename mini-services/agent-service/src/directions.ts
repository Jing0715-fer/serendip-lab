// directions.ts — 深研方向生成器（Task 12）
// 从证据链（节点 + 关系 + 综述 + 问题清单）提炼 3-4 个值得深入研究的方向，
// 每个方向附完整研究计划（目标 / 关键问题 / 阶段 / 方法 / 预期产出 / 风险 / 文献）。
// 异步执行（LLM 一次调用约 30-90s）：POST 立即返回，结果经 SSE `directions` 事件推送。
import { broadcast } from './emitter'
import {
  getSessionRow,
  listNodes,
  listEdges,
  listQuestions,
  insertActivity,
  insertMessage,
  touchSession,
  saveDirections,
  type ResearchDirections,
  type ResearchDirection,
} from './db'
import { llmJson } from './llm'
import { DIRECTIONS_PROMPT } from './prompts'

const running = new Set<string>()

export function directionsRunning(sessionId: string): boolean {
  return running.has(sessionId)
}

// ---------- 输入组装：把整面证据墙压成一份给战略顾问看的简报 ----------
export function buildBriefing(sessionId: string): string | null {
  const row = getSessionRow(sessionId)
  if (!row) return null
  const nodes = listNodes(sessionId)
  if (nodes.length < 3) return null

  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title || id
  const lines: string[] = []

  lines.push(`# 案件：${row.title}（当前阶段 ${row.phase}）`)
  lines.push('')

  const questions = nodes.filter((n) => n.kind === 'question')
  if (questions.length) {
    lines.push('# 核心问题')
    for (const q of questions) lines.push(`- ${q.title}${q.content ? `：${q.content}` : ''}`)
    lines.push('')
  }

  const hypotheses = nodes.filter((n) => n.kind === 'hypothesis')
  if (hypotheses.length) {
    lines.push('# 待验证假说')
    for (const h of hypotheses) lines.push(`- ${h.title}${h.content ? `：${h.content}` : ''}`)
    lines.push('')
  }

  lines.push('# 证据墙（全部节点）')
  for (const n of nodes) {
    lines.push(`[${n.kind}] ${n.title}`)
    if (n.content) lines.push(`  ${n.content}`)
    if (n.sourceRef) lines.push(`  （来源: ${n.sourceRef}）`)
    if (n.confidence != null) lines.push(`  （置信度: ${n.confidence}）`)
  }
  lines.push('')

  const edges = listEdges(sessionId)
  if (edges.length) {
    lines.push('# 证据关系')
    for (const e of edges) {
      lines.push(`${titleOf(e.source)} --${e.relation}--> ${titleOf(e.target)}${e.label ? `（${e.label}）` : ''}`)
    }
    lines.push('')
  }

  if (row.narrative) {
    lines.push('# 案情综述（节选）')
    lines.push(row.narrative.slice(0, 2200))
    lines.push('')
  }

  const qs = listQuestions(sessionId)
  if (qs.length) {
    lines.push('# 已评估的问题清单（含打分）')
    for (const q of qs) {
      const s = q.scores || {}
      lines.push(`- ${q.text}（新颖 ${s.novelty ?? '?'}/5 · 可行 ${s.feasibility ?? '?'}/5 · 影响 ${s.impact ?? '?'}/5${q.recommended ? ' · 已推荐' : ''}）`)
    }
    lines.push('')
  }

  lines.push('请从以上证据链中提炼 3-4 个值得深入研究的方向，并为每个方向制定完整研究计划（严格按系统指令的 JSON 格式输出）。')
  return lines.join('\n')
}

// ---------- 输出归一化：容错 + clamp，防模型输出越界 ----------
function clampScore(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 3
  return Math.min(5, Math.max(1, n))
}

function strArray(v: unknown, cap: number, maxLen: number): string[] {
  // 字符串 → 按 、/，/,/; 分拆（模型偶发把数组输出成逗号拼接串）
  const arr: string[] = Array.isArray(v)
    ? v.map((x) => (typeof x === 'string' ? x.trim() : ''))
    : typeof v === 'string' && v.trim()
      ? v.split(/[、，,;；\n]+/)
      : []
  return arr
    .filter(Boolean)
    .slice(0, cap)
    .map((s) => s.trim().slice(0, maxLen))
    .filter(Boolean)
}

function normalizeDirections(raw: any): ResearchDirections {
  const dirsIn = Array.isArray(raw?.directions) ? raw.directions : []
  const directions: ResearchDirection[] = []
  for (const d of dirsIn.slice(0, 4)) {
    if (!d || typeof d !== 'object') continue
    const title = String(d.title ?? '').trim().slice(0, 60)
    if (!title) continue
    const planRaw = d.plan && typeof d.plan === 'object' ? d.plan : {}
    const approach = Array.isArray(planRaw.approach)
      ? planRaw.approach
          .filter((a: any) => a && typeof a === 'object' && String(a.step ?? '').trim())
          .slice(0, 6)
          .map((a: any) => ({
            step: String(a.step).trim().slice(0, 40),
            detail: String(a.detail ?? '').trim().slice(0, 400),
            ...(a.duration ? { duration: String(a.duration).trim().slice(0, 20) } : {}),
          }))
      : []
    const litIn = Array.isArray(d.literature) ? d.literature : []
    const literature = litIn
      .map((l: any) => {
        if (typeof l === 'string') return { ref: l.trim().slice(0, 80) }
        if (l && typeof l === 'object') {
          const ref = String(l.ref ?? '').trim().slice(0, 80)
          return ref ? { ref, ...(l.note ? { note: String(l.note).trim().slice(0, 120) } : {}) } : null
        }
        return null
      })
      .filter((l: any): l is { ref: string; note?: string } => !!l)
      .slice(0, 6)

    directions.push({
      title,
      why: String(d.why ?? '').trim().slice(0, 600),
      scores: {
        novelty: clampScore((d.scores ?? {}).novelty),
        feasibility: clampScore((d.scores ?? {}).feasibility),
        impact: clampScore((d.scores ?? {}).impact),
      },
      evidenceRefs: strArray(d.evidence_refs, 8, 60),
      plan: {
        objective: String(planRaw.objective ?? '').trim().slice(0, 300),
        keyQuestions: strArray(planRaw.key_questions, 5, 200),
        approach,
        methods: strArray(planRaw.methods, 8, 80),
        expectedOutcome: String(planRaw.expected_outcome ?? planRaw.expectedOutcome ?? '').trim().slice(0, 400),
        ...(planRaw.risks ? { risks: String(planRaw.risks).trim().slice(0, 300) } : {}),
      },
      literature,
    })
  }
  return {
    generatedAt: Date.now(),
    ...(raw?.summary ? { summary: String(raw.summary).trim().slice(0, 300) } : {}),
    directions,
  }
}

/**
 * 触发深研方向生成（异步）：立即返回，结果经 SSE `directions` 事件推送。
 * 返回 {ok:false,error} 表示前置校验失败（同步）。
 */
export async function generateDirections(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  if (running.has(sessionId)) return { ok: false, error: 'directions_busy' }
  const row = getSessionRow(sessionId)
  if (!row) return { ok: false, error: 'session not found' }
  const nodes = listNodes(sessionId)
  if (nodes.length < 3) return { ok: false, error: '证据墙节点太少（至少需要 3 个节点才能提炼方向）' }

  const briefing = buildBriefing(sessionId)
  if (!briefing) return { ok: false, error: '证据链简报组装失败' }

  running.add(sessionId)
  console.log(`[directions] start session=${sessionId} nodes=${nodes.length}`)
  void (async () => {
    const started = Date.now()
    try {
      insertActivity(sessionId, { type: 'notice', summary: '首席战略顾问开始审阅证据链，提炼深研方向…' })
      const out = await llmJson(DIRECTIONS_PROMPT, briefing, undefined, { face: 'synthesizer' })
      if (!out.ok) throw new Error(out.error)
      const dirs = normalizeDirections(out.value)
      if (!dirs.directions.length) throw new Error('模型未返回有效的深研方向')

      saveDirections(sessionId, dirs)
      touchSession(sessionId)
      insertActivity(sessionId, {
        type: 'notice',
        summary: `深研方向已生成：${dirs.directions.length} 个方向 · ${Math.round((Date.now() - started) / 1000)}s`,
        ok: true,
      })
      const msg = insertMessage(sessionId, {
        role: 'assistant',
        kind: 'notice',
        content: `已从证据链提炼出 ${dirs.directions.length} 个深研方向${dirs.summary ? `：${dirs.summary}` : ''}——工作台「深研方向」标签页查看完整研究计划。`,
      })
      broadcast(sessionId, 'message', msg)
      broadcast(sessionId, 'directions', dirs)
      console.log(`[directions] done session=${sessionId} count=${dirs.directions.length} in ${Math.round((Date.now() - started) / 1000)}s`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[directions] failed session=${sessionId}:`, message)
      insertActivity(sessionId, { type: 'notice', summary: `深研方向生成失败：${message}`, ok: false })
      broadcast(sessionId, 'error', { message: `深研方向生成失败: ${message}` })
    } finally {
      running.delete(sessionId)
    }
  })()

  return { ok: true }
}
