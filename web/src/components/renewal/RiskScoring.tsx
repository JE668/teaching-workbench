import { useMemo, useState } from 'react';
import { Card, CardBody, CardHeader } from '../ui/Card';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { cn } from '../../lib/utils';
import { count, type RiskStudentRow } from '../../lib/renewal';
import { TrendingDown, AlertTriangle, CheckCircle, UserX, Clock, Target, Award } from 'lucide-react';

/** 风险等级 */
export type RiskLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface RiskScoredStudent extends RiskStudentRow {
  riskScore: number;      // 0-100，越高风险越大
  riskLevel: RiskLevel;
  riskFactors: RiskFactor[];
  /** 最近 N 个月课消趋势 */
  classTrend?: number[];
}

/** 风险因子 */
export interface RiskFactor {
  id: string;
  label: string;
  score: number;        // 贡献分数
  severity: 'high' | 'medium' | 'low';
  description: string;
}

/** 风险评分配置 */
const RISK_CONFIG = {
  // 课消衰减权重
  classDecay: {
    last1Weight: 30,      // 上月无课消
    last2Weight: 20,      // 上上月无课消
    bothMissingBonus: 15, // 连续两月无课消额外加分
  },
  // 在读天数权重（越久未续费风险越高）
  enrollDays: {
    threshold: 180,       // 半年分界线
    maxScore: 20,
  },
  // 年级权重（毕业班优先关注）
  grade: {
    graduatingBonus: 15,  // 初三/高三
    seniorBonus: 10,      // 高一/高二
  },
  // 课程产品权重
  product: {
    one2oneBonus: 5,      // 一对一单价高，流失损失大
  },
  // 系数
  coef: {
    highThreshold: 1.5,
    highScore: 10,
  },
};

/** 计算单个学生的风险评分 */
export function computeRiskScore(student: RiskStudentRow): RiskScoredStudent {
  const factors: RiskFactor[] = [];
  let score = 0;

  // 1. 课消衰减（核心指标）
  const hasClassLast1 = (student.classLast1 ?? 0) > 0;
  const hasClassLast2 = (student.classLast2 ?? 0) > 0;

  if (!hasClassLast1) {
    factors.push({
      id: 'no-class-last1',
      label: '上月零课消',
      score: RISK_CONFIG.classDecay.last1Weight,
      severity: 'high',
      description: '上月完全无课消记录，流失风险极高',
    });
    score += RISK_CONFIG.classDecay.last1Weight;
  }
  if (!hasClassLast2) {
    factors.push({
      id: 'no-class-last2',
      label: '上上月零课消',
      score: RISK_CONFIG.classDecay.last2Weight,
      severity: hasClassLast1 ? 'medium' : 'high',
      description: hasClassLast1
        ? '上上月无课消，但上月有课消（可能暂时停课）'
        : '连续两月无课消，持续流失信号',
    });
    score += RISK_CONFIG.classDecay.last2Weight;
  }
  if (!hasClassLast1 && !hasClassLast2) {
    factors.push({
      id: 'continuous-decay',
      label: '连续两月零课消',
      score: RISK_CONFIG.classDecay.bothMissingBonus,
      severity: 'high',
      description: '连续两个月无任何课消，属于高危休眠学员',
    });
    score += RISK_CONFIG.classDecay.bothMissingBonus;
  }

  // 2. 在读天数（越久未续费，积累的未续费金额越大）
  const enrollDays = student.enrollDays ?? 0;
  if (enrollDays > RISK_CONFIG.enrollDays.threshold) {
    const extraDays = enrollDays - RISK_CONFIG.enrollDays.threshold;
    const dayScore = Math.min(RISK_CONFIG.enrollDays.maxScore, Math.floor(extraDays / 30) * 5);
    if (dayScore > 0) {
      factors.push({
        id: 'long-enroll',
        label: `在读 ${enrollDays} 天`,
        score: dayScore,
        severity: dayScore >= 15 ? 'high' : 'medium',
        description: `在读超过 ${RISK_CONFIG.enrollDays.threshold} 天未续费，累计流失金额可能较大`,
      });
      score += dayScore;
    }
  }

  // 3. 年级权重
  const grade = student.grade?.toString() || '';
  const isGraduating = ['初三', '高三', '9', '12', 'grade9', 'grade12'].some(g => grade.includes(g));
  const isSeniorHigh = ['高一', '高二', '10', '11'].some(g => grade.includes(g));
  if (isGraduating) {
    factors.push({
      id: 'graduating-grade',
      label: '毕业班学员',
      score: RISK_CONFIG.grade.graduatingBonus,
      severity: 'high',
      description: '毕业班学员续费窗口期短，优先跟进',
    });
    score += RISK_CONFIG.grade.graduatingBonus;
  } else if (isSeniorHigh) {
    factors.push({
      id: 'senior-high',
      label: '高中非毕业班',
      score: RISK_CONFIG.grade.seniorBonus,
      severity: 'medium',
      description: '高中阶段学员单价高、决策周期长，需重点维护',
    });
    score += RISK_CONFIG.grade.seniorBonus;
  }

  // 4. 课程产品
  const product = student.courseProduct?.toString() || '';
  if (product.includes('一对一') || product.includes('1对1') || product.includes('1v1')) {
    factors.push({
      id: 'one2one-product',
      label: '一对一课程',
      score: RISK_CONFIG.product.one2oneBonus,
      severity: 'low',
      description: '一对一单价高，单客流失损失大',
    });
    score += RISK_CONFIG.product.one2oneBonus;
  }

  // 5. 系数
  const coef = student.coef ?? 0;
  if (coef >= RISK_CONFIG.coef.highThreshold) {
    factors.push({
      id: 'high-coef',
      label: `系数 ${coef.toFixed(1)}`,
      score: RISK_CONFIG.coef.highScore,
      severity: 'medium',
      description: '课消系数偏高，可能存在补课/透支预存情况',
    });
    score += RISK_CONFIG.coef.highScore;
  }

  // 归一化到 0-100
  const normalizedScore = Math.min(100, Math.round(score));

  // 确定风险等级
  let riskLevel: RiskLevel;
  if (normalizedScore >= 70) riskLevel = 'high';
  else if (normalizedScore >= 40) riskLevel = 'medium';
  else if (normalizedScore > 0) riskLevel = 'low';
  else riskLevel = 'unknown';

  return {
    ...student,
    riskScore: normalizedScore,
    riskLevel,
    riskFactors: factors,
  };
}

