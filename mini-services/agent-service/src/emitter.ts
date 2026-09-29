// emitter.ts — SSE 客户端注册 / 广播（每 session 可多客户端）
import type { ChatMessage } from './db'

export type SseEvent =
  | { event: 'hello'; data: { sessionId: string; phase: string; status: string; ts: number } }
  | { event: 'message'; data: ChatMessage }
  | { event: 'phase'; data: { phase: string; status: string } }
  | { event: 'thought'; data: { step: number; text: string } }
  | { event: 'tool_call'; data: { callId: string; tool: string; args: Record<string, unknown>; step: number } }
  | { event: 'tool_result'; data: { callId: string; tool: string; ok: boolean; summary: string; durationMs: number; step: number } }
  | { event: 'state'; data: Record<string, unknown> }
  | { event: 'plan'; data: { plan: unknown } }
  | { event: 'directions'; data: unknown }
  | { event: 'explore'; data: { nodeId: string; exploration: unknown } }
  | { event: 'done'; data: { reason: string; summary: string } }
  | { event: 'error'; data: { message: string } }

type Client = {
  id: number
  sessionId: string
  send: (event: string, data: unknown) => void
  close: () => void
}

let nextClientId = 1
const clients = new Map<number, Client>()

export function registerClient(sessionId: string, send: (event: string, data: unknown) => void, close: () => void): Client {
  const c: Client = { id: nextClientId++, sessionId, send, close }
  clients.set(c.id, c)
  return c
}

export function unregisterClient(c: Client) {
  clients.delete(c.id)
}

export function clientCount(sessionId: string): number {
  let n = 0
  for (const c of clients.values()) if (c.sessionId === sessionId) n++
  return n
}

export function broadcast(sessionId: string, event: string, data: unknown) {
  for (const c of clients.values()) {
    if (c.sessionId !== sessionId) continue
    try {
      c.send(event, data)
    } catch {
      // 发送失败（连接已断）→ 注销
      clients.delete(c.id)
    }
  }
}

export function makeSseResponse(request: Request, sessionId: string, phase: string, status: string): Response {
  const enc = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let client: Client | null = null

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      client = registerClient(sessionId, send, () => {
        try { controller.close() } catch { /* already closed */ }
      })
      // 立即 hello
      send('hello', { sessionId, phase, status, ts: Date.now() })
      // 每 15s 心跳
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(enc.encode(': ping\n\n'))
        } catch {
          if (heartbeat) clearInterval(heartbeat)
        }
      }, 15000)
      // 客户端断开 → 注销
      request.signal.addEventListener('abort', () => {
        if (heartbeat) clearInterval(heartbeat)
        if (client) unregisterClient(client)
        try { controller.close() } catch { /* already closed */ }
      })
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
      if (client) unregisterClient(client)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
