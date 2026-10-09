// Task 31 单元验证：①密度守护挂到步数上限收口窗口（P1-①，三场景）②末段任务饥饿跳过（P1-②）
// ③investigator prompt fullText 利用度指引（P2-③）④检索计数统一口径（含 clinvar）
import {
  createSession, deleteSession, savePlan, getBudget, saveBudget,
  listNodes, listTaskRecords, listActivity, type Plan, type Budget,
} from '../src/db'
import { AgentRuntime } from '../src/runtime'
import { buildInvestigatorPrompt } from '../src/prompts'

let pass = 0
let fail = 0
const t = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const mkTask = (id: string, goal: string, done = false, summary = '') =>
  ({ id, goal, why: 'w', queries: [], toolsHint: [], expectedEvidence: '', done, summary })

const freshBudget = (maxSteps: number, stepsUsed: number): Budget => ({
  maxSteps, maxMinutes: 30, stepsUsed, toolCalls: 0, llmCalls: 0, startedAt: null, round: 1, elapsedMs: 0,
})

// 检索工具桩：pubmed_search 返回中性假观察（无方向词 → 不误触矛盾自检）；图操作走真实实现
const stubSearches = (rt: any) => {
  const orig = rt.runTool.bind(rt)
  rt.runTool = async (tool: string, args: any, step: number) =>
    tool === 'pubmed_search' ? 'FAKE_RESULT: 3 条测试条目（桩）' : orig(tool, args, step)
}

// 场景 A：主窗口 9 检索 + 1 卡 → 窗口密度督促 → batch_cards 补 3 → fallback 收口 pinned=4
{
  console.log('[1] 密度守护挂到步数上限收口窗口（P1-①）')
  const sid = createSession('t31-density-a', 'zh').id
  const rt = AgentRuntime.get(sid) as any
  savePlan(sid, { round: 1, focusQuestion: 'F', hypotheses: [], tasks: [mkTask('t1', '阿司匹林一级预防试验证据')] } as Plan)
  saveBudget(sid, freshBudget(48, 0))

  const script: Array<{ thought: string; action: { tool: string; args: any } }> = []
  for (let i = 0; i < 9; i++) script.push({ thought: `第 ${i + 1} 轮试验检索`, action: { tool: 'pubmed_search', args: { query: `aspirin trial ${i}` } } })
  script.push({ thought: '先落一张已确认的事实卡', action: { tool: 'add_evidence', args: {
    kind: 'evidence', title: 'ARRIVE 主要终点事件数对比', content: '事件数数据', level: 'rct', sourceRef: 'PMID:30146997',
  } } })
  script.push({ thought: '收到密度督促，批量补落剩余关键事实', action: { tool: 'batch_cards', args: { cards: [
    { kind: 'evidence', title: 'ASCEND 复合终点事件数对比', content: '事件数数据', level: 'rct', sourceRef: 'PMID:30146998' },
    { kind: 'evidence', title: 'ASPREE 全因死亡事件数对比', content: '事件数数据', level: 'rct', sourceRef: 'PMID:31495813' },
    { kind: 'evidence', title: '一级预防出血事件 Meta 分析', content: '事件数数据', level: 'cohort', sourceRef: 'PMID:2' },
  ] } } })
  let idx = 0
  rt.callInvestigator = async () => {
    const s = script[idx++] ?? { thought: '兜底收尾', action: { tool: 'finish_task', args: { summary: '兜底' } } }
    return { ok: true, thought: s.thought, action: s.action }
  }
  stubSearches(rt)

  await rt.investigate(mkTask('t1', '阿司匹林一级预防试验证据'))

  const acts = listActivity(sid).map((a) => a.summary)
  t('A1 收口窗口密度守护通知发出', acts.some((s) => s.includes('密度守护（收口窗口）')))
  t('A2 通知含具体数字（9 次检索仅钉 1 张卡）', acts.some((s) => s.includes('9 次检索仅钉 1 张卡')))
  const recs = listTaskRecords(sid)
  t('A3 任务历史 pinned=4（1 张 + 督促后补 3 张）', recs[0]?.pinned === 4)
  t('A4 任务历史 searches=9', recs[0]?.searches === 9)
  t('A5 fallback 轨迹小结含「钉卡 4 张」', (recs[0]?.summary || '').includes('钉卡 4 张'))
  t('A6 全局 stepsUsed 只计检索（9）——窗口/落墙零计费', getBudget(sid).stepsUsed === 9)
  t('A7 墙上 4 张 evidence 卡', listNodes(sid).filter((n) => n.kind === 'evidence').length === 4)
  deleteSession(sid)
}

