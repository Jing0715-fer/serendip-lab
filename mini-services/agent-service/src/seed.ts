// seed.ts — §9 Demo 种子课题「线粒体基因组的留守之谜」
// Task 13：双语化——seedDemoSession(lang) 按语言选择中文/英文内容包，
// 引用均为经 Europe PMC 实测验证的真实 PMID（可点击打开原文）。
import {
  createSession, insertNode, insertEdge, insertMessage, replaceQuestions,
  updateSessionFields, defaultBudget, defaultMeta, listNodes,
} from './db'

export function seedDemoSession(lang: 'zh' | 'en' = 'zh'): string {
  const row = createSession(undefined, lang)
  const sid = row.id
  // 节点 id 全局唯一（nodes.id 为主键）：按会话前缀生成，避免多个 demo 会话冲突
  const nid = (short: string) => `${sid.slice(0, 8)}-${short}`

  // ---- 节点（15） ----
  // Task 20：证据卡补 level 证据等级（rct/cohort/animal/invitro/computational 各至少一张；
  // i1 洞见保持未定级 null，同步演示「未定级」卡面）。引用均经 Europe PMC 实测验证的真实 PMID。
  const nodes: [string, string, string, string, any][] = lang === 'en' ? [
    ['demo-q1', 'question', 'Why have mitochondria kept their own genome for ~2 billion years?',
      'Since endosymbiosis, most genes have relocated to the nuclear genome, yet a handful of core genes remain. Transfer is mechanically feasible (successful cases exist) — why did evolution never empty mtDNA?',
      {
        confidence: 0.95,
        detail: 'The central puzzle of this project: mitochondria descend from an ~2-billion-year-old endosymbiotic event, after which the vast majority of genes moved to the nucleus (human mtDNA retains only 37). Yet transfer is not impossible — some genes did successfully relocate. That evolution never cleared mtDNA out implies a persistent selective pressure behind the retention. Click the source cards below to open the original papers.',
      }],
    ['demo-h1', 'hypothesis', 'H1 · Hydrophobicity constraint: mtDNA-encoded membrane proteins are too hydrophobic to import through TOM/TIM channels',
      'Highly hydrophobic OXPHOS subunits, if translated in the cytosol and imported via TOM/TIM, would aggregate or fail to traverse the hydrophilic channel — so they must be translated in situ and co-translationally inserted into the inner membrane.',
      {
        confidence: 0.85,
        detail: 'Core logic: the TOM/TIM import channel is hydrophilic, while mtDNA-retained membrane proteins (e.g. COX1, CYTB) are among the most hydrophobic proteins in the cell — post-translational import would risk aggregation in the cytosol. These proteins "cannot leave", so they must be translated in the matrix and inserted co-translationally. Johnston & Williams 2016 provide systematic cross-eukaryotic evidence for this hypothesis.',
      }],
    ['demo-h2', 'hypothesis', 'H2 · Co-translational control: OXPHOS subunits require translation-insertion coupling and rapid stoichiometric compensation',
      'Mitochondrially encoded subunits and their nuclear-encoded partners require strict stoichiometry; local translation allows rapid compensatory regulation in response to redox state changes.',
      {
        confidence: 0.6,
        detail: 'This hypothesis explains retention via "regulatory advantage": respiratory-chain complexes are assembled from subunits encoded by both mtDNA and the nucleus, demanding strict stoichiometry. In-situ translation lets the mitochondrion sense local demand and compensate immediately — far faster than a "signal back to the nucleus, transcribe, translate, import" loop.',
      }],
    ['demo-h3', 'hypothesis', 'H3 · Local redox response: matrix translation can react instantly to redox state',
      'The translation machinery in the matrix sits right next to the electron transport chain and can sense ROS/redox state and adjust subunit synthesis rates in real time.',
      {
        confidence: 0.45,
        detail: 'Direct temporal evidence is still missing: the hypothesis predicts that mitochondrial local translation should respond to redox perturbations significantly faster than nuclear gene pathways, but quantitative side-by-side data are lacking. This is one of the "questions worth pursuing" below.',
      }],
    ['demo-e1', 'evidence', 'Cross-eukaryote comparison: mtDNA-encoded proteins are significantly more hydrophobic than homologs that successfully relocated to the nucleus',
      'Large-scale comparative analysis across eukaryotes shows mtDNA-retained proteins are significantly more hydrophobic than homologs historically transferred to the nuclear genome.',
      {
        sourceRef: 'PMID: 27135164 · Cell Syst 2016',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/27135164/',
        detail: 'Johnston & Williams performed phylogenetically controlled comparisons across hundreds of eukaryotes, finding mtDNA-retained proteins are significantly more hydrophobic than successfully transferred homologs — hydrophobicity is one of the strongest predictors of gene retention. This is the most systematic quantitative evidence for H1 (click the PMID above to open the abstract).',
        tags: ['comparative genomics'], confidence: 0.9, status: 'strong', level: 'computational' }],
    ['demo-e2', 'evidence', 'Mitochondrial ribosomes dock on the inner membrane, dedicated to translating highly hydrophobic core subunits like COX1/CYTB',
      'EM and biochemical evidence shows mitochondrial ribosomes anchored to the inner membrane face, specializing in translating hydrophobic core subunits — supporting the co-translational insertion model.',
      {
        sourceRef: 'PMID: 42660304 · J Struct Biol 2026',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/42660304/',
        detail: 'Latest structural evidence: factors such as yeast Mba1 anchor mitochondrial ribosomes to the inner membrane face, so that highly hydrophobic subunits like COX1/CYTB insert directly into the membrane as they are translated — "co-translational insertion" is no longer just a model but a visible structural fact (click the PMID to open the paper).',
        confidence: 0.8, status: 'strong', level: 'invitro' }],
    ['demo-e3', 'evidence', 'Exception: lineages such as S. cerevisiae have relocated part of their mitochondrial tRNA genes to the nucleus',
      'tRNAs are not subject to the membrane-protein hydrophobicity constraint; several lineages successfully relocated them and rely on tRNA import back into mitochondria — retention is not a single iron law.',
      {
        sourceRef: 'PMID: 10066161 · Science 1999',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/10066161/',
        detail: 'The classic review by Gray, Burger & Lang (Science 1999) synthesizes cross-lineage evidence: non-membrane-protein genes such as tRNAs do have successful relocation cases, maintained by tRNA import. This means the hydrophobicity constraint explains "why membrane proteins stay", not the full retention pattern — retention is a multi-factor verdict (click the PMID to open the paper).',
        confidence: 0.75, level: 'computational' }],
    ['demo-e4', 'evidence', 'Nuclear–mitochondrial expression imbalance diseases (e.g. LHON) reveal the clinical weight of stoichiometric control',
      'Diseases such as LHON show that fine-grained control of subunit stoichiometry carries physiological and clinical significance.',
      {
        sourceRef: 'PMID: 3201231 · Science 1988',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/3201231/',
        detail: 'Wallace\'s team first mapped LHON to an mtDNA mutation in Science in 1988 — a defect in a single mtDNA-encoded subunit suffices to cause optic neuropathy. Clinically, this shows the expression balance of mitochondrially encoded subunits has irreplaceable physiological weight, supporting H2\'s "stoichiometric control" argument (click the PMID to open the paper).',
        confidence: 0.7, level: 'cohort' }],
    ['demo-e5', 'evidence', 'RCT: idebenone improves visual outcomes in LHON (electron bypass of the defective respiratory chain)',
      'The RHODOS trial (85 LHON patients, randomized double-blind placebo-controlled) showed significant best-corrected visual acuity improvement with idebenone — RCT-level evidence that respiratory-chain defects caused by mtDNA mutations are clinically actionable.',
      {
        sourceRef: 'PMID: 21788663 · Brain 2011',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/21788663/',
        detail: 'Klopstock et al., multicenter randomized controlled trial (RHODOS): idebenone, a short-chain quinone electron carrier, bypasses the defective complex I by shuttling electrons directly to complex III; treated patients recovered vision significantly versus placebo. This is the highest-tier literature evidence on the wall (rct) — a clinical-interventional counterpart to the LHON pedigree evidence above (click the PMID to open the paper).',
        confidence: 0.85, level: 'rct' }],
    ['demo-e6', 'evidence', 'In vivo causal evidence: mtDNA mutation accumulation suffices to drive premature ageing in mammals',
      'PolgA proofreading-deficient knock-in mice (the mtDNA mutator mouse) accumulate mtDNA mutations massively and show premature-ageing phenotypes — causal in vivo proof that mtDNA integrity and function are vital.',
      {
        sourceRef: 'PMID: 15164064 · Nature 2004',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/15164064/',
        detail: 'Trifunovic et al., Nature 2004 — the classic mtDNA mutator mouse: knocking out the PolgA proofreading domain causes massive mtDNA mutation accumulation in vivo, with alopecia, osteoporosis, cardiomyopathy and other premature-ageing phenotypes. A landmark animal-level causal experiment (animal): maintaining a functional mitochondrial genome is a hard requirement for multicellular life (click the PMID to open the paper).',
        confidence: 0.9, level: 'animal' }],
    ['demo-i1', 'insight', 'Retention is a coupled multi-factor verdict: hydrophobicity locks "who cannot leave"; local regulatory advantage decides "who should not leave"',
      'Synthesizing comparative genomics, the co-translational insertion model and lineage exceptions: hydrophobicity explains "cannot leave", local regulatory advantage explains "not worth leaving" — together they determine retention.',
      {
        confidence: 0.8,
        detail: 'The overall picture from H1 + H2 + exceptions: two locks engage simultaneously — hydrophobicity decides which genes physically cannot leave, local regulatory advantage decides which genes are economically not worth moving. No single factor explains the full retention pattern.',
      }],
    ['demo-s1', 'source', 'Johnston & Williams (2016) Cell Systems · Cross-eukaryote analysis of mtDNA retention pressures',
      'Evolutionary Inference across Eukaryotes Identifies Specific Pressures Favoring Mitochondrial Gene Retention.',
      {
        sourceRef: 'PMID: 27135164',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/27135164/',
        detail: 'The quantitative cornerstone of H1: phylogenetic independent contrasts testing how hydrophobicity, complexity and genome size predict mtDNA gene retention across hundreds of eukaryotes. Click to open the PubMed page.' }],
    ['demo-s2', 'source', 'Gray, Burger & Lang (1999) Science · Classic review of mitochondrial evolution',
      'Mitochondrial evolution. Science 283:1476-1481.',
      {
        sourceRef: 'PMID: 10066161',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/10066161/',
        detail: 'A milestone review of mitochondrial evolution, covering the endosymbiotic origin, secondary gene loss and cross-lineage mtDNA diversity. Click to open the PubMed page.' }],
    ['demo-g1', 'gap', 'Why do mtDNA gene-loss rates differ by orders of magnitude across lineages?',
      'mtDNA genome sizes vary enormously across eukaryotic lineages (from a few kb to hundreds of kb); loss rates differ by orders of magnitude and the drivers remain unknown.',
      {
        detail: 'Follow-up analysis by Johnston 2022 (PMID: 36115336) shows large unexplained variance remains across lineages — ecological/life-history variables (generation time, metabolic rate, population size) are candidate predictors.',
        sourceRef: 'PMID: 36115336 · Cell Syst 2022',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/36115336/' }],
    ['demo-g2', 'gap', 'If codon reprogramming lowers COX1 hydrophobicity, can it be nuclear-expressed and functionally assembled into Complex IV?',
      'If artificially de-hydrophobized COX1 could be imported via TOM/TIM, could it be expressed from the nucleus and correctly assembled into Complex IV? The decisive experiment for H1.',
      {
        detail: 'The decisive discriminating experiment: if an artificially de-hydrophobized COX1 can be nuclear-expressed and assembled into Complex IV, "cannot leave" is a hard constraint; if it still fails, a second barrier independent of hydrophobicity exists. Also of synthetic-biology value.',
      }],
  ] : [
    ['demo-q1', 'question', '为什么线粒体在 ~20 亿年内仍保留自己的基因组？',
      '内共生以来，大多数基因已迁入核基因组，但少数核心基因始终留守。迁移在机制上可行（有成功案例），为何演化不搬空？',
      {
        confidence: 0.95,
        detail: '这是本课题的核心谜题：线粒体源自约 20 亿年前的一次内共生事件，此后绝大多数基因已迁往核基因组（人类线粒体仅余 37 个基因）。但迁移在机制上并非不可能——确实有基因成功迁核的案例。演化却始终没有把 mtDNA 搬空，说明留守背后存在持续的选择压力。点击下方文献源卡片可打开原文。',
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
        tags: ['比较基因组学'], confidence: 0.9, status: 'strong', level: 'computational' }],
    ['demo-e2', 'evidence', '线粒体核糖体贴内膜分布，专门翻译 COX1/CYTB 等高度疏水核心亚基',
      '电镜与生化证据显示线粒体核糖体锚定于内膜内表面，专职翻译疏水核心亚基，支持共翻译插入模型。',
      {
        sourceRef: 'PMID: 42660304 · J Struct Biol 2026',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/42660304/',
        detail: '最新结构生物学证据：酵母 Mba1 等因子将线粒体核糖体锚定在内膜内表面，使 COX1/CYTB 等高度疏水亚基在翻译的同时直接插入内膜——"共翻译插入"不再只是模型，而是可见的结构事实（点击 PMID 打开原文）。',
        confidence: 0.8, status: 'strong', level: 'invitro' }],
    ['demo-e3', 'evidence', '例外：酿酒酵母等谱系已将部分线粒体 tRNA 基因迁入核基因组',
      'tRNA 不涉及膜蛋白疏水性约束，部分谱系成功迁核并依赖 tRNA 输入回运，说明留守并非单一铁律。',
      {
        sourceRef: 'PMID: 10066161 · Science 1999',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/10066161/',
        detail: 'Gray, Burger & Lang 的经典综述（Science 1999）梳理了跨谱系证据：tRNA 等非膜蛋白基因确实存在成功迁核案例，需要通过 tRNA 输入回运维持功能。这说明疏水性约束解释的是"膜蛋白为何留守"，而非全部留守现象——留守是多因素耦合的裁决（点击 PMID 打开原文）。',
        confidence: 0.75, level: 'computational' }],
    ['demo-e4', 'evidence', '核-线粒体表达失衡疾病（如 LHON）显示化学计量调控的临床重要性',
      'LHON 等核-线粒体表达失衡疾病表明亚基化学计量的精细调控具有生理与临床意义。',
      {
        sourceRef: 'PMID: 3201231 · Science 1988',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/3201231/',
        detail: 'Wallace 团队 1988 年在 Science 上首次将 LHON 定位于 mtDNA 突变——单个 mtDNA 编码亚基的缺陷即可导致视神经变性。这从临床角度说明了线粒体编码亚基的表达平衡具有不可替代的生理分量，支撑 H2 的"化学计量调控"论点（点击 PMID 打开原文）。',
        confidence: 0.7, level: 'cohort' }],
    ['demo-e5', 'evidence', '随机对照试验：idebenone 改善 LHON 患者视功能（绕过缺陷呼吸链的电子旁路）',
      'RHODOS 试验（85 例 LHON，随机双盲安慰剂对照）显示 idebenone 组最佳矫正视力显著改善且耐受良好——mtDNA 突变所致呼吸链缺陷可被临床干预，RCT 级证据。',
      {
        sourceRef: 'PMID: 21788663 · Brain 2011',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/21788663/',
        detail: 'Klopstock 等的多中心随机对照试验（RHODOS）：idebenone 作为短链醌类电子载体，可绕过缺陷的复合体 I 将电子直接递给复合体 III；治疗组视力较安慰剂组显著恢复。这是本证据墙上等级最高的文献证据（rct）——与上方 LHON 家系证据构成临床观察↔临床干预的对照（点击 PMID 打开原文）。',
        confidence: 0.85, level: 'rct' }],
    ['demo-e6', 'evidence', '体内因果证据：mtDNA 突变累积足以在哺乳动物中驱动早衰表型',
      'PolgA 校读域敲入小鼠（mtDNA mutator mouse）体内大量累积 mtDNA 突变并出现早衰表型——因果性地证明 mtDNA 完整性与功能对多细胞生物是硬需求。',
      {
        sourceRef: 'PMID: 15164064 · Nature 2004',
        sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/15164064/',
        detail: 'Trifunovic 等在 Nature 2004 报道的经典 mtDNA mutator 小鼠：敲除 PolgA 校读结构域后突变在小鼠体内大量累积，出现脱发、骨质疏松、心肌病等早衰表型——动物因果实验（animal）的标志性证据：维持一个功能完好的线粒体基因组是多细胞生命的硬需求（点击 PMID 打开原文）。',
        confidence: 0.9, level: 'animal' }],
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

  // ---- 边（17） ----
  const edges: [string, string, string][] = [
    ['demo-e1', 'demo-h1', 'supports'],
    ['demo-e2', 'demo-h1', 'supports'],
    ['demo-e2', 'demo-h2', 'supports'],
    ['demo-e4', 'demo-h2', 'supports'],
    ['demo-e3', 'demo-h1', 'contradicts'],
    ['demo-e5', 'demo-q1', 'relates'],
    ['demo-e6', 'demo-q1', 'relates'],
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

  // ---- narrative（结构对齐 SYNTHESIZER_PROMPT：现象与矛盾 → 证据链 → 推演 → 未解之谜 → 下一步建议） ----
  const narrative = lang === 'en' ? `## Phenomena & Contradictions
Roughly 2 billion years ago, an endosymbiosis let an α-proteobacterium take up residence inside a eukaryotic cell. Since then, most of its genes have relocated to the nuclear genome — yet to this day, mitochondria stubbornly keep a scrap of DNA. Transfer is mechanically feasible (successful cases exist), yet evolution never emptied it. This looks less like an oversight and more like a deliberately maintained residency.

## Evidence Chain
- **The hydrophobicity rule**: cross-eukaryotic comparison shows mtDNA-encoded proteins are on average far more hydrophobic than homologs that successfully relocated [PMID: 27135164]. Highly hydrophobic substrates can barely pass through the TOM/TIM import channel — the foundation of H1.
- **Translate where you insert**: mitochondrial ribosomes line the inner membrane, dedicated to translating the core hydrophobic OXPHOS subunits (COX1, CYTB…), coupling translation to insertion [co-translational insertion model]. This explains the other half of "why they must stay".
- **Exceptions are clues**: yeasts and other lineages have relocated part of their mitochondrial tRNAs to the nucleus — the hydrophobicity constraint does not bind RNA, so retention is not a single iron law but a coupled, multi-factor verdict.
- **Clinical echo**: nuclear–mitochondrial expression imbalance diseases (e.g. LHON) hint at the physiological weight of stoichiometric control [cohort, PMID: 3201231]; the idebenone RCT in LHON adds an interventional clinical counterpart [rct, PMID: 21788663], while the mtDNA mutator mouse causally proves in vivo that mtDNA integrity is vital [animal, PMID: 15164064].

## Reasoning
H1 (hydrophobicity constraint) has the thickest evidence, yet it cannot explain the retention of non-membrane-protein genes or cross-lineage variation; H2 (co-translational/stoichiometric control) complements rather than excludes H1. The strongest current picture: **hydrophobicity decides which genes cannot leave; local regulatory advantage decides which genes are not worth moving — two locks engaging at once**. H3 remains thinly evidenced.

## Open Questions
- Why do mtDNA loss rates differ by orders of magnitude across lineages?
- If COX1 hydrophobicity is artificially lowered (codon reprogramming), can it be nuclear-expressed and correctly assembled into the complex?

## Next Steps
Within a cross-lineage comparative-genomics framework, quantify the relative contributions of "retention propensity / hydrophobicity / regulatory demand"; and use COX1 reprogramming plus nuclear expression as the decisive discriminating experiment.` : `## 现象与矛盾
约 20 亿年前的一次内共生，让一类 α-变形菌住进了真核细胞。此后绝大多数基因陆续迁往核基因组——但直到今天，线粒体仍固执地保留着一小撮 DNA。迁移在机制上并非不可能（确有成功案例），演化却没有搬空它。这不是遗忘，更像一场被刻意维持的留守。

## 证据链
- **疏水性铁律**：跨真核生物的比较分析显示，mtDNA 编码蛋白的平均疏水性显著高于已成功迁核的同源基因 [PMID: 27135164]。高度疏水的底物几乎无法穿过 TOM/TIM 输入通道——这是 H1 的地基。
- **就近翻译**：线粒体核糖体贴近内膜排布，专职翻译 OXPHOS 复合体的核心疏水亚基（COX1、CYTB 等），实现翻译-插入耦联 [共翻译插入模型]。这解释了"为什么必须留"的另一半。
- **例外即线索**：酵母等谱系已把部分线粒体 tRNA 迁入核基因组——疏水性约束对 RNA 并不成立，说明留守不是单一铁律，而是多因素耦合的裁决。
- **临床回声**：核-线粒体基因表达失衡疾病（如 LHON）提示化学计量调控的生理分量 [cohort，PMID: 3201231]；idebenone 治疗 LHON 的随机对照试验给出临床干预层面的呼应 [rct，PMID: 21788663]；mtDNA mutator 小鼠则体内因果性地证明 mtDNA 完整性关乎个体健康 [animal，PMID: 15164064]。

## 推演
H1（疏水性约束）证据最厚，但解释不了非膜蛋白基因的留守与跨谱系差异；H2（共翻译/化学计量调控）与 H1 互补而非互斥。目前最强的画面是：**疏水性决定了"哪些基因不能走"，局部调控优势决定了"哪些基因不值得走"——两把锁同时咬合**。H3 证据尚薄。

## 未解之谜
- 为什么不同谱系的 mtDNA 丢失速率相差数量级？
- 若人工降低 COX1 疏水性（密码子重编程），它能否核表达并正确嵌入复合体？

## 下一步建议
在跨谱系比较基因组框架下，量化"留守倾向 / 疏水性 / 调控需求"三项的相对贡献；并以 COX1 重编程核表达实验作为决定性判据。`

  // ---- questions（3）+ 深研课题卡（Task 14：同步钉为金箔 topic 卡，与 runtime.syncTopicNodes 同构） ----
  const demoQuestions = lang === 'en' ? [
    {
      text: 'Which ecological or life-history variables predict cross-lineage variation in mitochondrial gene retention rates?',
      rationale: 'Extending static comparison into dynamic evolutionary-rate analysis tests the predictive power of the multi-factor model.',
      scores: { novelty: 4, feasibility: 4, impact: 3 },
      recommended: false,
      evidenceRefs: ['Cross-eukaryote comparison: mtDNA-encoded proteins are significantly more hydrophobic than homologs that successfully relocated to the nucleus'],
    },
    {
      text: 'Can codon-reprogrammed, de-hydrophobized COX1 achieve functional nuclear encoding and assembly?',
      rationale: 'The decisive experiment: directly tests whether hydrophobicity is a hard constraint, with synthetic-biology value on top.',
      scores: { novelty: 5, feasibility: 2, impact: 5 },
      recommended: true,
      evidenceRefs: ['Cross-eukaryote comparison: mtDNA-encoded proteins are significantly more hydrophobic than homologs that successfully relocated to the nucleus', 'If codon reprogramming lowers COX1 hydrophobicity, can it be nuclear-expressed and functionally assembled into Complex IV?'],
    },
    {
      text: 'How much faster is the redox-response kinetics of mitochondrial local translation than the nuclear pathway?',
      rationale: 'Quantifying the temporal advantage of H3 is key to distinguishing "worth keeping" from "must keep".',
      scores: { novelty: 3, feasibility: 4, impact: 4 },
      recommended: false,
      evidenceRefs: ['Mitochondrial ribosomes dock on the inner membrane, dedicated to translating highly hydrophobic core subunits like COX1/CYTB'],
    },
  ] : [
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
  ]
  replaceQuestions(sid, demoQuestions)

  // 深研课题卡：与 runtime.syncTopicNodes 同构的种子版本（按标题反查节点 id 后 derives 连线）
  const allNodes = listNodes(sid)
  const resolveByTitle = (refTitle: string): string | null =>
    allNodes.find((n) => n.title === refTitle)?.id ?? null
  demoQuestions.forEach((q, i) => {
    const scoresLine = lang === 'en'
      ? `novelty ${q.scores.novelty}/5 · feasibility ${q.scores.feasibility}/5 · impact ${q.scores.impact}/5`
      : `新颖 ${q.scores.novelty}/5 · 可行 ${q.scores.feasibility}/5 · 影响 ${q.scores.impact}/5`
    const tags = lang === 'en'
      ? [`Nov ${q.scores.novelty}`, `Fea ${q.scores.feasibility}`, `Imp ${q.scores.impact}`]
      : [`新颖 ${q.scores.novelty}`, `可行 ${q.scores.feasibility}`, `影响 ${q.scores.impact}`]
    const detail = [
      `${lang === 'en' ? 'Full question' : '完整问题'}：${q.text}`,
      `${lang === 'en' ? 'Scores' : '评分'}：${scoresLine}${q.recommended ? (lang === 'en' ? ' · ⭐ recommended' : ' · ⭐ 推荐深挖') : ''}`,
      '',
      `${lang === 'en' ? 'Why it matters' : '为何值得研究'}：${q.rationale}`,
    ].join('\n')
    const topicNode = insertNode(sid, {
      id: nid(`demo-t${i + 1}`),
      kind: 'topic',
      title: q.text.slice(0, 60),
      content: q.rationale.slice(0, 400),
      detail,
      tags,
      starred: !!q.recommended,
      pinnedBy: 'agent',
    })
    for (const ref of (q.evidenceRefs || []).slice(0, 4)) {
      const targetId = resolveByTitle(String(ref))
      if (targetId && targetId !== topicNode.id) insertEdge(sid, topicNode.id, targetId, 'derives', null)
    }
  })

  // ---- 消息 ----
  insertMessage(sid, {
    role: 'system',
    kind: 'notice',
    content: lang === 'en'
      ? 'Demo project loaded — click “Continue Research” to let the agent build on it, or start your own project'
      : '示例课题已载入 · 点击「继续研究」可让 Agent 基于此课题继续自主研究，或新建属于你的课题',
  })

  // ---- 会话元信息 ----
  const budget = { ...defaultBudget(), stepsUsed: 27, toolCalls: 31, llmCalls: 18, round: 1, elapsedMs: 8 * 60_000, startedAt: null }
  const meta = {
    ...defaultMeta(),
    ready: true,
    lang,
    title_suggestion: lang === 'en' ? 'Why Mitochondria Keep Their Own Genome' : '线粒体基因组的留守之谜',
    pendingQuestion: null,
  }
  updateSessionFields(sid, {
    title: lang === 'en' ? 'Demo · Why Mitochondria Keep Their Own Genome' : '示例课题 · 线粒体基因组的留守之谜',
    phase: 'done',
    status: 'idle',
    narrative,
    meta: JSON.stringify(meta),
    budget: JSON.stringify(budget),
  })

  return sid
}
