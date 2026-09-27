// runtime.ts — AgentRuntime 状态机（§6：ReAct + 事件流 + LangGraph 检查点 + AutoGPT 预算 + Reflexion 自愈）
import { broadcast } from './emitter'
import {
  getBudget, saveBudget, getMeta, saveMeta, getPlan, savePlan,
  listNodes, listEdges, listMessages, listQuestions,
  insertMessage, insertActivity, updateSessionFields, getSessionRow,
  findNodeByTitle, insertNode, updateNode, updateNodeContent, insertEdge,
  replaceQuestions, computeStats, NODE_KINDS, EDGE_RELATIONS,
  type SessionPhase, type AgentStatus, type Plan, type PlanTask,
  type BoardNode, type ChatMessage,
} from './db'
import { llmJson } from './llm'
import { INTERVIEWER_PROMPT, PLANNER_PROMPT, SYNTHESIZER_PROMPT, buildInvestigatorPrompt } from './prompts'
import { findExternalTool, toolsDoc } from './tools'
import { uuid, now, truncObs, oneLine, clamp, sleep } from './util'

const EXTERNAL_TOOL_NAMES = [
  'pubmed_search', 'pubmed_fetch', 'europepmc_search', 'openalex_search',
  'uniprot_search', 'ncbi_gene', 'pdb_search', 'taxonomy_search',
  'clinvar_search', 'web_search', 'web_read',
]
const GRAPH_TOOL_NAMES = ['add_evidence', 'link_evidence', 'update_evidence', 'note_gap', 'ask_user', 'finish_task']

type ScratchEntry = { thought: string; action: { tool: string; args: any }; observation: string }

type SynthOut = {
  narrative_md?: string
  message_to_user?: string
  questions?: any[]
  graph_ops?: any[]
  continue?: boolean
  next_focus?: string
}

// ---------- 全量 state 快照（SSE `state` 事件 & GET /sessions/:id 共用） ----------
export function stateSnapshot(sessionId: string): Record<string, unknown> {
  const row = getSessionRow(sessionId)
  if (!row) return {}
  const budget = getBudget(sessionId)
  const elapsedMs = budget.startedAt ? now() - budget.startedAt : budget.elapsedMs
  const stats = computeStats(sessionId, { ...budget, elapsedMs })
  return {
    nodes: listNodes(sessionId),
    edges: listEdges(sessionId),
    narrative: row.narrative || '',
    questions: listQuestions(sessionId),
    plan: getPlan(sessionId),
    stats,
    phase: row.phase,
    status: row.status,
  }
}

// ---------- 证据墙摘要 ----------
function wallSummary(sessionId: string): string {
  const nodes = listNodes(sessionId)
  if (!nodes.length) return '（证据墙尚为空）'
  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title || id
  const lines = nodes.map((n) => `[${n.kind}] ${n.title}${n.status !== 'new' ? `(${n.status})` : ''}`)
  const edges = listEdges(sessionId)
  if (edges.length) {
    lines.push('', '关系:')
    for (const e of edges) lines.push(`${titleOf(e.source)} --${e.relation}--> ${titleOf(e.target)}`)
  }
  return lines.join('\n')
}

function serializeScratchpad(pad: ScratchEntry[]): string {
  if (!pad.length) return '（调查刚刚开始，尚无历史观察）'
  const full = pad.slice(-14)
  const early = pad.slice(0, Math.max(0, pad.length - 14))
  const lines: string[] = []
  for (const e of early) {
    lines.push(`[已压缩] thought: ${oneLine(e.thought)}; action: ${e.action.tool}; obs: ${oneLine(e.observation, 200)}`)
  }
  let i = pad.length - full.length + 1
  for (const e of full) {
    lines.push(`Step ${i++} thought: ${e.thought}\n  action: ${JSON.stringify(e.action)}\n  observation: ${e.observation}`)
  }
  return lines.join('\n')
}

// ---------- AgentRuntime ----------
export class AgentRuntime {
  readonly sessionId: string
  running = false
  private stopFlag = false
  private paused = false
  private resumeResolve: (() => void) | null = null
  private userAnswerResolve: ((answer: string) => void) | null = null
  private consecutiveFails = 0
  private interviewBusy = false
  steeringQueue: string[] = []

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  // ---------- 实例管理 ----------
  private static runtimes = new Map<string, AgentRuntime>()

  static get(sessionId: string): AgentRuntime {
    let rt = AgentRuntime.runtimes.get(sessionId)
    if (!rt) {
      rt = new AgentRuntime(sessionId)
      AgentRuntime.runtimes.set(sessionId, rt)
    }
    return rt
  }

  static find(sessionId: string): AgentRuntime | undefined {
    return AgentRuntime.runtimes.get(sessionId)
  }

