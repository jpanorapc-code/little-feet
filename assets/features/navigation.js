// navigation workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function setupKeyboardShortcuts() {
  window.addEventListener('keydown', event => {
    if (!currentUser || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key.length === 1) {
      windtLegacyKeyTrail = `${windtLegacyKeyTrail}${key}`.slice(-5);
      if (windtLegacyKeyTrail === 'windt') {
        windtLegacyKeyTrail = '';
        openWindtLegacy();
        return;
      }
    }
    const shortcuts = { h: 'homeTab', t: 'ticketsTab', f: 'feedTab', s: 'scheduleTab', g: 'guideTab' };
    if (shortcuts[key]) { event.preventDefault(); openWorkspace(shortcuts[key]); }
    if (key === '/') { event.preventDefault(); openGlobalSearch(); }
  });
}

function showPortalTourSlide(index) {
  const slides = [...document.querySelectorAll('.portal-tour-slide')];
  const dots = [...document.querySelectorAll('.tour-dots button')];
  if (!slides.length) return;
  portalTourIndex = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => slide.classList.toggle('is-active', slideIndex === portalTourIndex));
  dots.forEach((dot, dotIndex) => dot.classList.toggle('is-active', dotIndex === portalTourIndex));
}

function movePortalTour(direction) {
  showPortalTourSlide(portalTourIndex + direction);
  restartPortalTour();
}

function restartPortalTour() {
  if (portalTourTimer) window.clearInterval(portalTourTimer);
  portalTourTimer = window.setInterval(() => showPortalTourSlide(portalTourIndex + 1), 7500);
}

function setupPortalTour() {
  const tour = document.getElementById('portalTour');
  if (!tour) return;
  restartPortalTour();
  tour.addEventListener('mouseenter', () => { if (portalTourTimer) window.clearInterval(portalTourTimer); });
  tour.addEventListener('mouseleave', restartPortalTour);
  tour.addEventListener('focusin', () => { if (portalTourTimer) window.clearInterval(portalTourTimer); });
  tour.addEventListener('focusout', restartPortalTour);
}

function routeErrorToHelpdesk(error) {
  const redactedCrossOriginError = /^Script error\.?$/i.test(String(error.message || '').trim()) && !error.source;
  const diagnosticMessage = redactedCrossOriginError
    ? 'A cross-origin script failed, but the browser redacted its source. External libraries now load with CORS diagnostics so reproducing the fault should identify the exact file and line.'
    : error.message;
  const safeStack = String(error.stack || '').split('\n').slice(0, 5).join('\n');
  const enrichedError = { ...error, message: diagnosticMessage, originalMessage: redactedCrossOriginError ? error.message : undefined };
  captureDebugEvent({ category: 'Browser runtime', ...enrichedError });
  const details = `${error.code}: ${diagnosticMessage}${error.source ? `\nSource: ${error.source}` : ''}${error.line ? `\nLine: ${error.line}${error.column ? `, column ${error.column}` : ''}` : ''}${safeStack ? `\nStack: ${safeStack}` : ''}`;
  if (currentUser) void reportClientStructuredLog({
    severity: 'error', code: error.code || 'WEB_RUNTIME_ERROR', message: diagnosticMessage,
    source: error.source || '', line: error.line || null, column: error.column || null, page: window.location.pathname
  });
  if (!currentUser || sessionStorage.getItem(`lf_error_${details}`)) return;
  sessionStorage.setItem(`lf_error_${details}`, '1');
  sessionStorage.setItem('lf_pending_support_error', JSON.stringify({ code: error.code, details }));
  document.getElementById('runtimeErrorBanner')?.classList.remove('hidden');
}

function openModal(title, contentHtml) {
  const modal = document.getElementById('appModal');  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = contentHtml;
  document.querySelector('#appModal .modal-card').classList.remove('subscription-modal-card');
  modal.classList.remove('hidden');
  requestAnimationFrame(() => modal.querySelector('.modal-close')?.focus());
}

