const express = require('express');
const compression = require('compression');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const tls = require('tls');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const session = require('express-session');
const { hashPin, matchesPin, pinHashNeedsUpgrade } = require('./auth-crypto');
const { registerFinanceAutomation } = require('./finance-automation-server');
const { createObjectStorage, objectKeyFor } = require('./lib/storage/object-storage');
const { stripHtml, verifyResendWebhook, fetchResendReceivedEmail } = require('./lib/mailbox-integration');
const { oauthCallbackUrl, resolveOAuthAccount, publicOrigin } = require('./lib/oauth-identity');
const { createStructuredLogger, redactSensitiveLogText } = require('./lib/structured-logger');
const { PROVIDERS: MAILBOX_PROVIDERS, PROVIDER_LABELS: MAILBOX_PROVIDER_LABELS, createAuthorization: createMailboxAuthorization, exchangeCode: exchangeMailboxCode, refreshAccessToken: refreshMailboxAccessToken, fetchMailbox, sendMailboxMessage, revokeMailboxAccess } = require('./lib/mailbox-oauth');

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const isProduction = process.env.NODE_ENV === 'production';
const replicaMode = process.env.LF_REPLICA_MODE === '1';
const schoolSearchCache = new Map();
const loginAttempts = new Map();
const loginUsernameAttempts = new Map();
const LOGIN_COOLDOWN_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW_MS = LOGIN_COOLDOWN_MS;
const MAX_LOGIN_ATTEMPTS = 3;
const MAX_DISTRIBUTED_LOGIN_ATTEMPTS = 3;
const SCHOOL_SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const SCHOOL_SEARCH_CACHE_MAX_ENTRIES = 250;
const MAX_API_BODY_MB = Math.max(1, Math.min(10, Number(process.env.LF_MAX_API_BODY_MB) || 8));
const STANDARD_IMPORT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const DUPLICATE_POST_WINDOW_MS = 5 * 1000;
const recentPostFingerprints = new Map();
const structuredLogger = createStructuredLogger({
  maxEntries: Number(process.env.LF_STRUCTURED_LOG_MAX_ENTRIES) || 5000,
  slowRequestMs: Number(process.env.LF_SLOW_REQUEST_MS) || 1500
});
const logStructured = (severity, event, fields = {}) => structuredLogger.emit(severity, event, fields);
const SERVER_BUSY_THRESHOLD = Math.max(8, Math.min(100, Number(process.env.LF_SERVER_BUSY_THRESHOLD) || 12));
const DEFAULT_BLOCKED_TERMS = Object.freeze(['asshole', 'bastard', 'bitch', 'cunt', 'dick', 'fok', 'fokken', 'fuck', 'kak', 'poes', 'shit']);
const blockedTerms = Object.freeze((process.env.LF_BLOCKED_TERMS || DEFAULT_BLOCKED_TERMS.join(','))
  .split(',').map(term => term.trim().toLocaleLowerCase('en-US')).filter(Boolean));
let activeRequestCount = 0;
let persistenceReady = Promise.resolve();
const fieldEncryptionConfigured = Boolean(process.env.LF_FIELD_ENCRYPTION_KEY);
const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);
const productionConfigurationErrors = [];
if (isProduction && !replicaMode && !process.env.DATABASE_URL) productionConfigurationErrors.push('DATABASE_URL');
if (isProduction && !fieldEncryptionConfigured) productionConfigurationErrors.push('LF_FIELD_ENCRYPTION_KEY');
if (isProduction && !sessionSecretConfigured) productionConfigurationErrors.push('SESSION_SECRET');
if (productionConfigurationErrors.length) {
  throw new Error(`Production configuration is missing required secure settings: ${productionConfigurationErrors.join(', ')}`);
}
const fieldKey = crypto.createHash('sha256').update(process.env.LF_FIELD_ENCRYPTION_KEY || 'LittleFeet-development-key-change-before-production').digest();
const LITTLE_FEET_PRIVACY_VERSION = 'POPIA-2026-09-v6';
const LITTLE_FEET_TERMS_VERSION = 'TOS-ZA-2026-09-v5';
const RENDER_DEPLOY_SHA = String(process.env.RENDER_GIT_COMMIT || '').trim().toLowerCase();
const RENDER_REPO_SLUG = String(process.env.RENDER_GIT_REPO_SLUG || '').trim();
const renderDeployAvailable = process.env.RENDER === 'true' && /^[0-9a-f]{40}$/.test(RENDER_DEPLOY_SHA);
const renderRepoSlugAvailable = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(RENDER_REPO_SLUG);
const RENDER_DEPLOY_METADATA_FILE = path.join(__dirname, '.render-deploy-release.json');
let renderDeployReleaseNote = null;
let renderDeployReleasePromise = null;
const cleanReleaseVersion = value => /^\d+\.\d+(?:\.\d+)?$/.test(String(value || '').trim()) ? String(value).trim() : '1.0';
const readBuiltRenderDeployReleaseNote = () => {
  if (!renderDeployAvailable) return null;
  try {
    const built = JSON.parse(fs.readFileSync(RENDER_DEPLOY_METADATA_FILE, 'utf8'));
    const fullCommitSha = String(built?.fullCommitSha || '').trim().toLowerCase();
    if (fullCommitSha !== RENDER_DEPLOY_SHA) return null;
    const updateLineCount = Math.max(1, Number(built?.updateLineCount) || 1);
    return {
      id: `render-${RENDER_DEPLOY_SHA}`,
      version: cleanReleaseVersion(built?.version),
      title: boundedText(built?.title || `Deploy ${RENDER_DEPLOY_SHA.slice(0, 7)}`, 240),
      summary: boundedText(built?.summary || 'The latest Little Feet improvements are now live.', 600),
      publishedAt: Number.isNaN(Date.parse(built?.publishedAt || '')) ? new Date().toISOString() : built.publishedAt,
      source: 'Render',
      commitSha: RENDER_DEPLOY_SHA.slice(0, 7),
      updateLineCount,
      changeLines: null,
      releaseType: boundedText(built?.releaseType || 'update', 40)
    };
  } catch {
    return null;
  }
};
const renderDeployFallbackNote = () => renderDeployAvailable ? {
  id: `render-${RENDER_DEPLOY_SHA}`,
  version: '1.0',
  title: 'Production foundation',
  summary: 'The latest Little Feet improvements are now live.',
  publishedAt: new Date().toISOString(),
  source: 'Render',
  commitSha: RENDER_DEPLOY_SHA.slice(0, 7),
  updateLineCount: null,
  changeLines: null,
  releaseType: 'live'
} : null;
const resolveRenderDeployReleaseNote = async () => {
  if (!renderDeployAvailable) return null;
  if (renderDeployReleaseNote) return renderDeployReleaseNote;
  const builtReleaseNote = readBuiltRenderDeployReleaseNote();
  if (builtReleaseNote) {
    renderDeployReleaseNote = builtReleaseNote;
    return renderDeployReleaseNote;
  }
  if (!renderRepoSlugAvailable) return renderDeployFallbackNote();
  if (renderDeployReleasePromise) return renderDeployReleasePromise;
  renderDeployReleasePromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`https://api.github.com/repos/${RENDER_REPO_SLUG}/commits/${RENDER_DEPLOY_SHA}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LittleFeetReleaseFeed/1.0' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`GitHub commit lookup returned ${response.status}`);
      const commit = await response.json();
      const messageLines = String(commit?.commit?.message || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const title = String(messageLines[0] || `Deploy ${RENDER_DEPLOY_SHA.slice(0, 7)}`).slice(0, 240);
      const updateLineCount = Math.max(1, messageLines.length);
      const changeLines = Math.max(0, Number(commit?.stats?.total) || 0);
      const releaseType = updateLineCount <= 8 ? 'patch' : 'update';
      renderDeployReleaseNote = {
        id: `render-${RENDER_DEPLOY_SHA}`,
        version: '1.0',
        title,
        summary: messageLines.slice(1, 4).join(' · ') || 'The latest Little Feet improvements are now live.',
        publishedAt: commit?.commit?.committer?.date || commit?.commit?.author?.date || new Date().toISOString(),
        source: 'Render',
        commitSha: RENDER_DEPLOY_SHA.slice(0, 7),
        updateLineCount,
        changeLines,
        releaseType
      };
      return renderDeployReleaseNote;
    } catch (error) {
      logStructured('warn', 'deploy.metadata_lookup_failed', { category: 'deployment', message: error.message });
      return renderDeployFallbackNote();
    } finally {
      clearTimeout(timeout);
      renderDeployReleasePromise = null;
    }
  })();
  return renderDeployReleasePromise;
};
const CURRENT_RELEASE_NOTES = Object.freeze([
  Object.freeze({
    id: 'little-feet-1.0-baseline', version: '1.0', title: 'Production foundation',
    summary: 'Secure accounts, automatic subscription activation, private file storage, reliable imports, and performance improvements are now live.',
    publishedAt: '2026-09-27T15:00:00.000+02:00'
  })
]);
if (!fieldEncryptionConfigured) logStructured('warn', 'config.development_field_key', { category: 'configuration', message: 'Using a development field-encryption key. Set LF_FIELD_ENCRYPTION_KEY before production.' });
if (!sessionSecretConfigured) logStructured('warn', 'config.development_session_secret', { category: 'configuration', message: 'Using a development session secret. Set SESSION_SECRET before production.' });
// Usernames and email addresses are identifiers, not secrets. Store their display
// casing, but compare a trimmed, case-insensitive value at every authentication boundary.
const normalizeUsername = (value) => String(value || '').trim().toLocaleLowerCase('en-US');
const accountMatchesUsername = (account, value) => {
  const requested = normalizeUsername(value);
  return normalizeUsername(account.username) === requested
    || (account.loginAliases || []).some(alias => normalizeUsername(alias) === requested);
};
const findAccountByUsername = (username) => db.users.find(account => accountMatchesUsername(account, username));
const normalizeComparableText = (value) => String(value || '').trim().toLocaleLowerCase('en-US');
const learnerRecordKey = (learner) => [learner?.studentName, learner?.className, learner?.contactEmail].map(normalizeComparableText).join('|');
const normaliseAccessCode = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const normaliseModerationText = (value) => String(value || '')
  .toLocaleLowerCase('en-US')
  .replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!]/g, 'i')
  .replace(/[0]/g, 'o').replace(/[$5]/g, 's').replace(/[7]/g, 't');
const containsBlockedLanguage = (value) => {
  const normalised = normaliseModerationText(value);
  const compact = normalised.replace(/[^a-z]+/g, '');
  return blockedTerms.some(term => new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z])`, 'i').test(normalised)
    || (term.length >= 4 && compact.includes(term)));
};
const MODERATION_EXEMPT_FIELDS = new Set([
  'pin', 'password', 'passcode', 'verificationcode', 'accesscode',
  'signature', 'signaturedata', 'mediaurl', 'photourl',
  'accountnumber', 'reference', 'transactionid', 'bankreference'
]);
const requestContainsBlockedLanguage = (value, fieldName = '') => {
  if (MODERATION_EXEMPT_FIELDS.has(String(fieldName || '').toLocaleLowerCase('en-US'))) return false;
  if (typeof value === 'string') return containsBlockedLanguage(value);
  if (Array.isArray(value)) return value.some(item => requestContainsBlockedLanguage(item, fieldName));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => requestContainsBlockedLanguage(item, key));
};
const requestPayloadTooComplex = (root, { maxDepth = 64, maxNodes = 5000 } = {}) => {
  const stack = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    visited += 1;
    if (visited > maxNodes || depth > maxDepth) return true;
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    for (const item of Object.values(value)) stack.push({ value: item, depth: depth + 1 });
  }
  return false;
};
const safeTextColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#2dd4bf';
const boundedText = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const limitedText = (value, max = 500) => {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : null;
};
const validSecretLength = (value, { min = 1, max = 128 } = {}) =>
  typeof value === 'string' && value.length >= min && value.length <= max;
const POST_AUDIENCES = new Set(['All', 'Infants', 'Toddlers', 'Preschool', 'GradeR', 'Foundation', 'Intermediate', 'Senior', 'Primary', 'FET', 'HighSchool']);
const PLATFORM_INTERNAL_ROLES = new Set(['staff', 'crm', 'accounts', 'support']);
const FULL_PLATFORM_ROLES = new Set(['staff', 'crm', 'accounts']);
const ACCOUNT_ROLES = new Set(['parent', 'teacher', 'principal', 'district', 'admin', 'school_accounts', 'staff', 'crm', 'accounts', 'support']);
const CHAT_ROLES = new Set(['parent', 'teacher', 'principal', 'admin', 'staff', 'crm', 'accounts', 'support']);
const configuredPlatformOwnerUsername = () => normalizeUsername(process.env.LF_OWNER_ADMIN_USERNAME || process.env.LF_BOOTSTRAP_ADMIN_USERNAME || '');
const isConfiguredPlatformOwner = account => Boolean(account && configuredPlatformOwnerUsername() && normalizeUsername(account.username) === configuredPlatformOwnerUsername());
const hasPlatformAccess = account => Boolean(account && (account.platformAccess === true || FULL_PLATFORM_ROLES.has(account.role) || isConfiguredPlatformOwner(account)));
const isAdminLike = account => Boolean(account && (account.role === 'admin' || account.role === 'staff' || hasPlatformAccess(account)));
const isCompanyStaffRole = account => Boolean(account && (hasPlatformAccess(account) || ['admin', 'staff', 'crm', 'accounts', 'support'].includes(account.role)));
const ATTENDANCE_STATUSES = new Set(['Checked In', 'Present', 'Absent', 'Late', 'Excused', 'Checked Out']);
const APPLICATION_STAGE_SELECTIONS = new Set([
  'ECD · Baby (Birth–11 months)',
  'ECD · 1-year-olds (12–23 months)',
  'ECD · 2-year-olds (24–35 months)',
  'ECD · 3-year-olds (36–47 months)',
  'ECD · 4-year-olds (48–59 months)',
  'ECD · 5-year-olds (60–71 months)',
  // Legacy values remain accepted so old clients and saved drafts do not break.
  'ECD · Infant care (Birth–12 months)',
  'ECD · Toddler (Approx. 1–3 years)',
  'ECD · Preschool (Approx. 3–4 years)',
  'Grade R · Reception',
  'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'
]);
const educationStageForSelection = value => {
  const selection = boundedText(value, 80);
  if (/^ECD · Baby/i.test(selection) || /^ECD · Infant/i.test(selection)) return 'Day care / ECD · Baby / infant';
  if (/^ECD · 1-year/i.test(selection)) return 'Day care / ECD · 1-year-olds';
  if (/^ECD · 2-year/i.test(selection) || /^ECD · Toddler/i.test(selection)) return 'Day care / ECD · 2-year-olds / toddler';
  if (/^ECD · 3-year/i.test(selection)) return 'Day care / ECD · 3-year-olds';
  if (/^ECD · 4-year/i.test(selection) || /^ECD · Preschool/i.test(selection)) return 'Day care / ECD · 4-year-olds / preschool';
  if (/^ECD · 5-year/i.test(selection)) return 'Day care / ECD · 5-year-olds / transition';
  if (/^Grade R/i.test(selection)) return 'Foundation Phase · Grade R';
  const match = /^Grade (\d{1,2})$/.exec(selection);
  const grade = Number(match?.[1] || 0);
  if (grade >= 1 && grade <= 3) return 'Foundation Phase · Grades 1–3';
  if (grade >= 4 && grade <= 6) return 'Intermediate Phase · Grades 4–6';
  if (grade >= 7 && grade <= 9) return 'Senior Phase · Grades 7–9';
  if (grade >= 10 && grade <= 12) return 'FET Phase · Grades 10–12';
  return 'Other / school-defined';
};
const publicRateLimits = new Map();
const enforcePublicRateLimit = (req, res, key, limit, windowMs) => {
  const now = Date.now();
  const id = `${key}:${req.ip}`;
  let entry = publicRateLimits.get(id);
  if (!entry || now - entry.startedAt >= windowMs) entry = { count: 0, startedAt: now };
  entry.count += 1;
  publicRateLimits.set(id, entry);
  if (publicRateLimits.size > 10000) {
    for (const [candidate, value] of publicRateLimits) {
      if (now - value.startedAt >= windowMs) publicRateLimits.delete(candidate);
      if (publicRateLimits.size <= 8000) break;
    }
    // A distributed spray can leave every entry "active". Keep the limiter
    // itself bounded rather than letting hostile source churn exhaust memory.
    while (publicRateLimits.size > 10000) {
      publicRateLimits.delete(publicRateLimits.keys().next().value);
    }
  }
  if (entry.count <= limit) return true;
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowMs - (now - entry.startedAt)) / 1000))));
  res.status(429).json({ message: 'Too many requests. Please wait and try again.' });
  return false;
};
const generateLearnerAccessCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () => Array.from(crypto.randomBytes(4), byte => alphabet[byte % alphabet.length]).join('');
  return `LF-${segment()}-${segment()}`;
};
const normaliseLearnerLinks = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(normalizeComparableText).filter(Boolean))];
const validateLearnerLinks = (value) => {
  const links = normaliseLearnerLinks(value);
  return links.length <= 4 ? { links } : { error: 'A parent account can be linked to a maximum of four learners.' };
};
const isParentLinkedToLearner = (parent, learner) => {
  if (!parent || !learner) return false;
  if (parent.role !== 'parent' || parent.parentRelationshipStatus !== 'Administrator approved') return false;
  return normaliseLearnerLinks(parent.linkedLearners).includes(normalizeComparableText(learner.studentName));
};
const normaliseAssignedClasses = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(normalizeComparableText).filter(Boolean))];
const schoolKey = (value) => normalizeComparableText(value).replace(/\s+/g, ' ');
const createSchoolId = () => `school_${crypto.randomUUID()}`;
const ensureSchool = (schoolName) => {
  const cleanName = String(schoolName || '').trim() || 'Your School';
  if (!Array.isArray(db.schools)) db.schools = [];
  let school = db.schools.find(entry => schoolKey(entry.name) === schoolKey(cleanName));
  if (!school) {
    school = { id: createSchoolId(), name: cleanName, status: 'active', createdAt: new Date().toISOString() };
    db.schools.push(school);
  }
  return school;
};
const accountSchoolId = (account) => {
  if (!account) return '';
  if (account.schoolId) return account.schoolId;
  const schoolName = String(account.schoolName || '').trim();
  if (!schoolName) return '';
  account.schoolId = ensureSchool(schoolName).id;
  return account.schoolId;
};
const isSameSchool = (first, second) => {
  if (!first || !second) return false;
  if (hasPlatformAccess(first)) return true;
  const firstSchoolId = accountSchoolId(first);
  const secondSchoolId = accountSchoolId(second);
  if (firstSchoolId && secondSchoolId) return firstSchoolId === secondSchoolId;
  return !firstSchoolId && !secondSchoolId && PLATFORM_INTERNAL_ROLES.has(first.role) && PLATFORM_INTERNAL_ROLES.has(second.role);
};
const recordInSchool = (record, actor) => {
  if (!record || !actor) return false;
  if (hasPlatformAccess(actor)) return true;
  const actorSchoolId = accountSchoolId(actor);
  return actorSchoolId ? record.schoolId === actorSchoolId : !record.schoolId && PLATFORM_INTERNAL_ROLES.has(actor.role);
};
const tagSchoolRecord = (actor, record) => ({ ...record, schoolId: accountSchoolId(actor), schoolName: actor.schoolName || '' });
const tenantRecords = (records, actor) => (Array.isArray(records) ? (hasPlatformAccess(actor) ? records.slice() : records.filter(record => recordInSchool(record, actor))) : []);
const canUseDirectChat = (first, second) => {
  if (!first || !second || !CHAT_ROLES.has(first.role) || !CHAT_ROLES.has(second.role) || first.username === second.username || !isSameSchool(first, second)) return false;
  const parent = first.role === 'parent' ? first : second.role === 'parent' ? second : null;
  if (!parent) return true;
  const staffMember = parent === first ? second : first;
  if (staffMember.role === 'principal') return true;
  if (staffMember.role !== 'teacher') return false;
  const learnerClasses = new Set(tenantRecords(db.students, parent).filter(learner => isParentLinkedToLearner(parent, learner)).map(learner => normalizeComparableText(learner.className)).filter(Boolean));
  return normaliseAssignedClasses(staffMember.assignedClasses).some(className => learnerClasses.has(className));
};
const encryptField = (value) => { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', fieldKey, iv); const content = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]); return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${content.toString('base64')}`; };
const decryptField = (value) => { try { const [iv, tag, content] = String(value || '').split('.').map(part => Buffer.from(part, 'base64')); const decipher = crypto.createDecipheriv('aes-256-gcm', fieldKey, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8'); } catch { return ''; } };
const looksEncryptedField = (value) => {
  const parts = String(value || '').split('.');
  return parts.length === 3 && parts.every(part => /^[A-Za-z0-9+/=_-]*$/.test(part));
};
const decryptStoredField = (value) => looksEncryptedField(value) ? decryptField(value) : String(value || '');
const encryptStoredField = (value) => looksEncryptedField(value) ? String(value) : encryptField(value);
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MEDIA_SIGNATURES = Object.freeze({
  'image/png': bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': bytes => bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/gif': bytes => bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a'),
  'image/webp': bytes => bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
});
const decodeImageDataUrl = (value, allowedMimeTypes = Object.keys(MEDIA_SIGNATURES), maxBytes = MAX_MEDIA_BYTES) => {
  if (typeof value !== 'string') return null;
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !allowedMimeTypes.includes(match[1]) || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes || !MEDIA_SIGNATURES[match[1]](bytes)) return null;
  return { mimeType: match[1], bytes };
};
const FILE_TYPE_RULES = Object.freeze({
  'image/png': { extension: 'png', maxBytes: MAX_MEDIA_BYTES, validate: MEDIA_SIGNATURES['image/png'] },
  'image/jpeg': { extension: 'jpg', maxBytes: MAX_MEDIA_BYTES, validate: MEDIA_SIGNATURES['image/jpeg'] },
  'image/gif': { extension: 'gif', maxBytes: MAX_MEDIA_BYTES, validate: MEDIA_SIGNATURES['image/gif'] },
  'image/webp': { extension: 'webp', maxBytes: MAX_MEDIA_BYTES, validate: MEDIA_SIGNATURES['image/webp'] },
  'application/pdf': { extension: 'pdf', maxBytes: MAX_MEDIA_BYTES, validate: bytes => bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-' },
  'text/plain': { extension: 'txt', maxBytes: 2 * 1024 * 1024, validate: bytes => !bytes.includes(0) },
  'text/csv': { extension: 'csv', maxBytes: 2 * 1024 * 1024, validate: bytes => !bytes.includes(0) }
});
const safeOriginalFilename = (value, extension) => {
  const leaf = String(value || `upload.${extension}`).split(/[\\/]/).pop().normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').slice(0, 180);
  const safeLeaf = leaf || `upload.${extension}`;
  return path.extname(safeLeaf) ? safeLeaf : `${safeLeaf}.${extension}`;
};
const decodeSupportedFileDataUrl = (value, suppliedName = '') => {
  if (typeof value !== 'string') return null;
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  const rule = match && FILE_TYPE_RULES[match[1].toLowerCase()];
  if (!rule || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > rule.maxBytes || !rule.validate(bytes)) return null;
  const filename = safeOriginalFilename(suppliedName, rule.extension);
  const suppliedExtension = path.extname(filename).slice(1).toLowerCase();
  const compatibleExtensions = rule.extension === 'jpg' ? new Set(['jpg', 'jpeg']) : new Set([rule.extension]);
  if (suppliedExtension && !compatibleExtensions.has(suppliedExtension)) return null;
  return { mimeType: match[1].toLowerCase(), bytes, extension: rule.extension, filename };
};
const validPostMediaData = value => Boolean(decodeImageDataUrl(value, ['image/png', 'image/jpeg', 'image/webp']));
const validWorksheetMediaData = value => Boolean(decodeImageDataUrl(value));
const validSignatureData = value => Boolean(decodeImageDataUrl(value, ['image/png'], 512 * 1024));
const safeStoredMedia = (value, validator = validWorksheetMediaData) => value == null ? value : (validator(value) ? value : null);
const studentSensitiveView = (student) => ({
  ...student,
  dateOfBirth: decryptStoredField(student.dateOfBirth),
  medicalNotes: decryptStoredField(student.medicalNotes),
  emergencyContact: decryptStoredField(student.emergencyContact),
  authorisedPickups: decryptStoredField(student.authorisedPickups)
});
const registryRecordView = (record) => ({
  ...record,
  dateOfBirth: decryptStoredField(record.dateOfBirth),
  guardianPhone: decryptStoredField(record.guardianPhone),
  guardianEmail: decryptStoredField(record.guardianEmail),
  address: decryptStoredField(record.address),
  emergencyContact: decryptStoredField(record.emergencyContact),
  medicalNotes: decryptStoredField(record.medicalNotes)
});
const reportReviewView = (report) => ({
  ...report,
  teacherSignature: report.teacherSignature ? decryptStoredField(report.teacherSignature) : null,
  parentSignature: report.parentSignature ? decryptStoredField(report.parentSignature) : null
});
const accessCodeInUse = (candidate) => db.learnerAccessCodes.some(entry => entry.status === 'active' && decryptStoredField(entry.codeEncrypted) === candidate);
const createUniqueLearnerAccessCode = () => {
  let code;
  do { code = generateLearnerAccessCode(); } while (accessCodeInUse(code));
  return code;
};
const ensureLearnerAccessCode = (actor, learner) => {
  const learnerKey = learnerRecordKey(learner);
  const existing = db.learnerAccessCodes.find(entry => entry.learnerKey === learnerKey && entry.status === 'active' && recordInSchool(entry, actor));
  if (existing) return existing;
  const accessCode = createUniqueLearnerAccessCode();
  const record = tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerKey, codeEncrypted: encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username, source: 'automatic-learner-creation' });
  db.learnerAccessCodes.unshift(record);
  return record;
};
const ensureAllLearnersHaveAccessCodes = () => {
  (db.students || []).forEach(learner => {
    const learnerKey = learnerRecordKey(learner);
    if (!learner.schoolId || db.learnerAccessCodes.some(entry => entry.learnerKey === learnerKey && entry.status === 'active' && entry.schoolId === learner.schoolId)) return;
    const accessCode = createUniqueLearnerAccessCode();
    db.learnerAccessCodes.unshift({
      id: crypto.randomUUID(),
      learnerKey,
      codeEncrypted: encryptField(accessCode),
      status: 'active',
      issuedAt: new Date().toISOString(),
      issuedBy: 'system',
      source: 'automatic-legacy-migration',
      schoolId: learner.schoolId,
      schoolName: learner.schoolName || ''
    });
  });
};
const safeHttpsUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
};
const loginAttemptKey = (req, username) => `${req.ip}:${normalizeUsername(username)}`;
const loginAttemptExpiry = entry => Number(entry?.lockedUntil) || (Number(entry?.firstAttempt) + LOGIN_ATTEMPT_WINDOW_MS);
const activeAttempt = (map, key) => {
  const entry = map.get(key);
  if (!entry || Date.now() >= loginAttemptExpiry(entry)) { map.delete(key); return null; }
  return entry;
};
const activeLoginAttempt = key => activeAttempt(loginAttempts, key);
const activeUsernameAttempt = username => activeAttempt(loginUsernameAttempts, normalizeUsername(username));
const loginLockoutRemainingSeconds = entry => Math.max(1, Math.ceil((Number(entry?.lockedUntil) - Date.now()) / 1000));
const clearLoginLockoutForAccount = account => {
  const identity = normalizeUsername(account?.username);
  if (!identity) return 0;
  let cleared = loginUsernameAttempts.delete(identity) ? 1 : 0;
  const suffix = `:${identity}`;
  for (const key of [...loginAttempts.keys()]) {
    if (key.endsWith(suffix)) {
      loginAttempts.delete(key);
      cleared += 1;
    }
  }
  return cleared;
};
const looksLikeEmailAddress = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const accountSecurityEmail = account => {
  const candidates = [account?.email, account?.username, ...(Array.isArray(account?.loginAliases) ? account.loginAliases : [])];
  return candidates.map(value => String(value || '').trim()).find(looksLikeEmailAddress) || '';
};
const sendLoginLockoutEmail = async account => {
  const to = accountSecurityEmail(account);
  if (!to) return false;
  return sendLittleFeetEmail({
    to,
    subject: 'Little Feet sign-in temporarily locked',
    text: [
      `Hello ${String(account?.name || 'Little Feet user').trim()},`,
      '',
      'Little Feet blocked sign-in attempts to your account for 10 minutes after three unsuccessful password or PIN attempts.',
      `Lock started: ${new Date().toISOString()}`,
      '',
      'If this was you, wait 10 minutes before trying again.',
      'If this was not you, contact your school administrator and change your password or PIN as soon as you can.',
      '',
      'Little Feet security'
    ].join('\n')
  });
};

const pruneLoginAttempts = (now = Date.now()) => {
  for (const [key, entry] of loginAttempts) {
    if (!entry || now >= loginAttemptExpiry(entry)) loginAttempts.delete(key);
  }
  for (const [key, entry] of loginUsernameAttempts) {
    if (!entry || now >= loginAttemptExpiry(entry)) loginUsernameAttempts.delete(key);
  }
  while (loginAttempts.size > 10000) loginAttempts.delete(loginAttempts.keys().next().value);
  while (loginUsernameAttempts.size > 10000) loginUsernameAttempts.delete(loginUsernameAttempts.keys().next().value);
};
const loginAttemptCleanupTimer = setInterval(pruneLoginAttempts, 5 * 60 * 1000);
loginAttemptCleanupTimer.unref?.();

const readSchoolSearchCache = (key, now = Date.now()) => {
  const cached = schoolSearchCache.get(key);
  if (!cached) return null;
  if (now - cached.createdAt >= SCHOOL_SEARCH_CACHE_TTL_MS) {
    schoolSearchCache.delete(key);
    return null;
  }
  return cached;
};
const writeSchoolSearchCache = (key, data, now = Date.now()) => {
  for (const [candidate, entry] of schoolSearchCache) {
    if (!entry || now - entry.createdAt >= SCHOOL_SEARCH_CACHE_TTL_MS) schoolSearchCache.delete(candidate);
  }
  if (schoolSearchCache.has(key)) schoolSearchCache.delete(key);
  while (schoolSearchCache.size >= SCHOOL_SEARCH_CACHE_MAX_ENTRIES) {
    schoolSearchCache.delete(schoolSearchCache.keys().next().value);
  }
  schoolSearchCache.set(key, { createdAt: now, data });
};

// Middleware for parsing JSON & URL-encoded bodies (supports Base64 media files)
app.disable('x-powered-by');
app.use(compression({ threshold: 1024 }));
const STRUCTURED_LOG_QUIET_READ_ROUTES = new Set([
  '/api/health',
  '/api/ready',
  '/api/keepalive',
  '/api/system-status',
  '/api/system-diagnostics',
  '/api/system-errors',
  '/api/system-logs'
]);
app.use((req, res, next) => {
  req.requestId = String(req.get('x-request-id') || crypto.randomUUID()).slice(0, 100);
  req.structuredLogStartedAt = process.hrtime.bigint();
  res.setHeader('X-Request-Id', req.requestId);

  let requestLogWritten = false;
  const writeRequestLog = (closedEarly = false) => {
    if (requestLogWritten || !req.path.startsWith('/api/')) return;
    requestLogWritten = true;
    const route = String(req.originalUrl || req.path || '').split('?')[0].slice(0, 240);
    if (req.method === 'GET' && STRUCTURED_LOG_QUIET_READ_ROUTES.has(route)) return;

    const durationMs = Number(process.hrtime.bigint() - req.structuredLogStartedAt) / 1e6;
    let actor = null;
    try { actor = getSessionAccount(req); } catch { actor = null; }
    const status = closedEarly && !res.writableEnded ? 499 : Number(res.statusCode || 200);
    const securityStatus = [401, 403, 429].includes(status);
    const severity = status >= 500 ? 'error'
      : securityStatus || [409, 413, 415, 422].includes(status) || durationMs >= structuredLogger.slowRequestMs ? 'warn'
      : 'info';
    const result = closedEarly && !res.writableEnded ? 'client_closed'
      : status >= 500 ? 'server_error'
      : status >= 400 ? 'client_error'
      : 'success';

    logStructured(severity, 'http.request', {
      category: securityStatus ? 'security' : 'request',
      requestId: req.requestId,
      user: actor?.username || '',
      role: actor?.role || '',
      schoolId: actor ? accountSchoolId(actor) : '',
      schoolName: actor?.schoolName || '',
      method: req.method,
      route,
      status,
      durationMs,
      result,
      details: durationMs >= structuredLogger.slowRequestMs ? 'Slow request threshold exceeded.' : ''
    });
  };
  res.on('finish', () => writeRequestLog(false));
  res.on('close', () => writeRequestLog(true));
  next();
});
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  const hasBody = Number(req.get('content-length') || 0) > 0 || Boolean(req.get('transfer-encoding'));
  if (!hasBody) return next();
  if (req.is('application/json') || req.is('application/*+json') || req.is('application/x-www-form-urlencoded')) return next();
  return res.status(415).json({ message: 'Unsupported request body type. Use JSON or URL-encoded form data.' });
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "upgrade-insecure-requests",
    "block-all-mixed-content"
  ].join('; '));
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/') && !['/api/health', '/api/ready', '/api/nearby-schools'].includes(req.path)) {
    res.setHeader('Cache-Control', 'no-store, private');
  }
  next();
});
app.use(express.json({
  limit: `${MAX_API_BODY_MB}mb`,
  verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); }
}));
app.use(express.urlencoded({ extended: true, limit: `${MAX_API_BODY_MB}mb` }));
const STANDARD_IMPORT_API_PATHS = new Set([
  '/api/schedules/import',
  '/api/attendance/import',
  '/api/book-register/import'
]);
app.use('/api', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const requestPath = String(req.originalUrl || '').split('?')[0];
  if (!STANDARD_IMPORT_API_PATHS.has(requestPath)) return next();
  const requestBytes = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.length
    : Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
  if (requestBytes <= STANDARD_IMPORT_MAX_BODY_BYTES) return next();
  return res.status(413).json({
    message: 'This import is too large. Use a spreadsheet up to 5 MB. Large school-register imports must use School Integration.'
  });
});
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  if (String(req.originalUrl || '').split('?')[0] === '/api/email/inbound/resend') return next();
  if (requestPayloadTooComplex(req.body)) return res.status(400).json({ message: 'Request structure is too deeply nested or complex.' });
  if (!requestContainsBlockedLanguage(req.body)) return next();
  return res.status(422).json({ message: 'Please remove prohibited language before submitting this form.' });
});
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/signup' && !enforcePublicRateLimit(req, res, 'signup', 20, 60 * 60 * 1000)) return;
  if (req.method === 'GET' && req.path === '/api/nearby-schools' && !enforcePublicRateLimit(req, res, 'nearby-schools', 60, 10 * 60 * 1000)) return;
  if (req.method === 'GET' && req.path === '/api/schools/search' && !enforcePublicRateLimit(req, res, 'school-name-search', 90, 10 * 60 * 1000)) return;
  if (req.method === 'POST' && req.path === '/api/schools/enrich' && !enforcePublicRateLimit(req, res, 'school-enrich', 60, 10 * 60 * 1000)) return;
  if (req.method === 'POST' && req.path === '/api/donations/intents' && !enforcePublicRateLimit(req, res, 'donation-intent', 30, 60 * 60 * 1000)) return;
  next();
});
app.set('trust proxy', 1);
app.use('/api', (req, res, next) => {
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const limit = isMutation
    ? Math.max(60, Math.min(600, Number(process.env.LF_API_MUTATION_RATE_LIMIT) || 240))
    : Math.max(300, Math.min(3000, Number(process.env.LF_API_READ_RATE_LIMIT) || 1200));
  if (!enforcePublicRateLimit(req, res, isMutation ? 'api-mutation' : 'api-read', limit, 60 * 1000)) return;
  next();
});
app.use((req, res, next) => {
  const allowReplicaWritesForTests = process.env.NODE_ENV === 'test' && process.env.LF_TEST_ALLOW_REPLICA_WRITES === '1';
  if (!replicaMode || allowReplicaWritesForTests || !req.path.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Standby replicas are deliberately read-only. Authentication is allowed so
  // users can inspect the latest snapshot during failover, but business-data
  // writes must never return success when there is no durable write path.
  if (req.method === 'POST' && ['/api/login', '/api/auth/logout'].includes(req.path)) return next();
  res.setHeader('Retry-After', '30');
  return res.status(503).json({
    message: 'Backup server is read-only. Your change was not saved; reconnect to the primary service and retry.',
    requestId: req.requestId
  });
});
app.use((req, res, next) => {
  persistenceReady.then(async () => {
    activeRequestCount += 1;
    let requestReleased = false;
    let mutationLockClient = null;
    let mutationLockReleased = false;
    const releaseRequest = () => {
      if (requestReleased) return;
      requestReleased = true;
      activeRequestCount = Math.max(0, activeRequestCount - 1);
    };
    const releaseMutationLock = async () => {
      if (mutationLockReleased || !mutationLockClient) return;
      mutationLockReleased = true;
      await mutationLockClient.query('SELECT pg_advisory_unlock(12801337)').catch(() => {});
      mutationLockClient.release();
      mutationLockClient = null;
    };
    res.on('finish', () => { releaseRequest(); void releaseMutationLock(); });
    res.on('close', () => { releaseRequest(); void releaseMutationLock(); });

    if (!req.method || req.method === 'GET' || replicaMode) return next();

    if (postgresPool) {
      mutationLockClient = await postgresPool.connect();
      await mutationLockClient.query('SELECT pg_advisory_lock(12801337)');
      await loadDatabaseState();
    }

    const originalJson = res.json.bind(res);
    let persistenceResponsePending = false;
    res.json = (body) => {
      if (res.statusCode >= 400 || req.persistenceCommitted || persistenceResponsePending) {
        return originalJson(body);
      }
      persistenceResponsePending = true;
      void saveDatabaseState().then(async () => {
        req.persistenceCommitted = true;
        scheduleReplicaSnapshot();
        await releaseMutationLock();
        originalJson(body);
      }).catch(async error => {
        logStructured('error', 'persistence.mutation_commit_failed', { category: 'persistence', requestId: req.requestId, method: req.method, route: String(req.originalUrl || '').split('?')[0], status: 503, result: 'not_persisted', message: error.message });
        await loadDatabaseState().catch(() => {});
        await releaseMutationLock();
        if (!res.headersSent) {
          res.status(503);
          originalJson({
            message: 'Your change could not be committed to durable storage. Nothing has been confirmed; please retry after the database recovers.',
            requestId: req.requestId
          });
        }
      });
      return res;
    };
    next();
  }).catch(next);
});
// Serve only explicit public assets. Serving the repository root would also
// expose backend source, configuration manifests, and local database files.
const staticFileOptions = {
  setHeaders: (res, filePath) => {
    if (/\.html$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(?:js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    else if (/\.(?:png|jpe?g|webp|gif|svg|ico|mp3|wav|woff2?)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  }
};
app.use('/assets', express.static(path.join(__dirname, 'assets'), staticFileOptions));
const publicOutputDocuments = Object.freeze(new Map([
  ['LittleFeet_Presentation_2026_Updated.pdf', 'LittleFeet_Presentation_2026_Updated.pdf'],
  ['LittleFeet_User_Manual_2026_Updated.pdf', 'LittleFeet_User_Manual_2026_Updated.pdf'],
  ['LittleSteps_Platform_Presentation_2026.pdf', 'LittleSteps_Platform_Presentation_2026.pdf'],
  ['LittleSteps_User_Manual_2026.pdf', 'LittleSteps_User_Manual_2026.pdf']
]));
app.get('/output/pdf/:document', (req, res) => {
  const document = publicOutputDocuments.get(String(req.params.document || ''));
  if (!document) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('application/pdf');
  res.sendFile(document, { root: path.join(__dirname, 'output', 'pdf') });
});
const sendPublicRootFile = (req, res) => {
  if (/\.js$/i.test(req.path)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(req.path.slice(1), { root: __dirname });
};
app.get('/backup.js', sendPublicRootFile);
app.get('/paia.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.type('html');
  res.sendFile('paia.html', { root: __dirname });
});
app.get(['/little-feet-mascot.jfif', '/logo.png', '/logo-transparent.png'], sendPublicRootFile);
app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/manifest+json');
  res.sendFile('manifest.webmanifest', { root: __dirname });
});
app.get('/service-worker.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.sendFile('service-worker.js', { root: __dirname });
});
app.get('/robots.txt', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('text/plain');
  res.sendFile('robots.txt', { root: __dirname });
});
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/xml');
  res.sendFile('sitemap.xml', { root: __dirname });
});
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/png');
  res.sendFile('logo.png', { root: __dirname });
});

