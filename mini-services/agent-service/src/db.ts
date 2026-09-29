// db.ts — bun:sqlite 初始化（WAL）+ 全部 CRUD
// 类型契约与 docs/ARCHITECTURE.md §2/§5 保持一致
import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { now, uuid } from './util'

// ---------- 共享类型（§2） ----------
export type SessionPhase =
  | 'interview' | 'planning' | 'investigating' | 'synthesizing'
  | 'awaiting_user' | 'done'

export type AgentStatus =
  | 'idle' | 'thinking' | 'running' | 'paused'
  | 'awaiting_user' | 'done' | 'error' | 'interrupted'

export type NodeKind = 'question' | 'hypothesis' | 'evidence' | 'insight' | 'source' | 'gap' | 'topic'

export type EdgeRelation = 'supports' | 'contradicts' | 'relates' | 'derives' | 'answers'

export type BoardNode = {
  id: string
  kind: NodeKind
  title: string
  content: string
  tags: string[]
  sourceUrl: string | null
  sourceRef: string | null
  confidence: number | null
  starred: boolean
  pinnedBy: 'agent' | 'user'
  status: 'new' | 'strong' | 'weak' | 'contradicted'
  createdAt: number
  position: { x: number; y: number } | null
}

export type BoardEdge = {
  id: string
  source: string
  target: string
  relation: EdgeRelation
  label: string | null
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  kind: 'chat' | 'question' | 'steer' | 'steer_ack' | 'notice' | 'synthesis'
  content: string
  data: Record<string, unknown> | null
  createdAt: number
}

export type ResearchQuestion = {
  id: string
  text: string
  rationale: string
  scores: { novelty: number; feasibility: number; impact: number }
  recommended: boolean
  evidenceRefs: string[]
}

// ---------- 深研方向（Task 12：从证据链提炼研究方向 + 研究计划） ----------

export type DirectionPlanStep = { step: string; detail: string; duration?: string }
export type DirectionLiterature = { ref: string; note?: string }

export type ResearchDirection = {
  title: string
  why: string
  scores: { novelty: number; feasibility: number; impact: number }
  evidenceRefs: string[]
  plan: {
    objective: string
    keyQuestions: string[]
    approach: DirectionPlanStep[]
    methods: string[]
    expectedOutcome: string
    risks?: string
  }
  literature: DirectionLiterature[]
}

export type ResearchDirections = {
  generatedAt: number
  summary?: string
  directions: ResearchDirection[]
}

// ---------- 课题探索闭环（Task 16：单课题探索方案 + 反馈推导循环） ----------

export type ExploreStep = { step: string; detail: string; duration?: string }

export type TopicPlan = {
  objective: string
  hypothesis: string
  keyQuestions: string[]
  design: ExploreStep[]
  methods: string[]
  metrics: string[]
  expectedOutcome: string
  risks?: string
}

export type ExploreVerdict = 'supports' | 'contradicts' | 'mixed' | 'inconclusive' | 'refined'

export type FeedbackRound = {
  n: number
  feedback: string
  analysis: string
  verdict: ExploreVerdict
  logicUpdates: string[]
  nextSteps: string[]
  planPatch: Partial<TopicPlan> | null
  createdAt: number
}

export type Exploration = {
  nodeId: string
  topicTitle: string
  generatedAt: number
  updatedAt: number
  plan: TopicPlan
  rounds: FeedbackRound[]
}

export type Plan = {
  round: number
  focusQuestion: string
  tasks: PlanTask[]
  hypotheses: { title: string; basis: string }[]
}

export type SessionMeta = {
  ready: boolean
  signals: {
    topic: string
    organism: string
    scale: string
    mechanism_interest: string
    method_context: string
  }
  pendingQuestion?: string | null
  title_suggestion?: string
  /** 会话输出语言（Task 13 双语）：zh 默认；由前端随请求透传并落库 */
  lang?: 'zh' | 'en'
}

export type Budget = {
  maxSteps: number
  maxMinutes: number
  stepsUsed: number
  toolCalls: number
  llmCalls: number
  startedAt: number | null
  round: number
  elapsedMs: number
}

