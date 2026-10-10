// diagnostics workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function setupRuntimeErrorHelpdesk() {
  window.addEventListener('error', event => {
    const resource = event.target && event.target !== window ? event.target : null;
    if (resource) {
      const source = resource.src || resource.href || '';
      if (source) routeErrorToHelpdesk({ code: 'WEB_RESOURCE_ERROR', message: 'A browser resource failed to load.', source });
      return;
    }
    routeErrorToHelpdesk({
      code: 'WEB_RUNTIME_ERROR',
      message: event.message || 'Unexpected browser error',
      line: event.lineno,
      column: event.colno,
      source: event.filename,
      stack: event.error?.stack || ''
    });
  }, true);
  window.addEventListener('unhandledrejection', event => routeErrorToHelpdesk({
    code: 'WEB_PROMISE_ERROR',
    message: event.reason?.message || String(event.reason || 'Unexpected background error'),
    stack: event.reason?.stack || ''
  }));
}

function dismissRuntimeErrorBanner() {
  document.getElementById('runtimeErrorBanner')?.classList.add('hidden');
}

function openRuntimeErrorSupport() {
  const pending = JSON.parse(sessionStorage.getItem('lf_pending_support_error') || 'null');
  if (!pending) return dismissRuntimeErrorBanner();
  const supportButton = [...document.querySelectorAll('.nav-btn')].find(button => button.getAttribute('onclick')?.includes("ticketsTab"));
  switchTab('ticketsTab', supportButton);
  const department = document.getElementById('ticketDept');
  const priority = document.getElementById('ticketPriority');
  const subject = document.getElementById('ticketSubject');
  const message = document.getElementById('ticketMessage');
  if (department) department.value = 'Technical Support';
  if (priority) priority.value = 'High';
  if (subject) subject.value = `Technical issue: ${pending.code}`;
  if (message) {
    message.value = `${pending.details}\n\nAdditional notes (optional): `;
    message.focus();
    message.setSelectionRange(message.value.length, message.value.length);
  }
  dismissRuntimeErrorBanner();
}

function reportClientStructuredLog({ severity = 'warn', code = 'CLIENT_EVENT', message = '', source = '', line = null, column = null, page = window.location.pathname } = {}) {
  if (!currentUser) return Promise.resolve(null);
  return fetch('/api/system/client-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ severity, code, message, source, line, column, page })
  }).catch(() => null);
}

function logAppError(code, reason) {
  captureDebugEvent({ category: 'Application', code, message: reason });
  void reportClientStructuredLog({ severity: 'warn', code, message: reason });
  const errItem = { code, reason, timestamp: new Date().toLocaleTimeString() };
  errorLog.unshift(errItem);

  const errorBox = document.getElementById('attendanceErrorIndex');
  const errorList = document.getElementById('errorListItems');

  if (errorBox && errorList) {
    errorBox.style.display = 'block';
    errorList.innerHTML = errorLog.map(err => 
      `<li><strong>[${escapeWorkspaceText(err.code)}]</strong> ${escapeWorkspaceText(err.reason)} <em>(${escapeWorkspaceText(err.timestamp)})</em></li>`
    ).join('');
  }
}

function sanitiseDebugText(value) {
  return String(value || 'No additional detail').replace(/(password|pin|token)\s*[:=]\s*\S+/gi, '$1: [redacted]').slice(0, 600);
}

function applyBrowserDiagnosticHistoryReset() {
  const markerKey = 'lf_inspect_clean_slate_id';
  if (sessionStorage.getItem(markerKey) === INSPECT_BROWSER_CLEAN_SLATE_ID) return;
  debugEvents = [];
  sessionStorage.removeItem('lf_debug_events');
  sessionStorage.removeItem('lf_pending_support_error');
  [...Array(sessionStorage.length).keys()]
    .map(index => sessionStorage.key(index))
    .filter(key => key && key.startsWith('lf_error_'))
    .forEach(key => sessionStorage.removeItem(key));
  sessionStorage.setItem(markerKey, INSPECT_BROWSER_CLEAN_SLATE_ID);
}