  static isActive(sessionId: string): boolean {
    const rt = AgentRuntime.runtimes.get(sessionId)
    return !!rt && rt.running
  }

  // ---------- 事件发射（先落库再广播） ----------
  private emitMessage(msg: ChatMessage) {
    broadcast(this.sessionId, 'message', msg)
  }

  private setPhase(phase: SessionPhase | null, status: AgentStatus) {
    if (phase !== null) {
      updateSessionFields(this.sessionId, { phase, status })
    } else {
      updateSessionFields(this.sessionId, { status })
    }
    const row = getSessionRow(this.sessionId)
    broadcast(this.sessionId, 'phase', { phase: row?.phase, status })
    insertActivity(this.sessionId, { type: 'phase', summary: `阶段切换 → ${row?.phase ?? '?'} / ${status}` })
  }

  private emitState() {
    broadcast(this.sessionId, 'state', stateSnapshot(this.sessionId))
  }

  private countLlm() {
    const b = getBudget(this.sessionId)
    b.llmCalls++
    saveBudget(this.sessionId, b)
  }

  // ---------- 预算 ----------
  private budgetOK(): boolean {
    const b = getBudget(this.sessionId)
    if (b.stepsUsed >= b.maxSteps) return false
    if (b.startedAt && now() - b.startedAt > b.maxMinutes * 60_000) return false
    return true
  }

  private remainingText(): string {
    const b = getBudget(this.sessionId)
    const elapsed = b.startedAt ? now() - b.startedAt : 0
    return `${Math.max(0, b.maxSteps - b.stepsUsed)} 步 / ${Math.max(0, Math.round((b.maxMinutes * 60_000 - elapsed) / 60_000))} 分钟`
  }

  private persistStep() {
    // checkpoint：预算 + 计划（任务 done 状态）落库，然后广播全量 state
    const b = getBudget(this.sessionId)
    b.elapsedMs = b.startedAt ? now() - b.startedAt : 0
    saveBudget(this.sessionId, b)
    const p = getPlan(this.sessionId)
    if (p) savePlan(this.sessionId, p)
    this.emitState()
  }

  // ---------- 控制 ----------
  pause() {
    if (!this.running) return
    this.paused = true
    this.setPhase(null, 'paused')
  }

  resume() {
    this.paused = false
    if (this.resumeResolve) {
      const r = this.resumeResolve
      this.resumeResolve = null
      r()
    }
    if (this.running) this.setPhase(null, 'running')
  }

  stop() {
    this.stopFlag = true
    this.paused = false
    if (this.resumeResolve) {
      const r = this.resumeResolve
      this.resumeResolve = null
      r()
    }
    if (this.userAnswerResolve) {
      const r = this.userAnswerResolve
      this.userAnswerResolve = null
      r('（用户已停止调查）')
    }
  }

  private async waitIfPaused() {
    while (this.paused && !this.stopFlag) {
      await new Promise<void>((r) => {
        this.resumeResolve = r
      })
    }
  }

  // ---------- 主入口：POST /research ----------
  async start(focus: string | undefined, maxSteps = 40, maxMinutes = 15) {
    if (this.running) return
    this.running = true
    this.stopFlag = false
    this.paused = false
    this.consecutiveFails = 0

    const b = getBudget(this.sessionId)
    saveBudget(this.sessionId, {
      ...b,
      maxSteps: clamp(Math.round(maxSteps), 1, 200),
      maxMinutes: clamp(Math.round(maxMinutes), 1, 240),
      stepsUsed: 0,
      toolCalls: 0,
      llmCalls: 0,
      startedAt: now(),
      round: b.round + 1,
      elapsedMs: 0,
    })

    let reason = 'completed'
    try {
      reason = await this.mainLoop(focus)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      insertActivity(this.sessionId, { type: 'notice', summary: `调查异常终止: ${msg}`, ok: false })
      broadcast(this.sessionId, 'error', { message: msg })
      this.setPhase(null, 'error')
      this.running = false
      this.emitState()
      return
    }

    // 最终综合 + done（running 保持 true，防止并发新循环）
    let synth: SynthOut | null = null
    try {
      synth = await this.callSynthesizer(true)
    } catch (e) {
      console.error('[final-synthesize]', e)
    }
    this.setPhase('done', 'done')
    const summary = synth?.message_to_user || '本轮调查结束。'
    insertMessage(this.sessionId, { role: 'system', kind: 'notice', content: `调查结束（${reason === 'budget' ? '预算已用尽' : reason === 'stopped' ? '用户停止' : '任务完成'}）：${summary}` })
    const noticeMsg = listMessages(this.sessionId).filter((m) => m.kind === 'notice').pop()
    if (noticeMsg) this.emitMessage(noticeMsg)
    broadcast(this.sessionId, 'done', { reason, summary })
    this.emitState()
    this.running = false
  }

