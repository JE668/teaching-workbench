import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 合并 Tailwind 类名，处理条件与冲突 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 校验字数：去除空白与标点符号 */
export function countWords(text: string): number {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length;
}

/** 复制文本到剪贴板，兼容非 HTTPS 环境 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // 回退方案：临时 textarea + execCommand
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

/** 触发浏览器下载 Blob（用完即释放 objectURL，避免内存泄漏） */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延后释放，确保下载已开始
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 格式化日期：2026-10-08 12:30:00 → 10月8日 */
export function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const parts = dateStr.split(' ')[0].split('-');
  if (parts.length !== 3) return dateStr;
  return parts[0] + '年' + parseInt(parts[1]) + '月' + parseInt(parts[2]) + '日';
}

/** 相对时间：刚刚 / 3小时前 / 2天前 */
export function relativeTime(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const then = new Date(dateStr.replace(' ', 'T')).getTime();
  if (Number.isNaN(then)) return dateStr;
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + '分钟前';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + '小时前';
  const day = Math.floor(hour / 24);
  if (day < 30) return day + '天前';
  return formatDate(dateStr);
}
