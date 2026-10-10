// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const normalizeUsername = (value) => String(value || '').trim().toLocaleLowerCase('en-US');

const accountMatchesUsername = (account, value) => {
  const requested = context.normalizeUsername(value);
  return context.normalizeUsername(account.username) === requested
    || (account.loginAliases || []).some(alias => context.normalizeUsername(alias) === requested);
};

const findAccountByUsername = (username) => context.db.users.find(account => context.accountMatchesUsername(account, username));

const normaliseAccessCode = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

const validSecretLength = (value, { min = 1, max = 128 } = {}) =>
  typeof value === 'string' && value.length >= min && value.length <= max;

const isAwaitingAccountVerification = account => String(account?.verificationStatus || '').toLowerCase().includes('pending');

const configuredPlatformOwnerUsername = () => context.normalizeUsername(process.env.LF_OWNER_ADMIN_USERNAME || process.env.LF_BOOTSTRAP_ADMIN_USERNAME || '');

const isConfiguredPlatformOwner = account => Boolean(account && context.configuredPlatformOwnerUsername() && context.normalizeUsername(account.username) === context.configuredPlatformOwnerUsername());

const hasPlatformAccess = account => Boolean(account && (account.role === 'admin' && (account.platformAccess === true || context.isConfiguredPlatformOwner(account))));

const isAdminLike = account => Boolean(account && (account.role === 'admin' || context.hasPlatformAccess(account)));

const isCompanyStaffRole = account => Boolean(account && (context.hasPlatformAccess(account) || ['admin', 'staff', 'crm', 'accounts', 'support'].includes(account.role)));

const canUseDirectChat = (first, second) => {
  if (!first || !second || context.isAwaitingAccountVerification(first) || context.isAwaitingAccountVerification(second) || !context.CHAT_ROLES.has(first.role) || !context.CHAT_ROLES.has(second.role) || first.username === second.username) return false;
  const parent = first.role === 'parent' ? first : second.role === 'parent' ? second : null;
  if (!parent) return context.isSameSchool(first, second) || context.PLATFORM_INTERNAL_ROLES.has(first.role) || context.PLATFORM_INTERNAL_ROLES.has(second.role) || context.hasPlatformAccess(first) || context.hasPlatformAccess(second);
  if (!context.isSameSchool(parent, parent === first ? second : first)) return false;
  const staffMember = parent === first ? second : first;
  if (staffMember.role === 'principal') return true;
  if (staffMember.role !== 'teacher') return false;
  const learnerClasses = new Set(context.tenantRecords(context.db.students, parent).filter(learner => context.isParentLinkedToLearner(parent, learner)).map(learner => context.normalizeComparableText(learner.className)).filter(Boolean));
  return context.normaliseAssignedClasses(staffMember.assignedClasses).some(className => learnerClasses.has(className));
};

const accessCodeInUse = (candidate) => context.db.learnerAccessCodes.some(entry => entry.status === 'active' && context.decryptStoredField(entry.codeEncrypted) === candidate);

const loginAttemptKey = (req, username) => `${req.ip}:${context.normalizeUsername(username)}`;

const loginAttemptExpiry = entry => Number(entry?.lockedUntil) || (Number(entry?.firstAttempt) + context.LOGIN_ATTEMPT_WINDOW_MS);

const activeLoginAttempt = key => context.activeAttempt(context.loginAttempts, key);

const activeUsernameAttempt = username => context.activeAttempt(context.loginUsernameAttempts, context.normalizeUsername(username));

const loginLockoutRemainingSeconds = entry => Math.max(1, Math.ceil((Number(entry?.lockedUntil) - Date.now()) / 1000));

const clearLoginLockoutForAccount = account => {
  const identity = context.normalizeUsername(account?.username);
  if (!identity) return 0;
  let cleared = context.loginUsernameAttempts.delete(identity) ? 1 : 0;
  const suffix = `:${identity}`;
  for (const key of [...context.loginAttempts.keys()]) {
    if (key.endsWith(suffix)) {
      context.loginAttempts.delete(key);
      cleared += 1;
    }
  }
  return cleared;
};

const loginSecurityRequestSummary = req => ({
  network: context.boundedText(req.ip || 'Unavailable', 96) || 'Unavailable',
  device: context.boundedText(req.get('user-agent') || 'Unknown browser or device', 300) || 'Unknown browser or device'
});