const browserVendorSources = Object.freeze({
  'xlsx.js': Object.freeze({
    url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    sha256: 'sha256-yVBhl8r4CaB1tt7h2g02+xnacVj/6KiOewyWxdhiPJk='
  }),
  'qrcode.js': Object.freeze({
    url: 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
    sha256: 'sha256-xUHvBjJ4hahBW8qN9gceFBibSFUzbe9PNttUvehITzY='
  }),
  'leaflet.js': Object.freeze({
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    sha256: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
  }),
  'leaflet-markercluster.js': Object.freeze({
    url: 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
    sha256: 'sha256-Hk4dIpcqOSb0hZjgyvFOP+cEmDXUKKNE/tT542ZbNQg='
  }),
  'three.module.js': Object.freeze({
    url: 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js',
    sha256: 'sha256-kFIELWdssP3B3f7+GTBT80t6wFE6YW/axFNdSZh4Euo='
  }),
  'three.core.js': Object.freeze({
    url: 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.core.js',
    sha256: 'sha256-nt3gArBmqaBWdqYSf2dzW2K685m96lKfL34xZX2naeY='
  })
});
const browserVendorCache = new Map();
const vendorSha256 = buffer => `sha256-${crypto.createHash('sha256').update(buffer).digest('base64')}`;
app.get('/vendor/:asset', async (req, res, next) => {
  const source = browserVendorSources[req.params.asset];
  if (!source) return res.status(404).end();
  try {
    let script = browserVendorCache.get(req.params.asset);
    if (!script) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(source.url, { signal: controller.signal, redirect: 'follow' });
        if (!response.ok) throw new Error(`Vendor download failed with HTTP ${response.status}`);
        const downloaded = Buffer.from(await response.arrayBuffer());
        const actualHash = vendorSha256(downloaded);
        if (actualHash !== source.sha256) {
          throw new Error(`Vendor integrity check failed for ${req.params.asset}`);
        }
        script = downloaded.toString('utf8');
      } finally {
        clearTimeout(timeout);
      }
      script = script
        .replace(/\n?\/\/# sourceMappingURL=.*$/gm, '')
        .replace(/\/\*# sourceMappingURL=[\s\S]*?\*\//g, '');
      browserVendorCache.set(req.params.asset, script);
    }
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(script);
  } catch (error) {
    error.status = 502;
    next(error);
  }
});

// In-Memory Database Store
const db = {
  term: "Academic Term 3: Active Session | Campus Hours: 07:00 - 17:30 SAST",
  users: [],
  schools: [],
  posts: [],
  schedules: [],
  worksheets: [],
  badges: [],
  tickets: [],
  attendance: [],
  staffTasks: [],
  staffLeave: [],
  teacherCover: [],
  performanceReviews: [],
  staffQualifications: [],
  staffDevelopmentPlans: [],
  emailInbox: [],
  emailDismissals: [],
  accountMigrations: {},
  staffNotices: [],
  meetingMinutes: [],
  maintenanceOrders: [],
  resourceBookings: [],
  purchaseRequests: [],
  broadcasts: [],
  campusVisitors: [],
  visitorMeetings: [],
  registry: [],
  moduleRecords: { finance: [], operations: [], care: [], engagement: [], dailyCare: [], portfolio: [], curriculum: [], supplies: [], stock: [], reports: [], safeguarding: [], absences: [], handovers: [], stickyNotes: [] },
  consentRecords: [],
  pickupLogs: [],
  reportReviews: [],
  releaseNotes: CURRENT_RELEASE_NOTES.map(note => ({ ...note })),
  chatGroups: [],
  groupMessages: {},
  directMessages: [],
  importAudit: [],
  importJobs: [],
  fileRecords: [],
  storageCleanupJobs: [],
  students: [],
  learnerAccessCodes: [],
  donations: [],
  storeProducts: [],
  storeOrders: [],
  parentPayments: [],
  parentSubscriptions: [],
  bookRegister: [],
  paymentEvents: [],
  paymentLedger: [],
  financeRecurringRules: [],
  financeAdjustments: [],
  financeReconciliationRuns: [],
  payrollProfiles: [],
  payrollRuns: [],
  systemErrors: [],
  schoolBilling: {},
  schoolTerms: {},
  subscriptionBilling: {
    pricing: { baseMonthly: 0, bundles: { 5: { costPrice: 0, sellingPrice: 0 }, 20: { costPrice: 0, sellingPrice: 0 }, 100: { costPrice: 0, sellingPrice: 0 } }, lateFeeEnabled: false, lateFee: 0 },
    payment: { method: 'payment_link', paymentLink: '', accountName: '', bankName: '', accountNumberEncrypted: '', branchCode: '', referencePrefix: 'LF' },
    orders: []
  }
};

// PostgreSQL is used whenever DATABASE_URL is configured (the production path).
// SQLite remains a local-development fallback; the JSON replica is a portable
// standby snapshot for the backup service.
const databaseFile = path.join(__dirname, 'littlefeet.db');
const replicaFile = path.join(__dirname, 'littlefeet-replica.json');
let replicaTimer = null;
let replicaSnapshotTimer = null;
let stateDatabase = null;
let postgresPool = null;
let postgresSaveChain = Promise.resolve();
let postgresPersistenceSnapshot = new Map();
let replicaSnapshotVersion = '';
const objectStorage = createObjectStorage({ rootDir: __dirname });

