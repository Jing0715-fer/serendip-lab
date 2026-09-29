# Serendip Lab · 生物科研灵感侦探 — 架构契约 v1

> 本文档是前后端唯一真源（Single Source of Truth）。所有实现必须与本文档一致，修改契约需先改文档。

## 0. 产品概述

**Serendip Lab**（中文名：灵光侦探）是一个生物科研灵感发掘工具：

1. **苏格拉底式访谈**：AI 侦探通过启发式提问与追问，逐步发掘用户真正感兴趣的科学问题；
2. **自主调查**：Agent 长时间自主工作，调用 PubMed / Europe PMC / OpenAlex / UniProt / NCBI / PDB 等生物学数据库 API 与 Web 搜索工具收集证据；
3. **人机协同**：用户可随时补充只有自己知道的信息（steering），Agent 在检查点纳入；
4. **证据墙**：以影视剧侦探追查凶手的信息墙（软木板 + 图钉 + 红绳）方式，展示证据与问题之间的关系；
5. **结案陈词**：把碎片化信息梳理成有逻辑的叙事（案情综述），并评估**哪些问题值得被进一步研究**（新颖性/可行性/影响力打分）。

## 1. 系统拓扑与端口

```
┌─────────────────────────── 用户浏览器 ───────────────────────────┐
│  Next.js 16 前端 (唯一用户路由: /)                                │
│  fetch('/api/agent/...?XTransformPort=3002')  ← 全部相对路径      │
│  EventSource('/api/agent/sessions/:id/stream?XTransformPort=3002')│
└──────────────────────────────┬───────────────────────────────────┘
                               │ Caddy 网关 (XTransformPort 转发)
┌──────────────────────────────┴───────────────────────────────────┐
│  agent-service (Bun mini-service, 端口 3002)                      │
│  · Bun.serve HTTP 路由 + SSE 推流                                  │
│  · AgentRuntime（访谈/规划/调查/综合 状态机）                       │
│  · 工具层（9 个生物数据库工具 + 6 个图操作工具）                     │
│  · z-ai-web-dev-sdk（LLM + web_search + page_reader，仅后端）      │
│  · bun:sqlite 持久化（WAL 模式，data/serendip.db）                 │
└────────────────────────────────────────────────────────────────────┘
         外部 API: NCBI E-utilities / Europe PMC / OpenAlex /
         UniProt / RCSB PDB （均为免费无 Key API）
```

**硬性规则**：
- mini-service 必须是独立 Bun 项目（`mini-services/agent-service/`），入口 `index.ts`，`bun run dev` = `bun --hot index.ts`，端口固定 **3002**。
- 前端所有请求相对路径 + `?XTransformPort=3002`，**绝不**出现 `localhost:3002` 字样。
- z-ai-web-dev-sdk 只在 agent-service 内使用，绝不进前端。
- 主 Next.js 项目不使用 Prisma（全部数据由 agent-service 持有）。

## 2. 共享类型（前端 `src/lib/types.ts` 与后端保持一致）

```ts
export type SessionPhase =
  | 'interview'    // 苏格拉底访谈
  | 'planning'     // 规划中
  | 'investigating'// 调查中（ReAct 循环）
  | 'synthesizing' // 综合分析中
  | 'awaiting_user'// Agent 提问后等待用户回复
  | 'done';        // 本轮调查完成

export type AgentStatus =
  | 'idle' | 'thinking' | 'running' | 'paused'
  | 'awaiting_user' | 'done' | 'error' | 'interrupted';

export type NodeKind =
  | 'question'    // 核心问题（琥珀便签）
  | 'hypothesis'  // 假说（青瓷便签）
  | 'evidence'    // 证据（米白拍立得）
  | 'insight'     // 洞见（橙色便签）
  | 'source'      // 文献/数据源（报纸灰卡）
  | 'gap';        // 待查空白（虚线空卡）

export type EdgeRelation =
  | 'supports'      // 红实线
  | 'contradicts'   // 深灰虚线
  | 'relates'       // 浅灰细线
  | 'derives'       // 琥珀点线
  | 'answers';      // 绿实线

export type BoardNode = {
  id: string;
  kind: NodeKind;
  title: string;               // ≤40字，具体可读
  content: string;             // ≤300字，事实+出处
  tags: string[];
  sourceUrl: string | null;
  sourceRef: string | null;    // 如 "PMID: 26808694"、"UniProt: P12345"
  confidence: number | null;   // 0-1
  starred: boolean;
  pinnedBy: 'agent' | 'user';
  status: 'new' | 'strong' | 'weak' | 'contradicted';
  createdAt: number;
  position: { x: number; y: number } | null;  // null = 前端自动布局
};

export type BoardEdge = {
  id: string;
  source: string;             // node id
  target: string;
  relation: EdgeRelation;
  label: string | null;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  kind: 'chat' | 'question' | 'steer' | 'steer_ack' | 'notice' | 'synthesis';
  content: string;
  data: Record<string, unknown> | null;  // 如 { ready: true }
  createdAt: number;
};

export type ResearchQuestion = {
  id: string;
  text: string;
  rationale: string;
  scores: { novelty: number; feasibility: number; impact: number }; // 1-5
  recommended: boolean;
  evidenceRefs: string[];
};

export type PlanTask = {
  id: string;               // 't1','t2'...
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
  summary: string;       // 人可读一行摘要
  ok?: boolean;
  durationMs?: number;
  step?: number;
};

export type SessionSummary = {
  id: string; title: string; phase: SessionPhase; status: AgentStatus;
  createdAt: number; updatedAt: number;
  counts: { messages: number; nodes: number; edges: number; questions: number };
  hasNarrative: boolean;
};

export type SessionFull = {
  id: string; title: string; phase: SessionPhase; status: AgentStatus;
  createdAt: number; updatedAt: number;
  ready: boolean;          // 访谈是否已足够聚焦（前端显示"进入调查"CTA）
  budget: { maxSteps: number; maxMinutes: number };
};
```

