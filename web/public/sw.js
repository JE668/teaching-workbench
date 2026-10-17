/*
 * Service Worker（PWA / 离线壳）。
 *
 * 三条铁律：
 *   1. 业务数据（/api/）和上传文件（/uploads/）永远直连后端，绝不缓存 ——
 *      缓存了就会出现「列表还是上次的数据」「AI 评课返回旧结果」。
 *   2. 带内容哈希的静态资源缓存优先，断网也能把界面打开。
 *   3. 页面导航网络优先、失败才回退到缓存的 index.html ——
 *      联网时一定是新版本，断网时至少还能看到壳。
 *
 * 因此这里的"离线"是指：已登录状态下断网，页面还在、已加载的界面还能看；
 * 登录和任何需要联网的操作仍然要联网。
 */

const CACHE = 'tw-static-v1';

// Vite 产物文件名带内容哈希，改代码即换名，所以缓存不会串版本
const IMMUTABLE = /^\/(assets\/.+|icon-\d+\.png|apple-touch-icon\.png|manifest\.webmanifest)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/']))
      .catch(() => {})
  );
  // 立即激活，不用等所有旧标签页都关掉
  return self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 业务数据 / 上传文件：不拦截，直连后端
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;

  // SPA 页面导航：网络优先，断网回退缓存
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // 带哈希的静态资源：缓存优先
  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
      )
    );
  }
});
