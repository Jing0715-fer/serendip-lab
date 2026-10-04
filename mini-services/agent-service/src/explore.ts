// explore.ts — 课题探索闭环（Task 16）
// 针对单张深研课题卡的两条链路：
//  1) generateExplorePlan：为课题制定具体探索方案（目标/假说/实验设计/判读标准/决策点）；
//  2) submitExploreFeedback：用户反馈结果 → AI 继续推导 → graph_ops 重整证据墙逻辑 →
//     修正方案（plan_patch 合并）→ 给出下一步方向（next_steps），循环迭代。
// 均为异步执行（LLM 一次调用约 30-90s）：POST 立即返回，结果经 SSE `explore` 事件推送；
// 反馈应用 graph_ops 后同步广播 `state` 快照让证据墙即时更新。
import { broadcast } from './emitter'
import {
  getSessionRow, getMeta, listNodes, listEdges, insertActivity, insertMessage,
  touchSession, insertNode, updateNode, updateNodeContent, insertEdge, findNodeByTitle,
  saveExploration, getExploration, deleteExploration, NODE_KINDS, EDGE_RELATIONS,
  type BoardNode, type TopicPlan, type FeedbackRound, type Exploration, type ExploreVerdict,
} from './db'
import { llmJsonSteady } from './llm'
import { EXPLORE_PROMPT, FEEDBACK_PROMPT } from './prompts'
import { getSessionLang, langDirective, noticeFor, type Lang } from './lang'
import { stateSnapshot, resolveNodeByTitle } from './runtime'

/** sessionId → `${action}:${nodeId}`；同一会话同一时刻只跑一个探索任务 */
const running = new Map<string, string>()

export function exploreJobOf(sessionId: string): string | null {
  return running.get(sessionId) ?? null
}

// ---------- 归一化工具（容错 + clamp，防模型输出越界） ----------
function strArray(v: unknown, cap: number, maxLen: number): string[] {
  const arr: string[] = Array.isArray(v)
    ? v.map((x) => (typeof x === 'string' ? x.trim() : ''))
    : typeof v === 'string' && v.trim()
      ? v.split(/[、，,;；\n]+/)
      : []
  return arr.filter(Boolean).slice(0, cap).map((s) => s.trim().slice(0, maxLen)).filter(Boolean)
}

function normStep(v: unknown): { step: string; detail: string; duration?: string }[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((s: any) => s && typeof s === 'object' && String(s.step ?? '').trim())
    .slice(0, 8)
    .map((s: any) => ({
      step: String(s.step).trim().slice(0, 48),
      detail: String(s.detail ?? '').trim().slice(0, 500),
      ...(s.duration ? { duration: String(s.duration).trim().slice(0, 20) } : {}),
    }))
}

function normPlan(raw: any): TopicPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const objective = String(raw.objective ?? '').trim().slice(0, 300)
  if (!objective && !String(raw.hypothesis ?? '').trim()) return null
  return {
    objective,
    hypothesis: String(raw.hypothesis ?? '').trim().slice(0, 300),
    keyQuestions: strArray(raw.key_questions ?? raw.keyQuestions, 5, 200),
    design: normStep(raw.design),
    methods: strArray(raw.methods, 8, 100),
    metrics: strArray(raw.metrics, 6, 240),
    expectedOutcome: String(raw.expected_outcome ?? raw.expectedOutcome ?? '').trim().slice(0, 400),
    ...(String(raw.risks ?? '').trim() ? { risks: String(raw.risks).trim().slice(0, 300) } : {}),
  }
}

const VERDICTS: ExploreVerdict[] = ['supports', 'contradicts', 'mixed', 'inconclusive', 'refined']

function normVerdict(v: unknown): ExploreVerdict {
  const s = String(v ?? '').toLowerCase()
  return VERDICTS.includes(s as ExploreVerdict) ? (s as ExploreVerdict) : 'mixed'
}