## 3. HTTP API 契约（agent-service，全部前缀 `/api/agent`）

统一错误格式：`{ error: string }`，非 2xx。

| Method | Path | Body / Query | 返回 |
|---|---|---|---|
| GET | `/api/agent/health` | — | `{ok:true, version, uptimeSec}` |
| GET | `/api/agent/sessions` | — | `{sessions: SessionSummary[]}`（按 updatedAt 倒序） |
| POST | `/api/agent/sessions` | `{title?, demo?:boolean}` | `{session: SessionFull, nodes, edges, questions, narrative}`；demo=true 注入示例案件 |
| GET | `/api/agent/sessions/:id` | — | `{session, messages: ChatMessage[], nodes, edges, narrative: string, questions, plan: Plan\|null, stats, activity: ActivityEvent[]}`（activity 最近 120 条） |
| PATCH | `/api/agent/sessions/:id` | `{title}` | `{ok}` |
| DELETE | `/api/agent/sessions/:id` | — | `{ok}` |
| POST | `/api/agent/sessions/:id/chat` | `{text}` | `{ok, mode:'interview'\|'steer'\|'queued'}`；agent 忙时 409 `{error:'agent_busy'}` |
| POST | `/api/agent/sessions/:id/research` | `{focus?, maxSteps?=40, maxMinutes?=15}` | `{ok}`（已 running 时 409） |
| POST | `/api/agent/sessions/:id/control` | `{action:'pause'\|'resume'\|'stop'}` | `{ok}` |
| POST | `/api/agent/sessions/:id/notes` | `{kind, title, content, sourceUrl?, tags?}` | `{node}`（用户手动添加线索，同时写入 kind='steer' 的消息供 Agent 后续读取） |
| POST | `/api/agent/sessions/:id/layout` | `{positions:[{id,x,y}]}` | `{ok}` |
| POST | `/api/agent/sessions/:id/star` | `{nodeId, starred}` | `{ok}` |
| GET | `/api/agent/sessions/:id/stream` | — | **SSE**，见下节 |

**chat 语义**：
- phase 为 `interview` / `idle` / `done`：走访谈链路（存用户消息 → LLM(interviewer) → 存 assistant 消息 → SSE 推送）。done 阶段继续聊 = 轻量继续对话（interviewer prompt，ready 已 true）。
- phase 为调查类（planning/investigating/synthesizing）：消息存为 kind='steer'，推入 steering 队列，返回 `{ok, mode:'steer'}`；SSE 发一条 notice「已加入调查线索队列，Agent 将在检查点纳入」。
- phase 为 `awaiting_user`：用户回复即答案 → 注入 Agent 下一步上下文并恢复运行，返回 `{ok, mode:'queued'}`。

## 4. SSE 事件契约

`GET /api/agent/sessions/:id/stream`，`Content-Type: text/event-stream`。
每 15s 发注释心跳 `: ping`。事件名即类型，data 为 JSON。

| event | data | 说明 |
|---|---|---|
| `hello` | `{sessionId, phase, status, ts}` | 连接建立 |
| `message` | `ChatMessage` | 新聊天消息（含 assistant/user/notice/question/steer_ack） |
| `phase` | `{phase, status}` | 阶段/状态切换 |
| `thought` | `{step, text}` | Agent 当前推理（活动流展示） |
| `tool_call` | `{callId, tool, args, step}` | 工具调用开始 |
| `tool_result` | `{callId, tool, ok, summary, durationMs, step}` | 工具调用结束 |
| `state` | `{nodes, edges, narrative, questions, plan, stats, phase, status}` | **全量快照**（每个 Agent 步后发） |
| `plan` | `{plan}` | 新计划 |
| `done` | `{reason:'completed'\|'stopped'\|'budget'\|'error', summary}` | 一轮调查结束 |
| `error` | `{message}` | 错误 |

