let currentUser = null;
let serverSessionValidatedAt = 0;
let sessionValidationPromise = null;
const SESSION_VALIDATION_TTL_MS = 2500;
const LITTLE_FEET_INTERNAL_ROLES = new Set(['staff', 'crm', 'accounts', 'support']);
const isFullAccessUser = (user = currentUser) => Boolean(user && (user.role === 'admin'));
const canManageSchoolAccounts = (user = currentUser) => Boolean(user && (user.role === 'admin' || user.role === 'crm'));
const isInternalCompanyRole = role => LITTLE_FEET_INTERNAL_ROLES.has(String(role || ''));
const isFinanceUser = (user = currentUser) => Boolean(user && (isFullAccessUser(user) || user.role === 'school_accounts'));
const displayRoleName = user => {
  if (!user) return '';
  if (user.role === 'admin' && user.platformAccess) return 'CEO / Administrator Little Feet';
  if (user.schoolPosition && !isInternalCompanyRole(user.role)) return user.schoolPosition;
  return ({ parent:'Parent / Guardian', teacher:'Teacher / Educator', principal:'Principal / Head of School', district:'District / Circuit Official', admin:'School Administrator', school_staff:'School Support Staff', school_hr:'School HR', staff:'Staff Little Feet', crm:'CRM Little Feet', accounts:'Accounts Little Feet', school_accounts:'School Accounts', support:'Support Little Feet' }[user.role] || String(user.role || '').toUpperCase());
};
window.getLittleFeetCurrentUser = () => currentUser;
window.isLittleFeetFullAccessUser = user => isFullAccessUser(user || currentUser);
let parentPaymentData = null;
let bookRegisterData = null;
const errorLog = [];
let mapInstance = null;
let schoolMapRequestToken = 0;
let nearbySchoolRecords = [];
let alertLocation = null;
let accountsCache = [];
let accountSessionGeneration = 0;
let accountRoleCatalog = null;
let accountSchoolSearchTimer = null;
let accountSchoolSearchToken = 0;
let broadcastsLoaded = false;
let alertMonitorId = null;
let ticketMonitorId = null;
let knownTicketIds = new Set();
let ticketsLoaded = false;
let ticketAssigneeAccounts = [];
let portalAudioContext = null;
let schoolStatusTimer = null;
let reportSignaturePads = {};
let pendingLearnerImport = [];
let pendingLearnerImportId = '';
let portalTourIndex = 0;
let portalTourTimer = null;
let portalBackgroundRefreshTimer = null;
let portalBackgroundRefreshInFlight = false;
const PORTAL_BACKGROUND_REFRESH_MS = 2 * 60 * 1000;
const portalRefreshJobs = new Map();
function runPortalRefreshJob(key, task) {
  const existing = portalRefreshJobs.get(key);
  if (existing) return existing;
  const job = Promise.resolve().then(task).finally(() => {
    if (portalRefreshJobs.get(key) === job) portalRefreshJobs.delete(key);
  });
  portalRefreshJobs.set(key, job);
  return job;
}
// Keep startup ownership in one place: deferred modules can register before or
// after session restoration, but each initializes only once for that session.
let workspaceSessionEpoch = 0;
const workspaceInitializers = new Map();
function workspaceSessionKey() {
  return currentUser ? JSON.stringify([workspaceSessionEpoch, currentUser.username, currentUser.schoolId, currentUser.role]) : '';
}
function resetWorkspaceLoads() {
  workspaceSessionEpoch += 1;
  workspaceInitializers.clear();
  portalRefreshJobs.clear();
}
window.getLittleFeetWorkspaceSessionKey = workspaceSessionKey;
window.registerLittleFeetWorkspace = (name, initialize) => {
  const start = () => {
    const sessionKey = workspaceSessionKey();
    if (!sessionKey) return Promise.resolve();
    const key = sessionKey + ':' + name;
    if (workspaceInitializers.has(key)) return workspaceInitializers.get(key);
    const job = Promise.resolve().then(() => {
      if (workspaceSessionKey() === sessionKey) return initialize();
    }).catch(error => {
      if (workspaceInitializers.get(key) === job) workspaceInitializers.delete(key);
      void window.reportLittleFeetClientLog?.({ severity: 'warn', code: 'WORKSPACE_INIT_FAILED', message: error?.message || 'Workspace initialization failed.' });
    });
    workspaceInitializers.set(key, job);
    return job;
  };
  document.addEventListener('littlefeet:session-ready', start);
  void start();
};
let debugModeEnabled = false;
let debugEvents = [];
let latestServerDiagnostics = null;
let latestServerErrors = [];
let inspectStructuredLogPayload = null;
let inspectServerFaults = [];
let inspectDiagnostics = null;
let inspectSelfTestResult = null;
let inspectAutoRefreshTimer = null;
let inspectRefreshPromise = null;
let executiveHomeOverviewPromise = null;
const INSPECT_AUTO_REFRESH_MS = 60 * 1000;
let connectedSignInProviders = {};
let learnerAccessCodeRecords = [];
let learnerCodeExportRows = [];
let visitorScannerStream = null;
let wallpaperIdleTimer = null;
let windtLegacyAudio = null;
let wallpaperThemeAudio = null;
let littleFeetAntarcticAudioPlaying = false;
let customWallpaperObjectUrl = '';
let portalAudioMuted = false;
let portalAudioChangedBeforeLogin = false;
const WALLPAPER_IDLE_MS = 60 * 60 * 1000;
const CUSTOM_WALLPAPER_MAX_BYTES = 8 * 1024 * 1024;
const STANDARD_SPREADSHEET_MAX_BYTES = 5 * 1024 * 1024;
const SCHOOL_INTEGRATION_SPREADSHEET_MAX_BYTES = 50 * 1024 * 1024;
const FORM_DOUBLE_SUBMIT_GUARD_MS = 2000;
const CUSTOM_WALLPAPER_MAX_GIF_MS = 8000;
window.LITTLE_FEET_SCHOOL_INTEGRATION_MAX_BYTES = SCHOOL_INTEGRATION_SPREADSHEET_MAX_BYTES;