/** plan_patch 归一化：只保留非空字段，避免空串/空数组把好方案清掉 */
function normPatch(raw: any): Partial<TopicPlan> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Partial<TopicPlan> = {}
  const objective = String(raw.objective ?? '').trim().slice(0, 300)
  if (objective) out.objective = objective
  const hypothesis = String(raw.hypothesis ?? '').trim().slice(0, 300)
  if (hypothesis) out.hypothesis = hypothesis
  const keyQuestions = strArray(raw.key_questions ?? raw.keyQuestions, 5, 200)
  if (keyQuestions.length) out.keyQuestions = keyQuestions
  const design = normStep(raw.design)
  if (design.length) out.design = design
  const methods = strArray(raw.methods, 8, 100)
  if (methods.length) out.methods = methods
  const metrics = strArray(raw.metrics, 6, 240)
  if (metrics.length) out.metrics = metrics
  const expectedOutcome = String(raw.expected_outcome ?? raw.expectedOutcome ?? '').trim().slice(0, 400)
  if (expectedOutcome) out.expectedOutcome = expectedOutcome
  const risks = String(raw.risks ?? '').trim().slice(0, 300)
  if (risks) out.risks = risks
  return Object.keys(out).length ? out : null
}

function mergePatch(plan: TopicPlan, patch: Partial<TopicPlan> | null): TopicPlan {
  if (!patch) return plan
  return {
    objective: patch.objective ?? plan.objective,
    hypothesis: patch.hypothesis ?? plan.hypothesis,
    keyQuestions: patch.keyQuestions ?? plan.keyQuestions,
    design: patch.design ?? plan.design,
    methods: patch.methods ?? plan.methods,
    metrics: patch.metrics ?? plan.metrics,
    expectedOutcome: patch.expectedOutcome ?? plan.expectedOutcome,
    risks: patch.risks ?? plan.risks,
  }
}

// ---------- 简报组装 ----------
function L(lang: Lang, zh: string, en: string): string {
  return lang === 'en' ? en : zh
}

