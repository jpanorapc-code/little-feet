// Existing handlers, registered at their original middleware positions.
function registerAuthHumanCheckRoutes(app, context) {
app.get('/api/auth/human-check', (req, res) => {
  if (!context.enforcePublicRateLimit(req, res, 'login-human-check', 60, 10 * 60 * 1000)) return;
  res.set('Cache-Control', 'no-store');
  if (!context.loginHumanCheckRequired()) return res.json({ required: false });
  res.json({ required: true, ...context.issueLoginHumanCheck(req) });
});
}

function registerLoginRoutes(app, context) {
app.post('/api/login', (req, res) => context.withLoginVerification(async () => {
  const { username, pin } = req.body;
  if (!context.verifyLoginHumanCheck(req, req.body)) {
    context.logStructured('warn', 'auth.human_check_failed', {
      category: 'authentication',
      requestId: req.requestId,
      method: req.method,
      route: req.path,
      result: 'rejected'
    });
    return res.status(400).json({
      message: 'Please complete the security check and try again.',
      humanCheckRequired: true
    });
  }
  const loginUsername = context.limitedText(username, 160);
  const normalizedUsername = loginUsername ? context.normalizeUsername(loginUsername) : '';

  // Every accepted login alias for the same account shares one username-level
  // spray bucket. Otherwise an attacker could multiply guesses by rotating
  // aliases while also rotating source IPs.
  const matchedAccount = normalizedUsername
    ? context.db.users.find(account => context.accountMatchesUsername(account, normalizedUsername))
    : null;
  const attemptIdentity = matchedAccount ? context.normalizeUsername(matchedAccount.username) : normalizedUsername;
  const attemptKey = context.loginAttemptKey(req, attemptIdentity || '[invalid-username]');
  const previousAttempts = context.activeLoginAttempt(attemptKey);
  const previousUsernameAttempts = context.activeUsernameAttempt(attemptIdentity);
  const activeLockout = [previousAttempts, previousUsernameAttempts]
    .filter(entry => Number(entry?.lockedUntil) > Date.now())
    .sort((left, right) => Number(right.lockedUntil) - Number(left.lockedUntil))[0];
  if (activeLockout) {
    const retryAfterSeconds = context.loginLockoutRemainingSeconds(activeLockout);
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      message: 'Too many unsuccessful sign-in attempts. Please wait 10 minutes before trying again.',
      retryAfterSeconds
    });
  }

  const checkedHash = matchedAccount?.pinHash;
  const passwordMatches = matchedAccount && context.validSecretLength(pin) && await context.matchesPinAsync(pin, checkedHash);
  // A standby refresh may replace an account while the worker is checking its
  // password. Re-read it so a deleted account or changed password cannot sign in.
  const currentAccount = matchedAccount ? context.findAccountByUsername(matchedAccount.username) : null;
  const user = passwordMatches && currentAccount?.pinHash === checkedHash
    ? currentAccount
    : null;
  if (user) {
    if (context.isAwaitingAccountVerification(user)) {
      return res.status(403).json({ message: 'This account is waiting for school approval. Please contact your school administrator.' });
    }
    context.loginAttempts.delete(attemptKey);
    context.loginUsernameAttempts.delete(attemptIdentity);
    if (!context.replicaMode && context.pinHashNeedsUpgrade(user.pinHash)) user.pinHash = await context.hashPinAsync(pin);
    context.establishAuthenticatedSession(req, user, (error, safeUser) => {
      if (error) return res.status(500).json({ message: 'Unable to establish a secure sign-in session. Please try again.' });
      res.json({ user: safeUser });
    });
  } else {
    const now = Date.now();
    const nextSourceCount = (previousAttempts?.count || 0) + 1;
    const nextUsernameCount = (previousUsernameAttempts?.count || 0) + 1;
    const sourceLocked = nextSourceCount >= context.MAX_LOGIN_ATTEMPTS;
    const usernameLocked = nextUsernameCount >= context.MAX_DISTRIBUTED_LOGIN_ATTEMPTS;
    const lockedUntil = sourceLocked || usernameLocked ? now + context.LOGIN_COOLDOWN_MS : 0;

    context.loginAttempts.set(attemptKey, {
      count: nextSourceCount,
      firstAttempt: previousAttempts?.firstAttempt || now,
      ...(sourceLocked ? { lockedUntil } : {})
    });
    context.loginUsernameAttempts.set(attemptIdentity, {
      count: nextUsernameCount,
      firstAttempt: previousUsernameAttempts?.firstAttempt || now,
      ...(usernameLocked ? { lockedUntil } : {})
    });
    if (context.loginAttempts.size > 10000 || context.loginUsernameAttempts.size > 10000) context.pruneLoginAttempts();

    if (sourceLocked || usernameLocked) {
      if (matchedAccount && usernameLocked) {
        void context.sendLoginLockoutEmail(matchedAccount).catch(error => {
          context.logStructured('error', 'auth.lockout_email_failed', { category: 'authentication', requestId: req.requestId, user: matchedAccount?.username || '', role: matchedAccount?.role || '', schoolId: matchedAccount ? context.accountSchoolId(matchedAccount) : '', schoolName: matchedAccount?.schoolName || '', method: req.method, route: req.path, message: error.message });
        });
      }
      const retryAfterSeconds = Math.ceil(context.LOGIN_COOLDOWN_MS / 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        message: 'Too many unsuccessful sign-in attempts. Please wait 10 minutes before trying again.',
        retryAfterSeconds
      });
    }

    res.status(401).json({ message: "Invalid Staff ID / Parent Email or PIN." });
  }
}));
}

