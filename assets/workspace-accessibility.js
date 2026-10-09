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
  function start() {
    labelControls(document);
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) labelControls(node);
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
