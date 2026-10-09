// index.ts — Bun.serve 路由入口（端口 3002，路径前缀 /api/agent）
import {
  createSession, getSessionRow, mapSessionFull, listSessionSummaries, deleteSession,
  updateSessionFields, listMessages, listNodes, listEdges, listQuestions, getPlan,
  listActivity, listActivityPage, insertActivity, insertNode, insertMessage, setNodePositions, updateNode, getBudget,
  computeStats, touchSession, getDirections, listExplorations, NODE_KINDS,
} from './src/db'
import { broadcast, makeSseResponse } from './src/emitter'
import { AgentRuntime, stateSnapshot, sweepPendingFinals } from './src/runtime'
import { seedDemoSession } from './src/seed'
import { generateDirections, directionsRunning } from './src/directions'
import { generateExplorePlan, submitExploreFeedback, regenerateExplorePlan, exploreJobOf } from './src/explore'
import { getSessionLang, setSessionLang, normLang, noticeFor } from './src/lang'
import { sleep, clamp } from './src/util'
import {
  PROVIDER_CATALOG,
  getLlmSettings,
  saveLlmSettings,
  maskedSettings,
  type LlmSettings,
} from './src/llm-config'
import { testLlmConnection, listRemoteModels } from './src/llm'

const PORT = 3002
const VERSION = '1.0.0'
const startedAt = Date.now()

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })

// ---- 防静默崩溃：Bun 对 unhandled rejection 默认退出进程，全部接管并记日志 ----
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
})

const errJson = (message: string, status: number) => json({ error: message }, status)

async function readBody(request: Request): Promise<any> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

// ---------- GET /api/agent/sessions/:id 完整数据 ----------
function sessionFullPayload(id: string) {
  const row = getSessionRow(id)
  if (!row) return null
  const budget = getBudget(id)
  const elapsedMs = budget.startedAt ? Date.now() - budget.startedAt : budget.elapsedMs
  const stats = computeStats(id, { ...budget, elapsedMs })
  return {
    session: mapSessionFull(row),
    messages: listMessages(id),
    nodes: listNodes(id),
    edges: listEdges(id),
    narrative: row.narrative || '',
    questions: listQuestions(id),
    plan: getPlan(id),
    directions: getDirections(id),
    explorations: listExplorations(id),
    stats,
    activity: listActivity(id, 240),
    // Task 29 P1-③：初始加载只携带尾部 240 条，hasMore 供前端「加载更早」按钮判定
    activityMore: listActivityPage(id, null, 1).total > 240,
  }
}

// ---------- chat 语义（§3） ----------
async function handleChat(id: string, request: Request) {
  const row = getSessionRow(id)
  if (!row) return errJson('session not found', 404)
  const body = await readBody(request)
  const text = String(body.text || '').trim()
  if (!text) return errJson('缺少 text', 400)
  if (body.lang) setSessionLang(id, normLang(body.lang))

  const runtime = AgentRuntime.get(id)

  // 1) awaiting_user：用户回复即答案 → 注入并恢复
  if (row.phase === 'awaiting_user') {
    const injected = runtime.injectUserAnswer(text)
    if (injected) {
      const msg = insertMessage(id, { role: 'user', kind: 'chat', content: text })
      broadcast(id, 'message', msg)
      return json({ ok: true, mode: 'queued' })
    }
    // P1 修复：runtime 不在等待（服务重启后 DB 残留 awaiting_user）→ 复位为访谈态走下方链路，
    // 不再重复插 steer 消息（旧逻辑同一句话先插 chat 再插 steer，聊天窗出现两条且 phase 永久卡死）
    updateSessionFields(id, { phase: 'interview', status: 'idle' })
    broadcast(id, 'phase', { phase: 'interview', status: 'idle' })
  }

  // 2) 调查类 phase：steer 入队
  if (row.phase === 'planning' || row.phase === 'investigating' || row.phase === 'synthesizing') {
    insertMessage(id, { role: 'user', kind: 'steer', content: text })
    runtime.steeringQueue.push(text)
    const notice = insertMessage(id, {
      role: 'system',
      kind: 'notice',
      content: noticeFor(getSessionLang(id), 'steerQueued'),
    })
    broadcast(id, 'message', notice)
    touchSession(id)
    return json({ ok: true, mode: 'steer' })
  }

  // 3) interview / idle / done：访谈链路（互斥）
  if (runtime.interviewLocked) return errJson('agent_busy', 409)
  // LLM 访谈耗时较长 → 后台执行，立即返回（结果经 SSE 推送）
  void runtime.interviewTurn(text).catch((e) => {
    console.error('[interviewTurn]', e)
    try {
      const errMsg = insertMessage(id, { role: 'assistant', kind: 'notice', content: noticeFor(getSessionLang(id), 'interviewerUnavailable') })
      broadcast(id, 'message', errMsg)
    } catch { /* ignore */ }
  })
  return json({ ok: true, mode: 'interview' })
}

