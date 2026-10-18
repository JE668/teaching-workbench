import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 后端地址：E2E 场景下通过环境变量指向测试实例
// 开发/预览时的后端地址。
// 优先读 VITE_API_TARGET（直观）；保留 E2E_API_TARGET 兼容既有脚本。
// 注意默认值 3000 可能与本机其它项目冲突，必要时用环境变量覆盖：
//   VITE_API_TARGET=http://localhost:3010 npm run dev
const API_TARGET = process.env.VITE_API_TARGET || process.env.E2E_API_TARGET || 'http://localhost:3000';

const proxy = {
  '/api': { target: API_TARGET, changeOrigin: true },
  '/uploads': { target: API_TARGET, changeOrigin: true },
};

export default defineConfig({
  plugins: [react()],
  // 路由级分包之后，再手动切一层 vendor，避免每个页面 chunk 都各自重复打包 react。
  // 注意：这里只放「稳定不变的第三方库」。
  // 业务模块（含 framer-motion，被多个页面共享）交给 Rollup 的动态分块处理，
  // 强行指定会触发 "Manually-specified chunks contain circular dependencies" 警告。
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy,
  },
  // 供 E2E 使用：以生产构建产物启动，并同样反代 API
  // 注意：必须显式指定 host，否则 vite preview 只监听 IPv6 [::1]，
  // 导致走 IPv4 的服务探活（如 Playwright）一直等不到就绪。
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy,
  },
});
