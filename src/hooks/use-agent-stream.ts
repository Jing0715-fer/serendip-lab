'use client';

// use-agent-stream.ts — SSE 订阅钩子：会话切换自动重连，断线恢复后拉全量补齐
// P2 修复：浏览器对非重试型错误（如 404/网关不可达）会置 CLOSED 并停止自动重连 →
// 指数退避手动重建连接（上限 30s），避免「已断开」状态永久卡死。
import { useEffect, useRef } from 'react';
import { sseUrl } from '@/lib/agent-api';
import { useStudio, type AgentEvent } from '@/store/studio';

const EVENT_NAMES = [
  'hello',
  'message',
  'phase',
  'thought',
  'tool_call',
  'tool_result',
  'state',
  'plan',
  'directions',
  'explore',
  'done',
  'error',
] as const;

export function useAgentStream(): void {
  const sessionId = useStudio((s) => s.session?.id ?? null);
  const applyEvent = useStudio((s) => s.applyEvent);
  const setConnected = useStudio((s) => s.setConnected);
  const loadSession = useStudio((s) => s.loadSession);
  const everConnected = useRef(false);

  useEffect(() => {
    if (!sessionId) return;

    let disposed = false;
    let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let current: EventSource | null = null;

    const connect = () => {
      if (disposed) return;
      const es = new EventSource(sseUrl(sessionId));
      current = es;

      for (const name of EVENT_NAMES) {
        const listener = (e: Event) => {
          // 原生 EventSource 'error' 事件（连接断开/重连）不是 MessageEvent、没有 data —— 跳过
          if (!(e instanceof MessageEvent) || typeof e.data !== 'string') return;
          try {
            const data = JSON.parse(e.data);
            applyEvent({ type: name, ...data } as AgentEvent);
          } catch (err) {
            console.warn('[sse] bad payload', name, err);
          }
        };
        es.addEventListener(name, listener as EventListener);
      }

      es.onopen = () => {
        attempts = 0;
        setConnected(true);
        if (everConnected.current) {
          // 断线重连：拉全量补齐错过的事件（失败静默——下一次 onopen 还会再试）
          void loadSession(sessionId).catch(() => undefined);
        }
        everConnected.current = true;
      };

      es.onerror = () => {
        setConnected(false);
        // CONNECTING = 浏览器还在自动重连，交给它；
        // CLOSED = 浏览器已放弃（非重试型错误）→ 手动退避重建
        if (es.readyState === EventSource.CLOSED && !disposed) {
          attempts++;
          const delay = Math.min(30_000, 2_000 * attempts);
          rebuildTimer = setTimeout(() => {
            es.close();
            connect();
          }, delay);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (rebuildTimer) clearTimeout(rebuildTimer);
      current?.close();
      setConnected(false);
      everConnected.current = false;
    };
  }, [sessionId, applyEvent, setConnected, loadSession]);
}
