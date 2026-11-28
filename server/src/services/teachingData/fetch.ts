import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CAMPUS, DEPARTMENTS, FETCH_MAX, FETCH_TTL_MS, MAX_PAGES, MAX_WORKERS,
  PAGE_SIZE, PREVIEW_MAPPING, RETRY_BACKOFF_MS, RETRY_TIMES, URL_CONFIG,
} from './constants.js';
import { TeachingDataError, TokenInvalidError } from './errors.js';
import { externalRequest, parseObject } from './http.js';
import { TtlLruStore } from './store.js';
import type {
  DepartmentKey, FetchSuccess, ScrapeResult, StoredFetch, TeachingCell,
  TeachingFilters, TeachingMeta, TeachingRow, TeachingStats,
} from './types.js';

const fetchResults = new TtlLruStore<StoredFetch>(FETCH_MAX, FETCH_TTL_MS);

type Job = {
  department: Exclude<DepartmentKey, 'all'>;
  name: string;
  departmentId: string;
  colType: string;
};

type JobResult = {
  rows: TeachingRow[];
  warnings: string[];
  okPages: number;
  failedPages: number;
  empty: boolean;
  truncated: boolean;
};

function defaultColType(filters: TeachingFilters): string {
  if (filters.colType) return filters.colType;
  if (filters.modelType === 'tutorplan' || filters.modelType === 'evaluate_analysis') return 'must_upload_num';
  return 'course_num';
}

function jobsFor(filters: TeachingFilters): Job[] {
  const departments = filters.dept === 'all'
    ? (['math', 'science', 'arts'] as const)
    : [filters.dept];
  const baseColType = defaultColType(filters);
  const colTypes = filters.modelType === 'evaluate_analysis' && baseColType === 'both'
    ? ['must_upload_num', 'total_must_upload_num']
    : [baseColType];
  const jobs: Job[] = [];
  for (const colType of colTypes) {
    for (const department of departments) {
      const info = DEPARTMENTS[department];
      jobs.push({ department, name: info.name, departmentId: info.id, colType });
    }
  }
  return jobs;
}

function requestPayload(filters: TeachingFilters, job: Job, page: number): Record<string, unknown> {
  const campus = { ...DEFAULT_CAMPUS, ...Object.fromEntries(
    Object.entries(filters).filter(([key, value]) => ['branchId', 'branchName', 'campusId', 'campusName'].includes(key) && value !== undefined),
  ) };
  const payload: Record<string, unknown> = {
    ...campus,
    modelType: filters.modelType,
    departmentId: job.departmentId,
    colType: job.colType,
    page,
    pageSize: PAGE_SIZE,
  };
  if (filters.modelType === 'evaluate_analysis') {
    payload.schoolYear = filters.schoolYear;
    payload.term = filters.term;
    payload.examType = filters.examType;
  } else {
    payload.startDate = filters.startDate;
    payload.endDate = filters.endDate;
  }
  if (filters.modelType === 'prepare') {
    const tags = filters.courseTags ?? [];
    payload.courseTags = tags.length ? tags : null;
  }
  return payload;
}

function normalizeCell(value: unknown): TeachingCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeRows(items: unknown[], job: Job): TeachingRow[] {
  const rows: TeachingRow[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row: TeachingRow = {};
    for (const [key, value] of Object.entries(item)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
      row[key] = normalizeCell(value);
    }
    row['科组'] = job.name;
    row['统计口径'] = job.colType;
    rows.push(row);
  }
  return rows;
}

function abortDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', aborted);
      resolve();
    }, ms);
    const aborted = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', aborted, { once: true });
  });
}

