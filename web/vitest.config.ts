import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/test/**',
        // 根目录 shared/ 的镜像副本：覆盖率由它自己的单元测试负责，
        // 在前后端各算一次只会让两边数字互相打架。
        'src/shared/**',
      ],
      // include 覆盖 src 下全部源码（含从未被用例 import 的文件，按 0% 计），
      // 所以数字比「只统计被加载文件」更严格也更诚实。
      // 门槛 = 当前实测值（行 65.5 / 语句 63.7 / 函数 54.2 / 分支 54.8）下压约 1.5 个点，
      // 目的是「防倒退」而不是刷数字：新代码掉下去会让 CI 红，想提高再逐步上调。
      thresholds: { lines: 64, statements: 62, functions: 52, branches: 53 },
    },
  },
});
