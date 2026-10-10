// learner-codes workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function renderLearnerCodeNameOptions() {
  const list = document.getElementById('learnerCodeNameOptions');
  if (!list) return;
  list.innerHTML = learnerAccessCodeRecords.map(record =>
    `<option value="${escapeWorkspaceText(record.learnerName || '')}" label="${escapeWorkspaceText(record.className || 'Class not recorded')}"></option>`
  ).join('');
}

function learnerCodeResultLabel(status) {
  return ({
    generated: 'New code generated',
    existing: 'Existing active code reused',
    not_found: 'Learner not found',
    ambiguous: 'Multiple learners match — add Grade / Class',
    invalid: 'Learner name required'
  })[status] || 'Unable to generate code';
}

function stageLearnerCodeResults(results) {
  (Array.isArray(results) ? results : []).forEach(result => {
    if (!['generated', 'existing'].includes(result.status) || !result.accessCode || !result.learnerKey) return;
    const row = {
      learnerKey: result.learnerKey,
      learnerName: result.learnerName || result.inputName || '',
      accessCode: result.accessCode,
      className: result.className || '',
      parentName: result.parentName || '',
      status: learnerCodeResultLabel(result.status),
      issuedAt: result.issuedAt || ''
    };
    const existingIndex = learnerCodeExportRows.findIndex(item => item.learnerKey === row.learnerKey);
    if (existingIndex >= 0) learnerCodeExportRows[existingIndex] = row;
    else learnerCodeExportRows.push(row);
  });
  renderLearnerCodeExportPreview();
}

function renderLearnerCodeExportPreview() {
  const preview = document.getElementById('learnerCodeExportPreview');
  if (!preview) return;
  if (!learnerCodeExportRows.length) {
    preview.innerHTML = '<p class="meta">No learner codes are staged for export yet.</p>';
    return;
  }
  preview.innerHTML = `<div class="item-row" style="display:block;"><strong>${learnerCodeExportRows.length} learner code${learnerCodeExportRows.length === 1 ? '' : 's'} staged for export</strong><div style="overflow:auto;margin-top:8px;"><table><thead><tr><th>Learner</th><th>Code</th><th>Class</th><th>Status</th></tr></thead><tbody>${learnerCodeExportRows.slice(-20).map(row => `<tr><td>${escapeWorkspaceText(row.learnerName)}</td><td><strong style="letter-spacing:.06em;">${escapeWorkspaceText(row.accessCode)}</strong></td><td>${escapeWorkspaceText(row.className || 'Not recorded')}</td><td>${escapeWorkspaceText(row.status)}</td></tr>`).join('')}</tbody></table></div>${learnerCodeExportRows.length > 20 ? '<p class="meta">Showing the latest 20 staged rows. The download contains the full staged list.</p>' : ''}</div>`;
}

async function requestLearnerCodeGeneration(rows) {
  if (!isFullAccessUser()) throw new Error('Only an administrator can generate learner access codes.');
  const requested = Array.isArray(rows) ? rows : [];
  if (!requested.length) return [];
  const results = [];
  const chunkSize = 500;
  for (let offset = 0; offset < requested.length; offset += chunkSize) {
    const response = await fetch('/api/learner-access-codes/generate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ learners: requested.slice(offset, offset + chunkSize) })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Unable to generate learner access codes.');
    results.push(...(Array.isArray(payload.results) ? payload.results : []));
  }
  return results;
}

async function generateSingleLearnerCode() {
  if (!isFullAccessUser()) return alert('Only an administrator can generate learner access codes.');
  const nameField = document.getElementById('learnerCodeGenerateName');
  const classField = document.getElementById('learnerCodeGenerateClass');
  const resultBox = document.getElementById('learnerCodeGenerateResult');
  const learnerName = String(nameField?.value || '').trim();
  const className = String(classField?.value || '').trim();
  if (!learnerName) return alert('Enter the learner name first.');

  try {
    if (resultBox) resultBox.textContent = 'Matching the learner and generating the secure code…';
    const [result] = await requestLearnerCodeGeneration([{ learnerName, className }]);
    if (!result) throw new Error('No learner-code result was returned.');
    if (!['generated', 'existing'].includes(result.status)) {
      if (resultBox) resultBox.innerHTML = `<strong>${escapeWorkspaceText(learnerCodeResultLabel(result.status))}</strong> · ${escapeWorkspaceText(result.message || 'Check the learner name and class.')}`;
      return;
    }
    stageLearnerCodeResults([result]);
    if (resultBox) resultBox.innerHTML = `<strong>${escapeWorkspaceText(result.learnerName)}</strong> · <strong style="letter-spacing:.08em;color:var(--primary-color);">${escapeWorkspaceText(result.accessCode)}</strong> · ${escapeWorkspaceText(learnerCodeResultLabel(result.status))}`;
    if (nameField) nameField.value = '';
    if (classField) classField.value = '';
    await loadLearnerAccessCodes();
    playDingSound();
  } catch (error) {
    if (resultBox) resultBox.textContent = safeUserFacingError(error, 'Unable to generate this learner code.');
  }
}

