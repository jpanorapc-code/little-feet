// Existing handlers, registered at their original middleware positions.
function registerSystemStatusRoutes(app, context) {
app.get('/api/system-status', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view live system status.' });
  const recentUpdates = (context.db.releaseNotes || []).slice(0, 5);
  const openErrors = (context.db.systemErrors || []).filter(entry => entry.status === 'open' && (!entry.schoolId || entry.schoolId === context.accountSchoolId(actor))).length;
  res.json({ status: openErrors ? 'attention' : 'operational', openIssues: openErrors, recentUpdates, checkedAt: new Date().toISOString() });
});

app.get('/api/system-diagnostics', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const schoolId = context.accountSchoolId(actor);
  const schoolCount = records => (records || []).filter(entry => !entry.schoolId || entry.schoolId === schoolId).length;
  const readiness = context.runtimeReadiness();
  res.json({
    status: readiness.ready ? 'ready' : 'configuration-required', readiness,
    records: {
      accounts: context.db.users.filter(account => context.accountSchoolId(account) === schoolId).length,
      learners: schoolCount(context.db.students), attendance: schoolCount(context.db.attendance),
      messages: schoolCount(context.db.directMessages), payments: schoolCount(context.db.paymentLedger),
      activeFiles: schoolCount(context.db.fileRecords?.filter(file => file.accessState === 'active')),
      openErrors: (context.db.systemErrors || []).filter(entry => entry.status === 'open' && (!entry.schoolId || entry.schoolId === schoolId)).length
    },
    persistence: context.postgresPool ? 'record-based-postgresql' : context.replicaMode ? 'read-only-replica' : 'local-sqlite',
    activeRequests: context.activeRequestCount, generatedAt: new Date().toISOString()
  });
});
}

function registerSystemErrorsRoutes(app, context) {
app.get('/api/system-errors', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  res.json((context.db.systemErrors || []).filter(entry => context.systemErrorVisibleTo(entry, actor)).slice(0, 250));
});

app.get('/api/system-logs', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });

  const severity = context.boundedText(req.query?.severity, 20).toLowerCase();
  const method = context.boundedText(req.query?.method, 12).toUpperCase();
  const status = context.boundedText(req.query?.status, 8).toLowerCase();
  const requestId = context.boundedText(req.query?.requestId, 100);
  const user = context.boundedText(req.query?.user, 160).toLowerCase();
  const event = context.boundedText(req.query?.event, 120).toLowerCase();
  const search = context.boundedText(req.query?.search, 160).toLowerCase();
  const limit = Math.max(25, Math.min(1000, Number(req.query?.limit) || 250));
  const visibleLogs = context.structuredLogger.list().filter(entry => context.structuredLogVisibleTo(entry, actor));
  const recentCutoff = Date.now() - 15 * 60 * 1000;
  const recent = visibleLogs.filter(entry => Date.parse(entry.timestamp) >= recentCutoff);
  const filtered = visibleLogs.filter(entry => {
    if (severity && entry.severity !== severity) return false;
    if (method && entry.method !== method) return false;
    if (status && !context.structuredStatusMatches(entry.status, status)) return false;
    if (requestId && entry.requestId !== requestId) return false;
    if (user && !String(entry.user || '').toLowerCase().includes(user)) return false;
    if (event && !String(entry.event || '').toLowerCase().includes(event)) return false;
    if (search) {
      const haystack = [entry.event, entry.category, entry.route, entry.result, entry.code, entry.message, entry.details, entry.user, entry.requestId].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }).slice(0, limit);
  const summary = {
    captured: visibleLogs.length,
    displayed: filtered.length,
    last15Minutes: recent.length,
    errors: recent.filter(entry => entry.severity === 'error').length,
    warnings: recent.filter(entry => entry.severity === 'warn').length,
    serverErrors: recent.filter(entry => Number(entry.status) >= 500).length,
    deniedOrLimited: recent.filter(entry => [401, 403, 429].includes(Number(entry.status))).length,
    slowRequests: recent.filter(entry => entry.event === 'http.request' && Number(entry.durationMs) >= context.structuredLogger.slowRequestMs).length,
    uniqueUsers: new Set(recent.map(entry => entry.user).filter(Boolean)).size,
    maxEntries: context.structuredLogger.maxEntries,
    slowRequestMs: context.structuredLogger.slowRequestMs,
    newestAt: visibleLogs[0]?.timestamp || null,
    oldestAt: visibleLogs[visibleLogs.length - 1]?.timestamp || null
  };
  res.json({ summary, logs: filtered, generatedAt: new Date().toISOString() });
});