前端策略：`message`/`thought`/`tool_*` 做动画，`state`/`plan` 直接覆盖 store；EventSource 重连成功后调 `GET /sessions/:id` 补齐错过的事件。

## 5. SQLite Schema（bun:sqlite，WAL，`data/serendip.db`）

```sql
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '新调查',
  phase TEXT NOT NULL DEFAULT 'interview', status TEXT NOT NULL DEFAULT 'idle',
  meta TEXT NOT NULL DEFAULT '{}',      -- {ready, signals:{topic,organism,scale,mechanism_interest,method_context}, pendingQuestion}
  plan TEXT, narrative TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL DEFAULT '{}',   -- {maxSteps,maxMinutes,stepsUsed,toolCalls,llmCalls,startedAt,round,elapsedMs}
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
```

启动时：`PRAGMA journal_mode=WAL;`；把 status IN ('running','thinking','paused','awaiting_user') 的会话改标 `interrupted`（phase 保留），前端可一键「继续调查」。

## 6. Agent 层设计（借鉴开源 Agent 的优点）

| 借鉴对象 | 吸收的能力 |
|---|---|
| **ReAct** | thought → action → observation 交错推理，文本协议（不依赖原生 function calling） |
| **OpenHands (OpenDevin)** | 一切皆事件（Event Stream），SSE 直通前端；用户随时 steering |
| **LangGraph** | 显式阶段状态机 + 每步 checkpoint 持久化（SQLite） |
| **AutoGPT/AgentGPT** | 预算约束（步数 + 墙钟时间）下的长时自主循环 |
| **Reflexion** | 失败反思：JSON 解析失败/工具报错 → 错误信息回灌重试；连续 3 次失败熔断 |
| **CAMEL/Socratic** | 访谈者人格：一次一个问题、层层递进、挖掘矛盾 |

### 6.1 状态机

```
interview ──POST /research──▶ planning ──▶ investigating ◀──▶ synthesizing
                                   │              │                 │
                                   │              ▼                 ├─(continue)─▶ planning(下一轮)
                                   │        awaiting_user           └─(预算尽/完成)─▶ done
                                   │              │
                                   └──(预算尽)────┴──▶ synthesizing ──▶ done
任意调查阶段可 pause / resume / stop（stop → 最后一次综合 → done）
```

### 6.2 主循环（伪代码）

```ts
async start(focus?, maxSteps, maxMinutes) {
  emit phase(planning)
  plan = await callPlanner(focus)                       // 见 §8.2
  emit plan / state
  while (预算未耗尽 && !stop) {
    if (paused) await resumeSignal
    task = plan.tasks.find(t => !t.done)
    if (!task) {
      synth = await callSynthesizer()                   // 见 §8.4
      if (!synth.continue || 预算将尽) break
      plan = await callPlanner(synth.next_focus); continue
    }
    await investigate(task)                             // ReAct 内循环，见 6.3
    // steering 检查点：吃掉队列，emit steer_ack
    if (每完成2个任务 || 每10步) await callSynthesizer()
  }
  await callSynthesizer(final=true)
  status='done'; emit done
}

async investigate(task) {   // 内循环每任务最多 8 步
  scratchpad = []
  for (step=0; step<8 && 预算OK && !stop; step++) {
    out = await callInvestigator(task, scratchpad)      // 见 §8.3
    emit thought(out.thought)
    a = out.action
    if (a.tool === 'finish_task') { task.done=true; task.summary=a.args.summary; emit state; return }
    if (a.tool === 'ask_user') { emit question消息; await 等待用户回复(挂起,不耗预算); 注入回复; continue }
    emit tool_call; obs = await runTool(a)【25s超时/限速/容错】; emit tool_result
    scratchpad.push({thought, action:a, observation: trunc(obs,1600)})
    budget.stepsUsed++; checkpoint持久化; emit state
  }
  task.done = true  // 达到步数上限也算完成（summary 可为空）
}
```

### 6.3 容错与自愈