function learnerCodeSheetRows(rows = learnerCodeExportRows) {
  return rows.map(row => ({
    'Learner Name': row.learnerName || '',
    'Learner Access Code': row.accessCode || '',
    'Grade / Class': row.className || '',
    'Parent / Guardian': row.parentName || '',
    'Code Status': row.status || '',
    'Issued At': row.issuedAt || ''
  }));
}

function downloadLearnerCodeRows(rows, format, filenameBase) {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading. Please try again in a moment.');
  if (!rows.length) return alert('There are no learner codes to export yet.');
  const worksheet = XLSX.utils.json_to_sheet(rows);
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `${filenameBase}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    return;
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Learner codes');
  XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
}

function downloadStagedLearnerCodes(format = 'xlsx') {
  downloadLearnerCodeRows(
    learnerCodeSheetRows(),
    format,
    `LittleFeet_Learner_Codes_${new Date().toISOString().slice(0, 10)}`
  );
}

function clearStagedLearnerCodes() {
  learnerCodeExportRows = [];
  renderLearnerCodeExportPreview();
  const resultBox = document.getElementById('learnerCodeGenerateResult');
  if (resultBox) resultBox.textContent = 'No code generated in this browser session yet.';
}

function downloadLearnerCodeGeneratorTemplate() {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading. Please try again in a moment.');
  const worksheet = XLSX.utils.aoa_to_sheet([['Learner Name', 'Grade / Class']]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Learner names');
  XLSX.writeFile(workbook, 'LittleFeet_Learner_Code_Generator_Template.xlsx');
}

function readLearnerCodeSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const fileError = validateSpreadsheetFile(file, STANDARD_SPREADSHEET_MAX_BYTES);
    if (fileError) return reject(new Error(fileError));
    if (typeof XLSX === 'undefined') return reject(new Error('The spreadsheet tool is still loading. Please try again in a moment.'));
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const sourceRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' }).filter(row =>
          Object.values(row || {}).some(value => String(value || '').trim())
        );
        if (!sourceRows.length) throw new Error('The spreadsheet does not contain any learner rows.');
        if (sourceRows.length > 100000) throw new Error('This spreadsheet contains more than 100,000 rows. Split it into smaller school-approved files.');
        resolve(sourceRows);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('The spreadsheet could not be read.'));
    reader.readAsArrayBuffer(file);
  });
}

function normalizedSpreadsheetHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function learnerCodeSpreadsheetHeaders(rows) {
  const reserved = new Set(['learneraccesscode', 'codestatus']);
  const headers = [];
  rows.forEach(row => Object.keys(row || {}).forEach(key => {
    if (reserved.has(normalizedSpreadsheetHeader(key))) return;
    if (!headers.includes(key)) headers.push(key);
  }));
  const learnerAliases = new Set(['learnername', 'studentname', 'childname', 'name']);
  const nameHeader = headers.find(header => learnerAliases.has(normalizedSpreadsheetHeader(header))) || null;
  const outputHeaders = [];
  headers.forEach(header => {
    outputHeaders.push(header);
    if (header === nameHeader) outputHeaders.push('Learner Access Code', 'Code Status');
  });
  if (!nameHeader) outputHeaders.push('Learner Access Code', 'Code Status');
  return { headers, outputHeaders };
}

async function generateLearnerCodesFromSpreadsheet(format = 'xlsx') {
  if (!isFullAccessUser()) return alert('Only an administrator can generate learner access codes.');
  const input = document.getElementById('learnerCodeBulkFile');
  const status = document.getElementById('learnerCodeBulkStatus');
  const file = input?.files?.[0];
  if (!file) return alert('Choose an Excel or CSV learner-name file first.');

  try {
    if (status) status.textContent = 'Reading learner names…';
    const sourceRows = await readLearnerCodeSpreadsheet(file);
    const requests = sourceRows.map(row => ({
      learnerName: importValue(row, ['learnername', 'studentname', 'childname', 'name']),
      className: importValue(row, ['gradeclass', 'classname', 'class', 'grade'])
    }));
    if (status) status.textContent = `Matching ${requests.length} learner row${requests.length === 1 ? '' : 's'} to the real school register…`;
    const results = await requestLearnerCodeGeneration(requests);
    const { outputHeaders } = learnerCodeSpreadsheetHeaders(sourceRows);
    const enrichedRows = sourceRows.map((row, index) => {
      const result = results[index] || { status: 'invalid', message: 'No result returned.' };
      return {
        ...row,
        'Learner Access Code': result.accessCode || '',
        'Code Status': learnerCodeResultLabel(result.status)
      };
    });
    stageLearnerCodeResults(results);

    const worksheet = XLSX.utils.json_to_sheet(enrichedRows, { header: outputHeaders });
    const generated = results.filter(result => result.status === 'generated').length;
    const existing = results.filter(result => result.status === 'existing').length;
    const unmatched = results.length - generated - existing;
    const filenameBase = `LittleFeet_Learner_Codes_${new Date().toISOString().slice(0, 10)}`;

    if (format === 'csv') {
      const csv = XLSX.utils.sheet_to_csv(worksheet);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      link.download = `${filenameBase}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } else {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Learner codes');
      XLSX.writeFile(workbook, `${filenameBase}.xlsx`);
    }

    if (status) status.innerHTML = `<strong>${generated + existing} matched</strong> · ${generated} new code${generated === 1 ? '' : 's'} generated · ${existing} existing code${existing === 1 ? '' : 's'} reused · ${unmatched} row${unmatched === 1 ? '' : 's'} need attention. The downloaded file keeps every source row and places <strong>Learner Access Code</strong> immediately after the learner-name column.`;
    await loadLearnerAccessCodes();
    playDingSound();
  } catch (error) {
    if (status) status.textContent = safeUserFacingError(error, 'Unable to generate learner codes from this spreadsheet.');
  }
}

