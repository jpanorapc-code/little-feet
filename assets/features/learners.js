// learners workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function loadHouseholdSwitcher() {
  const box = document.getElementById('householdSwitcher');
  if (!box || currentUser?.role !== 'parent') return;
  try {
    const response = await fetch(`/api/household?username=${encodeURIComponent(currentUser.username)}`);
    const learners = await response.json();
    if (!response.ok || !learners.length) return;
    const analyticsInput = document.getElementById('analyticsStudent');
    const analyticsSelect = document.getElementById('analyticsStudentSelect');
    const storedSelection = localStorage.getItem('lf_selected_learner');
    const selectedLearner = learners.find(learner => learner.studentName === storedSelection) || learners[0];
    if (analyticsInput && analyticsSelect) {
      analyticsInput.classList.add('hidden');
      analyticsInput.required = false;
      analyticsSelect.classList.remove('hidden');
      analyticsSelect.required = true;
      analyticsSelect.innerHTML = learners.map(learner => `<option value="${escapeWorkspaceText(learner.studentName)}">${escapeWorkspaceText(learner.studentName)} · ${escapeWorkspaceText(learner.className)}</option>`).join('');
      analyticsSelect.value = selectedLearner.studentName;
    }
    localStorage.setItem('lf_selected_learner', selectedLearner.studentName);
    box.classList.remove('hidden');
    box.innerHTML = `<div class="card-header-bar"><h2>👨‍👩‍👧 Your linked learners</h2><span class="badge-tag info">PARENT</span></div><p style="color:var(--text-muted);margin-bottom:10px;">Only children linked to this parent account are shown here.</p><div style="display:flex;gap:8px;flex-wrap:wrap;">${learners.map((learner, index) => `<button type="button" class="action-btn ${learner.studentName === selectedLearner.studentName || (!index && !selectedLearner) ? 'btn-green' : 'btn-blue'}" onclick="selectHouseholdLearner('${encodeInlineIdentifier(learner.studentName)}')">${escapeWorkspaceText(learner.studentName)} · ${escapeWorkspaceText(learner.className)}</button>`).join('')}</div><p id="householdSelection" class="meta" style="margin-top:9px;">Selected learner: ${escapeWorkspaceText(selectedLearner.studentName)}</p>`;
  } catch { box.classList.add('hidden'); }
}

function selectHouseholdLearner(encodedName) {
  const name = decodeURIComponent(encodedName);
  localStorage.setItem('lf_selected_learner', name);
  const analyticsSelect = document.getElementById('analyticsStudentSelect');
  if (analyticsSelect) analyticsSelect.value = name;
  const notice = document.getElementById('householdSelection');
  if (notice) notice.textContent = `Selected learner: ${name}`;
}