class PostgresSessionStore extends session.Store {
  constructor() {
    super();
    this.cleanupTimer = setInterval(() => {
      if (postgresPool) postgresPool.query('DELETE FROM little_feet_sessions WHERE expires_at <= NOW()').catch(error => {
        logStructured('error', 'session.cleanup_failed', { category: 'session', message: error.message });
      });
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  get(sessionId, callback) {
    postgresPool.query(
      'SELECT sess FROM little_feet_sessions WHERE sid = $1 AND expires_at > NOW()',
      [sessionId]
    ).then(result => callback(null, result.rows[0]?.sess || null)).catch(callback);
  }

  set(sessionId, sessionData, callback = () => {}) {
    const expiresAt = sessionData?.cookie?.expires
      ? new Date(sessionData.cookie.expires)
      : new Date(Date.now() + 60 * 60 * 1000);
    postgresPool.query(`
      INSERT INTO little_feet_sessions (sid, sess, expires_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expires_at = EXCLUDED.expires_at
    `, [sessionId, JSON.stringify(sessionData), expiresAt]).then(() => callback()).catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    postgresPool.query('DELETE FROM little_feet_sessions WHERE sid = $1', [sessionId])
      .then(() => callback()).catch(callback);
  }

  touch(sessionId, sessionData, callback = () => {}) {
    const expiresAt = sessionData?.cookie?.expires
      ? new Date(sessionData.cookie.expires)
      : new Date(Date.now() + 60 * 60 * 1000);
    postgresPool.query('UPDATE little_feet_sessions SET expires_at = $2 WHERE sid = $1', [sessionId, expiresAt])
      .then(() => callback()).catch(callback);
  }
}

app.use(session({
  store: process.env.DATABASE_URL ? new PostgresSessionStore() : undefined,
  secret: process.env.SESSION_SECRET || 'little-feet-session-secret',
  name: 'littlefeet.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000
  }
}));
app.use((req, res, next) => {
  const enforceOriginCheck = isProduction || process.env.LF_TEST_ENFORCE_ORIGIN === '1';
  if (!enforceOriginCheck || !req.session?.littleFeetUser || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return res.status(403).json({ message: 'A same-origin browser request is required.' });
  try {
    const sourceUrl = new URL(source);
    if (sourceUrl.host !== req.get('host') || sourceUrl.protocol !== `${req.protocol}:`) {
      return res.status(403).json({ message: 'Cross-origin state changes are not allowed.' });
    }
  } catch {
    return res.status(403).json({ message: 'Invalid request origin.' });
  }
  next();
});

const DUPLICATE_POST_EXEMPT_PATHS = new Set([
  '/api/login',
  '/api/auth/logout',
  '/api/email/inbound/resend',
  '/api/email/mailbox/sync',
  '/api/payments/webhook',
  '/api/payments/reconcile',
  '/api/finance/recurring-runs',
  '/api/finance/reconciliation/apply',
  '/api/students/import',
  '/api/attendance/toggle'
]);
const duplicatePostIsHandledByRoute = requestPath =>
  DUPLICATE_POST_EXEMPT_PATHS.has(requestPath)
  || /^\/api\/finance\/payroll\/runs\/[^/]+\/approve$/.test(requestPath);
app.use('/api', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const requestPath = String(req.originalUrl || '').split('?')[0];
  if (duplicatePostIsHandledByRoute(requestPath)) return next();

  const actorKey = normalizeUsername(req.session?.littleFeetUser?.username || '') || String(req.ip || 'anonymous');
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
  const fingerprint = crypto.createHash('sha256')
    .update(`${actorKey}\n${requestPath}\n${bodyHash}`)
    .digest('hex');
  const now = Date.now();
  const previous = recentPostFingerprints.get(fingerprint);
  const duplicateStillActive = previous && !previous.completedAt && now - previous.startedAt < 60 * 1000;
  const duplicateRecentlyCompleted = previous?.completedAt && now - previous.completedAt < DUPLICATE_POST_WINDOW_MS;
  if (duplicateStillActive || duplicateRecentlyCompleted) {
    res.setHeader('Retry-After', '2');
    return res.status(409).json({
      message: 'This action is already being processed. Please wait a moment before trying again.',
      requestId: req.requestId
    });
  }

  const entry = { startedAt: now, completedAt: null };
  recentPostFingerprints.set(fingerprint, entry);
  res.on('finish', () => {
    if (recentPostFingerprints.get(fingerprint) !== entry) return;
    if (res.statusCode >= 400) recentPostFingerprints.delete(fingerprint);
    else entry.completedAt = Date.now();
  });

  for (const [key, value] of recentPostFingerprints) {
    const staleActive = !value.completedAt && now - value.startedAt >= 60 * 1000;
    const staleCompleted = value.completedAt && now - value.completedAt >= DUPLICATE_POST_WINDOW_MS;
    if (staleActive || staleCompleted) recentPostFingerprints.delete(key);
    if (recentPostFingerprints.size <= 5000) break;
  }
  while (recentPostFingerprints.size > 5000) {
    recentPostFingerprints.delete(recentPostFingerprints.keys().next().value);
  }
  next();
});

const persistenceHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const persistenceRecordKey = (record, index) => {
  const candidate = record?.id || record?.username || record?.reference || record?.learnerKey || record?.version;
  return candidate ? String(candidate) : `legacy-${persistenceHash(record)}-${index}`;
};
const flattenPersistentState = () => {
  const records = new Map();
  const metadata = new Map();
  const addRecords = (collection, values) => (Array.isArray(values) ? values : []).forEach((record, index) => {
    const recordKey = persistenceRecordKey(record, index);
    records.set(`${collection}\u0000${recordKey}`, { collection, recordKey, schoolId: String(record?.schoolId || ''), payload: record });
  });
  Object.entries(db).forEach(([key, value]) => {
    if (Array.isArray(value)) return addRecords(`array:${key}`, value);
    if (key === 'moduleRecords') return Object.entries(value || {}).forEach(([moduleName, values]) => addRecords(`module:${moduleName}`, values));
    if (key === 'groupMessages') return Object.entries(value || {}).forEach(([groupId, values]) => addRecords(`group:${groupId}`, values));
    if (key === 'schoolBilling') return Object.entries(value || {}).forEach(([schoolId, billing]) => metadata.set(`schoolBilling:${schoolId}`, billing));
    if (key === 'schoolTerms') return Object.entries(value || {}).forEach(([schoolId, term]) => metadata.set(`schoolTerms:${schoolId}`, term));
    metadata.set(key, value);
  });
  return { records, metadata };
};

function openStateDatabase() {
  if (replicaMode) return;
  stateDatabase = new Database(databaseFile);
  stateDatabase.pragma('journal_mode = WAL');
  stateDatabase.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      state_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

async function openPostgresDatabase() {
  postgresPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    // Keep enough database headroom for Render's rolling deploy overlap and
    // the isolated recovery job. The production session pool allows 15
    // clients, so two briefly concurrent web instances must stay below it.
    max: Math.max(2, Math.min(6, Number(process.env.PG_POOL_MAX) || 5)),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    allowExitOnIdle: false
  });
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS little_feet_app_state (
      state_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS little_feet_records (
      collection TEXT NOT NULL,
      record_key TEXT NOT NULL,
      school_id TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (collection, record_key)
    );
    CREATE INDEX IF NOT EXISTS little_feet_records_school_collection_idx
      ON little_feet_records (school_id, collection);
    CREATE TABLE IF NOT EXISTS little_feet_metadata (
      state_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS little_feet_sessions (
      sid TEXT PRIMARY KEY,
      sess JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS little_feet_sessions_expiry_idx
      ON little_feet_sessions (expires_at)
  `);
}

function applySavedState(saved) {
  if (!saved || typeof saved !== 'object') return false;
  const moduleDefaults = db.moduleRecords;
  Object.keys(db).forEach(key => {
    if (key !== 'moduleRecords' && Object.hasOwn(saved, key)) db[key] = saved[key];
  });
  if (Object.hasOwn(saved, 'moduleRecords')) db.moduleRecords = { ...moduleDefaults, ...(saved.moduleRecords || {}) };
  syncCurrentReleaseNotes();
  removeLegacyDemoRecords();
  migrateSchoolTenancy();
  migrateSensitiveStoredFields();
  return true;
}

function syncCurrentReleaseNotes() {
  db.releaseNotes = CURRENT_RELEASE_NOTES.map(note => ({ ...note })).sort((first, second) => {
    const dateDifference = Date.parse(second.publishedAt || '') - Date.parse(first.publishedAt || '');
    return Number.isFinite(dateDifference) && dateDifference !== 0
      ? dateDifference
      : String(second.version || '').localeCompare(String(first.version || ''), undefined, { numeric: true });
  });
}

function migrateSchoolTenancy() {
  if (!Array.isArray(db.schools)) db.schools = [];
  db.users.forEach(account => {
    if (PLATFORM_INTERNAL_ROLES.has(account.role) && !String(account.schoolName || '').trim() && !String(account.schoolId || '').trim()) {
      account.schoolId = '';
      account.schoolName = '';
      return;
    }
    const school = ensureSchool(account.schoolName);
    account.schoolId = account.schoolId || school.id;
    account.schoolName = school.name;
  });
  const defaultSchoolId = db.users.find(account => account.role === 'admin')?.schoolId || db.users[0]?.schoolId || ensureSchool('Your School').id;
  const collections = ['posts', 'schedules', 'worksheets', 'badges', 'tickets', 'attendance', 'staffTasks', 'staffLeave', 'teacherCover', 'performanceReviews', 'staffQualifications', 'staffDevelopmentPlans', 'emailInbox', 'emailDismissals', 'staffNotices', 'meetingMinutes', 'maintenanceOrders', 'resourceBookings', 'purchaseRequests', 'broadcasts', 'campusVisitors', 'visitorMeetings', 'registry', 'consentRecords', 'pickupLogs', 'reportReviews', 'learnerAccessCodes', 'storeProducts', 'storeOrders', 'parentPayments', 'parentSubscriptions', 'bookRegister', 'paymentEvents', 'paymentLedger', 'financeRecurringRules', 'financeAdjustments', 'financeReconciliationRuns', 'payrollProfiles', 'payrollRuns', 'systemErrors', 'importAudit', 'importJobs', 'fileRecords', 'storageCleanupJobs', 'chatGroups', 'directMessages'];
  collections.forEach(collection => {
    if (!Array.isArray(db[collection])) db[collection] = [];
    db[collection].forEach(record => {
      if (!record.schoolId) record.schoolId = record.schoolName ? ensureSchool(record.schoolName).id : defaultSchoolId;
    });
  });
  Object.values(db.moduleRecords || {}).forEach(records => (records || []).forEach(record => {
    if (!record.schoolId) record.schoolId = record.schoolName ? ensureSchool(record.schoolName).id : defaultSchoolId;
  }));
  db.students.forEach(record => { if (!record.schoolId) record.schoolId = defaultSchoolId; });
  if (!db.schoolTerms || typeof db.schoolTerms !== 'object') db.schoolTerms = {};
  if (!db.schoolTerms[defaultSchoolId]) db.schoolTerms[defaultSchoolId] = db.term;
  if (!db.schoolBilling || typeof db.schoolBilling !== 'object') db.schoolBilling = {};
  if (!db.schoolBilling[defaultSchoolId] && db.subscriptionBilling) db.schoolBilling[defaultSchoolId] = db.subscriptionBilling;
}

function migrateSensitiveStoredFields() {
  const registryFields = ['dateOfBirth', 'guardianPhone', 'guardianEmail', 'address', 'emergencyContact', 'medicalNotes'];
  (db.registry || []).forEach(record => {
    registryFields.forEach(field => {
      if (record[field] !== undefined && record[field] !== null && record[field] !== '') record[field] = encryptStoredField(record[field]);
    });
  });
  (db.reportReviews || []).forEach(report => {
    if (report.teacherSignature) report.teacherSignature = encryptStoredField(report.teacherSignature);
    if (report.parentSignature) report.parentSignature = encryptStoredField(report.parentSignature);
  });
}

function removeLegacyDemoRecords() {
  const demoUsernames = new Set(['admin@gmail.com', 'teacher@gmail.com', 'parent@gmail.com', 'principle@gmail.com', 'district@gmail.com']);
  db.users = db.users.filter(account => !demoUsernames.has(normalizeUsername(account.username)));
  db.students = db.students.filter(student => !(
    (student.studentName === 'Liam Smith' && normalizeUsername(student.contactEmail) === 'parent@gmail.com')
    || (student.studentName === 'Emma Watson' && normalizeUsername(student.contactEmail) === 'teacher@gmail.com')
  ));
  db.posts = db.posts.filter(post => post.caption !== 'Welcome to our updated Little Feet ECD & High School Learning Portal!');
  db.chatGroups = db.chatGroups.filter(group => !['general', 'toddlers'].includes(group.id));
  delete db.groupMessages.general;
  delete db.groupMessages.toddlers;
  db.directMessages = db.directMessages.filter(message => !demoUsernames.has(normalizeUsername(message.sender)) && !demoUsernames.has(normalizeUsername(message.recipient)));
  const obsoleteStickyErrorTickets = new Set(db.tickets.filter(ticket =>
    ticket.subject === 'Automatic error report: WEB_RUNTIME_ERROR'
    && /saveStickyNote is not defined/i.test(String(ticket.message || ticket.feedback || ''))
  ).map(ticket => ticket.id));
  if (obsoleteStickyErrorTickets.size) {
    db.tickets = db.tickets.filter(ticket => !obsoleteStickyErrorTickets.has(ticket.id));
    db.emailInbox = (db.emailInbox || []).filter(item => !(item.type === 'Ticket' && obsoleteStickyErrorTickets.has(item.sourceId)));
  }
}

async function loadDatabaseState() {
  if (postgresPool) {
    try {
      const normalizedCount = await postgresPool.query('SELECT COUNT(*)::int AS count FROM little_feet_records');
      const metadataCount = await postgresPool.query('SELECT COUNT(*)::int AS count FROM little_feet_metadata');
      if (normalizedCount.rows[0].count || metadataCount.rows[0].count) {
        const [recordResult, metadataResult] = await Promise.all([
          postgresPool.query('SELECT collection, record_key, school_id, payload FROM little_feet_records ORDER BY collection, record_key'),
          postgresPool.query('SELECT state_key, payload FROM little_feet_metadata ORDER BY state_key')
        ]);
        const saved = {};
        postgresPersistenceSnapshot = new Map();
        recordResult.rows.forEach(row => {
          const [kind, name] = row.collection.split(':', 2);
          if (kind === 'array') (saved[name] ||= []).push(row.payload);
          else if (kind === 'module') ((saved.moduleRecords ||= {})[name] ||= []).push(row.payload);
          else if (kind === 'group') ((saved.groupMessages ||= {})[name] ||= []).push(row.payload);
          postgresPersistenceSnapshot.set(`record:${row.collection}\u0000${row.record_key}`, persistenceHash(row.payload));
        });
        metadataResult.rows.forEach(row => {
          if (row.state_key.startsWith('schoolBilling:')) (saved.schoolBilling ||= {})[row.state_key.slice(14)] = row.payload;
          else if (row.state_key.startsWith('schoolTerms:')) (saved.schoolTerms ||= {})[row.state_key.slice(12)] = row.payload;
          else saved[row.state_key] = row.payload;
          postgresPersistenceSnapshot.set(`metadata:${row.state_key}`, persistenceHash(row.payload));
        });
        return applySavedState(saved);
      }
      const result = await postgresPool.query('SELECT payload FROM little_feet_app_state WHERE state_key = $1', ['primary']);
      return result.rowCount ? applySavedState(result.rows[0].payload) : false;
    } catch (error) {
      logStructured('error', 'persistence.postgres_load_failed', { category: 'persistence', message: error.message });
      throw error;
    }
  }
  if (!stateDatabase) return false;
  try {
    const row = stateDatabase.prepare('SELECT payload FROM app_state WHERE state_key = ?').get('primary');
    if (!row) return false;
    return applySavedState(JSON.parse(row.payload));
  } catch (error) {
    logStructured('error', 'persistence.sqlite_load_failed', { category: 'persistence', message: error.message });
    return false;
  }
}

async function saveDatabaseState() {
  if (replicaMode) return;
  if (postgresPool) {
    postgresSaveChain = postgresSaveChain.catch(() => {}).then(async () => {
      const { records, metadata } = flattenPersistentState();
      const nextSnapshot = new Map();
      const client = await postgresPool.connect();
      try {
        await client.query('BEGIN');
        for (const [compositeKey, entry] of records) {
          const snapshotKey = `record:${compositeKey}`;
          const hash = persistenceHash(entry.payload);
          nextSnapshot.set(snapshotKey, hash);
          if (postgresPersistenceSnapshot.get(snapshotKey) === hash) continue;
          await client.query(`INSERT INTO little_feet_records (collection, record_key, school_id, payload, updated_at)
            VALUES ($1, $2, $3, $4::jsonb, NOW()) ON CONFLICT (collection, record_key) DO UPDATE SET
            school_id = EXCLUDED.school_id, payload = EXCLUDED.payload, updated_at = NOW()`,
          [entry.collection, entry.recordKey, entry.schoolId, JSON.stringify(entry.payload)]);
        }
        for (const [stateKey, payload] of metadata) {
          const snapshotKey = `metadata:${stateKey}`;
          const hash = persistenceHash(payload);
          nextSnapshot.set(snapshotKey, hash);
          if (postgresPersistenceSnapshot.get(snapshotKey) === hash) continue;
          await client.query(`INSERT INTO little_feet_metadata (state_key, payload, updated_at)
            VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (state_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [stateKey, JSON.stringify(payload)]);
        }
        for (const snapshotKey of postgresPersistenceSnapshot.keys()) {
          if (nextSnapshot.has(snapshotKey)) continue;
          if (snapshotKey.startsWith('record:')) {
            const [collection, recordKey] = snapshotKey.slice(7).split('\u0000');
            await client.query('DELETE FROM little_feet_records WHERE collection = $1 AND record_key = $2', [collection, recordKey]);
          } else if (snapshotKey.startsWith('metadata:')) {
            await client.query('DELETE FROM little_feet_metadata WHERE state_key = $1', [snapshotKey.slice(9)]);
          }
        }
        await client.query('COMMIT');
        postgresPersistenceSnapshot = nextSnapshot;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logStructured('error', 'persistence.postgres_save_failed', { category: 'persistence', message: error.message });
        throw error;
      } finally {
        client.release();
      }
    });
    return postgresSaveChain;
  }
  if (!stateDatabase) return;
  try {
    stateDatabase.prepare(`
      INSERT INTO app_state (state_key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run('primary', JSON.stringify(db), new Date().toISOString());
  } catch (error) {
    logStructured('error', 'persistence.sqlite_save_failed', { category: 'persistence', message: error.message });
    throw error;
  }
}
const queueStorageCleanup = (schoolId, files, reason) => {
  const objectKeys = [...new Set((files || []).map(file => file?.objectKey).filter(Boolean))];
  if (!objectKeys.length) return null;
  const job = { id: crypto.randomUUID(), targetSchoolId: schoolId, reason, pendingKeys: objectKeys, failedKeys: [], status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.storageCleanupJobs.unshift(job);
  return job;
};
const runStorageCleanupJob = async job => {
  if (!job || !objectStorage.configured) return false;
  const failed = [];
  for (const key of job.pendingKeys || []) {
    try { await objectStorage.delete({ key }); } catch { failed.push(key); }
  }
  job.pendingKeys = failed;
  job.failedKeys = failed;
  job.status = failed.length ? 'retry_required' : 'completed';
  job.updatedAt = new Date().toISOString();
  if (!failed.length) {
    const completedForSchool = db.storageCleanupJobs.filter(item => item.status === 'completed' && item.targetSchoolId === job.targetSchoolId);
    const expiredIds = new Set(completedForSchool.slice(100).map(item => item.id));
    if (expiredIds.size) db.storageCleanupJobs = db.storageCleanupJobs.filter(item => !expiredIds.has(item.id));
  }
  return !failed.length;
};
const retryPendingStorageCleanup = async () => {
  if (!objectStorage.configured) return;
  for (const job of db.storageCleanupJobs.filter(item => item.status !== 'completed').slice(0, 25)) await runStorageCleanupJob(job);
};
function loadReplicaSnapshot() {
  try {
    if (!fs.existsSync(replicaFile)) return;
    const snapshotStat = fs.statSync(replicaFile);
    const snapshotVersion = `${snapshotStat.mtimeMs}:${snapshotStat.size}`;
    if (snapshotVersion === replicaSnapshotVersion) return;
    const saved = JSON.parse(fs.readFileSync(replicaFile, 'utf8'));
    if (applySavedState(saved)) replicaSnapshotVersion = snapshotVersion;
  } catch (error) {
    logStructured('error', 'replica.snapshot_load_failed', { category: 'replica', message: error.message });
  }
}
function writeReplicaSnapshot() {
  if (replicaMode) return;
  try {
    const stagingFile = `${replicaFile}.next`;
    fs.writeFileSync(stagingFile, JSON.stringify({ ...db, replicatedAt: new Date().toISOString() }), 'utf8');
    fs.renameSync(stagingFile, replicaFile);
  } catch (error) {
    logStructured('error', 'replica.snapshot_write_failed', { category: 'replica', message: error.message });
  }
}
function ensureBootstrapAdministrator() {
  if (db.users.some(account => account.role === 'admin')) return;
  const username = String(process.env.LF_BOOTSTRAP_ADMIN_USERNAME || '').trim();
  const pin = String(process.env.LF_BOOTSTRAP_ADMIN_PIN || '');
  if (!username || !pin) {
    logStructured('warn', 'bootstrap.admin_missing', { category: 'configuration', message: 'No administrator account exists. Set LF_BOOTSTRAP_ADMIN_USERNAME and LF_BOOTSTRAP_ADMIN_PIN to create the first real school administrator.' });
    return;
  }
  db.users.push({
    username,
    pinHash: hashPin(pin),
    name: String(process.env.LF_BOOTSTRAP_ADMIN_NAME || 'School Administrator').trim(),
    role: 'admin',
    schoolName: String(process.env.LF_BOOTSTRAP_SCHOOL_NAME || 'Your School').trim(),
    schoolStoreUrl: '',
    verificationStatus: 'Active',
    createdAt: new Date().toISOString()
  });
}
function applyOwnerAccountMigration() {
  if (process.env.LF_OWNER_RESET_ALL_ACCOUNTS !== '1') return false;
  const migrationId = String(process.env.LF_OWNER_ACCOUNT_RESET_ID || '').trim().slice(0, 120);
  const username = String(process.env.LF_OWNER_ADMIN_USERNAME || '').trim().slice(0, 160);
  const pin = String(process.env.LF_OWNER_ADMIN_PIN || '');
  const name = String(process.env.LF_OWNER_ADMIN_NAME || '').trim().slice(0, 160);
  if (!migrationId || !username || !name || pin.length < 4 || pin.length > 128) {
    throw new Error('LF_OWNER_RESET_ALL_ACCOUNTS requires a reset ID, owner username, owner name, and a 4-128 character owner PIN/password.');
  }
  if (!db.accountMigrations || typeof db.accountMigrations !== 'object' || Array.isArray(db.accountMigrations)) db.accountMigrations = {};
  if (db.accountMigrations[migrationId]) return false;

  const anchor = db.users.find(account => account.role === 'admin') || db.users[0];
  const requestedSchoolName = String(process.env.LF_OWNER_SCHOOL_NAME || '').trim().slice(0, 160);
  const anchorSchool = anchor && db.schools.find(school => school.id === accountSchoolId(anchor));
  const school = anchorSchool || db.schools.find(item => schoolKey(item.name) === schoolKey(requestedSchoolName))
    || ensureSchool(requestedSchoolName || anchor?.schoolName || 'Little Feet');
  const removedUsernames = new Set(db.users.map(account => normalizeUsername(account.username)).filter(value => value && value !== normalizeUsername(username)));
  const removedStaffFiles = (db.fileRecords || []).filter(file => file.entityType === 'staff'
    && removedUsernames.has(normalizeUsername(file.recordId)) && file.accessState !== 'deleted');
  const filesBySchool = new Map();
  removedStaffFiles.forEach(file => {
    const schoolId = String(file.schoolId || 'unassigned');
    if (!filesBySchool.has(schoolId)) filesBySchool.set(schoolId, []);
    filesBySchool.get(schoolId).push(file);
  });
  filesBySchool.forEach((files, schoolId) => queueStorageCleanup(schoolId, files, `owner-account-reset:${migrationId}`));
  const deletedAt = new Date().toISOString();
  removedStaffFiles.forEach(file => { file.accessState = 'deleted'; file.deletedAt = deletedAt; file.deletedBy = username; });

  db.users = [{
    username,
    pinHash: hashPin(pin),
    name,
    role: 'admin',
    schoolId: school.id,
    schoolName: requestedSchoolName || school.name,
    schoolStoreUrl: '',
    verificationStatus: 'Active',
    createdAt: new Date().toISOString()
  }];
  db.accountMigrations[migrationId] = { appliedAt: new Date().toISOString(), ownerUsername: username, removedAccounts: removedUsernames.size };
  logStructured('info', 'account.owner_reset_applied', { category: 'migration', result: 'completed', details: `Migration ${migrationId}; removed ${removedUsernames.size} previous account(s).` });
  return true;
}
function removeLegacyMailboxConnections() {
  let removed = 0;
  (db.users || []).forEach(account => {
    if (!account?.mailboxConnection) return;
    if (account.mailboxConnection.version === 2 && MAILBOX_PROVIDERS.has(account.mailboxConnection.provider)) return;
    delete account.mailboxConnection;
    removed += 1;
  });
  if (removed) logStructured('info', 'mailbox.legacy_connections_removed', { category: 'migration', result: 'completed', details: `Removed ${removed} obsolete mailbox connection record(s).` });
  return removed;
}

function syncConfiguredPlatformOwnerAccess() {
  const ownerUsername = configuredPlatformOwnerUsername();
  let owner = ownerUsername ? db.users.find(account => normalizeUsername(account.username) === ownerUsername) : null;
  // Safe first-run fallback: if no owner username is configured yet and the
  // installation has exactly one administrator, that founding administrator
  // becomes the platform owner. Once set, the persisted platformAccess flag
  // keeps the ownership capability explicit rather than depending on a name.
  if (!owner) {
    const administrators = db.users.filter(account => account.role === 'admin');
    if (!ownerUsername && administrators.length === 1) owner = administrators[0];
  }
  if (!owner) return false;
  owner.role = 'admin';
  owner.platformAccess = true;
  owner.verificationStatus = 'Active';
  return true;
}

function scheduleReplicaSnapshot() {
  if (replicaMode || replicaSnapshotTimer) return;
  replicaSnapshotTimer = setTimeout(() => {
    replicaSnapshotTimer = null;
    writeReplicaSnapshot();
  }, 250);
}
async function initialisePersistence() {
  if (replicaMode) {
    loadReplicaSnapshot();
    replicaTimer = setInterval(loadReplicaSnapshot, 2000);
    return;
  }
  if (process.env.DATABASE_URL) await openPostgresDatabase();
  else openStateDatabase();
  const restoredFromDatabase = await loadDatabaseState();
  if (!restoredFromDatabase) loadReplicaSnapshot();
  const ownerAccountResetApplied = applyOwnerAccountMigration();
  ensureBootstrapAdministrator();
  syncConfiguredPlatformOwnerAccess();
  migrateSchoolTenancy();
  migrateSensitiveStoredFields();
  removeLegacyMailboxConnections();
  ensureAllLearnersHaveAccessCodes();
  syncCurrentReleaseNotes();
  await retryPendingStorageCleanup();
  await saveDatabaseState();
  if (ownerAccountResetApplied && postgresPool) await postgresPool.query('DELETE FROM little_feet_sessions');
  writeReplicaSnapshot();
}

persistenceReady = initialisePersistence();

// API Endpoints
// Auth
const establishAuthenticatedSession = (req, account, callback) => {
  const safeUser = safeAccount(account);
  req.session.regenerate(regenerateError => {
    if (regenerateError) return callback(regenerateError);
    req.session.littleFeetUser = safeUser;
    req.session.save(saveError => callback(saveError, safeUser));
  });
};

app.post('/api/login', (req, res) => {
  const { username, pin } = req.body;
  const loginUsername = limitedText(username, 160);
  const normalizedUsername = loginUsername ? normalizeUsername(loginUsername) : '';

  // Every accepted login alias for the same account shares one username-level
  // spray bucket. Otherwise an attacker could multiply guesses by rotating
  // aliases while also rotating source IPs.
  const matchedAccount = normalizedUsername
    ? db.users.find(account => accountMatchesUsername(account, normalizedUsername))
    : null;
  const attemptIdentity = matchedAccount ? normalizeUsername(matchedAccount.username) : normalizedUsername;
  const attemptKey = loginAttemptKey(req, attemptIdentity || '[invalid-username]');
  const previousAttempts = activeLoginAttempt(attemptKey);
  const previousUsernameAttempts = activeUsernameAttempt(attemptIdentity);
  const activeLockout = [previousAttempts, previousUsernameAttempts]
    .filter(entry => Number(entry?.lockedUntil) > Date.now())
    .sort((left, right) => Number(right.lockedUntil) - Number(left.lockedUntil))[0];
  if (activeLockout) {
    const retryAfterSeconds = loginLockoutRemainingSeconds(activeLockout);
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      message: 'Too many unsuccessful sign-in attempts. Please wait 10 minutes before trying again.',
      retryAfterSeconds
    });
  }

  const user = matchedAccount && validSecretLength(pin) && matchesPin(pin, matchedAccount.pinHash)
    ? matchedAccount
    : null;
  if (user) {
    if (String(user.verificationStatus || '').includes('verification pending')) {
      return res.status(403).json({ message: 'This account is waiting for school approval. Please contact your school administrator.' });
    }
    loginAttempts.delete(attemptKey);
    loginUsernameAttempts.delete(attemptIdentity);
    if (!replicaMode && pinHashNeedsUpgrade(user.pinHash)) user.pinHash = hashPin(pin);
    establishAuthenticatedSession(req, user, (error, safeUser) => {
      if (error) return res.status(500).json({ message: 'Unable to establish a secure sign-in session. Please try again.' });
      res.json({ user: safeUser });
    });
  } else {
    const now = Date.now();
    const nextSourceCount = (previousAttempts?.count || 0) + 1;
    const nextUsernameCount = (previousUsernameAttempts?.count || 0) + 1;
    const sourceLocked = nextSourceCount >= MAX_LOGIN_ATTEMPTS;
    const usernameLocked = nextUsernameCount >= MAX_DISTRIBUTED_LOGIN_ATTEMPTS;
    const lockedUntil = sourceLocked || usernameLocked ? now + LOGIN_COOLDOWN_MS : 0;

    loginAttempts.set(attemptKey, {
      count: nextSourceCount,
      firstAttempt: previousAttempts?.firstAttempt || now,
      ...(sourceLocked ? { lockedUntil } : {})
    });
    loginUsernameAttempts.set(attemptIdentity, {
      count: nextUsernameCount,
      firstAttempt: previousUsernameAttempts?.firstAttempt || now,
      ...(usernameLocked ? { lockedUntil } : {})
    });
    if (loginAttempts.size > 10000 || loginUsernameAttempts.size > 10000) pruneLoginAttempts();

    if (sourceLocked || usernameLocked) {
      if (matchedAccount && usernameLocked) {
        void sendLoginLockoutEmail(matchedAccount).catch(error => {
          logStructured('error', 'auth.lockout_email_failed', { category: 'authentication', requestId: req.requestId, user: matchedAccount?.username || '', role: matchedAccount?.role || '', schoolId: matchedAccount ? accountSchoolId(matchedAccount) : '', schoolName: matchedAccount?.schoolName || '', method: req.method, route: req.path, message: error.message });
        });
      }
      const retryAfterSeconds = Math.ceil(LOGIN_COOLDOWN_MS / 1000);
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        message: 'Too many unsuccessful sign-in attempts. Please wait 10 minutes before trying again.',
        retryAfterSeconds
      });
    }

    res.status(401).json({ message: "Invalid Staff ID / Parent Email or PIN." });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  // Do not count the health probe itself, and do not report normal concurrent
  // dashboard startup requests as server overload.
  const reportedActiveRequests = Math.max(0, activeRequestCount - 1);
  const status = reportedActiveRequests >= SERVER_BUSY_THRESHOLD ? 'BUSY' : 'OK';
  const actor = getSessionAccount(req);
  res.set('Cache-Control', 'no-store');
  if (!actor) return res.json({ status, timestamp: new Date().toISOString() });
  return res.json({
    status,
    instance: replicaMode ? 'STANDBY' : 'PRIMARY',
    activeRequests: reportedActiveRequests,
    timestamp: new Date().toISOString()
  });
});

// A lightweight heartbeat used by the repository's free scheduled monitor. It
// touches the configured datastore so both the web service and a free pilot
// PostgreSQL project remain active without exposing application records.
app.get('/api/keepalive', async (_req, res) => {
  try {
    if (postgresPool) await postgresPool.query('SELECT 1');
    else if (stateDatabase) stateDatabase.prepare('SELECT 1').get();
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
  } catch (error) {
    logStructured('error', 'health.keepalive_probe_failed', { category: 'health', message: error.message, result: 'failed' });
    res.status(503).json({ status: 'DATABASE_UNAVAILABLE', timestamp: new Date().toISOString() });
  }
});

const runtimeReadiness = () => {
  const checks = {
    database: Boolean(process.env.DATABASE_URL),
    durableSessions: Boolean(process.env.DATABASE_URL),
    fieldEncryption: fieldEncryptionConfigured,
    sessionSecret: sessionSecretConfigured,
    secureCookies: isProduction,
    bootstrapAccount: db.users.some(account => account.role === 'admin'),
    privateObjectStorage: objectStorage.configured,
    storageCleanupHealthy: !(db.storageCleanupJobs || []).some(job => job.status === 'retry_required')
  };
  return { checks, ready: Object.values(checks).every(Boolean) };
};

// A separate readiness endpoint lets hosting monitor liveness without treating
// a missing production secret as a healthy, launch-ready configuration.
app.get('/api/ready', (req, res) => {
  const readiness = runtimeReadiness();
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
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const billing = subscriptionBillingState(actor);
  const readiness = runtimeReadiness();
  const integrations = {
    paymentDestination: billingPaymentConfigured(billing.payment),
    signedPaymentWebhook: Boolean(process.env.LF_PAYMENT_WEBHOOK_SECRET),
    emailDelivery: Boolean(process.env.LF_EMAIL_FROM && process.env.LF_EMAIL_API_KEY),
    smsDelivery: Boolean(process.env.LF_SMS_FROM && process.env.LF_SMS_API_KEY),
    monitoring: Boolean(process.env.LF_MONITORING_DSN || process.env.LF_MONITORING_PROVIDER),
    monitoringProvider: boundedText(process.env.LF_MONITORING_PROVIDER || (process.env.LF_MONITORING_DSN ? 'external-dsn' : ''), 80),
    privateObjectStorage: objectStorage.configured,
    objectStorageProvider: objectStorage.kind,
    offsiteBackup: Boolean(process.env.LF_BACKUP_R2_BUCKET && process.env.LF_BACKUP_REHEARSAL_ID),
    backupProvider: process.env.LF_BACKUP_R2_BUCKET ? 'cloudflare-r2-isolated-bucket' : '',
    backupRehearsalId: boundedText(process.env.LF_BACKUP_REHEARSAL_ID, 120)
  };
  const missingActions = [];
  if (!readiness.checks.database) missingActions.push('Connect a persistent PostgreSQL DATABASE_URL.');
  if (!readiness.checks.fieldEncryption) missingActions.push('Set LF_FIELD_ENCRYPTION_KEY.');
  if (!readiness.checks.sessionSecret) missingActions.push('Set a strong SESSION_SECRET.');
  if (!readiness.checks.privateObjectStorage) missingActions.push('Configure the private Cloudflare R2 bucket and server-side credentials.');
  if (!readiness.checks.storageCleanupHealthy) missingActions.push('Resolve pending private-object cleanup jobs.');
  if (!integrations.paymentDestination) missingActions.push('Configure a bank-transfer destination or HTTPS payment link.');
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

// Public self-registration is intentionally limited to school-facing roles.
app.post('/api/signup', (req, res) => {
  const { username, pin, name, role, schoolName, termsAccepted, linkedLearners } = req.body;
  const cleanUsername = boundedText(username, 160);
  const cleanName = boundedText(name, 160);
  const cleanSchoolName = boundedText(schoolName, 160);
  const selfRegistrationRoles = ['parent', 'teacher', 'principal'];
  if (!cleanUsername || !pin || !cleanName || !cleanSchoolName || !selfRegistrationRoles.includes(role)) {
    return res.status(400).json({ message: 'Complete all fields and choose Parent, Teacher, or Principal.' });
  }
  if (!termsAccepted) return res.status(400).json({ message: 'You must accept the school privacy notice and terms before creating an account.' });
  if (String(pin).length < 4 || String(pin).length > 128) return res.status(400).json({ message: 'Choose a password or PIN between 4 and 128 characters.' });
  if (db.users.some(account => accountMatchesUsername(account, cleanUsername))) return res.status(409).json({ message: 'That username is already in use.' });
  const linkValidation = role === 'parent' ? validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const requestedLinks = linkValidation.links;
  const account = {
    username: cleanUsername, pinHash: hashPin(pin), name: cleanName, role,
    schoolName: cleanSchoolName, schoolStoreUrl: '', linkedLearners: [],
    requestedLearnerLinks: role === 'parent' ? requestedLinks : [],
    parentRelationshipStatus: role === 'parent' ? 'Pending administrator approval' : undefined,
    subscription: role === 'parent' ? 'basic' : 'school',
    verificationStatus: 'Self-registered — school verification pending',
    termsAcceptedAt: new Date().toISOString(),
    termsVersion: LITTLE_FEET_TERMS_VERSION,
    privacyAcceptedAt: new Date().toISOString(),
    privacyVersion: LITTLE_FEET_PRIVACY_VERSION
  };
  account.schoolId = ensureSchool(account.schoolName).id;
  db.users.push(account);
  const { pin: _pin, pinHash: _pinHash, ...safeAccount } = account;
  res.status(201).json({ success: true, account: safeAccount });
});

const safeAccount = ({ pin, pinHash, reportSigningPinHash, mailboxConnection, emailForwarding, ...account }) => ({
  ...account,
  ...(account.role === 'parent' ? { subscription: parentSubscriptionActive(account) ? 'plus' : 'basic', parentSubscriptionActive: parentSubscriptionActive(account) } : {})
});
const getSessionAccount = (req) => {
  const username = req.session?.littleFeetUser?.username;
  return username ? findAccountByUsername(username) : null;
};
const requireAdmin = (req) => {
  const account = getSessionAccount(req);
  return isAdminLike(account) ? account : null;
};
const requireSchoolStaff = (req) => {
  const account = getSessionAccount(req);
  return account && (hasPlatformAccess(account) || ['teacher', 'principal', 'admin', 'staff', 'school_accounts'].includes(account.role)) ? account : null;
};
const requireCompanyStaff = (req) => {
  const account = getSessionAccount(req);
  return isCompanyStaffRole(account) ? account : null;
};
const learnerRecordsVisibleTo = (records, actor) => {
  const schoolRecords = tenantRecords(records, actor);
  if (actor?.role === 'parent') {
    const linkedLearnerNames = new Set(
      tenantRecords(db.students, actor)
        .filter(student => isParentLinkedToLearner(actor, student))
        .map(student => normalizeComparableText(student.studentName))
    );
    return schoolRecords.filter(record => linkedLearnerNames.has(normalizeComparableText(record.studentName || record.learnerName)));
  }
  if (actor?.role === 'teacher') {
    const assignedClasses = new Set(normaliseAssignedClasses(actor.assignedClasses));
    if (!assignedClasses.size) return [];
    const assignedLearners = new Set(
      tenantRecords(db.students, actor)
        .filter(student => assignedClasses.has(normalizeComparableText(student.className)))
        .map(student => normalizeComparableText(student.studentName))
    );
    return schoolRecords.filter(record => {
      const recordClass = normalizeComparableText(record.className);
      if (recordClass) return assignedClasses.has(recordClass);
      return assignedLearners.has(normalizeComparableText(record.studentName || record.learnerName));
    });
  }
  return schoolRecords;
};
const recordSystemError = (error, req = null, extra = {}) => {
  if (!Array.isArray(db.systemErrors)) db.systemErrors = [];
  const actor = req ? getSessionAccount(req) : null;
  const route = String(extra.route || req?.originalUrl || '').split('?')[0].slice(0, 240);
  const entry = {
    id: crypto.randomUUID(), requestId: req?.requestId || '', schoolId: actor ? accountSchoolId(actor) : '',
    method: String(req?.method || extra.method || 'SYSTEM').slice(0, 12),
    route,
    name: String(extra.name || error?.name || 'Error').slice(0, 80), message: redactSensitiveLogText(error?.message || 'Unknown server error'),
    severity: extra.severity || 'error', status: 'open', createdAt: new Date().toISOString()
  };
  db.systemErrors.unshift(entry);
  if (db.systemErrors.length > 5000) db.systemErrors.length = 5000;
  logStructured(entry.severity, 'system.error', {
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
    message: entry.message
  });
  return entry;
};

app.get('/api/system-status', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view live system status.' });
  const recentUpdates = (db.releaseNotes || []).slice(0, 5);
  const openErrors = (db.systemErrors || []).filter(entry => entry.status === 'open' && (!entry.schoolId || entry.schoolId === accountSchoolId(actor))).length;
  res.json({ status: openErrors ? 'attention' : 'operational', openIssues: openErrors, recentUpdates, checkedAt: new Date().toISOString() });
});

app.get('/api/system-diagnostics', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const schoolId = accountSchoolId(actor);
  const schoolCount = records => (records || []).filter(entry => !entry.schoolId || entry.schoolId === schoolId).length;
  const readiness = runtimeReadiness();
  res.json({
    status: readiness.ready ? 'ready' : 'configuration-required', readiness,
    records: {
      accounts: db.users.filter(account => accountSchoolId(account) === schoolId).length,
      learners: schoolCount(db.students), attendance: schoolCount(db.attendance),
      messages: schoolCount(db.directMessages), payments: schoolCount(db.paymentLedger),
      activeFiles: schoolCount(db.fileRecords?.filter(file => file.accessState === 'active')),
      openErrors: (db.systemErrors || []).filter(entry => entry.status === 'open' && (!entry.schoolId || entry.schoolId === schoolId)).length
    },
    persistence: postgresPool ? 'record-based-postgresql' : replicaMode ? 'read-only-replica' : 'local-sqlite',
    activeRequests: activeRequestCount, generatedAt: new Date().toISOString()
  });
});

const structuredLogVisibleTo = (entry, actor) =>
  Boolean(actor && (hasPlatformAccess(actor) || !entry.schoolId || entry.schoolId === accountSchoolId(actor)));
const systemErrorVisibleTo = (entry, actor) =>
  Boolean(actor && (hasPlatformAccess(actor) || !entry.schoolId || entry.schoolId === accountSchoolId(actor)));
const structuredStatusMatches = (status, filter) => {
  if (!filter) return true;
  if (/^[1-5]xx$/i.test(filter)) return Math.floor(Number(status || 0) / 100) === Number(filter[0]);
  return Number(status) === Number(filter);
};

app.get('/api/system-errors', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  res.json((db.systemErrors || []).filter(entry => systemErrorVisibleTo(entry, actor)).slice(0, 250));
});

app.get('/api/system-logs', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });

  const severity = boundedText(req.query?.severity, 20).toLowerCase();
  const method = boundedText(req.query?.method, 12).toUpperCase();
  const status = boundedText(req.query?.status, 8).toLowerCase();
  const requestId = boundedText(req.query?.requestId, 100);
  const user = boundedText(req.query?.user, 160).toLowerCase();
  const event = boundedText(req.query?.event, 120).toLowerCase();
  const search = boundedText(req.query?.search, 160).toLowerCase();
  const limit = Math.max(25, Math.min(1000, Number(req.query?.limit) || 250));
  const visibleLogs = structuredLogger.list().filter(entry => structuredLogVisibleTo(entry, actor));
  const recentCutoff = Date.now() - 15 * 60 * 1000;
  const recent = visibleLogs.filter(entry => Date.parse(entry.timestamp) >= recentCutoff);
  const filtered = visibleLogs.filter(entry => {
    if (severity && entry.severity !== severity) return false;
    if (method && entry.method !== method) return false;
    if (status && !structuredStatusMatches(entry.status, status)) return false;
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
    slowRequests: recent.filter(entry => entry.event === 'http.request' && Number(entry.durationMs) >= structuredLogger.slowRequestMs).length,
    uniqueUsers: new Set(recent.map(entry => entry.user).filter(Boolean)).size,
    maxEntries: structuredLogger.maxEntries,
    slowRequestMs: structuredLogger.slowRequestMs,
    newestAt: visibleLogs[0]?.timestamp || null,
    oldestAt: visibleLogs[visibleLogs.length - 1]?.timestamp || null
  };
  res.json({ summary, logs: filtered, generatedAt: new Date().toISOString() });
});

app.get('/api/system-logs/trace/:requestId', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const requestId = boundedText(req.params.requestId, 100);
  if (!requestId) return res.status(400).json({ message: 'A request ID is required.' });
  const logs = structuredLogger.findByRequestId(requestId).filter(entry => structuredLogVisibleTo(entry, actor));
  const errors = (db.systemErrors || []).filter(entry => entry.requestId === requestId && systemErrorVisibleTo(entry, actor));
  if (!logs.length && !errors.length) return res.status(404).json({ message: 'No trace was found for this request ID.' });
  res.json({ requestId, logs, errors });
});

app.post('/api/system/client-log', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in before sending browser diagnostics.' });
  const severity = ['info', 'warn', 'error'].includes(String(req.body?.severity || '').toLowerCase()) ? String(req.body.severity).toLowerCase() : 'error';
  const code = boundedText(req.body?.code || 'CLIENT_ERROR', 100);
  const page = boundedText(req.body?.page || '/', 200).split('?')[0];
  const source = boundedText(req.body?.source || '', 220).split('?')[0];
  const message = boundedText(req.body?.message || 'Browser diagnostic event', 500);
  const line = Number.isFinite(Number(req.body?.line)) ? Number(req.body.line) : null;
  const column = Number.isFinite(Number(req.body?.column)) ? Number(req.body.column) : null;
  const details = [source ? `Source ${source}` : '', line ? `Line ${line}${column ? `:${column}` : ''}` : ''].filter(Boolean).join(' · ');
  const logged = logStructured(severity, 'client.error', {
    category: 'browser',
    requestId: req.requestId,
    user: actor.username,
    role: actor.role,
    schoolId: accountSchoolId(actor),
    schoolName: actor.schoolName || '',
    method: 'CLIENT',
    route: page,
    result: 'reported',
    code,
    message,
    details
  });

  const persistentCodes = new Set(['WEB_RUNTIME_ERROR', 'WEB_PROMISE_ERROR', 'WEB_RESOURCE_ERROR']);
  if (severity === 'error' && persistentCodes.has(code)) {
    const duplicateCutoff = Date.now() - 5 * 60 * 1000;
    const duplicate = (db.systemErrors || []).some(entry =>
      entry.name === code
      && entry.schoolId === accountSchoolId(actor)
      && entry.message === redactSensitiveLogText(message)
      && Date.parse(entry.createdAt || '') >= duplicateCutoff
    );
    if (!duplicate) {
      const clientError = new Error(message);
      clientError.name = code;
      recordSystemError(clientError, req, { severity: 'error', route: page, name: code });
    }
  }
  res.status(201).json({ success: true, logId: logged.id, requestId: req.requestId });
});

app.patch('/api/system-errors/:id', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const entry = (db.systemErrors || []).find(item => item.id === req.params.id && systemErrorVisibleTo(item, actor));
  if (!entry) return res.status(404).json({ message: 'System error report not found.' });
  const status = String(req.body?.status || 'acknowledged').toLowerCase();
  if (!['acknowledged', 'resolved'].includes(status)) return res.status(400).json({ message: 'Choose acknowledged or resolved.' });
  entry.status = status;
  entry.updatedAt = new Date().toISOString();
  entry.updatedBy = actor.username;
  logStructured('info', 'system.error_status_changed', {
    category: 'error-management', requestId: req.requestId, user: actor.username, role: actor.role,
    schoolId: accountSchoolId(actor), schoolName: actor.schoolName || '', method: req.method, route: req.path,
    result: status, code: entry.name, message: `Error report ${entry.id} marked ${status}.`
  });
  res.json({ success: true, entry });
});

const billingBundleSizes = [5, 20, 100];
const schoolSubscriptionPlans = Object.freeze([
  Object.freeze({ code: 'micro', name: 'Micro / ECD', maxLearners: 30, monthlyPrice: 350 }),
  Object.freeze({ code: 'standard', name: 'Standard Primary', maxLearners: 250, monthlyPrice: 1500 }),
  Object.freeze({ code: 'enterprise', name: 'Enterprise Campus', maxLearners: 1000, monthlyPrice: 7500 })
]);
const billingDefaults = () => ({
  pricing: { baseMonthly: 0, bundles: { 5: { costPrice: 0, sellingPrice: 0 }, 20: { costPrice: 0, sellingPrice: 0 }, 100: { costPrice: 0, sellingPrice: 0 } }, lateFeeEnabled: false, lateFee: 0 },
  payment: { method: 'payment_link', paymentLink: '', accountName: '', bankName: '', accountNumberEncrypted: '', payMePayloadEncrypted: '', branchCode: '', referencePrefix: 'LF' },
  orders: []
});
const billingPaymentConfigured = (payment) => payment?.method === 'payment_link'
  ? Boolean(payment.paymentLink)
  : Boolean(payment?.accountName && payment?.bankName && payment?.accountNumberEncrypted);
const subscriptionBillingState = (actor = null) => {
  const defaults = billingDefaults();
  const schoolId = actor ? accountSchoolId(actor) : null;
  if (schoolId) {
    if (!db.schoolBilling || typeof db.schoolBilling !== 'object') db.schoolBilling = {};
    if (!db.schoolBilling[schoolId]) db.schoolBilling[schoolId] = db.subscriptionBilling || {};
  }
  const existing = schoolId ? db.schoolBilling[schoolId] : (db.subscriptionBilling || {});
  const state = {
    ...defaults,
    ...existing,
    pricing: {
      ...defaults.pricing,
      ...(existing.pricing || {}),
      bundles: { ...defaults.pricing.bundles, ...((existing.pricing || {}).bundles || {}) }
    },
    payment: { ...defaults.payment, ...(existing.payment || {}) },
    orders: Array.isArray(existing.orders) ? existing.orders : []
  };
  // The platform owner receives subscription and donation payments. A saved
  // global destination is therefore the safe fallback for a school record that
  // predates payment setup or was created by an older release.
  if (schoolId && !billingPaymentConfigured(state.payment) && billingPaymentConfigured(db.subscriptionBilling?.payment)) {
    state.payment = { ...defaults.payment, ...db.subscriptionBilling.payment };
  }
  if (schoolId) db.schoolBilling[schoolId] = state;
  else db.subscriptionBilling = state;
  return state;
};
const billingAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1000000 ? Math.round(amount * 100) / 100 : null;
};
const publicBillingPricing = (billing, includeCosts = false) => ({
  baseMonthly: billing.pricing.baseMonthly,
  lateFeeEnabled: Boolean(billing.pricing.lateFeeEnabled),
  lateFee: billing.pricing.lateFee,
  bundles: billingBundleSizes.map(capacity => ({
    capacity,
    sellingPrice: billing.pricing.bundles[capacity]?.sellingPrice || 0,
    ...(includeCosts ? { costPrice: billing.pricing.bundles[capacity]?.costPrice || 0 } : {})
  }))
});
const donationBillingState = () => {
  const globalBilling = subscriptionBillingState();
  if (billingPaymentConfigured(globalBilling.payment)) return globalBilling;
  const configuredSchoolBilling = Object.values(db.schoolBilling || {}).find(state => billingPaymentConfigured(state?.payment || {}));
  return configuredSchoolBilling || globalBilling;
};
const paymentInstructions = (billing, reference) => {
  const payment = billing.payment;
  if (payment.method === 'payment_link') return { method: 'Online payment', paymentLink: payment.paymentLink, reference };
  return {
    method: 'Bank transfer', accountName: payment.accountName, bankName: payment.bankName,
    accountNumber: decryptField(payment.accountNumberEncrypted), branchCode: payment.branchCode, reference,
    capitecPayMePayload: decryptField(payment.payMePayloadEncrypted)
  };
};
const dateKeyInSouthAfrica = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());
const parentSubscriptionActive = account => {
  if (!account || account.role !== 'parent') return true;
  const grantedUntil = validDateKey(account.parentSubscriptionGrantedUntil);
  if (String(account.parentSubscriptionStatus || '').toLowerCase() === 'paid') return !grantedUntil || grantedUntil >= dateKeyInSouthAfrica();
  return Boolean(grantedUntil && grantedUntil >= dateKeyInSouthAfrica());
};
const validDateKey = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim()) ? String(value).trim() : '';
const extendSubscriptionDate = (currentEndDate, fromTimestamp = new Date().toISOString()) => {
  const today = validDateKey(String(fromTimestamp || '').slice(0, 10)) || dateKeyInSouthAfrica();
  const current = validDateKey(currentEndDate);
  const base = current && current >= today ? current : today;
  const expiry = new Date(`${base}T12:00:00.000Z`);
  expiry.setUTCDate(expiry.getUTCDate() + 30);
  return expiry.toISOString().slice(0, 10);
};
const cents = value => Math.round(Number(value || 0) * 100) / 100;
const parentPaymentAmount = record => billingAmount(record.arrangementAmount) > 0 ? billingAmount(record.arrangementAmount) : (billingAmount(record.amountDue) || 0);
const parentPaymentDueDate = record => {
  const original = validDateKey(record.dueDate) || dateKeyInSouthAfrica();
  const arrangement = validDateKey(record.arrangementDueDate);
  return arrangement && arrangement > original ? arrangement : original;
};
const parentPaymentFinancials = (record, asOf = dateKeyInSouthAfrica()) => {
  const originalEffectiveAmount = parentPaymentAmount(record);
  const creditTotal = cents((db.financeAdjustments || [])
    .filter(adjustment => adjustment.type === 'credit' && adjustment.schoolId === record.schoolId && String(adjustment.reference || '').toUpperCase() === String(record.reference || '').toUpperCase())
    .reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0));
  const amountDue = Math.max(0, cents(originalEffectiveAmount - creditTotal));
  const events = (db.paymentEvents || []).filter(event => event.targetType === 'parent_payment' && event.schoolId === record.schoolId && String(event.reference || '').toUpperCase() === String(record.reference || '').toUpperCase());
  const paid = cents(events.filter(event => event.status === 'paid').reduce((sum, event) => sum + Number(event.amount || 0), 0));
  const refunded = cents(events.filter(event => event.status === 'refunded').reduce((sum, event) => sum + Number(event.amount || 0), 0));
  const paidAmount = Math.max(0, cents(paid - refunded));
  const balance = Math.max(0, cents(amountDue - paidAmount));
  const effectiveDueDate = parentPaymentDueDate(record);
  const overdue = balance > 0 && effectiveDueDate < asOf;
  const daysPastDue = overdue
    ? Math.max(1, Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(effectiveDueDate + 'T00:00:00Z')) / 86400000))
    : 0;
  return {
    amountDue, originalAmount: billingAmount(record.amountDue) || amountDue,
    effectiveAmountBeforeCredits: originalEffectiveAmount, creditTotal,
    arrangementAmount: billingAmount(record.arrangementAmount) || null,
    paidAmount, balance, arrears: overdue ? balance : 0, dueDate: validDateKey(record.dueDate),
    effectiveDueDate, daysPastDue, status: balance <= 0 ? 'paid' : overdue ? 'in_arrears' : paidAmount > 0 ? 'partially_paid' : 'awaiting_payment',
    arrangementActive: Boolean(validDateKey(record.arrangementDueDate) && effectiveDueDate === record.arrangementDueDate && effectiveDueDate >= asOf),
    arrangementNote: String(record.arrangementNote || '').trim()
  };
};
const parentPaymentSummary = records => (records || []).reduce((summary, record) => {
  const financials = parentPaymentFinancials(record);
  summary.count += 1;
  summary.amountDue = cents(summary.amountDue + financials.amountDue);
  summary.paidAmount = cents(summary.paidAmount + financials.paidAmount);
  summary.balance = cents(summary.balance + financials.balance);
  summary.arrears = cents(summary.arrears + financials.arrears);
  if (financials.status === 'paid') summary.paid += 1;
  else if (financials.status === 'in_arrears') summary.inArrears += 1;
  return summary;
}, { count: 0, paid: 0, inArrears: 0, amountDue: 0, paidAmount: 0, balance: 0, arrears: 0 });
const parentPaymentAgeing = records => {
  const buckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, totalOpen: 0 };
  (records || []).forEach(record => {
    const financials = parentPaymentFinancials(record);
    if (financials.balance <= 0) return;
    buckets.totalOpen = cents(buckets.totalOpen + financials.balance);
    if (!financials.daysPastDue) buckets.current = cents(buckets.current + financials.balance);
    else if (financials.daysPastDue <= 30) buckets.days1to30 = cents(buckets.days1to30 + financials.balance);
    else if (financials.daysPastDue <= 60) buckets.days31to60 = cents(buckets.days31to60 + financials.balance);
    else if (financials.daysPastDue <= 90) buckets.days61to90 = cents(buckets.days61to90 + financials.balance);
    else buckets.days90plus = cents(buckets.days90plus + financials.balance);
  });
  return buckets;
};
const parentPaymentView = (record, actor) => {
  const financials = parentPaymentFinancials(record);
  const paymentHistory = (db.paymentEvents || []).filter(event => event.targetType === 'parent_payment' && event.schoolId === record.schoolId && String(event.reference || '').toUpperCase() === String(record.reference || '').toUpperCase()).map(event => ({ amount: billingAmount(event.amount) || 0, status: event.status, receivedAt: event.receivedAt, providerTransactionId: event.providerTransactionId || '' }));
  return {
    id: record.id, reference: record.reference, parentUsername: record.parentUsername, parentName: record.parentName,
    learnerName: record.learnerName, description: record.description, createdAt: record.createdAt, createdBy: record.createdBy, parentSignature: record.parentSignature || '', parentSignedAt: record.parentSignedAt || '',
    ...financials, paymentHistory, payment: paymentInstructions(subscriptionBillingState(actor), record.reference)
  };
};
const paymentStatuses = new Set(['awaiting_payment', 'paid', 'failed', 'refunded']);
const canonicalPaymentStatus = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const findPaymentTarget = (reference, actor = null) => {
  const cleanReference = String(reference || '').trim().toUpperCase();
  if (!cleanReference) return null;
  const schoolId = actor ? accountSchoolId(actor) : null;
  for (const [billingSchoolId, billing] of Object.entries(db.schoolBilling || {})) {
    if (schoolId && billingSchoolId !== schoolId) continue;
    const order = (billing.orders || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference);
    if (order) return { type: 'subscription', record: order, schoolId: billingSchoolId };
  }
  const parentSubscription = (db.parentSubscriptions || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference && (!schoolId || entry.schoolId === schoolId));
  if (parentSubscription) return { type: 'parent_subscription', record: parentSubscription, schoolId: parentSubscription.schoolId };
  const parentPayment = (db.parentPayments || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference && (!schoolId || entry.schoolId === schoolId));
  if (parentPayment) return { type: 'parent_payment', record: parentPayment, schoolId: parentPayment.schoolId };
  const storeOrder = (db.storeOrders || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference && (!schoolId || entry.schoolId === schoolId));
  if (storeOrder) return { type: 'store', record: storeOrder, schoolId: storeOrder.schoolId };
  const donation = (db.donations || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference);
  if (donation && !actor) return { type: 'donation', record: donation, schoolId: donation.schoolId || '' };
  return null;
};
const expectedPaymentAmount = target => Number(target.type === 'subscription' ? target.record.monthlyTotal : target.type === 'parent_payment' ? parentPaymentAmount(target.record) : target.record.amount);
const applyPaymentEvent = ({ eventId, reference, status, amount, providerTransactionId, source, receivedAt }, actor = null) => {
  if (!Array.isArray(db.paymentEvents)) db.paymentEvents = [];
  if (!Array.isArray(db.paymentLedger)) db.paymentLedger = [];
  const existing = db.paymentEvents.find(event => event.eventId === eventId);
  if (existing) return { duplicate: true, event: existing };
  const target = findPaymentTarget(reference, actor);
  if (!target) return { error: 'Payment reference was not found.' };
  const numericAmount = billingAmount(amount);
  const expectedAmount = expectedPaymentAmount(target);
  const normalStatus = canonicalPaymentStatus(status);
  if (!paymentStatuses.has(normalStatus)) return { error: 'Payment status is not supported.' };
  const settledEvent = db.paymentEvents.find(event => event.status === 'paid'
    && event.targetType === target.type && event.schoolId === target.schoolId
    && String(event.reference || '').toUpperCase() === String(target.record.reference || '').toUpperCase());
  if (normalStatus === 'paid' && settledEvent) return { duplicate: true, event: settledEvent, target: target.record };
  if (numericAmount === null || numericAmount <= 0) return { error: 'Payment amount must be greater than zero.' };
  if (target.type === 'parent_payment') {
    const current = parentPaymentFinancials(target.record);
    const remaining = normalStatus === 'refunded' ? current.paidAmount : current.balance;
    if (numericAmount > remaining || (normalStatus !== 'failed' && remaining <= 0)) return { error: `Payment amount cannot exceed the remaining balance of ${remaining.toFixed(2)}.` };
  } else if (numericAmount !== expectedAmount) {
    return { error: `Payment amount must match the expected amount of ${expectedAmount.toFixed(2)}.` };
  }
  const timestamp = receivedAt || new Date().toISOString();
  const event = {
    eventId, reference: target.record.reference, status: normalStatus, amount: numericAmount,
    providerTransactionId: String(providerTransactionId || '').trim().slice(0, 160), source,
    schoolId: target.schoolId, targetType: target.type, receivedAt: timestamp
  };
  target.record.paymentStatus = normalStatus;
  if (target.type === 'subscription') target.record.status = normalStatus;
  target.record.paymentUpdatedAt = timestamp;
  if (normalStatus === 'paid') target.record.paidAt = timestamp;
  if (normalStatus === 'refunded') target.record.refundedAt = timestamp;
  if (target.type === 'parent_subscription') {
    const parent = findAccountByUsername(target.record.parentUsername);
    if (parent && normalStatus === 'paid') {
      parent.parentSubscriptionStatus = 'paid'; parent.subscription = 'plus'; parent.parentSubscriptionPaidAt = timestamp;
      parent.parentSubscriptionGrantedUntil = extendSubscriptionDate(parent.parentSubscriptionGrantedUntil, timestamp);
      target.record.grantedUntil = parent.parentSubscriptionGrantedUntil;
    } else if (parent && normalStatus === 'refunded') {
      parent.parentSubscriptionStatus = 'basic'; parent.subscription = 'basic'; parent.parentSubscriptionGrantedUntil = '';
    }
  } else if (target.type === 'subscription') {
    const school = db.schools.find(entry => entry.id === target.schoolId);
    if (school && normalStatus === 'paid') {
      school.subscriptionStatus = 'active';
      school.subscriptionPlanCode = target.record.planCode || '';
      school.subscriptionActivatedAt = timestamp;
      school.subscriptionActiveUntil = extendSubscriptionDate(school.subscriptionActiveUntil, timestamp);
      target.record.activeUntil = school.subscriptionActiveUntil;
    } else if (school && normalStatus === 'refunded') {
      school.subscriptionStatus = 'refunded';
      school.subscriptionActiveUntil = '';
    }
  }
  db.paymentEvents.unshift(event);
  db.paymentLedger.unshift({
    id: crypto.randomUUID(), eventId, reference: target.record.reference, schoolId: target.schoolId,
    targetType: target.type, amount: numericAmount, status: normalStatus, source, createdAt: timestamp,
    recordedBy: actor?.username || 'signed-webhook'
  });
  return { duplicate: false, event, target: target.record };
};

app.get('/api/subscription-billing', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view subscription billing.' });
  if (!(hasPlatformAccess(actor) || ['teacher', 'principal', 'district', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'School subscription information is available to authorised school staff only.' });
  const billing = subscriptionBillingState(actor);
  const isAdmin = isAdminLike(actor);
  const school = db.schools.find(entry => entry.id === accountSchoolId(actor));
  const { accountNumberEncrypted, payMePayloadEncrypted, ...adminPayment } = billing.payment;
  res.json({
    pricing: publicBillingPricing(billing, isAdmin),
    plans: schoolSubscriptionPlans.map(plan => ({ ...plan })),
    paymentConfigured: billingPaymentConfigured(billing.payment),
    subscription: school ? {
      active: school.subscriptionStatus === 'active' && (!validDateKey(school.subscriptionActiveUntil) || school.subscriptionActiveUntil >= dateKeyInSouthAfrica()),
      status: school.subscriptionStatus || 'trial',
      planCode: school.subscriptionPlanCode || '',
      activeUntil: validDateKey(school.subscriptionActiveUntil)
    } : { active: false, status: 'unverified', planCode: '', activeUntil: '' },
    payment: isAdmin ? { ...adminPayment, accountNumber: decryptField(accountNumberEncrypted), capitecPayMeConfigured: Boolean(decryptField(payMePayloadEncrypted)) } : undefined,
    orders: billing.orders.filter(order => !order.schoolId || order.schoolId === accountSchoolId(actor)).map(order => ({ ...order, profitMargin: isAdmin ? order.profitMargin : undefined }))
  });
});

app.put('/api/subscription-billing', async (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator can change subscription pricing or payment details.' });
  const baseMonthly = billingAmount(req.body?.baseMonthly);
  const lateFee = billingAmount(req.body?.lateFee);
  const bundles = {};
  for (const capacity of billingBundleSizes) {
    const costPrice = billingAmount(req.body?.bundles?.[capacity]?.costPrice);
    const sellingPrice = billingAmount(req.body?.bundles?.[capacity]?.sellingPrice);
    if (costPrice === null || sellingPrice === null || sellingPrice < costPrice) return res.status(400).json({ message: `Set a valid selling price at or above the cost price for the ${capacity}-learner bundle.` });
    bundles[capacity] = { costPrice, sellingPrice };
  }
  if (baseMonthly === null || lateFee === null) return res.status(400).json({ message: 'Enter valid non-negative pricing amounts.' });
  const paymentMethod = req.body?.payment?.method === 'bank_transfer' ? 'bank_transfer' : 'payment_link';
  const rawPaymentLink = limitedText(req.body?.payment?.paymentLink || '', 2048);
  const accountName = limitedText(req.body?.payment?.accountName || '', 160);
  const bankName = limitedText(req.body?.payment?.bankName || '', 160);
  const accountNumber = limitedText(req.body?.payment?.accountNumber || '', 64);
  const branchCode = limitedText(req.body?.payment?.branchCode || '', 32);
  const referencePrefix = String(req.body?.payment?.referencePrefix || 'LF').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) || 'LF';
  if (rawPaymentLink === null || accountName === null || bankName === null || accountNumber === null || branchCode === null) {
    return res.status(400).json({ message: 'Payment configuration contains a field that is too long.' });
  }
  const paymentLink = rawPaymentLink ? safeHttpsUrl(rawPaymentLink) : '';
  if (paymentMethod === 'payment_link') {
    if (!paymentLink) return res.status(400).json({ message: 'Enter a valid HTTPS payment link without embedded credentials.' });
  } else if (!accountName || !bankName || !accountNumber) {
    return res.status(400).json({ message: 'Account name, bank name, and account number are required for bank transfers.' });
  }
  const billing = subscriptionBillingState(actor);
  const paymentInput = req.body?.payment || {};
  const hasPayMePayload = Object.prototype.hasOwnProperty.call(paymentInput, 'capitecPayMePayload');
  const capitecPayMePayload = String(paymentInput.capitecPayMePayload || '').trim();
  if (capitecPayMePayload && (!capitecPayMePayload.startsWith('000201') || !capitecPayMePayload.includes('za.co.capitec.electrum.payme') || capitecPayMePayload.length > 512)) {
    return res.status(400).json({ message: 'Enter a valid Capitec Pay Me QR payload.' });
  }
  const payMePayloadEncrypted = hasPayMePayload
    ? (capitecPayMePayload ? encryptField(capitecPayMePayload) : '')
    : String(billing.payment.payMePayloadEncrypted || '');
  billing.pricing = { baseMonthly, bundles, lateFeeEnabled: Boolean(req.body?.lateFeeEnabled), lateFee };
  billing.payment = { method: paymentMethod, paymentLink: paymentMethod === 'payment_link' ? paymentLink : '', accountName: paymentMethod === 'bank_transfer' ? accountName : '', bankName: paymentMethod === 'bank_transfer' ? bankName : '', accountNumberEncrypted: paymentMethod === 'bank_transfer' ? encryptField(accountNumber) : '', payMePayloadEncrypted, branchCode: paymentMethod === 'bank_transfer' ? branchCode : '', referencePrefix };
  billing.updatedAt = new Date().toISOString();
  db.subscriptionBilling = {
    ...billing,
    pricing: { ...billing.pricing, bundles: { ...billing.pricing.bundles } },
    payment: { ...billing.payment },
    orders: Array.isArray(db.subscriptionBilling?.orders) ? db.subscriptionBilling.orders : []
  };
  // Payment destinations must survive a restart. Commit this high-value setting
  // before acknowledging the request instead of relying only on the normal
  // post-response persistence queue.
  await saveDatabaseState();
  if (postgresPool) {
    const schoolBillingKey = `schoolBilling:${accountSchoolId(actor)}`;
    const persisted = await postgresPool.query(
      'SELECT state_key, payload FROM little_feet_metadata WHERE state_key = ANY($1::text[])',
      [[schoolBillingKey, 'subscriptionBilling']]
    );
    const destinationStored = persisted.rows.some(row => billingPaymentConfigured(row.payload?.payment || {}));
    if (!destinationStored) throw new Error('The payment destination could not be confirmed in persistent storage.');
  }
  writeReplicaSnapshot();
  req.persistenceCommitted = true;
  res.json({ success: true, pricing: publicBillingPricing(billing, true), paymentConfigured: true });
});

app.post('/api/subscription-billing/orders', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['principal', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only a principal, administrator, or school accounts user can create a school subscription payment request.' });
  const requestedPlanCode = String(req.body?.planCode || '').trim().toLowerCase();
  const requestedPlan = schoolSubscriptionPlans.find(plan => plan.code === requestedPlanCode);
  if (requestedPlanCode && !requestedPlan) return res.status(400).json({ message: 'Choose a valid school subscription plan.' });
  const requestedBundle = Number(req.body?.bundleCapacity || 0);
  if (!requestedPlan && ![0, ...billingBundleSizes].includes(requestedBundle)) return res.status(400).json({ message: 'Choose a valid extra-learner bundle.' });
  const billing = subscriptionBillingState(actor);
  if (!billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'The payment destination must be configured by an administrator first.' });
  const bundle = requestedBundle ? billing.pricing.bundles[requestedBundle] : { costPrice: 0, sellingPrice: 0 };
  if (!requestedPlan && billing.pricing.baseMonthly <= 0) return res.status(409).json({ message: 'Choose one of the published school plans.' });
  if (!requestedPlan && requestedBundle && bundle.sellingPrice <= 0) return res.status(409).json({ message: 'That learner bundle is not available yet. Ask an administrator to set its selling price.' });
  const reference = `${billing.payment.referencePrefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const monthlyTotal = requestedPlan ? requestedPlan.monthlyPrice : Math.round((billing.pricing.baseMonthly + bundle.sellingPrice) * 100) / 100;
  const order = {
    id: crypto.randomUUID(), reference, schoolId: accountSchoolId(actor), schoolName: actor.schoolName, requestedBy: actor.username,
    planCode: requestedPlan?.code || '', planName: requestedPlan?.name || '', learnerCapacity: requestedPlan?.maxLearners || 0,
    baseMonthly: requestedPlan ? requestedPlan.monthlyPrice : billing.pricing.baseMonthly, bundleCapacity: requestedPlan ? 0 : requestedBundle, bundlePrice: requestedPlan ? 0 : bundle.sellingPrice,
    monthlyTotal, lateFeeAccepted: Boolean(req.body?.lateFeeAccepted), lateFee: Boolean(req.body?.lateFeeAccepted) && billing.pricing.lateFeeEnabled ? billing.pricing.lateFee : 0,
    profitMargin: requestedPlan ? 0 : Math.round((bundle.sellingPrice - bundle.costPrice) * 100) / 100,
    status: 'awaiting_payment', paymentStatus: 'awaiting_payment', createdAt: new Date().toISOString()
  };
  billing.orders.unshift(order);
  res.status(201).json({ success: true, order: { ...order, profitMargin: undefined }, payment: paymentInstructions(billing, reference) });
});

const allowedParentPaymentRoles = new Set(['parent', 'principal', 'admin', 'school_accounts']);
const parentPaymentParentForSchool = (username, actor) => {
  const parent = findAccountByUsername(username);
  return parent && parent.role === 'parent' && isSameSchool(actor, parent) ? parent : null;
};
const createParentPaymentRecord = (body, actor) => {
  const parent = parentPaymentParentForSchool(body?.parentUsername, actor);
  if (!parent) return { error: 'Choose a parent account from this school.' };
  const amountDue = billingAmount(body?.amountDue);
  const dueDate = validDateKey(body?.dueDate);
  const arrangementDueDate = validDateKey(body?.arrangementDueDate);
  const hasArrangementAmount = body?.arrangementAmount !== '' && body?.arrangementAmount != null;
  const arrangementAmount = hasArrangementAmount ? billingAmount(body.arrangementAmount) : null;
  if (amountDue === null || amountDue <= 0 || !dueDate) return { error: 'Enter a positive amount and a valid due date.' };
  if (body?.arrangementDueDate && !arrangementDueDate) return { error: 'Enter a valid approved later date.' };
  if (arrangementDueDate && arrangementDueDate <= dueDate) return { error: 'The approved later date must be after the original due date.' };
  if (hasArrangementAmount && (arrangementAmount === null || arrangementAmount <= 0 || arrangementAmount > amountDue)) return { error: 'The approved arrangement amount must be positive and no more than the original amount.' };
  const description = String(body?.description || '').trim().slice(0, 240);
  if (!description) return { error: 'Add a short description for this parent payment.' };
  const billing = subscriptionBillingState(actor);
  if (!billingPaymentConfigured(billing.payment)) return { error: 'Configure the school payment destination before creating a parent payment.' };
  const reference = `${billing.payment.referencePrefix}-PARENT-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const record = tagSchoolRecord(actor, {
    id: crypto.randomUUID(), reference, parentUsername: parent.username, parentName: parent.name || parent.username,
    learnerName: String(body?.learnerName || '').trim().slice(0, 160), description, amountDue, dueDate,
    arrangementDueDate: arrangementDueDate || '', arrangementAmount, arrangementNote: String(body?.arrangementNote || '').trim().slice(0, 500), parentSignature: '', parentSignedAt: '',
    paymentStatus: 'awaiting_payment', createdAt: new Date().toISOString(), createdBy: actor.username
  });
  return { record };
};

registerFinanceAutomation(app, {
  db, getSessionAccount, accountSchoolId, isSameSchool, recordInSchool, tagSchoolRecord,
  findAccountByUsername, normalizeUsername, limitedText, billingAmount, cents, validDateKey,
  dateKeyInSouthAfrica, createParentPaymentRecord, parentPaymentFinancials, parentPaymentView,
  applyPaymentEvent, findPaymentTarget, expectedPaymentAmount, saveDatabaseState,
  scheduleReplicaSnapshot, persistenceReady, hasPlatformAccess
});

app.get('/api/parent-payments/parents', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['principal', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'School finance access is required.' });
  res.json(db.users.filter(account => account.role === 'parent' && isSameSchool(actor, account)).map(account => ({ username: account.username, name: account.name || account.username, linkedLearners: account.linkedLearners || [] })));
});

app.get('/api/parent-payments', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || allowedParentPaymentRoles.has(actor.role))) return res.status(403).json({ message: 'Parent payment access is required.' });
  let records = (db.parentPayments || []).filter(record => recordInSchool(record, actor));
  if (actor.role === 'parent') records = records.filter(record => normalizeUsername(record.parentUsername) === normalizeUsername(actor.username));
  const payments = records.map(record => parentPaymentView(record, actor));
  res.json({ payments, summary: parentPaymentSummary(records), ageing: parentPaymentAgeing(records), recalculatedAt: new Date().toISOString() });
});

app.post('/api/parent-payments', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['principal', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only a principal, administrator, or school accounts user can create parent payment requests.' });
  const result = createParentPaymentRecord(req.body, actor);
  if (result.error) return res.status(400).json({ message: result.error });
  if (!Array.isArray(db.parentPayments)) db.parentPayments = [];
  db.parentPayments.unshift(result.record);
  const schoolRecords = db.parentPayments.filter(record => recordInSchool(record, actor));
  res.status(201).json({ success: true, payment: parentPaymentView(result.record, actor), summary: parentPaymentSummary(schoolRecords), ageing: parentPaymentAgeing(schoolRecords) });
});

app.post('/api/parent-payments/:id/acknowledge', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || actor.role !== 'parent') return res.status(403).json({ message: 'Only the parent account can confirm this payment request.' });
  const record = (db.parentPayments || []).find(entry => entry.id === req.params.id && recordInSchool(entry, actor) && normalizeUsername(entry.parentUsername) === normalizeUsername(actor.username));
  const signature = String(req.body?.signature || '').trim().slice(0, 160);
  if (!record || !signature) return res.status(400).json({ message: 'A parent signature is required.' });
  record.parentSignature = signature; record.parentSignedAt = new Date().toISOString();
  res.json({ success: true, payment: parentPaymentView(record, actor) });
});

app.get('/api/parent-subscription', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['parent', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Parent subscription access is required.' });
  const records = (db.parentSubscriptions || []).filter(record => recordInSchool(record, actor) && (isAdminLike(actor) || normalizeUsername(record.parentUsername) === normalizeUsername(actor.username)));
  res.json({ active: isAdminLike(actor) ? undefined : parentSubscriptionActive(actor), pricePerChild: 29, latest: records[0] ? { reference: records[0].reference, status: records[0].paymentStatus, amount: records[0].amount, createdAt: records[0].createdAt } : null, parents: isAdminLike(actor) ? db.users.filter(account => account.role === 'parent' && isSameSchool(actor, account)).map(account => ({ username: account.username, name: account.name, active: parentSubscriptionActive(account), status: account.parentSubscriptionStatus || 'basic', grantedUntil: account.parentSubscriptionGrantedUntil || '' })) : undefined, paymentConfigured: billingPaymentConfigured(subscriptionBillingState(actor).payment) });
});

app.post('/api/parent-subscription/orders', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || actor.role !== 'parent') return res.status(403).json({ message: 'Only a parent can start a parent subscription.' });
  const billing = subscriptionBillingState(actor);
  if (!billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'The school payment destination is not configured yet.' });
  const children = Math.max(1, Math.min(4, (actor.linkedLearners || []).length));
  const amount = children * 29;
  const reference = `${billing.payment.referencePrefix}-PLUS-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const order = tagSchoolRecord(actor, { id: crypto.randomUUID(), reference, parentUsername: actor.username, parentName: actor.name || actor.username, children, amount, paymentStatus: 'awaiting_payment', termDays: 30, createdAt: new Date().toISOString() });
  if (!Array.isArray(db.parentSubscriptions)) db.parentSubscriptions = [];
  db.parentSubscriptions.unshift(order);
  res.status(201).json({ success: true, order, payment: paymentInstructions(billing, reference) });
});

