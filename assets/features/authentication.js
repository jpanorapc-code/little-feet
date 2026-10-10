// authentication workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function completeProviderLogin() {
  try {
    const response = await fetch('/api/auth/session', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.authenticated || !data.user) throw new Error(data.message || 'Unable to complete provider sign-in.');
    currentUser = data.user;
    window.history.replaceState({}, document.title, '/');
    setupSession();
  } catch (error) {
    alert(safeUserFacingError(error, 'Provider sign-in could not be completed.'));
    window.history.replaceState({}, document.title, '/');
  }
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
    'google-sign-in-failed': ['Google sign-in could not finish', 'Please try again. If this continues, an administrator should check the Google app connection.'],
    'account-not-linked': ['Account not linked', 'This email is not linked to an approved Little Feet account. Please use your approved school, teacher, parent, principal, or district email.'],
    'account-link-ambiguous': ['Email linked more than once', 'An administrator must remove the duplicate email alias before provider sign-in can continue.'],
    'account-pending': ['Account approval is pending', 'Your school administrator must approve this account before provider sign-in can continue.'],
    'oauth-email-missing': ['Provider email unavailable', 'Your provider did not return a usable email address. Check the provider account and try again.'],
    'session-failed': ['Secure sign-in session could not start', 'Please try again. If this continues, contact your administrator.'],
    'yahoo-sign-in-failed': ['Yahoo sign-in could not finish', 'Please try again. If this continues, an administrator should check the Yahoo app connection.'],
    'microsoft-sign-in-failed': ['Microsoft sign-in could not finish', 'Please try again. If this continues, an administrator should check the Microsoft app connection.']
  };
  const [title, text] = messages[error] || ['Sign-in could not finish', 'Please try again or contact your school administrator.'];
  window.history.replaceState({}, document.title, '/');
  setTimeout(() => openModal(title, `<p style="margin:0;line-height:1.6;">${escapeWorkspaceText(text)}</p>`), 0);
}

function toggleLoginPinVisibility() {
  const input = document.getElementById('loginPin');
  const button = document.getElementById('loginPinToggle');
  if (!input || !button) return;
  const shouldShow = input.type === 'password';
  input.type = shouldShow ? 'text' : 'password';
  const label = shouldShow
    ? (window.translateLittleFeetText?.('hidePassword') || 'Hide password')
    : (window.translateLittleFeetText?.('showPassword') || 'Show password');
  button.setAttribute('aria-pressed', String(shouldShow));
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  input.focus({ preventScroll: true });
}

function refreshLoginPasswordLanguage() {
  const input = document.getElementById('loginPin');
  const button = document.getElementById('loginPinToggle');
  if (!input || !button) return;
  const key = input.type === 'text' ? 'hidePassword' : 'showPassword';
  const fallback = input.type === 'text' ? 'Hide password' : 'Show password';
  const label = window.translateLittleFeetText?.(key) || fallback;
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
}

function clearRememberedLogin() {
  try { localStorage.removeItem(SAVED_LOGIN_USERNAME_KEY); } catch {}
}

async function saveRememberedLogin(username, pin) {
  try { localStorage.setItem(SAVED_LOGIN_USERNAME_KEY, username); } catch {}
  if (!window.PasswordCredential || !navigator.credentials?.store) return;
  try {
    await navigator.credentials.store(new PasswordCredential({
      id: username,
      name: currentUser?.name || username,
      password: pin
    }));
  } catch { /* The browser may choose its own password-save prompt instead. */ }
}

async function loadLoginHumanCheck() {
  const prompt = document.getElementById('loginHumanCheckPrompt');
  const answer = document.getElementById('loginHumanCheckAnswer');
  const challengeId = document.getElementById('loginHumanCheckId');
  const submit = document.querySelector('#loginForm button[type="submit"]');
  const refresh = document.querySelector('#loginHumanCheckPanel .action-btn');
  if (!prompt || !answer || !challengeId) return false;

  const loadVersion = ++loginHumanCheckLoadVersion;
  loginHumanCheckAbortController?.abort();
  prompt.dataset.lfI18n = 'loadingSecurityCheck';
  prompt.textContent = window.translateLittleFeetText?.('loadingSecurityCheck') || 'Loading security check…';
  delete prompt.dataset.humanLeft;
  delete prompt.dataset.humanRight;
  delete prompt.dataset.humanOperator;
  answer.value = '';
  answer.required = true;
  answer.disabled = true;
  challengeId.value = '';
  if (submit) submit.disabled = true;
  if (refresh) refresh.disabled = true;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    loginHumanCheckAbortController = controller;
    const timeout = window.setTimeout(() => controller.abort(), 2500);

    try {
      const response = await fetch('/api/auth/human-check', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (loadVersion !== loginHumanCheckLoadVersion) return false;
      if (!response.ok) throw new Error('Security check unavailable.');

      if (data.required === false) {
        loginHumanCheckEnabled = false;
        document.getElementById('loginHumanCheckPanel')?.classList.add('hidden');
        answer.required = false;
        answer.disabled = true;
        if (submit) submit.disabled = false;
        if (refresh) refresh.disabled = false;
        return true;
      }

      if (!data.challengeId || !data.prompt) throw new Error('Security check unavailable.');
      loginHumanCheckEnabled = true;
      document.getElementById('loginHumanCheckPanel')?.classList.remove('hidden');
      answer.required = true;
      if (Number.isFinite(Number(data.left)) && Number.isFinite(Number(data.right)) && ['+', '−'].includes(data.operator)) {
        prompt.dataset.lfI18n = 'humanCheckQuestion';
        prompt.dataset.humanLeft = String(data.left);
        prompt.dataset.humanRight = String(data.right);
        prompt.dataset.humanOperator = data.operator;
        prompt.textContent = window.translateLittleFeetText?.('humanCheckQuestion', {
          left: data.left,
          operator: data.operator,
          right: data.right
        }) || data.prompt;
      } else {
        prompt.textContent = data.prompt;
      }
      challengeId.value = data.challengeId;
      answer.disabled = false;
      if (submit) submit.disabled = false;
      if (refresh) refresh.disabled = false;
      answer.focus({ preventScroll: true });
      return true;
    } catch (error) {
      if (loadVersion !== loginHumanCheckLoadVersion) return false;
      if (attempt === 0) {
        prompt.dataset.lfI18n = 'retryingSecurityCheck';
        prompt.textContent = window.translateLittleFeetText?.('retryingSecurityCheck') || 'Retrying security check…';
        await new Promise(resolve => window.setTimeout(resolve, 150));
        continue;
      }
      prompt.dataset.lfI18n = 'securityUnavailable';
      prompt.textContent = window.translateLittleFeetText?.('securityUnavailable') || 'Security check unavailable. Select New check to retry.';
      if (submit) submit.disabled = true;
      if (refresh) refresh.disabled = false;
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (loginHumanCheckAbortController === controller) loginHumanCheckAbortController = null;
    }
  }
  return false;
}

function showSignupForm() {
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('signupForm').classList.remove('hidden');
}

function hideSignupForm() {
  document.getElementById('signupForm').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
  document.getElementById('signupForm').reset();
  void loadLoginHumanCheck();
}