function configureDebugMode() {
  const isAdmin = isFullAccessUser();
  if (isAdmin) applyBrowserDiagnosticHistoryReset();
  debugModeEnabled = isAdmin && localStorage.getItem('lf_admin_debug_mode') === 'true';
  if (isAdmin) {
    try { debugEvents = JSON.parse(sessionStorage.getItem('lf_debug_events') || '[]'); } catch { debugEvents = []; }
  } else {
    debugEvents = [];
    debugModeEnabled = false;
  }
  updateDebugModePanel();
}

function captureDebugEvent(event) {
  if (!debugModeEnabled || !isFullAccessUser()) return;
  const item = {
    id: `DBG-${Date.now()}`,
    timestamp: new Date().toISOString(),
    category: sanitiseDebugText(event.category || 'Application'),
    code: sanitiseDebugText(event.code || 'UNCLASSIFIED'),
    message: sanitiseDebugText(event.message),
    source: sanitiseDebugText(event.source || 'Not provided'),
    line: Number(event.line) || null,
    column: Number(event.column) || null,
    page: window.location.pathname
  };
  debugEvents.unshift(item);
  debugEvents = debugEvents.slice(0, 50);
  sessionStorage.setItem('lf_debug_events', JSON.stringify(debugEvents));
  updateDebugModePanel();
}

function updateDebugModePanel() {
  const panel = document.getElementById('debugModePanel');
  const toggle = document.getElementById('debugModeToggle');
  const status = document.getElementById('debugModeStatus');
  if (!panel || !isFullAccessUser()) return;
  if (toggle) { toggle.textContent = debugModeEnabled ? 'Disable debug mode' : 'Enable debug mode'; toggle.className = `action-btn ${debugModeEnabled ? 'btn-red' : 'btn-blue'}`; }
  if (status) status.textContent = debugModeEnabled ? `Debug mode is on. ${debugEvents.length} safe technical event${debugEvents.length === 1 ? '' : 's'} captured this session.` : 'Debug mode is off. Turn it on only while diagnosing a problem.';
}

function toggleDebugMode() {
  if (!isFullAccessUser()) return alert('Debug mode is available to administrators only.');
  debugModeEnabled = !debugModeEnabled;
  localStorage.setItem('lf_admin_debug_mode', String(debugModeEnabled));
  updateDebugModePanel();
}

async function openDebugReport() {
  if (!isFullAccessUser()) return;
  try {
    const [diagnosticsResponse, errorsResponse] = await Promise.all([fetch('/api/system-diagnostics'), fetch('/api/system-errors')]);
    latestServerDiagnostics = diagnosticsResponse.ok ? await diagnosticsResponse.json() : null;
    latestServerErrors = errorsResponse.ok ? await errorsResponse.json() : [];
  } catch (error) {
    captureDebugEvent({ category: 'System doctor', code: 'DIAGNOSTICS_UNAVAILABLE', message: error.message });
  }
  const report = debugEvents.length ? debugEvents.map(event => `<div class="item-row"><strong>${escapeWorkspaceText(event.code)}</strong><p style="margin-top:4px;">${escapeWorkspaceText(event.message)}</p><span class="meta">${escapeWorkspaceText(event.category)} · ${escapeWorkspaceText(event.source)}${event.line ? ` · Line ${event.line}${event.column ? `, column ${event.column}` : ''}` : ''}<br>${new Date(event.timestamp).toLocaleString()}</span></div>`).join('') : '<p class="meta">No debug events have been captured in this session.</p>';
  const serverSummary = latestServerDiagnostics ? `<div class="workspace-card" style="margin-bottom:12px;"><h3>Live system doctor</h3><p><strong>Status:</strong> ${escapeWorkspaceText(latestServerDiagnostics.status)} · <strong>Database:</strong> ${escapeWorkspaceText(latestServerDiagnostics.persistence)} · <strong>Open server errors:</strong> ${Number(latestServerDiagnostics.records?.openErrors || 0)}</p><p class="meta">Learners ${Number(latestServerDiagnostics.records?.learners || 0)} · Accounts ${Number(latestServerDiagnostics.records?.accounts || 0)} · Attendance ${Number(latestServerDiagnostics.records?.attendance || 0)} · Payments ${Number(latestServerDiagnostics.records?.payments || 0)}<br>Generated ${new Date(latestServerDiagnostics.generatedAt).toLocaleString()}</p></div>` : '<p class="meta">Live server diagnostics are temporarily unavailable.</p>';
  const serverErrors = latestServerErrors.length ? latestServerErrors.slice(0, 25).map(event => `<div class="item-row"><strong>${escapeWorkspaceText(event.name)} · ${escapeWorkspaceText(event.status)}</strong><p style="margin-top:4px;">${escapeWorkspaceText(event.message)}</p><span class="meta">${escapeWorkspaceText(event.method)} ${escapeWorkspaceText(event.route)} · Request ${escapeWorkspaceText(event.requestId || event.id)}<br>${new Date(event.createdAt).toLocaleString()}</span></div>`).join('') : '<p class="meta">No server errors have been recorded.</p>';
  openModal('Administrator debug report', `<p style="margin:0 0 12px;color:var(--text-muted);">This report contains safe technical context only. Do not add learner data or passwords to support requests.</p>${serverSummary}<h3>Server error history</h3>${serverErrors}<h3 style="margin-top:16px;">This browser session</h3>${report}`);
}

