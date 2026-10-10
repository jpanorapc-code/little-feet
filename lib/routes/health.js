// Existing handlers, registered at their original middleware positions.
function registerFailoverReadinessRoutes(app, context) {
app.get('/api/failover-readiness', async (req, res) => {
  const capturedMs = Date.parse(context.replicaCapturedAt);
  const ageSeconds = Number.isFinite(capturedMs) ? Math.max(0, Math.floor((Date.now() - capturedMs) / 1000)) : null;
  const maximumAgeSeconds = Math.max(30, Math.min(600, Number(process.env.LF_REPLICA_MAX_AGE_SECONDS) || 120));
  const versionMatch = context.applicationSha && context.replicaSourceSha
    ? context.applicationSha === context.replicaSourceSha
    : false;
  let sharedDatabaseReady = false;
  if (context.sharedDatabaseFailover && context.postgresPool) {
    try {
      await context.postgresPool.query('SELECT 1 FROM little_feet_metadata LIMIT 1');
      sharedDatabaseReady = true;
    } catch (error) {
      context.logStructured('warn', 'failover.shared_database_readiness_failed', { category: 'failover', message: error.message });
    }
  }
  const ready = context.sharedDatabaseFailover ? sharedDatabaseReady : context.replicaMode && context.replicaTransport.configured && ageSeconds !== null
    && ageSeconds <= maximumAgeSeconds && versionMatch === true;
  res.set('Cache-Control', 'no-store');
  res.set('Access-Control-Allow-Origin', '*');
  return res.status(ready ? 200 : 503).json({
    ready,
    instance: context.replicaMode ? 'STANDBY' : 'PRIMARY',
    mode: context.sharedDatabaseFailover ? 'shared-postgresql-writable' : context.replicaMode ? 'r2-snapshot-read-only' : 'primary',
    writeCapable: !context.readOnlySnapshotMode,
    configured: context.sharedDatabaseFailover ? Boolean(process.env.DATABASE_URL) : context.replicaTransport.configured,
    capturedAt: context.replicaCapturedAt || null,
    ageSeconds,
    maximumAgeSeconds,
    applicationSha: context.applicationSha || null,
    replicaSourceSha: context.replicaSourceSha || null,
    versionMatch: context.sharedDatabaseFailover ? null : versionMatch
  });
});

app.get('/api/health', async (req, res) => {
  // Do not count the health probe itself, and do not report normal concurrent
  // dashboard startup requests as server overload.
  const reportedActiveRequests = Math.max(0, context.activeRequestCount - 1);
  const status = reportedActiveRequests >= context.SERVER_BUSY_THRESHOLD ? 'BUSY' : 'OK';
  const actor = context.getSessionAccount(req);
  res.set('Cache-Control', 'no-store');
  let persistenceAvailable = true;
  if (context.postgresPool) {
    try { await context.postgresPool.query('SELECT 1'); }
    catch (error) {
      persistenceAvailable = false;
      context.logStructured('warn', 'persistence.health_probe_failed', { category: 'persistence', message: error.message });
    }
  }
  if (!persistenceAvailable) res.status(503);
  if (!actor) return res.json({ status: persistenceAvailable ? status : 'DATABASE_UNAVAILABLE', timestamp: new Date().toISOString() });
  return res.json({
    status: persistenceAvailable ? status : 'DATABASE_UNAVAILABLE',
    instance: context.replicaMode ? 'STANDBY' : 'PRIMARY',
    replica: context.replicaMode ? {
      mode: context.sharedDatabaseFailover ? 'shared-postgresql-writable' : 'r2-snapshot-read-only',
      transport: context.sharedDatabaseFailover ? 'shared-postgresql' : context.replicaTransport.configured ? 'cloudflare-r2' : 'local-file-only',
      configured: context.sharedDatabaseFailover ? Boolean(process.env.DATABASE_URL) : context.replicaTransport.configured,
      available: context.sharedDatabaseFailover ? Boolean(context.postgresPool) : Boolean(context.replicaCapturedAt),
      capturedAt: context.replicaCapturedAt || null,
      ageSeconds: context.replicaCapturedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(context.replicaCapturedAt)) / 1000)) : null,
      applicationSha: context.replicaSourceSha || null
    } : undefined,
    activeRequests: reportedActiveRequests,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/keepalive', async (_req, res) => {
  try {
    if (context.postgresPool) await context.postgresPool.query('SELECT 1');
    else if (context.stateDatabase) context.stateDatabase.prepare('SELECT 1').get();
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  } catch (error) {
    context.logStructured('error', 'health.keepalive_probe_failed', { category: 'health', message: error.message, result: 'failed' });
    res.status(503).json({ status: 'DATABASE_UNAVAILABLE', timestamp: new Date().toISOString() });
  }
});
}