async function loadLearnerAccessCodes() {
  const list = document.getElementById('learnerCodeList');
  if (!list || !(isFullAccessUser() || currentUser?.role === 'principal')) return;
  try {
    const response = await fetch(`/api/learner-access-codes?actorUsername=${encodeURIComponent(currentUser.username)}`);
    const records = await response.json();
    if (!response.ok) throw new Error(records.message || 'Unable to load learner code forms.');
    learnerAccessCodeRecords = records;
    renderLearnerCodeNameOptions();
    renderLearnerCodeExportPreview();
    if (!records.length) {
      list.innerHTML = '<p style="font-size:.84rem;color:var(--text-muted);">No learners are available yet. Import or register learners first.</p>';
      return;
    }
    renderLearnerAccessCodes();
  } catch (error) {
    list.textContent = safeUserFacingError(error, 'Unable to load learner code forms.');
  }
}

function renderLearnerAccessCodes() {
  const list = document.getElementById('learnerCodeList');
  if (!list || !(isFullAccessUser() || currentUser?.role === 'principal')) return;
  const canManage = isFullAccessUser();
  const query = String(document.getElementById('learnerCodeSearch')?.value || '').trim().toLowerCase();
  const records = learnerAccessCodeRecords.filter(record => !query || [record.learnerName, record.className, record.parentName, record.accessCode].some(value => String(value || '').toLowerCase().includes(query)));
  if (!records.length) {
    list.innerHTML = '<p class="meta">No learners match that search.</p>';
    return;
  }
  list.innerHTML = records.map(record => {
    const encodedKey = encodeInlineIdentifier(record.learnerKey);
    const encodedSchool = encodeInlineIdentifier(record.schoolId || "");
    const details = `${escapeWorkspaceText(record.learnerName)} · ${escapeWorkspaceText(record.className || 'Class not recorded')}`;
    const status = record.accessCode ? `<p style="margin-top:5px;">Current code: <strong style="letter-spacing:.08em;color:var(--primary-color);">${escapeWorkspaceText(record.accessCode)}</strong></p>` : record.hasPrintableForm ? '<p class="meta" style="margin-top:5px;">Prepared for printing. The code is not displayed to this role.</p>' : '<p class="meta" style="margin-top:5px;">No active learner code issued.</p>';
    const history = canManage && record.codeHistory?.length ? `<details style="margin-top:8px;"><summary class="meta">${record.codeHistory.length} code record${record.codeHistory.length === 1 ? '' : 's'} in history</summary><div class="meta" style="margin:7px 0 0;line-height:1.55;">${record.codeHistory.map(entry => `${escapeWorkspaceText(entry.status)} · issued ${entry.issuedAt ? new Date(entry.issuedAt).toLocaleDateString() : 'date unknown'}${entry.changedAt ? ` · updated ${new Date(entry.changedAt).toLocaleDateString()}` : ''}`).join('<br>')}</div></details>` : '';
    const actions = record.hasPrintableForm ? `<button type="button" class="action-btn btn-blue" onclick="printLearnerCodeForm('${encodedKey}', '${encodedSchool}')">🖨️ Print form</button>` : '';
    const management = canManage ? (record.accessCode ? `<button type="button" class="action-btn btn-green" onclick="replaceLearnerAccessCode('${record.codeRecordId}')">♻️ New random code</button><button type="button" class="action-btn btn-red" onclick="revokeLearnerAccessCode('${record.codeRecordId}')">Scrap code</button>` : `<button type="button" class="action-btn btn-green" onclick="openLearnerCodeIssue('${encodedKey}', '${encodedSchool}')">Generate code</button>`) : '';
    return `<div class="item-row"><div><strong>${details}</strong>${status}<span class="meta">${record.issuedAt ? `Issued ${new Date(record.issuedAt).toLocaleString()} by ${escapeWorkspaceText(record.issuedBy || 'school administrator')}` : 'Awaiting administrator issue'}${record.parentName ? ` · Parent: ${escapeWorkspaceText(record.parentName)}` : ''}</span>${history}</div><div style="display:flex;gap:8px;flex-wrap:wrap;">${actions}${management}</div></div>`;
  }).join('');
}

