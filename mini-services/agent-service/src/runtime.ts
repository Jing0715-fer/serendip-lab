// runtime.ts — AgentRuntime 状态机（§6：ReAct + 事件流 + LangGraph 检查点 + AutoGPT 预算 + Reflexion 自愈）
import { broadcast } from './emitter'
import {
  getBudget, saveBudget, getMeta, saveMeta, getPlan, savePlan,
  listNodes, listEdges, listMessages, listQuestions,
  insertMessage, insertActivity, updateSessionFields, getSessionRow,
  findNodeByTitle, findNodeBySourceKey, sourceDedupKey, insertNode, updateNode, updateNodeContent, insertEdge,
  findEdge, updateEdgeLabel,
  replaceQuestions, deleteStaleTopicNodes, computeStats, NODE_KINDS, EDGE_RELATIONS, EVIDENCE_LEVELS,
  normalizeNodeStatus,
  getPendingFinal, savePendingFinal, listPendingFinalSessions,
  insertTaskRecord, listTaskRecords,
  type SessionPhase, type AgentStatus, type Plan, type PlanTask,
  type BoardNode, type ChatMessage, type ResearchQuestion, type EvidenceLevel,
  type PendingFinalState,
} from './db'
import { llmJson } from './llm'
import { INTERVIEWER_PROMPT, PLANNER_PROMPT, SYNTHESIZER_PROMPT, CONTRADICTS_PROMPT, buildInvestigatorPrompt } from './prompts'
import { getSessionLang, langDirective, noticeFor, type Lang } from './lang'
import { findExternalTool, toolsDoc } from './tools'
import { uuid, now, truncObs, oneLine, clamp, sleep } from './util'

const EXTERNAL_TOOL_NAMES = [
  'pubmed_search', 'pubmed_fetch', 'europepmc_search', 'openalex_search',
  'uniprot_search', 'ncbi_gene', 'pdb_search', 'taxonomy_search',
  'clinvar_search', 'web_search', 'web_read',
]
const GRAPH_TOOL_NAMES = ['add_evidence', 'batch_cards', 'link_evidence', 'update_evidence', 'note_gap', 'ask_user', 'finish_task']

/**
 * 检索/精读类动作计数——密度守护、轨迹小结、任务历史的统一口径（Task 31 抽取，
 * 此前同一正则在 4 处内联，改口径时容易漂移不一致）。
 */
const countSearchActions = (scratchpad: ScratchEntry[]): number =>
  scratchpad.filter((s) => /pubmed_|europepmc_|openalex_|web_read|web_search|uniprot|ncbi_|pdb|clinvar/i.test(String(s.action?.tool || ''))).length

/** 访谈就绪后自动开启自主调研的延迟：留一小窗口给用户继续补充/细化需求 */
const AUTO_START_DELAY_MS = 6_000
/** 自动开启自主调研的默认预算（标准调研档）。Task 27：40步/15分 → 48步/20分——
 *  第九领域实证：429 退避吃掉约 7 分钟墙钟后时间取代步数成为瓶颈（38/40 步、15 分钟封顶余 2 步未用）；
 *  落墙免计费后步数只统计检索，适当放宽双预算给限流风暴留缓冲 */
const AUTO_START_BUDGET = { maxSteps: 48, maxMinutes: 20 } as const

// ---------- 延迟收官 sweeper（Task 23） ----------
/** 每次失败后的自动重试退避：2/5/10/15/30 分钟，之后每 30 分钟一次 */
const FINAL_RETRY_DELAYS = [2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000, 30 * 60_000] as const
/** 自动重试上限（约 2.5 小时累计退避；达上限后仅保留手动补收官入口） */
const FINAL_MAX_ATTEMPTS = 12

/** 第 attempts 次失败后距下次自动重试的间隔 */
function finalRetryDelayMs(attempts: number): number {
  return FINAL_RETRY_DELAYS[Math.min(Math.max(attempts, 0), FINAL_RETRY_DELAYS.length - 1)]
}

/**
 * 扫描并补收官（index.ts 心跳每 60s 调一次）：
 * - 只处理 pending_final 非空且到退避时间的会话（状态全在 DB，重启后自然续跑）
 * - runtime 正在跑（研究/重综合/补收官中）→ 跳过本轮
 * - 达 FINAL_MAX_ATTEMPTS → 不再自动重试（手动 finalize 端点不受限）
 */
export async function sweepPendingFinals(): Promise<number> {
  let fired = 0
  for (const row of listPendingFinalSessions()) {
    try {
      const rt = AgentRuntime.find(row.id)
      if (rt?.running) continue
      const pf = getPendingFinal(row.id)
      if (!pf) continue
      if (pf.attempts >= FINAL_MAX_ATTEMPTS) continue // 自动重试上限，等手动
      const lastAt = pf.lastAttemptAt ?? pf.since
      if (now() < lastAt + finalRetryDelayMs(pf.attempts)) continue // 退避未到
      insertActivity(row.id, { type: 'notice', summary: noticeFor(getSessionLang(row.id), 'finalizeAutoStart') })
      console.log(`[sweeper] auto-finalizing ${row.id.slice(0, 8)} (attempts=${pf.attempts})`)
      void AgentRuntime.get(row.id).finalizeNow().catch((e) => console.error('[sweep-finalize]', row.id, e))
      fired++
    } catch (e) {
      console.error('[sweep-pending]', row.id, e)
    }
  }
  return fired
}

/** 默认会话标题（任何一种都允许被 title_suggestion 覆盖） */
const DEFAULT_SESSION_TITLES = ['新调查', '新课题', 'New Project']

/** 归一化证据等级：严格匹配六个合法值，否则 null（未定级）；非法值一律落 null。
 *  Task 23 起导出：explore.ts 反馈钉墙链路同样需要归一化（不再只靠 sourceRef 启发式） */
export function normalizeLevel(v: unknown): EvidenceLevel | null {
  const s = String(v ?? '').trim().toLowerCase()
  return (EVIDENCE_LEVELS as string[]).includes(s) ? (s as EvidenceLevel) : null
}

// ---------- 证据等级合理性校验（Task 22 P1-2：关键词 vs 等级交叉验证，保守降级） ----------
// 目标：拦截「临床前小鼠研究被标 cohort」这类虚标。规则保守：仅在文本含强跨域标记
// 且完全无人体/临床试验标记时降级；user/computational 不参与（无法从文本判型）。
const PRECLINICAL_RE = /临床前|preclinical|小鼠|\bmouse\b|\bmice\b|murine|C57BL|BALB|裸鼠|鼠模型|异种移植|xenograft|\bPDX\b/i
const INVITRO_RE = /细胞系|cell lines?\b|in vitro|体外培养|培养细胞|2D 培养|3D 培养|类器官|organoids?\b/i
const HUMAN_RE = /患者|patient|受试者|参与者|志愿者|队列|cohort|前瞻性|回顾性|prospective|retrospective|临床试验|clinical trial|\btrial\b|随机|randomi[sz]ed|安慰剂|placebo|人群|人体|人类|流行病学|epidemiolog|孟德尔|Mendelian|全基因组关联|\bGWAS\b/i
// Task 29 P2-④：孟德尔随机化/遗传工具变量研究——六等级体系不动（避免 schema/front 端大改），
// 以 MR 专有 tag 标识：cohort 等级 + 'MR' 标签，卡面即可区分遗传学因果推断与常规观察队列
const MR_RE = /孟德尔|Mendelian|遗传工具变量|genetic instrument|遗传学因果|多基因风险评分.*因果|polygenic.*causal/i

