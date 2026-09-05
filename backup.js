let currentUser = null;
const errorLog = [];
let mapInstance = null;
let nearbySchoolRecords = [];
let alertLocation = null;
let accountsCache = [];
let broadcastsLoaded = false;
let alertMonitorId = null;
let ticketMonitorId = null;
let knownTicketIds = new Set();
let ticketsLoaded = false;
let ticketAssigneeAccounts = [];
let portalAudioContext = null;
let startupChimePending = false;
let startupChimePrompt = null;
let reportSignaturePads = {};
let pendingLearnerImport = [];
let portalTourIndex = 0;
let portalTourTimer = null;
let debugModeEnabled = false;
let debugEvents = [];
let startupChimePlayed = false;
let connectedSignInProviders = {};
let learnerAccessCodeRecords = [];
let visitorScannerStream = null;
let wallpaperIdleTimer = null;
const WALLPAPER_IDLE_MS = 60 * 60 * 1000;
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
function getPortalAudioContext() {
  if (!portalAudioContext || portalAudioContext.state === 'closed') portalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  return portalAudioContext;
}

function unlockPortalAudio() {
  try {
    const ctx = getPortalAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => { if (startupChimePending) playStartupChime(); }).catch(showStartupChimePrompt);
    } else if (startupChimePending) {
      playStartupChime();
    }
  } catch { /* Sound remains optional when unavailable on a device. */ }
}

// Some mobile browsers only permit sound after an explicit second tap.  This
// small, visible fallback is shown only when the browser blocks the first one.
function showStartupChimePrompt() {
  if (startupChimePlayed || startupChimePrompt || !currentUser) return;
  const prompt = document.createElement('button');
  prompt.type = 'button';
  prompt.className = 'action-btn btn-green';
  prompt.textContent = '🔊 Play welcome theme';
  prompt.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:10020;box-shadow:0 12px 30px rgba(0,0,0,.35);';
  prompt.addEventListener('click', () => {
    const ctx = getPortalAudioContext();
    ctx.resume().then(() => {
      prompt.remove();
      startupChimePrompt = null;
      playStartupChime();
    }).catch(() => {});
  });
  document.body.append(prompt);
  startupChimePrompt = prompt;
  window.setTimeout(() => {
    if (startupChimePrompt === prompt) { prompt.remove(); startupChimePrompt = null; }
  }, 12000);
}

// Audio indicator
function playDingSound() {
  try {
    const ctx = getPortalAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.log('Audio disabled:', e);
  }
}

function playTicketAlert() {
  try {
    const ctx = getPortalAudioContext();
    if (ctx.state === 'suspended') return;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 6.4);
    master.connect(ctx.destination);
    const pattern = [659.25, 783.99, 987.77, 783.99, 659.25, 523.25, 659.25, 880];
    Array.from({ length: 25 }, (_, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + index * 0.25;
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(pattern[index % pattern.length], start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.42, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
      oscillator.connect(gain); gain.connect(master);
      oscillator.start(start); oscillator.stop(start + 0.22);
    });
  } catch { /* Browser sound is optional and can be disabled by device settings. */ }
}

// DOM Initialization
window.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('pointerdown', unlockPortalAudio, { once: true, passive: true });
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

async function completeProviderLogin() {
  try {
    const response = await fetch('/api/auth/session');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to complete provider sign-in.');
    currentUser = data.user;
    window.history.replaceState({}, document.title, '/');
    setupSession();
  } catch (error) {
    alert(error.message || 'Provider sign-in could not be completed.');
    window.history.replaceState({}, document.title, '/');
  }
}

async function restoreAuthenticatedSession() {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json();
    currentUser = data.user;
    setupSession();
  } catch { /* The sign-in screen remains available if the session check is unavailable. */ }
}

async function syncProviderButtons() {
  const buttons = [...document.querySelectorAll('[data-provider-signin]')];
  if (!buttons.length) return;
  try {
    const response = await fetch('/api/auth/providers', { cache: 'no-store' });
    if (!response.ok) throw new Error('Provider status could not be loaded.');
    connectedSignInProviders = await response.json();
    buttons.forEach(button => {
      const enabled = connectedSignInProviders[button.dataset.providerSignin] === true;
      button.hidden = !enabled;
      button.disabled = !enabled;
    });
    const providerPanel = buttons[0].closest('.social-signin');
    if (providerPanel) providerPanel.hidden = !buttons.some(button => !button.hidden);
  } catch {
    // Keep the account sign-in form available even when the optional provider
    // status check is temporarily unavailable.
    buttons.forEach(button => { button.hidden = true; button.disabled = true; });
  }
}

function startProviderSignIn(provider) {
  if (connectedSignInProviders[provider] === false) return showProviderSetup(`${provider} sign-in`);
  if (provider === 'google' || provider === 'yahoo' || provider === 'microsoft') window.location.assign(`/auth/${provider}`);
  else showProviderSetup(`${provider} sign-in`);
}

function showOAuthSignInMessage(error) {
  const messages = {
    'google-not-configured': ['Google sign-in is not ready yet', 'An administrator still needs to finish the Google connection.'],
    'yahoo-not-configured': ['Yahoo sign-in is not ready yet', 'An administrator still needs to add the Yahoo connection details in Render.'],
    'microsoft-not-configured': ['Microsoft sign-in is not ready yet', 'An administrator still needs to add the Microsoft connection details in Render.'],
    'account-not-linked': ['Account not linked', 'This email is not linked to an approved Little Feet account. Please use your approved school, teacher, parent, principal, or district email.'],
    'yahoo-sign-in-failed': ['Yahoo sign-in could not finish', 'Please try again. If this continues, an administrator should check the Yahoo app connection.'],
    'microsoft-sign-in-failed': ['Microsoft sign-in could not finish', 'Please try again. If this continues, an administrator should check the Microsoft app connection.']
  };
  const [title, text] = messages[error] || ['Sign-in could not finish', 'Please try again or contact your school administrator.'];
  window.history.replaceState({}, document.title, '/');
  setTimeout(() => openModal(title, `<p style="margin:0;line-height:1.6;">${escapeWorkspaceText(text)}</p>`), 0);
}

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

function handleMascotLegacyTap(event) {
  event?.stopPropagation();
  windtLegacyTapCount += 1;
  if (windtLegacyTapTimer) clearTimeout(windtLegacyTapTimer);
  if (windtLegacyTapCount >= 5) {
    windtLegacyTapCount = 0;
    openWindtLegacy();
    return;
  }
  windtLegacyTapTimer = setTimeout(() => {
    windtLegacyTapCount = 0;
    goToMainMenu();
  }, 650);
}

function openWindtLegacy() {
  if (!currentUser) return;
  openModal('The Windt Legacy 🐧', `<article style="display:grid;gap:14px;line-height:1.7;"><div style="padding:16px;border:1px solid rgba(45,212,191,.5);border-radius:14px;background:radial-gradient(circle at 80% 15%,rgba(45,212,191,.18),rgba(7,17,30,.15));"><p style="margin:0;color:#99f6e4;font-size:.76rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">A note for one day</p><h3 style="margin:5px 0 0;font-size:1.4rem;">To my son,</h3></div><p style="margin:0;">Your little feet and your small penguin waddle gave Little Feet its heart. When you were one year and four months old, you inspired this place more than you could have known.</p><p style="margin:0;">Through the late nights, the hard moments, and every small step of building, you kept me inspired to work hard and to care deeply. You changed me into a better man. I still have faults, and I am still learning, but you gave me a reason to keep becoming better.</p><p style="margin:0;">If you find this one day, I want you to know that I am proud of you. I will always love you. If it were not for you, I would never have come this far.</p><p style="margin:0;font-weight:700;color:var(--primary-color);">Every little step matters — especially yours.</p><details style="border-top:1px solid rgba(45,212,191,.35);padding-top:12px;"><summary style="cursor:pointer;color:#99f6e4;font-weight:800;">’n Brief van Pa</summary><div style="display:grid;gap:12px;margin-top:12px;color:var(--text-dark);"><p style="margin:0;">My seun ek is so trots op jou so ver as wat jy gekom het, as ek nie daar meer is nie ek is jammer jy is die beste ding wat in my lewe gebeur het en ek weet jy gan n success wees in lewe pa glo vas jy sal kan beter doen as wat ek sou kon, asseblief kyk mooi na jou ma as ek nie meer daar is nie.</p><p style="margin:0;">Btw jou middle naam is based op my child hood game hero Marcus Fenix jou ma wou nie hê ek moes jou dit noem nie maar pa het inageval want jy deserve die beste.</p><p style="margin:0;">Die Windt Legacy gan nie oor wat gedoen was nie en aan gaan met dit nie dit gaan oor wat jy voor sit vir jou familie sodat die volgende generation kan streef en nog beter doen as die laaste.</p><p style="margin:0;font-weight:700;color:var(--primary-color);">Christiaan Windt in and out, love you my Potato.</p></div></details></article>`);
}

function showPortalTourSlide(index) {
  const slides = [...document.querySelectorAll('.portal-tour-slide')];
  const dots = [...document.querySelectorAll('.tour-dots button')];
  if (!slides.length) return;
  portalTourIndex = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => slide.classList.toggle('is-active', slideIndex === portalTourIndex));
  dots.forEach((dot, dotIndex) => dot.classList.toggle('is-active', dotIndex === portalTourIndex));
}

// An original ten-second, gently fingerpicked welcome motif, played once per sign-in.
// It is browser synthesis, not a copied or licensed recording.
function playStartupChime() {
  if (startupChimePlayed) return;
  try {
    const ctx = getPortalAudioContext();
    if (ctx.state === 'suspended') {
      startupChimePending = true;
      ctx.resume().then(() => playStartupChime()).catch(showStartupChimePrompt);
      return;
    }
    startupChimePending = false;
    const startedAt = ctx.currentTime;
    const duration = 10;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, startedAt);
    master.gain.exponentialRampToValueAtTime(0.56, startedAt + 0.06);
    master.gain.setValueAtTime(0.56, startedAt + 8.8);
    master.gain.exponentialRampToValueAtTime(0.0001, startedAt + duration);
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.setValueAtTime(3200, startedAt);
    warmth.Q.setValueAtTime(0.7, startedAt);
    const echo = ctx.createDelay(0.35);
    const echoGain = ctx.createGain();
    const reverb = ctx.createConvolver();
    const reverbGain = ctx.createGain();
    echo.delayTime.setValueAtTime(0.21, startedAt);
    echoGain.gain.setValueAtTime(0.16, startedAt);
    const impulse = ctx.createBuffer(2, Math.ceil(ctx.sampleRate * 2.6), ctx.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const samples = impulse.getChannelData(channel);
      for (let index = 0; index < samples.length; index += 1) {
        const decay = Math.pow(1 - index / samples.length, 2.6);
        samples[index] = (Math.random() * 2 - 1) * decay;
      }
    }
    reverb.buffer = impulse;
    reverbGain.gain.setValueAtTime(0.06, startedAt);
    master.connect(warmth); warmth.connect(ctx.destination);
    warmth.connect(echo); echo.connect(echoGain); echoGain.connect(ctx.destination);
    warmth.connect(reverb); reverb.connect(reverbGain); reverbGain.connect(ctx.destination);

    const pluck = (frequency, start, length = 1.15, volume = 0.24) => {
      const oscillator = ctx.createOscillator();
      const string = ctx.createBiquadFilter();
      const tone = ctx.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start);
      string.type = 'bandpass';
      string.frequency.setValueAtTime(Math.min(frequency * 4.2, 2400), start);
      string.Q.setValueAtTime(3.2, start);
      tone.gain.setValueAtTime(0.0001, start);
      tone.gain.exponentialRampToValueAtTime(volume * 1.9, start + 0.008);
      tone.gain.exponentialRampToValueAtTime(0.075, start + Math.min(0.2, length * 0.18));
      tone.gain.exponentialRampToValueAtTime(0.0001, start + length);
      oscillator.connect(string); string.connect(tone); tone.connect(master);
      oscillator.start(start); oscillator.stop(start + length + 0.03);
    };

    // A simple original fingerpicked progression: soft, melancholy, then warming.
    const notes = [
      [0.18, 196, 1.55, 0.22], [0.82, 246.94, 1.2, 0.16], [1.52, 293.66, 1.16, 0.15],
      [2.22, 174.61, 1.52, 0.2], [2.88, 220, 1.2, 0.16], [3.57, 261.63, 1.16, 0.15],
      [4.30, 164.81, 1.48, 0.2], [4.95, 207.65, 1.16, 0.16], [5.65, 246.94, 1.16, 0.15],
      [6.36, 146.83, 1.5, 0.2], [7.03, 196, 1.2, 0.16], [7.72, 246.94, 1.16, 0.15],
      [8.43, 196, 1.38, 0.24], [9.12, 293.66, 0.78, 0.18]
    ];
    notes.forEach(([offset, frequency, length, volume]) => pluck(frequency, startedAt + offset, length, volume));
    startupChimePlayed = true;
  } catch { /* Browser sound is optional and can be disabled by device settings. */ }
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

function addFormTemplates(form, label, templates, applyTemplate) {
  if (!form || form.dataset.templatesReady) return;
  form.dataset.templatesReady = 'true';
  const bar = document.createElement('div');
  bar.className = 'form-template-bar';
  const select = document.createElement('select');
  select.setAttribute('aria-label', `${label} template`);
  select.innerHTML = `<option value="">Choose a ${label.toLowerCase()} template…</option>${templates.map((template, index) => `<option value="${index}">${template.label}</option>`).join('')}`;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'action-btn btn-blue'; button.textContent = 'Use template';
  button.addEventListener('click', () => { const template = templates[Number(select.value)]; if (!template) return; applyTemplate(template); });
  const hint = document.createElement('span'); hint.textContent = 'Templates save time; review every field before saving.';
  bar.append(select, button, hint); form.prepend(bar);
}

function setupFormTemplates() {
  addFormTemplates(document.getElementById('scheduleForm'), 'schedule', [
    { label: 'Morning learning block', day: 'Monday', time: '08:00 - 08:30', activity: 'Morning circle: welcome, weather, and attendance' },
    { label: 'Literacy activity', day: 'Tuesday', time: '09:00 - 09:45', activity: 'Early literacy: story time, sounds, and name writing' },
    { label: 'Outdoor movement', day: 'Wednesday', time: '10:00 - 10:40', activity: 'Outdoor play: gross-motor movement and cooperative games' }
  ], template => { document.getElementById('schDay').value = template.day; document.getElementById('schTime').value = template.time; document.getElementById('schActivity').value = template.activity; });

  addFormTemplates(document.getElementById('ticketForm'), 'support request', [
    { label: 'Fee or payment question', department: 'Finance', priority: 'Normal', subject: 'Request for account assistance', message: 'Please review the account and advise on the next steps.' },
    { label: 'Medical information update', department: 'Medical', priority: 'High', subject: 'Learner medical information update', message: 'Please contact me to confirm the correct process for updating this learner’s medical information.' },
    { label: 'General school query', department: 'Admin', priority: 'Normal', subject: 'School administration query', message: 'Please provide guidance or arrange a suitable time to discuss this request.' }
  ], template => { document.getElementById('ticketDept').value = template.department; document.getElementById('ticketPriority').value = template.priority; document.getElementById('ticketSubject').value = template.subject; document.getElementById('ticketMessage').value = template.message; });

  addFormTemplates(document.getElementById('broadcastForm'), 'alert', [
    { label: 'Weather closure notice', priority: 'Weather Alert', message: 'Important: The school is monitoring severe weather conditions. Please check this notice for the next update and follow school collection instructions.' },
    { label: 'Health and safety notice', priority: 'Urgent Medical', message: 'Important safety notice: Please follow the school’s collection and access instructions. Contact the school office if you need assistance.' },
    { label: 'General campus notice', priority: 'Campus Notice', message: 'School notice: Please review this update and contact the school office if you have questions.' }
  ], template => { document.getElementById('bcPriority').value = template.priority; document.getElementById('bcMessage').value = template.message; });

  addFormTemplates(document.getElementById('reportPublishForm'), 'report', [
    { label: 'Monthly learning summary', title: 'Monthly learning summary', period: new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' }) },
    { label: 'Assessment feedback', title: 'Assessment feedback and next steps', period: new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' }) },
    { label: 'Term progress report', title: 'Term progress report', period: 'Term 3, 2026' }
  ], template => { document.getElementById('reportTitle').value = template.title; document.getElementById('reportPeriod').value = template.period; });

  const incidentForm = document.querySelector("form[onsubmit*=\"'care','Incident report'\"]");
  addFormTemplates(incidentForm, 'incident report', [
    { label: 'Minor playground incident', details: 'Learner: [name]. Time: [time]. Location: playground. Objective facts: [what was observed]. Immediate action: [first aid / supervision]. Parent notified: [yes/no].' },
    { label: 'Behaviour observation', details: 'Learner: [name]. Time: [time]. Location: [area]. Objective facts: [what was observed]. Support provided: [action]. Parent notified: [yes/no].' }
  ], template => { const input = incidentForm.querySelector('[name="details"]'); if (input) input.value = template.details; });
}

function setupRuntimeErrorHelpdesk() {
  window.addEventListener('error', event => routeErrorToHelpdesk({ code: 'WEB_RUNTIME_ERROR', message: event.message || 'Unexpected browser error', line: event.lineno, column: event.colno, source: event.filename }));
  window.addEventListener('unhandledrejection', event => routeErrorToHelpdesk({ code: 'WEB_PROMISE_ERROR', message: event.reason?.message || String(event.reason || 'Unexpected background error') }));
}

function routeErrorToHelpdesk(error) {
  captureDebugEvent({ category: 'Browser runtime', ...error });
  const details = `${error.code}: ${error.message}${error.source ? `\nSource: ${error.source}` : ''}${error.line ? `\nLine: ${error.line}${error.column ? `, column ${error.column}` : ''}` : ''}`;
  console.error(details);
  if (!currentUser || sessionStorage.getItem(`lf_error_${details}`)) return;
  sessionStorage.setItem(`lf_error_${details}`, '1');
  const ticketBody = { id: `err-${Date.now()}`, department: 'Technical Support', priority: 'High', subject: `Automatic error report: ${error.code}`, message: details, createdBy: currentUser?.username };
  fetch('/api/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ticketBody) }).catch(() => {});
  const supportButton = [...document.querySelectorAll('.nav-btn')].find(button => button.getAttribute('onclick')?.includes("ticketsTab"));
  switchTab('ticketsTab', supportButton);
  const subject = document.getElementById('ticketSubject');
  const message = document.getElementById('ticketMessage');
  if (subject) subject.value = `Automatic error report: ${error.code}`;
  if (message) message.value = details;
  alert('A technical issue was detected. You have been taken to Support Desk with the error details.');
}

function showWellbeingBanner() {
  const banner = document.getElementById('wellbeingBanner');
  const text = document.getElementById('wellbeingBannerText');
  if (!banner || !text || localStorage.getItem('lf_wellbeing_banner_hidden') === 'true') return;
  const last = Number(localStorage.getItem('lf_wellbeing_tip_index'));
  const choices = wellbeingTips.map((_, index) => index).filter(index => index !== last);
  const next = choices[Math.floor(Math.random() * choices.length)];
  localStorage.setItem('lf_wellbeing_tip_index', String(next));
  text.textContent = wellbeingTips[next];
  banner.classList.remove('hidden');
}

function dismissWellbeingBanner() {
  document.getElementById('wellbeingBanner')?.classList.add('hidden');
  localStorage.setItem('lf_wellbeing_banner_hidden', 'true');
}

function dismissTermsNotice() {
  document.getElementById('termsNotice')?.classList.add('hidden');
  localStorage.setItem('lf_terms_notice_acknowledged', 'true');
}

async function loadReleaseNotes() {
  const board = document.getElementById('updatesBoard');
  if (!board) return;
  try {
    const response = await fetch('/api/release-notes');
    const notes = await response.json();
    const latest = notes[0];
    const seen = localStorage.getItem('lf_latest_release_seen');
    if (!latest || seen === latest.id) return;
    board.innerHTML = `<div class="card-header-bar"><h2>✨ What’s new</h2><button type="button" class="action-btn btn-blue" onclick="dismissReleaseNotes('${latest.id}')">Mark as read</button></div>${notes.slice(0, 3).map(note => `<div class="item-row"><div><strong>Version ${escapeWorkspaceText(note.version)} · ${escapeWorkspaceText(note.title)}</strong><p style="margin-top:4px;color:var(--text-muted);">${escapeWorkspaceText(note.summary)}</p><span class="meta">${new Date(note.publishedAt).toLocaleDateString()}</span></div></div>`).join('')}`;
    board.classList.remove('hidden');
  } catch { board.classList.add('hidden'); }
}

function dismissReleaseNotes(id) {
  localStorage.setItem('lf_latest_release_seen', id);
  document.getElementById('updatesBoard')?.classList.add('hidden');
}

function setupSignaturePads() {
  ['teacherSignaturePad', 'parentSignaturePad'].forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.lineWidth = 2.5; context.lineCap = 'round'; context.strokeStyle = '#0f2b48';
    let drawing = false; let hasStroke = false;
    const position = event => { const rect = canvas.getBoundingClientRect(); const point = event.touches?.[0] || event; return { x: (point.clientX - rect.left) * (canvas.width / rect.width), y: (point.clientY - rect.top) * (canvas.height / rect.height) }; };
    const start = event => { drawing = true; const point = position(event); context.beginPath(); context.moveTo(point.x, point.y); event.preventDefault(); };
    const move = event => { if (!drawing) return; const point = position(event); context.lineTo(point.x, point.y); context.stroke(); hasStroke = true; event.preventDefault(); };
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerdown', start); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointerleave', stop);
    reportSignaturePads[id] = { canvas, context, hasStroke: () => hasStroke, clear: () => { context.clearRect(0, 0, canvas.width, canvas.height); hasStroke = false; } };
  });
}