function safeUserFacingError(error, fallback = 'Unable to complete this action. Please try again.') {
  const message = String(error?.message || '').trim().slice(0, 240);
  if (!message || /[\r\n]/.test(message)) return fallback;
  const internalPattern = /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|EvalError|SQLITE|PostgreSQL|ECONN\w*|ENOTFOUND|EAI_AGAIN|fetch failed|Failed to fetch|NetworkError|AbortError|invalid_client|invalid_grant|access_token|refresh_token|client_secret|node_modules|stack trace|unexpected token|cannot read (?:properties|property)|undefined is not)\b/i;
  const safePrefix = /^(?:Unable|Please|Choose|Select|Only|Sign in|Connect|No\b|This\b|The\b|Your\b|A\b|An\b|Invalid|Unsupported|Live|Verified|School|Payment|Mailbox|Email|Import|Book|Attendance|Schedule|Account|Recipient|Donation|Subscription|Too many|Authorised|Use\b|Set\b|Add\b|Create\b|Delete\b|Permanently|Sticky note|Provider sign-in|Parent|Management|Request|Large|Split exports)/i;
  if (internalPattern.test(message) || /(?:^|\s)at\s+\S+\s*\(/.test(message) || !safePrefix.test(message)) return fallback;
  return message;
}
window.safeUserFacingError = safeUserFacingError;

function markServerSessionValidated() {
  serverSessionValidatedAt = Date.now();
}

function expireClientSessionFromServer() {
  if (!currentUser) return;
  window.stopDashboardAutoRefresh?.();
  if (dashboardRefreshTimer) window.clearInterval(dashboardRefreshTimer);
  dashboardRefreshTimer = null;
  if (schoolStatusTimer) window.clearInterval(schoolStatusTimer);
  schoolStatusTimer = null;
  if (portalBackgroundRefreshTimer) window.clearInterval(portalBackgroundRefreshTimer);
  portalBackgroundRefreshTimer = null;
  portalBackgroundRefreshInFlight = false;
  if (inspectAutoRefreshTimer) window.clearInterval(inspectAutoRefreshTimer);
  inspectAutoRefreshTimer = null;
  if (alertMonitorId) window.clearInterval(alertMonitorId);
  alertMonitorId = null;
  if (ticketMonitorId) window.clearInterval(ticketMonitorId);
  ticketMonitorId = null;
  serverSessionValidatedAt = 0;
  currentUser = null;
  resetWorkspaceLoads();
  knownTicketIds = new Set();
  ticketsLoaded = false;
  inspectStructuredLogPayload = null;
  inspectServerFaults = [];
  inspectDiagnostics = null;
  inspectSelfTestResult = null;
  document.getElementById('dashboardSection')?.classList.add('hidden');
  document.getElementById('authSection')?.classList.remove('hidden');
  document.body.classList.remove('portal-active');
  document.getElementById('stickyNotesOverlay')?.replaceChildren();
  document.getElementById('stickyNotesOverlay')?.classList.add('hidden');
  document.getElementById('stickyNotesLauncher')?.classList.add('hidden');
  document.dispatchEvent(new CustomEvent('littlefeet:session-ended', { detail: { reason: 'server-session-ended' } }));
  window.setTimeout(() => openModal('Session ended', '<p style="margin:0;line-height:1.6;">Your secure Little Feet session ended. Please sign in again to continue.</p>'), 0);
}

async function ensureAuthenticatedSession({ force = false } = {}) {
  if (!currentUser) return false;
  if (!force && Date.now() - serverSessionValidatedAt <= SESSION_VALIDATION_TTL_MS) return true;
  if (sessionValidationPromise) return sessionValidationPromise;

  const expectedUsername = currentUser.username;
  sessionValidationPromise = (async () => {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (currentUser?.username !== expectedUsername) return false;
      if (response.ok && data.authenticated && data.user) {
        currentUser = data.user;
        markServerSessionValidated();
        return true;
      }
      if (response.ok || response.status === 401 || response.status === 403) expireClientSessionFromServer();
      return false;
    } catch {
      // A temporary network failure must not destroy the local session or drafts.
      return false;
    } finally {
      sessionValidationPromise = null;
    }
  })();
  return sessionValidationPromise;
}

window.ensureLittleFeetAuthenticatedSession = ensureAuthenticatedSession;