  private async mainLoop(focus: string | undefined): Promise<string> {
    this.setPhase('planning', 'thinking')
    let plan = await this.callPlanner(focus)
    let tasksSinceSynth = 0
    let stepsSinceSynth = 0

    while (this.budgetOK() && !this.stopFlag) {
      await this.waitIfPaused()
      if (this.stopFlag) return 'stopped'

      const task = plan.tasks.find((t) => !t.done)
      if (!task) {
        // 全部任务完成 → 综合判断是否开下一轮
        const synth = await this.callSynthesizer(false)
        const b = getBudget(this.sessionId)
        const enoughBudget = b.maxSteps - b.stepsUsed >= 5 && b.maxMinutes * 60_000 - (b.startedAt ? now() - b.startedAt : 0) > 120_000
        if (!synth?.continue || !enoughBudget) return 'completed'
        plan = await this.callPlanner(synth.next_focus || focus)
        continue
      }

      await this.investigate(task)
      tasksSinceSynth++
      if (this.paused && !this.stopFlag) {
        // 熔断或用户暂停：挂起
        await this.waitIfPaused()
        if (this.stopFlag) return 'stopped'
      }
      if (this.stopFlag) return 'stopped'

      // steering 检查点：吃掉队列
      this.drainSteering()

      if (tasksSinceSynth >= 2 || stepsSinceSynth >= 10) {
        await this.callSynthesizer(false)
        tasksSinceSynth = 0
        stepsSinceSynth = 0
        if (this.stopFlag) return 'stopped'
      }
    }

    if (this.stopFlag) return 'stopped'
    return this.budgetOK() ? 'completed' : 'budget'
  }

  // ---------- 调查内循环（ReAct，每任务最多 8 步） ----------
  private async investigate(task: PlanTask) {
    this.setPhase('investigating', 'running')
    const scratchpad: ScratchEntry[] = []
    let parseFails = 0
    let llmFails = 0
    for (let step = 0; step < 8; step++) {
      if (!this.budgetOK() || this.stopFlag) break
      await this.waitIfPaused()
      if (this.stopFlag) break

      const out = await this.callInvestigator(task, scratchpad)
      if (!out.ok) {
        if (out.kind === 'llm') {
          // LLM 调用失败（429/网络）：退避后重试，宽松熔断（5 次）
          llmFails++
          insertActivity(this.sessionId, { type: 'notice', summary: `LLM 调用失败（${llmFails}/5）：${out.error}`, ok: false })
          await sleep(5000)
          if (llmFails >= 5) {
            this.paused = true
            this.setPhase(null, 'paused')
            broadcast(this.sessionId, 'error', { message: '连续 5 次 LLM 调用失败，调查已熔断暂停。可稍后 POST /control {action:"resume"} 恢复。' })
            return
          }
          continue
        }
        // 解析/结构失败 → 循环级 Reflexion：把纠错反馈写进 scratchpad，改变下一步提示词让模型自愈
        parseFails++
        scratchpad.push({
          thought: '（上一步输出格式错误，需要纠正）',
          action: { tool: '__invalid_output__', args: {} },
          observation:
            'ERROR: 你上一次的输出无法解析为合法的 JSON 动作（不要在 JSON 外加任何说明文字、不要用全角引号、确保字符串内的引号被转义）。请严格输出单个 JSON 对象：{"thought":"...","action":{"tool":"...","args":{...}}}',
        })
        insertActivity(this.sessionId, { type: 'notice', summary: `步骤输出解析失败（${parseFails}/3），已注入纠错反馈`, ok: false })
        if (parseFails >= 3) {
          this.paused = true
          this.setPhase(null, 'paused')
          broadcast(this.sessionId, 'error', { message: '连续 3 步输出解析失败，调查已熔断暂停。可 POST /control {action:"resume"} 恢复。' })
          return
        }
        continue
      }
      llmFails = 0
      parseFails = 0

      const thought = String(out.thought || '').slice(0, 500)
      broadcast(this.sessionId, 'thought', { step, text: thought })
      insertActivity(this.sessionId, { type: 'thought', summary: oneLine(thought, 200), step })

      const a = out.action || {}
      const toolName = String(a.tool || '')
      const args = a.args || {}

      if (toolName === 'finish_task') {
        task.done = true
        task.summary = String(args.summary || '').slice(0, 400)
        this.persistTask(task)
        this.persistStep()
        insertActivity(this.sessionId, { type: 'notice', summary: `任务完成: ${oneLine(task.goal, 80)} — ${oneLine(task.summary || '', 150)}` })
        return
      }

      if (toolName === 'ask_user') {
        const answer = await this.askUser(String(args.question || ''), args.context ? String(args.context) : undefined)
        if (this.stopFlag) return
        scratchpad.push({
          thought: thought || '向用户提问，等待补充信息',
          action: { tool: 'ask_user', args: { question: args.question } },
          observation: `USER_INPUT: ${answer}`,
        })
        continue // 不耗预算
      }

      // 通用工具执行（外部检索 + 图操作）
      const obs = await this.runTool(toolName, args, step)
      scratchpad.push({ thought, action: { tool: toolName, args }, observation: truncObs(obs) })

      const b = getBudget(this.sessionId)
      b.stepsUsed++
      saveBudget(this.sessionId, b)
      this.persistStep()
    }
    // 达到步数上限也算完成（summary 可为空）
    if (!task.done) {
      task.done = true
      this.persistTask(task)
    }
  }