app.patch('/api/accounts/:username/parent-subscription', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator can grant parent subscription access.' });
  const parent = findAccountByUsername(req.params.username);
  if (!parent || parent.role !== 'parent' || !isSameSchool(actor, parent)) return res.status(404).json({ message: 'Parent account not found.' });
  const status = String(req.body?.status || '').toLowerCase() === 'paid' ? 'paid' : 'basic';
  const grantedUntil = validDateKey(req.body?.grantedUntil);
  if (req.body?.grantedUntil && !grantedUntil) return res.status(400).json({ message: 'Enter a valid access end date.' });
  parent.parentSubscriptionStatus = status;
  parent.parentSubscriptionGrantedUntil = status === 'paid' ? grantedUntil : '';
  parent.parentSubscriptionUpdatedAt = new Date().toISOString();
  parent.parentSubscriptionUpdatedBy = actor.username;
  parent.subscription = parentSubscriptionActive(parent) ? 'plus' : 'basic';
  res.json({ success: true, account: safeAccount(parent) });
});

const bookRecordVisibleTo = (record, actor) => {
  if (!recordInSchool(record, actor)) return false;
  if (actor.role !== 'parent') return true;
  return normalizeUsername(record.parentUsername) === normalizeUsername(actor.username);
};
const bookRecordView = record => ({
  id: record.id, bookTitle: record.bookTitle, bookCode: record.bookCode, bookPrice: billingAmount(record.bookPrice) || 0, learnerName: record.learnerName,
  className: record.className, parentUsername: record.parentUsername, parentName: record.parentName, issueCondition: record.issueCondition,
  issuedAt: record.issuedAt, adminSignature: record.adminSignature, adminSignedAt: record.adminSignedAt,
  parentSignature: record.parentSignature, parentSignedAt: record.parentSignedAt, returnCondition: record.returnCondition,
  returnedAt: record.returnedAt, returnAdminSignature: record.returnAdminSignature, returnAdminSignedAt: record.returnAdminSignedAt,
  returnParentSignature: record.returnParentSignature, returnParentSignedAt: record.returnParentSignedAt, returnStatus: record.returnStatus || '', penaltyAmount: billingAmount(record.penaltyAmount) || 0, status: record.status,
  notes: record.notes, createdAt: record.createdAt
});
const bookRecordsForSchool = actor => (db.bookRegister || []).filter(record => bookRecordVisibleTo(record, actor));

app.get('/api/book-register', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Book register access is required.' });
  const className = normalizeComparableText(req.query.className);
  let records = bookRecordsForSchool(actor);
  if (className) records = records.filter(record => normalizeComparableText(record.className) === className);
  res.json({ records: records.map(bookRecordView), summary: { total: records.length, returned: records.filter(record => record.status === 'returned').length, outstanding: records.filter(record => record.status !== 'returned').length, unsignedParents: records.filter(record => !record.parentSignature).length, penalties: cents(records.reduce((sum, record) => sum + (billingAmount(record.penaltyAmount) || 0), 0)) }, generatedAt: new Date().toISOString() });
});

app.get('/api/book-register/parents', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'School book-register management is required.' });
  res.json(db.users.filter(account => account.role === 'parent' && isSameSchool(actor, account)).map(account => ({ username: account.username, name: account.name || account.username, linkedLearners: account.linkedLearners || [] })));
});

app.post('/api/book-register', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can issue books.' });
  const parent = parentPaymentParentForSchool(req.body?.parentUsername, actor);
  const bookTitle = String(req.body?.bookTitle || '').trim().slice(0, 200);
  const learnerName = String(req.body?.learnerName || '').trim().slice(0, 160);
  const issueCondition = String(req.body?.issueCondition || '').trim().slice(0, 500);
  if (!parent || !bookTitle || !learnerName || !issueCondition) return res.status(400).json({ message: 'Choose a parent and enter the book, learner, and condition before handover.' });
  const bookPrice = billingAmount(req.body?.bookPrice);
  if (bookPrice === null || bookPrice < 0) return res.status(400).json({ message: 'Enter a valid replacement price for the book.' });
  const record = tagSchoolRecord(actor, {
    id: crypto.randomUUID(), bookTitle, bookCode: String(req.body?.bookCode || '').trim().slice(0, 80), bookPrice, learnerName,
    className: String(req.body?.className || '').trim().slice(0, 120), parentUsername: parent.username, parentName: parent.name || parent.username,
    issueCondition, issuedAt: String(req.body?.issuedAt || '').trim() || new Date().toISOString(), adminSignature: String(req.body?.adminSignature || actor.name || actor.username).trim().slice(0, 160),
    adminSignedAt: new Date().toISOString(), parentSignature: '', parentSignedAt: '', returnCondition: '', returnedAt: '',
    returnAdminSignature: '', returnAdminSignedAt: '', returnParentSignature: '', returnParentSignedAt: '', returnStatus: '', penaltyAmount: 0, status: 'awaiting_parent_signature',
    notes: String(req.body?.notes || '').trim().slice(0, 500), createdAt: new Date().toISOString()
  });
  if (!Array.isArray(db.bookRegister)) db.bookRegister = [];
  db.bookRegister.unshift(record);
  res.status(201).json({ success: true, record: bookRecordView(record) });
});

app.post('/api/book-register/import', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Only a principal or administrator can import the book register.' });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ message: 'Add at least one checklist row to import.' });
  if (rows.length > 2000) return res.status(400).json({ message: 'Import up to 2,000 book-register records per file.' });
  const imported = [], rejected = [];
  rows.forEach((row, index) => {
    const result = createBookRecordFromImport(row, actor);
    if (result.error) rejected.push({ row: index + 2, error: result.error });
    else { db.bookRegister.unshift(result.record); imported.push(bookRecordView(result.record)); }
  });
  res.status(imported.length ? 201 : 400).json({ success: Boolean(imported.length), imported: imported.length, rejected, records: imported });
});

function createBookRecordFromImport(row, actor) {
  const body = {
    bookTitle: row.bookTitle ?? row['Book Title'], bookCode: row.bookCode ?? row['Book Code'], learnerName: row.learnerName ?? row['Learner Name'],
    className: row.className ?? row.Class ?? row['Class Name'], parentUsername: row.parentUsername ?? row['Parent Username'],
    issueCondition: row.issueCondition ?? row['Condition at handover'] ?? row['Condition at Handover'], bookPrice: row.bookPrice ?? row['Book replacement price'] ?? row['Replacement Price'], notes: row.notes ?? row.Notes,
    adminSignature: row.adminSignature ?? row['Admin signature']
  };
  const parent = parentPaymentParentForSchool(body.parentUsername, actor);
  const bookPrice = billingAmount(body.bookPrice);
  const bookTitle = String(body.bookTitle || '').trim().slice(0, 200), learnerName = String(body.learnerName || '').trim().slice(0, 160), issueCondition = String(body.issueCondition || '').trim().slice(0, 500);
  if (!parent || !bookTitle || !learnerName || !issueCondition || bookPrice === null || bookPrice < 0) return { error: 'Parent username, book title, learner name, handover condition, and a valid replacement price are required.' };
  return { record: tagSchoolRecord(actor, {
    id: crypto.randomUUID(), bookTitle, bookCode: String(body.bookCode || '').trim().slice(0, 80), bookPrice, learnerName, className: String(body.className || '').trim().slice(0, 120),
    parentUsername: parent.username, parentName: parent.name || parent.username, issueCondition, issuedAt: new Date().toISOString(),
    adminSignature: String(body.adminSignature || actor.name || actor.username).trim().slice(0, 160), adminSignedAt: new Date().toISOString(),
    parentSignature: '', parentSignedAt: '', returnCondition: '', returnedAt: '', returnAdminSignature: '', returnAdminSignedAt: '', returnParentSignature: '', returnParentSignedAt: '', returnStatus: '', penaltyAmount: 0, status: 'awaiting_parent_signature', notes: String(body.notes || '').trim().slice(0, 500), createdAt: new Date().toISOString()
  }) };
}

app.post('/api/book-register/:id/sign', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || actor.role !== 'parent') return res.status(403).json({ message: 'Only the linked parent can sign this handover or return.' });
  const record = (db.bookRegister || []).find(entry => entry.id === req.params.id && recordInSchool(entry, actor) && normalizeUsername(entry.parentUsername) === normalizeUsername(actor.username));
  const signature = String(req.body?.signature || '').trim().slice(0, 160);
  const action = String(req.body?.action || 'received').trim().toLowerCase();
  if (!record || !signature) return res.status(400).json({ message: 'A parent signature is required.' });
  if (action === 'returned') {
    if (record.status !== 'returned') return res.status(409).json({ message: 'The school must record the returned book condition before the parent can sign the return.' });
    record.returnParentSignature = signature; record.returnParentSignedAt = new Date().toISOString();
  } else {
    record.parentSignature = signature; record.parentSignedAt = new Date().toISOString(); record.status = 'issued';
  }
  res.json({ success: true, record: bookRecordView(record) });
});

app.put('/api/book-register/:id/return', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can record returned books.' });
  const record = (db.bookRegister || []).find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  const returnCondition = String(req.body?.returnCondition || '').trim().slice(0, 500);
  const returnStatus = ['returned_good', 'damaged', 'lost'].includes(String(req.body?.returnStatus || '')) ? String(req.body.returnStatus) : '';
  const signature = String(req.body?.returnAdminSignature || actor.name || actor.username).trim().slice(0, 160);
  if (!record || !returnCondition || !returnStatus) return res.status(400).json({ message: 'Record the condition and choose returned, damaged, or lost.' });
  record.returnCondition = returnCondition; record.returnStatus = returnStatus; record.penaltyAmount = ['damaged', 'lost'].includes(returnStatus) ? (billingAmount(record.bookPrice) || 0) : 0; record.returnedAt = new Date().toISOString(); record.returnAdminSignature = signature; record.returnAdminSignedAt = new Date().toISOString(); record.status = 'returned';
  res.json({ success: true, record: bookRecordView(record) });
});

// Free bank-transfer reconciliation is available to school administrators. The
// same ledger can accept a gateway later through the signed, provider-neutral
// webhook without changing the finance screens or historical records.
app.get('/api/payments/ledger', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'School finance access is required.' });
  res.json((db.paymentLedger || []).filter(entry => entry.schoolId === accountSchoolId(actor)));
});

app.post('/api/payments/reconcile', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['principal', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only a principal, administrator, or school accounts user can reconcile a school payment.' });
  const eventId = String(req.body?.eventId || '').trim().slice(0, 160);
  if (!eventId) return res.status(400).json({ message: 'A unique reconciliation event ID is required.' });
  const result = applyPaymentEvent({
    eventId: `manual:${accountSchoolId(actor)}:${eventId}`,
    reference: req.body?.reference,
    status: req.body?.status,
    amount: req.body?.amount,
    providerTransactionId: req.body?.bankReference,
    source: 'manual-bank-reconciliation',
    receivedAt: new Date().toISOString()
  }, actor);
  if (result.error) return res.status(400).json({ message: result.error });
  res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, event: result.event });
});

app.post('/api/payments/webhook', (req, res) => {
  const secret = String(process.env.LF_PAYMENT_WEBHOOK_SECRET || '');
  if (!secret) return res.status(503).json({ message: 'Payment webhook processing is not configured.' });
  const supplied = String(req.get('x-little-feet-signature') || '').trim().toLowerCase().replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/.test(supplied)) return res.status(401).json({ message: 'Invalid payment webhook signature.' });
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from('')).digest('hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return res.status(401).json({ message: 'Invalid payment webhook signature.' });
  }
  const eventId = String(req.body?.eventId || '').trim().slice(0, 160);
  if (!eventId) return res.status(400).json({ message: 'A provider event ID is required.' });
  const result = applyPaymentEvent({
    eventId: `webhook:${eventId}`,
    reference: req.body?.reference,
    status: req.body?.status,
    amount: req.body?.amount,
    providerTransactionId: req.body?.transactionId,
    source: String(req.body?.provider || 'payment-webhook').trim().slice(0, 80),
    receivedAt: String(req.body?.occurredAt || '').trim() || new Date().toISOString()
  });
  if (result.error) return res.status(400).json({ message: result.error });
  res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate });
});

app.get('/api/donations/payment', (req, res) => {
  const billing = donationBillingState();
  res.json({ configured: billingPaymentConfigured(billing.payment), method: billing.payment.method });
});

app.post('/api/donations/intents', (req, res) => {
  const amount = billingAmount(req.body?.amount);
  if (amount === null || amount <= 0) return res.status(400).json({ message: 'Enter a donation amount greater than zero.' });
  const billing = donationBillingState();
  if (!billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'Donations are not available until an administrator configures the payment destination.' });
  const donorName = String(req.body?.donorName || '').trim().slice(0, 120);
  const donorEmail = String(req.body?.donorEmail || '').trim().slice(0, 160);
  const reference = `${billing.payment.referencePrefix}-DONATE-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const donation = { id: crypto.randomUUID(), reference, amount, donorName, donorEmail, status: 'awaiting payment', createdAt: new Date().toISOString() };
  if (!Array.isArray(db.donations)) db.donations = [];
  db.donations.unshift(donation);
  res.status(201).json({ success: true, donation, payment: paymentInstructions(billing, reference) });
});

app.get('/api/accounts', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const visibleAccounts = hasPlatformAccess(actor)
    ? db.users
    : db.users.filter(account => !PLATFORM_INTERNAL_ROLES.has(account.role) && isSameSchool(actor, account));
  res.json(visibleAccounts.map(safeAccount));
});

const resolveManagedAccountScope = (actor, role, requestedSchoolName) => {
  const internalRole = PLATFORM_INTERNAL_ROLES.has(role);
  const cleanSchoolName = boundedText(requestedSchoolName, 160);
  if (internalRole && !hasPlatformAccess(actor)) {
    return { error: 'Only Little Feet platform staff can create or assign company-level roles.' };
  }
  if (internalRole && !cleanSchoolName) return { schoolId: '', schoolName: '' };
  const effectiveSchoolName = cleanSchoolName || boundedText(actor.schoolName, 160);
  if (!effectiveSchoolName) return { error: 'Choose a linked school for school-facing accounts.' };
  if (!hasPlatformAccess(actor) && schoolKey(effectiveSchoolName) !== schoolKey(actor.schoolName)) {
    return { error: 'Administrators can manage accounts only for their own school.' };
  }
  const school = ensureSchool(effectiveSchoolName);
  return { schoolId: school.id, schoolName: school.name };
};

const canManageAccount = (actor, target) => Boolean(actor && target && (hasPlatformAccess(actor) || (!PLATFORM_INTERNAL_ROLES.has(target.role) && isSameSchool(actor, target))));

app.post('/api/accounts', (req, res) => {
  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses } = req.body;
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const cleanUsername = boundedText(username, 160);
  const cleanName = boundedText(name, 160);
  if (!cleanUsername || !pin || !cleanName || !ACCOUNT_ROLES.has(role)) return res.status(400).json({ message: 'Name, username, password, and a supported role are required.' });
  if (String(pin).length < 4 || String(pin).length > 128) return res.status(400).json({ message: 'Passwords must be between 4 and 128 characters.' });
  if (db.users.some(account => accountMatchesUsername(account, cleanUsername))) return res.status(409).json({ message: 'That username is already in use.' });

  const scope = resolveManagedAccountScope(actor, role, schoolName);
  if (scope.error) return res.status(403).json({ message: scope.error });
  const linkValidation = role === 'parent' ? validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const normalisedStoreUrl = safeHttpsUrl(schoolStoreUrl);
  if (String(schoolStoreUrl || '').trim() && !normalisedStoreUrl) return res.status(400).json({ message: 'School web-store links must use a valid HTTPS URL.' });

  const account = {
    username: cleanUsername,
    pinHash: hashPin(pin),
    name: cleanName,
    role,
    schoolName: scope.schoolName,
    schoolId: scope.schoolId,
    schoolStoreUrl: normalisedStoreUrl,
    linkedLearners: linkValidation.links,
    parentRelationshipStatus: role === 'parent' ? 'Administrator approved' : undefined,
    verificationStatus: 'Active',
    assignedClasses: role === 'teacher' ? normaliseAssignedClasses(assignedClasses).slice(0, 30) : [],
    platformAccess: FULL_PLATFORM_ROLES.has(role)
  };
  db.users.push(account);
  res.status(201).json({ success: true, account: safeAccount(account) });
});

app.put('/api/accounts/:username', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = findAccountByUsername(req.params.username);
  if (!canManageAccount(actor, account)) return res.status(404).json({ message: 'Account not found.' });

  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses } = req.body;
  const cleanUpdatedUsername = username === undefined ? '' : limitedText(username, 160);
  const cleanUpdatedName = name === undefined ? '' : limitedText(name, 160);
  const nextRole = role || account.role;
  if (username !== undefined && !cleanUpdatedUsername) return res.status(400).json({ message: 'Usernames must be between 1 and 160 characters.' });
  if (name !== undefined && !cleanUpdatedName) return res.status(400).json({ message: 'Names must be between 1 and 160 characters.' });
  if (role !== undefined && !ACCOUNT_ROLES.has(role)) return res.status(400).json({ message: 'Choose a supported account role.' });
  if (cleanUpdatedUsername && db.users.some(entry => entry !== account && accountMatchesUsername(entry, cleanUpdatedUsername))) return res.status(409).json({ message: 'That username is already in use.' });

  if (isConfiguredPlatformOwner(account) && nextRole !== 'admin') {
    return res.status(400).json({ message: 'The configured Little Feet owner account must remain an administrator.' });
  }
  if (account.role === 'admin' && nextRole !== 'admin' && !isConfiguredPlatformOwner(account)) {
    const schoolId = accountSchoolId(account);
    const remainingAdmins = db.users.filter(entry => entry !== account && entry.role === 'admin' && accountSchoolId(entry) === schoolId);
    if (schoolId && remainingAdmins.length < 1) return res.status(400).json({ message: 'Create another administrator before changing the final administrator account to another role.' });
  }

  const scope = resolveManagedAccountScope(actor, nextRole, schoolName === undefined ? account.schoolName : schoolName);
  if (scope.error) return res.status(403).json({ message: scope.error });

  if (cleanUpdatedUsername) account.username = cleanUpdatedUsername;
  if (pin) {
    if (String(pin).length < 4 || String(pin).length > 128) return res.status(400).json({ message: 'Passwords must be between 4 and 128 characters.' });
    account.pinHash = hashPin(pin);
  }
  if (cleanUpdatedName) account.name = cleanUpdatedName;
  account.role = nextRole;
  account.schoolName = scope.schoolName;
  account.schoolId = scope.schoolId;
  account.platformAccess = FULL_PLATFORM_ROLES.has(nextRole) || isConfiguredPlatformOwner(account);

  const normalisedStoreUrl = safeHttpsUrl(schoolStoreUrl);
  if (String(schoolStoreUrl || '').trim() && !normalisedStoreUrl) return res.status(400).json({ message: 'School web-store links must use a valid HTTPS URL.' });
  account.schoolStoreUrl = normalisedStoreUrl;

  const linkValidation = account.role === 'parent' ? validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  account.linkedLearners = linkValidation.links;
  if (account.role === 'parent') {
    account.parentRelationshipStatus = linkValidation.links.length ? 'Administrator approved' : 'Pending administrator approval';
    account.requestedLearnerLinks = [];
  } else {
    delete account.parentRelationshipStatus;
    delete account.requestedLearnerLinks;
  }
  account.assignedClasses = account.role === 'teacher' ? normaliseAssignedClasses(assignedClasses).slice(0, 30) : [];
  res.json({ success: true, account: safeAccount(account) });
});

app.delete('/api/accounts/:username', async (req, res, next) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const target = findAccountByUsername(req.params.username);
  if (!canManageAccount(actor, target)) return res.status(404).json({ message: 'Account not found.' });
  if (isConfiguredPlatformOwner(target)) return res.status(400).json({ message: 'The configured Little Feet owner account cannot be deleted.' });
  if (target.role === 'admin') {
    const schoolId = accountSchoolId(target);
    const remainingAdmins = db.users.filter(account => account !== target && account.role === 'admin' && accountSchoolId(account) === schoolId);
    if (schoolId && remainingAdmins.length < 1) return res.status(400).json({ message: 'Create another administrator before removing the final administrator account.' });
  }
  try {
    const targetSchoolId = accountSchoolId(target);
    const staffFiles = (db.fileRecords || []).filter(file => file.schoolId === targetSchoolId
      && file.entityType === 'staff' && normalizeUsername(file.recordId) === normalizeUsername(target.username)
      && file.accessState !== 'deleted');
    const cleanupJob = queueStorageCleanup(targetSchoolId || 'platform', staffFiles, 'staff-account-deletion');
    if (cleanupJob) await saveDatabaseState();
    db.users = db.users.filter(account => account !== target);
    staffFiles.forEach(file => { file.accessState = 'deleted'; file.deletedAt = new Date().toISOString(); file.deletedBy = actor.username; });
    await saveDatabaseState();
    if (cleanupJob) {
      const cleaned = await runStorageCleanupJob(cleanupJob);
      await saveDatabaseState();
      if (!cleaned) return res.status(503).json({ message: 'The account was deleted, but its private-file cleanup requires an automatic retry.', cleanupJobId: cleanupJob.id });
    }
    req.persistenceCommitted = true;
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.post('/api/accounts/:username/reset-login-lockout', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = findAccountByUsername(req.params.username);
  if (!canManageAccount(actor, account)) return res.status(404).json({ message: 'Account not found.' });
  const clearedBuckets = clearLoginLockoutForAccount(account);
  res.json({
    success: true,
    clearedBuckets,
    account: safeAccount(account),
    message: 'The 10-minute sign-in wait has been cleared. The account can try the correct password again now.'
  });
});

app.post('/api/accounts/:username/approve', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = findAccountByUsername(req.params.username);
  if (!canManageAccount(actor, account)) return res.status(404).json({ message: 'Account not found.' });
  account.verificationStatus = 'Active';
  if (account.role === 'parent' && !account.linkedLearners?.length) account.parentRelationshipStatus = 'Pending administrator approval';
  account.approvedAt = new Date().toISOString();
  scheduleReplicaSnapshot();
  res.json({ success: true, account: safeAccount(account) });
});

// Search schools by name for Account Management. Known Little Feet schools are
// returned first; public South African school names are then filled from OpenStreetMap.
app.get('/api/schools/search', async (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });

  const query = boundedText(req.query.q, 120).trim();
  if (query.length < 2) return res.json({ results: [], liveSearchAvailable: true });

  const queryKey = schoolKey(query);
  const visibleLocalSchools = new Map();
  const addLocalSchool = (name, id = '') => {
    const cleanName = boundedText(name, 160).trim();
    if (!cleanName || !schoolKey(cleanName).includes(queryKey)) return;
    if (!hasPlatformAccess(actor) && schoolKey(cleanName) !== schoolKey(actor.schoolName)) return;
    const key = schoolKey(cleanName);
    if (!visibleLocalSchools.has(key)) {
      visibleLocalSchools.set(key, { name: cleanName, schoolId: id || '', locality: 'Saved in Little Feet', source: 'Little Feet' });
    }
  };
  (db.schools || []).forEach(school => addLocalSchool(school.name, school.id));
  (db.users || []).forEach(account => addLocalSchool(account.schoolName, account.schoolId));

  const localResults = [...visibleLocalSchools.values()].slice(0, 8);
  const cacheKey = `school-name:${queryKey}`;
  const cached = readSchoolSearchCache(cacheKey);
  let publicResults = cached?.data?.results || [];
  let liveSearchAvailable = true;

  if (!cached) {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.search = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        countrycodes: 'za',
        limit: '10',
        dedupe: '1',
        q: `${query} school`
      }).toString();
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'LittleFeetSchoolFinder/1.0' },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
      const places = await response.json();
      if (!Array.isArray(places)) throw new Error('Nominatim returned an invalid school-name result.');
      publicResults = places.map(place => {
        const name = boundedText(place.name || String(place.display_name || '').split(',')[0], 160).trim();
        const locality = boundedText(
          place.address?.suburb || place.address?.neighbourhood || place.address?.city ||
          place.address?.town || place.address?.village || place.address?.municipality || '',
          160
        ).trim();
        return { name, schoolId: '', locality, source: 'OpenStreetMap' };
      }).filter(result => result.name);
      writeSchoolSearchCache(cacheKey, { results: publicResults });
    } catch (error) {
      liveSearchAvailable = false;
      logStructured('warn', 'school_search.fallback_unavailable', { category: 'integration', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    }
  }

  const merged = [];
  const seen = new Set();
  for (const result of [...localResults, ...publicResults]) {
    const key = schoolKey(result.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
    if (merged.length >= 12) break;
  }
  res.json({ results: merged, liveSearchAvailable });
});

// Live nearby-school search. Results are sourced from OpenStreetMap via Overpass.
app.get('/api/nearby-schools', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=1800');
  const latitude = Number.parseFloat(req.query.lat);
  const longitude = Number.parseFloat(req.query.lng);
  const radius = Math.min(Math.max(Number.parseInt(req.query.radius, 10) || 20000, 1000), 20000);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ message: 'A valid latitude and longitude are required.' });
  }

  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)},${radius}`;
  const cached = readSchoolSearchCache(cacheKey);
  if (cached) return res.json({ ...cached.data, cached: true });

  // A bounding-box lookup is significantly faster than searching every school building by radius.
  // The browser applies the exact circular 20 km check before rendering markers.
  const latitudeOffset = radius / 111320;
  const longitudeOffset = radius / (111320 * Math.cos(latitude * Math.PI / 180));
  const south = (latitude - latitudeOffset).toFixed(6);
  const west = (longitude - longitudeOffset).toFixed(6);
  const north = (latitude + latitudeOffset).toFixed(6);
  const east = (longitude + longitudeOffset).toFixed(6);
  const query = `[out:json][timeout:30];nwr[\"amenity\"~\"^(school|kindergarten|childcare|college|university)$\"][\"name\"](${south},${west},${north},${east});out center qt;`;

  try {
    const overpassServices = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass.nchc.org.tw/api/interpreter'
    ];
    // Public providers vary in availability. Use the first successful response
    // rather than making the user wait for a slow service to time out.
    const payload = await Promise.any(overpassServices.map(async serviceUrl => {
      const candidate = await fetch(serviceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'LittleFeetSchoolFinder/1.0' },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(25000)
      });
      if (!candidate.ok) throw new Error(`${new URL(serviceUrl).host} returned ${candidate.status}`);
      const result = await candidate.json();
      if (!Array.isArray(result.elements)) throw new Error(`${new URL(serviceUrl).host} returned an invalid map result`);
      return result;
    }));

    const data = { elements: Array.isArray(payload.elements) ? payload.elements : [], source: 'OpenStreetMap' };
    writeSchoolSearchCache(cacheKey, data);
    res.json(data);
  } catch (error) {
    // If the shared Overpass network is busy, use Nominatim's independent
    // OpenStreetMap search as a fallback. The result is cached above for 30
    // minutes, so repeated map opens do not repeatedly send location lookups.
    try {
      const fallbackUrl = new URL('https://nominatim.openstreetmap.org/search');
      fallbackUrl.search = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        limit: '100',
        bounded: '1',
        viewbox: `${west},${north},${east},${south}`,
        q: 'school'
      }).toString();
      const fallbackResponse = await fetch(fallbackUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'LittleFeetSchoolFinder/1.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (!fallbackResponse.ok) throw new Error(`Nominatim returned ${fallbackResponse.status}`);
      const places = await fallbackResponse.json();
      if (!Array.isArray(places)) throw new Error('Nominatim returned an invalid map result');
      const data = {
        elements: places.map((place, index) => ({
          type: 'node',
          id: `nominatim-${index}`,
          lat: Number(place.lat),
          lon: Number(place.lon),
          tags: {
            name: place.name || String(place.display_name || '').split(',')[0] || 'Nearby school',
            amenity: 'school',
            'addr:street': place.address?.road || '',
            'addr:suburb': place.address?.suburb || place.address?.neighbourhood || '',
            'addr:city': place.address?.city || place.address?.town || place.address?.village || ''
          }
        })).filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lon)),
        source: 'OpenStreetMap fallback'
      };
      if (!data.elements.length) throw new Error('No nearby schools were returned by the fallback');
      writeSchoolSearchCache(cacheKey, data);
      res.json(data);
    } catch (fallbackError) {
      logStructured('error', 'school_search.nearby_failed', { category: 'integration', requestId: req.requestId, method: req.method, route: req.path, message: error.message, details: `Fallback: ${fallbackError.message}` });
      res.status(502).json({ message: 'Live school data is temporarily unavailable. Please try again shortly.' });
    }
  }
});

