// Task 27 E2E Phase A2：第三轮访谈 → ready → 确认自动调研开启（预算应为 48步/20分）
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
  const msg3 = '我倾向认为是反向因果加上检测混淆共同制造了虚假关联——疾病状态和炎症本身会压低循环 25(OH)D，而总 25(OH)D 检测受 VDBP 遗传变异影响；但我没有把握，这正是需要证据链回答的问题。三种解释都要排查：①反向因果/健康使用者效应 ②VDBP 与游离维D的生物利用度 ③剂量与基线缺乏（含高剂量间歇补充的差异）。人群以一般成年人与老年人为主，兼顾特定人群（糖尿病、慢性肾病）。信息够了，请开始调研。'
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