- **LLM JSON 解析失败**：剥离 ```json 围栏 / 提取首个 `{` 到末个 `}`；仍失败 → 追加「你的上一次输出无法解析为 JSON，错误：…，请重新输出严格 JSON」重试 1 次；再失败记 failed step。
- **连续 3 个 failed step** → 熔断：pause + emit error。
- **工具失败**：observation 返回 `{error}`，由 Agent 自行换检索词（提示词已要求最多换 2 次）。
- **eutils 限速**：全局串行队列，相邻间隔 ≥380ms。
- **服务重启**：running → interrupted（见 §5）；resume = 再次 POST /research（planner 读已有证据墙续查）。

### 6.4 上下文管理（长时工作的关键）

- investigator 的 scratchpad 只保留**最近 14 条完整 observation**（每条 ≤1600 chars）；更早的压缩为首 200 chars 单行摘要。
- 每个新任务重建 scratchpad，但注入：证据墙摘要（全部节点标题+kind + 关系列表）+ 当前 narrative + 用户 steering 消息。
- synthesizer 每轮全量重读 DB（节点/边/任务小结/用户消息），天然无上下文膨胀。

### 6.5 LLM 调用统一封装

```ts
import ZAI from 'z-ai-web-dev-sdk'
let zai: any
async function llm(systemPrompt: string, userPrompt: string): Promise<string> {
  zai ??= await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: systemPrompt },   // SDK 约定：系统提示用 assistant 角色
      { role: 'user', content: userPrompt },
    ],
    thinking: { type: 'disabled' },
  })
  return completion.choices[0]?.message?.content ?? ''
}
// 重试：指数退避 1s/3s，共 2 次；返回体为空视为失败
```

## 7. 工具规格（investigator 可用工具，运行时逐个注册）

### 7.1 外部检索工具（返回统一为 JSON 对象，由 runtime 截断成 observation）

**pubmed_search** `{query: string, max?: number=8}`
- `GET https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax={max}&sort=relevance&term={enc(query)}`
- 再 `GET .../esummary.fcgi?db=pubmed&retmode=json&id={ids.join(',')}`
- 返回 `{tool:'pubmed_search', query, total, results:[{pmid,title,journal,year,firstAuthor}], note:'用 pubmed_fetch 获取摘要'}`

**pubmed_fetch** `{pmids: string[]}`（≤5 个）
- `GET .../efetch.fcgi?db=pubmed&retmode=xml&id={...}`
- 正则提取每个 `<PubmedArticle>` 的 `<PMID...>(\d+)`、`<ArticleTitle>([\s\S]*?)</ArticleTitle>`、全部 `<AbstractText[^>]*>([\s\S]*?)</AbstractText>` 拼接；基本 HTML 实体解码；每篇截 700 chars。
- 返回 `{articles:[{pmid,title,abstract}]}`

**europepmc_search** `{query, max?=8}`
- `GET https://www.ebi.ac.uk/europepmc/webservices/rest/search?query={enc}&format=json&pageSize={max}&resultType=core`
- 映射 resultList.result → `{pmid, title, abstract(截600), journal, year, citations, openAccess}`

**openalex_search** `{query, max?=8}`（文献热度/引用数）
- `GET https://api.openalex.org/works?search={enc}&per-page={max}&mailto=serendip%40example.com&select=id,doi,title,publication_year,cited_by_count,primary_location`
- 返回 `{results:[{title,year,citations,journal,doi}]}`

**uniprot_search** `{query, max?=5}`
- `GET https://rest.uniprot.org/uniprotkb/search?query={enc}&format=json&size={max}&fields=accession,id,protein_name,gene_names,organism_name,cc_function`
- 返回 `{proteins:[{accession,name,gene,organism,function(截400)}]}`

**ncbi_gene** `{term, max?=5}`
- esearch(db=gene) + esummary(db=gene) → `{genes:[{geneId,symbol,description,organism}]}`

**pdb_search** `{term, max?=5}`
- `GET https://search.rcsb.org/rcsbsearch/v2/query?json={enc(JSON.stringify({query:{type:'terminal',service:'text',parameters:{value:term}},return_type:'entry',request_options:{paginate:{start:0,rows:max}}}))}`
- 对前 3 个 entry 再取 `https://data.rcsb.org/rest/v1/core/entry/{id}` 的 `rcsb_entry_info.title?`（或 `struct.title`），失败忽略。
- 返回 `{total, entries:[{id,title}]}`

**taxonomy_search** `{term, max?=3}`
- esearch(db=taxonomy) + esummary → `{taxa:[{taxid,scientificName,commonName,rank,lineage}]}`

**clinvar_search** `{term, max?=5}`
- esearch(db=clinvar) + esummary(db=clinvar) → 尽力映射 `{variants:[{id,title}]}`（字段解析失败就只给 title 列表）

**web_search** `{query, num?=8, recency_days?: number}`
- `zai.functions.invoke('web_search', {query, num, recency_days})`
- 映射 → `{results:[{title,url,snippet(截200),host,date}]}`

**web_read** `{url}`
- `zai.functions.invoke('page_reader', {url})` → `result.data`
- `result.data.html` 去除 script/style、剥标签、压空白，截 1800 chars
- 返回 `{title, url, text}`

