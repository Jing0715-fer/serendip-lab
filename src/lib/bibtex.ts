// bibtex.ts — 证据墙文献源 → BibTeX 文献库导出（Task 17 新功能）
//
// 目标：把墙上的文献源卡（以及任何带可解析引用标识的证据卡）一键导出为 .bib，
// 可直接导入 Zotero / JabRef / EndNote 等文献管理器，衔接「证据墙 → 写作」的最后一公里。
//
// 识别的标识：PMID / PMC / DOI / OpenAlex / UniProt / PDB（与 citation.ts 同一套模式）；
// 有 sourceUrl 的卡作为 @misc 收录。PMID/DOI/PMC 视为期刊文献 → @article（附 pmid/doi 字段），
// 数据库条目（UniProt/PDB/OpenAlex）与纯 URL → @misc。按标识/URL 去重。

import { resolveCitationUrl } from './citation';
import type { BoardNode } from './types';

export type BibIdentifierType = 'pmid' | 'pmc' | 'doi' | 'openalex' | 'uniprot' | 'pdb';

export type BibEntry = {
  /** BibTeX cite key（文件内唯一） */
  key: string;
  /** @article（期刊文献）/ @misc（数据库条目或网页） */
  type: 'article' | 'misc';
  title: string;
  /** 卡片正文摘要（截断），作为 note 带走 */
  note: string;
  url: string;
  tags: string[];
  identifier: { type: BibIdentifierType; value: string } | null;
};