document.addEventListener('submit', event => {
  const form = event.target;
  if (!form || form.tagName !== 'FORM') return;
  const now = Date.now();
  const lockedUntil = Number(form.dataset.lfSubmitLockedUntil || 0);
  if (lockedUntil > now) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  form.dataset.lfSubmitLockedUntil = String(now + FORM_DOUBLE_SUBMIT_GUARD_MS);
  form.setAttribute('aria-busy', 'true');
  const submitters = [...form.querySelectorAll('button[type="submit"], input[type="submit"], button:not([type])')];
  submitters.forEach(button => {
    button.dataset.lfGuardPointerEvents = button.style.pointerEvents || '';
    button.style.pointerEvents = 'none';
    button.setAttribute('aria-disabled', 'true');
  });
  window.setTimeout(() => {
    if (Number(form.dataset.lfSubmitLockedUntil || 0) > Date.now()) return;
    delete form.dataset.lfSubmitLockedUntil;
    form.removeAttribute('aria-busy');
    submitters.forEach(button => {
      button.style.pointerEvents = button.dataset.lfGuardPointerEvents || '';
      delete button.dataset.lfGuardPointerEvents;
      button.removeAttribute('aria-disabled');
    });
  }, FORM_DOUBLE_SUBMIT_GUARD_MS + 50);
}, true);
const SAVED_LOGIN_USERNAME_KEY = 'lf_saved_login_username';
const SA_PUBLIC_SCHOOL_CALENDAR = {
  2026: {
    terms: [['2026-01-14', '2026-03-27'], ['2026-04-08', '2026-06-26'], ['2026-07-21', '2026-09-23'], ['2026-10-06', '2026-12-11']],
    closed: new Set(['2026-04-27', '2026-05-01', '2026-06-15', '2026-06-16', '2026-08-10', '2026-09-24'])
  },
  2027: {
    terms: [['2027-01-13', '2027-03-19'], ['2027-04-06', '2027-06-25'], ['2027-07-20', '2027-10-01'], ['2027-10-11', '2027-12-10']],
    closed: new Set(['2027-04-26', '2027-04-27', '2027-06-16', '2027-08-09', '2027-09-24'])
  }
};
let windtLegacyTapCount = 0;
let windtLegacyTapTimer = null;
let windtLegacyKeyTrail = '';
const wellbeingTips = [
  'Small routines create a sense of safety. A calm goodbye helps children settle into their day.',
  'Notice effort, not only outcomes. “You kept trying” helps children build confidence.',
  'A few minutes of child-led play can be the most meaningful part of a busy day.',
  'Children learn emotional language from us. Naming a feeling can make it easier to manage.',
  'Consistency is caring: predictable meals, rest, and handovers help children feel secure.',
  'Ask one open question today: “What made you smile?” It invites a richer conversation.'
];

// Audio indicator. Mobile browsers require the audio engine to be unlocked by a tap.


window.getPortalAudioContext = getPortalAudioContext;
window.isPortalAudioMuted = () => portalAudioMuted;















window.getLittleFeetAntarcticAudio = getLittleFeetAntarcticAudio;







// Audio indicator




// DOM Initialization
window.addEventListener('DOMContentLoaded', () => {
  upgradeLegacyIcons();
  observeProfessionalIcons();
  document.addEventListener('pointerdown', unlockPortalAudio, { once: true, passive: true });
  getLittleFeetAntarcticAudio();
  installLittleFeetAntarcticUnlockListeners();
  try {
    if (localStorage.getItem('lf_wallpaper_muted') === 'true' && localStorage.getItem('lf_portal_audio_muted_last') === null) localStorage.setItem('lf_portal_audio_muted_last', 'true');
  } catch {}
  loadPortalAudioPreference();
  restoreRememberedLogin();
  document.getElementById('rememberLogin')?.addEventListener('change', event => {
    if (!event.target.checked) clearRememberedLogin();
  });
  restoreCustomWallpaper().catch(() => {});
  const dateEl = document.getElementById('todayDateStr');
  if (dateEl) dateEl.textContent = new Date().toISOString().split('T')[0];

  const oauthProvider = new URLSearchParams(window.location.search).get('oauth');
  const oauthError = new URLSearchParams(window.location.search).get('oauthError');
  if (oauthProvider === 'google' || oauthProvider === 'yahoo' || oauthProvider === 'microsoft') {
    completeProviderLogin();
  } else {
    restoreAuthenticatedSession();
  }
  if (oauthError) showOAuthSignInMessage(oauthError);
  syncProviderButtons();
  startHealthMonitor();
  showWellbeingBanner();
  if (localStorage.getItem('lf_terms_notice_acknowledged') === 'true') document.getElementById('termsNotice')?.classList.add('hidden');

  const btnClearAtt = document.getElementById('btnClearAttendance');
  if (btnClearAtt) {
    btnClearAtt.addEventListener('click', (e) => {
      e.preventDefault();
      clearAttendanceRegistry();
    });
  }

  setupFormListeners();
  setupFormTemplates();
  setupRuntimeErrorHelpdesk();
  setupSignaturePads();
  setupPortalTour();
  setupKeyboardShortcuts();
  setupWallpaperMode();
});







async function restoreAuthenticatedSession() {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    if (!data.authenticated || !data.user) return;
    currentUser = data.user;
    setupSession();
  } catch { /* The sign-in screen remains available if the session check is unavailable. */ }
}



















window.addEventListener('littlefeet:languagechange', updatePortalAudioControls);





































async function runPortalBackgroundRefresh() {
  if (portalBackgroundRefreshInFlight || !currentUser || document.hidden) return false;
  portalBackgroundRefreshInFlight = true;
  try {
    if (!await ensureAuthenticatedSession()) return false;
    await Promise.allSettled([
      runPortalRefreshJob('tickets', () => loadTickets(true)),
      runPortalRefreshJob('broadcasts', () => loadBroadcasts())
    ]);
    return true;
  } finally {
    portalBackgroundRefreshInFlight = false;
  }
}