// 场景 B：零卡 + 模型无视两次督促 → 落墙守护（窗口）→ 密度守护（finish_task 分支）级联，各自仅一次
{
  console.log('[2] 零卡级联：窗口落墙守护 → finish_task 分支密度守护')
  const sid = createSession('t31-density-b', 'zh').id
  const rt = AgentRuntime.get(sid) as any
  savePlan(sid, { round: 1, focusQuestion: 'F', hypotheses: [], tasks: [mkTask('t2', '阿司匹林出血风险检索')] } as Plan)
  saveBudget(sid, freshBudget(48, 0))

  const script: Array<{ thought: string; action: { tool: string; args: any } }> = []
  for (let i = 0; i < 10; i++) script.push({ thought: `第 ${i + 1} 轮检索`, action: { tool: 'pubmed_search', args: { query: `bleeding ${i}` } } })
  script.push({ thought: '摸底完成，直接收官', action: { tool: 'finish_task', args: { summary: '摸底型任务：已确认检索结论，无需落卡' } } })
  script.push({ thought: '再次收官', action: { tool: 'finish_task', args: { summary: '摸底型任务：已确认检索结论，无需落卡' } } })
  let idx = 0
  rt.callInvestigator = async () => {
    const s = script[idx++] ?? { thought: '兜底', action: { tool: 'finish_task', args: { summary: '兜底' } } }
    return { ok: true, thought: s.thought, action: s.action }
  }
  stubSearches(rt)

  await rt.investigate(mkTask('t2', '阿司匹林出血风险检索'))

  const acts = listActivity(sid).map((a) => a.summary)
  t('B1 窗口落墙守护通知发出（步数达到上限）', acts.some((s) => s.includes('落墙守护：步数达到上限')))
  t('B2 finish_task 分支密度守护通知发出', acts.some((s) => s.includes('密度守护：本任务 10 次检索仅钉 0 张卡')))
  t('B3 两级督促各仅一次（密度通知不重复）', acts.filter((s) => s.includes('密度守护')).length === 1)
  const recs = listTaskRecords(sid)
  t('B4 二次 finish_task 直接过（模型 summary 保留）', recs[0]?.summary === '摸底型任务：已确认检索结论，无需落卡')
  t('B5 pinned=0 / searches=10 如实记录', recs[0]?.pinned === 0 && recs[0]?.searches === 10)
  t('B6 stepsUsed=10（仅检索计费）', getBudget(sid).stepsUsed === 10)
  deleteSession(sid)
}

// 场景 C：零卡但预算余量 <3（抢救不接管）→ 窗口密度督促兜底（落墙免计费，无需余量）
{
  console.log('[3] 低余量兜底：密度督促在抢救不可用时接管')
  const sid = createSession('t31-density-c', 'zh').id
  const rt = AgentRuntime.get(sid) as any
  savePlan(sid, { round: 1, focusQuestion: 'F', hypotheses: [], tasks: [mkTask('t3', '低余量任务')] } as Plan)
  saveBudget(sid, freshBudget(12, 0)) // 10 次检索后余量 2 < 3：needsEvidenceRescue 不接管

  const script: Array<{ thought: string; action: { tool: string; args: any } }> = []
  for (let i = 0; i < 10; i++) script.push({ thought: `第 ${i + 1} 轮检索`, action: { tool: 'pubmed_search', args: { query: `q ${i}` } } })
  script.push({ thought: '收到密度督促，补落三张卡', action: { tool: 'batch_cards', args: { cards: [
    { kind: 'evidence', title: '条目一事件数对比', content: '数据', level: 'rct', sourceRef: 'PMID:11' },
    { kind: 'evidence', title: '条目二事件数对比', content: '数据', level: 'rct', sourceRef: 'PMID:22' },
    { kind: 'evidence', title: '条目三事件数对比', content: '数据', level: 'cohort', sourceRef: 'PMID:33' },
  ] } } })
  let idx = 0
  rt.callInvestigator = async () => {
    const s = script[idx++] ?? { thought: '兜底', action: { tool: 'finish_task', args: { summary: '兜底' } } }
    return { ok: true, thought: s.thought, action: s.action }
  }
  stubSearches(rt)

  await rt.investigate(mkTask('t3', '低余量任务'))

  const acts = listActivity(sid).map((a) => a.summary)
  t('C1 余量 <3 时密度督促（收口窗口）兜底触发', acts.some((s) => s.includes('密度守护（收口窗口）') && s.includes('10 次检索仅钉 0 张卡')))
  t('C2 补落 3 张卡（落墙免计费不受余量限制）', listTaskRecords(sid)[0]?.pinned === 3)
  t('C3 stepsUsed=10（batch_cards 零计费）', getBudget(sid).stepsUsed === 10)
  t('C4 轨迹小结含「钉卡 3 张」', (listTaskRecords(sid)[0]?.summary || '').includes('钉卡 3 张'))
  deleteSession(sid)
}