function clearSignature(id) { reportSignaturePads[id]?.clear(); }

function quickFill(user, pin) {
  document.getElementById('loginUsername').value = user;
  document.getElementById('loginPin').value = pin;
}

function showSignupForm() {
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('signupForm').classList.remove('hidden');
}

function hideSignupForm() {
  document.getElementById('signupForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
  document.getElementById('signupForm').reset();
}

// Authentication
const loginForm = document.getElementById('loginForm');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    unlockPortalAudio();
    const username = document.getElementById('loginUsername').value;
    const pin = document.getElementById('loginPin').value;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, pin })
      });
      const data = await res.json();
      if (res.ok) {
        currentUser = data.user;
        setupSession();
      } else {
        alert(data.message || 'Login failed.');
      }
    } catch (err) {
      console.error(err);
      alert('Unable to connect to login server.');
    }
  });
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
function logAppError(code, reason) {
  captureDebugEvent({ category: 'Application', code, message: reason });
  const errItem = { code, reason, timestamp: new Date().toLocaleTimeString() };
  errorLog.unshift(errItem);

  const errorBox = document.getElementById('attendanceErrorIndex');
  const errorList = document.getElementById('errorListItems');

  if (errorBox && errorList) {
    errorBox.style.display = 'block';
    errorList.innerHTML = errorLog.map(err => 
      `<li><strong>[${err.code}]</strong> ${err.reason} <em>(${err.timestamp})</em></li>`
    ).join('');
  }
}

function openModal(title, contentHtml) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = contentHtml;
  document.querySelector('#appModal .modal-card').classList.remove('subscription-modal-card');
  document.getElementById('appModal').classList.remove('hidden');
}

function sanitiseDebugText(value) {
  return String(value || 'No additional detail').replace(/(password|pin|token)\s*[:=]\s*\S+/gi, '$1: [redacted]').slice(0, 600);
}

function configureDebugMode() {
  const isAdmin = currentUser?.role === 'admin';
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
  if (!debugModeEnabled || currentUser?.role !== 'admin') return;
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
  if (!panel || currentUser?.role !== 'admin') return;
  if (toggle) { toggle.textContent = debugModeEnabled ? 'Disable debug mode' : 'Enable debug mode'; toggle.className = `action-btn ${debugModeEnabled ? 'btn-red' : 'btn-blue'}`; }
  if (status) status.textContent = debugModeEnabled ? `Debug mode is on. ${debugEvents.length} safe technical event${debugEvents.length === 1 ? '' : 's'} captured this session.` : 'Debug mode is off. Turn it on only while diagnosing a problem.';
}

function toggleDebugMode() {
  if (currentUser?.role !== 'admin') return alert('Debug mode is available to administrators only.');
  debugModeEnabled = !debugModeEnabled;
  localStorage.setItem('lf_admin_debug_mode', String(debugModeEnabled));
  updateDebugModePanel();
}

function openDebugReport() {
  if (currentUser?.role !== 'admin') return;
  const report = debugEvents.length ? debugEvents.map(event => `<div class="item-row"><strong>${escapeWorkspaceText(event.code)}</strong><p style="margin-top:4px;">${escapeWorkspaceText(event.message)}</p><span class="meta">${escapeWorkspaceText(event.category)} · ${escapeWorkspaceText(event.source)}${event.line ? ` · Line ${event.line}${event.column ? `, column ${event.column}` : ''}` : ''}<br>${new Date(event.timestamp).toLocaleString()}</span></div>`).join('') : '<p class="meta">No debug events have been captured in this session.</p>';
  openModal('Administrator debug report', `<p style="margin:0 0 12px;color:var(--text-muted);">This report contains safe technical context only. Do not add learner data or passwords to support requests.</p>${report}`);
}

function downloadDebugReport() {
  if (currentUser?.role !== 'admin') return;
  const content = JSON.stringify({ generatedAt: new Date().toISOString(), events: debugEvents }, null, 2);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  link.download = `LittleFeet_Debug_Report_${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function clearDebugReport() {
  if (currentUser?.role !== 'admin' || !confirm('Clear this session’s debug report?')) return;
  debugEvents = [];
  sessionStorage.removeItem('lf_debug_events');
  updateDebugModePanel();
}

function closeModal() {
  visitorScannerStream?.getTracks().forEach(track => track.stop());
  visitorScannerStream = null;
  document.getElementById('appModal').classList.add('hidden');
}

function toggleDarkMode() {
  document.body.classList.toggle('light-mode');
}

let dashboardRefreshTimer = null;
function applyUserPreferences() {
  const preferences = JSON.parse(localStorage.getItem('lf_user_preferences') || '{}');
  const language = document.getElementById('languagePreference');
  const refresh = document.getElementById('refreshPreference');
  if (language) language.value = preferences.language || 'en';
  if (refresh) refresh.value = preferences.refresh || '0';
  document.documentElement.lang = preferences.language || 'en';
  const sidebarCollapsed = localStorage.getItem('lf_sidebar_collapsed') === 'true';
  document.getElementById('dashboardSection')?.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  document.getElementById('mainNavigation')?.classList.toggle('is-collapsed', sidebarCollapsed);
  restoreSidebarGroups();
  if (dashboardRefreshTimer) clearInterval(dashboardRefreshTimer);
  const interval = Number(preferences.refresh || 0);
  if (interval > 0) dashboardRefreshTimer = setInterval(() => { if (currentUser && !document.hidden) loadAllData(); }, interval);
}

function saveUserPreferences() {
  const preferences = {
    language: document.getElementById('languagePreference')?.value || 'en',
    refresh: document.getElementById('refreshPreference')?.value || '0'
  };
  localStorage.setItem('lf_user_preferences', JSON.stringify(preferences));
  applyUserPreferences();
  if (preferences.language === 'af') alert('Afrikaans has been saved as your preference. Full text translation will become available as the approved translation catalogue is completed.');
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

function setupSession() {
  applyRolePermissions(currentUser.role);
  const isParent = currentUser.role === 'parent';
  const subscriptionEntry = document.getElementById('subscriptionEntryButton');
  const subscriptionFooter = document.getElementById('subscriptionFooterLink');
  const navLivePill = document.getElementById('navLivePill');
  if (subscriptionEntry) subscriptionEntry.textContent = isParent ? '💎 Parent Subscription' : '💎 Plans & Benefits';
  if (subscriptionFooter) subscriptionFooter.textContent = isParent ? 'Parent Subscription' : 'School Subscriptions';
  if (navLivePill) navLivePill.textContent = isParent ? 'Family updates ready' : 'School day in progress';
  const footerSchoolName = document.getElementById('footerSchoolName');
  if (footerSchoolName) footerSchoolName.textContent = `${currentUser.schoolName || 'Little Feet'} School Portal`;
  const displayRoleEl = document.getElementById('displayRole');
  if (displayRoleEl) displayRoleEl.textContent = `${currentUser.name || currentUser.username} · ${currentUser.role.toUpperCase()}`;

  const userAvatarEl = document.getElementById('userAvatar');
  if (userAvatarEl) {
    userAvatarEl.textContent = '👤';
    userAvatarEl.title = currentUser.name || currentUser.username;
  }

  if (document.getElementById('postAuthorTag')) {
    document.getElementById('postAuthorTag').textContent = `${currentUser.role.toUpperCase()} - ${currentUser.username}`;
  }
  document.getElementById('authSection').classList.add('hidden');
  document.getElementById('dashboardSection').classList.remove('hidden');
  document.body.classList.add('portal-active');
  resetWallpaperTimer();
  renderRoleHomePanel();
  configureDebugMode();
  applyUserPreferences();
  playStartupChime();
  if (isParent) switchChatMode('direct');
  requestAnimationFrame(syncMobileHeaderOffset);
  loadAllData();
  loadSubscriptionBillingOverview();
  if (alertMonitorId) clearInterval(alertMonitorId);
  alertMonitorId = setInterval(() => { if (currentUser) loadBroadcasts(); }, 30000);
  if (ticketMonitorId) clearInterval(ticketMonitorId);
  ticketMonitorId = setInterval(() => { if (currentUser) loadTickets(true); }, 20000);
}

function applyRolePermissions(role) {
  document.querySelectorAll('.role-admin, .role-teacher').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('[data-roles]').forEach(el => {
    const roleAllowed = el.dataset.roles.split(',').includes(role);
    const subscriptionAllowed = !el.dataset.subscription || role !== 'parent' || currentUser?.subscription === el.dataset.subscription;
    el.classList.toggle('hidden', !roleAllowed || !subscriptionAllowed);
  });
  if (role === 'admin') {
    document.querySelectorAll('.role-admin').forEach(el => el.classList.remove('hidden'));
  } else if (role === 'teacher') {
    document.querySelectorAll('.role-teacher').forEach(el => el.classList.remove('hidden'));
  } else if (role === 'principal') {
    document.querySelectorAll('#attendanceTab, #schoolDayTab, #chatTab, #operationsTab, #careTab, #registryTab, #financeTab').forEach(el => el.classList.remove('hidden'));
  } else if (role === 'district') {
    document.querySelectorAll('#analyticsTab, #lookupTab').forEach(el => el.classList.remove('hidden'));
  }
  document.querySelectorAll('[data-nav-group]').forEach(group => {
    group.classList.toggle('hidden', ![...group.querySelectorAll('li[data-roles]')].some(item => !item.classList.contains('hidden')));
  });
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
      icon: '🐧', title: `Admin centre for ${currentUser.name || 'your school'}`,
      message: 'Keep accounts, learner links, consent, and school data accurate before inviting families and staff.'
    }
  };
  const experience = experiences[currentUser.role] || experiences.parent;
  panel.classList.add('mascot-role-home');
  panel.innerHTML = `<div class="role-home-content"><div><span class="portal-tour-kicker">YOUR WORKSPACE</span><h2>${escapeWorkspaceText(experience.title)}</h2><p>${escapeWorkspaceText(experience.message)}</p></div><div class="role-home-icon" aria-hidden="true">${experience.icon}</div></div>`;
}

function logout() {
  clearTimeout(wallpaperIdleTimer);
  currentUser = null;
  exitWallpaperMode();
  startupChimePlayed = false;
  startupChimePending = false;
  startupChimePrompt?.remove();
  startupChimePrompt = null;
  if (alertMonitorId) { clearInterval(alertMonitorId); alertMonitorId = null; }
  if (ticketMonitorId) { clearInterval(ticketMonitorId); ticketMonitorId = null; }
  knownTicketIds = new Set();
  ticketsLoaded = false;
  void fetch('/api/auth/logout', { method: 'POST' });
  document.getElementById('dashboardSection').classList.add('hidden');
  document.getElementById('authSection').classList.remove('hidden');
  document.body.classList.remove('portal-active');
}

function switchUser() {
  logout();
  const usernameInput = document.getElementById('loginUsername');
  const pinInput = document.getElementById('loginPin');
  if (usernameInput) usernameInput.value = '';
  if (pinInput) pinInput.value = '';
  setTimeout(() => usernameInput?.focus(), 0);
}

function syncMobileHeaderOffset() {
  const dashboard = document.getElementById('dashboardSection');
  const header = dashboard?.querySelector('nav');
  if (!dashboard || dashboard.classList.contains('hidden') || !header) return;
  document.documentElement.style.setProperty('--mobile-header-height', `${Math.ceil(header.getBoundingClientRect().height)}px`);
}

window.addEventListener('resize', syncMobileHeaderOffset);

function switchTab(tabId, btn) {
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
}

function setupWallpaperMode() {
  const noteActivity = (event) => {
    const overlay = document.getElementById('wallpaperOverlay');
    if (overlay?.classList.contains('is-visible')) {
      exitWallpaperMode();
      return;
    }
    resetWallpaperTimer();
  };
  ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'scroll'].forEach(eventName => {
    document.addEventListener(eventName, noteActivity, { passive: eventName !== 'keydown' });
  });
}

function resetWallpaperTimer() {
  clearTimeout(wallpaperIdleTimer);
  const dashboard = document.getElementById('dashboardSection');
  if (!currentUser || !dashboard || dashboard.classList.contains('hidden')) return;
  wallpaperIdleTimer = window.setTimeout(() => startWallpaperMode(), WALLPAPER_IDLE_MS);
}

function startWallpaperMode() {
  const overlay = document.getElementById('wallpaperOverlay');
  if (!currentUser || !overlay) return;
  clearTimeout(wallpaperIdleTimer);
  overlay.classList.add('is-visible');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.querySelector('.wallpaper-exit')?.focus({ preventScroll: true });
}

function exitWallpaperMode() {
  const overlay = document.getElementById('wallpaperOverlay');
  if (!overlay) return;
  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  resetWallpaperTimer();
}

function openWorkspace(tabId) {
  const navButton = [...document.querySelectorAll('.nav-btn')].find(button => button.getAttribute('onclick')?.includes(`'${tabId}'`));
  if (!navButton || navButton.closest('li')?.classList.contains('hidden')) {
    alert('This workspace is not available for your account. Please contact your school administrator if you need access.');
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

function restoreSidebarGroups() {
  let collapsed = [];
  try { collapsed = JSON.parse(localStorage.getItem('lf_collapsed_nav_groups') || '[]'); } catch { collapsed = []; }
  document.querySelectorAll('[data-nav-group]').forEach(group => group.classList.toggle('is-collapsed', collapsed.includes(group.querySelector('.sidebar-group-toggle')?.textContent.trim())));
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
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const health = await res.json();
      consecutiveFailures = 0;
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
      // A production backup URL is configured by the school host / load balancer.
      // Local development remains manual so a missing local port never traps users in a redirect loop.
      if (configuredBackupUrl && consecutiveFailures >= 2 && !sessionStorage.getItem('lf_failover_redirected')) {
        sessionStorage.setItem('lf_failover_redirected', '1');
        window.location.replace(configuredBackupUrl);
      }
    }
  };

  checkStatus();
  setInterval(checkStatus, 8000);
}

function loadAllData() {
  loadAcademicTerm();
  loadPosts();
  loadSchedules();
  loadWorksheets();
  loadBadges();
  loadTickets();
  loadTicketAssignees();
  loadAttendance();
  loadBroadcasts();
  loadChatGroups();
  loadGroupChatMessages();
  loadDirectChatUsers();
  loadStoreItems();
  loadStoreOrders();
  loadReleaseNotes();
  loadReportReviews();
  loadHouseholdSwitcher();
  loadRegistry();
  loadAccounts();
  loadLearnerAccessCodes();
  loadSafetyNetwork();
  loadVisitorMeetingRecipients();
  loadVisitorMeetings();
  loadConsentRecords();
  loadPickupRecords();
  ['finance', 'operations', 'care', 'engagement', 'dailyCare', 'portfolio', 'supplies', 'stock', 'reports', 'safeguarding', 'absences', 'handovers'].forEach(loadWorkspaceRecords);
}

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
    box.innerHTML = `<div class="card-header-bar"><h2>👨‍👩‍👧 Your linked learners</h2><span class="badge-tag info">PARENT</span></div><p style="color:var(--text-muted);margin-bottom:10px;">Only children linked to this parent account are shown here.</p><div style="display:flex;gap:8px;flex-wrap:wrap;">${learners.map((learner, index) => `<button type="button" class="action-btn ${learner.studentName === selectedLearner.studentName || (!index && !selectedLearner) ? 'btn-green' : 'btn-blue'}" onclick="selectHouseholdLearner('${encodeURIComponent(learner.studentName)}')">${escapeWorkspaceText(learner.studentName)} · ${escapeWorkspaceText(learner.className)}</button>`).join('')}</div><p id="householdSelection" class="meta" style="margin-top:9px;">Selected learner: ${escapeWorkspaceText(selectedLearner.studentName)}</p>`;
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

function openAlertsTab() {
  const alertButton = [...document.querySelectorAll('.nav-btn')].find(button =>
    (button.getAttribute('onclick') || '').includes("broadcastsTab")
  );
  switchTab('broadcastsTab', alertButton);
}

const toBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result);
  reader.onerror = error => reject(error);
});

// Editable Academic Term Functions
async function loadAcademicTerm() {
  try {
    const res = await fetch('/api/term');
    const data = await res.json();
    if (data.term) {
      document.getElementById('currentTermText').textContent = data.term;
    }
  } catch (err) {
    console.error('Failed to load academic term.');
  }
}

function editTermModal() {
  const currentText = document.getElementById('currentTermText').textContent;
  const html = `
    <form id="editTermForm">
      <label for="termInput">Academic Term Description & Status:</label>
      <input type="text" id="termInput" value="${currentText.replace(/"/g, '&quot;')}" required>
      <button type="submit" class="submit-btn">💾 Save Academic Term</button>
    </form>`;
  openModal('Edit Academic Term Ribbon', html);

  document.getElementById('editTermForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newTerm = document.getElementById('termInput').value.trim();
    if (!newTerm) return;

    await fetch('/api/term', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: newTerm })
    });
    document.getElementById('currentTermText').textContent = newTerm;
    closeModal();
    playDingSound();
  });
}

// Interactive 20Km Radius School Finder Map using live OpenStreetMap data.
async function loadSchoolProximityMap() {
  const container = document.getElementById('schoolMapContainer');
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  container.innerHTML = '📍 Requesting location permission and searching live school data…';
  navigator.geolocation.getCurrentPosition(async (position) => {
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;
    const userPos = [userLat, userLng];
    container.innerHTML = '<div id="interactiveMap" style="width:100%; height:100%; border-radius:8px;"></div>';

    if (typeof L === 'undefined') {
      container.textContent = 'Map service could not be loaded. Please refresh the page and try again.';
      return;
    }
    if (mapInstance) mapInstance.remove();

    // Disabling Leaflet's mobile tap shim prevents one physical tap being
    // interpreted as a marker click followed by a map click that closes the card.
    mapInstance = L.map('interactiveMap', { closePopupOnClick: false, tap: false }).setView(userPos, 12);
    mapInstance.on('click', () => {
      hideSchoolPinCard();
      mapInstance.closePopup();
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(mapInstance);
    const userLocationIcon = L.divIcon({ className: '', html: '<div class="user-location-pin" title="Your current location"></div>', iconSize: [30, 30], iconAnchor: [15, 15] });
    L.marker(userPos, { icon: userLocationIcon, zIndexOffset: 1000 }).addTo(mapInstance).bindPopup(`<strong>📍 Your Current Location</strong><br>Lat: ${userLat.toFixed(5)}, Long: ${userLng.toFixed(5)}`, { autoClose: false, closeOnClick: false, keepInView: true }).openPopup();
    L.circle(userPos, { color: '#2dd4bf', fillColor: '#14b8a6', fillOpacity: 0.14, radius: 20000 }).addTo(mapInstance);
    const latitudeOffset = 20000 / 111320;
    const longitudeOffset = 20000 / (111320 * Math.cos(userLat * Math.PI / 180));
    mapInstance.fitBounds([[userLat - latitudeOffset, userLng - longitudeOffset], [userLat + latitudeOffset, userLng + longitudeOffset]], { padding: [22, 22], maxZoom: 13 });

    const status = L.control({ position: 'topright' });
    status.onAdd = () => {
      const element = L.DomUtil.create('div');
      element.style.cssText = 'background:#fff; color:#0f172a; padding:8px 10px; border-radius:4px; box-shadow:0 1px 5px rgba(0,0,0,.35); font-size:12px; font-weight:600;';
      element.textContent = 'Loading live nearby schools…';
      return element;
    };
    status.addTo(mapInstance);

    const escapeHtml = (value) => String(value || 'Not listed in OpenStreetMap').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const distanceInMetres = (lat, lng) => {
      const radians = (degrees) => degrees * Math.PI / 180;
      const earthRadius = 6371000;
      const latDifference = radians(lat - userLat);
      const lngDifference = radians(lng - userLng);
      const a = Math.sin(latDifference / 2) ** 2 + Math.cos(radians(userLat)) * Math.cos(radians(lat)) * Math.sin(lngDifference / 2) ** 2;
      return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    try {
      const cacheKey = `lf_nearby_school_cache_${userLat.toFixed(2)}_${userLng.toFixed(2)}`;
      let payload;
      let usingCachedResults = false;
      try {
        const schoolSearchUrl = `/api/nearby-schools?lat=${encodeURIComponent(userLat)}&lng=${encodeURIComponent(userLng)}&radius=20000`;
        let lastSearchError;
        // Public map providers occasionally reject a single request while they are
        // healthy again a moment later. Retry twice before using the saved result.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await fetch(schoolSearchUrl, { cache: 'no-store' });
            const candidate = await response.json();
            if (!response.ok) throw new Error(candidate.message || 'Unable to load live nearby schools.');
            payload = candidate;
            break;
          } catch (error) {
            lastSearchError = error;
            if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 700 * (attempt + 1)));
          }
        }
        if (!payload) throw lastSearchError || new Error('Unable to load live nearby schools.');
        // Storage can be blocked in private browsing or restricted web views.
        // Map pins must still render when caching is unavailable.
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload })); } catch { /* live result remains usable without a cache */ }
      } catch (liveError) {
        let cached = null;
        try { cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null'); } catch { cached = null; }
        if (!cached?.payload?.elements?.length || Date.now() - Number(cached.savedAt || 0) > 24 * 60 * 60 * 1000) throw liveError;
        payload = cached.payload;
        usingCachedResults = true;
      }

      const seenSchools = new Set();
      const nearbySchools = payload.elements.map((place) => {
        const tags = place.tags || {};
        const lat = Number(place.lat ?? place.center?.lat);
        const lng = Number(place.lon ?? place.center?.lon);
        const name = tags.name || tags['name:en'] || 'Unnamed education facility';
        return { tags, lat, lng, name, key: `${name.toLowerCase()}|${lat.toFixed(5)}|${lng.toFixed(5)}` };
      }).filter((school) => Number.isFinite(school.lat) && Number.isFinite(school.lng) && distanceInMetres(school.lat, school.lng) <= 20000)
        .filter((school) => !seenSchools.has(school.key) && seenSchools.add(school.key))
        .sort((a, b) => distanceInMetres(a.lat, a.lng) - distanceInMetres(b.lat, b.lng));

      const safeExternalUrl = (value) => {
        if (!value) return '';
        const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        try {
          const url = new URL(candidate);
          return /^https?:$/.test(url.protocol) ? url.href : '';
        } catch {
          return '';
        }
      };
      const markerLayer = typeof L.markerClusterGroup === 'function'
        ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, chunkedLoading: true, chunkInterval: 80, chunkDelay: 15, animate: false, removeOutsideVisibleBounds: true, zoomToBoundsOnClick: true })
        : L.layerGroup();

      nearbySchools.forEach((school) => {
        const street = [school.tags['addr:housenumber'], school.tags['addr:street']].filter(Boolean).join(' ') || 'Not listed in OpenStreetMap';
        const suburb = school.tags['addr:suburb'] || school.tags['addr:neighbourhood'] || school.tags['addr:district'] || 'Not listed in OpenStreetMap';
        const town = school.tags['addr:city'] || school.tags['addr:town'] || school.tags['addr:village'] || 'Not listed in OpenStreetMap';
        const category = school.tags.amenity || school.tags.building || 'education facility';
        const phone = school.tags['contact:phone'] || school.tags.phone || school.tags['contact:mobile'] || school.tags.mobile || '';
        const email = school.tags['contact:email'] || school.tags.email || '';
        const website = safeExternalUrl(school.tags['contact:website'] || school.tags.website || '');
        const imageUrl = safeExternalUrl(school.tags.image || school.tags['contact:image'] || '');
        const contactSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${school.name} ${town} contact`)}`;
        const photo = imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(school.name)}" style="display:block; width:100%; max-height:130px; margin:0 0 8px; object-fit:cover; border-radius:5px;">`
          : '<p class="school-muted" style="font-size:0.75rem; margin:7px 0 0;"><strong>Photo:</strong> Not publicly listed in OpenStreetMap.</p>';
        const contact = `<p style="font-size:0.8rem; margin:7px 0 0;"><strong>Phone:</strong> ${phone ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` : 'Not publicly listed'}<br><strong>Email:</strong> ${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : 'Not publicly listed'}<br><strong>Website:</strong> ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Visit school website</a>` : `Not publicly listed · <a href="${escapeHtml(contactSearchUrl)}" target="_blank" rel="noopener noreferrer">Find official contact</a>`}</p>`;
        school.details = { street, suburb, town, category, phone, email, website, imageUrl };
        const content = `<div class="school-popup" style="padding:4px; font-family:sans-serif; min-width:240px; max-width:290px;"><h3 style="margin:0 0 6px; font-size:0.95rem;">🏫 ${escapeHtml(school.name)}</h3>${photo}<p style="font-size:0.8rem; margin:0 0 4px;"><strong>Type:</strong> ${escapeHtml(category)}<br><strong>Coordinates:</strong> Lat ${school.lat.toFixed(5)}, Long ${school.lng.toFixed(5)}</p><p style="font-size:0.8rem; margin:0;"><strong>Street Address:</strong> ${escapeHtml(street)}<br><strong>Suburb:</strong> ${escapeHtml(suburb)}<br><strong>Town / City:</strong> ${escapeHtml(town)}</p>${contact}<div class="school-enrichment" style="margin-top:9px;"><button type="button" class="action-btn btn-green" style="margin:0 0 7px;" onclick="openSchoolDetail(${nearbySchools.indexOf(school)})">View details / apply</button><button type="button" class="action-btn btn-blue" style="margin:0;" onclick="enrichSchoolPin(this, decodeURIComponent('${encodeURIComponent(school.name)}'), ${school.lat}, ${school.lng})">Check verified public details</button><p class="school-muted" style="font-size:.72rem;margin:6px 0 0;">Uses verified public details only. No AI-generated school details are saved automatically.</p></div></div>`;
        const marker = L.marker([school.lat, school.lng], { riseOnHover: true }).bindPopup(content, { autoClose: false, closeOnClick: false, closeOnEscapeKey: false, keepInView: true, autoPanPadding: [20, 20], maxWidth: 310 });
        marker.on('click', event => {
          if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
          showSchoolPinCard(nearbySchools.indexOf(school));
          // Open after Leaflet's built-in marker handler has finished so the
          // popup is not toggled away by the same tap on mobile browsers.
          window.setTimeout(() => marker.openPopup(), 0);
        });
        markerLayer.addLayer(marker);
      });
      markerLayer.addTo(mapInstance);
      mapInstance.on('popupopen', event => {
        const popupElement = event.popup.getElement();
        if (popupElement) {
          L.DomEvent.disableClickPropagation(popupElement);
          L.DomEvent.disableScrollPropagation(popupElement);
        }
      });
      nearbySchoolRecords = nearbySchools;
      renderNearbySchoolPicker();
      status.getContainer().textContent = usingCachedResults
        ? `${nearbySchools.length} recent school results shown - live refresh will retry next time`
        : `${nearbySchools.length} live education facilities found within 20 km`;
    } catch (error) {
      console.error(error);
      status.getContainer().textContent = 'Live school search unavailable. Please try again shortly.';
      logAppError('ERR_MAP_SCHOOLS', 'Unable to load live nearby school data.');
    }

    setTimeout(() => { if (mapInstance) mapInstance.invalidateSize(); }, 300);
  }, () => {
    logAppError('ERR_MAP_GEO', 'Unable to retrieve device location for map search.');
    alert('Unable to detect your location. Please enable browser location access.');
  });
}