  /** 把内存中 task 的 done/summary 合并回 DB 的 plan（checkpoint） */
  private persistTask(task: PlanTask) {
    const p = getPlan(this.sessionId)
    if (!p) return
    const t = p.tasks.find((x) => x.id === task.id) ?? p.tasks.find((x) => x.goal === task.goal)
    if (t) {
      t.done = task.done
      t.summary = task.summary
    }
    savePlan(this.sessionId, p)
  }

  // ---------- 工具执行（含 tool_call/tool_result 事件） ----------
  private async runTool(toolName: string, args: any, step: number): Promise<unknown> {
    const callId = uuid()
    broadcast(this.sessionId, 'tool_call', { callId, tool: toolName, args, step })
    insertActivity(this.sessionId, { type: 'tool_call', tool: toolName, summary: `调用 ${toolName} ${oneLine(JSON.stringify(args), 120)}`, step })
    const t0 = now()
    let obs: unknown
    try {
      const graph = this.runGraphTool(toolName, args)
      if (graph) {
        obs = graph
      } else {
        const spec = findExternalTool(toolName)
        if (!spec) {
          obs = { error: `未知工具: ${toolName}`, available: [...EXTERNAL_TOOL_NAMES, ...GRAPH_TOOL_NAMES] }
        } else {
          obs = await spec.run(args)
          const b = getBudget(this.sessionId)
          b.toolCalls++
          saveBudget(this.sessionId, b)
        }
      }
    } catch (e) {
      obs = { error: e instanceof Error ? e.message : String(e) }
    }
    const dur = now() - t0
    const ok = !(obs && typeof obs === 'object' && !Array.isArray(obs) && (obs as any).error != null)
    const summary = oneLine(typeof obs === 'string' ? obs : JSON.stringify(obs), 200)
    broadcast(this.sessionId, 'tool_result', { callId, tool: toolName, ok, summary, durationMs: dur, step })
    insertActivity(this.sessionId, { type: 'tool_result', tool: toolName, ok, summary, durationMs: dur, step })
    return obs
  }

  // ---------- 图操作工具（直接落库） ----------
  private runGraphTool(toolName: string, args: any): unknown | null {
    if (toolName === 'add_evidence') return this.toolAddEvidence(args)
    if (toolName === 'link_evidence') return this.toolLinkEvidence(args)
    if (toolName === 'update_evidence') return this.toolUpdateEvidence(args)
    if (toolName === 'note_gap') return this.toolNoteGap(args)
    return null
  }

  private toolAddEvidence(args: any) {
    const kind = String(args.kind || 'evidence') as BoardNode['kind']
    if (!NODE_KINDS.includes(kind)) return { error: `非法 kind: ${kind}（合法值: ${NODE_KINDS.join('/')}）` }
    const title = String(args.title || '').trim()
    if (!title) return { error: '缺少 title' }
    const content = String(args.content || '').trim()
    if (!content) return { error: '缺少 content' }
    const tags = Array.isArray(args.tags) ? args.tags.map(String).slice(0, 6) : []
    const confidence = args.confidence != null ? clamp(Number(args.confidence), 0, 1) : null

    // 同 title 节点 → 更新
    const existing = findNodeByTitle(this.sessionId, title)
    if (existing) {
      updateNodeContent(this.sessionId, existing.id, content, confidence, args.sourceRef ? String(args.sourceRef) : null, args.sourceUrl ? String(args.sourceUrl) : null)
      this.emitState()
      return { ok: true, updated: true, nodeId: existing.id, title: existing.title }
    }
    const node = insertNode(this.sessionId, {
      kind,
      title,
      content,
      tags,
      sourceUrl: args.sourceUrl ? String(args.sourceUrl) : null,
      sourceRef: args.sourceRef ? String(args.sourceRef) : null,
      confidence,
      pinnedBy: 'agent',
    })
    insertActivity(this.sessionId, { type: 'notice', summary: `新增证据节点 [${kind}] ${node.title}` })
    this.emitState()
    return { ok: true, nodeId: node.id, title: node.title }
  }

