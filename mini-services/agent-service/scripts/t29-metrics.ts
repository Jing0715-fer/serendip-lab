// Task 29 E2E 度量采集：对比 Task 28 基线（密度 2.60 卡/任务、有机 contradicts 4、PMID 8/8）
// 新增 Task 29 专项：①fallback 轨迹小结填充率 ②矛盾边反向去重 ③MR 标签 ④活动分页
const GW = 'http://localhost:81/api/agent'
const sid = process.argv[2]

async function api(path: string) {
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${GW}${path}${sep}XTransformPort=3002`)
  return r.json() as any
}

async function main() {
  const s = await api(`/sessions/${sid}`)
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
  const densityGuards = actCount((a) => String(a.summary || '').includes('密度守护'))
  const pinGuards = actCount((a) => String(a.summary || '').includes('落墙守护'))
  const promotes = actCount((a) => String(a.summary || '').includes('课题卡升格'))
  const merges = actCount((a) => String(a.summary || '').includes('同源合并'))
  const hunter = actCount((a) => String(a.summary || '').includes('矛盾猎手'))
  const zeroHit = actCount((a) => String(a.summary || '').includes('放宽') || String(a.summary || '').includes('换上位词'))
  const rateEvents = acts.filter((a) => /API 限流|rate-limited/i.test(String(a.summary || '')))

  const doneTasks = (plan?.tasks || []).filter((t: any) => t.done)
  const wallPins = (byKind.evidence || 0) + (byKind.source || 0)

  console.log('========== E2E 度量（第十二领域：HRT 悖论）==========')
  console.log(`标题: ${s.session?.title}`)
  console.log(`预算: ${s.stats?.stepsUsed}/${s.stats?.maxSteps} 步, ${Math.round((s.stats?.elapsedMs || 0) / 60000)} 分钟, ${s.stats?.llmCalls} 次 LLM`)
  console.log(`节点 ${nodes.length}: ${JSON.stringify(byKind)}`)
  console.log(`边 ${edges.length}: ${JSON.stringify(byRel)}`)
  console.log(`任务完成: ${doneTasks.length}/${(plan?.tasks || []).length}`)
  for (const t of plan?.tasks || []) {
    console.log(`  - [${t.done ? '✓' : ' '}] ${String(t.goal).slice(0, 60)}`)
    console.log(`      summary: ${t.summary ? String(t.summary).slice(0, 120) : '（空！）'}`)
  }
  console.log(`证据密度: ${(doneTasks.length ? (wallPins / doneTasks.length).toFixed(2) : 'n/a')} 卡/任务 (evidence+source=${wallPins}) ← T28 基线 2.60，目标 ≥2.5`)
  console.log(`工具使用: batch_cards=${batchCalls}, add_evidence=${addCalls}`)
  console.log(`守护事件: 密度=${densityGuards}, 落墙=${pinGuards}, 升格=${promotes}, 同源合并=${merges}, 矛盾猎手=${hunter}, 零命中自愈=${zeroHit}`)
  console.log(`限流事件: ${rateEvents.length} 次`)

  // ---------- Task 29 专项 ----------
  console.log('\n----- Task 29 专项 -----')
  // ① fallback 轨迹小结（P1-①）
  const fallbackClosed = doneTasks.filter((t: any) => String(t.summary || '').startsWith('（步数上限收口）'))
  const finishTaskClosed = doneTasks.filter((t: any) => t.summary && !String(t.summary).startsWith('（步数上限收口）'))
  const emptySummary = doneTasks.filter((t: any) => !t.summary)
  console.log(`① fallback 小结: ${fallbackClosed.length}/${doneTasks.length} 任务经步数上限收口且全部带轨迹小结；finish_task 收口 ${finishTaskClosed.length}；空 summary ${emptySummary.length}（期望 0）`)
  if (fallbackClosed.length) console.log(`   样例: ${String(fallbackClosed[0].summary).slice(0, 150)}`)
  const traceNotice = actCount((a) => String(a.summary || '').includes('已自动生成轨迹小结'))
  console.log(`   轨迹小结活动通知: ${traceNotice} 条`)

  // ② contradicts 反向去重（P1-②）
  const contradictDedup = actCount((a) => String(a.summary || '').includes('矛盾边去重'))
  const contraEdges = edges.filter((e) => e.relation === 'contradicts')
  // 平行反向边检测：同一对节点双向 contradicts
  const nodePairKeys = contraEdges.map((e) => [e.source, e.target].sort().join('|'))
  const parallelReverse = nodePairKeys.filter((k, i) => nodePairKeys.indexOf(k) !== i)
  console.log(`② 矛盾边去重事件: ${contradictDedup} 次；contradicts 边 ${contraEdges.length} 条；平行反向对 ${parallelReverse.length}（期望 0）`)
  for (const e of contraEdges) {
    const src = nodes.find((n) => n.id === e.source)
    const dst = nodes.find((n) => n.id === e.target)
    console.log(`   - ${src?.title?.slice(0, 36)} ⇄ ${dst?.title?.slice(0, 36)} (${e.label || '无label'})`)
  }

  // ③ MR 标签（P2-④）
  const mrCards = nodes.filter((n) => (n.tags || []).some((x: string) => /^mr$/i.test(x)))
  console.log(`③ MR 标签卡: ${mrCards.length} 张${mrCards.length ? ' → ' + mrCards.map((n) => n.title.slice(0, 30)).join(' / ') : ''}`)

  // ④ 活动分页（P1-③）
  const page1 = await api(`/sessions/${sid}/activity?limit=100`)
  const older1 = await api(`/sessions/${sid}/activity?before=${page1.events[0].id}&limit=100`)
  console.log(`④ 活动分页: 初始载荷 ${acts.length} 条（activityMore=${s.activityMore}）；API 首页 ${page1.events.length} 条 hasMore=${page1.hasMore}；第二页 ${older1.events.length} 条 hasMore=${older1.hasMore}；DB 总量 ${page1.total}`)
  const overlap = older1.events.filter((e: any) => page1.events.some((x: any) => x.id === e.id))
  console.log(`   页间重叠: ${overlap.length} 条（期望 0）`)

  // ---------- 常规防线 ----------
  console.log('\n----- 常规防线 -----')
  console.log(`同题 topic↔非topic 双卡对: ${dupTopicPairs.length}${dupTopicPairs.length ? ' → ' + dupTopicPairs.map((n) => `${n.title}(${n.kind})`).join(' / ') : ' ✅'}`)
  console.log(`同源重复卡: ${dupSource.length}${dupSource.length ? ' → ' + dupSource.join(', ') : ' ✅'}`)
  console.log(`课题卡 ${(s.questions || []).length} 张:`)
  for (const q of s.questions || []) console.log(`  - ${q.recommended ? '⭐' : ' '} ${q.text.slice(0, 60)} [N${q.scores?.novelty}F${q.scores?.feasibility}I${q.scores?.impact}]`)
  console.log(`narrative: ${(s.narrative || '').length} 字`)
  const pmids = [...new Set(((s.narrative || '') + ' ' + nodes.map((n) => `${n.sourceRef || ''} ${n.content || ''}`).join(' ')).match(/\b\d{7,8}\b/g) || [])]
  console.log(`全部 PMID 引用: ${pmids.join(', ')}`)
  const lv: Record<string, number> = {}
  for (const n of nodes.filter((n) => n.kind === 'evidence' || n.kind === 'source')) lv[n.level || 'null'] = (lv[n.level || 'null'] || 0) + 1
  console.log(`evidence/source 卡 level 分布: ${JSON.stringify(lv)}`)

  // Task 28 专项复核
  const contradictChecks = actCount((a) => String(a.summary || '').includes('矛盾自检'))
  const skipInterim = actCount((a) => String(a.summary || '').includes('跳过本轮阶段性综合'))
  const finalStart = actCount((a) => String(a.summary || '').includes('最终综合：正在基于证据墙'))
  console.log(`T28 复核: 矛盾自检触发=${contradictChecks}，中途综合跳过=${skipInterim}，最终综合开始事件=${finalStart}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