function renderNearbySchoolPicker() {
  const panel = document.getElementById('schoolPickerPanel');
  const picker = document.getElementById('nearbySchoolPicker');
  if (!panel || !picker || !nearbySchoolRecords.length) return;
  picker.innerHTML = nearbySchoolRecords.map((school, index) => `<option value="${index}">${escapeWorkspaceText(school.name)} · ${school.lat.toFixed(5)}, ${school.lng.toFixed(5)}</option>`).join('');
  panel.classList.remove('hidden');
}

function openSelectedSchoolDetail() { openSchoolDetail(Number(document.getElementById('nearbySchoolPicker')?.value)); }
function showSchoolPinCard(index) {
  const school = nearbySchoolRecords[index];
  const card = document.getElementById('schoolPinCard');
  const picker = document.getElementById('nearbySchoolPicker');
  if (!school || !card) return;
  if (picker) picker.value = String(index);
  const detail = school.details || {};
  const address = [detail.street, detail.suburb, detail.town].filter(value => value && value !== 'Not listed in OpenStreetMap').join(', ') || 'Address not publicly listed';
  card.innerHTML = `<div style="display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;"><div><strong>🏫 ${escapeWorkspaceText(school.name)}</strong><p class="meta" style="margin:5px 0 0;">${escapeWorkspaceText(detail.category || 'Education facility')} · ${escapeWorkspaceText(address)}</p><p class="meta" style="margin:4px 0 0;">Tap elsewhere on the map to close this selection.</p></div><div style="display:flex;gap:7px;align-items:center;"><button type="button" class="action-btn btn-green" onclick="openSchoolDetail(${index})">View details / apply</button><button type="button" class="action-btn btn-blue" aria-label="Close selected school" onclick="hideSchoolPinCard()">×</button></div></div>`;
  card.classList.remove('hidden');
}
function hideSchoolPinCard() {
  const card = document.getElementById('schoolPinCard');
  if (!card) return;
  card.classList.add('hidden');
  card.innerHTML = '';
}
function openSchoolDetail(index) {
  const school = nearbySchoolRecords[index];
  if (!school) return;
  const detail = school.details || {};
  const coordinates = `${school.lat.toFixed(5)}, ${school.lng.toFixed(5)}`;
  const verifiedParent = currentUser?.role === 'parent' && !String(currentUser?.verificationStatus || '').toLowerCase().includes('pending');
  const application = verifiedParent
    ? `<section style="border-top:1px solid var(--border-color);padding-top:14px;"><h3 style="margin:0 0 5px;">Apply to this school</h3><p style="margin:0 0 12px;color:var(--text-muted);font-size:.84rem;">Your verified Little Feet account is required. The application is sent directly to this school’s principal when its school account is active. Do not include medical or other sensitive details here.</p><form onsubmit="submitSchoolApplication(event, ${index})" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;"><label>Parent / guardian name<input name="guardianName" required value="${escapeWorkspaceText(currentUser.name || '')}"></label><label>Contact email<input name="contactEmail" type="email" required value="${escapeWorkspaceText(currentUser.username || '')}"></label><label>Contact phone<input name="contactPhone" required inputmode="tel"></label><label>Learner name<input name="learnerName" required></label><label>Date of birth<input name="dateOfBirth" type="date" required></label><label>Age group / intended grade<input name="gradeOrAgeGroup" required placeholder="e.g. Grade R / Toddler"></label><label>Intended start date<input name="intendedStart" type="date" required></label><label>Home area / suburb<input name="homeArea" required></label><label style="grid-column:1/-1;">Application note<textarea name="notes" required rows="3" placeholder="Why you are applying, preferred contact time, and any non-sensitive information the school should know."></textarea></label><label style="grid-column:1/-1;display:flex;gap:8px;align-items:flex-start;"><input type="checkbox" required> I confirm these details are accurate and I am authorised to apply for this learner.</label><button class="submit-btn" style="grid-column:1/-1;">Send application to principal</button></form></section>`
    : `<section style="border-top:1px solid var(--border-color);padding-top:14px;"><h3 style="margin:0 0 5px;">Apply to this school</h3><p style="margin:0;color:var(--text-muted);">Applications require an active, verified parent account. Sign in with your approved Little Feet parent account first.</p></section>`;
  openModal('School details', `<div style="display:grid;gap:12px;"><div><h3 style="margin:0 0 5px;">${escapeWorkspaceText(school.name)}</h3><p style="margin:0;color:var(--text-muted);">${escapeWorkspaceText(detail.category || 'Education facility')} · ${escapeWorkspaceText(detail.street || 'Address not listed')}, ${escapeWorkspaceText(detail.suburb || '')}, ${escapeWorkspaceText(detail.town || '')}</p></div><div><label>Coordinates</label><input id="schoolCoordinates" readonly value="${coordinates}"><button type="button" class="action-btn btn-blue" style="margin-top:8px;" onclick="navigator.clipboard?.writeText(document.getElementById('schoolCoordinates').value); this.textContent='Copied'">Copy coordinates</button></div>${application}</div>`);
}
async function submitSchoolApplication(event, index) {
  event.preventDefault();
  const school = nearbySchoolRecords[index];
  if (!school) return;
  const form = event.currentTarget;
  const value = name => String(form.elements[name]?.value || '').trim();
  try {
    const response = await fetch('/api/school-applications', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ schoolName: school.name, guardianName: value('guardianName'), contactEmail: value('contactEmail'), contactPhone: value('contactPhone'), learnerName: value('learnerName'), dateOfBirth: value('dateOfBirth'), gradeOrAgeGroup: value('gradeOrAgeGroup'), intendedStart: value('intendedStart'), homeArea: value('homeArea'), notes: value('notes') }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to send the school application.');
    closeModal();
    alert(`Application sent to ${result.ticket.assignedTo}. Your application reference is ${result.ticket.id}.`);
    loadTickets();
  } catch (error) { alert(error.message || 'Unable to send the school application.'); }
}

async function enrichSchoolPin(button, schoolName, latitude, longitude) {
  const panel = button?.closest('.school-enrichment');
  if (!panel) return;
  button.disabled = true;
  button.textContent = 'Checking verified details…';
  try {
    const response = await fetch('/api/schools/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: schoolName, latitude, longitude })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Verified public lookup was unavailable.');
    const escape = value => escapeWorkspaceText(value || 'Not publicly listed');
    const website = /^https:\/\//i.test(result.website || '') ? `<a href="${escape(result.website)}" target="_blank" rel="noopener noreferrer">Visit school website</a>` : 'Not publicly listed';
    panel.innerHTML = `<p style="font-size:.8rem;margin:0;"><strong>Verified public details</strong><br><strong>Address:</strong> ${escape(result.address)}<br><strong>Phone:</strong> ${result.phone ? `<a href="tel:${escape(result.phone)}">${escape(result.phone)}</a>` : 'Not publicly listed'}<br><strong>Website:</strong> ${website}</p><p class="school-muted" style="font-size:.72rem;margin:6px 0 0;">Source: ${escape(result.source)}. Review public details with the school before relying on them.</p>`;
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Check verified public details';
    const notice = document.createElement('p');
    notice.className = 'school-muted';
    notice.style.cssText = 'font-size:.72rem;margin:6px 0 0;';
    notice.textContent = error.message;
    panel.querySelector('.school-enrichment-error')?.remove();
    notice.classList.add('school-enrichment-error');
    panel.append(notice);
  }
}

// Posts
async function loadPosts() {
  try {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    document.getElementById('postList').innerHTML = posts.length
      ? posts.map(p => `
          <div class="item-row" style="flex-direction: column; align-items: flex-start;">
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <span class="badge-tag info">Audience: ${p.audience || 'All'}</span>
                <p style="font-size:0.95rem; margin-top:6px; color: var(--text-dark);">${p.caption}</p>
              </div>
              <button type="button" onclick="deletePost('${p.id}')" class="action-btn btn-red">🗑️ Delete</button>
            </div>
            ${p.mediaUrl ? `<img src="${p.mediaUrl}" class="post-item" onclick="openModal('Media File Preview', '<img src=\\'${p.mediaUrl}\\' style=\\'max-width:100%; max-height:80vh; object-fit:contain; border-radius:6px;\\'>')">` : ''}
            <div class="meta"><span>Posted by Staff (${p.createdAt || 'Recent'})</span></div>
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No updates published yet.</p>';
  } catch (err) {
    logAppError('ERR_POST_001', 'Failed to retrieve Activity Feed posts.');
  }
}

async function deletePost(id) {
  if (!confirm('Are you sure you want to delete this activity post?')) return;
  await fetch(`/api/posts/${id}`, { method: 'DELETE' });
  loadPosts();
}

const postForm = document.getElementById('postForm');
if (postForm) {
  postForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('postMedia').files[0];
    const mediaUrl = file ? await toBase64(file) : null;
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
async function loadSchedules() {
  try {
    const res = await fetch('/api/schedules');
    const list = await res.json();
    document.getElementById('scheduleList').innerHTML = list.length
      ? list.map(s => `
          <div class="item-row">
            <div>
              <span class="badge-tag">${s.dayOfWeek}</span>
              <strong>${s.studentName}</strong> - <span style="color:#0d9488; font-weight:600;">${s.timeSlot}</span>
              <p style="font-size:0.88rem; margin-top:4px; color: var(--text-muted);">Activity / Subject: ${s.activity}</p>
            </div>
            <button type="button" onclick="deleteSchedule('${s.id}')" class="action-btn btn-red">🗑️ Delete</button>
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No active schedule records found.</p>';
  } catch (err) {
    logAppError('ERR_SCHED_001', 'Could not load student schedules.');
  }
}

async function deleteSchedule(id) {
  if (!confirm('Delete this submitted schedule record?')) return;
  await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
  loadSchedules();
}

const scheduleForm = document.getElementById('scheduleForm');
if (scheduleForm) {
  scheduleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      studentName: document.getElementById('schStudentName').value,
      dayOfWeek: document.getElementById('schDay').value,
      timeSlot: document.getElementById('schTime').value,
      activity: document.getElementById('schActivity').value
    };
    await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    scheduleForm.reset();
    loadSchedules();
  });
}

async function exportScheduleExcel() {
  const res = await fetch('/api/schedules');
  const list = await res.json();
  if (!list.length) return alert('No schedules available to export.');

  const exportData = list.map(s => ({
    "ID": s.id,
    "Student Name": s.studentName,
    "Day of Week": s.dayOfWeek,
    "Time Slot Block": s.timeSlot,
    "Activity Module": s.activity
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Test Results Schedule");
  XLSX.writeFile(workbook, "LittleFeet_TestResultsSchedule.xlsx");
}

async function importScheduleExcel() {
  const fileInput = document.getElementById('excelFileInput');
  const file = fileInput ? fileInput.files[0] : null;
  if (!file) {
    logAppError('ERR_FILE_404', 'Excel file import attempted without selecting a file.');
    return alert('Select a valid Excel (.xlsx / .xls) or CSV file.');
  }

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const schedules = rows.slice(1).map(row => ({
        id: row[0] ? String(row[0]) : Date.now().toString(),
        studentName: row[1] || '',
        dayOfWeek: row[2] || 'Monday',
        timeSlot: row[3] || '',
        activity: row[4] || ''
      })).filter(s => s.studentName.trim() !== '');

      const res = await fetch('/api/schedules/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedules })
      });

      if (!res.ok) throw new Error('Backend failed to parse Excel rows.');

      alert('Excel batch sync complete!');
      fileInput.value = '';
      loadSchedules();
    } catch (err) {
      logAppError('ERR_EXCEL_400', 'File cannot be read: corrupt format or invalid worksheet columns.');
      alert('Error reading Excel spreadsheet file.');
    }
  };
  reader.readAsArrayBuffer(file);
}