function registerSignupRoutes(app, context) {
app.post('/api/signup', (req, res) => {
  const { username, pin, name, role, schoolName, termsAccepted, linkedLearners } = req.body;
  const cleanUsername = context.boundedText(username, 160);
  const cleanName = context.boundedText(name, 160);
  const cleanSchoolName = context.boundedText(schoolName, 160);
  const selfRegistrationRoles = ['parent', 'teacher', 'principal'];
  if (!cleanUsername || !pin || !cleanName || !cleanSchoolName || !selfRegistrationRoles.includes(role)) {
    return res.status(400).json({ message: 'Complete all fields and choose Parent, Teacher, or Principal.' });
  }
  if (!termsAccepted) return res.status(400).json({ message: 'You must accept the school privacy notice and terms before creating an account.' });
  if (String(pin).length < 4 || String(pin).length > 128) return res.status(400).json({ message: 'Choose a password or PIN between 4 and 128 characters.' });
  if (context.db.users.some(account => context.accountMatchesUsername(account, cleanUsername))) return res.status(409).json({ message: 'That username is already in use.' });
  const linkValidation = role === 'parent' ? context.validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const requestedLinks = linkValidation.links;
  const account = {
    username: cleanUsername, pinHash: context.hashPin(pin), name: cleanName, role,
    schoolName: cleanSchoolName, schoolStoreUrl: '', linkedLearners: [],
    requestedLearnerLinks: role === 'parent' ? requestedLinks : [],
    parentRelationshipStatus: role === 'parent' ? 'Pending administrator approval' : undefined,
    subscription: role === 'parent' ? 'basic' : 'school',
    verificationStatus: 'Self-registered — school verification pending',
    termsAcceptedAt: new Date().toISOString(),
    termsVersion: context.LITTLE_FEET_TERMS_VERSION,
    privacyAcceptedAt: new Date().toISOString(),
    privacyVersion: context.LITTLE_FEET_PRIVACY_VERSION
  };
  account.schoolId = context.ensureSchool(account.schoolName).id;
  context.db.users.push(account);
  const { pin: _pin, pinHash: _pinHash, ...safeAccount } = account;
  res.status(201).json({ success: true, account: safeAccount });
});
}

function registerAuthProvidersRoutes(app, context) {
app.get('/api/auth/providers', (req, res) => res.json({ google: context.googleSignInConfigured, yahoo: context.yahooSignInConfigured, microsoft: context.microsoftSignInConfigured }));

app.get('/api/auth/session', (req, res) => {
  const account = context.getSessionAccount(req);
  if (!account) return res.json({ authenticated: false, user: null });
  res.json({ authenticated: true, user: context.safeAccount(account) });
});

app.post('/api/auth/logout', (req, res) => {
  const clearSessionCookie = () => res.clearCookie('littlefeet.sid', { path: '/', secure: context.isProduction, httpOnly: true, sameSite: 'lax' });
  if (!req.session) {
    clearSessionCookie();
    return res.json({ success: true });
  }
  req.session.destroy(error => {
    clearSessionCookie();
    if (error) return res.status(500).json({ message: 'Unable to complete sign out. Please try again.' });
    res.json({ success: true });
  });
});
}

module.exports = { registerAuthHumanCheckRoutes, registerLoginRoutes, registerSignupRoutes, registerAuthProvidersRoutes };