  private toolLinkEvidence(args: any) {
    const from = String(args.from || '').trim()
    const to = String(args.to || '').trim()
    const relation = String(args.relation || 'relates') as any
    if (!from || !to) return { error: '缺少 from/to' }
    if (!EDGE_RELATIONS.includes(relation)) return { error: `非法 relation: ${relation}（合法值: ${EDGE_RELATIONS.join('/')}）` }

    const nodes = listNodes(this.sessionId)
    const resolve = (q: string): BoardNode | null => {
      if (!q) return null
      // 1. id 精确
      const byId = nodes.find((n) => n.id === q)
      if (byId) return byId
      // 2. 标题精确（忽略大小写与空白）
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
      const t = norm(q)
      const exact = nodes.find((n) => norm(n.title) === t)
      if (exact) return exact
      // 3. 子串包含 → 多命中取最新
      const contains = nodes.filter((n) => norm(n.title).includes(t) || t.includes(norm(n.title)))
      if (contains.length) return contains[contains.length - 1]
      return null
    }

    const srcNode = resolve(from)
    const dstNode = resolve(to)
    if (!srcNode || !dstNode) {
      const candidates = nodes.slice(-20).map((n) => n.title)
      return { error: `未找到节点（${!srcNode ? `from: ${from}` : `to: ${to}`}）`, candidates }
    }
    if (srcNode.id === dstNode.id) return { error: '不能连接节点自身' }

    // 语义方向矫正：answers 应由假说/证据指向问题；若模型给反了则自动翻转
    let finalSrc = srcNode
    let finalDst = dstNode
    if (relation === 'answers' && srcNode.kind === 'question' && dstNode.kind !== 'question') {
      finalSrc = dstNode
      finalDst = srcNode
    }

    const edge = insertEdge(this.sessionId, finalSrc.id, finalDst.id, relation, args.label ? String(args.label) : null)
    if (!edge) return { ok: true, deduped: true, note: '该关系边已存在' }
    insertActivity(this.sessionId, { type: 'notice', summary: `连接 ${finalSrc.title} --${relation}--> ${finalDst.title}` })
    this.emitState()
    return { ok: true, edgeId: edge.id }
  }

  private toolUpdateEvidence(args: any) {
    const title = String(args.title || '').trim()
    if (!title) return { error: '缺少 title' }
    const node = findNodeByTitle(this.sessionId, title)
    if (!node) {
      const candidates = listNodes(this.sessionId).slice(-20).map((n) => n.title)
      return { error: '未找到节点', candidates }
    }
    const patch = args.patch || {}
    updateNode(this.sessionId, node.id, {
      confidence: patch.confidence != null ? clamp(Number(patch.confidence), 0, 1) : undefined,
      content: patch.content != null ? String(patch.content) : undefined,
      status: patch.status != null ? String(patch.status) : undefined,
      tags: Array.isArray(patch.tags) ? patch.tags.map(String) : undefined,
    })
    this.emitState()
    return { ok: true }
  }

  private toolNoteGap(args: any) {
    const question = String(args.question || '').trim()
    if (!question) return { error: '缺少 question' }
    const why = String(args.why || '').trim()
    const node = insertNode(this.sessionId, { kind: 'gap', title: question, content: why, pinnedBy: 'agent' })
    insertActivity(this.sessionId, { type: 'notice', summary: `记录待查空白: ${node.title}` })
    this.emitState()
    return { ok: true, nodeId: node.id }
  }

  // ---------- ask_user：挂起等待（不耗预算） ----------
  private async askUser(question: string, context?: string): Promise<string> {
    if (!question) return '（Agent 提问为空）'
    const msg = insertMessage(this.sessionId, {
      role: 'assistant',
      kind: 'question',
      content: question,
      data: context ? { context } : null,
    })
    this.emitMessage(msg)
    const meta = getMeta(this.sessionId)
    saveMeta(this.sessionId, { ...meta, pendingQuestion: question })
    this.setPhase('awaiting_user', 'awaiting_user')
    insertActivity(this.sessionId, { type: 'notice', summary: `等待用户回答: ${oneLine(question, 150)}` })

    const answer = await new Promise<string>((resolve) => {
      this.userAnswerResolve = resolve
    })
    // 恢复调查
    this.setPhase('investigating', 'running')
    return answer
  }

  /** chat 端点调用：awaiting_user 时注入用户回答并恢复 */
  injectUserAnswer(answer: string) {
    if (this.userAnswerResolve) {
      const r = this.userAnswerResolve
      this.userAnswerResolve = null
      r(answer)
      return true
    }
    return false
  }

  // ---------- steering ----------
  drainSteering() {
    if (!this.steeringQueue.length) return
    const items = this.steeringQueue.splice(0)
    for (const it of items) {
      const msg = insertMessage(this.sessionId, { role: 'system', kind: 'steer_ack', content: `已纳入调查线索：${it.slice(0, 120)}` })
      this.emitMessage(msg)
    }
    insertActivity(this.sessionId, { type: 'notice', summary: `纳入 ${items.length} 条用户补充线索` })
  }