// Worksheets
async function loadWorksheets() {
  try {
    const res = await fetch('/api/worksheets');
    const list = await res.json();
    document.getElementById('worksheetList').innerHTML = list.length
      ? list.map(w => `
          <div class="item-row" style="flex-direction: column; align-items: flex-start;">
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
              <div>
                <strong>${w.studentName}</strong> — ${w.title} 
                <span class="badge-tag" style="background-color: #16a34a; margin-left: 6px;">Score: ${w.grade}%</span>
              </div>
              <div>
                ${w.photoUrl ? `<button type="button" onclick="viewWorksheetFile('${w.id}')" class="action-btn btn-blue">👁️ View Attached File</button>` : ''}
                <button type="button" onclick="deleteWorksheet('${w.id}')" class="action-btn btn-red">🗑️ Delete</button>
              </div>
            </div>
            
            <div class="meta" style="margin-top:8px;">
              <span>Submitted By: <strong style="color:var(--primary-color);">${w.submittedBy || 'Educator'}</strong></span>
              <span>• Upload Date: ${w.uploadedAt || 'Recently'}</span>
            </div>
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No graded worksheets uploaded.</p>';
  } catch (err) {
    logAppError('ERR_WS_001', 'Unable to fetch worksheet submissions portfolio.');
  }
}

async function viewWorksheetFile(id) {
  try {
    const res = await fetch('/api/worksheets');
    const list = await res.json();
    const item = list.find(w => w.id === id);
    if (item && item.photoUrl) {
      openModal(`Submission File View: ${item.studentName}`, `
        <div style="text-align:center;">
          <p style="font-size:0.85rem; margin-bottom:10px;">Submitted by: <strong>${item.submittedBy}</strong> | Title: ${item.title}</p>
          <img src="${item.photoUrl}" style="max-width:100%; max-height:75vh; border-radius:6px; border:1px solid var(--border-color); object-fit:contain;">
        </div>
      `);
    } else {
      logAppError('ERR_FILE_404', `File content missing for ID: ${id}`);
      alert('File payload could not be read.');
    }
  } catch (e) {
    logAppError('ERR_WS_404', 'Error retrieving submission file preview.');
  }
}

async function deleteWorksheet(id) {
  if (!confirm('Delete this graded submission file record?')) return;
  await fetch(`/api/worksheets/${id}`, { method: 'DELETE' });
  loadWorksheets();
}

const worksheetForm = document.getElementById('worksheetForm');
if (worksheetForm) {
  worksheetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('wsPhoto').files[0];
    if (!file) return alert('Please select a file to attach.');

    const photoUrl = await toBase64(file);
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
function canManageBadges() {
  return ['teacher', 'principal', 'admin'].includes(currentUser?.role);
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
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading. Please try again in a moment.');
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const workbook = XLSX.read(new Uint8Array(event.target.result), { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const sourceRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
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
      const previewRows = validRows.slice(0, 8).map(row => `<tr><td>${escapeWorkspaceText(row.studentName)}</td><td>${escapeWorkspaceText(row.className)}</td><td>${escapeWorkspaceText(row.parentName || 'Not supplied')}</td><td>${escapeWorkspaceText(row.contactEmail || 'Not supplied')}</td></tr>`).join('');
      preview.innerHTML = `<div class="item-row" style="display:block;"><strong>${validRows.length} valid learner record${validRows.length === 1 ? '' : 's'} detected</strong><p class="meta" style="margin:7px 0 12px;">${rows.length - validRows.length} row${rows.length - validRows.length === 1 ? '' : 's'} need a learner name and class/grade before they can be imported. Only the first eight records are shown below.</p><div style="overflow-x:auto;"><table><thead><tr><th>Learner</th><th>Class</th><th>Parent / guardian</th><th>Contact email</th></tr></thead><tbody>${previewRows || '<tr><td colspan="4">No valid learner rows found.</td></tr>'}</tbody></table></div><button type="button" class="submit-btn" style="margin-top:14px;max-width:330px;" onclick="confirmLearnerDatabaseImport()">Review and import ${validRows.length} record${validRows.length === 1 ? '' : 's'}</button></div>`;
    } catch (error) {
      pendingLearnerImport = [];
      preview.textContent = 'This file could not be read. Download the template to check the expected column headings.';
      logAppError('ERR_IMPORT_FILE_400', error.message || 'The learner import file could not be read.');
    }
  };
  reader.readAsArrayBuffer(file);
}

async function confirmLearnerDatabaseImport() {
  if (!pendingLearnerImport.length) return alert('Preview a valid school register before importing it.');
  if (!confirm(`Import ${pendingLearnerImport.length} learner record${pendingLearnerImport.length === 1 ? '' : 's'}? Existing matches will not be overwritten.`)) return;
  const response = await fetch('/api/students/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorUsername: currentUser?.username, students: pendingLearnerImport })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'The learner import could not be completed.');
  const duplicateSummary = result.rejected?.length ? ` ${result.rejected.length} duplicate or incomplete row${result.rejected.length === 1 ? ' was' : 's were'} skipped.` : '';
  alert(`${result.message}${duplicateSummary}`);
  document.getElementById('schoolDatabaseFile').value = '';
  document.getElementById('schoolDatabasePreview').innerHTML = '';
  pendingLearnerImport = [];
  playDingSound();
}

async function loadBadges() {
  try {
    if (!currentUser) return;
    const res = await fetch(`/api/badges?username=${encodeURIComponent(currentUser.username)}`);
    if (!res.ok) throw new Error('Unable to load badges.');
    const list = await res.json();
    const wall = document.getElementById('badgeWallLog');
    if (!wall) return;

    wall.innerHTML = list.length
      ? list.map(b => `
          <div class="item-row" style="justify-content: space-between; align-items: flex-start;">
            <div>
              <span class="badge-tag" style="background:#10b981;">${b.category}</span>
              <strong style="font-size:1.05rem; color:#fff;">${b.title || b.awardName}</strong>
              <span style="color:#a7f3d0;">— ${b.studentName}</span>
              <p style="font-size:0.88rem; margin-top:4px; font-style:italic; color:var(--text-muted);">"${b.note}"</p>
            </div>
            ${canManageBadges() ? `<button type="button" onclick="deleteBadge('${b.id}')" class="action-btn btn-red">🗑️ Delete</button>` : ''}
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No milestone badges awarded yet.</p>';
  } catch (err) {
    logAppError('ERR_BDG_001', 'Failed to render digital badges archive.');
  }
}

const badgeForm = document.getElementById('badgeForm');
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
    loadBadges();
    playDingSound();
  });
}

async function deleteBadge(id) {
  if (!canManageBadges()) return alert('Only authorised school staff can remove badges.');
  if (!confirm('Are you sure you want to delete this awarded badge?')) return;
  const response = await fetch(`/api/badges/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username }) });
  if (!response.ok) {
    const result = await response.json();
    return alert(result.message || 'Unable to remove this badge.');
  }
  loadBadges();
}

// Analytics
const analyticsSearchForm = document.getElementById('analyticsSearchForm');
if (analyticsSearchForm) {
  analyticsSearchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputEl = currentUser?.role === 'parent' ? document.getElementById('analyticsStudentSelect') : document.getElementById('analyticsStudent');
    const studentName = inputEl.value.trim();

    try {
      const res = await fetch(`/api/analytics/${encodeURIComponent(studentName)}?username=${encodeURIComponent(currentUser?.username || '')}`);
      const data = await res.json();
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
async function loadAttendance() {
  try {
    const res = await fetch('/api/attendance');
    if (!res.ok) throw new Error('Attendance backend unreadable');
    const list = await res.json();

    document.getElementById('attendanceList').innerHTML = list.length
      ? list.map(a => `
          <div class="item-row">
            <div>
              <strong>${a.studentName}</strong> <span class="meta" style="display:inline;">(${a.status} at ${a.timestamp || 'Today'})</span>
            </div>
            <div>
              <button type="button" onclick="toggleAttendance('${a.id}', '${a.status === 'Checked In' ? 'Checked Out' : 'Checked In'}')" class="action-btn ${a.status === 'Checked In' ? 'btn-red' : 'btn-green'}">
                ${a.status === 'Checked In' ? 'Mark Out' : 'Mark In'}
              </button>
              <button type="button" onclick="removeAttendance('${a.id}')" class="action-btn btn-red" style="padding: 4px 8px; font-size: 0.75rem;">🗑️ Delete</button>
            </div>
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No students checked in today.</p>';
  } catch (err) {
    logAppError('ERR_ATT_500', 'Failed to render Attendance Registry roster.');
  }
}

async function importAttendanceExcel() {
  const fileInput = document.getElementById('attExcelFileInput');
  const file = fileInput ? fileInput.files[0] : null;
  if (!file) {
    logAppError('ERR_FILE_404', 'Attendance file import attempted without selecting a file.');
    return alert('Select a valid Excel (.xlsx / .xls) or CSV file.');
  }

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const attendanceData = rows.slice(1).map(row => ({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
        studentName: row[0] ? String(row[0]).trim() : '',
        status: row[1] && String(row[1]).trim() ? String(row[1]).trim() : 'Checked In',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })).filter(a => a.studentName !== '');

      const res = await fetch('/api/attendance/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance: attendanceData })
      });

      if (!res.ok) throw new Error('Backend failed to parse Excel rows.');

      alert('Attendance Excel Sheet imported successfully!');
      fileInput.value = '';
      loadAttendance();
    } catch (err) {
      logAppError('ERR_EXCEL_400', 'File cannot be read: corrupt format or invalid worksheet columns.');
      alert('Error reading Attendance Excel spreadsheet file.');
    }
  };
  reader.readAsArrayBuffer(file);
}

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

async function toggleAttendance(id, status) {
  await fetch('/api/attendance/toggle', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ id, status }) 
  });
  loadAttendance();
}

async function removeAttendance(id) {
  if (!confirm('Are you sure you want to delete this attendance record?')) return;
  await fetch(`/api/attendance/${id}`, { method: 'DELETE' });
  loadAttendance();
}

async function clearAttendanceRegistry() {
  if (!confirm("Are you sure you want to clear Today's Attendance Registry?")) return;
  await fetch('/api/attendance/clear', { method: 'POST' });
  loadAttendance();
}

// Support Tickets Archive & Queue
function ticketCanBeManaged(ticket) {
  return currentUser?.role === 'admin' || String(ticket.assignedTo || '').toLowerCase() === String(currentUser?.username || '').toLowerCase();
}

function showTicketNotification(ticket) {
  const notice = document.createElement('div');
  notice.className = 'ticket-toast';
  notice.setAttribute('role', 'status');
  notice.innerHTML = `<strong>🎫 New ticket assigned</strong><span>${escapeWorkspaceText(ticket.subject || 'Support request')}</span>`;
  document.body.appendChild(notice);
  window.setTimeout(() => notice.remove(), 8000);
}

function renderTicketAssigneeOptions(selectId, query = '', selected = '') {
  const select = document.getElementById(selectId);
  if (!select) return;
  const search = String(query || '').trim().toLowerCase();
  const schoolAccounts = ticketAssigneeAccounts.filter(account => {
    const matchesSearch = !search || `${account.name || ''} ${account.username || ''}`.toLowerCase().includes(search);
    return account.username !== currentUser?.username && account.schoolName === currentUser?.schoolName && matchesSearch;
  });
  const roleGroups = [['teacher', 'Teachers'], ['principal', 'Principals'], ['parent', 'Parents']];
  const groupedOptions = roleGroups.map(([role, label]) => {
    const people = schoolAccounts.filter(account => account.role === role);
    return people.length ? `<optgroup label="${label}">${people.map(account => `<option value="${escapeWorkspaceText(account.username)}">${escapeWorkspaceText(account.name || account.username)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  select.innerHTML = `<option value="">Unassigned</option>${groupedOptions}`;
  select.value = [...select.options].some(option => option.value === selected) ? selected : '';
}

function filterTicketAssignees(searchId, selectId) {
  const search = document.getElementById(searchId)?.value || '';
  const selected = document.getElementById(selectId)?.value || '';
  renderTicketAssigneeOptions(selectId, search, selected);
}

async function loadTicketAssignees() {
  if (!document.getElementById('ticketAssignee') || currentUser?.role !== 'admin') return;
  try {
    const response = await fetch(`/api/accounts?actorUsername=${encodeURIComponent(currentUser.username)}`);
    const accounts = await response.json();
    if (!response.ok) return;
    const selected = document.getElementById('ticketAssignee').value;
    ticketAssigneeAccounts = accounts;
    renderTicketAssigneeOptions('ticketAssignee', document.getElementById('ticketAssigneeSearch')?.value || '', selected);
  } catch { /* The ticket form remains available without preloading assignees. */ }
}

async function loadTickets(checkForNew = false) {
  try {
    if (!currentUser) return;
    const res = await fetch(`/api/tickets?username=${encodeURIComponent(currentUser.username)}`);
    const tickets = await res.json();
    if (!res.ok) throw new Error('Unable to fetch tickets.');
    const assignedTickets = tickets.filter(ticket => String(ticket.assignedTo || '').toLowerCase() === String(currentUser.username).toLowerCase());
    const newTickets = assignedTickets.filter(ticket => !knownTicketIds.has(ticket.id));
    if (ticketsLoaded && checkForNew && newTickets.length) { showTicketNotification(newTickets[0]); playTicketAlert(); }
    tickets.forEach(ticket => knownTicketIds.add(ticket.id));
    ticketsLoaded = true;
    const filter = document.getElementById('ticketDeptFilter').value;

    const filtered = tickets.filter(t => filter === 'All' || t.department === filter);
    const active = filtered.filter(t => t.status !== 'Completed');
    const completed = filtered.filter(t => t.status === 'Completed');

    document.getElementById('ticketList').innerHTML = active.length
      ? active.map(t => `
          <div class="item-row" style="flex-direction: column; align-items: flex-start;">
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <span class="badge-tag">${t.department}</span> 
                <span class="badge-tag urgent">${t.priority} Priority</span>
                <strong>${t.subject}</strong>
                <p class="meta" style="margin-top:5px;">${t.assignedTo ? `Assigned to: ${escapeWorkspaceText(t.assignedTo)}` : 'Unassigned'}</p>
              </div>
              ${currentUser?.role === 'admin' ? `<button type="button" onclick="deleteTicket('${t.id}')" class="action-btn btn-red">🗑️ Delete</button>` : ''}
            </div>
            <p style="margin-top:6px; font-size:0.88rem; color:var(--text-muted);">${t.message}</p>
            ${t.application ? `<div style="width:100%;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);font-size:.82rem;line-height:1.55;"><strong>Application details</strong><br><strong>Parent / guardian:</strong> ${escapeWorkspaceText(t.application.guardianName)} · ${escapeWorkspaceText(t.application.contactPhone)} · ${escapeWorkspaceText(t.application.contactEmail)}<br><strong>Learner:</strong> ${escapeWorkspaceText(t.application.learnerName)} · DOB ${escapeWorkspaceText(t.application.dateOfBirth)} · ${escapeWorkspaceText(t.application.gradeOrAgeGroup)}<br><strong>Start date:</strong> ${escapeWorkspaceText(t.application.intendedStart)} · <strong>Area:</strong> ${escapeWorkspaceText(t.application.homeArea)}<br><strong>Note:</strong> ${escapeWorkspaceText(t.application.notes)}</div>` : ''}
            ${t.feedback ? `<div style="background:var(--input-bg); padding:8px; border-radius:4px; font-size:0.8rem; margin-top:6px; color:#2dd4bf; border: 1px solid var(--border-color);"><strong>Feedback from ${t.updatedBy}:</strong> ${t.feedback}</div>` : ''}
            ${ticketCanBeManaged(t) ? `<div style="margin-top: 8px;">
              <button type="button" onclick="editTicketModal('${t.id}', '${t.status}', '${encodeURIComponent(t.feedback || '')}', '${encodeURIComponent(t.assignedTo || '')}')" class="action-btn btn-blue">✏️ Edit & Respond</button>
            </div>` : ''}
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No active tickets in queue.</p>';

    const grouped = {};
    completed.forEach(t => {
      const monthKey = t.monthCategory || 'August 2026';
      if (!grouped[monthKey]) grouped[monthKey] = [];
      grouped[monthKey].push(t);
    });

    let completedHtml = '';
    for (const [month, list] of Object.entries(grouped)) {
      completedHtml += `<h3 style="font-size:0.95rem; color:var(--primary-color); margin: 15px 0 8px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">📅 Submitted Category: ${month}</h3>`;
      completedHtml += list.map(t => `
        <div class="item-row" style="opacity: 0.85; flex-direction: column; align-items: flex-start;">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
            <div><span class="badge-tag" style="background:#16a34a;">Completed</span> <strong>${t.subject}</strong></div>
            ${currentUser?.role === 'admin' ? `<button type="button" onclick="deleteTicket('${t.id}')" class="action-btn btn-red">🗑️ Delete</button>` : ''}
          </div>
          <p style="font-size:0.85rem; margin-top:4px;">${t.message}</p>
          ${t.feedback ? `<p style="font-size:0.78rem; color:#2dd4bf;">Feedback: ${t.feedback}</p>` : ''}
        </div>
      `).join('');
    }

    document.getElementById('completedTicketList').innerHTML = completedHtml || '<p style="font-size:0.85rem; color:var(--text-muted);">No completed tickets archived.</p>';
  } catch (err) {
    logAppError('ERR_TCK_001', 'Failed to fetch Support Desk tickets.');
  }
}

async function deleteTicket(id) {
  if (currentUser?.role !== 'admin') return alert('Only an administrator can delete support tickets.');
  if (!confirm('Are you sure you want to delete this support ticket?')) return;
  const response = await fetch(`/api/tickets/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username }) });
  if (!response.ok) return alert('Unable to delete this ticket.');
  loadTickets();
}

const ticketForm = document.getElementById('ticketForm');
if (ticketForm) {
  ticketForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      id: Date.now().toString(),
      department: document.getElementById('ticketDept').value,
      priority: document.getElementById('ticketPriority').value,
      subject: document.getElementById('ticketSubject').value,
      message: document.getElementById('ticketMessage').value,
      createdBy: currentUser?.username,
      assignedTo: currentUser?.role === 'admin' ? document.getElementById('ticketAssignee')?.value : ''
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

function editTicketModal(id, currentStatus, encodedFeedback, encodedAssignee) {
  const currentFeedback = decodeURIComponent(encodedFeedback || '');
  const currentAssignee = decodeURIComponent(encodedAssignee || '');
  const html = `
    <form id="editTicketForm">
      <div>
        <label>Admin Feedback & Notes</label>
        <textarea id="editFeedback" rows="3" required>${currentFeedback || ''}</textarea>
      </div>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
        <input type="checkbox" id="editCompleted" ${currentStatus === 'Completed' ? 'checked' : ''} style="width:auto; margin-bottom:0;">
        <label for="editCompleted" style="margin-bottom:0;">Mark Ticket as Completed</label>
      </div>
      ${currentUser?.role === 'admin' ? '<div><label for="editTicketAssigneeSearch">Find an account</label><input id="editTicketAssigneeSearch" type="search" placeholder="Search a teacher, principal, or parent" oninput="filterTicketAssignees(\'editTicketAssigneeSearch\', \'editTicketAssignee\')"><label for="editTicketAssignee">Assign to account</label><select id="editTicketAssignee"><option value="">Unassigned</option></select></div>' : ''}
      <button type="submit" class="submit-btn">Save Ticket Resolution</button>
    </form>`;
  openModal('Edit Support Ticket', html);
  if (currentUser?.role === 'admin') loadTicketAssignees().then(() => renderTicketAssigneeOptions('editTicketAssignee', '', currentAssignee));

  document.getElementById('editTicketForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = document.getElementById('editFeedback').value;
    const status = document.getElementById('editCompleted').checked ? 'Completed' : 'Open';
    const response = await fetch('/api/tickets/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, feedback, updatedBy: currentUser ? currentUser.username : 'Admin', assignedTo: currentUser?.role === 'admin' ? document.getElementById('editTicketAssignee')?.value : undefined })
    });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to update this ticket.');
    closeModal();
    loadTickets();
    playDingSound();
  });
}

