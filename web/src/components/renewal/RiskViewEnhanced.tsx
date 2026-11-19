import React, { useState } from 'react';
import { AlertTriangle, Search, Filter, Download, Users, TrendingDown, Award, Target } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { cn } from '../../lib/utils';
import { count, money, NOT_AVAILABLE_YET, pct, type RiskStudentRow } from '../../lib/renewal';
import BarList, { BarListRow } from './BarList';
import Sparkline from './Sparkline';

/** 风险学生增强视图所需字段（在 RenewalDashboard 中由基础数据转换而来） */
interface RiskStudentEnhanced {
  managerName: string | null;
  studentId: string | null;
  studentName: string;
  grade: string | null;
  enrollDays: number | null;
  coef: number | null;
  type: string | null;
  courseProduct: string | null;
  classLast1: number | null;
  classLast2: number | null;
  // 增强字段（后端暂未提供，预留字段）
  teacherName?: string | null;
  subjectGroup?: string | null;
  riskLevel: 'low' | 'medium' | 'high';
  riskCount: number;
  status: 'renewed' | 'prepaid' | 'dropped' | 'graduating' | 'normal';
  prepaid: boolean;
  renewed: boolean;
  remainingHours: number | null;
  riskReasons: string[];
}

interface Props {
  students: RiskStudentEnhanced[];
}

const RISK_LEVELS = [
  { key: 'all', label: '全部' },
  { key: 'high', label: '高危（≥3项）' },
  { key: 'medium', label: '中危（2项）' },
  { key: 'low', label: '低危（1项）' },
];

const STATUS_COLORS: Record<string, string> = {
  renewed: 'bg-emerald-500',
  prepaid: 'bg-purple-500',
  dropped: 'bg-red-500',
  graduating: 'bg-amber-500',
};

export default function RiskViewEnhanced({ students }: Props) {
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [search, setSearch] = useState('');

  if (students.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader
          title="风险学生清单"
          description="预警：预存未续、停课未结、高三毕业、课消异常的学生名单"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <CardBody className="py-16">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-slate-300" />
            </div>
            <h3 className="text-lg font-medium text-slate-600 mb-1">{NOT_AVAILABLE_YET}</h3>
            <p className="text-sm text-slate-400">续生率明细将在下个月录入完成后显示</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const filtered = students.filter(s => {
    if (filter !== 'all' && s.riskLevel !== filter) return false;
    if (search && !s.studentName.toLowerCase().includes(search.toLowerCase()) &&
        !s.teacherName?.toLowerCase().includes(search.toLowerCase()) &&
        !s.managerName?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // 汇总统计
  const stats = students.reduce((acc, s) => {
    acc[s.riskLevel] = (acc[s.riskLevel] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // TOP 风险榜单
  const topRisk: BarListRow[] = students
    .filter(s => s.riskLevel === 'high' || s.riskLevel === 'medium')
    .sort((a, b) => (b.riskCount || 0) - (a.riskCount || 0))
    .slice(0, 10)
    .map((s, i) => ({
      label: s.studentName,
      value: String(s.riskCount || 0),
      rawValue: s.riskCount || 0,
      ratio: Math.max(...students.map(x => x.riskCount || 0), 1) > 0 ? ((s.riskCount || 0) / Math.max(...students.map(x => x.riskCount || 0), 1)) * 100 : 0,
      hint: `${s.teacherName || '—'} · ${s.managerName || '—'} · ${s.status}`,
      className: s.riskLevel === 'high' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700',
      color: s.riskLevel === 'high' ? 'bg-red-500' : 'bg-amber-500',
    }));

  return (
    <Card className="h-full">
      <CardHeader
        title="风险学生清单"
        description="预警：预存未续、停课未结、高三毕业、课消异常的学生名单"
        icon={<AlertTriangle className="h-5 w-5" />}
        action={
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="搜索学生/老师/学管..."
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              className="w-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none pl-10 relative"
            />
            <select
              value={filter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')}
              className="w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none"
            >
              {RISK_LEVELS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
          </div>
        }
      />
      <CardBody className="space-y-6 p-4">
        {/* 风险等级分布 */}
        <div className="flex gap-3 flex-wrap">
          {RISK_LEVELS.slice(1).map(l => (
            <div key={l.key} className="rounded-xl px-4 py-3 bg-slate-50 border border-slate-100 flex items-center gap-2">
              <span className={cn('w-2.5 h-2.5 rounded-full',
                l.key === 'high' && 'bg-red-500',
                l.key === 'medium' && 'bg-amber-500',
                l.key === 'low' && 'bg-sky-500',
              )} />
              <span className="text-sm font-medium text-slate-700">{l.label}</span>
              <span className="text-lg font-bold tabular-nums text-slate-800">{stats[l.key] || 0}</span>
            </div>
          ))}
          <div className="rounded-xl px-4 py-3 bg-slate-50 border border-slate-100 flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <span className="text-sm font-medium text-slate-700">合计</span>
            <span className="text-lg font-bold tabular-nums text-slate-800">{students.length}</span>
          </div>
        </div>

        {/* TOP 风险榜单 */}
        {topRisk.length > 0 && (
          <div className="rounded-xl bg-slate-50/50 p-4 border border-slate-100">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
              <Award className="h-4 w-4 text-red-500" />
              高/中危 TOP 10（按风险项数排序）
            </h4>
            <BarList rows={topRisk} compact />
          </div>
        )}

        {/* 明细表格 */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 font-medium">学生</th>
                  <th className="px-4 py-3 font-medium">年级</th>
                  <th className="px-4 py-3 font-medium">老师</th>
                  <th className="px-4 py-3 font-medium">学管</th>
                  <th className="px-4 py-3 font-medium">科组</th>
                  <th className="px-4 py-3 font-medium">风险等级</th>
                  <th className="px-4 py-3 font-medium">风险项数</th>
                  <th className="px-4 py-3 font-medium">状态标签</th>
                  <th className="px-4 py-3 font-medium">预存</th>
                  <th className="px-4 py-3 font-medium">续费</th>
                  <th className="px-4 py-3 font-medium">剩余课时</th>
                  <th className="px-4 py-3 font-medium">风险详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s, i) => (
                  <tr key={s.studentName + ':' + s.teacherName + ':' + i} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{s.studentName}</td>
                    <td className="px-4 py-3 text-slate-600">{s.grade || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{s.teacherName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{s.managerName || '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{s.subjectGroup || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        s.riskLevel === 'high' && 'bg-red-100 text-red-700',
                        s.riskLevel === 'medium' && 'bg-amber-100 text-amber-700',
                        s.riskLevel === 'low' && 'bg-sky-100 text-sky-700',
                      )}>
                        {RISK_LEVELS.find(x => x.key === s.riskLevel)?.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-700 font-medium">{s.riskCount}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', STATUS_COLORS[s.status])}>
                        {s.status === 'renewed' && '已续费'}
                        {s.status === 'prepaid' && '已预存'}
                        {s.status === 'dropped' && '停课/结课'}
                        {s.status === 'graduating' && '高三毕业'}
                        {s.status === 'normal' && '正常'}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{s.prepaid ? '是' : '否'}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{s.renewed ? '是' : '否'}</td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{s.remainingHours !== null ? count(s.remainingHours) : '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{s.riskReasons.join('；') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {filtered.length !== students.length && (
          <div className="text-xs text-slate-400 text-center py-2">
            共 {students.length} 条，筛选后显示 {filtered.length} 条
          </div>
        )}
      </CardBody>
    </Card>
  );
}