function startPortalBackgroundRefresh() {
  if (portalBackgroundRefreshTimer) window.clearInterval(portalBackgroundRefreshTimer);
  portalBackgroundRefreshTimer = window.setInterval(runPortalBackgroundRefresh, PORTAL_BACKGROUND_REFRESH_MS);
}











window.addEventListener('littlefeet:languagechange', refreshLoginPasswordLanguage);







let loginHumanCheckEnabled = true;
let loginHumanCheckLoadVersion = 0;
let loginHumanCheckAbortController = null;







// Authentication
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    unlockPortalAudio();

    const usernameInput = document.getElementById('loginUsername');
    const pinInput = document.getElementById('loginPin');
    const username = usernameInput?.value.trim() || '';
    const pin = pinInput?.value || '';
    const humanCheckId = document.getElementById('loginHumanCheckId')?.value || '';
    const humanCheckAnswer = document.getElementById('loginHumanCheckAnswer')?.value.trim() || '';
    const companyWebsite = document.getElementById('loginCompanyWebsite')?.value || '';
    const rememberLogin = document.getElementById('rememberLogin')?.checked === true;

    if (!username || !pin || (loginHumanCheckEnabled && (!humanCheckId || !humanCheckAnswer))) {
      loginForm.reportValidity();
      return;
    }
    if (usernameInput && usernameInput.value !== username) usernameInput.value = username;
    if (!rememberLogin) clearRememberedLogin();

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, pin, humanCheckId, humanCheckAnswer, companyWebsite })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.user) {
        currentUser = data.user;

        // Enter the portal immediately after the server accepts the login.
        // Mobile credential managers can keep navigator.credentials.store()
        // pending while their native save-password UI is open, so saving the
        // optional remembered credential must never block session startup.
        setupSession();
        if (rememberLogin) void saveRememberedLogin(username, pin);
      } else {
        alert(data.message || 'Login failed.');
        void loadLoginHumanCheck();
      }
    } catch {
      alert('Unable to connect to login server.');
      void loadLoginHumanCheck();
    }
  });
  void loadLoginHumanCheck();
}

const signupForm = document.getElementById('signupForm');
if (signupForm) {
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
      name: document.getElementById('signupName').value.trim(),
      username: document.getElementById('signupUsername').value.trim(),
      pin: document.getElementById('signupPin').value,
      role: document.getElementById('signupRole').value,
      schoolName: document.getElementById('signupSchool').value.trim(),
      linkedLearners: document.getElementById('signupLinkedLearners').value.trim(),
      termsAccepted: document.getElementById('signupTermsAccepted').checked
    };
    try {
      const response = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) return alert(result.message || 'Unable to create account.');
      document.getElementById('loginUsername').value = result.account.username;
      document.getElementById('loginPin').value = '';
      hideSignupForm();
      const parentMessage = result.account.role === 'parent'
        ? ' Your school must approve your account and learner relationship before learner information is available.'
        : ' Your school must approve your account before sign-in.';
      alert(`Account request created for ${result.account.name}.${parentMessage}`);
    } catch {
      alert('Unable to reach the account service.');
    }
  });
}

// Diagnostic Error Log Index


window.reportLittleFeetClientLog = reportClientStructuredLog;



let modalReturnFocus = null;





const INSPECT_BROWSER_CLEAN_SLATE_ID = 'inspect-clean-slate-20261001-v1';














































document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const modal = document.getElementById('appModal');
  if (modal && !modal.classList.contains('hidden')) closeModal();
});



let dashboardRefreshTimer = null;
const profileIcons = ['classic', 'lady', 'tough', 'cute', 'happy', 'cool', 'boss', 'smart-lady'];
const profileIconLabels = Object.freeze({
  classic: 'Classic',
  lady: 'Lady',
  tough: 'Tough',
  cute: 'Cute',
  happy: 'Happy',
  cool: 'Cool',
  boss: 'Boss',
  'smart-lady': 'Smart Lady'
});
const legacyProfileIconMap = Object.freeze({
  '👤': 'classic',
  '🧑‍🏫': 'smart-lady',
  '👨‍👩‍👧': 'cute',
  '🏫': 'boss',
  '🌟': 'happy',
  '🌱': 'classic',
  '🐾': 'cute',
  '📚': 'smart-lady',
  '🎨': 'lady',
  '🏆': 'boss'
});

