// Optional, verified public-place enrichment. This is deliberately server-side so
// the API key is never sent to a browser. It does not use an AI model to invent data.
app.post('/api/schools/enrich', async (req, res) => {
  const { name, latitude, longitude } = req.body || {};
  if (!name || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return res.status(400).json({ message: 'A school name and valid map coordinates are required.' });
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(424).json({ message: 'Verified Google Places enrichment is not configured for this school. Public fields remain sourced from OpenStreetMap.' });
  }
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.location'
      },
      body: JSON.stringify({
        textQuery: `${String(name).trim()} school`,
        locationBias: { circle: { center: { latitude: Number(latitude), longitude: Number(longitude) }, radius: 3000 } },
        maxResultCount: 1
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Google Places returned ${response.status}.`);
    const place = (await response.json()).places?.[0];
    if (!place) return res.status(404).json({ message: 'No verified public listing was found for this school.' });
    const expectedName = normalizeComparableText(name);
    const returnedName = normalizeComparableText(place.displayName?.text);
    if (!returnedName || (!returnedName.includes(expectedName) && !expectedName.includes(returnedName))) {
      return res.status(409).json({ message: 'The public listing did not clearly match this school, so no details were applied.' });
    }
    res.json({
      source: 'Google Places',
      name: place.displayName?.text || String(name),
      address: place.formattedAddress || '',
      phone: place.internationalPhoneNumber || place.nationalPhoneNumber || '',
      website: place.websiteUri || '',
      mapsUrl: place.googleMapsUri || ''
    });
  } catch (error) {
    logStructured('error', 'school_search.enrichment_failed', { category: 'integration', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.status(502).json({ message: 'Verified public-school lookup is temporarily unavailable. Please try again later.' });
  }
});

// Academic Term
app.get('/api/term', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view the academic term.' });
  res.json({ term: db.schoolTerms?.[accountSchoolId(actor)] || db.term });
});
app.post('/api/term', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const { term } = req.body;
  if (!db.schoolTerms || typeof db.schoolTerms !== 'object') db.schoolTerms = {};
  if (term) db.schoolTerms[accountSchoolId(actor)] = String(term).slice(0, 200);
  res.json({ term: db.schoolTerms[accountSchoolId(actor)] || db.term });
});

const FILE_ENTITY_TYPES = new Set(['learner', 'staff', 'school', 'post', 'worksheet']);
const fileContentPath = file => `/api/files/${encodeURIComponent(file.id)}/content`;
const publicFileMetadata = file => ({
  id: file.id, entityType: file.entityType, recordId: file.recordId, purpose: file.purpose,
  originalFilename: file.originalFilename, contentType: file.contentType, size: file.size,
  sha256: file.sha256, uploadedBy: file.uploadedBy, createdAt: file.createdAt,
  updatedAt: file.updatedAt || file.createdAt, accessState: file.accessState,
  contentUrl: file.accessState === 'active' ? fileContentPath(file) : null
});
const relatedRecordForFile = (file, actor) => {
  if (!recordInSchool(file, actor)) return null;
  if (file.entityType === 'learner') return db.students.find(item => item.id === file.recordId && recordInSchool(item, actor));
  if (file.entityType === 'staff') return db.users.find(item => normalizeUsername(item.username) === normalizeUsername(file.recordId) && isSameSchool(item, actor));
  if (file.entityType === 'school') return db.schools.find(item => item.id === file.recordId && item.id === accountSchoolId(actor));
  if (file.entityType === 'post') return db.posts.find(item => item.id === file.recordId && recordInSchool(item, actor));
  if (file.entityType === 'worksheet') return learnerRecordsVisibleTo(db.worksheets, actor).find(item => item.id === file.recordId);
  return null;
};
const canManageFile = (file, actor) => Boolean(actor && recordInSchool(file, actor)
  && ((hasPlatformAccess(actor) || ['admin', 'principal', 'staff'].includes(actor.role)) || normalizeUsername(file.uploadedBy) === normalizeUsername(actor.username)));
const createStoredFile = async (actor, { entityType, recordId, purpose, originalFilename, dataUrl }) => {
  if (!objectStorage.configured) {
    const error = new Error('Private file storage is not configured. Ask an administrator to configure Cloudflare R2.');
    error.status = 503;
    throw error;
  }
  if (!FILE_ENTITY_TYPES.has(entityType)) {
    const error = new Error('Choose a supported file relationship.'); error.status = 400; throw error;
  }
  const decoded = decodeSupportedFileDataUrl(dataUrl, originalFilename);
  if (!decoded) {
    const error = new Error('Unsupported or invalid file. Allowed: PNG, JPEG, GIF, WebP, PDF up to 5 MB; TXT or CSV up to 2 MB.');
    error.status = 400;
    throw error;
  }
  const id = crypto.randomUUID();
  const key = objectKeyFor({ schoolId: accountSchoolId(actor), entityType, recordId, extension: decoded.extension });
  const sha256 = crypto.createHash('sha256').update(decoded.bytes).digest('hex');
  const result = await objectStorage.put({
    key, body: decoded.bytes, contentType: decoded.mimeType,
    metadata: { fileid: id, tenant: crypto.createHash('sha256').update(accountSchoolId(actor)).digest('hex') }
  });
  const record = tagSchoolRecord(actor, {
    id, entityType, recordId: boundedText(recordId, 180), purpose: boundedText(purpose || 'attachment', 80),
    storageProvider: objectStorage.kind, objectKey: key, originalFilename: decoded.filename,
    contentType: decoded.mimeType, size: decoded.bytes.length, sha256, etag: boundedText(result.etag, 180),
    uploadedBy: actor.username, createdAt: new Date().toISOString(), accessState: 'active'
  });
  db.fileRecords.unshift(record);
  return record;
};
const rollbackStoredFile = async file => {
  db.fileRecords = db.fileRecords.filter(item => item !== file);
  await objectStorage.delete({ key: file.objectKey }).catch(() => {});
};

app.get('/api/files', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view files.' });
  const entityType = boundedText(req.query.entityType, 40);
  const recordId = boundedText(req.query.recordId, 180);
  const files = tenantRecords(db.fileRecords, actor).filter(file => file.accessState === 'active'
    && (!entityType || file.entityType === entityType) && (!recordId || file.recordId === recordId)
    && relatedRecordForFile(file, actor));
  res.json(files.map(publicFileMetadata));
});

app.post('/api/files', async (req, res, next) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'Authorised school staff can upload files.' });
  const entityType = boundedText(req.body?.entityType, 40);
  const recordId = boundedText(req.body?.recordId, 180);
  const probe = tagSchoolRecord(actor, { entityType, recordId });
  if (!recordId || !relatedRecordForFile(probe, actor)) return res.status(404).json({ message: 'The related school record was not found.' });
  let file;
  try {
    file = await createStoredFile(actor, { entityType, recordId, purpose: req.body?.purpose, originalFilename: req.body?.originalFilename, dataUrl: req.body?.dataUrl });
    await saveDatabaseState();
    req.persistenceCommitted = true;
    res.status(201).json({ success: true, file: publicFileMetadata(file) });
  } catch (error) {
    if (file) await rollbackStoredFile(file);
    next(error);
  }
});

app.get('/api/files/integrity', async (req, res, next) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  if (!objectStorage.configured) return res.status(503).json({ message: 'Cloudflare R2 storage is not configured.' });
  try {
    const files = tenantRecords(db.fileRecords, actor).filter(file => file.accessState === 'active').slice(0, 500);
    const results = [];
    for (const file of files) {
      try {
        const object = await objectStorage.head({ key: file.objectKey });
        results.push({ id: file.id, status: Number(object.size) === Number(file.size) ? 'ok' : 'size_mismatch' });
      } catch (error) {
        results.push({ id: file.id, status: (error?.code === 'ENOENT' || Number(error?.$metadata?.httpStatusCode) === 404) ? 'missing' : 'unverified' });
      }
    }
    const issues = results.filter(item => item.status !== 'ok');
    res.json({ checked: results.length, limited: tenantRecords(db.fileRecords, actor).filter(file => file.accessState === 'active').length > 500, issues });
  } catch (error) { next(error); }
});

app.put('/api/files/:id', async (req, res, next) => {
  const actor = getSessionAccount(req);
  const previous = actor && db.fileRecords.find(item => item.id === req.params.id && item.accessState === 'active' && recordInSchool(item, actor));
  if (!previous || !canManageFile(previous, actor)) return res.status(404).json({ message: 'File not found.' });
  let replacement;
  let previousObjectDeleted = false;
  try {
    replacement = await createStoredFile(actor, {
      entityType: previous.entityType, recordId: previous.recordId, purpose: previous.purpose,
      originalFilename: req.body?.originalFilename, dataUrl: req.body?.dataUrl
    });
    replacement.replacesFileId = previous.id;
    previous.accessState = 'replaced'; previous.replacedByFileId = replacement.id; previous.updatedAt = new Date().toISOString();
    const related = relatedRecordForFile(replacement, actor);
    if (related && previous.entityType === 'post' && related.mediaFileId === previous.id) related.mediaFileId = replacement.id;
    if (related && previous.entityType === 'worksheet' && related.photoFileId === previous.id) related.photoFileId = replacement.id;
    await saveDatabaseState();
    await objectStorage.delete({ key: previous.objectKey });
    previousObjectDeleted = true;
    previous.accessState = 'deleted'; previous.deletedAt = new Date().toISOString();
    await saveDatabaseState();
    req.persistenceCommitted = true;
    res.json({ success: true, file: publicFileMetadata(replacement) });
  } catch (error) {
    if (replacement && !previousObjectDeleted) await rollbackStoredFile(replacement);
    previous.accessState = previousObjectDeleted ? 'deleted' : 'active';
    if (!previousObjectDeleted) { delete previous.replacedByFileId; delete previous.deletedAt; }
    await saveDatabaseState().catch(() => {});
    next(error);
  }
});

app.get('/api/files/:id/content', async (req, res, next) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to download files.' });
  const file = db.fileRecords.find(item => item.id === req.params.id && item.accessState === 'active' && recordInSchool(item, actor));
  if (!file || !relatedRecordForFile(file, actor)) return res.status(404).json({ message: 'File not found.' });
  try {
    const object = await objectStorage.get({ key: file.objectKey });
    const bytes = Buffer.from(object.body);
    if (bytes.length !== file.size || crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      return res.status(409).json({ message: 'The stored file failed its integrity check. An administrator must restore or replace it.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `inline; filename="${safeOriginalFilename(file.originalFilename, 'bin').replace(/["\\]/g, '_')}"`);
    res.send(bytes);
  } catch (error) {
    if (String(error?.name || '').includes('NoSuchKey') || Number(error?.$metadata?.httpStatusCode) === 404 || error?.code === 'ENOENT') {
      return res.status(404).json({ message: 'The file metadata exists, but the stored object is missing. An administrator must restore or replace it.' });
    }
    next(error);
  }
});

app.delete('/api/files/:id', async (req, res, next) => {
  const actor = getSessionAccount(req);
  const file = actor && db.fileRecords.find(item => item.id === req.params.id && item.accessState === 'active' && recordInSchool(item, actor));
  if (!file || !canManageFile(file, actor)) return res.status(404).json({ message: 'File not found.' });
  try {
    const related = relatedRecordForFile(file, actor);
    file.accessState = 'pending_delete'; file.updatedAt = new Date().toISOString();
    if (related && file.entityType === 'post' && related.mediaFileId === file.id) related.mediaFileId = null;
    if (related && file.entityType === 'worksheet' && related.photoFileId === file.id) related.photoFileId = null;
    await saveDatabaseState();
    await objectStorage.delete({ key: file.objectKey });
    file.accessState = 'deleted'; file.deletedAt = new Date().toISOString(); file.deletedBy = actor.username;
    await saveDatabaseState();
    req.persistenceCommitted = true;
    res.json({ success: true });
  } catch (error) {
    file.accessState = 'active'; delete file.deletedAt; delete file.deletedBy;
    const related = relatedRecordForFile(file, actor);
    if (related && file.entityType === 'post') related.mediaFileId = file.id;
    if (related && file.entityType === 'worksheet') related.photoFileId = file.id;
    await saveDatabaseState().catch(() => {});
    next(error);
  }
});

// Posts
app.get('/api/posts', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view the school feed.' });
  res.json(tenantRecords(db.posts, actor).map(post => ({ ...post, mediaUrl: post.mediaFileId ? `/api/files/${encodeURIComponent(post.mediaFileId)}/content` : safeStoredMedia(post.mediaUrl, validPostMediaData) })));
});
app.post('/api/posts', async (req, res, next) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can post updates.' });
  if (req.body?.mediaUrl !== undefined && req.body.mediaUrl !== null && !validPostMediaData(req.body.mediaUrl)) return res.status(400).json({ message: 'Attached media must be a supported PNG, JPEG, or WebP image under 5 MB.' });
  const audience = boundedText(req.body?.audience || 'All', 40);
  const caption = boundedText(req.body?.caption, 4000);
  if (!POST_AUDIENCES.has(audience) || !caption) return res.status(400).json({ message: 'Choose a valid audience and add an update.' });
  const post = tagSchoolRecord(actor, {
    id: crypto.randomUUID(),
    audience,
    caption,
    mediaUrl: req.body?.mediaUrl || null,
    createdBy: actor.username,
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  let file;
  try {
    if (post.mediaUrl && objectStorage.configured) {
      file = await createStoredFile(actor, { entityType: 'post', recordId: post.id, purpose: 'school-feed-image', originalFilename: 'school-feed-image', dataUrl: post.mediaUrl });
      post.mediaFileId = file.id; post.mediaUrl = null;
    }
    db.posts.unshift(post);
    if (file) { await saveDatabaseState(); req.persistenceCommitted = true; }
    res.json({ success: true, post: { ...post, mediaUrl: file ? fileContentPath(file) : post.mediaUrl } });
  } catch (error) {
    db.posts = db.posts.filter(item => item !== post);
    if (file) await rollbackStoredFile(file);
    next(error);
  }
});
app.delete('/api/posts/:id', async (req, res, next) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const post = db.posts.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!post) return res.status(404).json({ message: 'School update not found.' });
  const file = post.mediaFileId && db.fileRecords.find(item => item.id === post.mediaFileId && recordInSchool(item, actor));
  try {
    if (file) { file.accessState = 'pending_delete'; file.updatedAt = new Date().toISOString(); }
    db.posts = db.posts.filter(p => p !== post);
    if (file) {
      await saveDatabaseState(); await objectStorage.delete({ key: file.objectKey });
      file.accessState = 'deleted'; file.deletedAt = new Date().toISOString(); await saveDatabaseState(); req.persistenceCommitted = true;
    }
    res.json({ success: true });
  } catch (error) {
    if (!db.posts.includes(post)) db.posts.unshift(post);
    if (file) file.accessState = 'active';
    await saveDatabaseState().catch(() => {}); next(error);
  }
});

// Schedules
app.get('/api/schedules', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view schedules.' });
  res.json(learnerRecordsVisibleTo(db.schedules, actor));
});
app.post('/api/schedules', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can create schedules.' });
  const studentName = boundedText(req.body?.studentName, 160);
  const dayOfWeek = boundedText(req.body?.dayOfWeek, 20);
  const timeSlot = boundedText(req.body?.timeSlot, 80);
  const activity = boundedText(req.body?.activity, 1000);
  if (!studentName || !activity) return res.status(400).json({ message: 'Complete the learner and activity.' });
  const item = tagSchoolRecord(actor, { id: crypto.randomUUID(), studentName, dayOfWeek, timeSlot, activity, createdBy: actor.username });
  db.schedules.push(item);
  res.json({ success: true, item });
});
app.post('/api/schedules/import', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can import schedules.' });
  const { schedules } = req.body;
  if (!Array.isArray(schedules) || !schedules.length) return res.status(400).json({ message: 'Add at least one schedule record to import.' });
  if (schedules.length > 2000) return res.status(400).json({ message: 'Import up to 2,000 schedule records per file.' });
  {
    const cleanSchedules = schedules.map(item => ({
      studentName: boundedText(item?.studentName, 160),
      dayOfWeek: boundedText(item?.dayOfWeek, 20),
      timeSlot: boundedText(item?.timeSlot, 80),
      activity: boundedText(item?.activity, 1000)
    })).filter(item => item.studentName && item.activity);
    db.schedules.push(...cleanSchedules.map(item => tagSchoolRecord(actor, { ...item, id: crypto.randomUUID(), createdBy: actor.username })));
  }
  res.json({ success: true });
});
app.delete('/api/schedules/:id', (req, res) => {
  const actor = getSessionAccount(req);
  const item = db.schedules.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!actor || !item || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(404).json({ message: 'Schedule item not found.' });
  db.schedules = db.schedules.filter(s => s !== item);
  res.json({ success: true });
});

// Worksheets
app.get('/api/worksheets', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view learning files.' });
  res.json(learnerRecordsVisibleTo(db.worksheets, actor).map(worksheet => ({ ...worksheet, photoUrl: worksheet.photoFileId ? `/api/files/${encodeURIComponent(worksheet.photoFileId)}/content` : safeStoredMedia(worksheet.photoUrl) })));
});
app.post('/api/worksheets', async (req, res, next) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can add learning files.' });
  if (req.body?.photoUrl !== undefined && req.body.photoUrl !== null && !validWorksheetMediaData(req.body.photoUrl)) return res.status(400).json({ message: 'Attached evidence must be a supported PNG, JPEG, GIF, or WebP image under 5 MB.' });
  const studentName = boundedText(req.body?.studentName, 160);
  const title = boundedText(req.body?.title, 240);
  const hasGrade = req.body?.grade !== undefined && req.body?.grade !== null && String(req.body.grade).trim() !== '';
  const grade = hasGrade ? Number(req.body.grade) : null;
  if (!studentName || !title || (hasGrade && (!Number.isFinite(grade) || grade < 0 || grade > 100))) return res.status(400).json({ message: 'Enter a learner and title; when supplied, the grade must be between 0 and 100.' });
  const item = tagSchoolRecord(actor, {
    id: crypto.randomUUID(), studentName, title, ...(hasGrade ? { grade } : {}),
    photoUrl: req.body?.photoUrl || null,
    submittedBy: actor.username,
    uploadedAt: new Date().toLocaleDateString(),
    createdAt: new Date().toISOString()
  });
  let file;
  try {
    if (item.photoUrl && objectStorage.configured) {
      file = await createStoredFile(actor, { entityType: 'worksheet', recordId: item.id, purpose: 'learning-evidence', originalFilename: 'learning-evidence', dataUrl: item.photoUrl });
      item.photoFileId = file.id; item.photoUrl = null;
    }
    db.worksheets.unshift(item);
    if (file) { await saveDatabaseState(); req.persistenceCommitted = true; }
    res.json({ success: true, item: { ...item, photoUrl: file ? fileContentPath(file) : item.photoUrl } });
  } catch (error) {
    db.worksheets = db.worksheets.filter(record => record !== item);
    if (file) await rollbackStoredFile(file);
    next(error);
  }
});
app.delete('/api/worksheets/:id', async (req, res, next) => {
  const actor = getSessionAccount(req);
  const item = db.worksheets.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!actor || !item || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(404).json({ message: 'Learning file not found.' });
  const file = item.photoFileId && db.fileRecords.find(record => record.id === item.photoFileId && recordInSchool(record, actor));
  try {
    if (file) { file.accessState = 'pending_delete'; file.updatedAt = new Date().toISOString(); }
    db.worksheets = db.worksheets.filter(w => w !== item);
    if (file) {
      await saveDatabaseState(); await objectStorage.delete({ key: file.objectKey });
      file.accessState = 'deleted'; file.deletedAt = new Date().toISOString(); await saveDatabaseState(); req.persistenceCommitted = true;
    }
    res.json({ success: true });
  } catch (error) {
    if (!db.worksheets.includes(item)) db.worksheets.unshift(item);
    if (file) file.accessState = 'active';
    await saveDatabaseState().catch(() => {}); next(error);
  }
});

// Badges
app.get('/api/badges', (req, res) => {
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to view badges.' });
  const badges = tenantRecords(db.badges, requester);
  if (requester.role !== 'parent') return res.json(badges);

  const linkedLearners = new Set(
    tenantRecords(db.students, requester)
      .filter(student => isParentLinkedToLearner(requester, student))
      .map(student => String(student.studentName).toLocaleLowerCase('en-US'))
  );
  res.json(badges.filter(badge => linkedLearners.has(String(badge.studentName || '').toLocaleLowerCase('en-US'))));
});
app.post('/api/badges', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) {
    return res.status(403).json({ message: 'Only authorised school staff can award badges.' });
  }
  const studentName = String(req.body?.studentName || '').trim().slice(0, 160);
  const category = String(req.body?.category || '').trim().slice(0, 80);
  const title = String(req.body?.title || req.body?.awardName || '').trim().slice(0, 160);
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!studentName || !category || !title) return res.status(400).json({ message: 'Choose a learner, milestone category, and badge title.' });
  const item = tagSchoolRecord(actor, {
    id: crypto.randomUUID(),
    studentName,
    category,
    title,
    note,
    awardedBy: actor.username,
    createdAt: new Date().toISOString()
  });
  db.badges.unshift(item);
  res.json({ success: true, item });
});
app.delete('/api/badges/:id', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) {
    return res.status(403).json({ message: 'Only authorised school staff can remove badges.' });
  }
  const badge = db.badges.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!badge) return res.status(404).json({ message: 'Badge not found.' });
  db.badges = db.badges.filter(b => b !== badge);
  res.json({ success: true });
});

// Analytics
app.get('/api/analytics/:studentName', (req, res) => {
  const name = req.params.studentName;
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to view growth analytics.' });
  const student = tenantRecords(db.students, requester).find(entry => normalizeComparableText(entry.studentName) === normalizeComparableText(name));
  if (!student) return res.status(404).json({ message: 'Learner record not found.' });
  if (requester.role === 'parent' && !isParentLinkedToLearner(requester, student)) return res.status(403).json({ message: 'Parents may only view analytics for their linked learner.' });
  const studentWorksheets = tenantRecords(db.worksheets, requester).filter(w => w.studentName.toLowerCase() === name.toLowerCase() && Number.isFinite(Number(w.grade))).reverse();
  if (!studentWorksheets.length) return res.json({ totalAssessments: 0, subscription: requester.subscription || 'school', studentName: name });
  const scores = studentWorksheets.map(item => Number(item.grade));
  const averageScore = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
  const first = studentWorksheets[0];
  const latest = studentWorksheets.at(-1);
  const pointChange = Number(latest.grade) - Number(first.grade);
  const percentageChange = Number(first.grade) ? Math.round((pointChange / Number(first.grade)) * 1000) / 10 : null;
  const best = studentWorksheets.reduce((bestItem, item) => Number(item.grade) > Number(bestItem.grade) ? item : bestItem);
  const worst = studentWorksheets.reduce((worstItem, item) => Number(item.grade) < Number(worstItem.grade) ? item : worstItem);
  const hasPremiumDetail = requester.role !== 'parent' || parentSubscriptionActive(requester);
  res.json({ totalAssessments: scores.length, averageScore, latestScore: Number(latest.grade), baselineScore: Number(first.grade), pointChange, percentageChange, trend: pointChange > 0 ? 'Improved' : pointChange < 0 ? 'Declined' : 'Maintained', best: hasPremiumDetail ? { title: best.title || 'Assessment', score: Number(best.grade) } : null, worst: hasPremiumDetail ? { title: worst.title || 'Assessment', score: Number(worst.grade) } : null, subscription: requester.role === 'parent' ? (hasPremiumDetail ? 'plus' : 'basic') : (requester.subscription || 'school'), detailedInsights: hasPremiumDetail });
});

// Staff qualifications, compliance, development and KPI history.
const validIsoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(String(value) + 'T00:00:00Z'));
const qualificationStatus = item => {
  if (!item.expiryDate) return 'No expiry';
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const expiry = new Date(item.expiryDate + 'T00:00:00Z');
  const days = Math.ceil((expiry - today) / 86400000);
  return days < 0 ? 'Expired' : days <= 30 ? 'Expiring soon' : 'Valid';
};
app.get('/api/staff/qualifications', (req,res) => {
  const actor=requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=tenantRecords(db.staffQualifications,actor).map(item=>({...item,status:qualificationStatus(item)}));
  res.json((hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role))?rows:rows.filter(x=>normalizeUsername(x.username)===normalizeUsername(actor.username)));
});
app.post('/api/staff/qualifications', (req,res) => {
  const actor=requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const target=staffAccountInSchool(actor,req.body?.username||actor.username);
  if(!target)return res.status(400).json({message:'Choose a staff member from this school.'});
  if(actor.role==='teacher'&&normalizeUsername(target.username)!==normalizeUsername(actor.username))return res.status(403).json({message:'Staff can add qualifications only to their own record.'});
  const name=boundedText(req.body?.name,180),issuingBody=boundedText(req.body?.issuingBody,180),obtainedDate=boundedText(req.body?.obtainedDate,10),expiryDate=boundedText(req.body?.expiryDate,10);
  if(!name||!issuingBody||!validIsoDate(obtainedDate)||(expiryDate&&(!validIsoDate(expiryDate)||expiryDate<obtainedDate)))return res.status(400).json({message:'Add a qualification, issuing body and valid dates. Expiry cannot be before the obtained date.'});
  const item=tagSchoolRecord(actor,{id:crypto.randomUUID(),username:target.username,staffName:target.name||target.username,name,issuingBody,obtainedDate,expiryDate,reference:boundedText(req.body?.reference,300),createdBy:actor.username,createdAt:new Date().toISOString()});
  db.staffQualifications.unshift(item);res.status(201).json({success:true,item:{...item,status:qualificationStatus(item)}});
});
app.patch('/api/staff/qualifications/:id', (req,res) => {
  const actor=requireSchoolStaff(req); const item=actor&&db.staffQualifications.find(x=>x.id===req.params.id&&recordInSchool(x,actor));
  if(!item)return res.status(404).json({message:'Qualification not found.'});
  const own=normalizeUsername(item.username)===normalizeUsername(actor.username),manager=(hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role));
  if(!own&&!manager)return res.status(403).json({message:'You cannot update this qualification.'});
  const expiry=boundedText(req.body?.expiryDate??item.expiryDate,10),reference=boundedText(req.body?.reference??item.reference,300);
  if(expiry&&(!validIsoDate(expiry)||expiry<item.obtainedDate))return res.status(400).json({message:'Choose a valid expiry date after the obtained date.'});
  item.expiryDate=expiry;item.reference=reference;item.updatedAt=new Date().toISOString();res.json({success:true,item:{...item,status:qualificationStatus(item)}});
});
app.get('/api/staff/kpi-history', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const requested=boundedText(req.query.username||actor.username,160),target=staffAccountInSchool(actor,requested);
  if(!target)return res.status(404).json({message:'Staff member not found.'});
  if(!(hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role))&&normalizeUsername(target.username)!==normalizeUsername(actor.username))return res.status(403).json({message:'You can view only your own KPI history.'});
  const count=Math.max(1,Math.min(24,Number(req.query.months)||12)),rows=[];const now=new Date();
  for(let i=count-1;i>=0;i--){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1));rows.push(monthlyTaskKpi(actor,target.username,d.toISOString().slice(0,7)));}
  res.json({username:target.username,staffName:target.name||target.username,rows});
});
app.get('/api/staff/development-plans', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=tenantRecords(db.staffDevelopmentPlans,actor);res.json((hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role))?rows:rows.filter(x=>normalizeUsername(x.username)===normalizeUsername(actor.username)));
});
app.post('/api/staff/development-plans', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor||!(hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role)))return res.status(403).json({message:'Management access is required.'});
  const target=staffAccountInSchool(actor,req.body?.username),goal=boundedText(req.body?.goal,1000);
  if(!target||!goal)return res.status(400).json({message:'Choose a staff member and add a development goal.'});
  const targetDate=boundedText(req.body?.targetDate,10);if(targetDate&&!validIsoDate(targetDate))return res.status(400).json({message:'Choose a valid target date.'});
  const item=tagSchoolRecord(actor,{id:crypto.randomUUID(),username:target.username,staffName:target.name||target.username,goal,actions:boundedText(req.body?.actions,2000),targetDate,status:'Active',reviewId:boundedText(req.body?.reviewId,100),createdBy:actor.username,createdAt:new Date().toISOString()});
  db.staffDevelopmentPlans.unshift(item);res.status(201).json({success:true,item});
});
app.patch('/api/staff/development-plans/:id', (req,res) => {
  const actor=requireSchoolStaff(req),item=actor&&db.staffDevelopmentPlans.find(x=>x.id===req.params.id&&recordInSchool(x,actor));
  if(!item)return res.status(404).json({message:'Development plan not found.'});
  const own=normalizeUsername(item.username)===normalizeUsername(actor.username),manager=(hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role));if(!own&&!manager)return res.status(403).json({message:'You cannot update this plan.'});
  const status=boundedText(req.body?.status||item.status,30);if(!['Active','Completed','Paused'].includes(status))return res.status(400).json({message:'Choose a valid plan status.'});
  item.status=status;item.staffComment=boundedText(req.body?.staffComment??item.staffComment,1500);item.updatedAt=new Date().toISOString();res.json({success:true,item});
});

// Little Feet Email Integration inbox: a separate delivery surface for portal events.
const emailInboxVisibleTo = (item, actor) => item && normalizeUsername(item.username) === normalizeUsername(actor.username) && (item.type === 'Email' || recordInSchool(item, actor));
const emailSourceKey = item => `${item.type}:${item.sourceId}`;
const dismissEmailSource = (actor, item) => {
  if (!item?.sourceId) return;
  const key = emailSourceKey(item);
  if (!tenantRecords(db.emailDismissals, actor).some(entry => normalizeUsername(entry.username) === normalizeUsername(actor.username) && entry.sourceKey === key)) {
    db.emailDismissals.unshift(tagSchoolRecord(actor, { id: crypto.randomUUID(), username: actor.username, sourceKey: key, dismissedAt: new Date().toISOString() }));
  }
};
const addEmailInboxItem = (actor, data) => {
  if (!actor) return null;
  const item = tagSchoolRecord(actor, {
    id: crypto.randomUUID(), username: actor.username, type: boundedText(data.type || 'Notification', 40),
    title: boundedText(data.title || 'Little Feet notification', 200), message: boundedText(data.message, 4000),
    sourceId: boundedText(data.sourceId, 160), sourceTab: boundedText(data.sourceTab, 80),
    sender: boundedText(data.sender, 300), provider: boundedText(data.provider, 40),
    providerLink: safeHttpsUrl(data.providerLink) || '',
    read: false, pinned: false,
    createdAt: data.createdAt && !Number.isNaN(Date.parse(data.createdAt)) ? new Date(data.createdAt).toISOString() : new Date().toISOString()
  });
  db.emailInbox.unshift(item); return item;
};
const emailInboxPreferenceDefaults = actor => {
  const role = String(actor?.role || '');
  if (hasPlatformAccess(actor)) return { mail:true, tickets:true, messages:true, notices:true, alerts:true };
  if (role === 'parent') return { mail:true, tickets:true, messages:true, payments:true, subscriptions:true };
  if (role === 'district') return { mail:true, tickets:true, alerts:true };
  if (role === 'crm' || role === 'support') return { mail:true, tickets:true, messages:true };
  if (role === 'school_accounts') return { mail:true, tickets:true };
  return { mail:true, tickets:true, messages:true, notices:true, alerts:true };
};
const emailInboxPreferenceKeys = actor => Object.keys(emailInboxPreferenceDefaults(actor));
const emailInboxPreferencesFor = actor => emailInboxPreferenceDefaults(actor);
const emailInboxTypeKey = type => ({
  Email:'mail', Ticket:'tickets', Message:'messages', Notice:'notices', Alert:'alerts', Payment:'payments', Subscription:'subscriptions'
})[type] || '';
const emailInboxTypeEnabled = (actor, type) => {
  const key = emailInboxTypeKey(type);
  if (!key || !emailInboxPreferenceKeys(actor).includes(key)) return false;
  return emailInboxPreferencesFor(actor)[key] !== false;
};

const buildEmailInbox = actor => {
  const isParent = actor?.role === 'parent';
  const parentUsername = normalizeUsername(actor?.username);
  const parentAllowedTypes = new Set(['Email', 'Ticket', 'Message', 'Payment', 'Subscription']);

  // Parent inboxes are deliberately isolated from staff notices, internal school alerts,
  // and other operational material. Remove any legacy items that were created before
  // this boundary existed so old data cannot keep leaking into a parent account.
  if (isParent) {
    db.emailInbox = db.emailInbox.filter(item => !emailInboxVisibleTo(item, actor) || parentAllowedTypes.has(item.type));
  }

  const openTicketIds = new Set(
    tenantRecords(db.tickets, actor)
      .filter(ticket => ticket.status !== 'Completed' && (!isParent || normalizeUsername(ticket.createdBy) === parentUsername))
      .map(ticket => ticket.id)
  );
  db.emailInbox = db.emailInbox.filter(item => !(emailInboxVisibleTo(item, actor) && item.type === 'Ticket' && !openTicketIds.has(item.sourceId)));

  const existing = tenantRecords(db.emailInbox, actor)
    .filter(item => emailInboxVisibleTo(item, actor))
    .filter(item => !isParent || parentAllowedTypes.has(item.type))
    .filter(item => emailInboxTypeEnabled(actor, item.type));
  const known = new Set(existing.map(item => item.type + ':' + item.sourceId));
  const dismissed = new Set(tenantRecords(db.emailDismissals, actor).filter(item => normalizeUsername(item.username) === parentUsername).map(item => item.sourceKey));
  const add = (type, sourceId, title, message, sourceTab) => {
    if (!emailInboxTypeEnabled(actor, type)) return;
    const key=type+':'+sourceId;if(!sourceId||known.has(key)||dismissed.has(key))return;
    const item=addEmailInboxItem(actor,{type,sourceId,title,message,sourceTab});if(item){existing.push(item);known.add(key);}
  };

  if (isParent) {
    // Parent-facing only: their own support requests, messages addressed to them,
    // their payment requests and their own LittleSteps subscription activity.
    tenantRecords(db.tickets, actor)
      .filter(t => t.status !== 'Completed' && normalizeUsername(t.createdBy) === parentUsername)
      .forEach(t => add('Ticket', t.id, t.subject, t.feedback || t.message || 'Support ticket update', 'ticketsTab'));
    tenantRecords(db.directMessages, actor)
      .filter(m => normalizeUsername(m.recipient) === parentUsername)
      .forEach(m => add('Message', m.id, 'Message from ' + (m.sender || 'Little Feet'), m.message, 'chatTab'));
    (db.parentPayments || [])
      .filter(record => recordInSchool(record, actor) && normalizeUsername(record.parentUsername) === parentUsername)
      .forEach(record => add(
        'Payment',
        record.id,
        record.description || 'Parent payment request',
        `${record.learnerName ? record.learnerName + ' · ' : ''}${record.reference || 'Payment'} · ${String(record.paymentStatus || 'awaiting payment').replaceAll('_',' ')}`,
        'parentPaymentsTab'
      ));
    (db.parentSubscriptions || [])
      .filter(record => recordInSchool(record, actor) && normalizeUsername(record.parentUsername) === parentUsername)
      .forEach(record => add(
        'Subscription',
        record.id,
        'LittleSteps subscription',
        `${record.reference || 'Subscription'} · ${String(record.paymentStatus || 'awaiting payment').replaceAll('_',' ')}`,
        'parentPaymentsTab'
      ));
    return existing.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  tenantRecords(db.tickets, actor).filter(t=>t.status!=='Completed'&&(normalizeUsername(t.createdBy)===parentUsername||normalizeUsername(t.assignedTo)===parentUsername))
    .forEach(t=>add('Ticket',t.id,t.subject,t.feedback||t.message||'Support ticket update','ticketsTab'));
  tenantRecords(db.staffNotices, actor).filter(n=>n.audience==='All staff'||n.audience===actor.role)
    .forEach(n=>add('Notice',n.id,n.title,n.message,'staffNoticesTab'));
  tenantRecords(db.directMessages, actor).filter(m=>normalizeUsername(m.recipient)===parentUsername)
    .forEach(m=>add('Message',m.id,'Message from '+(m.sender||'Little Feet'),m.message,'chatTab'));
  tenantRecords(db.broadcasts, actor).forEach(b=>add('Alert',b.id,b.bcPriority||'School alert',b.bcMessage,'broadcastsTab'));
  return existing.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
};
app.get('/api/email/inbox',(req,res)=>{
  const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view your Little Feet email inbox.'});
  res.json(buildEmailInbox(actor));
});
app.patch('/api/email/inbox/:id',(req,res)=>{
  const actor=getSessionAccount(req),item=actor&&db.emailInbox.find(x=>x.id===req.params.id&&emailInboxVisibleTo(x,actor));
  if(!item)return res.status(404).json({message:'Inbox item not found.'});
  if(typeof req.body?.read==='boolean')item.read=req.body.read;if(typeof req.body?.pinned==='boolean')item.pinned=req.body.pinned;
  item.updatedAt=new Date().toISOString();res.json({success:true,item});
});
app.delete('/api/email/inbox/:id',(req,res)=>{
  const actor=getSessionAccount(req),item=actor&&db.emailInbox.find(x=>x.id===req.params.id&&emailInboxVisibleTo(x,actor));
  if(!item)return res.status(404).json({message:'Inbox item not found.'});dismissEmailSource(actor,item);db.emailInbox=db.emailInbox.filter(x=>x!==item);res.json({success:true});
});
app.delete('/api/email/inbox',(req,res)=>{
  const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to manage your Little Feet email inbox.'});
  const visible=db.emailInbox.filter(x=>emailInboxVisibleTo(x,actor));visible.forEach(item=>dismissEmailSource(actor,item));const before=db.emailInbox.length;db.emailInbox=db.emailInbox.filter(x=>!emailInboxVisibleTo(x,actor));res.json({success:true,deleted:before-db.emailInbox.length});
});

// Email is a delivery channel, separate from in-app notifications.
// Little Feet can use the existing HTTPS email API or a real mailbox SMTP
// connection (for example Zoho Mail) without exposing mailbox credentials.
const emailVerificationTokens = new Map();
const emailHeaderText = value => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
const smtpConfig = () => {
  const port = Number(process.env.LF_SMTP_PORT || 465);
  return {
    host: String(process.env.LF_SMTP_HOST || '').trim(),
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 465,
    username: String(process.env.LF_SMTP_USERNAME || '').trim(),
    password: String(process.env.LF_SMTP_PASSWORD || ''),
    from: String(process.env.LF_EMAIL_FROM || process.env.LF_SMTP_USERNAME || '').trim(),
    fromName: emailHeaderText(process.env.LF_EMAIL_FROM_NAME || 'Little Feet')
  };
};
const smtpEmailConfigured = () => {
  const config = smtpConfig();
  return Boolean(config.host && config.username && config.password && looksLikeEmailAddress(config.from));
};
const apiEmailConfigured = () => Boolean(
  looksLikeEmailAddress(process.env.LF_EMAIL_FROM) &&
  String(process.env.LF_EMAIL_API_KEY || '').trim()
);
const emailDeliveryProvider = () => {
  if (smtpEmailConfigured()) {
    const host = smtpConfig().host.toLowerCase();
    return host.includes('zoho') ? 'Zoho SMTP' : 'SMTP';
  }
  if (apiEmailConfigured()) return 'Email API';
  return 'Not configured';
};

const smtpSend = async ({to,subject,text}) => {
  const config = smtpConfig();
  if (!smtpEmailConfigured()) return false;
  if (config.port !== 465) throw new Error('Little Feet SMTP currently requires implicit TLS on port 465.');

  const responseQueue = [];
  const waiters = [];
  let lineBuffer = '';
  let responseLines = [];
  let terminalError = null;

  const deliver = response => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(response);
    else responseQueue.push(response);
  };
  const failAll = error => {
    if (terminalError) return;
    terminalError = error instanceof Error ? error : new Error(String(error || 'SMTP connection failed.'));
    while (waiters.length) waiters.shift().reject(terminalError);
  };
  const nextResponse = () => {
    if (responseQueue.length) return Promise.resolve(responseQueue.shift());
    if (terminalError) return Promise.reject(terminalError);
    return new Promise((resolve,reject)=>waiters.push({resolve,reject}));
  };
  const expect = async (allowed, label) => {
    const response = await nextResponse();
    if (!allowed.includes(response.code)) throw new Error(`SMTP ${label} failed with ${response.code}: ${response.text}`);
    return response;
  };

  const socket = tls.connect({
    host: config.host,
    port: config.port,
    servername: config.host,
    rejectUnauthorized: true
  });
  socket.setTimeout(15000, () => {
    const error = new Error('SMTP connection timed out.');
    failAll(error);
    socket.destroy(error);
  });
  socket.on('error', failAll);
  socket.on('close', () => {
    if (waiters.length && !terminalError) failAll(new Error('SMTP connection closed unexpectedly.'));
  });
  socket.on('data', chunk => {
    lineBuffer += chunk.toString('utf8');
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line) continue;
      responseLines.push(line);
      if (/^\d{3} /.test(line)) {
        const code = Number(line.slice(0,3));
        deliver({ code, text: responseLines.join(' | ').slice(0,1200) });
        responseLines = [];
      }
    }
  });

  try {
    await new Promise((resolve,reject)=>{
      if (socket.authorized) return resolve();
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    await expect([220], 'greeting');
    const command = async (value, allowed, label) => {
      socket.write(`${value}\r\n`);
      return expect(allowed, label);
    };
    await command('EHLO littlefeet.co.za', [250], 'EHLO');
    await command('AUTH LOGIN', [334], 'authentication');
    await command(Buffer.from(config.username).toString('base64'), [334], 'username');
    await command(Buffer.from(config.password).toString('base64'), [235], 'password');
    await command(`MAIL FROM:<${config.from}>`, [250], 'sender');
    await command(`RCPT TO:<${to}>`, [250,251], 'recipient');
    await command('DATA', [354], 'data');

    const cleanSubject = emailHeaderText(subject || 'Little Feet');
    const cleanText = String(text || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const fromHeader = config.fromName ? `${config.fromName} <${config.from}>` : config.from;
    const message = [
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Subject: ${cleanSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      `Date: ${new Date().toUTCString()}`,
      '',
      cleanText
    ].join('\r\n');
    socket.write(`${message}\r\n.\r\n`);
    await expect([250], 'message delivery');
    socket.write('QUIT\r\n');
    await expect([221], 'QUIT').catch(()=>{});
    socket.end();
    return true;
  } catch (error) {
    socket.destroy();
    throw error;
  }
};

const sendLittleFeetEmail = async ({to,subject,text}) => {
  if (!looksLikeEmailAddress(to)) return false;
  if (smtpEmailConfigured()) return smtpSend({to,subject,text});

  const from=String(process.env.LF_EMAIL_FROM||'').trim(),apiKey=String(process.env.LF_EMAIL_API_KEY||'').trim();
  if(!looksLikeEmailAddress(from)||!apiKey)return false;
  const endpoint=safeHttpsUrl(process.env.LF_EMAIL_API_URL||'https://api.resend.com/emails');
  if(!endpoint)throw new Error('Invalid LF_EMAIL_API_URL');
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify({from,to:[to],subject:emailHeaderText(subject),text:String(text||'')})});
  if(!response.ok)throw new Error(`Email provider returned HTTP ${response.status}`);
  return true;
};

const inboundEmailDomain = () => {
  const value = String(process.env.LF_INBOUND_EMAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, '');
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && value.includes('.') ? value : '';
};
const inboundEmailApiKey = () => String(process.env.LF_INBOUND_EMAIL_API_KEY || process.env.LF_EMAIL_API_KEY || '').trim();
const inboundWebhookSecret = () => String(process.env.LF_INBOUND_WEBHOOK_SECRET || '').trim();
const inboundEmailConfigured = () => Boolean(
  inboundEmailDomain()
  && inboundEmailApiKey()
  && /^whsec_[A-Za-z0-9+/=_-]+$/.test(inboundWebhookSecret())
);
const validForwardingAlias = value => /^lf-[a-f0-9]{24}$/.test(String(value || ''));
const forwardingAddressFor = actor => {
  const domain = inboundEmailDomain();
  const alias = actor?.emailForwarding?.aliasToken;
  return domain && validForwardingAlias(alias) ? String(alias).toLowerCase() + '@' + domain : '';
};
const publicForwardingStatus = actor => ({
  configured: inboundEmailConfigured(),
  address: forwardingAddressFor(actor),
  createdAt: actor?.emailForwarding?.createdAt || null,
  lastReceivedAt: actor?.emailForwarding?.lastReceivedAt || null
});
const ensureForwardingAddress = actor => {
  if (!actor) return '';
  if (!actor.emailForwarding || !validForwardingAlias(actor.emailForwarding.aliasToken)) {
    actor.emailForwarding = {
      aliasToken: 'lf-' + crypto.randomBytes(12).toString('hex'),
      createdAt: new Date().toISOString(),
      lastReceivedAt: null
    };
  }
  return forwardingAddressFor(actor);
};
const normalizeEnvelopeAddress = value => {
  const clean = String(value || '').trim().toLowerCase();
  const bracket = /<([^<>\s]+@[^<>\s]+)>/.exec(clean);
  return (bracket?.[1] || clean).replace(/^mailto:/, '');
};
const forwardingActorForRecipients = recipients => {
  const addresses = new Set((Array.isArray(recipients) ? recipients : [])
    .map(normalizeEnvelopeAddress)
    .filter(Boolean));
  return (db.users || []).find(account => {
    const address = forwardingAddressFor(account);
    return address && addresses.has(address);
  }) || null;
};
const receivedEmailSourceId = emailId => 'resend:' + String(emailId || '').trim();

app.post('/api/email/forwarding/setup', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to create your forwarding address.' });
  if (!inboundEmailConfigured()) {
    return res.status(503).json({ message: 'Inbound email receiving is not configured on this Little Feet server yet.' });
  }
  const address = ensureForwardingAddress(actor);
  res.json({ success: true, forwarding: publicForwardingStatus(actor), address });
});

