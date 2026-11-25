import { ClipboardPen, Download, Search, UserX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import { count, type RiskStudentRow } from "../../lib/renewal";
import { downloadCsv } from "../../lib/exportCsv";
import { api } from "../../api/client";
import Button from "../ui/Button";
import { Select } from "../ui/Field";
import RiskFollowUpModal, {
  type FollowUpStatus,
  type RiskFollowUpRecord,
} from "./RiskFollowUpModal";

interface Props {
  rows: RiskStudentRow[];
  reportId: number;
}

const FOLLOW_UP_LABEL: Record<FollowUpStatus, string> = {
  pending: "待联系",
  contacted: "已联系",
  committed: "已承诺续费",
  renewed: "已续费",
  closed: "已关闭",
};
const FOLLOW_UP_TONE: Record<
  FollowUpStatus,
  "warning" | "info" | "violet" | "success" | "neutral"
> = {
  pending: "warning",
  contacted: "info",
  committed: "violet",
  renewed: "success",
  closed: "neutral",
};
const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "unrecorded", label: "未记录" },
  ...Object.entries(FOLLOW_UP_LABEL).map(([value, label]) => ({
    value,
    label,
  })),
];
const DUE_OPTIONS = [
  { value: "all", label: "全部时间" },
  { value: "overdue", label: "已逾期" },
  { value: "today", label: "今天到期" },
  { value: "week", label: "未来 7 天" },
  { value: "none", label: "进行中但未排期" },
];

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayDistance(date: string, today: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86400000,
  );
}

function isActive(
  record: RiskFollowUpRecord | undefined,
): record is RiskFollowUpRecord {
  return (
    !!record &&
    record.followUpStatus !== "renewed" &&
    record.followUpStatus !== "closed"
  );
}

