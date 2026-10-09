// Task 29 单元验证：①fallback 轨迹小结 ②contradicts 反向去重 ③MR 自动标签 ④活动日志分页
import { createSession, deleteSession, insertActivity, listActivityPage, listEdges, findNodeByTitle } from '../src/db'
import { AgentRuntime } from '../src/runtime'

let pass = 0
let fail = 0
const t = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const sid = createSession('t29-verify', 'zh').id
const rt = AgentRuntime.get(sid) as any

try {
  // ---------- [1] composeFallbackSummary ----------
  console.log('[1] fallback 轨迹小结（P1-①）')
  // 场景 A：任务内钉 2 张卡 + 1 张假说 + 3 次检索 + 末段思路 → 摘要含全部要素
  const nodesBefore = new Set((await import('../src/db')).listNodes(sid).map((n) => n.id))
  rt.toolAddEvidence({ kind: 'evidence', title: 'WHI试验冠心病风险升高', content: 'HR 1.29', level: 'rct', sourceRef: 'PMID:12117397' })
  rt.toolAddEvidence({ kind: 'evidence', title: '护士健康研究风险下降', content: 'RR 0.6', level: 'cohort' })
  rt.toolAddEvidence({ kind: 'hypothesis', title: '时间窗假说', content: '绝经10年内启动或获益' })
  const pad = [
    { thought: '先检索 WHI 试验', action: { tool: 'pubmed_search', args: {} }, observation: '...' },
    { thought: '', action: { tool: 'pubmed_fetch', args: {} }, observation: '...' },
    { thought: '再检索队列', action: { tool: 'openalex_search', args: {} }, observation: '...' },
    { thought: '步数达到上限，任务收尾自检：证据墙未新增卡片', action: { tool: '__step_cap__', args: {} }, observation: 'SYSTEM: ...' },
    { thought: '总体判断：RCT 与队列结论相反，时间窗可能是调和点', action: { tool: 'add_evidence', args: {} }, observation: 'ok' },
  ]
  const sumA = rt.composeFallbackSummary(pad, nodesBefore) as string
  t('包含钉卡数（2 张）', sumA.includes('钉卡 2 张'))
  t('包含钉卡标题（截断到 30 字内）', sumA.includes('WHI试验冠心病风险升高') && sumA.includes('护士健康研究风险下降'))
  t('包含假说/空白计数', sumA.includes('1 张假说/空白卡'))
  t('包含检索次数（3 次）', sumA.includes('3 次检索/精读'))
  t('包含末段判断（排除 __step_cap__ 注入条目）', sumA.includes('末段判断：总体判断：RCT 与队列结论相反'))
  t('含步数上限标记', sumA.startsWith('（步数上限收口）'))
  t('长度 ≤400', sumA.length <= 400)

  // 场景 B：空 scratchpad 无钉卡 → 兜底文案
  const sumB = rt.composeFallbackSummary([], new Set((await import('../src/db')).listNodes(sid).map((n) => n.id)))
  t('空场景兜底文案', sumB.includes('无落墙成果'))

  // 场景 C：英文会话
  const sidEn = createSession('t29-verify-en', 'en').id
  const rtEn = AgentRuntime.get(sidEn) as any
  const sumC = rtEn.composeFallbackSummary(
    [{ thought: 'final judgment: benefit confined to early menopause', action: { tool: 'pubmed_search', args: {} }, observation: 'x' }],
    new Set((await import('../src/db')).listNodes(sidEn).map((n) => n.id))
  ) as string
  t('英文会话输出英文小结', sumC.startsWith('(closed at step cap)') && sumC.includes('last assessment:'))
  deleteSession(sidEn)

  // ---------- [2] contradicts 反向去重 ----------
  console.log('[2] contradicts 反向去重（P1-②）')
  const r1 = rt.toolLinkEvidence({ from: 'WHI试验冠心病风险升高', to: '护士健康研究风险下降', relation: 'contradicts' })
  t('正向首连成功', r1?.ok === true && !r1?.deduped)
  const r2 = rt.toolLinkEvidence({ from: '护士健康研究风险下降', to: 'WHI试验冠心病风险升高', relation: 'contradicts', label: 'RCT危害 vs 队列获益' })
  t('反向重连返回 deduped+reversed', r2?.ok === true && r2?.deduped === true && r2?.reversed === true)
  const ce = listEdges(sid).filter((e) => e.relation === 'contradicts')
  t('边数仍为 1（无平行双线）', ce.length === 1)
  t('反向带来的 label 已补写', ce[0].label === 'RCT危害 vs 队列获益')
  const r3 = rt.toolLinkEvidence({ from: '护士健康研究风险下降', to: 'WHI试验冠心病风险升高', relation: 'supports' })
  t('非对称关系不受影响（supports 反向照常新建）', r3?.ok === true && !r3?.deduped)

  // ---------- [3] MR 自动标签 ----------
  console.log('[3] MR 语义自动标签（P2-④）')
  rt.toolAddEvidence({ kind: 'evidence', title: 'ALDH2工具变量与卒中风险', content: 'Mendelian randomization 50万人线性关联', level: 'cohort', sourceRef: 'PMID:30959937' })
  const mrNode = findNodeByTitle(sid, 'ALDH2工具变量与卒中风险')
  t('MR 文本卡自动补 MR 标签', !!mrNode?.tags?.includes('MR'))
  rt.toolAddEvidence({ kind: 'evidence', title: '常规前瞻性队列结局', content: 'prospective cohort follow-up 10y', level: 'cohort' })
  const plainNode = findNodeByTitle(sid, '常规前瞻性队列结局')
  t('普通队列卡不加 MR 标签', !plainNode?.tags?.some((x) => /^mr$/i.test(x)))
  rt.toolAddEvidence({ kind: 'hypothesis', title: '孟德尔随机化验证因果的假说', content: 'Mendelian randomization 支持因果' })
  const hypNode = findNodeByTitle(sid, '孟德尔随机化验证因果的假说')
  t('假说卡不加 MR 标签（仅 evidence/source）', !hypNode?.tags?.includes('MR'))

  // ---------- [4] 活动日志分页 ----------
  console.log('[4] 活动日志分页（P1-③）')
  // 已有若干条活动（前面操作产生的）——补齐到 >12 条
  for (let i = 0; i < 20; i++) insertActivity(sid, { type: 'notice', summary: `filler-${i}` })
  const page1 = listActivityPage(sid, null, 10)
  t('首页返回 10 条（ASC 序）', page1.events.length === 10)
  t('首页 hasMore=true', page1.hasMore === true)
  t('total 正确（≥30）', page1.total >= 30)
  const oldest = page1.events[0].id
  const page2 = listActivityPage(sid, oldest, 10)
  t('第二页全部早于游标', page2.events.every((e) => e.id < oldest))
  t('第二页与首页无重叠', !page2.events.some((e) => e.id >= oldest))
  // 翻到最底：从头取 total 条 → hasMore=false
  const all = listActivityPage(sid, null, 1000)
  t('全量取出后 hasMore=false', all.hasMore === false)
  t('全量条数 = total', all.events.length === all.total)
  // 空 before 返回最新页（ DESC limit 后 reverse → 最新 10 条）
  const newest = all.events[all.events.length - 1]
  t('首页含最新一条', page1.events[page1.events.length - 1].id === newest.id)
} finally {
  deleteSession(sid)
}

console.log(`\n结果: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