  private steeringBlock(): string {
    const steers = listMessages(this.sessionId).filter((m) => m.kind === 'steer').slice(-10)
    if (!steers.length) return ''
    return steers.map((m) => `- ${m.content.slice(0, 300)}`).join('\n')
  }

  // ---------- 四张面孔 ----------
  private async callPlanner(focus: string | undefined): Promise<Plan> {
    const meta = getMeta(this.sessionId)
    const s = meta.signals
    const msgs = listMessages(this.sessionId).filter(
      (m) => (m.kind === 'chat' || m.kind === 'steer') && (m.role === 'user' || m.role === 'assistant')
    )
    const userBlock = [
      '【用户画像】',
      `topic: ${s.topic || '未知'}；organism: ${s.organism || '未知'}；scale: ${s.scale || '未知'}；mechanism_interest: ${s.mechanism_interest || '未知'}；method_context: ${s.method_context || '未知'}`,
      '【用户消息精选】',
      ...msgs.slice(-20).map((m) => `${m.role}(${m.kind}): ${m.content.slice(0, 200)}`),
    ].join('\n')

    const wall = wallSummary(this.sessionId)
    const prevPlan = getPlan(this.sessionId)
    const doneTasks = (prevPlan?.tasks || []).filter((t) => t.done)
    const doneBlock = doneTasks.length
      ? '【已完成任务】\n' + doneTasks.map((t) => `- ${t.goal} → ${t.summary || '（无小结）'}`).join('\n')
      : '【已完成任务】无'

    const focusBlock = focus
      ? `【本轮用户指定聚焦点】${focus}`
      : prevPlan?.focusQuestion
        ? `【上轮聚焦问题】${prevPlan.focusQuestion}`
        : ''

    const userPrompt = [
      userBlock,
      `【证据墙摘要】\n${wall}`,
      doneBlock,
      `【剩余预算】${this.remainingText()}`,
      focusBlock,
      '请输出严格 JSON 计划。',
    ]
      .filter(Boolean)
      .join('\n\n')

    const res = await llmJson<any>(PLANNER_PROMPT, userPrompt, () => this.countLlm())
    if (!res.ok) {
      insertActivity(this.sessionId, { type: 'notice', summary: `规划失败: ${res.error}`, ok: false })
      // 兜底计划
      const budget = getBudget(this.sessionId)
      const fallback: Plan = {
        round: budget.round,
        focusQuestion: focus || prevPlan?.focusQuestion || s.topic || '探索用户兴趣主题',
        tasks: [
          {
            id: 't1',
            goal: `检索并梳理「${focus || s.topic || '用户主题'}」的核心文献`,
            why: '建立基础证据',
            queries: [`${s.topic || focus || 'biology'} review`],
            toolsHint: ['pubmed_search'],
            expectedEvidence: '综述类证据',
            done: false,
          },
        ],
        hypotheses: [],
      }
      savePlan(this.sessionId, fallback)
      broadcast(this.sessionId, 'plan', { plan: fallback })
      this.emitState()
      return fallback
    }

    const j = res.value
    const budget = getBudget(this.sessionId)
    const rawTasks = Array.isArray(j.tasks) ? j.tasks.slice(0, 5) : []
    const plan: Plan = {
      round: budget.round,
      focusQuestion: String(j.focus_question || focus || s.topic || '核心问题待定'),
      tasks: rawTasks.map((t: any, i: number) => ({
        id: String(t.id || `t${i + 1}`),
        goal: String(t.goal || `任务 ${i + 1}`),
        why: String(t.why || ''),
        queries: Array.isArray(t.queries) ? t.queries.map(String) : [],
        toolsHint: Array.isArray(t.tools_hint) ? t.tools_hint.map(String) : [],
        expectedEvidence: String(t.expected_evidence || ''),
        done: false,
      })),
      hypotheses: Array.isArray(j.hypotheses)
        ? j.hypotheses.map((h: any) => ({ title: String(h.title || ''), basis: String(h.basis || '') }))
        : [],
    }
    savePlan(this.sessionId, plan)
    broadcast(this.sessionId, 'plan', { plan })
    insertActivity(this.sessionId, { type: 'notice', summary: `生成调查计划（${plan.tasks.length} 个任务）: ${oneLine(plan.focusQuestion, 150)}` })
    this.emitState()
    return plan
  }