export type Stats = Budget & {
  evidenceCount: number
  sourceCount: number
}

export type ActivityEvent = {
  id: number
  ts: number
  type: 'thought' | 'tool_call' | 'tool_result' | 'phase' | 'notice'
  tool?: string
  summary: string
  ok?: boolean
  durationMs?: number
  step?: number
}

export type SessionSummary = {
  id: string
  title: string
  phase: SessionPhase
  status: AgentStatus
  createdAt: number
  updatedAt: number
  counts: { messages: number; nodes: number; edges: number; questions: number }
  hasNarrative: boolean
}

export type SessionFull = {
  id: string
  title: string
  phase: SessionPhase
  status: AgentStatus
  createdAt: number
  updatedAt: number
  ready: boolean
  budget: { maxSteps: number; maxMinutes: number }
}

// topic：综合分析师提炼出的「值得深入研究的科学课题」卡（Task 14 新流程，醒目钉在证据墙课题栏）
export const NODE_KINDS: NodeKind[] = ['question', 'hypothesis', 'evidence', 'insight', 'source', 'gap', 'topic']
export const EDGE_RELATIONS: EdgeRelation[] = ['supports', 'contradicts', 'relates', 'derives', 'answers']

// ---------- 数据库初始化 ----------
const DATA_DIR = join(process.cwd(), 'data')
const DB_PATH = join(DATA_DIR, 'serendip.db')
mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(DB_PATH)
db.exec('PRAGMA journal_mode=WAL;')
db.exec('PRAGMA busy_timeout=5000;')

db.exec(`
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '新课题',
  phase TEXT NOT NULL DEFAULT 'interview', status TEXT NOT NULL DEFAULT 'idle',
  meta TEXT NOT NULL DEFAULT '{}',
  plan TEXT, narrative TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'chat', content TEXT NOT NULL,
  data TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]', source_url TEXT, source_ref TEXT,
  confidence REAL, starred INTEGER NOT NULL DEFAULT 0,
  pinned_by TEXT NOT NULL DEFAULT 'agent', status TEXT NOT NULL DEFAULT 'new',
  x REAL, y REAL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS edges(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
  source TEXT NOT NULL, target TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'relates', label TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS questions(
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, text TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '', scores TEXT NOT NULL DEFAULT '{}',
  recommended INTEGER NOT NULL DEFAULT 0, evidence_refs TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS activity(
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
  type TEXT NOT NULL, tool TEXT, summary TEXT NOT NULL,
  ok INTEGER, duration_ms INTEGER, step INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_session ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_nodes_session ON nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_edges_session ON edges(session_id);
CREATE INDEX IF NOT EXISTS idx_q_session ON questions(session_id);
CREATE INDEX IF NOT EXISTS idx_act_session ON activity(session_id, id);
CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS explorations(
  node_id TEXT PRIMARY KEY, session_id TEXT NOT NULL,
  topic_title TEXT NOT NULL, data TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_explore_session ON explorations(session_id);
`)

// 轻量迁移：老库补 nodes.detail 列（卡片详细说明，Task 11）
try {
  const cols = db.query('PRAGMA table_info(nodes)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'detail')) {
    db.exec('ALTER TABLE nodes ADD COLUMN detail TEXT')
    console.log('[db] migrated: nodes.detail added')
  }
} catch (e) {
  console.error('[db] migrate nodes.detail failed:', e)
}

// 轻量迁移：老库补 sessions.directions 列（深研方向，Task 12）
try {
  const cols = db.query('PRAGMA table_info(sessions)').all() as { name: string }[]
  if (!cols.some((c) => c.name === 'directions')) {
    db.exec('ALTER TABLE sessions ADD COLUMN directions TEXT')
    console.log('[db] migrated: sessions.directions added')
  }
} catch (e) {
  console.error('[db] migrate sessions.directions failed:', e)
}