function topicBriefing(sessionId: string, node: BoardNode, plan: Exploration | null): string | null {
  const row = getSessionRow(sessionId)
  if (!row) return null
  const lang = getSessionLang(sessionId)
  const nodes = listNodes(sessionId)
  const edges = listEdges(sessionId)
  const meta = getMeta(sessionId)
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title || id

  const lines: string[] = []
  lines.push(lang === 'en' ? `# Research topic to explore` : `# 待探索的深研课题`)
  lines.push(`[${node.kind}] ${node.title}`)
  if (node.content) lines.push(node.content)
  if (node.detail) lines.push(node.detail.slice(0, 600))
  lines.push('')

  // 直连节点（课题卡 derives 挂的支撑证据 / 相关假说）
  const related = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => ({
      other: e.source === node.id ? e.target : e.source,
      relation: e.source === node.id ? `--${e.relation}-->` : `<--${e.relation}--`,
    }))
    .map((r) => ({ ...r, node: nodes.find((n) => n.id === r.other) }))
    .filter((r): r is { other: string; relation: string; node: BoardNode } => !!r.node)

  if (related.length) {
    lines.push(lang === 'en' ? `# Directly linked wall cards` : `# 课题直连的墙卡（支撑证据/相关节点）`)
    for (const r of related.slice(0, 10)) {
      lines.push(`- ${r.relation} [${r.node.kind}] ${r.node.title}${r.node.content ? `：${r.node.content.slice(0, 160)}` : ''}${r.node.status === 'contradicted' ? '（⚠ 已被矛盾证据动摇）' : ''}`)
    }
    lines.push('')
  }

  // 假说与核心问题（全墙，方案需要衔接）
  const hypotheses = nodes.filter((n) => n.kind === 'hypothesis')
  const questions = nodes.filter((n) => n.kind === 'question')
  if (hypotheses.length || questions.length) {
    lines.push(lang === 'en' ? `# Hypotheses & core questions on the wall` : `# 证据墙上的假说与核心问题`)
    for (const h of hypotheses.slice(0, 6)) lines.push(`- [假说] ${h.title}${h.confidence != null ? `（置信度 ${h.confidence}）` : ''}${h.status === 'contradicted' ? '（⚠ 被矛盾证据动摇）' : ''}`)
    for (const q of questions.slice(0, 4)) lines.push(`- [问题] ${q.title}`)
    lines.push('')
  }

  // 矛盾边（最有价值的探索线索）
  const contradictions = edges.filter((e) => e.relation === 'contradicts')
  if (contradictions.length) {
    lines.push(lang === 'en' ? `# Known contradictions (highest-value leads)` : `# 已知矛盾（探索价值最高的线索）`)
    for (const e of contradictions.slice(0, 6)) {
      lines.push(`- ${titleOf(e.source)} ⚡ ${titleOf(e.target)}${e.label ? `（${e.label}）` : ''}`)
    }
    lines.push('')
  }

  // 既有探索方案 + 历史反馈轮次
  if (plan && plan.rounds.length) {
    lines.push(lang === 'en' ? `# Current exploration plan (v${plan.rounds.length + 1})` : `# 当前探索方案（v${plan.rounds.length + 1}）`)
    lines.push(`objective: ${plan.plan.objective}`)
    lines.push(`hypothesis: ${plan.plan.hypothesis}`)
    if (plan.plan.metrics.length) lines.push(`metrics: ${plan.plan.metrics.join('；')}`)
    lines.push('')
    lines.push(lang === 'en' ? `# Previous feedback rounds` : `# 历史反馈轮次`)
    for (const r of plan.rounds.slice(-6)) {
      lines.push(`- 轮 ${r.n}：${r.feedback.slice(0, 200)} → ${r.verdict}（${r.analysis.slice(0, 160)}…）`)
    }
    lines.push('')
  }

  // 研究综述节选
  if (row.narrative) {
    lines.push(lang === 'en' ? `# Research review (excerpt)` : `# 研究综述（节选）`)
    lines.push(row.narrative.slice(0, 1800))
    lines.push('')
  }

  // 用户画像（方法背景约束方案设计）
  const s = meta.signals
  if (s.topic || s.method_context || s.organism) {
    lines.push(lang === 'en' ? `# User context` : `# 用户背景（方案须尊重其资源与约束）`)
    lines.push(`topic: ${s.topic || '未知'}；organism: ${s.organism || '未知'}；method_context: ${s.method_context || '未知'}`)
    lines.push('')
  }

  return lines.join('\n')
}

