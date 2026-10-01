/* 修改任何运行资源时同步递增 VERSION。整批缓存成功才允许新版本安装。 */
'use strict';
const VERSION = 'v1';
const PREFIX = 'danaiwa-pwa:' + encodeURIComponent(self.registration.scope) + ':';
const CACHE = PREFIX + VERSION;
const ASSETS = [
  'index.html', 'style.css', 'game.js', 'pwa.css', 'pwa.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'assets/fruits/parts.js', 'assets/fruits/blur.js',
  'assets/fruits/01-grape.webp', 'assets/fruits/02-cherry.webp',
  'assets/fruits/03-orange.webp', 'assets/fruits/04-lemon.webp',
  'assets/fruits/05-kiwi.webp', 'assets/fruits/06-tomato.webp',
  'assets/fruits/07-peach.webp', 'assets/fruits/08-pineapple.webp',
  'assets/fruits/09-coconut.webp', 'assets/fruits/10-halfmelon.webp',
  'assets/fruits/11-watermelon.webp'
].map(path => new URL(path, self.registration.scope).href);
const INDEX = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
    // 不使用 skipWaiting：旧页面继续使用旧版本，关闭所有窗口后再更新。
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  url.hash = '';
  let key = url.href;
  if (event.request.mode === 'navigate' && key === self.registration.scope) key = INDEX;
  if (!ASSETS.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    if (cached) return cached;
    // 浏览器清理部分缓存后，允许联网修复；离线准备状态会重新检查完整性。
    const response = await fetch(new Request(key, { cache: 'reload' }));
    if (response.ok) await cache.put(key, response.clone());
    return response;
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const found = await Promise.all(ASSETS.map(url => cache.match(url)));
      event.ports[0].postMessage({ ready: found.every(Boolean), version: VERSION });
    } catch {
      event.ports[0].postMessage({ ready: false, version: VERSION });
    }
  })());
});
