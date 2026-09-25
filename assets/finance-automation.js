(() => {
  let financeAutomationState = null;
  let latestStatement = null;
  let pendingBankLines = [];
  let pendingBankPreview = null;

  const safe = value => window.escapeWorkspaceText ? window.escapeWorkspaceText(value) : String(value ?? '');
  const money = value => window.formatSubscriptionMoney ? window.formatSubscriptionMoney(value) : 'R' + Number(value || 0).toFixed(2);
  const today = () => new Date().toISOString().slice(0, 10);
  const yearStart = () => today().slice(0, 4) + '-01-01';

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Finance request failed.');
    return data;
  }

  async function refreshState() {
    financeAutomationState = await api('/api/finance/automation');
    return financeAutomationState;
  }

  function automationSummaryMarkup(data) {
    const counts = data.counts || {};
    const recentRun = data.payrollRuns?.[0];
    const recentRecon = data.recentReconciliationRuns?.[0];
    return `
      <div class="card-header-bar">
        <div><h3>Finance automation</h3><p class="meta" style="margin:4px 0 0;">Recurring billing, statements, controlled adjustments, reconciliation, payroll and accounting exports.</p></div>
        <span class="badge-tag info">AUTOMATION</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px;">
        <div><span class="meta">Recurring rules</span><strong style="display:block;font-size:1.1rem;">${Number(counts.activeRecurringRules || 0)} active</strong></div>
        <div><span class="meta">Payroll profiles</span><strong style="display:block;font-size:1.1rem;">${Number(counts.payrollProfiles || 0)}</strong></div>
        <div><span class="meta">Latest payroll</span><strong style="display:block;font-size:.9rem;">${recentRun ? safe(recentRun.status + ' · ' + recentRun.payDate) : 'None yet'}</strong></div>
        <div><span class="meta">Latest reconciliation</span><strong style="display:block;font-size:.9rem;">${recentRecon ? safe(recentRecon.appliedCount + ' applied') : 'None yet'}</strong></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">
        <button type="button" class="action-btn btn-green" onclick="openRecurringInvoiceRule()">Recurring invoices</button>
        <button type="button" class="action-btn btn-blue" onclick="openFinanceStatement()">Statements</button>
        <button type="button" class="action-btn btn-blue" onclick="openFinanceAdjustment()">Credits / refunds</button>
        <button type="button" class="action-btn btn-green" onclick="openAutoReconcile()">Auto reconcile</button>
        <button type="button" class="action-btn btn-blue" onclick="openPayrollManager()">Payroll</button>
        <button type="button" class="action-btn btn-blue" onclick="openAccountingExport()">Accounting export</button>
      </div>
    `;
  }

  async function loadFinanceAutomationOverview() {
    const host = document.getElementById('financeAutomationOverview');
    if (!host) return;
    try {
      const data = await refreshState();
      host.innerHTML = automationSummaryMarkup(data);
    } catch (error) {
      host.innerHTML = '<p class="meta">Finance automation unavailable: ' + safe(error.message) + '</p>';
    }
  }

  async function openRecurringInvoiceRule() {
    const data = await refreshState();
    const options = ['<option value="*">All approved parent accounts</option>']
      .concat((data.parents || []).map(parent => '<option value="' + safe(parent.username) + '">' + safe(parent.name) + '</option>'))
      .join('');
    const rules = (data.rules || []).map(rule => `
      <div class="item-row"><div><strong>${safe(rule.name)}</strong> <span class="badge-tag ${rule.active === false ? '' : 'info'}">${rule.active === false ? 'PAUSED' : 'ACTIVE'}</span>
      <p style="margin:4px 0;">${safe(rule.description)} · ${money(rule.amount)} · day ${Number(rule.dueDay)}</p>
      <span class="meta">${rule.parentUsername === '*' ? 'All parents' : safe(rule.parentUsername)}${rule.lastRunPeriod ? ' · last run ' + safe(rule.lastRunPeriod) : ''}</span></div>
      <button type="button" class="action-btn btn-blue" onclick="toggleRecurringInvoiceRule('${safe(rule.id)}', ${rule.active === false ? 'true' : 'false'})">${rule.active === false ? 'Resume' : 'Pause'}</button></div>
    `).join('');
    window.openModal('Recurring parent invoices', `
      <form onsubmit="saveRecurringInvoiceRule(event)" style="display:grid;gap:10px;">
        <label>Rule name<input name="name" maxlength="160" required placeholder="Monthly school fees"></label>
        <label>Parents<select name="parentUsername" required>${options}</select></label>
        <div class="workspace-grid">
          <label>Amount (R)<input name="amount" type="number" min="0.01" step="0.01" required></label>
          <label>Due day<input name="dueDay" type="number" min="1" max="28" value="1" required></label>
        </div>
        <label>Description<input name="description" maxlength="240" required value="School fees · {month}"></label>
        <label>Learner (optional)<input name="learnerName" maxlength="160"></label>
        <p class="meta" style="margin:0;">Automatic runs occur monthly. Duplicate invoices for the same rule, parent and month are blocked.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="submit-btn">Save recurring rule</button><button type="button" class="action-btn btn-blue" onclick="runRecurringInvoices()">Run due invoices now</button></div>
      </form>
      <div class="record-list" style="margin-top:14px;">${rules || '<div class="record-empty-state"><span><strong>No recurring rules yet</strong><span>Create one above.</span></span></div>'}</div>
    `);
  }

  async function saveRecurringInvoiceRule(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    await api('/api/finance/recurring-rules', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    await loadFinanceAutomationOverview();
    await openRecurringInvoiceRule();
  }

  async function toggleRecurringInvoiceRule(id, active) {
    await api('/api/finance/recurring-rules/' + encodeURIComponent(id) + '/toggle', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ active }) });
    await openRecurringInvoiceRule();
    await loadFinanceAutomationOverview();
  }

  async function runRecurringInvoices() {
    const result = await api('/api/finance/recurring-runs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ force:true }) });
    alert(result.created.length + ' invoice(s) created for ' + result.period + '.');
    await loadFinanceAutomationOverview();
    window.loadParentPayments?.();
    await openRecurringInvoiceRule();
  }

  async function openFinanceStatement() {
    const currentUser = window.getLittleFeetCurrentUser?.();
    const parents = currentUser?.role === 'parent'
      ? [{ username: currentUser.username, name: currentUser.name || currentUser.username }]
      : ((await refreshState()).parents || []);
    const options = parents.map(parent => '<option value="' + safe(parent.username) + '">' + safe(parent.name) + '</option>').join('');
    window.openModal('Parent statement', `
      <form onsubmit="loadFinanceStatement(event)" style="display:grid;gap:10px;">
        <label>Parent<select name="parentUsername" required>${options}</select></label>
        <div class="workspace-grid"><label>From<input name="from" type="date" value="${yearStart()}" required></label><label>To<input name="to" type="date" value="${today()}" required></label></div>
        <button class="submit-btn">Build statement</button>
      </form>
      <div id="financeStatementPreview" style="margin-top:14px;"></div>
    `);
  }

  async function loadFinanceStatement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const params = new URLSearchParams({
      parentUsername: form.elements.parentUsername.value,
      from: form.elements.from.value,
      to: form.elements.to.value
    });
    latestStatement = await api('/api/finance/statements?' + params.toString());
    const host = document.getElementById('financeStatementPreview');
    const rows = latestStatement.rows.map(row => '<tr><td>' + safe(row.date) + '</td><td>' + safe(row.type) + '</td><td>' + safe(row.reference) + '</td><td>' + safe(row.description) + '</td><td>' + money(row.debit) + '</td><td>' + money(row.credit) + '</td><td>' + money(row.balance) + '</td></tr>').join('');
    host.innerHTML = `
      <div class="workspace-card"><strong>${safe(latestStatement.parent.name)}</strong><p class="meta">Opening ${money(latestStatement.openingBalance)} · Closing ${money(latestStatement.closingBalance)}</p></div>
      <div style="overflow:auto;"><table style="width:100%;min-width:760px;"><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No activity in this period.</td></tr>'}</tbody></table></div>
      <button type="button" class="action-btn btn-blue" style="margin-top:10px;" onclick="exportFinanceStatement()">Export statement</button>
    `;
  }

  function exportFinanceStatement() {
    if (!latestStatement) return;
    if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading.');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(latestStatement.rows.map(row => ({
      Date: row.date, Type: row.type, Reference: row.reference, Description: row.description,
      Debit: row.debit, Credit: row.credit, Balance: row.balance
    }))), 'Statement');
    XLSX.writeFile(workbook, 'LittleFeet_Statement_' + latestStatement.parent.username.replace(/[^a-z0-9]+/gi, '_') + '_' + latestStatement.period.to + '.xlsx');
  }

  async function openFinanceAdjustment() {
    const payments = await api('/api/parent-payments');
    const options = (payments.payments || []).filter(payment => payment.balance > 0 || payment.paidAmount > 0).map(payment =>
      '<option value="' + safe(payment.id) + '">' + safe(payment.parentName + ' · ' + payment.description + ' · ' + payment.reference) + '</option>'
    ).join('');
    window.openModal('Credit note or refund', `
      <form onsubmit="saveFinanceAdjustment(event)" style="display:grid;gap:10px;">
        <label>Invoice<select name="paymentId" required>${options}</select></label>
        <label>Adjustment<select name="type"><option value="credit">Credit note</option><option value="refund">Refund</option></select></label>
        <label>Amount (R)<input name="amount" type="number" min="0.01" step="0.01" required></label>
        <label>Reason<input name="reason" maxlength="500" required></label>
        <label>Bank reference (refund only)<input name="bankReference" maxlength="160"></label>
        <p class="meta" style="margin:0;">Credits reduce the invoice balance. Refunds reverse paid value and restore the balance. Every adjustment is audited.</p>
        <button class="submit-btn">Apply adjustment</button>
      </form>
    `);
  }

  async function saveFinanceAdjustment(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api('/api/finance/adjustments', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    window.closeModal();
    await window.loadParentPayments?.();
    await loadFinanceAutomationOverview();
  }

  function parseSpreadsheetDate(value) {
    if (!value) return today();
    if (typeof value === 'number' && typeof XLSX !== 'undefined') {
      const parts = XLSX.SSF.parse_date_code(value);
      if (parts) return String(parts.y).padStart(4, '0') + '-' + String(parts.m).padStart(2, '0') + '-' + String(parts.d).padStart(2, '0');
    }
    const text = String(value).trim();
    const direct = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
    if (direct) return direct;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? today() : parsed.toISOString().slice(0, 10);
  }

  function pickColumn(row, names) {
    const map = new Map(Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), value]));
    for (const name of names) if (map.has(name)) return map.get(name);
    return '';
  }

  async function openAutoReconcile() {
    window.openModal('Automatic bank reconciliation', `
      <p class="meta">Upload CSV/XLSX statement lines. Little Feet only auto-applies a line when it finds an exact Little Feet payment reference and the amount is safe for the outstanding balance.</p>
      <input id="financeBankFile" type="file" accept=".csv,.xlsx,.xls" onchange="previewBankStatementFile(event)">
      <div id="financeBankPreview" style="margin-top:14px;"></div>
    `);
  }

  async function previewBankStatementFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading.');
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type:'array', cellDates:false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval:'' });
    pendingBankLines = rows.slice(0, 500).map((row, index) => ({
      id: String(pickColumn(row, ['id','transaction id','transactionid']) || ('row-' + (index + 2))),
      bankReference: String(pickColumn(row, ['bank reference','bankreference','transaction reference']) || ''),
      reference: String(pickColumn(row, ['reference','payment reference','little feet reference']) || ''),
      amount: pickColumn(row, ['amount','credit','paid amount']),
      date: parseSpreadsheetDate(pickColumn(row, ['date','transaction date','received date'])),
      description: String(pickColumn(row, ['description','details','narrative','memo']) || '')
    }));
    pendingBankPreview = await api('/api/finance/reconciliation/preview', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ lines:pendingBankLines }) });
    const host = document.getElementById('financeBankPreview');
    const counts = pendingBankPreview.counts || {};
    const matched = pendingBankPreview.results.filter(row => row.status === 'matched');
    host.innerHTML = `
      <div class="workspace-card"><strong>Preview</strong><p class="meta">Matched ${Number(counts.matched || 0)} · Unmatched ${Number(counts.unmatched || 0)} · Amount mismatch ${Number(counts.amount_mismatch || 0)} · Duplicates ${Number(counts.duplicate || 0)} · Invalid ${Number(counts.invalid || 0)}</p></div>
      <div class="record-list">${matched.slice(0, 50).map(row => '<div class="item-row"><div><strong>' + safe(row.reference) + '</strong><p class="meta">' + money(row.amount) + ' · ' + safe(row.date) + ' · exact reference</p></div></div>').join('') || '<p class="meta">No safe automatic matches found.</p>'}</div>
      <button type="button" class="action-btn btn-green" onclick="applyAutoReconciliation()" ${matched.length ? '' : 'disabled'}>Apply safe matches</button>
    `;
  }

  async function applyAutoReconciliation() {
    if (!pendingBankLines.length) return;
    const result = await api('/api/finance/reconciliation/apply', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ lines:pendingBankLines }) });
    alert(result.run.appliedCount + ' bank line(s) reconciled.');
    window.closeModal();
    await window.loadParentPayments?.();
    await loadFinanceAutomationOverview();
  }

  async function openPayrollManager() {
    const data = await refreshState();
    const profileByUser = new Map((data.payrollProfiles || []).map(profile => [String(profile.username).toLowerCase(), profile]));
    const staffRows = (data.staff || []).map(staff => {
      const profile = profileByUser.get(String(staff.username).toLowerCase());
      return '<div class="item-row"><div><strong>' + safe(staff.name) + '</strong><p class="meta">' + safe(staff.role) + (profile ? ' · ' + money(profile.baseGross) + ' base gross' : ' · no payroll profile') + '</p></div><button type="button" class="action-btn btn-blue" onclick="openPayrollProfileForm(\'' + encodeURIComponent(staff.username) + '\')">Configure</button></div>';
    }).join('');
    const runRows = (data.payrollRuns || []).map(run =>
      '<div class="item-row"><div><strong>' + safe(run.periodStart + ' → ' + run.periodEnd) + '</strong><p class="meta">' + safe(run.status) + ' · pay ' + safe(run.payDate) + ' · net ' + money(run.totals?.net) + '</p></div><div style="display:flex;gap:6px;">' +
      (run.status === 'draft' ? '<button type="button" class="action-btn btn-green" onclick="approvePayrollRun(\'' + safe(run.id) + '\')">Approve</button>' : '') +
      '<button type="button" class="action-btn btn-blue" onclick="exportPayrollRun(\'' + safe(run.id) + '\')">Export</button></div></div>'
    ).join('');
    window.openModal('Payroll runs', `
      <p class="meta">Little Feet records approved gross pay, allowances, deductions and net pay. It does not calculate PAYE, UIF, SDL or other statutory obligations.</p>
      <button type="button" class="action-btn btn-green" onclick="openPayrollRunForm()">Create payroll run</button>
      <h4 style="margin:16px 0 8px;">Staff profiles</h4><div class="record-list">${staffRows || '<p class="meta">No staff accounts found.</p>'}</div>
      <h4 style="margin:16px 0 8px;">Payroll runs</h4><div class="record-list">${runRows || '<p class="meta">No payroll runs yet.</p>'}</div>
    `);
  }

  async function openPayrollProfileForm(encodedUsername) {
    const data = financeAutomationState || await refreshState();
    const username = decodeURIComponent(encodedUsername);
    const staff = (data.staff || []).find(item => item.username === username);
    const profile = (data.payrollProfiles || []).find(item => item.username === username) || {};
    if (!staff) return;
    window.openModal('Payroll profile · ' + safe(staff.name), `
      <form onsubmit="savePayrollProfile(event,'${encodeURIComponent(username)}')" style="display:grid;gap:10px;">
        <label>Employee number<input name="employeeNumber" maxlength="80" value="${safe(profile.employeeNumber || '')}"></label>
        <label>Pay frequency<select name="payFrequency"><option value="monthly" ${profile.payFrequency === 'weekly' ? '' : 'selected'}>Monthly</option><option value="weekly" ${profile.payFrequency === 'weekly' ? 'selected' : ''}>Weekly</option></select></label>
        <div class="workspace-grid"><label>Base gross (R)<input name="baseGross" type="number" min="0" step="0.01" value="${Number(profile.baseGross || 0)}" required></label><label>Allowances (R)<input name="defaultAllowances" type="number" min="0" step="0.01" value="${Number(profile.defaultAllowances || 0)}"></label></div>
        <label>Approved deductions (R)<input name="defaultDeductions" type="number" min="0" step="0.01" value="${Number(profile.defaultDeductions || 0)}"></label>
        <label style="display:flex;gap:8px;align-items:center;"><input name="active" type="checkbox" ${profile.active === false ? '' : 'checked'}> Active in payroll</label>
        <button class="submit-btn">Save payroll profile</button>
      </form>
    `);
  }

  async function savePayrollProfile(event, encodedUsername) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form).entries());
    body.active = form.elements.active.checked;
    await api('/api/finance/payroll/profiles/' + encodeURIComponent(decodeURIComponent(encodedUsername)), { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    await refreshState();
    await openPayrollManager();
    await loadFinanceAutomationOverview();
  }

  function openPayrollRunForm() {
    window.openModal('Create payroll run', `
      <form onsubmit="createPayrollRun(event)" style="display:grid;gap:10px;">
        <div class="workspace-grid"><label>Period start<input name="periodStart" type="date" required></label><label>Period end<input name="periodEnd" type="date" required></label></div>
        <label>Pay date<input name="payDate" type="date" required></label>
        <label>Note<input name="note" maxlength="500" placeholder="Optional run note"></label>
        <p class="meta">All active payroll profiles are included. Review and approve the generated run before using the export.</p>
        <button class="submit-btn">Create draft payroll run</button>
      </form>
    `);
  }

  async function createPayrollRun(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api('/api/finance/payroll/runs', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    await refreshState();
    await openPayrollManager();
    await loadFinanceAutomationOverview();
  }

  async function approvePayrollRun(id) {
    await api('/api/finance/payroll/runs/' + encodeURIComponent(id) + '/approve', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    await refreshState();
    await openPayrollManager();
    await loadFinanceAutomationOverview();
  }

  function exportPayrollRun(id) {
    const run = financeAutomationState?.payrollRuns?.find(item => item.id === id);
    if (!run) return;
    if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading.');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet((run.lines || []).map(line => ({
      Employee: line.employeeName, Username: line.username, 'Employee Number': line.employeeNumber,
      'Base Gross': line.baseGross, Allowances: line.allowances, Gross: line.gross, Deductions: line.deductions, Net: line.net
    }))), 'Payroll');
    XLSX.writeFile(workbook, 'LittleFeet_Payroll_' + run.periodEnd + '.xlsx');
  }

  function openAccountingExport() {
    window.openModal('Accounting journal export', `
      <form onsubmit="createAccountingExport(event)" style="display:grid;gap:10px;">
        <div class="workspace-grid"><label>From<input name="from" type="date" value="${yearStart()}" required></label><label>To<input name="to" type="date" value="${today()}" required></label></div>
        <p class="meta">Exports balanced generic journal rows for parent invoices, payments/refunds, credit notes and approved payroll. Review account mappings with the school accountant before importing.</p>
        <button class="submit-btn">Generate accounting export</button>
      </form>
    `);
  }

  async function createAccountingExport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const params = new URLSearchParams({ from:form.elements.from.value, to:form.elements.to.value });
    const data = await api('/api/finance/accounting-export?' + params.toString());
    if (Math.abs(Number(data.totalDebits || 0) - Number(data.totalCredits || 0)) > 0.001) throw new Error('Accounting journal is not balanced; export blocked.');
    if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading.');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(data.rows.map(row => ({
      Date: row.date, Reference: row.reference, Memo: row.memo, Source: row.sourceType, Account: row.account, Debit: row.debit, Credit: row.credit
    }))), 'Journal');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ From:data.period.from, To:data.period.to, Debits:data.totalDebits, Credits:data.totalCredits, Note:data.note }]), 'Read me');
    XLSX.writeFile(workbook, 'LittleFeet_Accounting_Journal_' + data.period.to + '.xlsx');
    window.closeModal();
  }

  Object.assign(window, {
    loadFinanceAutomationOverview,
    openRecurringInvoiceRule, saveRecurringInvoiceRule, toggleRecurringInvoiceRule, runRecurringInvoices,
    openFinanceStatement, loadFinanceStatement, exportFinanceStatement,
    openFinanceAdjustment, saveFinanceAdjustment,
    openAutoReconcile, previewBankStatementFile, applyAutoReconciliation,
    openPayrollManager, openPayrollProfileForm, savePayrollProfile, openPayrollRunForm, createPayrollRun, approvePayrollRun, exportPayrollRun,
    openAccountingExport, createAccountingExport
  });
})();
