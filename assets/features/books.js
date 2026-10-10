// books workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function bookStatusLabel(record) {
  if (record.status === 'returned') return record.returnStatus === 'lost' ? '<span class="badge-tag urgent">LOST</span>' : record.returnStatus === 'damaged' ? '<span class="badge-tag urgent">DAMAGED</span>' : '<span class="badge-tag info">RETURNED</span>';
  if (!record.parentSignature) return '<span class="badge-tag">AWAITING PARENT SIGNATURE</span>';
  return '<span class="badge-tag info">ISSUED</span>';
}

async function loadBookRegister() {
  const summaryBox = document.getElementById('bookRegisterSummary');
  const list = document.getElementById('bookRegisterRecords');
  if (!summaryBox || !list || !currentUser || !(isFullAccessUser() || ['parent', 'teacher', 'principal'].includes(currentUser.role))) return;
  try {
    const response = await fetch('/api/book-register');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load the book checklist.');
    bookRegisterData = data;
    summaryBox.innerHTML = `<div class="card-header-bar"><h3>Current checklist</h3><span class="badge-tag ${data.summary.outstanding ? 'urgent' : 'info'}">${data.summary.outstanding ? `${data.summary.outstanding} OUTSTANDING` : 'ALL RETURNED'}</span></div><div style="display:flex;gap:18px;flex-wrap:wrap;"><span><strong>${data.summary.total}</strong> books</span><span><strong>${data.summary.returned}</strong> returned</span><span><strong>${data.summary.unsignedParents}</strong> parent signatures missing</span><span><strong>${formatSubscriptionMoney(data.summary.penalties)}</strong> damage/loss penalties</span></div>`;
    list.innerHTML = data.records?.length ? data.records.map(record => {
      const returnDetails = record.status === 'returned' ? `<p class="meta">Returned ${record.returnedAt ? new Date(record.returnedAt).toLocaleString() : ''} · ${escapeWorkspaceText(record.returnCondition)} · ${escapeWorkspaceText(record.returnStatus)}${record.penaltyAmount ? ` · Penalty ${formatSubscriptionMoney(record.penaltyAmount)}` : ''}</p>` : '';
      const signatures = `<p class="meta">Admin signed: ${escapeWorkspaceText(record.adminSignature || '—')} ${record.adminSignedAt ? `(${new Date(record.adminSignedAt).toLocaleString()})` : ''} · Parent signed: ${escapeWorkspaceText(record.parentSignature || '—')} ${record.parentSignedAt ? `(${new Date(record.parentSignedAt).toLocaleString()})` : ''}</p>`;
      const parentActions = currentUser.role === 'parent' ? `${!record.parentSignature ? `<button type="button" class="action-btn btn-blue" onclick="signBookRecord('${encodeInlineIdentifier(record.id)}','received')">Sign received</button>` : ''}${record.status === 'returned' && !record.returnParentSignature ? `<button type="button" class="action-btn btn-blue" onclick="signBookRecord('${encodeInlineIdentifier(record.id)}','returned')">Sign returned</button>` : ''}` : '';
      const staffActions = (isFullAccessUser() || currentUser.role === 'principal') && record.status !== 'returned' ? `<button type="button" class="action-btn btn-green" onclick="openBookReturnModal('${encodeInlineIdentifier(record.id)}')">Record return</button>` : '';
      return `<div class="item-row"><div><strong>${escapeWorkspaceText(record.bookTitle)}${record.bookCode ? ` · ${escapeWorkspaceText(record.bookCode)}` : ''}</strong> ${bookStatusLabel(record)}<p style="margin:4px 0;">Learner: ${escapeWorkspaceText(record.learnerName)} · Class: ${escapeWorkspaceText(record.className || 'Not recorded')} · Parent: ${escapeWorkspaceText(record.parentName)}</p><p class="meta">Handover condition: ${escapeWorkspaceText(record.issueCondition)} · Replacement price: ${formatSubscriptionMoney(record.bookPrice)}</p>${returnDetails}${signatures}</div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">${parentActions}${staffActions}</div></div>`;
    }).join('') : '<p class="meta">No books have been added to the school checklist yet.</p>';
  } catch (error) { summaryBox.innerHTML = `<p style="margin:0;color:#fca5a5;">${escapeWorkspaceText(safeUserFacingError(error, 'Unable to load book checklist.'))}</p>`; list.innerHTML = ''; }
}

