// Task 27 E2E 驱动 Phase A：建会话 + 访谈两轮，然后退出
// （等待阶段由外部短轮询完成，避免长驻后台进程被环境回收——Task 25/26 实证）
// 第十领域：维生素D补充悖论——观察性关联普遍阳性 vs 大型RCT补充Null vs MR分歧
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
  const created = await api('/sessions', { method: 'POST', body: JSON.stringify({ lang: 'zh', title: '维生素D补充悖论' }) })
  const sid = created.session?.id
  if (!sid) { console.error('创建会话失败', created); process.exit(1) }
  console.log(`SID=${sid}`)

  const msg1 = '我在做营养流行病学方向的文献梳理时遇到一个经典困惑：维生素D补充的悖论。观察性研究里低血清 25(OH)D 几乎与一切不良结局强相关——心血管病、癌症、2型糖尿病、全因死亡率，部分孟德尔随机化甚至支持因果方向；但维生素D补充的大型随机对照试验（VITAL 近2.6万人、ViDA、D2d 等）对绝大多数硬终点都是阴性。同一条「低维D→疾病」的链路，为什么换了研究设计就消失了？我想把这条证据链彻底梳理清楚。'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg1, lang: 'zh' }) })
  console.log('[chat 1] sent')

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
  console.log(`[chat 1] reply: ${r1.content.slice(0, 160)}`)

  const msg2 = '对象主要关注人类证据全谱：补充 RCT（VITAL/ViDA/D2d 及个体数据再分析）、前瞻性队列与 consortia 汇总（如 CHARGE、UK Biobank 队列）、孟德尔随机化（GWAS 遗传工具）；机制上我最想知道的是「关联为何是假的」——是反向因果（疾病与炎症本身压低 25(OH)D、健康使用者效应）还是生物利用度混淆（VDBP 维D结合蛋白、总 vs 游离 25(OH)D、检测方法偏差），还是剂量与基线水平问题（RCT 参与者基线并不低）？手段偏计算与公共数据（GWAS 汇总统计、UK Biobank、RCT 再分析），不做湿实验。'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg2, lang: 'zh' }) })
  console.log('[chat 2] sent')
  const r2 = await waitReply()
  if (!r2) { console.error('访谈第二轮无回复'); process.exit(1) }
  console.log(`[chat 2] reply: ${r2.content.slice(0, 200)}`)
  console.log(`[chat 2] ready = ${JSON.stringify(r2.data)}`)
  console.log('PHASE_A_DONE')
}

main().catch((e) => { console.error(e); process.exit(1) })
