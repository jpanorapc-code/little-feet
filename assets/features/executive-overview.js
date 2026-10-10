// executive-overview workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function showExecutiveChartDetail(event) {
  const item = event.currentTarget;
  const detail = item?.closest('[data-executive-chart]')?.querySelector('.executive-chart-detail');
  if (detail && item.dataset.chartDetail) detail.textContent = item.dataset.chartDetail;
}

function executiveChartMarkup({ title, description, items = [], format = 'integer', workspaceId, actionLabel, centerLabel = 'Total' }) {
  const safeItems = (Array.isArray(items) ? items : [])
    .map(item => ({ label: String(item?.label || ''), value: Number(item?.value || 0) }))
    .filter(item => item.label && Number.isFinite(item.value) && item.value > 0);
  const total = safeItems.reduce((sum, item) => sum + item.value, 0);
  const formatter = format === 'currency'
    ? value => new Intl.NumberFormat('en-ZA', { style:'currency', currency:'ZAR', minimumFractionDigits:2, maximumFractionDigits:2 }).format(value)
    : formatExecutiveInteger;
  if (!total) {
    return `<article class="executive-chart-card" data-executive-chart="${escapeWorkspaceText(title)}">
      <h3>${escapeWorkspaceText(title)}</h3>
      <p>${escapeWorkspaceText(description)}</p>
      <div class="executive-chart-empty">No live records to chart yet.</div>
      <button type="button" class="action-btn btn-blue executive-chart-link" onclick="openWorkspace('${workspaceId}')">${escapeWorkspaceText(actionLabel)}</button>
    </article>`;
  }
  let cursor = 0;
  const chartKey = `executive-ring-${++executiveChartSequence}`;
  const gradients = safeItems.map((item, index) => `<linearGradient id="${chartKey}-${index}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e7fcff"/><stop offset=".3" stop-color="${EXECUTIVE_CHART_COLORS[index % EXECUTIVE_CHART_COLORS.length]}"/><stop offset="1" stop-color="${EXECUTIVE_CHART_COLORS[index % EXECUTIVE_CHART_COLORS.length]}" stop-opacity=".7"/></linearGradient>`).join('');
  const percentFormatter = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 1 });
  const share = item => item.value / total * 100 < .1 ? '<0.1' : percentFormatter.format(item.value / total * 100);
  const itemDetail = item => `${item.label}: ${formatter(item.value)} · ${share(item)}% of total`;
  const segments = safeItems.map((item, index) => {
    const start = (cursor / total) * 100;
    cursor += item.value;
    const end = (cursor / total) * 100;
    const amount = end - start;
    const arc = safeItems.length > 1 ? Math.max(amount - .8, amount * .85) : amount;
    const angle = (start + amount / 2) / 100 * Math.PI * 2;
    const label = amount >= 8 ? `<text x="${60 + Math.sin(angle) * 48}" y="${60 - Math.cos(angle) * 48}" class="executive-slice-label" aria-hidden="true">${percentFormatter.format(amount)}%</text>` : '';
    return `<circle cx="60" cy="60" r="48" pathLength="100" fill="none" stroke="url(#${chartKey}-${index})" stroke-width="18" stroke-dasharray="${arc} ${100 - arc}" stroke-dashoffset="${-start}" transform="rotate(-90 60 60)" tabindex="0" role="img" aria-label="${escapeWorkspaceText(itemDetail(item))}" data-chart-detail="${escapeWorkspaceText(itemDetail(item))}" onpointerenter="showExecutiveChartDetail(event)" onfocus="showExecutiveChartDetail(event)" onclick="showExecutiveChartDetail(event)"><title>${escapeWorkspaceText(itemDetail(item))}</title></circle>${label}`;
  }).join('');
  const centerValue = format === 'currency' ? formatExecutiveCompactCurrency(total) : formatExecutiveInteger(total);
  const legend = safeItems.map((item, index) => `<button type="button" class="executive-legend-row" data-chart-detail="${escapeWorkspaceText(itemDetail(item))}" aria-label="${escapeWorkspaceText(itemDetail(item))}" onpointerenter="showExecutiveChartDetail(event)" onfocus="showExecutiveChartDetail(event)" onclick="showExecutiveChartDetail(event)">
    <span class="executive-legend-swatch" style="background:${EXECUTIVE_CHART_COLORS[index % EXECUTIVE_CHART_COLORS.length]};"></span>
    <span>${escapeWorkspaceText(item.label)}<small>${escapeWorkspaceText(share(item))}% of total</small></span>
    <strong>${escapeWorkspaceText(formatter(item.value))}</strong>
  </button>`).join('');
  return `<article class="executive-chart-card" data-executive-chart="${escapeWorkspaceText(title)}">
    <h3>${escapeWorkspaceText(title)}</h3>
    <p>${escapeWorkspaceText(description)}</p>
    <div class="executive-chart-body">
      <div class="executive-pie" role="group" aria-label="${escapeWorkspaceText(title)} total ${escapeWorkspaceText(formatter(total))}">
        <svg class="executive-pie-segments" viewBox="0 0 120 120" aria-label="Category breakdown"><defs>${gradients}</defs><circle cx="60" cy="60" r="48" fill="none" stroke="rgba(148,183,216,.18)" stroke-width="18"/>${segments}</svg>
        <span class="executive-pie-center"><strong>${escapeWorkspaceText(centerValue)}</strong><small>${escapeWorkspaceText(centerLabel)}</small></span>
      </div>
      <div class="executive-chart-legend">${legend}</div>
    </div>
    <p class="executive-chart-total">Total: <strong>${escapeWorkspaceText(formatter(total))}</strong></p>
    <p class="executive-chart-detail" aria-live="polite">Hover, focus or tap a category for its breakdown.</p>
    <button type="button" class="action-btn btn-blue executive-chart-link" onclick="openWorkspace('${workspaceId}')">${escapeWorkspaceText(actionLabel)}</button>
  </article>`;
}

