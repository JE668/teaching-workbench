import { test, expect } from '@playwright/test';

/**
 * e2e 前置用例（setup project，先于所有业务用例执行）：
 * 断言 3111 上的后端确实是 Playwright 拉起的 test 实例。
 *
 * 真实事故：本机残留了一台非 test 模式的后端占着 3111，reuseExistingServer
 * 把它静默复用 —— 那台实例启动时灌了 3589 条内置课程目录，catalog / reports /
 * observation 里所有「库里应该只有我造的几门课」的行数断言全部崩掉，
 * 5 个用例离奇失败且极难排查。这里让这种环境直接红灯并报出原因。
 *
 * 注：必须做成 project 而不是 globalSetup —— globalSetup 在 webServer
 * 就绪之前执行，会连不上后端。
 */
const API_PORT = 3111;

test('被测后端是测试实例（/health 带 testEnv 标记）', async ({ request }) => {
  const res = await request.get('http://127.0.0.1:' + API_PORT + '/health');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(
    body.testEnv,
    API_PORT + ' 上复用了非测试模式的后端（残留进程？）。' +
    '先执行: lsof -ti :' + API_PORT + ' | xargs kill 再重跑'
  ).toBe(true);
});
