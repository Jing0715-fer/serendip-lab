// runtime.ts — AgentRuntime 状态机（§6：ReAct + 事件流 + LangGraph 检查点 + AutoGPT 预算 + Reflexion 自愈）
import { broadcast } from './emitter'
import {
  getBudget, saveBudget, getMeta, saveMeta, getPlan, savePlan,
  listNodes, listEdges, listMessages, listQuestions,
  insertMessage, insertActivity, updateSessionFields, getSessionRow,
  findNodeByTitle, insertNode, updateNode, updateNodeContent, insertEdge,
  replaceQuestions, deleteStaleTopicNodes, computeStats, NODE_KINDS, EDGE_RELATIONS, EVIDENCE_LEVELS,
  type SessionPhase, type AgentStatus, type Plan, type PlanTask,
  type BoardNode, type ChatMessage, type ResearchQuestion, type EvidenceLevel,
} from './db'
import { llmJson } from './llm'
import { INTERVIEWER_PROMPT, PLANNER_PROMPT, SYNTHESIZER_PROMPT, buildInvestigatorPrompt } from './prompts'
import { getSessionLang, langDirective, noticeFor, type Lang } from './lang'
import { findExternalTool, toolsDoc } from './tools'
import { uuid, now, truncObs, oneLine, clamp, sleep } from './util'

const EXTERNAL_TOOL_NAMES = [
  'pubmed_search', 'pubmed_fetch', 'europepmc_search', 'openalex_search',
  'uniprot_search', 'ncbi_gene', 'pdb_search', 'taxonomy_search',
  'clinvar_search', 'web_search', 'web_read',
]
const GRAPH_TOOL_NAMES = ['add_evidence', 'link_evidence', 'update_evidence', 'note_gap', 'ask_user', 'finish_task']

/** 访谈就绪后自动开启自主调研的延迟：留一小窗口给用户继续补充/细化需求 */
const AUTO_START_DELAY_MS = 6_000
/** 自动开启自主调研的默认预算（标准调研档） */
const AUTO_START_BUDGET = { maxSteps: 40, maxMinutes: 15 } as const

/** 默认会话标题（任何一种都允许被 title_suggestion 覆盖） */
const DEFAULT_SESSION_TITLES = ['新调查', '新课题', 'New Project']

/** 归一化证据等级：严格匹配六个合法值，否则 null（未定级）；非法值一律落 null */
function normalizeLevel(v: unknown): EvidenceLevel | null {
  const s = String(v ?? '').trim().toLowerCase()
  return (EVIDENCE_LEVELS as string[]).includes(s) ? (s as EvidenceLevel) : null
}

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

/** 按会话语言取双语文案（活动时间线 insertActivity 用，EN 会话不再混中文） */
function L(sessionId: string, zh: string, en: string): string {
  return getSessionLang(sessionId) === 'en' ? en : zh
}

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
  if (!pad.length) return '（研究刚刚开始，尚无历史观察）'
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

