import type { FormEvent } from 'react';
import { Filter, Search, SlidersHorizontal } from 'lucide-react';
import type { TeachingDataFilters, TeachingDataModel } from '../../lib/teachingData';
import { academicYearOptions, COURSE_TAG_OPTIONS, defaultColumnType, DEPARTMENT_OPTIONS, MODEL_OPTIONS } from '../../lib/teachingData';
import Button from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { Input, Select } from '../ui/Field';

interface ExtractionFormProps {
  value: TeachingDataFilters;
  onChange: (value: TeachingDataFilters) => void;
  onSubmit: () => void;
  connected: boolean;
  busy: boolean;
}

export default function ExtractionForm({ value, onChange, onSubmit, connected, busy }: ExtractionFormProps) {
  function update<K extends keyof TeachingDataFilters>(key: K, next: TeachingDataFilters[K]) {
    onChange({ ...value, [key]: next });
  }

  function chooseModel(modelType: TeachingDataModel) {
    onChange({ ...value, modelType, colType: defaultColumnType(modelType), courseTags: [] });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  const columnOptions = value.modelType === 'feedback'
    ? [{ value: 'course_num', label: '按上课次数' }, { value: 'feedback_num', label: '按反馈次数' }]
    : value.modelType === 'tutorplan'
      ? [{ value: 'must_upload_num', label: '应上传次数' }, { value: 'should_upload_num', label: '实际上传次数' }]
      : value.modelType === 'prepare'
        ? [{ value: 'course_num', label: '全部学生' }, { value: 'ready_num', label: '新学生' }]
        : [{ value: 'both', label: '考核率 + 覆盖率（双 Sheet）' }, { value: 'rate', label: '考核率' }, { value: 'num', label: '覆盖率' }];

  return (
    <Card>
      <CardHeader icon={<SlidersHorizontal className="h-5 w-5" />} title="设置提取条件" description="先选择业务模块，再按科组和时间范围缩小结果" />
      <CardBody>
        <form onSubmit={submit} className="space-y-6">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><Filter className="h-4 w-4" /> 业务模块</div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="业务模块">
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={value.modelType === option.value}
                  onClick={() => chooseModel(option.value)}
                  className={'rounded-2xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ' + (value.modelType === option.value ? 'border-brand-400 bg-brand-50 shadow-sm' : 'border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50')}
                >
                  <span className={'block text-sm font-semibold ' + (value.modelType === option.value ? 'text-brand-800' : 'text-slate-800')}>{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Select label="科组" value={value.dept} onChange={(event) => update('dept', event.target.value as TeachingDataFilters['dept'])} options={DEPARTMENT_OPTIONS} />
            <Select label="统计口径" value={value.colType} onChange={(event) => update('colType', event.target.value)} options={columnOptions} />
            {value.modelType === 'evaluate_analysis' ? (
              <>
                <Select label="学年" value={value.schoolYear} onChange={(event) => update('schoolYear', event.target.value)} options={academicYearOptions().map((year) => ({ value: year, label: year }))} />
                <Select label="学期" value={value.term} onChange={(event) => { const term = event.target.value as TeachingDataFilters['term']; onChange({ ...value, term, examType: term === '3' || term === '4' ? '' : value.examType }); }} options={[{ value: '1', label: '上学期' }, { value: '2', label: '下学期' }, { value: '3', label: '暑假' }, { value: '4', label: '寒假' }]} />
                {(value.term === '1' || value.term === '2') && <Select label="考试类型" value={value.examType} onChange={(event) => update('examType', event.target.value as TeachingDataFilters['examType'])} options={[{ value: '', label: '全部考试' }, { value: '1', label: '期中' }, { value: '2', label: '期末' }]} />}
              </>
            ) : (
              <>
                <Input label="开始日期" type="date" value={value.startDate} onChange={(event) => update('startDate', event.target.value)} required />
                <Input label="结束日期" type="date" value={value.endDate} onChange={(event) => update('endDate', event.target.value)} required />
              </>
            )}
          </div>

          {value.modelType === 'prepare' && (
            <fieldset>
              <legend className="mb-3 text-sm font-semibold text-slate-800">课程标签（不勾选表示全部）</legend>
              <div className="flex flex-wrap gap-3">
                {COURSE_TAG_OPTIONS.map((tag) => (
                  <label key={tag.value} className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm text-slate-700 transition hover:border-brand-300 hover:bg-brand-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                      checked={value.courseTags.includes(tag.value)}
                      onChange={() => update('courseTags', value.courseTags.includes(tag.value) ? value.courseTags.filter((item) => item !== tag.value) : [...value.courseTags, tag.value])}
                    />
                    {tag.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <details className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">校区匹配设置</summary>
            <p className="mt-2 text-xs text-slate-500">默认使用源工具的校区配置；仅在平台组织信息变化时调整。</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Input label="分公司 ID" value={value.branchId} onChange={(event) => update('branchId', event.target.value)} required />
              <Input label="分公司名称" value={value.branchName} onChange={(event) => update('branchName', event.target.value)} required />
              <Input label="校区 ID" value={value.campusId} onChange={(event) => update('campusId', event.target.value)} required />
              <Input label="校区名称" value={value.campusName} onChange={(event) => update('campusName', event.target.value)} required />
            </div>
          </details>

          {!connected && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">请先在上方连接晓教育平台，再开始提取。</p>}
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-slate-500">多科组会并行提取；失败页和空科组会在结果中明确标注。</p>
            <Button type="submit" size="lg" loading={busy} disabled={!connected} icon={<Search className="h-4 w-4" />}>
              {busy ? '正在提取，请保持页面打开' : '开始提取数据'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
