import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './lib/serviceWorker';
import './index.css';

// 只在生产构建里注册 Service Worker：
// 开发环境注册了会被 SW 的缓存拦截，改代码看不到效果。
if (import.meta.env.PROD) {
  registerServiceWorker();
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
