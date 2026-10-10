// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const runtimeReadiness = () => {
  const checks = {
    database: Boolean(process.env.DATABASE_URL),
    durableSessions: Boolean(process.env.DATABASE_URL),
    fieldEncryption: context.fieldEncryptionConfigured,
    sessionSecret: context.sessionSecretConfigured,
    secureCookies: context.isProduction,
    bootstrapAccount: context.db.users.some(account => account.role === 'admin'),
    privateObjectStorage: context.objectStorage.configured,
    storageCleanupHealthy: !(context.db.storageCleanupJobs || []).some(job => job.status === 'retry_required')
  };
  return { checks, ready: Object.values(checks).every(Boolean) };
};

const recordSystemError = (error, req = null, extra = {}) => {
  if (!Array.isArray(context.db.systemErrors)) context.db.systemErrors = [];
  const actor = req ? context.getSessionAccount(req) : null;
  const route = String(extra.route || req?.originalUrl || '').split('?')[0].slice(0, 240);
  const location = extra.source
    ? { source: context.boundedText(extra.source, 240), line: Number(extra.line) || null, column: Number(extra.column) || null }
    : context.errorSourceLocation(error);
  const entry = {
    id: context.crypto.randomUUID(), requestId: req?.requestId || '', schoolId: actor ? context.accountSchoolId(actor) : '',
    method: String(req?.method || extra.method || 'SYSTEM').slice(0, 12),
    route,
    name: String(extra.name || error?.name || 'Error').slice(0, 80), message: context.redactSensitiveLogText(error?.message || 'Unknown server error'),
    source: location.source, line: location.line, column: location.column,
    severity: extra.severity || 'error', status: 'open', createdAt: new Date().toISOString()
  };
  context.db.systemErrors.unshift(entry);
  if (context.db.systemErrors.length > 5000) context.db.systemErrors.length = 5000;
  context.logStructured(entry.severity, 'system.error', {
    category: 'error',
    requestId: entry.requestId,
    user: actor?.username || '',
    role: actor?.role || '',
    schoolId: entry.schoolId,
    schoolName: actor?.schoolName || '',
    method: entry.method,
    route: entry.route,
    status: Number(error?.status) || 500,
    result: 'fault_recorded',
    code: entry.name,
    source: entry.source,
    line: entry.line,
    column: entry.column,
    message: entry.message
  });
  return entry;
};

const systemErrorVisibleTo = (entry, actor) =>
  Boolean(actor && (context.hasPlatformAccess(actor) || !entry.schoolId || entry.schoolId === context.accountSchoolId(actor)));
return { runtimeReadiness, recordSystemError, systemErrorVisibleTo };
}
module.exports = { createHelpers };
