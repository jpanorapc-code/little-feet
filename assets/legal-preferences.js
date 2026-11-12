(() => {
  'use strict';

  const STORAGE_KEY = 'lf_cookie_notice_20261112';
  const notice = document.getElementById('lfCookieConsent');
  const acknowledge = document.getElementById('lfCookieAcknowledge');
  if (!notice || !acknowledge) return;

  const hasAcknowledged = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return saved?.essential === true && saved?.version === 1;
    } catch {
      return false;
    }
  };

  const hide = () => notice.classList.add('hidden');
  const show = (moveFocus = false) => {
    notice.classList.remove('hidden');
    if (moveFocus) requestAnimationFrame(() => acknowledge.focus());
  };

  acknowledge.addEventListener('click', () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, essential: true, acknowledgedAt: new Date().toISOString() }));
    } catch {
      // Essential sign-in cookies do not depend on local storage.
    }
    hide();
  });

  window.showLittleFeetCookieNotice = () => show(true);
  if (!hasAcknowledged()) show();
})();
