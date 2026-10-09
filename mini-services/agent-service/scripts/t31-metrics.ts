// Task 31 E2E 度量采集：对比 T30 基线（密度 R1 2.40 / R2 0.75，跨轮 1.67；T30 E2E 发现 R2 尾段 3 任务 0-1 卡收口）
// Task 31 专项：①密度守护收口窗口（P1-①）触发与补落效果 ②末段任务饥饿跳过（P1-②）
// ③fullText 利用度（P2-③——具体数据引用密度）④整体证据密度对比
const GW = 'http://localhost:81/api/agent'
const sid = process.argv[2]

async function api(path: string) {
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${GW}${path}${sep}XTransformPort=3002`)
  return r.json() as any
}

// Task 31 修复：sessionFullPayload 的 activity 被 T29 分页截断在 100 条（守护事件集中在后段
// 被整段漏掉——首采时密度窗口显示 0 触发实则 4 次）。走 /activity 游标翻全量。
// 注意：每页内事件为正序（first=最小 id）→「向更早翻页」的游标取本页第一行的 id。
async function allActivity(sid: string): Promise<any[]> {
  const out: any[] = []
  let before: number | null = null
  for (let i = 0; i < 50; i++) {
    const page = await api(`/sessions/${sid}/activity${before ? `?before=${before}&limit=200` : '?limit=200'}`)
    const evts: any[] = page.events || []
    if (!evts.length) break
    out.push(...evts)
    if (!page.hasMore) break
    before = evts[0].id // 本页最老的 id 作为下一页游标
  }
  return out.reverse() // 页块自新到旧堆叠、页内正序 → 反转得全量时间正序
}

async function main() {
  const s = await api(`/sessions/${sid}`)
  const nodes: any[] = s.nodes || []
  const edges: any[] = s.edges || []
  const acts: any[] = await allActivity(sid)
  console.log(`(activity 全量采集: ${acts.length} 条)`)
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
  const densityWindow = actCount((a) => String(a.summary || '').includes('密度守护（收口窗口）'))
  const densityFinish = actCount((a) => /密度守护：本任务/.test(String(a.summary || '')))
  const pinGuards = actCount((a) => String(a.summary || '').includes('落墙守护'))
  const promotes = actCount((a) => String(a.summary || '').includes('课题卡升格'))
  const merges = actCount((a) => String(a.summary || '').includes('同源合并'))
  const starveNotices = acts.filter((a) => String(a.summary || '').includes('个任务未启动'))
  const rateEvents = acts.filter((a) => /API 限流|rate-limited/i.test(String(a.summary || '')))

  const wallPins = (byKind.evidence || 0) + (byKind.source || 0)

  console.log('========== E2E 度量（第十四领域：阿司匹林一级预防悖论）==========')
  console.log(`标题: ${s.session?.title}`)
  console.log(`预算: ${s.stats?.stepsUsed}/${s.stats?.maxSteps} 步, ${Math.round((s.stats?.elapsedMs || 0) / 60000)} 分钟, ${s.stats?.llmCalls} 次 LLM`)
  console.log(`节点 ${nodes.length}: ${JSON.stringify(byKind)}`)
  console.log(`边 ${edges.length}: ${JSON.stringify(byRel)}`)
  console.log(`证据密度: ${(history.length ? (wallPins / history.length).toFixed(2) : 'n/a')} 卡/任务 (evidence+source=${wallPins}, 闭环任务=${history.length}) ← T30 基线 R1 2.40 / R2 0.75，目标 ≥2.5`)
  console.log(`工具使用: batch_cards=${batchCalls}, add_evidence=${addCalls}, pubmed_fetch=${fetchCalls}`)
  console.log(`守护事件: 密度(收口窗口)=${densityWindow}, 密度(finish分支)=${densityFinish}, 落墙=${pinGuards}, 升格=${promotes}, 同源合并=${merges}`)
  console.log(`限流事件: ${rateEvents.length} 次`)

  // ---------- Task 31 专项 ----------
  console.log('\n----- Task 31 专项 -----')
  // ① 密度守护收口窗口（P1-①）：触发次数 + 触发任务的补落效果（task_records 中 pinned ≥3 占比）
  console.log(`① 密度守护（收口窗口）触发 ${densityWindow} 次 + finish 分支 ${densityFinish} 次`)
  const lowPinTasks = history.filter((r) => (r.pinned || 0) <= 2 && (r.searches || 0) >= 3)
  console.log(`   闭环任务中「≤2 卡且 ≥3 检索」的低密度残留: ${lowPinTasks.length}/${history.length}（T30 R2 为 3/4）`)
  const fallbacks = history.filter((r) => String(r.summary || '').startsWith('（步数上限收口）'))
  console.log(`   fallback 路径收口任务 ${fallbacks.length}/${history.length}`)
  for (const r of lowPinTasks) console.log(`   - [${r.taskId}] pinned=${r.pinned} searches=${r.searches} | ${String(r.goal).slice(0, 56)}`)

  // ② 末段任务饥饿跳过（P1-②）
  console.log(`② 饥饿跳过通知 ${starveNotices.length} 条`)
  for (const a of starveNotices) console.log(`   - ${String(a.summary).slice(0, 140)}`)
  const starvedIds = starveNotices.flatMap((a) => String(a.summary).match(/未启动/g) || [])
  const leftover = actCount((a) => String(a.summary || '').includes('未能执行'))
  console.log(`   饥饿跳过总计 ${starvedIds.length} 个任务；budgetLeftover 触发 ${leftover}（ starving 与 leftover 互斥：前者剩余 <4 步主动停，后者预算耗尽被动停）`)

  // ③ fullText 利用度（P2-③）：证据卡内容含具体数值的占比（HR/RR/OR/CI/剂量/百分比）
  const evCards = nodes.filter((n) => n.kind === 'evidence' || n.kind === 'source')
  const withNumbers = evCards.filter((n) =>
    /\b(HR|RR|OR|CI|95%|mg|岁|%)|风险(升|降|高|低)|\d+\.\d+/.test(String(n.content || '') + String(n.title || '')))
  console.log(`③ fullText 利用度：${fetchCalls} 次 pubmed_fetch；${withNumbers.length}/${evCards.length} 张卡 title/content 含具体数值（HR/RR/剂量/百分比）`)
  const numericDetail = evCards.filter((n) => /\d/.test(String(n.content || '')))
  console.log(`   content 含数字的卡 ${numericDetail.length}/${evCards.length}`)
  const nar = String(s.narrative || '')
  const narNums = (nar.match(/\b\d+\.\d+%|\bHR\b|\bRR\b|\bOR\b|95% CI|mg\/d/g) || []).length
  console.log(`   narrative 具体数值引用密度: ${narNums} 处 / ${nar.length} 字`)

  // ④ 任务轨迹全表
  console.log('④ 任务轨迹（task_records）：')
  for (const r of history) {
    console.log(`   - R${r.round} [${r.taskId}] ${String(r.goal).slice(0, 52)}`)
    console.log(`       pinned=${r.pinned} searches=${r.searches} | ${r.summary ? String(r.summary).slice(0, 110) : '（空！）'}`)
  }
  const emptySummary = history.filter((r) => !r.summary)
  console.log(`   空 summary: ${emptySummary.length}（期望 0）`)

  // ---------- T28/T29/T30 复核 ----------
  console.log('\n----- 前序防线复核 -----')
  const strategyLeads = fallbacks.filter((r) => /末段判断：(我需要调整|换个|换词|重新检索|调整策略)/.test(String(r.summary)))
  console.log(`fallback 末段判断策略性开头: ${strategyLeads.length} 条（期望 0）`)
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
  const mrCards = nodes.filter((n) => (n.tags || []).some((x: string) => /^mr$/i.test(x)))
  console.log(`MR 标签卡: ${mrCards.length} 张（本域无 MR 属正常）`)

  // ---------- 常规防线 ----------
  console.log('\n----- 常规防线 -----')
  console.log(`同题 topic↔非topic 双卡对: ${dupTopicPairs.length}${dupTopicPairs.length ? ' → ' + dupTopicPairs.map((n) => `${n.title}(${n.kind})`).join(' / ') : ' ✅'}`)
  console.log(`同源重复卡: ${dupSource.length}${dupSource.length ? ' → ' + dupSource.join(', ') : ' ✅'}`)
  console.log(`课题卡 ${(s.questions || []).length} 张:`)
  for (const q of s.questions || []) console.log(`  - ${q.recommended ? '⭐' : ' '} ${q.text.slice(0, 66)} [N${q.scores?.novelty}F${q.scores?.feasibility}I${q.scores?.impact}]`)
  console.log(`narrative: ${nar.length} 字`)
  const pmids = [...new Set((nar + ' ' + nodes.map((n) => `${n.sourceRef || ''} ${n.content || ''}`).join(' ')).match(/\b\d{7,8}\b/g) || [])]
  console.log(`全部 PMID 引用: ${pmids.join(', ')}`)
  const lv: Record<string, number> = {}
  for (const n of evCards) lv[n.level || 'null'] = (lv[n.level || 'null'] || 0) + 1
  console.log(`evidence/source 卡 level 分布: ${JSON.stringify(lv)}`)
  const planDone = (plan?.tasks || []).filter((t: any) => t.done)
  console.log(`plan: round=${plan?.round} done=${planDone.length}/${plan?.tasks?.length || 0}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