// ---------- [4] 末段任务饥饿跳过（P1-②） ----------
{
  console.log('[4] 末段任务饥饿跳过')
  const sid = createSession('t31-starve', 'zh').id
  const rt = AgentRuntime.get(sid) as any
  const plan: Plan = {
    round: 1, focusQuestion: 'F', hypotheses: [],
    tasks: [mkTask('t1', '已完成任务', true, '小结'), mkTask('t2', '未启动任务A'), mkTask('t3', '未启动任务B')],
  }
  rt.callPlanner = async () => plan
  rt.callSynthesizer = async () => null
  saveBudget(sid, freshBudget(6, 4)) // 剩余 2 < 4：不启动
  let investigateCalled = 0
  rt.investigate = async () => { investigateCalled++ }
  const reason = await rt.mainLoop('focus')
  t('D1 剩余 <4 步返回 budget（进最终综合）', reason === 'budget')
  t('D2 investigate 未被调用（饥饿跳过）', investigateCalled === 0)
  const acts = listActivity(sid).map((a) => a.summary)
  t('D3 饥饿通知点名 2 个未启动任务', acts.some((s) => s.includes('2 个任务未启动') && s.includes('未启动任务A') && s.includes('未启动任务B')))
  t('D4 通知说明最小闭环需 ≥4 步', acts.some((s) => s.includes('≥4 步')))

  // 边界：剩余恰好 4 步 → 正常启动（investigate 被调用一次）
  const sid2 = createSession('t31-starve-boundary', 'zh').id
  const rt2 = AgentRuntime.get(sid2) as any
  const plan2: Plan = { round: 1, focusQuestion: 'F', hypotheses: [], tasks: [mkTask('t1', '任务一')] }
  rt2.callPlanner = async () => plan2
  rt2.callSynthesizer = async () => null
  saveBudget(sid2, freshBudget(8, 4)) // 剩余 4：可启动
  let called2 = 0
  rt2.investigate = async (task: any) => { called2++; task.done = true }
  const reason2 = await rt2.mainLoop('focus')
  t('D5 剩余恰 4 步正常启动（investigate 调用 1 次）', called2 === 1)
  t('D6 无饥饿通知（边界会话）', !listActivity(sid2).some((a) => a.summary.includes('个任务未启动')))
  t('D7 边界会话正常收官（completed）', reason2 === 'completed')
  deleteSession(sid); deleteSession(sid2)
}

// ---------- [5] fullText 利用度指引（P2-③） ----------
{
  console.log('[5] investigator prompt fullText 指引')
  const prompt = buildInvestigatorPrompt({
    goal: 'g', why: 'w', wallSummary: '', narrative: '', steering: '',
    toolsDoc: '(tools)', remainingSteps: 10, remainingMinutes: 10,
  })
  t('E1 prompt 声明 fullText 为全文节选', prompt.includes('fullText') && prompt.includes('全文节选'))
  t('E2 指引优先引用具体数据（剂量/亚组/效应量）', prompt.includes('亚组') && prompt.includes('效应量'))
}

// ---------- [6] 检索计数统一口径（含 clinvar） ----------
{
  console.log('[6] countSearchActions 统一口径')
  const sid = createSession('t31-count', 'zh').id
  const rt = AgentRuntime.get(sid) as any
  const sum = rt.composeFallbackSummary([
    { thought: 'clinvar 检索变异注释条目', action: { tool: 'clinvar_search', args: {} }, observation: '' },
    { thought: '落一张卡', action: { tool: 'add_evidence', args: {} }, observation: '' },
  ], new Set()) as string
  t('F1 clinvar_search 计入检索口径（1 次检索/精读）', sum.includes('1 次检索/精读'))
  t('F2 图操作不计检索（add_evidence 不出现在计数）', !sum.includes('2 次检索/精读'))
  deleteSession(sid)
}

console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