const mailboxConnectionStatus = actor => {
  const connection = actor?.mailboxConnection;
  const connected = Boolean(connection?.version === 2 && MAILBOX_PROVIDERS.has(connection.provider));
  return {
    connected,
    provider: connected ? connection.provider : '',
    email: connected ? connection.email : '',
    connectedAt: connected ? connection.connectedAt : null,
    lastSyncAt: connected ? connection.lastSuccessfulSyncAt || null : null,
    initialSyncComplete: connected ? Boolean(connection.initialSyncComplete) : false,
    lastError: connected ? connection.lastError || '' : '',
    availableProviders: {
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
      zoho: Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
      yahoo: Boolean(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET)
    }
  };
};
const mailboxSyncLimit = initial => {
  const requested = Number(initial ? process.env.LF_MAILBOX_INITIAL_SYNC_LIMIT : process.env.LF_MAILBOX_SYNC_LIMIT);
  const fallback = initial ? 100 : 50;
  return Math.max(1, Math.min(200, Number.isSafeInteger(requested) ? requested : fallback));
};
const mailboxAccessToken = async actor => {
  const connection = actor?.mailboxConnection;
  if (!connection || connection.version !== 2 || !MAILBOX_PROVIDERS.has(connection.provider)) throw new Error('Connect a supported mailbox first.');
  let accessToken = decryptField(connection.accessToken);
  if (accessToken && Number(connection.accessTokenExpiresAt || 0) > Date.now() + 60_000) return accessToken;
  const refreshToken = decryptField(connection.refreshToken);
  const tokens = await refreshMailboxAccessToken({
    provider: connection.provider,
    refreshToken,
    origin: publicOrigin(),
    providerMetadata: connection.providerMetadata || {}
  });
  accessToken = String(tokens.access_token || '');
  if (!accessToken) throw new Error('The mailbox provider did not return an access token.');
  connection.accessToken = encryptField(accessToken);
  if (tokens.refresh_token) connection.refreshToken = encryptField(tokens.refresh_token);
  if (tokens.providerMetadata) connection.providerMetadata = { ...(connection.providerMetadata || {}), ...tokens.providerMetadata };
  connection.accessTokenExpiresAt = Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000;
  return accessToken;
};
const syncConnectedMailbox = async (actor, { initial = false } = {}) => {
  const connection = actor?.mailboxConnection;
  if (!connection) throw new Error('Connect a mailbox first.');
  if (!initial && connection.lastAttemptAt && Date.now() - Date.parse(connection.lastAttemptAt) < 30_000) {
    return { added: 0, skipped: true, lastSyncAt: connection.lastSuccessfulSyncAt || null };
  }
  connection.lastAttemptAt = new Date().toISOString();
  try {
    const accessToken = await mailboxAccessToken(actor);
    const limit = mailboxSyncLimit(initial);
    const mailboxOptions = {
      provider: connection.provider,
      accessToken,
      limit,
      providerMetadata: connection.providerMetadata || {}
    };
    const batches = [await fetchMailbox(mailboxOptions)];
    if (!initial && connection.backlogCursor) {
      batches.push(await fetchMailbox({ ...mailboxOptions, cursor: connection.backlogCursor }));
    }
    if (!batches[0].email) throw new Error('The mailbox provider did not identify the connected email address.');
    connection.email = boundedText(batches[0].email, 254).toLowerCase();
    connection.backlogCursor = initial ? boundedText(batches[0].nextCursor, 2000) : boundedText(batches[1]?.nextCursor, 2000);
    connection.initialSyncComplete = !connection.backlogCursor;
    let added = 0;
    for (const message of batches.flatMap(batch => batch.messages)) {
      const sourceId = `mailbox:${connection.provider}:${message.id}`;
      const duplicate = (db.emailInbox || []).some(item => item.type === 'Email'
        && item.sourceId === sourceId
        && normalizeUsername(item.username) === normalizeUsername(actor.username));
      if (duplicate) continue;
      addEmailInboxItem(actor, {
        type: 'Email', sourceId, title: message.subject,
        message: `From: ${message.from}\n\n${message.preview}`,
        sender: message.from, provider: MAILBOX_PROVIDER_LABELS[connection.provider] || connection.provider,
        sourceTab: 'emailIntegrationTab', createdAt: message.receivedAt
      });
      added += 1;
    }
    connection.lastSuccessfulSyncAt = new Date().toISOString();
    connection.lastError = '';
    return { added, skipped: false, email: connection.email, lastSyncAt: connection.lastSuccessfulSyncAt };
  } catch (error) {
    logStructured('error', 'mailbox.provider_sync_failed', { category: 'mailbox', message: error.message });
    connection.lastError = 'Mailbox sync is temporarily unavailable. Please try again.';
    throw error;
  }
};

app.get('/api/email/mailbox/status', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to manage a mailbox.' });
  res.json(mailboxConnectionStatus(actor));
});

app.get('/api/email/mailbox/connect/:provider', (req, res) => {
  const actor = getSessionAccount(req);
  const provider = String(req.params.provider || '').toLowerCase();
  if (!actor) return res.redirect('/?mailboxError=sign-in-required');
  if (!MAILBOX_PROVIDERS.has(provider)) return res.redirect('/?mailboxError=provider-unsupported');
  try {
    const authorization = createMailboxAuthorization({ provider, origin: publicOrigin() });
    req.session.mailboxOAuth = {
      provider, state: authorization.state, verifier: authorization.verifier,
      username: normalizeUsername(actor.username), createdAt: Date.now()
    };
    req.session.save(error => res.redirect(error ? '/?mailboxError=session-failed' : authorization.url));
  } catch (error) {
    logStructured('error', 'mailbox.authorization_setup_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.redirect('/?mailboxError=mailbox-connection-failed');
  }
});

const completeMailboxOAuth = async (req, res, provider) => {
  const actor = getSessionAccount(req);
  const pending = req.session?.mailboxOAuth;
  if (req.session) delete req.session.mailboxOAuth;
  const valid = actor && MAILBOX_PROVIDERS.has(provider) && pending?.provider === provider
    && pending.state === req.query.state && pending.username === normalizeUsername(actor.username)
    && Date.now() - Number(pending.createdAt || 0) < 10 * 60_000 && req.query.code && !req.query.error;
  if (!valid) return res.redirect('/?mailboxError=mailbox-connection-failed');
  const previousConnection = actor.mailboxConnection;
  try {
    const tokens = await exchangeMailboxCode({
      provider,
      code: String(req.query.code),
      verifier: pending.verifier,
      origin: publicOrigin(),
      callbackParams: {
        accountsServer: String(req.query['accounts-server'] || ''),
        location: String(req.query.location || '')
      }
    });
    if (!tokens.access_token || !tokens.refresh_token) throw new Error('The provider did not grant renewable mailbox access.');
    actor.mailboxConnection = {
      version: 2, provider, email: '',
      accessToken: encryptField(tokens.access_token), refreshToken: encryptField(tokens.refresh_token),
      accessTokenExpiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
      connectedAt: new Date().toISOString(), lastSuccessfulSyncAt: null, lastError: '',
      backlogCursor: '', initialSyncComplete: false,
      providerMetadata: tokens.providerMetadata || {}
    };
    await syncConnectedMailbox(actor, { initial: true });
    await saveDatabaseState();
    return res.redirect('/?mailbox=connected');
  } catch (error) {
    if (previousConnection) actor.mailboxConnection = previousConnection;
    else delete actor.mailboxConnection;
    logStructured('error', 'mailbox.connection_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, details: `Provider ${provider}`, message: error.message });
    return res.redirect('/?mailboxError=mailbox-connection-failed');
  }
};

app.get('/api/email/mailbox/oauth/:provider/callback', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  return completeMailboxOAuth(req, res, provider);
});

app.post('/api/email/mailbox/sync', async (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to sync a mailbox.' });
  try {
    const result = await syncConnectedMailbox(actor);
    await saveDatabaseState();
    res.json({ success: true, ...result, mailbox: mailboxConnectionStatus(actor) });
  } catch (error) {
    logStructured('error', 'mailbox.sync_request_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.status(502).json({ message: 'Mailbox sync is temporarily unavailable. Please try again.' });
  }
});

app.post('/api/email/mailbox/send', async (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to send mailbox email.' });
  if (!actor.mailboxConnection) return res.status(409).json({ message: 'Connect a mailbox before sending email.' });
  const to = boundedText(req.body?.to, 254), subject = boundedText(req.body?.subject, 300), text = boundedText(req.body?.text, 20000);
  if (!to || !subject || !text) return res.status(400).json({ message: 'Recipient, subject and message are required.' });
  try {
    const accessToken = await mailboxAccessToken(actor);
    const result = await sendMailboxMessage({ provider: actor.mailboxConnection.provider, accessToken, from: actor.mailboxConnection.email, to, subject, text, providerMetadata: actor.mailboxConnection.providerMetadata || {} });
    actor.mailboxConnection.lastSentAt = new Date().toISOString();
    await saveDatabaseState();
    res.status(201).json({ success: true, provider: result.provider, id: result.id || '', sentAt: actor.mailboxConnection.lastSentAt });
  } catch (error) {
    logStructured('error', 'mailbox.send_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.status(502).json({ message: 'Email could not be sent right now. Please try again.' });
  }
});

app.delete('/api/email/mailbox', async (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to disconnect a mailbox.' });
  const connection = actor.mailboxConnection;
  if (!connection) return res.json({ success: true, revoked: false });
  let revoked = false;
  try {
    const refreshToken = decryptField(connection.refreshToken);
    const accessToken = decryptField(connection.accessToken);
    const result = await revokeMailboxAccess({
      provider: connection.provider,
      refreshToken,
      accessToken,
      providerMetadata: connection.providerMetadata || {}
    });
    revoked = Boolean(result?.revoked);
  } catch (error) {
    logStructured('warn', 'mailbox.token_revocation_warning', { category: 'mailbox', details: `Provider ${connection.provider || 'Mailbox'}`, message: error.message });
  } finally {
    delete actor.mailboxConnection;
    await saveDatabaseState();
  }
  res.json({ success: true, revoked });
});

app.post('/api/email/inbound/resend', async (req, res) => {
  if (!inboundEmailConfigured()) return res.status(503).json({ message: 'Inbound email receiving is not configured.' });

  let event;
  try {
    event = verifyResendWebhook({
      rawBody: req.rawBody,
      headers: req.headers,
      secret: inboundWebhookSecret()
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid inbound email webhook signature.' });
  }

  if (event?.type !== 'email.received') return res.json({ received: true, ignored: true });

  const emailId = boundedText(event?.data?.email_id, 120);
  if (!emailId) return res.status(400).json({ message: 'Inbound email event did not include an email id.' });

  try {
    const received = await fetchResendReceivedEmail({
      emailId,
      apiKey: inboundEmailApiKey()
    });
    const recipients = [
      ...(Array.isArray(event?.data?.to) ? event.data.to : []),
      ...(Array.isArray(received.to) ? received.to : []),
      ...(Array.isArray(received.receivedFor) ? received.receivedFor : [])
    ];
    const actor = forwardingActorForRecipients(recipients);
    if (!actor) return res.status(202).json({ received: true, routed: false });

    const sourceId = receivedEmailSourceId(emailId);
    const duplicate = (db.emailInbox || []).find(item =>
      item.type === 'Email'
      && item.sourceId === sourceId
      && normalizeUsername(item.username) === normalizeUsername(actor.username)
    );
    if (duplicate) return res.json({ received: true, routed: true, duplicate: true });

    const body = received.text || received.htmlText || '(No message body)';
    const attachmentNote = received.attachmentCount
      ? `\n\n[${received.attachmentCount} attachment${received.attachmentCount === 1 ? '' : 's'} received. Attachment viewing will be added separately.]`
      : '';
    addEmailInboxItem(actor, {
      type: 'Email',
      sourceId,
      title: received.subject || '(No subject)',
      message: 'From: ' + (received.from || 'Unknown sender') + '\n\n' + body + attachmentNote,
      sender: received.from || 'Unknown sender',
      provider: 'Forwarded email',
      sourceTab: 'emailIntegrationTab',
      createdAt: received.createdAt
    });
    ensureForwardingAddress(actor);
    actor.emailForwarding.lastReceivedAt = received.createdAt || new Date().toISOString();
    actor.emailForwarding.lastEmailId = emailId;

    res.json({ received: true, routed: true });
  } catch (error) {
    logStructured('error', 'mailbox.inbound_processing_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.status(502).json({ message: 'Inbound email could not be processed yet; the provider may retry.' });
  }
});

const emailActor = req => getSessionAccount(req);
app.get('/api/email/status',(req,res)=>{
  const actor=emailActor(req);if(!actor)return res.status(401).json({message:'Sign in to manage your account email.'});
  const address=accountSecurityEmail(actor);
  res.json({
    configured:smtpEmailConfigured()||apiEmailConfigured(),
    provider:emailDeliveryProvider(),
    address,
    verified:Boolean(actor.emailVerifiedAt),
    verifiedAt:actor.emailVerifiedAt||null,
    forwarding:publicForwardingStatus(actor)
  });
});
app.post('/api/email/verification/request',async(req,res,next)=>{
  try{const actor=emailActor(req);if(!actor)return res.status(401).json({message:'Sign in to verify your account email.'});const to=accountSecurityEmail(actor);if(!to)return res.status(400).json({message:'Your account does not have a valid email address.'});
    const code=String(crypto.randomInt(100000,1000000)),hash=crypto.createHash('sha256').update(code).digest('hex');emailVerificationTokens.set(normalizeUsername(actor.username),{hash,expiresAt:Date.now()+10*60*1000});
    const sent=await sendLittleFeetEmail({to,subject:'Verify your Little Feet email',text:`Your Little Feet verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`});
    if(!sent){emailVerificationTokens.delete(normalizeUsername(actor.username));return res.status(503).json({message:'Email delivery is not configured yet. Configure the Little Feet SMTP or email API environment settings.'});}res.json({success:true,expiresInSeconds:600,provider:emailDeliveryProvider()});
  }catch(error){emailVerificationTokens.delete(normalizeUsername(getSessionAccount(req)?.username));next(error);}
});
app.post('/api/email/verification/confirm',(req,res)=>{
  const actor=emailActor(req);if(!actor)return res.status(401).json({message:'Sign in to verify your account email.'});const key=normalizeUsername(actor.username),entry=emailVerificationTokens.get(key),code=boundedText(req.body?.code,6);
  if(!entry||entry.expiresAt<Date.now()){emailVerificationTokens.delete(key);return res.status(400).json({message:'Verification code expired. Request a new one.'});}
  const hash=crypto.createHash('sha256').update(code).digest('hex');if(code.length!==6||hash!==entry.hash)return res.status(400).json({message:'Verification code is incorrect.'});
  actor.emailVerifiedAt=new Date().toISOString();emailVerificationTokens.delete(key);res.json({success:true,verifiedAt:actor.emailVerifiedAt});
});

// Attendance

// Monthly KPI is calculated from completed staff tasks, not subjective manager ratings.
const monthKey = value => /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : new Date().toISOString().slice(0, 7);
const monthlyTaskKpi = (actor, username, month) => {
  const key = monthKey(month);
  const tasks = tenantRecords(db.staffTasks, actor).filter(item => normalizeUsername(item.assignedTo) === normalizeUsername(username) && String(item.createdAt || '').slice(0, 7) === key);
  const completed = tasks.filter(item => item.status === 'Completed').length;
  const total = tasks.length;
  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const band = completionRate < 50 ? 'Below average' : completionRate < 80 ? 'Average' : 'Above average';
  return { month: key, total, completed, outstanding: total - completed, completionRate, band };
};
app.get('/api/staff/kpi-monthly', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const month = monthKey(req.query.month);
  const schoolStaff = tenantRecords(db.users, actor).filter(account => (hasPlatformAccess(account) || ['teacher', 'principal', 'admin', 'staff'].includes(account.role)));
  const visible = (hasPlatformAccess(actor) || ['admin', 'principal', 'staff'].includes(actor.role)) ? schoolStaff : schoolStaff.filter(account => normalizeUsername(account.username) === normalizeUsername(actor.username));
  const rows = visible.map(account => ({ username: account.username, staffName: account.name || account.username, ...monthlyTaskKpi(actor, account.username, month) }));
  const ranked = rows.slice().sort((a,b) => b.completionRate - a.completionRate || b.completed - a.completed || a.staffName.localeCompare(b.staffName)).map((row,index)=>({ ...row, rank:index+1 }));
  res.json({ month, rows: ranked });
});

// Staff purchase requests feed management approvals and finance fulfilment.
app.get('/api/purchase-requests', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=tenantRecords(db.purchaseRequests,actor);
  res.json((hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role))?rows:rows.filter(x=>normalizeUsername(x.requestedBy)===normalizeUsername(actor.username)));
});
app.post('/api/purchase-requests', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const itemName=boundedText(req.body?.itemName,180),reason=boundedText(req.body?.reason,2000),quantity=Math.max(1,Math.min(9999,Number(req.body?.quantity)||1)),estimatedUnitCost=Number(req.body?.estimatedUnitCost||0);
  if(!itemName||!reason||!Number.isFinite(estimatedUnitCost)||estimatedUnitCost<0)return res.status(400).json({message:'Add an item, reason, quantity and valid estimated cost.'});
  const item=tagSchoolRecord(actor,{id:crypto.randomUUID(),itemName,reason,quantity,estimatedUnitCost:Number(estimatedUnitCost.toFixed(2)),estimatedTotal:Number((quantity*estimatedUnitCost).toFixed(2)),supplier:boundedText(req.body?.supplier,180),category:boundedText(req.body?.category||'General',80),requestedBy:actor.username,requestedByName:actor.name||actor.username,status:'Pending',financeStatus:'Awaiting approval',createdAt:new Date().toISOString()});
  db.purchaseRequests.unshift(item);res.status(201).json({success:true,item});
});
app.patch('/api/purchase-requests/:id/finance', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor||!(hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role)))return res.status(403).json({message:'Management access is required for purchase fulfilment.'});
  const item=db.purchaseRequests.find(x=>x.id===req.params.id&&recordInSchool(x,actor));if(!item)return res.status(404).json({message:'Purchase request not found.'});
  if(item.status!=='Approved')return res.status(409).json({message:'The purchase request must be approved first.'});
  const status=boundedText(req.body?.financeStatus,40);if(!['Approved for purchase','Ordered','Received'].includes(status))return res.status(400).json({message:'Choose a valid finance fulfilment status.'});
  item.financeStatus=status;item.financeUpdatedBy=actor.username;item.financeUpdatedAt=new Date().toISOString();res.json({success:true,item});
});

// School resource booking with collision prevention.
app.get('/api/resources/bookings', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  res.json(tenantRecords(db.resourceBookings,actor).filter(x=>x.status!=='Cancelled'));
});
app.post('/api/resources/bookings', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const resource=boundedText(req.body?.resource,160),date=boundedText(req.body?.date,30),startTime=boundedText(req.body?.startTime,10),endTime=boundedText(req.body?.endTime,10),purpose=boundedText(req.body?.purpose,500);
  if(!resource||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)||endTime<=startTime)return res.status(400).json({message:'Choose a resource, valid date and a start time before the end time.'});
  const conflict=tenantRecords(db.resourceBookings,actor).find(x=>x.status!=='Cancelled'&&normalizeComparableText(x.resource)===normalizeComparableText(resource)&&x.date===date&&startTime<x.endTime&&endTime>x.startTime);
  if(conflict)return res.status(409).json({message:`${resource} is already booked from ${conflict.startTime} to ${conflict.endTime}.`,conflict:{id:conflict.id,startTime:conflict.startTime,endTime:conflict.endTime,bookedByName:conflict.bookedByName}});
  const item=tagSchoolRecord(actor,{id:crypto.randomUUID(),resource,date,startTime,endTime,purpose,resourceType:boundedText(req.body?.resourceType||'Other',60),bookedBy:actor.username,bookedByName:actor.name||actor.username,status:'Booked',createdAt:new Date().toISOString()});
  db.resourceBookings.unshift(item);res.status(201).json({success:true,item});
});
app.patch('/api/resources/bookings/:id', (req,res) => {
  const actor=requireSchoolStaff(req);const item=actor&&db.resourceBookings.find(x=>x.id===req.params.id&&recordInSchool(x,actor));if(!item)return res.status(404).json({message:'Booking not found.'});
  if(!(hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role))&&normalizeUsername(item.bookedBy)!==normalizeUsername(actor.username))return res.status(403).json({message:'You can only cancel your own booking.'});
  if(req.body?.status!=='Cancelled')return res.status(400).json({message:'Bookings can only be cancelled here.'});item.status='Cancelled';item.cancelledBy=actor.username;item.cancelledAt=new Date().toISOString();res.json({success:true,item});
});

// Maintenance & work orders
const MAINTENANCE_STATUSES = new Set(['Open','In Progress','Completed']);
app.get('/api/maintenance', (req,res) => {
  const actor=requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=tenantRecords(db.maintenanceOrders,actor);
  res.json((hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role))?rows:rows.filter(x=>normalizeUsername(x.reportedBy)===normalizeUsername(actor.username)||normalizeUsername(x.assignedTo)===normalizeUsername(actor.username)));
});
app.post('/api/maintenance', (req,res) => {
  const actor=requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const title=boundedText(req.body?.title,180),location=boundedText(req.body?.location,180);
  if(!title||!location)return res.status(400).json({message:'Add an issue and location.'});
  const item=tagSchoolRecord(actor,{id:crypto.randomUUID(),title,details:boundedText(req.body?.details,3000),location,category:boundedText(req.body?.category||'General',80),priority:boundedText(req.body?.priority||'Normal',30),status:'Open',reportedBy:actor.username,reportedByName:actor.name||actor.username,assignedTo:'',assignedToName:'',createdAt:new Date().toISOString()});
  db.maintenanceOrders.unshift(item);res.status(201).json({success:true,item});
});
app.patch('/api/maintenance/:id', (req,res) => {
  const actor=requireSchoolStaff(req);const item=actor&&db.maintenanceOrders.find(x=>x.id===req.params.id&&recordInSchool(x,actor));if(!item)return res.status(404).json({message:'Work order not found.'});
  const manager=(hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role)),assigned=normalizeUsername(item.assignedTo)===normalizeUsername(actor.username);
  if(!manager&&!assigned)return res.status(403).json({message:'Only management or the assigned staff member can update this work order.'});
  if(req.body?.assignedTo!==undefined){if(!manager)return res.status(403).json({message:'Only management can assign work orders.'});const account=req.body.assignedTo?staffAccountInSchool(actor,req.body.assignedTo):null;if(req.body.assignedTo&&!account)return res.status(400).json({message:'Choose staff from this school.'});item.assignedTo=account?.username||'';item.assignedToName=account?.name||account?.username||'';}
  if(req.body?.status!==undefined){const status=boundedText(req.body.status,30);if(!MAINTENANCE_STATUSES.has(status))return res.status(400).json({message:'Choose a valid work-order status.'});item.status=status;if(status==='Completed'){item.completedAt=new Date().toISOString();item.completionNotes=boundedText(req.body?.completionNotes,2000);}}
  item.updatedAt=new Date().toISOString();res.json({success:true,item});
});

// Meeting minutes turn approved meeting tickets into accountable staff work.
app.get('/api/staff/meetings', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const tickets = tenantRecords(db.tickets, actor).filter(item => item.ticketType === 'Meeting request' && item.meetingDecision === 'Approved');
  const minutes = tenantRecords(db.meetingMinutes, actor);
  res.json(tickets.map(ticket => ({ ...ticket, minutes: minutes.find(item => item.ticketId === ticket.id) || null })));
});
app.post('/api/staff/meetings/:id/minutes', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can record meeting minutes.' });
  const ticket = db.tickets.find(item => item.id === req.params.id && recordInSchool(item, actor) && item.ticketType === 'Meeting request' && item.meetingDecision === 'Approved');
  if (!ticket) return res.status(404).json({ message: 'Approved meeting request not found.' });
  if (db.meetingMinutes.some(item => item.ticketId === ticket.id && recordInSchool(item, actor))) return res.status(409).json({ message: 'Minutes have already been recorded for this meeting.' });
  const summary = boundedText(req.body?.summary, 5000);
  if (!summary) return res.status(400).json({ message: 'Add meeting minutes before saving.' });
  const actions = Array.isArray(req.body?.actions) ? req.body.actions.slice(0, 30) : [];
  const createdTasks = [];
  for (const action of actions) {
    const title = boundedText(action?.title, 180);
    if (!title) continue;
    const assignee = staffAccountInSchool(actor, action?.assignedTo);
    if (!assignee) return res.status(400).json({ message: 'Every action item must be assigned to staff from this school.' });
    const dueDate = boundedText(action?.dueDate, 30);
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ message: 'Choose a valid action-item due date.' });
    createdTasks.push(tagSchoolRecord(actor, { id: crypto.randomUUID(), title, details: `Meeting action · ${ticket.subject}`, priority: boundedText(action?.priority || 'Normal', 30), dueDate, status:'Open', assignedTo:assignee.username, assignedToName:assignee.name || assignee.username, createdBy:actor.username, sourceType:'Meeting', sourceId:ticket.id, createdAt:new Date().toISOString() }));
  }
  const item = tagSchoolRecord(actor, { id:crypto.randomUUID(), ticketId:ticket.id, subject:ticket.subject, summary, attendees:boundedText(req.body?.attendees, 2000), decisions:boundedText(req.body?.decisions, 4000), actionTaskIds:createdTasks.map(task=>task.id), recordedBy:actor.username, recordedByName:actor.name || actor.username, createdAt:new Date().toISOString() });
  db.staffTasks.unshift(...createdTasks); db.meetingMinutes.unshift(item); ticket.minutesRecordedAt=item.createdAt; ticket.minutesId=item.id;
  res.status(201).json({ success:true, item, createdTasks });
});

// Staff notice board with per-staff acknowledgement tracking.
app.get('/api/staff/notices', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const staff = tenantRecords(db.users, actor).filter(account => (hasPlatformAccess(account) || ['teacher', 'principal', 'admin', 'staff'].includes(account.role)) && !String(account.verificationStatus || '').toLowerCase().includes('pending'));
  const rows = tenantRecords(db.staffNotices, actor).map(notice => {
    const acknowledgedBy = Array.isArray(notice.acknowledgedBy) ? notice.acknowledgedBy : [];
    const acknowledged = acknowledgedBy.some(entry => normalizeUsername(entry.username) === normalizeUsername(actor.username));
    const eligible = staff.filter(account => notice.audience === 'All staff' || account.role === notice.audience);
    return { ...notice, acknowledged, acknowledgedCount: eligible.filter(account => acknowledgedBy.some(entry => normalizeUsername(entry.username) === normalizeUsername(account.username))).length, audienceCount: eligible.length,
      outstanding: (hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role)) ? eligible.filter(account => !acknowledgedBy.some(entry => normalizeUsername(entry.username) === normalizeUsername(account.username))).map(account => ({ username: account.username, name: account.name || account.username })) : undefined };
  });
  res.json(rows);
});
app.post('/api/staff/notices', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin','principal','staff'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can publish staff notices.' });
  const title = boundedText(req.body?.title, 180), message = boundedText(req.body?.message, 5000);
  if (!title || !message) return res.status(400).json({ message: 'Add a notice title and message.' });
  const audience = ['All staff','teacher','principal','admin'].includes(req.body?.audience) ? req.body.audience : 'All staff';
  const dueDate = boundedText(req.body?.dueDate, 30);
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ message: 'Choose a valid acknowledgement due date.' });
  const item = tagSchoolRecord(actor, { id: crypto.randomUUID(), title, message, audience, required: req.body?.required !== false, dueDate, createdBy: actor.username, createdByName: actor.name || actor.username, acknowledgedBy: [], createdAt: new Date().toISOString() });
  db.staffNotices.unshift(item); res.status(201).json({ success:true, item });
});
app.post('/api/staff/notices/:id/acknowledge', (req, res) => {
  const actor = requireSchoolStaff(req);
  const item = actor && db.staffNotices.find(record => record.id === req.params.id && recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Staff notice not found.' });
  if (item.audience !== 'All staff' && item.audience !== actor.role) return res.status(403).json({ message: 'This notice is not addressed to your role.' });
  item.acknowledgedBy = Array.isArray(item.acknowledgedBy) ? item.acknowledgedBy : [];
  if (!item.acknowledgedBy.some(entry => normalizeUsername(entry.username) === normalizeUsername(actor.username))) item.acknowledgedBy.push({ username: actor.username, name: actor.name || actor.username, acknowledgedAt: new Date().toISOString() });
  res.json({ success:true, item });
});

// Management approvals centre aggregates existing workflows without duplicating their records.
app.get('/api/approvals', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'accounts', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'School management access is required.' });
  const leave = tenantRecords(db.staffLeave, actor).filter(item => item.status === 'Pending').map(item => ({
    id: item.id, type: 'Leave', title: `${item.staffName} · ${item.leaveType}`, detail: `${item.startDate} to ${item.endDate}`, createdAt: item.createdAt, actions: ['Approve', 'Reject']
  }));
  const meetings = tenantRecords(db.tickets, actor).filter(item => item.ticketType === 'Meeting request' && item.status !== 'Completed').map(item => ({
    id: item.id, type: 'Meeting', title: item.subject, detail: [item.createdByName || item.createdBy, item.meetingDate, item.meetingTime, item.meetingLocation].filter(Boolean).join(' · '), createdAt: item.createdAt, actions: ['Approve', 'Reject']
  }));
  const purchases = tenantRecords(db.purchaseRequests, actor).filter(item => item.status === 'Pending').map(item => ({ id:item.id, type:'Purchase', title:`${item.itemName} × ${item.quantity}`, detail:`${item.requestedByName} · Estimated R${item.estimatedTotal.toFixed(2)} · ${item.reason}`, createdAt:item.createdAt, actions:['Approve','Reject'] }));
  res.json([...leave, ...meetings, ...purchases].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});
app.post('/api/approvals/:type/:id', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'accounts', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'School management access is required.' });
  const decision = boundedText(req.body?.decision, 20);
  if (!['Approve', 'Reject'].includes(decision)) return res.status(400).json({ message: 'Choose Approve or Reject.' });
  if (req.params.type === 'Leave') {
    const item = db.staffLeave.find(record => record.id === req.params.id && recordInSchool(record, actor));
    if (!item || item.status !== 'Pending') return res.status(404).json({ message: 'Pending leave request not found.' });
    item.status = decision === 'Approve' ? 'Approved' : 'Rejected'; item.reviewedBy = actor.username; item.reviewedAt = new Date().toISOString();
    return res.json({ success: true, item });
  }
  if (req.params.type === 'Purchase') {
    const item=db.purchaseRequests.find(record=>record.id===req.params.id&&recordInSchool(record,actor));
    if(!item||item.status!=='Pending')return res.status(404).json({message:'Pending purchase request not found.'});
    item.status=decision==='Approve'?'Approved':'Rejected';item.financeStatus=decision==='Approve'?'Approved for purchase':'Rejected';item.reviewedBy=actor.username;item.reviewedAt=new Date().toISOString();
    return res.json({success:true,item});
  }
  if (req.params.type === 'Meeting') {
    const item = db.tickets.find(record => record.id === req.params.id && recordInSchool(record, actor) && record.ticketType === 'Meeting request' && record.status !== 'Completed');
    if (!item) return res.status(404).json({ message: 'Meeting request not found.' });
    item.meetingDecision = decision === 'Approve' ? 'Approved' : 'Rejected'; item.meetingDecisionBy = actor.username; item.meetingDecisionAt = new Date().toISOString(); item.status = 'Completed';
    return res.json({ success: true, item });
  }
  res.status(400).json({ message: 'Unsupported approval type.' });
});