export function sanityCheckLevel(level: EvidenceLevel | null, title: string, content: string): EvidenceLevel | null {
  if (!level || level === 'user' || level === 'computational') return level
  const text = `${title} ${content}`
  if (HUMAN_RE.test(text)) return level // 含人体研究标记 → 不动，宁可漏纠不可误纠
  if ((level === 'rct' || level === 'cohort') && PRECLINICAL_RE.test(text)) return 'animal'
  if ((level === 'rct' || level === 'cohort' || level === 'animal') && INVITRO_RE.test(text) && !PRECLINICAL_RE.test(text)) return 'invitro'
  return level
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
    // Task 30 P1-①：跨轮任务历史随 state 快照下发（前轮任务不再随 savePlan 覆盖丢失）
    taskHistory: listTaskRecords(sessionId),
    stats,
    phase: row.phase,
    status: row.status,
    pendingFinal: getPendingFinal(sessionId),
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
  /** 预算紧张收敛模式已提示（每轮研究重置，避免活动日志刷屏） */
  private tightNotified = false
  /** 最近一次综合失败摘要（延迟收官记录用；callSynthesizer 返回 null 前写入） */
  private lastSynthError: string | null = null

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

  /** Task 27：剩余墙钟预算（ms）——时间感知限流退避的锚点 */
  private remainingMs(): number {
    const b = getBudget(this.sessionId)
    const elapsed = b.startedAt ? now() - b.startedAt : b.elapsedMs
    return Math.max(0, b.maxMinutes * 60_000 - elapsed)
  }

  /** Task 27：限流重试等待上限——不超过剩余时间的 1/4（时间取代步数成为瓶颈后，
 *  盲退避曾吃掉约一半墙钟）；预留 3s 下限避免热循环，90s 上限维持原耐心天花板 */
  private rateWaitCapMs(): number {
    return clamp(this.remainingMs() / 4, 3_000, 90_000)
  }

  private remainingText(): string {
    const b = getBudget(this.sessionId)
    const elapsed = b.startedAt ? now() - b.startedAt : b.elapsedMs
    return `${Math.max(0, b.maxSteps - b.stepsUsed)} 步 / ${Math.max(0, Math.round((b.maxMinutes * 60_000 - elapsed) / 60_000))} 分钟`
  }

  /** 预算紧张（剩余步数 < 6 或剩余时间 < 4 分钟）→ 收敛模式：压缩单任务步数，避免末尾任务把预算烧光还留不下任何成果 */
  private budgetTight(): boolean {
    const b = getBudget(this.sessionId)
    const elapsed = b.startedAt ? now() - b.startedAt : b.elapsedMs
    return b.maxSteps - b.stepsUsed < 6 || b.maxMinutes * 60_000 - elapsed < 4 * 60_000
  }

  /**
   * Task 28 P1-②：方向相反证据对的确定性检测（纯文本启发式，finish_task 前一次性核对）。
   * 命中条件：本任务研究历史同时出现「获益/保护向」与「损害/无效向」的效应表述——
   * 观察性获益 vs 孟德尔随机化零因果、干预获益 vs 出血/死亡风险升高等经典悖论形态。
   * 背景：investigator 矛盾即时落边准则经 Task 26/27 两轮 prompt 强化仍有机落边为 0，
   * 猎手兑底虽能补齐但时机滞后（最终综合后）——改在任务收口点确定性触发。
   * 误报成本低：提示可被模型判为无关措辞重叠而拒绝，二次 finish_task 直接过（与密度守护同语义）。
   */
  private oppositeEvidencePairs(scratchpad: ScratchEntry[]): boolean {
    const text = scratchpad
      .map((s) => `${s.observation || ''}\n${s.thought || ''}`)
      .join('\n')
      .toLowerCase()
      .slice(0, 30_000)
    if (!text) return false
    const benefit = /(reduced|lower|decreased|protect\w+|beneficial|improv\w+)\s+(risk|mortality|incidence|death|odds)|protective association|降低(风险|死亡|发病率|发生率)|保护(作用|效应)|获益/.test(text)
    const harm = /(increased|elevated|higher|raised)\s+(risk|mortality|incidence|death|odds)|no (significant |causal )?(association|effect|benefit|reduction)|null (finding|effect|association)|增加(风险|死亡|发病率|发生率)|无(因果|关联|获益|保护作用)|有害/.test(text)
    return benefit && harm
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
  /** 路由层读取暂停态（paused 为私有字段，不外露） */
  isPaused(): boolean {
    return this.paused
  }

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
  async start(focus: string | undefined, maxSteps = 48, maxMinutes = 20) {
    if (this.running) return
    this.running = true
    this.stopFlag = false
    this.paused = false
    this.consecutiveFails = 0
    this.tightNotified = false

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
    // Task 27 P2：免计费口径一次性说明——步数仅统计检索/精读，落墙零成本（防用户看到步数增长慢而困惑）
    insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
      '预算口径：步数仅统计检索/精读等外部操作，证据卡落墙与连线零成本不计数；遇 API 限流时会自动退避重试',
      'Budget note: steps count external search/read actions only — pinning cards & linking are free; API rate-limits are auto-retried with budget-aware backoff') })

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
      this.lastSynthError = e instanceof Error ? e.message : String(e)
    }
    // Task 23 延迟收官（P1）：最终综合失败（持续 429 配额耗尽远超内层重试耐心）时，
    // 不再静默吞掉——持久化 pendingFinal，后台 sweeper 按退避自动补收官，前端同时可见可手动
    if (!synth) {
      const pf: PendingFinalState = { since: now(), attempts: 0, error: (this.lastSynthError || 'synthesis failed').slice(0, 200) }
      savePendingFinal(this.sessionId, pf)
      insertActivity(this.sessionId, { type: 'notice', summary: noticeFor(getSessionLang(this.sessionId), 'finalizePending') })
    } else if (getPendingFinal(this.sessionId)) {
      // 成功收官：清掉可能残留的历史 pendingFinal（如上一轮挂起后本轮重跑成功）
      savePendingFinal(this.sessionId, null)
    }
    // 矛盾猎手兜底：最终综合后若墙上零 contradicts 边且综述提及矛盾 → 定向结构化（失败不阻断收官）
    await this.ensureContradictionEdges()
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
      await this.ensureContradictionEdges()
      // 手动重梳理成功同样视为收官完成：清掉 pendingFinal，横幅随之消失
      if (getPendingFinal(this.sessionId)) savePendingFinal(this.sessionId, null)
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

  // ---------- 补收官（Task 23 延迟收官）：手动 finalize 端点与后台 sweeper 共用 ----------
  // 语义：把当初因模型服务受限而丢失的最终综述 + 矛盾猎手补齐；成功后清 pendingFinal。
  // 失败：attempts+1、lastAttemptAt=now 落库（重启后 sweeper 仍能续退避）。
  async finalizeNow(): Promise<{ ok: boolean; error?: string }> {
    if (this.running) return { ok: false, error: 'agent_busy' }
    if (listNodes(this.sessionId).length === 0) return { ok: false, error: 'no_evidence' }
    this.running = true
    const lang = getSessionLang(this.sessionId)
    const recordFailure = (): void => {
      const cur = getPendingFinal(this.sessionId) ?? { since: now(), attempts: 0, error: '' }
      const attempts = cur.attempts + 1
      const nextDelayMin = Math.round(finalRetryDelayMs(attempts) / 60_000)
      savePendingFinal(this.sessionId, {
        since: cur.since,
        attempts,
        lastAttemptAt: now(),
        error: (this.lastSynthError || 'synthesis failed').slice(0, 200),
      })
      insertActivity(this.sessionId, {
        type: 'notice',
        ok: false,
        summary: attempts >= FINAL_MAX_ATTEMPTS
          ? noticeFor(lang, 'finalizeGiveup', { n: attempts })
          : noticeFor(lang, 'finalizeRetry', { n: attempts, err: (this.lastSynthError || '').slice(0, 60), min: nextDelayMin }),
      })
      this.emitState()
    }
    try {
      let synth: SynthOut | null = null
      try {
        synth = await this.callSynthesizer(true)
      } catch (e) {
        // callSynthesizer 正常 LLM 失败走 return null；此处兜底 DB/意外异常
        this.lastSynthError = e instanceof Error ? e.message : String(e)
        console.error('[finalize-synthesize]', e)
      }
      if (!synth) {
        recordFailure()
        return { ok: false, error: this.lastSynthError || 'synthesis failed' }
      }
      await this.ensureContradictionEdges()
      savePendingFinal(this.sessionId, null)
      this.setPhase('done', 'done')
      insertActivity(this.sessionId, { type: 'notice', summary: noticeFor(lang, 'finalizeDone') })
      const noticeMsg = listMessages(this.sessionId).filter((m) => m.kind === 'notice').pop()
      if (noticeMsg) this.emitMessage(noticeMsg)
      broadcast(this.sessionId, 'done', { reason: 'finalized', summary: noticeFor(lang, 'finalizeDone') })
      this.emitState()
      return { ok: true }
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

      // 预算紧张 → 收敛模式（每轮仅提示一次）：压缩后续单任务步数，优先把核心任务带过终点线
      if (!this.tightNotified && this.budgetTight()) {
        this.tightNotified = true
        insertActivity(this.sessionId, { type: 'notice', summary: noticeFor(getSessionLang(this.sessionId), 'budgetTight') })
      }

      // T31 P1-②：末段任务饥饿防护——剩余步数 <4（检索+落卡+收尾的最小闭环都凑不齐）时不启动新任务。
      // T30 E2E 实证：R2 t4 在预算近耗尽时照常启动，1 次检索 0 卡收口——白耗预算还产出误导性的「已完成」记录。
      // 未启动任务点名进活动日志供用户决策续研；剩余墙钟全部让给最终综合
      const bLeft = getBudget(this.sessionId)
      if (bLeft.maxSteps - bLeft.stepsUsed < 4) {
        const starved = plan.tasks.filter((t) => !t.done)
        if (starved.length) {
          insertActivity(this.sessionId, {
            type: 'notice',
            summary: noticeFor(getSessionLang(this.sessionId), 'starvedTasks', {
              n: starved.length,
              tasks: starved.map((t) => oneLine(t.goal, 60)).slice(0, 3).join('；'),
            }),
          })
        }
        return 'budget'
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
        // Task 28 P2-④：预算紧张时跳过阶段性综合——收官必有最终综合兜底，
        // 尾段把墙钟留给调研循环（第十领域实证：一次中途综合 ~1 分钟，恰是尾段能再完成半个任务的量）
        if (this.budgetTight()) {
          insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
            '预算紧张：跳过本轮阶段性综合，把时间留给调研（收官时统一综合）',
            'Budget tight: skipping this interim synthesis to leave time for research (the final synthesis will cover it)') })
        } else {
          await this.callSynthesizer(false)
          if (this.stopFlag) return 'stopped'
        }
        tasksSinceSynth = 0
        stepsSinceSynth = 0
      }
    }

    if (this.stopFlag) return 'stopped'
    if (!this.budgetOK()) {
      // 预算耗尽透明收官：未完成任务点名到活动日志，供用户决策追加研究（飞轮入口）
      const undone = plan.tasks.filter((t) => !t.done)
      if (undone.length) {
        insertActivity(this.sessionId, {
          type: 'notice',
          summary: noticeFor(getSessionLang(this.sessionId), 'budgetLeftover', {
            n: undone.length,
            tasks: undone.map((t) => oneLine(t.goal, 60)).slice(0, 3).join('；'),
          }),
        })
      }
      return 'budget'
    }
    return 'completed'
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

  // ---------- 调查内循环（ReAct，每任务最多 10 步；预算紧张时压缩到 5 步） ----------
  private async investigate(task: PlanTask) {
    this.setPhase('investigating', 'running')
    const scratchpad: ScratchEntry[] = []
    let parseFails = 0
    let llmFails = 0
    // Task 27 P1-②：落墙免计费后步数只统计检索，任务内检索空间变大——8 → 10 步
    //（全局 stepsUsed 仍封顶，任务级上限只防单任务失控独吞预算）
    const stepCap = this.budgetTight() ? 5 : 10
    // 落墙守护（P1）：任务开始时的证据卡数基准——finish 时若零新增且有检索成果，给一次抢救机会
    // Task 25：source 卡同样计入落墙（线索源也是墙上的研究成果）；密度守护追踪本任务新钉卡数
    const wallPinCount = () => listNodes(this.sessionId).filter((n) => n.kind === 'evidence' || n.kind === 'source').length
    const evBefore = wallPinCount()
    let rescueUsed = false
    let densityNudged = false
    // Task 28 P1-②：本任务 contradicts 落边基准——收口时零新增且检测到反向证据对 → 一次性结构化提示
    const contradictBefore = listEdges(this.sessionId).filter((e) => e.relation === 'contradicts').length
    let contradictsNudged = false
    // Task 29 P1-①：任务开始时的节点 id 快照——fallback 收口时差集即本任务新钉卡（轨迹小结的原材料）
    const nodesBeforeIds = new Set(listNodes(this.sessionId).map((n) => n.id))
    // 两处收口点（finish_task 分支 + 步数上限窗口）共用的矛盾自检提示文案
    const CONTRADICT_HINT =
      'SYSTEM: 自检发现本任务的研究历史中同时出现「获益/保护方向」与「损害/无效方向」的证据表述，但证据墙在本任务中没有新增任何 contradicts 边。若这确属同一问题上的相反结论（例如：观察性研究显示降低风险 vs 孟德尔随机化显示无因果关联），请先用 link_evidence（relation=contradicts，from/to 为两张证据卡的 id，label 一句话点明冲突点）把这对冲突结构化，再 finish_task；若只是不同问题/不同暴露的措辞重叠（并非真正的结论对立），直接 finish_task 即可。'
    // Task 31 P1-①：密度守护提示文案（finish_task 分支 + 步数上限收口窗口两处共用——
    // T30 E2E 实证 9/9 任务经 fallback 路径收口，只接 finish_task 分支的密度督促从未被走到）
    const densityHint = (newPins: number, searches: number) =>
      `SYSTEM: 本任务至今只钉了 ${newPins} 张证据卡，但研究历史中有 ${searches} 次检索/精读——图操作（add_evidence/batch_cards/link_evidence）不消耗全局步数预算，落墙零成本。若其中还有 ≥1 条值得保留的关键事实（不同文献分卡，含 PMID/DOI、level 证据等级与 detail 解释），请用 batch_cards 一次补落（2-4 张，可附 links 连线）后再 finish_task；若确属摸底型任务且无更多可落，直接 finish_task 并在 summary 中写明检索结论。`
    // Task 22：主步数用尽后追加 ≤4 轮收口窗口（落墙 + 矛盾自检）；Task 28：+3 → +4 给两项注入各留位
    for (let step = 0; step < stepCap + 4; step++) {
      if (!this.budgetOK() || this.stopFlag) break
      await this.waitIfPaused()
      if (this.stopFlag) break

      // 步数上限收口自检（Task 22 落墙守护 + Task 28 矛盾自检 + Task 31 密度守护）：主窗口结束时有未了事项 → 注入系统指令（每项仅一次）。
      // Task 28 P1-② 修复：第十一领域 E2E 实证 5/5 任务全部经本路径收口（模型用满 10 步检索、
      // 补落窗口落卡后 break→fallback done），finish_task 分支的钩子从未被走到——
      // 矛盾自检必须同时挂在本收口路径上，否则形同虚设；窗口 +4 轮给各项注入留位
      // Task 31 P1-①：密度守护同样挂上（T30 E2E 实证 9/9 走本路径，R2 尾段 3 任务以 0-1 卡收口把密度拉低到 1.67）。
      // 优先级：零卡抢救 > 密度督促 > 矛盾结构化；零卡但预算余量不足抢救时密度督促兜底（落墙本就免计费）
      if (step >= stepCap) {
        const needPin = this.needsEvidenceRescue(evBefore, scratchpad)
        const pinsNow = wallPinCount() - evBefore
        const searchesNow = countSearchActions(scratchpad)
        const needDensity = !densityNudged && pinsNow <= 2 && searchesNow >= 3
        const needContradict = !contradictsNudged
          && listEdges(this.sessionId).filter((e) => e.relation === 'contradicts').length === contradictBefore
          && wallPinCount() >= 2
          && this.oppositeEvidencePairs(scratchpad)
        if (!needPin && !needDensity && !needContradict) break
        if (needPin && !rescueUsed) {
          rescueUsed = true
          insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
            '落墙守护：步数达到上限但检索成果尚未上墙，追加补落窗口（≤4 步）',
            'Evidence-pin guard: step cap reached with unpinned results — extending a pinning window (≤4 steps)') })
          scratchpad.push({
            thought: '步数达到上限，任务收尾自检：证据墙未新增卡片',
            action: { tool: '__step_cap__', args: {} },
            observation:
              'SYSTEM: 步数已达上限。本任务检索到的关键事实尚未落到证据墙——请立即用 add_evidence 把已确认的关键事实落墙（1-3 张，含 PMID/DOI 来源、level 证据等级、detail 两句解释），随后 finish_task 收尾。不要发起新的检索。',
          })
        } else if (needDensity) {
          // 落了 0-2 张但检索 ≥3 次（零卡且抢救未接管/被无视时由此兜底）→ 一次性密度督促补落
          densityNudged = true
          insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
            `密度守护（收口窗口）：${searchesNow} 次检索仅钉 ${pinsNow} 张卡，已要求补落后再收口`,
            `Density guard (closure window): only ${pinsNow} card(s) pinned after ${searchesNow} searches — asked to pin more before closing`) })
          scratchpad.push({
            thought: '步数达到上限，任务收尾密度自检：证据卡不足',
            action: { tool: '__step_cap__', args: {} },
            observation: densityHint(pinsNow, searchesNow),
          })
        } else if (needContradict) {
          // 落墙已完成、仅剩冲突未结构化 → 注入矛盾提示续窗 1 轮
          contradictsNudged = true
          insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
            '矛盾自检：研究历史出现方向相反的证据表述但本任务未落 contradicts 边，已提示结构化冲突对',
            'Contradiction self-check: opposite-direction evidence found with no contradicts edge added this task — asked to structure the pair') })
          scratchpad.push({
            thought: '步数达到上限，任务收尾自检：方向相反证据未结构化',
            action: { tool: '__step_cap__', args: {} },
            observation: CONTRADICT_HINT,
          })
        }
      }

      const out = await this.callInvestigator(task, scratchpad)
      if (!out.ok) {
        if (out.kind === 'llm') {
          // LLM 调用失败：429 限流 → 递增等待（20s/40s/60s/80s/90s）自愈，其他错误固定 5s；宽松熔断（5 次）。
          // Task 27 P1-① 时间感知：等待上限不超过剩余墙钟的 1/4（盲退避曾吃掉约一半预算）；
          // 剩余时间 <15s 时不再等待直接上抛——循环顶部 budgetOK() 会自然收官，别把尾段烧在 sleep 上
          llmFails++
          const isRateLimit = /\b429\b|too many requests|rate.?limit/i.test(out.error)
          const remMs = this.remainingMs()
          if (isRateLimit && remMs < 15_000) {
            insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
              `API 限流且剩余时间不足（${Math.round(remMs / 1000)}s），不再等待重试，交由预算收口`,
              `API rate-limited with only ${Math.round(remMs / 1000)}s left — skipping retry waits, letting the budget close the run`), ok: false })
            continue
          }
          const waitMs = isRateLimit
            ? Math.min(20_000 * llmFails, this.rateWaitCapMs())
            : Math.min(5_000, this.rateWaitCapMs())
          insertActivity(this.sessionId, { type: 'notice', summary: `${L(this.sessionId,
            isRateLimit ? `API 限流，${Math.round(waitMs / 1000)}s 后自动重试（第 ${llmFails}/5 次，不超过剩余时间的 1/4）` : `LLM 调用失败（${llmFails}/5），5s 后重试`,
            isRateLimit ? `API rate-limited — auto retry in ${Math.round(waitMs / 1000)}s (attempt ${llmFails}/5, capped at 1/4 of remaining time)` : `LLM call failed (${llmFails}/5), retry in 5s`)}: ${out.error}`, ok: false })
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
        // 落墙守护：检索到了成果但一张卡都没落就收官 → 注入系统指令给一次补落机会（每任务仅一次）
        if (!rescueUsed && this.needsEvidenceRescue(evBefore, scratchpad)) {
          rescueUsed = true
          scratchpad.push({
            thought: '任务收尾自检：证据墙未新增任何卡片',
            action: { tool: 'finish_task', args: {} },
            observation:
              'SYSTEM: 等一下——本任务的研究历史中已有可信检索结果，但证据墙尚未新增任何 evidence 卡。预算耗尽后未落墙的成果将全部丢失。请立即改用 add_evidence 把已确认的关键事实（含 PMID/DOI 来源、level 证据等级、detail 两句解释）落到证据墙（2-4 张），完成后再 finish_task。',
          })
          insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
            '落墙守护：检索成果尚未上墙，已要求补落证据卡后再收官',
            'Evidence-pin guard: retrieved results not yet pinned — asked to add evidence cards before closing') })
          continue
        }
        // Task 25 密度守护（Task 26 重校准：落墙免费后阈值从 ≤1/≥2 提至 ≤2/≥3）：
        // 检索型任务检索 ≥3 次却仅钉 ≤2 张卡 → 一次性督促补落；摸底型任务可在 summary 说明后直接二次 finish 通过
        // Task 31 P1-①：文案与收口窗口共用 densityHint（两处口径必须一致，防止模型在两个收口路径看到矛盾指令）
        if (!densityNudged) {
          const newPins = wallPinCount() - evBefore
          const searches = countSearchActions(scratchpad)
          const bNow = getBudget(this.sessionId)
          if (newPins <= 2 && searches >= 3 && bNow.maxSteps - bNow.stepsUsed >= 2) {
            densityNudged = true
            insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
              `密度守护：本任务 ${searches} 次检索仅钉 ${newPins} 张卡，已要求补落后再收官`,
              `Density guard: only ${newPins} card(s) pinned after ${searches} searches — asked to pin more before closing`) })
            scratchpad.push({
              thought: '任务收尾密度自检：证据卡不足',
              action: { tool: 'finish_task', args: {} },
              observation: densityHint(newPins, searches),
            })
            continue
          }
        }
        // Task 28 P1-② 有机矛盾钩子（确定性兜底，每任务一次）：本任务零 contradicts 落边
        // 且研究历史同时出现获益向与损害/无效向表述 → 一次性结构化提示（模型可判为
        // 无关措辞重叠而拒绝，二次 finish_task 直接过；墙上 ≥2 张卡才有可能落 contradicts 边）
        if (!contradictsNudged) {
          const contradictsNow = listEdges(this.sessionId).filter((e) => e.relation === 'contradicts').length
          if (contradictsNow === contradictBefore && wallPinCount() >= 2 && this.oppositeEvidencePairs(scratchpad)) {
            contradictsNudged = true
            insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
              '矛盾自检：研究历史出现方向相反的证据表述但本任务未落 contradicts 边，已提示结构化冲突对',
              'Contradiction self-check: opposite-direction evidence found with no contradicts edge added this task — asked to structure the pair') })
            scratchpad.push({
              thought: '任务收尾矛盾自检：方向相反证据未结构化',
              action: { tool: 'finish_task', args: {} },
              observation: CONTRADICT_HINT,
            })
            continue
          }
        }
        task.done = true
        task.summary = String(args.summary || '').slice(0, 400)
        this.persistTask(task)
        // Task 30 P1-①：闭环即落跨轮任务历史（finish_task 路径）
        this.recordClosedTask(task, scratchpad, nodesBeforeIds)
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
      // Task 27（E2E 实证）：多摘要类工具（fetch/read/搜索）1600 字截断曾让模型误判「数据不完整」
      // 而重复同参重调浪费步数——此类工具放宽到 6000 字；其余保持 1600
      const OBS_LIMITS: Record<string, number> = {
        pubmed_fetch: 6_000, web_read: 6_000, europepmc_search: 6_000,
        openalex_search: 6_000, pubmed_search: 3_000,
      }
      scratchpad.push({ thought, action: { tool: toolName, args }, observation: truncObs(obs, OBS_LIMITS[toolName] ?? 1_600) })

      // Task 26 落墙免计费：纯图操作（落卡/连线/更新/记空白）不消耗全局步数预算——
      // 上代实证（饱和脂肪-CVD）：模型「舍不得」用步数落卡（密度 1.2 卡/任务），检索换词重试反而吃光预算。
      // 仍占任务级 stepCap（for 循环上限）防失控；外部检索/精读照常计费。
      if (!GRAPH_TOOL_NAMES.includes(toolName)) {
        const b = getBudget(this.sessionId)
        b.stepsUsed++
        saveBudget(this.sessionId, b)
      }
      this.persistStep()
    }
    // 达到步数上限也算完成。Task 29 P1-①：fallback 收口不再留空 summary——
    // 第十一领域 E2E 实证 5/5 任务经本路径收口（finish_task 从未被走到），全部任务小结为空，
    // 最终综合的【已完成任务小结】块沦为「（无小结）」×N，直接精简化综述质量。
    // 此处从钉卡差集 + 检索轨迹确定性合成小结（零 LLM 成本——预算此刻本就耗尽）。
    if (!task.done) {
      task.done = true
      task.summary = this.composeFallbackSummary(scratchpad, nodesBeforeIds)
      this.persistTask(task)
      // Task 30 P1-①：步数封顶收口同样落跨轮任务历史（第十一领域实证 5/5 任务走此路径）
      this.recordClosedTask(task, scratchpad, nodesBeforeIds)
    }
  }

  /**
   * Task 29 P1-①：步数封顶/预算耗尽收口时的轨迹小结（无 LLM 调用的确定性合成）。
   * 原材料：①本任务新钉的证据卡标题（nodesBefore 差集，最重要——综合阶段可直接引用）；
   * ②检索/精读次数；③末段有效思路（模型自己的判断，比空值好得多）。
   * 综合 prompt 里 doneTasks 的「（无小结）」从主要路径上彻底消失。
   */
  private composeFallbackSummary(scratchpad: ScratchEntry[], nodesBefore: Set<string>): string {
    const lang = getSessionLang(this.sessionId)
    const newNodes = listNodes(this.sessionId).filter((n) => !nodesBefore.has(n.id))
    const pinned = newNodes.filter((n) => n.kind === 'evidence' || n.kind === 'source')
    const others = newNodes.filter((n) => n.kind === 'hypothesis' || n.kind === 'gap' || n.kind === 'insight')
    const searches = countSearchActions(scratchpad)
    // 末段有效思路：排除系统注入的自检条目（__step_cap__/纠错反馈）与空 thought；
    // Task 30 P2-③：优先取最后一个「非策略性」thought——末段若是「我需要调整检索策略」这类
    // 过程性文本，对综合阶段毫无信息量（T29 E2E 实证样例）；全为策略性时退回原选取
    const isValidThought = (s: ScratchEntry) =>
      (s.thought || '').trim() && s.action?.tool !== '__step_cap__' && s.action?.tool !== '__invalid_output__' && !/收尾自检|纠正/.test(s.thought)
    const STRATEGY_THOUGHT_RE =
      /(调整|改变|更换?|换个?)(策略|思路|方向|检索式?|关键词)|(重新)?(换词|重试|再试|重新检索)|另(?:外)?尝试|换.{0,4}(词|关键词|思路)|adjust (?:my |the )?(?:strategy|approach|search)|rephrase|retry|try (?:a |another )?(?:different|another|new)/i
    const reversed = [...scratchpad].reverse()
    const lastThought = reversed.find((s) => isValidThought(s) && !STRATEGY_THOUGHT_RE.test(s.thought)) ?? reversed.find(isValidThought)
    const parts: string[] = []
    if (pinned.length) {
      const titles = pinned.map((n) => oneLine(n.title, 30)).slice(0, 4).join('；')
      parts.push(lang === 'en' ? `pinned ${pinned.length} card(s): ${titles}${pinned.length > 4 ? ' …' : ''}` : `钉卡 ${pinned.length} 张：${titles}${pinned.length > 4 ? ' 等' : ''}`)
    }
    if (others.length) parts.push(lang === 'en' ? `${others.length} hypothesis/gap card(s)` : `另钉 ${others.length} 张假说/空白卡`)
    if (searches) parts.push(lang === 'en' ? `${searches} search/read actions` : `${searches} 次检索/精读`)
    if (lastThought) parts.push(lang === 'en' ? `last assessment: ${oneLine(lastThought.thought, 160)}` : `末段判断：${oneLine(lastThought.thought, 160)}`)
    const head = lang === 'en' ? '(closed at step cap) ' : '（步数上限收口）'
    const body = parts.length ? parts.join(lang === 'en' ? '; ' : '；') : (lang === 'en' ? 'no pinned results this task' : '无落墙成果')
    if (pinned.length || lastThought) {
      insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
        `任务收口（步数上限）：已自动生成轨迹小结（${pinned.length} 张新卡）供最终综合引用`,
        `Task closed at step cap: trace summary auto-generated (${pinned.length} new cards) for the final synthesis`) })
    }
    return `${head}${body}`.slice(0, 400)
  }

  /** 落墙守护判定：全程零新增 evidence 卡 + scratchpad 里有真实检索成果 + 预算还够补落（≥3 步） */
  private needsEvidenceRescue(evBefore: number, scratchpad: ScratchEntry[]): boolean {
    const evNow = listNodes(this.sessionId).filter((n) => n.kind === 'evidence' || n.kind === 'source').length
    if (evNow > evBefore) return false
    if (!this.budgetOK()) return false
    const b = getBudget(this.sessionId)
    if (b.maxSteps - b.stepsUsed < 3) return false
    return scratchpad.some((s) => /pubmed_|europepmc_|openalex_|web_read|uniprot|ncbi_|pdb/i.test(String(s.action?.tool || '')))
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

  /**
   * Task 30 P1-①：任务闭环 → 追加式落跨轮任务历史（savePlan 每轮整体覆盖，
   * 前轮已完成任务连同轨迹小结会从 plan 视图丢失——这里独立成表永久留存，
   * 供前端任务历史视图/导出/最终综合引用）。幂等：同 session+round+task_id 重收口覆盖更新。
   */
  private recordClosedTask(task: PlanTask, scratchpad: ScratchEntry[], nodesBeforeIds: Set<string>) {
    try {
      const nodes = listNodes(this.sessionId)
      const pinned = nodes.filter((n) => !nodesBeforeIds.has(n.id) && (n.kind === 'evidence' || n.kind === 'source')).length
      const searches = countSearchActions(scratchpad)
      const round = getPlan(this.sessionId)?.round ?? getBudget(this.sessionId).round ?? 1
      insertTaskRecord(this.sessionId, {
        taskId: task.id,
        round,
        goal: task.goal,
        why: task.why || '',
        summary: task.summary || '',
        pinned,
        searches,
      })
    } catch (e) {
      console.error('[task-record] insert failed:', this.sessionId, task.id, e)
    }
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
    if (toolName === 'batch_cards') return this.toolBatchCards(args)
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
    // Task 29 P2-④：孟德尔随机化/遗传工具变量研究自动补 MR 标签（等级体系六档不动，cohort+MR 区分
    // 遗传学因果推断与常规观察队列——卡面 tags 即可见；配合 prompts 引导双保险）
    if (
      (String(args.kind || 'evidence') === 'evidence' || String(args.kind || 'evidence') === 'source') &&
      !tags.some((x: string) => /^mr$/i.test(x)) &&
      MR_RE.test(`${String(args.title || '')} ${String(args.content || '')}`)
    ) {
      tags.push('MR')
    }
    // Task 20 打磨：证据等级只对 evidence/source 卡有意义（研究类型分级），
    // 假说/洞见/课题等语句型卡片不带 level，防止语义泄漏（真实测试发现 hypothesis 被标 animal）
    // Task 22：归一化后过合理性校验器（保守降级：纯动物/体外文本不得标临床级）
    const level =
      kind === 'evidence' || kind === 'source' ? sanityCheckLevel(normalizeLevel(args.level), title, content) : null

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

    // Task 24 唯一性防线：标题不同但同源（同 PMID/DOI）的证据卡 → 合并进原卡而非新建重复卡。
    // 真实测试根因：investigator 全称标题 vs synth 缩写标题重钉同一文献（3 对重复全部同 PMID）。
    if (kind === 'evidence' || kind === 'source') {
      const dedupKey = sourceDedupKey(args.sourceRef, args.sourceUrl)
      const twin = dedupKey ? findNodeBySourceKey(this.sessionId, dedupKey) : null
      if (twin) {
        updateNodeContent(
          this.sessionId, twin.id, content, confidence,
          args.sourceRef ? String(args.sourceRef) : null,
          args.sourceUrl ? String(args.sourceUrl) : null,
          args.detail ? String(args.detail) : null,
          level
        )
        insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
          `同源合并：「${title.slice(0, 30)}」与已钉卡「${twin.title.slice(0, 30)}」引用同一文献（${dedupKey}），已并入原卡`,
          `Merged: “${title.slice(0, 30)}” cites the same source (${dedupKey}) as existing card “${twin.title.slice(0, 30)}” — folded into the original`) })
        this.emitState()
        return {
          ok: true, merged: true, nodeId: twin.id, title: twin.title, sourceKey: dedupKey,
          note: L(this.sessionId,
            `同一文献（${dedupKey}）已在卡「${twin.title}」上：已合并更新该卡，未新建重复卡；后续请直接引用该标题或 update_evidence 更新`,
            `Same source (${dedupKey}) already on card “${twin.title}”: merged into it instead of creating a duplicate; reference that title or use update_evidence going forward`),
        }
      }
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
    // Task 27（E2E 实证：9 张卡中 2 张缺 level 且为 meta-分析误用 evidence）：软警告引导自纠
    const warnings: string[] = []
    if ((kind === 'evidence' || kind === 'source') && level == null) {
      warnings.push('本卡未标注 level 证据等级（user/rct/cohort/animal/invitro/computational，按来源研究类型如实分级）——请用 update_evidence {title, patch:{level}} 补上')
    }
    if (kind === 'evidence' && /meta[\s-]?分析|系统综述|荟萃|systematic review|meta[\s-]?analysis|network meta|指南|guideline|综述|review/i.test(`${title} ${content}`)) {
      warnings.push('疑似综述/meta-分析/指南类线索源——后续同类卡片请改用 kind=source（单一原始研究才用 evidence）')
    }
    return warnings.length ? { ok: true, nodeId: node.id, title: node.title, warnings } : { ok: true, nodeId: node.id, title: node.title }
  }

  /**
   * Task 25 证据密度：一次批量落多张卡 + 连线。
   * 动机：每个 ReAct 步骤只做一个动作，逐张 add_evidence 会耗尽步数预算（上代 1.8 卡/任务）；
   * batch_cards 让一个步骤产出 2-6 张卡，密度与步数利用率同步提升。内部复用 toolAddEvidence
   * （自动享受同题更新 + 同源合并防线）与 toolLinkEvidence（同名守卫 + 方向矫正）。
   */
  private toolBatchCards(args: any) {
    const cards = Array.isArray(args.cards) ? args.cards.slice(0, 6) : []
    const links = Array.isArray(args.links) ? args.links.slice(0, 6) : []
    if (!cards.length && !links.length) {
      return { error: 'batch_cards 需要 cards 数组（每项为 add_evidence 的参数，≤6 张），可选 links 数组（每项为 link_evidence 的参数，≤6 条）' }
    }
    const results: unknown[] = []
    let pinned = 0
    let merged = 0
    for (const c of cards) {
      const r = this.toolAddEvidence(c || {})
      results.push(r)
      if ((r as any)?.ok) pinned++
      if ((r as any)?.merged) merged++
    }
    let linked = 0
    for (const l of links) {
      const r = this.toolLinkEvidence(l || {})
      results.push(r)
      if ((r as any)?.ok) linked++
    }
    insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
      `批量落墙：${pinned} 张卡（含合并 ${merged}）+ ${linked} 条连线`,
      `Batch pin: ${pinned} card(s) (${merged} merged) + ${linked} link(s)`) })
    this.emitState()
    return { ok: true, pinned, merged, linked, results }
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

    // Task 24 同名异卡守卫：课题卡与同题假说卡等（同标题不同 id）互连是语义自环，拒绝并引导改连
    const normT = (s: string) => s.toLowerCase().replace(/\s+/g, '')
    if (normT(srcNode.title) === normT(dstNode.title)) {
      return { error: L(this.sessionId,
        `「${srcNode.title.slice(0, 30)}」存在两张同名卡（${srcNode.kind}/${dstNode.kind}），连接它们没有语义意义；请连接到其他证据/假说/课题卡`,
        `Two cards share the title “${srcNode.title.slice(0, 30)}” (${srcNode.kind}/${dstNode.kind}) — linking them is semantically meaningless; link to a different evidence/hypothesis/topic card instead`) }
    }

    // 语义方向矫正：answers 应由假说/证据指向问题；若模型给反了则自动翻转
    let finalSrc = srcNode
    let finalDst = dstNode
    if (relation === 'answers' && srcNode.kind === 'question' && dstNode.kind !== 'question') {
      finalSrc = dstNode
      finalDst = srcNode
    }

    // Task 29 P1-②：contradicts 语义对称——B→A 与已有 A→B 是同一条关系，反向重连不新建平行边
    //（insertEdge 只挡同向重复；有机矛盾落边量上来后 A→B + B→A 双平行线必然出现）
    if (relation === 'contradicts') {
      const reverse = findEdge(this.sessionId, finalDst.id, finalSrc.id, 'contradicts')
      if (reverse) {
        const newLabel = args.label ? String(args.label) : null
        if (newLabel && !reverse.label) updateEdgeLabel(this.sessionId, reverse.id, newLabel)
        insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
          `矛盾边去重：${finalDst.title.slice(0, 24)} ⇄ ${finalSrc.title.slice(0, 24)} 的反向 contradicts 已存在，合并为一条${newLabel && !reverse.label ? '（已补冲突点 label）' : ''}`,
          `Contradiction dedup: reverse contradicts between “${finalDst.title.slice(0, 24)}” and “${finalSrc.title.slice(0, 24)}” already exists — merged into one`) })
        this.emitState()
        return { ok: true, deduped: true, reversed: true, edgeId: reverse.id, note: '该矛盾对已有反向边，已合并；无需重连' }
      }
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
      status: normalizeNodeStatus(patch.status) ?? undefined,
      tags: Array.isArray(patch.tags) ? patch.tags.map(String) : undefined,
      level:
        patch.level !== undefined
          ? node.kind === 'evidence' || node.kind === 'source'
            ? sanityCheckLevel(normalizeLevel(patch.level), node.title, patch.content != null ? String(patch.content) : node.content)
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

  /** 矛盾猎手（Task 22 P1-3 兜底）：综述提及矛盾但墙上零 contradicts 边 → 定向 LLM 调用结构化冲突对 */
  private async ensureContradictionEdges(): Promise<void> {
    try {
      const edges = listEdges(this.sessionId)
      if (edges.some((e) => e.relation === 'contradicts')) return
      const nodes = listNodes(this.sessionId)
      const candidates = nodes.filter((n) => n.kind === 'evidence' || n.kind === 'hypothesis' || n.kind === 'insight')
      if (candidates.length < 2) return
      const narrative = getSessionRow(this.sessionId)?.narrative || ''
      if (!/矛盾|冲突|相反|不一致|争议|controvers|contradict|conflict|discrepan/i.test(narrative)) return

      insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
        '🔎 矛盾猎手：综述提到矛盾但证据墙还没有 contradicts 边，正在定向结构化冲突对…',
        '🔎 Contradiction hunter: the review mentions conflicts but the wall has no contradicts edges yet — structuring pairs…') })
      const list = candidates
        .map((n) => `- ${n.title} | ${n.kind}${n.level ? ` | ${n.level}` : ''} | ${n.content.slice(0, 160)}`)
        .join('\n')
      const userPrompt = `# 节点清单（title | kind | level | content）\n${list}\n\n# 综述片段（矛盾语境）\n${narrative.slice(0, 1200)}\n\n请找出真实存在的冲突对（宁缺毋滥，最多 3 对）。`
      const res = await llmJson<any>(CONTRADICTS_PROMPT, userPrompt, () => this.countLlm(), { face: 'synthesizer' })
      if (!res.ok) {
        insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId, `矛盾猎手失败: ${res.error.slice(0, 80)}`, `Contradiction hunter failed: ${res.error.slice(0, 80)}`), ok: false })
        return
      }
      const pairs = Array.isArray(res.value?.pairs) ? res.value.pairs.slice(0, 3) : []
      let linked = 0
      for (const p of pairs) {
        const r = this.toolLinkEvidence({ from: String(p.from || ''), to: String(p.to || ''), relation: 'contradicts', label: p.label ? String(p.label) : undefined })
        if (r && r.ok) linked++
      }
      if (linked > 0) {
        insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
          `已结构化 ${linked} 对矛盾关系（contradicts）——矛盾是课题的种子`,
          `${linked} contradiction pair(s) structured — contradictions seed research questions`) })
        this.emitState()
      } else {
        insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
          '矛盾猎手未发现可连接的真实冲突对（宁缺毋滥）',
          'No genuine conflicting pairs found (better none than forced)') })
      }
    } catch (e) {
      console.error('[contradiction-hunter]', e)
    }
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
      ? `【本轮聚焦点】${focus}\n【领域范围】${s.topic || s.organism || '见用户画像'} —— 聚焦点是切入角度而非边界：任务应覆盖领域关键侧面（机制 / 对立证据 / 情境外推 / 方法学），不要只在聚焦点字面范围内打转`
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
    // Task 22 P2：预算收敛代码硬约束——剩余 <10 步或 <5 分钟，或总预算本就小（≤12 步 / ≤8 分钟）时，
    // 无论 LLM 规划几个任务只保留前 2 个（prompt 已要求收敛，此处兜底强制服从；10 步小预算曾规划 5 任务导致半数未跑即耗尽）
    const elapsedMs = budget.startedAt ? now() - budget.startedAt : budget.elapsedMs
    const tightNow =
      budget.maxSteps - budget.stepsUsed < 10 ||
      budget.maxSteps <= 12 ||
      budget.maxMinutes * 60_000 - elapsedMs < 5 * 60_000 ||
      budget.maxMinutes <= 8
    const taskLimit = tightNow ? 2 : 5
    const rawTasks = Array.isArray(j.tasks) ? j.tasks.slice(0, taskLimit) : []
    if (Array.isArray(j.tasks) && j.tasks.length > taskLimit) {
      insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
        `预算紧张，计划已收敛至 ${taskLimit} 个核心任务（原规划 ${j.tasks.length} 个）`,
        `Budget tight — plan narrowed to ${taskLimit} core task(s) (planner proposed ${j.tasks.length})`) })
    }
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
    // 全局假说上下文（P2 修复：investigator 曾因看不到假说而过早 ask_user 询问已知信息）
    const planForCtx = getPlan(this.sessionId)
    const globalContext = planForCtx
      ? [
          `核心问题：${planForCtx.focusQuestion || '（未定）'}`,
          ...(planForCtx.hypotheses || []).map((h) => `- ${h.title}${h.basis ? `（依据: ${h.basis}）` : ''}`),
        ].join('\n')
      : undefined
    const systemPrompt = buildInvestigatorPrompt({
      goal: task.goal,
      why: task.why,
      globalContext,
      wallSummary: wallSummary(this.sessionId).slice(0, 3000),
      narrative: row?.narrative || '',
      steering: this.steeringBlock(),
      toolsDoc: toolsDoc(true),
      remainingSteps: Math.max(0, b.maxSteps - b.stepsUsed),
      remainingMinutes: Math.max(0, Math.round((b.maxMinutes * 60_000 - (b.startedAt ? now() - b.startedAt : b.elapsedMs)) / 60_000)),
      langDirective: langDirective(getSessionLang(this.sessionId)),
    })
    const userPrompt = `# 研究历史（thought → action → observation）\n${serializeScratchpad(scratchpad)}\n\n请输出下一步的严格 JSON（{"thought":"...","action":{"tool":"...","args":{...}}}）。\n提醒：已确认的关键事实请尽快 add_evidence / batch_cards 落到证据墙（图操作不消耗全局步数预算，落墙零成本；预算耗尽后未落墙的检索成果将丢失）；剩余预算紧张时应优先落墙与 finish_task，而非继续检索。`
    // Task 27 P1-①：内层 llm() 退避耐心同样受剩余预算钳制（≤剩余 1/4，下限 8s）——
    // 尾段限流风暴不再把几分钟烧在无谓等待上，快速上抛给本循环的时间感知重试梯队
    const res = await llmJson<any>(systemPrompt, userPrompt, () => this.countLlm(), {
      face: 'investigator',
      maxTotalWaitMs: clamp(this.remainingMs() / 4, 8_000, 240_000),
    })
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
    this.lastSynthError = null // 每次进入时重置；仅本次调用失败时写入
    // Task 28 P2-③：最终综合开始事件——第十领域实证 429 风暴期间前端 ~7 分钟只见 synthesizing 无任何事件；
    // 开始/重试均有活动后，用户能看到“它在退避重试”而非“它挂了”
    if (final) {
      insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
        '最终综合：正在基于证据墙生成研究综述（遇 API 限流会自动退避重试；失败转为延迟收官自动补齐，研究数据不丢失）',
        'Final synthesis: generating the research review from the evidence wall (auto-retries on rate limits; falls back to deferred finalization on failure — no data loss)') })
    }
    const plan = getPlan(this.sessionId)
    const nodes = listNodes(this.sessionId)
    const edges = listEdges(this.sessionId)
    const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title || id

    const doneTasks = (plan?.tasks || []).filter((t) => t.done)
    const undoneTasks = (plan?.tasks || []).filter((t) => !t.done)
    const steers = listMessages(this.sessionId).filter((m) => m.kind === 'steer').slice(-10)

    const userPrompt = [
      `【核心问题】${plan?.focusQuestion || '（尚未明确）'}`,
      `【假说】${(plan?.hypotheses || []).map((h) => `- ${h.title}（依据: ${h.basis}）`).join('\n') || '（无）'}`,
      `【证据节点】\n${nodes.map((n) => `- [${n.kind}]${n.level ? ` [${n.level}]` : ''} ${n.title}: ${n.content}${n.sourceRef ? ` [${n.sourceRef}]` : n.sourceUrl ? ` [${n.sourceUrl}]` : ''}${n.confidence != null ? ` (置信度 ${n.confidence})` : ''}`).join('\n') || '（无）'}`,
      `【证据关系】\n${edges.map((e) => `- ${titleOf(e.source)} --${e.relation}--> ${titleOf(e.target)}`).join('\n') || '（无）'}`,
      `【已完成任务小结】\n${doneTasks.map((t) => `- ${t.goal} → ${t.summary || '（无小结）'}`).join('\n') || '（无）'}`,
      ...(final && undoneTasks.length
        ? [`【未完成任务（预算耗尽或中断，这些方向尚无证据覆盖）】\n${undoneTasks.map((t) => `- ${t.goal}（${t.why || '未说明原因'}）`).join('\n')}`]
        : []),
      `【研究期间用户的补充消息】\n${steers.map((m) => `- ${m.content.slice(0, 300)}`).join('\n') || '（无）'}`,
      final
        ? noticeFor(getSessionLang(this.sessionId), 'finalSynthesisNote')
        : getSessionLang(this.sessionId) === 'en'
          ? `This is an interim synthesis. Remaining budget: ${this.remainingText()}.`
          : `这是阶段性综合。剩余预算：${this.remainingText()}。`,
      '请输出严格 JSON。',
      langDirective(getSessionLang(this.sessionId)),
    ].join('\n\n')

    const res0 = await llmJson<any>(SYNTHESIZER_PROMPT, userPrompt, () => this.countLlm(), {
      face: 'synthesizer',
      // Task 27 P1-①：中途综合的内层退避耐心受剩余预算钳制（≤剩余 1/3）；
      // Task 28 P2-③：最终综合内层耐心也上 90s 保底上限——原全量阶梯（8/25/60/120s ≈3.5 分钟/次）
      // 叠加外层 2 轮重试最坏 ~11 分钟且 429 风暴期间全程无事件；延迟收官兜底已验证可靠，
      // 更快转 pendingFinal（横幅可见 + sweeper 自动补）优于长时间静默等待
      maxTotalWaitMs: final ? 90_000 : clamp(this.remainingMs() / 3, 8_000, 240_000),
    })
    // 研究综述是关键调用：退避重试（429 限流常见），最多 3 轮
    // Task 27 P1-①：中途综合的重试等待与剩余预算挂钩（≤剩余 1/3）；最终综合保持原 20s/40s 阶梯
    let res = res0
    if (!res.ok) {
      for (let i = 1; i <= 2; i++) {
        const waitMs = final
          ? 20_000 * i
          : Math.min(20_000 * i, Math.max(10_000, Math.round(this.remainingMs() / 3)))
        insertActivity(this.sessionId, { type: 'notice', summary: L(this.sessionId,
          `综合失败（${res.error.slice(0, 80)}），${Math.round(waitMs / 1000)}s 后重试 ${i}/2`,
          `Synthesis failed (${res.error.slice(0, 80)}) — retry ${i}/2 in ${Math.round(waitMs / 1000)}s`), ok: false })
        await sleep(waitMs)
        res = await llmJson<any>(SYNTHESIZER_PROMPT, userPrompt, () => this.countLlm(), {
          face: 'synthesizer',
          maxTotalWaitMs: final ? 90_000 : clamp(this.remainingMs() / 3, 8_000, 240_000),
        })
        if (res.ok) break
      }
    }
    if (!res.ok) {
      this.lastSynthError = res.error.slice(0, 200) // Task 23：延迟收官记录用
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
      } else if (existing && ['hypothesis', 'insight', 'gap', 'question'].includes(existing.kind)) {
        // Task 25 同题吸收：墙上已有同题假说/洞见/空白卡 → 复用其 id 升格为课题卡。
        // 上代行为是另插一张课题卡 → 同题双卡并存（语义重复）；吸收后连线/位置全保留，课题栏成为唯一本体。
        updateNode(this.sessionId, existing.id, { kind: 'topic', content, tags, starred: !!q.recommended })
        updateNodeContent(this.sessionId, existing.id, content, null, null, null, detail)
        nodeId = existing.id
        insertActivity(this.sessionId, {
          type: 'notice',
          summary: L(this.sessionId,
            `课题卡升格：同题「${oneLine(title, 40)}」${existing.kind} 卡已升格为课题卡（保留原连线）`,
            `Topic promoted: same-titled ${existing.kind} card “${oneLine(title, 40)}” promoted into the research topic card (existing links kept)`),
        })
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
      // Task 24 守卫：evidence_refs 解析到与课题卡同名的卡（如 synth 同时落了同题假说卡）→ 语义自环，跳过
      const nodes = listNodes(this.sessionId)
      const normTitle = (s: string) => s.toLowerCase().replace(/\s+/g, '')
      for (const ref of (q.evidenceRefs || []).slice(0, 4)) {
        const target = resolveNodeByTitle(nodes, String(ref))
        if (target && target.id !== nodeId && target.kind !== 'topic' && normTitle(target.title) !== normTitle(title)) {
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