// Emergency Broadcasts
async function loadBroadcasts() {
  try {
    const userPosition = await getCurrentPositionQuietly();
    const locationQuery = userPosition ? `?lat=${encodeURIComponent(userPosition.latitude)}&lng=${encodeURIComponent(userPosition.longitude)}` : '';
    const res = await fetch(`/api/broadcasts${locationQuery}`);
    const broadcasts = await res.json();
    const listEl = document.getElementById('broadcastList');
    if (!listEl) return;

    if (!res.ok) throw new Error(broadcasts.message || 'Unable to load safety alerts.');
    const visibleBroadcasts = broadcasts;

    const knownAlertIds = new Set(JSON.parse(localStorage.getItem('lf_known_alert_ids') || '[]'));
    const newApplicableAlerts = visibleBroadcasts.filter(alert => !knownAlertIds.has(alert.id));
    if (broadcastsLoaded && newApplicableAlerts.length) playDingSound();
    visibleBroadcasts.forEach(alert => knownAlertIds.add(alert.id));
    localStorage.setItem('lf_known_alert_ids', JSON.stringify([...knownAlertIds].slice(-100)));
    broadcastsLoaded = true;

    listEl.innerHTML = visibleBroadcasts.length
      ? visibleBroadcasts.map(b => `
          <div class="item-row" style="border-left-color: #dc2626; flex-direction: column; align-items: flex-start;">
            <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
              <span class="badge-tag urgent">${b.bcPriority || 'Urgent Notice'}</span>
              <div style="display:flex;gap:8px;align-items:center;"><span class="meta">${b.timestamp || 'Recent'}${b.radiusKm ? ` · ${b.radiusKm}km area` : ''}</span>${['admin','principal'].includes(currentUser?.role) ? `<button type="button" onclick="deleteBroadcast('${b.id}')" class="action-btn btn-red" style="margin:0;padding:4px 8px;">Delete</button>` : ''}</div>
            </div>
            <p style="margin-top:6px; font-size:0.92rem; color:var(--text-dark);">${b.bcMessage}</p>
            <div style="margin-top:7px;"><button type="button" onclick="markBroadcastRead('${b.id}')" class="action-btn btn-blue" style="padding:4px 8px;display:${['admin','principal'].includes(currentUser?.role) ? 'none' : 'inline-block'};">Mark as read</button><span class="meta" style="margin-left:8px;display:${['admin','principal'].includes(currentUser?.role) ? 'inline' : 'none'};">${b.readBy?.length || 0} recipient acknowledgement(s)</span></div>
          </div>
        `).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No alerts apply to your current location.</p>';
  } catch (e) {
    logAppError('ERR_BC_001', 'Unable to fetch campus broadcast alerts.');
  }
}

async function loadSafetyNetwork() {
  const summary = document.getElementById('safetyNetworkSummary');
  const visitorList = document.getElementById('safetyNetworkVisitors');
  if (!summary || !['admin', 'principal'].includes(currentUser?.role)) return;
  try {
    const response = await fetch('/api/safety-network');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load campus safety status.');
    summary.innerHTML = [["Learners marked present", data.presentLearners], ["Visitors on campus", data.visitorsOnCampus], ["Active broadcasts", data.activeBroadcasts], ["Alert acknowledgements", data.acknowledgements]].map(([label, value]) => `<div class="workspace-card"><h3>${value}</h3><p>${label}</p></div>`).join('');
    visitorList.innerHTML = data.visitors.length ? `<h3 class="workspace-heading">Currently on campus</h3>${data.visitors.map(visitor => `<div class="item-row"><div><strong>${escapeWorkspaceText(visitor.visitorName)}</strong><p style="margin-top:4px;">Host: ${escapeWorkspaceText(visitor.host || 'School office')} · ${escapeWorkspaceText(visitor.purpose)}</p><span class="meta">Checked in ${new Date(visitor.checkedInAt).toLocaleString()}</span></div><button type="button" class="action-btn btn-blue" onclick="checkOutCampusVisitor('${visitor.id}')">Check out</button></div>`).join('')}` : '<p class="meta">No approved visitors are currently checked in.</p>';
  } catch (error) { summary.innerHTML = `<p class="meta">${escapeWorkspaceText(error.message)}</p>`; }
}

async function loadVisitorMeetingRecipients() {
  const select = document.getElementById('visitorMeetingHost');
  if (!select || currentUser?.role !== 'parent') return;
  try {
    const response = await fetch('/api/visitor-meetings/recipients');
    const people = await response.json();
    if (!response.ok) throw new Error(people.message || 'Unable to load meeting recipients.');
    select.innerHTML = '<option value="">Choose teacher or principal</option>' + people.map(person => `<option value="${escapeWorkspaceText(person.username)}">${escapeWorkspaceText(person.name || person.username)} · ${escapeWorkspaceText(person.role)}</option>`).join('');
  } catch { select.innerHTML = '<option value="">No authorised staff available</option>'; }
}

async function loadVisitorMeetings() {
  const list = document.getElementById('visitorMeetingList');
  if (!list || !['parent','teacher','principal','admin'].includes(currentUser?.role)) return;
  try {
    const response = await fetch('/api/visitor-meetings');
    const meetings = await response.json();
    if (!response.ok) throw new Error(meetings.message || 'Unable to load meeting requests.');
    list.innerHTML = meetings.length ? meetings.map(meeting => {
      const status = String(meeting.status || '').replaceAll('-', ' ');
      let actions = '';
      if (currentUser.role === 'teacher' && meeting.status === 'awaiting-teacher-response') actions = `<button type="button" class="action-btn btn-green" onclick="respondVisitorMeeting('${meeting.id}','accept')">Accept time</button><button type="button" class="action-btn btn-blue" onclick="respondVisitorMeeting('${meeting.id}','counter')">Counter-offer</button>`;
      if (currentUser.role === 'parent' && meeting.status === 'awaiting-parent-confirmation') actions = `<button type="button" class="action-btn btn-green" onclick="confirmVisitorMeeting('${meeting.id}')">Confirm agreed time</button>`;
      if (['principal','admin'].includes(currentUser.role) && meeting.status === 'awaiting-principal-approval') actions = `<button type="button" class="action-btn btn-green" onclick="approveVisitorMeeting('${meeting.id}')">Approve & issue QR pass</button>`;
      return `<div class="item-row"><div><strong>${escapeWorkspaceText(meeting.parentName)} → ${escapeWorkspaceText(meeting.hostName)}</strong><p style="margin-top:4px;">${escapeWorkspaceText(meeting.purpose)}<br>Meeting: ${escapeWorkspaceText(meeting.agreedAt || meeting.proposedAt)}</p><span class="meta">Status: ${escapeWorkspaceText(status)}</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;">${actions}</div></div>`;
    }).join('') : '<p class="meta">No meeting requests are waiting for your action.</p>';
  } catch (error) { list.textContent = error.message || 'Unable to load meeting requests.'; }
}

async function respondVisitorMeeting(id, action) {
  let agreedAt = '';
  if (action === 'counter') { agreedAt = prompt('Enter the alternative meeting date and time (for example 2026-09-05 14:30):') || ''; if (!agreedAt) return; }
  const response = await fetch(`/api/visitor-meetings/${encodeURIComponent(id)}/respond`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, agreedAt }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to update this meeting.');
  playDingSound(); loadVisitorMeetings();
}

async function confirmVisitorMeeting(id) {
  const response = await fetch(`/api/visitor-meetings/${encodeURIComponent(id)}/confirm`, { method:'POST' });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to confirm this meeting.');
  playDingSound(); loadVisitorMeetings();
}

async function approveVisitorMeeting(id) {
  const response = await fetch(`/api/visitor-meetings/${encodeURIComponent(id)}/approve-visitor`, { method:'POST' });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to approve visitor entry.');
  playDingSound(); loadVisitorMeetings(); loadSafetyNetwork(); printVisitorPass(result.visitor, result.passCode);
}

async function checkInCampusVisitor() {
  const field = document.getElementById('visitorPassCode');
  const response = await fetch('/api/campus-visitors/check-in', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ passCode: field?.value || '' }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Visitor entry could not be validated.');
  if (field) field.value = ''; playDingSound(); loadSafetyNetwork(); alert(`${result.visitor.visitorName} is checked in.`);
}

async function checkOutCampusVisitor(id) {
  const response = await fetch(`/api/campus-visitors/${encodeURIComponent(id)}/check-out`, { method:'POST' });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Visitor check-out failed.');
  loadSafetyNetwork();
}

async function printVisitorPass(visitor, passCode) {
  const safe = escapeWorkspaceText;
  let qrImage = '';
  if (window.QRCode) {
    const holder = document.createElement('div');
    new window.QRCode(holder, { text: passCode, width: 180, height: 180, correctLevel: window.QRCode.CorrectLevel.M });
    await new Promise(resolve => setTimeout(resolve, 80));
    qrImage = holder.querySelector('canvas')?.toDataURL('image/png') || holder.querySelector('img')?.src || '';
  }
  const popup = window.open('', '_blank', 'width=760,height=900');
  if (!popup) return alert('Allow pop-ups for Little Feet to print the visitor ticket.');
  popup.document.write(`<!doctype html><title>Little Feet Visitor Pass</title><style>body{font-family:Arial;padding:36px;color:#102a43}.pass{max-width:620px;border:3px solid #0d9488;border-radius:18px;padding:30px}.code{font-size:28px;letter-spacing:3px;font-weight:bold;color:#0f766e;padding:18px 0;border-top:1px dashed #0d9488;border-bottom:1px dashed #0d9488}.qr{width:180px;height:180px;display:block;margin:20px auto}.meta{color:#526d82;line-height:1.6}@media print{body{padding:0}}</style><main class="pass"><p> LITTLE FEET · AUTHORISED VISITOR</p><h1>Campus visitor ticket</h1><p><strong>${safe(visitor.visitorName)}</strong><br>${safe(visitor.purpose)}<br>Host: ${safe(visitor.host || 'School office')}<br>Meeting: ${safe(visitor.expectedDate)}</p>${qrImage ? `<img class="qr" src="${qrImage}" alt="QR visitor pass">` : ''}<div class="code">${safe(passCode)}</div><p class="meta">Present this QR ticket at the gate. Security validates it with Little Feet before admitting the visitor. It is single-use and becomes invalid once checked in.</p></main><script>window.onload=()=>window.print();<\/script>`); popup.document.close();
}

function stopVisitorQrScan() {
  visitorScannerStream?.getTracks().forEach(track => track.stop());
  visitorScannerStream = null;
  closeModal();
}

async function scanVisitorPassCode() {
  if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) return alert('This device does not support camera QR scanning. Enter the visitor pass code shown beneath the QR image instead.');
  try {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    openModal('Scan visitor QR ticket', '<p class="meta" style="margin:0 0 10px;">Hold the school-issued QR ticket inside the frame. The server will still validate it before entry is recorded.</p><video id="visitorScannerVideo" autoplay playsinline style="width:100%;border-radius:10px;background:#07111e;"></video><button type="button" class="action-btn btn-blue" style="margin-top:12px;" onclick="stopVisitorQrScan()">Cancel scan</button>');
    visitorScannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    const video = document.getElementById('visitorScannerVideo');
    if (!video) return stopVisitorQrScan();
    video.srcObject = visitorScannerStream;
    const scanFrame = async () => {
      if (!visitorScannerStream || !video.videoWidth) return visitorScannerStream && requestAnimationFrame(scanFrame);
      try {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue) {
          const field = document.getElementById('visitorPassCode');
          if (field) field.value = codes[0].rawValue.trim().toUpperCase();
          stopVisitorQrScan();
          return;
        }
      } catch { /* Continue scanning while the camera frame settles. */ }
      if (visitorScannerStream) requestAnimationFrame(scanFrame);
    };
    video.onloadedmetadata = () => requestAnimationFrame(scanFrame);
  } catch {
    stopVisitorQrScan();
    alert('Camera access was unavailable. Enter the visitor pass code manually.');
  }
}

// Chat System Operations
function switchChatMode(mode) {
  if (currentUser?.role === 'parent' && mode === 'group') mode = 'direct';
  const groupSec = document.getElementById('groupChatSection');
  const directSec = document.getElementById('directChatSection');
  const btnGroup = document.getElementById('btnGroupChatMode');
  const btnDirect = document.getElementById('btnDirectChatMode');

  if (mode === 'group') {
    groupSec.classList.remove('hidden');
    directSec.classList.add('hidden');
    btnGroup.style.opacity = '1';
    btnDirect.style.opacity = '0.65';
  } else {
    groupSec.classList.add('hidden');
    directSec.classList.remove('hidden');
    btnGroup.style.opacity = '0.65';
    btnDirect.style.opacity = '1';
    loadDirectChatUsers();
  }
}

async function loadChatGroups() {
  try {
    const res = await fetch('/api/chat/groups');
    const groups = await res.json();
    const select = document.getElementById('chatGroupSelect');
    if (!select) return;

    select.innerHTML = groups.map(g => `<option value="${g.id}">${g.groupName}</option>`).join('');
    
    const delBtn = document.getElementById('btnDeleteGroup');
    if (delBtn && currentUser && currentUser.role === 'admin') {
      if (select.value === 'general') {
        delBtn.classList.add('hidden');
      } else {
        delBtn.classList.remove('hidden');
      }
    }
  } catch (e) {
    logAppError('ERR_CHAT_GRP', 'Failed to retrieve staff chat groups.');
  }
}

async function loadGroupChatMessages() {
  const select = document.getElementById('chatGroupSelect');
  if (!select) return;
  const groupId = select.value;

  const delBtn = document.getElementById('btnDeleteGroup');
  if (delBtn && currentUser && currentUser.role === 'admin') {
    if (groupId === 'general') {
      delBtn.classList.add('hidden');
    } else {
      delBtn.classList.remove('hidden');
    }
  }

  try {
    const res = await fetch(`/api/chat/messages/${groupId}`);
    const msgs = await res.json();
    const chatBox = document.getElementById('chatMessages');

    chatBox.innerHTML = msgs.length
      ? msgs.map(m => {
          const isMe = currentUser && m.sender === currentUser.username;
          const moderation = currentUser?.role === 'admin' && m.id
            ? `<button type="button" class="chat-delete-btn" onclick="deleteGroupChatMessage('${groupId}','${m.id}')">Delete</button>` : '';
          return `
            <div class="msg ${isMe ? 'sent' : 'received'}">
              <strong style="color:${m.textColor || 'inherit'};">${escapeWorkspaceText(m.sender)}:</strong> ${escapeWorkspaceText(m.message)}
              <span class="msg-timestamp">${escapeWorkspaceText(m.timestamp || '')}</span>${moderation}
            </div>`;
        }).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No messages in this channel yet.</p>';
    
    chatBox.scrollTop = chatBox.scrollHeight;
  } catch (e) {
    logAppError('ERR_CHAT_MSG', 'Unable to fetch group messages.');
  }
}

async function deleteGroupChatMessage(groupId, messageId) {
  if (!currentUser || currentUser.role !== 'admin' || !confirm('Delete this chat message?')) return;
  const response = await fetch(`/api/chat/messages/${encodeURIComponent(groupId)}/${encodeURIComponent(messageId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to delete this message.');
  loadGroupChatMessages();
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

  await fetch(`/api/chat/groups/${groupId}`, { method: 'DELETE' });
  await loadChatGroups();
  loadGroupChatMessages();
}

async function loadDirectChatUsers() {
  try {
    if (!currentUser) return;
    const res = await fetch(`/api/chat/direct/users?username=${encodeURIComponent(currentUser.username)}`);
    const users = await res.json();
    const select = document.getElementById('directRecipientSelect');
    if (!select) return;

    if (!res.ok) throw new Error(users.message || 'Unable to load approved contacts.');
    const filtered = users.filter(u => u.username !== currentUser.username);
    const prompt = currentUser.role === 'parent' ? 'Select your child\'s teacher or principal...' : 'Select approved school contact...';
    select.innerHTML = `<option value="">${prompt}</option>` +
      filtered.map(u => `<option value="${u.username}">${u.name || u.username} (${u.role.toUpperCase()})</option>`).join('');
  } catch (e) {
    logAppError('ERR_DIRECT_USERS', 'Failed to retrieve direct messaging contacts.');
  }
}

async function loadDirectChatMessages() {
  const select = document.getElementById('directRecipientSelect');
  if (!select || !select.value || !currentUser) {
    document.getElementById('directChatMessages').innerHTML = '<p style="font-size:0.85rem; color:var(--text-muted);">Please select a target user from the dropdown menu to load direct messages.</p>';
    return;
  }

  const recipient = select.value;
  try {
    const res = await fetch(`/api/chat/direct/${encodeURIComponent(currentUser.username)}/${encodeURIComponent(recipient)}`);
    const msgs = await res.json();
    const box = document.getElementById('directChatMessages');

    box.innerHTML = msgs.length
      ? msgs.map(m => {
          const isMe = m.sender === currentUser.username;
          const moderation = currentUser?.role === 'admin' && m.id
            ? `<button type="button" class="chat-delete-btn" onclick="deleteDirectChatMessage('${m.id}')">Delete</button>` : '';
          return `
            <div class="msg ${isMe ? 'sent' : 'received'}">
              <strong style="color:${m.textColor || 'inherit'};">${escapeWorkspaceText(m.sender)}:</strong> ${escapeWorkspaceText(m.message)}
              <span class="msg-timestamp">${escapeWorkspaceText(m.timestamp || '')}</span>${moderation}
            </div>`;
        }).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No private messages exchange recorded yet.</p>';

    box.scrollTop = box.scrollHeight;
  } catch (e) {
    logAppError('ERR_DIRECT_MSG', 'Unable to fetch private messages.');
  }
}

async function deleteDirectChatMessage(messageId) {
  if (!currentUser || currentUser.role !== 'admin' || !confirm('Delete this private message?')) return;
  const response = await fetch(`/api/chat/direct/${encodeURIComponent(messageId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to delete this message.');
  loadDirectChatMessages();
}

// Global Form Submissions Router
function setupFormListeners() {
  const signingPinForm = document.getElementById('signingPinForm');
  if (signingPinForm) signingPinForm.addEventListener('submit', async event => {
    event.preventDefault();
    const response = await fetch('/api/report-signing-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser?.username, pin: document.getElementById('reportSigningPin').value }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to save signing PIN.');
    signingPinForm.reset(); alert('Signing PIN saved.');
  });

  const reportPublishForm = document.getElementById('reportPublishForm');
  if (reportPublishForm) reportPublishForm.addEventListener('submit', async event => {
    event.preventDefault();
    const signature = reportSignaturePads.teacherSignaturePad;
    if (!signature?.hasStroke()) return alert('Add the teacher signature before publishing.');
    const response = await fetch('/api/report-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentName: document.getElementById('reportStudent').value.trim(), reportTitle: document.getElementById('reportTitle').value.trim(), period: document.getElementById('reportPeriod').value.trim(), parentUsername: document.getElementById('reportParentUsername').value.trim(), teacherUsername: currentUser?.username, signingPin: document.getElementById('reportTeacherPin').value, signatureData: signature.canvas.toDataURL('image/png') }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to publish report.');
    reportPublishForm.reset(); clearSignature('teacherSignaturePad'); loadReportReviews(); playDingSound();
  });

  const accountForm = document.getElementById('accountForm');
  if (accountForm) {
    accountForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const originalUsername = document.getElementById('accountOriginalUsername').value;
      const body = {
        name: document.getElementById('accountName').value.trim(),
        username: document.getElementById('accountUsername').value.trim(),
        pin: document.getElementById('accountPin').value,
        role: document.getElementById('accountRole').value,
        schoolName: document.getElementById('accountSchoolName').value.trim(),
        schoolStoreUrl: document.getElementById('accountStoreUrl').value.trim(),
        assignedClasses: document.getElementById('accountAssignedClasses').value.trim(),
        linkedLearners: document.getElementById('accountLinkedLearners').value.trim(),
        actorUsername: currentUser?.username
      };
      if (!originalUsername && !body.pin) return alert('Set a password or PIN for the new account.');
      const response = await fetch(originalUsername ? `/api/accounts/${encodeURIComponent(originalUsername)}` : '/api/accounts', { method: originalUsername ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) return alert(result.message || 'Unable to save account.');
      resetAccountForm();
      loadAccounts();
      playDingSound();
    });
  }

  const registryForm = document.getElementById('registryForm');
  if (registryForm) {
    registryForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(registryForm).entries());
      const response = await fetch('/api/registry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok) return alert(result.message || 'Unable to save learner registry record.');
      registryForm.reset();
      await loadRegistry();
      playDingSound();
    });
  }

  const consentForm = document.getElementById('consentForm');
  if (consentForm) consentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch('/api/consents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ learnerName: document.getElementById('consentLearner').value.trim(), guardianName: document.getElementById('consentGuardian').value.trim(), internalUpdates: document.getElementById('consentInternal').checked, marketingPhotos: document.getElementById('consentMarketing').checked }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to record consent.');
    consentForm.reset(); loadConsentRecords(); playDingSound();
  });

  const pickupForm = document.getElementById('pickupForm');
  if (pickupForm) pickupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch('/api/pickups/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ learnerName: document.getElementById('pickupLearner').value.trim(), pickupAdult: document.getElementById('pickupAdult').value.trim(), verificationCode: document.getElementById('pickupCode').value, action: document.getElementById('pickupAction').value, recordedBy: currentUser?.name || currentUser?.username }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to create the audit record.');
    pickupForm.reset(); loadPickupRecords(); playDingSound();
  });

  const chatForm = document.getElementById('chatForm');
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const groupId = document.getElementById('chatGroupSelect').value;
      const message = document.getElementById('chatInput').value;
      const textColor = document.getElementById('chatColorPicker').value;

      if (!message.trim() || !currentUser) return;

      await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, sender: currentUser.username, message, textColor })
      });

      document.getElementById('chatInput').value = '';
      loadGroupChatMessages();
      playDingSound();
    });
  }

  const directForm = document.getElementById('directChatForm');
  if (directForm) {
    directForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const recipient = document.getElementById('directRecipientSelect').value;
      const message = document.getElementById('directChatInput').value;
      const textColor = document.getElementById('directChatColorPicker').value;

      if (!recipient) return alert('Select a chat recipient first.');
      if (!message.trim() || !currentUser) return;

      await fetch('/api/chat/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: currentUser.username, recipient, message, textColor })
      });

      document.getElementById('directChatInput').value = '';
      loadDirectChatMessages();
      playDingSound();
    });
  }

  const bcForm = document.getElementById('broadcastForm');
  if (bcForm) {
    bcForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        bcPriority: document.getElementById('bcPriority').value,
        bcMessage: document.getElementById('bcMessage').value,
        radiusKm: Number(document.getElementById('bcRadius').value) || 5,
        location: alertLocation
      };

      if (!alertLocation) return alert('Use your current location before dispatching an area-based alert.');

      await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      bcForm.reset();
      alertLocation = null;
      document.getElementById('bcLocation').value = '';
      loadBroadcasts();
      playDingSound();
    });
  }

  const visitorMeetingForm = document.getElementById('visitorMeetingRequestForm');
  if (visitorMeetingForm) visitorMeetingForm.addEventListener('submit', async event => {
    event.preventDefault();
    const response = await fetch('/api/visitor-meetings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ hostUsername: document.getElementById('visitorMeetingHost').value, proposedAt: document.getElementById('visitorMeetingTime').value, purpose: document.getElementById('visitorMeetingPurpose').value.trim() }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to submit the meeting request.');
    visitorMeetingForm.reset();
    playDingSound();
    loadVisitorMeetings();
  });

  const lookupForm = document.getElementById('studentLookupForm');
  if (lookupForm) {
    lookupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const className = document.getElementById('lookupClass').value;
      const childName = document.getElementById('lookupChild').value;

      try {
        const res = await fetch(`/api/students/search?className=${encodeURIComponent(className)}&childName=${encodeURIComponent(childName)}&username=${encodeURIComponent(currentUser?.username || '')}`);
        const results = await res.json();
        const box = document.getElementById('lookupResults');

        box.innerHTML = results.length
          ? results.map(s => `
              <div class="item-row" style="flex-direction: column; align-items: flex-start;">
                <strong>${s.studentName}</strong> <span class="badge-tag info">${s.className}</span>
                <div style="font-size:0.85rem; margin-top:4px;">
                  <p>Guardian: <strong>${s.parentName}</strong> (${s.contactEmail})</p>
                  <p style="color:#ef4444; margin-top:2px;"><strong>⚕ Medical / allergy card:</strong> ${s.medicalNotes}</p>
                  <p style="margin-top:2px;"><strong>Emergency:</strong> ${s.emergencyContact || 'Not recorded'}<br><strong>Authorised pickup:</strong> ${s.authorisedPickups || 'Not recorded'}</p>
                </div>
              </div>
            `).join('')
          : '<p style="font-size:0.85rem; color:var(--text-muted);">No student records matched your query parameters.</p>';
      } catch (err) {
        logAppError('ERR_LOOKUP_500', 'Failed to perform student information query.');
      }
    });
  }
}