**网络通用**：`AbortController` 25s 超时；`User-Agent: SerendipLab/1.0 (research-agent)`；429/5xx 时退避重试 1 次。

### 7.2 图操作工具（由 runtime 直接执行并落库）

**add_evidence** `{kind, title, content, sourceUrl?, sourceRef?, tags?, confidence?}`
→ 建节点（校验 kind 合法、title≤60字、content≤400字，超长截断），返回 `{ok:true, nodeId, title}`；若同 session 已有同 title 节点则**更新**内容并返回 `{ok:true, updated:true}`。

**link_evidence** `{from, to, relation, label?}`
→ from/to 为节点 id 或标题（标题匹配：忽略大小写与空白；支持子串包含）。命中多个取最新；找不到返回 `{error:'未找到节点', candidates:[现有节点标题前20个]}` 供重试。防重复边（同 from+to+relation）。

**update_evidence** `{title, patch:{confidence?, content?, status?, tags?}}` → 返回 `{ok}`

**note_gap** `{question, why}` → 建 gap 节点（title=question, content=why），返回 `{ok,nodeId}`

**ask_user** `{question, context?}` → emit message(kind='question')，phase='awaiting_user'，**挂起等待**（不耗预算）；用户 chat 回复后注入 `USER_INPUT: ...` 到下一步 scratchpad 并恢复。

**finish_task** `{summary}` → 结束当前任务（summary ≤400字）。

## 8. 提示词全文（四张面孔，语言=用户语言，默认中文）

### 8.1 Interviewer（访谈者）

```
# 角色
你是 Serendip——一位资深生物学科研合作者（PI 与博士后之间的头脑风暴搭档），正通过苏格拉底式提问帮用户挖掘真正值得研究的科学问题。你同时具备侦探的嗅觉：对矛盾与例外极度敏感。

# 任务
通过一次一个问题、层层递进的追问，把用户模糊的好奇心打磨成具体、可研究的科学问题。每轮回复只包含一个核心问题（可带一句简短铺垫），绝不一次问多个问题。

# 提问的推进层次
1. 好奇心起源：什么现象/矛盾/意外引发了兴趣？
2. 具体化：研究对象（基因/蛋白/细胞/组织/个体/种群/生态系统）与尺度（分子/细胞/个体/群体）？
3. 机制取向：更关心"是什么"(描述)、"为什么"(机制) 还是"怎么办"(应用)？
4. 边界条件：关注的物种/环境/疾病背景？偏好的研究手段（湿实验/计算/临床数据）？
5. 矛盾挖掘：用户所述内容中，哪些与教科书共识或主流假说存在张力？张力处往往藏着金矿。

# 提问品味
- 好问题像手术刀：具体、有对比、有张力。示范：「你提到"衰老细胞"——你更想理解它们为何不被免疫系统清除，还是想知道清除它们为何能延缓衰老？前者是机制问题，后者是转化问题，通往完全不同的研究路线。」
- 坏问题是清单式轰炸：「你研究什么领域？背景是什么？会用什么方法？」
- 必须基于用户已说的内容追问（引用他们用过的词），绝不重复已回答的问题。
- 可以适度点出相关经典假说/文献的存在来引导方向，但访谈阶段不大段科普。
- 用户明显想跳过访谈或已给出完整命题时，不要恋战，尽快 ready。

# 输出格式（严格 JSON，无其他文本、无代码块）
{"reply":"1-3句话+一个核心问题","ready":false,
 "extracted":{"topic":"","organism":"","scale":"","mechanism_interest":"","method_context":""},
 "title_suggestion":""}
- extracted：累积提炼的结构化画像，未知字段留空字符串
- ready：能概括出具体研究方向时置 true（通常≥2轮有效问答后）
- title_suggestion：ready 时给一个侦探风案件标题（如"线粒体基因组的留守之谜"）
```

输入拼接：系统提示 + `【对话记录】\nuser: ...\nassistant: ...`（仅 role 为 user/assistant 且 kind 为 chat 的消息）+ `【本次用户消息】`。

### 8.2 Planner（规划师）

```
# 角色
你是 Serendip 的调查规划师。基于用户画像与当前证据墙，制定下一轮自主调查计划，像刑侦组长部署排查方向。

# 原则
- 每轮 3-5 个任务，每个任务目标单一明确：验证某个假说 / 补足某类证据 / 探索某个矛盾 / 摸底某个空白。
- 排查优先级：① 与核心问题直接相关的经典与前沿文献；② 相互矛盾的证据（矛盾处藏真相）；③ 尚无证据覆盖的空白；④ 跨库交叉验证（文献↔基因↔蛋白↔结构）。
- 检索词以英文为主（生物数据库英文检索效果更好），每个任务 2-4 个角度不同的查询。
- 不与已完成的任务重复（已执行任务清单会提供）。

# 输出格式（严格 JSON，无其他文本）
{"focus_question":"本轮聚焦的核心问题",
 "tasks":[{"id":"t1","goal":"验证/发现什么","why":"为什么重要","queries":["..."],"tools_hint":["pubmed_search","openalex_search"],"expected_evidence":"期望证据类型"}],
 "hypotheses":[{"title":"假说陈述","basis":"当前依据"}]}
```