async function updateSystemErrorStatus(encodedId, status) {
  if (!canUseInspectDashboard()) return;
  const id = decodeURIComponent(encodedId || '');
  if (!id) return;
  try {
    const response = await fetch(`/api/system-errors/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to update this fault.');
    await loadInspectDashboard({ silent: true });
  } catch (error) {
    alert(safeUserFacingError(error, 'Unable to update this fault.'));
  }
}

function closeModal() {
  visitorScannerStream?.getTracks().forEach(track => track.stop());
  visitorScannerStream = null;
  stopWindtLegacyNote();
  document.getElementById('appModal').classList.add('hidden');
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  modalReturnFocus = null;
}

function openGlobalSearch() {
  if (!currentUser) return;
  const buttons = [...document.querySelectorAll('.nav-btn')].filter(button => !button.closest('li')?.classList.contains('hidden'));
  const choices = buttons.map((button, index) => `<option value="${index}">${escapeWorkspaceText(button.textContent.trim())}</option>`).join('');
  openModal('Search workspaces', `<p style="margin:0 0 12px;color:var(--text-muted);">Choose a workspace available to your role.</p><select id="globalWorkspaceSearch">${choices}</select><button type="button" class="submit-btn" style="margin-top:12px;" onclick="openSelectedWorkspace()">Open workspace</button>`);
}

function openSelectedWorkspace() {
  const index = Number(document.getElementById('globalWorkspaceSearch')?.value);
  const buttons = [...document.querySelectorAll('.nav-btn')].filter(button => !button.closest('li')?.classList.contains('hidden'));
  const button = buttons[index];
  if (!button) return;
  closeModal();
  button.click();
}

function renderRoleHomePanel() {
  const panel = document.getElementById('roleHomePanel');
  if (!panel || !currentUser) return;
  const experiences = {
    parent: {
      icon: '👨‍👩‍👧', title: `Welcome back, ${currentUser.name || 'Parent'}`,
      message: 'Keep up with the learning, reports, achievements, and school updates that are available for your linked children.'
    },
    teacher: {
      icon: '🧑‍🏫', title: `Ready for the day, ${currentUser.name || 'Educator'}?`,
      message: 'Start with attendance, record care updates as they happen, and keep your classroom team in sync.'
    },
    principal: {
      icon: '🏫', title: `School overview for ${currentUser.name || 'Principal'}`,
      message: 'Review attendance, finance tasks, reports, and day-to-day operations from the workspaces below.'
    },
    district: {
      icon: '🌍', title: `District workspace`,
      message: 'Use the approved cross-school tools to review progress, find records, and stay informed about safety notices.'
    },
    admin: {
      icon: '🐧', title: currentUser.platformAccess ? `CEO centre for ${currentUser.name || 'Little Feet'}` : `Admin centre for ${currentUser.name || 'your school'}`,
      message: currentUser.platformAccess ? 'Company-wide administrator access is active across Little Feet workspaces and schools.' : 'Keep accounts, learner links, consent, and school data accurate before inviting families and staff.'
    },
    staff: {
      icon: '🐧', title: `Staff Little Feet · ${currentUser.name || 'Team member'}`,
      message: 'Manage your assigned company tasks, leave, training, email and messages.'
    },
    crm: {
      icon: '🤝', title: `CRM Little Feet · ${currentUser.name || 'Little Feet'}`,
      message: 'Help clients set up their school users, manage client follow-ups and assigned tickets, and use your own work tools.'
    },
    accounts: {
      icon: '🧾', title: `Accounts Little Feet · ${currentUser.name || 'Little Feet'}`,
      message: 'Review Little Feet school subscription invoices and record confirmed payments. School and parent finances remain private.'
    },
    school_hr: { icon:'🏫', title:`HR · ${currentUser.name || 'School team'}`, message:'Manage school staff work, leave, qualifications and reviews.' },
    school_staff: { icon:'🏫', title:`${currentUser.schoolPosition || 'School Support'} · ${currentUser.name || 'Team member'}`, message:'Manage your assigned school work, leave, qualifications and communication.' },
    school_accounts: {
      icon: '🧾', title: `Accounts workspace · ${currentUser.name || 'School accounts'}`,
      message: 'Work with the finance and accounting tools for your linked school.'
    },
    support: {
      icon: '🛠️', title: `Support Little Feet · ${currentUser.name || 'Little Feet'}`,
      message: 'Handle support tickets, client messages and software-support communication for Little Feet.'
    }
  };
  const experience = experiences[currentUser.role] || experiences.parent;
  panel.classList.add('mascot-role-home');
  panel.innerHTML = `<div class="role-home-content"><div><span class="portal-welcome-kicker">YOUR LITTLE FEET WORKSPACE</span><h1>${escapeWorkspaceText(experience.title)}</h1><p>${escapeWorkspaceText(experience.message)}</p></div><div class="role-home-icon" aria-hidden="true">${experience.icon}</div></div>`;
  const setupCard = document.getElementById('schoolSetupCard');
  if (setupCard && (currentUser.platformAccess || isInternalCompanyRole(currentUser.role))) setupCard.classList.add('hidden');
}

function syncMobileHeaderOffset() {
  const dashboard = document.getElementById('dashboardSection');
  const header = dashboard?.querySelector('nav');
  if (!dashboard || dashboard.classList.contains('hidden') || !header) return;
  const rect = header.getBoundingClientRect();
  const height = Math.ceil(rect.height);
  if (!Number.isFinite(height) || height < 1) return;
  const value = `${height}px`;
  const visibleHeaderBottom = Math.max(0, Math.min(height, Math.ceil(rect.bottom)));
  document.documentElement.style.setProperty('--mobile-header-height', value);
  document.documentElement.style.setProperty('--portal-header-height', value);
  document.documentElement.style.setProperty('--portal-sidebar-top', `${visibleHeaderBottom}px`);
}

function usesDockedSnappedDesktopSidebar() {
  return window.matchMedia?.('(min-width: 900px) and (max-width: 1199px) and (hover: hover) and (pointer: fine)').matches === true;
}

function syncNavigationViewportState() {
  if (!usesDockedSnappedDesktopSidebar()) return;
  const dashboard = document.getElementById('dashboardSection');
  const toggle = document.getElementById('navMoreToggle');
  dashboard?.classList.remove('sidebar-open');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = '☰ Menu';
  }
}

function observePortalHeaderSize() {
  const header = document.querySelector('#dashboardSection > nav');
  if (!header || typeof ResizeObserver !== 'function') return;
  portalHeaderResizeObserver?.disconnect();
  portalHeaderResizeObserver = new ResizeObserver(() => requestAnimationFrame(syncMobileHeaderOffset));
  portalHeaderResizeObserver.observe(header);
}

function queuePortalHeaderOffsetSync() {
  if (portalHeaderScrollFrame) return;
  portalHeaderScrollFrame = requestAnimationFrame(() => {
    portalHeaderScrollFrame = 0;
    syncMobileHeaderOffset();
    syncNavigationViewportState();
  });
}

function switchTab(tabId, btn) {
  window.saveDashboardDrafts?.();
  window.restoreEducationTools?.(tabId);
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const targetTab = document.getElementById(tabId);
  if (targetTab) {
    targetTab.classList.remove('active');
    // Restart the reveal animation when a user revisits a workspace.
    void targetTab.offsetWidth;
    targetTab.classList.add('active');
  }
  if (btn) btn.classList.add('active');
  closeNavigation();
  loadWorkspaceOnDemand(tabId);
  window.setTimeout(() => window.restoreDashboardDrafts?.(), 80);
}

function openWorkspace(tabId) {
  const navButton = [...document.querySelectorAll('.nav-btn')].find(button => button.getAttribute('onclick')?.includes(`'${tabId}'`));
  if (!navButton || navButton.closest('li')?.classList.contains('hidden')) {    alert('This workspace is not available for your account. Please contact your school administrator if you need access.');
    return;
  }
  switchTab(tabId, navButton);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openGuideWorkspace(tabId) {
  const navButton = [...document.querySelectorAll('.nav-btn')].find(button => button.getAttribute('onclick')?.includes(`'${tabId}'`));
  const targetTab = document.getElementById(tabId);
  if (!navButton || !targetTab || navButton.closest('li')?.classList.contains('hidden')) {
    alert('This workspace is not available for your account. Please contact your school administrator if you need access.');
    return;
  }
  switchTab(tabId, navButton);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleNavigation() {
  const dashboard = document.getElementById('dashboardSection');
  const toggle = document.getElementById('navMoreToggle');
  if (!dashboard || !toggle) return;
  if (usesDockedSnappedDesktopSidebar()) {
    syncNavigationViewportState();
    return;
  }
  const isOpen = dashboard.classList.toggle('sidebar-open');
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.textContent = isOpen ? '✕ Close' : '☰ Menu';
}

function toggleSidebarGroup(button) {
  const group = button?.closest('[data-nav-group]');
  if (!group) return;
  group.classList.toggle('is-collapsed');
  const collapsed = [...document.querySelectorAll('[data-nav-group].is-collapsed')].map(section => section.querySelector('.sidebar-group-toggle')?.textContent.trim()).filter(Boolean);
  localStorage.setItem('lf_collapsed_nav_groups', JSON.stringify(collapsed));
}

function toggleSidebarCollapse() {
  if (window.innerWidth < 960) return;
  const dashboard = document.getElementById('dashboardSection');
  const sidebar = document.getElementById('mainNavigation');
  if (!dashboard || !sidebar) return;
  const collapsed = dashboard.classList.toggle('sidebar-collapsed');
  sidebar.classList.toggle('is-collapsed', collapsed);
  localStorage.setItem('lf_sidebar_collapsed', String(collapsed));
}

function closeNavigation() {
  const dashboard = document.getElementById('dashboardSection');
  const toggle = document.getElementById('navMoreToggle');
  if (!dashboard || !toggle) return;
  dashboard.classList.remove('sidebar-open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = '☰ Menu';
}

function goToMainMenu() {
  if (!currentUser) return alert("Please log in first.");
  openWorkspace('homeTab');
}

async function startHealthMonitor() {
  let consecutiveFailures = 0;
  const configuredBackupUrl = String(window.LITTLE_FEET_BACKUP_URL || '').trim().replace(/\/$/, '');
  const checkStatus = async () => {
    const statusEl = document.getElementById('serverStatus');
    const statusText = document.getElementById('serverStatusText');
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const requestedAt = performance.now();
      const res = await fetch('/api/health', { cache: 'no-store', signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const health = await res.json();
      window.syncLittleFeetClock?.(health.timestamp, performance.now() - requestedAt);
      consecutiveFailures = 0;
      sessionStorage.removeItem('lf_backup_unready_notified');
      if (statusEl && statusText) {
        const busy = health.status === 'BUSY';
        statusEl.className = `server-status ${busy ? 'busy' : 'good'}`;
        statusText.textContent = busy ? 'Server busy' : health.instance === 'STANDBY' ? 'Backup server online' : 'Server online';
      }
      const footerStatus = document.getElementById('footerSystemStatus');
      if (footerStatus) footerStatus.textContent = health.status === 'BUSY' ? 'Server busy — requests may take longer.' : health.instance === 'STANDBY' ? 'Backup server online.' : 'Server online.';
    } catch (e) {
      consecutiveFailures += 1;
      if (statusEl && statusText) {
        statusEl.className = 'server-status';
        statusText.textContent = 'Server offline';
      }
      const footerStatus = document.getElementById('footerSystemStatus');
      if (footerStatus) footerStatus.textContent = 'Server connection unavailable.';
      logAppError('ERR_SRV_503', 'Live server connection lost to API.');
      // Redirect only to a separately deployed standby with a recent replica
      // snapshot and compatible code. An unready standby remains read-only and
      // must not receive users with an empty or stale database.
      if (configuredBackupUrl && consecutiveFailures >= 2 && !sessionStorage.getItem('lf_failover_redirected')) {
        try {
          const backupController = new AbortController();
          const backupTimeout = window.setTimeout(() => backupController.abort(), 5000);
          let backupReadiness;
          try {
            const backupResponse = await fetch(`${configuredBackupUrl}/api/failover-readiness`, {
              cache: 'no-store', mode: 'cors', signal: backupController.signal
            });
            if (backupResponse.ok) backupReadiness = await backupResponse.json();
          } finally {
            window.clearTimeout(backupTimeout);
          }
          if (backupReadiness?.ready === true && backupReadiness.instance === 'STANDBY') {
            sessionStorage.setItem('lf_failover_redirected', '1');
            window.location.replace(configuredBackupUrl);
          } else if (!sessionStorage.getItem('lf_backup_unready_notified')) {
            sessionStorage.setItem('lf_backup_unready_notified', '1');
            footerStatus && (footerStatus.textContent = 'Primary unavailable; backup is not current yet. Please retry shortly.');
          }
        } catch (backupError) {
          if (!sessionStorage.getItem('lf_backup_unready_notified')) {
            sessionStorage.setItem('lf_backup_unready_notified', '1');
            footerStatus && (footerStatus.textContent = 'Primary unavailable; backup could not be reached. Please retry shortly.');
          }
        }
      }
    } finally {
      window.clearTimeout(requestTimeout);
    }
  };

  checkStatus();
  setInterval(() => { if (!document.hidden) checkStatus(); }, 30000);
}

function openAlertsTab() {
  const alertButton = [...document.querySelectorAll('.nav-btn')].find(button =>
    (button.getAttribute('onclick') || '').includes("broadcastsTab")
  );
  switchTab('broadcastsTab', alertButton);
}

function encodeInlineIdentifier(value) {
  return encodeURIComponent(value).replace(/'/g, '%27');
}

function createNewGroupModal() {
  const html = `
    <form id="newGroupForm">
      <div>
        <label for="newGroupNameInput">Group Channel Name <span class="req">*</span></label>
        <input type="text" id="newGroupNameInput" placeholder="e.g. Primary Educators Lounge" required>
      </div>
      <button type="submit" class="submit-btn">Create Group</button>
    </form>`;
  openModal('Create New Chat Group', html);

  document.getElementById('newGroupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const groupName = document.getElementById('newGroupNameInput').value.trim();
    if (!groupName) return;

    await fetch('/api/chat/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName })
    });

    closeModal();
    await loadChatGroups();
    loadGroupChatMessages();
    playDingSound();
  });
}

async function deleteCurrentGroup() {
  const select = document.getElementById('chatGroupSelect');
  if (!select) return;
  const groupId = select.value;
  if (groupId === 'general') return alert('Cannot delete General group.');

  if (!confirm('Are you sure you want to delete this group channel?')) return;

  await fetch(`/api/chat/groups/${encodeURIComponent(groupId)}`, { method: 'DELETE' });
  await loadChatGroups();
  loadGroupChatMessages();
}

async function refreshCurrentUserAccess() {
  const response = await fetch('/api/auth/session');
  const session = await response.json();
  if (!response.ok || !session.authenticated || !session.user) return;
  const previousSubscription = currentUser?.subscription;
  currentUser = session.user;
  if (currentUser.subscription !== previousSubscription) applyRolePermissions(currentUser.role);
}
