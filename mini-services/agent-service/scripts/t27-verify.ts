// Task 27 快速验证：① add_evidence 缺 level 警告 + meta 误用 evidence 提示 ② truncObs 每工具限额
import { createSession, deleteSession, listNodes } from '../src/db'
import { AgentRuntime } from '../src/runtime'
import { truncObs } from '../src/util'

let pass = 0
let fail = 0
const t = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const sid = createSession('t27-verify', 'zh').id
const rt = AgentRuntime.get(sid) as any
try {
  console.log('[1] add_evidence 缺 level 警告')
  const r1 = rt.toolAddEvidence({ kind: 'evidence', title: '维生素D预防子痫前期的网络荟萃分析', content: '网络meta分析纳入12项RCT' })
  const w1 = (r1?.warnings || []).join('|')
  t('缺 level 警告出现', r1?.ok === true && /level/.test(w1))
  t('meta 误用 evidence 提示出现', /source/.test(w1))

  console.log('[2] 正常带 level 的卡无警告')
  const r2 = rt.toolAddEvidence({ kind: 'evidence', title: 'PURE 队列高乳制品摄入与死亡率', content: '18国前瞻队列', sourceRef: 'PMID:28864332', level: 'cohort' })
  t('无 warnings 字段', r2?.ok === true && !r2?.warnings)

  console.log('[3] update_evidence 补 level')
  rt.toolUpdateEvidence({ title: '维生素D预防子痫前期的网络荟萃分析', patch: { level: 'rct' } })
  const nodes = listNodes(sid)
  const patched = nodes.find((n: any) => n.title.includes('子痫前期'))
  t('level 补标成功', patched?.level === 'rct')

  console.log('[4] truncObs 限额')
  const long = { articles: Array.from({ length: 4 }, (_, i) => ({ pmid: 10000000 + i, abstract: 'x'.repeat(1200) })) }
  t('默认 1600 截断', truncObs(long).length <= 1600)
  t('fetch 限额 6000 不截断（完整保留）', truncObs(long, 6000).length === JSON.stringify(long).length)
} finally {
  deleteSession(sid)
}
console.log(`\n结果: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
