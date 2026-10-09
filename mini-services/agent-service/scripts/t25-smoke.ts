// Task 25 冒烟测试：batch_cards 批量落墙 / 课题卡同题吸收（kind 升格）/ 同源合并防线在 batch 路径下仍生效
import {
  createSession, deleteSession, listNodes, listEdges, updateNode,
} from '../src/db'
import { AgentRuntime } from '../src/runtime'

let pass = 0
let fail = 0
const t = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const sid = createSession('t25-smoke-batch-absorb', 'zh').id
const rt = AgentRuntime.get(sid) as any
try {
  // ---- 1. batch_cards：一次 2 张卡 + 1 条连线 ----
  console.log('[1] batch_cards')
  const r1 = rt.toolBatchCards({
    cards: [
      { kind: 'evidence', title: 'PURE 队列：高饱和脂肪摄入与死亡率负相关', content: '18 国 135,335 人前瞻队列', sourceRef: 'PMID:28864332', level: 'cohort', detail: ' PURE 研究。' },
      { kind: 'source', title: '2020 WHO 饱和脂肪摄入指南', content: '建议成人饱和脂肪供能比 <10%', sourceRef: 'DOI:10.1111/nbu.12371', level: 'cohort' },
    ],
    links: [{ from: 'PURE 队列：高饱和脂肪摄入与死亡率负相关', to: '核心问题', relation: 'relates' }],
  })
  t('返回 ok + pinned=2', r1?.ok === true && r1.pinned === 2)
  t('返回 linked=1（relates 连线成功，核心问题未找到则 0）', r1.linked === 1 || r1.linked === 0)
  const nodes1 = listNodes(sid)
  t('墙上出现 2 张新卡（1 evidence + 1 source）', nodes1.filter((n: any) => n.kind === 'evidence').length === 1 && nodes1.filter((n: any) => n.kind === 'source').length === 1)
  const ev = nodes1.find((n: any) => n.kind === 'evidence')!
  t('evidence 卡 level=cohort 保留', ev.level === 'cohort')
  t('evidence 卡 sourceRef 落库', ev.sourceRef === 'PMID:28864332')

  // ---- 2. batch 路径同源合并：同 PMID 换标题重钉 → merged ----
  console.log('[2] batch_cards 同源合并')
  const r2 = rt.toolBatchCards({
    cards: [
      { kind: 'evidence', title: 'PURE 研究（Dehghan 2017）', content: '同一 PURE 文献的另一个标题', sourceRef: 'PMID:28864332', level: 'cohort' },
    ],
  })
  t('同 PMID 第二张卡被合并（merged=1）', r2?.ok === true && r2.merged === 1)
  t('墙上仍只有 1 张 evidence 卡', listNodes(sid).filter((n: any) => n.kind === 'evidence').length === 1)

  // ---- 3. 课题卡同题吸收：先落一张同题 hypothesis 卡，再 syncTopicNodes ----
  console.log('[3] 课题卡同题吸收')
  const HYP = '乳制品来源饱和脂肪为何表现为中性或保护性'
  rt.toolAddEvidence({ kind: 'hypothesis', title: HYP, content: '乳制品矩阵（钙/发酵/脂质组）可能抵消 SFA 升 LDL 效应' })
  rt.toolLinkEvidence({ from: 'PURE 队列：高饱和脂肪摄入与死亡率负相关', to: HYP, relation: 'supports' })
  rt.syncTopicNodes([{
    text: HYP,
    rationale: 'PURE 队列证据与脂质假说矛盾',
    scores: { novelty: 4, feasibility: 4, impact: 4 },
    recommended: true,
    evidenceRefs: ['PURE 队列：高饱和脂肪摄入与死亡率负相关'],
  }], false)
  const nodes3 = listNodes(sid)
  const sameTitled = nodes3.filter((n: any) => n.title === HYP)
  t('同题卡唯一（不再双卡并存）', sameTitled.length === 1)
  t('该卡已升格 kind=topic', sameTitled[0]?.kind === 'topic')
  t('升格卡 starred=true', sameTitled[0]?.starred === true || sameTitled[0]?.starred === 1)
  const edgeTo = listEdges(sid).filter((e: any) => e.target === sameTitled[0]?.id || e.source === sameTitled[0]?.id)
  t('原连线保留（supports 边指向升格卡）', edgeTo.length >= 1)
  const derives = listEdges(sid).filter((e: any) => e.relation === 'derives' && e.source === sameTitled[0]?.id)
  t('课题卡 derives 连线到支撑证据', derives.length >= 1)

  // ---- 4. 二轮 sync：同题保留 id（吸收后按 topic upsert 幂等） ----
  console.log('[4] 二轮 sync 幂等')
  const idBefore = sameTitled[0]?.id
  rt.syncTopicNodes([{
    text: HYP,
    rationale: '更新后的理由',
    scores: { novelty: 5, feasibility: 3, impact: 4 },
    recommended: false,
    evidenceRefs: [],
  }], false)
  const nodes4 = listNodes(sid)
  const still = nodes4.filter((n: any) => n.title === HYP)
  t('二轮 sync 仍唯一且保留 id', still.length === 1 && still[0]?.id === idBefore)
  t('陈旧课题清理不影响吸收卡（本轮仍在问题集）', nodes4.filter((n: any) => n.kind === 'topic').length === 1)

  // ---- 5. updateNode kind 非法值不生效 ----
  console.log('[5] kind 升格防注入')
  updateNode(sid, idBefore, { kind: 'nonsense' as any })
  t('非法 kind 被忽略', listNodes(sid).find((n: any) => n.id === idBefore)?.kind === 'topic')

  console.log(`\n结果: ${pass} passed, ${fail} failed`)
} finally {
  AgentRuntime.dispose(sid)
  deleteSession(sid)
  process.exit(fail > 0 ? 1 : 0)
}
