# Task 20-a · backend-agent 工作记录

## 任务
Serendip Lab agent-service（Bun + SQLite, :3002）两个 P0 特性后端管线：
1. 证据等级体系（EvidenceLevel：user/rct/cohort/animal/invitro/computational）
2. 重综合端点（POST /api/agent/sessions/:id/resynthesize）

## 共享契约落实情况
- `EvidenceLevel` 六值类型 + `EVIDENCE_LEVELS` 顺序数组：`src/db.ts`（与前端代理共享的字段语义一致）
- `BoardNode.level: EvidenceLevel | null`（null = 未定级），全链路（insert/update/map/SSE state/GET 会话）透出
- `POST /api/agent/sessions/:id/resynthesize` body `{lang?}` → `{ok:true}`；409 `agent_busy`（研究运行中）；400 `no_evidence`（墙上无节点）——三分支均已 curl 实测

## 修改文件清单
| 文件 | 修改 |
|---|---|
| src/db.ts | EvidenceLevel 类型 + EVIDENCE_LEVELS 常量；BoardNode/NodeRow 加 level；第三个轻量迁移 `ALTER TABLE nodes ADD COLUMN level TEXT`；mapNode 白名单校验；insertNode 写入 level；updateNode patch 支持 level（非法落 null）；updateNodeContent 追加可选 level 参数（COALESCE：null 不动/合法覆盖，旧 7 参调用兼容） |
| src/tools.ts | toolsDoc add_evidence 参数表追加 `level?(user/rct/cohort/animal/invitro/computational)` 说明 |
| src/prompts.ts | buildInvestigatorPrompt 调研准则加「必须标注 level，宁可降级不可虚标」；SYNTHESIZER_PROMPT：输入说明注明 [level] 标记语义 + 新增「推演原则」按等级加权（user/rct > cohort > animal > invitro > computational，computational 不足以确立因果，需指出证据链等级构成与短板）+ graph_ops add_evidence 加 `"level?":"user|rct|cohort|animal|invitro|computational"` |
| src/runtime.ts | 模块级 `normalizeLevel()`（trim/lowercase 后严格匹配六值）；toolAddEvidence insert/update 两分支传 level；toolUpdateEvidence patch.level 归一后传 updateNode；callSynthesizer 证据节点行插 `[level]` 标记 + graph_ops 透传 level；新增 `resynthesize()` 公开方法（agent_busy/no_evidence 守卫 + resynthesizeStart notice + callSynthesizer(true) + phase=done） |
| src/lang.ts | NOTICES 与 NoticeKey 加 `resynthesizeStart` 双语条目 |
| index.ts | 子操作路由正则追加 `\|resynthesize`；explorations 块后新增 resynthesize 处理块（lang 透传、409/400 守卫、异步执行即返 ok） |
| src/seed.ts | demo 证据卡补 level：e1/e3=computational、e2=invitro、e4=cohort；新增 2 张真实引用证据卡：e5=rct（RHODOS 试验，idebenone 治疗 LHON，PMID 21788663 经 Europe PMC 验证）、e6=animal（mtDNA mutator mouse，Trifunovic Nature 2004，PMID 15164064 经验证）；i1 洞见保持 null（演示未定级态）；narrative 证据链补等级标注行；边 +2（e5/e6 relates→q1） |

## 验证结果（全部通过）
1. health：`{"ok":true,"version":"1.0.0"}`（bun --hot 热重载生效，模块级迁移在老库上执行成功）
2. demo 会话 nodes 含 level：computational×2 / invitro / cohort / rct / animal 全齐，insight=null；EN 包同样全齐
3. resynthesize：`{"ok":true}` → 80s 完成；narrative 由种子 910 字重写为 818 字新综述，**推演段出现等级加权表述**（H1 强支持（computational+invitro）/ H2 中等（cohort））；phase=done；graph_ops 新增节点带 level=user（LLM 主动使用 level 参数，管线端到端打通）；COALESCE 保级验证：e2 invitro/e4 cohort 在重综合后原级保留
4. 错误分支：运行中并发调用 → HTTP 409 `{"error":"agent_busy"}`；空会话 → HTTP 400 `{"error":"no_evidence"}`
5. PRAGMA table_info(nodes)：`...,detail,level` ✓
6. db 层单测（bun -e 脚本）：insert=rct；patch 非法值→null；patch 合法→cohort；updateNodeContent null 不动 / user 覆盖；7 参旧调用兼容 ✓
7. tsc 对比基线：HEAD 21 个 agent-service 相关错误 → 修改后同样 21 个（仅行号位移，全部为预存 detail/PlanTask/directions 旧错），**零新增类型错误**
8. `bun run lint`（主项目）：exit 0 全绿

## 已知边界（按任务范围约定）
- explore.ts（反馈推导闭环的 applyGraphOps）按指示未动——反馈路径新增卡片暂不带 level（后续任务可低成本补齐，normalizeLevel 已导出在 runtime 内可复用思路）
- LLM 可能把非 evidence 类卡（question/hypothesis）标 level（如 user）——schema 允许，卡面渲染时前端可按 kind 决定是否显示徽章