function renderExecutiveHomeOverview(payload) {
  const root = document.getElementById('executiveHomeOverview');
  if (!root || currentUser?.role !== 'admin') return;
  const kpis = payload?.kpis || {};
  const charts = payload?.charts || {};
  const reviewCount = (Array.isArray(charts.reviews) ? charts.reviews : []).reduce((sum, item) => sum + Number(item?.value || 0), 0);
  const scopeLabel = payload?.scope === 'platform' ? 'Company-wide live overview' : 'School live overview';
  const generatedAt = payload?.generatedAt ? new Date(payload.generatedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' }) : 'now';
  const reviewRating = Number.isFinite(Number(kpis.averageReviewRating)) ? `${Number(kpis.averageReviewRating).toFixed(2)}/5` : '—';
  const outstanding = formatExecutiveCurrency(kpis.outstandingBalance);
  const arrears = formatExecutiveCurrency(kpis.arrears);
  const openFaults = Number(kpis.openFaults || 0);

  const kpiCards = [
    ['Schools', formatExecutiveInteger(kpis.schools), payload?.scope === 'platform' ? 'Schools with approved accounts' : 'Current school scope'],
    ['Learners', formatExecutiveInteger(kpis.learners), 'Live learner records'],
    ['Accounts', formatExecutiveInteger(kpis.accounts), 'Visible active accounts'],
    ['Needs attention', formatExecutiveInteger(kpis.openAttention), 'High-level work queues'],
    ['Outstanding', outstanding, Number(kpis.arrears || 0) > 0 ? `${arrears} currently in arrears` : 'No current arrears'],
    ['Avg review', reviewRating, reviewCount ? `${formatExecutiveInteger(reviewCount)} performance review records` : 'No review records yet']
  ];

  root.innerHTML = `<div class="executive-overview-header">
    <div>
      <h2>Executive overview</h2>
      <span class="meta">${escapeWorkspaceText(scopeLabel)} · updated ${escapeWorkspaceText(generatedAt)} · open system faults: ${formatExecutiveInteger(openFaults)}</span>
    </div>
    <button type="button" class="action-btn btn-blue" onclick="loadExecutiveHomeOverview()">Refresh overview</button>
  </div>
  <div class="executive-kpi-grid">
    ${kpiCards.map(([label, value, detail]) => `<div class="executive-kpi"><span>${escapeWorkspaceText(label)}</span><strong>${escapeWorkspaceText(value)}</strong><small>${escapeWorkspaceText(detail)}</small></div>`).join('')}
  </div>
  <div class="executive-chart-grid">
    ${executiveChartMarkup({ title:'Account mix', description:'User accounts by role — not the number of schools.', items:charts.accounts, workspaceId:'accountsTab', actionLabel:'Open accounts', centerLabel:'Accounts' })}
    ${executiveChartMarkup({ title:'Operational attention', description:'Current work that still needs action, without duplicating My Day.', items:charts.attention, workspaceId:'myDayTab', actionLabel:'Open My Day' })}
    ${executiveChartMarkup({ title:'Fee collection', description:'Collected versus outstanding parent-fee value.', items:charts.finance, format:'currency', workspaceId:'parentPaymentsTab', actionLabel:'Open parent payments' })}
    ${executiveChartMarkup({ title:'Performance reviews', description:'Current review workflow status across staff records.', items:charts.reviews, workspaceId:'staffWorkTab', actionLabel:'Open staff work' })}
  </div>`;
  root.classList.remove('hidden');

  const setupCard = document.getElementById('schoolSetupCard');
  if (setupCard) {
    const shouldHideSetup = currentUser.platformAccess === true || payload?.setup?.complete === true || payload?.setup?.show === false;
    setupCard.classList.toggle('hidden', shouldHideSetup);
  }
}

async function loadExecutiveHomeOverview({ silent = false } = {}) {
  const root = document.getElementById('executiveHomeOverview');
  if (!root) return false;
  if (!currentUser || currentUser.role !== 'admin') {
    root.classList.add('hidden');
    return false;
  }
  if (executiveHomeOverviewPromise) return executiveHomeOverviewPromise;
  const expectedSession = workspaceSessionKey();
  if (!silent && !root.children.length) {
    root.innerHTML = '<div class="executive-overview-header"><div><h2>Executive overview</h2><span class="meta">Loading live management data…</span></div></div>';
    root.classList.remove('hidden');
  }
  const job = (async () => {
    try {
      const response = await fetch('/api/executive-overview', { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to load the executive overview.');
      if (!currentUser || workspaceSessionKey() !== expectedSession) return false;
      renderExecutiveHomeOverview(payload);
      return true;
    } catch (error) {
      if (!silent && root) {
        root.innerHTML = `<div class="executive-overview-header"><div><h2>Executive overview</h2><span class="meta">${escapeWorkspaceText(safeUserFacingError(error, 'Executive overview is temporarily unavailable.'))}</span></div><button type="button" class="action-btn btn-blue" onclick="loadExecutiveHomeOverview()">Try again</button></div>`;
        root.classList.remove('hidden');
      }
      return false;
    }
  })();
  executiveHomeOverviewPromise = job;
  try {
    return await job;
  } finally {
    if (executiveHomeOverviewPromise === job) executiveHomeOverviewPromise = null;
  }
}