function setupSession() {
  markServerSessionValidated();
  loadPortalAudioPreference();
  applyRolePermissions(currentUser.role);
  ['reportSigningUsername', 'reportTeacherUsername', 'parentReportUsername'].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = currentUser?.username || '';
  });
  updateAlertLocationFilterStatus();
  const isParent = currentUser.role === 'parent';
  const navLivePill = document.getElementById('navLivePill');
  if (navLivePill) updateSchoolDayStatus();
  if (schoolStatusTimer) window.clearInterval(schoolStatusTimer);
  schoolStatusTimer = window.setInterval(updateSchoolDayStatus, 60 * 1000);
  const footerSchoolName = document.getElementById('footerSchoolName');
  if (footerSchoolName) footerSchoolName.textContent = `${currentUser.schoolName || 'Little Feet'} School Portal`;
  const displayRoleEl = document.getElementById('displayRole');
  if (displayRoleEl) displayRoleEl.textContent = `${currentUser.name || currentUser.username} · ${displayRoleName(currentUser)}`;

  if (document.getElementById('postAuthorTag')) {
    document.getElementById('postAuthorTag').textContent = `${displayRoleName(currentUser)} - ${currentUser.username}`;
  }
  document.getElementById('authSection').classList.add('hidden');
  document.getElementById('dashboardSection').classList.remove('hidden');
  document.body.classList.add('portal-active');
  resetWallpaperTimer();
  renderRoleHomePanel();
  configureDebugMode();
  applyUserPreferences();
  if (isParent) switchChatMode('direct');
  requestAnimationFrame(syncMobileHeaderOffset);
  const subscriptionBlocked = enforceSchoolSubscriptionUi();
  if (!subscriptionBlocked) loadAllData();
  window.setTimeout(() => window.restoreDashboardDrafts?.(), 120);
  document.dispatchEvent(new CustomEvent('littlefeet:session-ready'));
  if (alertMonitorId) clearInterval(alertMonitorId);
  alertMonitorId = null;
  if (ticketMonitorId) clearInterval(ticketMonitorId);
  ticketMonitorId = null;
  startPortalBackgroundRefresh();
}

function applyRolePermissions(role) {
  const fullAccess = isFullAccessUser(currentUser);
  updateAccountRoleFields();
  document.querySelectorAll('.role-admin, .role-teacher').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('[data-roles]').forEach(el => {
    const companyTabs = new Set(['homeTab','staffWorkTab','qualificationsTab','kpiHistoryTab','staffDevelopmentTab','emailIntegrationTab','chatTab','ticketsTab','guideTab','settingsTab','wallpaperTab', ...(role === 'crm' ? ['companyClientsTab','accountsTab'] : []), ...(role === 'accounts' ? ['companyBillingTab'] : [])]);
    const tabId = el.classList.contains('tab-content') ? el.id : el.querySelector('.nav-btn')?.getAttribute('onclick')?.match(/switchTab\('([^']+)'/)?.[1];
    const companyTool = tabId === 'companyClientsTab' || tabId === 'companyBillingTab';
    const supportTabs = new Set(['homeTab','staffWorkTab','qualificationsTab','kpiHistoryTab','staffDevelopmentTab','emailIntegrationTab','chatTab','ticketsTab','guideTab','settingsTab','wallpaperTab']);
    const roleAllowed = ['school_staff','school_hr'].includes(role) && tabId ? supportTabs.has(tabId) : companyTool
      ? Boolean((role === 'admin' && currentUser.platformAccess === true) || (role === 'crm' && tabId === 'companyClientsTab') || (role === 'accounts' && tabId === 'companyBillingTab'))
      : fullAccess || (isInternalCompanyRole(role) && tabId ? companyTabs.has(tabId) : el.dataset.roles.split(',').includes(role));
    const subscriptionAllowed = !el.dataset.subscription || role !== 'parent' || currentUser?.subscription === el.dataset.subscription;
    el.classList.toggle('hidden', !roleAllowed || !subscriptionAllowed);
  });
  if (fullAccess) {
    document.querySelectorAll('.role-admin, .role-teacher').forEach(el => el.classList.remove('hidden'));
  } else if (role === 'teacher') {
    document.querySelectorAll('.role-teacher').forEach(el => el.classList.remove('hidden'));
  } else if (role === 'principal') {
    document.querySelectorAll('#attendanceTab, #schoolDayTab, #chatTab, #operationsTab, #careTab, #registryTab, #financeTab').forEach(el => el.classList.remove('hidden'));
  } else if (role === 'district') {
    document.querySelectorAll('#analyticsTab, #lookupTab').forEach(el => el.classList.remove('hidden'));
  } else if (role === 'crm') {
    document.getElementById('accountsTab')?.classList.remove('hidden');
  }
  document.getElementById('debugModePanel')?.classList.toggle('hidden', !fullAccess);
  document.querySelectorAll('[data-nav-group]').forEach(group => {
    group.classList.toggle('hidden', ![...group.querySelectorAll('li[data-roles]')].some(item => !item.classList.contains('hidden')));
  });
}









const EXECUTIVE_CHART_COLORS = Object.freeze(['#5eead4', '#38bdf8', '#fbbf24', '#a78bfa', '#fb7185', '#34d399', '#f97316']);
let executiveChartSequence = 0;
const formatExecutiveInteger = value => new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(Number(value || 0));
const formatExecutiveCurrency = value => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(Number(value || 0));
const formatExecutiveCompactCurrency = value => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));








window.loadExecutiveHomeOverview = loadExecutiveHomeOverview;

