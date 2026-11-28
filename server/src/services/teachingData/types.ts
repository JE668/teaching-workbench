export type TeachingModel = 'feedback' | 'tutorplan' | 'evaluate_analysis' | 'prepare';
export type DepartmentKey = 'math' | 'science' | 'arts' | 'all';
export type TwoStepMethod = 'sms' | 'wx';

export interface Campus {
  branchId: string;
  branchName: string;
  campusId: string;
  campusName: string;
}

export interface TeachingFilters extends Partial<Campus> {
  token: string;
  modelType: TeachingModel;
  dept: DepartmentKey;
  startDate?: string;
  endDate?: string;
  schoolYear?: string;
  term?: '1' | '2' | '3' | '4';
  examType?: '' | '1' | '2';
  colType?: string;
  courseTags?: number[] | null;
}

export type TeachingMeta = Omit<TeachingFilters, 'token'>;
export type TeachingCell = string | number | boolean | null;
export type TeachingRow = Record<string, TeachingCell>;

export interface TeachingStats {
  okPages: number;
  failedPages: number;
  emptyDepartments: string[];
  truncated: string[];
  elapsedSeconds: number;
}

export interface ScrapeResult {
  rows: TeachingRow[];
  warnings: string[];
  stats: TeachingStats;
}

export interface StoredFetch {
  ownerId: number;
  rows: TeachingRow[];
  meta: TeachingMeta;
}

export interface FetchSuccess {
  data: Array<Record<string, TeachingCell>>;
  total: number;
  fetchId: string;
  warnings: string[];
  stats: TeachingStats;
}