async function downloadDebugReport() {
  if (!isFullAccessUser()) return;
  if (!latestServerDiagnostics) {
    try {
      const [diagnosticsResponse, errorsResponse] = await Promise.all([fetch('/api/system-diagnostics'), fetch('/api/system-errors')]);
      latestServerDiagnostics = diagnosticsResponse.ok ? await diagnosticsResponse.json() : null;
      latestServerErrors = errorsResponse.ok ? await errorsResponse.json() : [];
    } catch { /* The downloadable report still includes browser diagnostics. */ }
  }
  const content = JSON.stringify({ generatedAt: new Date().toISOString(), server: latestServerDiagnostics, serverErrors: latestServerErrors, browserEvents: debugEvents }, null, 2);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  link.download = `LittleFeet_Debug_Report_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function clearDebugReport() {
  if (!isFullAccessUser() || !confirm('Clear this session’s debug report?')) return;
  debugEvents = [];
  sessionStorage.removeItem('lf_debug_events');
  updateDebugModePanel();
}

function canUseInspectDashboard() {
  return Boolean(currentUser && (isFullAccessUser(currentUser) || currentUser.role === 'staff'));
}

function inspectFilterParams() {
  const params = new URLSearchParams({ limit: '500' });
  const fields = [
    ['severity', 'inspectFilterSeverity'],
    ['status', 'inspectFilterStatus'],
    ['method', 'inspectFilterMethod'],
    ['user', 'inspectFilterUser'],
    ['event', 'inspectFilterEvent'],
    ['requestId', 'inspectFilterRequestId'],
    ['search', 'inspectFilterSearch']
  ];
  fields.forEach(([key, id]) => {
    const value = String(document.getElementById(id)?.value || '').trim();
    if (value) params.set(key, value);
  });
  return params;
}

function inspectDateTime(value) {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? 'Unknown time' : parsed.toLocaleString();
}

function inspectSeverityBadge(severity) {
  const level = String(severity || 'info').toLowerCase();
  if (level === 'error') return '<span class="badge-tag urgent">ERROR</span>';
  if (level === 'warn') return '<span class="badge-tag urgent">WARN</span>';
  if (level === 'debug') return '<span class="badge-tag">DEBUG</span>';
  return '<span class="badge-tag info">INFO</span>';
}

function renderInspectDashboard() {
  const payload = inspectStructuredLogPayload || { summary: {}, logs: [] };
  const summary = payload.summary || {};
  const faults = Array.isArray(inspectServerFaults) ? inspectServerFaults : [];
  const diagnostics = inspectDiagnostics;
  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = String(value ?? '—');
  };

  setText('inspectRuntimeStatus', diagnostics?.status ? String(diagnostics.status).replaceAll('-', ' ').toUpperCase() : 'UNAVAILABLE');
  setText('inspectRequestCount', summary.last15Minutes ?? 0);
  setText('inspectErrorCount', summary.errors ?? 0);
  setText('inspectWarningCount', summary.warnings ?? 0);
  setText('inspectSlowCount', summary.slowRequests ?? 0);
  setText('inspectOpenFaultCount', faults.filter(fault => fault.status === 'open').length);
  setText('inspectGeneratedAt', payload.generatedAt ? `Updated ${inspectDateTime(payload.generatedAt)}` : 'Not loaded');

  const diagnosticsSummary = document.getElementById('inspectDiagnosticsSummary');
  if (diagnosticsSummary) {
    if (!diagnostics) {
      diagnosticsSummary.textContent = 'Live server diagnostics are unavailable.';
    } else {
      diagnosticsSummary.innerHTML = [
        `<strong>Persistence:</strong> ${escapeWorkspaceText(diagnostics.persistence || 'unknown')}`,
        `<strong>Active requests:</strong> ${Number(diagnostics.activeRequests || 0)}`,
        `<strong>Accounts:</strong> ${Number(diagnostics.records?.accounts || 0)}`,
        `<strong>Learners:</strong> ${Number(diagnostics.records?.learners || 0)}`,
        `<strong>Attendance:</strong> ${Number(diagnostics.records?.attendance || 0)}`,
        `<strong>Payments:</strong> ${Number(diagnostics.records?.payments || 0)}`,
        `<strong>Open faults:</strong> ${Number(diagnostics.records?.openErrors || 0)}`,
        `<strong>Logger capacity:</strong> ${Number(summary.maxEntries || 0)} · slow ≥ ${Number(summary.slowRequestMs || 0)} ms`
      ].join(' &nbsp;·&nbsp; ');
    }
  }

  const logs = Array.isArray(payload.logs) ? payload.logs : [];
  setText('inspectLogCount', `${logs.length} shown · ${Number(summary.captured || 0)} captured in this runtime`);
  const logRows = document.getElementById('inspectLogRows');
  if (logRows) {
    logRows.innerHTML = logs.length ? logs.map(entry => {
      const requestId = String(entry.requestId || '');
      const encodedRequestId = encodeInlineIdentifier(requestId);
      const userContext = entry.user
        ? `<strong>${escapeWorkspaceText(entry.user)}</strong><br><span class="meta">${escapeWorkspaceText(entry.role || 'account')}${entry.schoolName ? ` · ${escapeWorkspaceText(entry.schoolName)}` : ''}</span>`
        : '<span class="meta">System / unauthenticated</span>';
      const sourceLocation = entry.source ? `${entry.source}${entry.line ? `:${entry.line}${entry.column ? `:${entry.column}` : ''}` : ''}` : '';
      const eventDetail = [entry.code, entry.message, entry.details, sourceLocation].filter(Boolean).map(escapeWorkspaceText).join(' · ');
      return `<tr>
        <td data-label="Time">${escapeWorkspaceText(inspectDateTime(entry.timestamp))}</td>
        <td data-label="Severity">${inspectSeverityBadge(entry.severity)}</td>
        <td data-label="Event"><strong>${escapeWorkspaceText(entry.event || 'event')}</strong>${eventDetail ? `<br><span class="meta">${eventDetail}</span>` : ''}</td>
        <td data-label="User / school">${userContext}</td>
        <td data-label="Request"><strong>${escapeWorkspaceText(entry.method || '—')}</strong> ${escapeWorkspaceText(entry.route || '—')}</td>
        <td data-label="Status">${entry.status ? escapeWorkspaceText(entry.status) : '—'}</td>
        <td data-label="Duration">${entry.durationMs === null || entry.durationMs === undefined ? '—' : `${Number(entry.durationMs).toFixed(1)} ms`}</td>
        <td data-label="Result">${escapeWorkspaceText(entry.result || '—')}</td>
        <td data-label="Trace">${requestId ? `<button type="button" class="action-btn btn-blue inspect-trace-button" onclick="inspectTraceRequest('${encodedRequestId}')">Trace</button><span class="inspect-trace-id">${escapeWorkspaceText(requestId.slice(0, 12))}…</span>` : '<span class="meta">No request ID</span>'}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="9">No structured log entries match these filters.</td></tr>';
  }

  const faultRows = document.getElementById('inspectFaultRows');
  if (faultRows) {
    faultRows.innerHTML = faults.length ? faults.slice(0, 100).map(fault => {
      const encodedId = encodeInlineIdentifier(fault.id);
      const encodedRequestId = encodeInlineIdentifier(fault.requestId || '');
      const actions = fault.status === 'resolved'
        ? '<span class="badge-tag info">RESOLVED</span>'
        : `<button type="button" class="action-btn btn-blue" onclick="updateSystemErrorStatus('${encodedId}','acknowledged')">Acknowledge</button><button type="button" class="action-btn btn-green" onclick="updateSystemErrorStatus('${encodedId}','resolved')">Resolve</button>`;
      return `<div class="item-row"><div><strong>${escapeWorkspaceText(fault.name || 'Error')} · ${escapeWorkspaceText(fault.status || 'open')}</strong><p style="margin-top:4px;">${escapeWorkspaceText(fault.message || 'No message')}</p><span class="meta">${escapeWorkspaceText(fault.method || 'SYSTEM')} ${escapeWorkspaceText(fault.route || '')} · ${escapeWorkspaceText(inspectDateTime(fault.createdAt))}${fault.source ? ` · ${escapeWorkspaceText(fault.source)}${fault.line ? `:${Number(fault.line)}${fault.column ? `:${Number(fault.column)}` : ''}` : ''}` : ''}${fault.updatedBy ? ` · updated by ${escapeWorkspaceText(fault.updatedBy)}` : ''}</span></div><div style="display:flex;gap:7px;flex-wrap:wrap;">${fault.requestId ? `<button type="button" class="action-btn btn-blue inspect-trace-button" onclick="inspectTraceRequest('${encodedRequestId}')">Trace request</button>` : ''}${actions}</div></div>`;
    }).join('') : '<p class="meta">No persistent server faults have been recorded.</p>';
  }
}

