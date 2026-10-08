// Task 26 E2E Phase A2：第三轮访谈 → ready → 确认自动调研
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
  const msg3 = '我倾向认为年龄相关的出血风险增长是主要驱动（流行病学上消化道出血率随年龄指数增长），但我没有把握——这正是需要证据链回答的问题，三种机制都要排查：出血风险、阿司匹林反应性、肠道微生物代谢。人群就以老年人（≥70 岁）为核心，兼顾糖尿病等特殊人群的一级预防。信息够了，请开始调研。'
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
  await sleep(15_000)
  const s = await api(`/sessions/${SID}`)
  console.log(`[auto-research] phase = ${s.session?.phase}/${s.session?.status}`)
  console.log('PHASE_A2_DONE')
}

main().catch((e) => { console.error(e); process.exit(1) })