async function openBookIssueModal() {
  if (!(isFullAccessUser() || currentUser?.role === 'principal')) return alert('Only a principal or administrator can add book checklists.');
  let parents;
  try { const response = await fetch('/api/book-register/parents'); parents = await response.json(); if (!response.ok) throw new Error(parents.message || 'Unable to load parents.'); } catch (error) { return alert(safeUserFacingError(error, 'Unable to load parents.')); }
  if (!parents.length) return alert('Create or approve a parent account first.');
  const options = parents.map(parent => `<option value="${escapeWorkspaceText(parent.username)}">${escapeWorkspaceText(parent.name)} · ${escapeWorkspaceText(parent.username)}</option>`).join('');
  openModal('Add book to checklist', `<form onsubmit="createBookRecord(event)" style="display:grid;gap:12px;"><p class="meta" style="margin:0;">The admin signature and time are saved automatically. The parent can sign after reviewing the handover.</p><div class="workspace-grid"><label>Book title<input name="bookTitle" required maxlength="200" placeholder="e.g. Grade 4 Mathematics"></label><label>Book code (optional)<input name="bookCode" maxlength="80"></label></div><div class="workspace-grid"><label>Learner name<input name="learnerName" required maxlength="160"></label><label>Class<input name="className" maxlength="120" placeholder="e.g. Grade 4A"></label></div><label>Parent account<select name="parentUsername" required>${options}</select></label><div class="workspace-grid"><label>Replacement price (R)<input name="bookPrice" type="number" min="0" step="0.01" required></label><label>Condition before handover<input name="issueCondition" required maxlength="500" placeholder="e.g. New, no markings"></label></div><label>Notes (optional)<input name="notes" maxlength="500"></label><button class="submit-btn">Save book checklist</button></form>`);
}

async function createBookRecord(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  try { const response = await fetch('/api/book-register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Unable to save book checklist.'); closeModal(); await loadBookRegister(); } catch (error) { alert(safeUserFacingError(error, 'Unable to save book checklist.')); }
}

function openBookReturnModal(encodedId) {
  const record = bookRegisterData?.records?.find(item => item.id === decodeURIComponent(encodedId));
  if (!record) return;
  openModal('Record returned book', `<form onsubmit="recordBookReturn(event,'${encodeInlineIdentifier(record.id)}')" style="display:grid;gap:12px;"><p style="margin:0;"><strong>${escapeWorkspaceText(record.bookTitle)}</strong> · ${escapeWorkspaceText(record.learnerName)} · Replacement price ${formatSubscriptionMoney(record.bookPrice)}</p><label>Return result<select name="returnStatus" required><option value="returned_good">Returned in acceptable condition</option><option value="damaged">Damaged — charge replacement price</option><option value="lost">Lost — charge replacement price</option></select></label><label>Condition at return<textarea name="returnCondition" rows="3" required placeholder="Describe the final condition or loss."></textarea></label><label>Admin signature<input name="returnAdminSignature" value="${escapeWorkspaceText(currentUser.name || '')}" required maxlength="160"></label><button class="submit-btn">Save return</button></form>`);
}

