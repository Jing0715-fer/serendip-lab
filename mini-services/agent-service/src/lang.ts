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
      '这是本轮研究的最终综述（本轮即将结束），continue 请置 false。若上方列有「未完成任务」，必须在「未解之谜」与「下一步建议」中点名这些未覆盖的方向及尚缺的证据类型，供用户决策是否追加研究。',
      'This is the final synthesis of this run — set continue to false. If any “unfinished tasks” are listed above, name them (and the missing evidence types) under “Open Questions” and “Next Steps” so the user can decide whether to extend the research.',
    ],
    budgetTight: [
      '⏳ 预算紧张，进入收敛模式：压缩单任务步数，优先完成核心任务',
      '⏳ Budget running low — switching to convergence mode: fewer steps per task, core tasks first',
    ],
    budgetLeftover: [
      '研究预算已用尽，{n} 个任务未能执行：{tasks}……这些方向将在最终综述的「下一步建议」中点名',
      'Budget exhausted with {n} task(s) left unrun: {tasks}… These will be flagged in the final review’s “Next Steps”',
    ],
    userNotePrefix: ['【用户手动添加素材】', '[User-added card]'],
    demoLoaded: [
      '示例课题已载入 · 点击「继续研究」可让 Agent 基于此课题继续自主研究，或新建属于你的课题',
      'Demo project loaded — click “Continue Research” to let the agent build on it, or start your own project',
    ],
    investigatingStart: ['开始自主研究', 'Autonomous research started'],
    resynthesizeStart: ['按当前证据墙重新梳理综述…', 'Re-synthesizing the review from the current wall…'],
    autoResearchArmed: [
      '✅ 需求已经足够清晰——{sec} 秒后我将自动开始自主信息收集与科学逻辑梳理（继续发言可细化需求，研究中可随时补充素材或暂停）',
      '✅ Enough context gathered — autonomous research starts in {sec}s (keep typing to refine; you can add notes or pause anytime once it begins)',
    ],
    autoResearchArmedShort: ['访谈就绪，即将自动开启自主调研', 'Interview complete — auto-research armed'],
    autoResearchStart: [
      '🔍 自主调研开始：我将检索文献与数据库、梳理科学逻辑，把证据钉上证据墙，并最终提炼出值得深入研究的科学课题（右侧课题栏）。',
      '🔍 Autonomous research started: I will search literature and databases, organize the scientific logic, pin evidence onto the wall, and distill research questions worth pursuing (see the topic column).',
    ],
    topicsPinned: [
      '⭐ 已提炼出 {n} 个值得深入研究的科学课题，醒目钉在证据墙右侧课题栏（含评分与支撑证据连线）——最终判断权在你。',
      '⭐ {n} research-worthy questions distilled and pinned prominently in the wall’s topic column (with scores and supporting-evidence links) — the final call is yours.',
    ],
    // ---------- 课题探索闭环（Task 16） ----------
    explorePlanStart: [
      '实验设计顾问正在为课题《{title}》制定具体探索方案（目标 · 实验设计 · 判读标准 · 决策点）…',
      'The experiment-design advisor is drafting a concrete exploration plan for “{title}”…',
    ],
    explorePlanDone: ['探索方案已生成', 'Exploration plan generated'],
    explorePlanChat: [
      '🧪 已为课题《{title}》制定具体探索方案——含目标、分阶段实验设计、判读标准与决策点。点击课题卡上的「探索方案」按钮查看；按方案推进后回来反馈结果，我会继续推导、重整证据墙逻辑并给出下一步方向。',
      '🧪 A concrete exploration plan is ready for “{title}” — objective, staged design, readout criteria and decision points. Open it via the “Explore” button on the topic card; after you run a step, come back with your results and I’ll keep reasoning, re-organize the wall and propose next steps.',
    ],
    explorePlanFailed: ['探索方案生成失败', 'Failed to generate the exploration plan'],
    feedbackStart: ['科研推理搭档正在分析你的反馈，推导并重整证据墙逻辑…', 'The reasoning partner is analyzing your feedback and re-organizing the wall…'],
    feedbackDone: ['反馈推导完成（第 {n} 轮）', 'Feedback analysis complete (round {n})'],
    feedbackChat: [
      '🔄 第 {n} 轮推导完成（课题《{title}》）——结论：{verdict}。证据墙逻辑已同步重整。{next}\n完整分析与全部下一步方向见课题卡「探索方案」面板。',
      '🔄 Round {n} reasoning complete (“{title}”) — verdict: {verdict}. The wall has been re-organized accordingly.{next}\nSee the topic card’s “Explore” panel for the full analysis and all next steps.',
    ],
    feedbackFailed: ['反馈推导失败', 'Feedback analysis failed'],
    verdict_supports: ['反馈支持原假说', 'the feedback supports the hypothesis'],
    verdict_contradicts: ['反馈否定了原假说', 'the feedback contradicts the hypothesis'],
    verdict_mixed: ['反馈部分支持、部分否定', 'partly supported, partly contradicted'],
    verdict_inconclusive: ['证据尚不足以判定', 'inconclusive so far'],
    verdict_refined: ['问题本身被重新定义', 'the question itself got refined'],
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
  | 'budgetTight'
  | 'budgetLeftover'
  | 'userNotePrefix'
  | 'demoLoaded'
  | 'investigatingStart'
  | 'resynthesizeStart'
  | 'autoResearchArmed'
  | 'autoResearchArmedShort'
  | 'autoResearchStart'
  | 'topicsPinned'
  | 'explorePlanStart'
  | 'explorePlanDone'
  | 'explorePlanChat'
  | 'explorePlanFailed'
  | 'feedbackStart'
  | 'feedbackDone'
  | 'feedbackChat'
  | 'feedbackFailed'
  | 'verdict_supports'
  | 'verdict_contradicts'
  | 'verdict_mixed'
  | 'verdict_inconclusive'
  | 'verdict_refined'