// Staff performance reviews / KPI
const KPI_RATINGS = new Set([1, 2, 3, 4, 5]);
app.get('/api/staff/performance-reviews', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = tenantRecords(db.performanceReviews, actor);
  if ((hasPlatformAccess(actor) || ['admin', 'principal', 'staff'].includes(actor.role))) return res.json(records);
  res.json(records.filter(item => normalizeUsername(item.username) === normalizeUsername(actor.username)));
});
app.post('/api/staff/performance-reviews', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'accounts', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can create performance reviews.' });
  const employee = staffAccountInSchool(actor, req.body?.username);
  if (!employee) return res.status(400).json({ message: 'Choose a staff member from this school.' });
  const criteriaInput = Array.isArray(req.body?.criteria) ? req.body.criteria : [];
  const criteria = criteriaInput.slice(0, 20).map(entry => ({
    name: boundedText(entry?.name, 120),
    rating: Number(entry?.rating),
    comment: boundedText(entry?.comment, 1000)
  })).filter(entry => entry.name && KPI_RATINGS.has(entry.rating));
  if (!criteria.length) return res.status(400).json({ message: 'Add at least one KPI with a rating from 1 to 5.' });
  const averageRating = Number((criteria.reduce((sum, entry) => sum + entry.rating, 0) / criteria.length).toFixed(2));
  const item = tagSchoolRecord(actor, {
    id: crypto.randomUUID(), username: employee.username, staffName: employee.name || employee.username,
    reviewPeriod: monthKey(req.body?.reviewPeriod), reviewDate: boundedText(req.body?.reviewDate, 30) || new Date().toISOString().slice(0, 10),
    criteria, averageRating, strengths: boundedText(req.body?.strengths, 2500), development: boundedText(req.body?.development, 2500),
    goals: boundedText(req.body?.goals, 2500), managerComment: boundedText(req.body?.managerComment, 2500),
    employeeComment: '', status: 'Draft', reviewedBy: actor.username, reviewedByName: actor.name || actor.username, createdAt: new Date().toISOString()
  });
  db.performanceReviews.unshift(item);
  res.status(201).json({ success: true, item });
});
app.patch('/api/staff/performance-reviews/:id', (req, res) => {
  const actor = requireSchoolStaff(req);
  const item = actor && db.performanceReviews.find(record => record.id === req.params.id && recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Performance review not found.' });
  const isEmployee = normalizeUsername(item.username) === normalizeUsername(actor.username);
  const isManager = (hasPlatformAccess(actor) || ['admin', 'principal', 'staff'].includes(actor.role));
  if (!isEmployee && !isManager) return res.status(403).json({ message: 'You cannot update this performance review.' });
  if (isEmployee) {
    item.employeeComment = boundedText(req.body?.employeeComment, 2500);
    if (req.body?.acknowledged === true) { item.status = 'Acknowledged'; item.acknowledgedAt = new Date().toISOString(); }
  } else {
    const nextStatus = boundedText(req.body?.status || item.status, 30);
    if (!['Draft', 'Shared', 'Acknowledged'].includes(nextStatus)) return res.status(400).json({ message: 'Choose a valid review status.' });
    item.status = nextStatus;
    if (nextStatus === 'Shared' && !item.sharedAt) item.sharedAt = new Date().toISOString();
  }
  item.updatedAt = new Date().toISOString();
  res.json({ success: true, item });
});

// Staff workplace: tasks, leave and teacher cover
const WORK_TASK_STATUSES = new Set(['Open', 'In Progress', 'Completed']);
const LEAVE_STATUSES = new Set(['Pending', 'Approved', 'Rejected', 'Cancelled']);
const COVER_STATUSES = new Set(['Needs Cover', 'Assigned', 'Completed', 'Cancelled']);
const staffAccountInSchool = (actor, username) => {
  const account = findAccountByUsername(boundedText(username, 160));
  return account && (hasPlatformAccess(account) || ['teacher', 'principal', 'admin', 'staff'].includes(account.role)) && isSameSchool(actor, account) ? account : null;
};

app.get('/api/staff/tasks', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = tenantRecords(db.staffTasks, actor);
  if ((hasPlatformAccess(actor) || ['admin', 'principal', 'staff'].includes(actor.role))) return res.json(records);
  res.json(records.filter(item => normalizeUsername(item.assignedTo) === normalizeUsername(actor.username) || normalizeUsername(item.createdBy) === normalizeUsername(actor.username)));
});
app.post('/api/staff/tasks', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const assignee = staffAccountInSchool(actor, req.body?.assignedTo || actor.username);
  const title = boundedText(req.body?.title, 180);
  if (!assignee || !title) return res.status(400).json({ message: 'Choose a staff member from this school and add a task title.' });
  if (actor.role === 'teacher' && normalizeUsername(assignee.username) !== normalizeUsername(actor.username)) return res.status(403).json({ message: 'Teachers can create tasks for themselves. Management can assign tasks to staff.' });
  const item = tagSchoolRecord(actor, { id: crypto.randomUUID(), title, details: boundedText(req.body?.details, 3000), priority: boundedText(req.body?.priority || 'Normal', 30), dueDate: boundedText(req.body?.dueDate, 30), status: 'Open', assignedTo: assignee.username, assignedToName: assignee.name || assignee.username, createdBy: actor.username, createdAt: new Date().toISOString() });
  db.staffTasks.unshift(item);
  res.status(201).json({ success: true, item });
});
app.patch('/api/staff/tasks/:id', (req, res) => {
  const actor = requireSchoolStaff(req);
  const item = actor && db.staffTasks.find(record => record.id === req.params.id && recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Task not found.' });
  const canManage = (hasPlatformAccess(actor) || ['admin', 'principal', 'staff'].includes(actor.role)) || normalizeUsername(item.assignedTo) === normalizeUsername(actor.username);
  if (!canManage) return res.status(403).json({ message: 'You cannot update this task.' });
  const status = boundedText(req.body?.status || item.status, 30);
  if (!WORK_TASK_STATUSES.has(status)) return res.status(400).json({ message: 'Choose a valid task status.' });
  item.status = status;
  item.updatedAt = new Date().toISOString();
  res.json({ success: true, item });
});

app.get('/api/staff/leave', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = tenantRecords(db.staffLeave, actor);
  res.json((hasPlatformAccess(actor) || ['admin', 'principal', 'staff'].includes(actor.role)) ? records : records.filter(item => normalizeUsername(item.username) === normalizeUsername(actor.username)));
});
app.post('/api/staff/leave', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const startDate = boundedText(req.body?.startDate, 30);
  const endDate = boundedText(req.body?.endDate || startDate, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return res.status(400).json({ message: 'Choose a valid leave date range.' });
  const item = tagSchoolRecord(actor, { id: crypto.randomUUID(), username: actor.username, staffName: actor.name || actor.username, leaveType: boundedText(req.body?.leaveType || 'Annual leave', 80), startDate, endDate, reason: boundedText(req.body?.reason, 1500), status: 'Pending', createdAt: new Date().toISOString() });
  db.staffLeave.unshift(item);
  res.status(201).json({ success: true, item });
});
app.patch('/api/staff/leave/:id', (req, res) => {
  const actor = requireSchoolStaff(req);
  const item = actor && db.staffLeave.find(record => record.id === req.params.id && recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Leave request not found.' });
  const requestedStatus = boundedText(req.body?.status, 30);
  if (!LEAVE_STATUSES.has(requestedStatus)) return res.status(400).json({ message: 'Choose a valid leave status.' });
  const ownCancellation = requestedStatus === 'Cancelled' && normalizeUsername(item.username) === normalizeUsername(actor.username) && item.status === 'Pending';
  if (!(hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'accounts', 'school_accounts'].includes(actor.role)) && !ownCancellation) return res.status(403).json({ message: 'Management approval is required.' });
  item.status = requestedStatus;
  item.reviewedBy = actor.username;
  item.reviewedAt = new Date().toISOString();
  res.json({ success: true, item });
});

app.get('/api/staff/cover', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = tenantRecords(db.teacherCover, actor);
  res.json((hasPlatformAccess(actor) || ['admin', 'principal', 'staff'].includes(actor.role)) ? records : records.filter(item => [item.absentTeacher, item.coverTeacher].some(username => normalizeUsername(username) === normalizeUsername(actor.username))));
});
app.post('/api/staff/cover', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'accounts', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can create cover assignments.' });
  const absent = staffAccountInSchool(actor, req.body?.absentTeacher);
  const cover = req.body?.coverTeacher ? staffAccountInSchool(actor, req.body.coverTeacher) : null;
  const date = boundedText(req.body?.date, 30);
  if (!absent || absent.role !== 'teacher' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Choose an absent teacher and a valid cover date.' });
  if (cover && cover.role !== 'teacher') return res.status(400).json({ message: 'Cover must be assigned to a teacher.' });
  const item = tagSchoolRecord(actor, { id: crypto.randomUUID(), absentTeacher: absent.username, absentTeacherName: absent.name || absent.username, coverTeacher: cover?.username || '', coverTeacherName: cover ? (cover.name || cover.username) : '', date, period: boundedText(req.body?.period, 80), className: boundedText(req.body?.className, 120), notes: boundedText(req.body?.notes, 1500), status: cover ? 'Assigned' : 'Needs Cover', createdBy: actor.username, createdAt: new Date().toISOString() });
  db.teacherCover.unshift(item);
  res.status(201).json({ success: true, item });
});
app.patch('/api/staff/cover/:id', (req, res) => {
  const actor = requireSchoolStaff(req);
  const item = actor && db.teacherCover.find(record => record.id === req.params.id && recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Cover assignment not found.' });
  if (!(hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'accounts', 'school_accounts'].includes(actor.role)) && normalizeUsername(item.coverTeacher) !== normalizeUsername(actor.username)) return res.status(403).json({ message: 'You cannot update this cover assignment.' });
  const status = boundedText(req.body?.status || item.status, 30);
  if (!COVER_STATUSES.has(status)) return res.status(400).json({ message: 'Choose a valid cover status.' });
  item.status = status;
  item.updatedAt = new Date().toISOString();
  res.json({ success: true, item });
});

app.get('/api/attendance', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view attendance.' });
  res.json(learnerRecordsVisibleTo(db.attendance, actor));
});
app.post('/api/attendance', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can record attendance.' });
  const studentName = boundedText(req.body?.studentName, 160);
  const status = boundedText(req.body?.status || 'Checked In', 40);
  if (!studentName || !ATTENDANCE_STATUSES.has(status)) return res.status(400).json({ message: 'Enter a learner and valid attendance status.' });
  const item = tagSchoolRecord(actor, { id: crypto.randomUUID(), studentName, status, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), recordedBy: actor.username });
  db.attendance.unshift(item);
  res.json({ success: true, item });
});
app.post('/api/attendance/import', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can import attendance.' });
  const { attendance } = req.body;
  if (!Array.isArray(attendance) || !attendance.length) return res.status(400).json({ message: 'Add at least one attendance record to import.' });
  if (attendance.length > 2000) return res.status(400).json({ message: 'Import up to 2,000 attendance records per file.' });
  {
    const cleanAttendance = attendance.map(item => ({
      studentName: boundedText(item?.studentName, 160),
      status: boundedText(item?.status || 'Checked In', 40)
    })).filter(item => item.studentName && ATTENDANCE_STATUSES.has(item.status));
    db.attendance.unshift(...cleanAttendance.map(item => tagSchoolRecord(actor, { ...item, id: crypto.randomUUID(), timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), recordedBy: actor.username })));
  }
  res.json({ success: true });
});
app.post('/api/attendance/toggle', (req, res) => {
  const actor = getSessionAccount(req);
  const { id } = req.body;
  const status = boundedText(req.body?.status, 40);
  const item = db.attendance.find(a => a.id === id && recordInSchool(a, actor));
  if (!actor || !item || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(404).json({ message: 'Attendance record not found.' });
  if (!ATTENDANCE_STATUSES.has(status)) return res.status(400).json({ message: 'Choose a valid attendance status.' });
  item.status = status;
  res.json({ success: true });
});
app.delete('/api/attendance/:id', (req, res) => {
  const actor = getSessionAccount(req);
  const item = db.attendance.find(a => a.id === req.params.id && recordInSchool(a, actor));
  if (!actor || !item || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(404).json({ message: 'Attendance record not found.' });
  db.attendance = db.attendance.filter(a => a !== item);
  res.json({ success: true });
});
app.post('/api/attendance/clear', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can clear attendance.' });
  db.attendance = db.attendance.filter(item => !recordInSchool(item, actor));
  res.json({ success: true });
});

// Tickets
app.post('/api/school-applications', (req, res) => {
  const applicant = getSessionAccount(req);
  if (!applicant || String(applicant.verificationStatus || '').toLowerCase().includes('pending')) {
    return res.status(403).json({ message: 'Use an active, verified Little Feet account before applying to a school.' });
  }
  if (applicant.role !== 'parent') return res.status(403).json({ message: 'School applications can only be submitted from a verified parent account.' });
  const schoolName = String(req.body?.schoolName || '').trim().slice(0, 160);
  const guardianName = String(req.body?.guardianName || '').trim().slice(0, 120);
  const contactPhone = String(req.body?.contactPhone || '').trim().slice(0, 50);
  const contactEmail = String(req.body?.contactEmail || '').trim().slice(0, 160);
  const learnerName = String(req.body?.learnerName || '').trim().slice(0, 120);
  const dateOfBirth = String(req.body?.dateOfBirth || '').trim().slice(0, 20);
  const intendedStart = String(req.body?.intendedStart || '').trim().slice(0, 20);
  const gradeOrAgeGroup = boundedText(req.body?.gradeOrAgeGroup, 80);
  const educationStage = educationStageForSelection(gradeOrAgeGroup);
  const homeArea = String(req.body?.homeArea || '').trim().slice(0, 160);
  const notes = String(req.body?.notes || '').trim().slice(0, 1200);
  if (!schoolName || !guardianName || !contactPhone || !contactEmail || !learnerName || !dateOfBirth || !intendedStart || !gradeOrAgeGroup || !homeArea || !notes) {
    return res.status(400).json({ message: 'Complete the contact, learner, start-date, age/grade, area and application details.' });
  }
  if (!APPLICATION_STAGE_SELECTIONS.has(gradeOrAgeGroup)) {
    return res.status(400).json({ message: 'Choose a recognised Little Feet age group or school grade.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(contactEmail)) return res.status(400).json({ message: 'Enter a valid contact email address.' });
  if (!validDateKey(dateOfBirth) || dateOfBirth >= dateKeyInSouthAfrica()) return res.status(400).json({ message: 'Enter a valid learner date of birth.' });
  if (!validDateKey(intendedStart)) return res.status(400).json({ message: 'Enter a valid intended start date.' });
  const principal = db.users.find(account => account.role === 'principal' && normalizeComparableText(account.schoolName) === normalizeComparableText(schoolName) && !String(account.verificationStatus || '').toLowerCase().includes('pending'));
  if (!principal) return res.status(409).json({ message: 'This school is not yet available for Little Feet applications. Ask the school to activate its principal account first.' });
  const application = { guardianName, contactPhone, contactEmail, learnerName, dateOfBirth, intendedStart, gradeOrAgeGroup, educationStage, homeArea, notes };
  const ticket = {
    id: crypto.randomUUID(), department: 'Admissions', category: 'School application', priority: 'Normal', subject: `School application · ${learnerName}`,
    message: `Application for ${schoolName}`, application, schoolName, createdBy: applicant.username, createdByName: applicant.name || applicant.username,
    assignedTo: principal.username, schoolId: accountSchoolId(principal), status: 'Open', monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }), createdAt: new Date().toISOString()
  };
  db.tickets.unshift(ticket);
  res.status(201).json({ success: true, ticket: { id: ticket.id, assignedTo: principal.name || principal.username, status: ticket.status } });
});

app.post('/api/account-deletion-request', (req, res) => {
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in before requesting account deletion.' });
  if (isAdminLike(requester)) return res.status(400).json({ message: 'Administrators can manage accounts directly from Account Management.' });

  const schoolId = accountSchoolId(requester);
  const existing = db.tickets.find(ticket =>
    recordInSchool(ticket, requester) &&
    ticket.category === 'Account deletion request' &&
    normalizeUsername(ticket.createdBy) === normalizeUsername(requester.username) &&
    ticket.status !== 'Completed'
  );
  if (existing) return res.status(409).json({ message: 'An account deletion request is already waiting for administrator review.', ticketId: existing.id });

  const administrator = db.users.find(account =>
    account.role === 'admin' &&
    accountSchoolId(account) === schoolId &&
    !String(account.verificationStatus || '').toLowerCase().includes('pending')
  );
  if (!administrator) return res.status(409).json({ message: 'No active administrator is available for this school yet.' });

  const ticket = tagSchoolRecord(requester, {
    id: crypto.randomUUID(),
    department: 'Admin',
    category: 'Account deletion request',
    priority: 'High',
    subject: `Account deletion request · ${requester.name || requester.username}`,
    message: [
      'ACCOUNT DELETION REQUEST',
      `Name: ${requester.name || 'Not recorded'}`,
      `Username / email: ${requester.username}`,
      `Role: ${requester.role}`,
      `School: ${requester.schoolName || 'Not recorded'}`,
      `Requested at: ${new Date().toISOString()}`,
      '',
      'The signed-in user requested deletion of their Little Feet account. Verify the requester and complete the approved account-deletion process.'
    ].join('\n'),
    createdBy: requester.username,
    createdByName: requester.name || requester.username,
    assignedTo: administrator.username,
    status: 'Open',
    monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }),
    createdAt: new Date().toISOString()
  });
  db.tickets.unshift(ticket);
  res.status(201).json({ success: true, ticket: { id: ticket.id, assignedTo: administrator.name || administrator.username, status: ticket.status } });
});

app.post('/api/school-deletion-request', (req, res) => {
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in before requesting school deletion.' });
  if (requester.role !== 'principal') {
    return res.status(403).json({ message: 'Only the school principal can request deletion of the entire school account and its linked data.' });
  }

  const existing = db.tickets.find(ticket =>
    recordInSchool(ticket, requester) &&
    ticket.category === 'School deletion request' &&
    ticket.status !== 'Completed'
  );
  if (existing) return res.status(409).json({ message: 'A school deletion request is already waiting for administrator review.', ticketId: existing.id });

  const administrator = db.users.find(account =>
    account.role === 'admin' &&
    isSameSchool(requester, account) &&
    !String(account.verificationStatus || '').toLowerCase().includes('pending')
  );
  if (!administrator) return res.status(409).json({ message: 'No active administrator is available for this school yet.' });

  const ticket = tagSchoolRecord(requester, {
    id: crypto.randomUUID(),
    department: 'Admin',
    category: 'School deletion request',
    priority: 'High',
    subject: `SCHOOL DELETION REQUEST · ${requester.schoolName}`,
    message: [
      'SCHOOL DELETION REQUEST',
      `School: ${requester.schoolName || 'Not recorded'}`,
      `School ID: ${accountSchoolId(requester)}`,
      `Requested by: ${requester.name || requester.username}`,
      `Username / email: ${requester.username}`,
      `Role: ${requester.role}`,
      `Requested at: ${new Date().toISOString()}`,
      '',
      'WARNING: Approval permanently deletes every account and every school-scoped record linked to this school. The administrator must verify the request before approval.'
    ].join('\n'),
    createdBy: requester.username,
    createdByName: requester.name || requester.username,
    assignedTo: administrator.username,
    status: 'Open',
    monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }),
    createdAt: new Date().toISOString()
  });
  db.tickets.unshift(ticket);
  res.status(201).json({ success: true, ticket: { id: ticket.id, assignedTo: administrator.name || administrator.username, status: ticket.status } });
});

app.get('/api/tickets', (req, res) => {
  const viewer = getSessionAccount(req);
  if (!viewer) return res.status(401).json({ message: 'Sign in to view your support tickets.' });
  const schoolTickets = tenantRecords(db.tickets, viewer);
  if (hasPlatformAccess(viewer) || ['crm', 'support'].includes(viewer.role)) return res.json(db.tickets);
  if (isAdminLike(viewer)) return res.json(schoolTickets);
  const visibleTickets = schoolTickets.filter(ticket =>
    normalizeUsername(ticket.createdBy) === normalizeUsername(viewer.username) ||
    normalizeUsername(ticket.assignedTo) === normalizeUsername(viewer.username)
  );
  res.json(visibleTickets);
});
app.post('/api/tickets', (req, res) => {
  const assignedTo = boundedText(req.body?.assignedTo, 160);
  const creator = getSessionAccount(req);
  if (!creator) return res.status(401).json({ message: 'Sign in to create a support ticket.' });
  const canAssignTicket = isAdminLike(creator) || ['crm', 'support'].includes(creator.role);
  const assignedAccount = canAssignTicket ? findAccountByUsername(assignedTo) : null;
  if (assignedTo && (!assignedAccount || (!hasPlatformAccess(creator) && !['crm', 'support'].includes(creator.role) && !isSameSchool(creator, assignedAccount)))) {
    return res.status(400).json({ message: 'Choose an account from this school for the ticket assignment.' });
  }
  const department = boundedText(req.body?.department || 'Admin', 80);
  const priority = boundedText(req.body?.priority || 'Normal', 40);
  const subject = boundedText(req.body?.subject, 200);
  const message = boundedText(req.body?.message, 5000);
  if (!subject || !message) return res.status(400).json({ message: 'Add a ticket subject and message.' });
  const item = tagSchoolRecord(creator, {
    id: crypto.randomUUID(),
    department,
    category: boundedText(req.body?.category, 100),
    priority,
    subject,
    message,
    ticketType: boundedText(req.body?.ticketType || 'Help request', 40),
    meetingDate: boundedText(req.body?.meetingDate, 30),
    meetingTime: boundedText(req.body?.meetingTime, 20),
    meetingLocation: boundedText(req.body?.meetingLocation, 200),
    createdBy: creator.username,
    createdByName: creator.name || creator.username,
    assignedTo: assignedAccount?.username || '',
    status: 'Open',
    monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }),
    createdAt: new Date().toISOString()
  });
  db.tickets.unshift(item);
  res.json({ success: true, item });
});
const purgeSchoolData = schoolId => {
  const chatGroupIds = new Set((db.chatGroups || []).filter(group => group.schoolId === schoolId).map(group => String(group.id)));
  for (const [key, value] of Object.entries(db)) {
    if (!Array.isArray(value)) continue;
    if (key === 'storageCleanupJobs') continue;
    if (key === 'schools') {
      db.schools = value.filter(record => record.id !== schoolId);
      continue;
    }
    if (key === 'releaseNotes') continue;
    db[key] = value.filter(record => record?.schoolId !== schoolId);
  }
  for (const [moduleName, records] of Object.entries(db.moduleRecords || {})) {
    db.moduleRecords[moduleName] = (records || []).filter(record => record?.schoolId !== schoolId);
  }
  for (const groupId of chatGroupIds) delete db.groupMessages[groupId];
  if (db.schoolBilling && typeof db.schoolBilling === 'object') delete db.schoolBilling[schoolId];
  if (db.schoolTerms && typeof db.schoolTerms === 'object') delete db.schoolTerms[schoolId];
};

app.post('/api/school-deletion/execute', async (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const ticketId = String(req.body?.ticketId || '');
  const confirmation = String(req.body?.confirmation || '').trim();
  if (confirmation !== 'DELETE SCHOOL') return res.status(400).json({ message: 'Type DELETE SCHOOL exactly to confirm the permanent deletion.' });

  const ticket = db.tickets.find(entry =>
    entry.id === ticketId &&
    entry.category === 'School deletion request' &&
    entry.status !== 'Completed' &&
    recordInSchool(entry, actor)
  );
  if (!ticket) return res.status(404).json({ message: 'Open school deletion request not found.' });

  const schoolId = accountSchoolId(actor);
  const schoolName = actor.schoolName;
  const schoolFiles = (db.fileRecords || []).filter(file => file.schoolId === schoolId && file.accessState !== 'deleted');
  const cleanupJob = queueStorageCleanup(schoolId, schoolFiles, 'school-deletion');
  if (cleanupJob) await saveDatabaseState();
  purgeSchoolData(schoolId);
  await saveDatabaseState();

  if (postgresPool) {
    await postgresPool.query(
      `DELETE FROM little_feet_sessions
       WHERE sess->'littleFeetUser'->>'schoolId' = $1`,
      [schoolId]
    );
  }

  if (cleanupJob) {
    const cleaned = await runStorageCleanupJob(cleanupJob);
    await saveDatabaseState();
    if (!cleaned) return res.status(503).json({ message: 'The school records were deleted, but private object cleanup requires an automatic retry.', cleanupJobId: cleanupJob.id });
  }

  req.persistenceCommitted = true;
  res.json({ success: true, deletedSchoolId: schoolId, deletedSchoolName: schoolName });
});

app.post('/api/tickets/update', (req, res) => {
  const { id, status, feedback, updatedBy, assignedTo } = req.body;
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to update a support ticket.' });
  const companyQueueAccess = hasPlatformAccess(actor) || ['crm', 'support'].includes(actor.role);
  const ticket = db.tickets.find(t => t.id === id && (companyQueueAccess || recordInSchool(t, actor)));
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found.' });
  const canManage = companyQueueAccess || isAdminLike(actor) || normalizeUsername(ticket.assignedTo) === normalizeUsername(actor.username);
  if (!canManage) return res.status(403).json({ message: 'Only the assigned account or an administrator can update this ticket.' });
  if (assignedTo !== undefined) {
    if (!(isAdminLike(actor) || ['crm', 'support'].includes(actor.role))) return res.status(403).json({ message: 'Only an administrator or authorised Little Feet support staff can change ticket assignments.' });
    const assignedAccount = assignedTo ? findAccountByUsername(assignedTo) : null;
    if (assignedTo && (!assignedAccount || (!companyQueueAccess && !isSameSchool(actor, assignedAccount)))) return res.status(400).json({ message: 'Choose an available account for the ticket assignment.' });
    ticket.assignedTo = assignedAccount?.username || '';
  }
  if (status !== undefined) {
    if (!['Open', 'Completed'].includes(status)) return res.status(400).json({ message: 'Ticket status must be Open or Completed.' });
    ticket.status = status;
  }
  if (feedback !== undefined) ticket.feedback = String(feedback || '').trim().slice(0, 5000);
  ticket.updatedBy = actor.username;
  res.json({ success: true, ticket });
});
app.delete('/api/tickets/:id', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const ticket = db.tickets.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found.' });
  db.tickets = db.tickets.filter(t => t !== ticket);
  res.json({ success: true });
});

// Chat - Groups
app.get('/api/chat/groups', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view school chat groups.' });
  if (!CHAT_ROLES.has(actor.role)) return res.status(403).json({ message: 'This role cannot access school chat.' });
  res.json(tenantRecords(db.chatGroups, actor));
});
app.post('/api/chat/groups', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can create groups.' });
  const groupName = String(req.body?.groupName || '').trim();
  if (!groupName) return res.status(400).json({ message: 'A group name is required.' });
  if (groupName.length > 120) return res.status(413).json({ message: 'Group names are limited to 120 characters.' });
  const id = crypto.randomUUID();
  db.chatGroups.push(tagSchoolRecord(actor, { id, groupName }));
  db.groupMessages[id] = [];
  res.json({ success: true, id });
});
app.delete('/api/chat/groups/:id', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const id = req.params.id;
  const group = db.chatGroups.find(entry => entry.id === id && recordInSchool(entry, actor));
  if (!group) return res.status(404).json({ message: 'Chat group not found.' });
  db.chatGroups = db.chatGroups.filter(g => g !== group);
  delete db.groupMessages[id];
  res.json({ success: true });
});

// Chat - Messages
app.get('/api/chat/messages/:groupId', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !CHAT_ROLES.has(actor.role)) return res.status(403).json({ message: 'This role cannot access school chat.' });
  const group = db.chatGroups.find(entry => entry.id === req.params.groupId && recordInSchool(entry, actor));
  if (!group) return res.status(404).json({ message: 'Chat group not found.' });
  const msgs = db.groupMessages[req.params.groupId] || [];
  res.json(msgs);
});
app.post('/api/chat/messages', (req, res) => {
  const { groupId, message, textColor } = req.body;
  const actor = getSessionAccount(req);
  if (!actor || !CHAT_ROLES.has(actor.role)) return res.status(403).json({ message: 'This role cannot access school chat.' });
  const group = db.chatGroups.find(entry => entry.id === groupId && recordInSchool(entry, actor));
  if (!group) return res.status(404).json({ message: 'Chat group not found.' });
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) return res.status(400).json({ message: 'A message is required.' });
  if (cleanMessage.length > 4000) return res.status(413).json({ message: 'Messages are limited to 4,000 characters.' });
  if (!db.groupMessages[groupId]) db.groupMessages[groupId] = [];
  const msgObj = {
    id: crypto.randomUUID(),
    sender: actor.username,
    message: cleanMessage,
    textColor: safeTextColor(textColor),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  db.groupMessages[groupId].push(msgObj);
  res.json({ success: true, msgObj });
});
app.delete('/api/chat/messages/:groupId/:messageId', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const group = db.chatGroups.find(entry => entry.id === req.params.groupId && recordInSchool(entry, actor));
  if (!group) return res.status(404).json({ message: 'Chat group not found.' });
  const messages = db.groupMessages[req.params.groupId];
  if (!messages) return res.status(404).json({ message: 'Chat group not found.' });
  const previousLength = messages.length;
  db.groupMessages[req.params.groupId] = messages.filter(message => message.id !== req.params.messageId);
  if (db.groupMessages[req.params.groupId].length === previousLength) return res.status(404).json({ message: 'Message not found.' });
  res.json({ success: true });
});

// Chat - Direct
app.get('/api/chat/direct/users', (req, res) => {
  const viewer = getSessionAccount(req);
  if (!viewer) return res.status(401).json({ message: 'A valid signed-in account is required.' });
  if (!CHAT_ROLES.has(viewer.role)) return res.status(403).json({ message: 'This role cannot access direct chat.' });
  res.json(db.users.filter(user => canUseDirectChat(viewer, user)).map(safeAccount));
});
app.get('/api/chat/direct/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  const viewer = getSessionAccount(req);
  const contact = findAccountByUsername(user2);
  if (!viewer || normalizeUsername(user1) !== normalizeUsername(viewer.username) || !canUseDirectChat(viewer, contact)) return res.status(403).json({ message: 'This private conversation is not available for these accounts.' });
  const msgs = db.directMessages.filter(
    m => recordInSchool(m, viewer) && ((m.sender === user1 && m.recipient === user2) || (m.sender === user2 && m.recipient === user1))
  );
  res.json(msgs);
});
app.post('/api/chat/direct', (req, res) => {
  const { recipient, message, textColor } = req.body;
  const senderAccount = getSessionAccount(req);
  const recipientAccount = findAccountByUsername(recipient);
  if (!canUseDirectChat(senderAccount, recipientAccount)) return res.status(403).json({ message: 'You can only message approved contacts at your school.' });
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) return res.status(400).json({ message: 'A message is required.' });
  if (cleanMessage.length > 4000) return res.status(413).json({ message: 'Messages are limited to 4,000 characters.' });
  const msgObj = tagSchoolRecord(senderAccount, {
    id: crypto.randomUUID(),
    sender: senderAccount.username,
    recipient: recipientAccount.username,
    message: cleanMessage,
    textColor: safeTextColor(textColor),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  db.directMessages.push(msgObj);
  res.json({ success: true, msgObj });
});
app.delete('/api/chat/direct/:messageId', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const message = db.directMessages.find(entry => entry.id === req.params.messageId && recordInSchool(entry, actor));
  if (!message) return res.status(404).json({ message: 'Message not found.' });
  db.directMessages = db.directMessages.filter(entry => entry !== message);
  res.json({ success: true });
});

// Location-aware emergency broadcasts. Exact incident coordinates remain visible
// only to authorised safety staff; recipients receive only applicable alerts.
const requireSafetyStaff = (req) => {
  const account = getSessionAccount(req);
  return account && (hasPlatformAccess(account) || ['admin', 'principal', 'staff'].includes(account.role)) ? account : null;
};
app.get('/api/broadcasts', (req, res) => {
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to view safety alerts.' });
  const latitude = Number(req.query.lat);
  const longitude = Number(req.query.lng);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const canSeeAll = (hasPlatformAccess(requester) || ['admin', 'principal', 'staff'].includes(requester.role));
  const visible = tenantRecords(db.broadcasts, requester).filter(item => {
    if (canSeeAll || !item.location || !Number(item.radiusKm)) return true;
    if (!hasLocation) return false;
    const latDistance = (latitude - Number(item.location.lat)) * 111.32;
    const lngDistance = (longitude - Number(item.location.lng)) * 111.32 * Math.cos(latitude * Math.PI / 180);
    return Math.hypot(latDistance, lngDistance) <= Number(item.radiusKm);
  }).map(item => {
    if (canSeeAll) return item;
    const { location, readBy, ...safeAlert } = item;
    return safeAlert;
  });
  res.json(visible);
});
app.post('/api/broadcasts', (req, res) => {
  const actor = requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator or principal can dispatch an emergency broadcast.' });
  const bcMessage = String(req.body?.bcMessage || '').trim();
  const bcPriority = String(req.body?.bcPriority || 'Campus Notice').trim().slice(0, 80);
  const latitude = Number(req.body?.location?.lat);
  const longitude = Number(req.body?.location?.lng);
  const radiusKm = Number(req.body?.radiusKm);
  if (!bcMessage || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ message: 'A message and valid alert location are required.' });
  }
  if (bcMessage.length > 2000) return res.status(413).json({ message: 'Emergency alerts are limited to 2,000 characters.' });
  if (!Number.isFinite(radiusKm) || radiusKm < 0.1 || radiusKm > 100) return res.status(400).json({ message: 'Alert radius must be between 0.1 km and 100 km.' });
  const item = tagSchoolRecord(actor, {
    id: crypto.randomUUID(),
    bcMessage,
    bcPriority,
    radiusKm,
    location: { lat: latitude, lng: longitude },
    issuedBy: actor.username,
    issuedAt: new Date().toISOString(),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    readBy: []
  });
  db.broadcasts.unshift(item);
  res.json({ success: true, item });
});
app.post('/api/broadcasts/:id/read', (req, res) => {
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to acknowledge an alert.' });
  const item = db.broadcasts.find(entry => entry.id === req.params.id && recordInSchool(entry, requester));
  if (!item) return res.status(404).json({ message: 'Alert not found.' });
  if (!item.readBy.includes(requester.username)) item.readBy.push(requester.username);
  res.json({ success: true, readCount: item.readBy.length });
});
app.delete('/api/broadcasts/:id', (req, res) => {
  const actor = requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Only authorised safety staff can remove a broadcast.' });
  const broadcast = db.broadcasts.find(item => item.id === req.params.id && recordInSchool(item, actor));
  if (!broadcast) return res.status(404).json({ message: 'Broadcast not found.' });
  db.broadcasts = db.broadcasts.filter(item => item !== broadcast);
  res.json({ success: true });
});

app.get('/api/safety-network', (req, res) => {
  const actor = requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Safety Network is available to authorised school safety staff.' });
  const presentLearners = tenantRecords(db.attendance, actor).filter(entry => /present|checked.?in/i.test(String(entry.status || ''))).length;
  const visitorsOnCampus = tenantRecords(db.campusVisitors, actor).filter(visitor => visitor.status === 'checked-in');
  const activeBroadcasts = tenantRecords(db.broadcasts, actor).filter(broadcast => !broadcast.closedAt);
  res.json({
    presentLearners,
    visitorsOnCampus: visitorsOnCampus.length,
    activeBroadcasts: activeBroadcasts.length,
    acknowledgements: activeBroadcasts.reduce((total, broadcast) => total + (broadcast.readBy?.length || 0), 0),
    visitors: visitorsOnCampus.map(({ passCodeHash, ...visitor }) => visitor)
  });
});

app.get('/api/campus-visitors', (req, res) => {
  const actor = requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Only authorised safety staff can view campus visitors.' });
  res.json(tenantRecords(db.campusVisitors, actor).map(({ passCodeHash, ...visitor }) => visitor));
});

app.get('/api/visitor-meetings/recipients', (req, res) => {
  const parent = getSessionAccount(req);
  if (!parent || parent.role !== 'parent') return res.status(403).json({ message: 'Only a signed-in parent can request a meeting.' });
  res.json(db.users.filter(account => ['teacher', 'principal'].includes(account.role) && isSameSchool(parent, account) && !String(account.verificationStatus || '').includes('pending')).map(safeAccount));
});

app.get('/api/visitor-meetings', (req, res) => {
  const user = getSessionAccount(req);
  if (!user || !(hasPlatformAccess(user) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(user.role))) return res.status(403).json({ message: 'You are not authorised to view meeting requests.' });
  const meetings = db.visitorMeetings.filter(meeting => {
    if (!recordInSchool(meeting, user)) return false;
    if (user.role === 'parent') return normalizeUsername(meeting.parentUsername) === normalizeUsername(user.username);
    if (user.role === 'teacher') return normalizeUsername(meeting.hostUsername) === normalizeUsername(user.username);
    return true;
  });
  res.json(meetings);
});

app.post('/api/visitor-meetings', (req, res) => {
  const parent = getSessionAccount(req);
  const host = findAccountByUsername(limitedText(req.body?.hostUsername, 160) || '');
  const proposedAt = limitedText(req.body?.proposedAt, 80);
  const purpose = limitedText(req.body?.purpose, 1200);
  if (!parent || parent.role !== 'parent' || !host || !['teacher', 'principal'].includes(host.role) || !isSameSchool(parent, host) || !proposedAt || !purpose) return res.status(400).json({ message: 'Choose an authorised teacher or principal, a proposed time, and a meeting purpose within the allowed limits.' });
  const meeting = tagSchoolRecord(parent, { id: crypto.randomUUID(), parentUsername: parent.username, parentName: parent.name || parent.username, hostUsername: host.username, hostName: host.name || host.username, proposedAt, agreedAt: null, purpose, status: 'awaiting-teacher-response', requestedAt: new Date().toISOString() });
  db.visitorMeetings.unshift(meeting);
  res.status(201).json({ success: true, meeting });
});

app.post('/api/visitor-meetings/:id/respond', (req, res) => {
  const staff = getSessionAccount(req);
  const meeting = db.visitorMeetings.find(entry => entry.id === req.params.id && recordInSchool(entry, staff));
  const action = String(req.body?.action || '');
  const agreedAt = String(req.body?.agreedAt || '').trim();
  if (!staff || !meeting || !['teacher', 'principal'].includes(staff.role) || normalizeUsername(meeting.hostUsername) !== normalizeUsername(staff.username) || meeting.status !== 'awaiting-teacher-response' || !['accept', 'counter'].includes(action)) return res.status(403).json({ message: 'This meeting cannot be updated by this account.' });
  meeting.agreedAt = action === 'accept' ? meeting.proposedAt : agreedAt;
  if (!meeting.agreedAt) return res.status(400).json({ message: 'Provide an alternative meeting time.' });
  meeting.status = 'awaiting-parent-confirmation';
  meeting.respondedAt = new Date().toISOString();
  res.json({ success: true, meeting });
});

app.post('/api/visitor-meetings/:id/confirm', (req, res) => {
  const parent = getSessionAccount(req);
  const meeting = db.visitorMeetings.find(entry => entry.id === req.params.id && recordInSchool(entry, parent));
  if (!parent || !meeting || parent.role !== 'parent' || normalizeUsername(meeting.parentUsername) !== normalizeUsername(parent.username) || meeting.status !== 'awaiting-parent-confirmation') return res.status(403).json({ message: 'This meeting cannot be confirmed by this account.' });
  meeting.status = 'awaiting-principal-approval';
  meeting.parentConfirmedAt = new Date().toISOString();
  res.json({ success: true, meeting });
});