// Footer Info Modals
function openLegalModal(title, text) {
  openModal(title, `<p style="font-size:0.9rem; line-height:1.5; color:var(--text-dark);">${text}</p>`);
}

async function openDonationModal() {
  let status;
  try {
    const response = await fetch('/api/donations/payment');
    status = await response.json();
    if (!response.ok) throw new Error(status.message || 'Unable to open donations.');
  } catch (error) { return alert(error.message || 'Unable to open donations.'); }
  if (!status.configured) {
    return openModal('Donations coming soon', `<p style="font-size:.9rem;line-height:1.6;">Little Feet has not published its secure donation destination yet. Please check back soon.</p>`);
  }
  openModal('Donate to Little Feet', `<form onsubmit="createDonationIntent(event)" style="display:grid;gap:12px;font-size:.9rem;"><p style="margin:0;color:var(--text-muted);line-height:1.55;">Your contribution supports accessible tools and continued improvements for early-learning communities.</p><label>Donation amount (R)<input name="amount" type="number" min="1" step="0.01" required placeholder="e.g. 50"></label><label>Your name <span style="color:var(--text-muted);">(optional)</span><input name="donorName" maxlength="120" autocomplete="name"></label><label>Email for acknowledgement <span style="color:var(--text-muted);">(optional)</span><input name="donorEmail" type="email" maxlength="160" autocomplete="email"></label><button class="submit-btn">Continue to donate</button></form>`);
}

async function createDonationIntent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/donations/intents', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ amount: form.elements.amount.value, donorName: form.elements.donorName.value, donorEmail: form.elements.donorEmail.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to prepare the donation.');
    const payment = result.payment;
    const destination = payment.paymentLink ? `<a class="submit-btn" style="display:inline-block;text-decoration:none;text-align:center;" href="${escapeWorkspaceText(payment.paymentLink)}" target="_blank" rel="noopener">Continue to secure payment</a>` : `<div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><strong>${escapeWorkspaceText(payment.bankName)}</strong><br>Account name: ${escapeWorkspaceText(payment.accountName)}<br>Account number: ${escapeWorkspaceText(payment.accountNumber)}${payment.branchCode ? `<br>Branch code: ${escapeWorkspaceText(payment.branchCode)}` : ''}</div>`;
    openModal('Donation ready', `<p style="margin:0 0 10px;">Thank you for supporting Little Feet.</p><div style="padding:12px;border-left:4px solid #2dd4bf;background:rgba(45,212,191,.1);margin-bottom:12px;"><strong>Donation: ${formatSubscriptionMoney(result.donation.amount)}</strong><br>Reference: <strong>${escapeWorkspaceText(result.donation.reference)}</strong></div>${destination}<p style="margin:12px 0 0;color:var(--text-muted);font-size:.82rem;">Use the reference exactly as shown so the contribution can be matched correctly.</p>`);
  } catch (error) { alert(error.message || 'Unable to prepare the donation.'); }
}

async function openSubscriptionsModal() {
  const schoolRoles = ['teacher', 'principal', 'district', 'admin'];
  if (currentUser?.role === 'parent') {
    const parentContent = `
      <section style="font-size:0.9rem; line-height:1.55; color:var(--text-dark);">
        <div style="display:inline-block; background:#059669; color:#fff; border-radius:999px; padding:4px 11px; font-size:0.68rem; font-weight:700; letter-spacing:0.08em;">FAMILY PLAN</div>
        <h2 style="margin:10px 0 4px; color:var(--text-dark); font-size:1.5rem;">LittleSteps Plus</h2>
        <p style="margin:0 0 16px; color:#10b981; font-size:1rem; font-weight:700;">More ways to follow and celebrate your child’s learning.</p>
        <div style="padding:16px; border:1px solid #6ee7b7; border-left:5px solid #10b981; border-radius:10px; background:rgba(16,185,129,0.08);">
          <strong style="display:block; font-size:1.4rem; color:var(--text-dark);">R29 / month per child</strong>
          <span style="display:block; margin:2px 0 13px; color:#10b981; font-size:.78rem; font-weight:700;">Optional parent subscription</span>
          <ul style="margin:0; padding-left:20px; display:grid; gap:8px;">
            <li>Full-quality downloads of approved school photos and videos.</li>
            <li>Weekly learning and development highlights.</li>
            <li>Priority handling for eligible help requests.</li>
            <li>Extended access to your child’s learning portfolio, reports, and achievements.</li>
            <li>Additional family access for approved caregivers.</li>
          </ul>
        </div>
        <p style="margin:14px 0 0; color:var(--text-muted); font-size:.78rem;">Availability and features are set by your school and your family account permissions.</p>
      </section>`;
    openModal('Parent Subscription', parentContent);
    document.querySelector('#appModal .modal-card').classList.add('subscription-modal-card');
    return;
  }
  if (!schoolRoles.includes(currentUser?.role)) {
    return alert('School subscription information is available to authorised school staff only.');
  }
  let billing = null;
  try {
    const response = await fetch('/api/subscription-billing');
    const result = await response.json();
    if (response.ok) billing = result;
  } catch { /* The page still explains the service when billing is temporarily unavailable. */ }
  const subscriptionPricingOverview = billing
    ? `<div style="overflow-x:auto; border:1px solid var(--border-color); border-radius:6px;"><table style="width:100%; min-width:620px; border-collapse:collapse; text-align:left; font-size:0.8rem;"><thead><tr style="background:#065f46; color:#fff;"><th style="padding:9px 10px;">Monthly school plan</th><th style="padding:9px 10px;">Extra learner capacity</th><th style="padding:9px 10px;">Monthly add-on price</th></tr></thead><tbody><tr><td style="padding:9px 10px;font-weight:700;">${formatSubscriptionMoney(billing.pricing.baseMonthly)} / month</td><td style="padding:9px 10px;">Included by your selected school plan</td><td style="padding:9px 10px;">Choose a bundle below if needed</td></tr>${billing.pricing.bundles.map(bundle => `<tr style="background:rgba(16,185,129,0.08);"><td style="padding:8px 10px;">School capacity add-on</td><td style="padding:8px 10px;font-weight:700;">+${bundle.capacity} children</td><td style="padding:8px 10px;font-weight:700;">${formatSubscriptionMoney(bundle.sellingPrice)} / month</td></tr>`).join('')}</tbody></table></div>${billing.pricing.lateFeeEnabled ? `<p style="margin:10px 0 0;color:var(--text-muted);font-size:.78rem;">Late-payment term: ${formatSubscriptionMoney(billing.pricing.lateFee)} applies only when accepted during checkout.</p>` : ''}`
    : `<div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);color:var(--text-muted);">Live pricing is temporarily unavailable. Please try again shortly.</div>`;
  const content = `
    <div style="font-size:0.88rem; line-height:1.5; color:var(--text-dark);">
      <section style="margin-bottom:22px;padding:15px;border:1px solid #6ee7b7;border-radius:10px;background:rgba(16,185,129,.08);">
        <div style="display:inline-block; background:#059669; color:#fff; border-radius:999px; padding:3px 11px; font-size:0.68rem; font-weight:700; letter-spacing:0.08em;">MIGRATION &amp; LAUNCH</div>
        <h2 style="margin:8px 0 6px;color:var(--text-dark);font-size:1.25rem;">Move to Little Feet with a guided setup</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;">
          <div><strong>Week 1: Integration</strong><br><span style="color:var(--text-muted);">Import learner, family, class, and approved school data; review roles and consent records.</span></div>
          <div><strong>Two-week trial</strong><br><span style="color:var(--text-muted);">Use the agreed plan with real workflows before the contract starts.</span></div>
          <div><strong>Launch support</strong><br><span style="color:var(--text-muted);">Confirm staff training, parent access, and go-live checks together.</span></div>
        </div>
        <p style="margin:12px 0 0;color:var(--text-muted);font-size:.78rem;">Commercial terms: 30-day money-back guarantee, 36-month agreement, cancellation and post-contract customisation fees are fixed in the signed school quotation based on the selected plan. No fee is charged or agreement created by this portal.</p>
      </section>
      <section style="margin-bottom:26px;">
        <div style="display:inline-block; background:#059669; color:#fff; border-radius:999px; padding:3px 11px; font-size:0.68rem; font-weight:700; letter-spacing:0.08em;">INSTITUTIONAL PRICING & BENEFITS</div>
        <h2 style="margin:8px 0 2px; color:var(--text-dark); font-size:1.55rem;">School Subscriptions & Operational Advantages</h2>
        <p style="margin:0 0 12px; color:#10b981; font-size:1rem; font-weight:700;">Predictable Pricing Models Designed for Scalability</p>
        <div style="overflow-x:auto; border:1px solid var(--border-color); border-radius:8px; margin-bottom:12px;">
          <table style="width:100%; min-width:700px; border-collapse:collapse; text-align:left; font-size:.82rem;">
            <thead><tr style="background:#065f46; color:#fff;"><th style="padding:10px;">Package tier</th><th style="padding:10px;">School learners</th><th style="padding:10px;">Monthly fee</th><th style="padding:10px;">Extra learner fee</th></tr></thead>
            <tbody><tr><td style="padding:10px;"><strong>Micro / ECD Tier</strong></td><td style="padding:10px;">Up to 30 learners</td><td style="padding:10px;"><strong>R350 / month</strong></td><td style="padding:10px;">R10 / learner / month</td></tr><tr style="background:rgba(16,185,129,.10);"><td style="padding:10px;"><strong>Standard Primary</strong></td><td style="padding:10px;">Up to 250 learners</td><td style="padding:10px;"><strong>R1,500 / month</strong></td><td style="padding:10px;">R6 / learner / month</td></tr><tr><td style="padding:10px;"><strong>Enterprise Campus</strong></td><td style="padding:10px;">Up to 1,000 learners</td><td style="padding:10px;"><strong>R7,500 / month</strong></td><td style="padding:10px;">Flat package — no overage</td></tr></tbody>
          </table>
        </div>
        ${subscriptionPricingOverview}
        <div style="margin-top:10px; padding:12px 14px; border:1px solid #6ee7b7; border-left:5px solid #10b981; border-radius:8px; background:rgba(16,185,129,0.08);">
          <h3 style="margin:0 0 7px; color:var(--text-dark); font-size:0.95rem;">Key Institutional Advantages of Subscribing</h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:4px 22px; font-size:0.78rem;">
            <p style="margin:0;"><strong>• 15+ Hours Saved Monthly:</strong> Automates daily administrative logs, attendance tracking, and grading uploads so teachers focus on teaching.</p>
            <p style="margin:0;"><strong>• 100% Digital Audit Trail:</strong> Maintain verifiable records for support queries, fee receipts, and official compliance requirements.</p>
            <p style="margin:0;"><strong>• Zero Paper & Printing Costs:</strong> Replaces physical notices, printed newsletters, and paper report covers with instant digital delivery.</p>
            <p style="margin:0;"><strong>• Stronger Parent Retention:</strong> High-transparency communication drives parent trust and institutional reputation.</p>
          </div>
        </div>
      </section>

      <section>
        <div style="display:inline-block; background:#059669; color:#fff; border-radius:999px; padding:3px 11px; font-size:0.68rem; font-weight:700; letter-spacing:0.08em;">PREMIUM PARENT UPGRADE</div>
        <h2 style="margin:8px 0 2px; color:var(--text-dark); font-size:1.55rem;">LittleSteps Plus & Parent Subscription Advantages</h2>
        <p style="margin:0 0 12px; color:#10b981; font-size:1rem; font-weight:700;">Unlocking Premium Growth Insights & Keepsake Features</p>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(300px, 1fr)); gap:14px;">
          <div style="padding:14px; border:1px solid #6ee7b7; border-left:5px solid #10b981; border-radius:8px; background:rgba(16,185,129,0.08);">
            <h3 style="margin:0 0 7px; color:var(--text-dark); font-size:0.95rem;">⭐ LittleSteps Plus Add-On Overview</h3>
            <p style="margin:0 0 10px;">An optional, affordable premium subscription available directly to parents for <strong>R29 / month per child.</strong></p>
            <div style="padding:9px; border:1px solid #10b981; border-radius:8px; background:var(--panel-bg); text-align:center; margin-bottom:10px;"><strong style="display:block; font-size:1.25rem; color:var(--text-dark);">R29 / month</strong><span style="color:#10b981; font-size:0.75rem; font-weight:700;">Direct Subscription Tier</span></div>
            <p style="margin:0;">Serves as a high-margin value-add that turns school management software into an engaging, memory-rich parent companion app.</p>
          </div>
          <div style="padding:14px; border:1px solid #6ee7b7; border-left:5px solid #10b981; border-radius:8px; background:rgba(16,185,129,0.08);">
            <h3 style="margin:0 0 7px; color:var(--text-dark); font-size:0.95rem;">💎 Key Advantages for Subscribing Parents</h3>
            <ul style="margin:0; padding-left:18px; font-size:0.78rem;">
              <li style="margin-bottom:4px;"><strong>Full High-Definition Media Downloads:</strong> Download unlimited original-resolution photos and videos of daily classroom activities and school events.</li>
              <li style="margin-bottom:4px;"><strong>AI Growth & Development Insights:</strong> Receive automated weekly summaries highlighting developmental progress, strength areas, and tailored learning tips.</li>
              <li style="margin-bottom:4px;"><strong>Priority Ticket Queueing:</strong> Escalated response status for administrative, fee, and medical inquiries submitted to the school desk.</li>
              <li style="margin-bottom:4px;"><strong>Permanent Digital Portfolio:</strong> Lifetime access to archived worksheets, term certificates, and milestone badges across all school years.</li>
              <li><strong>Multi-Caregiver Family Access:</strong> Grant secondary access accounts for grandparents or guardians to follow the child's progress.</li>
            </ul>
          </div>
        </div>
      </section>
      ${['principal', 'admin'].includes(currentUser?.role) ? `<section style="margin-top:24px;padding:16px;border:1px solid #2dd4bf;border-radius:10px;background:rgba(13,148,136,.1);"><h3 style="margin:0 0 6px;color:var(--text-dark);">Ready to subscribe?</h3><p style="margin:0 0 12px;color:var(--text-muted);">Choose your learner capacity, accept the late-payment terms if enabled, and receive a unique payment reference.</p><button type="button" class="submit-btn" onclick="openSubscriptionCheckout()">Choose plan &amp; pay</button></section>` : ''}
    </div>`;
  openModal('School Subscriptions & Advantages', content);
  document.querySelector('#appModal .modal-card').classList.add('subscription-modal-card');
}

function formatSubscriptionMoney(value) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(Number(value || 0));
}

async function loadSubscriptionBillingOverview() {
  const container = document.getElementById('subscriptionBillingOverview');
  if (!container || currentUser?.role !== 'admin') return;
  try {
    const response = await fetch('/api/subscription-billing');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load subscription information.');
    const bundles = data.pricing.bundles || [];
    const awaiting = (data.orders || []).filter(order => order.status === 'awaiting payment');
    const requestedMonthly = awaiting.reduce((total, order) => total + Number(order.monthlyTotal || 0), 0);
    const potentialMargin = awaiting.reduce((total, order) => total + Number(order.profitMargin || 0), 0);
    const rows = bundles.map(bundle => {
      const margin = Number(bundle.sellingPrice || 0) - Number(bundle.costPrice || 0);
      return `<tr><td style="padding:9px 10px;"><strong>+${bundle.capacity} children</strong></td><td style="padding:9px 10px;">${formatSubscriptionMoney(bundle.costPrice)}</td><td style="padding:9px 10px;">${formatSubscriptionMoney(bundle.sellingPrice)}</td><td style="padding:9px 10px;color:#2dd4bf;font-weight:700;">${formatSubscriptionMoney(margin)}</td></tr>`;
    }).join('');
    const orders = (data.orders || []).slice(0, 6).map(order => `<li><strong>${escapeWorkspaceText(order.reference)}</strong> · ${escapeWorkspaceText(order.schoolName)} · ${formatSubscriptionMoney(order.monthlyTotal)}/month · ${escapeWorkspaceText(order.status)}</li>`).join('') || '<li>No payment requests yet.</li>';
    container.innerHTML = `<div class="card-header-bar"><h3>Subscription pricing &amp; operating overview</h3><span class="badge-tag ${data.paymentConfigured ? 'info' : 'urgent'}">${data.paymentConfigured ? 'PAYMENT READY' : 'SETUP NEEDED'}</span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0;"><div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><span class="meta">Base school subscription</span><strong style="display:block;margin-top:3px;font-size:1.1rem;">${formatSubscriptionMoney(data.pricing.baseMonthly)} / month</strong></div><div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><span class="meta">Late-payment term</span><strong style="display:block;margin-top:3px;font-size:1.1rem;">${data.pricing.lateFeeEnabled ? formatSubscriptionMoney(data.pricing.lateFee) : 'Not enabled'}</strong></div><div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><span class="meta">Awaiting monthly revenue</span><strong style="display:block;margin-top:3px;font-size:1.1rem;">${formatSubscriptionMoney(requestedMonthly)}</strong></div><div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><span class="meta">Potential add-on margin</span><strong style="display:block;margin-top:3px;font-size:1.1rem;color:#2dd4bf;">${formatSubscriptionMoney(potentialMargin)}</strong></div></div><div style="overflow-x:auto;border:1px solid var(--border-color);border-radius:8px;"><table style="width:100%;min-width:560px;border-collapse:collapse;text-align:left;"><thead><tr><th style="padding:9px 10px;">Learner add-on</th><th style="padding:9px 10px;">Your cost</th><th style="padding:9px 10px;">School price</th><th style="padding:9px 10px;">Your profit</th></tr></thead><tbody>${rows}</tbody></table></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;margin-top:14px;"><div><h4 style="margin:0 0 7px;">How it works</h4><ol style="margin:0;padding-left:19px;color:var(--text-muted);font-size:.84rem;line-height:1.6;"><li>Set your cost and selling price for each child bundle.</li><li>Choose a secure payment link or bank-transfer account.</li><li>Principals or admins choose a bundle and create a payment request.</li><li>Little Feet creates a unique reference for payment matching.</li></ol></div><div><h4 style="margin:0 0 7px;">Recent payment requests</h4><ul style="margin:0;padding-left:19px;display:grid;gap:5px;font-size:.84rem;">${orders}</ul></div></div><button type="button" class="action-btn btn-blue" style="margin-top:14px;" onclick="openSubscriptionBillingAdmin()">Edit prices &amp; payment destination</button>`;
  } catch (error) {
    container.innerHTML = `<p style="margin:0;color:#fca5a5;">${escapeWorkspaceText(error.message || 'Unable to load subscription information.')}</p><button type="button" class="action-btn btn-blue" style="margin-top:10px;" onclick="loadSubscriptionBillingOverview()">Try again</button>`;
  }
}