// ---------- research ----------
async function handleResearch(id: string, request: Request) {
  const row = getSessionRow(id)
  if (!row) return errJson('session not found', 404)
  const body = await readBody(request)
  if (body.lang) setSessionLang(id, normLang(body.lang))
  const focus = body.focus ? String(body.focus).trim().slice(0, 500) : undefined
  // Task 27：默认预算 40/15 → 48/20（与 AUTO_START_BUDGET / 前端标准档对齐——时间取代步数成为瓶颈）
  const maxSteps = clamp(Math.round(Number(body.maxSteps) || 48), 1, 200)
  const maxMinutes = clamp(Math.round(Number(body.maxMinutes) || 20), 1, 240)

  const existing = AgentRuntime.find(id)
  if (existing?.running && !existing.isPaused()) return errJson('agent_busy', 409)

  // 已暂停的旧循环 → stop 收尾后自动开启新一轮（异步，不阻塞响应）
  void (async () => {
    try {
      if (existing?.running) {
        existing.stop()
        for (let i = 0; i < 600 && existing.running; i++) await sleep(200)
      }
      const rt = AgentRuntime.get(id)
      if (rt.running) {
        for (let i = 0; i < 600 && rt.running; i++) await sleep(200)
      }
      // P2 修复：120s 后旧循环仍未收尾（如超长综合叠 429 退避）→ 向前端报错而非静默丢弃
      if (rt.running) {
        const lang = getSessionLang(id)
        broadcast(id, 'error', {
          message: lang === 'en'
            ? 'The previous run is still wrapping up — please try starting again in a minute.'
            : '上一轮研究仍在收尾，请稍候一分钟再启动。',
        })
        return
      }
      console.log(`[research] session=${id} focus=${focus || '(auto)'} maxSteps=${maxSteps} maxMinutes=${maxMinutes}`)
      await rt.start(focus, maxSteps, maxMinutes)
    } catch (e) {
      console.error('[research-start]', e)
    }
  })()

  return json({ ok: true })
}

// ---------- control ----------
function handleControl(id: string, body: any) {
  const action = String(body.action || '')
  const rt = AgentRuntime.find(id)
  switch (action) {
    case 'pause':
      rt?.pause()
      return json({ ok: true })
    case 'resume': {
      if (rt?.running && rt.isPaused()) {
        rt.resume()
        return json({ ok: true })
      }
      if (rt?.running && !rt.isPaused()) return errJson('agent_not_paused', 400)
      // runtime 已丢失（进程重启/热重载）但 DB 仍是 paused → 等效于再次启动调查（planner 续查已有证据墙）
      const row = getSessionRow(id)
      if (row && (row.status === 'paused' || row.status === 'interrupted')) {
        const b = getBudget(id)
        console.log(`[control] resume-as-restart session=${id}`)
        void AgentRuntime.get(id).start(undefined, b.maxSteps, b.maxMinutes)
        return json({ ok: true, mode: 'restarted' })
      }
      return errJson('agent_not_paused', 400)
    }
    case 'stop':
      rt?.stop()
      return json({ ok: true })
    default:
      return errJson('未知 action（合法值: pause/resume/stop）', 400)
  }
}