export default function RiskViewEnhanced({ rows, reportId }: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [dueFilter, setDueFilter] = useState("all");
  const [records, setRecords] = useState<Record<string, RiskFollowUpRecord>>(
    {},
  );
  const [selected, setSelected] = useState<RiskStudentRow | null>(null);
  const [page, setPage] = useState(1);
  const [followUpError, setFollowUpError] = useState("");
  const [followUpLoadState, setFollowUpLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const followUpRequestRef = useRef(0);
  const today = localIsoDate(new Date());
  const followUpsReady = followUpLoadState === "ready";

  const loadFollowUps = useCallback(async () => {
    const requestId = ++followUpRequestRef.current;
    setFollowUpError("");
    setFollowUpLoadState("loading");
    try {
      const response = (await api.get(
        `/renewal/risk-followups?reportId=${reportId}`,
      )) as { records?: RiskFollowUpRecord[] };
      if (requestId !== followUpRequestRef.current) return;
      setRecords(
        Object.fromEntries(
          (response.records || []).map((record) => [record.studentKey, record]),
        ),
      );
      setFollowUpLoadState("ready");
    } catch (reason) {
      if (requestId === followUpRequestRef.current) {
        setFollowUpError(
          reason instanceof Error ? reason.message : "跟进记录加载失败",
        );
        setFollowUpLoadState("error");
      }
    }
  }, [reportId]);
  useEffect(() => {
    setRecords({});
    setSelected(null);
    void loadFollowUps();
    return () => {
      followUpRequestRef.current += 1;
    };
  }, [loadFollowUps]);

  const owners = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(records)
            .map((record) => record.owner.trim())
            .filter(Boolean),
        ),
      ).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [records],
  );
  const summary = useMemo(() => {
    let unrecorded = 0;
    let overdue = 0;
    let dueToday = 0;
    let nextSevenDays = 0;
    for (const row of rows) {
      const record = records[row.studentKey];
      if (!record) unrecorded += 1;
      if (!isActive(record) || !record.nextFollowUpDate) continue;
      const distance = dayDistance(record.nextFollowUpDate, today);
      if (distance < 0) overdue += 1;
      if (distance === 0) dueToday += 1;
      if (distance >= 0 && distance <= 7) nextSevenDays += 1;
    }
    return { unrecorded, overdue, dueToday, nextSevenDays };
  }, [records, rows, today]);

  const filteredRows = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const record = records[row.studentKey];
      if (
        keyword &&
        ![
          row.studentName,
          row.studentId,
          row.managerName,
          row.grade,
          row.courseProduct,
          record?.owner,
          record?.outcome,
        ].some((value) =>
          String(value ?? "")
            .toLocaleLowerCase()
            .includes(keyword),
        )
      )
        return false;
      if (statusFilter === "unrecorded" && record) return false;
      if (
        statusFilter !== "all" &&
        statusFilter !== "unrecorded" &&
        record?.followUpStatus !== statusFilter
      )
        return false;
      if (ownerFilter !== "all" && record?.owner !== ownerFilter) return false;
      if (dueFilter !== "all") {
        if (!isActive(record)) return false;
        const distance = record.nextFollowUpDate
          ? dayDistance(record.nextFollowUpDate, today)
          : null;
        if (dueFilter === "none" && distance !== null) return false;
        if (dueFilter === "overdue" && (distance === null || distance >= 0))
          return false;
        if (dueFilter === "today" && distance !== 0) return false;
        if (
          dueFilter === "week" &&
          (distance === null || distance < 0 || distance > 7)
        )
          return false;
      }
      return true;
    });
  }, [dueFilter, ownerFilter, query, records, rows, statusFilter, today]);

  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  useEffect(() => {
    setPage(1);
  }, [reportId, query, statusFilter, ownerFilter, dueFilter]);

  function exportFilteredRows() {
    downloadCsv(
      `待关注学生-筛选结果-${today}.csv`,
      [
        { label: "学生编号", value: (row) => row.studentId },
        { label: "学生", value: (row) => row.studentName },
        { label: "学管", value: (row) => row.managerName },
        { label: "年级", value: (row) => row.grade },
        { label: "课程", value: (row) => row.courseProduct },
        {
          label: "跟进状态",
          value: (row) =>
            records[row.studentKey]
              ? FOLLOW_UP_LABEL[records[row.studentKey].followUpStatus]
              : "未记录",
        },
        {
          label: "跟进负责人",
          value: (row) => records[row.studentKey]?.owner ?? null,
        },
        {
          label: "下次跟进日期",
          value: (row) => records[row.studentKey]?.nextFollowUpDate ?? null,
        },
        {
          label: "沟通与处置记录",
          value: (row) => records[row.studentKey]?.outcome ?? null,
        },
      ],
      filteredRows,
    );
  }

  return (
    <>
      <Card className="h-full">
        <CardHeader
          title="待关注学生"
          description="接口口径：本月未续费且上月无课消（class_last1 = 0）；跟进记录独立于 Excel 原始状态"
          icon={<UserX className="h-5 w-5" />}
          action={<Badge tone="warning">{count(rows.length)} 人</Badge>}
        />
        <CardBody className="space-y-4 p-4">
          {followUpError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600"
            >
              <span>{followUpError}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadFollowUps()}
              >
                重新加载跟进
              </Button>
            </div>
          )}
          <div
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
            aria-label="跟进概览"
          >
            {[
              {
                label: "未记录",
                value: summary.unrecorded,
                tone: "text-slate-700",
              },
              { label: "已逾期", value: summary.overdue, tone: "text-red-600" },
              {
                label: "今天到期",
                value: summary.dueToday,
                tone: "text-amber-600",
              },
              {
                label: "未来 7 天",
                value: summary.nextSevenDays,
                tone: "text-brand-600",
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3"
              >
                <div className="text-xs text-slate-500">{item.label}</div>
                <div
                  className={`mt-1 text-2xl font-semibold tabular-nums ${item.tone}`}
                >
                  {followUpsReady ? item.value : "—"}
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="relative block md:col-span-2 xl:col-span-1">
              <span className="sr-only">搜索学生、学管、课程或跟进内容</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索学生或跟进内容"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <Select
              aria-label="按跟进状态筛选"
              options={STATUS_OPTIONS}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              disabled={!followUpsReady}
            />
            <Select
              aria-label="按跟进负责人筛选"
              options={[
                { value: "all", label: "全部负责人" },
                ...owners.map((owner) => ({ value: owner, label: owner })),
              ]}
              value={ownerFilter}
              onChange={(event) => setOwnerFilter(event.target.value)}
              disabled={!followUpsReady}
            />
            <Select
              aria-label="按跟进时间筛选"
              options={DUE_OPTIONS}
              value={dueFilter}
              onChange={(event) => setDueFilter(event.target.value)}
              disabled={!followUpsReady}
            />
            <Button
              variant="outline"
              icon={<Download className="h-4 w-4" />}
              onClick={exportFilteredRows}
              disabled={!followUpsReady || filteredRows.length === 0}
            >
              导出筛选结果
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              显示 {filteredRows.length} / {rows.length}{" "}
              人；已逾期和今天到期只统计仍在跟进中的记录
            </span>
            {(query ||
              statusFilter !== "all" ||
              ownerFilter !== "all" ||
              dueFilter !== "all") && (
              <button
                type="button"
                className="font-medium text-brand-600 hover:text-brand-700"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                  setOwnerFilter("all");
                  setDueFilter("all");
                }}
              >
                清除筛选
              </button>
            )}
          </div>
          {filteredRows.length === 0 ? (
            <p className="rounded-xl bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
              {rows.length === 0
                ? "接口已成功返回空列表，当前没有符合该口径的学生"
                : "没有匹配筛选条件的学生"}
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500">
                    <tr className="border-b border-slate-200">
                      <th className="px-4 py-3 font-medium">学管</th>
                      <th className="px-4 py-3 font-medium">学生 ID</th>
                      <th className="px-4 py-3 font-medium">学生</th>
                      <th className="px-4 py-3 font-medium">年级</th>
                      <th className="px-4 py-3 font-medium">课程</th>
                      <th className="px-4 py-3 font-medium">在读天数</th>
                      <th className="px-4 py-3 font-medium">系数</th>
                      <th className="px-4 py-3 font-medium">类型</th>
                      <th className="px-4 py-3 font-medium">上 2 月课消</th>
                      <th className="px-4 py-3 font-medium">上月课消</th>
                      <th className="px-4 py-3 font-medium">跟进状态</th>
                      <th className="px-4 py-3 font-medium">负责人</th>
                      <th className="px-4 py-3 font-medium">下次跟进</th>
                      <th className="px-4 py-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pageRows.map((row, index) => {
                      const record = records[row.studentKey];
                      const distance =
                        isActive(record) && record.nextFollowUpDate
                          ? dayDistance(record.nextFollowUpDate, today)
                          : null;
                      return (
                        <tr
                          key={
                            row.studentKey ||
                            `${row.studentId}:${row.sourceRow}:${index}`
                          }
                          className="hover:bg-slate-50/60"
                        >
                          <td className="px-4 py-3 text-slate-600">
                            {row.managerName || "—"}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-slate-600">
                            {row.studentId || "—"}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-700">
                            {row.studentName || "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {row.grade || "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {row.courseProduct || "—"}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-slate-600">
                            {count(row.enrollDays)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-slate-600">
                            {count(row.coef)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {row.type || "—"}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-slate-600">
                            {count(row.classLast2)}
                          </td>
                          <td className="px-4 py-3 tabular-nums text-slate-600">
                            {count(row.classLast1)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {!followUpsReady ? (
                              followUpLoadState === "loading" ? (
                                "加载中…"
                              ) : (
                                "状态未知"
                              )
                            ) : record ? (
                              <Badge
                                tone={FOLLOW_UP_TONE[record.followUpStatus]}
                              >
                                {FOLLOW_UP_LABEL[record.followUpStatus]}
                              </Badge>
                            ) : (
                              "未记录"
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {followUpsReady ? record?.owner || "—" : "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {record?.nextFollowUpDate ? (
                              <div className="whitespace-nowrap">
                                <div>{record.nextFollowUpDate}</div>
                                {distance !== null && distance < 0 && (
                                  <Badge tone="danger" className="mt-1">
                                    逾期 {-distance} 天
                                  </Badge>
                                )}
                                {distance === 0 && (
                                  <Badge tone="warning" className="mt-1">
                                    今天到期
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<ClipboardPen className="h-3.5 w-3.5" />}
                              onClick={() => setSelected(row)}
                              disabled={!followUpsReady}
                            >
                              {!followUpsReady
                                ? "暂不可用"
                                : record
                                  ? "编辑跟进"
                                  : "记录跟进"}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-500">
                  <span>
                    第 {currentPage} / {totalPages} 页，每页 {pageSize}{" "}
                    人；筛选与导出仍覆盖全部 {filteredRows.length} 人
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                      上一页
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage >= totalPages}
                      onClick={() =>
                        setPage((value) => Math.min(totalPages, value + 1))
                      }
                    >
                      下一页
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>
      <RiskFollowUpModal
        open={selected !== null}
        student={selected}
        reportId={reportId}
        record={selected ? records[selected.studentKey] : null}
        onClose={() => setSelected(null)}
        onSaved={(record) =>
          setRecords((previous) => ({
            ...previous,
            [record.studentKey]: record,
          }))
        }
      />
    </>
  );
}
