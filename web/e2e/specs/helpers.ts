import { Page, APIResponse, expect } from '@playwright/test';

export const ADMIN_USER = 'admin';
export const ADMIN_PASS = 'e2e-admin-pass';

/**
 * 取 API 令牌。
 *
 * 注意 1：page.request 不共享页面 localStorage 中的 JWT，
 *         凡是绕过 UI 直接调接口的地方都必须显式带上 Authorization。
 * 注意 2：**不能跨用例缓存 token**。Playwright 每个测试都是全新的浏览器上下文，
 *         缓存的 token 会让第二个用例之后拿不到登录时下发的图片 cookie，
 *         导致图片请求 401。登录限流只统计失败请求，重复登录没有副作用。
 */
export async function getToken(page: Page): Promise<string> {
  const res = await page.request.post('/api/auth/login', {
    data: { username: ADMIN_USER, password: ADMIN_PASS },
  });
  expect(res.ok(), 'API 登录失败: ' + res.status()).toBeTruthy();

  return (await res.json()).token as string;
}

/** 带鉴权的 API 调用 */
export async function apiPost(page: Page, path: string, data: unknown): Promise<APIResponse> {
  const token = await getToken(page);
  return page.request.post(path, { headers: { Authorization: 'Bearer ' + token }, data });
}

/** 走真实登录表单登录 */
export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/用户名/).fill(ADMIN_USER);
  await page.getByLabel(/密码/).fill(ADMIN_PASS);
  await page.locator('form button[type="submit"]').click();
  // 必须 exact —— 侧边栏也有个"教学工作台"标题，模糊匹配会同时命中两个元素
  await expect(page.locator('main').getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
}

/** 直接注入登录态，跳过 UI 登录 */
/** 清掉服务端草稿（草稿是账号级的，用例之间会互相污染） */
export async function clearServerDraft(page: Page) {
  const token = await getToken(page);
  await page.request
    .delete('/api/draft', {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      data: { clientId: 'e2e-cleanup' },
    })
    .catch(() => {});
}

export async function loginViaApi(page: Page) {
  await page.goto('/login');
  const token = await getToken(page);

  const me = await page.request.get('/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(me.ok()).toBeTruthy();
  const { user } = await me.json();

  await page.evaluate(
    ([t, u]) => {
      localStorage.setItem('token', t as string);
      localStorage.setItem('user', JSON.stringify(u));
    },
    [token, user] as const
  );

  // 草稿是账号级的：不清掉的话，上一个用例的残留会被下一个用例恢复出来
  await page.request
    .delete('/api/draft', {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      data: { clientId: 'e2e-cleanup' },
    })
    .catch(() => {});
}

/**
 * 注册一个全新账号并注入登录态。
 *
 * 需要「干净数据」的统计类用例用这个：admin 账号下已经堆了一堆
 * 前面用例造的回访记录，覆盖次数之类的断言会被污染。
 */
export async function loginAsNewUser(page: Page, username: string, password = 'e2e-admin-pass'): Promise<string> {
  // 必须先落到同源页面，否则 page.evaluate 读 localStorage 会被跨源策略拦掉
  await page.goto('/login');

  const reg = await page.request.post('/api/auth/register', {
    data: { username, password },
  });
  expect(reg.ok(), '注册失败: ' + reg.status() + ' ' + (await reg.text())).toBeTruthy();
  const token = (await reg.json()).token as string;

  const me = await page.request.get('/api/auth/me', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(me.ok()).toBeTruthy();
  const { user } = await me.json();

  await page.evaluate(
    ([t, u]) => {
      localStorage.setItem('token', t as string);
      localStorage.setItem('user', JSON.stringify(u));
    },
    [token, user] as const
  );

  return token;
}

/** 通过 API 建一个学生，返回其 id */
export async function seedStudent(page: Page, name: string, extra: Record<string, unknown> = {}) {
  const res = await apiPost(page, '/api/students', {
    name,
    grade: '小学五年级',
    subject: '数学',
    ...extra,
  });
  expect(res.ok(), '创建学生失败: ' + res.status() + ' ' + (await res.text())).toBeTruthy();
  return (await res.json()).student.id as number;
}

/**
 * 通过 API 建一条回访，返回其 id。
 *
 * 不传 token 时用 admin；统计类用例传新账号的 token，
 * 避免 admin 下前面用例造的回访记录污染覆盖次数之类的断言。
 */
export async function seedFollowUp(page: Page, data: Record<string, unknown>, token?: string) {
  const body = {
    studentId: null,
    studentName: '测试学生',
    grade: '小学五年级',
    subject: '数学',
    topic: '测试课程',
    performance: '正常',
    mastery: 'good',
    images: [],
    content: '【课堂内容】测试内容。',
    ...data,
  };

  const res = token
    ? await page.request.post('/api/followups', {
        headers: { Authorization: 'Bearer ' + token },
        data: body,
      })
    : await apiPost(page, '/api/followups', body);

  expect(res.ok(), '创建回访失败: ' + res.status() + ' ' + (await res.text())).toBeTruthy();
  return (await res.json()).followup.id as number;
}

/** 通过 API 建一份月度报告，返回其 id。同名学生同月已存在时返回那条。 */
export async function seedReport(
  page: Page,
  data: { studentId: number; yearMonth: string; term?: string; grade?: string; subject?: string }
): Promise<number> {
  const res = await apiPost(page, '/api/reports', data);
  expect(res.ok(), '创建月度报告失败: ' + res.status() + ' ' + (await res.text())).toBeTruthy();
  return (await res.json()).report.id as number;
}

/** 给一份月度报告加一条明细（总结 / 规划 / 阶测） */
export async function seedReportItem(
  page: Page,
  reportId: number,
  data: Record<string, unknown>
): Promise<{ id: number }> {
  const res = await apiPost(page, '/api/reports/' + reportId + '/items', data);
  expect(res.ok(), '添加报告明细失败: ' + res.status() + ' ' + (await res.text())).toBeTruthy();
  return (await res.json()).item as { id: number };
}

/** 上传一份课程目录 Excel（走真实导入接口），返回导入结果 */
export async function importCatalog(page: Page, file: { name: string; buffer: Buffer }, band = '小初') {
  const token = await getToken(page);
  const res = await page.request.post('/api/catalog/import', {
    headers: { Authorization: 'Bearer ' + token },
    multipart: {
      file: {
        name: file.name,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: file.buffer,
      },
      band,
    },
  });
  expect(res.ok(), '导入课程目录失败: ' + res.status() + ' ' + (await res.text())).toBeTruthy();
  return (await res.json()) as Record<string, unknown>;
}