输入拼接：用户画像（signals + 全部 chat/steer 消息精选）+ 证据墙摘要（节点标题列表 + 边关系摘要）+ 已完成任务及其 summary + 剩余预算。

### 8.3 Investigator（调查员，ReAct）

```
# 角色
你是 Serendip 的调查员，正在执行一项具体调查任务。你通过 ReAct 循环（思考→行动→观察）逼近真相，像侦探一样建立证据链。

# 当前任务
{goal} —— {why}

# 证据墙现状
{节点清单: [kind] title；关系: A --supports--> B}
{当前案情综述（若有）}

# 用户补充（调查期间用户提供的信息，权重高于检索结果）
{steering 消息，无则省略此段}

# 可用工具
{逐工具：名称 | 参数 | 用途 | 返回}

# 行动协议（严格遵守）
每步只输出一个 JSON 对象（不要代码块、不要多余文本）：
{"thought":"简短推理：基于已有观察，这一步做什么、为什么","action":{"tool":"工具名","args":{...}}}

# 调查准则
- 先检索后精读：搜索工具先拿列表，再对高相关条目用 pubmed_fetch / web_read 深挖。
- 交叉验证：关键结论需两个独立来源。
- 每确认一条关键事实/数据，立即 add_evidence 落到证据墙：title 具体（含对象与数值），content 写清事实与出处（PMID/数据库名）。
- 证据与假说的关系用 link_evidence 建立；relation 取值：supports/contradicts/relates/derives/answers。
- 发现文献间矛盾或未解现象 → note_gap。
- 需要只有用户知道的信息（ta 的数据、背景约束）→ ask_user（调查会暂停等待）。
- 工具返回空或报错：换检索词重试，最多换 2 次，不要原地打转。
- 本任务最多 8 步；信息足够即 finish_task，summary 写清：获得了什么证据、支持/动摇了什么假说、留下什么疑问。
- 不要连续调用相同工具+相同参数。

# 剩余预算
全局剩余 {N} 步 / {M} 分钟。
```

### 8.4 Synthesizer（综合师）

```
# 角色
你是 Serendip 的首席综合分析师，做结案陈词的侦探。把碎片化证据组织成有逻辑的叙事，并评估哪些科学问题值得进一步研究。

# 输入
核心问题与假说、全部证据节点（含内容与来源）、证据关系、已完成任务小结、调查期间用户的补充消息。

# 输出格式（严格 JSON，无其他文本）
{"narrative_md":"案情综述 markdown，结构：## 迷雾（现象与矛盾）→ ## 证据链（按逻辑顺序组织，关键论断后标注[来源]）→ ## 推演（各假说强弱评估）→ ## 未解之谜 → ## 下一步建议。中文，克制、有画面感但不堆砌辞藻",
 "message_to_user":"1-3句话向用户汇报本轮关键发现（聊天窗展示）",
 "questions":[{"text":"值得进一步研究的具体问题","rationale":"为什么值得：新颖性/可行性/影响力综合理由","scores":{"novelty":1-5,"feasibility":1-5,"impact":1-5},"recommended":false,"evidence_refs":["支撑该问题的证据节点title"]}],
 "graph_ops":[{"op":"update_evidence","title":"...","patch":{"confidence":0.85,"status":"strong"}}],
 "continue":true,
 "next_focus":"若继续，下一轮聚焦点"}
- questions 给 3-5 个，其中恰好 1 个 recommended=true
- graph_ops 可选：用于上调/下调证据置信度、标注 status（strong/weak/contradicted）
- continue：证据未饱和且预算尚余时 true
```

## 9. Demo Seed 案件（POST /sessions {demo:true} 注入）

标题：`示例案件 · 线粒体基因组的留守之谜`，phase='done'，status='idle'。