const pruneLoginAttempts = (now = Date.now()) => {
  for (const [key, entry] of context.loginAttempts) {
    if (!entry || now >= context.loginAttemptExpiry(entry)) context.loginAttempts.delete(key);
  }
  for (const [key, entry] of context.loginUsernameAttempts) {
    if (!entry || now >= context.loginAttemptExpiry(entry)) context.loginUsernameAttempts.delete(key);
  }
  while (context.loginAttempts.size > 10000) context.loginAttempts.delete(context.loginAttempts.keys().next().value);
  while (context.loginUsernameAttempts.size > 10000) context.loginUsernameAttempts.delete(context.loginUsernameAttempts.keys().next().value);
};

const loginHumanCheckRequired = () => process.env.NODE_ENV !== 'test' || process.env.LF_TEST_REQUIRE_HUMAN_CHECK === '1';

const loginHumanCheckClientHash = req => context.crypto.createHash('sha256')
  .update(String(req.get('user-agent') || '').slice(0, 500))
  .digest('hex');

const pruneUsedLoginHumanChecks = (now = Date.now()) => {
  for (const [key, expiresAt] of context.usedLoginHumanChecks) {
    if (Number(expiresAt) < now) context.usedLoginHumanChecks.delete(key);
  }
  while (context.usedLoginHumanChecks.size > context.LOGIN_HUMAN_CHECK_USED_MAX) {
    context.usedLoginHumanChecks.delete(context.usedLoginHumanChecks.keys().next().value);
  }
};

const issueLoginHumanCheck = req => {
  const first = context.crypto.randomInt(2, 10);
  const second = context.crypto.randomInt(1, 9);
  const subtract = context.crypto.randomInt(0, 2) === 1;
  const left = subtract ? Math.max(first, second) : first;
  const right = subtract ? Math.min(first, second) : second;
  const answer = subtract ? left - right : left + right;
  const nonce = context.crypto.randomBytes(18).toString('hex');
  const expiresAt = Date.now() + context.LOGIN_HUMAN_CHECK_TTL_MS;
  const clientHash = context.loginHumanCheckClientHash(req);
  const signature = context.loginHumanCheckSignature({ nonce, expiresAt, clientHash, answer });
  return {
    challengeId: `${nonce}.${expiresAt}.${signature}`,
    prompt: `What is ${left} ${subtract ? '−' : '+'} ${right}?`,
    left,
    right,
    operator: subtract ? '−' : '+',
    expiresInSeconds: Math.floor(context.LOGIN_HUMAN_CHECK_TTL_MS / 1000)
  };
};

const verifyLoginHumanCheck = (req, body) => {
  if (!context.loginHumanCheckRequired()) return true;
  const challengeId = context.limitedText(body?.humanCheckId, 180);
  const answer = context.limitedText(body?.humanCheckAnswer, 20);
  const honeypot = context.limitedText(body?.companyWebsite, 200);
  if (honeypot || !challengeId || !answer) return false;

  const parts = challengeId.split('.');
  if (parts.length !== 3) return false;
  const [nonce, expiresText, suppliedSignature] = parts;
  if (!/^[a-f0-9]{36}$/.test(nonce) || !/^\d{13}$/.test(expiresText) || !/^[a-f0-9]{64}$/.test(suppliedSignature)) return false;

  const expiresAt = Number(expiresText);
  const now = Date.now();
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + context.LOGIN_HUMAN_CHECK_TTL_MS + 30000) return false;

  context.pruneUsedLoginHumanChecks(now);
  const fingerprint = context.crypto.createHash('sha256').update(challengeId).digest('hex');
  if (context.usedLoginHumanChecks.has(fingerprint)) return false;
  context.usedLoginHumanChecks.set(fingerprint, expiresAt);

  const expectedSignature = context.loginHumanCheckSignature({
    nonce,
    expiresAt,
    clientHash: context.loginHumanCheckClientHash(req),
    answer
  });
  const expected = Buffer.from(expectedSignature, 'hex');
  const actual = Buffer.from(suppliedSignature, 'hex');
  return expected.length === actual.length && context.crypto.timingSafeEqual(expected, actual);
};