// 启动时：未完成的会话标记 interrupted；awaiting_user 一并复位为 interview
// （P1 修复：runtime 已随进程丢失，若保留 awaiting_user，用户回复将无法注入且输入框永久锁死）
db.exec(
  `UPDATE sessions SET status='interrupted', phase=CASE WHEN phase='awaiting_user' THEN 'interview' ELSE phase END, updated_at=${now()} WHERE status IN ('running','thinking','paused','awaiting_user')`
)

// ---------- 行映射 ----------
type SessionRow = {
  id: string; title: string; phase: string; status: string
  meta: string; plan: string | null; narrative: string; budget: string
  directions: string | null
  created_at: number; updated_at: number
}
type MessageRow = {
  id: string; session_id: string; role: string; kind: string
  content: string; data: string | null; created_at: number
}
type NodeRow = {
  id: string; session_id: string; kind: string; title: string; content: string
  tags: string; source_url: string | null; source_ref: string | null
  confidence: number | null; starred: number; pinned_by: string; status: string
  x: number | null; y: number | null; created_at: number; updated_at: number
  detail: string | null
}
type EdgeRow = {
  id: string; session_id: string; source: string; target: string
  relation: string; label: string | null; created_at: number
}
type QuestionRow = {
  id: string; session_id: string; text: string; rationale: string
  scores: string; recommended: number; evidence_refs: string; updated_at: number
}
type ActivityRow = {
  id: number; session_id: string; type: string; tool: string | null
  summary: string; ok: number | null; duration_ms: number | null
  step: number | null; created_at: number
}
type ExplorationRow = {
  node_id: string; session_id: string; topic_title: string
  data: string; created_at: number; updated_at: number
}

function mapMessage(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    role: r.role as ChatMessage['role'],
    kind: r.kind as ChatMessage['kind'],
    content: r.content,
    data: r.data ? JSON.parse(r.data) : null,
    createdAt: r.created_at,
  }
}

function mapNode(r: NodeRow): BoardNode {
  return {
    id: r.id,
    kind: r.kind as NodeKind,
    title: r.title,
    content: r.content,
    detail: r.detail ?? null,
    tags: JSON.parse(r.tags || '[]'),
    sourceUrl: r.source_url,
    sourceRef: r.source_ref,
    confidence: r.confidence,
    starred: !!r.starred,
    pinnedBy: r.pinned_by as 'agent' | 'user',
    status: r.status as BoardNode['status'],
    createdAt: r.created_at,
    position: r.x != null && r.y != null ? { x: r.x, y: r.y } : null,
  }
}

function mapEdge(r: EdgeRow): BoardEdge {
  return {
    id: r.id,
    source: r.source,
    target: r.target,
    relation: r.relation as EdgeRelation,
    label: r.label,
  }
}

function mapQuestion(r: QuestionRow): ResearchQuestion {
  return {
    id: r.id,
    text: r.text,
    rationale: r.rationale,
    scores: JSON.parse(r.scores || '{}'),
    recommended: !!r.recommended,
    evidenceRefs: JSON.parse(r.evidence_refs || '[]'),
  }
}

function mapActivity(r: ActivityRow): ActivityEvent {
  return {
    id: r.id,
    ts: r.created_at,
    type: r.type as ActivityEvent['type'],
    tool: r.tool ?? undefined,
    summary: r.summary,
    ok: r.ok == null ? undefined : !!r.ok,
    durationMs: r.duration_ms ?? undefined,
    step: r.step ?? undefined,
  }
}

export function defaultMeta(): SessionMeta {
  return {
    ready: false,
    signals: { topic: '', organism: '', scale: '', mechanism_interest: '', method_context: '' },
    pendingQuestion: null,
  }
}

export function defaultBudget(): Budget {
  return { maxSteps: 40, maxMinutes: 15, stepsUsed: 0, toolCalls: 0, llmCalls: 0, startedAt: null, round: 0, elapsedMs: 0 }
}

