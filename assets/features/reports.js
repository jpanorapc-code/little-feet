// reports workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function loadReportReviews() {
  const list = document.getElementById('reportReviewList');
  if (!list || !currentUser) return;
  const parentSigner = document.getElementById('parentReportSigner');
  if (parentSigner) parentSigner.classList.toggle('hidden', currentUser.role !== 'parent');
  try {
    const response = await fetch(`/api/report-reviews?username=${encodeURIComponent(currentUser.username)}`);
    const reports = await response.json();
    const grouped = reports.reduce((groups, report) => {
      const month = report.period || new Date(report.createdAt).toLocaleString(undefined, { month: 'long', year: 'numeric' });
      (groups[month] ||= []).push(report); return groups;
    }, {});
    window.reportReviewCache = Object.fromEntries(reports.map(report => [report.id, report]));
    list.innerHTML = Object.keys(grouped).length ? Object.entries(grouped).map(([month, entries]) => `<h3 class="workspace-heading">${escapeWorkspaceText(month)}</h3>${entries.map(report => `<div class="item-row"><div><strong>${escapeWorkspaceText(report.studentName)} · ${escapeWorkspaceText(report.reportTitle)}</strong><p style="margin-top:4px;">${escapeWorkspaceText(report.period)} · <span class="badge-tag ${report.status.startsWith('Complete') ? 'info' : 'urgent'}">${escapeWorkspaceText(report.status)}</span></p><span class="meta">Teacher signed: ${new Date(report.teacherSignedAt).toLocaleString()}${report.parentSignedAt ? ` · Parent signed: ${new Date(report.parentSignedAt).toLocaleString()}` : ''}</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button type="button" class="action-btn btn-blue" onclick="viewParentReport('${report.id}')">View report</button>${currentUser.role === 'parent' && !report.parentSignature ? `<button type="button" class="action-btn btn-green" onclick="signParentReport('${report.id}')">Sign report</button>` : ''}</div></div>`).join('')}`).join('') : '<p class="meta">No reports are available for this account.</p>';
  } catch { list.textContent = 'Unable to load report reviews.'; }
}

function viewParentReport(id) {
  const report = window.reportReviewCache?.[id];
  if (!report) return alert('The report is no longer available. Refresh and try again.');
  const safe = escapeWorkspaceText;
  const teacherSignature = typeof report.teacherSignature === 'string' && report.teacherSignature.startsWith('data:image/')
    ? `<img src="${report.teacherSignature}" alt="Teacher signature" style="width:100%;max-width:500px;border:1px solid var(--border-color);border-radius:8px;background:#fff;">`
    : '<p class="meta">Teacher signature unavailable.</p>';
  const parentSignature = typeof report.parentSignature === 'string' && report.parentSignature.startsWith('data:image/')
    ? `<img src="${report.parentSignature}" alt="Parent signature" style="width:100%;max-width:500px;border:1px solid var(--border-color);border-radius:8px;background:#fff;">`
    : '<p class="meta">Awaiting parent signature.</p>';
  openModal(`Report: ${safe(report.reportTitle)}`, `<div style="display:grid;gap:14px;line-height:1.55;"><div><strong>Learner:</strong> ${safe(report.studentName)}<br><strong>Period:</strong> ${safe(report.period)}<br><strong>Status:</strong> ${safe(report.status)}</div><div><strong>Teacher acknowledgement</strong><br><span class="meta">Signed ${new Date(report.teacherSignedAt).toLocaleString()}</span>${teacherSignature}</div><div><strong>Parent acknowledgement</strong><br><span class="meta">${report.parentSignedAt ? `Signed ${new Date(report.parentSignedAt).toLocaleString()}` : 'Use the parent signature panel to complete this report.'}</span>${parentSignature}</div></div>`);
}

async function signParentReport(id) {
  const signature = reportSignaturePads.parentSignaturePad;
  const pin = document.getElementById('parentReportPin')?.value;
  if (!signature?.hasStroke()) return alert('Add the parent signature first.');
  if (!pin) return alert('Enter your signing PIN.');
  const response = await fetch(`/api/report-reviews/${id}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser?.username, signingPin: pin, signatureData: signature.canvas.toDataURL('image/png') }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to sign report.');
  document.getElementById('parentReportPin').value = ''; clearSignature('parentSignaturePad'); loadReportReviews(); playDingSound();
}

function showProviderSetup(providerName) {
  openModal(`${providerName} connection required`, `<div style="font-size:.9rem;line-height:1.6;"><p>This feature needs an approved school-owned ${providerName} account before it can operate.</p><p style="margin-top:10px;"><strong>Next steps:</strong></p><ol style="margin:6px 0 0 20px;"><li>Choose and contract an approved provider.</li><li>Obtain the provider credentials and consent documentation.</li><li>Ask an administrator to configure the connection securely.</li></ol><p style="margin-top:10px;color:var(--text-muted);">No payment, payroll, SMS, or push messages are sent until a provider is connected.</p></div>`);
}
