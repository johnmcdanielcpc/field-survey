/* Startup: service worker (offline), persistent storage, first route, background upload. */
(function () {
  const FS = window.FS;
  FS.VERSION = '1.0.15';

  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w && w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            const b = document.createElement('div'); b.className = 'toast update';
            b.innerHTML = 'App update ready. <button class="btn small">Reload</button>';
            b.querySelector('button').onclick = () => location.reload();
            document.body.appendChild(b);
          }
        });
      });
    }).catch(e => console.warn('SW', e));
  }
  // ask the browser not to clear our storage under pressure
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });

  FS.route();
  FS.updateNet();
  setTimeout(() => FS.Sync.run(), 1500);
})();