  private async callInvestigator(
    task: PlanTask,
    scratchpad: ScratchEntry[]
  ): Promise<
    | { ok: true; thought: string; action: { tool: string; args: any } }
    | { ok: false; kind: 'llm' | 'parse'; error: string }
  > {
    const row = getSessionRow(this.sessionId)
    const b = getBudget(this.sessionId)
    const systemPrompt = buildInvestigatorPrompt({
      goal: task.goal,
      why: task.why,
      wallSummary: wallSummary(this.sessionId).slice(0, 3000),
      narrative: row?.narrative || '',
      steering: this.steeringBlock(),
      toolsDoc: toolsDoc(true),
      remainingSteps: Math.max(0, b.maxSteps - b.stepsUsed),
      remainingMinutes: Math.max(0, Math.round((b.maxMinutes * 60_000 - (b.startedAt ? now() - b.startedAt : 0)) / 60_000)),
    })
    const userPrompt = `# 调查历史（thought → action → observation）\n${serializeScratchpad(scratchpad)}\n\n请输出下一步的严格 JSON（{"thought":"...","action":{"tool":"...","args":{...}}}）。\n提醒：已确认的关键事实请尽快 add_evidence 落到证据墙（预算耗尽后未落墙的检索成果将丢失）；剩余预算紧张时应优先落墙与 finish_task，而非继续检索。`
    const res = await llmJson<any>(systemPrompt, userPrompt, () => this.countLlm())
    if (!res.ok) {
      const isLlmFailure = /LLM (重试)?调用失败/.test(res.error)
      return { ok: false, kind: isLlmFailure ? 'llm' : 'parse', error: res.error }
    }
    const v = res.value
    if (!v || !v.action || typeof v.action.tool !== 'string') {
      return { ok: false, kind: 'parse', error: '输出缺少 action.tool 字段' }
    }
    return { ok: true, thought: String(v.thought || ''), action: { tool: v.action.tool, args: v.action.args || {} } }
  }

  async callSynthesizer(final: boolean): Promise<SynthOut | null> {
    this.setPhase('synthesizing', 'thinking')
    const plan = getPlan(this.sessionId)
    const nodes = listNodes(this.sessionId)
    const edges = listEdges(this.sessionId)
    const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title || id

    const doneTasks = (plan?.tasks || []).filter((t) => t.done)
    const steers = listMessages(this.sessionId).filter((m) => m.kind === 'steer').slice(-10)

    const userPrompt = [
      `【核心问题】${plan?.focusQuestion || '（尚未明确）'}`,
      `【假说】${(plan?.hypotheses || []).map((h) => `- ${h.title}（依据: ${h.basis}）`).join('\n') || '（无）'}`,
      `【证据节点】\n${nodes.map((n) => `- [${n.kind}] ${n.title}: ${n.content}${n.sourceRef ? ` [${n.sourceRef}]` : n.sourceUrl ? ` [${n.sourceUrl}]` : ''}${n.confidence != null ? ` (置信度 ${n.confidence})` : ''}`).join('\n') || '（无）'}`,
      `【证据关系】\n${edges.map((e) => `- ${titleOf(e.source)} --${e.relation}--> ${titleOf(e.target)}`).join('\n') || '（无）'}`,
      `【已完成任务小结】\n${doneTasks.map((t) => `- ${t.goal} → ${t.summary || '（无小结）'}`).join('\n') || '（无）'}`,
      `【调查期间用户的补充消息】\n${steers.map((m) => `- ${m.content.slice(0, 300)}`).join('\n') || '（无）'}`,
      final ? '这是本轮调查的最终结案陈词（调查即将结束），continue 请置 false。' : `这是阶段性综合。剩余预算：${this.remainingText()}。`,
      '请输出严格 JSON。',
    ].join('\n\n')

    const res0 = await llmJson<any>(SYNTHESIZER_PROMPT, userPrompt, () => this.countLlm())
    // 结案陈词是关键调用：退避重试（429 限流常见），最多 3 轮
    let res = res0
    if (!res.ok) {
      for (let i = 1; i <= 2; i++) {
        insertActivity(this.sessionId, { type: 'notice', summary: `综合失败（${res.error.slice(0, 80)}），${20 * i}s 后重试 ${i}/2`, ok: false })
        await sleep(20_000 * i)
        res = await llmJson<any>(SYNTHESIZER_PROMPT, userPrompt, () => this.countLlm())
        if (res.ok) break
      }
    }
    if (!res.ok) {
      insertActivity(this.sessionId, { type: 'notice', summary: `综合失败: ${res.error}`, ok: false })
      return null
    }
    const v: SynthOut = res.value

    // narrative 落库
    if (v.narrative_md) updateSessionFields(this.sessionId, { narrative: String(v.narrative_md) })
    // questions 替换
    if (Array.isArray(v.questions)) {
      replaceQuestions(this.sessionId, v.questions.slice(0, 5).map((q: any) => ({
        text: String(q.text || ''),
        rationale: String(q.rationale || ''),
        scores: {
          novelty: clamp(Math.round(Number(q.scores?.novelty) || 3), 1, 5),
          feasibility: clamp(Math.round(Number(q.scores?.feasibility) || 3), 1, 5),
          impact: clamp(Math.round(Number(q.scores?.impact) || 3), 1, 5),
        },
        recommended: !!q.recommended,
        evidenceRefs: Array.isArray(q.evidence_refs) ? q.evidence_refs.map(String) : [],
      })))
    }
    // graph_ops 执行（update_evidence / add_evidence / link_evidence）
    if (Array.isArray(v.graph_ops)) {
      for (const op of v.graph_ops.slice(0, 24)) {
        try {
          if (op?.op === 'update_evidence' && op.title) {
            this.toolUpdateEvidence({ title: String(op.title), patch: op.patch || {} })
          } else if (op?.op === 'add_evidence' && op.title) {
            // add_evidence 按 title 去重，检查点重复执行安全
            this.toolAddEvidence({
              kind: op.kind || 'hypothesis',
              title: String(op.title),
              content: String(op.content || ''),
              sourceRef: op.sourceRef ? String(op.sourceRef) : undefined,
              sourceUrl: op.sourceUrl ? String(op.sourceUrl) : undefined,
              confidence: op.confidence,
            })
          } else if (op?.op === 'link_evidence' && op.from && op.to) {
            this.toolLinkEvidence({
              from: String(op.from),
              to: String(op.to),
              relation: op.relation || 'relates',
              label: op.label ? String(op.label) : undefined,
            })
          }
        } catch {
          // 单个 graph_op 失败不影响其余
        }
      }
    }
    // 汇报消息
    if (v.message_to_user) {
      const msg = insertMessage(this.sessionId, { role: 'assistant', kind: 'synthesis', content: String(v.message_to_user) })
      this.emitMessage(msg)
    }
    insertActivity(this.sessionId, { type: 'notice', summary: `综合分析完成${final ? '（结案）' : '（阶段）'}` })
    this.emitState()
    return v
  }

