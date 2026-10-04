// agent-api.ts — agent-service HTTP 客户端（全部走 Caddy 网关，相对路径 + XTransformPort）
import type {
  BoardNode,
  Exploration,
  LlmConfigResponse,
  LlmModelsResult,
  LlmSettingsView,
  LlmTestResult,
  ResearchQuestion,
  SessionFull,
  SessionState,
  SessionSummary,
} from '@/lib/types';

const AGENT_PORT = 3002;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/agent${path}?XTransformPort=${AGENT_PORT}`, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === 'string') message = body.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export type CreateSessionResult = {
  session: SessionFull;
  nodes: BoardNode[];
  edges: unknown[];
  questions: ResearchQuestion[];
  narrative: string;
};

export const agentApi = {
  listSessions: () => api<{ sessions: SessionSummary[] }>('/sessions'),

  createSession: (opts?: { title?: string; demo?: boolean; lang?: 'zh' | 'en' }) =>
    api<CreateSessionResult>('/sessions', { method: 'POST', json: opts ?? {} }),

  getSession: (id: string) => api<SessionState>(`/sessions/${id}`),

  patchSession: (id: string, title: string) =>
    api<{ ok: boolean }>(`/sessions/${id}`, { method: 'PATCH', json: { title } }),

  deleteSession: (id: string) => api<{ ok: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),

  chat: (id: string, text: string, lang?: 'zh' | 'en') =>
    api<{ ok: boolean; mode: 'interview' | 'steer' | 'queued' }>(`/sessions/${id}/chat`, {
      method: 'POST',
      json: { text, lang },
    }),

  research: (id: string, opts: { focus?: string; maxSteps?: number; maxMinutes?: number; lang?: 'zh' | 'en' }) =>
    api<{ ok: boolean }>(`/sessions/${id}/research`, { method: 'POST', json: opts }),

  control: (id: string, action: 'pause' | 'resume' | 'stop') =>
    api<{ ok: boolean; mode?: string }>(`/sessions/${id}/control`, {
      method: 'POST',
      json: { action },
    }),

  addNote: (
    id: string,
    note: { kind: string; title: string; content: string; sourceUrl?: string; tags?: string[] }
  ) =>
    api<{ node: BoardNode }>(`/sessions/${id}/notes`, {
      method: 'POST',
      json: note,
    }),

  saveLayout: (id: string, positions: { id: string; x: number; y: number }[]) =>
    api<{ ok: boolean }>(`/sessions/${id}/layout`, { method: 'POST', json: { positions } }),

  star: (id: string, nodeId: string, starred: boolean) =>
    api<{ ok: boolean }>(`/sessions/${id}/star`, {
      method: 'POST',
      json: { nodeId, starred },
    }),

  // ---------- LLM 配置 ----------

  getLlmConfig: () => api<LlmConfigResponse>('/llm-config'),

  saveLlmConfig: (patch: {
    providerId?: string;
    model?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    baseUrlOverride?: string;
    temperature?: number | null;
    thinking?: Partial<Record<string, boolean>>;
  }) => api<{ ok: boolean; settings: LlmSettingsView }>('/llm-config', { method: 'PUT', json: patch }),

  testLlmConfig: () => api<LlmTestResult>('/llm-config/test', { method: 'POST' }),

  /** 远端模型列表发现：填 Key 后自动拉取 GET {base}/models */
  fetchLlmModels: (opts: { providerId?: string; apiKey?: string; baseUrlOverride?: string }) =>
    api<LlmModelsResult>('/llm-config/models', { method: 'POST', json: opts }),

  // ---------- 深研方向（Task 12） ----------

  generateDirections: (id: string, lang?: 'zh' | 'en') =>
    api<{ ok: boolean; running: boolean }>(`/sessions/${id}/directions`, { method: 'POST', json: { lang } }),

  getDirections: (id: string) =>
    api<{ directions: unknown; running: boolean }>(`/sessions/${id}/directions`),

  // ---------- 课题探索闭环（Task 16：方案生成 → 反馈推导循环） ----------

  generateExplorePlan: (id: string, nodeId: string, lang?: 'zh' | 'en') =>
    api<{ ok: boolean; running: string | null }>(`/sessions/${id}/explorations`, {
      method: 'POST',
      json: { nodeId, action: 'plan', lang },
    }),

  submitExploreFeedback: (id: string, nodeId: string, text: string, lang?: 'zh' | 'en') =>
    api<{ ok: boolean; running: string | null }>(`/sessions/${id}/explorations`, {
      method: 'POST',
      json: { nodeId, action: 'feedback', text, lang },
    }),

  regenerateExplorePlan: (id: string, nodeId: string, lang?: 'zh' | 'en') =>
    api<{ ok: boolean; running: string | null }>(`/sessions/${id}/explorations`, {
      method: 'POST',
      json: { nodeId, action: 'regenerate', lang },
    }),

  // ---------- 综述重梳理（Task 20）：按当前证据墙重新生成研究综述 ----------

  /** 409 agent_busy / 400 no_evidence 由调用方 catch 处理；结果经 SSE phase/state 事件带回 */
  resynthesize: (id: string, lang?: 'zh' | 'en') =>
    api<{ ok: boolean }>(`/sessions/${id}/resynthesize`, { method: 'POST', json: { lang } }),
};

export function sseUrl(sessionId: string): string {
  return `/api/agent/sessions/${sessionId}/stream?XTransformPort=${AGENT_PORT}`;
}
