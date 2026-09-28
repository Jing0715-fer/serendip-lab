// tools.ts — §7 外部检索工具 + eutils 全局串行限速队列（≥380ms 间隔）
import { getZai } from './llm'
import { decodeEntities, sleep } from './util'

const UA = 'SerendipLab/1.0 (research-agent)'
const FETCH_TIMEOUT_MS = 25_000

// ---------- 通用网络封装：25s 超时 + UA + 429/5xx 退避重试 1 次 ----------
async function rawFetch(url: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } })
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchWithRetry(url: string): Promise<Response> {
  let res: Response
  try {
    res = await rawFetch(url)
  } catch (e) {
    // 网络错误 → 重试 1 次
    await sleep(1500)
    res = await rawFetch(url)
    return res
  }
  if (res.status === 429 || res.status >= 500) {
    await sleep(1500)
    res = await rawFetch(url)
  }
  return res
}

async function getJson(url: string): Promise<any> {
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url.slice(0, 120)}`)
  return res.json()
}

async function getText(url: string): Promise<string> {
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url.slice(0, 120)}`)
  return res.text()
}

// ---------- eutils 全局串行限速队列（相邻间隔 ≥380ms） ----------
const EUTILS_MIN_INTERVAL = 380
let eutilsChain: Promise<unknown> = Promise.resolve()
let lastEutilsAt = 0

function eutils<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = Math.max(0, EUTILS_MIN_INTERVAL - (Date.now() - lastEutilsAt))
    if (wait > 0) await sleep(wait)
    lastEutilsAt = Date.now()
    return fn()
  }
  const p = eutilsChain.then(run, run)
  eutilsChain = p.then(
    () => undefined,
    () => undefined
  )
  return p
}

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

// ---------- 工具实现 ----------
async function pubmedSearch(args: { query: string; max?: number }) {
  const query = String(args.query || '').trim()
  if (!query) return { error: '缺少 query 参数' }
  const max = Math.min(Math.max(Number(args.max) || 8, 1), 20)
  const es = await eutils(() =>
    getJson(`${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=${max}&sort=relevance&term=${encodeURIComponent(query)}`)
  )
  const ids: string[] = es?.esearchresult?.idlist || []
  const total = Number(es?.esearchresult?.count || 0)
  if (!ids.length) return { tool: 'pubmed_search', query, total: 0, results: [], note: '用 pubmed_fetch 获取摘要' }
  const sum = await eutils(() => getJson(`${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`))
  const results = ids.map((pmid) => {
    const r = sum?.result?.[pmid] || {}
    return {
      pmid: String(pmid),
      title: decodeEntities(String(r.title || '')),
      journal: r.source || '',
      year: String(r.pubdate || '').slice(0, 4),
      firstAuthor: r.sortfirstauthor || (r.authors?.[0]?.name ?? ''),
    }
  })
  return { tool: 'pubmed_search', query, total, results, note: '用 pubmed_fetch 获取摘要' }
}

