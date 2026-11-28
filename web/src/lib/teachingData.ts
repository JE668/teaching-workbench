export type TeachingDataModel = 'feedback' | 'tutorplan' | 'evaluate_analysis' | 'prepare';
export type TeachingDataDepartment = 'all' | 'math' | 'science' | 'arts';
export type TwoStepMethod = 'sms' | 'wx';

export interface CampusConfig {
  branchId: string;
  branchName: string;
  campusId: string;
  campusName: string;
}

export interface TeachingDataConfig {
  campus: CampusConfig;
  pageSize: number;
  maxPages: number;
  retryTimes: number;
}

export interface TeachingDataFilters extends CampusConfig {
  modelType: TeachingDataModel;
  dept: TeachingDataDepartment;
  startDate: string;
  endDate: string;
  schoolYear: string;
  term: '1' | '2' | '3' | '4';
  examType: '' | '1' | '2';
  colType: string;
  courseTags: number[];
}

export interface TeachingDataStats {
  okPages: number;
  failedPages: number;
  emptyDepartments: string[];
  truncated: string[];
  elapsedSeconds: number;
}

export type TeachingDataPreviewRow = Record<string, string | number | null | undefined>;

export interface TeachingDataResult {
  data: TeachingDataPreviewRow[];
  total: number;
  fetchId: string;
  warnings: string[];
  stats: TeachingDataStats;
}

export const MODEL_OPTIONS: Array<{ value: TeachingDataModel; label: string; description: string }> = [
  { value: 'feedback', label: '课堂反馈', description: '按日期提取课堂反馈完成明细' },
  { value: 'tutorplan', label: '个辅方案', description: '核对个辅方案上传与完成情况' },
  { value: 'evaluate_analysis', label: '阶段评估', description: '分别或同时提取考核率、覆盖率' },
  { value: 'prepare', label: '课前备课', description: '提取全部或新学生备课明细' },
];

export const DEPARTMENT_OPTIONS: Array<{ value: TeachingDataDepartment; label: string }> = [
  { value: 'all', label: '全科组汇总' },
  { value: 'math', label: '数学组' },
  { value: 'science', label: '理综组' },
  { value: 'arts', label: '文科组' },
];

export const COURSE_TAG_OPTIONS = [
  { value: 3, label: '正常' },
  { value: 0, label: '代课' },
  { value: 1, label: '换老师' },
  { value: 2, label: '临时加课' },
];

export const PREVIEW_COLUMNS = ['所属组', '统计口径', '教师', '日期', '学生', '状态', '课程标签'] as const;

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function academicYearOptions(now = new Date()): string[] {
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return [-1, 0, 1].map((offset) => `${start + offset}-${start + offset + 1}`);
}

export function defaultTeachingDataFilters(campus: CampusConfig, now = new Date()): TeachingDataFilters {
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  const years = academicYearOptions(now);
  return {
    ...campus,
    modelType: 'feedback',
    dept: 'all',
    startDate: localDate(start),
    endDate: localDate(now),
    schoolYear: years[1],
    term: '1',
    examType: '',
    colType: 'course_num',
    courseTags: [],
  };
}

export function defaultColumnType(modelType: TeachingDataModel): string {
  if (modelType === 'feedback' || modelType === 'prepare') return 'course_num';
  if (modelType === 'evaluate_analysis') return 'both';
  return 'must_upload_num';
}

export function saveDownloadedFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