function registerReadyRoutes(app, context) {
app.get('/api/ready', (req, res) => {
  const readiness = context.runtimeReadiness();
  res.set('Cache-Control', 'no-store');
  // Public monitors need only the readiness result. Detailed infrastructure
  // checks remain available to authenticated administrators.
  res.status(readiness.ready ? 200 : 503).json({
    ready: readiness.ready,
    status: readiness.ready ? 'READY' : 'NOT_READY',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/production-readiness', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const billing = context.subscriptionBillingState(actor);
  const readiness = context.runtimeReadiness();
  const integrations = {
    paymentDestination: context.billingPaymentConfigured(billing.payment),
    signedPaymentWebhook: Boolean(process.env.LF_PAYMENT_WEBHOOK_SECRET),
    payfastAutomaticConfirmation: context.payFastConfigured(),
    emailDelivery: Boolean(context.smtpEmailConfigured() || context.apiEmailConfigured()),
    smsDelivery: Boolean(process.env.LF_SMS_FROM && process.env.LF_SMS_API_KEY && context.safeHttpsUrl(process.env.LF_SMS_API_URL)),
    pushDelivery: Boolean(process.env.LF_PUSH_API_KEY && context.safeHttpsUrl(process.env.LF_PUSH_API_URL)),
    monitoring: Boolean(process.env.LF_MONITORING_DSN || process.env.LF_MONITORING_PROVIDER),
    monitoringProvider: context.boundedText(process.env.LF_MONITORING_PROVIDER || (process.env.LF_MONITORING_DSN ? 'external-dsn' : ''), 80),
    privateObjectStorage: context.objectStorage.configured,
    objectStorageProvider: context.objectStorage.kind,
    offsiteBackup: Boolean(process.env.LF_BACKUP_R2_BUCKET && process.env.LF_BACKUP_REHEARSAL_ID),
    backupProvider: process.env.LF_BACKUP_R2_BUCKET ? 'cloudflare-r2-isolated-bucket' : '',
    backupRehearsalId: context.boundedText(process.env.LF_BACKUP_REHEARSAL_ID, 120)
  };
  const missingActions = [];
  if (!readiness.checks.database) missingActions.push('Connect a persistent PostgreSQL DATABASE_URL.');
  if (!readiness.checks.fieldEncryption) missingActions.push('Set LF_FIELD_ENCRYPTION_KEY.');
  if (!readiness.checks.sessionSecret) missingActions.push('Set a strong SESSION_SECRET.');
  if (!readiness.checks.privateObjectStorage) missingActions.push('Configure the private Cloudflare R2 bucket and server-side credentials.');
  if (!readiness.checks.storageCleanupHealthy) missingActions.push('Resolve pending private-object cleanup jobs.');
  if (!integrations.paymentDestination) missingActions.push('Configure a bank-transfer destination, HTTPS payment link, or PayFast automatic confirmation.');
  if (context.payFastMode === 'sandbox' && context.isProduction) missingActions.push('Production cannot use PayFast sandbox mode. Set LF_PAYFAST_MODE=live.');
  if (!integrations.monitoring) missingActions.push('Configure error and uptime monitoring.');
  if (!integrations.offsiteBackup) missingActions.push('Configure an offsite backup target and test a restore.');
  res.json({
    ...readiness,
    integrations,
    missingActions,
    launchReady: readiness.ready && integrations.paymentDestination && integrations.monitoring && integrations.offsiteBackup,
    checkedAt: new Date().toISOString()
  });
});
}

module.exports = { registerFailoverReadinessRoutes, registerReadyRoutes };
