// Task 30 单元验证：①跨轮任务历史（task_records） ②fallback 末段判断非策略性 ③pubmed_fetch 全文降级链
import {
  createSession, deleteSession, listNodes, listTaskRecords, insertTaskRecord,
  savePlan, type Plan,
} from '../src/db'
import { AgentRuntime, stateSnapshot } from '../src/runtime'
import { findExternalTool } from '../src/tools'

let pass = 0
let fail = 0
const t = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const sid = createSession('t30-verify', 'zh').id
const rt = AgentRuntime.get(sid) as any

const mkTask = (id: string, goal: string, summary = '') =>
  ({ id, goal, why: 'w', queries: [], toolsHint: [], expectedEvidence: '', done: true, summary })

try {
  // ---------- [1] 跨轮任务历史（P1-①） ----------
  console.log('[1] task_records 跨轮任务历史')
  const plan: Plan = { round: 2, focusQuestion: 'F', hypotheses: [], tasks: [mkTask('t1', '第二轮任务')] }
  savePlan(sid, plan)

  // 1a. recordClosedTask：pinned / searches / round 计算
  const nodesBefore = new Set(listNodes(sid).map((n) => n.id))
  rt.toolAddEvidence({ kind: 'evidence', title: 'HDL与冠心病观察性保护关联', content: 'RR 0.7', level: 'cohort', sourceRef: 'PMID:1' })
  rt.toolAddEvidence({ kind: 'source', title: 'Voight 2012 MR 综述源', content: 'CETP 变异工具变量', level: 'cohort' })
  rt.toolAddEvidence({ kind: 'hypothesis', title: 'HDL因果假说', content: 'HDL 或非因果' })
  rt.recordClosedTask(mkTask('t1', '检索 HDL 与冠心病证据', '小结 v1'), [
    { thought: 'x', action: { tool: 'pubmed_search', args: {} }, observation: '' },
    { thought: 'x', action: { tool: 'pubmed_fetch', args: {} }, observation: '' },
    { thought: 'x', action: { tool: 'web_read', args: {} }, observation: '' },
    { thought: 'x', action: { tool: 'add_evidence', args: {} }, observation: '' }, // 图操作不计检索
  ], nodesBefore)
  let recs = listTaskRecords(sid)
  t('闭环落库 1 条', recs.length === 1)
  t('round 取自当前 plan（2）', recs[0]?.round === 2)
  t('pinned=2（evidence+source，假说不计）', recs[0]?.pinned === 2)
  t('searches=3（检索/精读，图操作不计）', recs[0]?.searches === 3)
  t('summary 落库', recs[0]?.summary === '小结 v1')

  // 1b. 幂等：同 session+round+task_id 重收口 → 更新而非重复
  rt.recordClosedTask(mkTask('t1', '检索 HDL 与冠心病证据', '小结 v2（补落两卡后更新）'), [], new Set(listNodes(sid).map((n) => n.id)))
  recs = listTaskRecords(sid)
  t('重收口不产生重复（仍 1 条）', recs.length === 1)
  t('重收口覆盖 summary', recs[0]?.summary === '小结 v2（补落两卡后更新）')
  t('重收口 pinned 重算为 0（无新卡）', recs[0]?.pinned === 0)

  // 1c. 跨轮：同 task_id 不同 round → 独立记录（LLM 每轮重新生成 t1/t2 编号）
  insertTaskRecord(sid, { taskId: 't1', round: 1, goal: '第一轮摸底任务', why: '', summary: '首轮小结', pinned: 3, searches: 4 })
  recs = listTaskRecords(sid)
  t('跨轮同 id 各自成记录（2 条）', recs.length === 2)
  t('按 round 升序排列（R1 在前）', recs[0]?.round === 1 && recs[1]?.round === 2)

  // 1d. 截断防线：goal>300 / summary>400
  insertTaskRecord(sid, { taskId: 't9', round: 3, goal: '长'.repeat(400), why: '', summary: 's'.repeat(500), pinned: 0, searches: 0 })
  const rec9 = listTaskRecords(sid).find((r) => r.taskId === 't9')
  t('goal 截断 ≤300', (rec9?.goal.length ?? 999) <= 300)
  t('summary 截断 ≤400', (rec9?.summary.length ?? 999) <= 400)

  // 1e. stateSnapshot 携带 taskHistory（SSE state 事件 / persistStep 广播链路）
  const snap = stateSnapshot(sid) as Record<string, unknown>
  t('stateSnapshot 含 taskHistory 且条数一致', Array.isArray(snap.taskHistory) && (snap.taskHistory as unknown[]).length === 3)

  // 1f. 空会话零历史不报错
  const sidEmpty = createSession('t30-empty', 'zh').id
  t('空会话 listTaskRecords=[]', listTaskRecords(sidEmpty).length === 0)
  deleteSession(sidEmpty)

  // ---------- [2] fallback 末段判断非策略性（P2-③） ----------
  console.log('[2] fallback 末段判断排除策略性文本')
  const padStrategy = [
    { thought: 'Voight MR 116320 人显示 HDL 升高不降 MI 风险', action: { tool: 'pubmed_search', args: {} }, observation: '' },
    { thought: '我需要调整检索策略', action: { tool: 'pubmed_search', args: {} }, observation: '' },
    { thought: '换个关键词重新检索', action: { tool: 'europepmc_search', args: {} }, observation: '' },
  ]
  const sumS = rt.composeFallbackSummary(padStrategy, new Set()) as string
  t('跳过策略性末段、取更早科学判断', sumS.includes('末段判断：Voight MR'))

  const padAllStrategy = [
    { thought: '换词重试一次', action: { tool: 'pubmed_search', args: {} }, observation: '' },
    { thought: '重新检索试试', action: { tool: 'pubmed_search', args: {} }, observation: '' },
  ]
  const sumAll = rt.composeFallbackSummary(padAllStrategy, new Set()) as string
  t('全为策略性时退回最后一个有效 thought（不空）', sumAll.includes('末段判断：重新检索试试'))

  const sidEn = createSession('t30-verify-en', 'en').id
  const rtEn = AgentRuntime.get(sidEn) as any
  const sumEn = rtEn.composeFallbackSummary([
    { thought: 'torcetrapib raised HDL 60% yet raised CV events', action: { tool: 'pubmed_fetch', args: {} }, observation: '' },
    { thought: 'I need to adjust my search strategy', action: { tool: 'pubmed_search', args: {} }, observation: '' },
  ], new Set()) as string
  t('英文策略性 thought 同样被跳过', sumEn.includes('last assessment: torcetrapib'))
  deleteSession(sidEn)

  // ---------- [3] pubmed_fetch 全文降级链（P1-②，真实网络） ----------
  console.log('[3] pubmed_fetch 全文降级链（EuropePMC OA）')
  const fetchTool = findExternalTool('pubmed_fetch')!
  // 3a. 先用 europepmc_search 自选出本域 OA 文献（避免硬编码 PMID 的开放状态漂移）
  const epmc = findExternalTool('europepmc_search')!
  const oa = await epmc.run({ query: 'OPEN_ACCESS:y AND (high density lipoprotein AND mendelian randomization)', max: 8 }) as any
  const oaPmids = (oa?.results || []).filter((r: any) => r.pmid && r.openAccess).map((r: any) => String(r.pmid)).slice(0, 3)
  t('EuropePMC 自选出 ≥1 篇 OA 文献（PMID）', oaPmids.length >= 1)
  console.log(`    OA PMIDs: ${oaPmids.join(', ')}`)
  if (oaPmids.length) {
    const r1 = await fetchTool.run({ pmids: oaPmids }) as any
    t('articles 正常返回', Array.isArray(r1?.articles) && r1.articles.length === oaPmids.length)
    t('note 字段存在', typeof r1?.note === 'string' && r1.note.length > 0)
    const withFull = (r1?.articles || []).filter((a: any) => typeof a.fullText === 'string' && a.fullText.length > 80)
    console.log(`    fullText 补齐: ${withFull.length}/${oaPmids.length}`)
    t('OA 目标至少 1 篇补齐 fullText（≤1200 字）', withFull.length >= 1 && withFull.every((a: any) => a.fullText.length <= 1200))
    t('摘要仍保留（abstract 字段）', (r1?.articles || []).every((a: any) => typeof a.abstract === 'string'))
  }

  // 3b. 非 OA 经典文献：降级不崩、note 给出 web_read 建议路径
  const r2 = await fetchTool.run({ pmids: ['12117397'] }) as any // WHI 主报告（JAMA，闭源）
  t('非 OA 文章不崩、articles 返回', Array.isArray(r2?.articles) && r2.articles.length === 1 && r2.articles[0].pmid === '12117397')
  const note2 = String(r2?.note || '')
  t('降级 note 指向 web_read 替代路径', note2.includes('web_read'))
  t('非 OA 不伪造 fullText', !r2?.articles?.[0]?.fullText)

  // 3c. 工具文档已更新（模型侧可见降级语义）
  const doc = (await import('../src/tools')).toolsDoc(false)
  t('toolsDoc 声明 fullText 自动补齐', doc.includes('fullText'))
} finally {
  deleteSession(sid)
}

console.log(`\n结果: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
