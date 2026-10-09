// Task 30 E2E 驱动（分段执行防后台进程回收）：bun scripts/t30-e2e.ts interview | poll
// 第十三领域：HDL「好胆固醇」悖论——观察性保护关联（Framingham 等） vs MR 空因果（Voight 2012 CETP） vs RCT 危害（torcetrapib ILLUMINATE）
// 领域选择动机：T29 roadmap 第 4 项——MR 自动标签从未在真实域验证（第十二领域无 MR 研究）；
// 本域以孟德尔随机化为核心证据层之一（CETP/HHL 工具变量），同时具备观察-vs-MR-vs-RCT 三层冲突
// （比 T28 酒精 J 曲线的两层更立体），天然检验 T28 矛盾钩子 + T30 三项新机制。
const GW = 'http://localhost:81/api/agent'
const SID_FILE = '/tmp/t30-sid.txt'

async function api(path: string, init?: RequestInit) {
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${GW}${path}${sep}XTransformPort=3002`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
  const text = await r.text()
  try { return JSON.parse(text) } catch { return { raw: text, status: r.status } }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitReply(sid: string): Promise<any> {
  for (let i = 0; i < 40; i++) {
    await sleep(6_000)
    const s = await api(`/sessions/${sid}`)
    const msgs = s.messages || []
    const last = [...msgs].reverse().find((m: any) => m.role === 'assistant' && m.kind === 'chat')
    if (last) return last
  }
  return null
}

async function interview() {
  const created = await api('/sessions', { method: 'POST', body: JSON.stringify({ lang: 'zh', title: 'HDL好胆固醇悖论' }) })
  const sid = created.session?.id
  if (!sid) { console.error('创建会话失败', created); process.exit(1) }
  console.log(`SID=${sid}`)
  const { writeFileSync } = await import('fs')
  writeFileSync(SID_FILE, sid)

  const msg1 = '我在做脂蛋白与动脉粥样硬化方向的文献梳理，卡在「好胆固醇」HDL 的核心悖论上。观察性一侧：Framingham 心脏研究以来的大量前瞻性队列（含 PROCAM、ARIC）一致显示血清 HDL-C 与冠心病风险呈强负相关——高 HDL 者风险显著更低，低 HDL-C 被各大指南列为独立危险因素，「升高 HDL 就能保护心脏」曾是被广泛接受的推论。但两层证据相继动摇了它：①孟德尔随机化（Voight 2012, Lancet）：以升高 HDL-C 的 CETP/HHL 遗传变异作工具变量，携「HDL 升高等位基因」者心肌梗死风险并未下降（>10 万人队列）；②药物 RCT：torcetrapib 的 ILLUMINATE 试验（2007）把 HDL-C 升高约 60%，主要心血管事件风险反升约 25%、全因死亡增加，试验提前终止；随后 dalcetrapib（dal-OUTCOMES）、evacetrapib（ACCELERATE）相继失败，anacetrapib（REVEAL）仅见他汀基础上边缘性获益，CETP 抑制剂全线退出商业开发。同一分子，观察性说保护、遗传学说不因果、药物试验说有害。我想把这组三层证据的冲突彻底拆解：HDL 究竟是因果通路上的执行者，还是仅仅一个「旁观者生物标志物」（健康生活方式与代谢状态的共生指标）？'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg1, lang: 'zh' }) })
  console.log('[chat 1] sent')
  const r1 = await waitReply(sid)
  if (!r1) { console.error('访谈第一轮无回复'); process.exit(1) }
  console.log(`[chat 1] reply: ${r1.content.slice(0, 160)}`)

  const msg2 = '证据全谱要求：①观察性经典证据的效应量与混杂结构（Framingham、PROCAM、ARIC；重点：饮酒、体力活动、胰岛素抵抗同时影响 HDL-C 与心血管风险——共混杂 vs 逆因果）；②孟德尔随机化核心文献（Voight 2012 CETP/HHL 变异；单变异 vs 多变异遗传评分的结果差异；针对 MR 工具变量假设的批评——CETP 变异的多效性问题：它同时改变 LDL/ApoB，如何影响「HDL 单独效应」的解读）；③药物 RCT 层（ILLUMINATE 的 torcetrapib 血压/醛固酮脱靶效应争议；dal-OUTCOMES、ACCELERATE、REVEAL 各自的 HDL 升幅与临床结局）；④机制文献（胆固醇逆转运通路、HDL 的抗氧化/抗炎「功能」 vs 单纯浓度——HDL 质与量之辩）；⑤权威综合（Cochrane/ESC-EAS 对 HDL 作为治疗靶点的立场）。我的核心困惑：MR 说「升高 HDL 本身不降风险」，但 REVEAL 的 anacetrapib 在他汀基础上仍见小幅获益且同时伴随 LDL-C/ApoB 下降——怎么把 HDL 效应从 LDL/ApoB 效应里干净地分离出来？如果 HDL 的「功能」而非「浓度」才是真正的因果变量，现有以浓度为导向的证据体系需要怎样重建？手段偏公共文献数据汇总与证据结构化，不做湿实验。'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg2, lang: 'zh' }) })
  console.log('[chat 2] sent')
  const r2 = await waitReply(sid)
  if (!r2) { console.error('访谈第二轮无回复'); process.exit(1) }
  console.log(`[chat 2] reply: ${r2.content.slice(0, 200)}`)
  console.log(`[chat 2] ready = ${JSON.stringify(r2.data)}`)
  console.log('PHASE_INTERVIEW_DONE')
}

async function poll() {
  const { readFileSync } = await import('fs')
  const sid = readFileSync(SID_FILE, 'utf-8').trim()
  console.log(`SID=${sid}`)
  let started = false
  let lastPhase = ''
  for (let i = 0; i < 46; i++) {
    await sleep(12_000)
    const s = await api(`/sessions/${sid}`)
    const phase = s.session?.phase
    const status = s.session?.status
    const stats = s.stats || {}
    if (phase !== lastPhase) {
      console.log(`[t+${(i + 1) * 12}s] phase=${phase} status=${status} steps=${stats.stepsUsed}/${stats.maxSteps} nodes=${(s.nodes || []).length} taskHistory=${(s.taskHistory || []).length}`)
      lastPhase = phase
    }
    if (phase === 'investigating' || phase === 'synthesizing' || phase === 'planning') started = true
    if (started && (phase === 'done' || phase === 'error' || status === 'done')) {
      console.log(`RUN_DONE phase=${phase} status=${status}`)
      process.exit(0)
    }
  }
  console.log('STILL_RUNNING（9 分钟窗口耗尽，可再次运行 poll 续接）')
  process.exit(2)
}

const phase = process.argv[2] || 'interview'
if (phase === 'interview') interview().catch((e) => { console.error(e); process.exit(1) })
else if (phase === 'poll') poll().catch((e) => { console.error(e); process.exit(1) })
else { console.error('用法: bun scripts/t30-e2e.ts interview|poll'); process.exit(1) }