// ---------- graph_ops 应用（反馈后重整证据墙逻辑） ----------
function applyGraphOps(sessionId: string, ops: any[]): { applied: string[] } {
  const applied: string[] = []
  const lang = getSessionLang(sessionId)
  const nodes = () => listNodes(sessionId)
  for (const op of (Array.isArray(ops) ? ops : []).slice(0, 24)) {
    try {
      if (op?.op === 'add_evidence' && op.title) {
        const kind = String(op.kind || 'evidence')
        if (!NODE_KINDS.includes(kind as any)) continue
        const title = String(op.title).trim()
        const content = String(op.content || '').trim()
        if (!title || !content) continue
        const existing = findNodeByTitle(sessionId, title)
        // Task 20 打磨：用户一手实验数据（sourceRef 为 User experiment 等）自动标 user 等级——
        // 反馈链路钉墙的实验数据是最高权重证据，此前漏标 level（真实测试发现）
        const isUserExp = /user[\s_-]*experiment|用户实验|用户数据|一手数据/i.test(String(op.sourceRef || ''))
        if (existing) {
          updateNodeContent(
            sessionId, existing.id, content,
            op.confidence != null ? Math.min(1, Math.max(0, Number(op.confidence))) : null,
            op.sourceRef ? String(op.sourceRef) : null,
            op.sourceUrl ? String(op.sourceUrl) : null,
            op.detail ? String(op.detail) : null,
            kind === 'evidence' && (isUserExp || op.level === 'user') ? 'user' : null
          )
          applied.push(L(lang, `更新卡片「${title}」`, `Updated card “${title}”`))
        } else {
          insertNode(sessionId, {
            kind: kind as any, title, content,
            detail: op.detail ? String(op.detail) : null,
            sourceRef: op.sourceRef ? String(op.sourceRef) : null,
            sourceUrl: op.sourceUrl ? String(op.sourceUrl) : null,
            confidence: op.confidence != null ? Math.min(1, Math.max(0, Number(op.confidence))) : null,
            level: kind === 'evidence' && (isUserExp || op.level === 'user') ? 'user' : null,
            pinnedBy: 'agent',
          })
          applied.push(L(lang, `钉上新卡片「${title}」`, `Pinned new card “${title}”`))
        }
      } else if (op?.op === 'link_evidence' && op.from && op.to) {
        const relation = String(op.relation || 'relates')
        if (!EDGE_RELATIONS.includes(relation as any)) continue
        const ns = nodes()
        let src = resolveNodeByTitle(ns, String(op.from))
        let dst = resolveNodeByTitle(ns, String(op.to))
        if (!src || !dst) continue
        if (src.id === dst.id) continue
        // answers 方向矫正（同 runtime）
        if (relation === 'answers' && src.kind === 'question' && dst.kind !== 'question') {
          const t = src; src = dst; dst = t
        }
        const edge = insertEdge(sessionId, src.id, dst.id, relation as any, op.label ? String(op.label) : null)
        if (edge) applied.push(L(lang, `连线 ${src.title} --${relation}--> ${dst.title}`, `Link ${src.title} --${relation}--> ${dst.title}`))
      } else if (op?.op === 'update_evidence' && op.title) {
        const node = findNodeByTitle(sessionId, String(op.title))
        if (!node) continue
        const patch = op.patch || {}
        updateNode(sessionId, node.id, {
          confidence: patch.confidence != null ? Math.min(1, Math.max(0, Number(patch.confidence))) : undefined,
          content: patch.content != null ? String(patch.content) : undefined,
          status: patch.status != null ? String(patch.status) : undefined,
          tags: Array.isArray(patch.tags) ? patch.tags.map(String) : undefined,
        })
        applied.push(L(lang, `调整「${node.title}」（置信度/状态）`, `Adjusted “${node.title}” (confidence/status)`))
      }
    } catch {
      // 单个 op 失败不影响其余
    }
  }
  return { applied }
}

