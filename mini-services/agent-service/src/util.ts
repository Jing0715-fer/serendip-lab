// util.ts — uuid / 时间戳 / 截断等通用工具

export function uuid(): string {
  return crypto.randomUUID()
}

export function now(): number {
  return Date.now()
}

/** JSON.stringify 后若超长则截断（默认 1600 chars，§6.2 observation 截断） */
export function truncObs(obj: unknown, max = 1600): string {
  let s: string
  try {
    s = typeof obj === 'string' ? obj : JSON.stringify(obj)
  } catch {
    s = String(obj)
  }
  if (s.length > max) s = s.slice(0, max - 20) + '…(truncated)'
  return s
}

/** 单行压缩：去换行、压空白，用于旧观察的摘要行 */
export function oneLine(s: string, max = 200): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** HTML 实体解码（pubmed_fetch 用） */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/** 从 LLM 输出中容错提取 JSON 对象（多级防御）
 *  1) 剥 ```json 围栏  2) 直接解析  3) 智能引号归一化
 *  4) 平衡括号扫描（取首个完整 JSON 对象，忽略其后缀文本/多个对象）
 *  5) 截断修复（补齐未闭合的字符串/括号，应对 max_tokens 截断）
 */
export function extractJson<T = any>(raw: string): T | null {
  if (!raw) return null
  let s = raw.trim()
  // 1) 剥代码围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // 2) 直接尝试
  try {
    return JSON.parse(s) as T
  } catch {
    /* continue */
  }
  // 3) 智能引号 / 全角引号归一化（模型常见笔误）
  const cleaned = s.replace(/[\u201c\u201d\u300c\u300d]/g, '"').replace(/[\u2018\u2019]/g, "'")
  try {
    return JSON.parse(cleaned) as T
  } catch {
    /* continue */
  }
  // 4) 平衡括号扫描：从首个 { 起找第一个完整对象
  const start = cleaned.indexOf('{')
  if (start >= 0) {
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (inStr) {
        if (esc) {
          esc = false
          continue
        }
        if (ch === '\\') {
          esc = true
          continue
        }
        if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') {
        inStr = true
        continue
      }
      if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T
      } catch {
        /* fallthrough to repair */
      }
    }
    // 5) 截断修复：补齐未闭合的字符串与括号
    let body = cleaned.slice(start)
    let inStr2 = false
    let esc2 = false
    const stack: string[] = []
    for (const ch of body) {
      if (inStr2) {
        if (esc2) {
          esc2 = false
          continue
        }
        if (ch === '\\') {
          esc2 = true
          continue
        }
        if (ch === '"') inStr2 = false
        continue
      }
      if (ch === '"') {
        inStr2 = true
        continue
      }
      if (ch === '{' || ch === '[') stack.push(ch)
      else if (ch === '}' || ch === ']') stack.pop()
    }
    if (inStr2) body += '"'
    body = body.replace(/,\s*$/, '')
    while (stack.length) {
      body += stack.pop() === '{' ? '}' : ']'
    }
    try {
      return JSON.parse(body) as T
    } catch {
      /* give up */
    }
  }
  return null
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
