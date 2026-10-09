// Task 27 E2E 轮询：等待研究完成（或超参分钟数退出）。用法: bun run scripts/t27-poll.ts <sid> [maxWaitMin]
const GW = 'http://localhost:81/api/agent'
const SID = process.argv[2]
const MAX_MIN = Number(process.argv[3] || 8)

async function api(path: string) {
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${GW}${path}${sep}XTransformPort=3002`)
  const text = await r.text()
  try { return JSON.parse(text) } catch { return { raw: text, status: r.status } }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const t0 = Date.now()
  let lastLine = ''
  while ((Date.now() - t0) / 60000 < MAX_MIN) {
    const s = await api(`/sessions/${SID}`)
    const phase = `${s.session?.phase}/${s.session?.status}`
    const st = s.stats || {}
    const nodes = (s.nodes || []).length
    const line = `[${Math.round((Date.now() - t0) / 60000)}m] ${phase} steps=${st.stepsUsed}/${st.maxSteps} elapsed=${Math.round((st.elapsedMs || 0) / 60000)}m nodes=${nodes}`
    if (line !== lastLine) { console.log(line); lastLine = line }
    if (s.session?.phase === 'done' || s.session?.status === 'done') { console.log('RESEARCH_DONE'); return }
    if (s.session?.status === 'paused' || s.session?.status === 'error') { console.log(`HALTED: ${phase}`); return }
    await sleep(20_000)
  }
  console.log('POLL_TIMEOUT')
}

main().catch((e) => { console.error(e); process.exit(1) })
