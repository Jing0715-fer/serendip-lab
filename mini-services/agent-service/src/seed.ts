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
  // 引用均已通过 Europe PMC 验证真实存在（PMID 可点击打开原文）
  const nodes: [string, any, string, string, any][] = [
    ['demo-q1', 'question', '为什么线粒体在 ~20 亿年内仍保留自己的基因组？',
      '内共生以来，大多数基因已迁入核基因组，但少数核心基因始终留守。迁移在机制上可行（有成功案例），为何演化不搬空？',
      {
        confidence: 0.95,
        detail: '这是本案件的核心谜题：线粒体源自约 20 亿年前的一次内共生事件，此后绝大多数基因已迁往核基因组（人类线粒体仅余 37 个基因）。但迁移在机制上并非不可能——确实有基因成功迁核的案例。演化却始终没有把 mtDNA 搬空，说明留守背后存在持续的选择压力。点击下方文献源卡片可打开原文。',
      }],
    ['demo-h1', 'hypothesis', 'H1 · 疏水性约束：mtDNA 编码的膜蛋白过疏水，无法经 TOM/TIM 通道输入',
      '高度疏水的 OXPHOS 亚基若在胞质翻译后经 TOM/TIM 复合体输入线粒体，会因疏水性强而聚集/无法穿过亲水通道，因此在就地翻译并共翻译插入内膜。',
      {
        confidence: 0.85,
        detail: '核心逻辑：TOM/TIM 输入通道是亲水性的，而 mtDNA 保留的膜蛋白（如 COX1、CYTB）平均疏水性极高——翻译后再输入会在胞质中聚集失活。因此这类蛋白"不能走"，必须留在基质内就地翻译并共翻译插入内膜。 Johnston & Williams 2016 的跨真核比较分析为该假说提供了系统证据。',
      }],
    ['demo-h2', 'hypothesis', 'H2 · 共翻译调控：OXPHOS 亚基需要翻译-插入耦联与快速化学计量补偿',
      '线粒体编码亚基与其核编码搭档需严格化学计量；局部翻译允许对氧化还原状态变化做快速补偿性调控。',
      {
        confidence: 0.6,
        detail: '该假说从"调控优势"角度解释留守：呼吸链复合体由 mtDNA 与核 DNA 双方编码的亚基组装而成，需要严格化学计量。就地翻译允许线粒体即时感知局部需求并快速补偿，比"发回细胞核再转录翻译"的回路快得多。',
      }],
    ['demo-h3', 'hypothesis', 'H3 · 局部氧化还原响应：基质内翻译可即时响应氧化还原状态',
      '基质内翻译机器紧邻电子传递链，可即时感知 ROS/氧化还原状态并调整亚基合成速率。',
      {
        confidence: 0.45,
        detail: '尚缺直接时序证据：假说预测线粒体局部翻译对氧化还原扰动的响应应显著快于核基因通路，但目前缺乏定量对比数据。这也是下面"值得研究的问题"之一。',
      }],
    ['demo-e1', 'evidence', '跨真核比较：mtDNA 编码蛋白平均疏水性显著高于已成功迁核的同源基因',
      '对跨真核生物的大规模比较分析显示，mtDNA 保留蛋白的疏水性显著高于历史上已成功转移到核基因组的同源蛋白。',
      {
        sourceRef: 'PMID: 27135164 · Cell Syst 2016',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/27135164/',
        detail: 'Johnston & Williams 对数百种真核生物做了系统发生控制的比较分析，发现 mtDNA 保留蛋白的疏水性显著高于已成功迁核的同源蛋白——疏水性是基因能否迁核的最强预测因子之一。这是 H1 最系统的定量证据（点击上方 PMID 可打开原文摘要）。',
        tags: ['比较基因组学'], confidence: 0.9, status: 'strong' }],
    ['demo-e2', 'evidence', '线粒体核糖体贴内膜分布，专门翻译 COX1/CYTB 等高度疏水核心亚基',
      '电镜与生化证据显示线粒体核糖体锚定于内膜内表面，专职翻译疏水核心亚基，支持共翻译插入模型。',
      {
        sourceRef: 'PMID: 42660304 · J Struct Biol 2026',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/42660304/',
        detail: '最新结构生物学证据：酵母 Mba1 等因子将线粒体核糖体锚定在内膜内表面，使 COX1/CYTB 等高度疏水亚基在翻译的同时直接插入内膜——"共翻译插入"不再只是模型，而是可见的结构事实（点击 PMID 打开原文）。',
        confidence: 0.8, status: 'strong' }],
    ['demo-e3', 'evidence', '例外：酿酒酵母等谱系已将部分线粒体 tRNA 基因迁入核基因组',
      'tRNA 不涉及膜蛋白疏水性约束，部分谱系成功迁核并依赖 tRNA 输入回运，说明留守并非单一铁律。',
      {
        sourceRef: 'PMID: 10066161 · Science 1999',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/10066161/',
        detail: 'Gray, Burger & Lang 的经典综述（Science 1999）梳理了跨谱系证据：tRNA 等非膜蛋白基因确实存在成功迁核案例，需要通过 tRNA 输入回运维持功能。这说明疏水性约束解释的是"膜蛋白为何留守"，而非全部留守现象——留守是多因素耦合的裁决（点击 PMID 打开原文）。',
        confidence: 0.75 }],
    ['demo-e4', 'evidence', '核-线粒体表达失衡疾病（如 LHON）显示化学计量调控的临床重要性',
      'LHON 等核-线粒体表达失衡疾病表明亚基化学计量的精细调控具有生理与临床意义。',
      {
        sourceRef: 'PMID: 3201231 · Science 1988',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/3201231/',
        detail: 'Wallace 团队 1988 年在 Science 上首次将 LHON 定位于 mtDNA 突变——单个别 mtDNA 编码亚基的缺陷即可导致视神经变性。这从临床角度说明了线粒体编码亚基的表达平衡具有不可替代的生理分量，支撑 H2 的"化学计量调控"论点（点击 PMID 打开原文）。',
        confidence: 0.7 }],
    ['demo-i1', 'insight', '留守是多因素耦合裁决：疏水性锁死"谁不能走"，局部调控优势决定"谁不值得走"',
      '综合比较基因组学、共翻译插入模型与谱系例外：疏水性约束解释"不能走"，局部调控优势解释"不值得走"，两者耦合决定留守。',
      {
        confidence: 0.8,
        detail: '综合 H1+H2+例外的整体图景：两把锁同时咬合——疏水性决定"哪些基因物理上不能走"，局部调控优势决定"哪些基因在经济上不值得走"。任何单一因素都解释不了全部留守模式。',
      }],
    ['demo-s1', 'source', 'Johnston & Williams (2016) Cell Systems · 跨真核 mtDNA 保留压力分析',
      'Evolutionary Inference across Eukaryotes Identifies Specific Pressures Favoring Mitochondrial Gene Retention.',
      {
        sourceRef: 'PMID: 27135164',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/27135164/',
        detail: '本文是 H1 假说的定量基石：用系统发生独立对比对数百种真核生物检验了"疏水性、复杂性、基因组大小"等因素对 mtDNA 基因保留的预测力。点击可打开 PubMed 原文页。' }],
    ['demo-s2', 'source', 'Gray, Burger & Lang (1999) Science · Mitochondrial Evolution 经典综述',
      'Mitochondrial evolution. Science 283:1476-1481.',
      {
        sourceRef: 'PMID: 10066161',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/10066161/',
        detail: '线粒体演化领域的里程碑综述，梳理了内共生起源、二次基因丢失与跨谱系 mtDNA 多样性。点击可打开 PubMed 原文页。' }],
    ['demo-g1', 'gap', '为何不同谱系 mtDNA 基因丢失速率相差数量级？',
      '不同真核谱系 mtDNA 基因组大小差异巨大（从几 kb 到几百 kb），丢失速率相差数量级，驱动因素不明。',
      {
        detail: 'Johnston 2022（PMID: 36115336）的后续分析显示谱系间差异仍有大量未解释方差——生态/生活史变量（世代时间、代谢率、种群大小）可能是候选预测因子。',
        sourceRef: 'PMID: 36115336 · Cell Syst 2022',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/36115336/' }],
    ['demo-g2', 'gap', '密码子重编程降低 COX1 疏水性后，能否核表达并功能整合进复合体？',
      '若人工降低 COX1 疏水性使其可经 TOM/TIM 输入，能否在核基因组表达并正确组装进复合体 IV？这是 H1 的决定性实验。',
      {
        detail: '决定性判据实验：若人工降低疏水性的 COX1 能成功核表达并组装进复合体 IV，则"不能走"是硬约束；若仍失败，则存在独立于疏水性的第二重障碍。兼具合成生物学价值。',
      }],
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
