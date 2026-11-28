import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Filter, Funnel, X, Calendar, Building2, Users, User, Search, Save, Trash2, SlidersHorizontal } from 'lucide-react';
import { api } from '../../api/client';
import { Card, CardBody } from '../ui/Card';
import Button from '../ui/Button';
import { Select, MultiSelect } from '../ui/Field';
import { cn } from '../../lib/utils';
import { useSearchParams } from 'react-router-dom';

/** 筛选器状态接口 */
export interface FilterState {
  centerIds: number[];
  statMonths: string[];
  teacherIds: number[];
  managerIds: number[];
  subjectGroups: string[];
  grades: string[];
  tab: string;
}

/** 筛选器选项（用于下拉） */
export interface FilterOptions {
  centers: { id: number; name: string }[];
  statMonths: string[];
  teachers: { id: number; name: string; subjectGroup?: string }[];
  managers: { id: number; name: string }[];
  subjectGroups: string[];
  grades: string[];
}

/** 预设筛选配置 */
export interface FilterPreset {
  id: string;
  name: string;
  filters: Partial<FilterState>;
  isDefault?: boolean;
}

/** 默认预设 */
const DEFAULT_PRESETS: FilterPreset[] = [
  { id: 'all', name: '全部数据', filters: {}, isDefault: true },
  { id: 'current-month', name: '本月', filters: {} }, // 运行时填充最新月份
  { id: 'graduating', name: '毕业班', filters: { grades: ['初三', '高三'] } },
  { id: 'non-grad', name: '非毕业班', filters: { grades: ['初一', '初二', '高一', '高二'] } },
];

interface FilterBarProps {
  /** 当前筛选状态（受控） */
  filters: FilterState;
  /** 筛选状态变更回调 */
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  /** 可用筛选选项 */
  options: FilterOptions;
  /** 当前激活的 Tab */
  currentTab: string;
  /** Tab 变更回调 */
  setTab: (tab: string) => void;
  /** 当前报表 ID */
  reportId: number | null;
  /** 校区名称 */
  centerName: string;
  /** 统计月份 */
  statMonth: string;
  /** 面板展开状态 */
  open: boolean;
  /** 面板展开状态变更回调 */
  setOpen: (open: boolean) => void;
  /** 应用筛选回调（重新加载数据） */
  onApply: () => void;
  /** 切换多期对比回调 */
  onCompare: () => void;
  /** 多期对比是否展开 */
  comparisonOpen: boolean;
  /** 切换趋势图回调 */
  onTrend: () => void;
  /** 趋势图是否展开 */
  trendOpen: boolean;
}

const STORAGE_KEY = 'renewal-filter-presets';
const URL_PARAM_PREFIX = 'flt_';