节点（id 用 `demo-q1` 等）：
1. `demo-q1` question「为什么线粒体在 ~20 亿年内仍保留自己的基因组？」content：「内共生以来，大多数基因已迁入核基因组，但少数核心基因始终留守。迁移在机制上可行（有成功案例），为何演化不搬空？」confidence 0.95
2. `demo-h1` hypothesis「H1 · 疏水性约束：mtDNA 编码的膜蛋白过疏水，无法经 TOM/TIM 通道输入」basis 见 content。conf 0.85
3. `demo-h2` hypothesis「H2 · 共翻译调控：OXPHOS 亚基需要翻译-插入耦联与快速化学计量补偿」conf 0.6
4. `demo-h3` hypothesis「H3 · 局部氧化还原响应：基质内翻译可即时响应氧化还原状态」conf 0.45
5. `demo-e1` evidence「跨真核比较：mtDNA 编码蛋白平均疏水性显著高于已成功迁核的同源基因」sourceRef「PMID: 26808694 · PLoS Biol 2016」tags:[比较基因组学] conf 0.9 status strong
6. `demo-e2` evidence「线粒体核糖体贴内膜分布，专门翻译 COX1/CYTB 等高度疏水核心亚基」sourceRef「多篇综述 · 共翻译插入模型」conf 0.8 status strong
7. `demo-e3` evidence「例外：酿酒酵母等谱系已将部分线粒体 tRNA 基因迁入核基因组」sourceRef「RNA 无膜蛋白疏水性约束」conf 0.75
8. `demo-e4` evidence「核-线粒体表达失衡疾病（如 LHON）显示化学计量调控的临床重要性」conf 0.7
9. `demo-i1` insight「留守是多因素耦合裁决：疏水性锁死"谁不能走"，局部调控优势决定"谁不值得走"」conf 0.8
10. `demo-s1` source「Johnston & Williams (2016) PLoS Biology」sourceUrl https://plosbiology.org
11. `demo-s2` source「Allen (2015) Biochem Soc Trans · 共翻译调控综述」
12. `demo-g1` gap「为何不同谱系 mtDNA 基因丢失速率相差数量级？」
13. `demo-g2` gap「密码子重编程降低 COX1 疏水性后，能否核表达并功能整合进复合体？」

边：e1→h1 supports；e2→h1 supports；e2→h2 supports；e4→h2 supports；e3→h1 contradicts；h1→q1 answers；h2→q1 answers；h3→q1 answers；e1+e3→i1 derives（两条：e1→i1, e3→i1）；i1→q1 relates；s1→e1 relates；s2→e2 relates；g1→q1 relates；g2→h1 relates。

narrative（存 sessions.narrative）：
```md
## 迷雾
约 20 亿年前的一次内共生，让一类 α-变形菌住进了真核细胞。此后绝大多数基因陆续迁往核基因组——但直到今天，线粒体仍固执地保留着一小撮 DNA。迁移在机制上并非不可能（确有成功案例），演化却没有搬空它。这不是遗忘，更像一场被刻意维持的留守。

## 证据链
- **疏水性铁律**：跨真核生物的比较分析显示，mtDNA 编码蛋白的平均疏水性显著高于已成功迁核的同源基因 [PMID: 26808694]。高度疏水的底物几乎无法穿过 TOM/TIM 输入通道——这是 H1 的地基。
- **就近翻译**：线粒体核糖体贴近内膜排布，专职翻译 OXPHOS 复合体的核心疏水亚基（COX1、CYTB 等），实现翻译-插入耦联 [共翻译插入模型]。这解释了"为什么必须留"的另一半。
- **例外即线索**：酵母等谱系已把部分线粒体 tRNA 迁入核基因组——疏水性约束对 RNA 并不成立，说明留守不是单一铁律，而是多因素耦合的裁决。
- **临床回声**：核-线粒体基因表达失衡疾病（如 LHON）提示化学计量调控的生理分量。

## 推演
H1（疏水性约束）证据最厚，但解释不了非膜蛋白基因的留守与跨谱系差异；H2（共翻译/化学计量调控）与 H1 互补而非互斥。目前最强的画面是：**疏水性决定了"哪些基因不能走"，局部调控优势决定了"哪些基因不值得走"——两把锁同时咬合**。H3 证据尚薄。

## 未解之谜
- 为什么不同谱系的 mtDNA 丢失速率相差数量级？
- 若人工降低 COX1 疏水性（密码子重编程），它能否核表达并正确嵌入复合体？

## 下一步建议
在跨谱系比较基因组框架下，量化"留守倾向 / 疏水性 / 调控需求"三项的相对贡献；并以 COX1 重编程核表达实验作为决定性判据。
```

questions：
1. 「跨谱系线粒体基因留守速率的差异，可由哪些生态/生活史变量预测？」scores {novelty:4, feasibility:4, impact:3}
2. 「密码子重编程降低 COX1 疏水性后能否实现功能性核编码与组装？」scores {novelty:5, feasibility:2, impact:5} **recommended**
3. 「线粒体局部翻译的氧化还原响应动力学比核基因通路快多少？」scores {novelty:3, feasibility:4, impact:4}

messages：一条 system notice「示例案件已载入 · 点击"继续调查"可让 Agent 基于此案继续自主调查，或新建属于你的调查」。