async function pubmedFetch(args: { pmids: string[] | string }) {
  let pmids: string[] = Array.isArray(args.pmids) ? args.pmids : String(args.pmids || '').split(/[,;\s]+/)
  pmids = pmids.map((s) => String(s).trim()).filter(Boolean).slice(0, 5)
  if (!pmids.length) return { error: '缺少 pmids 参数（≤5 个）' }
  const xml = await eutils(() => getText(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmids.join(',')}`))
  const articles: { pmid: string; title: string; abstract: string }[] = []
  const blocks = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || []
  for (const b of blocks) {
    const pmidM = b.match(/<PMID[^>]*>(\d+)<\/PMID>/)
    const titleM = b.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/)
    const absParts = [...b.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)].map((m) => m[1])
    let abstract = decodeEntities(absParts.join(' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    if (abstract.length > 700) abstract = abstract.slice(0, 700) + '…'
    articles.push({
      pmid: pmidM ? pmidM[1] : '',
      title: decodeEntities(String(titleM?.[1] || '').replace(/<[^>]+>/g, '')),
      abstract,
    })
  }
  if (!articles.length) return { error: 'efetch 未解析到文章（XML 格式异常或无结果）' }
  return { articles }
}

async function europepmcSearch(args: { query: string; max?: number }) {
  const query = String(args.query || '').trim()
  if (!query) return { error: '缺少 query 参数' }
  const max = Math.min(Math.max(Number(args.max) || 8, 1), 20)
  const j = await getJson(
    `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(query)}&format=json&pageSize=${max}&resultType=core`
  )
  const list = j?.resultList?.result || []
  const results = list.map((r: any) => ({
    pmid: r?.pmid ? String(r.pmid) : r?.id ? String(r.id) : '',
    title: String(r?.title || ''),
    abstract: String(r?.abstractText || '').slice(0, 600),
    journal: r?.journalTitle || r?.journal || '',
    year: String(r?.pubYear || r?.firstPublicationDate || '').slice(0, 4),
    citations: Number(r?.citedByCount || 0),
    openAccess: r?.isOpenAccess === 'Y' || r?.isOpenAccess === true,
  }))
  return { total: Number(j?.hitCount || 0), results }
}

async function openalexSearch(args: { query: string; max?: number }) {
  const query = String(args.query || '').trim()
  if (!query) return { error: '缺少 query 参数' }
  const max = Math.min(Math.max(Number(args.max) || 8, 1), 20)
  const j = await getJson(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${max}&mailto=serendip%40example.com&select=id,doi,title,publication_year,cited_by_count,primary_location`
  )
  const results = (j?.results || []).map((w: any) => ({
    title: w?.title || '',
    year: w?.publication_year || null,
    citations: w?.cited_by_count || 0,
    journal: w?.primary_location?.source?.display_name || '',
    doi: w?.doi || '',
  }))
  return { results }
}

async function uniprotSearch(args: { query: string; max?: number }) {
  const query = String(args.query || '').trim()
  if (!query) return { error: '缺少 query 参数' }
  const max = Math.min(Math.max(Number(args.max) || 5, 1), 10)
  const j = await getJson(
    `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(query)}&format=json&size=${max}&fields=accession,id,protein_name,gene_names,organism_name,cc_function`
  )
  const results = (j?.results || []).map((p: any) => {
    let fn = ''
    for (const c of p?.comments || []) {
      if (c?.commentType === 'FUNCTION') {
        fn = (c?.texts || []).map((t: any) => t?.value || '').join(' ')
        break
      }
    }
    return {
      accession: p?.primaryAccession || '',
      name: p?.proteinDescription?.recommendedName?.fullName?.value || p?.id || '',
      gene: (p?.genes || []).map((g: any) => g?.geneName?.value).filter(Boolean).join(', '),
      organism: p?.organism?.scientificName || '',
      function: String(fn).slice(0, 400),
    }
  })
  return { proteins: results }
}

async function ncbiGene(args: { term: string; max?: number }) {
  const term = String(args.term || '').trim()
  if (!term) return { error: '缺少 term 参数' }
  const max = Math.min(Math.max(Number(args.max) || 5, 1), 10)
  const es = await eutils(() =>
    getJson(`${EUTILS}/esearch.fcgi?db=gene&retmode=json&retmax=${max}&term=${encodeURIComponent(term)}`)
  )
  const ids: string[] = es?.esearchresult?.idlist || []
  if (!ids.length) return { genes: [] }
  const sum = await eutils(() => getJson(`${EUTILS}/esummary.fcgi?db=gene&retmode=json&id=${ids.join(',')}`))
  const genes = ids.map((id) => {
    const r = sum?.result?.[id] || {}
    return {
      geneId: String(id),
      symbol: r.name || '',
      description: r.description || '',
      organism: r?.organism?.scientificname || r?.organism?.name || '',
    }
  })
  return { genes }
}

async function pdbSearch(args: { term: string; max?: number }) {
  const term = String(args.term || '').trim()
  if (!term) return { error: '缺少 term 参数' }
  const max = Math.min(Math.max(Number(args.max) || 5, 1), 10)
  const q = {
    query: { type: 'terminal', service: 'text', parameters: { value: term } },
    return_type: 'entry',
    request_options: { paginate: { start: 0, rows: max } },
  }
  const j = await getJson(`https://search.rcsb.org/rcsbsearch/v2/query?json=${encodeURIComponent(JSON.stringify(q))}`)
  const total = Number(j?.total_count || 0)
  const hits = (j?.result_set || []).slice(0, max)
  const entries: { id: string; title: string }[] = []
  for (const h of hits.slice(0, 3)) {
    const id = h?.identifier
    if (!id) continue
    let title = ''
    try {
      const e = await getJson(`https://data.rcsb.org/rest/v1/core/entry/${id}`)
      title = e?.rcsb_entry_info?.title || e?.struct?.title || ''
    } catch {
      // 失败忽略
    }
    entries.push({ id, title })
  }
  for (const h of hits.slice(3)) {
    if (h?.identifier) entries.push({ id: h.identifier, title: '' })
  }
  return { total, entries }
}