// ---------- sessions ----------
export function createSession(title?: string, lang?: 'zh' | 'en'): SessionRow {
  const id = uuid()
  const t = now()
  const meta = { ...defaultMeta(), ...(lang === 'en' ? { lang: 'en' as const } : {}) }
  const row: SessionRow = {
    id, title: title || (lang === 'en' ? 'New Project' : '新课题'), phase: 'interview', status: 'idle',
    meta: JSON.stringify(meta), plan: null, narrative: '',
    budget: JSON.stringify(defaultBudget()), created_at: t, updated_at: t,
  }
  db.run(
    `INSERT INTO sessions(id,title,phase,status,meta,plan,narrative,budget,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.title, row.phase, row.status, row.meta, row.plan, row.narrative, row.budget, t, t]
  )
  return row
}

export function getSessionRow(id: string): SessionRow | null {
  return (db.query('SELECT * FROM sessions WHERE id=?').get(id) as SessionRow) ?? null
}

export function touchSession(id: string) {
  db.run(`UPDATE sessions SET updated_at=? WHERE id=?`, [now(), id])
}

export function updateSessionFields(id: string, fields: Partial<{ title: string; phase: string; status: string; meta: string; plan: string | null; narrative: string; budget: string; directions: string | null }>) {
  const keys = Object.keys(fields)
  if (!keys.length) return
  const setSql = keys.map((k) => `${k}=?`).join(',')
  db.run(`UPDATE sessions SET ${setSql}, updated_at=${now()} WHERE id=?`, [...keys.map((k) => (fields as any)[k]), id])
}

export function getMeta(id: string): SessionMeta {
  const r = getSessionRow(id)
  if (!r) return defaultMeta()
  try {
    return { ...defaultMeta(), ...JSON.parse(r.meta) }
  } catch {
    return defaultMeta()
  }
}

export function saveMeta(id: string, meta: SessionMeta) {
  updateSessionFields(id, { meta: JSON.stringify(meta) })
}

export function getBudget(id: string): Budget {
  const r = getSessionRow(id)
  if (!r) return defaultBudget()
  try {
    return { ...defaultBudget(), ...JSON.parse(r.budget) }
  } catch {
    return defaultBudget()
  }
}

export function saveBudget(id: string, b: Budget) {
  updateSessionFields(id, { budget: JSON.stringify(b) })
}

export function getPlan(id: string): Plan | null {
  const r = getSessionRow(id)
  if (!r || !r.plan) return null
  try {
    return JSON.parse(r.plan) as Plan
  } catch {
    return null
  }
}

export function savePlan(id: string, plan: Plan | null) {
  updateSessionFields(id, { plan: plan ? JSON.stringify(plan) : null })
}

// ---------- directions（深研方向，Task 12） ----------
export function getDirections(id: string): ResearchDirections | null {
  const r = getSessionRow(id)
  if (!r || !r.directions) return null
  try {
    const parsed = JSON.parse(r.directions) as ResearchDirections
    return Array.isArray(parsed?.directions) && parsed.directions.length ? parsed : null
  } catch {
    return null
  }
}

export function saveDirections(id: string, d: ResearchDirections) {
  updateSessionFields(id, { directions: JSON.stringify(d) })
}

export function mapSessionFull(r: SessionRow): SessionFull & { narrative: string } {
  const meta = (() => { try { return { ...defaultMeta(), ...JSON.parse(r.meta) } } catch { return defaultMeta() } })()
  const budget = (() => { try { return { ...defaultBudget(), ...JSON.parse(r.budget) } } catch { return defaultBudget() } })()
  return {
    id: r.id,
    title: r.title,
    phase: r.phase as SessionPhase,
    status: r.status as AgentStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ready: !!meta.ready,
    budget: { maxSteps: budget.maxSteps, maxMinutes: budget.maxMinutes },
    narrative: r.narrative,
  }
}

export function listSessionSummaries(): SessionSummary[] {
  const rows = db.query('SELECT * FROM sessions ORDER BY updated_at DESC').all() as SessionRow[]
  return rows.map((r) => {
    const counts = {
      messages: (db.query('SELECT COUNT(*) c FROM messages WHERE session_id=?').get(r.id) as any).c,
      nodes: (db.query('SELECT COUNT(*) c FROM nodes WHERE session_id=?').get(r.id) as any).c,
      edges: (db.query('SELECT COUNT(*) c FROM edges WHERE session_id=?').get(r.id) as any).c,
      questions: (db.query('SELECT COUNT(*) c FROM questions WHERE session_id=?').get(r.id) as any).c,
    }
    return {
      id: r.id,
      title: r.title,
      phase: r.phase as SessionPhase,
      status: r.status as AgentStatus,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      counts,
      hasNarrative: !!r.narrative,
    }
  })
}

export function deleteSession(id: string) {
  db.run('DELETE FROM messages WHERE session_id=?', [id])
  db.run('DELETE FROM nodes WHERE session_id=?', [id])
  db.run('DELETE FROM edges WHERE session_id=?', [id])
  db.run('DELETE FROM questions WHERE session_id=?', [id])
  db.run('DELETE FROM activity WHERE session_id=?', [id])
  db.run('DELETE FROM sessions WHERE id=?', [id])
}

// ---------- messages ----------
export function insertMessage(
  sessionId: string,
  msg: { role: ChatMessage['role']; kind: ChatMessage['kind']; content: string; data?: Record<string, unknown> | null }
): ChatMessage {
  const id = uuid()
  const t = now()
  db.run(
    `INSERT INTO messages(id,session_id,role,kind,content,data,created_at) VALUES(?,?,?,?,?,?,?)`,
    [id, sessionId, msg.role, msg.kind, msg.content, msg.data ? JSON.stringify(msg.data) : null, t]
  )
  return { id, role: msg.role, kind: msg.kind, content: msg.content, data: msg.data ?? null, createdAt: t }
}

export function listMessages(sessionId: string): ChatMessage[] {
  const rows = db.query('SELECT * FROM messages WHERE session_id=? ORDER BY created_at ASC, id ASC').all(sessionId) as MessageRow[]
  return rows.map(mapMessage)
}

// ---------- nodes ----------
export function insertNode(
  sessionId: string,
  n: Partial<BoardNode> & { title: string; kind: NodeKind }
): BoardNode {
  const id = n.id || uuid()
  const t = now()
  db.run(
    `INSERT INTO nodes(id,session_id,kind,title,content,detail,tags,source_url,source_ref,confidence,starred,pinned_by,status,x,y,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, sessionId, n.kind, n.title.slice(0, 60), (n.content || '').slice(0, 400),
      (n.detail || '').slice(0, 1200) || null,
      JSON.stringify(n.tags || []), n.sourceUrl ?? null, n.sourceRef ?? null,
      n.confidence ?? null, n.starred ? 1 : 0, n.pinnedBy || 'agent', n.status || 'new',
      null, null, t, t,
    ]
  )
  return {
    id, kind: n.kind, title: n.title.slice(0, 60), content: (n.content || '').slice(0, 400),
    detail: (n.detail || '').slice(0, 1200) || null,
    tags: n.tags || [], sourceUrl: n.sourceUrl ?? null, sourceRef: n.sourceRef ?? null,
    confidence: n.confidence ?? null, starred: !!n.starred, pinnedBy: n.pinnedBy || 'agent',
    status: n.status || 'new', createdAt: t, position: null,
  }
}