async function toggleLearnerCodeTeacherPreview() {
  if (!isFullAccessUser()) return;
  const panel = document.getElementById('learnerCodeTeacherPreview');
  if (!panel) return;
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  panel.innerHTML = '<p class="meta">Loading the teacher-safe view…</p>';
  panel.classList.remove('hidden');
  try {
    const response = await fetch('/api/learner-access-codes/teacher-preview');
    const records = await response.json();
    if (!response.ok) throw new Error(records.message || 'Unable to load the teacher view.');
    panel.innerHTML = records.length ? records.map(record => `<div class="item-row"><div><strong>${escapeWorkspaceText(record.learnerName)} · ${escapeWorkspaceText(record.className || 'Class not recorded')}</strong><p class="meta" style="margin:4px 0 0;">${record.parentName ? `Parent: ${escapeWorkspaceText(record.parentName)} · ` : ''}${record.codeIssued ? 'School code issued' : 'No school code issued'}</p></div><span class="badge-tag info">NO CODE SHOWN</span></div>`).join('') : '<p class="meta">No learner records are available.</p>';
  } catch (error) {
    panel.innerHTML = `<p class="meta">${escapeWorkspaceText(safeUserFacingError(error, 'Unable to load the teacher view.'))}</p>`;
  }
}

function learnerCodeRecord(encodedKey, encodedSchool = "") {
  return learnerAccessCodeRecords.find(record => record.learnerKey === decodeURIComponent(encodedKey) && (!encodedSchool || record.schoolId === decodeURIComponent(encodedSchool)));
}

function openLearnerCodeIssue(encodedKey, encodedSchool = "") {
  if (!isFullAccessUser()) return alert('Only an administrator can issue a learner access code.');
  const record = learnerCodeRecord(encodedKey, encodedSchool);
  if (!record) return alert('Learner record not found. Refresh the code list and try again.');
  openModal('Issue learner access code', `<p style="margin:0 0 12px;color:var(--text-muted);">Issue a physical code for <strong>${escapeWorkspaceText(record.learnerName)}</strong>. Little Feet will generate a secure, random code for this learner.</p><p class="meta" style="margin-top:7px;">Only the administrator can create, replace, or invalidate a code. A principal may print the completed form.</p><button type="button" class="submit-btn" style="margin-top:14px;" onclick="issueLearnerAccessCode('${encodedKey}', '${encodedSchool}')">Issue code</button>`);
}

async function issueLearnerAccessCode(encodedKey, encodedSchool = "") {
  const response = await fetch('/api/learner-access-codes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorUsername: currentUser?.username, learnerKey: decodeURIComponent(encodedKey), schoolId: decodeURIComponent(encodedSchool) })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to issue this learner code.');
  closeModal();
  playDingSound();
  await loadLearnerAccessCodes();
}