async function recordBookReturn(event, encodedId) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  try { const response = await fetch(`/api/book-register/${encodeURIComponent(decodeURIComponent(encodedId))}/return`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Unable to record return.'); closeModal(); await loadBookRegister(); } catch (error) { alert(safeUserFacingError(error, 'Unable to record return.')); }
}

function signBookRecord(encodedId, action) {
  const record = bookRegisterData?.records?.find(item => item.id === decodeURIComponent(encodedId));
  if (!record) return;
  openModal(action === 'returned' ? 'Confirm returned book' : 'Confirm book received', `<form onsubmit="submitBookSignature(event,'${encodeInlineIdentifier(record.id)}','${action}')" style="display:grid;gap:12px;"><p class="meta">Type your name to save your signature and the current date and time.</p><label>Parent signature<input name="signature" required maxlength="160" autocomplete="name" value="${escapeWorkspaceText(currentUser.name || '')}"></label><button class="submit-btn">Confirm signature</button></form>`);
}

async function submitBookSignature(event, encodedId, action) {
  event.preventDefault();
  const signature = event.currentTarget.elements.signature.value;
  try { const response = await fetch(`/api/book-register/${encodeURIComponent(decodeURIComponent(encodedId))}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, signature }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Unable to save signature.'); closeModal(); await loadBookRegister(); } catch (error) { alert(safeUserFacingError(error, 'Unable to save signature.')); }
}

function downloadBookRegisterTemplate() {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading.');
  const rows = [{ 'Book Title': 'Example Mathematics', 'Book Code': 'BOOK-001', 'Learner Name': 'Example Learner', Class: 'Grade 4A', 'Parent Username': 'parent@example.com', 'Book replacement price': 250, 'Condition at handover': 'New, no markings', Notes: '' }];
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Book register'); XLSX.writeFile(workbook, 'LittleFeet_Book_Register_Template.xlsx');
}

function importBookRegisterExcel() {
  const input = document.getElementById('bookRegisterImportFile');
  if (!input) return;
  input.value = ''; input.onchange = event => {
    const file = event.target.files?.[0]; if (!file) return;
    const fileError = validateSpreadsheetFile(file); if (fileError) return alert(fileError);
    const reader = new FileReader(); reader.onload = async () => {
      try { const workbook = XLSX.read(new Uint8Array(reader.result), { type: 'array' }); const sheet = workbook.Sheets[workbook.SheetNames[0]]; const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }); if (rows.length > 2000) throw new Error('Book-register imports are limited to 2,000 records per file.'); const response = await fetch('/api/book-register/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Unable to import checklist.'); await loadBookRegister(); alert(`Imported ${result.imported} row(s).${result.rejected?.length ? ` Rejected ${result.rejected.length} row(s).` : ''}`); } catch (error) { alert(safeUserFacingError(error, 'Unable to import checklist.')); }
    }; reader.readAsArrayBuffer(file);
  }; input.click();
}

function exportBookRegister() {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading.');
  const rows = (bookRegisterData?.records || []).map(record => ({ 'Book Title': record.bookTitle, 'Book Code': record.bookCode, 'Learner Name': record.learnerName, Class: record.className, 'Parent Name': record.parentName, 'Parent Username': record.parentUsername, 'Replacement Price': record.bookPrice, 'Condition at Handover': record.issueCondition, 'Admin Signed At': record.adminSignedAt, 'Admin Signature': record.adminSignature, 'Parent Signed At': record.parentSignedAt, 'Parent Signature': record.parentSignature, Status: record.status, 'Return Condition': record.returnCondition, 'Return Result': record.returnStatus, 'Returned At': record.returnedAt, Penalty: record.penaltyAmount, 'Return Admin Signature': record.returnAdminSignature, 'Return Parent Signature': record.returnParentSignature }));
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Book register'); XLSX.writeFile(workbook, 'LittleFeet_Book_Register.xlsx');
}

function openBookClassReport() {
  const classes = [...new Set((bookRegisterData?.records || []).map(record => record.className).filter(Boolean))].sort();
  if (!classes.length) return alert('Add books with class names first.');
  const options = classes.map(className => `<option value="${escapeWorkspaceText(className)}">${escapeWorkspaceText(className)}</option>`).join('');
  openModal('Class book return report', `<label>Class<select id="bookReportClass" onchange="renderBookClassReport()">${options}</select></label><div id="bookClassReport" style="margin-top:14px;"></div><button type="button" class="action-btn btn-blue" style="margin-top:12px;" onclick="exportBookClassReport()">Export this class</button>`);
  renderBookClassReport();
}

function renderBookClassReport() {
  const className = document.getElementById('bookReportClass')?.value; const box = document.getElementById('bookClassReport'); if (!box) return;
  const records = (bookRegisterData?.records || []).filter(record => record.className === className); const returned = records.filter(record => record.status === 'returned').length; const penalties = records.reduce((sum, record) => sum + Number(record.penaltyAmount || 0), 0);
  box.innerHTML = `<div class="workspace-card"><strong>${escapeWorkspaceText(className)}</strong><p class="meta">${returned}/${records.length} books returned · ${formatSubscriptionMoney(penalties)} in damage/loss penalties</p>${records.map(record => `<div style="padding:8px 0;border-top:1px solid var(--border-color);"><strong>${escapeWorkspaceText(record.learnerName)}</strong> · ${escapeWorkspaceText(record.bookTitle)} · ${bookStatusLabel(record)}<br><span class="meta">Handover: ${escapeWorkspaceText(record.issueCondition)} · Return: ${escapeWorkspaceText(record.returnCondition || 'Not returned')}</span></div>`).join('')}</div>`;
}

function exportBookClassReport() {
  const className = document.getElementById('bookReportClass')?.value; if (!className || typeof XLSX === 'undefined') return;
  const rows = (bookRegisterData?.records || []).filter(record => record.className === className).map(record => ({ Learner: record.learnerName, Book: record.bookTitle, Status: record.status, 'Handover condition': record.issueCondition, 'Return condition': record.returnCondition || 'Not returned', Penalty: record.penaltyAmount || 0, 'Parent signature': record.parentSignature || 'Missing' }));
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Class report'); XLSX.writeFile(workbook, `LittleFeet_${className.replace(/[^a-z0-9]+/gi, '_')}_Book_Returns.xlsx`);
}