async function loadInspectDashboard({ silent = false, automatic = false } = {}) {
  if (!canUseInspectDashboard() || !document.getElementById('inspectTab')) return false;
  if (automatic && document.hidden) return false;
  if (inspectRefreshPromise) return inspectRefreshPromise;

  const refreshJob = (async () => {
    if (automatic && !await ensureAuthenticatedSession()) return false;
    const expectedUsername = currentUser?.username || '';
    const statusNode = document.getElementById('inspectGeneratedAt');
    if (!silent && statusNode) statusNode.textContent = 'Refreshing…';
    try {
      const [logsResponse, diagnosticsResponse, errorsResponse] = await Promise.all([
        fetch(`/api/system-logs?${inspectFilterParams().toString()}`),
        fetch('/api/system-diagnostics'),
        fetch('/api/system-errors')
      ]);
      const [logsPayload, diagnosticsPayload, errorsPayload] = await Promise.all([
        logsResponse.json().catch(() => ({})),
        diagnosticsResponse.json().catch(() => ({})),
        errorsResponse.json().catch(() => [])
      ]);
      if (!logsResponse.ok) throw new Error(logsPayload.message || 'Unable to load structured logs.');
      if (!diagnosticsResponse.ok) throw new Error(diagnosticsPayload.message || 'Unable to load diagnostics.');
      if (!errorsResponse.ok) throw new Error(errorsPayload?.message || 'Unable to load persistent faults.');
      if (!currentUser || currentUser.username !== expectedUsername) return false;
      inspectStructuredLogPayload = logsPayload;
      inspectDiagnostics = diagnosticsPayload;
      inspectServerFaults = Array.isArray(errorsPayload) ? errorsPayload : [];
      latestServerDiagnostics = inspectDiagnostics;
      latestServerErrors = inspectServerFaults;
      renderInspectDashboard();
      return true;
    } catch (error) {
      if (statusNode) statusNode.textContent = 'Refresh failed';
      const rows = document.getElementById('inspectLogRows');
      if (rows) rows.innerHTML = `<tr><td colspan="9">${escapeWorkspaceText(safeUserFacingError(error, 'Unable to load the logging dashboard.'))}</td></tr>`;
      return false;
    }
  })();

  inspectRefreshPromise = refreshJob;
  try {
    return await refreshJob;
  } finally {
    if (inspectRefreshPromise === refreshJob) inspectRefreshPromise = null;
  }
}

