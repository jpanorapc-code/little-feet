const crypto = require('crypto');

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const DEFAULT_MAX_ENTRIES = 5000;
const DEFAULT_SLOW_REQUEST_MS = 1500;

const redactSensitiveLogText = value => String(value || '')
  .replace(/\b(authorization|password|passwd|pin|token|secret|api[_ -]?key|cookie|session)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
  .replace(/\b(?:eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/g, '[redacted-token]')
  .slice(0, 600);

const cleanText = (value, max = 240) => redactSensitiveLogText(value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const cleanStatus = value => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
};
const cleanDuration = value => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 10) / 10 : null;
};

function createStructuredLogger({ maxEntries, slowRequestMs, sink = console } = {}) {
  const capacity = Math.max(500, Math.min(20000, Number(maxEntries) || DEFAULT_MAX_ENTRIES));
  const slowMs = Math.max(250, Math.min(30000, Number(slowRequestMs) || DEFAULT_SLOW_REQUEST_MS));
  const entries = [];

  const emit = (severity, event, fields = {}) => {
    const level = LOG_LEVELS.has(String(severity || '').toLowerCase()) ? String(severity).toLowerCase() : 'info';
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      severity: level,
      event: cleanText(event || 'application.event', 120),
      category: cleanText(fields.category || 'application', 80),
      requestId: cleanText(fields.requestId, 100),
      user: cleanText(fields.user, 160),
      role: cleanText(fields.role, 40),
      schoolId: cleanText(fields.schoolId, 180),
      schoolName: cleanText(fields.schoolName, 180),
      method: cleanText(fields.method, 12).toUpperCase(),
      route: cleanText(fields.route, 240),
      status: cleanStatus(fields.status),
      durationMs: cleanDuration(fields.durationMs),
      result: cleanText(fields.result, 80),
      code: cleanText(fields.code, 100),
      source: cleanText(fields.source, 240),
      line: Number.isInteger(Number(fields.line)) && Number(fields.line) > 0 ? Number(fields.line) : null,
      column: Number.isInteger(Number(fields.column)) && Number(fields.column) > 0 ? Number(fields.column) : null,
      message: cleanText(fields.message, 500),
      details: cleanText(fields.details, 600)
    };
    entries.unshift(entry);
    if (entries.length > capacity) entries.length = capacity;

    const line = JSON.stringify({ app: 'little-feet', ...entry });
    if (level === 'error' && typeof sink.error === 'function') sink.error(line);
    else if (level === 'warn' && typeof sink.warn === 'function') sink.warn(line);
    else if (typeof sink.log === 'function') sink.log(line);
    return entry;
  };

  const list = () => entries.slice();
  const findByRequestId = requestId => {
    const key = cleanText(requestId, 100);
    return key ? entries.filter(entry => entry.requestId === key) : [];
  };

  return {
    emit,
    list,
    findByRequestId,
    maxEntries: capacity,
    slowRequestMs: slowMs,
    redactSensitiveLogText
  };
}

module.exports = {
  createStructuredLogger,
  redactSensitiveLogText
};
