/**
 * 回访正文的段落解析。
 *
 * AI 输出固定三段，段标题形如【课堂内容】【学生收获】【课后任务】。
 * 这里把它拆开，供"待回访行内联上次课后任务""编辑时回填"等场景复用。
 */
export interface FollowUpSections {
  /** 【课堂内容】正文 */
  content: string | null;
  /** 【学生收获】正文 */
  gains: string | null;
  /** 【课后任务】正文 */
  task: string | null;
  /** 原始正文 */
  raw: string;
}

const SECTION_TITLES = ['课堂内容', '学生收获', '课后任务'] as const;

/** 按【xxx】拆分正文，返回三个段落（缺失时为 null） */
export function parseSections(content: string): FollowUpSections {
  const result: FollowUpSections = { content: null, gains: null, task: null, raw: content };
  if (!content) return result;

  // split 会把分隔符也保留在数组里：['', '课堂内容', '正文1', '学生收获', '正文2', ...]
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

/** 是否解析出了完整的三段 */
export function hasAllSections(content: string): boolean {
  const s = parseSections(content);
  return !!(s.content && s.gains && s.task);
}

export const SECTION_TITLE_LIST = SECTION_TITLES;