async function readPage(filters: TeachingFilters, job: Job, page: number, signal: AbortSignal): Promise<{ rows: TeachingRow[]; totalPage: number }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_TIMES; attempt += 1) {
    try {
      const response = await externalRequest(URL_CONFIG[filters.modelType], {
        method: 'POST',
        body: requestPayload(filters, job, page),
        token: filters.token,
        signal,
      });
      if (response.status === 401 || response.status === 403) throw new TokenInvalidError();
      if (!response.ok) throw new Error('Teaching page failed');
      const body = await parseObject(response);
      const data = body.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Malformed page');
      const criteria = (data as Record<string, unknown>).criteria;
      if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) throw new Error('Malformed page');
      const result = (criteria as Record<string, unknown>).result;
      if (!Array.isArray(result)) throw new Error('Malformed page');
      const rawTotal = Number((data as Record<string, unknown>).totalPage ?? 1);
      const totalPage = Number.isFinite(rawTotal) && rawTotal > 0 ? Math.floor(rawTotal) : 1;
      return { rows: normalizeRows(result, job), totalPage };
    } catch (error) {
      if (error instanceof TokenInvalidError || signal.aborted) throw error;
      lastError = error;
      if (attempt < RETRY_TIMES - 1) await abortDelay(RETRY_BACKOFF_MS * 2 ** attempt, signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Teaching page failed');
}

async function scrapeJob(filters: TeachingFilters, job: Job, signal: AbortSignal): Promise<JobResult> {
  const result: JobResult = { rows: [], warnings: [], okPages: 0, failedPages: 0, empty: false, truncated: false };
  let page = 1;
  let totalPage = 1;
  while (page <= totalPage && page <= MAX_PAGES) {
    try {
      const current = await readPage(filters, job, page, signal);
      totalPage = current.totalPage;
      result.okPages += 1;
      result.rows.push(...current.rows);
      if (current.rows.length === 0) break;
      page += 1;
    } catch (error) {
      if (error instanceof TokenInvalidError || signal.aborted) throw error;
      result.failedPages += 1;
      result.warnings.push(job.name + ' 第' + page + '页提取失败（已重试' + RETRY_TIMES + '次）');
      if (page === 1) break;
      // 已拿到第一页时保留部分结果，并继续尝试下一页，而不是把整批标记为空。
      page += 1;
    }
  }
  if (page > MAX_PAGES && totalPage > MAX_PAGES) {
    result.truncated = true;
    result.warnings.push(job.name + ' 达到 ' + MAX_PAGES + ' 页上限，结果可能不完整');
  }
  result.empty = result.rows.length === 0 && result.failedPages === 0;
  return result;
}

function previewRows(rows: TeachingRow[]): Array<Record<string, TeachingCell>> {
  return rows.map((row) => {
    const preview: Record<string, TeachingCell> = {};
    for (const [source, target] of Object.entries(PREVIEW_MAPPING)) preview[target] = row[source] ?? null;
    return preview;
  });
}

function emptyError(stats: TeachingStats, warnings: string[]): TeachingDataError {
  const partialFailure = stats.failedPages > 0;
  return new TeachingDataError(
    partialFailure ? 502 : 400,
    partialFailure ? '抓取失败，未获得可用数据，请稍后重试。' : '没有查到符合条件的数据，请调整筛选条件后重试。',
    partialFailure ? 'fetch_failed' : 'empty_data',
    { warnings, stats },
  );
}

export async function fetchAndStore(filters: TeachingFilters, ownerId: number): Promise<FetchSuccess> {
  const startedAt = Date.now();
  const jobs = jobsFor(filters);
  const results = new Array<JobResult>(jobs.length);
  const controller = new AbortController();
  let cursor = 0;
  let tokenFailure: TokenInvalidError | undefined;

  const worker = async () => {
    while (!controller.signal.aborted) {
      const index = cursor;
      cursor += 1;
      if (index >= jobs.length) return;
      try {
        results[index] = await scrapeJob(filters, jobs[index], controller.signal);
      } catch (error) {
        if (error instanceof TokenInvalidError) tokenFailure ??= error;
        controller.abort();
        throw error;
      }
    }
    if (tokenFailure) throw tokenFailure;
  };
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(MAX_WORKERS, jobs.length) }, () => worker()),
  );
  if (tokenFailure) throw tokenFailure;
  const failed = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
  if (failed) throw failed.reason;

  const rows: TeachingRow[] = [];
  const warnings: string[] = [];
  const stats: TeachingStats = { okPages: 0, failedPages: 0, emptyDepartments: [], truncated: [], elapsedSeconds: 0 };
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result) continue;
    rows.push(...result.rows);
    warnings.push(...result.warnings);
    stats.okPages += result.okPages;
    stats.failedPages += result.failedPages;
    if (result.empty) stats.emptyDepartments.push(jobs[index].name);
    if (result.truncated) stats.truncated.push(jobs[index].name + '（' + jobs[index].colType + '）');
  }
  stats.elapsedSeconds = Math.round((Date.now() - startedAt) / 10) / 100;
  if (rows.length === 0) throw emptyError(stats, warnings);

  const { token: _discardToken, ...meta } = filters;
  const fetchId = randomUUID().replaceAll('-', '');
  const stored: StoredFetch = { ownerId, rows, meta };
  fetchResults.set(fetchId, stored);
  return { data: previewRows(rows), total: rows.length, fetchId, warnings, stats };
}

export function getStoredFetch(fetchId: string, ownerId: number): StoredFetch {
  const result = fetchResults.getOwned(fetchId, ownerId);
  if (result.status === 'forbidden') throw new TeachingDataError(403, '无权下载其他用户的数据。', 'forbidden');
  if (result.status === 'missing') throw new TeachingDataError(404, '下载结果不存在或已过期，请重新提取。', 'fetch_not_found');
  return result.value;
}
