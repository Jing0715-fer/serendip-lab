'use client';

// use-agent-stream.ts — SSE 订阅钩子：会话切换自动重连，断线恢复后拉全量补齐
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
    const es = new EventSource(sseUrl(sessionId));

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
      setConnected(true);
      if (everConnected.current) {
        // 断线重连：拉全量补齐错过的事件
        void loadSession(sessionId);
      }
      everConnected.current = true;
    };
    es.onerror = () => {
      setConnected(false);
      // EventSource 会自动重连
    };

    return () => {
      es.close();
      setConnected(false);
      everConnected.current = false;
    };
  }, [sessionId, applyEvent, setConnected, loadSession]);
}
