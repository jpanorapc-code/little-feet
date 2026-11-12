(() => {
  const names = {
    lfGroupSelect: 'Learner group', lfLearnerDocumentLearner: 'Learner',
    lfEldaSkill: 'Development skill', lfGradeRSkill: 'Grade R skill',
    lfSchoolGroupSelect: 'School group', lfAssetImport: 'Asset spreadsheet',
    purpose: 'Document type', observedAt: 'Observation date',
    effectiveDate: 'Effective date', purchaseDate: 'Purchase date', date: 'Date', file: 'Supporting document',
    ticketMeetingDate: 'Requested meeting date', ticketMeetingTime: 'Requested meeting time',
    ticketMeetingLocation: 'Requested meeting location', badgeStudentName: 'Student name',
    badgeCategory: 'Milestone category', badgeTitle: 'Badge award name', badgeNote: 'Educator evaluation note',
    languagePreference: 'Display language', refreshPreference: 'Dashboard refresh frequency',
    customWallpaperFile: 'Choose a custom wallpaper image'
  };
  const readable = value => String(value || '').replace(/^lf[-_]/i, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  function contextualLabel(control) {
    const explicit = names[control.id] || names[control.name] || control.getAttribute('data-label') || control.getAttribute('aria-label') || control.getAttribute('title');
    if (explicit) return explicit;
    const placeholder = String(control.getAttribute('placeholder') || '').trim();
    if (placeholder && !/^[•*·\s]+$/.test(placeholder)) return placeholder.replace(/^e\.g\.\s*/i, '').replace(/\.{2,}$/, '').trim();
    const identity = readable(control.name || control.id);
    if (identity) return identity;
    const types = { checkbox:'Confirmation', radio:'Option', date:'Date', time:'Time', file:'File upload', number:'Number', email:'Email address', password:'Password', tel:'Telephone number', search:'Search', url:'Website address', color:'Colour' };
    const type = types[control.type] || (control.tagName === 'SELECT' ? 'Selection' : control.tagName === 'TEXTAREA' ? 'Message' : 'Text');
    const form = control.closest('form');
    const heading = form && (form.querySelector('h1,h2,h3,h4,legend')?.textContent?.trim() || form.getAttribute('aria-label'));
    return heading ? heading + ' · ' + type : type + ' field';
  }
  function labelControls(root) {
    const controls = Array.from(root.querySelectorAll ? root.querySelectorAll('input,select,textarea') : []);
    if (root.matches && root.matches('input,select,textarea')) controls.unshift(root);
    for (const control of controls) {
      if (control.type === 'hidden' || ['button','submit','reset','image'].includes(control.type) || control.closest('label') || control.closest('[aria-hidden="true"]') || control.labels?.length || control.hasAttribute('aria-labelledby')) continue;
      const labelText = contextualLabel(control);
      if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', labelText);
      // Preserve every existing control ID because application code depends on them.
      if (control.id && document.querySelectorAll('#' + CSS.escape(control.id)).length === 1) {
        const label = document.createElement('label'); label.className = 'sr-only'; label.htmlFor = control.id; label.textContent = labelText;
        control.parentNode.insertBefore(label, control);
      }
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
