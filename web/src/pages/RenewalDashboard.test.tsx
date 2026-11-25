import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RenewalDashboard from "./RenewalDashboard";
import { renderWithProviders } from "../test/test-utils";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(),
    upload: vi.fn(),
    getToken: vi.fn(() => "test-token"),
  },
}));

const getMock = api.get as Mock;

/** 教师统计行：tab 特有拆分列塞 extra */
function makeTeacher(overrides: Record<string, unknown> = {}) {
  return {
    tab: "incentive",
    teacherName: "张明",
    teacherNo: "T001",
    subjectGroup: "理科",
    baseCount: 20,
    prepaidCount: 8,
    prepaidRate: 40,
    renewedCount: 14,
    renewRate: 70,
    incentiveGap: 3,
    extra: {
      enroll_nongrad: 12,
      prepaid_nongrad: 5,
      enroll_g9: 4,
      prepaid_g9: 2,
      enroll_g12: 4,
      prepaid_g12: 1,
      enroll_0_80: 11,
      prepaid_0_80: 6,
      enroll_80p: 9,
      prepaid_80p: 2,
    },
    studentCount: 3,
    students: [
      { name: "李小四", status: "renewed", slot: 1 },
      { name: "王小明", status: "closed", slot: 2 },
      { name: "赵小华", status: "prepaid", slot: 3 },
    ],
    ...overrides,
  };
}

function makeGroup(overrides: Record<string, unknown> = {}) {
  return {
    subjectGroup: "理科",
    teacherCount: 2,
    baseCount: 30,
    prepaidCount: 12,
    renewedCount: 19,
    prepaidRate: 40,
    renewRate: 63.3,
    incentiveGap: 4,
    ...overrides,
  };
}

function makeManager(overrides: Record<string, unknown> = {}) {
  return {
    managerName: "郑淼林",
    renew: { one2one: 40, one2many: 10, small: 2, other: 0, total: 52 },
    newsign: { one2one: 18, one2many: 4, small: 0, other: 0, total: 22 },
    renewedCount: 26,
    tutoredCount: 34,
    renewRate: 76.5,
    taskAmount: 1210000,
    cashflowTotal: 1330000,
    completionRate: 110,
    actualStudents: 31,
    perStudent: 42903,
    avgOrder: 8900,
    gap80: 0,
    ...overrides,
  };
}

function mockApi(
  options: {
    teacher?: unknown[];
    summary?: unknown[];
    group?: unknown[];
    manager?: unknown[];
    funnel?: unknown[];
    risk?: unknown[];
  } = {},
) {
  getMock.mockImplementation((path: string) => {
    if (path === "/renewal/reports") {
      return Promise.resolve({
        reports: [
          {
            reportId: 1,
            fileName: "小榄龙山学习中心 2026年秋寒个性化学生续费统计.xlsx",
            fileSize: 2403891,
            statMonth: "2026-10",
            centerName: "小榄龙山学习中心",
            rowCount: 547,
            errorCount: 0,
            status: "committed",
            uploadedAt: "2026-11-18 20:00:00",
          },
        ],
      });
    }
    if (path.includes("/teacher-stats") && path.includes("tab=stage"))
      return Promise.resolve({
        tab: "stage",
        reportId: 1,
        rows: options.summary ?? options.teacher ?? [],
      });
    if (path.includes("/teacher-stats"))
      return Promise.resolve({
        tab: "incentive",
        reportId: 1,
        rows: options.teacher || [],
      });
    if (path.includes("/group-compare"))
      return Promise.resolve({
        tab: "incentive",
        reportId: 1,
        rows: options.group || [],
      });
    if (path.includes("/manager-perf"))
      return Promise.resolve({ reportId: 1, rows: options.manager || [] });
    if (path.includes("/funnel"))
      return Promise.resolve({ reportId: 1, rows: options.funnel || [] });
    if (path.includes("/risk-list"))
      return Promise.resolve({ reportId: 1, rows: options.risk || [] });
    if (path.includes("/risk-followups"))
      return Promise.resolve({ reportId: 1, records: [] });
    if (path.includes("/compare"))
      return Promise.resolve({ summary: {}, teachers: [] });
    if (path.includes("/mentor-matrix")) {
      return Promise.resolve({
        matrix: {
          teachers: ["张明"],
          managers: ["郑淼林"],
          totalStudents: 20,
          totalPrepaid: 8,
          totalRenewed: 14,
          cells: [
            {
              teacherName: "张明",
              managerName: "郑淼林",
              studentCount: 20,
              prepaidCount: 8,
              renewedCount: 14,
              prepaidRate: 40,
              renewRate: 70,
              students: [],
            },
          ],
        },
      });
    }
    if (path.includes("/teacher-grade-matrix")) {
      return Promise.resolve({
        matrix: {
          teachers: ["张明"],
          grades: ["初三"],
          totalStudents: 4,
          totalPrepaid: 2,
          totalRenewed: 3,
          cells: [
            {
              teacherName: "张明",
              grade: "初三",
              studentCount: 4,
              prepaidCount: 2,
              renewedCount: 3,
              prepaidRate: 50,
              renewRate: 75,
              students: [],
            },
          ],
        },
      });
    }
    if (path.includes("/group-grade-matrix")) {
      return Promise.resolve({
        matrix: {
          subjectGroups: ["理科"],
          grades: ["初三"],
          cells: [],
          totalStudents: 0,
          totalPrepaid: 0,
          totalRenewed: 0,
        },
      });
    }
    if (path.includes("/rate-overview")) {
      return Promise.resolve({
        overview: {
          byManager: [
            { managerName: "郑淼林", prepaidRate: 40, renewRate: 70 },
          ],
          byGroup: [{ subjectGroup: "理科", prepaidRate: 40, renewRate: 70 }],
        },
      });
    }
    if (path.includes("/student-status")) {
      return Promise.resolve({
        reportId: 1,
        rows: [
          { status: "renewed", count: 19 },
          { status: "prepaid", count: 12 },
          { status: "stopped", count: 5 },
          { status: "closed", count: 3 },
        ],
      });
    }
    return Promise.reject(new Error("unexpected path: " + path));
  });
}

