/* 安装引导和离线状态；不依赖任何第三方服务。 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('pwaDialog');
  const status = $('pwaStatus');
  const retry = $('retryOfflineBtn');
  let registration;
  let installPrompt;
  let noticeTimer;
  let wasReady = false;

  function notice(text) {
    clearTimeout(noticeTimer);
    $('pwaNotice').textContent = text;
    $('pwaNotice').hidden = false;
    noticeTimer = setTimeout(() => { $('pwaNotice').hidden = true; }, 6500);
  }

  function showStatus(text, ready = false, canRetry = false) {
    status.textContent = text;
    $('pwaBtn').dataset.ready = String(ready);
    $('pwaBtn').setAttribute('aria-label', '安装与离线状态：' + text);
    $('pwaIcon').textContent = ready ? '✓' : '↓';
    retry.hidden = !canRetry;
    if (ready && !wasReady) notice(text);
    wasReady = ready;
  }

  function checkOffline() {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return;
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      showStatus('暂时无法确认离线资源，请联网后点「重新准备」。', false, true);
    }, 8000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      if (data.ready) showStatus('已准备好，可以离线游玩。', true);
      else showStatus('离线资源不完整，请联网后点「重新准备」。', false, true);
    };
    worker.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
  }

  $('pwaBtn').addEventListener('click', () => {
    dialog.showModal();
    if (registration) checkOffline();
  });
  $('pwaClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
  // 弹窗操作不触发游戏的空格投放或 R 重开。
  dialog.addEventListener('keydown', event => event.stopPropagation());

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    $('installBtn').hidden = false;
  });
  $('installBtn').addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    $('installBtn').hidden = true;
    try { await prompt.prompt(); await prompt.userChoice; } catch { /* 菜单安装仍可用 */ }
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    $('installBtn').hidden = true;
    notice('已添加到桌面。离线准备完成后即可断网游玩。');
  });

  function watchInstalling(worker) {
    if (!worker) return;
    const changed = () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        $('pwaUpdate').hidden = false;
        notice('新版本已准备好，关闭所有游戏窗口后重新打开即可更新。');
      }
      if (worker.state === 'redundant' && !navigator.serviceWorker.controller) {
        showStatus('离线准备失败，请检查网络后重试。当前仍可继续玩。', false, true);
        notice('离线准备未完成，点「安装 / 离线」查看。');
      }
    };
    worker.addEventListener('statechange', changed);
    changed();
  }

  async function register() {
    showStatus('正在准备离线资源，请保持联网…');
    try {
      registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './', updateViaCache: 'none'
      });
      if (registration.waiting) $('pwaUpdate').hidden = false;
      watchInstalling(registration.installing);
      registration.addEventListener('updatefound', () => watchInstalling(registration.installing));
      if (navigator.serviceWorker.controller) checkOffline();
      navigator.serviceWorker.ready.then(checkOffline);
    } catch {
      showStatus('离线准备失败，请检查网络后重试。当前仍可继续玩。', false, true);
    }
  }

  retry.addEventListener('click', async () => {
    if (!registration || !navigator.serviceWorker.controller) {
      await register();
      return;
    }
    // 已有版本缺少资源时，重新加载会通过 SW 的联网回退修复运行资源。
    // 图标等非页面必需资源也一起修复，避免永远卡在「不完整」。
    retry.disabled = true;
    showStatus('正在重新准备，请保持联网…');
    try {
      const paths = ['index.html', 'style.css', 'game.js', 'pwa.css', 'pwa.js',
        'manifest.webmanifest', 'assets/fruits/parts.js', 'assets/fruits/blur.js',
        'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
        ...window.__DNW__.FRUITS.map(f => f.file)];
      await Promise.all(paths.map(async path => {
        const response = await fetch(path, { cache: 'reload' });
        if (!response.ok) throw new Error('下载失败');
      }));
      checkOffline();
    } catch {
      showStatus('离线准备失败，请联网后再次重试。', false, true);
    } finally { retry.disabled = false; }
  });

  if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') {
    showStatus('当前打开方式不能安装离线版。请使用 HTTPS 网址；电脑测试可用 localhost。');
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', checkOffline);
  window.addEventListener('online', () => { checkOffline(); registration?.update().catch(() => {}); });
  window.addEventListener('offline', checkOffline);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkOffline(); });
  register();
})();