// ---------- 路由 ----------
const server = Bun.serve({
  port: PORT,
  // SSE 长连接：默认 idleTimeout(10s) 会掐断 15s 心跳间隔的空闲流，放宽到 60s
  idleTimeout: 60,
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // --- 健康检查 ---
    if (method === 'GET' && path === '/api/agent/health') {
      return json({ ok: true, version: VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000) })
    }

    // --- LLM 配置（Task 11） ---
    if (path === '/api/agent/llm-config') {
      if (method === 'GET') {
        return json({ settings: maskedSettings(getLlmSettings()), catalog: PROVIDER_CATALOG })
      }
      if (method === 'PUT') {
        const body = await readBody(request)
        const patch: Partial<LlmSettings> = {}
        if (typeof body.providerId === 'string' && body.providerId) patch.providerId = body.providerId
        if (typeof body.model === 'string') patch.model = body.model.trim()
        // apiKey：空串 = 不变；仅显式提供时覆盖
        if (typeof body.apiKey === 'string' && body.apiKey.trim()) patch.apiKey = body.apiKey.trim()
        if (body.clearApiKey === true) patch.apiKey = ''
        if (typeof body.baseUrlOverride === 'string') patch.baseUrlOverride = body.baseUrlOverride.trim()
        if (body.temperature === null || body.temperature === undefined) {
          if ('temperature' in body) patch.temperature = null
        } else {
          const t = Number(body.temperature)
          if (!Number.isNaN(t)) patch.temperature = clamp(t, 0, 2)
        }
        if (body.thinking && typeof body.thinking === 'object') {
          const th: Partial<Record<string, boolean>> = {}
          for (const face of ['interviewer', 'planner', 'investigator', 'synthesizer'] as const) {
            if (typeof body.thinking[face] === 'boolean') th[face] = body.thinking[face]
          }
          patch.thinking = th as LlmSettings['thinking']
        }
        const saved = saveLlmSettings(patch)
        return json({ ok: true, settings: maskedSettings(saved) })
      }
      return errJson('method not allowed', 405)
    }

    if (path === '/api/agent/llm-config/test' && method === 'POST') {
      const result = await testLlmConnection()
      return json(result)
    }

    // --- 远端模型列表发现（Task 12）：填 Key 后自动拉取 /models ---
    if (path === '/api/agent/llm-config/models' && method === 'POST') {
      const body = await readBody(request)
      const result = await listRemoteModels({
        providerId: typeof body.providerId === 'string' ? body.providerId : undefined,
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        baseUrlOverride: typeof body.baseUrlOverride === 'string' ? body.baseUrlOverride : undefined,
      })
      return json(result)
    }

    // --- /api/agent/sessions 集合 ---
    if (path === '/api/agent/sessions') {
      if (method === 'GET') {
        return json({ sessions: listSessionSummaries() })
      }
      if (method === 'POST') {
        const body = await readBody(request)
        if (body.demo === true) {
          const lang = normLang(body.lang)
          const sid = seedDemoSession(lang)
          console.log(`[seed] demo session created: ${sid} (lang=${lang})`)
          return json({
            session: mapSessionFull(getSessionRow(sid)!),
            nodes: listNodes(sid),
            edges: listEdges(sid),
            questions: listQuestions(sid),
            narrative: getSessionRow(sid)!.narrative,
          })
        }
        const lang = normLang(body.lang)
        const row = createSession(body.title ? String(body.title).slice(0, 80) : undefined, lang)
        return json({
          session: mapSessionFull(row),
          nodes: [],
          edges: [],
          questions: [],
          narrative: '',
        })
      }
      return errJson('method not allowed', 405)
    }

    // --- /api/agent/sessions/:id/stream（SSE） ---
    const streamMatch = path.match(/^\/api\/agent\/sessions\/([^/]+)\/stream$/)
    if (streamMatch && method === 'GET') {
      const id = streamMatch[1]
      const row = getSessionRow(id)
      if (!row) return errJson('session not found', 404)
      return makeSseResponse(request, id, row.phase, row.status)
    }

    // --- /api/agent/sessions/:id/activity（Task 29 P1-③：活动日志分页，向更早翻页） ---
    const actMatch = path.match(/^\/api\/agent\/sessions\/([^/]+)\/activity$/)
    if (actMatch && method === 'GET') {
      const id = actMatch[1]
      if (!getSessionRow(id)) return errJson('session not found', 404)
      const beforeRaw = Number(url.searchParams.get('before'))
      const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : null
      const limitRaw = Number(url.searchParams.get('limit'))
      const limit = Number.isFinite(limitRaw) ? clamp(Math.round(limitRaw), 1, 500) : 100
      return json(listActivityPage(id, before, limit))
    }

    // --- /api/agent/sessions/:id 子操作 ---
    const subMatch = path.match(/^\/api\/agent\/sessions\/([^/]+)(?:\/(chat|research|control|notes|layout|star|directions|explorations|resynthesize|finalize))?$/)
    if (subMatch) {
      const id = subMatch[1]
      const action = subMatch[2]
      const row = getSessionRow(id)
      if (!row) return errJson('session not found', 404)

      if (!action) {
        if (method === 'GET') {
          const payload = sessionFullPayload(id)
          return payload ? json(payload) : errJson('session not found', 404)
        }
        if (method === 'PATCH') {
          const body = await readBody(request)
          const title = String(body.title || '').trim()
          if (!title) return errJson('缺少 title', 400)
          updateSessionFields(id, { title: title.slice(0, 80) })
          return json({ ok: true })
        }
        if (method === 'DELETE') {
          // P2 修复：stop + 从 runtimes Map 移除（Map 只增不减会造成长驻进程内存缓慢增长；
          // 旧实例异步收尾时对已删会话的孤儿写入无外键约束、无订阅者，无副作用）
          AgentRuntime.dispose(id)
          deleteSession(id)
          console.log(`[session] deleted: ${id}`)
          return json({ ok: true })
        }
        return errJson('method not allowed', 405)
      }

      if (action === 'chat' && method === 'POST') return handleChat(id, request)
      if (action === 'research' && method === 'POST') return handleResearch(id, request)

      // 深研方向：异步生成（结果经 SSE directions 事件推送）
      if (action === 'directions') {
        if (method === 'POST') {
          const body = await readBody(request)
          if (body.lang) setSessionLang(id, normLang(body.lang))
          const r = await generateDirections(id)
          if (!r.ok) {
            const status = r.error === 'directions_busy' ? 409 : r.error === 'session not found' ? 404 : 400
            return errJson(r.error ?? 'failed', status)
          }
          return json({ ok: true, running: directionsRunning(id) })
        }
        if (method === 'GET') {
          return json({ directions: getDirections(id), running: directionsRunning(id) })
        }
        return errJson('method not allowed', 405)
      }

      // 课题探索闭环：异步执行（结果经 SSE explore 事件推送；反馈还会广播 state 快照重整证据墙）
      if (action === 'explorations') {
        if (method === 'GET') {
          return json({ explorations: listExplorations(id), running: exploreJobOf(id) })
        }
        if (method === 'POST') {
          const body = await readBody(request)
          if (body.lang) setSessionLang(id, normLang(body.lang))
          const nodeId = String(body.nodeId || '')
          if (!nodeId) return errJson('缺少 nodeId', 400)
          const act = String(body.action || 'plan')
          let r: { ok: boolean; error?: string }
          if (act === 'plan') r = await generateExplorePlan(id, nodeId)
          else if (act === 'feedback') r = await submitExploreFeedback(id, nodeId, String(body.text || ''))
          else if (act === 'regenerate') r = await regenerateExplorePlan(id, nodeId)
          else return errJson('未知 action（合法值: plan/feedback/regenerate）', 400)
          if (!r.ok) {
            const status = r.error === 'explore_busy' ? 409 : r.error === 'session not found' ? 404 : 400
            return errJson(r.error ?? 'failed', status)
          }
          return json({ ok: true, running: exploreJobOf(id) })
        }
        return errJson('method not allowed', 405)
      }

      // 重综合（Task 20）：证据墙变化后不重跑研究，仅重新生成综述；异步执行，结果经 SSE state/message 推送
      if (action === 'resynthesize' && method === 'POST') {
        const body = await readBody(request)
        if (body.lang) setSessionLang(id, normLang(body.lang))
        const existing = AgentRuntime.find(id)
        if (existing?.running) return errJson('agent_busy', 409)
        if (listNodes(id).length === 0) return errJson('no_evidence', 400)
        void AgentRuntime.get(id).resynthesize()
        return json({ ok: true })
      }

      // 补收官（Task 23 延迟收官）：最终综合曾因配额/服务受限丢失 → 手动重试；
      // 不要求 pending_final 已设置（也允许用户主动重生成最终综述），异步执行，结果经 SSE 推送
      if (action === 'finalize' && method === 'POST') {
        const body = await readBody(request)
        if (body.lang) setSessionLang(id, normLang(body.lang))
        const existing = AgentRuntime.find(id)
        if (existing?.running) return errJson('agent_busy', 409)
        if (listNodes(id).length === 0) return errJson('no_evidence', 400)
        insertActivity(id, { type: 'notice', summary: noticeFor(getSessionLang(id), 'finalizeManualStart') })
        void AgentRuntime.get(id).finalizeNow().catch((e) => console.error('[manual-finalize]', id, e))
        return json({ ok: true })
      }

      if (action === 'control' && method === 'POST') {
        const body = await readBody(request)
        return handleControl(id, body)
      }

      if (action === 'notes' && method === 'POST') {
        const body = await readBody(request)
        const kind = String(body.kind || 'evidence')
        if (!NODE_KINDS.includes(kind as any)) return errJson(`非法 kind（合法值: ${NODE_KINDS.join('/')})`, 400)
        const title = String(body.title || '').trim()
        if (!title) return errJson('缺少 title', 400)
        const content = String(body.content || '').trim()
        const node = insertNode(id, {
          kind: kind as any,
          title,
          content,
          sourceUrl: body.sourceUrl ? String(body.sourceUrl) : null,
          tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
          pinnedBy: 'user',
        })
        // 同步写入 steer 消息供 Agent 后续读取
        const msg = insertMessage(id, {
          role: 'user',
          kind: 'steer',
          content: `${noticeFor(getSessionLang(id), 'userNotePrefix')}${title}: ${content}`,
        })
        broadcast(id, 'message', msg)
        broadcast(id, 'state', stateSnapshot(id))
        console.log(`[notes] user note added: ${node.id} (${kind})`)
        return json({ node })
      }

      if (action === 'layout' && method === 'POST') {
        const body = await readBody(request)
        const positions = Array.isArray(body.positions) ? body.positions : []
        setNodePositions(
          id,
          positions
            .filter((p: any) => p && p.id && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
            .map((p: any) => ({ id: String(p.id), x: Number(p.x), y: Number(p.y) }))
        )
        return json({ ok: true })
      }

      if (action === 'star' && method === 'POST') {
        const body = await readBody(request)
        const nodeId = String(body.nodeId || '')
        if (!nodeId) return errJson('缺少 nodeId', 400)
        updateNode(id, nodeId, { starred: !!body.starred })
        broadcast(id, 'state', stateSnapshot(id))
        return json({ ok: true })
      }

      return errJson('method not allowed', 405)
    }

    return errJson('not found', 404)
  },
})

console.log(`[agent-service] listening on port ${PORT} (v${VERSION})`)
console.log(`[agent-service] db at ${process.cwd()}/data/serendip.db`)

// 每分钟打印运行中会话与 SSE 连接概况（写入 dev.log 便于观察）；顺带清理已无会话的死 runtime
// 注：bun --hot 局部热重载可能让 index.ts 拿到旧模块图的 AgentRuntime（缺新方法）→ 防御性包裹
setInterval(() => {
  try {
    AgentRuntime.reapDead()
  } catch {
    /* 热重载后旧模块图无此方法，下次完整重启即恢复 */
  }
  // Task 23 延迟收官：扫描待补收官会话，到退避时间即自动重试（同样防热重载旧模块图）
  try {
    const fired = sweepPendingFinals()
    if (fired instanceof Promise) void fired.catch(() => {})
  } catch {
    /* 同上 */
  }
  const sessions = listSessionSummaries().filter((s) => s.status === 'running' || s.status === 'thinking' || s.status === 'awaiting_user')
  if (sessions.length) {
    console.log(`[heartbeat] active: ${sessions.map((s) => `${s.id.slice(0, 8)}(${s.phase}/${s.status})`).join(', ')}`)
  }
}, 60_000)