app.post('/api/visitor-meetings/:id/approve-visitor', (req, res) => {
  const principal = getSessionAccount(req);
  const meeting = db.visitorMeetings.find(entry => entry.id === req.params.id && recordInSchool(entry, principal));
  if (!principal || !meeting || !(hasPlatformAccess(principal) || ['principal', 'admin', 'staff'].includes(principal.role)) || !isSameSchool(principal, meeting) || meeting.status !== 'awaiting-principal-approval') return res.status(403).json({ message: 'Only the principal or administrator can issue visitor authorisation after both parties agree.' });
  const passCode = `LFV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const visitor = tagSchoolRecord(principal, { id: crypto.randomUUID(), meetingId: meeting.id, visitorName: meeting.parentName, purpose: meeting.purpose, host: meeting.hostName, expectedDate: meeting.agreedAt, status: 'approved', approvedBy: principal.username, approvedAt: new Date().toISOString(), passCodeHash: hashPin(passCode) });
  db.campusVisitors.unshift(visitor);
  meeting.status = 'visitor-authorised';
  meeting.visitorId = visitor.id;
  meeting.principalApprovedAt = new Date().toISOString();
  res.json({ success: true, visitor: { ...visitor, passCodeHash: undefined }, passCode });
});

app.post('/api/campus-visitors/check-in', (req, res) => {
  const actor = requireSafetyStaff(req);
  const passCode = String(req.body?.passCode || '').trim().toUpperCase();
  if (!actor || !passCode) return res.status(403).json({ message: 'An authorised staff member and visitor pass are required.' });
  if (!/^LFV-[A-F0-9]{8}$/.test(passCode)) return res.status(404).json({ message: 'Visitor pass not found, already used, or not approved.' });
  const visitor = db.campusVisitors.find(entry => entry.status === 'approved' && recordInSchool(entry, actor) && matchesPin(passCode, entry.passCodeHash));
  if (!visitor) return res.status(404).json({ message: 'Visitor pass not found, already used, or not approved.' });
  visitor.status = 'checked-in';
  visitor.checkedInAt = new Date().toISOString();
  visitor.checkedInBy = actor.username;
  res.json({ success: true, visitor: { ...visitor, passCodeHash: undefined } });
});

app.post('/api/campus-visitors/:id/check-out', (req, res) => {
  const actor = requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Only authorised safety staff can check out a visitor.' });
  const visitor = db.campusVisitors.find(entry => entry.id === req.params.id && entry.status === 'checked-in' && recordInSchool(entry, actor));
  if (!visitor) return res.status(404).json({ message: 'Checked-in visitor not found.' });
  visitor.status = 'checked-out';
  visitor.checkedOutAt = new Date().toISOString();
  visitor.checkedOutBy = actor.username;
  res.json({ success: true });
});

// Store details and purchases are always scoped to the signed-in user's school.
app.get('/api/store', (req, res) => {
  const user = getSessionAccount(req);
  if (!user) return res.status(401).json({ message: 'Sign in to view the school store.' });
  const schoolName = user.schoolName || 'Your school';
  const products = tenantRecords(db.storeProducts || [], user).filter(product => product.active !== false).map(({ schoolName: _schoolName, schoolId: _schoolId, ...product }) => product);
  res.json({ schoolName, products, canManage: isAdminLike(user), webStoreUrl: user.schoolStoreUrl || null });
});
app.post('/api/store/products', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator can add school store items.' });
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const price = billingAmount(req.body?.price);
  const stockQuantity = Number.parseInt(req.body?.stockQuantity, 10);
  if (!name || price === null || price <= 0 || !Number.isInteger(stockQuantity) || stockQuantity < 0) return res.status(400).json({ message: 'Enter an item name, a price greater than zero, and a valid stock quantity.' });
  if (!Array.isArray(db.storeProducts)) db.storeProducts = [];
  const product = tagSchoolRecord(actor, { id: crypto.randomUUID(), name, price, stockQuantity, active: true, createdAt: new Date().toISOString(), createdBy: actor.username });
  db.storeProducts.unshift(product);
  res.status(201).json({ success: true, product });
});
app.delete('/api/store/products/:id', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator can remove school store items.' });
  const product = (db.storeProducts || []).find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!product) return res.status(404).json({ message: 'Store item not found.' });
  product.active = false;
  res.json({ success: true });
});
app.post('/api/store/orders', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || actor.role !== 'parent') return res.status(403).json({ message: 'Only approved parent accounts can place a school store order.' });
  const product = (db.storeProducts || []).find(entry => entry.id === req.body?.productId && entry.active !== false && recordInSchool(entry, actor));
  const quantity = Number.parseInt(req.body?.quantity, 10);
  if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return res.status(400).json({ message: 'Choose an available store item and quantity.' });
  if (product.stockQuantity < quantity) return res.status(409).json({ message: 'The requested quantity is not currently available.' });
  const billing = subscriptionBillingState(actor);
  if (!billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'The school payment destination is not configured yet.' });
  product.stockQuantity -= quantity;
  const reference = `${billing.payment.referencePrefix}-STORE-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const order = tagSchoolRecord(actor, { id: crypto.randomUUID(), reference, productId: product.id, productName: product.name, quantity, amount: Math.round(product.price * quantity * 100) / 100, parentUsername: actor.username, parentName: actor.name || actor.username, status: 'awaiting payment and preparation', createdAt: new Date().toISOString() });
  if (!Array.isArray(db.storeOrders)) db.storeOrders = [];
  db.storeOrders.unshift(order);
  db.moduleRecords.stock.unshift(tagSchoolRecord(actor, { id: crypto.randomUUID(), details: `Store order to prepare · ${product.name} × ${quantity} · ${order.parentName} · Ref ${reference}`, source: 'school-store', status: 'Awaiting payment and preparation', createdAt: new Date().toLocaleString() }));
  res.status(201).json({ success: true, order, payment: paymentInstructions(billing, reference) });
});
app.get('/api/store/orders', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Stock-room access is required.' });
  res.json(tenantRecords(db.storeOrders || [], actor));
});

// Internal operational records for the advanced workspaces. External providers are configured separately.
const moduleRecordCollection = moduleName =>
  Object.hasOwn(db.moduleRecords || {}, moduleName) && Array.isArray(db.moduleRecords[moduleName])
    ? db.moduleRecords[moduleName]
    : null;

app.get('/api/modules/:module', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'Authorised school staff can view workspace records.' });
  const records = moduleRecordCollection(req.params.module);
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  res.json(tenantRecords(records, actor));
});
app.post('/api/modules/:module', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can save workspace records.' });
  const records = moduleRecordCollection(req.params.module);
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });

  let payload;
  if (req.params.module === 'curriculum') {
    const allowedFrameworks = new Set(['NCF Birth–4', 'CAPS Grade R']);
    const allowedAreas = new Set([
      'ELDA 1 · Well-being',
      'ELDA 2 · Identity and Belonging',
      'ELDA 3 · Communication',
      'ELDA 4 · Exploring Mathematics',
      'ELDA 5 · Creativity',
      'ELDA 6 · Knowledge and Understanding of the World',
      'Home Language',
      'Mathematics',
      'Life Skills'
    ]);
    const framework = String(req.body?.framework || '').trim();
    const area = String(req.body?.area || '').trim();
    const learnerName = String(req.body?.learnerName || '').trim().slice(0, 160);
    const observation = String(req.body?.observation || '').trim().slice(0, 1200);
    const evidenceReference = String(req.body?.evidenceReference || '').trim().slice(0, 240);
    if (!allowedFrameworks.has(framework) || !allowedAreas.has(area) || !learnerName || !observation) {
      return res.status(400).json({ message: 'Choose a supported NCF or Grade R framework area and enter an observation.' });
    }
    if (framework === 'NCF Birth–4' && !area.startsWith('ELDA ')) return res.status(400).json({ message: 'Choose an NCF ELDA for this observation.' });
    if (framework === 'CAPS Grade R' && area.startsWith('ELDA ')) return res.status(400).json({ message: 'Choose a Grade R CAPS area for this observation.' });
    payload = {
      type: 'Framework observation',
      frameworkKey: framework === 'NCF Birth–4' ? 'ncf_birth_to_four' : 'caps_grade_r',
      framework,
      area,
      learnerName,
      observation,
      evidenceReference,
      details: (learnerName + ' · ' + framework + ' · ' + area + ' · ' + observation).slice(0, 1800),
      recordedBy: actor.name || actor.username
    };
  } else {
    payload = {
      type: boundedText(req.body?.type, 160),
      details: boundedText(req.body?.details, 1800),
      recordedBy: boundedText(req.body?.recordedBy || actor.name || actor.username, 160),
      ...(req.params.module === 'stickyNotes' ? { colour: boundedText(req.body?.colour, 20) } : {})
    };
    if (!payload.type || !payload.details) return res.status(400).json({ message: 'Add a record type and details.' });
  }

  const record = tagSchoolRecord(actor, { ...payload, id: crypto.randomUUID(), ...(req.params.module === 'stickyNotes' ? { createdBy: actor.username } : {}), createdAt: new Date().toLocaleString() });
  records.unshift(record);
  res.json({ success: true, record });
});
app.patch('/api/modules/stickyNotes/:id', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can edit sticky notes.' });
  const records = moduleRecordCollection('stickyNotes');
  const record = records?.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!record) return res.status(404).json({ message: 'Sticky note not found.' });
  if (!isAdminLike(actor) && record.createdBy !== actor.username) return res.status(403).json({ message: 'You can edit only sticky notes you created.' });
  const type = boundedText(req.body?.type, 160);
  const details = boundedText(req.body?.details, 1800);
  const colour = boundedText(req.body?.colour, 20);
  if (!type || !details) return res.status(400).json({ message: 'Add a note title and reminder.' });
  if (!['yellow', 'teal', 'blue', 'rose'].includes(colour)) return res.status(400).json({ message: 'Choose a supported note colour.' });
  record.type = type;
  record.details = details;
  record.colour = colour;
  record.updatedAt = new Date().toLocaleString();
  res.json({ success: true, record });
});
app.delete('/api/modules/:module/:id', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const records = moduleRecordCollection(req.params.module);
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  const record = records.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!record) return res.status(404).json({ message: 'Workspace record not found.' });
  db.moduleRecords[req.params.module] = records.filter(entry => entry !== record);
  res.json({ success: true });
});

app.get('/api/registry', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'Authorised school staff can view the learner register.' });
  res.json(learnerRecordsVisibleTo(db.registry, actor).map(registryRecordView));
});
app.post('/api/registry', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can add register records.' });
  const learnerName = limitedText(req.body?.learnerName, 160);
  const className = limitedText(req.body?.className, 120);
  const dateOfBirth = limitedText(req.body?.dateOfBirth, 20);
  const guardianName = limitedText(req.body?.guardianName, 160);
  const guardianPhone = limitedText(req.body?.guardianPhone, 80);
  const guardianEmail = limitedText(req.body?.guardianEmail, 160);
  const address = limitedText(req.body?.address, 500);
  const emergencyContact = limitedText(req.body?.emergencyContact, 500);
  const medicalNotes = limitedText(req.body?.medicalNotes, 2000);
  const consent = limitedText(req.body?.consent || 'Pending verification', 120);
  if (!learnerName || !dateOfBirth || !guardianName || !guardianPhone || !address || guardianEmail === null || className === null || emergencyContact === null || medicalNotes === null || consent === null) {
    return res.status(400).json({ message: 'Complete the required learner fields and keep each field within its allowed length.' });
  }
  if (!validDateKey(dateOfBirth) || dateOfBirth >= dateKeyInSouthAfrica()) return res.status(400).json({ message: 'Enter a valid learner date of birth.' });
  if (actor.role === 'teacher' && (!className || !normaliseAssignedClasses(actor.assignedClasses).includes(normalizeComparableText(className)))) {
    return res.status(403).json({ message: 'Teachers can register learners only in their assigned classes.' });
  }
  const record = tagSchoolRecord(actor, {
    id: crypto.randomUUID(),
    learnerName,
    className,
    dateOfBirth: encryptField(dateOfBirth),
    guardianName,
    guardianPhone: encryptField(guardianPhone),
    guardianEmail: encryptField(guardianEmail || ''),
    address: encryptField(address),
    emergencyContact: encryptField(emergencyContact || ''),
    medicalNotes: encryptField(medicalNotes || ''),
    consent,
    createdAt: new Date().toISOString(),
    createdBy: actor.username
  });
  db.registry.unshift(record);

  let learner = tenantRecords(db.students, actor).find(student =>
    normalizeComparableText(student.studentName) === normalizeComparableText(learnerName)
    && normalizeComparableText(student.className) === normalizeComparableText(className)
  );
  if (!learner) {
    learner = tagSchoolRecord(actor, {
      id: crypto.randomUUID(),
      studentName: learnerName,
      className,
      parentName: guardianName,
      contactEmail: guardianEmail || '',
      dateOfBirth: encryptField(dateOfBirth),
      medicalNotes: encryptField(medicalNotes || ''),
      emergencyContact: encryptField(emergencyContact || ''),
      authorisedPickups: encryptField(''),
      registeredAt: new Date().toISOString(),
      registeredBy: actor.username
    });
    db.students.push(learner);
    ensureLearnerAccessCode(actor, learner);
  }
  res.status(201).json({ success: true, record: registryRecordView(record), learnerKey: learnerRecordKey(learner) });
});

app.get('/api/consents', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'Authorised school staff can view consent records.' });
  res.json(tenantRecords(db.consentRecords, actor));
});
app.post('/api/consents', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can save consent records.' });
  const learnerName = limitedText(req.body?.learnerName, 160);
  const guardianName = limitedText(req.body?.guardianName, 160);
  const { internalUpdates, marketingPhotos } = req.body;
  if (!learnerName || !guardianName) return res.status(400).json({ message: 'Learner and guardian details are required and must be within 160 characters.' });
  const record = tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerName, guardianName, internalUpdates: Boolean(internalUpdates), marketingPhotos: Boolean(marketingPhotos), capturedAt: new Date().toISOString(), version: 'POPIA-consent-2026-09-v2' });
  db.consentRecords = db.consentRecords.filter(entry => !recordInSchool(entry, actor) || entry.learnerName.toLowerCase() !== record.learnerName.toLowerCase());
  db.consentRecords.unshift(record);
  res.status(201).json({ success: true, record });
});

app.post('/api/pickups/verify', (req, res) => {
  const actor = getSessionAccount(req);
  const learnerName = limitedText(req.body?.learnerName, 160);
  const pickupAdult = limitedText(req.body?.pickupAdult, 160);
  const verificationCode = req.body?.verificationCode;
  const action = limitedText(req.body?.action, 40);
  const allowedActions = new Set(['Check-in', 'Pickup / release']);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can record pickups.' });
  if (!learnerName || !pickupAdult || !validSecretLength(verificationCode) || !allowedActions.has(action)) return res.status(400).json({ message: 'Learner, pickup adult, a valid verification code, and a supported action are required.' });
  const entry = tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerName, pickupAdult, verificationCode: hashPin(verificationCode), action, recordedBy: actor.username, timestamp: new Date().toISOString() });
  db.pickupLogs.unshift(entry);
  res.status(201).json({ success: true, entry: { ...entry, verificationCode: undefined } });
});
app.get('/api/pickups', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'Authorised school staff can view pickup records.' });
  res.json(tenantRecords(db.pickupLogs, actor).map(({ verificationCode, ...entry }) => entry));
});

app.get('/api/release-notes', async (req, res) => {
  const deployed = await resolveRenderDeployReleaseNote();
  if (deployed) return res.json([deployed]);
  res.json((db.releaseNotes || []).slice().sort((first, second) => Date.parse(second.publishedAt || '') - Date.parse(first.publishedAt || '')));
});

app.post('/api/report-signing-pin', (req, res) => {
  const { pin } = req.body;
  const user = getSessionAccount(req);
  if (!user || !validSecretLength(pin, { min: 4, max: 128 })) return res.status(400).json({ message: 'Choose a signing PIN between 4 and 128 characters.' });
  user.reportSigningPinHash = hashPin(pin);
  res.json({ success: true });
});

app.get('/api/report-reviews', (req, res) => {
  const user = getSessionAccount(req);
  if (!user) return res.status(401).json({ message: 'Sign in to view reports.' });
  if (!(hasPlatformAccess(user) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(user.role))) return res.status(403).json({ message: 'This role cannot access learner reports.' });
  const reports = user.role === 'parent'
    ? tenantRecords(db.reportReviews, user).filter(report => normalizeUsername(report.parentUsername) === normalizeUsername(user.username))
    : learnerRecordsVisibleTo(db.reportReviews, user);
  res.json(reports.map(reportReviewView));
});
app.post('/api/report-reviews', (req, res) => {
  const studentName = limitedText(req.body?.studentName, 160);
  const reportTitle = limitedText(req.body?.reportTitle, 240);
  const period = limitedText(req.body?.period, 120);
  const parentUsername = limitedText(req.body?.parentUsername, 160);
  const signatureData = req.body?.signatureData;
  const signingPin = req.body?.signingPin;
  const teacher = getSessionAccount(req);
  if (!teacher || !teacher.reportSigningPinHash || !validSecretLength(signingPin) || !matchesPin(signingPin, teacher.reportSigningPinHash)) return res.status(403).json({ message: 'Set and enter your teacher signing PIN before publishing a report.' });
  const parent = parentUsername ? findAccountByUsername(parentUsername) : null;
  if (!(hasPlatformAccess(teacher) || ['teacher', 'principal', 'admin', 'staff'].includes(teacher.role)) || !parent || parent.role !== 'parent' || !isSameSchool(teacher, parent)) return res.status(400).json({ message: 'Choose an authorised teacher and a linked parent account.' });
  const learner = learnerRecordsVisibleTo(db.students, teacher).find(entry => normalizeComparableText(entry.studentName) === normalizeComparableText(studentName));
  if (!learner) return res.status(403).json({ message: 'You do not have access to that learner.' });
  if (!isParentLinkedToLearner(parent, learner)) return res.status(400).json({ message: 'Choose the approved parent account linked to this learner.' });
  if (!studentName || !reportTitle || !period || !parentUsername || !validSignatureData(signatureData)) return res.status(400).json({ message: 'Complete the report details within the allowed limits and provide a valid signature.' });
  const report = tagSchoolRecord(teacher, { id: crypto.randomUUID(), studentName, className: learner.className || '', reportTitle, period, teacherUsername: teacher.username, parentUsername: parent.username, teacherSignature: encryptField(signatureData), teacherSignedAt: new Date().toISOString(), parentSignature: null, parentSignedAt: null, status: 'Awaiting parent signature', createdAt: new Date().toISOString() });
  db.reportReviews.unshift(report);
  res.status(201).json({ success: true, report: reportReviewView(report) });
});
app.post('/api/report-reviews/:id/sign', (req, res) => {
  const { signatureData, signingPin } = req.body;
  const user = getSessionAccount(req);
  const report = db.reportReviews.find(entry => entry.id === req.params.id && recordInSchool(entry, user));
  if (!report || !user || user.role !== 'parent' || normalizeUsername(report.parentUsername) !== normalizeUsername(user.username)) return res.status(403).json({ message: 'Only the linked parent account can sign this report.' });
  if (!user.reportSigningPinHash || !validSecretLength(signingPin) || !matchesPin(signingPin, user.reportSigningPinHash)) return res.status(403).json({ message: 'Set and enter your parent signing PIN before signing.' });
  if (!validSignatureData(signatureData)) return res.status(400).json({ message: 'Add a valid signature before confirming.' });
  report.parentSignature = encryptField(signatureData);
  report.parentSignedAt = new Date().toISOString();
  report.status = 'Complete - teacher and parent signed';
  res.json({ success: true, report: reportReviewView(report) });
});

// School-controlled learner access codes. Codes are encrypted at rest and are
// available only to the school roles that issue or print the physical handout.
const findLearnerAccessCodeActor = (req) => {
  const actor = getSessionAccount(req);
  return actor && (hasPlatformAccess(actor) || ['admin', 'principal', 'staff'].includes(actor.role)) ? actor : null;
};

const learnerAccessCodeView = (learner, actor, { includeCode = false, includeHistory = false } = {}) => {
  const key = learnerRecordKey(learner);
  const activeCode = db.learnerAccessCodes.find(entry => entry.learnerKey === key && entry.status === 'active' && recordInSchool(entry, actor));
  const history = db.learnerAccessCodes
    .filter(entry => entry.learnerKey === key && recordInSchool(entry, actor))
    .map(entry => ({
      id: entry.id,
      status: entry.status,
      issuedAt: entry.issuedAt || null,
      issuedBy: entry.issuedBy || null,
      changedAt: entry.replacedAt || entry.revokedAt || entry.redeemedAt || null,
      changedBy: entry.replacedBy || entry.revokedBy || entry.redeemedBy || null
    }))
    .sort((left, right) => String(right.issuedAt || '').localeCompare(String(left.issuedAt || '')));
  return {
    learnerKey: key,
    learnerName: learner.studentName,
    className: learner.className,
    parentName: learner.parentName || '',
    contactEmail: learner.contactEmail || '',
    codeRecordId: activeCode?.id || null,
    // A code is only shown in the administrator's register. Principals receive
    // a print action, not a list of credentials, and teachers never receive one.
    accessCode: includeCode && activeCode ? decryptField(activeCode.codeEncrypted) : null,
    issuedAt: activeCode?.issuedAt || null,
    issuedBy: activeCode?.issuedBy || null,
    hasPrintableForm: Boolean(activeCode),
    codeHistory: includeHistory ? history : []
  };
};

app.get('/api/learner-access-codes', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor) return res.status(403).json({ message: 'Only administrators and principals may view learner codes.' });
  const isAdmin = isAdminLike(actor);
  res.json(tenantRecords(db.students, actor).map(learner => learnerAccessCodeView(learner, actor, { includeCode: isAdmin, includeHistory: isAdmin })));
});

app.get('/api/learner-access-codes/printable-list', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator may print the full learner-code register.' });
  const learners = tenantRecords(db.students, actor).map(learner => learnerAccessCodeView(learner, actor, { includeCode: true, includeHistory: false }));
  res.json({
    schoolName: actor.schoolName,
    generatedAt: new Date().toISOString(),
    learners: learners.filter(entry => entry.accessCode).map(entry => ({
      learnerName: entry.learnerName,
      className: entry.className,
      parentName: entry.parentName,
      accessCode: entry.accessCode,
      issuedAt: entry.issuedAt
    }))
  });
});

// This is deliberately a separate, credential-free view. It lets an
// administrator verify exactly what teachers can use: learner details and an
// issued/not-issued indicator, never an access code or its history.
app.get('/api/learner-access-codes/teacher-preview', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can open the teacher-view preview.' });
  res.json(tenantRecords(db.students, actor).map(learner => {
    const key = learnerRecordKey(learner);
    return {
      learnerName: learner.studentName,
      className: learner.className,
      parentName: learner.parentName || '',
      codeIssued: db.learnerAccessCodes.some(entry => entry.learnerKey === key && entry.status === 'active' && recordInSchool(entry, actor))
    };
  }));
});

app.get('/api/learner-access-codes/:learnerKey/printable', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator or principal can print learner code forms.' });
  const learnerKey = String(req.params.learnerKey || '');
  const learner = db.students.find(entry => learnerRecordKey(entry) === learnerKey && recordInSchool(entry, actor));
  if (!learner) return res.status(404).json({ message: 'Learner record not found.' });
  const activeCode = db.learnerAccessCodes.find(entry => entry.learnerKey === learnerKey && entry.status === 'active' && recordInSchool(entry, actor));
  if (!activeCode) return res.status(404).json({ message: 'There is no active code available to print for this learner.' });
  res.json({
    learnerName: learner.studentName,
    className: learner.className,
    parentName: learner.parentName || '',
    accessCode: decryptField(activeCode.codeEncrypted),
    issuedAt: activeCode.issuedAt || null
  });
});

app.post('/api/learner-access-codes', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor || !isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can repair a missing learner access code.' });
  const learner = db.students.find(entry => learnerRecordKey(entry) === String(req.body?.learnerKey || '') && recordInSchool(entry, actor));
  if (!learner) return res.status(404).json({ message: 'Learner record not found.' });
  const learnerKey = learnerRecordKey(learner);
  if (db.learnerAccessCodes.some(entry => entry.learnerKey === learnerKey && entry.status === 'active' && recordInSchool(entry, actor))) return res.status(409).json({ message: 'This learner already has an active code. Regenerate it instead.' });
  ensureLearnerAccessCode(actor, learner);
  res.status(201).json({ success: true, learner: learnerAccessCodeView(learner, actor, { includeCode: true, includeHistory: true }) });
});

app.post('/api/learner-access-codes/:id/replace', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor || !isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can replace learner access codes.' });
  const previous = db.learnerAccessCodes.find(entry => entry.id === req.params.id && entry.status === 'active' && recordInSchool(entry, actor));
  if (!previous) return res.status(404).json({ message: 'The active code was not found.' });
  previous.status = 'replaced';
  previous.replacedAt = new Date().toISOString();
  previous.replacedBy = actor.username;
  const accessCode = createUniqueLearnerAccessCode();
  db.learnerAccessCodes.unshift(tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerKey: previous.learnerKey, codeEncrypted: encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username, replaces: previous.id, source: 'administrator-regeneration' }));
  const learner = db.students.find(entry => learnerRecordKey(entry) === previous.learnerKey && recordInSchool(entry, actor));
  res.json({ success: true, learner: learner ? learnerAccessCodeView(learner, actor, { includeCode: true, includeHistory: true }) : null });
});

app.post('/api/learner-access-codes/:id/revoke', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor || !isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can invalidate learner access codes.' });
  const record = db.learnerAccessCodes.find(entry => entry.id === req.params.id && entry.status === 'active' && recordInSchool(entry, actor));
  if (!record) return res.status(404).json({ message: 'The active code was not found.' });
  record.status = 'revoked';
  record.revokedAt = new Date().toISOString();
  record.revokedBy = actor.username;
  res.json({ success: true });
});

app.post('/api/learner-access-codes/redeem', (req, res) => {
  const parent = getSessionAccount(req);
  if (!parent || parent.role !== 'parent') return res.status(403).json({ message: 'Only a signed-in parent or guardian can use a learner access code.' });
  const suppliedCode = normaliseAccessCode(req.body?.accessCode);
  const codeRecord = db.learnerAccessCodes.find(entry => entry.status === 'active' && recordInSchool(entry, parent) && decryptField(entry.codeEncrypted) === suppliedCode);
  if (!codeRecord) return res.status(404).json({ message: 'That learner access code is invalid, has already been used, or has been replaced. Ask the school administrator for a new form.' });
  const learner = db.students.find(entry => learnerRecordKey(entry) === codeRecord.learnerKey && recordInSchool(entry, parent));
  if (!learner) return res.status(404).json({ message: 'The learner record linked to this code is no longer available.' });
  if (normaliseLearnerLinks(parent.linkedLearners).includes(normalizeComparableText(learner.studentName))) return res.status(409).json({ message: 'This learner is already linked to your account.' });
  const requested = Array.isArray(parent.requestedLearnerLinks) ? parent.requestedLearnerLinks : [];
  if (!requested.some(name => normalizeComparableText(name) === normalizeComparableText(learner.studentName))) requested.push(learner.studentName);
  const linkValidation = validateLearnerLinks(requested);
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  parent.requestedLearnerLinks = requested;
  parent.parentRelationshipStatus = 'Pending administrator approval';
  codeRecord.status = 'redeemed';
  codeRecord.redeemedAt = new Date().toISOString();
  codeRecord.redeemedBy = parent.username;
  res.json({ success: true, learnerName: learner.studentName, message: 'Learner link request sent to the school administrator for approval.' });
});

// Student Search
app.get('/api/students/search', (req, res) => {
  const { className, childName } = req.query;
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to search learner records.' });
  let results = learnerRecordsVisibleTo(db.students, requester);
  if (className) {
    results = results.filter(s => s.className.toLowerCase().includes(className.toLowerCase()));
  }
  if (childName) {
    results = results.filter(s => s.studentName.toLowerCase().includes(childName.toLowerCase()));
  }
  if (requester.role === 'district') {
    return res.json(results.map(student => ({ id: student.id || null, studentName: student.studentName, className: student.className })));
  }
  if (!(hasPlatformAccess(requester) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(requester.role))) return res.status(403).json({ message: 'This role cannot access learner records.' });
  res.json(results.map(studentSensitiveView));
});

app.get('/api/household', (req, res) => {
  const parent = getSessionAccount(req);
  if (!parent || parent.role !== 'parent') return res.status(403).json({ message: 'Only parent accounts can view linked learner records.' });
  res.json(tenantRecords(db.students, parent).filter(student => isParentLinkedToLearner(parent, student)).map(studentSensitiveView));
});

// Secure bulk learner import. The browser previews spreadsheet rows first; this
// endpoint applies the authoritative duplicate check and encrypts sensitive fields.
app.get('/api/students/import/:id', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'accounts', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only an administrator or principal may view learner imports.' });
  const job = db.importJobs.find(item => item.id === req.params.id && recordInSchool(item, actor));
  if (!job) return res.status(404).json({ message: 'Import job not found.' });
  res.json({ id: job.id, type: job.type, sourceSystem: job.sourceSystem || null, status: job.status, processedBatches: job.processedBatches.length, totalBatches: job.totalBatches, imported: job.imported, rejected: job.rejected, createdAt: job.createdAt, updatedAt: job.updatedAt });
});

app.post('/api/students/import', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'accounts', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only an administrator or principal may import learner records.' });
  const incoming = Array.isArray(req.body?.students) ? req.body.students : [];
  const sourceSystem = boundedText(req.body?.sourceSystem, 40);
  if (sourceSystem && sourceSystem !== 'SA-SAMS') return res.status(400).json({ message: 'Unsupported learner import source.' });
  if (!incoming.length) return res.status(400).json({ message: 'No learner records were supplied.' });
  if (incoming.length > 500) return res.status(400).json({ message: 'Import up to 500 learner records per bounded batch.' });
  const requestedJobId = boundedText(req.body?.importId, 80);
  const jobId = requestedJobId || crypto.randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(jobId)) return res.status(400).json({ message: 'Invalid import job identifier.' });
  const batchNumber = Number(req.body?.batchNumber ?? 0);
  const totalBatches = Number(req.body?.totalBatches ?? 1);
  if (!Number.isSafeInteger(batchNumber) || batchNumber < 0 || !Number.isSafeInteger(totalBatches) || totalBatches < 1 || totalBatches > 400 || batchNumber >= totalBatches) {
    return res.status(400).json({ message: 'Invalid import batch sequence. Imports support up to 400 batches (200,000 supplied rows).' });
  }
  let job = db.importJobs.find(item => item.id === jobId && recordInSchool(item, actor));
  if (job && normalizeUsername(job.createdBy) !== normalizeUsername(actor.username)) return res.status(403).json({ message: 'This import belongs to another account.' });
  if (!job) {
    job = tagSchoolRecord(actor, { id: jobId, type: sourceSystem === 'SA-SAMS' ? 'sa-sams-learners' : 'learners', sourceSystem: sourceSystem || null, status: 'in_progress', totalBatches, processedBatches: [], imported: 0, rejected: 0, createdBy: actor.username, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    db.importJobs.unshift(job);
    const completedForSchool = db.importJobs.filter(item => item !== job && item.status === 'completed' && recordInSchool(item, actor));
    const expiredJobIds = new Set(completedForSchool.slice(100).map(item => item.id));
    if (expiredJobIds.size) {
      db.importJobs = db.importJobs.filter(item => !expiredJobIds.has(item.id));
      db.importAudit = db.importAudit.filter(item => !expiredJobIds.has(item.importId));
    }
  }
  if (job.totalBatches !== totalBatches) return res.status(409).json({ message: 'This import job was started with a different batch count.' });
  if ((job.sourceSystem || '') !== (sourceSystem || '')) return res.status(409).json({ message: 'This import job was started from a different source system.' });
  const priorBatch = job.processedBatches.find(item => item.batchNumber === batchNumber);
  if (priorBatch) return res.json({ success: true, duplicateBatch: true, importId: job.id, status: job.status, imported: priorBatch.imported, rejected: priorBatch.rejectedRows, progress: { processedBatches: job.processedBatches.length, totalBatches, imported: job.imported, rejected: job.rejected } });

  const recordKey = (student) => [student.studentName, student.className, student.contactEmail].map(normalizeComparableText).join('|');
  const knownRecords = new Set(tenantRecords(db.students, actor).map(recordKey));
  const seenInFile = new Set();
  const rejected = [];
  let imported = 0;

  incoming.forEach((row, index) => {
    const studentName = boundedText(row?.studentName, 160);
    const className = boundedText(row?.className, 120);
    const parentName = boundedText(row?.parentName, 160);
    const contactEmail = boundedText(row?.contactEmail, 160);
    if (!studentName || !className) {
      rejected.push({ row: batchNumber * 500 + index + 2, reason: 'Learner name and class/grade are required.' });
      return;
    }
    const candidate = { studentName, className, contactEmail };
    const key = recordKey(candidate);
    if (knownRecords.has(key) || seenInFile.has(key)) {
      rejected.push({ row: batchNumber * 500 + index + 2, reason: 'Duplicate learner record already exists.' });
      return;
    }
    seenInFile.add(key);
    knownRecords.add(key);
    const learner = tagSchoolRecord(actor, {
      id: crypto.randomUUID(),
      studentName,
      className,
      parentName,
      contactEmail,
      medicalNotes: encryptField(boundedText(row?.medicalNotes, 2000)),
      emergencyContact: encryptField(boundedText(row?.emergencyContact, 500)),
      authorisedPickups: encryptField(boundedText(row?.authorisedPickups, 1000)),
      importedAt: new Date().toISOString(),
      importedBy: actor.username
    });
    db.students.push(learner);
    ensureLearnerAccessCode(actor, learner);
    imported += 1;
  });

  job.processedBatches.push({ batchNumber, imported, rejected: rejected.length, rejectedRows: rejected.slice(0, 100), rejectedRowsTruncated: rejected.length > 100, processedAt: new Date().toISOString() });
  job.processedBatches.sort((a, b) => a.batchNumber - b.batchNumber);
  job.imported += imported; job.rejected += rejected.length; job.updatedAt = new Date().toISOString();
  job.status = job.processedBatches.length === totalBatches ? 'completed' : 'in_progress';
  db.importAudit.unshift(tagSchoolRecord(actor, { id: crypto.randomUUID(), importId: job.id, sourceSystem: job.sourceSystem || null, batchNumber, importedAt: job.updatedAt, importedBy: actor.username, imported, rejected: rejected.length }));
  res.status(201).json({ success: true, importId: job.id, status: job.status, imported, rejected, progress: { processedBatches: job.processedBatches.length, totalBatches, imported: job.imported, rejected: job.rejected }, message: `${imported} learner record${imported === 1 ? '' : 's'} imported.` });
});

// 1. Session and Passport Setup
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const googleSignInConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const yahooSignInConfigured = Boolean(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET);
const microsoftSignInConfigured = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
const googleCallbackUrl = oauthCallbackUrl('google');
const yahooCallbackUrl = oauthCallbackUrl('yahoo');
const microsoftCallbackUrl = oauthCallbackUrl('microsoft');
if (googleSignInConfigured) passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: googleCallbackUrl,
    state: true
  },
  (accessToken, refreshToken, profile, done) => {
    const user = {
      googleId: profile.id,
      displayName: profile.displayName,
      email: profile.emails?.[0]?.value || '',
      emails: profile.emails || [],
      emailVerified: profile._json?.email_verified !== false,
      photo: profile.photos?.[0]?.value || ''
    };
    return done(null, user);
  }
));

app.get('/api/auth/providers', (req, res) => res.json({ google: googleSignInConfigured, yahoo: yahooSignInConfigured, microsoft: microsoftSignInConfigured }));
app.get('/api/auth/session', (req, res) => {
  const account = getSessionAccount(req);
  if (!account) return res.json({ authenticated: false, user: null });
  res.json({ authenticated: true, user: safeAccount(account) });
});
app.post('/api/auth/logout', (req, res) => {
  const clearSessionCookie = () => res.clearCookie('littlefeet.sid', { path: '/', secure: isProduction, httpOnly: true, sameSite: 'lax' });
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

app.get('/auth/google', (req, res, next) => {
  if (!googleSignInConfigured) return res.redirect('/?oauthError=google-not-configured');
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback',
  async (req, res, next) => {
    if (req.session?.mailboxOAuth?.provider === 'google') {
      return completeMailboxOAuth(req, res, 'google');
    }
    return next();
  },
  (req, res, next) => {
    passport.authenticate('google', { failureRedirect: '/?oauthError=google-sign-in-failed' })(req, res, next);
  },
  (req, res) => {
    const { account, error } = resolveOAuthAccount('google', req.user, db.users);
    if (error) return res.redirect(`/?oauthError=${encodeURIComponent(error)}`);
    establishAuthenticatedSession(req, account, error => res.redirect(error ? '/?oauthError=session-failed' : '/?oauth=google'));
  }
);

app.get('/auth/yahoo', (req, res) => {
  if (!yahooSignInConfigured) return res.redirect('/?oauthError=yahoo-not-configured');
  const state = crypto.randomBytes(24).toString('hex');
  req.session.yahooOAuthState = state;
  const authorizationUrl = new URL('https://api.login.yahoo.com/oauth2/request_auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: process.env.YAHOO_CLIENT_ID,
    redirect_uri: yahooCallbackUrl,
    response_type: 'code',
    scope: 'openid profile email',
    state
  }).toString();
  req.session.save(error => res.redirect(error ? '/?oauthError=session-failed' : authorizationUrl.toString()));
});

app.get('/auth/yahoo/callback', async (req, res) => {
  if (!yahooSignInConfigured || req.query.error || !req.query.code || req.query.state !== req.session.yahooOAuthState) {
    return res.redirect('/?oauthError=yahoo-sign-in-failed');
  }
  delete req.session.yahooOAuthState;
  try {
    const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: yahooCallbackUrl })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error('Yahoo token exchange failed');
    const profileResponse = await fetch('https://api.login.yahoo.com/openid/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) throw new Error('Yahoo profile request failed');
    const { account, error } = resolveOAuthAccount('yahoo', profile, db.users);
    if (error) return res.redirect(`/?oauthError=${encodeURIComponent(error)}`);
    establishAuthenticatedSession(req, account, error => res.redirect(error ? '/?oauthError=session-failed' : '/?oauth=yahoo'));
  } catch (error) {
    logStructured('error', 'oauth.yahoo_signin_failed', { category: 'authentication', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.redirect('/?oauthError=yahoo-sign-in-failed');
  }
});

app.get('/auth/microsoft', (req, res) => {
  if (!microsoftSignInConfigured) return res.redirect('/?oauthError=microsoft-not-configured');
  const state = crypto.randomBytes(24).toString('hex');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  req.session.microsoftOAuthState = state;
  req.session.microsoftCodeVerifier = verifier;
  const authorizationUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  authorizationUrl.search = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: microsoftCallbackUrl,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  }).toString();
  req.session.save(error => res.redirect(error ? '/?oauthError=session-failed' : authorizationUrl.toString()));
});

app.get('/auth/microsoft/callback', async (req, res) => {
  const verifier = req.session.microsoftCodeVerifier;
  if (!microsoftSignInConfigured || req.query.error || !req.query.code || !verifier || req.query.state !== req.session.microsoftOAuthState) {
    return res.redirect('/?oauthError=microsoft-sign-in-failed');
  }
  delete req.session.microsoftOAuthState;
  delete req.session.microsoftCodeVerifier;
  try {
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: microsoftCallbackUrl,
        code_verifier: verifier,
        scope: 'openid profile email User.Read'
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error('Microsoft token exchange failed');
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,otherMails', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) throw new Error('Microsoft profile request failed');
    const { account, error } = resolveOAuthAccount('microsoft', profile, db.users);
    if (error) return res.redirect(`/?oauthError=${encodeURIComponent(error)}`);
    establishAuthenticatedSession(req, account, error => res.redirect(error ? '/?oauthError=session-failed' : '/?oauth=microsoft'));
  } catch (error) {
    logStructured('error', 'oauth.microsoft_signin_failed', { category: 'authentication', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.redirect('/?oauthError=microsoft-sign-in-failed');
  }
});

app.use((req, res, next) => {
  const blockedFile = /^\/(?:\.env(?:\.[^/]+)?|server\.js|backup-server\.js|auth-crypto\.js|finance-automation-server\.js|littlefeet-replica\.json|(?:littlefeet|littlesteps)\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?|package(?:-lock)?\.json|\.render-deploy-release\.json|create_portal_documents\.py|npm-debug\.log)$/i.test(req.path);
  const blockedDirectory = /^\/(?:\.git|\.github|node_modules|output|tests|tmp|uploads|scripts|lib)(?:\/|$)/i.test(req.path);
  const blockedSourceMap = /\.map$/i.test(req.path);
  if (blockedFile || blockedDirectory || blockedSourceMap) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendStatus(404);
  }
  next();
});

// Wildcard Catch-All (Serves Frontend)
app.use((error, req, res, _next) => {
  const report = recordSystemError(error, req);
  if (!replicaMode && (!req.method || req.method === 'GET')) void saveDatabaseState();
  scheduleReplicaSnapshot();
  res.status(Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500).json({
    message: 'An unexpected server error occurred. The administrator report has been created.',
    requestId: report.requestId || report.id
  });
});

app.get(/(.*)/, (req, res) => {
  if (path.extname(req.path)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
persistenceReady.then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    logStructured('info', 'server.started', { category: 'runtime', result: 'listening', details: `Port ${PORT}` });
  });
}).catch(error => {
  logStructured('error', 'server.startup_failed', { category: 'runtime', result: 'failed', message: error.message });
  process.exit(1);
});