## 10. 前端契约

### 10.1 目录划分

- **Task 2-b（视觉子代理）产物**：`src/components/canvas/`
  - `evidence-board.tsx` — ReactFlow 完整封装（'use client'，内部 import '@xyflow/react/dist/style.css'）
  - `board-nodes.tsx` — 6 种自定义节点组件 + nodeTypes 映射
  - `string-edge.tsx` — 红绳自定义边
  - `board-layout.ts` — dagre 自动布局
- **主接线（本代理）产物**：`src/app/page.tsx`、`src/components/studio/*`、`src/lib/agent-api.ts`、`src/hooks/use-agent-stream.ts`、`src/store/studio.ts`

### 10.2 EvidenceBoard 组件签名（2-b 必须遵守）

```ts
import type { BoardNode, BoardEdge } from '@/lib/types'

export type EvidenceBoardProps = {
  nodes: BoardNode[];
  edges: BoardEdge[];
  liveIds?: string[];              // 最近新增节点 id，做"钉上去"动画
  onNodeClick?: (node: BoardNode) => void;
  onPositionsChange?: (positions: { id: string; x: number; y: number }[]) => void;
  className?: string;
}
```

- 节点 position 为 null 时调用 `board-layout.ts` 的 `layoutBoard(nodes, edges)`（dagre，LR 方向，rank 分层：question=0, hypothesis=1, gap=1.5, insight=2, evidence=2, source=3）计算；非 null 用存储位置。
- 画布容器为"软木板"质感（CSS 纹理，见 10.3），暖棕色调不随明暗模式剧变（dark 模式下用深胡桃木色）。
- 自带 Controls（缩放/适应）与 MiniMap（暖色主题化）+ 左上角图例（六种卡片颜色说明）。
- 节点被点击 → `onNodeClick`；拖拽结束 → 收集所有节点当前位置回调 `onPositionsChange`。

### 10.3 视觉规格（侦探证据墙）

- 软木板：浅模式 `#c8ab84`→`#b8996e` 的细密噪点纹理（repeating-radial-gradient + repeating-linear-gradient 叠加）；深模式 `#3a2f24`→`#2c231b`。外框深胡桃木边（8px border + 内阴影）。
- 卡片（约 210px 宽，max-height 132px，内容截断省略）：
  - question：琥珀便签 `#f5d98a`/深棕字 `#4a3410`，顶部红图钉
  - hypothesis：青瓷便签 `#bfe3d0`/墨绿字 `#123629`，顶部铜图钉
  - evidence：米白拍立得 `#fdfaf1`/碳棕字 `#33291c`，顶部深红图钉 + 轻微纸纹
  - insight：橙便签 `#f6c9a0`/深赭字 `#5c3416`
  - source：报纸灰卡 `#eceae4`/石墨字，**衬线字体**（Georgia/宋体栈），顶部灰图钉
  - gap：白卡 + 琥珀虚线边框 + 「待查」角标
- 每张卡按 id 哈希微旋转（-3°~3°），hover 回正并提升阴影；图钉 = 8px 径向渐变圆点 + 微投影；卡片投影 `0 6px 14px rgba(60,42,18,.35)`。
- 红绳边（string-edge）：`supports`=`#b91c1c` 2px 实线（末端小圆环像挂在图钉上）；`contradicts`=`#26221c` 2px 虚线 dasharray 7 4；`relates`=`#8a7a64` 1.5px；`derives`=`#b45309` 1.5px 点线 dasharray 2 5；`answers`=`#15803d` 2px 实线。边中点可显示 label 小纸条。
- 新节点 `liveIds` 命中时：framer-motion spring（scale 0.6→1 + 轻微旋转落定）。
- 全部颜色**禁止 indigo/blue**。

### 10.4 页面布局（主接线实现）

- 顶栏：Logo（放大镜+DNA SVG）+「Serendip Lab · 生物科研灵感侦探」+ 会话切换/新建 + 状态药丸（阶段+步数进度）+ 控制（开始/暂停/继续/停止调查）+ 导出简报 + 明暗切换。
- 主体（lg+ 双栏）：左=对谈面板（380px，消息流+活动内嵌卡+输入框）；右=工作区 Tabs（证据墙/案情综述/问题清单/活动日志）。
- 移动端：底部 Tab 切换「对谈/证据墙/综述/问题」。
- Footer：`min-h-screen flex flex-col` + `mt-auto` 固定底部。
- 空态：欢迎卡 + 三个示例话题卡（点击即发送）+「载入示例案件」按钮。

## 11. 工作日志协议

所有代理共享 `/home/z/my-project/worklog.md`：开工前必读；完工后按模板追加（`---` 分隔 + Task ID + Agent + Work Log + Stage Summary）。禁止覆写。