beforeEach(() => {
  getMock.mockReset();
});

describe("续费看板", () => {
  it("还没有报表时提示上传", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/renewal/reports") return Promise.resolve({ reports: [] });
      return Promise.reject(new Error("unexpected path: " + path));
    });
    renderWithProviders(<RenewalDashboard />);

    expect(await screen.findByText("还没有可展示的报表")).toBeInTheDocument();
    expect(
      screen.getByText("上传续费统计汇总表后，已提交批次会显示在这里。"),
    ).toBeInTheDocument();
  });

  it("汇总卡与图例随最新报表出数", async () => {
    mockApi({
      teacher: [
        makeTeacher(),
        makeTeacher({
          teacherName: "李华",
          teacherNo: "T002",
          baseCount: 10,
          renewedCount: 5,
          prepaidCount: 4,
          incentiveGap: 1,
        }),
      ],
    });
    renderWithProviders(<RenewalDashboard />);

    // 30 = 20 + 10 学生基数；19 = 14 + 5 已续科。顶部只保留一份汇总，避免重复卡片。
    expect(await screen.findByText("30")).toBeInTheDocument();
    // 默认学段卡展示同源预存 12、预存率 40%，不把续科混入学段卡
    expect((await screen.findAllByText("12")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("40.0%").length).toBeGreaterThanOrEqual(1);
    // 图例颜色说明来自 Excel 条件格式
    // 图例文案与 KPI 卡片同名（如「已预存」），故用 getAllByText
    expect(screen.getAllByText("已续费").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("已预存").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("结课").length).toBeGreaterThanOrEqual(1);
  });

  it("总览固定读取学段表并区分总预存与非毕业班预存", async () => {
    mockApi({
      teacher: [
        makeTeacher({ baseCount: 0, prepaidCount: 0, renewedCount: 0 }),
      ],
      summary: [
        makeTeacher({
          tab: "stage",
          baseCount: 306,
          prepaidCount: 226,
          renewedCount: null,
          extra: { prepaid_nongrad: 160, prepaid_g9: 55, prepaid_g12: 11 },
        }),
      ],
    });
    renderWithProviders(<RenewalDashboard />);

    expect((await screen.findAllByText("306")).length).toBeGreaterThanOrEqual(
      1,
    );
    expect((await screen.findAllByText("226")).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getAllByText("非毕业班预存").length).toBeGreaterThanOrEqual(
      1,
    );
    expect((await screen.findAllByText("160")).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      screen.getAllByText("学段表 · 1 位教师明细合计").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("默认选择最新已提交批次而不是处理中或失败批次", async () => {
    mockApi({ teacher: [makeTeacher()] });
    const defaultImplementation = getMock.getMockImplementation();
    getMock.mockImplementation((path: string) => {
      if (path === "/renewal/reports") {
        return Promise.resolve({
          reports: [
            { reportId: 9, fileName: "failed.xlsx", status: "failed" },
            {
              reportId: 2,
              fileName: "committed.xlsx",
              status: "committed",
              statMonth: "2026-10",
            },
            { reportId: 8, fileName: "processing.xlsx", status: "processing" },
          ],
        });
      }
      return defaultImplementation?.(path);
    });
    renderWithProviders(<RenewalDashboard />);

    await screen.findByRole("table");
    expect(screen.getByLabelText("选择报表批次")).toHaveValue("2");
    expect(getMock).toHaveBeenCalledWith(
      expect.stringContaining("tab=stage&reportId=2"),
    );
    expect(
      screen.queryByRole("option", { name: /failed/ }),
    ).not.toBeInTheDocument();
  });

  it("快速切换报表时忽略旧批次的迟到学管响应", async () => {
    let resolveOld!: (value: unknown) => void;
    const oldResponse = new Promise((resolve) => {
      resolveOld = resolve;
    });
    mockApi({
      teacher: [makeTeacher()],
      manager: [makeManager({ managerName: "当前批次学管" })],
    });
    const defaultImplementation = getMock.getMockImplementation();
    getMock.mockImplementation((path: string) => {
      if (path === "/renewal/reports") {
        return Promise.resolve({
          reports: [
            {
              reportId: 1,
              fileName: "current.xlsx",
              status: "committed",
              statMonth: "2026-10",
            },
            {
              reportId: 2,
              fileName: "old.xlsx",
              status: "committed",
              statMonth: "2026-09",
            },
          ],
        });
      }
      if (path.includes("/manager-perf") && path.includes("reportId=2"))
        return oldResponse;
      return defaultImplementation?.(path);
    });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");

    const reportSelect = screen.getByLabelText("选择报表批次");
    await user.selectOptions(reportSelect, "2");
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        expect.stringContaining("/manager-perf?reportId=2"),
      ),
    );
    await user.selectOptions(reportSelect, "1");
    await user.click(screen.getByRole("tab", { name: "学管业绩" }));
    expect(
      await screen.findByRole("cell", { name: "当前批次学管" }),
    ).toBeInTheDocument();

    resolveOld({ rows: [makeManager({ managerName: "旧批次学管" })] });
    await user.click(screen.getByRole("tab", { name: "教师统计" }));
    await user.click(screen.getByRole("tab", { name: "学管业绩" }));
    expect(
      screen.getByRole("cell", { name: "当前批次学管" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("旧批次学管")).not.toBeInTheDocument();
  });

  it("教师统计默认展开学段 tab，切换 tab 会重新取数", async () => {
    mockApi({ teacher: [makeTeacher()], group: [makeGroup()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    const table = await screen.findByRole("table");

    // 表格中应有教师名与科组
    expect(within(table).getByText("张明")).toBeInTheDocument();
    expect(within(table).getByText("理科")).toBeInTheDocument();

    // 切换到「课时」tab（教师视图内部的 tab，不是看板顶部的视图切换）
    await user.click(screen.getByRole("tab", { name: "课时" }));

    await waitFor(() => {
      const call = getMock.mock.calls.find(([p]) =>
        String(p).includes("tab=hours"),
      );
      expect(call).toBeDefined();
    });
  });

  it("学段使用 Excel 拆分字段，课时按真实五档学生网格展示分布图", async () => {
    mockApi({ teacher: [makeTeacher({
      studentCount: 10,
      students: [
        { name: "李小四", status: "renewed", slot: 1 },
        { name: "王小明", status: "closed", slot: 2 },
        { name: "赵小华", status: "prepaid", slot: 3 },
        { name: "24-40预存", status: "prepaid", slot: 9 },
        { name: "40-60在读", status: "normal", slot: 19 },
        { name: "40-60续费", status: "renewed", slot: 20 },
        { name: "60-80预存", status: "prepaid", slot: 24 },
        { name: "80+在读", status: "normal", slot: 29 },
        { name: "80+预存", status: "prepaid", slot: 30 },
        { name: "新增续费不重复计入", status: "prepaid", slot: 35 },
      ],
    })] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("tab", { name: "学段" }));
    expect(
      await screen.findByRole("img", {
        name: "非毕业班：在读 12 人，预存 5 人",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "非毕业班在读" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "总预存" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /高一/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("radiogroup", { name: "矩阵维度切换" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "课时" }));
    const expectedHours = [
      ["0–24", 3, 1], ["24–40", 1, 1], ["40–60", 2, 0], ["60–80", 1, 1], ["80+", 2, 1],
    ] as const;
    for (const [label, enrolled, prepaid] of expectedHours) {
      expect(await screen.findByRole("img", {
        name: `${label} 课时：在读 ${enrolled} 人，预存 ${prepaid} 人`,
      })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: `${label}课时在读` })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: `${label}课时预存` })).toBeInTheDocument();
    }
    expect(screen.queryByRole("img", { name: /^0–80 课时/ })).not.toBeInTheDocument();
  });

  it("学管维度解包并展示教师学管和教师年级矩阵", async () => {
    mockApi({ teacher: [makeTeacher()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("tab", { name: "学管" }));
    expect(await screen.findByText("教师 × 学管匹配矩阵")).toBeInTheDocument();
    expect(
      await screen.findByRole("columnheader", { name: "郑淼林" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "每格为学生数；预 = 预存，续 = 已续费。点击单元格可查看学生明细。",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "教师×年级" }));
    expect(
      await screen.findByRole("columnheader", { name: "初三" }),
    ).toBeInTheDocument();
    expect(screen.getByText("教师 × 年级分布")).toBeInTheDocument();
  });

  it("教师行默认隐藏学生明细，点击后仅显示一份完整学生网格", async () => {
    mockApi({ teacher: [makeTeacher()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    const table = await screen.findByRole("table");
    await within(table).findByText("张明");

    expect(screen.queryByText("李小四")).not.toBeInTheDocument();
    expect(screen.queryByText("王小明")).not.toBeInTheDocument();
    expect(screen.queryByText("赵小华")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看 3 名学生明细" }));
    for (const name of ["李小四", "王小明", "赵小华"]) {
      expect(await screen.findByText(name)).toBeInTheDocument();
      expect(screen.getAllByText(name)).toHaveLength(1);
    }
    await user.click(screen.getByRole("button", { name: "收起 3 名学生明细" }));
    expect(screen.queryByText("李小四")).not.toBeInTheDocument();
  });

  it("科组对比视图展示续科人数与激励差额两组排名", async () => {
    // 两科组差额都归 0，验证「全部达标」分支
    mockApi({
      teacher: [makeTeacher()],
      group: [
        makeGroup({ incentiveGap: 0 }),
        makeGroup({ subjectGroup: "文科", renewedCount: 12, incentiveGap: 0 }),
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("tab", { name: "科组对比" }));
    await user.click(screen.getByRole("tab", { name: "激励" }));

    expect(await screen.findByText("续科人数 TOP 科组")).toBeInTheDocument();
    expect(
      screen.getByText("已提供差额数据的科组均无正向缺口"),
    ).toBeInTheDocument();
  });

  it("学管业绩视图展示完成率进度条", async () => {
    mockApi({ teacher: [makeTeacher()], manager: [makeManager()] });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("tab", { name: "学管业绩" }));

    // 等待学管业绩表格出现（异步加载 manager 数据）
    // 先等汇总卡片，再等表格行（直接查找表格单元格内容）
    await screen.findByText("团队现金流");
    await screen.findByText("续费汇总"); // 表头
    await screen.findByRole("cell", { name: "郑淼林" });
    // 表格行里的完成率（汇总卡片也有 110.0%，取表格里的）
    const cells = await screen.findAllByText("110.0%");
    expect(cells.length).toBeGreaterThanOrEqual(2);
  });

  it("课消与续费视图展示独立指标和同源整体续费率", async () => {
    mockApi({
      teacher: [makeTeacher()],
      funnel: [
        {
          managerName: "郑淼林",
          students: 34,
          classedLast1: 22,
          classedLast2: 30,
          renewed: 26,
          renewRate: 76.5,
        },
        {
          managerName: "林家琪",
          students: 26,
          classedLast1: 15,
          classedLast2: 21,
          renewed: 18,
          renewRate: 69.2,
        },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("tab", { name: "课消与续费" }));

    expect(await screen.findByText("课消与续费概览")).toBeInTheDocument();
    expect(
      screen.getByText(
        "各列为独立统计，不构成严格嵌套漏斗；不计算阶段转化或阶段流失",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("73.3%")).toBeInTheDocument();
    expect(screen.getByText("林家琪")).toBeInTheDocument();
  });

  it("待关注学生只展示接口事实，不虚构风险等级", async () => {
    mockApi({
      teacher: [makeTeacher()],
      risk: [
        {
          studentKey: "S1",
          sourceRow: 7,
          managerName: "郑淼林",
          studentId: "S1",
          studentName: "陈志强",
          grade: "初三",
          enrollDays: 420,
          coef: 1,
          type: "前2月有课消",
          courseProduct: "数学",
          classLast1: 0,
          classLast2: 1,
        },
        {
          studentKey: "S2",
          sourceRow: 8,
          managerName: "林家琪",
          studentId: "S2",
          studentName: "刘小雨",
          grade: "初二",
          enrollDays: 96,
          coef: 1,
          type: "前2月无课消",
          courseProduct: "物理",
          classLast1: 0,
          classLast2: 0,
        },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("tab", { name: "待关注学生" }));

    expect(await screen.findByText("陈志强")).toBeInTheDocument();
    expect(screen.getByText("刘小雨")).toBeInTheDocument();
    expect(screen.queryByText(/低危/)).not.toBeInTheDocument();
    expect(screen.queryByText("正常")).not.toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByText("未记录")).toHaveLength(2);
    // 风险详情列显示 type 字段
    expect(screen.getByText("前2月有课消")).toBeInTheDocument();
    expect(screen.getByText("前2月无课消")).toBeInTheDocument();
  });

  it("首屏与教师口径切换不拉风险名单，进入后只加载一次", async () => {
    mockApi({
      teacher: [makeTeacher()],
      risk: [{
        studentKey: "S1", sourceRow: 7, managerName: "学管甲", studentId: "S1",
        studentName: "按需加载学生", grade: "初二", enrollDays: 10, coef: 1,
        type: "前2月无课消", courseProduct: "数学", classLast1: 0, classLast2: 0,
      }],
    });
    const riskCallCount = () => getMock.mock.calls.filter(([path]) => String(path).includes("/risk-list")).length;
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");
    expect(riskCallCount()).toBe(0);

    await user.click(screen.getByRole("tab", { name: "课时" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining("tab=hours")));
    expect(riskCallCount()).toBe(0);

    await user.click(screen.getByRole("tab", { name: "待关注学生" }));
    expect(await screen.findByText("按需加载学生")).toBeInTheDocument();
    expect(riskCallCount()).toBe(1);
    await user.click(screen.getByRole("tab", { name: "教师统计" }));
    await user.click(screen.getByRole("tab", { name: "待关注学生" }));
    expect(await screen.findByText("按需加载学生")).toBeInTheDocument();
    expect(riskCallCount()).toBe(1);
  });

  it("切换批次立即移除旧风险，迟到响应不会覆盖当前批次", async () => {
    let resolveOld!: (value: unknown) => void;
    const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
    mockApi({
      teacher: [makeTeacher()],
      risk: [{
        studentKey: "S1", sourceRow: 7, managerName: "学管甲", studentId: "S1",
        studentName: "当前批次学生", grade: "初二", enrollDays: 10, coef: 1,
        type: "前2月无课消", courseProduct: "数学", classLast1: 0, classLast2: 0,
      }],
    });
    const base = getMock.getMockImplementation()!;
    getMock.mockImplementation((path: string) => {
      if (path === "/renewal/reports") return Promise.resolve({ reports: [
        { reportId: 1, fileName: "current.xlsx", status: "committed", statMonth: "2026-10" },
        { reportId: 2, fileName: "old.xlsx", status: "committed", statMonth: "2026-09" },
      ] });
      if (path.includes("/risk-list") && path.includes("reportId=2")) return oldResponse;
      return base(path);
    });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("tab", { name: "待关注学生" }));
    expect(await screen.findByText("当前批次学生")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("选择报表批次"), "2");
    expect(screen.queryByText("当前批次学生")).not.toBeInTheDocument();
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining("/risk-list?page=1&pageSize=200&reportId=2")));
    await user.selectOptions(screen.getByLabelText("选择报表批次"), "1");
    expect(await screen.findByText("当前批次学生")).toBeInTheDocument();

    resolveOld({ reportId: 2, rows: [{
      studentKey: "S2", sourceRow: 8, managerName: "学管乙", studentId: "S2",
      studentName: "旧批次学生", grade: "初三", enrollDays: 20, coef: 1,
      type: "前2月无课消", courseProduct: "物理", classLast1: 0, classLast2: 0,
    }] });
    await user.click(screen.getByRole("tab", { name: "教师统计" }));
    await user.click(screen.getByRole("tab", { name: "待关注学生" }));
    expect(screen.getByText("当前批次学生")).toBeInTheDocument();
    expect(screen.queryByText("旧批次学生")).not.toBeInTheDocument();
  });
});

describe("风险跟进工作台状态与完整分页", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("跨服务端分页完整取数，DOM 分页且搜索覆盖后续页", async () => {
    mockApi({ teacher: [makeTeacher()] });
    const base = getMock.getMockImplementation()!;
    const riskRows = Array.from({ length: 201 }, (_, index) => ({
      studentKey: `S${index + 1}`,
      sourceRow: index + 7,
      managerName: "学管甲",
      studentId: `S${index + 1}`,
      studentName: `学生 ${index + 1}`,
      grade: "初二",
      enrollDays: index,
      coef: 1,
      type: "前2月无课消",
      courseProduct: "数学",
      classLast1: 0,
      classLast2: 0,
    }));
    getMock.mockImplementation((path: string) => {
      if (path.includes("/risk-list")) {
        const page = Number(
          new URL(path, "http://fixture").searchParams.get("page"),
        );
        return Promise.resolve({
          reportId: 1,
          rows: riskRows.slice((page - 1) * 200, page * 200),
          total: 201,
          totalPages: 2,
          page,
          pageSize: 200,
          hasMore: page === 1,
        });
      }
      return base(path);
    });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("tab", { name: "待关注学生" }));

    expect(await screen.findByText("学生 1")).toBeInTheDocument();
    expect(screen.getByText(/显示 201 \/ 201 人/)).toBeInTheDocument();
    expect(screen.getByText(/第 1 \/ 5 页/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      51,
    );
    expect(
      getMock.mock.calls.filter(([path]) =>
        String(path).includes("/risk-list"),
      ),
    ).toHaveLength(2);
    expect(screen.queryByText("学生 201")).not.toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("搜索学生或跟进内容"),
      "学生 201",
    );
    expect(await screen.findByText("学生 201")).toBeInTheDocument();
    expect(screen.getByText(/显示 1 \/ 201 人/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
  });

  it("跟进加载中与失败不冒充未记录，重试成功后才允许编辑", async () => {
    mockApi({
      teacher: [makeTeacher()],
      risk: [
        {
          studentKey: "S1",
          sourceRow: 7,
          managerName: "学管甲",
          studentId: "S1",
          studentName: "学生甲",
          grade: "初二",
          enrollDays: 10,
          coef: 1,
          type: "前2月无课消",
          courseProduct: "数学",
          classLast1: 0,
          classLast2: 0,
        },
      ],
    });
    const base = getMock.getMockImplementation()!;
    let rejectFollowUps!: (reason: Error) => void;
    getMock.mockImplementation((path: string) => {
      if (path.includes("/risk-followups"))
        return new Promise((_, reject) => {
          rejectFollowUps = reject;
        });
      return base(path);
    });
    const user = userEvent.setup();
    renderWithProviders(<RenewalDashboard />);
    await screen.findByRole("table");
    await user.click(screen.getByRole("tab", { name: "待关注学生" }));

    expect(await screen.findByText("加载中…")).toBeInTheDocument();
    expect(
      within(screen.getByRole("table")).queryByText("未记录"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂不可用" })).toBeDisabled();

    rejectFollowUps(new Error("fixture failed"));
    expect(await screen.findByText("状态未知")).toBeInTheDocument();
    expect(
      within(screen.getByRole("table")).queryByText("未记录"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂不可用" })).toBeDisabled();

    getMock.mockImplementation((path: string) => {
      if (path.includes("/risk-followups"))
        return Promise.resolve({ records: [] });
      return base(path);
    });
    await user.click(screen.getByRole("button", { name: "重新加载跟进" }));
    expect(
      await within(screen.getByRole("table")).findByText("未记录"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记录跟进" })).toBeEnabled();
  });
});
