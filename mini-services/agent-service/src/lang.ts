// lang.ts — 会话语言支持（Task 13 双语）
// 语言随前端请求透传并落库到 session.meta.lang；四个面孔的 prompt 末尾
// 注入 langDirective 控制所有面向用户的产出文本语言。
import { getSessionRow, getMeta, saveMeta } from './db'

export type Lang = 'zh' | 'en'

export function normLang(v: unknown): Lang {
  return v === 'en' ? 'en' : 'zh'
}

/** 读取会话语言（meta.lang，缺省 zh） */
export function getSessionLang(sessionId: string): Lang {
  const m = getMeta(sessionId)
  return m.lang === 'en' ? 'en' : 'zh'
}

/** 更新会话语言（meta 合并写入） */
export function setSessionLang(sessionId: string, lang: Lang): void {
  if (getSessionRow(sessionId) == null) return
  const m = getMeta(sessionId)
  if (m.lang === lang) return
  saveMeta(sessionId, { ...m, lang })
}

/**
 * 注入到各面孔 user prompt 末尾的语言指令。
 * 注意：检索关键词永远用英文（生物数据库英文检索效果最好）。
 */
export function langDirective(lang: Lang): string {
  if (lang === 'en') {
    return [
      '# Output language',
      'The user interface language is English. Write ALL user-facing text in English:',
      'reply / message_to_user / narrative_md / question text & rationale / node title, content, detail / plan fields.',
      'Scientific terms may keep their standard form. Database search keywords are always English.',
    ].join('\n')
  }
  return [
    '# 输出语言',
    '用户界面语言为简体中文。所有面向用户的文本一律使用简体中文撰写：',
    'reply / message_to_user / narrative_md / 问题文本与理由 / 节点 title、content、detail / 计划字段。',
    '专业术语可在括号内附英文原文；数据库检索关键词一律用英文。',
  ].join('\n')
}

/** 后端落库的双语文案（notice / activity / 汇报消息） */
export function noticeFor(lang: Lang, key: NoticeKey, params: Record<string, string | number> = {}): string {
  const pack: Record<NoticeKey, [string, string]> = {
    steerQueued: [
      '已加入研究素材队列，Agent 将在检查点纳入',
      'Added to the research queue — the agent will fold it in at the next checkpoint',
    ],
    interviewerUnavailable: [
      '（访谈者思考暂时不可用，请稍后重试）',
      '(The interviewer is temporarily unavailable — please retry shortly)',
    ],
    synthesisFinal: ['综合分析完成（最终）', 'Synthesis complete (final)'],
    synthesisStage: ['综合分析完成（阶段）', 'Synthesis complete (stage)'],
    planGenerated: ['生成研究计划', 'Research plan generated'],
    reviewStart: ['首席战略顾问开始审阅证据链，提炼深研方向…', 'The strategy advisor is reviewing the evidence chain…'],
    directionsDone: ['深研方向已生成', 'Research paths generated'],
    directionsChatPrefix: [
      '已从证据链提炼出 {n} 个深研方向{summary}——工作台「深研方向」标签页查看完整研究计划。',
      'Distilled {n} research paths from the evidence chain{summary} — see the “Research Paths” tab for full plans.',
    ],
    directionsFailed: ['深研方向生成失败', 'Research path distillation failed'],
    finalSynthesisNote: [
      '这是本轮研究的最终综述（本轮即将结束），continue 请置 false。',
      'This is the final synthesis of this run — set continue to false.',
    ],
    userNotePrefix: ['【用户手动添加素材】', '[User-added card]'],
    demoLoaded: [
      '示例课题已载入 · 点击「继续研究」可让 Agent 基于此课题继续自主研究，或新建属于你的课题',
      'Demo project loaded — click “Continue Research” to let the agent build on it, or start your own project',
    ],
    investigatingStart: ['开始自主研究', 'Autonomous research started'],
  }
  let text = pack[key][lang === 'en' ? 1 : 0]
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, String(v))
  }
  return text
}

export type NoticeKey =
  | 'steerQueued'
  | 'interviewerUnavailable'
  | 'synthesisFinal'
  | 'synthesisStage'
  | 'planGenerated'
  | 'reviewStart'
  | 'directionsDone'
  | 'directionsChatPrefix'
  | 'directionsFailed'
  | 'finalSynthesisNote'
  | 'userNotePrefix'
  | 'demoLoaded'
  | 'investigatingStart'