export function listNodes(sessionId: string): BoardNode[] {
  const rows = db.query('SELECT * FROM nodes WHERE session_id=? ORDER BY created_at ASC').all(sessionId) as NodeRow[]
  return rows.map(mapNode)
}

export function findNodeByTitle(sessionId: string, title: string): BoardNode | null {
  // 仅精确匹配（忽略大小写与空白）：子串包含会把不同节点误判为同一节点，
  // 导致 add_evidence 把新证据当作旧节点更新、内容被覆盖丢失（P2 修复）。
  // 模糊引用清由 link_evidence 的 resolve 自行处理并向模型返回候选列表消歧。
  const nodes = listNodes(sessionId)
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const t = norm(title)
  return nodes.find((n) => norm(n.title) === t) ?? null
}

export function updateNode(sessionId: string, nodeId: string, patch: Partial<Pick<BoardNode, 'confidence' | 'content' | 'status' | 'tags' | 'title' | 'starred'>>) {
  const sets: string[] = []
  const vals: any[] = []
  if (patch.confidence !== undefined) { sets.push('confidence=?'); vals.push(patch.confidence) }
  if (patch.content !== undefined) { sets.push('content=?'); vals.push(patch.content.slice(0, 400)) }
  if (patch.status !== undefined) { sets.push('status=?'); vals.push(patch.status) }
  if (patch.tags !== undefined) { sets.push('tags=?'); vals.push(JSON.stringify(patch.tags)) }
  if (patch.title !== undefined) { sets.push('title=?'); vals.push(patch.title.slice(0, 60)) }
  if (patch.starred !== undefined) { sets.push('starred=?'); vals.push(patch.starred ? 1 : 0) }
  if (!sets.length) return
  db.run(`UPDATE nodes SET ${sets.join(',')}, updated_at=${now()} WHERE id=? AND session_id=?`, [...vals, nodeId, sessionId])
}

