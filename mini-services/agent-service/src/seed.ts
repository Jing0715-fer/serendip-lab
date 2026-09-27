// seed.ts — §9 Demo 种子案件「线粒体基因组的留守之谜」
import {
  createSession, insertNode, insertEdge, insertMessage, replaceQuestions,
  updateSessionFields, defaultBudget, defaultMeta,
} from './db'

export function seedDemoSession(): string {
  const row = createSession()
  const sid = row.id
  // 节点 id 全局唯一（nodes.id 为主键）：按会话前缀生成，避免多个 demo 会话冲突
  const nid = (short: string) => `${sid.slice(0, 8)}-${short}`

  // ---- 节点（13） ----
  const nodes: [string, any, string, string, any][] = [
    ['demo-q1', 'question', '为什么线粒体在 ~20 亿年内仍保留自己的基因组？',
      '内共生以来，大多数基因已迁入核基因组，但少数核心基因始终留守。迁移在机制上可行（有成功案例），为何演化不搬空？',
      { confidence: 0.95 }],
    ['demo-h1', 'hypothesis', 'H1 · 疏水性约束：mtDNA 编码的膜蛋白过疏水，无法经 TOM/TIM 通道输入',
      '高度疏水的 OXPHOS 亚基若在胞质翻译后经 TOM/TIM 复合体输入线粒体，会因疏水性强而聚集/无法穿过亲水通道，因此在就地翻译并共翻译插入内膜。',
      { confidence: 0.85 }],
    ['demo-h2', 'hypothesis', 'H2 · 共翻译调控：OXPHOS 亚基需要翻译-插入耦联与快速化学计量补偿',
      '线粒体编码亚基与其核编码搭档需严格化学计量；局部翻译允许对氧化还原状态变化做快速补偿性调控。',
      { confidence: 0.6 }],
    ['demo-h3', 'hypothesis', 'H3 · 局部氧化还原响应：基质内翻译可即时响应氧化还原状态',
      '基质内翻译机器紧邻电子传递链，可即时感知 ROS/氧化还原状态并调整亚基合成速率。',
      { confidence: 0.45 }],
    ['demo-e1', 'evidence', '跨真核比较：mtDNA 编码蛋白平均疏水性显著高于已成功迁核的同源基因',
      '对跨真核生物的大规模比较分析显示，mtDNA 保留蛋白的疏水性显著高于历史上已成功转移到核基因组的同源蛋白。',
      { sourceRef: 'PMID: 26808694 · PLoS Biol 2016', tags: ['比较基因组学'], confidence: 0.9, status: 'strong' }],
    ['demo-e2', 'evidence', '线粒体核糖体贴内膜分布，专门翻译 COX1/CYTB 等高度疏水核心亚基',
      '电镜与生化证据显示线粒体核糖体锚定于内膜内表面，专职翻译疏水核心亚基，支持共翻译插入模型。',
      { sourceRef: '多篇综述 · 共翻译插入模型', confidence: 0.8, status: 'strong' }],
    ['demo-e3', 'evidence', '例外：酿酒酵母等谱系已将部分线粒体 tRNA 基因迁入核基因组',
      'tRNA 不涉及膜蛋白疏水性约束，部分谱系成功迁核并依赖 tRNA 输入回运，说明留守并非单一铁律。',
      { sourceRef: 'RNA 无膜蛋白疏水性约束', confidence: 0.75 }],
    ['demo-e4', 'evidence', '核-线粒体表达失衡疾病（如 LHON）显示化学计量调控的临床重要性',
      'LHON 等核-线粒体表达失衡疾病表明亚基化学计量的精细调控具有生理与临床意义。',
      { confidence: 0.7 }],
    ['demo-i1', 'insight', '留守是多因素耦合裁决：疏水性锁死"谁不能走"，局部调控优势决定"谁不值得走"',
      '综合比较基因组学、共翻译插入模型与谱系例外：疏水性约束解释"不能走"，局部调控优势解释"不值得走"，两者耦合决定留守。',
      { confidence: 0.8 }],
    ['demo-s1', 'source', 'Johnston & Williams (2016) PLoS Biology',
      'Expansion病因学：跨真核 mtDNA 基因保留的比较分析。', { sourceUrl: 'https://plosbiology.org' }],
    ['demo-s2', 'source', 'Allen (2015) Biochem Soc Trans · 共翻译调控综述',
      'Co-translational insertion of mitochondrial inner membrane proteins综述。', {}],
    ['demo-g1', 'gap', '为何不同谱系 mtDNA 基因丢失速率相差数量级？',
      '不同真核谱系 mtDNA 基因组大小差异巨大（从几 kb 到几百 kb），丢失速率相差数量级，驱动因素不明。', {}],
    ['demo-g2', 'gap', '密码子重编程降低 COX1 疏水性后，能否核表达并功能整合进复合体？',
      '若人工降低 COX1 疏水性使其可经 TOM/TIM 输入，能否在核基因组表达并正确组装进复合体 IV？这是 H1 的决定性实验。', {}],
  ]
  for (const [id, kind, title, content, extra] of nodes) {
    insertNode(sid, { id: nid(id), kind, title, content, pinnedBy: 'agent', ...extra })
  }

  // ---- 边（15） ----
  const edges: [string, string, string][] = [
    ['demo-e1', 'demo-h1', 'supports'],
    ['demo-e2', 'demo-h1', 'supports'],
    ['demo-e2', 'demo-h2', 'supports'],
    ['demo-e4', 'demo-h2', 'supports'],
    ['demo-e3', 'demo-h1', 'contradicts'],
    ['demo-h1', 'demo-q1', 'answers'],
    ['demo-h2', 'demo-q1', 'answers'],
    ['demo-h3', 'demo-q1', 'answers'],
    ['demo-e1', 'demo-i1', 'derives'],
    ['demo-e3', 'demo-i1', 'derives'],
    ['demo-i1', 'demo-q1', 'relates'],
    ['demo-s1', 'demo-e1', 'relates'],
    ['demo-s2', 'demo-e2', 'relates'],
    ['demo-g1', 'demo-q1', 'relates'],
    ['demo-g2', 'demo-h1', 'relates'],
  ]
  for (const [source, target, relation] of edges) {
    insertEdge(sid, nid(source), nid(target), relation as any)
  }

  // ---- narrative（§9 原文） ----
  const narrative = `## 迷雾
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
在跨谱系比较基因组框架下，量化"留守倾向 / 疏水性 / 调控需求"三项的相对贡献；并以 COX1 重编程核表达实验作为决定性判据。`

  // ---- questions（3） ----
  replaceQuestions(sid, [
    {
      text: '跨谱系线粒体基因留守速率的差异，可由哪些生态/生活史变量预测？',
      rationale: '把静态比较扩展为动态演化速率分析，可检验多因素模型的预测力。',
      scores: { novelty: 4, feasibility: 4, impact: 3 },
      recommended: false,
      evidenceRefs: ['跨真核比较：mtDNA 编码蛋白平均疏水性显著高于已成功迁核的同源基因'],
    },
    {
      text: '密码子重编程降低 COX1 疏水性后能否实现功能性核编码与组装？',
      rationale: '决定性实验：直接检验疏水性约束是否为硬限制，兼有合成生物学价值。',
      scores: { novelty: 5, feasibility: 2, impact: 5 },
      recommended: true,
      evidenceRefs: ['跨真核比较：mtDNA 编码蛋白平均疏水性显著高于已成功迁核的同源基因', '密码子重编程降低 COX1 疏水性后，能否核表达并功能整合进复合体？'],
    },
    {
      text: '线粒体局部翻译的氧化还原响应动力学比核基因通路快多少？',
      rationale: '量化 H3 假说的时序优势，是区分"值得留守"与"必须留守"的关键。',
      scores: { novelty: 3, feasibility: 4, impact: 4 },
      recommended: false,
      evidenceRefs: ['线粒体核糖体贴内膜分布，专门翻译 COX1/CYTB 等高度疏水核心亚基'],
    },
  ])

  // ---- 消息 ----
  insertMessage(sid, {
    role: 'system',
    kind: 'notice',
    content: '示例案件已载入 · 点击"继续调查"可让 Agent 基于此案继续自主调查，或新建属于你的调查',
  })

  // ---- 会话元信息 ----
  const budget = { ...defaultBudget(), stepsUsed: 27, toolCalls: 31, llmCalls: 18, round: 1, elapsedMs: 8 * 60_000, startedAt: null }
  const meta = { ...defaultMeta(), ready: true, title_suggestion: '线粒体基因组的留守之谜', pendingQuestion: null }
  updateSessionFields(sid, {
    title: '示例案件 · 线粒体基因组的留守之谜',
    phase: 'done',
    status: 'idle',
    narrative,
    meta: JSON.stringify(meta),
    budget: JSON.stringify(budget),
  })

  return sid
}