/** sourceRef → 结构化标识（独立于 citation.ts 的 URL 解析，.bib 需要分类型字段） */
function parseIdentifier(ref: string | null | undefined): BibEntry['identifier'] {
  if (!ref) return null;
  const s = ref.trim();
  if (!s) return null;

  let m: RegExpMatchArray | null;

  m = s.match(/(?:PMID|PubMed)[:\s#]*(\d{4,9})\b/i);
  if (m) return { type: 'pmid', value: m[1] };

  m = s.match(/PMC[:\s]*(\d{4,9})\b/i);
  if (m) return { type: 'pmc', value: m[1] };

  m =
    s.match(/\b(10\.\d{4,9}\/[^\s"')\]、，。；]+)[.,;]?\s*$/i) ??
    s.match(/\b(10\.\d{4,9}\/[^\s"')\]、，。；]+)/i);
  if (m) return { type: 'doi', value: m[1] };

  m = s.match(/UniProt[:\s]*([OPQ]\d[A-Z0-9]{3}\d|[A-NR-Z]\d([A-Z]|\d)[A-Z0-9]{2}\d)\b/i);
  if (m) return { type: 'uniprot', value: m[1].toUpperCase() };

  m = s.match(/PDB[:\s]*([0-9A-Za-z]{4})\b/i);
  if (m) return { type: 'pdb', value: m[1].toUpperCase() };

  m = s.match(/\b(W\d{6,14})\b/);
  if (m) return { type: 'openalex', value: m[1] };

  return null;
}

/** BibTeX 字段值转义：花括号与 % 会被 TeX/BibTeX 解释，反斜杠直接剔除（正文里不该有） */
function bibEscape(raw: string): string {
  return raw
    .replace(/\\/g, '')
    .replace(/([{}%])/g, '\\$1')
    // 多行压平为一行（note 里允许空格）
    .replace(/\s*\n\s*/g, ' ');
}

/** 标识符值 → ASCII 安全片段：非字母数字压成下划线，截断长度 */
function asciiStem(raw: string, max = 40): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
}

/**
 * 标题/标识符 → ASCII 安全的 cite key（兼容经典 LaTeX/BibTeX 工具链，非 ASCII 字符会导致编译失败）：
 *  1) 有文献标识 → serendip_pmid_37673907 / serendip_doi_10_1038_xxx（同标识已去重，天然唯一）
 *  2) 否则取标题前几个「有分量」的 ASCII 词（中文等非 ASCII 字符直接丢弃）snake_case
 *  3) 兜底 serendip_source_N
 *  注：非 ASCII（如中文标题）可能过滤后无词 → 兜底序号键，保证永不为空、永不非法
 */
function keyOf(title: string, index: number, identifier: BibEntry['identifier']): string {
  if (identifier) {
    const stem = asciiStem(identifier.value) || 'id';
    return `serendip_${identifier.type}_${stem}`;
  }
  const stop = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'for', 'to', 'with', 'is', 'are']);
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stop.has(w))
    .slice(0, 3)
    .map((w) => w.slice(0, 14));
  const stem = words.length ? words.join('_') : 'source';
  return `serendip_${stem}_${index + 1}`;
}

/**
 * 从证据墙节点收集 BibTeX 条目。
 * 收录条件：能解析出文献标识（PMID/DOI/PMC/OpenAlex/UniProt/PDB）或有可信 sourceUrl。
 * 按标识值 / URL 去重；source 类型卡优先排序（先文献、后数据库条目）。
 */
export function collectBibEntries(nodes: BoardNode[]): BibEntry[] {
  const seen = new Set<string>();
  const entries: BibEntry[] = [];

  const candidates = [...nodes].sort((a, b) => {
    const rank = (n: BoardNode) => (n.kind === 'source' ? 0 : n.kind === 'evidence' ? 1 : 2);
    return rank(a) - rank(b);
  });

  for (const n of candidates) {
    const url = resolveCitationUrl(n.sourceRef, n.sourceUrl);
    if (!url) continue;
    const identifier = parseIdentifier(n.sourceRef);
    const dedupeKey = identifier ? `${identifier.type}:${identifier.value}` : url;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const isArticle = identifier?.type === 'pmid' || identifier?.type === 'doi' || identifier?.type === 'pmc';
    entries.push({
      key: '',
      type: isArticle ? 'article' : 'misc',
      title: (n.title || url).trim().slice(0, 240),
      note: (n.content || '').trim().slice(0, 400),
      url,
      tags: (n.tags ?? []).filter(Boolean).slice(0, 6),
      identifier,
    });
  }

  // 键生成 + 唯一性保障：标识符键理论上唯一（同标识已去重），但保险起见碰撞时追加序号
  const usedKeys = new Set<string>();
  return entries.map((e, i) => {
    let key = keyOf(e.title, i, e.identifier);
    if (usedKeys.has(key)) {
      let n = 2;
      while (usedKeys.has(`${key}_${n}`)) n++;
      key = `${key}_${n}`;
    }
    usedKeys.add(key);
    return { ...e, key };
  });
}

/** 条目 → BibTeX 源码块 */
function entryToBib(e: BibEntry): string {
  const fields: string[] = [];
  fields.push(`  title = {${bibEscape(e.title)}}`);
  if (e.note) fields.push(`  note = {${bibEscape(e.note)}}`);
  fields.push(`  url = {${bibEscape(e.url)}}`);
  if (e.identifier) {
    if (e.identifier.type === 'pmid') fields.push(`  pmid = {${e.identifier.value}}`);
    if (e.identifier.type === 'doi') fields.push(`  doi = {${bibEscape(e.identifier.value)}}`);
    if (e.identifier.type === 'pmc') fields.push(`  pmcid = {PMC${e.identifier.value}}`);
    if (e.identifier.type === 'uniprot') fields.push(`  accession = {${e.identifier.value}}`);
    if (e.identifier.type === 'pdb') fields.push(`  structure = {${e.identifier.value}}`);
  }
  if (e.tags.length) fields.push(`  keywords = {${e.tags.map(bibEscape).join(', ')}}`);

  return `@${e.type}{${e.key},\n${fields.join(',\n')}\n}`;
}

/** 组装完整 .bib 文件内容（含导出说明头注释） */
export function buildBibTeX(entries: BibEntry[], header: { title: string; date: string }): string {
  const lines: string[] = [];
  lines.push(`% ${header.title}`);
  lines.push(`% Exported from Serendip Lab · ${header.date}`);
  lines.push(`% ${entries.length} entries`);
  lines.push('');
  for (const e of entries) {
    lines.push(entryToBib(e));
    lines.push('');
  }
  return lines.join('\n');
}

/** 触发浏览器下载 .bib */
export function downloadBibTeX(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/x-bibtex;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
