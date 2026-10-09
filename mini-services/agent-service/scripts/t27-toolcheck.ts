// Task 27 工具级验证：① pubmed_fetch 摘要完整性（E2E 中被模型抱怨「不完整」连调 3 次）
//                       ② 零命中自愈提示（过度约束查询）
import { findExternalTool } from '../src/tools'

async function main() {
  // ① E2E 中被抱怨的三篇
  const fetchTool = findExternalTool('pubmed_fetch')!
  const r1 = (await fetchTool.run({ pmids: ['24953955', '34034786', '26399451'] })) as any
  console.log('===== pubmed_fetch（E2E 抱怨的三篇）=====')
  for (const a of r1.articles || []) {
    const ab = String(a.abstract || '')
    console.log(`PMID ${a.pmid}: abstract=${ab.length} 字 | 开头: ${ab.slice(0, 80)}`)
  }

  // ② 零命中自愈：过度约束查询（8 个 AND 子句）
  const searchTool = findExternalTool('pubmed_search')!
  const r2 = (await searchTool.run({ query: 'vitamin D paradox AND reverse causation AND VDBP AND randomized AND mendelian AND inflammation AND biomarker AND threshold', max: 5 })) as any
  console.log('\n===== pubmed_search 零命中自愈 =====')
  console.log(`total=${r2.total}`)
  console.log(`note=${r2.note}`)
  // 对照：放宽后的查询应能命中
  const r3 = (await searchTool.run({ query: 'vitamin D supplementation reverse causation', max: 3 })) as any
  console.log(`\n对照放宽查询 total=${r3.total}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
