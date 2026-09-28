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

/* ---------------- 深研方向（Task 12：从证据链提炼研究方向 + 研究计划） ---------------- */

export type DirectionPlanStep = {
  step: string;
  detail: string;
  duration?: string;
};

export type DirectionLiterature = {
  ref: string;
  note?: string;
};

export type ResearchDirection = {
  title: string;
  why: string;
  scores: { novelty: number; feasibility: number; impact: number };
  evidenceRefs: string[];
  plan: {
    objective: string;
    keyQuestions: string[];
    approach: DirectionPlanStep[];
    methods: string[];
    expectedOutcome: string;
    risks?: string;
  };
  literature: DirectionLiterature[];
};

export type ResearchDirections = {
  generatedAt: number;
  summary?: string;
  directions: ResearchDirection[];
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
  directions: ResearchDirections | null;
  stats: Stats;
  activity: ActivityEvent[];
};

/* 标签表（NODE_KIND_LABEL / EDGE_RELATION_LABEL / PHASE_LABEL / AGENT_FACE_LABEL / TOOL_LABEL）
   已迁至 @/lib/i18n（Task 13 双语支持），按 useI18n().lang 取词。 */

/* ---------------- LLM 配置（agent-service /llm-config） ---------------- */

export type AgentFace = 'interviewer' | 'planner' | 'investigator' | 'synthesizer';

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
  /** 不支持 GET /models 远端发现（如内置网关） */
  supportsModelList?: boolean;
  /** UI 提示（如国内/海外双域名） */
  note?: string;
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

/** 远端模型列表发现结果（POST /llm-config/models） */
export type LlmModelsResult = {
  ok: boolean;
  provider: string;
  models: ProviderModelInfo[];
  /** true = 从远端 /models 拉取；false = 内置网关静态目录 */
  discovered: boolean;
  count: number;
  error?: string;
};