async function taxonomySearch(args: { term: string; max?: number }) {
  const term = String(args.term || '').trim()
  if (!term) return { error: '缺少 term 参数' }
  const max = Math.min(Math.max(Number(args.max) || 3, 1), 10)
  const es = await eutils(() =>
    getJson(`${EUTILS}/esearch.fcgi?db=taxonomy&retmode=json&retmax=${max}&term=${encodeURIComponent(term)}`)
  )
  const ids: string[] = es?.esearchresult?.idlist || []
  if (!ids.length) return { taxa: [] }
  const sum = await eutils(() => getJson(`${EUTILS}/esummary.fcgi?db=taxonomy&retmode=json&id=${ids.join(',')}`))
  const taxa = ids.map((id) => {
    const r = sum?.result?.[id] || {}
    return {
      taxid: String(id),
      scientificName: r.scientificname || '',
      commonName: r.commonname || '',
      rank: r.rank || '',
      lineage: r.lineage || '',
    }
  })
  return { taxa }
}

async function clinvarSearch(args: { term: string; max?: number }) {
  const term = String(args.term || '').trim()
  if (!term) return { error: '缺少 term 参数' }
  const max = Math.min(Math.max(Number(args.max) || 5, 1), 10)
  const es = await eutils(() =>
    getJson(`${EUTILS}/esearch.fcgi?db=clinvar&retmode=json&retmax=${max}&term=${encodeURIComponent(term)}`)
  )
  const ids: string[] = es?.esearchresult?.idlist || []
  if (!ids.length) return { variants: [] }
  const sum = await eutils(() => getJson(`${EUTILS}/esummary.fcgi?db=clinvar&retmode=json&id=${ids.join(',')}`))
  // 尽力映射：字段解析失败就只给 title 列表
  const variants = ids.map((id) => {
    const r = sum?.result?.[id] || {}
    let title = r.title || r.spdi || r.name || ''
    if (!title) {
      // clinvar esummary 常见结构: {uid, accession, title: {...}} 或 description 字段
      title = r?.description || r?.variation_set?.[0]?.name || String(r.accession || id)
    }
    return { id: String(id), title: decodeEntities(String(title)) }
  })
  return { variants }
}

async function webSearch(args: { query: string; num?: number; recency_days?: number }) {
  const query = String(args.query || '').trim()
  if (!query) return { error: '缺少 query 参数' }
  const num = Math.min(Math.max(Number(args.num) || 8, 1), 10)
  const z = await getZai()
  const items = await z.functions.invoke('web_search', {
    query,
    num,
    ...(args.recency_days ? { recency_days: Number(args.recency_days) } : {}),
  })
  const results = (items || []).map((it: any) => ({
    title: it?.name || '',
    url: it?.url || '',
    snippet: String(it?.snippet || '').slice(0, 200),
    host: it?.host_name || '',
    date: it?.date || '',
  }))
  return { results }
}