function clearInspectFilters() {
  ['inspectFilterSeverity','inspectFilterStatus','inspectFilterMethod','inspectFilterUser','inspectFilterEvent','inspectFilterRequestId','inspectFilterSearch'].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = '';
  });
  loadInspectDashboard();
}

function toggleInspectAutoRefresh() {
  const button = document.getElementById('inspectAutoRefreshToggle');
  if (inspectAutoRefreshTimer) {
    window.clearInterval(inspectAutoRefreshTimer);
    inspectAutoRefreshTimer = null;
    if (button) button.textContent = 'Auto-refresh: Off';
    return;
  }
  inspectAutoRefreshTimer = window.setInterval(() => {
    if (!currentUser || document.hidden || !document.getElementById('inspectTab')?.classList.contains('active') || inspectRefreshPromise) return;
    void loadInspectDashboard({ silent: true, automatic: true });
  }, INSPECT_AUTO_REFRESH_MS);
  if (button) button.textContent = 'Auto-refresh: 60s';
  void loadInspectDashboard({ silent: true, automatic: true });
}

async function inspectTraceRequest(encodedRequestId) {
  if (!canUseInspectDashboard()) return;
  const requestId = decodeURIComponent(encodedRequestId || '');
  if (!requestId) return;
  try {
    const response = await fetch(`/api/system-logs/trace/${encodeURIComponent(requestId)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to trace this request.');
    const logs = Array.isArray(data.logs) ? data.logs : [];
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const timeline = logs.length ? logs.slice().reverse().map(entry => `<div class="item-row"><div><strong>${escapeWorkspaceText(entry.event)} · ${escapeWorkspaceText(entry.severity)}</strong><p style="margin-top:4px;">${escapeWorkspaceText(entry.method || '')} ${escapeWorkspaceText(entry.route || '')}${entry.status ? ` · HTTP ${escapeWorkspaceText(entry.status)}` : ''}${entry.durationMs !== null && entry.durationMs !== undefined ? ` · ${Number(entry.durationMs).toFixed(1)} ms` : ''}</p><span class="meta">${escapeWorkspaceText(entry.message || entry.details || entry.result || '')}<br>${escapeWorkspaceText(inspectDateTime(entry.timestamp))}</span></div></div>`).join('') : '<p class="meta">No runtime log entries were found.</p>';
    const faultHistory = errors.length ? errors.map(error => `<div class="item-row"><div><strong>${escapeWorkspaceText(error.name)} · ${escapeWorkspaceText(error.status)}</strong><p style="margin-top:4px;">${escapeWorkspaceText(error.message)}</p><span class="meta">${escapeWorkspaceText(inspectDateTime(error.createdAt))}</span></div></div>`).join('') : '<p class="meta">No persistent fault is attached to this request.</p>';
    openModal('Request trace', `<p class="meta" style="word-break:break-all;">Request ID: <strong>${escapeWorkspaceText(requestId)}</strong></p><h3>Timeline</h3>${timeline}<h3 style="margin-top:16px;">Persistent faults</h3>${faultHistory}`);
  } catch (error) {
    alert(safeUserFacingError(error, 'Unable to trace this request.'));
  }
}

function renderInspectSelfTest() {
  const status = document.getElementById('inspectSelfTestStatus');
  const summary = document.getElementById('inspectSelfTestSummary');
  const findings = document.getElementById('inspectSelfTestFindings');
  const result = inspectSelfTestResult;
  if (!status || !summary || !findings) return;
  if (!result) {
    status.textContent = 'Not run';
    summary.textContent = 'Press “Run full site test” to inspect the current deployment.';
    findings.innerHTML = '';
    return;
  }
  status.textContent = `${String(result.status || 'unknown').toUpperCase()} · ${Number(result.durationMs || 0)} ms · ${inspectDateTime(result.completedAt)}`;
  summary.innerHTML = `<strong>${Number(result.summary?.checks || 0)} checks</strong> · ${Number(result.summary?.passed || 0)} passed · ${Number(result.summary?.attention || 0)} attention · ${Number(result.summary?.failed || 0)} failed · ${Number(result.summary?.errors || 0)} error finding(s) · ${Number(result.summary?.warnings || 0)} warning finding(s)`;
  const rows = Array.isArray(result.findings) ? result.findings : [];
  findings.innerHTML = rows.length ? rows.map(finding => {
    const location = finding.source ? `${finding.source}${finding.line ? `:${finding.line}${finding.column ? `:${finding.column}` : ''}` : ''}` : 'Runtime / no source line';
    return `<div class="item-row"><div><strong>${escapeWorkspaceText(String(finding.severity || '').toUpperCase())} · ${escapeWorkspaceText(finding.issue || 'Finding')}</strong><p style="margin-top:5px;"><strong>Why:</strong> ${escapeWorkspaceText(finding.why || 'No additional explanation was produced.')}</p><span class="meta">${escapeWorkspaceText(finding.category || 'diagnostic')} · ${escapeWorkspaceText(finding.check || '')}<br><strong>Location:</strong> ${escapeWorkspaceText(location)}${finding.recommendation ? `<br><strong>Next:</strong> ${escapeWorkspaceText(finding.recommendation)}` : ''}</span></div></div>`;
  }).join('') : '<div class="record-empty-state"><span><strong>No faults or threat indicators found by this run.</strong><span>The deployed checks completed without producing any findings.</span></span></div>';
}

async function runInspectSiteTest() {
  if (!canUseInspectDashboard()) return;
  const button = document.getElementById('inspectRunSiteTestButton');
  const status = document.getElementById('inspectSelfTestStatus');
  if (button) {
    button.disabled = true;
    button.textContent = 'Running real checks…';
  }
  if (status) status.textContent = 'Running…';
  try {
    const response = await fetch('/api/system-self-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'The site test could not complete.');
    inspectSelfTestResult = result;
    renderInspectSelfTest();
    await loadInspectDashboard({ silent: true });
  } catch (error) {
    inspectSelfTestResult = null;
    if (status) status.textContent = 'Test failed to run';
    const findings = document.getElementById('inspectSelfTestFindings');
    if (findings) findings.innerHTML = `<div class="item-row"><strong>Site test could not complete</strong><p>${escapeWorkspaceText(safeUserFacingError(error, 'The automated site test could not complete.'))}</p></div>`;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Run full site test';
    }
  }
}

async function clearInspectHistory() {
  if (!canUseInspectDashboard()) return;
  const confirmed = confirm('Clear Inspect diagnostic history? This removes structured logs, persistent fault history, and this browser session’s debug events. Learner, finance, ticket, import, security/audit, and other business records are not deleted.');
  if (!confirmed) return;

  const button = document.getElementById('inspectClearHistoryButton');
  if (button) {
    button.disabled = true;
    button.textContent = 'Clearing…';
  }
  try {
    const response = await fetch('/api/system-inspect-history', { method: 'DELETE' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Unable to clear Inspect history.');

    debugEvents = [];
    sessionStorage.removeItem('lf_debug_events');
    sessionStorage.removeItem('lf_pending_support_error');
    [...Array(sessionStorage.length).keys()]
      .map(index => sessionStorage.key(index))
      .filter(key => key && key.startsWith('lf_error_'))
      .forEach(key => sessionStorage.removeItem(key));
    latestServerErrors = [];
    inspectStructuredLogPayload = null;
    inspectServerFaults = [];
    inspectDiagnostics = null;
    inspectSelfTestResult = null;
    renderInspectSelfTest();
    updateDebugModePanel();
    await loadInspectDashboard({ silent: true });
    alert(`Inspect history cleared. Removed ${Number(result.removedPersistentFaults || 0)} persistent fault(s) and ${Number(result.removedRuntimeLogs || 0)} structured log entr${Number(result.removedRuntimeLogs || 0) === 1 ? 'y' : 'ies'}. New events will start from this clean slate.`);
  } catch (error) {
    alert(safeUserFacingError(error, 'Unable to clear Inspect history.'));
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Clear Inspect history';
    }
  }
}

async function downloadInspectReport() {
  if (!canUseInspectDashboard()) return;
  if (!inspectStructuredLogPayload || !inspectDiagnostics) await loadInspectDashboard({ silent: true });
  const report = {
    generatedAt: new Date().toISOString(),
    diagnostics: inspectDiagnostics,
    structuredLogs: inspectStructuredLogPayload,
    persistentFaults: inspectServerFaults,
    siteSelfTest: inspectSelfTestResult,
    browserDebugEvents: debugEvents
  };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  link.download = `LittleFeet_Inspect_Report_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
