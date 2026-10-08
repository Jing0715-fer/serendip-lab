// Task 28 单元验证：有机矛盾确定性钩子 oppositeEvidencePairs 的方向相反检测
// （finish_task 收口点接线由 E2E 验证；此处验证启发式本身的行为边界）
import { createSession, deleteSession } from '../src/db'
import { AgentRuntime } from '../src/runtime'

let pass = 0
let fail = 0
const t = (name: string, cond: boolean) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name}`) }
}

const sid = createSession('t28-verify-contradict-hook', 'zh').id
const rt = AgentRuntime.get(sid) as any

const det = (obs: string[], thoughts: string[] = []): boolean =>
  rt.oppositeEvidencePairs(obs.map((o) => ({ thought: '', action: { tool: 'pubmed_search', args: {} }, observation: o }))
    .concat(thoughts.map((th) => ({ thought: th, action: { tool: 'x', args: {} }, observation: '' }))))

try {
  console.log('[1] 反向证据对检测')
  t('观察性获益 vs MR 零因果（英文）',
    det(['Cohort: moderate alcohol intake was associated with reduced risk of cardiovascular disease.',
      'Mendelian randomization found no association between alcohol intake and CVD risk.']))
  t('干预获益 vs 出血风险升高（英文）',
    det(['Daily aspirin reduced risk of colorectal cancer in the trial.',
      'Aspirin increased risk of major bleeding compared to placebo.']))
  t('中文：降低风险 vs 增加死亡率',
    det(['适度饮酒与全因死亡风险降低相关', 'MR 分析显示无因果保护作用，重度饮酒增加死亡率']))
  t('thought 单独承载反向对（观察为空）',
    det([], ['队列研究显示保护作用，但 RCT 显示无效且有害']))

  console.log('[2] 单方向不应触发')
  t('仅获益向 → false', det(['Meta-analysis: reduced risk of all-cause mortality with moderate intake.']) === false)
  t('仅损害向 → false', det(['Heavy drinking increased risk of liver cirrhosis.']) === false)
  t('空 scratchpad → false', det([]) === false)

  console.log('[3] 已知误报类（可接受，模型可拒绝）')
  t('无关暴露的措辞重叠 → true（按设计放行，由模型判定非真冲突）',
    det(['Smoking increased risk of lung cancer in cohort A.', 'Physical activity reduced risk of fracture in cohort B.']))

  console.log('[4] 超长观察截断保护（30k 上限不抛错）')
  t('30k+ 文本安全返回布尔值', typeof det([`${'filler '.repeat(8000)} reduced risk and increased risk`]) === 'boolean')
} finally {
  deleteSession(sid)
}

console.log(`\n结果: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