/** 按标题解析节点（id 精确 → 规范化标题精确 → 子串包含取最新），link_evidence 与课题卡连线共用 */
export function resolveNodeByTitle(nodes: BoardNode[], q: string): BoardNode | null {
  if (!q) return null
  const byId = nodes.find((n) => n.id === q)
  if (byId) return byId
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const t = norm(q)
  const exact = nodes.find((n) => norm(n.title) === t)
  if (exact) return exact
  const contains = nodes.filter((n) => norm(n.title).includes(t) || t.includes(norm(n.title)))
  if (contains.length) return contains[contains.length - 1]
  return null
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
  /** 访谈 ready 后的自动开研究定时器（新用户消息可打断取消） */
  private autoStartTimer: ReturnType<typeof setTimeout> | null = null

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

  /** 停止并从实例表移除（会话删除时调用，防 Map 无限增长） */
  static dispose(sessionId: string) {
    const rt = AgentRuntime.runtimes.get(sessionId)
    if (rt) {
      rt.stop()
      AgentRuntime.runtimes.delete(sessionId)
    }
  }

  /** 清理会话已不存在且不在运行的死实例（心跳周期调用） */
  static reapDead() {
    for (const [id, rt] of AgentRuntime.runtimes) {
      if (!rt.running && !getSessionRow(id)) AgentRuntime.runtimes.delete(id)
    }
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
    insertActivity(this.sessionId, { type: 'phase', summary: `→ ${row?.phase ?? '?'} / ${status}` })
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
    const elapsed = b.startedAt ? now() - b.startedAt : b.elapsedMs
    return `${Math.max(0, b.maxSteps - b.stepsUsed)} 步 / ${Math.max(0, Math.round((b.maxMinutes * 60_000 - elapsed) / 60_000))} 分钟`
  }

  private persistStep() {
    // checkpoint：预算 + 计划（任务 done 状态）落库，然后广播全量 state
    const b = getBudget(this.sessionId)
    b.elapsedMs = b.startedAt ? now() - b.startedAt : b.elapsedMs
    saveBudget(this.sessionId, b)
    const p = getPlan(this.sessionId)
    if (p) savePlan(this.sessionId, p)
    this.emitState()
  }

  // ---------- 控制 ----------
  pause() {
    if (!this.running) return
    this.paused = true
    // P2 修复：冻结预算时钟 —— 已耗时固化进 elapsedMs、startedAt 置空，
    // 否则暂停 20 分钟后 resume，循环顶部预算即耗尽直接收尾
    const b = getBudget(this.sessionId)
    if (b.startedAt) {
      b.elapsedMs = now() - b.startedAt
      b.startedAt = null
      saveBudget(this.sessionId, b)
    }
    this.setPhase(null, 'paused')
  }

  resume() {
    this.paused = false
    // P2 修复：从累计时长续走预算时钟
    if (this.running) {
      const b = getBudget(this.sessionId)
      if (!b.startedAt) {
        b.startedAt = now() - b.elapsedMs
        saveBudget(this.sessionId, b)
      }
    }
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
    this.cancelAutoStart()
    if (this.resumeResolve) {
      const r = this.resumeResolve
      this.resumeResolve = null
      r()
    }
    if (this.userAnswerResolve) {
      const r = this.userAnswerResolve
      this.userAnswerResolve = null
      r(getSessionLang(this.sessionId) === 'en' ? '(user stopped the research)' : '（用户已停止研究）')
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
      insertActivity(this.sessionId, { type: 'notice', summary: `研究异常终止: ${msg}`, ok: false })
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
    const runLang = getSessionLang(this.sessionId)
    const summary = synth?.message_to_user || (runLang === 'en' ? 'This research run has ended.' : '本轮研究结束。')
    const reasonText = runLang === 'en'
      ? (reason === 'budget' ? 'budget exhausted' : reason === 'stopped' ? 'stopped by user' : 'completed')
      : (reason === 'budget' ? '预算已用尽' : reason === 'stopped' ? '用户停止' : '任务完成')
    insertMessage(this.sessionId, { role: 'system', kind: 'notice', content: runLang === 'en' ? `Research run ended (${reasonText}): ${summary}` : `研究结束（${reasonText}）：${summary}` })
    const noticeMsg = listMessages(this.sessionId).filter((m) => m.kind === 'notice').pop()
    if (noticeMsg) this.emitMessage(noticeMsg)
    broadcast(this.sessionId, 'done', { reason, summary })
    this.emitState()
    this.running = false
  }

  // ---------- 重综合（Task 20）：证据墙变化后无需重跑研究，直接重新生成综述 ----------
  async resynthesize(): Promise<{ ok: boolean; error?: string }> {
    if (this.running) return { ok: false, error: 'agent_busy' }
    if (listNodes(this.sessionId).length === 0) return { ok: false, error: 'no_evidence' }
    this.running = true
    try {
      insertActivity(this.sessionId, { type: 'notice', summary: noticeFor(getSessionLang(this.sessionId), 'resynthesizeStart') })
      await this.callSynthesizer(true)
      this.setPhase('done', 'done')
      this.emitState()
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      insertActivity(this.sessionId, { type: 'notice', summary: `重综合失败: ${msg}`, ok: false })
      this.setPhase(null, 'error')
      return { ok: false, error: msg }
    } finally {
      this.running = false
    }
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
        const elapsed = b.startedAt ? now() - b.startedAt : b.elapsedMs
        const enoughBudget = b.maxSteps - b.stepsUsed >= 5 && b.maxMinutes * 60_000 - elapsed > 120_000
        if (!synth?.continue || !enoughBudget) return 'completed'
        plan = await this.callPlanner(synth.next_focus || focus)
        continue
      }

      const stepsBefore = getBudget(this.sessionId).stepsUsed
      await this.investigate(task)
      tasksSinceSynth++
      // P2 修复：按实际消耗步数同步自增（原实现从不 ++，步数触发的阶段性综合是死逻辑）
      stepsSinceSynth += getBudget(this.sessionId).stepsUsed - stepsBefore
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

  // ---------- 访谈就绪 → 自动开启自主调研（Task 14 新流程） ----------

  /** 取消尚未触发的自动开研究（新用户消息 / stop / dispose 时调用） */
  private cancelAutoStart() {
    if (this.autoStartTimer) {
      clearTimeout(this.autoStartTimer)
      this.autoStartTimer = null
    }
  }

  /**
   * 访谈信息充足（ready 翻转）后：发系统预告 → 延迟数秒自动 start()。
   * 延迟窗口内用户再发言会走 interviewTurn 入口的 cancelAutoStart()，继续细化需求；
   * 触发时再校验会话存在、未在运行、未停止，避免旧定时器误启动。
   */
  private scheduleAutoResearch(focusSeed: string | undefined) {
    this.cancelAutoStart()
    const lang = getSessionLang(this.sessionId)
    const notice = insertMessage(this.sessionId, {
      role: 'system',
      kind: 'notice',
      content: noticeFor(lang, 'autoResearchArmed', { sec: Math.round(AUTO_START_DELAY_MS / 1000) }),
      data: { autoStart: true, delayMs: AUTO_START_DELAY_MS },
    })
    this.emitMessage(notice)
    insertActivity(this.sessionId, { type: 'notice', summary: noticeFor(lang, 'autoResearchArmedShort') })

    this.autoStartTimer = setTimeout(() => {
      this.autoStartTimer = null
      const row = getSessionRow(this.sessionId)
      if (!row || this.running || this.stopFlag) return
      const meta = getMeta(this.sessionId)
      const focus = focusSeed || meta.title_suggestion || meta.signals.topic || undefined
      console.log(`[auto-research] session=${this.sessionId} focus=${focus || '(auto)'}`)
      const startMsg = insertMessage(this.sessionId, {
        role: 'system',
        kind: 'notice',
        content: noticeFor(getSessionLang(this.sessionId), 'autoResearchStart'),
        data: { autoStarted: true },
      })
      this.emitMessage(startMsg)
      void this.start(focus, AUTO_START_BUDGET.maxSteps, AUTO_START_BUDGET.maxMinutes)
    }, AUTO_START_DELAY_MS)
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
          // LLM 调用失败：429 限流 → 递增等待（20s/40s/60s/80s/90s）自愈，其他错误固定 5s；宽松熔断（5 次）
          llmFails++
          const isRateLimit = /\b429\b|too many requests|rate.?limit/i.test(out.error)
          const waitMs = isRateLimit ? Math.min(20_000 * llmFails, 90_000) : 5_000
          insertActivity(this.sessionId, { type: 'notice', summary: `${L(this.sessionId,
            isRateLimit ? `API 限流，${Math.round(waitMs / 1000)}s 后自动重试（第 ${llmFails}/5 次）` : `LLM 调用失败（${llmFails}/5），5s 后重试`,
            isRateLimit ? `API rate-limited — auto retry in ${Math.round(waitMs / 1000)}s (attempt ${llmFails}/5)` : `LLM call failed (${llmFails}/5), retry in 5s`)}: ${out.error}`, ok: false })
          await sleep(waitMs)
          if (llmFails >= 5) {
            this.paused = true
            this.setPhase(null, 'paused')
            broadcast(this.sessionId, 'error', { message: getSessionLang(this.sessionId) === 'en' ? '5 consecutive LLM failures — the run is paused. POST /control {action:"resume"} to recover.' : '连续 5 次 LLM 调用失败，研究已熔断暂停。可稍后 POST /control {action:"resume"} 恢复。' })
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
        insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
          `步骤输出解析失败（${parseFails}/3），已注入纠错反馈`,
          `Step output parse failure (${parseFails}/3) — corrective feedback injected`), ok: false })
        if (parseFails >= 3) {
          this.paused = true
          this.setPhase(null, 'paused')
          broadcast(this.sessionId, 'error', { message: getSessionLang(this.sessionId) === 'en' ? '3 consecutive parse failures — the run is paused. POST /control {action:"resume"} to recover.' : '连续 3 步输出解析失败，研究已熔断暂停。可 POST /control {action:"resume"} 恢复。' })
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
        insertActivity(this.sessionId, { type: 'notice', summary: `${L(this.sessionId, '任务完成', 'Task completed')}: ${oneLine(task.goal, 80)} — ${oneLine(task.summary || '', 150)}` })
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
    insertActivity(this.sessionId, { type: 'tool_call', tool: toolName, summary: `→ ${toolName} ${oneLine(JSON.stringify(args), 120)}`, step })
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
    // Task 20 打磨：证据等级只对 evidence/source 卡有意义（研究类型分级），
    // 假说/洞见/课题等语句型卡片不带 level，防止语义泄漏（真实测试发现 hypothesis 被标 animal）
    const level = kind === 'evidence' || kind === 'source' ? normalizeLevel(args.level) : null

    // 同 title 节点 → 更新
    const existing = findNodeByTitle(this.sessionId, title)
    if (existing) {
      updateNodeContent(
        this.sessionId, existing.id, content, confidence,
        args.sourceRef ? String(args.sourceRef) : null,
        args.sourceUrl ? String(args.sourceUrl) : null,
        args.detail ? String(args.detail) : null,
        level
      )
      this.emitState()
      return { ok: true, updated: true, nodeId: existing.id, title: existing.title }
    }
    const node = insertNode(this.sessionId, {
      kind,
      title,
      content,
      detail: args.detail ? String(args.detail) : null,
      tags,
      sourceUrl: args.sourceUrl ? String(args.sourceUrl) : null,
      sourceRef: args.sourceRef ? String(args.sourceRef) : null,
      confidence,
      level,
      pinnedBy: 'agent',
    })
    insertActivity(this.sessionId, { type: 'notice', summary: `${L(this.sessionId, '新增证据节点', 'New card pinned')} [${kind}] ${node.title}` })
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
    const resolve = (q: string): BoardNode | null => resolveNodeByTitle(nodes, q)

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
    insertActivity(this.sessionId, { type: 'notice', summary: `${L(this.sessionId, '连接', 'Link')} ${finalSrc.title} --${relation}--> ${finalDst.title}` })
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
      level:
        patch.level !== undefined
          ? node.kind === 'evidence' || node.kind === 'source'
            ? normalizeLevel(patch.level)
            : null
          : undefined,
    })
    this.emitState()
    return { ok: true }
  }

  private toolNoteGap(args: any) {
    const question = String(args.question || '').trim()
    if (!question) return { error: '缺少 question' }
    const why = String(args.why || '').trim()
    const node = insertNode(this.sessionId, { kind: 'gap', title: question, content: why, pinnedBy: 'agent' })
    insertActivity(this.sessionId, { type: 'notice', summary: `${L(this.sessionId, '记录待查空白', 'Gap noted')}: ${node.title}` })
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
    insertActivity(this.sessionId, { type: 'notice', summary: `${getSessionLang(this.sessionId) === 'en' ? 'Awaiting your answer' : '等待用户回答'}: ${oneLine(question, 150)}` })

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
      const msg = insertMessage(this.sessionId, { role: 'system', kind: 'steer_ack', content: getSessionLang(this.sessionId) === 'en' ? `Folded into the research context: ${it.slice(0, 120)}` : `已纳入研究素材：${it.slice(0, 120)}` })
      this.emitMessage(msg)
    }
    insertActivity(this.sessionId, { type: 'notice', summary: `+${items.length} ${getSessionLang(this.sessionId) === 'en' ? 'user notes folded in' : '条用户补充素材已纳入'}` })
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
      langDirective(getSessionLang(this.sessionId)),
    ]
      .filter(Boolean)
      .join('\n\n')

    const res = await llmJson<any>(PLANNER_PROMPT, userPrompt, () => this.countLlm(), { face: 'planner' })
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
    insertActivity(this.sessionId, { type: 'notice', summary: `${noticeFor(getSessionLang(this.sessionId), 'planGenerated')}（${plan.tasks.length}）: ${oneLine(plan.focusQuestion, 150)}` })
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
      remainingMinutes: Math.max(0, Math.round((b.maxMinutes * 60_000 - (b.startedAt ? now() - b.startedAt : b.elapsedMs)) / 60_000)),
      langDirective: langDirective(getSessionLang(this.sessionId)),
    })
    const userPrompt = `# 研究历史（thought → action → observation）\n${serializeScratchpad(scratchpad)}\n\n请输出下一步的严格 JSON（{"thought":"...","action":{"tool":"...","args":{...}}}）。\n提醒：已确认的关键事实请尽快 add_evidence 落到证据墙（预算耗尽后未落墙的检索成果将丢失）；剩余预算紧张时应优先落墙与 finish_task，而非继续检索。`
    const res = await llmJson<any>(systemPrompt, userPrompt, () => this.countLlm(), { face: 'investigator' })
    if (!res.ok) {
      // P2 修复：直接读结构化 kind，不再靠中文错误文案正则耦合（llm.ts 改文案不影响熔断分类）
      return { ok: false, kind: res.kind === 'llm' ? 'llm' : 'parse', error: res.error }
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
      `【证据节点】\n${nodes.map((n) => `- [${n.kind}]${n.level ? ` [${n.level}]` : ''} ${n.title}: ${n.content}${n.sourceRef ? ` [${n.sourceRef}]` : n.sourceUrl ? ` [${n.sourceUrl}]` : ''}${n.confidence != null ? ` (置信度 ${n.confidence})` : ''}`).join('\n') || '（无）'}`,
      `【证据关系】\n${edges.map((e) => `- ${titleOf(e.source)} --${e.relation}--> ${titleOf(e.target)}`).join('\n') || '（无）'}`,
      `【已完成任务小结】\n${doneTasks.map((t) => `- ${t.goal} → ${t.summary || '（无小结）'}`).join('\n') || '（无）'}`,
      `【研究期间用户的补充消息】\n${steers.map((m) => `- ${m.content.slice(0, 300)}`).join('\n') || '（无）'}`,
      final
        ? noticeFor(getSessionLang(this.sessionId), 'finalSynthesisNote')
        : getSessionLang(this.sessionId) === 'en'
          ? `This is an interim synthesis. Remaining budget: ${this.remainingText()}.`
          : `这是阶段性综合。剩余预算：${this.remainingText()}。`,
      '请输出严格 JSON。',
      langDirective(getSessionLang(this.sessionId)),
    ].join('\n\n')

    const res0 = await llmJson<any>(SYNTHESIZER_PROMPT, userPrompt, () => this.countLlm(), { face: 'synthesizer' })
    // 研究综述是关键调用：退避重试（429 限流常见），最多 3 轮
    let res = res0
    if (!res.ok) {
      for (let i = 1; i <= 2; i++) {
        insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
          `综合失败（${res.error.slice(0, 80)}），${20 * i}s 后重试 ${i}/2`,
          `Synthesis failed (${res.error.slice(0, 80)}) — retry ${i}/2 in ${20 * i}s`), ok: false })
        await sleep(20_000 * i)
        res = await llmJson<any>(SYNTHESIZER_PROMPT, userPrompt, () => this.countLlm(), { face: 'synthesizer' })
        if (res.ok) break
      }
    }
    if (!res.ok) {
      insertActivity(this.sessionId, { type: 'notice', summary: `${L(this.sessionId, '综合失败', 'Synthesis failed')}: ${res.error}`, ok: false })
      return null
    }
    const v: SynthOut = res.value

    // narrative 落库
    if (v.narrative_md) updateSessionFields(this.sessionId, { narrative: String(v.narrative_md) })
    // questions 替换 + 自动钉「深研课题卡」（Task 14：醒目展示在证据墙课题栏）
    if (Array.isArray(v.questions)) {
      const qs = v.questions.slice(0, 5).map((q: any) => ({
        text: String(q.text || ''),
        rationale: String(q.rationale || ''),
        scores: {
          novelty: clamp(Math.round(Number(q.scores?.novelty) || 3), 1, 5),
          feasibility: clamp(Math.round(Number(q.scores?.feasibility) || 3), 1, 5),
          impact: clamp(Math.round(Number(q.scores?.impact) || 3), 1, 5),
        },
        recommended: !!q.recommended,
        evidenceRefs: Array.isArray(q.evidence_refs) ? q.evidence_refs.map(String) : [],
      }))
      replaceQuestions(this.sessionId, qs)
      this.syncTopicNodes(qs, final)
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
              detail: op.detail ? String(op.detail) : undefined,
              confidence: op.confidence,
              level: normalizeLevel(op.level) ?? undefined,
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
    insertActivity(this.sessionId, { type: 'notice', summary: noticeFor(getSessionLang(this.sessionId), final ? 'synthesisFinal' : 'synthesisStage') })
    this.emitState()
    return v
  }

  // ---------- 深研课题卡同步（Task 14：questions → 醒目 topic 节点） ----------

  /**
   * 把本轮综合提炼的科学问题集同步为证据墙上的 topic 课题卡：
   * - 陈旧课题（不在本轮问题集）连同其连线一并清理；
   * - 同题保留原节点 id（仅更新内容/评分/推荐），新题插入；
   * - 每张课题卡用 derives 边挂到支撑证据（最多 4 条，insertEdge 去重）；
   * - 推荐深挖的课题置 starred，卡面渲染金箔徽标。
   */
  private syncTopicNodes(qs: Omit<ResearchQuestion, 'id'>[], final: boolean) {
    if (!qs.length) return
    const lang = getSessionLang(this.sessionId)

    // 1. 清理不在本轮问题集的旧课题卡
    const removed = deleteStaleTopicNodes(this.sessionId, qs.map((q) => q.text.slice(0, 60)))
    if (removed > 0) {
      insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId, `清理 ${removed} 张已被本轮海汰的课题卡`, `Removed ${removed} outdated topic card(s)`) })
    }

    // 2. upsert 课题卡 + derives 连线
    for (const q of qs) {
      const title = q.text.slice(0, 60)
      const scoresLine = lang === 'en'
        ? `novelty ${q.scores.novelty}/5 · feasibility ${q.scores.feasibility}/5 · impact ${q.scores.impact}/5`
        : `新颖 ${q.scores.novelty}/5 · 可行 ${q.scores.feasibility}/5 · 影响 ${q.scores.impact}/5`
      const tags = lang === 'en'
        ? [`Nov ${q.scores.novelty}`, `Fea ${q.scores.feasibility}`, `Imp ${q.scores.impact}`]
        : [`新颖 ${q.scores.novelty}`, `可行 ${q.scores.feasibility}`, `影响 ${q.scores.impact}`]
      const detail = [
        `${lang === 'en' ? 'Full question' : '完整问题'}：${q.text}`,
        `${lang === 'en' ? 'Scores' : '评分'}：${scoresLine}${q.recommended ? (lang === 'en' ? ' · ⭐ recommended' : ' · ⭐ 推荐深挖') : ''}`,
        '',
        `${lang === 'en' ? 'Why it matters' : '为何值得研究'}：${q.rationale}`,
      ].join('\n')
      const content = q.rationale.slice(0, 400)

      const existing = findNodeByTitle(this.sessionId, title)
      let nodeId: string
      if (existing && existing.kind === 'topic') {
        updateNode(this.sessionId, existing.id, { content, tags, starred: !!q.recommended })
        updateNodeContent(this.sessionId, existing.id, content, null, null, null, detail)
        nodeId = existing.id
      } else {
        const node = insertNode(this.sessionId, {
          kind: 'topic',
          title,
          content,
          detail,
          tags,
          starred: !!q.recommended,
          pinnedBy: 'agent',
        })
        nodeId = node.id
        insertActivity(this.sessionId, {
          type: 'notice',
          summary: `${L(this.sessionId, '钉上深研课题卡', 'Research topic card pinned')}: ${oneLine(title, 80)}`,
        })
      }

      // derives 连线：课题卡 --derives--> 支撑证据（最多 4 条，去重幂等）
      const nodes = listNodes(this.sessionId)
      for (const ref of (q.evidenceRefs || []).slice(0, 4)) {
        const target = resolveNodeByTitle(nodes, String(ref))
        if (target && target.id !== nodeId && target.kind !== 'topic') {
          insertEdge(this.sessionId, nodeId, target.id, 'derives', null)
        }
      }
    }

    // 3. 最终综合时在聊天窗提示课题栏位置，引导用户去看醒目课题卡
    if (final) {
      const msg = insertMessage(this.sessionId, {
        role: 'system',
        kind: 'notice',
        content: noticeFor(lang, 'topicsPinned', { n: qs.length }),
      })
      this.emitMessage(msg)
    }
  }

  // ---------- 访谈链路（chat） ----------
  get interviewLocked(): boolean {
    return this.interviewBusy
  }

  /** 当前会话 phase（防御式读取，异常时返回 done 阻止自动开研究） */
  private getSessionPhaseSafe(): string {
    try {
      return getSessionRow(this.sessionId)?.phase ?? 'done'
    } catch {
      return 'done'
    }
  }

  async interviewTurn(text: string): Promise<ChatMessage | null> {
    if (this.interviewBusy) return null
    this.interviewBusy = true
    // 记录入口时是否存在待触发的自动开研究（用户打断补充需求 → 本轮结束后需重新武装）
    const wasArmed = this.autoStartTimer !== null
    try {
      // 0. 新用户消息打断未触发的自动开研究：用户还想继续细化需求
      this.cancelAutoStart()

      // 1. 用户消息落库
      const userMsg = insertMessage(this.sessionId, { role: 'user', kind: 'chat', content: text })
      this.emitMessage(userMsg)

      // 2. 构建 prompt：对话记录（不含本次）+ 本次用户消息
      const history = listMessages(this.sessionId)
        .filter((m) => m.kind === 'chat' && (m.role === 'user' || m.role === 'assistant') && m.id !== userMsg.id)
        .slice(-24)
      const dialogue = history.map((m) => `${m.role}: ${m.content}`).join('\n')
      const userPrompt = `【对话记录】\n${dialogue || '（无）'}\n\n【本次用户消息】\n${text}\n\n${langDirective(getSessionLang(this.sessionId))}`

      // 3. LLM 调用
      const res = await llmJson<any>(INTERVIEWER_PROMPT, userPrompt, () => this.countLlm(), { face: 'interviewer' })
      if (!res.ok) {
        const errMsg = insertMessage(this.sessionId, {
          role: 'assistant',
          kind: 'notice',
          content: noticeFor(getSessionLang(this.sessionId), 'interviewerUnavailable'),
        })
        this.emitMessage(errMsg)
        return errMsg
      }
      const v = res.value
      const reply = String(v.reply || '能再多说一点吗？你提到的东西里，哪一处最让你意外？')

      // 4. 更新 meta（signals 累积合并 / ready / title_suggestion）
      const meta = getMeta(this.sessionId)
      const prevReady = meta.ready
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
      if (ready && titleSuggestion && row && (DEFAULT_SESSION_TITLES.includes(row.title) || !row.title)) {
        updateSessionFields(this.sessionId, { title: titleSuggestion.slice(0, 80) })
      }

      // 5. 回复落库 kind='chat'，data 携带 ready/title 变化
      const data: Record<string, unknown> | null = ready ? { ready: true, title: titleSuggestion || row?.title } : null
      const msg = insertMessage(this.sessionId, { role: 'assistant', kind: 'chat', content: reply, data })
      this.emitMessage(msg)
      this.emitState()

      // 6. 新流程：信息充足 → 预告并自动开启自主调研（6s 窗口内可被新消息打断后重新武装；
      //    仅首次就绪或打断后的补充轮触发，研究完成后的闲聊不会自动开启新一轮）
      if (ready && !this.running && (wasArmed || (!prevReady && this.getSessionPhaseSafe() !== 'done'))) {
        this.scheduleAutoResearch(titleSuggestion || sig.topic || undefined)
      }
      return msg
    } finally {
      this.interviewBusy = false
    }
  }
}
