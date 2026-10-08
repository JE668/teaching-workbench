import { defineConfig } from '@playwright/test';

const AI_PORT = 3999; // 模拟 SenseNova
const API_PORT = 3111; // 后端（避开开发常用的 3000）
const WEB_PORT = 4173; // 前端 preview

const AI_URL = 'http://127.0.0.1:' + AI_PORT;
const API_URL = 'http://127.0.0.1:' + API_PORT;
const WEB_URL = 'http://127.0.0.1:' + WEB_PORT;

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/smoke.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // 用例共享同一个后端与数据库，串行执行避免相互干扰
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,

  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: WEB_URL,
    // 复用系统 Chrome，不下载 Playwright 自带浏览器
    // （macOS 13 已不被新版 Playwright 支持；CI 的 ubuntu runner 自带 Chrome）
    channel: 'chrome',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  webServer: [
    {
      command: 'node e2e/mock-sensenova.cjs',
      url: AI_URL + '/health',
      reuseExistingServer: !isCI,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        MOCK_PORT: String(AI_PORT),
        // 放慢流式节奏，使"逐字出现"可被稳定观测（默认 25ms 太快，采样会扑空）
        MOCK_CHUNK_DELAY_MS: '150',
      },
    },
    {
      command: 'npm --prefix ../server run start',
      url: API_URL + '/health',
      reuseExistingServer: !isCI,
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        HOST: '127.0.0.1',
        // 数据落在独立目录，不碰开发数据
        DATA_DIR: '../server/.e2e-data',
        JWT_SECRET: 'e2e-only-secret',
        SENSENOVA_API_KEY: 'e2e-key',
        SENSENOVA_BASE_URL: AI_URL + '/v1',
        SENSENOVA_REASONING_EFFORT: 'none',
        DEFAULT_ADMIN_USER: 'admin',
        DEFAULT_ADMIN_PASS: 'e2e-admin-pass',
        CORS_ORIGINS: '',
      },
    },
    {
      command: 'npm run preview -- --port ' + WEB_PORT + ' --strictPort',
      url: WEB_URL,
      reuseExistingServer: !isCI,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { E2E_API_TARGET: API_URL },
    },
  ],
});
