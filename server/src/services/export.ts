import { Student, FollowUp } from '../types/index.js';

/** 图片在导出文档中的展示方式 */
type ImageMode = 'path' | 'none';

export interface ExportOptions {
  /** 导出格式 */
  format: 'md' | 'csv';
  /** 图片列展示（Markdown 用） */
  imageMode?: ImageMode;
  /** 导出时间（用于文档头部，测试时可固定） */
  now?: Date;
}

const MASTERY_LABELS: Record<string, string> = {
  excellent: '优秀',
  good: '良好',
  average: '一般',
  needs_improvement: '需加强',
};

function masteryLabel(value: string): string {
  return MASTERY_LABELS[value] || value;
}

function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes())
  );
}

function formatDateCN(input?: string | null): string {
  if (!input) return '-';
  const parts = input.split(' ')[0].split('-');
  if (parts.length !== 3) return input;
  return parts[0] + '年' + parseInt(parts[1], 10) + '月' + parseInt(parts[2], 10) + '日';
}

/** 生成 Markdown 档案文档 */
export function toMarkdown(
  student: Student,
  followups: FollowUp[],
  options: ExportOptions = { format: 'md' }
): string {
  const now = options.now || new Date();
  const totalWords = followups.reduce((s, f) => s + (f.wordCount || 0), 0);
  const totalImages = followups.reduce((s, f) => s + f.images.length, 0);

  const lines: string[] = [];

  lines.push('# ' + student.name + ' · 学习档案');
  lines.push('');
  lines.push('| 项目 | 内容 |');
  lines.push('| --- | --- |');
  lines.push('| 年级 | ' + student.grade + ' |');
  lines.push('| 学科 | ' + student.subject + ' |');
  lines.push('| 联系电话 | ' + (student.phone || '-') + ' |');
  lines.push('| 建档时间 | ' + formatDateCN(student.createdAt) + ' |');
  lines.push('| 导出时间 | ' + formatDateTime(now) + ' |');
  lines.push('');

  if (student.notes) {
    lines.push('> **学生备注**：' + student.notes);
    lines.push('');
  }

  lines.push(
    '**统计**：共 ' + followups.length + ' 次回访 · 归档图片 ' + totalImages + ' 张 · 累计 ' + totalWords + ' 字'
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  if (followups.length === 0) {
    lines.push('_暂无回访记录_');
    lines.push('');
    return lines.join('\n');
  }

  followups.forEach((f, i) => {
    lines.push('## ' + (i + 1) + '. ' + (f.topic || '未命名课程'));
    lines.push('');
    lines.push(
      '- **日期**：' + formatDateCN(f.createdAt) +
      '　**学科**：' + f.subject +
      '　**掌握程度**：' + masteryLabel(f.mastery)
    );
    if (f.performance) {
      lines.push('- **课堂表现**：' + f.performance);
    }
    lines.push('');
    lines.push(f.content);
    lines.push('');

    if (f.images.length > 0 && options.imageMode !== 'none') {
      lines.push('**课堂图片**（' + f.images.length + ' 张）');
      lines.push('');
      f.images.forEach((img) => {
        lines.push('- ' + img);
      });
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  });

  return lines.join('\n');
}

/** CSV 单元格转义 */
function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  // 含逗号/引号/换行时用双引号包裹，内部引号翻倍
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** 生成 CSV（含 BOM，保证 Excel 正确识别 UTF-8） */
export function toCsv(student: Student, followups: FollowUp[]): string {
  const header = [
    '学生姓名', '年级', '学科', '课程主题', '上课日期',
    '掌握程度', '课堂表现', '回访内容', '图片数', '图片路径', '字数',
  ];

  const rows = followups.map((f) => [
    student.name,
    f.grade,
    f.subject,
    f.topic,
    f.createdAt,
    masteryLabel(f.mastery),
    f.performance,
    f.content,
    f.images.length,
    f.images.join(' | '),
    f.wordCount,
  ]);

  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  return '\uFEFF' + body + '\r\n';
}

/** 生成下载用的文件名（ASCII 回退 + UTF-8 名） */
export function exportFilename(student: Student, format: 'md' | 'csv', now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = '' + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate());
  const ascii = 'student-' + student.id + '-followups-' + stamp + '.' + format;
  const pretty = student.name + '-学习档案-' + stamp + '.' + format;
  return ascii + "; filename*=UTF-8''" + encodeURIComponent(pretty);
}
