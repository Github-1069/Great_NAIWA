'use strict';
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const root = __dirname;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'danaiwa-pwa-test-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp' };
let version = 'v1', failIcon = false, context;
const errors = [], external = [];
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/observer') { res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Update observer</title>'); return; }
  const relative = pathname.replace(/^\/(game|broken)\//, '') || 'index.html';
  if (failIcon && pathname.startsWith('/broken/') && relative === 'icons/icon-512.png') {
    res.writeHead(503).end('Simulated download failure'); return;
  }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, bytes) => {
    if (err) { res.writeHead(404).end(); return; }
    if (relative === 'sw.js') bytes = Buffer.from(bytes.toString().replace("const VERSION = 'v1'", `const VERSION = '${version}'`));
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  });
});
const browserPath = process.env.PWA_BROWSER;
async function launch(offline = false) {
  context = await chromium.launchPersistentContext(profile, {
    ...(browserPath ? { executablePath: browserPath } : {}), headless: true, offline,
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true
  });
  context.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:') && !req.url().startsWith('data:')) external.push(req.url()); });
  context.on('page', page => page.on('pageerror', err => errors.push(err.message)));
  for (const tab of context.pages()) await tab.close();
  return context;
}
async function wait(page, predicate) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待条件超时：' + predicate.toString());
}
async function ready(page) {
  await wait(page, () => document.getElementById('pwaBtn')?.dataset.ready === 'true');
  await wait(page, () => window.__DNW__?.FRUITS.every(f => f.img?.naturalWidth > 0));
}
async function workerVersion(page) {
  return page.evaluate(() => new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = e => { channel.port1.close(); resolve(e.data.version); };
    navigator.serviceWorker.controller.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
  }));
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await launch();
  let page = await context.newPage();
  await page.goto(base + '/game/');
  await ready(page);
  assert.equal(await workerVersion(page), 'v1');
  assert.equal(await page.locator('#boardBtn, #boardModal, #sponsorBtn, #submitBox').count(), 0);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
  console.log('PASS: 子目录部署、完整资源缓存、排行榜与赞助已移除');

  for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await wait(page, () => document.querySelector('#game').width > 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '横向溢出');
    const box = await page.locator('#stage').boundingBox();
    assert(box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, '棋盘超出屏幕');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#pwaBtn').click();
  await page.locator('#pwaDialog').waitFor({ state: 'visible' });
  await page.locator('#pwaStatus').evaluate(el => { el.tabIndex = -1; el.focus(); });
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => __DNW__.state.balls.length), 0);
  const shots = process.env.PWA_SCREENSHOTS;
  if (shots) {
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'mobile-install.png') });
  }
  await page.locator('#pwaClose').click();
  await page.locator('#pwaDialog').waitFor({ state: 'hidden' });
  await page.locator('#game').tap({ position: { x: 120, y: 120 } });
  assert(await page.evaluate(() => __DNW__.state.balls.length > 0));
  if (shots) await page.screenshot({ path: path.join(shots, 'mobile-game.png') });
  console.log('PASS: 竖屏、小屏、横屏布局及触屏投放、弹窗键盘隔离');

  await page.evaluate(() => { __DNW__.addScore(123); document.getElementById('soundBtn').click(); });
  const muted = await page.evaluate(() => localStorage.getItem('danaiwa.mute.v1'));
  await context.close();
  await launch(true);
  page = await context.newPage();
  await page.goto(base + '/game/?from=home');
  await ready(page);
  assert.equal(await page.evaluate(() => __DNW__.state.best), 123);
  assert.equal(await page.evaluate(() => localStorage.getItem('danaiwa.mute.v1')), muted);
  assert.equal(await page.evaluate(async () => (await fetch('assets/fruits/01-grape.webp?retry=2')).ok), true);
  await page.evaluate(() => { __DNW__.addScore(7); __DNW__.gameOver(); });
  await page.locator('#restartBtn').click();
  assert.equal(await page.evaluate(() => __DNW__.state.score), 0);
  await page.reload();
  await ready(page);
  console.log('PASS: 浏览器完全关闭后断网冷启动、贴图、查询参数、结算重开和本地最高分');

  await context.setOffline(false);
  await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys.find(key => key.includes(encodeURIComponent(location.href.split('?')[0]))));
    await cache.delete(new URL('icons/icon-512.png', location.href).href);
  });
  await page.locator('#pwaBtn').click();
  await wait(page, () => !document.getElementById('retryOfflineBtn').hidden);
  await page.locator('#retryOfflineBtn').click();
  await ready(page);
  await page.locator('#pwaClose').click();
  console.log('PASS: 缺失缓存能够识别，并可重新准备修复');

  version = 'v2';
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await wait(page, async () => !!(await navigator.serviceWorker.getRegistration()).waiting);
  assert.equal(await workerVersion(page), 'v1');
  await wait(page, () => !document.getElementById('pwaUpdate').hidden);
  const observer = await context.newPage();
  await observer.goto(base + '/observer');
  await page.close();
  await wait(observer, async () => { const r = await navigator.serviceWorker.getRegistration('/game/'); return r && !r.waiting && r.active?.state === 'activated'; });
  page = observer;
  await page.goto(base + '/game/');
  await ready(page);
  await wait(page, async () => (await caches.keys()).some(key => key.endsWith(':v2')) && !(await caches.keys()).some(key => key.endsWith(':v1')));
  await wait(page, () => new Promise(resolve => {
    if (!navigator.serviceWorker.controller) return resolve(false);
    const channel = new MessageChannel();
    channel.port1.onmessage = e => { channel.port1.close(); resolve(e.data.version === 'v2'); };
    navigator.serviceWorker.controller.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
  }));
  assert.equal(await workerVersion(page), 'v2');
  console.log('PASS: 新版本等待旧窗口关闭，切换成功并清理旧缓存');

  failIcon = true;
  const broken = await context.newPage();
  await broken.goto(base + '/broken/');
  await wait(broken, () => document.getElementById('pwaStatus').textContent.includes('失败'));
  assert.equal(await broken.evaluate(() => !!navigator.serviceWorker.controller), false);
  assert.equal(await broken.locator('#pwaBtn').getAttribute('data-ready'), 'false');
  failIcon = false;
  await broken.locator('#pwaBtn').click();
  await broken.locator('#retryOfflineBtn').click();
  await ready(broken);
  assert.equal(await workerVersion(page), 'v2');
  console.log('PASS: 首次下载失败不误报离线就绪，重试成功且不影响其他路径的应用');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: 无页面异常，无第三方网络请求');
})().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => {
  if (context) await context.close();
  server.close();
  // 临时目录保留，避免关闭浏览器后仍有系统句柄导致清理失败。
  console.log('测试浏览器临时目录：' + profile);
});