async function openSubscriptionBillingAdmin() {
  if (currentUser?.role !== 'admin') return alert('Only an administrator can manage subscription pricing and payment details.');
  let data;
  try {
    const response = await fetch('/api/subscription-billing');
    data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load subscription billing.');
  } catch (error) { return alert(error.message || 'Unable to load subscription billing.'); }
  const bundle = (capacity, field) => data.pricing.bundles.find(item => item.capacity === capacity)?.[field] || 0;
  const payment = data.payment || {};
  const orders = (data.orders || []).slice(0, 8).map(order => `<li><strong>${escapeWorkspaceText(order.reference)}</strong> · ${escapeWorkspaceText(order.schoolName)} · ${formatSubscriptionMoney(order.monthlyTotal)}/month · ${escapeWorkspaceText(order.status)}</li>`).join('') || '<li>No subscription payment requests yet.</li>';
  openModal('Subscription pricing & payment account', `
    <form id="subscriptionBillingForm" onsubmit="saveSubscriptionBillingConfig(event)" style="display:grid;gap:14px;">
      <p style="margin:0;color:var(--text-muted);">Set what schools pay and your underlying cost. The portal calculates the margin on each learner add-on privately for administrators.</p>
      <div class="workspace-grid"><label>Base monthly school price<input name="baseMonthly" type="number" min="0" step="0.01" value="${data.pricing.baseMonthly}"></label><label>Late-payment fee<input name="lateFee" type="number" min="0" step="0.01" value="${data.pricing.lateFee}"></label></div>
      <label style="display:flex;align-items:center;gap:8px;"><input name="lateFeeEnabled" type="checkbox" ${data.pricing.lateFeeEnabled ? 'checked' : ''}> Apply the late-payment fee only when the school accepts this term.</label>
      <div style="overflow-x:auto;border:1px solid var(--border-color);border-radius:8px;"><table style="width:100%;min-width:540px;border-collapse:collapse;text-align:left;"><thead><tr><th style="padding:9px;">Extra learners</th><th style="padding:9px;">Your cost</th><th style="padding:9px;">School price</th><th style="padding:9px;">Your margin</th></tr></thead><tbody>${[5,20,100].map(capacity => `<tr><td style="padding:9px;"><strong>+${capacity} children</strong></td><td style="padding:9px;"><input name="cost${capacity}" type="number" min="0" step="0.01" value="${bundle(capacity,'costPrice')}"></td><td style="padding:9px;"><input name="price${capacity}" type="number" min="0" step="0.01" value="${bundle(capacity,'sellingPrice')}"></td><td style="padding:9px;color:#2dd4bf;">Calculated after saving</td></tr>`).join('')}</tbody></table></div>
      <fieldset style="border:1px solid var(--border-color);border-radius:8px;padding:12px;"><legend style="padding:0 5px;font-weight:700;">Where schools pay</legend><label>Payment method<select name="paymentMethod" onchange="toggleSubscriptionPaymentFields(this.value)"><option value="payment_link" ${payment.method === 'payment_link' ? 'selected' : ''}>Secure payment link</option><option value="bank_transfer" ${payment.method === 'bank_transfer' ? 'selected' : ''}>Bank transfer</option></select></label><div id="subscriptionPaymentLinkFields" style="margin-top:10px;"><label>HTTPS payment link<input name="paymentLink" type="url" placeholder="https://..." value="${escapeWorkspaceText(payment.paymentLink || '')}"></label></div><div id="subscriptionBankFields" style="display:none;margin-top:10px;" class="workspace-grid"><label>Account name<input name="accountName" value="${escapeWorkspaceText(payment.accountName || '')}"></label><label>Bank name<input name="bankName" value="${escapeWorkspaceText(payment.bankName || '')}"></label><label>Account number<input name="accountNumber" inputmode="numeric" value="${escapeWorkspaceText(payment.accountNumber || '')}"></label><label>Branch code<input name="branchCode" inputmode="numeric" value="${escapeWorkspaceText(payment.branchCode || '')}"></label></div><label style="margin-top:10px;display:block;">Payment reference prefix<input name="referencePrefix" maxlength="16" value="${escapeWorkspaceText(payment.referencePrefix || 'LF')}"></label></fieldset>
      <button class="submit-btn">Save subscription billing</button>
    </form>
    <section style="margin-top:18px;border-top:1px solid var(--border-color);padding-top:12px;"><h3 style="margin:0 0 8px;">Recent payment requests</h3><ul style="margin:0;padding-left:20px;display:grid;gap:5px;font-size:.84rem;">${orders}</ul></section>`);
  toggleSubscriptionPaymentFields(payment.method || 'payment_link');
}

function toggleSubscriptionPaymentFields(method) {
  const link = document.getElementById('subscriptionPaymentLinkFields');
  const bank = document.getElementById('subscriptionBankFields');
  if (link) link.style.display = method === 'payment_link' ? 'block' : 'none';
  if (bank) bank.style.display = method === 'bank_transfer' ? 'grid' : 'none';
}

async function saveSubscriptionBillingConfig(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const value = name => form.elements[name]?.value || '';
  const payload = { baseMonthly: value('baseMonthly'), lateFee: value('lateFee'), lateFeeEnabled: form.elements.lateFeeEnabled.checked, bundles: {}, payment: { method: value('paymentMethod'), paymentLink: value('paymentLink'), accountName: value('accountName'), bankName: value('bankName'), accountNumber: value('accountNumber'), branchCode: value('branchCode'), referencePrefix: value('referencePrefix') } };
  [5,20,100].forEach(capacity => { payload.bundles[capacity] = { costPrice: value(`cost${capacity}`), sellingPrice: value(`price${capacity}`) }; });
  try {
    const response = await fetch('/api/subscription-billing', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to save subscription billing.');
    alert('Subscription pricing and payment details saved.');
    loadSubscriptionBillingOverview();
    openSubscriptionBillingAdmin();
  } catch (error) { alert(error.message || 'Unable to save subscription billing.'); }
}

async function openSubscriptionCheckout() {
  if (!['principal', 'admin'].includes(currentUser?.role)) return alert('Only a principal or administrator can create a subscription payment request.');
  let data;
  try {
    const response = await fetch('/api/subscription-billing');
    data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load subscription pricing.');
  } catch (error) { return alert(error.message || 'Unable to load subscription pricing.'); }
  if (!data.paymentConfigured || Number(data.pricing.baseMonthly) <= 0) return alert('An administrator still needs to configure the subscription price and payment destination.');
  const options = [{ capacity:0, sellingPrice:0 }, ...data.pricing.bundles].map(bundle => `<option value="${bundle.capacity}">${bundle.capacity ? `+${bundle.capacity} children — ${formatSubscriptionMoney(bundle.sellingPrice)}/month` : 'No extra learner bundle'}</option>`).join('');
  openModal('Choose subscription & pay', `<form onsubmit="createSubscriptionOrder(event)" style="display:grid;gap:14px;"><p style="margin:0;color:var(--text-muted);">Base school subscription: <strong>${formatSubscriptionMoney(data.pricing.baseMonthly)} / month</strong>. Select extra learner capacity if needed.</p><label>Extra learner bundle<select name="bundleCapacity">${options}</select></label>${data.pricing.lateFeeEnabled ? `<label style="display:flex;align-items:flex-start;gap:8px;"><input type="checkbox" name="lateFeeAccepted"> I accept the late-payment fee of ${formatSubscriptionMoney(data.pricing.lateFee)} if this invoice becomes overdue.</label>` : ''}<button class="submit-btn">Create payment request</button></form>`);
}

async function createSubscriptionOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/subscription-billing/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ bundleCapacity: form.elements.bundleCapacity.value, lateFeeAccepted: Boolean(form.elements.lateFeeAccepted?.checked) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to create payment request.');
    const payment = result.payment;
    const destination = payment.paymentLink ? `<a class="submit-btn" style="display:inline-block;text-decoration:none;text-align:center;" href="${escapeWorkspaceText(payment.paymentLink)}" target="_blank" rel="noopener">Pay securely now</a>` : `<div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><strong>${escapeWorkspaceText(payment.bankName)}</strong><br>Account name: ${escapeWorkspaceText(payment.accountName)}<br>Account number: ${escapeWorkspaceText(payment.accountNumber)}${payment.branchCode ? `<br>Branch code: ${escapeWorkspaceText(payment.branchCode)}` : ''}</div>`;
    openModal('Payment request ready', `<p style="margin:0 0 10px;">Your payment request is awaiting payment.</p><div style="padding:12px;border-left:4px solid #2dd4bf;background:rgba(45,212,191,.1);margin-bottom:12px;"><strong>Monthly total: ${formatSubscriptionMoney(result.order.monthlyTotal)}</strong><br>Payment reference: <strong>${escapeWorkspaceText(result.order.reference)}</strong>${result.order.lateFee ? `<br><span style="color:var(--text-muted);">Late-payment fee if overdue: ${formatSubscriptionMoney(result.order.lateFee)}</span>` : ''}</div>${destination}<p style="margin:12px 0 0;color:var(--text-muted);font-size:.82rem;">Use the reference exactly as shown so the payment can be matched to your school.</p>`);
  } catch (error) { alert(error.message || 'Unable to create payment request.'); }
}

function downloadAttendanceTemplate() {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading. Please try again in a moment.');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet([
    { 'Learner Name': 'Example Learner', Status: 'Present' },
    { 'Learner Name': 'Example Learner 2', Status: 'Absent' }
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance import');
  XLSX.writeFile(workbook, 'LittleFeet_Attendance_Import_Template.xlsx');
}

function downloadScheduleTemplate() {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading. Please try again in a moment.');
  const rows = [
    { 'ID (optional)': '', 'Student Name': 'Example Learner', 'Day of Week': 'Monday', 'Time Slot Block': '08:00 - 09:00', 'Activity Module': 'Morning circle and literacy' },
    { 'ID (optional)': '', 'Student Name': 'Example Learner', 'Day of Week': 'Monday', 'Time Slot Block': '09:00 - 10:00', 'Activity Module': 'Outdoor play' }
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Schedule import');
  XLSX.writeFile(workbook, 'LittleFeet_Schedule_Import_Template.xlsx');
}

async function loadAccounts() {
  const list = document.getElementById('accountsList');
  if (!list || currentUser?.role !== 'admin') return;
  try {
    const response = await fetch(`/api/accounts?actorUsername=${encodeURIComponent(currentUser.username)}`);
    const accounts = await response.json();
    accountsCache = accounts;
    list.innerHTML = accounts.map(account => `<div class="item-row"><div><strong>${escapeWorkspaceText(account.name)}</strong> <span class="badge-tag info">${escapeWorkspaceText(account.role)}</span><p style="margin-top:4px;">${escapeWorkspaceText(account.username)}<br><span style="color:var(--text-muted);">Linked school: ${escapeWorkspaceText(account.schoolName)}${account.schoolStoreUrl ? ' · Web store linked' : ' · No web store linked'}${account.role === 'parent' ? `<br>Requested learners: ${escapeWorkspaceText((account.requestedLearnerLinks || []).join(', ') || 'None')}<br>Approved learners: ${escapeWorkspaceText((account.linkedLearners || []).join(', ') || 'None yet')}<br>Relationship: ${escapeWorkspaceText(account.parentRelationshipStatus || 'Pending administrator approval')}</span>` : '</span>'}${account.verificationStatus ? `<br><span class="meta">Account status: ${escapeWorkspaceText(account.verificationStatus)}</span>` : ''}</p></div><div style="display:flex;gap:8px;flex-wrap:wrap;">${String(account.verificationStatus || '').includes('verification pending') ? `<button type="button" class="action-btn btn-green" onclick="approveAccount('${encodeURIComponent(account.username)}')">Approve account</button>` : ''}${account.role === 'parent' && account.requestedLearnerLinks?.length ? `<button type="button" class="action-btn btn-green" onclick="approveRequestedLearnerLinks('${encodeURIComponent(account.username)}')">Approve learner request</button>` : ''}<button type="button" class="action-btn btn-blue" onclick="editAccountByUsername('${encodeURIComponent(account.username)}')">Edit</button>${account.username !== 'Teacher' ? `<button type="button" class="action-btn btn-red" onclick="deleteAccount('${encodeURIComponent(account.username)}')">Delete</button>` : ''}</div></div>`).join('');
  } catch { list.textContent = 'Unable to load account records.'; }
}

async function loadLearnerAccessCodes() {
  const list = document.getElementById('learnerCodeList');
  if (!list || !['admin', 'principal'].includes(currentUser?.role)) return;
  try {
    const response = await fetch(`/api/learner-access-codes?actorUsername=${encodeURIComponent(currentUser.username)}`);
    const records = await response.json();
    if (!response.ok) throw new Error(records.message || 'Unable to load learner code forms.');
    learnerAccessCodeRecords = records;
    if (!records.length) {
      list.innerHTML = '<p style="font-size:.84rem;color:var(--text-muted);">No learners are available yet. Import or register learners first.</p>';
      return;
    }
    renderLearnerAccessCodes();
  } catch (error) {
    list.textContent = error.message || 'Unable to load learner code forms.';
  }
}

function renderLearnerAccessCodes() {
  const list = document.getElementById('learnerCodeList');
  if (!list || !['admin', 'principal'].includes(currentUser?.role)) return;
  const canManage = currentUser.role === 'admin';
  const query = String(document.getElementById('learnerCodeSearch')?.value || '').trim().toLowerCase();
  const records = learnerAccessCodeRecords.filter(record => !query || [record.learnerName, record.className, record.parentName, record.accessCode].some(value => String(value || '').toLowerCase().includes(query)));
  if (!records.length) {
    list.innerHTML = '<p class="meta">No learners match that search.</p>';
    return;
  }
  list.innerHTML = records.map(record => {
    const encodedKey = encodeURIComponent(record.learnerKey);
    const details = `${escapeWorkspaceText(record.learnerName)} · ${escapeWorkspaceText(record.className || 'Class not recorded')}`;
    const status = record.accessCode ? `<p style="margin-top:5px;">Current code: <strong style="letter-spacing:.08em;color:var(--primary-color);">${escapeWorkspaceText(record.accessCode)}</strong></p>` : record.hasPrintableForm ? '<p class="meta" style="margin-top:5px;">Prepared for printing. The code is not displayed to this role.</p>' : '<p class="meta" style="margin-top:5px;">No active learner code issued.</p>';
    const history = canManage && record.codeHistory?.length ? `<details style="margin-top:8px;"><summary class="meta">${record.codeHistory.length} code record${record.codeHistory.length === 1 ? '' : 's'} in history</summary><div class="meta" style="margin:7px 0 0;line-height:1.55;">${record.codeHistory.map(entry => `${escapeWorkspaceText(entry.status)} · issued ${entry.issuedAt ? new Date(entry.issuedAt).toLocaleDateString() : 'date unknown'}${entry.changedAt ? ` · updated ${new Date(entry.changedAt).toLocaleDateString()}` : ''}`).join('<br>')}</div></details>` : '';
    const actions = record.hasPrintableForm ? `<button type="button" class="action-btn btn-blue" onclick="printLearnerCodeForm('${encodedKey}')">🖨️ Print form</button>` : '';
    const management = canManage ? (record.accessCode ? `<button type="button" class="action-btn btn-green" onclick="replaceLearnerAccessCode('${record.codeRecordId}')">♻️ New random code</button><button type="button" class="action-btn btn-red" onclick="revokeLearnerAccessCode('${record.codeRecordId}')">Scrap code</button>` : `<button type="button" class="action-btn btn-green" onclick="openLearnerCodeIssue('${encodedKey}')">Generate code</button>`) : '';
    return `<div class="item-row"><div><strong>${details}</strong>${status}<span class="meta">${record.issuedAt ? `Issued ${new Date(record.issuedAt).toLocaleString()} by ${escapeWorkspaceText(record.issuedBy || 'school administrator')}` : 'Awaiting administrator issue'}${record.parentName ? ` · Parent: ${escapeWorkspaceText(record.parentName)}` : ''}</span>${history}</div><div style="display:flex;gap:8px;flex-wrap:wrap;">${actions}${management}</div></div>`;
  }).join('');
}

async function toggleLearnerCodeTeacherPreview() {
  if (currentUser?.role !== 'admin') return;
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
    panel.innerHTML = `<p class="meta">${escapeWorkspaceText(error.message || 'Unable to load the teacher view.')}</p>`;
  }
}

function learnerCodeRecord(encodedKey) {
  return learnerAccessCodeRecords.find(record => record.learnerKey === decodeURIComponent(encodedKey));
}

function openLearnerCodeIssue(encodedKey) {
  if (currentUser?.role !== 'admin') return alert('Only an administrator can issue a learner access code.');
  const record = learnerCodeRecord(encodedKey);
  if (!record) return alert('Learner record not found. Refresh the code list and try again.');
  openModal('Issue learner access code', `<p style="margin:0 0 12px;color:var(--text-muted);">Issue a physical code for <strong>${escapeWorkspaceText(record.learnerName)}</strong>. Leave the field blank to generate a secure school code automatically, or enter a school-approved code in the shown format.</p><label for="manualLearnerAccessCode">Manual code (optional)</label><input id="manualLearnerAccessCode" placeholder="LF-AB12-CD34" maxlength="11" style="text-transform:uppercase;"><p class="meta" style="margin-top:7px;">Only the administrator can create, replace, or invalidate a code. A principal may print the completed form.</p><button type="button" class="submit-btn" style="margin-top:14px;" onclick="issueLearnerAccessCode('${encodedKey}')">Issue code</button>`);
}

async function issueLearnerAccessCode(encodedKey) {
  const response = await fetch('/api/learner-access-codes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorUsername: currentUser?.username, learnerKey: decodeURIComponent(encodedKey), manualCode: document.getElementById('manualLearnerAccessCode')?.value || '' })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to issue this learner code.');
  closeModal();
  playDingSound();
  await loadLearnerAccessCodes();
}

