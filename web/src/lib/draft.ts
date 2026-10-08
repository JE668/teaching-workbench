/**
 * 回访表单的本地草稿。
 *
 * 为什么需要：这个流程**必然会离开浏览器** —— 生成完文案要切到微信发给家长。
 * 手机浏览器在后台内存紧张时会丢弃并重载标签页，回来时 React state 全没了，
 * 前面填的内容和刚生成、还没保存的文案一起消失。
 *
 * 因此把表单与生成结果落到 localStorage，切走再回来能原样恢复。
 */

const KEY = 'tw:followup-draft:v1';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 超过 7 天的草稿视为过期

export interface FollowUpDraft {
  form: any;
  images: string[];
  selectedIds: number[];
  content: string;
  draft: string;
  savedAt: number;
}

export function loadDraft(): Omit<FollowUpDraft, 'savedAt'> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as FollowUpDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }

    return {
      form: parsed.form ?? null,
      images: Array.isArray(parsed.images) ? parsed.images : [],
      selectedIds: Array.isArray(parsed.selectedIds) ? parsed.selectedIds : [],
      content: typeof parsed.content === 'string' ? parsed.content : '',
      draft: typeof parsed.draft === 'string' ? parsed.draft : '',
    };
  } catch {
    // 脏数据/隐私模式禁用存储：静默降级，不影响正常使用
    return null;
  }
}

export function saveDraft(data: Omit<FollowUpDraft, 'savedAt'>): void {
  try {
    // 什么都没填就不写，避免占位
    const empty =
      !data.content &&
      !data.draft &&
      data.images.length === 0 &&
      data.selectedIds.length === 0 &&
      !data.form?.studentName?.trim() &&
      !data.form?.topic?.trim() &&
      !data.form?.performance?.trim();

    if (empty) {
      localStorage.removeItem(KEY);
      return;
    }

    localStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    /* 存储不可用时忽略 */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 常用课堂表现短语。
 * 手机上敲中文很慢，而这类描述高度重复 —— 点一下即可插入。
 */
export const PERFORMANCE_PHRASES: { text: string; tone: 'good' | 'warn' }[] = [
  { text: '专注度高', tone: 'good' },
  { text: '主动提问', tone: 'good' },
  { text: '思路清晰', tone: 'good' },
  { text: '计算准确率提升', tone: 'good' },
  { text: '举一反三', tone: 'good' },
  { text: '计算粗心', tone: 'warn' },
  { text: '审题不仔细', tone: 'warn' },
  { text: '步骤跳步', tone: 'warn' },
  { text: '需加强练习', tone: 'warn' },
];

/** 把短语追加到已有的课堂表现文本里（去重、按顿号分隔） */
export function appendPhrase(current: string, phrase: string): string {
  const text = (current || '').trim();
  if (!text) return phrase;
  if (text.includes(phrase)) return text; // 已有就不重复加

  const separator = /[，,、]$/.test(text) ? '' : '，';
  return text + separator + phrase;
}