const establishAuthenticatedSession = (req, account, callback, authMethod = 'password') => {
  context.ensureSchoolTrialStarted(account);
  const safeUser = context.safeAccount(account);
  req.session.regenerate(regenerateError => {
    if (regenerateError) return callback(regenerateError);
    req.session.littleFeetUser = safeUser;
    req.session.save(saveError => {
      if (!saveError) {
        context.logStructured('info', 'auth.login_succeeded', {
          category: 'authentication',
          requestId: req.requestId,
          user: account?.username || '',
          role: account?.role || '',
          schoolId: account ? context.accountSchoolId(account) : '',
          schoolName: account?.schoolName || '',
          method: req.method,
          route: req.path,
          result: 'success',
          details: `Sign-in method: ${authMethod}`
        });
        void context.sendSuccessfulLoginEmail(req, account, authMethod).then(sent => {
          if (sent) context.logStructured('info', 'auth.login_notification_sent', {
            category: 'authentication',
            requestId: req.requestId,
            user: account?.username || '',
            role: account?.role || '',
            schoolId: account ? context.accountSchoolId(account) : '',
            schoolName: account?.schoolName || '',
            method: req.method,
            route: req.path,
            result: 'sent'
          });
        }).catch(error => {
          context.logStructured('error', 'auth.login_notification_failed', {
            category: 'authentication',
            requestId: req.requestId,
            user: account?.username || '',
            role: account?.role || '',
            schoolId: account ? context.accountSchoolId(account) : '',
            schoolName: account?.schoolName || '',
            method: req.method,
            route: req.path,
            message: error.message
          });
        });
      }
      callback(saveError, safeUser);
    });
  });
};

const safeAccount = ({ pin, pinHash, reportSigningPinHash, mailboxConnection, emailForwarding, ...account }) => ({
  ...account,
  platformAccess: context.hasPlatformAccess(account),
  ...(account.role === 'parent' ? { subscription: context.parentSubscriptionActive(account) ? 'plus' : 'basic', parentSubscriptionActive: context.parentSubscriptionActive(account) } : {}),
  ...(!context.PLATFORM_INTERNAL_ROLES.has(account.role) ? { schoolSubscriptionAccess: context.schoolSubscriptionAccessState(account) } : {})
});

const getSessionAccount = (req) => {
  const username = req.session?.littleFeetUser?.username;
  const account = username ? context.findAccountByUsername(username) : null;
  return account && !context.isAwaitingAccountVerification(account) ? account : null;
};

const requireAdmin = (req) => {
  const account = context.getSessionAccount(req);
  return context.isAdminLike(account) ? account : null;
};

const requireAccountManager = req => {
  const account = context.getSessionAccount(req);
  return account && (context.isAdminLike(account) || account.role === 'crm') ? account : null;
};

const requireCompanyStaff = (req) => {
  const account = context.getSessionAccount(req);
  return context.isCompanyStaffRole(account) ? account : null;
};

