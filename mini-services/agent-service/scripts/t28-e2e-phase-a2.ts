// Task 28 E2E Phase A2：第三轮访谈 → ready → 确认自动调研开启（预算 48步/20分）
const GW = 'http://localhost:81/api/agent'
const SID = process.argv[2]

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
  const msg3 = '我目前的先验是：sick-quitter 效应与社会经济混杂为主、真实保护效应即使存在也很小；但酒精对 HDL-C 与凝血因子的急性机制效应让我没法彻底否定保护窗口的存在。另一个未解点是饮酒模式——rs671 携带者「逢喝必红」从而天然总量偏低，MR 工具实际测量的是平均摄入量还是暴饮倾向并不清楚，这可能是 MR 与队列结论分歧的一个被忽视的桥接点。人群覆盖东亚与西方，以一般成年人为准。信息够了，请开始调研。'
  await api(`/sessions/${SID}/chat`, { method: 'POST', body: JSON.stringify({ text: msg3, lang: 'zh' }) })
  console.log('[chat 3] sent')
  for (let i = 0; i < 40; i++) {
    await sleep(6_000)
    const s = await api(`/sessions/${SID}`)
    const msgs = s.messages || []
    const last = [...msgs].reverse().find((m: any) => m.role === 'assistant' && m.kind === 'chat')
    if (last) {
      console.log(`[chat 3] reply: ${last.content.slice(0, 180)}`)
      console.log(`[chat 3] ready = ${JSON.stringify(last.data)}`)
      break
    }
  }
  // 等自动开研究（ready 后 6s）→ 确认 investigating + 预算口径
  await sleep(15_000)
  const s = await api(`/sessions/${SID}`)
  console.log(`[auto-research] phase = ${s.session?.phase}/${s.session?.status}`)
  console.log(`[budget] maxSteps=${s.stats?.maxSteps} maxMinutes=${s.stats?.maxMinutes}（期望 48/20）`)
  const hasBudgetNote = (s.activity || []).some((a: any) => String(a.summary || '').includes('预算口径'))
  console.log(`[budget-note] 免计费口径活动说明出现: ${hasBudgetNote ? '✅' : '❌'}`)
  console.log('PHASE_A2_DONE')
}

main().catch((e) => { console.error(e); process.exit(1) })
