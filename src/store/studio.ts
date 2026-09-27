// studio.ts — 工作台全局状态（zustand）
// 数据真源：agent-service 的全量 state 快照 + SSE 粒度事件
import { create } from 'zustand';
import { agentApi } from '@/lib/agent-api';
import type {
  ActivityEvent,
  AgentStatus,
  BoardEdge,
  BoardNode,
  ChatMessage,
  Plan,
  ResearchQuestion,
  SessionFull,
  SessionPhase,
  SessionState,
  SessionSummary,
  Stats,
} from '@/lib/types';

// ---------- SSE 事件（与后端 emitter.ts 一一对应） ----------
export type AgentEvent =
  | { type: 'hello'; sessionId: string; phase: SessionPhase; status: AgentStatus; ts: number }
  | { type: 'message'; id: string; role: 'user' | 'assistant' | 'system'; kind: string; content: string; data: Record<string, unknown> | null; createdAt: number }
  | { type: 'phase'; phase: SessionPhase; status: AgentStatus }
  | { type: 'thought'; step: number; text: string }
  | { type: 'tool_call'; callId: string; tool: string; args: Record<string, unknown>; step: number }
  | { type: 'tool_result'; callId: string; tool: string; ok: boolean; summary: string; durationMs: number; step: number }
  | { type: 'state'; nodes: BoardNode[]; edges: BoardEdge[]; narrative: string; questions: ResearchQuestion[]; plan: Plan | null; stats: Stats; phase: SessionPhase; status: AgentStatus }
  | { type: 'plan'; plan: Plan }
  | { type: 'done'; reason: string; summary: string }
  | { type: 'error'; message: string };

export type ToolRunning = {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  step: number;
  ts: number;
};

const ACTIVITY_CAP = 300;
const LIVE_TTL_MS = 5000;

type StudioState = {
  // ---- 数据 ----
  sessions: SessionSummary[];
  session: SessionFull | null;
  messages: ChatMessage[];
  nodes: BoardNode[];
  edges: BoardEdge[];
  narrative: string;
  questions: ResearchQuestion[];
  plan: Plan | null;
  stats: Stats | null;
  activity: ActivityEvent[];

  // ---- 瞬态 ----
  connected: boolean;
  bootstrapping: boolean;
  loadingSession: boolean;
  interviewBusy: boolean;
  toolRunning: ToolRunning | null;
  lastThought: { step: number; text: string } | null;
  liveIds: string[];
  inspectorNodeId: string | null;
  researchDialogOpen: boolean;
  addClueOpen: boolean;
  mobileView: 'chat' | 'workspace';
  workspaceTab: 'canvas' | 'narrative' | 'questions' | 'activity';

  // ---- 动作 ----
  init: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  createSession: (opts?: { demo?: boolean }) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  sendChat: (text: string) => Promise<void>;
  startResearch: (opts: { focus?: string; maxSteps: number; maxMinutes: number }) => Promise<void>;
  control: (action: 'pause' | 'resume' | 'stop') => Promise<void>;
  addNote: (note: { kind: string; title: string; content: string; sourceUrl?: string; tags?: string[] }) => Promise<void>;
  saveLayout: (positions: { id: string; x: number; y: number }[]) => void;
  toggleStar: (nodeId: string, starred: boolean) => Promise<void>;
  applyEvent: (ev: AgentEvent) => void;
  setConnected: (v: boolean) => void;
  openInspector: (nodeId: string | null) => void;
  setResearchDialog: (v: boolean) => void;
  setAddClue: (v: boolean) => void;
  setMobileView: (v: 'chat' | 'workspace') => void;
  setWorkspaceTab: (v: 'canvas' | 'narrative' | 'questions' | 'activity') => void;
};

let liveTimer: ReturnType<typeof setTimeout> | null = null;

function ingestState(
  s: Pick<StudioState, 'nodes' | 'edges' | 'narrative' | 'questions' | 'plan' | 'stats' | 'session'>,
  st: { nodes?: BoardNode[]; edges?: BoardEdge[]; narrative?: string; questions?: ResearchQuestion[]; plan?: Plan | null; stats?: Stats; phase?: SessionPhase; status?: AgentStatus }
): Record<string, unknown> {
  const prevIds = new Set(s.nodes.map((n) => n.id));
  const newNodes = st.nodes ?? s.nodes;
  const fresh = newNodes.filter((n) => !prevIds.has(n.id)).map((n) => n.id);
  const patch: Record<string, unknown> = {
    nodes: newNodes,
    edges: st.edges ?? s.edges,
    narrative: st.narrative ?? s.narrative,
    questions: st.questions ?? s.questions,
    plan: st.plan !== undefined ? st.plan : s.plan,
    stats: st.stats ?? s.stats,
  };
  if (st.phase && s.session) {
    patch.session = { ...s.session, phase: st.phase, status: st.status ?? s.session.status };
  }
  if (fresh.length) {
    patch.liveIds = fresh;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      useStudio.setState({ liveIds: [] });
    }, LIVE_TTL_MS);
  }
  return patch;
}

