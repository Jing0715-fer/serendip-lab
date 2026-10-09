// Task 30 E2E 度量采集：对比 Task 29 基线（密度 4.2 卡/任务、fallback 小结 6/6、contradicts 2）
// Task 30 专项：①跨轮任务历史（task_records 累积 vs plan 单轮视图） ②MR 标签真实域验证（HDL 域）
// ③fallback 末段判断非策略性 ④pubmed_fetch 降级链行为
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
  const history: any[] = s.taskHistory || []

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
  const fetchCalls = actCount((a) => a.type === 'tool_call' && a.tool === 'pubmed_fetch')
  const densityGuards = actCount((a) => String(a.summary || '').includes('密度守护'))
  const pinGuards = actCount((a) => String(a.summary || '').includes('落墙守护'))
  const promotes = actCount((a) => String(a.summary || '').includes('课题卡升格'))
  const merges = actCount((a) => String(a.summary || '').includes('同源合并'))
  const zeroHit = actCount((a) => String(a.summary || '').includes('放宽') || String(a.summary || '').includes('换上位词'))
  const rateEvents = acts.filter((a) => /API 限流|rate-limited/i.test(String(a.summary || '')))

  const wallPins = (byKind.evidence || 0) + (byKind.source || 0)

  console.log('========== E2E 度量（第十三领域：HDL 好胆固醇悖论）==========')
  console.log(`标题: ${s.session?.title}`)
  console.log(`预算: ${s.stats?.stepsUsed}/${s.stats?.maxSteps} 步, ${Math.round((s.stats?.elapsedMs || 0) / 60000)} 分钟, ${s.stats?.llmCalls} 次 LLM`)
  console.log(`节点 ${nodes.length}: ${JSON.stringify(byKind)}`)
  console.log(`边 ${edges.length}: ${JSON.stringify(byRel)}`)
  console.log(`证据密度: ${(history.length ? (wallPins / history.length).toFixed(2) : 'n/a')} 卡/任务 (evidence+source=${wallPins}, 闭环任务=${history.length}) ← T29 基线 4.2，目标 ≥2.5`)
  console.log(`工具使用: batch_cards=${batchCalls}, add_evidence=${addCalls}, pubmed_fetch=${fetchCalls}`)
  console.log(`守护事件: 密度=${densityGuards}, 落墙=${pinGuards}, 升格=${promotes}, 同源合并=${merges}, 零命中自愈=${zeroHit}`)
  console.log(`限流事件: ${rateEvents.length} 次`)

  // ---------- Task 30 专项 ----------
  console.log('\n----- Task 30 专项 -----')
  // ① 跨轮任务历史（P1-①）
  const planRound = plan?.round ?? 0
  const rounds = [...new Set(history.map((r) => r.round))].sort((a, b) => a - b)
  const visibleInPlan = new Set((plan?.tasks || []).map((t: any) => t.id))
  const prevRoundRecs = history.filter((r) => r.round !== planRound)
  const orphaned = prevRoundRecs.filter((r) => !visibleInPlan.has(r.taskId) && !(plan?.tasks || []).some((t: any) => t.goal === r.goal))
  console.log(`① 跨轮任务历史: ${history.length} 条记录跨 ${rounds.length} 轮（${rounds.map((r) => `R${r}:${history.filter((x) => x.round === r).length}`).join(' ')}）；plan 仅剩第 ${planRound} 轮 ${plan?.tasks?.length || 0} 任务`)
  console.log(`   前轮记录 ${prevRoundRecs.length} 条，其中 ${orphaned.length} 条已从 plan 视图消失（正是 T30 要救回的部分）`)
  const sumPinned = history.reduce((a, r) => a + (r.pinned || 0), 0)
  const sumSearches = history.reduce((a, r) => a + (r.searches || 0), 0)
  console.log(`   累计落卡 ${sumPinned} 张 / 检索 ${sumSearches} 次（记录口径）`)
  for (const r of history) {
    console.log(`   - R${r.round} [${r.taskId}] ${String(r.goal).slice(0, 52)}`)
    console.log(`       pinned=${r.pinned} searches=${r.searches} | ${r.summary ? String(r.summary).slice(0, 110) : '（空！）'}`)
  }
  const planDone = (plan?.tasks || []).filter((t: any) => t.done)
  const historyIds = new Set(history.map((r) => `${r.round}:${r.taskId}`))
  const missedRecords = planDone.filter((t: any) => !history.some((r) => r.taskId === t.id && r.round === planRound))
  console.log(`   plan 当前轮 done=${planDone.length}/${plan?.tasks?.length || 0}；漏录=${missedRecords.length}（期望 0）`)

  // ② MR 标签真实域验证（P2-④ T29 遗留）
  const mrCards = nodes.filter((n) => (n.tags || []).some((x: string) => /^mr$/i.test(x)))
  console.log(`② MR 标签卡: ${mrCards.length} 张${mrCards.length ? ' → ' + mrCards.map((n) => n.title.slice(0, 32)).join(' / ') : ''}`)

  // ③ fallback 末段判断非策略性（P2-③）
  const fallbacks = history.filter((r) => String(r.summary || '').startsWith('（步数上限收口）'))
  const strategyLeads = fallbacks.filter((r) => /末段判断：(我需要调整|换个|换词|重新检索|重新尝试|调整策略)/.test(String(r.summary)))
  console.log(`③ fallback 收口 ${fallbacks.length}/${history.length}；末段判断以策略性文本开头 ${strategyLeads.length} 条（期望 0）`)
  for (const r of fallbacks.slice(0, 3)) {
    const m = /末段判断：(.{0,100})/.exec(String(r.summary))
    if (m) console.log(`   样例: ${m[1]}`)
  }

  // ④ pubmed_fetch 降级链（P1-②）：调用次数 + 全文相关活动迹象（链路本体由 t30-verify 真网验证）
  const fullTextMentions = actCount((a) => String(a.summary || '').includes('fullText') || String(a.summary || '').includes('全文'))
  console.log(`④ pubmed_fetch 调用 ${fetchCalls} 次；活动含「全文」字样 ${fullTextMentions} 条（链路行为单测已覆盖）`)

  // ---------- T28/T29 复核 ----------
  console.log('\n----- T28/T29 复核 -----')
  const emptySummary = history.filter((r) => !r.summary)
  console.log(`空 summary 任务: ${emptySummary.length}（期望 0）`)
  const contradictChecks = actCount((a) => String(a.summary || '').includes('矛盾自检'))
  const contraEdges = edges.filter((e) => e.relation === 'contradicts')
  const nodePairKeys = contraEdges.map((e) => [e.source, e.target].sort().join('|'))
  const parallelReverse = nodePairKeys.filter((k, i) => nodePairKeys.indexOf(k) !== i)
  console.log(`矛盾自检触发=${contradictChecks}；contradicts 边 ${contraEdges.length} 条；平行反向对 ${parallelReverse.length}（期望 0）`)
  for (const e of contraEdges) {
    const src = nodes.find((n) => n.id === e.source)
    const dst = nodes.find((n) => n.id === e.target)
    console.log(`   - ${src?.title?.slice(0, 38)} ⇄ ${dst?.title?.slice(0, 38)} (${e.label || '无label'})`)
  }
  const skipInterim = actCount((a) => String(a.summary || '').includes('跳过本轮阶段性综合'))
  const finalStart = actCount((a) => String(a.summary || '').includes('最终综合：正在基于证据墙'))
  console.log(`中途综合跳过=${skipInterim}，最终综合开始事件=${finalStart}`)

  // ---------- 常规防线 ----------
  console.log('\n----- 常规防线 -----')
  console.log(`同题 topic↔非topic 双卡对: ${dupTopicPairs.length}${dupTopicPairs.length ? ' → ' + dupTopicPairs.map((n) => `${n.title}(${n.kind})`).join(' / ') : ' ✅'}`)
  console.log(`同源重复卡: ${dupSource.length}${dupSource.length ? ' → ' + dupSource.join(', ') : ' ✅'}`)
  console.log(`课题卡 ${(s.questions || []).length} 张:`)
  for (const q of s.questions || []) console.log(`  - ${q.recommended ? '⭐' : ' '} ${q.text.slice(0, 66)} [N${q.scores?.novelty}F${q.scores?.feasibility}I${q.scores?.impact}]`)
  console.log(`narrative: ${(s.narrative || '').length} 字`)
  const pmids = [...new Set(((s.narrative || '') + ' ' + nodes.map((n) => `${n.sourceRef || ''} ${n.content || ''}`).join(' ')).match(/\b\d{7,8}\b/g) || [])]
  console.log(`全部 PMID 引用: ${pmids.join(', ')}`)
  const lv: Record<string, number> = {}
  for (const n of nodes.filter((n) => n.kind === 'evidence' || n.kind === 'source')) lv[n.level || 'null'] = (lv[n.level || 'null'] || 0) + 1
  console.log(`evidence/source 卡 level 分布: ${JSON.stringify(lv)}`)
  console.log(`MR 标签与 level 口径: mr 卡 level = ${mrCards.map((n) => n.level).join('/') || '-'}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