function logout() {
  const signingOutUsername = currentUser?.username || '';
  window.stopDashboardAutoRefresh?.();
  if (dashboardRefreshTimer) window.clearInterval(dashboardRefreshTimer);
  dashboardRefreshTimer = null;
  window.clearDashboardDrafts?.(signingOutUsername);
  clearTimeout(wallpaperIdleTimer);
  if (schoolStatusTimer) window.clearInterval(schoolStatusTimer);
  schoolStatusTimer = null;
  if (portalBackgroundRefreshTimer) window.clearInterval(portalBackgroundRefreshTimer);
  portalBackgroundRefreshTimer = null;
  portalBackgroundRefreshInFlight = false;
  if (inspectAutoRefreshTimer) window.clearInterval(inspectAutoRefreshTimer);
  inspectAutoRefreshTimer = null;
  inspectStructuredLogPayload = null;
  inspectServerFaults = [];
  inspectDiagnostics = null;
  inspectSelfTestResult = null;
  executiveHomeOverviewPromise = null;
  serverSessionValidatedAt = 0;
  sessionValidationPromise = null;
  currentUser = null;
  resetWorkspaceLoads();
  document.dispatchEvent(new CustomEvent('littlefeet:session-ended'));
  exitWallpaperMode();
  stopWindtLegacyNote();
  if (alertMonitorId) { clearInterval(alertMonitorId); alertMonitorId = null; }
  if (ticketMonitorId) { clearInterval(ticketMonitorId); ticketMonitorId = null; }
  knownTicketIds = new Set();
  ticketsLoaded = false;
  void fetch('/api/auth/logout', { method: 'POST' });
  document.getElementById('dashboardSection').classList.add('hidden');
  document.getElementById('authSection').classList.remove('hidden');
  document.body.classList.remove('portal-active');
  document.getElementById('stickyNotesOverlay')?.replaceChildren();
  document.getElementById('stickyNotesOverlay')?.classList.add('hidden');
  document.getElementById('stickyNotesLauncher')?.classList.add('hidden');
}

function switchUser() {
  logout();
  const usernameInput = document.getElementById('loginUsername');
  const pinInput = document.getElementById('loginPin');
  if (usernameInput) usernameInput.value = '';
  if (pinInput) pinInput.value = '';
  setTimeout(() => usernameInput?.focus(), 0);
}

let portalHeaderResizeObserver = null;









let portalHeaderScrollFrame = 0;


window.addEventListener('resize', queuePortalHeaderOffsetSync);
window.addEventListener('scroll', queuePortalHeaderOffsetSync, { passive: true });
requestAnimationFrame(() => {
  observePortalHeaderSize();
  syncMobileHeaderOffset();
  syncNavigationViewportState();
});



function loadWorkspaceOnDemand(tabId) {
  if (!currentUser) return Promise.resolve([]);
  const loaders = {
    scheduleTab: [loadSchedules], worksheetsTab: [loadWorksheets], badgesTab: [loadBadges],
    companyClientsTab: [loadCompanyClients], companyBillingTab: [loadCompanyBilling],
    preschoolTab: [()=>window.refreshEducationWorkspace?.('preschoolTab')], gradeRTab: [()=>window.refreshEducationWorkspace?.('gradeRTab')], primarySchoolTab: [()=>window.refreshEducationWorkspace?.('primarySchoolTab')], highSchoolTab: [()=>window.refreshEducationWorkspace?.('highSchoolTab')],
    attendanceTab: [loadAttendance], ticketsTab: [() => runPortalRefreshJob('tickets', () => loadTickets()), loadTicketAssignees],
    broadcastsTab: [() => runPortalRefreshJob('broadcasts', () => loadBroadcasts())], chatTab: [loadChatGroups, loadGroupChatMessages, loadDirectChatUsers],
    registryTab: [loadRegistry, loadLearnerAccessCodes],
    parentContactsTab: [loadParentContacts],
    accountsTab: [loadAccounts],
    financeTab: [loadSubscriptionBillingOverview, () => window.loadFinanceAutomationOverview?.()], parentPaymentsTab: [loadParentPayments, loadParentSubscription],
    bookRegisterTab: [loadBookRegister], safetyNetworkTab: [loadSafetyNetwork],
    visitorMeetingTab: [loadVisitorMeetingRecipients, loadVisitorMeetings],
    safeguardingTab: [loadConsentRecords, loadPickupRecords],
    notesTab: [loadStickyNotes],
    inspectTab: [loadInspectDashboard],
    progressTab: [() => Promise.allSettled(['portfolio', 'reports'].map(loadWorkspaceRecords)), () => window.loadCurriculumRecords?.()]
  };
  const sessionKey = workspaceSessionKey();
  return runPortalRefreshJob('workspace:' + sessionKey + ':' + tabId, () => {
    if (workspaceSessionKey() !== sessionKey) return [];
    return Promise.allSettled((loaders[tabId] || []).map(load => Promise.resolve().then(load)));
  });
}









// The supplied wallpaper theme loops for as long as wallpaper mode remains open.








































async function loadAllData() {
  // Initial/session refresh only. Background timers must not call this function.
  if (!await ensureAuthenticatedSession()) return false;
  await Promise.allSettled([
    loadAcademicTerm(),
    loadPosts(),
    runPortalRefreshJob('tickets', () => loadTickets()),
    runPortalRefreshJob('broadcasts', () => loadBroadcasts()),
    loadReleaseNotes(),
    loadHouseholdSwitcher(),
    loadStickyNotes(),
    runPortalRefreshJob('executive-home', () => loadExecutiveHomeOverview({ silent: true }))
  ]);
  return true;
}

async function refreshActiveWorkspace(tabId = document.querySelector('#dashboardSection .tab-content.active')?.id || 'homeTab') {
  if (!await ensureAuthenticatedSession()) return false;
  if (tabId === 'homeTab') {
    await Promise.allSettled([
      loadAcademicTerm(),
      loadPosts(),
      loadReleaseNotes(),
      loadHouseholdSwitcher(),
      loadStickyNotes(),
      runPortalRefreshJob('executive-home', () => loadExecutiveHomeOverview({ silent: true }))
    ]);
    return true;
  }
  await loadWorkspaceOnDemand(tabId);
  return true;
}
window.refreshActiveWorkspace = refreshActiveWorkspace;