const runAdminSelfTest = async actor => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const checks = [];
  const findings = [];
  const addCheck = (name, status, detail) => checks.push({ name, status, detail });
  const addFinding = (...args) => findings.push(context.sourceFinding(...args));

  const readiness = context.runtimeReadiness();
  const readinessReasons = {
    database: 'The production database connection is not configured.',
    durableSessions: 'Sessions cannot be stored durably without the production database.',
    fieldEncryption: 'The field-encryption key is missing.',
    sessionSecret: 'The secure session secret is missing.',
    secureCookies: 'Secure-cookie enforcement is not active outside production mode.',
    bootstrapAccount: 'No administrator account currently exists.',
    privateObjectStorage: 'Private object storage is not configured.',
    storageCleanupHealthy: 'At least one object-storage cleanup job requires attention.'
  };
  for (const [name, passed] of Object.entries(readiness.checks)) {
    addCheck(`readiness.${name}`, passed ? 'passed' : 'failed', passed ? 'Configured and available.' : readinessReasons[name]);
    if (!passed) addFinding('error', 'configuration', `readiness.${name}`, readinessReasons[name], 'This production-readiness requirement is currently false in the running application.', 'runtime configuration', null, null, 'Correct the production configuration or resolve the unhealthy storage job.');
  }

  try {
    if (context.postgresPool) await context.postgresPool.query('SELECT 1');
    else if (context.stateDatabase) context.stateDatabase.prepare('SELECT 1').get();
    else throw new Error('No active database adapter is available.');
    addCheck('database.probe', 'passed', 'A live database SELECT 1 probe succeeded.');
  } catch (error) {
    addCheck('database.probe', 'failed', 'Database probe failed.');
    const location = context.errorSourceLocation(error);
    addFinding('error', 'persistence', 'database.probe', 'The live database probe failed.', context.redactSensitiveLogText(error.message), location.source, location.line, location.column, 'Inspect the database connection and Render database availability.');
  }

  const indexPath = context.path.join(context.__dirname, 'index.html');
  let indexSource = '';
  try {
    indexSource = context.fs.readFileSync(indexPath, 'utf8');
    const references = [];
    const collect = regex => {
      let match;
      while ((match = regex.exec(indexSource))) references.push({ raw: match[1], offset: match.index });
    };
    collect(/(?:src|href)=["']([^"']+)["']/gi);
    collect(/url\(\s*["']?([^"'\)]+)["']?\s*\)/gi);
    const checked = new Set();
    for (const reference of references) {
      const raw = String(reference.raw || '').trim();
      if (!raw || raw.startsWith('#') || /^(?:https?:|data:|blob:|mailto:|tel:|javascript:)/i.test(raw)) continue;
      const local = raw.split(/[?#]/)[0].replace(/^\//, '');
      if (!local || local.startsWith('api/') || local.startsWith('auth/') || !/\.[a-z0-9]{1,8}$/i.test(local)) continue;
      if (local.includes('..')) {
        addFinding('error', 'security', 'frontend.asset_reference', 'A public asset reference contains parent-directory traversal.', 'A deployed page should never reference a static file through .. path traversal.', 'index.html', context.sourceLineNumber(indexSource, reference.offset), null, 'Replace it with a normal same-origin asset path.');
        continue;
      }
      if (checked.has(local)) continue;
      checked.add(local);
      const vendorAsset = local.startsWith('vendor/') ? local.slice('vendor/'.length) : '';
      const routeBackedAsset = Boolean(vendorAsset && Object.prototype.hasOwnProperty.call(context.browserVendorSources, vendorAsset));
      if (!context.fs.existsSync(context.path.join(context.__dirname, local)) && !routeBackedAsset) {
        addFinding('error', 'frontend', 'frontend.asset_reference', `Missing deployed asset: ${local}`, 'index.html references a same-origin asset that is neither present on disk nor provided by an approved application route, which can cause broken UI, scripts, images or styles.', 'index.html', context.sourceLineNumber(indexSource, reference.offset), null, 'Restore the referenced file, add the approved serving route, or correct the index.html reference.');
      }
    }
    addCheck('frontend.asset_references', findings.some(item => item.check === 'frontend.asset_reference') ? 'failed' : 'passed', `${checked.size} local deployed asset references checked.`);
  } catch (error) {
    const location = context.errorSourceLocation(error);
    addCheck('frontend.asset_references', 'failed', 'Could not inspect index.html.');
    addFinding('error', 'frontend', 'frontend.asset_references', 'The deployed page could not be inspected.', context.redactSensitiveLogText(error.message), location.source, location.line, location.column, 'Verify that index.html exists and is readable in the deployed application.');
  }

  const publicFiles = ['index.html', 'backup.js'];
  try {
    const assetDir = context.path.join(context.__dirname, 'assets');
    for (const entry of context.fs.readdirSync(assetDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) publicFiles.push(`assets/${entry.name}`);
    }
  } catch {}
  const publicThreatRules = [
    { pattern: /\bprocess\.env\b/, severity: 'error', category: 'security', check: 'public.secret_boundary', issue: 'Server environment access appears in public client source.', why: 'Public browser code must never depend on or expose server environment variables.', recommendation: 'Move this logic to a server-only module.' },
    { pattern: /\b(?:DATABASE_URL|SESSION_SECRET|LF_FIELD_ENCRYPTION_KEY|LF_SMTP_PASSWORD|GOOGLE_CLIENT_SECRET|MICROSOFT_CLIENT_SECRET|R2_SECRET_ACCESS_KEY)\b/, severity: 'error', category: 'security', check: 'public.secret_boundary', issue: 'A server-only secret/configuration name appears in public client source.', why: 'Server-only configuration identifiers in public code can expose implementation details and increase accidental secret-leak risk.', recommendation: 'Remove the server-only reference from public source.' },
    { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, severity: 'error', category: 'security', check: 'public.secret_boundary', issue: 'Private-key material appears in public client source.', why: 'Private keys must never be shipped to a browser.', recommendation: 'Remove and rotate the exposed key immediately.' },
    { pattern: /\b(?:postgres(?:ql)?|mongodb(?:\+srv)?)\:\/\//i, severity: 'error', category: 'security', check: 'public.secret_boundary', issue: 'A database connection URL appears in public client source.', why: 'Database connection strings belong only on the server.', recommendation: 'Remove the connection string from public files and rotate credentials if they were real.' }
  ];
  let publicScanned = 0;
  for (const relative of publicFiles) {
    try {
      const content = context.fs.readFileSync(context.path.join(context.__dirname, relative), 'utf8');
      publicScanned += 1;
      findings.push(...context.scanSourceMatches(relative, content, publicThreatRules));
    } catch (error) {
      addFinding('warn', 'frontend', 'public.source_scan', `Could not inspect public source file ${relative}.`, context.redactSensitiveLogText(error.message), relative, null, null, 'Verify the deployed file exists and is readable.');
    }
  }
  addCheck('public.secret_boundary', findings.some(item => item.check === 'public.secret_boundary') ? 'failed' : 'passed', `${publicScanned} public source files scanned for server-only secrets and database URLs.`);

  try {
    const { auditRouteConnections } = context.requireFromRoot('./scripts/audit-route-connections');
    const routeAudit = auditRouteConnections(context.__dirname);
    const hasBrokenRoute = routeAudit.unmatched.length > 0;
    addCheck('frontend.route_connections', hasBrokenRoute ? 'failed' : 'passed', String(routeAudit.calls.length) + ' literal frontend API call(s) checked against ' + String(routeAudit.routes.length) + ' registered API route(s).');
    for (const call of routeAudit.unmatched.slice(0, 100)) {
      addFinding('error', 'routing', 'frontend.route_connections', 'No matching server route for ' + call.method + ' ' + call.route + '.', 'The deployed frontend contains an API call that does not match any registered server endpoint, so that action can fail at runtime.', call.file, call.line || null, null, 'Restore the matching server route or correct the frontend API path/method.');
    }
  } catch (error) {
    const location = context.errorSourceLocation(error);
    addCheck('frontend.route_connections', 'failed', 'The deployed frontend/server route audit could not run.');
    addFinding('error', 'routing', 'frontend.route_connections', 'The API route connection audit could not complete.', context.redactSensitiveLogText(error.message), location.source, location.line, location.column, 'Verify scripts/audit-route-connections.js is present and readable in the deployed build.');
  }

  const runtimeSourceFiles = ['server.js', 'finance-automation-server.js', 'backup.js', ...publicFiles.filter(name => name.startsWith('assets/'))];
  const executionRules = [
    { pattern: /\beval\s*\(/, severity: 'error', category: 'security', check: 'source.dynamic_code_execution', issue: 'eval() is present in deployed application source.', why: 'eval() can execute strings as code and expands the impact of injection bugs.', recommendation: 'Replace eval() with explicit parsing or normal function calls.' },
    { pattern: /\bnew\s+Function\s*\(/, severity: 'error', category: 'security', check: 'source.dynamic_code_execution', issue: 'new Function() is present in deployed application source.', why: 'Dynamic code construction can turn untrusted strings into executable code.', recommendation: 'Replace dynamic function creation with explicit application logic.' }
  ];
  for (const relative of [...new Set(runtimeSourceFiles)]) {
    try {
      const content = context.fs.readFileSync(context.path.join(context.__dirname, relative), 'utf8');
      const executionFindings = context.scanSourceMatches(relative, content, executionRules).filter(item => {
        if (relative !== 'server.js' || !item.line) return true;
        const sourceLine = content.split('\n')[item.line - 1] || '';
        // The self-test stores the detector regexes and human-readable rule names
        // in server.js. Those literals are not executable dynamic code.
        return !sourceLine.includes("source.dynamic_code_execution");
      });
      findings.push(...executionFindings);
    } catch {}
  }
  addCheck('source.dynamic_code_execution', findings.some(item => item.check === 'source.dynamic_code_execution') ? 'failed' : 'passed', 'Deployed first-party JavaScript checked for eval() and new Function().');

  for (const relative of [...new Set(runtimeSourceFiles)]) {
    try {
      const content = context.fs.readFileSync(context.path.join(context.__dirname, relative), 'utf8');
      const bypassRules = [{
        pattern: /\bconsole\.(?:log|info|warn|error|debug)\s*\(/,
        severity: 'warn', category: 'logging', check: 'logging.centralization',
        issue: 'A server console call bypasses the centralized structured logger.',
        why: 'Direct console output cannot be filtered and traced consistently in the Inspect dashboard.',
        recommendation: 'Route this event through logStructured().'
      }];
      findings.push(...context.scanSourceMatches(relative, content, bypassRules));
    } catch {}
  }
  addCheck('logging.centralization', findings.some(item => item.check === 'logging.centralization') ? 'attention' : 'passed', 'First-party server and browser runtime source checked for direct console logging bypasses.');

  const visibleErrors = (context.db.systemErrors || []).filter(entry => context.systemErrorVisibleTo(entry, actor) && entry.status === 'open');
  addCheck('faults.open', visibleErrors.length ? 'attention' : 'passed', visibleErrors.length ? `${visibleErrors.length} unresolved persistent fault(s) exist.` : 'No unresolved persistent faults.');
  visibleErrors.slice(0, 25).forEach(error => addFinding(
    'warn', 'fault-history', 'faults.open',
    `${error.name || 'Error'} remains ${error.status || 'open'}.`,
    error.message || 'A runtime fault was recorded and has not yet been resolved.',
    error.source || error.route || '', error.line || null, error.column || null,
    error.requestId ? `Trace request ${error.requestId} in Inspect & Logs, fix the cause, then mark the fault resolved.` : 'Review the fault, fix the cause, then mark it resolved.'
  ));

  const recentCutoff = Date.now() - 15 * 60 * 1000;
  const visibleLogs = context.structuredLogger.list().filter(entry => context.structuredLogVisibleTo(entry, actor) && Date.parse(entry.timestamp) >= recentCutoff);
  const serverErrors = visibleLogs.filter(entry => Number(entry.status) >= 500);
  const denied = visibleLogs.filter(entry => [401, 403].includes(Number(entry.status)));
  const limited = visibleLogs.filter(entry => Number(entry.status) === 429);
  const slow = visibleLogs.filter(entry => entry.event === 'http.request' && Number(entry.durationMs) >= context.structuredLogger.slowRequestMs);
  addCheck('traffic.server_errors', serverErrors.length ? 'attention' : 'passed', `${serverErrors.length} HTTP 5xx response(s) in the last 15 minutes.`);
  if (serverErrors.length) addFinding('warn', 'runtime', 'traffic.server_errors', `${serverErrors.length} server-error response(s) were recorded recently.`, 'HTTP 5xx responses mean a request reached the server but the server could not complete it successfully.', '', null, null, 'Filter Inspect logs to 5xx and trace the affected Request IDs.');
  addCheck('traffic.access_denied', denied.length >= 10 ? 'attention' : 'passed', `${denied.length} HTTP 401/403 response(s) in the last 15 minutes.`);
  if (denied.length >= 10) addFinding('warn', 'security', 'traffic.access_denied', 'A burst of access-denied responses was detected.', 'Repeated 401/403 responses can come from a broken client permission flow or from unauthorised probing.', '', null, null, 'Filter logs to 4xx, review users/routes and confirm the traffic is expected.');
  addCheck('traffic.rate_limited', limited.length >= 5 ? 'attention' : 'passed', `${limited.length} HTTP 429 response(s) in the last 15 minutes.`);
  if (limited.length >= 5) addFinding('warn', 'security', 'traffic.rate_limited', 'Repeated rate limiting was triggered.', 'A client is sending requests faster than the configured safety limit; this can be accidental retry behaviour or abusive automation.', '', null, null, 'Filter logs to HTTP 429 and identify the affected route/account pattern.');
  addCheck('performance.slow_requests', slow.length >= 5 ? 'attention' : 'passed', `${slow.length} request(s) exceeded ${context.structuredLogger.slowRequestMs} ms in the last 15 minutes.`);
  if (slow.length >= 5) addFinding('warn', 'performance', 'performance.slow_requests', 'Multiple slow requests were detected.', 'Repeated slow API calls can indicate database pressure, an external integration delay, or an expensive application path.', '', null, null, 'Sort the Inspect stream by route/request and investigate the slowest repeated path.');

  const errors = findings.filter(item => item.severity === 'error').length;
  const warnings = findings.filter(item => item.severity === 'warn').length;
  const completedAt = new Date().toISOString();
  const result = {
    runId: context.crypto.randomUUID(), startedAt, completedAt, durationMs: Date.now() - startedMs,
    status: errors ? 'failed' : warnings ? 'attention' : 'passed',
    summary: { checks: checks.length, passed: checks.filter(check => check.status === 'passed').length, attention: checks.filter(check => check.status === 'attention').length, failed: checks.filter(check => check.status === 'failed').length, errors, warnings },
    checks, findings
  };
  context.logStructured(errors ? 'error' : warnings ? 'warn' : 'info', 'system.self_test_completed', {
    category: 'diagnostics', user: actor.username, role: actor.role, schoolId: context.accountSchoolId(actor), schoolName: actor.schoolName || '',
    result: result.status, details: `${result.summary.checks} checks; ${errors} error finding(s); ${warnings} warning finding(s).`
  });
  return result;
};

const canManageAccount = (actor, target) => Boolean(actor && target && ((!context.isConfiguredPlatformOwner(target) || context.isConfiguredPlatformOwner(actor)) && (context.hasPlatformAccess(actor) || (!context.PLATFORM_INTERNAL_ROLES.has(target.role) && !context.hasPlatformAccess(target) && (actor.role === 'crm' ? context.db.schools.some(school => school.id === context.accountSchoolId(target)) : context.isSameSchool(actor, target))))));

const migrateAccountReferences = (previousUsername, nextUsername) => {
  if (previousUsername === nextUsername) return;
  const previousKey = context.normalizeUsername(previousUsername);
  const referenceFields = new Set(['username','parentUsername','teacherUsername','staffUsername','hostUsername','requesterUsername','userUsername','requestedBy','assignedTo','createdBy','updatedBy','approvedBy','recordedBy','reviewedBy','issuedBy','revokedBy','redeemedBy','uploadedBy','verifiedBy','deletedBy','changedBy','absentTeacher','coverTeacher']);
  const auditCollections = new Set(['users','systemErrors','documentAudit','importAudit','markHistory']);
  const historicalFields = new Set(['before','after','payload','raw','providerMetadata','mailboxConnection']);
  const updateReference = value => typeof value === 'string' && context.normalizeUsername(value) === previousKey ? nextUsername : value;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, item] of Object.entries(value)) {
      if (referenceFields.has(key)) value[key] = updateReference(item);
      else if (!historicalFields.has(key)) visit(item);
    }
  };
  // Update ownership/assignment fields, never message text, email addresses or audit snapshots.
  for (const [collection, records] of Object.entries(context.db)) if (!auditCollections.has(collection)) visit(records);
  for (const message of context.db.directMessages || []) {
    message.sender = updateReference(message.sender);
    message.recipient = updateReference(message.recipient);
  }
  for (const messages of Object.values(context.db.groupMessages || {})) for (const message of messages) message.sender = updateReference(message.sender);
  for (const file of context.db.fileRecords || []) if (file.entityType === 'staff') file.recordId = updateReference(file.recordId);
};

const admissionsManagementActor=req=>{
  const actor=context.getSessionAccount(req);
  return actor&&(context.hasPlatformAccess(actor)||['principal','admin','staff'].includes(actor.role))?actor:null;
};

const admissionForActor=(actor,id)=>(context.db.admissionsApplications||[]).find(item=>item.id===id&&context.admissionApplicationVisibleTo(item,actor));

const inboundWebhookSecret = () => String(process.env.LF_INBOUND_WEBHOOK_SECRET || '').trim();

const requireSafetyStaff = (req) => {
  const account = context.getSessionAccount(req);
  return account && (context.hasPlatformAccess(account) || ['admin', 'principal'].includes(account.role)) ? account : null;
};
return { normalizeUsername, accountMatchesUsername, findAccountByUsername, normaliseAccessCode, validSecretLength, isAwaitingAccountVerification, configuredPlatformOwnerUsername, isConfiguredPlatformOwner, hasPlatformAccess, isAdminLike, isCompanyStaffRole, canUseDirectChat, accessCodeInUse, loginAttemptKey, loginAttemptExpiry, activeLoginAttempt, activeUsernameAttempt, loginLockoutRemainingSeconds, clearLoginLockoutForAccount, loginSecurityRequestSummary, pruneLoginAttempts, loginHumanCheckRequired, loginHumanCheckClientHash, pruneUsedLoginHumanChecks, issueLoginHumanCheck, verifyLoginHumanCheck, establishAuthenticatedSession, safeAccount, getSessionAccount, requireAdmin, requireAccountManager, requireCompanyStaff, runAdminSelfTest, canManageAccount, migrateAccountReferences, admissionsManagementActor, admissionForActor, inboundWebhookSecret, requireSafetyStaff };
}
module.exports = { createHelpers };