async function replaceLearnerAccessCode(id) {
  if (!isFullAccessUser() || !confirm('Replace this code? The existing physical copy will stop working immediately.')) return;
  const response = await fetch(`/api/learner-access-codes/${encodeURIComponent(id)}/replace`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to replace this learner code.');
  playDingSound();
  await loadLearnerAccessCodes();
}

async function revokeLearnerAccessCode(id) {
  if (!isFullAccessUser() || !confirm('Invalidate this code? Its printed copy will no longer work.')) return;
  const response = await fetch(`/api/learner-access-codes/${encodeURIComponent(id)}/revoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to invalidate this learner code.');
  await loadLearnerAccessCodes();
}

async function printLearnerCodeForm(encodedKey, encodedSchool = "") {
  if (!(isFullAccessUser() || currentUser?.role === 'principal')) return alert('Only an administrator or principal can print this learner form.');
  const response = await fetch(`/api/learner-access-codes/${encodedKey}/printable?schoolId=${encodedSchool}`);
  const record = await response.json();
  if (!response.ok) return alert(record.message || 'An active learner code is required before this form can be printed.');
  const printWindow = window.open('', '_blank', 'width=820,height=980');
  if (!printWindow) return alert('Allow pop-ups for Little Feet to print this learner form.');
  const safe = escapeWorkspaceText;
  printWindow.document.write(`<!doctype html><html><head><title>Learner Access Code</title><style>body{font-family:Arial,sans-serif;color:#102a43;margin:0;padding:34px;background:#f6fbfb}.sheet{max-width:720px;margin:auto;background:#fff;border:2px solid #0d9488;border-radius:18px;padding:34px}.brand{display:flex;align-items:center;gap:14px;border-bottom:2px solid #d8f3ef;padding-bottom:18px}.brand h1{margin:0;font-size:28px;color:#0f766e}.tag{font-size:12px;letter-spacing:1.4px;font-weight:bold;color:#0f766e}.code{margin:28px 0;padding:24px;text-align:center;border-radius:14px;background:#e6fffb;border:2px dashed #0d9488;font-size:30px;font-weight:bold;letter-spacing:4px;color:#0f766e}.details{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:22px 0}.field{padding:12px;border:1px solid #d8e5ea;border-radius:10px}.field span{display:block;color:#627d98;font-size:12px;margin-bottom:4px}.notice{font-size:13px;line-height:1.5;padding:14px;background:#fff7df;border-radius:10px}.sign{margin-top:44px;display:grid;grid-template-columns:1fr 1fr;gap:38px}.line{border-top:1px solid #526d82;padding-top:8px;font-size:12px;color:#526d82}@media print{body{padding:0;background:#fff}.sheet{border:none;border-radius:0;max-width:none}}</style></head><body><main class="sheet"><div class="brand"><div><div class="tag">LITTLE FEET · SCHOOL-ISSUED FORM</div><h1>Learner Access Code</h1></div></div><p>This handout is tied to one learner. Keep it with the approved family record.</p><div class="code">${safe(record.accessCode)}</div><div class="details"><div class="field"><span>Learner</span><strong>${safe(record.learnerName)}</strong></div><div class="field"><span>Class / grade</span><strong>${safe(record.className || 'Not recorded')}</strong></div><div class="field"><span>Parent / guardian</span><strong>${safe(record.parentName || 'To be completed by school')}</strong></div><div class="field"><span>Issued</span><strong>${safe(new Date(record.issuedAt).toLocaleDateString())}</strong></div></div><div class="notice"><strong>For the family:</strong> This code was issued by the school for the learner shown above. Do not share it publicly. If it is lost or needs to be replaced, contact the school administrator; the old code will be invalidated.</div><div class="sign"><div class="line">School representative</div><div class="line">Parent / guardian acknowledgement</div></div></main><script>window.onload=()=>window.print();<\/script></body></html>`);
  printWindow.document.close();
}

async function redeemLearnerAccessCode() {
  if (currentUser?.role !== 'parent') return alert('Only a parent or guardian can use a learner access code.');
  const field = document.getElementById('parentLearnerAccessCode');
  const accessCode = field?.value?.trim();
  if (!accessCode) return alert('Enter the learner access code from the school form.');
  const response = await fetch('/api/learner-access-codes/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accessCode })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to use this learner access code.');
  if (field) field.value = '';
  alert(result.message || `A link request for ${result.learnerName} has been sent to the school administrator.`);
  playDingSound();
}