/** 批量计算风险评分 */
export function computeBatchRiskScores(students: RiskStudentRow[]): RiskScoredStudent[] {
  return students.map(computeRiskScore).sort((a, b) => b.riskScore - a.riskScore);
}

/** 风险等级配置 */
export const RISK_LEVEL_CONFIG: Record<RiskLevel, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  high: { label: '高危', color: '#EF4444', bgColor: '#FEF2F2', icon: <AlertTriangle className="h-3 w-3" /> },
  medium: { label: '中危', color: '#F59E0B', bgColor: '#FFFBEB', icon: <TrendingDown className="h-3 w-3" /> },
  low: { label: '低危', color: '#10B981', bgColor: '#ECFDF5', icon: <CheckCircle className="h-3 w-3" /> },
  unknown: { label: '未评分', color: '#94A3B8', bgColor: '#F8FAFC', icon: <Clock className="h-3 w-3" /> },
};

/** 风险分布统计 */
export function getRiskDistribution(scored: RiskScoredStudent[]) {
  const dist = { high: 0, medium: 0, low: 0, unknown: 0 } as Record<RiskLevel, number>;
  for (const s of scored) dist[s.riskLevel]++;
  return dist;
}

/** 风险学生列表组件 */
interface RiskScoredListProps {
  students: RiskScoredStudent[];
  onStudentClick?: (student: RiskScoredStudent) => void;
  compact?: boolean;
}

