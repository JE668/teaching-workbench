/**
 * 回访正文的段落解析（前端版，与 server/utils/sections.ts 同逻辑）。
 * 图片卡片渲染需要把正文按【课堂内容】【学生收获】【课后任务】拆开。
 */
export interface FollowUpSections {
  content: string | null;
  gains: string | null;
  task: string | null;
  raw: string;
}

export function parseSections(content: string): FollowUpSections {
  const result: FollowUpSections = { content: null, gains: null, task: null, raw: content };
  if (!content) return result;

  const parts = content.split(/【([^】]+)】/);
  for (let i = 1; i < parts.length - 1; i += 2) {
    const title = parts[i].trim();
    const body = parts[i + 1].replace(/\s+$/g, '');
    if (title === '课堂内容') result.content = body;
    else if (title === '学生收获') result.gains = body;
    else if (title === '课后任务') result.task = body;
  }

  return result;
}

/** 按三段拆成卡片可渲染的 [{heading, body}]，缺失的段跳过 */
export function sectionsForCard(content: string): { heading: string; body: string }[] {
  const s = parseSections(content);
  const out: { heading: string; body: string }[] = [];
  if (s.content) out.push({ heading: '课堂内容', body: s.content });
  if (s.gains) out.push({ heading: '学生收获', body: s.gains });
  if (s.task) out.push({ heading: '课后任务', body: s.task });
  // 解析不出任何段落时，把整段正文当作一段展示，避免空白卡片
  if (out.length === 0 && content.trim()) {
    out.push({ heading: '回访内容', body: content.trim() });
  }
  return out;
}