const toBase64 = file => new Promise((resolve, reject) => {
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    setFileLimitWarning(file, `⚠ File too large: ${(file.size / 1024 / 1024).toFixed(1)} MB. Attachments are limited to 5 MB. Compress it or use a smaller file.`);
    reject(new Error('This file is larger than 5 MB. Compress it or use a smaller file so the school database remains fast.'));
    return;
  }
  setFileLimitWarning(file, '');
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});




const validateSpreadsheetFile = (file, maxBytes = STANDARD_SPREADSHEET_MAX_BYTES) => {
  const extension = String(file?.name || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
  if (!['.xlsx', '.xls', '.csv'].includes(extension)) {
    setFileLimitWarning(file, '');
    return 'Use an XLSX, XLS, or CSV spreadsheet.';
  }
  if (file.size > maxBytes) {
    const limitMb = Math.round(maxBytes / 1024 / 1024);
    const actualMb = Math.max(0.1, file.size / 1024 / 1024).toFixed(1);
    const schoolIntegration = maxBytes === SCHOOL_INTEGRATION_SPREADSHEET_MAX_BYTES;
    const message = schoolIntegration
      ? `⚠ File too large: ${actualMb} MB. School Integration accepts up to ${limitMb} MB per spreadsheet. Split the school export into smaller approved files.`
      : `⚠ File too large: ${actualMb} MB. This import accepts up to ${limitMb} MB. Large learner/school-register files must use School Integration; otherwise split or reduce the file.`;
    setFileLimitWarning(file, message);
    return message.replace(/^⚠\s*/, '');
  }
  setFileLimitWarning(file, '');
  return '';
};

// Editable Academic Term Functions




// Interactive 20Km Radius School Finder Map using live OpenStreetMap data.














// Posts




const postForm = document.getElementById('postForm');
if (postForm) {
  postForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('postMedia').files[0];
    let mediaUrl = null;
    try {
      mediaUrl = file ? await toBase64(file) : null;
    } catch (error) {
      alert(safeUserFacingError(error, 'Unable to process this file.'));
      return;
    }
    const body = {
      id: Date.now().toString(),
      audience: document.getElementById('postAudience').value,
      caption: document.getElementById('postCaption').value,
      mediaUrl
    };
    await fetch('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    postForm.reset();
    loadPosts();
    playDingSound();
  });
}

// Schedules




const scheduleForm = document.getElementById('scheduleForm');
if (scheduleForm) {
  scheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      studentName: document.getElementById('schStudentName').value,
      dayOfWeek: document.getElementById('schDay').value,
      timeSlot: `${document.getElementById('schStartTime').value} - ${document.getElementById('schEndTime').value}`,
      activity: document.getElementById('schActivity').value
    };
    if (!document.getElementById('schStartTime').value || !document.getElementById('schEndTime').value) return alert('Choose both a start and end time.');
    if (document.getElementById('schEndTime').value <= document.getElementById('schStartTime').value) return alert('The end time must be after the start time.');
    await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    scheduleForm.reset();
    loadSchedules();
  });
}





// Worksheets






const worksheetForm = document.getElementById('worksheetForm');
if (worksheetForm) {
  worksheetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('wsPhoto').files[0];
    if (!file) return alert('Please select a file to attach.');

    let photoUrl;
    try {
      photoUrl = await toBase64(file);
    } catch (error) {
      alert(safeUserFacingError(error, 'Unable to process this file.'));
      return;
    }
    const body = {
      id: Date.now().toString(),
      studentName: document.getElementById('wsStudentName').value,
      title: document.getElementById('wsTitle').value,
      grade: document.getElementById('wsGrade').value,
      photoUrl,
      submittedBy: currentUser ? currentUser.username : 'Educator'
    };

    await fetch('/api/worksheets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    worksheetForm.reset();
    loadWorksheets();
    playDingSound();
  });
}

// Milestone Badges












const badgeForm = document.getElementById('badgeForm');
const badgeCategory = document.getElementById('badgeCategory');
const milestoneChoices = [...document.querySelectorAll('.milestone-choice')];

milestoneChoices.forEach(choice => choice.addEventListener('click', () => {
  if (badgeCategory) badgeCategory.value = choice.dataset.value;
  syncMilestoneChoice(choice.dataset.value);
}));
syncMilestoneChoice();
if (badgeForm) {
  badgeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canManageBadges()) return alert('Only authorised school staff can award badges.');
    const body = {
      id: Date.now().toString(),
      studentName: document.getElementById('badgeStudentName').value,
      category: document.getElementById('badgeCategory').value,
      title: document.getElementById('badgeTitle').value,
      note: document.getElementById('badgeNote').value,
      actorUsername: currentUser.username
    };
    const response = await fetch('/api/badges', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to award this badge.');
    badgeForm.reset();
    syncMilestoneChoice();
    loadBadges();
    playDingSound();
  });
}



