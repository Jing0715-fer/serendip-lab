// Task 28 E2E 驱动 Phase A：建会话 + 访谈两轮，然后退出（外部短轮询防进程回收）
// 第十一领域：酒精 J 形曲线悖论——前瞻性队列一致显示适度饮酒获益 vs 孟德尔随机化线性有害/无保护窗口
// 领域选择动机：本域科学内核就是「队列获益 vs MR 零因果」的正面冲突——P1-② 有机矛盾钩子的天然试金石
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
  const created = await api('/sessions', { method: 'POST', body: JSON.stringify({ lang: 'zh', title: '酒精J形曲线悖论' }) })
  const sid = created.session?.id
  if (!sid) { console.error('创建会话失败', created); process.exit(1) }
  console.log(`SID=${sid}`)

  const msg1 = '我在做心血管流行病学方向的文献梳理，遇到酒精摄入的 J 形曲线悖论。数十年前瞻性队列（医师健康研究、护士健康研究、Ronksley 2011 BMJ 荟萃 44 项队列）一致显示：与不饮酒者相比，适度饮酒者的全因死亡与冠心病风险更低，形成经典 J 形曲线；酒精升高 HDL-C、降低纤维蛋白原，机制上似乎也说得通。但孟德尔随机化给出了相反答案——Millwood 2019 BMJ（中国慢性病前瞻性研究 50 万人，ALDH2 rs671 工具变量）显示卒中风险随基因预测摄入量线性上升、没有任何保护窗口；西方 CAD consortium 的 MR 也未复制出冠心病保护；2018 Lancet GBD 分析更是宣称「安全剂量为零」。同一暴露，换了研究设计结论就翻转——我想把这条证据链彻底拆解清楚。'
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

  const msg2 = '证据全谱要求：①前瞻性队列与荟萃（重点看参照组构成——从不饮酒者 vs 戒酒者是否被合并成「不饮酒」组）；②孟德尔随机化（东亚 ALDH2 rs671 / ADH1B 与西方多基因评分工具，关注多效性与弱工具问题）；③机制层证据（HDL-C、纤维蛋白原、血压对酒精剂量的反应曲线，以及饮酒模式维度——同周总量下集中暴饮 vs 每日规律的差异）。我的核心困惑是：J 形曲线究竟是真实生物学，还是 sick-quitter 效应（病人因病因戒酒被并进参照组）与健康使用者混杂制造的假象？手段偏公共数据汇总统计（GWAS/UK Biobank/CKB），不做湿实验。'
  await api(`/sessions/${sid}/chat`, { method: 'POST', body: JSON.stringify({ text: msg2, lang: 'zh' }) })
  console.log('[chat 2] sent')
  const r2 = await waitReply()
  if (!r2) { console.error('访谈第二轮无回复'); process.exit(1) }
  console.log(`[chat 2] reply: ${r2.content.slice(0, 200)}`)
  console.log(`[chat 2] ready = ${JSON.stringify(r2.data)}`)
  console.log('PHASE_A_DONE')
}

main().catch((e) => { console.error(e); process.exit(1) })