app.delete('/api/system-inspect-history', async (req, res, next) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });

  const platformWide = context.hasPlatformAccess(actor);
  const schoolId = context.accountSchoolId(actor);
  const beforeFaults = Array.isArray(context.db.systemErrors) ? context.db.systemErrors : [];
  const removedPersistentFaults = platformWide
    ? beforeFaults.length
    : beforeFaults.filter(entry => entry.schoolId === schoolId).length;

  context.db.systemErrors = platformWide
    ? []
    : beforeFaults.filter(entry => entry.schoolId !== schoolId);

  const removedRuntimeLogs = context.structuredLogger.clear(entry =>
    platformWide || (entry.schoolId && entry.schoolId === schoolId)
  );

  try {
    await context.saveDatabaseState();
    req.persistenceCommitted = true;
    context.logStructured('info', 'inspection.history_cleared', {
      category: 'error-management',
      requestId: req.requestId,
      user: actor.username,
      role: actor.role,
      schoolId,
      schoolName: actor.schoolName || '',
      method: req.method,
      route: req.path,
      result: 'completed',
      details: `Removed ${removedPersistentFaults} persistent faults and ${removedRuntimeLogs} structured log entries.`
    });
    return res.json({
      success: true,
      removedPersistentFaults,
      removedRuntimeLogs,
      scope: platformWide ? 'platform' : 'school'
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/system-logs/trace/:requestId', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const requestId = context.boundedText(req.params.requestId, 100);
  if (!requestId) return res.status(400).json({ message: 'A request ID is required.' });
  const logs = context.structuredLogger.findByRequestId(requestId).filter(entry => context.structuredLogVisibleTo(entry, actor));
  const errors = (context.db.systemErrors || []).filter(entry => entry.requestId === requestId && context.systemErrorVisibleTo(entry, actor));
  if (!logs.length && !errors.length) return res.status(404).json({ message: 'No trace was found for this request ID.' });
  res.json({ requestId, logs, errors });
});

app.post('/api/system/client-log', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in before sending browser diagnostics.' });
  const severity = ['info', 'warn', 'error'].includes(String(req.body?.severity || '').toLowerCase()) ? String(req.body.severity).toLowerCase() : 'error';
  const code = context.boundedText(req.body?.code || 'CLIENT_ERROR', 100);
  const page = context.boundedText(req.body?.page || '/', 200).split('?')[0];
  const source = context.boundedText(req.body?.source || '', 220).split('?')[0];
  const message = context.boundedText(req.body?.message || 'Browser diagnostic event', 500);
  const line = Number.isFinite(Number(req.body?.line)) ? Number(req.body.line) : null;
  const column = Number.isFinite(Number(req.body?.column)) ? Number(req.body.column) : null;
  const details = [source ? `Source ${source}` : '', line ? `Line ${line}${column ? `:${column}` : ''}` : ''].filter(Boolean).join(' · ');
  const logged = context.logStructured(severity, 'client.error', {
    category: 'browser',
    requestId: req.requestId,
    user: actor.username,
    role: actor.role,
    schoolId: context.accountSchoolId(actor),
    schoolName: actor.schoolName || '',
    method: 'CLIENT',
    route: page,
    result: 'reported',
    code,
    source,
    line,
    column,
    message,
    details
  });

  const persistentCodes = new Set(['WEB_RUNTIME_ERROR', 'WEB_PROMISE_ERROR', 'WEB_RESOURCE_ERROR']);
  if (severity === 'error' && persistentCodes.has(code)) {
    const duplicateCutoff = Date.now() - 5 * 60 * 1000;
    const duplicate = (context.db.systemErrors || []).some(entry =>
      entry.name === code
      && entry.schoolId === context.accountSchoolId(actor)
      && entry.message === context.redactSensitiveLogText(message)
      && Date.parse(entry.createdAt || '') >= duplicateCutoff
    );
    if (!duplicate) {
      const clientError = new Error(message);
      clientError.name = code;
      context.recordSystemError(clientError, req, { severity: 'error', route: page, name: code, source, line, column });
    }
  }
  res.status(201).json({ success: true, logId: logged.id, requestId: req.requestId });
});
}

function registerSystemSelfTestRoutes(app, context) {
app.post('/api/system-self-test', async (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  try {
    res.json(await context.runAdminSelfTest(actor));
  } catch (error) {
    context.recordSystemError(error, req, { severity: 'error', name: 'SELF_TEST_FAILURE' });
    res.status(500).json({ message: 'The site self-test could not complete. The failure was recorded for inspection.', requestId: req.requestId });
  }
});

app.patch('/api/system-errors/:id', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const entry = (context.db.systemErrors || []).find(item => item.id === req.params.id && context.systemErrorVisibleTo(item, actor));
  if (!entry) return res.status(404).json({ message: 'System error report not found.' });
  const status = String(req.body?.status || 'acknowledged').toLowerCase();
  if (!['acknowledged', 'resolved'].includes(status)) return res.status(400).json({ message: 'Choose acknowledged or resolved.' });
  entry.status = status;
  entry.updatedAt = new Date().toISOString();
  entry.updatedBy = actor.username;
  context.logStructured('info', 'system.error_status_changed', {
    category: 'error-management', requestId: req.requestId, user: actor.username, role: actor.role,
    schoolId: context.accountSchoolId(actor), schoolName: actor.schoolName || '', method: req.method, route: req.path,
    result: status, code: entry.name, message: `Error report ${entry.id} marked ${status}.`
  });
  res.json({ success: true, entry });
});
}

function registerReleaseNotesRoutes(app, context) {
app.get('/api/release-notes', async (req, res) => {
  const deployed = await context.resolveRenderDeployReleaseNote();
  if (deployed) return res.json([deployed]);
  res.json((context.db.releaseNotes || []).slice().sort((first, second) => Date.parse(second.publishedAt || '') - Date.parse(first.publishedAt || '')));
});
}

module.exports = { registerSystemStatusRoutes, registerSystemErrorsRoutes, registerSystemSelfTestRoutes, registerReleaseNotesRoutes };
