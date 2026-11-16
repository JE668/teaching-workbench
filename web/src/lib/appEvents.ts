/**
 * 命令总线：命令面板 / 全局快捷键 与「当前页面」之间的唯一通道。
 *
 * 背景（真实缺陷）：App.tsx 里 10 个「当前页」命令一律用
 * `window.dispatchEvent(new CustomEvent('app:xxx'))` 派发，但全项目没有任何一处
 * `addEventListener('app:xxx')` —— 点了没反应、也不报错，属于最难被发现的一类 bug。
 * 命令名是裸字符串，写错了同样静默失效。
 *
 * 因此这里做两件事：
 *  1. 命令名集中登记（`APP_COMMANDS`），派发/订阅都走 key，拼错会直接编译报错；
 *  2. 配套 appEvents.test.ts 静态校验「每个命令都必须有人派发且有人订阅」，
 *     将来新增命令忘了接线会让 CI 变红，而不是又变成一个静默无效的按钮。
 */

export const APP_COMMANDS = {
  /** 保存当前页面（⌘S） */
  save: 'app:save',
  /** AI 生成 / 重新生成（⌘Enter） */
  generate: 'app:generate',
  /** 复制当前生成结果 */
  copy: 'app:copy',
  /** 带入上一次的内容 */
  applyLast: 'app:apply-last',
  /** 新建月份报告 */
  newReport: 'app:new-report',
  /** AI 生成总结 */
  aiSummary: 'app:ai-summary',
  /** AI 生成规划 */
  aiPlan: 'app:ai-plan',
  /** 从上月导入 */
  importLastMonth: 'app:import-last-month',
  /** 导出 Excel */
  exportExcel: 'app:export-excel',
  /** 导出图片卡片 */
  exportCard: 'app:export-card',
} as const;

export type AppCommand = keyof typeof APP_COMMANDS;

/** 派发命令；页面组件用 useAppCommand 订阅 */
export function emitAppCommand(cmd: AppCommand): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(APP_COMMANDS[cmd]));
}

/** 订阅命令，返回取消订阅函数（直接作为 useEffect 的清理函数返回） */
export function subscribeAppCommand(cmd: AppCommand, handler: () => void): () => void {
  const name = APP_COMMANDS[cmd];
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}
