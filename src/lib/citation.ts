// citation.ts — 引用标识 → 可点击原文链接的解析器
// 支持：PMID / PMC / DOI / UniProt / PDB / OpenAlex / NCBI Gene / arXiv
// 兜底顺序：显式 sourceUrl > sourceRef 模式识别

export function resolveCitationUrl(
  sourceRef: string | null | undefined,
  sourceUrl: string | null | undefined
): string | null {
  if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) return sourceUrl;
  if (!sourceRef) return null;
  const s = sourceRef.trim();
  if (!s) return null;

  let m: RegExpMatchArray | null;

  // PMID: 123456 / PMID:123456 / PubMed: 123456
  m = s.match(/(?:PMID|PubMed)[:\s#]*(\d{4,9})\b/i);
  if (m) return `https://pubmed.ncbi.nlm.nih.gov/${m[1]}/`;

  // PMC123456 / PMC: 123456
  m = s.match(/PMC[:\s]*(\d{4,9})\b/i);
  if (m) return `https://pmc.ncbi.nlm.nih.gov/articles/PMC${m[1]}/`;

  // DOI: 10.xxxx/yyy（遇空白/引号/括号终止）
  m = s.match(/\b(10\.\d{4,9}\/[^\s"')\]、，。；]+)[.,;]?\s*$/i) ?? s.match(/\b(10\.\d{4,9}\/[^\s"')\]、，。；]+)/i);
  if (m) return `https://doi.org/${m[1]}`;

  // UniProt: P04406 / UniProt accession
  m = s.match(/UniProt[:\s]*([OPQ]\d[A-Z0-9]{3}\d|[A-NR-Z]\d([A-Z]|\d)[A-Z0-9]{2}\d)\b/i);
  if (m) return `https://www.uniprot.org/uniprotkb/${m[1].toUpperCase()}`;

  // PDB: 1ABC / PDB 4HHB
  m = s.match(/PDB[:\s]*([0-9A-Za-z]{4})\b/i);
  if (m) return `https://www.rcsb.org/structure/${m[1].toUpperCase()}`;

  // OpenAlex: W1234567890
  m = s.match(/\b(W\d{6,14})\b/);
  if (m) return `https://openalex.org/works/${m[1]}`;

  // NCBI Gene: Gene: 5450
  m = s.match(/(?:GeneID|NCBI Gene|Gene)[:\s]*(\d{2,10})\b/i);
  if (m) return `https://www.ncbi.nlm.nih.gov/gene/${m[1]}`;

  // arXiv: 2401.12345
  m = s.match(/arXiv[:\s]*([\d.]{5,12}|[a-z-]+\/\d{7})/i);
  if (m) return `https://arxiv.org/abs/${m[1]}`;

  // Europe PMC ID: 12345 / EPMC: 12345
  m = s.match(/(?:EuropePMC|EPMC)[:\s]*(\d{4,9})\b/i);
  if (m) return `https://europepmc.org/article/MED/${m[1]}`;

  return null;
}

/** 引用徽章的短文本：截断到适合一行的长度 */
export function citationLabel(sourceRef: string): string {
  const s = sourceRef.trim();
  return s.length > 44 ? `${s.slice(0, 42)}…` : s;
}