export function updateNodeContent(sessionId: string, nodeId: string, content: string, confidence: number | null, sourceRef: string | null, sourceUrl: string | null, detail?: string | null) {
  db.run(
    `UPDATE nodes SET content=?, confidence=?, source_ref=COALESCE(?, source_ref), source_url=COALESCE(?, source_url), detail=COALESCE(?, detail), updated_at=${now()} WHERE id=? AND session_id=?`,
    [content.slice(0, 400), confidence, sourceRef, sourceUrl, detail ? detail.slice(0, 1200) : null, nodeId, sessionId]
  )
}

export function setNodePositions(sessionId: string, positions: { id: string; x: number; y: number }[]) {
  for (const p of positions) {
    db.run(`UPDATE nodes SET x=?, y=?, updated_at=${now()} WHERE id=? AND session_id=?`, [p.x, p.y, p.id, sessionId])
  }
  touchSession(sessionId)
}

/**
 * 清理陈旧的 topic 课题卡：删除 kind='topic' 且标题不在 keepTitles（规范化后）中的节点及其连线。
 * 每轮综合 replaceQuestions 后调用，让课题栏始终与最新一轮提炼的科学问题集一致（同题保留原 id，不破坏连线/位置）。
 */
export function deleteStaleTopicNodes(sessionId: string, keepTitles: string[]): number {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const keep = new Set(keepTitles.map(norm))
  const stale = listNodes(sessionId).filter((n) => n.kind === 'topic' && !keep.has(norm(n.title)))
  for (const n of stale) {
    db.run('DELETE FROM edges WHERE session_id=? AND (source=? OR target=?)', [sessionId, n.id, n.id])
    db.run('DELETE FROM nodes WHERE id=? AND session_id=?', [n.id, sessionId])
  }
  return stale.length
}

// ---------- edges ----------
export function insertEdge(sessionId: string, source: string, target: string, relation: EdgeRelation, label?: string | null): BoardEdge | null {
  // 防重复边（同 source+target+relation）
  const dup = db
    .query('SELECT id FROM edges WHERE session_id=? AND source=? AND target=? AND relation=?')
    .get(sessionId, source, target, relation)
  if (dup) return null
  const id = uuid()
  db.run(
    `INSERT INTO edges(id,session_id,source,target,relation,label,created_at) VALUES(?,?,?,?,?,?,?)`,
    [id, sessionId, source, target, relation, label ?? null, now()]
  )
  return { id, source, target, relation, label: label ?? null }
}

export function listEdges(sessionId: string): BoardEdge[] {
  const rows = db.query('SELECT * FROM edges WHERE session_id=? ORDER BY created_at ASC').all(sessionId) as EdgeRow[]
  return rows.map(mapEdge)
}