function pushActivity(s: Pick<StudioState, 'activity'>, ev: ActivityEvent): ActivityEvent[] {
  const next = [...s.activity, ev];
  return next.length > ACTIVITY_CAP ? next.slice(next.length - ACTIVITY_CAP) : next;
}

function evtId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export const useStudio = create<StudioState>((set, get) => ({
  sessions: [],
  session: null,
  messages: [],
  nodes: [],
  edges: [],
  narrative: '',
  questions: [],
  plan: null,
  stats: null,
  activity: [],

  connected: false,
  bootstrapping: false,
  loadingSession: false,
  interviewBusy: false,
  toolRunning: null,
  lastThought: null,
  liveIds: [],
  inspectorNodeId: null,
  researchDialogOpen: false,
  addClueOpen: false,
  mobileView: 'chat',
  workspaceTab: 'canvas',

  init: async () => {
    if (get().bootstrapping) return;
    set({ bootstrapping: true });
    try {
      const { sessions } = await agentApi.listSessions();
      if (sessions.length > 0) {
        set({ sessions });
        await get().loadSession(sessions[0].id);
      } else {
        await get().createSession();
      }
    } finally {
      set({ bootstrapping: false });
    }
  },

  refreshSessions: async () => {
    const { sessions } = await agentApi.listSessions();
    set({ sessions });
  },

  loadSession: async (id) => {
    set({ loadingSession: true, inspectorNodeId: null, toolRunning: null, lastThought: null });
    try {
      const st: SessionState = await agentApi.getSession(id);
      set({
        session: st.session,
        messages: st.messages,
        nodes: st.nodes,
        edges: st.edges,
        narrative: st.narrative,
        questions: st.questions,
        plan: st.plan,
        stats: st.stats,
        activity: st.activity,
        interviewBusy: false,
        liveIds: [],
      });
    } finally {
      set({ loadingSession: false });
    }
  },

  createSession: async (opts) => {
    const r = await agentApi.createSession(opts);
    await get().refreshSessions();
    await get().loadSession(r.session.id);
  },

  deleteSession: async (id) => {
    await agentApi.deleteSession(id);
    const rest = get().sessions.filter((s) => s.id !== id);
    set({ sessions: rest });
    if (get().session?.id === id) {
      if (rest.length > 0) await get().loadSession(rest[0].id);
      else await get().createSession();
    }
  },

  sendChat: async (text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const s = get();
    if (!s.session || s.interviewBusy) return; // 前端防抖，后端仍有 409 兜底

    const phase = s.session.phase;
    const investigating = phase === 'planning' || phase === 'investigating' || phase === 'synthesizing';
    const awaiting = phase === 'awaiting_user';

    // 乐观消息（interview/awaiting 场景；steer 场景走 notice 反馈，无需乐观）
    const optimistic: ChatMessage | null = investigating
      ? null
      : {
          id: `tmp-${Date.now()}`,
          role: 'user',
          kind: 'chat',
          content: trimmed,
          data: null,
          createdAt: Date.now(),
        };
    if (optimistic) set({ messages: [...s.messages, optimistic] });
    if (!investigating) set({ interviewBusy: true });

    const sessionId = s.session.id;
    try {
      await agentApi.chat(sessionId, trimmed);
    } catch (e) {
      if (optimistic) set({ messages: get().messages.filter((m) => m.id !== optimistic.id) });
      set({ interviewBusy: false });
      throw e;
    }

    // 兜底：SSE 掉线时 46s 后仍未收到 assistant 回复 → 拉全量恢复
    setTimeout(() => {
      const cur = useStudio.getState();
      if (
        cur.session?.id === sessionId &&
        cur.interviewBusy &&
        !awaiting // awaiting 场景由 phase 事件解除
      ) {
        void cur.loadSession(sessionId).then(() => useStudio.setState({ interviewBusy: false }));
      }
    }, 46000);
  },

  startResearch: async (opts) => {
    const s = get();
    if (!s.session) return;
    await agentApi.research(s.session.id, opts);
    set({ researchDialogOpen: false, mobileView: 'workspace' });
  },

  control: async (action) => {
    const s = get();
    if (!s.session) return;
    await agentApi.control(s.session.id, action);
    // phase/status 变化经 SSE phase 事件到达；1.2s 后兜底刷新
    setTimeout(() => {
      const cur = useStudio.getState();
      if (cur.session?.id === s.session.id) void cur.loadSession(cur.session.id);
    }, 1200);
  },

  addNote: async (note) => {
    const s = get();
    if (!s.session) return;
    await agentApi.addNote(s.session.id, note);
    set({ addClueOpen: false });
  },

  saveLayout: (positions) => {
    const s = get();
    if (!s.session || positions.length === 0) return;
    // 乐观更新本地位置，异步落库
    const byId = new Map(positions.map((p) => [p.id, p]));
    set({
      nodes: s.nodes.map((n) => {
        const p = byId.get(n.id);
        return p ? { ...n, position: { x: p.x, y: p.y } } : n;
      }),
    });
    void agentApi.saveLayout(s.session.id, positions).catch(() => undefined);
  },

  toggleStar: async (nodeId, starred) => {
    const s = get();
    if (!s.session) return;
    set({ nodes: s.nodes.map((n) => (n.id === nodeId ? { ...n, starred } : n)) });
    try {
      await agentApi.star(s.session.id, nodeId, starred);
    } catch {
      set({ nodes: get().nodes.map((n) => (n.id === nodeId ? { ...n, starred: !starred } : n)) });
    }
  },

  applyEvent: (ev) => {
    const s = get();
    switch (ev.type) {
      case 'hello': {
        set({ connected: true });
        break;
      }
      case 'message': {
        const msg: ChatMessage = {
          id: ev.id,
          role: ev.role,
          kind: ev.kind as ChatMessage['kind'],
          content: ev.content,
          data: ev.data ?? null,
          createdAt: ev.createdAt,
        };
        const exists = s.messages.some((m) => m.id === msg.id);
        if (exists) break;
        const optimisticIdx = msg.role === 'user'
          ? s.messages.findIndex((m) => m.id.startsWith('tmp-') && m.content === msg.content)
          : -1;
        const messages = optimisticIdx >= 0
          ? s.messages.map((m, i) => (i === optimisticIdx ? msg : m))
          : [...s.messages, msg];
        if (
          msg.role === 'assistant' &&
          (msg.kind === 'chat' || msg.kind === 'question' || msg.kind === 'synthesis')
        ) {
          set({ messages, interviewBusy: false });
        } else {
          set({ messages });
        }
        if (msg.kind === 'chat' && msg.data && (msg.data as Record<string, unknown>).ready) {
          void get().refreshSessions();
        }
        break;
      }
      case 'phase': {
        if (s.session) {
          set({ session: { ...s.session, phase: ev.phase, status: ev.status } });
        }
        set({
          activity: pushActivity(s, {
            id: evtId('phase'),
            ts: Date.now(),
            type: 'phase',
            summary: `阶段切换 → ${ev.phase} / ${ev.status}`,
          }),
        });
        if (ev.status === 'done' || ev.status === 'idle' || ev.status === 'error') {
          set({ toolRunning: null, interviewBusy: false });
        }
        break;
      }
      case 'thought': {
        set({
          lastThought: { step: ev.step, text: ev.text },
          activity: pushActivity(s, {
            id: evtId(`thought-${ev.step}`),
            ts: Date.now(),
            type: 'thought',
            step: ev.step,
            summary: ev.text.replace(/\s+/g, ' ').slice(0, 200),
          }),
        });
        break;
      }
      case 'tool_call': {
        set({
          toolRunning: { callId: ev.callId, tool: ev.tool, args: ev.args, step: ev.step, ts: Date.now() },
          activity: pushActivity(s, {
            id: `tc-${ev.callId}`,
            ts: Date.now(),
            type: 'tool_call',
            tool: ev.tool,
            step: ev.step,
            summary: `调用 ${ev.tool}`,
          }),
        });
        break;
      }
      case 'tool_result': {
        set({
          toolRunning: s.toolRunning?.callId === ev.callId ? null : s.toolRunning,
          activity: pushActivity(s, {
            id: `tr-${ev.callId}`,
            ts: Date.now(),
            type: 'tool_result',
            tool: ev.tool,
            ok: ev.ok,
            durationMs: ev.durationMs,
            step: ev.step,
            summary: ev.summary,
          }),
        });
        break;
      }
      case 'state': {
        set(ingestState(s, ev));
        break;
      }
      case 'plan': {
        set({ plan: ev.plan });
        break;
      }
      case 'done': {
        set({ toolRunning: null, interviewBusy: false });
        void get().refreshSessions();
        break;
      }
      case 'error': {
        set({ toolRunning: null, interviewBusy: false });
        break;
      }
    }
  },

  setConnected: (v) => set({ connected: v }),

  openInspector: (nodeId) => set({ inspectorNodeId: nodeId }),
  setResearchDialog: (v) => set({ researchDialogOpen: v }),
  setAddClue: (v) => set({ addClueOpen: v }),
  setMobileView: (v) => set({ mobileView: v }),
  setWorkspaceTab: (v) => set({ workspaceTab: v }),
}));

// ---------- 派生工具 ----------
export function selectInspectorNode(s: Pick<StudioState, 'inspectorNodeId' | 'nodes'>): BoardNode | null {
  if (!s.inspectorNodeId) return null;
  return s.nodes.find((n) => n.id === s.inspectorNodeId) ?? null;
}

export function isAgentWorking(status: AgentStatus | undefined): boolean {
  return status === 'running' || status === 'thinking';
}

export function fmtElapsed(ms: number): string {
  if (!ms || ms < 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
