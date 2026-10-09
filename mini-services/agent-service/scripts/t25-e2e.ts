// Task 25 E2E 驱动：第八领域真实任务（膳食饱和脂肪与心血管疾病）
// 走 Caddy 网关 :81 + XTransformPort=3002，模拟真实用户访谈 → 自动调研 → 度量采集
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
  // 1. 建会话（中文）
  const created = await api('/sessions', { method: 'POST', body: JSON.stringify({ lang: 'zh', title: '饱和脂肪悖论' }) })
  const sid = created.session?.id
  if (!sid) { console.error('创建会话失败', created); process.exit(1) }
  console.log(`session = ${sid}`)

  // 2. 访谈第一轮
  const msg1 = '我最近读营养流行病学文献很困惑：教科书和膳食指南说饱和脂肪升高 LDL、促进动脉粥样硬化，要限制摄入；但近几年大型队列（比如 PURE 研究）和一些 meta 分析发现乳制品来源的饱和脂肪与心血管事件中性甚至负相关，孟德尔随机化结果也不一致。为什么同一条「饱和脂肪→LDL→CVD」链路的证据这么分裂？我想把这条证据链梳理清楚。'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg1, lang: 'zh' }) })
  console.log('[chat 1] sent — waiting reply')

  // 等 assistant 回复
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
  console.log(`[chat 1] reply: ${r1.content.slice(0, 150)}`)

  // 3. 访谈第二轮（补充取向，触发 ready）
  const msg2 = '对象主要关注人类证据：前瞻队列、RCT 喂养试验、孟德尔随机化都要覆盖；机制上我最想知道为什么乳制品来源和肉类/黄油来源的饱和脂肪效应不同——是脂质组学差异（奇链脂肪酸 C15:0/C17:0）、发酵基质、还是钙的干扰？手段偏计算与公共数据（UK Biobank、GWAS 库），不做湿实验。可以开始调研了。'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg2, lang: 'zh' }) })
  console.log('[chat 2] sent — waiting reply/ready')
  const r2 = await waitReply()
  if (!r2) { console.error('访谈第二轮无回复'); process.exit(1) }
  console.log(`[chat 2] reply: ${r2.content.slice(0, 200)}`)
  console.log(`[chat 2] ready = ${JSON.stringify(r2.data)}`)

  // 4. 等自动开研究（ready 后 6s）并轮询至完成
  console.log('— waiting auto research —')
  const t0 = Date.now()
  let phaseLog = ''
  for (;;) {
    await sleep(20_000)
    const s = await api(`/sessions/${sid}`)
    const phase = `${s.session?.phase}/${s.session?.status}`
    if (phase !== phaseLog) { phaseLog = phase; console.log(`[${Math.round((Date.now() - t0) / 1000)}s] phase = ${phase} | steps ${s.stats?.stepsUsed ?? '-'}/${s.stats?.maxSteps ?? '-'} | nodes ${(s.nodes || []).length}`) }
    if (s.session?.phase === 'done') { console.log('research done'); break }
    if (Date.now() - t0 > 26 * 60_000) { console.log('TIMEOUT 26min — collecting anyway'); break }
  }

  // 5. 度量采集
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
  // 同题 topic↔非topic 双卡对（应为 0）
  const topicTitles = new Set(nodes.filter((n) => n.kind === 'topic').map((n) => norm(n.title)))
  const dupTopicPairs = nodes.filter((n) => n.kind !== 'topic' && topicTitles.has(norm(n.title)))
  // 同源重复卡（应为 0）
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
  const seen = new Map<string, number>()
  const dupSource: string[] = []
  for (const n of nodes.filter((n) => n.kind === 'evidence' || n.kind === 'source')) {
    const k = keyOf(n)
    if (!k) continue
    if (seen.has(k)) dupSource.push(`${k}: ${seen.get(k)} & ${n.id}`)
    else seen.set(k, n.id)
  }

  const actCount = (pred: (a: any) => boolean) => acts.filter(pred).length
  const batchCalls = actCount((a) => a.type === 'tool_call' && a.tool === 'batch_cards')
  const addCalls = actCount((a) => a.type === 'tool_call' && a.tool === 'add_evidence')
  const askUser = actCount((a) => a.type === 'tool_call' && a.tool === 'ask_user')
  const densityGuards = actCount((a) => String(a.summary || '').includes('密度守护'))
  const pinGuards = actCount((a) => String(a.summary || '').includes('落墙守护'))
  const promotes = actCount((a) => String(a.summary || '').includes('课题卡升格'))
  const merges = actCount((a) => String(a.summary || '').includes('同源合并'))

  const doneTasks = (plan?.tasks || []).filter((t: any) => t.done)
  const wallPins = (byKind.evidence || 0) + (byKind.source || 0)
  const pmids = [...new Set((s.narrative || '').match(/\b\d{7,8}\b/g) || [])].slice(0, 12)

  console.log('\n========== E2E 度量 ==========')
  console.log(`节点 ${nodes.length}: ${JSON.stringify(byKind)}`)
  console.log(`边 ${edges.length}: ${JSON.stringify(byRel)}`)
  console.log(`任务: ${doneTasks.length}/${(plan?.tasks || []).length} 完成`)
  console.log(`证据密度: ${(doneTasks.length ? (wallPins / doneTasks.length).toFixed(2) : 'n/a')} 卡/任务 (evidence+source=${wallPins})`)
  console.log(`batch_cards 调用: ${batchCalls} | add_evidence 调用: ${addCalls}`)
  console.log(`密度守护: ${densityGuards} | 落墙守护: ${pinGuards} | 课题升格: ${promotes} | 同源合并: ${merges} | ask_user: ${askUser}`)
  console.log(`同题 topic↔非topic 双卡对: ${dupTopicPairs.length}${dupTopicPairs.length ? ' → ' + dupTopicPairs.map((n) => n.title).join(' / ') : ' ✅'}`)
  console.log(`同源重复卡: ${dupSource.length}${dupSource.length ? ' → ' + dupSource.join(' / ') : ' ✅'}`)
  console.log(`课题卡: ${(s.questions || []).length} 张; 推荐: ${(s.questions || []).filter((q: any) => q.recommended).map((q: any) => q.text.slice(0, 40)).join(' | ')}`)
  console.log(`narrative: ${(s.narrative || '').length} 字; PMID 样本: ${pmids.join(', ')}`)
  console.log(`\nSID=${sid}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