async function webRead(args: { url: string }) {
  const url = String(args.url || '').trim()
  if (!/^https?:\/\//i.test(url)) return { error: '非法 URL' }
  const z = await getZai()
  const result = await z.functions.invoke('page_reader', { url })
  const d = result?.data || {}
  let text = String(d.html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > 1800) text = text.slice(0, 1800) + '…'
  return { title: d.title || '', url: d.url || url, text }
}

// ---------- 工具注册表 ----------
export type ToolSpec = {
  name: string
  params: string
  usage: string
  returns: string
  run: (args: any) => Promise<unknown>
}

export const EXTERNAL_TOOLS: ToolSpec[] = [
  {
    name: 'pubmed_search',
    params: '{query: string, max?: number=8}',
    usage: '检索 PubMed 文献（标题/期刊/年份/一作）',
    returns: '{total, results:[{pmid,title,journal,year,firstAuthor}]}',
    run: pubmedSearch,
  },
  {
    name: 'pubmed_fetch',
    params: '{pmids: string[]}（≤5 个）',
    usage: '获取 PubMed 文章摘要全文（配合 pubmed_search 的 pmid 深读）',
    returns: '{articles:[{pmid,title,abstract}]}',
    run: pubmedFetch,
  },
  {
    name: 'europepmc_search',
    params: '{query: string, max?: number=8}',
    usage: '检索 Europe PMC（含摘要、引用数、开放获取标记）',
    returns: '{total, results:[{pmid,title,abstract,journal,year,citations,openAccess}]}',
    run: europepmcSearch,
  },
  {
    name: 'openalex_search',
    params: '{query: string, max?: number=8}',
    usage: '检索 OpenAlex（文献热度/引用数，判断领域活跃度）',
    returns: '{results:[{title,year,citations,journal,doi}]}',
    run: openalexSearch,
  },
  {
    name: 'uniprot_search',
    params: '{query: string, max?: number=5}',
    usage: '检索 UniProt 蛋白（功能注释/基因/物种）',
    returns: '{proteins:[{accession,name,gene,organism,function}]}',
    run: uniprotSearch,
  },
  {
    name: 'ncbi_gene',
    params: '{term: string, max?: number=5}',
    usage: '检索 NCBI Gene 数据库（基因符号/描述/物种）',
    returns: '{genes:[{geneId,symbol,description,organism}]}',
    run: ncbiGene,
  },
  {
    name: 'pdb_search',
    params: '{term: string, max?: number=5}',
    usage: '检索 RCSB PDB 结构（蛋白三维结构条目）',
    returns: '{total, entries:[{id,title}]}',
    run: pdbSearch,
  },
  {
    name: 'taxonomy_search',
    params: '{term: string, max?: number=3}',
    usage: '检索 NCBI Taxonomy（物种分类）',
    returns: '{taxa:[{taxid,scientificName,commonName,rank,lineage}]}',
    run: taxonomySearch,
  },
  {
    name: 'clinvar_search',
    params: '{term: string, max?: number=5}',
    usage: '检索 ClinVar 临床变异',
    returns: '{variants:[{id,title}]}',
    run: clinvarSearch,
  },
  {
    name: 'web_search',
    params: '{query: string, num?: number=8, recency_days?: number}',
    usage: '通用 Web 搜索（新闻、数据库外信息、综述入口）',
    returns: '{results:[{title,url,snippet,host,date}]}',
    run: webSearch,
  },
  {
    name: 'web_read',
    params: '{url: string}',
    usage: '读取网页正文（对搜索结果深读，取前 1800 字符）',
    returns: '{title, url, text}',
    run: webRead,
  },
]

export function findExternalTool(name: string): ToolSpec | undefined {
  return EXTERNAL_TOOLS.find((t) => t.name === name)
}

/** 生成 investigator 提示词中的工具文档 */
export function toolsDoc(includeGraph: boolean): string {
  const lines = EXTERNAL_TOOLS.map((t) => `- ${t.name} | 参数 ${t.params} | 用途：${t.usage} | 返回：${t.returns}`)
  if (includeGraph) {
    lines.push(
      '- add_evidence | 参数 {kind: question/hypothesis/evidence/insight/source/gap, title(≤60字), content(≤400字), detail?(≤1200字，2-4句向用户解释该证据的含义与重要性), sourceUrl?(原文链接), sourceRef?(可识别格式如 PMID:123456 / DOI:10.x / UniProt:P04406), tags?, confidence?(0-1)} | 用途：把确认的事实/假说/洞见钉上证据墙（detail+sourceRef 会在卡片详情中展示并支持点击打开原文） | 返回：{ok, nodeId}',
      '- link_evidence | 参数 {from: 节点id或标题, to: 节点id或标题, relation: supports/contradicts/relates/derives/answers, label?} | 用途：连接证据与假说/问题 | 返回：{ok} 或 {error, candidates}',
      '- update_evidence | 参数 {title, patch:{confidence?, content?, status?, tags?}} | 用途：更新已有证据 | 返回：{ok}',
      '- note_gap | 参数 {question, why} | 用途：记录未解之谜/空白 | 返回：{ok, nodeId}',
      '- ask_user | 参数 {question, context?} | 用途：向用户要只有 ta 知道的信息（调查暂停等待） | 返回：{ok, question}',
      '- finish_task | 参数 {summary} | 用途：结束当前任务并总结 | 返回：{ok}'
    )
  }
  return lines.join('\n')
}