// ---------- 链路 1：生成探索方案 ----------
export async function generateExplorePlan(sessionId: string, nodeId: string): Promise<{ ok: boolean; error?: string }> {
  const job = running.get(sessionId)
  if (job) return { ok: false, error: 'explore_busy' }
  const row = getSessionRow(sessionId)
  if (!row) return { ok: false, error: 'session not found' }
  const node = listNodes(sessionId).find((n) => n.id === nodeId)
  if (!node) return { ok: false, error: '课题卡不存在（可能已被新一轮综合淘汰）' }
  const existing = getExploration(sessionId, nodeId)
  if (existing) return { ok: false, error: 'plan_exists' }

  const lang = getSessionLang(sessionId)
  const briefing = topicBriefing(sessionId, node, null)
  if (!briefing) return { ok: false, error: '课题简报组装失败' }

  running.set(sessionId, `plan:${nodeId}`)
  console.log(`[explore] plan start session=${sessionId} node=${nodeId} lang=${lang}`)
  void (async () => {
    const started = Date.now()
    try {
      insertActivity(sessionId, {
        type: 'notice',
        summary: noticeFor(lang, 'explorePlanStart', { title: node.title.slice(0, 40) }),
      })
      // Task 20：外层耐心重试（429 风暴下方案生成不再静默失败）
      const out = await llmJsonSteady(EXPLORE_PROMPT, `${briefing}\n\n${langDirective(lang)}`, {
        face: 'planner',
        onRetry: (i, wait, err) => {
          insertActivity(sessionId, {
            type: 'notice',
            ok: false,
            summary: L(lang, `方案生成受阻（${err.slice(0, 60)}）——API 限流/暂不可用，${Math.round(wait / 1000)}s 后自动重试（第 ${i}/2 次）`, `Plan generation stalled (${err.slice(0, 60)}) — API rate-limited, retry ${i}/2 in ${Math.round(wait / 1000)}s`),
          })
        },
      })
      if (!out.ok) throw new Error(out.error)
      const plan = normPlan(out.value)
      if (!plan) throw new Error(lang === 'en' ? 'model returned no valid plan' : '模型未返回有效方案')

      const exploration: Exploration = {
        nodeId, topicTitle: node.title, generatedAt: Date.now(), updatedAt: Date.now(),
        plan, rounds: [],
      }
      saveExploration(sessionId, exploration)
      touchSession(sessionId)
      insertActivity(sessionId, {
        type: 'notice', ok: true,
        summary: `${noticeFor(lang, 'explorePlanDone')} · ${Math.round((Date.now() - started) / 1000)}s`,
      })
      const msg = insertMessage(sessionId, {
        role: 'assistant',
        kind: 'notice',
        content: noticeFor(lang, 'explorePlanChat', { title: node.title.slice(0, 40) }),
        data: { exploreNodeId: nodeId },
      })
      broadcast(sessionId, 'message', msg)
      broadcast(sessionId, 'explore', { nodeId, exploration })
      console.log(`[explore] plan done session=${sessionId} node=${nodeId} in ${Math.round((Date.now() - started) / 1000)}s`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[explore] plan failed session=${sessionId}:`, message)
      insertActivity(sessionId, { type: 'notice', summary: `${noticeFor(lang, 'explorePlanFailed')}：${message}`, ok: false })
      broadcast(sessionId, 'error', { message: `${noticeFor(lang, 'explorePlanFailed')}: ${message}` })
    } finally {
      running.delete(sessionId)
    }
  })()

  return { ok: true }
}

// ---------- 链路 2：反馈结果 → 继续推导 → 重整逻辑 → 下一步方向 ----------
export async function submitExploreFeedback(
  sessionId: string,
  nodeId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const job = running.get(sessionId)
  if (job) return { ok: false, error: 'explore_busy' }
  const row = getSessionRow(sessionId)
  if (!row) return { ok: false, error: 'session not found' }
  const exploration = getExploration(sessionId, nodeId)
  if (!exploration) return { ok: false, error: '请先生成探索方案，再反馈结果' }
  const node = listNodes(sessionId).find((n) => n.id === nodeId)
  if (!node) return { ok: false, error: '课题卡不存在（可能已被新一轮综合淘汰）' }

  const feedback = text.trim().slice(0, 2000)
  if (!feedback) return { ok: false, error: '缺少反馈内容' }

  const lang = getSessionLang(sessionId)
  const briefing = topicBriefing(sessionId, node, exploration)
  if (!briefing) return { ok: false, error: '课题简报组装失败' }

  const roundNo = exploration.rounds.length + 1
  const userPrompt = [
    briefing,
    '',
    `# ${L(lang, `本次用户反馈（第 ${roundNo} 轮）`, `User feedback (round ${roundNo})`)}`,
    feedback,
    '',
    lang === 'en'
      ? `Analyze this feedback per the system instructions: reasoning analysis, graph_ops to re-organize the wall, plan_patch (only if the route really changed), and prioritized next_steps. Strict JSON.`
      : `按系统指令分析本轮反馈：推理分析、graph_ops 重整证据墙、plan_patch（仅当路线实质改变时）、按优先级排序的 next_steps。严格 JSON 输出。`,
    langDirective(lang),
  ].join('\n')

  running.set(sessionId, `feedback:${nodeId}`)
  console.log(`[explore] feedback start session=${sessionId} node=${nodeId} round=${roundNo}`)
  void (async () => {
    const started = Date.now()
    try {
      insertActivity(sessionId, { type: 'notice', summary: noticeFor(lang, 'feedbackStart') })
      // Task 20：外层耐心重试（反馈推导不丢用户输入——失败自动重试而非静默报错）
      const out = await llmJsonSteady(FEEDBACK_PROMPT, userPrompt, {
        face: 'synthesizer',
        onRetry: (i, wait, err) => {
          insertActivity(sessionId, {
            type: 'notice',
            ok: false,
            summary: L(lang, `反馈推导受阻（${err.slice(0, 60)}）——API 限流/暂不可用，${Math.round(wait / 1000)}s 后自动重试（第 ${i}/2 次）`, `Feedback analysis stalled (${err.slice(0, 60)}) — API rate-limited, retry ${i}/2 in ${Math.round(wait / 1000)}s`),
          })
        },
      })
      if (!out.ok) throw new Error(out.error)
      const v = out.value || {}

      // 1) graph_ops → 重整证据墙逻辑（先落墙，让连线的标题解析能找到刚新增的卡）
      const { applied } = applyGraphOps(sessionId, v.graph_ops)
      if (applied.length) {
        for (const a of applied.slice(0, 8)) {
          insertActivity(sessionId, { type: 'notice', summary: a })
        }
        broadcast(sessionId, 'state', stateSnapshot(sessionId))
      }

      // 2) 组装本轮记录：logic_updates 优先用模型的人话说明，缺省回退到实际应用的 ops
      const logicUpdates = strArray(v.logic_updates ?? v.logicUpdates ?? v.logicUpdatesX ?? v.updates, 6, 200)
      const round: FeedbackRound = {
        n: roundNo,
        feedback,
        analysis: String(v.analysis ?? '').trim().slice(0, 1200),
        verdict: normVerdict(v.verdict),
        logicUpdates: logicUpdates.length ? logicUpdates : applied.slice(0, 6),
        nextSteps: strArray(v.next_steps ?? v.nextSteps, 4, 260),
        planPatch: normPatch(v.plan_patch ?? v.planPatch),
        createdAt: Date.now(),
      }

      // 3) 方案演进：patch 合并 → v(n+1)
      const nextExploration: Exploration = {
        ...exploration,
        updatedAt: Date.now(),
        plan: mergePatch(exploration.plan, round.planPatch),
        rounds: [...exploration.rounds, round],
      }
      saveExploration(sessionId, nextExploration)
      touchSession(sessionId)

      insertActivity(sessionId, {
        type: 'notice', ok: true,
        summary: `${noticeFor(lang, 'feedbackDone', { n: String(roundNo) })} · ${Math.round((Date.now() - started) / 1000)}s`,
      })

      // 4) 聊天窗通知：verdict + 首条下一步方向，引导回探索面板
      const first = round.nextSteps[0]
      const msg = insertMessage(sessionId, {
        role: 'assistant',
        kind: 'notice',
        content: noticeFor(lang, 'feedbackChat', {
          n: String(roundNo),
          title: node.title.slice(0, 30),
          verdict: noticeFor(lang, `verdict_${round.verdict}` as any),
          next: first ? `\n${L(lang, '▶ 下一步：', '▶ Next: ')}${first}` : '',
        }),
        data: { exploreNodeId: nodeId },
      })
      broadcast(sessionId, 'message', msg)
      broadcast(sessionId, 'explore', { nodeId, exploration: nextExploration })
      console.log(`[explore] feedback done session=${sessionId} node=${nodeId} round=${roundNo} verdict=${round.verdict} ops=${applied.length} in ${Math.round((Date.now() - started) / 1000)}s`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[explore] feedback failed session=${sessionId}:`, message)
      insertActivity(sessionId, { type: 'notice', summary: `${noticeFor(lang, 'feedbackFailed')}：${message}`, ok: false })
      broadcast(sessionId, 'error', { message: `${noticeFor(lang, 'feedbackFailed')}: ${message}` })
    } finally {
      running.delete(sessionId)
    }
  })()

  return { ok: true }
}

// ---------- 链路 3：重新生成方案（推翻重来，历史轮次清空） ----------
export async function regenerateExplorePlan(sessionId: string, nodeId: string): Promise<{ ok: boolean; error?: string }> {
  const job = running.get(sessionId)
  if (job) return { ok: false, error: 'explore_busy' }
  if (getExploration(sessionId, nodeId)) {
    deleteExploration(sessionId, nodeId)
  }
  return generateExplorePlan(sessionId, nodeId)
}
