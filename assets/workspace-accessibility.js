(() => {
  const names = {
    lfGroupSelect: 'Learner group', lfLearnerDocumentLearner: 'Learner',
    lfEldaSkill: 'Development skill', lfGradeRSkill: 'Grade R skill',
    lfSchoolGroupSelect: 'School group', lfAssetImport: 'Asset spreadsheet',
    purpose: 'Document type', observedAt: 'Observation date',
    effectiveDate: 'Effective date', purchaseDate: 'Purchase date',
    date: 'Date', file: 'Supporting document'
  };
  const readable = value => String(value || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').trim();
  function labelControls(root) {
    const controls = [...root.querySelectorAll('input,select,textarea')];
    if (root.matches?.('input,select,textarea')) controls.unshift(root);
    for (const control of controls) {
      if (['hidden', 'button', 'submit', 'reset'].includes(control.type)
        || control.labels?.length || control.hasAttribute('aria-label')
        || control.hasAttribute('aria-labelledby') || control.title) continue;
      const label = names[control.id] || names[control.name] || control.placeholder || readable(control.name);
      if (label) control.setAttribute('aria-label', label);
    }
  }
  const loadingText = /^Loading(?:\s|…|\.\.\.)/i;
  function syncBusyState(root) {
    const elements = [];
    if (root.nodeType === Node.ELEMENT_NODE) elements.push(root);
    if (root.querySelectorAll) elements.push(...root.querySelectorAll('[aria-live], [id$="Content"], [id$="List"], [id$="Results"]'));
    for (const element of elements) {
      const text = String(element.textContent || '').trim();
      if (loadingText.test(text)) {
        if (!element.hasAttribute('aria-live')) element.setAttribute('aria-live', 'polite');
        element.setAttribute('aria-busy', 'true');
      } else if (element.getAttribute('aria-busy') === 'true') {
        element.setAttribute('aria-busy', 'false');
      }
    }
  }
  function start() {
    labelControls(document);
    syncBusyState(document.body);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') {
          syncBusyState(record.target.parentElement || document.body);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          labelControls(node);
          syncBusyState(node);
        }
        if (record.target?.nodeType === Node.ELEMENT_NODE) syncBusyState(record.target);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
