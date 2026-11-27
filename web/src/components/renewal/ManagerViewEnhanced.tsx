import { useEffect, useRef, useState } from 'react';
import { Users, Target, DollarSign, Award, Settings2, RotateCcw } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import { Input } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { api } from '../../api/client';
import { cn } from '../../lib/utils';
import {
  clampRatio,
  count,
  money,
  pct,
  rankStyle,
  type CashflowProductKey,
  type ManagerPerfRow,
} from '../../lib/renewal';
import BarList, { BarListRow } from './BarList';

interface Props {
  rows: ManagerPerfRow[];
  reportId: number;
  onSaved: (rows: ManagerPerfRow[]) => void;
}

type TargetDraft = {
  targetAmount: string;
  productTargets: Record<CashflowProductKey, string>;
};

const PRODUCTS: Array<{ key: CashflowProductKey; label: string }> = [
  { key: 'one2one', label: '一对一' },
  { key: 'one2many', label: '一对多' },
  { key: 'small', label: '小班' },
  { key: 'other', label: '其他' },
];

function amountText(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

function draftsFromRows(rows: ManagerPerfRow[]): TargetDraft[] {
  return rows.map(row => ({
    targetAmount: amountText(row.taskAmount),
    productTargets: {
      one2one: amountText(row.productTargets?.one2one),
      one2many: amountText(row.productTargets?.one2many),
      small: amountText(row.productTargets?.small),
      other: amountText(row.productTargets?.other),
    },
  }));
}

function parseAmount(value: string, label: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label}须为非负有限数`);
  }
  return parsed;
}

function productCompletion(actual: number | null, target: number | null): number | null {
  return actual !== null && target !== null && Number.isFinite(actual) && Number.isFinite(target) && target > 0
    ? (actual / target) * 100
    : null;
}

export default function ManagerViewEnhanced({ rows, reportId, onSaved }: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [drafts, setDrafts] = useState<TargetDraft[]>(() => draftsFromRows(rows));
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [savingAction, setSavingAction] = useState<'save' | 'restore' | null>(null);
  const [error, setError] = useState('');
  const { success } = useToast();
  const saving = savingIndex !== null;
  const reportIdRef = useRef(reportId);
  const requestSequence = useRef(0);
  reportIdRef.current = reportId;

  useEffect(() => {
    requestSequence.current += 1;
    setEditorOpen(false);
    setSavingIndex(null);
    setSavingAction(null);
    setError('');
    setDrafts([]);
  }, [reportId]);

  function openEditor() {
    setDrafts(draftsFromRows(rows));
    setError('');
    setEditorOpen(true);
  }

  function updateDraft(index: number, field: 'targetAmount' | CashflowProductKey, value: string) {
    setDrafts(current => current.map((draft, draftIndex) => {
      if (draftIndex !== index) return draft;
      return field === 'targetAmount'
        ? { ...draft, targetAmount: value }
        : { ...draft, productTargets: { ...draft.productTargets, [field]: value } };
    }));
    setError('');
  }

  async function saveTarget(index: number, restoreExcel = false) {
    const row = rows[index];
    const draft = drafts[index];
    let target: {
      managerName: string;
      targetAmount: number | null;
      productTargets: Record<CashflowProductKey, number | null> | null;
    };
    try {
      target = restoreExcel
        ? { managerName: row.managerName, targetAmount: null, productTargets: null }
        : {
            managerName: row.managerName,
            targetAmount: parseAmount(draft.targetAmount, `${row.managerName}总任务`),
            productTargets: {
              one2one: parseAmount(draft.productTargets.one2one, `${row.managerName}一对一目标`),
              one2many: parseAmount(draft.productTargets.one2many, `${row.managerName}一对多目标`),
              small: parseAmount(draft.productTargets.small, `${row.managerName}小班目标`),
              other: parseAmount(draft.productTargets.other, `${row.managerName}其他目标`),
            },
          };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '请检查任务金额');
      return;
    }

    const requestId = ++requestSequence.current;
    const requestReportId = reportId;
    setSavingIndex(index);
    setSavingAction(restoreExcel ? 'restore' : 'save');
    setError('');
    try {
      const response = await api.put('/renewal/analytics/manager-targets', {
        reportId: requestReportId,
        targets: [target],
      }) as { reportId: number; rows: ManagerPerfRow[] };
      if (requestId !== requestSequence.current || requestReportId !== reportIdRef.current) return;
      if (response.reportId !== requestReportId) {
        setError('保存响应批次不一致，请重试');
        return;
      }
      onSaved(response.rows);
      success(restoreExcel ? `${row.managerName}已恢复 Excel 任务` : `${row.managerName}现金流任务已保存`);
      setEditorOpen(false);
    } catch (reason) {
      if (requestId === requestSequence.current && requestReportId === reportIdRef.current) {
        setError(reason instanceof Error ? reason.message : '现金流任务保存失败');
      }
    } finally {
      if (requestId === requestSequence.current) {
        setSavingIndex(null);
        setSavingAction(null);
      }
    }
  }

  if (rows.length === 0) {
    return (
      <Card className="h-full">
        <CardBody className="py-16">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
              <Users className="h-8 w-8 text-slate-300" />
            </div>
            <h3 className="mb-1 text-lg font-medium text-slate-600">没有解析到学管业绩</h3>
            <p className="text-sm text-slate-400">确认表格包含「学管业绩统计表」sheet（表头在第 3-4 行，数据第 5 行起）</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const sumKnown = (pick: (row: ManagerPerfRow) => number | null | undefined): number | null => {
    const values = rows.map(pick).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const totals = {
    cashflow: sumKnown(r => r.cashflowTotal),
    task: sumKnown(r => r.taskAmount),
    renewed: sumKnown(r => r.renewedCount),
    tutored: sumKnown(r => r.tutoredCount),
    actualStudents: sumKnown(r => r.actualStudents),
  };
  const completionRate = totals.cashflow !== null && totals.task !== null && totals.task > 0
    ? (totals.cashflow / totals.task) * 100
    : null;
  const averagePerStudent = totals.cashflow !== null && totals.actualStudents !== null && totals.actualStudents > 0
    ? totals.cashflow / totals.actualStudents
    : null;
  const completionRows = rows.filter(r => typeof r.completionRate === 'number' && Number.isFinite(r.completionRate));
  const achievedCount = completionRows.filter(r => (r.completionRate ?? 0) >= 100).length;
  const maxCashflow = rows.reduce((max, r) => Math.max(max, r.cashflowTotal ?? 0), 0);

  const cashflowRanking: BarListRow[] = rows
    .filter(r => typeof r.cashflowTotal === 'number' && Number.isFinite(r.cashflowTotal))
    .slice()
    .sort((a, b) => (b.cashflowTotal ?? 0) - (a.cashflowTotal ?? 0))
    .slice(0, 10)
    .map((r, i) => ({
      label: r.managerName,
      value: money(r.cashflowTotal),
      rawValue: r.cashflowTotal ?? 0,
      ratio: maxCashflow > 0 ? ((r.cashflowTotal ?? 0) / maxCashflow) * 100 : 0,
      hint: `任务 ${money(r.taskAmount)} · 完成率 ${pct(r.completionRate)}`,
      className: rankStyle(i),
    }));

  const completionRanking: BarListRow[] = completionRows
    .slice()
    .sort((a, b) => (b.completionRate ?? 0) - (a.completionRate ?? 0))
    .slice(0, 10)
    .map((r, i) => ({
      label: r.managerName,
      value: pct(r.completionRate),
      rawValue: r.completionRate ?? 0,
      ratio: r.completionRate ?? 0,
      hint: `现金流 ${money(r.cashflowTotal)} / 任务 ${money(r.taskAmount)}`,
      className: rankStyle(i),
      color: (r.completionRate ?? 0) >= 100 ? 'bg-emerald-500' : (r.completionRate ?? 0) >= 80 ? 'bg-sky-500' : 'bg-amber-500',
    }));

  return (
    <Card className="h-full">
      <CardHeader
        title="学管业绩"
        description="有效任务与完成率使用保存后的最新口径"
        icon={<Target className="h-5 w-5" />}
        action={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone="brand">{rows.length} 位学管</Badge>
            <Button size="sm" variant="outline" icon={<Settings2 className="h-4 w-4" />} onClick={openEditor}>
              设置现金流任务
            </Button>
          </div>
        )}
      />
      <CardBody className="space-y-6 p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">团队现金流</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-800">{money(totals.cashflow)}</p>
            <p className="mt-1 text-xs text-slate-400">有效任务 {money(totals.task)} · 完成率 {pct(completionRate)}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">续生人数</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{count(totals.renewed)}</p>
            <p className="mt-1 text-xs text-slate-400">带生 {count(totals.tutored)} 人</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">平均单产</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-brand-600">{money(averagePerStudent)}</p>
            <p className="mt-1 text-xs text-slate-400">团队现金流 / 实际学生数 {count(totals.actualStudents)}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">达标人数</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-brand-600">
              {completionRows.length > 0 ? `${achievedCount} / ${completionRows.length}` : '—'}
            </p>
            <p className="mt-1 text-xs text-slate-400">仅有完成率数据的学管 · 完成率 ≥ 100%</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <DollarSign className="h-4 w-4 text-emerald-500" />
              现金流 TOP 10（高→低）
            </h4>
            <BarList rows={cashflowRanking} compact />
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
            <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Award className="h-4 w-4 text-amber-500" />
              完成率 TOP 10（高→低）
            </h4>
            <BarList rows={completionRanking} compact />
          </div>
        </div>

        <section aria-labelledby="manager-detail-heading" className="overflow-hidden rounded-xl border border-slate-200">
          <h3 id="manager-detail-heading" className="border-b border-slate-100 bg-white px-4 py-3 text-sm font-semibold text-slate-700">学管业绩明细</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] whitespace-nowrap text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 font-medium">排名</th>
                  <th className="px-4 py-3 font-medium">学管</th>
                  <th className="px-4 py-3 font-medium">续费汇总</th>
                  <th className="px-4 py-3 font-medium">新签汇总</th>
                  <th className="px-4 py-3 font-medium">续生数</th>
                  <th className="px-4 py-3 font-medium">续生率</th>
                  <th className="px-4 py-3 font-medium">有效任务</th>
                  <th className="px-4 py-3 font-medium">现金流合计</th>
                  <th className="px-4 py-3 font-medium">完成率</th>
                  <th className="px-4 py-3 font-medium">带生数</th>
                  <th className="px-4 py-3 font-medium">带生单产</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => {
                  const adjusted = r.importedTaskAmount !== undefined && r.taskAmount !== r.importedTaskAmount;
                  return (
                    <tr key={r.managerName + ':' + i} className="transition-colors hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <span className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                          i === 0 ? 'bg-amber-100 text-amber-700' : i < 3 ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400',
                        )}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">{r.managerName}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{money(r.renew.total)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{money(r.newsign.total)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.renewedCount)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{pct(r.renewRate)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700" title={adjusted ? `Excel 原值：${money(r.importedTaskAmount)}` : undefined}>
                        <div className="flex items-center gap-2">
                          <span>{money(r.taskAmount)}</span>
                          {adjusted && (
                            <Badge tone="warning" aria-label={`已调整，Excel 原值 ${money(r.importedTaskAmount)}`}>
                              已调整
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-bold tabular-nums text-slate-800">{money(r.cashflowTotal)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
                            <div
                              className={cn('h-full rounded-full transition-all duration-500', (r.completionRate ?? 0) >= 100 ? 'bg-emerald-500' : (r.completionRate ?? 0) >= 80 ? 'bg-sky-500' : 'bg-amber-500')}
                              style={{ width: Math.max(0, Math.min(100, clampRatio(r.completionRate, 100))) + '%' }}
                            />
                          </div>
                          <span className="tabular-nums text-slate-600">{pct(r.completionRate)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{count(r.actualStudents)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{money(r.perStudent)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="product-cashflow-heading" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-4">
            <h3 id="product-cashflow-heading" className="text-sm font-semibold text-slate-800">分产品现金流</h3>
            <p className="mt-1 text-xs text-slate-500">实际现金流 = 续费 + 新签；完成率 = 实际现金流 ÷ 产品目标，缺失值显示 —</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] whitespace-nowrap text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th scope="col" className="px-4 py-3 font-medium">学管</th>
                  <th scope="col" className="px-4 py-3 font-medium">产品</th>
                  <th scope="col" className="px-4 py-3 font-medium">续费</th>
                  <th scope="col" className="px-4 py-3 font-medium">新签</th>
                  <th scope="col" className="px-4 py-3 font-medium">实际现金流</th>
                  <th scope="col" className="px-4 py-3 font-medium">目标</th>
                  <th scope="col" className="px-4 py-3 font-medium">完成率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.flatMap((row, rowIndex) => PRODUCTS.map(product => {
                  const actual = row.productCashflow?.[product.key] ?? null;
                  const target = row.productTargets?.[product.key] ?? null;
                  return (
                    <tr key={`${row.managerName}:${rowIndex}:${product.key}`} aria-label={`${row.managerName} ${product.label}现金流`} className="transition-colors hover:bg-slate-50/60">
                      <th scope="row" className="px-4 py-3 font-medium text-slate-700">{product.key === 'one2one' ? row.managerName : ''}</th>
                      <td className="px-4 py-3 text-slate-600">{product.label}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-500">{money(row.renew[product.key])}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-500">{money(row.newsign[product.key])}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums text-slate-800">{money(actual)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{money(target)}</td>
                      <td className="px-4 py-3 tabular-nums text-slate-700">{pct(productCompletion(actual, target))}</td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        </section>
      </CardBody>

      <Modal
        open={editorOpen}
        onClose={() => { if (!saving) setEditorOpen(false); }}
        title="设置现金流任务"
        description="金额单位：元。产品目标留空表示未设置；总任务留空表示恢复 Excel。"
        size="xl"
        footer={<Button type="button" variant="ghost" disabled={saving} onClick={() => setEditorOpen(false)}>关闭</Button>}
      >
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <caption className="sr-only">逐学管编辑总任务和四产品现金流目标</caption>
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-3 font-medium">学管</th>
                <th scope="col" className="px-3 py-3 font-medium">总任务</th>
                {PRODUCTS.map(product => <th scope="col" key={product.key} className="px-3 py-3 font-medium">{product.label}目标</th>)}
                <th scope="col" className="px-3 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, index) => (
                <tr key={`${row.managerName}:${index}`}>
                  <th scope="row" className="whitespace-nowrap px-3 py-3 font-medium text-slate-700">{row.managerName}</th>
                  <td className="min-w-36 px-3 py-3">
                    <Input
                      aria-label={`${row.managerName} 总任务`}
                      inputMode="decimal"
                      value={drafts[index]?.targetAmount ?? ''}
                      disabled={saving}
                      onChange={event => updateDraft(index, 'targetAmount', event.target.value)}
                      placeholder="留空恢复 Excel"
                    />
                  </td>
                  {PRODUCTS.map(product => (
                    <td key={product.key} className="min-w-32 px-3 py-3">
                      <Input
                        aria-label={`${row.managerName} ${product.label}目标`}
                        inputMode="decimal"
                        value={drafts[index]?.productTargets[product.key] ?? ''}
                        disabled={saving}
                        onChange={event => updateDraft(index, product.key, event.target.value)}
                        placeholder="未设置"
                      />
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-3">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`恢复 ${row.managerName} Excel 任务`}
                        icon={<RotateCcw className="h-3.5 w-3.5" />}
                        loading={savingIndex === index && savingAction === 'restore'}
                        disabled={saving}
                        onClick={() => saveTarget(index, true)}
                      >
                        {savingIndex === index && savingAction === 'restore' ? '恢复中…' : '恢复 Excel'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        aria-label={`保存 ${row.managerName}任务`}
                        loading={savingIndex === index && savingAction === 'save'}
                        disabled={saving}
                        onClick={() => saveTarget(index)}
                      >
                        {savingIndex === index && savingAction === 'save' ? '保存中…' : '保存'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          每位学管独立保存；「恢复 Excel」会清除该学管的总任务与四产品人工覆盖并立即保存。所有金额须为非负有限数。
        </p>
        {error && <div role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>}
      </Modal>
    </Card>
  );
}
