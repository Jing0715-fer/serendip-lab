// Task 27 深查：活动时间线 + 空level卡 + 综合阶段耗时归因
const GW = 'http://localhost:81/api/agent'
const sid = process.argv[2]

async function main() {
  const r = await fetch(`${GW}/sessions/${sid}?XTransformPort=3002`)
  const s = await r.json() as any
  const acts: any[] = s.activity || []

  console.log(`活动总数: ${acts.length}`)
  // 时间线（每 30s 聚合一次事件类型，找出空洞期）
  let prev: number | null = null
  for (const a of acts) {
    const t = a.at || a.createdAt || a.ts
    if (t == null) continue
    const ts = new Date(t).getTime()
    if (prev != null && ts - prev > 45_000) {
      console.log(`\n---- 空洞 ${(ts - prev) / 1000}s ----`)
    }
    const d = new Date(t).toISOString().slice(11, 19)
    console.log(`${d} [${a.type}] ${String(a.summary || '').slice(0, 90)}`)
    prev = ts
  }

  console.log('\n===== evidence/source 卡 level 明细 =====')
  for (const n of (s.nodes || []).filter((n: any) => n.kind === 'evidence' || n.kind === 'source')) {
    console.log(`level=${n.level || '(空)'} | ${String(n.title).slice(0, 50)} | ${n.sourceRef || '无sourceRef'}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
