(() => {
  'use strict';
  if (!window.IntersectionObserver) return;
  const selector = '.card, .workspace-card, .workspace-results-panel, .store-item, .chat-shell, .guide-link-card, .modal-card, .executive-kpi, .executive-chart-card, .portal-welcome-banner, .my-day-hero, .my-day-attention, .my-day-action, .staff-work-card, .parent-contact-card, .ui-icon, .brand-header h1, .brand-header img, .brand-header .slogan, .nav-brand .site-name, .login-info-runner, .login-info-runner-track';
  const registered = new WeakSet();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      entry.target.dataset.lfMotion = entry.isIntersecting ? 'running' : 'paused';
    }
  });
  function visit(node, callback) {
    if (node.nodeType !== 1) return;
    if (node.matches(selector)) callback(node);
    node.querySelectorAll(selector).forEach(callback);
  }
  function register(element) {
    if (registered.has(element)) return;
    registered.add(element);
    element.dataset.lfMotion = 'paused';
    observer.observe(element);
  }
  visit(document.body, register);
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) visit(node, element => {
        if (element.isConnected) return;
        observer.unobserve(element);
        registered.delete(element);
      });
      for (const node of record.addedNodes) visit(node, register);
      if (record.type === 'attributes') {
        if (record.target.matches(selector)) register(record.target);
        else if (registered.has(record.target)) {
          observer.unobserve(record.target);
          registered.delete(record.target);
          delete record.target.dataset.lfMotion;
        }
      }
    }
  }).observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });

  let scrolling = false;
  let timer;
  const sync = () => document.documentElement.classList.toggle('lf-motion-idle', document.hidden || scrolling);
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('scroll', () => {
    if (!scrolling) { scrolling = true; sync(); }
    clearTimeout(timer);
    timer = setTimeout(() => { scrolling = false; sync(); }, 160);
  }, { capture:true, passive:true });
  sync();
})();
