// Task 29 E2E 驱动 Phase A：建会话 + 访谈两轮，等自动开研究后轮询到收官（含分段日志，防长轮询挂死）
// 第十二领域：绝经激素治疗（HRT）悖论——WHI 随机对照试验显示危害 vs 护士健康研究等观察性队列显示获益
// 领域选择动机：与第十一领域（队列获益 vs MR 零因果）形成互补的「RCT 危害 vs 队列获益」经典设计冲突——
// 恰是 Task 28 有机矛盾钩子的另一形态试金石；20 分钟长会话天然触发 >240 活动事件，验证 Task 29 分页。
const GW = 'http://localhost:81/api/agent'

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

async function main() {
  const created = await api('/sessions', { method: 'POST', body: JSON.stringify({ lang: 'zh', title: 'HRT悖论' }) })
  const sid = created.session?.id
  if (!sid) { console.error('创建会话失败', created); process.exit(1) }
  console.log(`SID=${sid}`)

  const msg1 = '我在做女性心血管健康方向的文献梳理，遇到绝经激素治疗（HRT）的核心悖论。观察性队列一侧：护士健康研究（Nurses\' Health Study，Stampfer 1991 NEJM）显示绝经后雌激素使用者冠心病风险下降约 40-50%，Grodst­ein 系列随访与 WHI 观察性队列（Manson 2013）也提示使用者全因死亡更低——连同雌激素升高 HDL-C、改善内皮功能的机制证据，「雌激素保护心脏」曾是主流认知，以至于 1990s 千万女性长期服用。但 2002 年 WHI 随机对照试验（Rossouw，JAMA，PMID 12117397）把这一认知击碎：雌孕激素联合（CHT）组冠心病 HR 1.29、卒中 HR 1.41、浸润性乳腺癌 HR 1.26，试验提前终止；全球 HRT 处方应声腰斩。同一问题、同一时代、两套研究设计给出方向相反的答案。我想把这组 RCT-vs-队列的冲突彻底拆解清楚。'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg1, lang: 'zh' }) })
  console.log('[chat 1] sent')

  const waitReply = async (): Promise<any> => {
    for (let i = 0; i < 40; i++) {
      await sleep(6_000)
      const s = await api(`/sessions/${sid}`)
      const msgs = s.messages || []
      const last = [...msgs].reverse().find((m: any) => m.role === 'assistant' && m.kind === 'chat')
      if (last) return last
    }
    return null
  }
  const r1 = await waitReply()
  if (!r1) { console.error('访谈第一轮无回复'); process.exit(1) }
  console.log(`[chat 1] reply: ${r1.content.slice(0, 160)}`)

  const msg2 = '证据全谱要求：①WHI 两臂 RCT 原始结果与 13 年随访再分析（Manson 2013 JAMA；特别关注年龄/绝经年限分层——<60 岁或绝经 <10 年亚组 CHD HR 是否回到 1.0 以下）；②单独雌激素（CEE-only）臂（Anderson 2004 JAMA）：为何它没有显示 CHD 危害、乳腺癌反而略降；③观察性队列侧（护士健康研究、WHI 观察性队列）的效应估计与后世批评（健康使用者混杂、绝经症状驱动的自我选择）；④权威综合（Cochrane 系统综述、2017 激素治疗立场声明）；⑤「时间窗假说」（timing hypothesis）的机制与动物证据（雌激素对年轻 vs 老化血管内皮的反应差异）。我的核心困惑：WHI 平均绝经 12 年后入组的老年人群，能否推翻「绝经 10 年内启动」的获益窗口？这是人群外推问题还是真实生物学？手段偏公共文献数据汇总，不做湿实验。'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg2, lang: 'zh' }) })
  console.log('[chat 2] sent')
  const r2 = await waitReply()
  if (!r2) { console.error('访谈第二轮无回复'); process.exit(1) }
  console.log(`[chat 2] reply: ${r2.content.slice(0, 200)}`)
  console.log(`[chat 2] ready = ${JSON.stringify(r2.data)}`)
  console.log('PHASE_A_DONE')

  // ---------- 等自动开研究（6s 后）并轮询到收官（最长 30 分钟） ----------
  let started = false
  let lastPhase = ''
  for (let i = 0; i < 155; i++) {
    await sleep(12_000)
    const s = await api(`/sessions/${sid}`)
    const phase = s.session?.phase
    const status = s.session?.status
    const stats = s.stats || {}
    if (phase !== lastPhase) {
      console.log(`[t+${(i + 1) * 12}s] phase=${phase} status=${status} steps=${stats.stepsUsed}/${stats.maxSteps} nodes=${(s.nodes || []).length}`)
      lastPhase = phase
    }
    if (phase === 'investigating' || phase === 'synthesizing' || phase === 'planning') started = true
    if (started && (phase === 'done' || phase === 'error' || status === 'done')) {
      console.log(`RUN_DONE phase=${phase} status=${status}`)
      break
    }
    if (i === 154) console.log('TIMEOUT_30MIN')
  }
  console.log('E2E_COMPLETE')
}

main().catch((e) => { console.error(e); process.exit(1) })
