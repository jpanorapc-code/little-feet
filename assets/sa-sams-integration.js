(() => {
  'use strict';

  let pendingSaSamsRows = [];
  let pendingSaSamsImportId = '';

  const normaliseHeader = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const field = (row, names) => {
    const normalised = {};
    Object.entries(row || {}).forEach(([key, value]) => { normalised[normaliseHeader(key)] = value; });
    for (const name of names) {
      const value = normalised[normaliseHeader(name)];
      if (value !== undefined && String(value).trim()) return String(value).trim();
    }
    return '';
  };
  const joinName = (...parts) => parts.map(value => String(value || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

  function mapSaSamsRow(row) {
    const combinedName = field(row, ['Learner Full Name', 'Learner Name and Surname', 'Student Name', 'Full Name']);
    const firstNames = field(row, ['Learner Name', 'Learner Names', 'First Name', 'First Names', 'Name']);
    const surname = field(row, ['Learner Surname', 'Surname', 'Last Name']);
    const grade = field(row, ['Grade', 'Current Grade', 'Grade Name']);
    const registerClass = field(row, ['Register Class', 'Registration Class', 'Class', 'Class Name']);
    const guardianName = field(row, ['Parent / Guardian Name', 'Parent Name', 'Guardian Name', 'Primary Guardian']);
    const guardianEmail = field(row, ['Parent Email', 'Guardian Email', 'Email Address', 'Email']);
    const guardianCell = field(row, ['Guardian Cell', 'Parent Cell', 'Parent Mobile', 'Guardian Mobile', 'Cell Number', 'Mobile Number']);
    return {
      studentName: combinedName || joinName(firstNames, surname),
      className: registerClass || grade,
      parentName: guardianName,
      contactEmail: guardianEmail,
      emergencyContact: guardianCell,
      medicalNotes: '',
      authorisedPickups: ''
    };
  }

  window.previewSaSamsImport = function previewSaSamsImport() {
    const input = document.getElementById('saSamsImportFile');
    const preview = document.getElementById('saSamsImportPreview');
    const file = input?.files?.[0];
    if (!file || !preview) return alert('Choose an SA-SAMS Excel or CSV learner/parent export first.');
    if (typeof XLSX === 'undefined') return alert('The spreadsheet reader is still loading. Please try again in a moment.');
    const fileError = typeof validateSpreadsheetFile === 'function' ? validateSpreadsheetFile(file, 50 * 1024 * 1024) : null;
    if (fileError) return alert(fileError);

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const sourceRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        if (!sourceRows.length) throw new Error('The SA-SAMS export contains no data rows.');
        if (sourceRows.length > 100000) throw new Error('Split exports larger than 100,000 rows before importing.');

        const mapped = sourceRows.map(mapSaSamsRow);
        const valid = mapped.filter(row => row.studentName && row.className);
        pendingSaSamsRows = valid;
        pendingSaSamsImportId = 'sasams_' + (globalThis.crypto?.randomUUID?.() || (Date.now() + '_' + Math.random().toString(16).slice(2))).replace(/-/g, '_');

        const sample = valid.slice(0, 8).map(row => '<tr><td>' + escapeText(row.studentName) + '</td><td>' + escapeText(row.className) + '</td><td>' + escapeText(row.parentName || 'Not supplied') + '</td><td>' + escapeText(row.contactEmail || row.emergencyContact || 'Not supplied') + '</td></tr>').join('');
        preview.innerHTML = '<div class="item-row" style="display:block;"><strong>' + valid.length + ' SA-SAMS learner record' + (valid.length === 1 ? '' : 's') + ' ready</strong><p class="meta" style="margin:7px 0 12px;">' + (sourceRows.length - valid.length) + ' row' + (sourceRows.length - valid.length === 1 ? '' : 's') + ' could not be mapped because learner name or grade/register class is missing. Nothing is saved until you confirm.</p><div style="overflow-x:auto;"><table><thead><tr><th>Learner</th><th>Grade / register class</th><th>Parent / guardian</th><th>Contact</th></tr></thead><tbody>' + (sample || '<tr><td colspan="4">No valid learner rows found.</td></tr>') + '</tbody></table></div><button type="button" class="submit-btn" style="margin-top:14px;max-width:330px;" onclick="confirmSaSamsImport()">Import ' + valid.length + ' into Little Feet</button></div>';
      } catch (error) {
        pendingSaSamsRows = [];
        pendingSaSamsImportId = '';
        preview.textContent = error.message || 'This SA-SAMS export could not be read.';
        if (typeof logAppError === 'function') logAppError('ERR_SASAMS_IMPORT_400', error.message || 'SA-SAMS import parse failed.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  window.confirmSaSamsImport = async function confirmSaSamsImport() {
    if (!pendingSaSamsRows.length) return alert('Preview a valid SA-SAMS export first.');
    if (!confirm('Import ' + pendingSaSamsRows.length + ' SA-SAMS learner record' + (pendingSaSamsRows.length === 1 ? '' : 's') + '? Existing Little Feet matches will not be overwritten.')) return;

    const chunkSize = 250;
    const totalBatches = Math.ceil(pendingSaSamsRows.length / chunkSize);
    let imported = 0;
    let rejected = 0;
    for (let offset = 0; offset < pendingSaSamsRows.length; offset += chunkSize) {
      const batchNumber = Math.floor(offset / chunkSize);
      const response = await fetch('/api/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importId: pendingSaSamsImportId,
          batchNumber,
          totalBatches,
          sourceSystem: 'SA-SAMS',
          students: pendingSaSamsRows.slice(offset, offset + chunkSize)
        })
      });
      const result = await response.json();
      if (!response.ok) return alert(result.message || 'The SA-SAMS import could not be completed.');
      imported += Number(result.imported || 0);
      rejected += Array.isArray(result.rejected) ? result.rejected.length : Number(result.rejected || 0);
      const preview = document.getElementById('saSamsImportPreview');
      const heading = preview?.querySelector('strong');
      if (heading) heading.textContent = 'Importing batch ' + (batchNumber + 1) + ' of ' + totalBatches + ' · ' + (result.progress?.imported ?? imported) + ' saved';
    }

    alert(imported + ' SA-SAMS learner record' + (imported === 1 ? '' : 's') + ' imported into Little Feet.' + (rejected ? ' ' + rejected + ' duplicate or invalid row' + (rejected === 1 ? ' was' : 's were') + ' skipped.' : ''));
    const input = document.getElementById('saSamsImportFile');
    const preview = document.getElementById('saSamsImportPreview');
    if (input) input.value = '';
    if (preview) preview.innerHTML = '';
    pendingSaSamsRows = [];
    pendingSaSamsImportId = '';
    if (typeof playDingSound === 'function') playDingSound();
  };
})();