  // ---------- 访谈链路（chat） ----------
  get interviewLocked(): boolean {
    return this.interviewBusy
  }

  async interviewTurn(text: string): Promise<ChatMessage | null> {
    if (this.interviewBusy) return null
    this.interviewBusy = true
    try {
      // 1. 用户消息落库
      const userMsg = insertMessage(this.sessionId, { role: 'user', kind: 'chat', content: text })
      this.emitMessage(userMsg)

      // 2. 构建 prompt：对话记录（不含本次）+ 本次用户消息
      const history = listMessages(this.sessionId)
        .filter((m) => m.kind === 'chat' && (m.role === 'user' || m.role === 'assistant') && m.id !== userMsg.id)
        .slice(-24)
      const dialogue = history.map((m) => `${m.role}: ${m.content}`).join('\n')
      const userPrompt = `【对话记录】\n${dialogue || '（无）'}\n\n【本次用户消息】\n${text}`

      // 3. LLM 调用
      const res = await llmJson<any>(INTERVIEWER_PROMPT, userPrompt, () => this.countLlm())
      if (!res.ok) {
        const errMsg = insertMessage(this.sessionId, {
          role: 'assistant',
          kind: 'notice',
          content: '（访谈者思考暂时不可用，请稍后重试）',
        })
        this.emitMessage(errMsg)
        return errMsg
      }
      const v = res.value
      const reply = String(v.reply || '能再多说一点吗？你提到的东西里，哪一处最让你意外？')

      // 4. 更新 meta（signals 累积合并 / ready / title_suggestion）
      const meta = getMeta(this.sessionId)
      const sig = { ...meta.signals }
      const ex = v.extracted || {}
      for (const key of ['topic', 'organism', 'scale', 'mechanism_interest', 'method_context'] as const) {
        const nv = String(ex[key] || '').trim()
        if (nv) sig[key] = nv
      }
      const ready = meta.ready || !!v.ready
      const titleSuggestion = v.title_suggestion ? String(v.title_suggestion).trim() : meta.title_suggestion || ''
      saveMeta(this.sessionId, { ...meta, ready, signals: sig, title_suggestion: titleSuggestion, pendingQuestion: reply })

      // ready 时更新会话标题（若仍是默认标题）
      const row = getSessionRow(this.sessionId)
      if (ready && titleSuggestion && row && (row.title === '新调查' || !row.title)) {
        updateSessionFields(this.sessionId, { title: titleSuggestion.slice(0, 80) })
      }

      // 5. 回复落库 kind='chat'，data 携带 ready/title 变化
      const data: Record<string, unknown> | null = ready ? { ready: true, title: titleSuggestion || row?.title } : null
      const msg = insertMessage(this.sessionId, { role: 'assistant', kind: 'chat', content: reply, data })
      this.emitMessage(msg)
      this.emitState()
      return msg
    } finally {
      this.interviewBusy = false
    }
  }
}
