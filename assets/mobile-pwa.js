(() => {
  let deferredInstallPrompt = null;

  const statusText = () => document.getElementById('pwaConnectionStatus');
  const installButton = () => document.getElementById('pwaInstallButton');
  const installStatus = () => document.getElementById('pwaInstallStatus');

  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  function updateConnectionStatus() {
    const target = statusText();
    if (!target) return;
    target.textContent = navigator.onLine
      ? 'Online — live school data is available.'
      : 'Offline — the portal shell is available, but live school records need a connection.';
    target.dataset.state = navigator.onLine ? 'online' : 'offline';
  }

  function updateInstallState() {
    const button = installButton();
    const status = installStatus();
    if (!button || !status) return;
    if (isStandalone()) {
      button.hidden = true;
      status.textContent = 'Little Feet is installed on this device.';
      return;
    }
    button.hidden = !deferredInstallPrompt;
    status.textContent = deferredInstallPrompt
      ? 'Install Little Feet for faster access from this device.'
      : 'Your browser will offer installation when it supports this app.';
  }

  async function installLittleFeetApp() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    updateInstallState();
    if (choice?.outcome === 'accepted') {
      const status = installStatus();
      if (status) status.textContent = 'Little Feet installation accepted.';
    }
  }

  window.installLittleFeetApp = installLittleFeetApp;

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallState();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallState();
  });
  window.addEventListener('online', updateConnectionStatus);
  window.addEventListener('offline', updateConnectionStatus);

  window.addEventListener('DOMContentLoaded', () => {
    updateConnectionStatus();
    updateInstallState();
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(error => {
        console.warn('Little Feet service worker registration failed:', error.message);
      });
    });
  }
})();