// Analytics
const analyticsSearchForm = document.getElementById('analyticsSearchForm');
if (analyticsSearchForm) {
  analyticsSearchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputEl = currentUser?.role === 'parent' ? document.getElementById('analyticsStudentSelect') : document.getElementById('analyticsStudent');
    const studentName = inputEl.value.trim();

    try {
      const res = await fetch(`/api/analytics/${encodeURIComponent(studentName)}?username=${encodeURIComponent(currentUser?.username || '')}`);      const data = await res.json();
      if (!res.ok) return alert(data.message || 'Unable to load analytics for this learner.');

      if (!data.totalAssessments) {
        document.getElementById('analyticsOutput').innerHTML = `<p class="meta">No completed scored assessments are available for ${escapeWorkspaceText(studentName)} yet. Add a worksheet or test result with a score first.</p>`;
        return;
      }
      const trendColour = data.pointChange > 0 ? '#16a34a' : data.pointChange < 0 ? '#dc2626' : '#0284c7';
      const trendText = data.percentageChange === null ? 'No percentage comparison is available because the first score was zero.' : `${data.percentageChange > 0 ? '+' : ''}${data.percentageChange}% from first to latest completed assessment (${data.pointChange > 0 ? '+' : ''}${data.pointChange} points).`;
      const premiumDetail = data.detailedInsights
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px;"><div class="store-item"><strong>🏆 Best completed assessment</strong><p style="margin:5px 0 0;">${escapeWorkspaceText(data.best.title)} · <strong>${data.best.score}%</strong></p></div><div class="store-item"><strong>📌 Assessment needing support</strong><p style="margin:5px 0 0;">${escapeWorkspaceText(data.worst.title)} · <strong>${data.worst.score}%</strong></p></div></div>`
        : `<p class="meta" style="margin-top:12px;">Detailed best/worst assessment insights are available with LittleSteps Plus.</p>`;

      document.getElementById('analyticsOutput').innerHTML = `
        <div class="item-row" style="flex-direction: column; align-items: flex-start; border-left-color:#16a34a;">
          <h3 style="color:var(--text-dark);">Term assessment summary: ${escapeWorkspaceText(studentName)}</h3>
          <div style="margin-top: 8px; font-size:0.9rem;">
            <p>Average completed score: <strong>${data.averageScore}%</strong></p>
            <p>First score: <strong>${data.baselineScore}%</strong> · Latest score: <strong>${data.latestScore}%</strong></p>
            <p style="color:${trendColour};"><strong>${data.trend}:</strong> ${trendText}</p>
            <p>Completed assessments: <strong>${data.totalAssessments}</strong></p>
          </div>
          ${premiumDetail}
          <button type="button" onclick="window.print()" class="action-btn btn-blue" style="margin-top: 12px;">Print assessment summary</button>
        </div>`;
    } catch (err) {
      logAppError('ERR_ANALYTICS_500', `Failed to generate metrics for: ${studentName}`);
    }
    inputEl.value = '';
  });
}

// Attendance Registry




const attendanceForm = document.getElementById('attendanceForm');
if (attendanceForm) {
  attendanceForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('attStudentName');
    const studentName = input.value.trim();
    if (!studentName) return;

    await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: Date.now().toString(), studentName, status: 'Checked In' })
    });
    input.value = '';
    loadAttendance();
    playDingSound();
  });
}







// Support Tickets Archive & Queue




















const ticketForm = document.getElementById('ticketForm');
if (ticketForm) {
  ticketForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      id: Date.now().toString(),
      department: document.getElementById('ticketDept').value,
      priority: document.getElementById('ticketPriority').value,
      ticketType: document.getElementById('ticketType')?.value || 'Help request',
      meetingDate: document.getElementById('ticketMeetingDate')?.value || '',
      meetingTime: document.getElementById('ticketMeetingTime')?.value || '',
      meetingLocation: document.getElementById('ticketMeetingLocation')?.value || '',
      subject: document.getElementById('ticketSubject').value,
      message: document.getElementById('ticketMessage').value,
      createdBy: currentUser?.username,
      assignedTo: canManageTicketQueue() ? document.getElementById('ticketAssignee')?.value : ''
    };
    const response = await fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to create the support ticket.');
    ticketForm.reset();
    loadTicketAssignees();
    loadTickets();
    playDingSound();
  });
}









// Emergency Broadcasts
























// Chat System Operations




















// Global Form Submissions Router










































































































































































let parentContactRecords = [];



























window.loadParentContacts = loadParentContacts;
window.filterParentContacts = filterParentContacts;
window.copyParentContactField = copyParentContactField;
window.copyParentContactSummary = copyParentContactSummary;
window.openParentContactEditor = openParentContactEditor;
window.closeParentContactEditor = closeParentContactEditor;
window.openRegistryForNewContact = openRegistryForNewContact;



const ALERT_LOCATION_SESSION_KEY = 'lf_alert_location';



































































// Keep the form compatible with a previously cached page that used an inline submit handler.
window.saveStickyNote = saveStickyNote;



bindStickyNoteForm();

































document.addEventListener('littlefeet:session-ended', () => { ['companyClientsContent','companyBillingContent'].forEach(id => document.getElementById(id)?.replaceChildren()); });

document.addEventListener('littlefeet:session-ended', () => {
  accountSessionGeneration++;
  accountsCache = [];
  accountRoleCatalog = null;
  window.clearTimeout(accountSchoolSearchTimer);
  accountSchoolSearchToken++;
  document.getElementById('accountsList')?.replaceChildren();
  const select = document.getElementById('accountEditSelect');
  if (select) { const option = document.createElement('option'); option.value = ''; option.textContent = 'Create a new account / select an existing account'; select.replaceChildren(option); }
  resetAccountForm();
  if (document.querySelector('.learner-link-choice')) closeModal();
});