function loadCustomPresets(): FilterPreset[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveCustomPresets(presets: FilterPreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export default function FilterBar({
  filters,
  setFilters,
  options,
  currentTab,
  setTab,
  reportId,
  centerName,
  statMonth,
  open,
  setOpen,
  onApply,
  onCompare,
  comparisonOpen,
  onTrend,
  trendOpen,
}: FilterBarProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>(() => [...DEFAULT_PRESETS, ...loadCustomPresets()]);
  const [activePresetId, setActivePresetId] = useState<string>('all');
  const [savingPreset, setSavingPreset] = useState<string>('');
  const [deletingPreset, setDeletingPreset] = useState<string>('');
  const [showPresetManager, setShowPresetManager] = useState(false);

  // 从 URL 恢复筛选
  useEffect(() => {
    const urlFilters: Partial<FilterState> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith(URL_PARAM_PREFIX)) {
        const filterKey = key.replace(URL_PARAM_PREFIX, '') as keyof FilterState;
        if (filterKey === 'centerIds' || filterKey === 'teacherIds' || filterKey === 'managerIds') {
          (urlFilters as any)[filterKey] = value.split(',').map(Number).filter(Boolean);
        } else if (filterKey === 'statMonths' || filterKey === 'subjectGroups' || filterKey === 'grades') {
          (urlFilters as any)[filterKey] = value.split(',').filter(Boolean);
        } else {
          (urlFilters as any)[filterKey] = value;
        }
      }
    }
    if (Object.keys(urlFilters).length > 0) {
      setFilters(prev => ({ ...prev, ...urlFilters }));
    }
  }, [searchParams, setFilters]);

  // 筛选变化时同步到 URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    let hasAny = false;
    (Object.entries(filters) as [keyof FilterState, any][]).forEach(([key, value]) => {
      const paramKey = URL_PARAM_PREFIX + key;
      if (Array.isArray(value) && value.length > 0) {
        next.set(paramKey, value.join(','));
        hasAny = true;
      } else if (value && !Array.isArray(value)) {
        next.set(paramKey, String(value));
        hasAny = true;
      } else {
        next.delete(paramKey);
      }
    });
    // 只有真正变化才 push，避免无限循环
    const currentStr = searchParams.toString();
    const nextStr = next.toString();
    if (currentStr !== nextStr) {
      setSearchParams(next, { replace: true });
    }
  }, [filters, searchParams, setSearchParams]);

  // 加载筛选选项（校区、月份、教师、学管等）
  const loadOptions = useCallback(async () => {
    if (!reportId) return;
    setIsLoadingOptions(true);
    try {
      const [centersRes, monthsRes, teacherRes, managerRes] = await Promise.all([
        api.get('/renewal/analytics/centers'),
        api.get('/renewal/analytics/stat-months'),
        api.get(`/renewal/dashboard/teacher-stats?tab=${currentTab}&reportId=${reportId}`),
        api.get(`/renewal/analytics/manager-perf?reportId=${reportId}`),
      ]);

      const teacherRows = teacherRes.rows || [];
      const managerRows = managerRes.rows || [];

      const teachers = teacherRows.map((r: any) => ({
        id: r.teacherStatId || 0,
        name: r.teacherName || '未命名',
        subjectGroup: r.subjectGroup,
      })).filter((t: any) => t.id > 0);

      const managers = managerRows.map((r: any) => ({
        id: r.managerId || 0,
        name: r.managerName || '未命名',
      })).filter((m: any) => m.id > 0);

      const subjectGroups = [...new Set(teacherRows.map((r: any) => r.subjectGroup).filter(Boolean))] as string[];
      const grades = options.grades || [];

      // Note: options is passed as prop from parent, parent should update based on this data
      // We could emit an event or callback here if needed
    } catch (e) {
      console.warn('加载筛选选项失败:', e);
    } finally {
      setIsLoadingOptions(false);
    }
  }, [reportId, currentTab, options.grades]);

  // 当 reportId 或 currentTab 变化时重新加载选项
  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  // 处理预设应用
  const applyPreset = useCallback((preset: FilterPreset) => {
    setFilters(prev => ({ ...prev, ...preset.filters }));
    setActivePresetId(preset.id);
  }, [setFilters]);

  // 保存自定义预设
  const handleSavePreset = useCallback((name: string) => {
    if (!name.trim()) return;
    const newPreset: FilterPreset = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      filters,
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    saveCustomPresets(updated.filter(p => !p.isDefault));
    setSavingPreset('');
  }, [filters, presets]);

  // 删除自定义预设
  const handleDeletePreset = useCallback((id: string) => {
    if (presets.find(p => p.id === id)?.isDefault) return;
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    saveCustomPresets(updated.filter(p => !p.isDefault));
    if (activePresetId === id) setActivePresetId('all');
    setDeletingPreset('');
  }, [presets, activePresetId]);

  const hasActiveFilters = Object.entries(filters).some(([key, value]) => {
    if (key === 'tab') return false;
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  });

  const renderMultiSelect = (key: keyof FilterState, label: string, items: { id: number; name: string }[] | string[], getId: (item: any) => number | string, getName: (item: any) => string) => {
    const selected = (filters[key] as (number | string)[]).map(String);
    const transformedOptions = items.map(item => ({ value: String(getId(item)), label: getName(item) }));
    return (
      <MultiSelect
        key={key}
        label={label}
        options={transformedOptions}
        value={selected}
        onChange={(vals: string[]) => setFilters(prev => ({ ...prev, [key]: vals.map(v => getId(items.find(i => String(getId(i)) === v) || v)) }))}
        placeholder={`选择 ${label}`}
        searchable
        maxDisplay={5}
      />
    );
  };

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          icon={<SlidersHorizontal className="h-4 w-4" />}
          onClick={() => setOpen(true)}
          className={cn(hasActiveFilters && 'ring-2 ring-brand-500 bg-brand-50')}
        >
          筛选器 {hasActiveFilters && <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-brand-500" />}
        </Button>
        {comparisonOpen && (
          <Button variant="outline" size="sm" icon={<Calendar className="h-4 w-4" />} onClick={onCompare}>
            多期对比
          </Button>
        )}
        {trendOpen && (
          <Button variant="outline" size="sm" icon={<Funnel className="h-4 w-4" />} onClick={onTrend}>
            趋势图
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 头部：当前报表信息 + 关闭按钮 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <Building2 className="h-4 w-4 text-slate-400" />
          <span className="font-medium text-slate-800">{centerName || '未知校区'}</span>
          <span className="text-slate-300">·</span>
          <Calendar className="h-4 w-4 text-slate-400" />
          <span className="font-medium text-slate-800">{statMonth}月</span>
          <span className="text-slate-300">·</span>
          <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 capitalize">{currentTab}</span>
        </div>
        <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={() => setOpen(false)} aria-label="关闭筛选器" />
      </div>

      {/* 筛选选项网格 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* 校区 */}
        <Select
          label="校区"
          options={options.centers.map(c => ({ value: String(c.id), label: c.name }))}
          value={filters.centerIds[0] ? String(filters.centerIds[0]) : ''}
          onChange={val => setFilters(prev => ({ ...prev, centerIds: val ? [Number(val)] : [] }))}
          placeholder="全部校区"
        />

        {/* 月份 */}
        <MultiSelect
          label="月份"
          options={options.statMonths.map(m => ({ value: m, label: `${m}月` }))}
          value={filters.statMonths}
          onChange={vals => setFilters(prev => ({ ...prev, statMonths: vals }))}
          placeholder="全部月份"
          searchable
          maxDisplay={5}
        />

        {/* 教师 */}
        {renderMultiSelect('teacherIds', '教师', options.teachers, t => t.id, t => t.name)}

        {/* 学管 */}
        {renderMultiSelect('managerIds', '学管', options.managers, m => m.id, m => m.name)}

        {/* 科组 */}
        <MultiSelect
          label="科组"
          options={options.subjectGroups.map(g => ({ value: g, label: g }))}
          value={filters.subjectGroups}
          onChange={vals => setFilters(prev => ({ ...prev, subjectGroups: vals }))}
          placeholder="全部科组"
          searchable
          maxDisplay={5}
        />

        {/* 年级 */}
        <MultiSelect
          label="年级"
          options={options.grades.map(g => ({ value: g, label: g }))}
          value={filters.grades}
          onChange={vals => setFilters(prev => ({ ...prev, grades: vals }))}
          placeholder="全部年级"
          searchable
          maxDisplay={5}
        />
      </div>

      {/* Tab 切换 */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
        <span className="text-xs text-slate-500">学段：</span>
        <button
          onClick={() => setTab('stage')}
          className={cn('px-3 py-1.5 rounded-full text-sm font-medium transition-colors', currentTab === 'stage' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}
        >
          学段
        </button>
        <button
          onClick={() => setTab('incentive')}
          className={cn('px-3 py-1.5 rounded-full text-sm font-medium transition-colors', currentTab === 'incentive' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50')}
        >
          激励口径
        </button>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
        <Button onClick={onApply} disabled={isLoadingOptions}>
          {isLoadingOptions ? '加载中…' : '应用筛选'}
        </Button>
        <Button variant="outline" onClick={() => setFilters({
          centerIds: [],
          statMonths: [],
          teacherIds: [],
          managerIds: [],
          subjectGroups: [],
          grades: [],
          tab: currentTab,
        })}>
          <Filter className="h-4 w-4 mr-1" />
          重置
        </Button>

        {/* 多期对比 / 趋势图切换 */}
        <Button variant="outline" icon={<Calendar className="h-4 w-4" />} onClick={onCompare} className={cn(comparisonOpen && 'bg-brand-50 ring-brand-200 text-brand-700')}>
          多期对比
        </Button>
        <Button variant="outline" icon={<Funnel className="h-4 w-4" />} onClick={onTrend} className={cn(trendOpen && 'bg-brand-50 ring-brand-200 text-brand-700')}>
          趋势图
        </Button>

        {/* 预设管理 */}
        <div className="relative ml-auto">
          <Button variant="outline" icon={<Save className="h-4 w-4" />} onClick={() => setShowPresetManager(true)}>
            预设
          </Button>
          {showPresetManager && (
            <div className="absolute right-0 top-full mt-1 z-10 w-72 rounded-lg border bg-white shadow-lg p-3 ring-1 ring-black ring-opacity-5">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-medium text-slate-800">筛选预设</h4>
                <Button variant="ghost" size="sm" icon={<X className="h-4 w-4" />} onClick={() => setShowPresetManager(false)} />
              </div>
              <div className="space-y-1 max-h-48 overflow-auto">
                {presets.map(p => (
                  <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50">
                    <button
                      onClick={() => applyPreset(p)}
                      className={cn('flex-1 text-left text-sm', activePresetId === p.id ? 'font-medium text-brand-700' : 'text-slate-700')}
                    >
                      {p.name} {p.isDefault && <span className="ml-1 text-xs text-slate-400">(默认)</span>}
                    </button>
                    {!p.isDefault && (
                      <Button variant="ghost" size="sm" icon={<Trash2 className="h-3 w-3" />} onClick={() => { setDeletingPreset(p.id); setTimeout(() => handleDeletePreset(p.id), 150); }} />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-slate-100">
                <input
                  type="text"
                  placeholder="新预设名称…"
                  value={savingPreset}
                  onChange={e => setSavingPreset(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSavePreset(savingPreset)}
                  className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:border-brand-400 focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}