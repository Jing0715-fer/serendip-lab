// Task 31 E2E 驱动（分段执行防后台进程回收）：bun scripts/t31-e2e.ts interview | poll
// 第十四领域：阿司匹林一级预防「获益-出血」矛盾——
//   历史 RCT 获益（PHS 1989/WHS 2005） vs 2018 三大现代 RCT 分化（ARRIVE 中性 / ASCEND 获益+出血翻倍 /
//   ASPREE 老年人全因死亡反升） vs 指南持续收窄（USPSTF 2022 / ESC 2024）。
// 领域选择动机：T30 roadmap 第 1/2 项的压测场——RCT 文献密度极高（检索型任务多 → 步数封顶收口占比高，
// 正是密度守护需挂 fallback 窗口的路径）；单轮 48 步预算尾段天然出现饥饿任务（P1-② 跳过）；
// 阿司匹林主试验多为 PMC 开放获取（P2-③ fullText 利用度指引的真实域验证）。
const GW = 'http://localhost:81/api/agent'
const SID_FILE = '/tmp/t31-sid.txt'

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
  const created = await api('/sessions', { method: 'POST', body: JSON.stringify({ lang: 'zh', title: '阿司匹林一级预防悖论' }) })
  const sid = created.session?.id
  if (!sid) { console.error('创建会话失败', created); process.exit(1) }
  console.log(`SID=${sid}`)
  const { writeFileSync } = await import('fs')
  writeFileSync(SID_FILE, sid)

  const msg1 = '我在梳理抗栓治疗的心血管一级预防证据，卡在阿司匹林「同一药物、三种答案」的悖论上。历史一侧：Physicians\' Health Study（1989，2.2 万美国男医生）显示低剂量阿司匹林使首次心梗风险下降约 44%，Women\'s Health Study（2005）显示女性缺血性卒中下降 17%——早期 RCT 一度支持较为广泛的使用，「每日一片阿司匹林防心脏病」成为流行文化。但 2018 年三大现代 RCT 同时发布并动摇全局：ARRIVE（心血管中危人群，主要终点无显著获益，HR 0.96，且事后置换分析提示实际依从人群中有获益迹象）；ASCEND（糖尿病人群，复合心血管终点获益 RR 0.88，但大出血风险近乎翻倍、输血与颅内出血均增多）；ASPREE（70 岁以上健康老年人，致残性痴呆复合终点无差异，心血管事件仅边缘略降，全因死亡却反升 HR 1.14——而出血本身不足以解释超额死亡）。此后 USPSTF 2022 把推荐收窄到 40-59 岁且 10 年 CVD 风险 ≥10% 的一小段人群，ESC 2024 对老年人不再常规推荐。同药同剂量（约 100mg/日），获益与出血伤害并存、净获益随人群而反转——我想把这个矛盾彻底拆解：阿司匹林一级预防的净获益究竟是「基线心血管风险与出血风险的连续函数」（存在个体化净获益阈值），还是「在高龄人群中因果性地净有害」（衰老同时改变血栓倾向、出血倾向与炎症/癌症相关通路）？'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg1, lang: 'zh' }) })
  console.log('[chat 1] sent')
  const r1 = await waitReply(sid)
  if (!r1) { console.error('访谈第一轮无回复'); process.exit(1) }
  console.log(`[chat 1] reply: ${r1.content.slice(0, 160)}`)

  const msg2 = '证据全谱要求：①三大 2018 RCT 的关键细节（ARRIVE 的依从性稀释问题与 c-perimeter 置换分析；ASCEND 的出血判定方法（PETO 法）与 GI 癌症亚组信号；ASPREE 的死亡原因分解——癌症死亡 HR 约 1.31 的争议，出血性卒中 vs 缺血性卒中的双向变化）；②历史 RCT 与汇总分析（PHS、WHS、British Doctors、HOT、PPP、TPT；ATT 2009 Lancet 个体数据 Meta；Rothwell 2012 Lancet 按年龄/性别分层的获益-出血量化；2019/2021 系统综述对当代人群外推性的批评）；③出血机制与风险修饰（GI 黏膜损伤的年龄依赖性、脑微出血 CMB 与颅内出血风险、H. pylori 感染与消化性溃疡史的交互、PPI 共同给药的净获益再计算）；④ASPREE 死亡之谜的两种解释（机会性筛查偏倚/领先时间偏倚 vs 阿司匹林促进进展-转移的生物学假说——ASA 相关的 Wnt/血小板-TGFβ 通路证据）；⑤当代指南框架（USPSTF 2022 的净获益表与「55-59 岁证据不足」理由；ESC 2024 糖尿病亚组为何保留；BEAUTIFY/AFFECT 等在研试验的方向）。我的核心困惑：如果 ASCEND 显示糖尿病人群仍有净获益、ASPREE 显示健康老年人净有害，「年龄 × 基线风险 × 出血风险」三维网格里净获益边界到底在哪里、能不能给出可操作的阈值？ASPREE 的癌症信号究竟是因果还是偏倚？手段偏公共文献数据汇总与证据结构化，不做湿实验。'
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
else { console.error('用法: bun scripts/t31-e2e.ts interview|poll'); process.exit(1) }
