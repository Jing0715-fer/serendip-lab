// node-search.ts — 证据墙卡片搜索命中判定（Task 17）
// 独立于 evidence-board.tsx（该模块 dynamic ssr:false 懒加载，勿从中静态导入工具函数）：
// canvas-tab 工具条的「n/m 张匹配」计数与画布的 is-hit/is-dimmed 高亮共用这一份真源。

import type { BoardNode } from '@/lib/types';

/** 命中范围：标题 / 正文 / 深度解读 / 标签 / 来源引用，大小写不敏感；空查询恒命中 */
export function nodeMatchesSearch(n: BoardNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [n.title, n.content, n.detail ?? '', n.sourceRef ?? '', ...(n.tags ?? [])]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return hay.includes(q);
}
