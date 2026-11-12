/**
 * 回访表单的本地草稿。
 *
 * 为什么需要：这个流程**必然会离开浏览器** —— 生成完文案要切到微信发给家长。
 * 手机浏览器在后台内存紧张时会丢弃并重载标签页，回来时 React state 全没了，
 * 前面填的内容和刚生成、还没保存的文案一起消失。
 *
 * 因此把表单与生成结果落到 localStorage，切走再回来能原样恢复。
 *
 * 【草稿必须按用户隔离】
 * 这个功能曾经把草稿存在一个全局 key 里，退出登录也不清，后果是：
 * 同一台设备上换了账号，新账号一进「课后回访」就直接看到上一个账号
 * 未保存的学生姓名、课堂表现原文、以及刚生成好还没发出去的回访文案。
 * 草稿里恰好是这些东西（不是设置项那种可公开的偏好），属于实打实的信息泄露。
 *
 * 现在每条草稿都带 ownerId：读取时带 ownerId 写入才会命中，不带或别人的一律当作没有；
 * 退出登录时由 clearDraft 清掉。旧版本遗留的无主草稿直接丢弃，不做迁移（无法判断归属）。
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
  /** 草稿归属的用户 id；缺失 = 旧版本遗留的无主草稿 */
  ownerId?: number;
}

export function loadDraft(ownerId: number | null | undefined): Omit<FollowUpDraft, 'savedAt' | 'ownerId'> | null {
  // 不知道当前是谁 → 一律不恢复。宁可让用户重填，也不能把别人的草稿显示给他。
  if (typeof ownerId !== 'number' || !Number.isFinite(ownerId)) return null;

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as FollowUpDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    // 归属不符：别人的草稿，或旧版本留下的无主草稿。
    // 不删（可能是同一设备上另一个账号的有效草稿），只是不读。
    if (parsed.ownerId !== ownerId) return null;

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

export function saveDraft(data: Omit<FollowUpDraft, 'savedAt' | 'ownerId'>, ownerId: number | null | undefined): void {
  // 入参校验放在 try 之外：调用方传缺字段的对象是【代码错误】，
  // 被 catch 静默吞掉会让草稿悄悄不落盘、且无任何提示（用户以为已保存）。
  if (!data || !Array.isArray(data.images) || !Array.isArray(data.selectedIds)) {
    throw new TypeError('saveDraft: images / selectedIds 必须是数组');
  }
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

    // 拿不到归属就不落盘：宁可这次不存草稿，也不能写出无主草稿再次扩散给下一个账号。
    if (typeof ownerId !== 'number' || !Number.isFinite(ownerId)) return;

    localStorage.setItem(KEY, JSON.stringify({ ...data, ownerId, savedAt: Date.now() }));
  } catch {
    /* 存储不可用时忽略 */
  }
}

/**
 * 清除本地草稿。
 *
 * - `clearDraft()`：无条件清除（归档成功后草稿使命结束，用这个）。
 * - `clearDraft(null)`：退出登录时用。不知道是谁也照清 —— 登出的语义就是
 *   "把这台设备上残留的我的东西拿掉"，宁可多清也不能把上一个人的学生数据留给下一个人。
 * - `clearDraft(userId)`：只清属于这个人的，或旧版本遗留的无主草稿；
 *   若存的是另一个账号的草稿则不动（同设备上别人的有效草稿不该被误删）。
 */
export function clearDraft(ownerId?: number | null): void {
  try {
    if (typeof ownerId === 'number') {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as FollowUpDraft;
        const belongsToSomeoneElse =
          parsed &&
          typeof parsed === 'object' &&
          typeof parsed.ownerId === 'number' &&
          parsed.ownerId !== ownerId;
        if (belongsToSomeoneElse) return;
      }
    }
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
