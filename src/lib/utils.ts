import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 导出文件名 ASCII 化（Task 20）：中文等非 ASCII 字符在部分系统/工具链有风险；
 *  有 ASCII 词用 snake/stem，全非 ASCII 兜底日期串 */
export function asciiFilenameStem(title: string, max = 32): string {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  if (stem) return stem;
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
