// Serendip Lab · 共享领域类型（与 docs/ARCHITECTURE.md §2 保持一致，前后端唯一真源）

export type SessionPhase =
  | 'interview'
  | 'planning'
  | 'investigating'
  | 'synthesizing'
  | 'awaiting_user'
  | 'done';

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'running'
  | 'paused'
  | 'awaiting_user'
  | 'done'
  | 'error'
  | 'interrupted';

export type NodeKind =
  | 'question'
  | 'hypothesis'
  | 'evidence'
  | 'insight'
  | 'source'
  | 'gap';

export type EdgeRelation =
  | 'supports'
  | 'contradicts'
  | 'relates'
  | 'derives'
  | 'answers';

export type BoardNode = {
  id: string;
  kind: NodeKind;
  title: string;
  content: string;
  /** 详细说明：点击卡片后展示的深度解读（agent 生成，≤1200 字） */
  detail: string | null;
  tags: string[];
  sourceUrl: string | null;
  sourceRef: string | null;
  confidence: number | null;
  starred: boolean;
  pinnedBy: 'agent' | 'user';
  status: 'new' | 'strong' | 'weak' | 'contradicted';
  createdAt: number;
  position: { x: number; y: number } | null;
};

export type BoardEdge = {
  id: string;
  source: string;
  target: string;
  relation: EdgeRelation;
  label: string | null;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  kind: 'chat' | 'question' | 'steer' | 'steer_ack' | 'notice' | 'synthesis';
  content: string;
  data: Record<string, unknown> | null;
  createdAt: number;
};

export type ResearchQuestion = {
  id: string;
  text: string;
  rationale: string;
  scores: { novelty: number; feasibility: number; impact: number };
  recommended: boolean;
  evidenceRefs: string[];
};

export type PlanTask = {
  id: string;
  goal: string;
  why: string;
  queries: string[];
  toolsHint: string[];
  expectedEvidence: string;
  done: boolean;
  summary?: string;
};

export type Plan = {
  round: number;
  focusQuestion: string;
  tasks: PlanTask[];
  hypotheses: { title: string; basis: string }[];
};

export type Stats = {
  stepsUsed: number;
  maxSteps: number;
  toolCalls: number;
  llmCalls: number;
  evidenceCount: number;
  sourceCount: number;
  elapsedMs: number;
  round: number;
};

export type ActivityEvent = {
  id: string;
  ts: number;
  type: 'thought' | 'tool_call' | 'tool_result' | 'phase' | 'notice';
  tool?: string;
  summary: string;
  ok?: boolean;
  durationMs?: number;
  step?: number;
};

export type SessionSummary = {
  id: string;
  title: string;
  phase: SessionPhase;
  status: AgentStatus;
  createdAt: number;
  updatedAt: number;
  counts: { messages: number; nodes: number; edges: number; questions: number };
  hasNarrative: boolean;
};

export type SessionFull = {
  id: string;
  title: string;
  phase: SessionPhase;
  status: AgentStatus;
  createdAt: number;
  updatedAt: number;
  ready: boolean;
  budget: { maxSteps: number; maxMinutes: number };
};

export type SessionState = {
  session: SessionFull;
  messages: ChatMessage[];
  nodes: BoardNode[];
  edges: BoardEdge[];
  narrative: string;
  questions: ResearchQuestion[];
  plan: Plan | null;
  stats: Stats;
  activity: ActivityEvent[];
};

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  question: '核心问题',
  hypothesis: '假说',
  evidence: '证据',
  insight: '洞见',
  source: '文献源',
  gap: '待查',
};

export const EDGE_RELATION_LABEL: Record<EdgeRelation, string> = {
  supports: '支持',
  contradicts: '矛盾',
  relates: '相关',
  derives: '推出',
  answers: '回答',
};

export const PHASE_LABEL: Record<SessionPhase, string> = {
  interview: '苏格拉底访谈',
  planning: '部署调查',
  investigating: '调查中',
  synthesizing: '结案推演',
  awaiting_user: '等你回应',
  done: '已结案',
};

/* ---------------- LLM 配置（agent-service /llm-config） ---------------- */

export type AgentFace = 'interviewer' | 'planner' | 'investigator' | 'synthesizer';

export const AGENT_FACE_LABEL: Record<AgentFace, string> = {
  interviewer: '访谈者',
  planner: '规划师',
  investigator: '调查员',
  synthesizer: '综合师',
};

export type ProviderModelInfo = { id: string; name: string; contextWindow?: number };

export type ProviderProfileInfo = {
  id: string;
  displayName: string;
  label: string;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel: string;
  models: ProviderModelInfo[];
  docsUrl: string;
  keyless?: boolean;
};

export type LlmSettingsView = {
  providerId: string;
  model: string;
  apiKey: string;
  apiKeyMasked: string;
  hasKey: boolean;
  baseUrlOverride: string;
  temperature: number | null;
  thinking: Record<AgentFace, boolean>;
};

export type LlmConfigResponse = {
  settings: LlmSettingsView;
  catalog: ProviderProfileInfo[];
};

export type LlmTestResult = {
  ok: boolean;
  latencyMs: number;
  model: string;
  provider: string;
  reply?: string;
  error?: string;
};