function downloadLearnerImportTemplate() {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading. Please try again in a moment.');
  const rows = [{
    'Learner Name': 'Example Learner',
    'Grade / Class': 'Preschool',
    'Parent / Guardian Name': 'Example Guardian',
    'Parent Email': 'parent@example.com',
    'Medical Notes': 'None known',
    'Emergency Contact': 'Example Guardian · 071 000 0000',
    'Authorised Pickups': 'Example Guardian'
  }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Learner import');
  XLSX.writeFile(workbook, 'LittleFeet_Learner_Import_Template.xlsx');
}

function importValue(row, candidates) {
  const normalized = Object.entries(row).reduce((fields, [key, value]) => {
    fields[String(key).trim().toLowerCase().replace(/[^a-z0-9]/g, '')] = value;
    return fields;
  }, {});
  for (const candidate of candidates) {
    const value = normalized[candidate];
    if (value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

function previewLearnerDatabaseImport() {
  const input = document.getElementById('schoolDatabaseFile');
  const preview = document.getElementById('schoolDatabasePreview');
  const file = input?.files?.[0];
  if (!file || !preview) return alert('Choose an Excel or CSV school register first.');
  const fileError = validateSpreadsheetFile(file, SCHOOL_INTEGRATION_SPREADSHEET_MAX_BYTES);
  if (fileError) return alert(fileError);
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading. Please try again in a moment.');
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const sourceRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
      if (sourceRows.length > 100000) throw new Error('This register contains more than 100,000 rows. Split it into school-approved files of 100,000 rows or fewer.');
      const rows = sourceRows.map(row => ({
        studentName: importValue(row, ['learnername', 'studentname', 'childname', 'name']),
        className: importValue(row, ['gradeclass', 'classname', 'class', 'grade']),
        parentName: importValue(row, ['parentguardianname', 'parentname', 'guardianname']),
        contactEmail: importValue(row, ['parentemail', 'guardianemail', 'contactemail', 'email']),
        medicalNotes: importValue(row, ['medicalnotes', 'medical', 'allergies']),
        emergencyContact: importValue(row, ['emergencycontact', 'emergencyphone', 'emergency']),
        authorisedPickups: importValue(row, ['authorisedpickups', 'authorizedpickups', 'pickups', 'pickup'])
      })).filter(row => row.studentName || row.className || row.parentName || row.contactEmail);
      const validRows = rows.filter(row => row.studentName && row.className);
      pendingLearnerImport = validRows;
      pendingLearnerImportId = (globalThis.crypto?.randomUUID?.() || `import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      const previewRows = validRows.slice(0, 8).map(row => `<tr><td>${escapeWorkspaceText(row.studentName)}</td><td>${escapeWorkspaceText(row.className)}</td><td>${escapeWorkspaceText(row.parentName || 'Not supplied')}</td><td>${escapeWorkspaceText(row.contactEmail || 'Not supplied')}</td></tr>`).join('');
      preview.innerHTML = `<div class="item-row" style="display:block;"><strong>${validRows.length} valid learner record${validRows.length === 1 ? '' : 's'} detected</strong><p class="meta" style="margin:7px 0 12px;">${rows.length - validRows.length} row${rows.length - validRows.length === 1 ? '' : 's'} need a learner name and class/grade before they can be imported. Only the first eight records are shown below.</p><div style="overflow-x:auto;"><table><thead><tr><th>Learner</th><th>Class</th><th>Parent / guardian</th><th>Contact email</th></tr></thead><tbody>${previewRows || '<tr><td colspan="4">No valid learner rows found.</td></tr>'}</tbody></table></div><button type="button" class="submit-btn" style="margin-top:14px;max-width:330px;" onclick="confirmLearnerDatabaseImport()">Review and import ${validRows.length} record${validRows.length === 1 ? '' : 's'}</button></div>`;
    } catch (error) {
      pendingLearnerImport = [];
      pendingLearnerImportId = '';
      preview.textContent = 'This file could not be read. Download the template to check the expected column headings.';
      logAppError('ERR_IMPORT_FILE_400', error.message || 'The learner import file could not be read.');
    }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmLearnerDatabaseImport() {
  if (!pendingLearnerImport.length) return alert('Preview a valid school register before importing it.');
  if (!confirm(`Import ${pendingLearnerImport.length} learner record${pendingLearnerImport.length === 1 ? '' : 's'}? Existing matches will not be overwritten.`)) return;
  const chunkSize = 250;
  const totalBatches = Math.ceil(pendingLearnerImport.length / chunkSize);
  const importId = pendingLearnerImportId || (globalThis.crypto?.randomUUID?.() || `import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  pendingLearnerImportId = importId;
  let imported = 0;
  const rejected = [];
  for (let offset = 0; offset < pendingLearnerImport.length; offset += chunkSize) {
    const batchNumber = Math.floor(offset / chunkSize);
    const response = await fetch('/api/students/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importId, batchNumber, totalBatches, students: pendingLearnerImport.slice(offset, offset + chunkSize) })
    });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'The learner import could not be completed.');
    imported += Number(result.imported || 0);
    rejected.push(...(result.rejected || []));
    const preview = document.getElementById('schoolDatabasePreview');
    if (preview) preview.querySelector('strong').textContent = `Importing batch ${batchNumber + 1} of ${totalBatches} · ${result.progress?.imported ?? imported} records saved`;
  }
  const duplicateSummary = rejected.length ? ` ${rejected.length} duplicate or incomplete row${rejected.length === 1 ? ' was' : 's were'} skipped.` : '';
  alert(`${imported} learner record${imported === 1 ? '' : 's'} imported in smaller secure batches.${duplicateSummary}`);
  document.getElementById('schoolDatabaseFile').value = '';
  document.getElementById('schoolDatabasePreview').innerHTML = '';
  pendingLearnerImport = [];
  pendingLearnerImportId = '';
  playDingSound();
}
