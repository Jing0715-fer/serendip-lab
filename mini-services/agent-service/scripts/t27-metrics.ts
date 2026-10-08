// Task 27 E2E 度量采集（会话已完成，从 DB 读全量数据）——对比 Task 26 基线（密度 1.60 卡/任务）
const GW = 'http://localhost:81/api/agent'
const sid = process.argv[2]

async function main() {
  const r = await fetch(`${GW}/sessions/${sid}?XTransformPort=3002`)
  const s = await r.json() as any
  const nodes: any[] = s.nodes || []
  const edges: any[] = s.edges || []
  const acts: any[] = s.activity || []
  const plan = s.plan

  const byKind: Record<string, number> = {}
  for (const n of nodes) byKind[n.kind] = (byKind[n.kind] || 0) + 1
  const byRel: Record<string, number> = {}
  for (const e of edges) byRel[e.relation] = (byRel[e.relation] || 0) + 1

  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, '')
  const topicTitles = new Set(nodes.filter((n) => n.kind === 'topic').map((n) => norm(n.title)))
  const dupTopicPairs = nodes.filter((n) => n.kind !== 'topic' && topicTitles.has(norm(n.title)))
  const keyOf = (n: any) => {
    const grab = (v: string) => {
      const m = /\bpmid[:\s]*(\d{4,9})\b/i.exec(v || '') || /pubmed\.ncbi\.nlm\.nih\.gov\/(\d{4,9})/i.exec(v || '')
      if (m) return `PMID:${m[1]}`
      const d = /\bdoi[:\s]*(10\.\d{4,9}\/[^\s"'<>]+)/i.exec(v || '') || /doi\.org\/(10\.\d{4,9}\/[^\s"'<>]+)/i.exec(v || '')
      if (d) return `DOI:${d[1].replace(/[.,;)]+$/, '').toLowerCase()}`
      return null
    }
    return grab(n.sourceRef || '') || grab(n.sourceUrl || '')
  }
  const seen = new Map<string, string>()
  const dupSource: string[] = []
  for (const n of nodes.filter((n) => n.kind === 'evidence' || n.kind === 'source')) {
    const k = keyOf(n)
    if (!k) continue
    if (seen.has(k)) dupSource.push(`${k}`)
    else seen.set(k, n.title)
  }

  const actCount = (pred: (a: any) => boolean) => acts.filter(pred).length
  const batchCalls = actCount((a) => a.type === 'tool_call' && a.tool === 'batch_cards')
  const addCalls = actCount((a) => a.type === 'tool_call' && a.tool === 'add_evidence')
  const askUser = actCount((a) => a.type === 'tool_call' && a.tool === 'ask_user')
  const densityGuards = actCount((a) => String(a.summary || '').includes('密度守护'))
  const pinGuards = actCount((a) => String(a.summary || '').includes('落墙守护'))
  const promotes = actCount((a) => String(a.summary || '').includes('课题卡升格'))
  const merges = actCount((a) => String(a.summary || '').includes('同源合并'))
  const hunter = actCount((a) => String(a.summary || '').includes('矛盾猎手'))
  const zeroHit = actCount((a) => String(a.summary || '').includes('放宽') || String(a.summary || '').includes('换上位词'))
  const budgetNote = actCount((a) => String(a.summary || '').includes('预算口径'))

  // Task 27 专项：限流事件与时间感知等待
  const rateEvents = acts.filter((a) => /API 限流|rate-limited/i.test(String(a.summary || '')))
  const rateWaits = rateEvents.map((a) => {
    const m = /(\d+)s 后自动重试/.exec(String(a.summary)) || /retry in (\d+)s/.exec(String(a.summary))
    return m ? Number(m[1]) : null
  }).filter((x): x is number => x != null)
  const noWaitSkip = actCount((a) => String(a.summary || '').includes('不再等待重试'))

  const doneTasks = (plan?.tasks || []).filter((t: any) => t.done)
  const wallPins = (byKind.evidence || 0) + (byKind.source || 0)

  console.log('========== E2E 度量（第十领域：维生素D补充悖论）==========')
  console.log(`标题: ${s.session?.title}`)
  console.log(`预算: ${s.stats?.stepsUsed}/${s.stats?.maxSteps} 步, ${Math.round((s.stats?.elapsedMs || 0) / 60000)} 分钟, ${s.stats?.llmCalls} 次 LLM（期望 maxSteps=48/maxMinutes=20）`)
  console.log(`节点 ${nodes.length}: ${JSON.stringify(byKind)}`)
  console.log(`边 ${edges.length}: ${JSON.stringify(byRel)}`)
  console.log(`任务完成: ${doneTasks.length}/${(plan?.tasks || []).length}`)
  for (const t of plan?.tasks || []) console.log(`  - [${t.done ? '✓' : ' '}] ${t.goal}`)
  console.log(`证据密度: ${(doneTasks.length ? (wallPins / doneTasks.length).toFixed(2) : 'n/a')} 卡/任务 (evidence+source=${wallPins}) ← Task 26 基线 1.60，目标 ≥2.5`)
  console.log(`工具使用: batch_cards=${batchCalls}, add_evidence=${addCalls}, ask_user=${askUser}`)
  console.log(`守护事件: 密度=${densityGuards}, 落墙=${pinGuards}, 升格=${promotes}, 同源合并=${merges}, 矛盾猎手=${hunter}, 零命中自愈=${zeroHit}, 预算口径说明=${budgetNote}`)
  console.log(`限流事件: ${rateEvents.length} 次${rateWaits.length ? `，重试等待(s): ${rateWaits.join('/')}` : ''}${noWaitSkip ? `，尾段跳过等待=${noWaitSkip}` : ''}`)
  console.log(`同题 topic↔非topic 双卡对: ${dupTopicPairs.length}${dupTopicPairs.length ? ' → ' + dupTopicPairs.map((n) => `${n.title}(${n.kind})`).join(' / ') : ' ✅'}`)
  console.log(`同源重复卡: ${dupSource.length}${dupSource.length ? ' → ' + dupSource.join(', ') : ' ✅'}`)
  console.log(`课题卡 ${(s.questions || []).length} 张:`)
  for (const q of s.questions || []) console.log(`  - ${q.recommended ? '⭐' : ' '} ${q.text.slice(0, 60)} [N${q.scores?.novelty}F${q.scores?.feasibility}I${q.scores?.impact}]`)
  console.log(`contradicts 边:`)
  for (const e of edges.filter((x) => x.relation === 'contradicts')) {
    const src = nodes.find((n) => n.id === e.source)
    const dst = nodes.find((n) => n.id === e.target)
    console.log(`  - ${src?.title?.slice(0, 38)} ⇄ ${dst?.title?.slice(0, 38)} (${e.label || '无label'})`)
  }
  console.log(`narrative: ${(s.narrative || '').length} 字`)
  const pmids = [...new Set(((s.narrative || '') + ' ' + nodes.map((n) => `${n.sourceRef || ''} ${n.content || ''}`).join(' ')).match(/\b\d{7,8}\b/g) || [])]
  console.log(`全部 PMID 引用: ${pmids.join(', ')}`)
  console.log(`evidence/source 卡 level 分布:`)
  const lv: Record<string, number> = {}
  for (const n of nodes.filter((n) => n.kind === 'evidence' || n.kind === 'source')) lv[n.level || 'null'] = (lv[n.level || 'null'] || 0) + 1
  console.log(`  ${JSON.stringify(lv)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