export default function RiskScoredList({ students, onStudentClick, compact = false }: RiskScoredListProps) {
  const [filterLevel, setFilterLevel] = useState<RiskLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    let result = students;
    if (filterLevel !== 'all') result = result.filter(s => s.riskLevel === filterLevel);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(s =>
        s.studentName?.toLowerCase().includes(q) ||
        s.studentId?.toLowerCase().includes(q) ||
        s.managerName?.toLowerCase().includes(q) ||
        s.grade?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [students, filterLevel, searchQuery]);

  const dist = useMemo(() => getRiskDistribution(students), [students]);

  if (students.length === 0) {
    return (
      <Card className="h-full">
        <CardHeader title="风险学员" icon={<UserX className="h-5 w-5" />} />
        <CardBody className="py-16 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
            <UserX className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-lg font-medium text-slate-600 mb-1">暂无风险学员数据</h3>
          <p className="text-sm text-slate-400">当前报表无待关注学生明细</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader
        title="风险学员智能评分"
        icon={<UserX className="h-5 w-5" />}
        action={
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="search"
                placeholder="搜索姓名/ID/学管/年级…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-56 h-8 rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400"
              />
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            </div>
            <select
              value={filterLevel}
              onChange={e => setFilterLevel(e.target.value as any)}
              className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-brand-400"
            >
              <option value="all">全部等级</option>
              <option value="high">高危</option>
              <option value="medium">中危</option>
              <option value="low">低危</option>
            </select>
          </div>
        }
      />
      <CardBody className="p-4 space-y-4">
        {/* 风险分布概览 */}
        <div className="flex flex-wrap gap-3" role="group" aria-label="风险等级分布">
          {(['high', 'medium', 'low', 'unknown'] as RiskLevel[]).map(level => {
            const cfg = RISK_LEVEL_CONFIG[level];
            const levelColor: Record<RiskLevel, { bg: string; text: string; hover: string; shadow: string }> = {
              high: { bg: 'bg-red-600', text: 'text-red-700', hover: 'hover:bg-red-100', shadow: 'shadow-red-500/25' },
              medium: { bg: 'bg-amber-600', text: 'text-amber-700', hover: 'hover:bg-amber-100', shadow: 'shadow-amber-500/25' },
              low: { bg: 'bg-emerald-600', text: 'text-emerald-700', hover: 'hover:bg-emerald-100', shadow: 'shadow-emerald-500/25' },
              unknown: { bg: 'bg-slate-600', text: 'text-slate-700', hover: 'hover:bg-slate-100', shadow: 'shadow-slate-500/25' },
            };
            const colors = levelColor[level];
            return (
              <button
                key={level}
                onClick={() => setFilterLevel(filterLevel === level ? 'all' : level)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
                  filterLevel === level
                    ? `${colors.bg} text-white ${colors.shadow}`
                    : `bg-${colors.text.replace('text-', 'bg-').replace('-700', '-50')} ${colors.text} ${colors.hover}`,
                )}
                aria-pressed={filterLevel === level}
              >
                <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-xs', filterLevel === level ? 'bg-white/20' : 'bg-white/50')} style={{ color: cfg.color }}>
                  {cfg.icon}
                </span>
                <span>{cfg.label}</span>
                <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-bold', filterLevel === level ? 'bg-white/30' : 'bg-white/50')}>
                  {dist[level]}
                </span>
              </button>
            );
          })}
        </div>

        {/* 列表 */}
        <div className="rounded-lg border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 font-medium w-14 text-center">评分</th>
                  <th className="px-4 py-3 font-medium w-10 text-center">等级</th>
                  <th className="px-4 py-3 font-medium">学生</th>
                  <th className="px-4 py-3 font-medium">学管</th>
                  <th className="px-4 py-3 font-medium w-20 text-center">年级</th>
                  <th className="px-4 py-3 font-medium">课程</th>
                  <th className="px-4 py-3 font-medium w-24 text-center">在读天数</th>
                  <th className="px-4 py-3 font-medium w-28 text-center">上月课消</th>
                  <th className="px-4 py-3 font-medium w-28 text-center">上上月课消</th>
                  <th className="px-4 py-3 font-medium w-40">风险因子</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((student, idx) => {
                  const levelCfg = RISK_LEVEL_CONFIG[student.riskLevel];
                  const topFactors = student.riskFactors.filter(f => f.severity === 'high').slice(0, 2);
                  const otherFactors = student.riskFactors.filter(f => f.severity !== 'high').slice(0, 1);
                  const displayFactors = [...topFactors, ...otherFactors];

                  return (
                    <tr
                      key={student.studentKey || idx}
                      className={cn('hover:bg-slate-50/60 transition-colors cursor-pointer', compact && 'py-2', !compact && 'py-3')}
                      onClick={() => onStudentClick?.(student)}
                      style={{ borderLeft: `4px solid ${levelCfg.color}` }}
                    >
                      <td className="px-4 text-center font-bold tabular-nums" style={{ color: levelCfg.color }}>
                        {student.riskScore}
                      </td>
                      <td className="px-4 text-center">
                        <Badge tone={student.riskLevel === 'high' ? 'danger' : student.riskLevel === 'medium' ? 'warning' : student.riskLevel === 'low' ? 'success' : 'neutral'}>
                          {levelCfg.label}
                        </Badge>
                      </td>
                      <td className="px-4 font-medium text-slate-800">
                        {student.studentName}
                        {student.studentId && <span className="ml-2 text-xs text-slate-400">ID: {student.studentId}</span>}
                      </td>
                      <td className="px-4 text-slate-600">{student.managerName || '—'}</td>
                      <td className="px-4 text-center text-slate-600">{student.grade || '—'}</td>
                      <td className="px-4 text-slate-600 truncate max-w-[180px]">{student.courseProduct || '—'}</td>
                      <td className="px-4 text-center text-slate-600 tabular-nums">{count(student.enrollDays)}</td>
                      <td className="px-4 text-center">
                        {student.classLast1 !== null && student.classLast1 !== undefined ? (
                          <span className={cn('font-medium', student.classLast1 > 0 ? 'text-emerald-600' : 'text-red-600')}>
                            {count(student.classLast1)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 text-center">
                        {student.classLast2 !== null && student.classLast2 !== undefined ? (
                          <span className={cn('font-medium', student.classLast2 > 0 ? 'text-emerald-600' : 'text-red-600')}>
                            {count(student.classLast2)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4">
                        <div className="flex flex-wrap gap-1">
                          {displayFactors.map(f => (
                            <Badge
                              key={f.id}
                              tone={f.severity === 'high' ? 'danger' : f.severity === 'medium' ? 'warning' : 'success'}

                              className="cursor-help"
                              title={f.description}
                            >
                              {f.label}
                            </Badge>
                          ))}
                          {student.riskFactors.length > displayFactors.length && (
                             <Badge tone="neutral" className="text-xs">+{student.riskFactors.length - displayFactors.length}</Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="p-8 text-center text-slate-400">
              {searchQuery ? `未找到匹配 "${searchQuery}" 的学员` : `无 ${filterLevel === 'all' ? '' : RISK_LEVEL_CONFIG[filterLevel].label} 等级学员`}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