async function replaceLearnerAccessCode(id) {
  if (currentUser?.role !== 'admin' || !confirm('Replace this code? The existing physical copy will stop working immediately.')) return;
  const response = await fetch(`/api/learner-access-codes/${encodeURIComponent(id)}/replace`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to replace this learner code.');
  playDingSound();
  await loadLearnerAccessCodes();
}

async function revokeLearnerAccessCode(id) {
  if (currentUser?.role !== 'admin' || !confirm('Invalidate this code? Its printed copy will no longer work.')) return;
  const response = await fetch(`/api/learner-access-codes/${encodeURIComponent(id)}/revoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to invalidate this learner code.');
  await loadLearnerAccessCodes();
}

async function printLearnerCodeForm(encodedKey) {
  if (!['admin', 'principal'].includes(currentUser?.role)) return alert('Only an administrator or principal can print this learner form.');
  const response = await fetch(`/api/learner-access-codes/${encodedKey}/printable`);
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

function resetAccountForm() {
  const form = document.getElementById('accountForm');
  if (!form) return;
  form.reset();
  document.getElementById('accountOriginalUsername').value = '';
  document.getElementById('accountSaveButton').textContent = 'Create account';
  document.getElementById('accountPinHint').textContent = '*';
  document.getElementById('accountPin').placeholder = 'Required for a new account';
}

function editAccount(account) {
  document.getElementById('accountOriginalUsername').value = account.username;
  document.getElementById('accountName').value = account.name || '';
  document.getElementById('accountUsername').value = account.username || '';
  document.getElementById('accountRole').value = account.role || 'parent';
  document.getElementById('accountSchoolName').value = account.schoolName || '';
  document.getElementById('accountStoreUrl').value = account.schoolStoreUrl || '';
  document.getElementById('accountAssignedClasses').value = (account.assignedClasses || []).join(', ');
  document.getElementById('accountLinkedLearners').value = (account.linkedLearners || []).join(', ');
  document.getElementById('accountPin').value = '';
  document.getElementById('accountPinHint').textContent = '(leave empty to keep password)';
  document.getElementById('accountPin').placeholder = 'Enter only to reset password';
  document.getElementById('accountSaveButton').textContent = 'Save account changes';
  document.getElementById('accountsTab').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function editAccountByUsername(encodedUsername) {
  const account = accountsCache.find(entry => entry.username === decodeURIComponent(encodedUsername));
  if (account) editAccount(account);
}

async function openLearnerLinkPicker() {
  const role = document.getElementById('accountRole')?.value;
  if (role !== 'parent') return alert('Linked learners can only be assigned to a parent account. Choose the Parent role first.');
  try {
    const response = await fetch(`/api/students/search?username=${encodeURIComponent(currentUser?.username || '')}`);
    const learners = await response.json();
    if (!response.ok) return alert(learners.message || 'Unable to load learner records.');
    if (!learners.length) return alert('No learner records are available to link yet. Add or import learners first.');
    const field = document.getElementById('accountLinkedLearners');
    const selected = new Set((field?.value || '').split(',').map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
    const options = learners.map(learner => {
      const name = String(learner.studentName || '');
      return `<label style="display:flex;align-items:center;gap:9px;padding:10px;border:1px solid var(--border-color);border-radius:8px;cursor:pointer;"><input type="checkbox" class="learner-link-choice" value="${escapeWorkspaceText(name)}" ${selected.has(name.toLocaleLowerCase()) ? 'checked' : ''}><span><strong>${escapeWorkspaceText(name)}</strong><br><span class="meta">${escapeWorkspaceText(learner.className || 'Class not recorded')}</span></span></label>`;
    }).join('');
    openModal('Choose linked learners', `<p style="margin:0 0 12px;color:var(--text-muted);">Select up to four children for this parent account.</p><div id="learnerLinkChoices" style="display:grid;gap:8px;max-height:46vh;overflow:auto;">${options}</div><button type="button" class="submit-btn" style="margin-top:14px;" onclick="saveLearnerLinks()">Save linked learners</button>`);
  } catch {
    alert('Unable to load learner records. Please try again.');
  }
}

function saveLearnerLinks() {
  const choices = [...document.querySelectorAll('.learner-link-choice:checked')];
  if (choices.length > 4) return alert('A parent account can be linked to a maximum of four learners.');
  const field = document.getElementById('accountLinkedLearners');
  if (field) field.value = choices.map(choice => choice.value).join(', ');
  closeModal();
}

async function deleteAccount(encodedUsername) {
  if (!confirm('Delete this account? This cannot be undone.')) return;
  const response = await fetch(`/api/accounts/${encodedUsername}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser?.username }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to delete account.');
  loadAccounts();
}

async function approveAccount(encodedUsername) {
  const response = await fetch(`/api/accounts/${encodedUsername}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser?.username })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to approve this account.');
  loadAccounts();
  playDingSound();
}

async function approveRequestedLearnerLinks(encodedUsername) {
  if (currentUser?.role !== 'admin') return alert('Only an administrator can approve learner relationships.');
  const account = accountsCache.find(entry => entry.username === decodeURIComponent(encodedUsername));
  if (!account?.requestedLearnerLinks?.length) return alert('There are no pending learner requests for this account.');
  const requested = account.requestedLearnerLinks.join(', ');
  if (!confirm(`Approve ${requested} for ${account.name || account.username}?`)) return;
  const response = await fetch(`/api/accounts/${encodeURIComponent(account.username)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: account.username, name: account.name, role: account.role, schoolName: account.schoolName, schoolStoreUrl: account.schoolStoreUrl, assignedClasses: (account.assignedClasses || []).join(', '), linkedLearners: requested })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to approve the learner relationship.');
  await loadAccounts();
  playDingSound();
}

async function loadRegistry() {
  const list = document.getElementById('registryList');
  if (!list) return;
  try {
    const response = await fetch('/api/registry');
    const records = await response.json();
    list.innerHTML = records.length ? records.map(record => `<div class="item-row"><div><strong>${escapeWorkspaceText(record.learnerName)}</strong> <span class="badge-tag info">${escapeWorkspaceText(record.className || 'Class pending')}</span><p style="margin-top:4px;">Guardian: ${escapeWorkspaceText(record.guardianName)} · ${escapeWorkspaceText(record.guardianPhone)}<br>Medical notes: ${escapeWorkspaceText(record.medicalNotes || 'None recorded')}</p><span class="meta">Registered ${escapeWorkspaceText(record.createdAt)}</span></div></div>`).join('') : '<p style="font-size:.84rem;color:var(--text-muted);">No learner registry records saved yet.</p>';
  } catch { list.textContent = 'Unable to load learner registry.'; }
}

function distanceInKm(lat1, lng1, lat2, lng2) {
  const radians = value => value * Math.PI / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCurrentPositionQuietly() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(position => resolve(position.coords), () => resolve(null), { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 });
  });
}

async function setAlertLocation() {
  const position = await getCurrentPositionQuietly();
  if (!position) return alert('Location access is required to create an area-based alert.');
  alertLocation = { lat: position.latitude, lng: position.longitude };
  document.getElementById('bcLocation').value = `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}

async function deleteBroadcast(id) {
  if (!confirm('Delete this emergency alert?')) return;
  await fetch(`/api/broadcasts/${id}`, { method: 'DELETE' });
  loadBroadcasts();
}

async function markBroadcastRead(id) {
  if (!currentUser) return;
  await fetch(`/api/broadcasts/${id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser.username }) });
  loadBroadcasts();
}

async function loadStoreItems() {
  const box = document.getElementById('storeItems');
  if (!box || !currentUser) return;
  try {
    const response = await fetch('/api/store');
    const store = await response.json();
    if (!response.ok) throw new Error(store.message);
    document.getElementById('storeWelcome').textContent = `${store.schoolName} store`;
    window.schoolStoreProducts = store.products || [];
    const productCards = store.products?.length ? store.products.map(product => `<article class="store-item"><span class="badge-tag info">IN STOCK: ${product.stockQuantity}</span><h3 style="margin:10px 0 6px;">${escapeWorkspaceText(product.name)}</h3><strong style="font-size:1.2rem;color:#2dd4bf;">${formatSubscriptionMoney(product.price)}</strong><p style="margin:8px 0 12px;color:var(--text-muted);font-size:.82rem;">Payment reference and confirmed total are shown before you continue to payment.</p>${currentUser.role === 'parent' ? `<button type="button" class="submit-btn" onclick="openStoreCheckout('${product.id}')" ${product.stockQuantity < 1 ? 'disabled' : ''}>${product.stockQuantity < 1 ? 'Out of stock' : 'Buy item'}</button>` : ''}${store.canManage ? `<button type="button" class="action-btn btn-red" style="margin-top:8px;" onclick="removeStoreProduct('${product.id}')">Remove item</button>` : ''}</article>`).join('') : `<article class="store-item" style="grid-column:1/-1;text-align:center;"><div style="font-size:2.2rem;margin-bottom:10px;">🛍️</div><h3 style="margin-bottom:8px;">No store items yet</h3><p style="color:var(--text-muted);margin:0;">An administrator can add uniforms, stationery, activity packs or other school items here.</p></article>`;
    const safeStoreUrl = typeof store.webStoreUrl === 'string' && /^https:\/\//i.test(store.webStoreUrl) ? store.webStoreUrl : '';
    const externalStore = safeStoreUrl ? `<article class="store-item" style="grid-column:1/-1;"><span class="badge-tag info">OFFICIAL EXTERNAL SCHOOL STORE</span><h3 style="margin:10px 0 5px;">${escapeWorkspaceText(store.schoolName)} web store</h3><p style="margin:0 0 12px;color:var(--text-muted);">Browse items managed by the school’s linked web-store provider.</p><a class="action-btn btn-blue" style="display:inline-block;text-decoration:none;" href="${safeStoreUrl}" target="_blank" rel="noopener noreferrer">Visit official web store</a></article>` : '';
    const manager = store.canManage ? `<article class="store-item" style="grid-column:1/-1;"><h3 style="margin-bottom:7px;">Add school-store item</h3><form onsubmit="addStoreProduct(event)" style="display:grid;grid-template-columns:minmax(180px,1fr) 130px 130px auto;gap:8px;align-items:end;"><label>Item name<input name="name" required placeholder="e.g. School jersey"></label><label>Price (R)<input name="price" type="number" min="0.01" step="0.01" required></label><label>Stock quantity<input name="stockQuantity" type="number" min="0" step="1" required></label><button class="submit-btn">Add item</button></form></article>` : '';
    box.innerHTML = productCards + externalStore + manager;
  } catch { box.textContent = 'Unable to load school store items.'; }
}

function openStoreCheckout(productId) {
  const product = (window.schoolStoreProducts || []).find(entry => entry.id === productId);
  if (!product || currentUser?.role !== 'parent') return alert('This school-store item is no longer available.');
  window.storeCheckoutProduct = product;
  openModal('Confirm school-store purchase', `<div style="display:grid;gap:12px;"><p style="margin:0;color:var(--text-muted);">You are about to order <strong>${escapeWorkspaceText(product.name)}</strong>. Check the total before continuing to payment.</p><label>Quantity<input id="storeOrderQuantity" type="number" min="1" max="${product.stockQuantity}" value="1" oninput="updateStoreCheckoutTotal()"></label><div style="padding:12px;border-left:4px solid #2dd4bf;border-radius:0 8px 8px 0;background:rgba(45,212,191,.1);"><span style="color:var(--text-muted);">Item price: ${formatSubscriptionMoney(product.price)}</span><br><strong id="storeCheckoutTotal">Total: ${formatSubscriptionMoney(product.price)}</strong></div><p style="margin:0;font-size:.84rem;color:var(--text-muted);">Are you sure you want to continue? A payment reference will be created and the stock room will be notified to prepare your order.</p><button type="button" class="submit-btn" onclick="confirmStoreCheckout()">Yes, continue to payment</button></div>`);
}

function updateStoreCheckoutTotal() {
  const product = window.storeCheckoutProduct;
  const quantity = Math.max(1, Math.min(Number(document.getElementById('storeOrderQuantity')?.value) || 1, product?.stockQuantity || 1));
  const field = document.getElementById('storeOrderQuantity');
  if (field) field.value = quantity;
  const total = document.getElementById('storeCheckoutTotal');
  if (total && product) total.textContent = `Total: ${formatSubscriptionMoney(product.price * quantity)}`;
}

async function confirmStoreCheckout() {
  const product = window.storeCheckoutProduct;
  const quantity = Number(document.getElementById('storeOrderQuantity')?.value);
  if (!product || !quantity) return alert('Choose a valid quantity.');
  try {
    const response = await fetch('/api/store/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ productId: product.id, quantity }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to create the order.');
    const payment = result.payment;
    const destination = payment.paymentLink ? `<a class="submit-btn" style="display:inline-block;text-decoration:none;text-align:center;" href="${escapeWorkspaceText(payment.paymentLink)}" target="_blank" rel="noopener">Continue to secure payment</a>` : `<div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><strong>${escapeWorkspaceText(payment.bankName)}</strong><br>Account name: ${escapeWorkspaceText(payment.accountName)}<br>Account number: ${escapeWorkspaceText(payment.accountNumber)}${payment.branchCode ? `<br>Branch code: ${escapeWorkspaceText(payment.branchCode)}` : ''}</div>`;
    openModal('Order ready for payment', `<p style="margin:0 0 10px;">Your order is in the stock-room queue for preparation.</p><div style="padding:12px;border-left:4px solid #2dd4bf;background:rgba(45,212,191,.1);margin-bottom:12px;"><strong>${escapeWorkspaceText(result.order.productName)} × ${result.order.quantity}: ${formatSubscriptionMoney(result.order.amount)}</strong><br>Payment reference: <strong>${escapeWorkspaceText(result.order.reference)}</strong></div>${destination}<p style="margin:12px 0 0;color:var(--text-muted);font-size:.82rem;">Use the reference exactly as shown so the order and payment can be matched.</p>`);
    loadStoreItems();
  } catch (error) { alert(error.message || 'Unable to create the order.'); }
}

async function addStoreProduct(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/store/products', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name: form.elements.name.value, price: form.elements.price.value, stockQuantity: form.elements.stockQuantity.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to add the store item.');
    form.reset(); loadStoreItems();
  } catch (error) { alert(error.message || 'Unable to add the store item.'); }
}

async function removeStoreProduct(productId) {
  if (!confirm('Remove this school-store item?')) return;
  const response = await fetch(`/api/store/products/${encodeURIComponent(productId)}`, { method:'DELETE' });
  if (!response.ok) return alert('Unable to remove the store item.');
  loadStoreItems();
}

async function loadStoreOrders() {
  const box = document.getElementById('storeOrderNotifications');
  if (!box || !['teacher','principal','admin'].includes(currentUser?.role)) return;
  try {
    const response = await fetch('/api/store/orders');
    const orders = await response.json();
    if (!response.ok) throw new Error(orders.message || 'Unable to load store orders.');
    box.innerHTML = orders.length ? orders.map(order => `<div class="item-row"><strong>🛍️ ${escapeWorkspaceText(order.productName)} × ${order.quantity}</strong><span class="badge-tag urgent">${escapeWorkspaceText(order.status)}</span><p style="margin:3px 0 0;color:var(--text-muted);">Parent: ${escapeWorkspaceText(order.parentName)} · ${formatSubscriptionMoney(order.amount)} · Ref ${escapeWorkspaceText(order.reference)}</p></div>`).join('') : '<p class="meta">No school-store orders are waiting for preparation.</p>';
  } catch { box.textContent = 'Unable to load school-store orders.'; }
}

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

function escapeWorkspaceText(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function showProviderSetup(providerName) {
  openModal(`${providerName} connection required`, `<div style="font-size:.9rem;line-height:1.6;"><p>This feature needs an approved school-owned ${providerName} account before it can operate.</p><p style="margin-top:10px;"><strong>Next steps:</strong></p><ol style="margin:6px 0 0 20px;"><li>Choose and contract an approved provider.</li><li>Obtain the provider credentials and consent documentation.</li><li>Ask an administrator to configure the connection securely.</li></ol><p style="margin-top:10px;color:var(--text-muted);">No payment, payroll, SMS, or push messages are sent until a provider is connected.</p></div>`);
}

function quickCareLog(activity) {
  const learner = prompt(`Who is this ${activity.toLowerCase()} for? Enter learner or class name.`);
  if (!learner || !learner.trim()) return;
  saveWorkspaceRecord(null, 'dailyCare', `${activity}: ${learner.trim()}`);
}

async function loadConsentRecords() {
  const list = document.getElementById('consentRecords');
  if (!list) return;
  const response = await fetch('/api/consents');
  const records = await response.json();
  list.innerHTML = records.length ? records.map(record => `<div class="item-row"><div><strong>${escapeWorkspaceText(record.learnerName)}</strong><p style="margin-top:3px;">Guardian: ${escapeWorkspaceText(record.guardianName)} · Internal updates: ${record.internalUpdates ? 'Allowed' : 'Not allowed'} · Marketing: ${record.marketingPhotos ? 'Allowed' : 'Not allowed'}</p><span class="meta">${escapeWorkspaceText(record.capturedAt)}</span></div></div>`).join('') : '<p class="meta">No consent decisions recorded.</p>';
}

async function loadPickupRecords() {
  const list = document.getElementById('pickupRecords');
  if (!list) return;
  const response = await fetch('/api/pickups');
  const records = await response.json();
  list.innerHTML = records.length ? records.map(record => `<div class="item-row"><div><strong>${escapeWorkspaceText(record.action)} · ${escapeWorkspaceText(record.learnerName)}</strong><p style="margin-top:3px;">Verified adult: ${escapeWorkspaceText(record.pickupAdult)} · Recorded by: ${escapeWorkspaceText(record.recordedBy)}</p><span class="meta">${escapeWorkspaceText(record.timestamp)}</span></div></div>`).join('') : '<p class="meta">No handover audit records recorded.</p>';
}

async function saveWorkspaceRecord(event, module, defaultDetails) {
  if (event) event.preventDefault();
  const detailsInput = event?.target?.querySelector('[name="details"]');
  const details = detailsInput?.value.trim() || defaultDetails;
  if (!details) return;
  const response = await fetch(`/api/modules/${module}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: defaultDetails, details, recordedBy: currentUser?.name || currentUser?.username || 'User' }) });
  if (!response.ok) return alert('Unable to save this record.');
  if (event) event.target.reset();
  await loadWorkspaceRecords(module);
  playDingSound();
}

async function loadWorkspaceRecords(module) {
  const list = document.getElementById(`${module}Records`);
  if (!list) return;
  try {
    const response = await fetch(`/api/modules/${module}`);
    const records = await response.json();
    list.innerHTML = records.length ? records.map(record => `<div class="item-row"><div><strong>${escapeWorkspaceText(record.type || 'Record')}</strong><p style="margin-top:3px;">${escapeWorkspaceText(record.details)}</p><span class="meta">${escapeWorkspaceText(record.recordedBy || 'User')} · ${escapeWorkspaceText(record.createdAt || '')}</span></div>${currentUser?.role === 'admin' ? `<button type="button" class="action-btn btn-red" onclick="deleteWorkspaceRecord('${module}','${record.id}')">Delete</button>` : ''}</div>`).join('') : '<p style="font-size:.84rem;color:var(--text-muted);">No records saved in this workspace yet.</p>';
  } catch { list.textContent = 'Unable to load workspace records.'; }
}

async function deleteWorkspaceRecord(module, id) {
  if (!confirm('Delete this record?')) return;
  await fetch(`/api/modules/${module}/${id}`, { method: 'DELETE' });
  loadWorkspaceRecords(module);
}

function openModulesBreakdownModal() {
  const content = `
    <div style="font-size:.88rem;line-height:1.55;color:var(--text-dark);">
      <p style="color:var(--text-muted);margin-bottom:14px;">Little Feet brings communication, records, learning evidence, and safety notices into one school portal.</p>
      <div style="display:grid;gap:10px;">
        <div style="padding:11px;border-left:4px solid #0d9488;background:rgba(13,148,136,.08);border-radius:6px;"><strong>🗺️ Nearby Schools & Campus Discovery</strong><br><span style="color:var(--text-muted);">Uses your optional device location to show mapped education facilities in a 20 km radius. Results are grouped to keep the map readable; select a pin for mapped address and public contact details.</span></div>
        <div style="padding:11px;border-left:4px solid #0284c7;background:rgba(2,132,199,.08);border-radius:6px;"><strong>📚 Learning Records & Portfolio</strong><br><span style="color:var(--text-muted);">Schedules, worksheets, badges, and attendance support day-to-day classroom documentation. Uploaded evidence remains connected to the relevant record.</span></div>
        <div style="padding:11px;border-left:4px solid #2dd4bf;background:rgba(45,212,191,.08);border-radius:6px;"><strong>🚨 Location-Aware Safety Alerts</strong><br><span style="color:var(--text-muted);">Administrators can create an alert with a location and radius. A user sees it only when their device is within that area and location access is enabled.</span></div>
        <div style="padding:11px;border-left:4px solid #8b5cf6;background:rgba(139,92,246,.08);border-radius:6px;"><strong>💬 Secure Communication Workspaces</strong><br><span style="color:var(--text-muted);">Group and direct chat support staff coordination, while Support Desk provides a separate route for issues requiring tracking and follow-up.</span></div>
        <div style="padding:11px;border-left:4px solid #22c55e;background:rgba(34,197,94,.08);border-radius:6px;"><strong>🟢 Live Service Indicator</strong><br><span style="color:var(--text-muted);">The header light reflects whether the portal is online, busy, or unavailable. A green light means the app can reach the server.</span></div>
      </div>
      <p style="margin-top:14px;font-size:.78rem;color:var(--text-muted);">Data availability depends on your role, school configuration, browser permissions, and the public information supplied by the mapped school.</p>
    </div>`;
  openModal('System Capabilities & Architecture', content);
}