// ---------- questions ----------
export function replaceQuestions(sessionId: string, qs: Omit<ResearchQuestion, 'id'>[]) {
  db.run('DELETE FROM questions WHERE session_id=?', [sessionId])
  const t = now()
  for (const q of qs) {
    db.run(
      `INSERT INTO questions(id,session_id,text,rationale,scores,recommended,evidence_refs,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
      [uuid(), sessionId, q.text, q.rationale, JSON.stringify(q.scores), q.recommended ? 1 : 0, JSON.stringify(q.evidenceRefs || []), t]
    )
  }
}

export function listQuestions(sessionId: string): ResearchQuestion[] {
  const rows = db.query('SELECT * FROM questions WHERE session_id=? ORDER BY updated_at ASC, rowid ASC').all(sessionId) as QuestionRow[]
  return rows.map(mapQuestion)
}

// ---------- activity ----------
export function insertActivity(
  sessionId: string,
  ev: { type: ActivityEvent['type']; tool?: string; summary: string; ok?: boolean; durationMs?: number; step?: number }
) {
  db.run(
    `INSERT INTO activity(session_id,type,tool,summary,ok,duration_ms,step,created_at) VALUES(?,?,?,?,?,?,?,?)`,
    [sessionId, ev.type, ev.tool ?? null, ev.summary, ev.ok == null ? null : ev.ok ? 1 : 0, ev.durationMs ?? null, ev.step ?? null, now()]
  )
}

export function listActivity(sessionId: string, limit = 120): ActivityEvent[] {
  const rows = db
    .query('SELECT * FROM activity WHERE session_id=? ORDER BY id DESC LIMIT ?')
    .all(sessionId, limit) as ActivityRow[]
  return rows.reverse().map(mapActivity)
}

// ---------- explorations（课题探索闭环，Task 16） ----------

function mapExploration(r: ExplorationRow): Exploration {
  try {
    const parsed = JSON.parse(r.data) as Omit<Exploration, 'nodeId' | 'topicTitle' | 'updatedAt'>
    return {
      nodeId: r.node_id,
      topicTitle: r.topic_title,
      generatedAt: parsed.generatedAt ?? r.created_at,
      updatedAt: r.updated_at,
      plan: parsed.plan,
      rounds: Array.isArray(parsed.rounds) ? parsed.rounds : [],
    }
  } catch {
    return {
      nodeId: r.node_id, topicTitle: r.topic_title, generatedAt: r.created_at, updatedAt: r.updated_at,
      plan: { objective: '', hypothesis: '', keyQuestions: [], design: [], methods: [], metrics: [], expectedOutcome: '' },
      rounds: [],
    }
  }
}

export function getExploration(sessionId: string, nodeId: string): Exploration | null {
  const r = db
    .query('SELECT * FROM explorations WHERE session_id=? AND node_id=?')
    .get(sessionId, nodeId) as ExplorationRow | undefined
  return r ? mapExploration(r) : null
}

export function listExplorations(sessionId: string): Exploration[] {
  const rows = db.query('SELECT * FROM explorations WHERE session_id=? ORDER BY updated_at DESC').all(sessionId) as ExplorationRow[]
  return rows.map(mapExploration)
}

export function saveExploration(sessionId: string, e: Exploration) {
  const t = now()
  const payload = JSON.stringify({ generatedAt: e.generatedAt, plan: e.plan, rounds: e.rounds })
  const existing = db.query('SELECT node_id FROM explorations WHERE session_id=? AND node_id=?').get(sessionId, e.nodeId)
  if (existing) {
    db.run(
      'UPDATE explorations SET topic_title=?, data=?, updated_at=? WHERE session_id=? AND node_id=?',
      [e.topicTitle.slice(0, 80), payload, t, sessionId, e.nodeId]
    )
  } else {
    db.run(
      'INSERT INTO explorations(node_id,session_id,topic_title,data,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      [e.nodeId, sessionId, e.topicTitle.slice(0, 80), payload, t, t]
    )
  }
  touchSession(sessionId)
}

export function deleteExploration(sessionId: string, nodeId: string) {
  db.run('DELETE FROM explorations WHERE session_id=? AND node_id=?', [sessionId, nodeId])
}

// ---------- stats ----------
export function computeStats(sessionId: string, budget: Budget): Stats {
  const nodes = listNodes(sessionId)
  return {
    ...budget,
    evidenceCount: nodes.filter((n) => n.kind === 'evidence').length,
    sourceCount: nodes.filter((n) => n.kind === 'source').length,
  }
}
