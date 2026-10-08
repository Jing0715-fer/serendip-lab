// Task 26 E2E 驱动 Phase A：建会话 + 访谈两轮 + 确认自动调研开启，然后退出
// （等待阶段由外部短轮询完成，避免长驻后台进程被环境回收——Task 25 实证）
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
  const created = await api('/sessions', { method: 'POST', body: JSON.stringify({ lang: 'zh', title: '阿司匹林一级预防悖论' }) })
  const sid = created.session?.id
  if (!sid) { console.error('创建会话失败', created); process.exit(1) }
  console.log(`SID=${sid}`)

  const msg1 = '我在做心血管预防方向的文献梳理时遇到一个困惑：阿司匹林一级预防的获益-出血悖论。经典理论是低剂量阿司匹林抑制血小板 COX-1、降低动脉粥样硬化血栓事件，早年指南推荐中高危心血管风险人群常规使用；但近年大型 RCT 结果严重分裂——ARRIVE 显示主要终点阴性、ASCEND 显示获益被出血抵消、ASPREE 在老年人中甚至看到全因死亡率升高，而 Meta 分析和孟德尔随机化对出血-获益净值的结论也不一致。同一条「抗血小板→减少血栓→减少心血管事件」的链路为什么在不同人群里翻转？我想把这条证据链彻底梳理清楚。'
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

  const msg2 = '对象主要关注人类证据：一级预防 RCT（ARRIVE/ASCEND/ASPREE/JPAD 等）、观察性队列、孟德尔随机化都要覆盖；机制上我最想知道为什么老年人获益-风险比会翻转——是年龄相关的出血风险增长、阿司匹林反应性（resistance）变化、还是肠道微生物介导的阿司匹林代谢差异？手段偏计算与公共数据（RCT 个体数据再分析、GWAS 库、UK Biobank），不做湿实验。可以开始调研了。'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg2, lang: 'zh' }) })
  console.log('[chat 2] sent')
  const r2 = await waitReply()
  if (!r2) { console.error('访谈第二轮无回复'); process.exit(1) }
  console.log(`[chat 2] reply: ${r2.content.slice(0, 200)}`)
  console.log(`[chat 2] ready = ${JSON.stringify(r2.data)}`)

  // 等自动开研究（ready 后 6s）→ 确认 investigating
  await sleep(15_000)
  const s = await api(`/sessions/${sid}`)
  console.log(`[auto-research] phase = ${s.session?.phase}/${s.session?.status}`)
  console.log('PHASE_A_DONE')
}

main().catch((e) => { console.error(e); process.exit(1) })
