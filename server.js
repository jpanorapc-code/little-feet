const express = require('express');
const compression = require('compression');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const tls = require('tls');
const dns = require('node:dns').promises;
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const session = require('express-session');
const { hashPin, matchesPin, pinHashNeedsUpgrade } = require('./auth-crypto');
const { registerFinanceAutomation } = require('./finance-automation-server');
let registerSchoolCoreUpgrades = null;
let registerAdvancedSchoolOperations = null;
try {
  ({ registerSchoolCoreUpgrades } = require('./school-core-upgrades-server'));
  ({ registerAdvancedSchoolOperations } = require('./advanced-school-operations-server'));
} catch (error) {
  const missingOwnModule = error?.code === 'MODULE_NOT_FOUND'
    && (String(error.message || '').includes('school-core-upgrades-server') || String(error.message || '').includes('advanced-school-operations-server'));
  if (!missingOwnModule || process.env.NODE_ENV !== 'test') throw error;
}
const { createObjectStorage, objectKeyFor } = require('./lib/storage/object-storage');
const { stripHtml, verifyResendWebhook, fetchResendReceivedEmail } = require('./lib/mailbox-integration');
const { oauthCallbackUrl, resolveOAuthAccount, publicOrigin } = require('./lib/oauth-identity');
const { createStructuredLogger, redactSensitiveLogText } = require('./lib/structured-logger');
const { PROVIDERS: MAILBOX_PROVIDERS, PROVIDER_LABELS: MAILBOX_PROVIDER_LABELS, createAuthorization: createMailboxAuthorization, exchangeCode: exchangeMailboxCode, refreshAccessToken: refreshMailboxAccessToken, fetchMailbox, sendMailboxMessage, revokeMailboxAccess } = require('./lib/mailbox-oauth');
const { resolveFailoverMode } = require('./failover-mode');

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const isProduction = process.env.NODE_ENV === 'production';
const failoverMode = resolveFailoverMode(process.env);
const replicaMode = failoverMode.replica;
const sharedDatabaseFailover = failoverMode.sharedDatabase;
const readOnlySnapshotMode = failoverMode.readOnlySnapshot;
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
const applicationSha = (() => {
  const fromEnvironment = String(process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || '').trim();
  if (fromEnvironment) return fromEnvironment;
  try {
    const release = JSON.parse(fs.readFileSync(path.join(__dirname, '.render-deploy-release.json'), 'utf8'));
    return String(release.fullCommitSha || '').trim();
  } catch { return ''; }
})();
const SERVER_BUSY_THRESHOLD = Math.max(8, Math.min(100, Number(process.env.LF_SERVER_BUSY_THRESHOLD) || 12));
const DEFAULT_BLOCKED_TERMS = Object.freeze(['asshole', 'bastard', 'bitch', 'cunt', 'dick', 'fok', 'fokken', 'fuck', 'kak', 'poes', 'shit']);
const blockedTerms = Object.freeze((process.env.LF_BLOCKED_TERMS || DEFAULT_BLOCKED_TERMS.join(','))
  .split(',').map(term => term.trim().toLocaleLowerCase('en-US')).filter(Boolean));
let activeRequestCount = 0;
let activeSharedDatabaseMutations = 0;
let persistenceReady = Promise.resolve();
const fieldEncryptionConfigured = Boolean(process.env.LF_FIELD_ENCRYPTION_KEY);
const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);
const productionConfigurationErrors = [];
if (isProduction && !readOnlySnapshotMode && !process.env.DATABASE_URL) productionConfigurationErrors.push('DATABASE_URL');
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
const FULL_PLATFORM_ROLES = new Set(); // Company jobs never confer owner privileges.
const ACCOUNT_ROLES = new Set(['parent', 'teacher', 'principal', 'district', 'admin', 'school_accounts', 'school_staff', 'school_hr', 'staff', 'crm', 'accounts', 'support']);
const CHAT_ROLES = new Set(['parent', 'teacher', 'principal', 'admin', 'school_accounts', 'school_staff', 'staff', 'crm', 'accounts', 'support']);
const SCHOOL_POSITION_CATALOG = {
 parent: ['Parent / Guardian'], teacher: ['Teacher / Educator','Baby Care Practitioner','ECD Practitioner','Preschool Educator','Grade R Educator','Primary School Educator','High School Educator','Special Needs Educator','Teaching Assistant','Head of Department'],
 principal: ['Principal / Head of School','Deputy Principal','ECD Centre Manager'], district: ['District / Circuit Official'], admin: ['School Administrator'], school_accounts: ['Bursar / School Accounts','Finance Officer'],
 school_hr:['HR Officer'], school_staff: ['Reception / School Office','Admissions Officer','School Nurse','Learning Support Practitioner','Aftercare Practitioner','Transport / Driver','Kitchen / Catering','Maintenance / Grounds','Security','Cleaning / Housekeeping','Library / Resources','Sports / Activities']
};
const SCHOOL_SECTORS = ['All School Sectors','Baby Care','Toddler / ECD','Preschool','Grade R','Primary School','High School','Combined School','Special Needs School'];
const validateSchoolPosition = (role, position, sector) => {
 if (PLATFORM_INTERNAL_ROLES.has(role)) return position || sector ? {error:'Company positions cannot be assigned a school job or sector.'} : {schoolPosition:'',schoolSector:''};
 const positions=SCHOOL_POSITION_CATALOG[role] || [], selected=position === undefined || position === '' ? positions[0] : position;
 if (!positions.includes(selected) || (sector !== undefined && sector !== '' && !SCHOOL_SECTORS.includes(sector))) return {error:'Choose a supported school position and sector.'};
 return {schoolPosition:selected,schoolSector:sector || 'All School Sectors'};
};
const isAwaitingAccountVerification = account => String(account?.verificationStatus || '').toLowerCase().includes('pending');
const configuredPlatformOwnerUsername = () => normalizeUsername(process.env.LF_OWNER_ADMIN_USERNAME || process.env.LF_BOOTSTRAP_ADMIN_USERNAME || '');
const isConfiguredPlatformOwner = account => Boolean(account && configuredPlatformOwnerUsername() && normalizeUsername(account.username) === configuredPlatformOwnerUsername());
const hasPlatformAccess = account => Boolean(account && (account.role === 'admin' && (account.platformAccess === true || isConfiguredPlatformOwner(account))));
const isAdminLike = account => Boolean(account && (account.role === 'admin' || hasPlatformAccess(account)));
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
  if (!recordInSchool(learner, parent)) return false;
  const name = normalizeComparableText(learner.studentName);
  if (!normaliseLearnerLinks(parent.linkedLearners).includes(name)) return false;
  // Legacy links contain names. An ambiguous name must never grant access to
  // another child's private records.
  return (db.students || []).filter(item => recordInSchool(item, parent)
    && normalizeComparableText(item.studentName) === name).length === 1;
};
const normaliseAssignedClasses = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(normalizeComparableText).filter(Boolean))];
const schoolKey = (value) => normalizeComparableText(value).replace(/\s+/g, ' ');
const createSchoolId = () => `school_${crypto.randomUUID()}`;
const ensureSchool = (schoolName) => {
  const cleanName = String(schoolName || '').trim() || 'Your School';
  if (!Array.isArray(db.schools)) db.schools = [];
  let school = db.schools.find(entry => schoolKey(entry.name) === schoolKey(cleanName));
  if (!school) {
    const createdAt = new Date().toISOString();
    school = {
      id: createSchoolId(), name: cleanName, status: 'active', createdAt,
      subscriptionStatus: 'trial_pending', trialStartedAt: '', trialEndsAt: ''
    };
    db.schools.push(school);
  }
  return school;
};
const accountSchoolId = (account) => {
  if (!account || PLATFORM_INTERNAL_ROLES.has(account.role)) return '';
  if (account.schoolId) return account.schoolId;
  const schoolName = String(account.schoolName || '').trim();
  if (!schoolName) return '';
  account.schoolId = ensureSchool(schoolName).id;
  return account.schoolId;
};
const ensureSchoolTrialStarted = account => {
  if (!account || hasPlatformAccess(account) || !['principal', 'admin', 'school_accounts'].includes(account.role)) return null;
  const school = db.schools.find(entry => entry.id === accountSchoolId(account));
  if (!school || school.subscriptionStatus !== 'trial_pending') return school || null;
  const startedAt = new Date().toISOString();
  school.subscriptionStatus = 'trial';
  school.trialStartedAt = startedAt;
  school.trialEndsAt = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString();
  return school;
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
const tagSchoolRecord = (actor, record) => {
  const schoolId = accountSchoolId(actor);
  const tagged = { ...record, schoolId, schoolName: PLATFORM_INTERNAL_ROLES.has(actor.role) ? '' : actor.schoolName || '' };
  if (!schoolId && (PLATFORM_INTERNAL_ROLES.has(actor.role) || hasPlatformAccess(actor))) tagged.companyScope = true;
  else delete tagged.companyScope;
  return tagged;
};
const tenantRecords = (records, actor) => (Array.isArray(records) ? (hasPlatformAccess(actor) ? records.slice() : records.filter(record => recordInSchool(record, actor))) : []);
const canUseDirectChat = (first, second) => {
  if (!first || !second || isAwaitingAccountVerification(first) || isAwaitingAccountVerification(second) || !CHAT_ROLES.has(first.role) || !CHAT_ROLES.has(second.role) || first.username === second.username) return false;
  const parent = first.role === 'parent' ? first : second.role === 'parent' ? second : null;
  if (!parent) return isSameSchool(first, second) || PLATFORM_INTERNAL_ROLES.has(first.role) || PLATFORM_INTERNAL_ROLES.has(second.role) || hasPlatformAccess(first) || hasPlatformAccess(second);
  if (!isSameSchool(parent, parent === first ? second : first)) return false;
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
  const schoolId = learner.schoolId || accountSchoolId(actor);
  const existing = db.learnerAccessCodes.find(entry => entry.learnerKey === learnerKey && entry.status === 'active' && entry.schoolId === schoolId);
  if (existing) return existing;
  const accessCode = createUniqueLearnerAccessCode();
  const record = tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerKey, codeEncrypted: encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username, source: 'automatic-learner-creation' });
  record.schoolId = schoolId;
  record.schoolName = learner.schoolName || actor.schoolName || '';
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

const loginSecurityRequestSummary = req => ({
  network: boundedText(req.ip || 'Unavailable', 96) || 'Unavailable',
  device: boundedText(req.get('user-agent') || 'Unknown browser or device', 300) || 'Unknown browser or device'
});

const sendSuccessfulLoginEmail = async (req, account, authMethod = 'password') => {
  const to = accountSecurityEmail(account);
  if (!to) return false;
  const requestSummary = loginSecurityRequestSummary(req);
  const signedInAt = new Date().toISOString();
  const accountName = String(account?.name || 'Little Feet user').trim();
  const imageUrl = 'https://littlefeet.co.za/assets/security/login-security-alert.jpg';
  const text = [
    `Hello ${accountName},`,
    '',
    'A successful sign-in to your Little Feet account was detected.',
    `Time: ${signedInAt}`,
    `Sign-in method: ${authMethod}`,
    `Network address: ${requestSummary.network}`,
    `Browser/device: ${requestSummary.device}`,
    '',
    'If this was you, no action is needed.',
    'If this was not you, change your password or PIN and contact your school administrator immediately.',
    '',
    'Little Feet security'
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#071426;font-family:Arial,Helvetica,sans-serif;color:#eef7ff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#071426;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#0d2038;border:1px solid #1f4d70;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:0;">
            <img src="${imageUrl}" width="620" alt="Little Feet login security alert" style="display:block;width:100%;max-width:620px;height:auto;border:0;">
          </td></tr>
          <tr><td style="padding:24px 28px 28px;">
            <div style="font-size:22px;font-weight:700;color:#ffffff;margin-bottom:14px;">New sign-in detected</div>
            <p style="margin:0 0 16px;line-height:1.6;color:#d8e9f7;">Hello ${emailHtmlText(accountName)},</p>
            <p style="margin:0 0 18px;line-height:1.6;color:#d8e9f7;">A successful sign-in to your Little Feet account was detected.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#09192c;border-radius:10px;margin:0 0 18px;">
              <tr><td style="padding:14px 16px;color:#b9d5e9;line-height:1.7;">
                <strong style="color:#ffffff;">Time:</strong> ${emailHtmlText(signedInAt)}<br>
                <strong style="color:#ffffff;">Sign-in method:</strong> ${emailHtmlText(authMethod)}<br>
                <strong style="color:#ffffff;">Network address:</strong> ${emailHtmlText(requestSummary.network)}<br>
                <strong style="color:#ffffff;">Browser/device:</strong> ${emailHtmlText(requestSummary.device)}
              </td></tr>
            </table>
            <p style="margin:0 0 8px;line-height:1.6;color:#d8e9f7;">If this was you, no action is needed.</p>
            <p style="margin:0;line-height:1.6;color:#ffd4d4;"><strong>If this was not you:</strong> change your password or PIN and contact your school administrator immediately.</p>
            <p style="margin:22px 0 0;color:#7fb4d7;font-size:13px;">Little Feet security</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  return sendLittleFeetEmail({
    to,
    subject: 'Little Feet security: new sign-in',
    text,
    html
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
  '/api/system-logs',
  '/api/auth/session'
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
    "form-action 'self' https://www.payfast.co.za https://sandbox.payfast.co.za",
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
app.use(express.urlencoded({
  extended: true,
  limit: `${MAX_API_BODY_MB}mb`,
  verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); }
}));
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
  if (['/api/email/inbound/resend', '/api/payments/payfast/itn'].includes(String(req.originalUrl || '').split('?')[0])) return next();
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
  if (!readOnlySnapshotMode || allowReplicaWritesForTests || !req.path.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Standby replicas are deliberately read-only. Authentication is allowed so
  // users can inspect the latest snapshot during failover, but business-data
  // writes must never return success when there is no durable write path.
  if (req.method === 'POST' && ['/api/login', '/api/auth/logout', '/api/system/client-log', '/api/system-self-test'].includes(req.path)) return next();
  res.setHeader('Retry-After', '30');
  return res.status(503).json({
    message: 'Backup server is read-only. Your change was not saved; reconnect to the primary service and retry.',
    requestId: req.requestId
  });
});
let persistentMutationQueue = Promise.resolve();
async function withPersistentMutation(task) {
  const previous = persistentMutationQueue;
  let releaseTurn;
  persistentMutationQueue = new Promise(resolve => { releaseTurn = resolve; });
  await previous;
  let lockClient;
  activeSharedDatabaseMutations += 1;
  try {
    if (postgresPool) {
      // Wait locally before borrowing a connection. Waiting requests must not
      // consume every pool slot needed by the lock holder to load or save.
      lockClient = await postgresPool.connect();
      await lockClient.query('SELECT pg_advisory_lock(12801337)');
      await loadDatabaseState();
    }
    return await task();
  } finally {
    if (lockClient) {
      await lockClient.query('SELECT pg_advisory_unlock(12801337)').catch(() => {});
      lockClient.release();
    }
    activeSharedDatabaseMutations = Math.max(0, activeSharedDatabaseMutations - 1);
    releaseTurn();
  }
}
app.use((req, res, next) => {
  persistenceReady.then(async () => {
    activeRequestCount += 1;
    let requestReleased = false;
    const releaseRequest = () => {
      if (requestReleased) return;
      requestReleased = true;
      activeRequestCount = Math.max(0, activeRequestCount - 1);
    };
    res.on('finish', releaseRequest);
    res.on('close', releaseRequest);
    if (!req.method || req.method === 'GET' || readOnlySnapshotMode) return next();
    await withPersistentMutation(() => new Promise(resolve => {
      if (res.destroyed) return resolve();
      let persistenceTask = null;
      const finishMutation = () => {
        if (persistenceTask) void persistenceTask.then(resolve, resolve);
        else resolve();
      };
      res.once('finish', finishMutation);
      res.once('close', () => { if (res.writableEnded) finishMutation(); });
      // A disconnected browser does not cancel an in-flight storage operation.
      // Keep the mutation turn until its handler ends the response or commits.
      const originalEnd = res.end.bind(res);
      res.end = (...args) => {
        const result = originalEnd(...args);
        finishMutation();
        return result;
      };
      const originalJson = res.json.bind(res);
      let persistenceResponsePending = false;
      res.json = body => {
        if (res.statusCode >= 400 || req.persistenceCommitted || persistenceResponsePending) return originalJson(body);
        persistenceResponsePending = true;
        persistenceTask = saveDatabaseState().then(() => {
          req.persistenceCommitted = true;
          scheduleReplicaSnapshot();
          if (!res.destroyed) originalJson(body);
          else finishMutation();
        }).catch(async error => {
          logStructured('error', 'persistence.mutation_commit_failed', { category: 'persistence', requestId: req.requestId, method: req.method, route: String(req.originalUrl || '').split('?')[0], status: 503, result: 'not_persisted', message: error.message });
          await loadDatabaseState().catch(() => {});
          if (!res.headersSent && !res.destroyed) {
            res.status(503);
            originalJson({ message: 'Your change could not be committed to durable storage. Nothing has been confirmed; please retry after the database recovers.', requestId: req.requestId });
          }
          if (res.destroyed) finishMutation();
        });
        return res;
      };
      next();
    }));
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
app.get('/runtime-config.js', (_req, res) => {
  const configured = replicaMode ? '' : String(process.env.LITTLE_FEET_BACKUP_URL || '').trim();
  let backupUrl = '';
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.origin !== publicOrigin()) backupUrl = parsed.origin;
  } catch {}
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(`window.LITTLE_FEET_BACKUP_URL = ${JSON.stringify(backupUrl)};`);
});
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
  diagnosticMigrations: {},
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
  subjectMarks: [],
  markHistory: [],
  reportCards: [],
  disciplineRecords: [],
  disciplineSettings: [],
  assetRegister: [],
  gradeRSkillAssessments: [],
  dsdIncidents: [],
  communicationCampaigns: [],
  attendanceAutomationSettings: [],
  eldaSkillCatalogue: [],
  eldaAssessments: [],
  aftercareSettings: [],
  aftercarePlans: [],
  aftercareSessions: [],
  staffClockSessions: [],
  staffRatioSettings: [],
  dayCareBookings: [],
  dayCareCapacitySettings: [],
  mealPlans: [],
  dietaryProfiles: [],
  learnerGroups: [],
  learnerSubjectAssignments: [],
  pickupPasses: [],
  academicAnalyticsSettings: [],
  schoolGroups: [],
  communicationTemplates: [],
  admissionsApplications: [],
  admissionsStatusHistory: [],
  documentAudit: [],
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
let replicaRemoteTimer = null;
let replicaSnapshotTimer = null;
let stateDatabase = null;
let postgresPool = null;
let postgresSaveChain = Promise.resolve();
let postgresPersistenceSnapshot = new Map();
let replicaSnapshotVersion = '';
const objectStorage = createObjectStorage({ rootDir: __dirname });
let replicaTransportLoadError = null;
let replicaTransport;
try {
  const { createReplicaTransport } = require('./lib/operations/replica-transport');
  replicaTransport = createReplicaTransport();
} catch (error) {
  replicaTransportLoadError = error;
  replicaTransport = { configured: false, missing: ['replica transport module unavailable'], async load() { return null; }, async publish() { throw error; } };
}
if (replicaTransportLoadError) logStructured('error', 'replica.transport_module_unavailable', { category: 'replica', message: replicaTransportLoadError.message });
let replicaCapturedAt = '';
let replicaSourceSha = '';
let replicaPublishChain = Promise.resolve();
let replicaRemotePollInProgress = false;

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

const LOGIN_HUMAN_CHECK_TTL_MS = 5 * 60 * 1000;
const LOGIN_HUMAN_CHECK_USED_MAX = 10000;
const usedLoginHumanChecks = new Map();
const loginHumanCheckRequired = () => process.env.NODE_ENV !== 'test' || process.env.LF_TEST_REQUIRE_HUMAN_CHECK === '1';
const loginHumanCheckKey = crypto.createHash('sha256')
  .update(`${process.env.SESSION_SECRET || 'little-feet-session-secret'}\nlogin-human-check-v2`)
  .digest();
const loginHumanCheckClientHash = req => crypto.createHash('sha256')
  .update(String(req.get('user-agent') || '').slice(0, 500))
  .digest('hex');
const loginHumanCheckSignature = ({ nonce, expiresAt, clientHash, answer }) => crypto
  .createHmac('sha256', loginHumanCheckKey)
  .update(`${nonce}\n${expiresAt}\n${clientHash}\n${String(answer ?? '').trim()}`)
  .digest('hex');

const pruneUsedLoginHumanChecks = (now = Date.now()) => {
  for (const [key, expiresAt] of usedLoginHumanChecks) {
    if (Number(expiresAt) < now) usedLoginHumanChecks.delete(key);
  }
  while (usedLoginHumanChecks.size > LOGIN_HUMAN_CHECK_USED_MAX) {
    usedLoginHumanChecks.delete(usedLoginHumanChecks.keys().next().value);
  }
};

const issueLoginHumanCheck = req => {
  const first = crypto.randomInt(2, 10);
  const second = crypto.randomInt(1, 9);
  const subtract = crypto.randomInt(0, 2) === 1;
  const left = subtract ? Math.max(first, second) : first;
  const right = subtract ? Math.min(first, second) : second;
  const answer = subtract ? left - right : left + right;
  const nonce = crypto.randomBytes(18).toString('hex');
  const expiresAt = Date.now() + LOGIN_HUMAN_CHECK_TTL_MS;
  const clientHash = loginHumanCheckClientHash(req);
  const signature = loginHumanCheckSignature({ nonce, expiresAt, clientHash, answer });
  return {
    challengeId: `${nonce}.${expiresAt}.${signature}`,
    prompt: `What is ${left} ${subtract ? '−' : '+'} ${right}?`,
    left,
    right,
    operator: subtract ? '−' : '+',
    expiresInSeconds: Math.floor(LOGIN_HUMAN_CHECK_TTL_MS / 1000)
  };
};

const verifyLoginHumanCheck = (req, body) => {
  if (!loginHumanCheckRequired()) return true;
  const challengeId = limitedText(body?.humanCheckId, 180);
  const answer = limitedText(body?.humanCheckAnswer, 20);
  const honeypot = limitedText(body?.companyWebsite, 200);
  if (honeypot || !challengeId || !answer) return false;

  const parts = challengeId.split('.');
  if (parts.length !== 3) return false;
  const [nonce, expiresText, suppliedSignature] = parts;
  if (!/^[a-f0-9]{36}$/.test(nonce) || !/^\d{13}$/.test(expiresText) || !/^[a-f0-9]{64}$/.test(suppliedSignature)) return false;

  const expiresAt = Number(expiresText);
  const now = Date.now();
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now || expiresAt > now + LOGIN_HUMAN_CHECK_TTL_MS + 30000) return false;

  pruneUsedLoginHumanChecks(now);
  const fingerprint = crypto.createHash('sha256').update(challengeId).digest('hex');
  if (usedLoginHumanChecks.has(fingerprint)) return false;
  usedLoginHumanChecks.set(fingerprint, expiresAt);

  const expectedSignature = loginHumanCheckSignature({
    nonce,
    expiresAt,
    clientHash: loginHumanCheckClientHash(req),
    answer
  });
  const expected = Buffer.from(expectedSignature, 'hex');
  const actual = Buffer.from(suppliedSignature, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

// Serve this before express-session so the login page does not wait for the
// database-backed session store just to display the human-verification prompt.
app.get('/api/auth/human-check', (req, res) => {
  if (!enforcePublicRateLimit(req, res, 'login-human-check', 60, 10 * 60 * 1000)) return;
  res.set('Cache-Control', 'no-store');
  if (!loginHumanCheckRequired()) return res.json({ required: false });
  res.json({ required: true, ...issueLoginHumanCheck(req) });
});

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
    const configuredOrigins = String(process.env.LF_ALLOWED_BROWSER_ORIGINS || '').split(',').map(value => {
      try { return new URL(value.trim()).origin; } catch { return ''; }
    }).filter(Boolean);
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const canonicalOriginAllowed = sourceUrl.protocol === 'https:' && configuredOrigins.includes(sourceUrl.origin);
    if ((sourceUrl.origin !== requestOrigin && !canonicalOriginAllowed) || sourceUrl.protocol !== `${req.protocol}:`) {
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
  '/api/payments/payfast/itn',
  '/api/payments/reconcile',
  '/api/company/billing/reconcile',
  '/api/finance/recurring-runs',
  '/api/finance/reconciliation/apply',
  '/api/students/import',
  '/api/learner-access-codes/generate-batch',
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
  if (readOnlySnapshotMode) return;
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
  const connectionUrl = new URL(process.env.DATABASE_URL);
  const explicitSslMode = process.env.PGSSLMODE || connectionUrl.searchParams.get('sslmode');
  const defaultSslMode = String(process.env.RENDER || '').toLowerCase() === 'true' ? 'require' : 'verify-full';
  const sslMode = String(explicitSslMode || defaultSslMode).toLowerCase();
  const tlsFile = name => {
    const filename = connectionUrl.searchParams.get(name);
    return filename ? fs.readFileSync(filename, 'utf8') : undefined;
  };
  const configuredCa = process.env.LF_POSTGRES_CA_CERT
    ? String(process.env.LF_POSTGRES_CA_CERT).replace(/\\n/g, '\n')
    : connectionUrl.searchParams.has('sslrootcert')
      ? tlsFile('sslrootcert')
      : undefined;
  const ssl = sslMode === 'disable' || connectionUrl.searchParams.get('ssl') === 'false' ? false : {
    // PostgreSQL sslmode=require guarantees encryption but does not require
    // certificate verification. Render's private Postgres endpoints use
    // self-signed certificates and explicitly support sslmode=require.
    // Keep verification enabled for every stricter/default mode and whenever
    // a CA has been supplied.
    rejectUnauthorized: Boolean(configuredCa) || sslMode !== 'require',
    ...(configuredCa ? { ca: configuredCa } : {}),
    ...(connectionUrl.searchParams.has('sslcert') ? { cert: tlsFile('sslcert') } : {}),
    ...(connectionUrl.searchParams.has('sslkey') ? { key: tlsFile('sslkey') } : {})
  };
  // URL SSL parameters otherwise replace pg's explicit TLS options. Resolve
  // them above so sslmode=require cannot silently remove verification or a CA.
  ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey'].forEach(name => connectionUrl.searchParams.delete(name));
  postgresPool = new Pool({
    connectionString: connectionUrl.toString(),
    ssl,
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
  migrateSchoolSubscriptionTrials();
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
  const collections = ['posts', 'schedules', 'worksheets', 'badges', 'tickets', 'attendance', 'staffTasks', 'staffLeave', 'teacherCover', 'performanceReviews', 'staffQualifications', 'staffDevelopmentPlans', 'emailInbox', 'emailDismissals', 'staffNotices', 'meetingMinutes', 'maintenanceOrders', 'resourceBookings', 'purchaseRequests', 'broadcasts', 'campusVisitors', 'visitorMeetings', 'registry', 'consentRecords', 'pickupLogs', 'reportReviews', 'learnerAccessCodes', 'storeProducts', 'storeOrders', 'parentPayments', 'parentSubscriptions', 'bookRegister', 'paymentEvents', 'paymentLedger', 'financeRecurringRules', 'financeAdjustments', 'financeReconciliationRuns', 'payrollProfiles', 'payrollRuns', 'subjectMarks', 'markHistory', 'reportCards', 'disciplineRecords', 'disciplineSettings', 'assetRegister', 'gradeRSkillAssessments', 'dsdIncidents', 'communicationCampaigns', 'attendanceAutomationSettings', 'eldaSkillCatalogue', 'eldaAssessments', 'aftercareSettings', 'aftercarePlans', 'aftercareSessions', 'staffClockSessions', 'staffRatioSettings', 'dayCareBookings', 'dayCareCapacitySettings', 'mealPlans', 'dietaryProfiles', 'learnerGroups', 'learnerSubjectAssignments', 'pickupPasses', 'academicAnalyticsSettings', 'communicationTemplates', 'admissionsApplications', 'admissionsStatusHistory', 'documentAudit', 'systemErrors', 'importAudit', 'importJobs', 'fileRecords', 'storageCleanupJobs', 'chatGroups', 'directMessages'];
  collections.forEach(collection => {
    if (!Array.isArray(db[collection])) db[collection] = [];
    db[collection].forEach(record => {
      if (!record.schoolId && record.companyScope !== true) record.schoolId = record.schoolName ? ensureSchool(record.schoolName).id : defaultSchoolId;
    });
  });
  Object.values(db.moduleRecords || {}).forEach(records => (records || []).forEach(record => {
    if (!record.schoolId && record.companyScope !== true) record.schoolId = record.schoolName ? ensureSchool(record.schoolName).id : defaultSchoolId;
  }));
  db.students.forEach(record => { if (!record.schoolId) record.schoolId = defaultSchoolId; });
  if (!db.schoolTerms || typeof db.schoolTerms !== 'object') db.schoolTerms = {};
  if (!db.schoolTerms[defaultSchoolId]) db.schoolTerms[defaultSchoolId] = db.term;
  if (!db.schoolBilling || typeof db.schoolBilling !== 'object') db.schoolBilling = {};
  if (!db.schoolBilling[defaultSchoolId] && db.subscriptionBilling) db.schoolBilling[defaultSchoolId] = db.subscriptionBilling;
}

function migrateSchoolSubscriptionTrials() {
  if (!Array.isArray(db.schools)) db.schools = [];
  const now = Date.now();
  const trialMs = 14 * 24 * 60 * 60 * 1000;
  db.schools.forEach(school => {
    if (!school || typeof school !== 'object') return;
    if (school.subscriptionStatus === 'trial_pending') return;
    if (!school.subscriptionStatus) school.subscriptionStatus = 'trial';
    if (school.trialStartedAt && Number.isFinite(Date.parse(school.trialEndsAt || ''))) return;
    const createdAtMs = Date.parse(school.createdAt || '');
    const startMs = Number.isFinite(createdAtMs) && createdAtMs >= now - trialMs ? createdAtMs : now;
    school.trialStartedAt = new Date(startMs).toISOString();
    school.trialEndsAt = new Date(startMs + trialMs).toISOString();
  });
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
  if (readOnlySnapshotMode) return;
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
    return postgresSaveChain.then(() => { scheduleReplicaSnapshot(); });
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
    scheduleReplicaSnapshot();
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
    if (replicaCapturedAt && Number.isFinite(Date.parse(saved.replicatedAt))
      && Date.parse(saved.replicatedAt) < Date.parse(replicaCapturedAt)) return;
    if (applySavedState(saved)) {
      replicaSnapshotVersion = snapshotVersion;
      if (Number.isFinite(Date.parse(saved.replicatedAt))) replicaCapturedAt = new Date(saved.replicatedAt).toISOString();
    }
  } catch (error) {
    logStructured('error', 'replica.snapshot_load_failed', { category: 'replica', message: error.message });
  }
}
async function loadRemoteReplicaSnapshot() {
  if (!replicaMode || !replicaTransport.configured || replicaRemotePollInProgress) return;
  replicaRemotePollInProgress = true;
  try {
    const snapshot = await replicaTransport.load();
    if (!snapshot || snapshot.capturedAt === replicaCapturedAt) return;
    if (replicaCapturedAt && Date.parse(snapshot.capturedAt) < Date.parse(replicaCapturedAt)) return;
    if (!applySavedState({ ...snapshot.state, replicatedAt: snapshot.capturedAt })) throw new Error('Remote replica snapshot could not be applied.');
    replicaCapturedAt = snapshot.capturedAt;
    replicaSourceSha = snapshot.applicationSha;
    logStructured('info', 'replica.remote_snapshot_loaded', {
      category: 'replica', result: 'success', details: `Loaded encrypted snapshot from ${snapshot.applicationSha}; captured ${snapshot.capturedAt}.`
    });
  } catch (error) {
    logStructured('error', 'replica.remote_snapshot_load_failed', { category: 'replica', message: error.message });
  } finally {
    replicaRemotePollInProgress = false;
  }
}
function writeReplicaSnapshot() {
  if (replicaMode) return;
  try {
    const stagingFile = `${replicaFile}.next`;
    fs.writeFileSync(stagingFile, JSON.stringify({ ...db, replicatedAt: new Date().toISOString() }), 'utf8');
    fs.renameSync(stagingFile, replicaFile);
    const snapshot = { ...db, replicatedAt: new Date().toISOString() };
    if (replicaTransport.configured) {
      replicaPublishChain = replicaPublishChain.catch(() => {}).then(() => replicaTransport.publish(snapshot, {
        applicationSha: applicationSha || 'unrecorded'
      })).then(result => {
        replicaCapturedAt = result.capturedAt;
        replicaSourceSha = applicationSha || 'unrecorded';
        logStructured('info', 'replica.remote_snapshot_published', {
          category: 'replica', result: 'success', details: `Encrypted standby snapshot published (${result.bytes} bytes).`
        });
      }).catch(error => {
        logStructured('error', 'replica.remote_snapshot_publish_failed', { category: 'replica', message: error.message });
      });
    }
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
const DIAGNOSTIC_HISTORY_RESET_ID = 'inspect-clean-slate-20261001-v1';
function applyDiagnosticHistoryResetMigration() {
  if (!db.diagnosticMigrations || typeof db.diagnosticMigrations !== 'object' || Array.isArray(db.diagnosticMigrations)) db.diagnosticMigrations = {};
  if (db.diagnosticMigrations[DIAGNOSTIC_HISTORY_RESET_ID]) return false;
  if (!Array.isArray(db.systemErrors)) db.systemErrors = [];
  const removedPersistentFaults = db.systemErrors.length;
  const removedRuntimeLogs = structuredLogger.clear();
  db.systemErrors = [];
  db.diagnosticMigrations[DIAGNOSTIC_HISTORY_RESET_ID] = {
    appliedAt: new Date().toISOString(),
    removedPersistentFaults,
    removedRuntimeLogs
  };
  return true;
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
  if (readOnlySnapshotMode) {
    loadReplicaSnapshot();
    if (!replicaTransport.configured) {
      logStructured('warn', 'replica.remote_transport_unconfigured', {
        category: 'configuration', details: `Standby is limited to a local snapshot. Missing: ${replicaTransport.missing.join(', ')}.`
      });
    } else {
      void loadRemoteReplicaSnapshot();
      replicaRemoteTimer = setInterval(() => { void loadRemoteReplicaSnapshot(); }, 10000);
    }
    replicaTimer = setInterval(loadReplicaSnapshot, 2000);
    return;
  }
  if (process.env.DATABASE_URL) await openPostgresDatabase();
  else openStateDatabase();
  const restoredFromDatabase = await loadDatabaseState();
  if (sharedDatabaseFailover) {
    if (!restoredFromDatabase) throw new Error('Shared-database standby refused startup because the primary Little Feet database contains no persisted state.');
    logStructured('info', 'failover.shared_database_standby_ready', {
      category: 'failover', result: 'ready', details: 'Standby uses the authoritative PostgreSQL database; writes are serialized by the shared advisory lock.'
    });
    let sharedStateRefreshInProgress = false;
    const sharedStateRefreshTimer = setInterval(() => {
      if (activeSharedDatabaseMutations > 0 || sharedStateRefreshInProgress || !postgresPool) return;
      sharedStateRefreshInProgress = true;
      void withPersistentMutation(() => {}).catch(error => {
        logStructured('error', 'failover.shared_database_refresh_failed', { category: 'failover', message: error.message });
      }).finally(() => { sharedStateRefreshInProgress = false; });
    }, 3000);
    sharedStateRefreshTimer.unref?.();
    return;
  }
  if (!restoredFromDatabase) loadReplicaSnapshot();
  const diagnosticHistoryResetApplied = applyDiagnosticHistoryResetMigration();
  const ownerAccountResetApplied = applyOwnerAccountMigration();
  ensureBootstrapAdministrator();
  syncConfiguredPlatformOwnerAccess();
  migrateSchoolTenancy();
  migrateSchoolSubscriptionTrials();
  migrateSensitiveStoredFields();
  removeLegacyMailboxConnections();
  ensureAllLearnersHaveAccessCodes();
  syncCurrentReleaseNotes();
  await retryPendingStorageCleanup();
  await saveDatabaseState();
  if (diagnosticHistoryResetApplied) {
    logStructured('info', 'inspection.history_reset_applied', {
      category: 'migration',
      result: 'completed',
      message: 'Previous Inspect diagnostic history was cleared for the centralized logging clean slate.'
    });
  }
  if (ownerAccountResetApplied && postgresPool) await postgresPool.query('DELETE FROM little_feet_sessions');
  // saveDatabaseState already queued a debounced snapshot. Cancel it before the
  // immediate startup publish so an unchanged state is not uploaded twice.
  if (replicaSnapshotTimer) {
    clearTimeout(replicaSnapshotTimer);
    replicaSnapshotTimer = null;
  }
  writeReplicaSnapshot();
}

persistenceReady = initialisePersistence();

// API Endpoints
// Auth
const establishAuthenticatedSession = (req, account, callback, authMethod = 'password') => {
  ensureSchoolTrialStarted(account);
  const safeUser = safeAccount(account);
  req.session.regenerate(regenerateError => {
    if (regenerateError) return callback(regenerateError);
    req.session.littleFeetUser = safeUser;
    req.session.save(saveError => {
      if (!saveError) {
        logStructured('info', 'auth.login_succeeded', {
          category: 'authentication',
          requestId: req.requestId,
          user: account?.username || '',
          role: account?.role || '',
          schoolId: account ? accountSchoolId(account) : '',
          schoolName: account?.schoolName || '',
          method: req.method,
          route: req.path,
          result: 'success',
          details: `Sign-in method: ${authMethod}`
        });
        void sendSuccessfulLoginEmail(req, account, authMethod).then(sent => {
          if (sent) logStructured('info', 'auth.login_notification_sent', {
            category: 'authentication',
            requestId: req.requestId,
            user: account?.username || '',
            role: account?.role || '',
            schoolId: account ? accountSchoolId(account) : '',
            schoolName: account?.schoolName || '',
            method: req.method,
            route: req.path,
            result: 'sent'
          });
        }).catch(error => {
          logStructured('error', 'auth.login_notification_failed', {
            category: 'authentication',
            requestId: req.requestId,
            user: account?.username || '',
            role: account?.role || '',
            schoolId: account ? accountSchoolId(account) : '',
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

app.post('/api/login', (req, res) => {
  const { username, pin } = req.body;
  if (!verifyLoginHumanCheck(req, req.body)) {
    logStructured('warn', 'auth.human_check_failed', {
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
    if (isAwaitingAccountVerification(user)) {
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
app.get('/api/failover-readiness', async (req, res) => {
  const capturedMs = Date.parse(replicaCapturedAt);
  const ageSeconds = Number.isFinite(capturedMs) ? Math.max(0, Math.floor((Date.now() - capturedMs) / 1000)) : null;
  const maximumAgeSeconds = Math.max(30, Math.min(600, Number(process.env.LF_REPLICA_MAX_AGE_SECONDS) || 120));
  const versionMatch = applicationSha && replicaSourceSha
    ? applicationSha === replicaSourceSha
    : false;
  let sharedDatabaseReady = false;
  if (sharedDatabaseFailover && postgresPool) {
    try {
      await postgresPool.query('SELECT 1 FROM little_feet_metadata LIMIT 1');
      sharedDatabaseReady = true;
    } catch (error) {
      logStructured('warn', 'failover.shared_database_readiness_failed', { category: 'failover', message: error.message });
    }
  }
  const ready = sharedDatabaseFailover ? sharedDatabaseReady : replicaMode && replicaTransport.configured && ageSeconds !== null
    && ageSeconds <= maximumAgeSeconds && versionMatch === true;
  res.set('Cache-Control', 'no-store');
  res.set('Access-Control-Allow-Origin', '*');
  return res.status(ready ? 200 : 503).json({
    ready,
    instance: replicaMode ? 'STANDBY' : 'PRIMARY',
    mode: sharedDatabaseFailover ? 'shared-postgresql-writable' : replicaMode ? 'r2-snapshot-read-only' : 'primary',
    writeCapable: !readOnlySnapshotMode,
    configured: sharedDatabaseFailover ? Boolean(process.env.DATABASE_URL) : replicaTransport.configured,
    capturedAt: replicaCapturedAt || null,
    ageSeconds,
    maximumAgeSeconds,
    applicationSha: applicationSha || null,
    replicaSourceSha: replicaSourceSha || null,
    versionMatch: sharedDatabaseFailover ? null : versionMatch
  });
});
app.get('/api/health', async (req, res) => {
  // Do not count the health probe itself, and do not report normal concurrent
  // dashboard startup requests as server overload.
  const reportedActiveRequests = Math.max(0, activeRequestCount - 1);
  const status = reportedActiveRequests >= SERVER_BUSY_THRESHOLD ? 'BUSY' : 'OK';
  const actor = getSessionAccount(req);
  res.set('Cache-Control', 'no-store');
  let persistenceAvailable = true;
  if (postgresPool) {
    try { await postgresPool.query('SELECT 1'); }
    catch (error) {
      persistenceAvailable = false;
      logStructured('warn', 'persistence.health_probe_failed', { category: 'persistence', message: error.message });
    }
  }
  if (!persistenceAvailable) res.status(503);
  if (!actor) return res.json({ status: persistenceAvailable ? status : 'DATABASE_UNAVAILABLE', timestamp: new Date().toISOString() });
  return res.json({
    status: persistenceAvailable ? status : 'DATABASE_UNAVAILABLE',
    instance: replicaMode ? 'STANDBY' : 'PRIMARY',
    replica: replicaMode ? {
      mode: sharedDatabaseFailover ? 'shared-postgresql-writable' : 'r2-snapshot-read-only',
      transport: sharedDatabaseFailover ? 'shared-postgresql' : replicaTransport.configured ? 'cloudflare-r2' : 'local-file-only',
      configured: sharedDatabaseFailover ? Boolean(process.env.DATABASE_URL) : replicaTransport.configured,
      available: sharedDatabaseFailover ? Boolean(postgresPool) : Boolean(replicaCapturedAt),
      capturedAt: replicaCapturedAt || null,
      ageSeconds: replicaCapturedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(replicaCapturedAt)) / 1000)) : null,
      applicationSha: replicaSourceSha || null
    } : undefined,
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
    payfastAutomaticConfirmation: payFastConfigured(),
    emailDelivery: Boolean(smtpEmailConfigured() || apiEmailConfigured()),
    smsDelivery: Boolean(process.env.LF_SMS_FROM && process.env.LF_SMS_API_KEY && safeHttpsUrl(process.env.LF_SMS_API_URL)),
    pushDelivery: Boolean(process.env.LF_PUSH_API_KEY && safeHttpsUrl(process.env.LF_PUSH_API_URL)),
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
  if (!integrations.paymentDestination) missingActions.push('Configure a bank-transfer destination, HTTPS payment link, or PayFast automatic confirmation.');
  if (payFastMode === 'sandbox' && isProduction) missingActions.push('Production cannot use PayFast sandbox mode. Set LF_PAYFAST_MODE=live.');
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
  platformAccess: hasPlatformAccess(account),
  ...(account.role === 'parent' ? { subscription: parentSubscriptionActive(account) ? 'plus' : 'basic', parentSubscriptionActive: parentSubscriptionActive(account) } : {}),
  ...(!PLATFORM_INTERNAL_ROLES.has(account.role) ? { schoolSubscriptionAccess: schoolSubscriptionAccessState(account) } : {})
});
const getSessionAccount = (req) => {
  const username = req.session?.littleFeetUser?.username;
  const account = username ? findAccountByUsername(username) : null;
  return account && !isAwaitingAccountVerification(account) ? account : null;
};
const requireAdmin = (req) => {
  const account = getSessionAccount(req);
  return isAdminLike(account) ? account : null;
};
const requireAccountManager = req => {
  const account = getSessionAccount(req);
  return account && (isAdminLike(account) || account.role === 'crm') ? account : null;
};
const requireSchoolStaff = (req) => {
  const account = getSessionAccount(req);
  return account && (hasPlatformAccess(account) || ['teacher', 'principal', 'admin', 'staff', 'crm', 'accounts', 'support', 'school_accounts', 'school_staff', 'school_hr'].includes(account.role)) ? account : null;
};
const requireCompanyStaff = (req) => {
  const account = getSessionAccount(req);
  return isCompanyStaffRole(account) ? account : null;
};
const SCHOOL_SUBSCRIPTION_EXEMPT_API_PREFIXES = Object.freeze([
  '/api/auth/', '/api/subscription-billing', '/api/payments/', '/api/release-notes',
  '/api/account-deletion-request', '/api/system/client-log'
]);
app.use('/api', (req, res, next) => {
  const pathOnly = String(req.originalUrl || '').split('?')[0];
  const employee = getSessionAccount(req);
  if (['school_staff','school_hr'].includes(employee?.role)) {
    const personal = /^\/api\/(?:auth\/|email\/(?!inbound\/)|chat\/|release-notes$|system\/client-log$|staff\/(?:directory|tasks|leave|qualifications|kpi-history|kpi-monthly|development-plans|performance-reviews)(?:\/|$)|tickets(?:\/|$)|account-deletion-request$)/.test(pathOnly);
    if (!personal) return res.status(403).json({message:'This position has access to staff work and communication only.'});
  }

  if (employee && PLATFORM_INTERNAL_ROLES.has(employee.role)) {
    // Deny by default even when a legacy employee has platformAccess stored as true.
    const common = /^\/api\/(?:auth\/|email\/(?!inbound\/)|chat\/|release-notes$|system\/client-log$|staff\/(?:directory|tasks|leave|qualifications|kpi-history|kpi-monthly|development-plans|performance-reviews)(?:\/|$)|tickets(?:\/|$)|account-deletion-request$)/.test(pathOnly);
    const job = (employee.role === 'crm' && /^\/api\/company\/clients(?:\/|$)/.test(pathOnly))
      || (employee.role === 'crm' && (/^\/api\/accounts(?:\/|$)/.test(pathOnly) || pathOnly === '/api/schools/search'))
      || (employee.role === 'accounts' && /^\/api\/company\/billing(?:\/|$)/.test(pathOnly));
    if (!common && !job) return res.status(403).json({ message: 'This tool is outside your company job permissions.' });
  }
  if (SCHOOL_SUBSCRIPTION_EXEMPT_API_PREFIXES.some(prefix => pathOnly.startsWith(prefix))) return next();
  const actor = getSessionAccount(req);
  if (!actor || hasPlatformAccess(actor) || PLATFORM_INTERNAL_ROLES.has(actor.role)) return next();
  const access = schoolSubscriptionAccessState(actor);
  if (access.allowed) return next();
  return res.status(402).json({
    code: 'SCHOOL_SUBSCRIPTION_REQUIRED',
    message: access.status === 'trial_expired'
      ? 'The school\'s 14-day Little Feet trial has ended. A principal or administrator must activate a school subscription to continue.'
      : access.status === 'trial_pending'
        ? 'The school\'s 14-day Little Feet trial has not started yet. A principal or administrator must sign in to activate it.'
        : 'The school subscription has expired or is inactive. A principal or administrator must renew it to continue.',
    subscription: access
  });
});
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
    const schoolLearners = tenantRecords(db.students, actor);
    const outsideClassNames = new Set(schoolLearners
      .filter(student => !assignedClasses.has(normalizeComparableText(student.className)))
      .map(student => normalizeComparableText(student.studentName)));
    const assignedLearnerIds = new Set(schoolLearners
      .filter(student => assignedClasses.has(normalizeComparableText(student.className)))
      .map(student => String(student.id || '')).filter(Boolean));
    const assignedLearners = new Set(
      schoolLearners
        .filter(student => assignedClasses.has(normalizeComparableText(student.className)))
        .map(student => normalizeComparableText(student.studentName))
        .filter(name => !outsideClassNames.has(name))
    );
    return schoolRecords.filter(record => {
      const learnerId = String(record.learnerId || record.learnerKey || record.studentId || '');
      if (learnerId) return assignedLearnerIds.has(learnerId);
      const recordClass = normalizeComparableText(record.className);
      if (recordClass) return assignedClasses.has(recordClass);
      return assignedLearners.has(normalizeComparableText(record.studentName || record.learnerName));
    });
  }
  return schoolRecords;
};
const errorSourceLocation = error => {
  const stack = String(error?.stack || '').split('\n').slice(1);
  for (const frame of stack) {
    const match = frame.match(/(?:\(|\s)([^()\s]+\.js):(\d+):(\d+)\)?/);
    if (!match) continue;
    const absolute = match[1].startsWith('file://') ? match[1].slice(7) : match[1];
    const relative = path.relative(__dirname, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    return { source: relative.replaceAll('\\', '/'), line: Number(match[2]), column: Number(match[3]) };
  }
  return { source: '', line: null, column: null };
};

const recordSystemError = (error, req = null, extra = {}) => {
  if (!Array.isArray(db.systemErrors)) db.systemErrors = [];
  const actor = req ? getSessionAccount(req) : null;
  const route = String(extra.route || req?.originalUrl || '').split('?')[0].slice(0, 240);
  const location = extra.source
    ? { source: boundedText(extra.source, 240), line: Number(extra.line) || null, column: Number(extra.column) || null }
    : errorSourceLocation(error);
  const entry = {
    id: crypto.randomUUID(), requestId: req?.requestId || '', schoolId: actor ? accountSchoolId(actor) : '',
    method: String(req?.method || extra.method || 'SYSTEM').slice(0, 12),
    route,
    name: String(extra.name || error?.name || 'Error').slice(0, 80), message: redactSensitiveLogText(error?.message || 'Unknown server error'),
    source: location.source, line: location.line, column: location.column,
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
    source: entry.source,
    line: entry.line,
    column: entry.column,
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

app.delete('/api/system-inspect-history', async (req, res, next) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });

  const platformWide = hasPlatformAccess(actor);
  const schoolId = accountSchoolId(actor);
  const beforeFaults = Array.isArray(db.systemErrors) ? db.systemErrors : [];
  const removedPersistentFaults = platformWide
    ? beforeFaults.length
    : beforeFaults.filter(entry => entry.schoolId === schoolId).length;

  db.systemErrors = platformWide
    ? []
    : beforeFaults.filter(entry => entry.schoolId !== schoolId);

  const removedRuntimeLogs = structuredLogger.clear(entry =>
    platformWide || (entry.schoolId && entry.schoolId === schoolId)
  );

  try {
    await saveDatabaseState();
    req.persistenceCommitted = true;
    logStructured('info', 'inspection.history_cleared', {
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
    source,
    line,
    column,
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
      recordSystemError(clientError, req, { severity: 'error', route: page, name: code, source, line, column });
    }
  }
  res.status(201).json({ success: true, logId: logged.id, requestId: req.requestId });
});

const sourceFinding = (severity, category, check, issue, why, source = '', line = null, column = null, recommendation = '') => ({
  id: crypto.randomUUID(), severity, category, check, issue, why, source, line, column, recommendation
});
const sourceLineNumber = (content, offset) => content.slice(0, Math.max(0, offset)).split('\n').length;
const scanSourceMatches = (sourceName, content, rules) => {
  const findings = [];
  for (const rule of rules) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g';
    const regex = new RegExp(rule.pattern.source, flags);
    let match;
    while ((match = regex.exec(content))) {
      findings.push(sourceFinding(rule.severity, rule.category, rule.check, rule.issue, rule.why, sourceName, sourceLineNumber(content, match.index), null, rule.recommendation));
      if (!match[0].length) regex.lastIndex += 1;
      if (findings.length >= 100) return findings;
    }
  }
  return findings;
};

const runAdminSelfTest = async actor => {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const checks = [];
  const findings = [];
  const addCheck = (name, status, detail) => checks.push({ name, status, detail });
  const addFinding = (...args) => findings.push(sourceFinding(...args));

  const readiness = runtimeReadiness();
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
    if (postgresPool) await postgresPool.query('SELECT 1');
    else if (stateDatabase) stateDatabase.prepare('SELECT 1').get();
    else throw new Error('No active database adapter is available.');
    addCheck('database.probe', 'passed', 'A live database SELECT 1 probe succeeded.');
  } catch (error) {
    addCheck('database.probe', 'failed', 'Database probe failed.');
    const location = errorSourceLocation(error);
    addFinding('error', 'persistence', 'database.probe', 'The live database probe failed.', redactSensitiveLogText(error.message), location.source, location.line, location.column, 'Inspect the database connection and Render database availability.');
  }

  const indexPath = path.join(__dirname, 'index.html');
  let indexSource = '';
  try {
    indexSource = fs.readFileSync(indexPath, 'utf8');
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
        addFinding('error', 'security', 'frontend.asset_reference', 'A public asset reference contains parent-directory traversal.', 'A deployed page should never reference a static file through .. path traversal.', 'index.html', sourceLineNumber(indexSource, reference.offset), null, 'Replace it with a normal same-origin asset path.');
        continue;
      }
      if (checked.has(local)) continue;
      checked.add(local);
      const vendorAsset = local.startsWith('vendor/') ? local.slice('vendor/'.length) : '';
      const routeBackedAsset = Boolean(vendorAsset && Object.prototype.hasOwnProperty.call(browserVendorSources, vendorAsset));
      if (!fs.existsSync(path.join(__dirname, local)) && !routeBackedAsset) {
        addFinding('error', 'frontend', 'frontend.asset_reference', `Missing deployed asset: ${local}`, 'index.html references a same-origin asset that is neither present on disk nor provided by an approved application route, which can cause broken UI, scripts, images or styles.', 'index.html', sourceLineNumber(indexSource, reference.offset), null, 'Restore the referenced file, add the approved serving route, or correct the index.html reference.');
      }
    }
    addCheck('frontend.asset_references', findings.some(item => item.check === 'frontend.asset_reference') ? 'failed' : 'passed', `${checked.size} local deployed asset references checked.`);
  } catch (error) {
    const location = errorSourceLocation(error);
    addCheck('frontend.asset_references', 'failed', 'Could not inspect index.html.');
    addFinding('error', 'frontend', 'frontend.asset_references', 'The deployed page could not be inspected.', redactSensitiveLogText(error.message), location.source, location.line, location.column, 'Verify that index.html exists and is readable in the deployed application.');
  }

  const publicFiles = ['index.html', 'backup.js'];
  try {
    const assetDir = path.join(__dirname, 'assets');
    for (const entry of fs.readdirSync(assetDir, { withFileTypes: true })) {
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
      const content = fs.readFileSync(path.join(__dirname, relative), 'utf8');
      publicScanned += 1;
      findings.push(...scanSourceMatches(relative, content, publicThreatRules));
    } catch (error) {
      addFinding('warn', 'frontend', 'public.source_scan', `Could not inspect public source file ${relative}.`, redactSensitiveLogText(error.message), relative, null, null, 'Verify the deployed file exists and is readable.');
    }
  }
  addCheck('public.secret_boundary', findings.some(item => item.check === 'public.secret_boundary') ? 'failed' : 'passed', `${publicScanned} public source files scanned for server-only secrets and database URLs.`);

  try {
    const { auditRouteConnections } = require('./scripts/audit-route-connections');
    const routeAudit = auditRouteConnections(__dirname);
    const hasBrokenRoute = routeAudit.unmatched.length > 0;
    addCheck('frontend.route_connections', hasBrokenRoute ? 'failed' : 'passed', String(routeAudit.calls.length) + ' literal frontend API call(s) checked against ' + String(routeAudit.routes.length) + ' registered API route(s).');
    for (const call of routeAudit.unmatched.slice(0, 100)) {
      addFinding('error', 'routing', 'frontend.route_connections', 'No matching server route for ' + call.method + ' ' + call.route + '.', 'The deployed frontend contains an API call that does not match any registered server endpoint, so that action can fail at runtime.', call.file, call.line || null, null, 'Restore the matching server route or correct the frontend API path/method.');
    }
  } catch (error) {
    const location = errorSourceLocation(error);
    addCheck('frontend.route_connections', 'failed', 'The deployed frontend/server route audit could not run.');
    addFinding('error', 'routing', 'frontend.route_connections', 'The API route connection audit could not complete.', redactSensitiveLogText(error.message), location.source, location.line, location.column, 'Verify scripts/audit-route-connections.js is present and readable in the deployed build.');
  }

  const runtimeSourceFiles = ['server.js', 'finance-automation-server.js', 'backup.js', ...publicFiles.filter(name => name.startsWith('assets/'))];
  const executionRules = [
    { pattern: /\beval\s*\(/, severity: 'error', category: 'security', check: 'source.dynamic_code_execution', issue: 'eval() is present in deployed application source.', why: 'eval() can execute strings as code and expands the impact of injection bugs.', recommendation: 'Replace eval() with explicit parsing or normal function calls.' },
    { pattern: /\bnew\s+Function\s*\(/, severity: 'error', category: 'security', check: 'source.dynamic_code_execution', issue: 'new Function() is present in deployed application source.', why: 'Dynamic code construction can turn untrusted strings into executable code.', recommendation: 'Replace dynamic function creation with explicit application logic.' }
  ];
  for (const relative of [...new Set(runtimeSourceFiles)]) {
    try {
      const content = fs.readFileSync(path.join(__dirname, relative), 'utf8');
      const executionFindings = scanSourceMatches(relative, content, executionRules).filter(item => {
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
      const content = fs.readFileSync(path.join(__dirname, relative), 'utf8');
      const bypassRules = [{
        pattern: /\bconsole\.(?:log|info|warn|error|debug)\s*\(/,
        severity: 'warn', category: 'logging', check: 'logging.centralization',
        issue: 'A server console call bypasses the centralized structured logger.',
        why: 'Direct console output cannot be filtered and traced consistently in the Inspect dashboard.',
        recommendation: 'Route this event through logStructured().'
      }];
      findings.push(...scanSourceMatches(relative, content, bypassRules));
    } catch {}
  }
  addCheck('logging.centralization', findings.some(item => item.check === 'logging.centralization') ? 'attention' : 'passed', 'First-party server and browser runtime source checked for direct console logging bypasses.');

  const visibleErrors = (db.systemErrors || []).filter(entry => systemErrorVisibleTo(entry, actor) && entry.status === 'open');
  addCheck('faults.open', visibleErrors.length ? 'attention' : 'passed', visibleErrors.length ? `${visibleErrors.length} unresolved persistent fault(s) exist.` : 'No unresolved persistent faults.');
  visibleErrors.slice(0, 25).forEach(error => addFinding(
    'warn', 'fault-history', 'faults.open',
    `${error.name || 'Error'} remains ${error.status || 'open'}.`,
    error.message || 'A runtime fault was recorded and has not yet been resolved.',
    error.source || error.route || '', error.line || null, error.column || null,
    error.requestId ? `Trace request ${error.requestId} in Inspect & Logs, fix the cause, then mark the fault resolved.` : 'Review the fault, fix the cause, then mark it resolved.'
  ));

  const recentCutoff = Date.now() - 15 * 60 * 1000;
  const visibleLogs = structuredLogger.list().filter(entry => structuredLogVisibleTo(entry, actor) && Date.parse(entry.timestamp) >= recentCutoff);
  const serverErrors = visibleLogs.filter(entry => Number(entry.status) >= 500);
  const denied = visibleLogs.filter(entry => [401, 403].includes(Number(entry.status)));
  const limited = visibleLogs.filter(entry => Number(entry.status) === 429);
  const slow = visibleLogs.filter(entry => entry.event === 'http.request' && Number(entry.durationMs) >= structuredLogger.slowRequestMs);
  addCheck('traffic.server_errors', serverErrors.length ? 'attention' : 'passed', `${serverErrors.length} HTTP 5xx response(s) in the last 15 minutes.`);
  if (serverErrors.length) addFinding('warn', 'runtime', 'traffic.server_errors', `${serverErrors.length} server-error response(s) were recorded recently.`, 'HTTP 5xx responses mean a request reached the server but the server could not complete it successfully.', '', null, null, 'Filter Inspect logs to 5xx and trace the affected Request IDs.');
  addCheck('traffic.access_denied', denied.length >= 10 ? 'attention' : 'passed', `${denied.length} HTTP 401/403 response(s) in the last 15 minutes.`);
  if (denied.length >= 10) addFinding('warn', 'security', 'traffic.access_denied', 'A burst of access-denied responses was detected.', 'Repeated 401/403 responses can come from a broken client permission flow or from unauthorised probing.', '', null, null, 'Filter logs to 4xx, review users/routes and confirm the traffic is expected.');
  addCheck('traffic.rate_limited', limited.length >= 5 ? 'attention' : 'passed', `${limited.length} HTTP 429 response(s) in the last 15 minutes.`);
  if (limited.length >= 5) addFinding('warn', 'security', 'traffic.rate_limited', 'Repeated rate limiting was triggered.', 'A client is sending requests faster than the configured safety limit; this can be accidental retry behaviour or abusive automation.', '', null, null, 'Filter logs to HTTP 429 and identify the affected route/account pattern.');
  addCheck('performance.slow_requests', slow.length >= 5 ? 'attention' : 'passed', `${slow.length} request(s) exceeded ${structuredLogger.slowRequestMs} ms in the last 15 minutes.`);
  if (slow.length >= 5) addFinding('warn', 'performance', 'performance.slow_requests', 'Multiple slow requests were detected.', 'Repeated slow API calls can indicate database pressure, an external integration delay, or an expensive application path.', '', null, null, 'Sort the Inspect stream by route/request and investigate the slowest repeated path.');

  const errors = findings.filter(item => item.severity === 'error').length;
  const warnings = findings.filter(item => item.severity === 'warn').length;
  const completedAt = new Date().toISOString();
  const result = {
    runId: crypto.randomUUID(), startedAt, completedAt, durationMs: Date.now() - startedMs,
    status: errors ? 'failed' : warnings ? 'attention' : 'passed',
    summary: { checks: checks.length, passed: checks.filter(check => check.status === 'passed').length, attention: checks.filter(check => check.status === 'attention').length, failed: checks.filter(check => check.status === 'failed').length, errors, warnings },
    checks, findings
  };
  logStructured(errors ? 'error' : warnings ? 'warn' : 'info', 'system.self_test_completed', {
    category: 'diagnostics', user: actor.username, role: actor.role, schoolId: accountSchoolId(actor), schoolName: actor.schoolName || '',
    result: result.status, details: `${result.summary.checks} checks; ${errors} error finding(s); ${warnings} warning finding(s).`
  });
  return result;
};

app.post('/api/system-self-test', async (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  try {
    res.json(await runAdminSelfTest(actor));
  } catch (error) {
    recordSystemError(error, req, { severity: 'error', name: 'SELF_TEST_FAILURE' });
    res.status(500).json({ message: 'The site self-test could not complete. The failure was recorded for inspection.', requestId: req.requestId });
  }
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
  Object.freeze({ code: 'micro', name: 'Micro / ECD', maxLearners: 30, hardMaxLearners: 250, monthlyPrice: 350, overagePerLearner: 10 }),
  Object.freeze({ code: 'standard', name: 'Standard Primary', maxLearners: 250, hardMaxLearners: 1000, monthlyPrice: 1500, overagePerLearner: 6 }),
  Object.freeze({ code: 'enterprise', name: 'Enterprise Campus', maxLearners: 1000, hardMaxLearners: 1000, monthlyPrice: 7500, overagePerLearner: 0 })
]);
const schoolLearnerCount = schoolId => (db.students || []).filter(student => student.schoolId === schoolId).length;
const schoolPlanForCode = code => schoolSubscriptionPlans.find(plan => plan.code === String(code || '').trim().toLowerCase()) || null;
const planPriceForLearners = (plan, learnerCount) => {
  const count = Math.max(0, Number(learnerCount) || 0);
  const overageLearners = Math.max(0, count - plan.maxLearners);
  return {
    learnerCount: count,
    overageLearners,
    overageRate: plan.overagePerLearner,
    monthlyTotal: Math.round((plan.monthlyPrice + (overageLearners * plan.overagePerLearner)) * 100) / 100
  };
};
const schoolLearnerLimitState = actor => {
  const schoolId = accountSchoolId(actor);
  const school = db.schools.find(entry => entry.id === schoolId);
  const count = schoolLearnerCount(schoolId);
  const access = schoolSubscriptionAccessState(actor);
  if (!school || hasPlatformAccess(actor)) return { allowed: true, learnerCount: count, hardMaxLearners: 1000, planCode: '' };
  if (access.status === 'trial') return { allowed: count < 1000, learnerCount: count, hardMaxLearners: 1000, planCode: 'trial' };
  const plan = schoolPlanForCode(school.subscriptionPlanCode);
  const hardMaxLearners = plan?.hardMaxLearners || 1000;
  return { allowed: count < hardMaxLearners, learnerCount: count, hardMaxLearners, planCode: plan?.code || '' };
};

const payFastMode = String(process.env.LF_PAYFAST_MODE || 'live').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'live';
const payFastConfigured = () => Boolean(
  process.env.LF_PAYFAST_MERCHANT_ID && process.env.LF_PAYFAST_MERCHANT_KEY && process.env.LF_PAYFAST_PASSPHRASE
  && (!isProduction || payFastMode === 'live')
);
const payFastHost = () => payFastMode === 'sandbox' ? 'sandbox.payfast.co.za' : 'www.payfast.co.za';
const payFastProcessUrl = () => `https://${payFastHost()}/eng/process`;
const payFastValidationUrl = () => process.env.NODE_ENV === 'test' && process.env.LF_PAYFAST_TEST_VALIDATION_URL
  ? String(process.env.LF_PAYFAST_TEST_VALIDATION_URL)
  : `https://${payFastHost()}/eng/query/validate`;
const payFastUrlEncode = value => encodeURIComponent(String(value ?? '').trim())
  .replace(/%20/g, '+')
  .replace(/[!'()*~]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  .replace(/%[0-9a-f]{2}/gi, token => token.toUpperCase());
const payFastParamString = (entries, passphrase = '') => {
  const pairs = [];
  for (const [key, value] of entries) {
    if (key === 'signature' || value === '' || value == null) continue;
    pairs.push(`${key}=${payFastUrlEncode(value)}`);
  }
  if (passphrase) pairs.push(`passphrase=${payFastUrlEncode(passphrase)}`);
  return pairs.join('&');
};
const payFastSignature = entries => crypto.createHash('md5')
  .update(payFastParamString(entries, String(process.env.LF_PAYFAST_PASSPHRASE || '')))
  .digest('hex');
const payFastRawEntries = req => {
  if (Buffer.isBuffer(req.rawBody) && req.rawBody.length) return [...new URLSearchParams(req.rawBody.toString('utf8')).entries()];
  return Object.entries(req.body || {}).map(([key, value]) => [key, String(value ?? '')]);
};
const ipv4ToInt = ip => {
  const parts = String(ip || '').replace(/^::ffff:/, '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
};
const ipv4InCidr = (ip, cidr) => {
  const [network, bitsText] = cidr.split('/');
  const bits = Number(bitsText);
  const address = ipv4ToInt(ip), networkAddress = ipv4ToInt(network);
  if (address === null || networkAddress === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (networkAddress & mask);
};
const PAYFAST_PUBLISHED_CIDRS = Object.freeze([
  '197.97.145.144/28', '41.74.179.192/27', '102.216.36.0/28', '102.216.36.128/28', '144.126.193.139/32'
]);
let payFastResolvedIps = { expiresAt: 0, values: new Set() };
const payFastSourceIsValid = async req => {
  if (process.env.NODE_ENV === 'test' && process.env.LF_PAYFAST_TEST_ALLOW_LOCAL_ITN === '1') return true;
  const sourceIp = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (PAYFAST_PUBLISHED_CIDRS.some(cidr => ipv4InCidr(sourceIp, cidr))) return true;
  if (payFastResolvedIps.expiresAt <= Date.now()) {
    const hosts = ['www.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za', ...(payFastMode === 'sandbox' ? ['sandbox.payfast.co.za'] : [])];
    const resolved = (await Promise.all(hosts.map(host => dns.resolve4(host).catch(() => [])))).flat();
    payFastResolvedIps = { expiresAt: Date.now() + (10 * 60 * 1000), values: new Set(resolved) };
  }
  return payFastResolvedIps.values.has(sourceIp);
};
const payFastServerValidates = async paramString => {
  const response = await fetch(payFastValidationUrl(), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: paramString,
    signal: AbortSignal.timeout(10000)
  });
  return response.ok && String(await response.text()).trim() === 'VALID';
};
const htmlAttributeEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const billingDefaults = () => ({
  pricing: { baseMonthly: 0, bundles: { 5: { costPrice: 0, sellingPrice: 0 }, 20: { costPrice: 0, sellingPrice: 0 }, 100: { costPrice: 0, sellingPrice: 0 } }, lateFeeEnabled: false, lateFee: 0 },
  payment: { method: 'payment_link', paymentLink: '', accountName: '', bankName: '', accountNumberEncrypted: '', payMePayloadEncrypted: '', branchCode: '', referencePrefix: 'LF' },
  orders: []
});
const billingPaymentConfigured = (payment) => payment?.method === 'payfast'
  ? payFastConfigured()
  : payment?.method === 'payment_link'
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
  if (payment.method === 'payfast') return { method: 'PayFast', provider: 'payfast', automaticConfirmation: true, paymentLink: `/api/payments/payfast/checkout?reference=${encodeURIComponent(reference)}`, reference };
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
const schoolSubscriptionAccessState = account => {
  if (!account || hasPlatformAccess(account) || PLATFORM_INTERNAL_ROLES.has(account.role)) return { allowed: true, active: true, status: 'platform', trialEndsAt: '', activeUntil: '' };
  const schoolId = accountSchoolId(account);
  const school = db.schools.find(entry => entry.id === schoolId);
  if (!school) return { allowed: false, active: false, status: 'unverified', trialEndsAt: '', activeUntil: '' };
  const activeUntil = /^\d{4}-\d{2}-\d{2}$/.test(String(school.subscriptionActiveUntil || '')) ? String(school.subscriptionActiveUntil) : '';
  if (school.subscriptionStatus === 'active') {
    const allowed = !activeUntil || activeUntil >= dateKeyInSouthAfrica();
    return { allowed, active: allowed, status: allowed ? 'active' : 'expired', planCode: school.subscriptionPlanCode || '', activeUntil, trialEndsAt: school.trialEndsAt || '' };
  }
  if (['refunded', 'expired', 'cancelled', 'canceled'].includes(String(school.subscriptionStatus || '').toLowerCase())) {
    return { allowed: false, active: false, status: String(school.subscriptionStatus).toLowerCase(), planCode: school.subscriptionPlanCode || '', activeUntil, trialEndsAt: school.trialEndsAt || '' };
  }
  if (school.subscriptionStatus === 'trial_pending') {
    return { allowed: false, active: false, status: 'trial_pending', planCode: '', activeUntil, trialStartedAt: '', trialEndsAt: '' };
  }
  const trialEndMs = Date.parse(school.trialEndsAt || '');
  const allowed = Number.isFinite(trialEndMs) && trialEndMs >= Date.now();
  return { allowed, active: false, status: allowed ? 'trial' : 'trial_expired', planCode: '', activeUntil, trialStartedAt: school.trialStartedAt || '', trialEndsAt: school.trialEndsAt || '' };
};
const parentSubscriptionActive = account => {
  if (!account || account.role !== 'parent') return true;
  const grantedUntil = validDateKey(account.parentSubscriptionGrantedUntil);
  if (String(account.parentSubscriptionStatus || '').toLowerCase() === 'paid') return !grantedUntil || grantedUntil >= dateKeyInSouthAfrica();
  return Boolean(grantedUntil && grantedUntil >= dateKeyInSouthAfrica());
};
const validDateKey = value => {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(`${text}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
};
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

const STORE_RESERVATION_TTL_MS = 30 * 60 * 1000;
const storeProductForOrder = order => (db.storeProducts || []).find(product =>
  product.id === order?.productId && (!order?.schoolId || product.schoolId === order.schoolId)
) || null;
const storeAvailableQuantity = product => Math.max(0, (Number(product?.stockQuantity) || 0) - (Number(product?.reservedQuantity) || 0));
const updateStoreRoomRecord = (order, status, details) => {
  const records = Array.isArray(db.moduleRecords?.stock) ? db.moduleRecords.stock : [];
  const reference = String(order?.reference || '').toUpperCase();
  const record = records.find(entry =>
    entry.orderId === order?.id
    || String(entry.reference || '').toUpperCase() === reference
    || (reference && String(entry.details || '').toUpperCase().includes(`REF ${reference}`))
  );
  if (!record) return;
  record.status = status;
  if (details) record.details = details;
  record.updatedAt = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
};
const releaseStoreReservation = (order, timestamp, reason = 'failed') => {
  const quantity = Math.max(0, Number.parseInt(order?.quantity, 10) || 0);
  const product = storeProductForOrder(order);
  if (order?.stockAccountingVersion === 2) {
    if (order.stockReservationStatus === 'reserved') {
      if (product) product.reservedQuantity = Math.max(0, (Number(product.reservedQuantity) || 0) - quantity);
      order.stockReservationStatus = reason === 'expired' ? 'expired' : 'released';
      order.stockReleasedAt = timestamp;
    }
  } else if (!order?.legacyStockRestoredAt) {
    // Legacy store orders reduced stock at checkout. Restore it once when a payment fails or is refunded.
    if (product) product.stockQuantity = Math.max(0, (Number(product.stockQuantity) || 0) + quantity);
    order.legacyStockRestoredAt = timestamp;
    order.stockReservationStatus = 'returned_legacy';
  }
  if (reason === 'expired') {
    order.status = 'payment expired - stock released';
    order.fulfilmentStatus = 'payment_expired';
    updateStoreRoomRecord(order, 'Payment expired · stock released', `Store payment expired · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
  } else if (reason === 'cancelled') {
    order.status = 'cancelled - stock released';
    order.fulfilmentStatus = 'cancelled';
    order.cancelledAt = timestamp;
    updateStoreRoomRecord(order, 'Cancelled · stock released', `Store order cancelled · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
  } else if (reason === 'refunded') {
    order.status = 'refunded - stock returned';
    order.fulfilmentStatus = 'refunded';
    updateStoreRoomRecord(order, 'Refunded · stock returned', `Store refund confirmed · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
  } else {
    order.status = 'payment failed - stock released';
    order.fulfilmentStatus = 'payment_failed';
    updateStoreRoomRecord(order, 'Payment failed · stock released', `Store payment failed · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
  }
};
const releaseExpiredStoreReservations = (schoolId = '') => {
  const now = Date.now();
  (db.storeOrders || []).forEach(order => {
    if (order.stockAccountingVersion !== 2 || order.stockReservationStatus !== 'reserved') return;
    if (schoolId && order.schoolId !== schoolId) return;
    const reservedAt = Date.parse(order.stockReservedAt || order.createdAt || '');
    if (!Number.isFinite(reservedAt) || now - reservedAt < STORE_RESERVATION_TTL_MS) return;
    const hasPaidEvent = (db.paymentEvents || []).some(event =>
      event.status === 'paid' && event.targetType === 'store' && event.schoolId === order.schoolId
      && String(event.reference || '').toUpperCase() === String(order.reference || '').toUpperCase()
    );
    if (!hasPaidEvent) releaseStoreReservation(order, new Date().toISOString(), 'expired');
  });
};
const applyStorePaymentState = (target, normalStatus, timestamp) => {
  const order = target.record;
  const quantity = Math.max(0, Number.parseInt(order?.quantity, 10) || 0);
  const product = storeProductForOrder(order);

  if (normalStatus === 'paid') {
    if (order.stockAccountingVersion === 2) {
      if (order.stockReservationStatus === 'reserved') {
        if (product) {
          product.stockQuantity = Math.max(0, (Number(product.stockQuantity) || 0) - quantity);
          product.reservedQuantity = Math.max(0, (Number(product.reservedQuantity) || 0) - quantity);
        }
        order.stockReservationStatus = 'consumed';
        order.stockConsumedAt = timestamp;
      } else if (['released', 'expired'].includes(order.stockReservationStatus)) {
        if (product && storeAvailableQuantity(product) >= quantity) {
          product.stockQuantity = Math.max(0, (Number(product.stockQuantity) || 0) - quantity);
          order.stockReservationStatus = 'consumed_after_release';
          order.stockConsumedAt = timestamp;
        } else {
          order.stockReservationStatus = 'paid_stock_review';
        }
      }
    } else {
      order.stockReservationStatus = order.stockReservationStatus || 'consumed_legacy';
    }
    const needsReview = order.stockReservationStatus === 'paid_stock_review';
    order.status = needsReview ? 'paid - stock review required' : 'paid - ready to prepare';
    order.fulfilmentStatus = needsReview ? 'stock_review_required' : 'ready_to_prepare';
    updateStoreRoomRecord(
      order,
      needsReview ? 'PAID · STOCK REVIEW REQUIRED' : 'PAID · READY TO PREPARE',
      `Paid store order · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`
    );
    return;
  }

  if (normalStatus === 'failed') {
    releaseStoreReservation(order, timestamp, 'failed');
    return;
  }

  if (normalStatus === 'refunded') {
    if (order.stockAccountingVersion === 2 && ['consumed', 'consumed_after_release'].includes(order.stockReservationStatus)) {
      if (product) product.stockQuantity = Math.max(0, (Number(product.stockQuantity) || 0) + quantity);
      order.stockReservationStatus = 'returned';
      order.stockReturnedAt = timestamp;
      order.status = 'refunded - stock returned';
      order.fulfilmentStatus = 'refunded';
      updateStoreRoomRecord(order, 'Refunded · stock returned', `Store refund confirmed · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
    } else if (order.stockReservationStatus === 'paid_stock_review') {
      order.status = 'refunded - no stock adjustment required';
      order.fulfilmentStatus = 'refunded';
      order.stockReservationStatus = 'refunded_without_stock';
      order.stockReturnedAt = timestamp;
      updateStoreRoomRecord(order, 'Refunded · no stock adjustment', `Store refund confirmed · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
    } else {
      releaseStoreReservation(order, timestamp, 'refunded');
    }
  }
};
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
  const refundedEvent = db.paymentEvents.find(event => event.status === 'refunded'
    && event.targetType === target.type && event.schoolId === target.schoolId
    && String(event.reference || '').toUpperCase() === String(target.record.reference || '').toUpperCase());
  if (normalStatus === 'paid' && settledEvent) return { duplicate: true, event: settledEvent, target: target.record };
  if (normalStatus === 'refunded' && target.type !== 'parent_payment' && refundedEvent) return { duplicate: true, event: refundedEvent, target: target.record };
  if (normalStatus === 'refunded' && target.type !== 'parent_payment' && !settledEvent) return { error: 'A payment can be refunded only after it has been confirmed as paid.' };
  if (target.type === 'store' && normalStatus === 'failed' && settledEvent) return { error: 'A paid store order cannot be changed back to failed.' };
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
      school.subscriptionLearnerCapacity = target.record.learnerCapacity || 0;
      school.subscriptionHardMaxLearners = target.record.hardMaxLearners || 0;
      school.subscriptionActivatedAt = timestamp;
      school.subscriptionActiveUntil = extendSubscriptionDate(school.subscriptionActiveUntil, timestamp);
      target.record.activeUntil = school.subscriptionActiveUntil;
    } else if (school && normalStatus === 'refunded') {
      school.subscriptionStatus = 'refunded';
      school.subscriptionActiveUntil = '';
    }
  } else if (target.type === 'store') {
    applyStorePaymentState(target, normalStatus, timestamp);
  }
  db.paymentEvents.unshift(event);
  db.paymentLedger.unshift({
    id: crypto.randomUUID(), eventId, reference: target.record.reference, schoolId: target.schoolId,
    targetType: target.type, amount: numericAmount, status: normalStatus, source, createdAt: timestamp,
    recordedBy: actor?.username || 'signed-webhook'
  });
  return { duplicate: false, event, target: target.record };
};

// Company employees use business records rather than school administration APIs.
app.get('/api/company/clients', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || actor.role === 'crm')) return res.status(403).json({ message: 'Sales access is required.' });
  const notes = db.moduleRecords.companyClients || [];
  res.json(db.schools.map(school => ({
    id: school.id, name: school.name, area: school.area || school.city || '',
    status: school.subscriptionStatus || school.status || '',
    note: notes.find(record => record.clientSchoolId === school.id && record.createdBy === actor.username)?.details || ''
  })));
});
app.put('/api/company/clients/:id', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || actor.role === 'crm')) return res.status(403).json({ message: 'Sales access is required.' });
  if (!db.schools.some(school => school.id === req.params.id)) return res.status(404).json({ message: 'School not found.' });
  const details = limitedText(req.body?.note, 2000);
  if (details === null || typeof req.body?.note !== 'string') return res.status(400).json({ message: 'Enter a note of no more than 2,000 characters.' });
  const records = db.moduleRecords.companyClients ||= [];
  let record = records.find(item => item.clientSchoolId === req.params.id && item.createdBy === actor.username);
  if (!record) { record = { id: crypto.randomUUID(), clientSchoolId: req.params.id, createdBy: actor.username, schoolId: '', schoolName: '', companyScope: true }; records.push(record); }
  record.details = details; record.updatedAt = new Date().toISOString();
  res.json({ success: true });
});
app.get('/api/company/billing', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || actor.role === 'accounts')) return res.status(403).json({ message: 'Company accounts access is required.' });
  const orders = Object.entries(db.schoolBilling || {}).flatMap(([schoolId, billing]) => (billing.orders || []).map(order => ({
    schoolId, schoolName: db.schools.find(school => school.id === schoolId)?.name || schoolId,
    reference: order.reference, amount: order.monthlyTotal, status: order.paymentStatus || order.status || '', createdAt: order.createdAt
  })));
  const ledger = (db.paymentLedger || []).filter(entry => entry.targetType === 'subscription').map(entry => ({
    reference: entry.reference, amount: entry.amount, status: entry.status, createdAt: entry.createdAt, schoolId: entry.schoolId
  }));
  res.json({ orders, ledger });
});
app.post('/api/company/billing/reconcile', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || actor.role === 'accounts')) return res.status(403).json({ message: 'Company accounts access is required.' });
  const eventId = limitedText(req.body?.eventId, 160), bankReference = limitedText(req.body?.bankReference, 160);
  if (!eventId || !bankReference) return res.status(400).json({ message: 'A unique event ID and bank reference are required.' });
  const target = findPaymentTarget(req.body?.reference);
  if (!target || target.type !== 'subscription') return res.status(404).json({ message: 'School subscription invoice not found.' });
  const school = db.schools.find(item => item.id === target.schoolId);
  if (!school) return res.status(404).json({ message: 'School not found.' });
  const scope = { ...actor, role: 'admin', platformAccess: false, schoolId: school.id, schoolName: school.name };
  const result = applyPaymentEvent({ eventId: `company:${eventId}`, reference: target.record.reference, status: 'paid', amount: req.body?.amount,
    providerTransactionId: bankReference, source: 'manual-bank-reconciliation', receivedAt: new Date().toISOString() }, scope);
  if (result.error) return res.status(400).json({ message: result.error });
  res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate });
});

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
    payfastAvailable: payFastConfigured(),
    subscription: school ? {
      ...schoolSubscriptionAccessState(actor),
      learnerCount: schoolLearnerCount(accountSchoolId(actor)),
      learnerCapacity: Number(school.subscriptionLearnerCapacity || 0),
      hardMaxLearners: Number(school.subscriptionHardMaxLearners || 0)
    } : { allowed: false, active: false, status: 'unverified', planCode: '', activeUntil: '', trialEndsAt: '' },
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
  const requestedPaymentMethod = String(req.body?.payment?.method || 'payment_link').trim().toLowerCase();
  const paymentMethod = ['bank_transfer', 'payfast'].includes(requestedPaymentMethod) ? requestedPaymentMethod : 'payment_link';
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
  } else if (paymentMethod === 'payfast') {
    if (!payFastConfigured()) return res.status(409).json({ message: 'PayFast automatic confirmation is not configured on the server yet.' });
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
  billing.payment = { method: paymentMethod, paymentLink: paymentMethod === 'payment_link' ? paymentLink : '', accountName: paymentMethod === 'bank_transfer' ? accountName : '', bankName: paymentMethod === 'bank_transfer' ? bankName : '', accountNumberEncrypted: paymentMethod === 'bank_transfer' ? encryptField(accountNumber) : '', payMePayloadEncrypted: paymentMethod === 'bank_transfer' ? payMePayloadEncrypted : '', branchCode: paymentMethod === 'bank_transfer' ? branchCode : '', referencePrefix };
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
  const currentLearners = schoolLearnerCount(accountSchoolId(actor));
  if (requestedPlan && currentLearners > requestedPlan.hardMaxLearners) {
    return res.status(409).json({ message: `${requestedPlan.name} supports up to ${requestedPlan.hardMaxLearners.toLocaleString('en-ZA')} learners including paid overage. Choose a larger package.` });
  }
  const planCharge = requestedPlan ? planPriceForLearners(requestedPlan, currentLearners) : null;
  const monthlyTotal = requestedPlan ? planCharge.monthlyTotal : Math.round((billing.pricing.baseMonthly + bundle.sellingPrice) * 100) / 100;
  const order = {
    id: crypto.randomUUID(), reference, schoolId: accountSchoolId(actor), schoolName: actor.schoolName, requestedBy: actor.username,
    planCode: requestedPlan?.code || '', planName: requestedPlan?.name || '', learnerCapacity: requestedPlan?.maxLearners || 0,
    hardMaxLearners: requestedPlan?.hardMaxLearners || 0, learnerCount: requestedPlan ? currentLearners : 0,
    overageLearners: requestedPlan ? planCharge.overageLearners : 0, overageRate: requestedPlan ? planCharge.overageRate : 0,
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
  scheduleReplicaSnapshot, persistenceReady, hasPlatformAccess, logStructured, withPersistentMutation, readOnlySnapshotMode
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

app.get('/api/payments/payfast/checkout', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).send('Sign in to continue to payment.');
  if (!payFastConfigured()) return res.status(503).send('PayFast automatic payment confirmation is not configured.');
  const reference = String(req.query?.reference || '').trim().toUpperCase();
  const target = findPaymentTarget(reference, actor);
  if (!target) return res.status(404).send('Payment request not found.');
  const billing = subscriptionBillingState(actor);
  if (billing.payment.method !== 'payfast') return res.status(409).send('This payment request is not configured for PayFast.');
  const amount = expectedPaymentAmount(target);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).send('Payment amount is invalid.');
  const origin = publicOrigin();
  const nameParts = String(actor.name || actor.username || 'Little Feet customer').trim().split(/\s+/);
  const fields = [
    ['merchant_id', String(process.env.LF_PAYFAST_MERCHANT_ID || '')],
    ['merchant_key', String(process.env.LF_PAYFAST_MERCHANT_KEY || '')],
    ['return_url', `${origin}/?payment=complete&reference=${encodeURIComponent(reference)}`],
    ['cancel_url', `${origin}/?payment=cancelled&reference=${encodeURIComponent(reference)}`],
    ['notify_url', `${origin}/api/payments/payfast/itn`],
    ['name_first', nameParts[0] || 'Customer'],
    ['name_last', nameParts.slice(1).join(' ') || ''],
    ['email_address', /^\S+@\S+\.\S+$/.test(String(actor.username || '')) ? actor.username : ''],
    ['m_payment_id', reference],
    ['amount', amount.toFixed(2)],
    ['item_name', String(target.record.planName || target.record.description || target.record.productName || 'Little Feet payment').slice(0, 100)],
    ['item_description', `Little Feet ${target.type.replaceAll('_', ' ')} · ${reference}`.slice(0, 255)]
  ];
  const signature = payFastSignature(fields);
  const hiddenFields = [...fields, ['signature', signature]].filter(([, value]) => value !== '').map(([name, value]) => `<input type="hidden" name="${htmlAttributeEscape(name)}" value="${htmlAttributeEscape(value)}">`).join('');
  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continue to PayFast</title></head><body><form id="payfast" method="post" action="${htmlAttributeEscape(payFastProcessUrl())}">${hiddenFields}<noscript><button type="submit">Continue to PayFast</button></noscript></form><script>document.getElementById('payfast').submit();</script></body></html>`);
});

app.post('/api/payments/payfast/itn', async (req, res) => {
  if (!payFastConfigured()) return res.status(503).send('PayFast is not configured.');
  const entries = payFastRawEntries(req);
  const data = Object.fromEntries(entries);
  const suppliedSignature = String(data.signature || '').trim().toLowerCase();
  const merchantId = String(data.merchant_id || '').trim();
  const reference = String(data.m_payment_id || '').trim().toUpperCase();
  const providerPaymentId = String(data.pf_payment_id || '').trim();
  const amount = Number(data.amount_gross);
  if (merchantId !== String(process.env.LF_PAYFAST_MERCHANT_ID || '').trim()) return res.status(401).send('Invalid merchant.');
  if (!/^[0-9a-f]{32}$/.test(suppliedSignature)) return res.status(401).send('Invalid signature.');
  const unsignedEntries = entries.filter(([key]) => key !== 'signature');
  const paramString = payFastParamString(unsignedEntries);
  const expectedSignature = crypto.createHash('md5').update(`${paramString}&passphrase=${payFastUrlEncode(String(process.env.LF_PAYFAST_PASSPHRASE || ''))}`).digest('hex');
  const suppliedBuffer = Buffer.from(suppliedSignature, 'hex'), expectedBuffer = Buffer.from(expectedSignature, 'hex');
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return res.status(401).send('Invalid signature.');
  if (!await payFastSourceIsValid(req)) return res.status(401).send('Invalid PayFast source.');
  const target = findPaymentTarget(reference);
  if (!target) return res.status(404).send('Unknown payment reference.');
  const expectedAmount = expectedPaymentAmount(target);
  if (!Number.isFinite(amount) || Math.abs(amount - expectedAmount) > 0.01) return res.status(400).send('Payment amount mismatch.');
  let confirmed = false;
  try { confirmed = await payFastServerValidates(paramString); } catch (error) {
    logStructured('error', 'payments.payfast_validation_failed', { category: 'payments', message: error.message, result: 'failed' });
    return res.status(503).send('Unable to validate payment with PayFast.');
  }
  if (!confirmed) return res.status(401).send('PayFast did not validate this notification.');
  const paymentStatus = String(data.payment_status || '').trim().toUpperCase();
  if (paymentStatus !== 'COMPLETE' && paymentStatus !== 'CANCELLED') return res.status(200).send('IGNORED');
  const result = applyPaymentEvent({
    eventId: `payfast:${providerPaymentId || crypto.createHash('sha256').update(paramString).digest('hex').slice(0, 32)}`,
    reference,
    status: paymentStatus === 'COMPLETE' ? 'paid' : 'failed',
    amount,
    providerTransactionId: providerPaymentId,
    source: 'payfast-itn',
    receivedAt: new Date().toISOString()
  });
  if (result.error) return res.status(400).send(result.error);
  res.status(200).json({ success: true, duplicate: result.duplicate });
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

app.get('/api/accounts/catalog', (req,res) => {
 if (!requireAccountManager(req)) return res.status(403).json({message:'Account management access is required.'});
 res.json({positions:SCHOOL_POSITION_CATALOG,sectors:SCHOOL_SECTORS});
});
app.get('/api/accounts', (req, res) => {
  const actor = requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const visibleAccounts = hasPlatformAccess(actor)
    ? db.users
    : db.users.filter(account => canManageAccount(actor, account));
  res.json(visibleAccounts.map(account => ({ ...safeAccount(account), canManage: canManageAccount(actor, account), canDelete: canManageAccount(actor, account) && !isConfiguredPlatformOwner(account) })));
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
  if (actor.role === 'crm') {
    const school = db.schools.find(item => schoolKey(item.name) === schoolKey(effectiveSchoolName));
    return school ? { schoolId: school.id, schoolName: school.name } : { error: 'Choose an existing Little Feet client school. Only an administrator can set up a new school.' };
  }
  if (!hasPlatformAccess(actor) && schoolKey(effectiveSchoolName) !== schoolKey(actor.schoolName)) {
    return { error: 'Administrators can manage accounts only for their own school.' };
  }
  const school = ensureSchool(effectiveSchoolName);
  return { schoolId: school.id, schoolName: school.name };
};

const canManageAccount = (actor, target) => Boolean(actor && target && ((!isConfiguredPlatformOwner(target) || isConfiguredPlatformOwner(actor)) && (hasPlatformAccess(actor) || (!PLATFORM_INTERNAL_ROLES.has(target.role) && !hasPlatformAccess(target) && (actor.role === 'crm' ? db.schools.some(school => school.id === accountSchoolId(target)) : isSameSchool(actor, target))))));

app.get('/api/accounts/learner-options', (req, res) => {
  const actor = requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Account management access is required.' });
  const school = db.schools.find(item => schoolKey(item.name) === schoolKey(req.query.schoolName));
  if (!school || (!hasPlatformAccess(actor) && actor.role !== 'crm' && school.id !== accountSchoolId(actor))) return res.status(404).json({ message: 'School not found.' });
  res.json(db.students.filter(learner => learner.schoolId === school.id).map(learner => ({ id: learner.id, studentName: learner.studentName, className: learner.className })));
});
const clientLearnerLinkError = (actor, scope, links) => {
  if (actor.role !== 'crm') return '';
  return links.some(name => db.students.filter(student => student.schoolId === scope.schoolId && normalizeComparableText(student.studentName) === normalizeComparableText(name)).length !== 1)
    ? 'Choose uniquely identified learners enrolled at the selected school.' : '';
};

app.post('/api/accounts', (req, res) => {
  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses, schoolPosition, schoolSector } = req.body;
  const actor = requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const cleanUsername = boundedText(username, 160);
  const cleanName = boundedText(name, 160);
  if (!cleanUsername || !pin || !cleanName || !ACCOUNT_ROLES.has(role)) return res.status(400).json({ message: 'Name, username, password, and a supported role are required.' });
  if (String(pin).length < 4 || String(pin).length > 128) return res.status(400).json({ message: 'Passwords must be between 4 and 128 characters.' });
  if (db.users.some(account => accountMatchesUsername(account, cleanUsername))) return res.status(409).json({ message: 'That username is already in use.' });

  const linkValidation = role === 'parent' ? validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const normalisedStoreUrl = safeHttpsUrl(schoolStoreUrl);
  if (String(schoolStoreUrl || '').trim() && !normalisedStoreUrl) return res.status(400).json({ message: 'School web-store links must use a valid HTTPS URL.' });

  const position = validateSchoolPosition(role, schoolPosition, schoolSector);
  if (position.error) return res.status(400).json({message:position.error});
  const scope = resolveManagedAccountScope(actor, role, schoolName);
  if (scope.error) return res.status(403).json({ message: scope.error });
  const learnerError = clientLearnerLinkError(actor, scope, linkValidation.links);
  if (learnerError) return res.status(400).json({ message: learnerError });

  const account = {
    username: cleanUsername,
    pinHash: hashPin(pin),
    name: cleanName,
    role,
    ...position,
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

const migrateAccountReferences = (previousUsername, nextUsername) => {
  if (previousUsername === nextUsername) return;
  const previousKey = normalizeUsername(previousUsername);
  const referenceFields = new Set(['username','parentUsername','teacherUsername','staffUsername','hostUsername','requesterUsername','userUsername','requestedBy','assignedTo','createdBy','updatedBy','approvedBy','recordedBy','reviewedBy','issuedBy','revokedBy','redeemedBy','uploadedBy','verifiedBy','deletedBy','changedBy','absentTeacher','coverTeacher']);
  const auditCollections = new Set(['users','systemErrors','documentAudit','importAudit','markHistory']);
  const historicalFields = new Set(['before','after','payload','raw','providerMetadata','mailboxConnection']);
  const updateReference = value => typeof value === 'string' && normalizeUsername(value) === previousKey ? nextUsername : value;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, item] of Object.entries(value)) {
      if (referenceFields.has(key)) value[key] = updateReference(item);
      else if (!historicalFields.has(key)) visit(item);
    }
  };
  // Update ownership/assignment fields, never message text, email addresses or audit snapshots.
  for (const [collection, records] of Object.entries(db)) if (!auditCollections.has(collection)) visit(records);
  for (const message of db.directMessages || []) {
    message.sender = updateReference(message.sender);
    message.recipient = updateReference(message.recipient);
  }
  for (const messages of Object.values(db.groupMessages || {})) for (const message of messages) message.sender = updateReference(message.sender);
  for (const file of db.fileRecords || []) if (file.entityType === 'staff') file.recordId = updateReference(file.recordId);
};

app.put('/api/accounts/:username', (req, res) => {
  const actor = requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = findAccountByUsername(req.params.username);
  if (!canManageAccount(actor, account)) return res.status(404).json({ message: 'Account not found.' });

  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses, schoolPosition, schoolSector } = req.body;
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

  if (isConfiguredPlatformOwner(account) && cleanUpdatedUsername && normalizeUsername(cleanUpdatedUsername) !== configuredPlatformOwnerUsername()) {
    return res.status(400).json({ message: 'The configured Little Feet owner username cannot be renamed here.' });
  }
  if (pin && (String(pin).length < 4 || String(pin).length > 128)) return res.status(400).json({ message: 'Passwords must be between 4 and 128 characters.' });
  const normalisedStoreUrl = schoolStoreUrl === undefined ? (account.schoolStoreUrl || '') : safeHttpsUrl(schoolStoreUrl);
  if (schoolStoreUrl !== undefined && String(schoolStoreUrl || '').trim() && !normalisedStoreUrl) return res.status(400).json({ message: 'School web-store links must use a valid HTTPS URL.' });
  const previousRole = account.role;
  const previousUsername = account.username;
  const linkValidation = nextRole === 'parent' ? validateLearnerLinks(linkedLearners === undefined && previousRole === 'parent' ? account.linkedLearners : linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const nextClasses = nextRole === 'teacher' ? normaliseAssignedClasses(assignedClasses === undefined && previousRole === 'teacher' ? account.assignedClasses : assignedClasses).slice(0, 30) : [];
  const nextPinHash = pin ? hashPin(pin) : account.pinHash;
  const nextPlatformAccess = FULL_PLATFORM_ROLES.has(nextRole) || isConfiguredPlatformOwner(account) || (previousRole === nextRole && nextRole === 'admin' && account.platformAccess === true);
  const position = validateSchoolPosition(nextRole, schoolPosition === undefined && previousRole === nextRole ? account.schoolPosition : schoolPosition, schoolSector === undefined && previousRole === nextRole ? account.schoolSector : schoolSector);
  if (position.error) return res.status(400).json({message:position.error});
  const scope = resolveManagedAccountScope(actor, nextRole, schoolName === undefined ? account.schoolName : schoolName);
  if (scope.error) return res.status(403).json({ message: scope.error });
  if (actor.role === 'crm' && scope.schoolId !== accountSchoolId(account)) return res.status(403).json({ message: 'CRM staff cannot move an existing user to another school.' });
  const learnerError = clientLearnerLinkError(actor, scope, linkValidation.links);
  if (learnerError) return res.status(400).json({ message: learnerError });

  Object.assign(account, {
    username: cleanUpdatedUsername || account.username, name: cleanUpdatedName || account.name,
    pinHash: nextPinHash, role: nextRole, ...position, schoolName: scope.schoolName, schoolId: scope.schoolId,
    platformAccess: nextPlatformAccess, schoolStoreUrl: normalisedStoreUrl,
    linkedLearners: linkedLearners === undefined && previousRole === nextRole && nextRole === 'parent' ? [...(account.linkedLearners || [])] : linkValidation.links,
    assignedClasses: assignedClasses === undefined && previousRole === nextRole && nextRole === 'teacher' ? [...(account.assignedClasses || [])] : nextClasses
  });
  migrateAccountReferences(previousUsername, account.username);
  if (nextRole === 'parent') {
    if (previousRole !== 'parent' || linkedLearners !== undefined) {
      account.parentRelationshipStatus = linkValidation.links.length ? 'Administrator approved' : 'Pending administrator approval';
      account.requestedLearnerLinks = [];
    }
  } else {
    delete account.parentRelationshipStatus;
    delete account.requestedLearnerLinks;
  }
  res.json({ success: true, account: safeAccount(account) });
});

app.delete('/api/accounts/:username', async (req, res, next) => {
  const actor = requireAccountManager(req);
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
  const actor = requireAccountManager(req);
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
  const actor = requireAccountManager(req);
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
  const actor = requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });

  const query = boundedText(req.query.q, 120).trim();
  if (query.length < 2) return res.json({ results: [], liveSearchAvailable: true });

  const queryKey = schoolKey(query);
  const visibleLocalSchools = new Map();
  const addLocalSchool = (name, id = '') => {
    const cleanName = boundedText(name, 160).trim();
    if (!cleanName || !schoolKey(cleanName).includes(queryKey)) return;
    if (!hasPlatformAccess(actor) && actor.role !== 'crm' && schoolKey(cleanName) !== schoolKey(actor.schoolName)) return;
    const key = schoolKey(cleanName);
    if (!visibleLocalSchools.has(key)) {
      visibleLocalSchools.set(key, { name: cleanName, schoolId: id || '', locality: 'Saved in Little Feet', source: 'Little Feet' });
    }
  };
  (db.schools || []).forEach(school => addLocalSchool(school.name, school.id));
  (db.users || []).forEach(account => addLocalSchool(account.schoolName, account.schoolId));

  const localResults = [...visibleLocalSchools.values()].slice(0, 8);
  if (actor.role === 'crm') return res.json({ results: localResults, liveSearchAvailable: false });
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

const FILE_ENTITY_TYPES = new Set(['learner', 'staff', 'school', 'post', 'worksheet', 'dsd_incident', 'admission_application']);
const fileContentPath = file => `/api/files/${encodeURIComponent(file.id)}/content`;
const publicFileMetadata = file => ({
  id: file.id, entityType: file.entityType, recordId: file.recordId, purpose: file.purpose,
  originalFilename: file.originalFilename, contentType: file.contentType, size: file.size,
  sha256: file.sha256, uploadedBy: file.uploadedBy, createdAt: file.createdAt,
  updatedAt: file.updatedAt || file.createdAt, accessState: file.accessState,
  verificationStatus:file.verificationStatus||'Pending review', verifiedAt:file.verifiedAt||'', verifiedBy:file.verifiedBy||'',
  rejectionReason:file.rejectionReason||'', expiryDate:file.expiryDate||'', contentUrl: file.accessState === 'active' ? fileContentPath(file) : null
});
const admissionApplicationVisibleTo = (application, actor) => Boolean(application && actor && (
  hasPlatformAccess(actor)
  || (['principal','admin','staff'].includes(actor.role) && application.schoolId===accountSchoolId(actor))
  || (actor.role==='parent' && normalizeUsername(application.createdBy)===normalizeUsername(actor.username))
));
const admissionApplicationView = application => ({
  ...application,
  contactPhone:decryptStoredField(application.contactPhone),
  contactEmail:decryptStoredField(application.contactEmail),
  dateOfBirth:decryptStoredField(application.dateOfBirth),
  homeArea:decryptStoredField(application.homeArea),
  notes:decryptStoredField(application.notes)
});
const relatedRecordForFile = (file, actor) => {
  if (!file || !actor) return null;
  if (file.entityType === 'admission_application') {
    const application=(db.admissionsApplications||[]).find(item=>item.id===file.recordId);
    return admissionApplicationVisibleTo(application,actor)?application:null;
  }
  if (file.entityType === 'learner') {
    const learner=db.students.find(item=>item.id===file.recordId);
    if(!learner)return null;
    if(hasPlatformAccess(actor) || (recordInSchool(learner,actor)&&['principal','admin','staff'].includes(actor.role)))return learner;
    if(actor.role==='teacher')return learnerRecordsVisibleTo(db.students,actor).some(item=>item.id===learner.id)?learner:null;
    return actor.role==='parent'&&isParentLinkedToLearner(actor,learner)?learner:null;
  }
  if (!recordInSchool(file, actor)) return null;
  if (file.entityType === 'staff') return db.users.find(item => normalizeUsername(item.username) === normalizeUsername(file.recordId) && isSameSchool(item, actor));
  if (file.entityType === 'school') return db.schools.find(item => item.id === file.recordId && item.id === accountSchoolId(actor));
  if (file.entityType === 'post') return db.posts.find(item => item.id === file.recordId && recordInSchool(item, actor));
  if (file.entityType === 'worksheet') return learnerRecordsVisibleTo(db.worksheets, actor).find(item => item.id === file.recordId);
  if (file.entityType === 'dsd_incident') {
    const incident = learnerRecordsVisibleTo(db.dsdIncidents || [], actor).find(item => item.id === file.recordId);
    if (!incident) return null;
    if (hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role)) return incident;
    if (actor.role !== 'parent') return null;
    const learner = db.students.find(item => normalizeComparableText(item.studentName) === normalizeComparableText(incident.learnerName) && recordInSchool(item,actor));
    return learner && isParentLinkedToLearner(actor, learner) ? incident : null;
  }
  return null;
};
const canManageFile = (file, actor) => Boolean(actor && relatedRecordForFile(file,actor)
  && ((hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) || normalizeUsername(file.uploadedBy) === normalizeUsername(actor.username)));
const createStoredFile = async (actor, { entityType, recordId, purpose, originalFilename, dataUrl, schoolIdOverride, schoolNameOverride }) => {
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
  const storageSchoolId=schoolIdOverride||accountSchoolId(actor),storageSchoolName=schoolNameOverride||actor.schoolName||'';
  const key = objectKeyFor({ schoolId: storageSchoolId, entityType, recordId, extension: decoded.extension });
  const sha256 = crypto.createHash('sha256').update(decoded.bytes).digest('hex');
  const result = await objectStorage.put({
    key, body: decoded.bytes, contentType: decoded.mimeType,
    metadata: { fileid: id, tenant: crypto.createHash('sha256').update(storageSchoolId).digest('hex') }
  });
  const record = {
    id, entityType, recordId: boundedText(recordId, 180), purpose: boundedText(purpose || 'attachment', 80),
    storageProvider: objectStorage.kind, objectKey: key, originalFilename: decoded.filename,
    contentType: decoded.mimeType, size: decoded.bytes.length, sha256, etag: boundedText(result.etag, 180),
    uploadedBy: actor.username, createdAt: new Date().toISOString(), accessState: 'active',
    verificationStatus:'Pending review', verifiedAt:'', verifiedBy:'', rejectionReason:'',
    schoolId:storageSchoolId, schoolName:storageSchoolName
  };
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
  const files = (db.fileRecords||[]).filter(file => file.accessState === 'active'
    && (!entityType || file.entityType === entityType) && (!recordId || file.recordId === recordId)
    && relatedRecordForFile(file, actor));
  res.json(files.map(publicFileMetadata));
});

app.post('/api/files', async (req, res, next) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in before uploading files.' });
  const entityType = boundedText(req.body?.entityType, 40);
  const recordId = boundedText(req.body?.recordId, 180);
  const probe = {entityType,recordId,schoolId:accountSchoolId(actor)};
  const related=recordId&&relatedRecordForFile(probe, actor);
  const staffAllowed=hasPlatformAccess(actor)||['teacher','principal','admin','staff'].includes(actor.role);
  const parentAllowed=actor.role==='parent'&&['learner','admission_application'].includes(entityType);
  if(!staffAllowed&&!parentAllowed)return res.status(403).json({message:'You cannot upload files for this record.'});
  if (!related) return res.status(404).json({ message: 'The related school record was not found.' });
  let file;
  try {
    file = await createStoredFile(actor, { entityType, recordId, purpose: req.body?.purpose, originalFilename: req.body?.originalFilename, dataUrl: req.body?.dataUrl,
      schoolIdOverride:related.schoolId||accountSchoolId(actor),schoolNameOverride:related.schoolName||actor.schoolName||'' });
    if(['learner','admission_application'].includes(entityType))db.documentAudit.unshift({id:crypto.randomUUID(),schoolId:file.schoolId,entityType,recordId,fileId:file.id,action:'uploaded',by:actor.username,at:new Date().toISOString(),details:file.originalFilename});
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
  const previous = actor && db.fileRecords.find(item => item.id === req.params.id && item.accessState === 'active' && relatedRecordForFile(item,actor));
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
  const file = db.fileRecords.find(item => item.id === req.params.id && item.accessState === 'active');
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
  const file = actor && db.fileRecords.find(item => item.id === req.params.id && item.accessState === 'active' && relatedRecordForFile(item,actor));
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

// Admissions 2.0 + central learner document repository.
const admissionsManagementActor=req=>{
  const actor=getSessionAccount(req);
  return actor&&(hasPlatformAccess(actor)||['principal','admin','staff'].includes(actor.role))?actor:null;
};
const admissionForActor=(actor,id)=>(db.admissionsApplications||[]).find(item=>item.id===id&&admissionApplicationVisibleTo(item,actor));
const admissionDocumentState=application=>{
  const files=(db.fileRecords||[]).filter(file=>file.entityType==='admission_application'&&file.recordId===application.id&&file.accessState==='active');
  const byPurpose=new Map();
  files.forEach(file=>{const list=byPurpose.get(file.purpose)||[];list.push(file);byPurpose.set(file.purpose,list);});
  const checklist=(application.checklist||[]).map(item=>{
    const documents=byPurpose.get(item.key)||[];
    const verified=documents.some(file=>file.verificationStatus==='Verified');
    const rejected=documents.length>0&&!verified&&documents.every(file=>file.verificationStatus==='Rejected');
    return {...item,status:verified?'verified':rejected?'rejected':documents.length?'pending':'missing',documentCount:documents.length};
  });
  const missingRequired=checklist.filter(item=>item.required&&item.status!=='verified').map(item=>item.key);
  return {files:files.map(publicFileMetadata),checklist,missingRequired,complete:missingRequired.length===0};
};
const admissionApiView=application=>({...admissionApplicationView(application),documents:admissionDocumentState(application)});
const notifyAdmissionParent=async(application,title,message)=>{
  const parent=(db.users||[]).find(account=>account.role==='parent'&&normalizeUsername(account.username)===normalizeUsername(application.createdBy));
  if(parent&&typeof addEmailInboxItem==='function')addEmailInboxItem(parent,{type:'Notification',title,message,sourceId:application.id,sourceTab:'homeTab',sender:application.schoolName||'Admissions'});
  const email=decryptStoredField(application.contactEmail);
  if(looksLikeEmailAddress(email)&&(smtpEmailConfigured()||apiEmailConfigured()))await sendLittleFeetEmail({to:email,subject:title,text:message,html:'<p>'+String(message).replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])).replace(/\n/g,'<br>')+'</p>'}).catch(()=>false);
};

app.get('/api/admissions/applications',(req,res)=>{
  const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view admissions.'});
  let rows=(db.admissionsApplications||[]).filter(item=>admissionApplicationVisibleTo(item,actor));
  rows=rows.sort((a,b)=>Date.parse(b.updatedAt||b.createdAt)-Date.parse(a.updatedAt||a.createdAt));
  res.json(rows.map(admissionApiView));
});
app.get('/api/admissions/applications/:id',(req,res)=>{
  const actor=getSessionAccount(req),application=actor&&admissionForActor(actor,req.params.id);
  if(!application)return res.status(404).json({message:'Application not found.'});
  res.json(admissionApiView(application));
});
app.get('/api/admissions/applications/:id/history',(req,res)=>{
  const actor=getSessionAccount(req),application=actor&&admissionForActor(actor,req.params.id);
  if(!application)return res.status(404).json({message:'Application not found.'});
  res.json((db.admissionsStatusHistory||[]).filter(row=>row.applicationId===application.id).sort((a,b)=>Date.parse(b.changedAt)-Date.parse(a.changedAt)));
});
app.patch('/api/admissions/applications/:id/status',(req,res)=>{
  const actor=admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'Admissions management access is required.'});
  const application=(db.admissionsApplications||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
  if(!application)return res.status(404).json({message:'Application not found.'});
  const nextStatus=boundedText(req.body?.status,40),note=boundedText(req.body?.note,1200);
  if(!ADMISSION_STATUSES.has(nextStatus)||nextStatus==='Enrolled')return res.status(400).json({message:'Choose a valid admissions status. Use Enrol to create the learner record.'});
  if(application.status==='Enrolled')return res.status(409).json({message:'An enrolled application cannot be moved back into the admissions queue.'});
  const previous=application.status;
  application.status=nextStatus;application.reviewNote=note;application.updatedAt=new Date().toISOString();application.updatedBy=actor.username;
  db.admissionsStatusHistory.unshift({id:crypto.randomUUID(),applicationId:application.id,schoolId:application.schoolId,fromStatus:previous,toStatus:nextStatus,changedBy:actor.username,changedAt:application.updatedAt,note});
  const ticket=(db.tickets||[]).find(item=>item.applicationId===application.id&&recordInSchool(item,actor));
  if(ticket){ticket.status=['Approved','Rejected','Withdrawn'].includes(nextStatus)?'Completed':'Open';ticket.updatedAt=application.updatedAt;}
  if(nextStatus==='Documents required'){
    const missing=admissionDocumentState(application).checklist.filter(item=>item.required&&item.status!=='verified').map(item=>item.label);
    void notifyAdmissionParent(application,'Admission documents required',missing.length?('Please upload or replace these required documents: '+missing.join(', ')+'.'):'The school requested additional admission documents.').catch(()=>{});
  }else if(['Waitlisted','Approved','Rejected'].includes(nextStatus)){
    void notifyAdmissionParent(application,'School application update',application.learnerName+' application status is now '+nextStatus+'.'+(note?' '+note:'')).catch(()=>{});
  }
  res.json({success:true,application:admissionApiView(application)});
});
app.post('/api/admissions/applications/:id/withdraw',(req,res)=>{
  const actor=getSessionAccount(req),application=actor&&admissionForActor(actor,req.params.id);
  if(!application||actor.role!=='parent'||normalizeUsername(application.createdBy)!==normalizeUsername(actor.username))return res.status(404).json({message:'Application not found.'});
  if(['Enrolled','Rejected','Withdrawn'].includes(application.status))return res.status(409).json({message:'This application can no longer be withdrawn.'});
  const previous=application.status;application.status='Withdrawn';application.updatedAt=new Date().toISOString();application.updatedBy=actor.username;
  db.admissionsStatusHistory.unshift({id:crypto.randomUUID(),applicationId:application.id,schoolId:application.schoolId,fromStatus:previous,toStatus:'Withdrawn',changedBy:actor.username,changedAt:application.updatedAt,note:'Withdrawn by parent'});
  res.json({success:true,application:admissionApiView(application)});
});
app.put('/api/admissions/applications/:id/checklist',(req,res)=>{
  const actor=admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'Admissions management access is required.'});
  const application=(db.admissionsApplications||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
  if(!application)return res.status(404).json({message:'Application not found.'});
  const incoming=Array.isArray(req.body?.items)?req.body.items:[];
  if(!incoming.length)return res.status(400).json({message:'Add at least one checklist item.'});
  const existing=new Map((application.checklist||[]).map(item=>[item.key,item]));
  if(incoming.length>30)return res.status(400).json({message:'Use no more than 30 checklist items.'});
  const checklist=incoming.map(raw=>{
    const key=boundedText(raw?.key,80).replace(/[^a-z0-9_-]/gi,'_').toLowerCase(),label=limitedText(raw?.label,160);
    const old=existing.get(key)||{};
    return {key,label:label||old.label||key,required:Boolean(raw?.required),status:old.status||'missing',verifiedAt:old.verifiedAt||'',verifiedBy:old.verifiedBy||''};
  }).filter(item=>item.key&&item.label);
  if(checklist.length!==incoming.length||new Set(checklist.map(item=>item.key)).size!==checklist.length)return res.status(400).json({message:'Checklist items must have valid, unique names.'});
  application.checklist=checklist;
  application.updatedAt=new Date().toISOString();application.updatedBy=actor.username;
  res.json({success:true,application:admissionApiView(application)});
});
app.post('/api/admissions/applications/:id/documents/:fileId/verify',(req,res)=>{
  const actor=admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'Admissions management access is required.'});
  const application=(db.admissionsApplications||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
  if(!application)return res.status(404).json({message:'Application not found.'});
  const file=(db.fileRecords||[]).find(item=>item.id===req.params.fileId&&item.entityType==='admission_application'&&item.recordId===application.id&&item.accessState==='active');
  if(!file)return res.status(404).json({message:'Application document not found.'});
  const status=boundedText(req.body?.status,30),reason=boundedText(req.body?.reason,500);
  if(!['Verified','Rejected'].includes(status))return res.status(400).json({message:'Choose Verified or Rejected.'});
  if(status==='Rejected'&&!reason)return res.status(400).json({message:'Add a reason when rejecting a document.'});
  file.verificationStatus=status;file.verifiedAt=status==='Verified'?new Date().toISOString():'';file.verifiedBy=status==='Verified'?actor.username:'';file.rejectionReason=status==='Rejected'?reason:'';
  db.documentAudit.unshift({id:crypto.randomUUID(),schoolId:application.schoolId,entityType:'admission_application',recordId:application.id,fileId:file.id,action:status==='Verified'?'verified':'rejected',by:actor.username,at:new Date().toISOString(),details:reason||''});
  const item=(application.checklist||[]).find(row=>row.key===file.purpose);
  if(item){item.status=status==='Verified'?'verified':'rejected';item.verifiedAt=file.verifiedAt;item.verifiedBy=file.verifiedBy;}
  application.updatedAt=new Date().toISOString();application.updatedBy=actor.username;
  if(status==='Rejected')void notifyAdmissionParent(application,'Admission document rejected','The school rejected '+file.originalFilename+'. Reason: '+reason).catch(()=>{});
  res.json({success:true,file:publicFileMetadata(file),application:admissionApiView(application)});
});
app.post('/api/admissions/applications/:id/enrol',(req,res)=>{
  const actor=admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'Admissions management access is required.'});
  const application=(db.admissionsApplications||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
  if(!application)return res.status(404).json({message:'Application not found.'});
  if(application.status==='Enrolled')return res.status(409).json({message:'This application is already enrolled.',learnerId:application.convertedLearnerId});
  if(!['Approved','Under review','Documents required','Waitlisted','Submitted'].includes(application.status))return res.status(409).json({message:'This application cannot be enrolled from its current status.'});
  const documentState=admissionDocumentState(application);
  if(!documentState.complete)return res.status(409).json({message:'Verify all required admission documents before enrolment.',missingRequired:documentState.missingRequired});
  const className=limitedText(req.body?.className||application.gradeOrAgeGroup,120),address=limitedText(req.body?.address||decryptStoredField(application.homeArea),500);
  const emergencyContact=limitedText(req.body?.emergencyContact,500),medicalNotes=limitedText(req.body?.medicalNotes,2000),consent=limitedText(req.body?.consent||'Pending verification',120);
  if(!className||!address)return res.status(400).json({message:'Enter the learner class/grade and home address before enrolment.'});
  const guardianName=application.guardianName,guardianPhone=decryptStoredField(application.contactPhone),guardianEmail=decryptStoredField(application.contactEmail),dateOfBirth=decryptStoredField(application.dateOfBirth);
  const applicantParent=(db.users||[]).find(account=>account.role==='parent'&&normalizeUsername(account.username)===normalizeUsername(application.createdBy));
  if(applicantParent&&accountSchoolId(applicantParent)&&accountSchoolId(applicantParent)!==application.schoolId)return res.status(409).json({message:'The parent account belongs to another school. Resolve its school assignment before enrolling this application.'});
  const admissionActor={...actor,schoolId:application.schoolId,schoolName:application.schoolName};
  const schoolLearners=(db.students||[]).filter(student=>student.schoolId===application.schoolId);
  const schoolRegistry=(db.registry||[]).filter(row=>row.schoolId===application.schoolId);
  if(schoolLearners.some(student=>normalizeComparableText(student.studentName)===normalizeComparableText(application.learnerName))||schoolRegistry.some(row=>normalizeComparableText(row.learnerName)===normalizeComparableText(application.learnerName)))return res.status(409).json({message:'A learner with this name already exists. Resolve the learner identity before enrolling; no existing learner has been linked or changed.'});
  if(applicantParent&&normaliseLearnerLinks(applicantParent.linkedLearners).length>=4)return res.status(409).json({message:'This parent account is already linked to four learners. Resolve the account links before enrolment.'});
  let learner=schoolLearners.find(student=>normalizeComparableText(student.studentName)===normalizeComparableText(application.learnerName)&&normalizeComparableText(student.className)===normalizeComparableText(className));
  if(!learner){
    const learnerLimit=schoolLearnerLimitState(admissionActor);if(!learnerLimit.allowed)return res.status(409).json({message:`The ${learnerLimit.planCode||'current'} school package has reached its learner limit.`});
    learner=tagSchoolRecord(admissionActor,{id:crypto.randomUUID(),studentName:application.learnerName,className,parentName:guardianName,contactEmail:guardianEmail||'',dateOfBirth:encryptField(dateOfBirth),medicalNotes:encryptField(medicalNotes||''),emergencyContact:encryptField(emergencyContact||''),authorisedPickups:encryptField(''),registeredAt:new Date().toISOString(),registeredBy:actor.username,admissionApplicationId:application.id});
    db.students.push(learner);ensureLearnerAccessCode(actor,learner);
  }
  let registry=schoolRegistry.find(row=>normalizeComparableText(row.learnerName)===normalizeComparableText(application.learnerName)&&normalizeComparableText(row.className)===normalizeComparableText(className));
  if(!registry){
    registry=tagSchoolRecord(admissionActor,{id:crypto.randomUUID(),learnerName:application.learnerName,className,dateOfBirth:encryptField(dateOfBirth),guardianName,guardianPhone:encryptField(guardianPhone),guardianEmail:encryptField(guardianEmail||''),address:encryptField(address),emergencyContact:encryptField(emergencyContact||''),medicalNotes:encryptField(medicalNotes||''),consent,createdAt:new Date().toISOString(),createdBy:actor.username,admissionApplicationId:application.id});
    db.registry.unshift(registry);
  }
  const parent=(db.users||[]).find(account=>account.role==='parent'&&normalizeUsername(account.username)===normalizeUsername(application.createdBy));
  if(parent){
    const links=new Set(Array.isArray(parent.linkedLearners)?parent.linkedLearners:[]);
    links.add(application.learnerName);parent.linkedLearners=[...links];
    parent.parentRelationshipStatus='Administrator approved';
    parent.parentRelationshipApprovedAt=new Date().toISOString();
    parent.parentRelationshipApprovedBy=actor.username;
    if(!parent.schoolId){parent.schoolId=application.schoolId;parent.schoolName=application.schoolName;}
  }
  const priorStatus=application.status;application.status='Enrolled';application.convertedLearnerId=learner.id;application.convertedRegistryId=registry.id;application.enrolledAt=new Date().toISOString();application.enrolledBy=actor.username;application.updatedAt=application.enrolledAt;
  db.admissionsStatusHistory.unshift({id:crypto.randomUUID(),applicationId:application.id,schoolId:application.schoolId,fromStatus:priorStatus,toStatus:'Enrolled',changedBy:actor.username,changedAt:application.enrolledAt,note:'Converted to learner register'});
  const ticket=(db.tickets||[]).find(item=>item.applicationId===application.id&&recordInSchool(item,actor));if(ticket){ticket.status='Completed';ticket.updatedAt=application.enrolledAt;}
  void notifyAdmissionParent(application,'Application enrolled',application.learnerName+' has been enrolled into '+className+' at '+application.schoolName+'.').catch(()=>{});
  res.status(201).json({success:true,application:admissionApiView(application),learnerKey:learnerRecordKey(learner),registryId:registry.id});
});
app.get('/api/learner-documents',(req,res)=>{
  const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view learner documents.'});
  let learners=[];
  if(actor.role==='parent')learners=(db.students||[]).filter(learner=>isParentLinkedToLearner(actor,learner));
  else if(actor.role==='teacher')learners=learnerRecordsVisibleTo(db.students,actor);
  else if(hasPlatformAccess(actor)||['principal','admin','staff'].includes(actor.role))learners=tenantRecords(db.students,actor);
  else return res.status(403).json({message:'You cannot view learner documents.'});
  const learnerIds=new Set(learners.map(item=>item.id));
  const files=(db.fileRecords||[]).filter(file=>file.entityType==='learner'&&file.accessState==='active'&&learnerIds.has(file.recordId)&&relatedRecordForFile(file,actor));
  res.json(learners.map(learner=>({learner:{id:learner.id,studentName:learner.studentName,className:learner.className},documents:files.filter(file=>file.recordId===learner.id).map(publicFileMetadata)})));
});
app.patch('/api/learner-documents/:learnerId/:fileId',(req,res)=>{
  const actor=admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'School management access is required.'});
  const learner=tenantRecords(db.students,actor).find(item=>item.id===req.params.learnerId);if(!learner)return res.status(404).json({message:'Learner not found.'});
  const file=(db.fileRecords||[]).find(item=>item.id===req.params.fileId&&item.entityType==='learner'&&item.recordId===learner.id&&item.accessState==='active');
  if(!file)return res.status(404).json({message:'Learner document not found.'});
  const expiryDate=boundedText(req.body?.expiryDate,10);
  if(expiryDate&&!validDateKey(expiryDate))return res.status(400).json({message:'Choose a valid expiry date.'});
  const purpose=boundedText(req.body?.purpose||file.purpose,80);if(!purpose)return res.status(400).json({message:'Document type is required.'});
  file.expiryDate=expiryDate;file.purpose=purpose;file.updatedAt=new Date().toISOString();
  db.documentAudit.unshift({id:crypto.randomUUID(),schoolId:learner.schoolId,entityType:'learner',recordId:learner.id,fileId:file.id,action:'metadata_updated',by:actor.username,at:file.updatedAt,details:expiryDate?('Expiry '+expiryDate):'Expiry cleared'});
  res.json({success:true,file:publicFileMetadata(file)});
});
app.get('/api/learner-documents/:learnerId/audit',(req,res)=>{
  const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view document history.'});
  const learner=(db.students||[]).find(item=>item.id===req.params.learnerId);
  if(!learner||!relatedRecordForFile({entityType:'learner',recordId:learner.id,schoolId:learner.schoolId},actor))return res.status(404).json({message:'Learner not found.'});
  res.json((db.documentAudit||[]).filter(row=>row.entityType==='learner'&&row.recordId===learner.id).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)));
});

app.post('/api/learner-documents/:learnerId/:fileId/verify',(req,res)=>{
  const actor=admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'School management access is required.'});
  const learner=tenantRecords(db.students,actor).find(item=>item.id===req.params.learnerId);if(!learner)return res.status(404).json({message:'Learner not found.'});
  const file=(db.fileRecords||[]).find(item=>item.id===req.params.fileId&&item.entityType==='learner'&&item.recordId===learner.id&&item.accessState==='active');
  if(!file)return res.status(404).json({message:'Learner document not found.'});
  const status=boundedText(req.body?.status,30),reason=boundedText(req.body?.reason,500);if(!['Verified','Rejected'].includes(status))return res.status(400).json({message:'Choose Verified or Rejected.'});if(status==='Rejected'&&!reason)return res.status(400).json({message:'Add a rejection reason.'});
  file.verificationStatus=status;file.verifiedAt=status==='Verified'?new Date().toISOString():'';file.verifiedBy=status==='Verified'?actor.username:'';file.rejectionReason=status==='Rejected'?reason:'';
  db.documentAudit.unshift({id:crypto.randomUUID(),schoolId:learner.schoolId,entityType:'learner',recordId:learner.id,fileId:file.id,action:status==='Verified'?'verified':'rejected',by:actor.username,at:new Date().toISOString(),details:reason||''});
  res.json({success:true,file:publicFileMetadata(file)});
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
  if (!(hasPlatformAccess(requester) || ['parent', 'teacher', 'principal', 'district', 'admin', 'staff'].includes(requester.role))) return res.status(403).json({ message: 'Learner analytics access is restricted.' });
  const student = learnerRecordsVisibleTo(db.students, requester).find(entry => normalizeComparableText(entry.studentName) === normalizeComparableText(name));
  if (!student) return res.status(404).json({ message: 'Learner record not found.' });
  if (requester.role === 'parent' && !isParentLinkedToLearner(requester, student)) return res.status(403).json({ message: 'Parents may only view analytics for their linked learner.' });
  const studentWorksheets = learnerRecordsVisibleTo(db.worksheets, requester).filter(w => w.studentName.toLowerCase() === name.toLowerCase() && Number.isFinite(Number(w.grade))).reverse();
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
  res.json((hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))?rows:rows.filter(x=>normalizeUsername(x.username)===normalizeUsername(actor.username)));
});
app.post('/api/staff/qualifications', (req,res) => {
  const actor=requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const target=staffAccountInSchool(actor,req.body?.username||actor.username);
  if(!target)return res.status(400).json({message:'Choose a staff member from this school.'});
  if(!(hasPlatformAccess(actor)||['admin','principal','school_hr'].includes(actor.role))&&normalizeUsername(target.username)!==normalizeUsername(actor.username))return res.status(403).json({message:'Staff can add qualifications only to their own record.'});
  const name=boundedText(req.body?.name,180),issuingBody=boundedText(req.body?.issuingBody,180),obtainedDate=boundedText(req.body?.obtainedDate,10),expiryDate=boundedText(req.body?.expiryDate,10);
  if(!name||!issuingBody||!validIsoDate(obtainedDate)||(expiryDate&&(!validIsoDate(expiryDate)||expiryDate<obtainedDate)))return res.status(400).json({message:'Add a qualification, issuing body and valid dates. Expiry cannot be before the obtained date.'});
  const item=tagEmploymentRecord(actor,target,{id:crypto.randomUUID(),username:target.username,staffName:target.name||target.username,name,issuingBody,obtainedDate,expiryDate,reference:boundedText(req.body?.reference,300),createdBy:actor.username,createdAt:new Date().toISOString()});
  db.staffQualifications.unshift(item);res.status(201).json({success:true,item:{...item,status:qualificationStatus(item)}});
});
app.patch('/api/staff/qualifications/:id', (req,res) => {
  const actor=requireSchoolStaff(req); const item=actor&&db.staffQualifications.find(x=>x.id===req.params.id&&recordInSchool(x,actor));
  if(!item)return res.status(404).json({message:'Qualification not found.'});
  const own=normalizeUsername(item.username)===normalizeUsername(actor.username),manager=(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role));
  if(!own&&!manager)return res.status(403).json({message:'You cannot update this qualification.'});
  const expiry=boundedText(req.body?.expiryDate??item.expiryDate,10),reference=boundedText(req.body?.reference??item.reference,300);
  if(expiry&&(!validIsoDate(expiry)||expiry<item.obtainedDate))return res.status(400).json({message:'Choose a valid expiry date after the obtained date.'});
  item.expiryDate=expiry;item.reference=reference;item.updatedAt=new Date().toISOString();res.json({success:true,item:{...item,status:qualificationStatus(item)}});
});
app.get('/api/staff/kpi-history', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const requested=boundedText(req.query.username||actor.username,160),target=staffAccountInSchool(actor,requested);
  if(!target)return res.status(404).json({message:'Staff member not found.'});
  if(!(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))&&normalizeUsername(target.username)!==normalizeUsername(actor.username))return res.status(403).json({message:'You can view only your own KPI history.'});
  const count=Math.max(1,Math.min(24,Number(req.query.months)||12)),rows=[];const now=new Date();
  for(let i=count-1;i>=0;i--){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1));rows.push(monthlyTaskKpi(actor,target.username,d.toISOString().slice(0,7)));}
  res.json({username:target.username,staffName:target.name||target.username,rows});
});
app.get('/api/staff/development-plans', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=tenantRecords(db.staffDevelopmentPlans,actor);res.json((hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))?rows:rows.filter(x=>normalizeUsername(x.username)===normalizeUsername(actor.username)));
});
app.post('/api/staff/development-plans', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor||!(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)))return res.status(403).json({message:'Management access is required.'});
  const target=staffAccountInSchool(actor,req.body?.username),goal=boundedText(req.body?.goal,1000);
  if(!target||!goal)return res.status(400).json({message:'Choose a staff member and add a development goal.'});
  const targetDate=boundedText(req.body?.targetDate,10);if(targetDate&&!validIsoDate(targetDate))return res.status(400).json({message:'Choose a valid target date.'});
  const item=tagSchoolRecord(actor,{id:crypto.randomUUID(),username:target.username,staffName:target.name||target.username,goal,actions:boundedText(req.body?.actions,2000),targetDate,status:'Active',reviewId:boundedText(req.body?.reviewId,100),createdBy:actor.username,createdAt:new Date().toISOString()});
  db.staffDevelopmentPlans.unshift(item);res.status(201).json({success:true,item});
});
app.patch('/api/staff/development-plans/:id', (req,res) => {
  const actor=requireSchoolStaff(req),item=actor&&db.staffDevelopmentPlans.find(x=>x.id===req.params.id&&recordInSchool(x,actor));
  if(!item)return res.status(404).json({message:'Development plan not found.'});
  const own=normalizeUsername(item.username)===normalizeUsername(actor.username),manager=(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role));if(!own&&!manager)return res.status(403).json({message:'You cannot update this plan.'});
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

const emailHtmlText = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const smtpSend = async ({to,subject,text,html}) => {
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
    const cleanText = String(text || '').replace(/\r?\n/g, '\r\n');
    const cleanHtml = String(html || '').replace(/\r?\n/g, '\r\n');
    const fromHeader = config.fromName ? `${config.fromName} <${config.from}>` : config.from;
    const messageHeaders = [
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Subject: ${cleanSubject}`,
      'MIME-Version: 1.0',
      `Date: ${new Date().toUTCString()}`
    ];
    let messageBody;
    if (cleanHtml) {
      const boundary = `lf-alt-${crypto.randomBytes(12).toString('hex')}`;
      messageHeaders.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      messageBody = [
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        cleanText,
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        cleanHtml,
        `--${boundary}--`
      ].join('\r\n');
    } else {
      messageHeaders.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit');
      messageBody = cleanText;
    }
    const message = `${messageHeaders.join('\r\n')}\r\n\r\n${messageBody}`.replace(/^\./gm, '..');
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

const sendLittleFeetEmail = async ({to,subject,text,html}) => {
  if (!looksLikeEmailAddress(to)) return false;
  if (smtpEmailConfigured()) return smtpSend({to,subject,text,html});

  const from=String(process.env.LF_EMAIL_FROM||'').trim(),apiKey=String(process.env.LF_EMAIL_API_KEY||'').trim();
  if(!looksLikeEmailAddress(from)||!apiKey)return false;
  const rawEndpoint=String(process.env.LF_EMAIL_API_URL||'https://api.resend.com/emails').trim();
  const testLoopbackEndpoint=process.env.NODE_ENV==='test' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(rawEndpoint)
    ? rawEndpoint
    : '';
  const endpoint=safeHttpsUrl(rawEndpoint)||testLoopbackEndpoint;
  if(!endpoint)throw new Error('Invalid LF_EMAIL_API_URL');
  const payload={from,to:[to],subject:emailHeaderText(subject),text:String(text||'')};
  if(String(html||'').trim())payload.html=String(html);
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(payload)});
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
  const schoolStaff = db.users.filter(account => staffAccountInSchool(actor, account.username));
  const visible = (hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) ? schoolStaff : schoolStaff.filter(account => normalizeUsername(account.username) === normalizeUsername(actor.username));
  const rows = visible.map(account => ({ username: account.username, staffName: account.name || account.username, ...monthlyTaskKpi(actor, account.username, month) }));
  const ranked = rows.slice().sort((a,b) => b.completionRate - a.completionRate || b.completed - a.completed || a.staffName.localeCompare(b.staffName)).map((row,index)=>({ ...row, rank:index+1 }));
  res.json({ month, rows: ranked });
});

// Staff purchase requests feed management approvals and finance fulfilment.
app.get('/api/purchase-requests', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=tenantRecords(db.purchaseRequests,actor);
  res.json((hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))?rows:rows.filter(x=>normalizeUsername(x.requestedBy)===normalizeUsername(actor.username)));
});
app.post('/api/purchase-requests', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const itemName=boundedText(req.body?.itemName,180),reason=boundedText(req.body?.reason,2000),quantity=Math.max(1,Math.min(9999,Number(req.body?.quantity)||1)),estimatedUnitCost=Number(req.body?.estimatedUnitCost||0);
  if(!itemName||!reason||!Number.isFinite(estimatedUnitCost)||estimatedUnitCost<0)return res.status(400).json({message:'Add an item, reason, quantity and valid estimated cost.'});
  const item=tagSchoolRecord(actor,{id:crypto.randomUUID(),itemName,reason,quantity,estimatedUnitCost:Number(estimatedUnitCost.toFixed(2)),estimatedTotal:Number((quantity*estimatedUnitCost).toFixed(2)),supplier:boundedText(req.body?.supplier,180),category:boundedText(req.body?.category||'General',80),requestedBy:actor.username,requestedByName:actor.name||actor.username,status:'Pending',financeStatus:'Awaiting approval',createdAt:new Date().toISOString()});
  db.purchaseRequests.unshift(item);res.status(201).json({success:true,item});
});
app.patch('/api/purchase-requests/:id/finance', (req,res) => {
  const actor=requireSchoolStaff(req);if(!actor||!(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)))return res.status(403).json({message:'Management access is required for purchase fulfilment.'});
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
  if(!(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))&&normalizeUsername(item.bookedBy)!==normalizeUsername(actor.username))return res.status(403).json({message:'You can only cancel your own booking.'});
  if(req.body?.status!=='Cancelled')return res.status(400).json({message:'Bookings can only be cancelled here.'});item.status='Cancelled';item.cancelledBy=actor.username;item.cancelledAt=new Date().toISOString();res.json({success:true,item});
});

// Maintenance & work orders
const MAINTENANCE_STATUSES = new Set(['Open','In Progress','Completed']);
app.get('/api/maintenance', (req,res) => {
  const actor=requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=tenantRecords(db.maintenanceOrders,actor);
  res.json((hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))?rows:rows.filter(x=>normalizeUsername(x.reportedBy)===normalizeUsername(actor.username)||normalizeUsername(x.assignedTo)===normalizeUsername(actor.username)));
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
  const manager=(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)),assigned=normalizeUsername(item.assignedTo)===normalizeUsername(actor.username);
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
  if (!actor || !(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can record meeting minutes.' });
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
  const management = hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role);
  const rows = tenantRecords(db.staffNotices, actor)
    .filter(notice => management || notice.audience === 'All staff' || notice.audience === actor.role)
    .map(notice => {
    const acknowledgedBy = Array.isArray(notice.acknowledgedBy) ? notice.acknowledgedBy : [];
    const acknowledged = acknowledgedBy.some(entry => normalizeUsername(entry.username) === normalizeUsername(actor.username));
    const eligible = staff.filter(account => notice.audience === 'All staff' || account.role === notice.audience);
    return { ...notice, acknowledged, acknowledgedCount: eligible.filter(account => acknowledgedBy.some(entry => normalizeUsername(entry.username) === normalizeUsername(account.username))).length, audienceCount: eligible.length,
      outstanding: (hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)) ? eligible.filter(account => !acknowledgedBy.some(entry => normalizeUsername(entry.username) === normalizeUsername(account.username))).map(account => ({ username: account.username, name: account.name || account.username })) : undefined };
  });
  res.json(rows);
});
app.post('/api/staff/notices', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can publish staff notices.' });
  const title = boundedText(req.body?.title, 180), message = boundedText(req.body?.message, 5000);
  if (!title || !message) return res.status(400).json({ message: 'Add a notice title and message.' });
  const audience = ['All staff','teacher','principal','admin'].includes(req.body?.audience) ? req.body.audience : 'All staff';
  const dueDate = boundedText(req.body?.dueDate, 30);
  if (dueDate && !validDateKey(dueDate)) return res.status(400).json({ message: 'Choose a valid acknowledgement due date.' });
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
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'School management access is required.' });
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
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'School management access is required.' });
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

// Executive Home overview: one aggregate request keeps the CEO dashboard live
// without duplicating the per-workspace API fan-out used by My Day.
app.get('/api/executive-overview', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });

  const platformWide = hasPlatformAccess(actor);
  const scoped = records => platformWide ? (Array.isArray(records) ? records.slice() : []) : tenantRecords(records, actor);
  const visibleAccounts = platformWide
    ? (db.users || []).slice()
    : (db.users || []).filter(account => !PLATFORM_INTERNAL_ROLES.has(account.role) && isSameSchool(actor, account));

  const schools = platformWide
    ? (db.schools || []).filter(school => school.status !== 'deleted')
    : (db.schools || []).filter(school => school.id === accountSchoolId(actor));
  const learners = scoped(db.students);
  const tasks = scoped(db.staffTasks);
  const leave = scoped(db.staffLeave);
  const cover = scoped(db.teacherCover);
  const maintenance = scoped(db.maintenanceOrders);
  const purchases = scoped(db.purchaseRequests);
  const tickets = scoped(db.tickets);
  const reviews = scoped(db.performanceReviews);
  const payments = scoped(db.parentPayments);
  const consents = scoped(db.consentRecords);

  const groupedCount = (records, select) => {
    const counts = new Map();
    records.forEach(record => {
      const key = select(record);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  };
  const chartRows = (counts, preferredOrder = []) => {
    const order = new Map(preferredOrder.map((label, index) => [label, index]));
    return [...counts.entries()]
      .filter(([, value]) => Number(value) > 0)
      .map(([label, value]) => ({ label, value: Number(value) }))
      .sort((first, second) => {
        const firstOrder = order.has(first.label) ? order.get(first.label) : 999;
        const secondOrder = order.has(second.label) ? order.get(second.label) : 999;
        return firstOrder - secondOrder || second.value - first.value || first.label.localeCompare(second.label);
      });
  };

  const accountGroups = groupedCount(visibleAccounts, account => {
    if (account.role === 'parent') return 'Parents';
    if (account.role === 'teacher') return 'Teachers';
    if (['admin', 'principal'].includes(account.role)) return 'Leadership';
    if (account.role === 'school_accounts') return 'School accounts';
    if (PLATFORM_INTERNAL_ROLES.has(account.role)) return 'Little Feet team';
    if (account.role === 'district') return 'District';
    return 'Other';
  });

  const attentionCounts = new Map([
    ['Open tasks', tasks.filter(item => item.status !== 'Completed').length],
    ['Pending leave', leave.filter(item => item.status === 'Pending').length],
    ['Cover needed', cover.filter(item => item.status === 'Needs Cover').length],
    ['Maintenance', maintenance.filter(item => item.status !== 'Completed').length],
    ['Purchases', purchases.filter(item => item.status === 'Pending').length],
    ['Open tickets', tickets.filter(item => item.status !== 'Completed').length]
  ]);
  const openAttention = [...attentionCounts.values()].reduce((sum, value) => sum + Number(value || 0), 0);

  const reviewCounts = groupedCount(reviews, item => ['Draft', 'Shared', 'Acknowledged'].includes(item.status) ? item.status : 'Other');
  const ratedReviews = reviews.map(item => Number(item.averageRating)).filter(Number.isFinite);
  const averageReviewRating = ratedReviews.length
    ? Number((ratedReviews.reduce((sum, rating) => sum + rating, 0) / ratedReviews.length).toFixed(2))
    : null;

  const paymentFinancials = payments.map(record => parentPaymentFinancials(record));
  const financeSummary = parentPaymentSummary(payments);
  const financeCounts = new Map([
    ['Collected', cents(financeSummary.paidAmount)],
    ['Outstanding', cents(financeSummary.balance)]
  ]);

  const openFaults = (db.systemErrors || []).filter(entry =>
    entry.status === 'open' && (platformWide || !entry.schoolId || entry.schoolId === accountSchoolId(actor))
  ).length;

  let setup = { show: false, complete: true, steps: {} };
  if (!platformWide && actor.role === 'admin') {
    const steps = {
      learners: learners.length > 0,
      people: visibleAccounts.some(account => ['parent', 'teacher', 'principal', 'school_accounts'].includes(account.role)),
      consent: consents.length > 0,
      finance: billingPaymentConfigured(subscriptionBillingState(actor).payment) || payments.length > 0
    };
    setup = { show: !Object.values(steps).every(Boolean), complete: Object.values(steps).every(Boolean), steps };
  }

  res.json({
    scope: platformWide ? 'platform' : 'school',
    generatedAt: new Date().toISOString(),
    kpis: {
      schools: schools.length,
      learners: learners.length,
      accounts: visibleAccounts.length,
      openAttention,
      outstandingBalance: cents(financeSummary.balance),
      arrears: cents(financeSummary.arrears),
      averageReviewRating,
      openFaults
    },
    charts: {
      accounts: chartRows(accountGroups, ['Parents', 'Teachers', 'Leadership', 'School accounts', 'Little Feet team', 'District', 'Other']),
      attention: chartRows(attentionCounts, ['Open tasks', 'Pending leave', 'Cover needed', 'Maintenance', 'Purchases', 'Open tickets']),
      finance: chartRows(financeCounts, ['Collected', 'Outstanding']),
      reviews: chartRows(reviewCounts, ['Draft', 'Shared', 'Acknowledged', 'Other'])
    },
    setup
  });
});

// Staff performance reviews / KPI
const KPI_RATINGS = new Set([1, 2, 3, 4, 5]);
app.get('/api/staff/performance-reviews', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = tenantRecords(db.performanceReviews, actor);
  if ((hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role))) return res.json(records);
  res.json(records.filter(item => normalizeUsername(item.username) === normalizeUsername(actor.username)));
});
app.post('/api/staff/performance-reviews', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can create performance reviews.' });
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
  const item = tagEmploymentRecord(actor, employee, {
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
  const isManager = (hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role));
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
  if (!account || !['teacher','principal','admin','school_accounts','staff','crm','accounts','support','school_staff','school_hr'].includes(account.role) || isAwaitingAccountVerification(account)) return null;
  const companyAccount = hasPlatformAccess(account) || PLATFORM_INTERNAL_ROLES.has(account.role);
  if (companyAccount && !hasPlatformAccess(actor) && normalizeUsername(actor.username) !== normalizeUsername(account.username)) return null;
  return isSameSchool(actor, account) ? account : null;
};

const tagEmploymentRecord = (actor, employee, record) => {
  const company = hasPlatformAccess(employee) || PLATFORM_INTERNAL_ROLES.has(employee.role);
  return tagSchoolRecord({ ...actor, schoolId: company ? '' : accountSchoolId(employee), schoolName: company ? '' : employee.schoolName }, record);
};
app.get('/api/staff/directory', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'Staff access is required.' });
  const manager = hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role);
  const accounts = db.users.filter(account => staffAccountInSchool(actor, account.username) && (manager || normalizeUsername(account.username) === normalizeUsername(actor.username)));
  res.json(accounts.map(account => ({ username: account.username, name: account.name || account.username, role: account.role, schoolId: account.schoolId || '', schoolName: account.schoolName || '' })));
});

app.get('/api/staff/tasks', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = tenantRecords(db.staffTasks, actor);
  if ((hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role))) return res.json(records);
  res.json(records.filter(item => normalizeUsername(item.assignedTo) === normalizeUsername(actor.username) || normalizeUsername(item.createdBy) === normalizeUsername(actor.username)));
});
app.post('/api/staff/tasks', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const assignee = staffAccountInSchool(actor, req.body?.assignedTo || actor.username);
  const title = boundedText(req.body?.title, 180);
  if (!assignee || !title) return res.status(400).json({ message: 'Choose a staff member from this school and add a task title.' });
  if (!(hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)) && normalizeUsername(assignee.username) !== normalizeUsername(actor.username)) return res.status(403).json({ message: 'Teachers can create tasks for themselves. Management can assign tasks to staff.' });
  const item = tagEmploymentRecord(actor, assignee, { id: crypto.randomUUID(), title, details: boundedText(req.body?.details, 3000), priority: boundedText(req.body?.priority || 'Normal', 30), dueDate: boundedText(req.body?.dueDate, 30), status: 'Open', assignedTo: assignee.username, assignedToName: assignee.name || assignee.username, createdBy: actor.username, createdAt: new Date().toISOString() });
  db.staffTasks.unshift(item);
  res.status(201).json({ success: true, item });
});
app.patch('/api/staff/tasks/:id', (req, res) => {
  const actor = requireSchoolStaff(req);
  const item = actor && db.staffTasks.find(record => record.id === req.params.id && recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Task not found.' });
  const canManage = (hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) || normalizeUsername(item.assignedTo) === normalizeUsername(actor.username);
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
  res.json((hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) ? records : records.filter(item => normalizeUsername(item.username) === normalizeUsername(actor.username)));
});
app.post('/api/staff/leave', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const startDate = boundedText(req.body?.startDate, 30);
  const endDate = boundedText(req.body?.endDate || startDate, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return res.status(400).json({ message: 'Choose a valid leave date range.' });
  const item = tagEmploymentRecord(actor, actor, { id: crypto.randomUUID(), username: actor.username, staffName: actor.name || actor.username, leaveType: boundedText(req.body?.leaveType || 'Annual leave', 80), startDate, endDate, reason: boundedText(req.body?.reason, 1500), status: 'Pending', createdAt: new Date().toISOString() });
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
  if (!(hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) && !ownCancellation) return res.status(403).json({ message: 'Management approval is required.' });
  item.status = requestedStatus;
  item.reviewedBy = actor.username;
  item.reviewedAt = new Date().toISOString();
  res.json({ success: true, item });
});

app.get('/api/staff/cover', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = tenantRecords(db.teacherCover, actor);
  res.json((hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) ? records : records.filter(item => [item.absentTeacher, item.coverTeacher].some(username => normalizeUsername(username) === normalizeUsername(actor.username))));
});
app.post('/api/staff/cover', (req, res) => {
  const actor = requireSchoolStaff(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can create cover assignments.' });
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
  if (!(hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role)) && normalizeUsername(item.coverTeacher) !== normalizeUsername(actor.username)) return res.status(403).json({ message: 'You cannot update this cover assignment.' });
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
const ADMISSION_STATUSES = new Set(['Submitted','Under review','Documents required','Waitlisted','Approved','Rejected','Enrolled','Withdrawn']);
const admissionChecklistDefaults = () => [
  { key:'birth_certificate', label:'Birth certificate', required:true },
  { key:'guardian_id', label:'Parent / guardian identity document', required:true },
  { key:'proof_of_address', label:'Proof of address', required:false },
  { key:'immunisation_record', label:'Immunisation record', required:false },
  { key:'previous_report', label:'Previous school report', required:false },
  { key:'transfer_card', label:'Transfer card', required:false }
].map(item=>({...item,status:'missing',verifiedAt:'',verifiedBy:''}));

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
  const targetSchoolId=accountSchoolId(principal);
  const duplicate=(db.admissionsApplications||[]).find(item=>item.schoolId===targetSchoolId&&normalizeUsername(item.createdBy)===normalizeUsername(applicant.username)&&normalizeComparableText(item.learnerName)===normalizeComparableText(learnerName)&&!['Rejected','Withdrawn','Enrolled'].includes(item.status));
  if(duplicate)return res.status(409).json({message:'An active application for this learner already exists at this school.',applicationId:duplicate.id,status:duplicate.status});
  const createdAt=new Date().toISOString();
  const application = {
    id:crypto.randomUUID(), applicationNumber:'LF-'+new Date().getUTCFullYear()+'-'+crypto.randomBytes(4).toString('hex').toUpperCase(),
    schoolId:targetSchoolId, schoolName, guardianName,
    contactPhone:encryptField(contactPhone), contactEmail:encryptField(contactEmail),
    learnerName, dateOfBirth:encryptField(dateOfBirth), intendedStart,
    gradeOrAgeGroup, educationStage, homeArea:encryptField(homeArea), notes:encryptField(notes),
    checklist:admissionChecklistDefaults(), status:'Submitted', createdBy:applicant.username,
    createdByName:applicant.name||applicant.username, assignedTo:principal.username,
    createdAt, updatedAt:createdAt, convertedLearnerId:'', convertedRegistryId:''
  };
  db.admissionsApplications.unshift(application);
  db.admissionsStatusHistory.unshift({id:crypto.randomUUID(),applicationId:application.id,schoolId:targetSchoolId,fromStatus:'',toStatus:'Submitted',changedBy:applicant.username,changedAt:createdAt,note:'Application submitted'});
  const ticket = {
    id: crypto.randomUUID(), department: 'Admissions', category: 'School application', priority: 'Normal', subject: `School application · ${learnerName}`,
    message: `Application ${application.applicationNumber} for ${schoolName}`, applicationId:application.id, schoolName, createdBy: applicant.username, createdByName: applicant.name || applicant.username,
    assignedTo: principal.username, schoolId: targetSchoolId, status: 'Open', monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }), createdAt
  };
  db.tickets.unshift(ticket);
  res.status(201).json({ success: true, application: { id:application.id, applicationNumber:application.applicationNumber, assignedTo: principal.name || principal.username, status: application.status }, ticketId:ticket.id });
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

app.get('/api/tickets/assignees', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(isAdminLike(actor) || ['crm', 'support'].includes(actor.role))) return res.status(403).json({ message: 'Ticket management access is required.' });
  const companyQueueAccess = hasPlatformAccess(actor) || ['crm', 'support'].includes(actor.role);
  const accounts = db.users.filter(account => !isAwaitingAccountVerification(account) && (companyQueueAccess || canManageAccount(actor, account)) && (actor.role !== 'crm' || PLATFORM_INTERNAL_ROLES.has(account.role) || ['admin','principal'].includes(account.role)));
  res.json(accounts.map(account => ({ username: account.username, name: account.name || account.username, role: account.role, schoolId: account.schoolId || '', schoolName: account.schoolName || '', companyAccount: hasPlatformAccess(account) || PLATFORM_INTERNAL_ROLES.has(account.role) })));
});

app.get('/api/tickets', (req, res) => {
  const viewer = getSessionAccount(req);
  if (!viewer) return res.status(401).json({ message: 'Sign in to view your support tickets.' });
  const schoolTickets = PLATFORM_INTERNAL_ROLES.has(viewer.role) ? db.tickets : tenantRecords(db.tickets, viewer);
  if (hasPlatformAccess(viewer) || viewer.role === 'support') return res.json(db.tickets);
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
  if (db.users.some(account => isConfiguredPlatformOwner(account) && accountSchoolId(account) === schoolId)) {
    return res.status(409).json({ message: 'This school cannot be deleted because it contains the protected Little Feet owner account.' });
  }
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
  const companyQueueAccess = hasPlatformAccess(actor) || actor.role === 'support';
  const ticket = db.tickets.find(t => t.id === id && (companyQueueAccess || recordInSchool(t, actor) || (PLATFORM_INTERNAL_ROLES.has(actor.role) && normalizeUsername(t.assignedTo) === normalizeUsername(actor.username))));
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found.' });
  const canManage = companyQueueAccess || isAdminLike(actor) || normalizeUsername(ticket.assignedTo) === normalizeUsername(actor.username);
  if (!canManage) return res.status(403).json({ message: 'Only the assigned account or an administrator can update this ticket.' });
  if (status !== undefined && !['Open', 'Completed'].includes(status)) return res.status(400).json({ message: 'Ticket status must be Open or Completed.' });
  let nextAssignee;
  if (assignedTo !== undefined) {
    if (!(isAdminLike(actor) || ['crm', 'support'].includes(actor.role))) return res.status(403).json({ message: 'Only an administrator or authorised Little Feet support staff can change ticket assignments.' });
    const assignedAccount = assignedTo ? findAccountByUsername(assignedTo) : null;
    if (assignedTo && (!assignedAccount || isAwaitingAccountVerification(assignedAccount) || (!companyQueueAccess && !isSameSchool(actor, assignedAccount)))) return res.status(400).json({ message: 'Choose an available account for the ticket assignment.' });
    nextAssignee = assignedAccount?.username || '';
  }
  if (nextAssignee !== undefined) ticket.assignedTo = nextAssignee;
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
  res.json(db.users.filter(user => canUseDirectChat(viewer, user)).map(user => ({ username:user.username, name:user.name || user.username, role:user.role })));
});
app.get('/api/chat/direct/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  const viewer = getSessionAccount(req);
  const contact = findAccountByUsername(user2);
  if (!viewer || normalizeUsername(user1) !== normalizeUsername(viewer.username) || !canUseDirectChat(viewer, contact)) return res.status(403).json({ message: 'This private conversation is not available for these accounts.' });
  const msgs = db.directMessages.filter(
    m => ((m.sender === user1 && m.recipient === user2) || (m.sender === user2 && m.recipient === user1))
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
  const messageScope = PLATFORM_INTERNAL_ROLES.has(senderAccount.role) && !PLATFORM_INTERNAL_ROLES.has(recipientAccount.role) ? recipientAccount : senderAccount;
  const msgObj = tagSchoolRecord(messageScope, {
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
  return account && (hasPlatformAccess(account) || ['admin', 'principal'].includes(account.role)) ? account : null;
};
app.get('/api/broadcasts', (req, res) => {
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to view safety alerts.' });
  const latitude = Number(req.query.lat);
  const longitude = Number(req.query.lng);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const canSeeAll = (hasPlatformAccess(requester) || ['admin', 'principal'].includes(requester.role));
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
  const schoolId = accountSchoolId(user);
  releaseExpiredStoreReservations(schoolId);
  const canManage = isAdminLike(user);
  const products = tenantRecords(db.storeProducts || [], user).filter(product => product.active !== false).map(({ schoolName: _schoolName, schoolId: _schoolId, ...product }) => {
    const physicalStockQuantity = Math.max(0, Number(product.stockQuantity) || 0);
    const reservedQuantity = Math.max(0, Number(product.reservedQuantity) || 0);
    return {
      ...product,
      stockQuantity: Math.max(0, physicalStockQuantity - reservedQuantity),
      ...(canManage ? { physicalStockQuantity, reservedQuantity } : {})
    };
  });
  res.json({ schoolName, products, canManage, webStoreUrl: user.schoolStoreUrl || null });
});
app.post('/api/store/products', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator can add school store items.' });
  const name = String(req.body?.name || '').trim().slice(0, 120);
  const price = billingAmount(req.body?.price);
  const stockQuantity = Number.parseInt(req.body?.stockQuantity, 10);
  if (!name || price === null || price <= 0 || !Number.isInteger(stockQuantity) || stockQuantity < 0) return res.status(400).json({ message: 'Enter an item name, a price greater than zero, and a valid stock quantity.' });
  if (!Array.isArray(db.storeProducts)) db.storeProducts = [];
  const product = tagSchoolRecord(actor, { id: crypto.randomUUID(), name, price, stockQuantity, reservedQuantity: 0, active: true, createdAt: new Date().toISOString(), createdBy: actor.username });
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
  const schoolId = accountSchoolId(actor);
  releaseExpiredStoreReservations(schoolId);
  if (storeAvailableQuantity(product) < quantity) return res.status(409).json({ message: 'The requested quantity is not currently available.' });
  const billing = subscriptionBillingState(actor);
  if (!billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'The school payment destination is not configured yet.' });
  product.reservedQuantity = Math.max(0, Number(product.reservedQuantity) || 0) + quantity;
  const reference = `${billing.payment.referencePrefix}-STORE-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const timestamp = new Date().toISOString();
  const order = tagSchoolRecord(actor, {
    id: crypto.randomUUID(), reference, productId: product.id, productName: product.name, quantity,
    amount: Math.round(product.price * quantity * 100) / 100,
    parentUsername: actor.username, parentName: actor.name || actor.username,
    status: 'awaiting payment', paymentStatus: 'awaiting_payment', fulfilmentStatus: 'awaiting_payment',
    stockAccountingVersion: 2, stockReservationStatus: 'reserved', stockReservedAt: timestamp,
    createdAt: timestamp
  });
  if (!Array.isArray(db.storeOrders)) db.storeOrders = [];
  db.storeOrders.unshift(order);
  db.moduleRecords.stock.unshift(tagSchoolRecord(actor, {
    id: crypto.randomUUID(), orderId: order.id, reference,
    details: `Store order awaiting payment · ${product.name} × ${quantity} · ${order.parentName} · Ref ${reference}`,
    source: 'school-store', status: 'Awaiting payment', createdAt: new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })
  }));
  res.status(201).json({ success: true, order, payment: paymentInstructions(billing, reference), reservationExpiresAt: new Date(Date.parse(timestamp) + STORE_RESERVATION_TTL_MS).toISOString() });
});
app.get('/api/store/orders', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'School-store order access is required.' });
  releaseExpiredStoreReservations(accountSchoolId(actor));
  let orders = tenantRecords(db.storeOrders || [], actor);
  if (actor.role === 'parent') orders = orders.filter(order => normalizeUsername(order.parentUsername) === normalizeUsername(actor.username));
  res.json(orders.map(order => ({
    id: order.id, reference: order.reference, productId: order.productId, productName: order.productName,
    quantity: order.quantity, amount: order.amount, parentName: order.parentName,
    status: order.status, paymentStatus: order.paymentStatus || 'awaiting_payment',
    fulfilmentStatus: order.fulfilmentStatus || '', stockReservationStatus: order.stockReservationStatus || '',
    createdAt: order.createdAt, paidAt: order.paidAt || '', refundedAt: order.refundedAt || '',
    stockReservedAt: order.stockReservedAt || '', stockReleasedAt: order.stockReleasedAt || '',
    fulfilmentUpdatedAt: order.fulfilmentUpdatedAt || ''
  })));
});

app.post('/api/store/orders/:id/cancel', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to cancel a store order.' });
  const order = (db.storeOrders || []).find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!order) return res.status(404).json({ message: 'Store order not found.' });
  const ownsOrder = actor.role === 'parent' && normalizeUsername(order.parentUsername) === normalizeUsername(actor.username);
  const canManage = hasPlatformAccess(actor) || ['principal', 'admin', 'staff'].includes(actor.role);
  if (!ownsOrder && !canManage) return res.status(403).json({ message: 'You cannot cancel this store order.' });
  if (order.paymentStatus === 'paid') return res.status(409).json({ message: 'A paid order cannot be cancelled. Confirm the actual refund first, then record that refund in Little Feet.' });
  if (['cancelled', 'refunded', 'collected'].includes(String(order.fulfilmentStatus || '').toLowerCase())) return res.json({ success: true, order });
  releaseStoreReservation(order, new Date().toISOString(), 'cancelled');
  res.json({ success: true, order });
});

app.patch('/api/store/orders/:id/fulfilment', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Only authorised store staff can update order fulfilment.' });
  const order = (db.storeOrders || []).find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!order) return res.status(404).json({ message: 'Store order not found.' });
  if (order.paymentStatus !== 'paid') return res.status(409).json({ message: 'The order must have a confirmed payment before fulfilment can change.' });
  if (order.fulfilmentStatus === 'refunded') return res.status(409).json({ message: 'A refunded order cannot be fulfilled.' });
  const next = String(req.body?.status || '').trim().toLowerCase();
  const labels = {
    preparing: ['preparing', 'PAID · PREPARING'],
    ready_for_collection: ['ready for collection', 'PAID · READY FOR COLLECTION'],
    collected: ['collected', 'PAID · COLLECTED']
  };
  if (!labels[next]) return res.status(400).json({ message: 'Choose preparing, ready for collection, or collected.' });
  order.fulfilmentStatus = next;
  order.status = labels[next][0];
  order.fulfilmentUpdatedAt = new Date().toISOString();
  order.fulfilmentUpdatedBy = actor.username;
  updateStoreRoomRecord(order, labels[next][1], `Store order ${labels[next][0]} · ${order.productName} × ${order.quantity} · ${order.parentName} · Ref ${order.reference}`);
  res.json({ success: true, order });
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

app.get('/api/parent-contacts', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) {
    return res.status(403).json({ message: 'Authorised school staff can view parent contact details.' });
  }
  const contacts = learnerRecordsVisibleTo(db.registry, actor)
    .map(registryRecordView)
    .map(record => ({
      id: record.id || [record.schoolId, record.learnerName, record.guardianName].map(value => String(value || '')).join('|'),
      learnerName: record.learnerName || '',
      className: record.className || '',
      guardianName: record.guardianName || '',
      guardianPhone: record.guardianPhone || '',
      guardianEmail: record.guardianEmail || '',
      emergencyContact: record.emergencyContact || ''
    }))
    .sort((first, second) => {
      const classOrder = String(first.className || '').localeCompare(String(second.className || ''), undefined, { numeric: true, sensitivity: 'base' });
      return classOrder || String(first.learnerName || '').localeCompare(String(second.learnerName || ''), undefined, { sensitivity: 'base' });
    });
  res.set('Cache-Control', 'no-store');
  res.json(contacts);
});

app.patch('/api/registry/:id/contact', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) {
    return res.status(403).json({ message: 'Authorised school staff can update parent contact details.' });
  }
  const record = learnerRecordsVisibleTo(db.registry, actor).find(entry => entry.id === req.params.id);
  if (!record) return res.status(404).json({ message: 'Learner contact record not found.' });

  const guardianName = limitedText(req.body?.guardianName, 160);
  const guardianPhone = limitedText(req.body?.guardianPhone, 80);
  const guardianEmail = limitedText(req.body?.guardianEmail, 160);
  const emergencyContact = limitedText(req.body?.emergencyContact, 500);
  if (!guardianName || !guardianPhone || guardianEmail === null || emergencyContact === null) {
    return res.status(400).json({ message: 'Enter the parent or guardian name and phone number, and keep all contact fields within their allowed length.' });
  }

  record.guardianName = guardianName;
  record.guardianPhone = encryptField(guardianPhone);
  record.guardianEmail = encryptField(guardianEmail || '');
  record.emergencyContact = encryptField(emergencyContact || '');
  record.updatedAt = new Date().toISOString();
  record.updatedBy = actor.username;

  const learner = tenantRecords(db.students, actor).find(student =>
    student.schoolId === record.schoolId
    && normalizeComparableText(student.studentName) === normalizeComparableText(record.learnerName)
    && normalizeComparableText(student.className) === normalizeComparableText(record.className)
  );
  if (learner) {
    const previousLearnerKey = learnerRecordKey(learner);
    learner.parentName = guardianName;
    learner.contactEmail = guardianEmail || '';
    learner.emergencyContact = encryptField(emergencyContact || '');
    learner.updatedAt = record.updatedAt;
    learner.updatedBy = actor.username;
    // Updating a guardian's contact address must not invalidate an already
    // printed learner code or affect a matching learner in another school.
    for (const code of db.learnerAccessCodes) {
      if (code.schoolId === learner.schoolId && code.learnerKey === previousLearnerKey) code.learnerKey = learnerRecordKey(learner);
    }
  }

  res.json({ success: true, record: registryRecordView(record) });
});

app.get('/api/registry', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can view the learner register.' });
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
  let learner = tenantRecords(db.students, actor).find(student =>
    student.schoolId === record.schoolId
    && normalizeComparableText(student.studentName) === normalizeComparableText(learnerName)
    && normalizeComparableText(student.className) === normalizeComparableText(className)
  );
  if (!learner) {
    const learnerLimit = schoolLearnerLimitState(actor);
    if (!learnerLimit.allowed) return res.status(409).json({ message: `The ${learnerLimit.planCode || 'current'} school package has reached its ${learnerLimit.hardMaxLearners.toLocaleString('en-ZA')}-learner limit. Renew or move to a larger package before adding another learner.` });
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
  db.registry.unshift(record);
  res.status(201).json({ success: true, record: registryRecordView(record), learnerKey: learnerRecordKey(learner) });
});

app.get('/api/consents', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher','principal','admin','staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can view consent records.' });
  res.json(learnerRecordsVisibleTo(db.consentRecords, actor));
});
app.post('/api/consents', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can save consent records.' });
  const learnerName = limitedText(req.body?.learnerName, 160);
  const guardianName = limitedText(req.body?.guardianName, 160);
  const { internalUpdates, marketingPhotos } = req.body;
  if (!learnerName || !guardianName) return res.status(400).json({ message: 'Learner and guardian details are required and must be within 160 characters.' });
  if ((internalUpdates !== undefined && typeof internalUpdates !== 'boolean') || (marketingPhotos !== undefined && typeof marketingPhotos !== 'boolean')) {
    return res.status(400).json({ message: 'Consent choices must be true or false.' });
  }
  const matches = db.students.filter(student => student.schoolId === accountSchoolId(actor) && normalizeComparableText(student.studentName) === normalizeComparableText(learnerName));
  if (actor.role === 'teacher' && (matches.length !== 1 || !learnerRecordsVisibleTo(matches, actor).length)) return res.status(403).json({ message: 'Choose a uniquely identified learner in your assigned classes.' });
  const learner = matches.length === 1 ? matches[0] : null;
  const record = tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerName, learnerId: learner?.id || '', className: learner?.className || '', guardianName, internalUpdates: Boolean(internalUpdates), marketingPhotos: Boolean(marketingPhotos), capturedAt: new Date().toISOString(), version: 'POPIA-consent-2026-09-v2' });
  db.consentRecords = db.consentRecords.filter(entry => entry.schoolId !== record.schoolId || normalizeComparableText(entry.learnerName) !== normalizeComparableText(record.learnerName));
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
  const matches = db.students.filter(student => student.schoolId === accountSchoolId(actor) && normalizeComparableText(student.studentName) === normalizeComparableText(learnerName));
  if (actor.role === 'teacher' && (matches.length !== 1 || !learnerRecordsVisibleTo(matches, actor).length)) return res.status(403).json({ message: 'Choose a uniquely identified learner in your assigned classes.' });
  const learner = matches.length === 1 ? matches[0] : null;
  const entry = tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerName, learnerId: learner?.id || '', className: learner?.className || '', pickupAdult, verificationCode: hashPin(verificationCode), action, recordedBy: actor.username, timestamp: new Date().toISOString() });
  db.pickupLogs.unshift(entry);
  res.status(201).json({ success: true, entry: { ...entry, verificationCode: undefined } });
});
app.get('/api/pickups', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['teacher','principal','admin','staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can view pickup records.' });
  res.json(learnerRecordsVisibleTo(db.pickupLogs, actor).map(({ verificationCode, ...entry }) => entry));
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
  return actor && (hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) ? actor : null;
};

const learnerAccessCodeView = (learner, actor, { includeCode = false, includeHistory = false } = {}) => {
  const key = learnerRecordKey(learner);
  const activeCode = db.learnerAccessCodes.find(entry => entry.learnerKey === key && entry.schoolId === learner.schoolId && entry.status === 'active' && recordInSchool(entry, actor));
  const history = db.learnerAccessCodes
    .filter(entry => entry.learnerKey === key && entry.schoolId === learner.schoolId && recordInSchool(entry, actor))
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
    schoolId: learner.schoolId || '',
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
      codeIssued: db.learnerAccessCodes.some(entry => entry.learnerKey === key && entry.schoolId === learner.schoolId && entry.status === 'active' && recordInSchool(entry, actor))
    };
  }));
});

app.get('/api/learner-access-codes/:learnerKey/printable', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator or principal can print learner code forms.' });
  const learnerKey = String(req.params.learnerKey || '');
  const matches = tenantRecords(db.students, actor).filter(entry => learnerRecordKey(entry) === learnerKey && (!req.query.schoolId || entry.schoolId === req.query.schoolId));
  if (matches.length > 1) return res.status(409).json({ message: 'Choose the learner’s school before printing this code.' });
  const learner = matches[0];
  if (!learner) return res.status(404).json({ message: 'Learner record not found.' });
  const activeCode = db.learnerAccessCodes.find(entry => entry.learnerKey === learnerKey && entry.schoolId === learner.schoolId && entry.status === 'active' && recordInSchool(entry, actor));
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
  const matches = tenantRecords(db.students, actor).filter(entry => learnerRecordKey(entry) === String(req.body?.learnerKey || '') && (!req.body?.schoolId || entry.schoolId === req.body.schoolId));
  if (matches.length > 1) return res.status(409).json({ message: 'Choose the learner’s school before issuing this code.' });
  const learner = matches[0];
  if (!learner) return res.status(404).json({ message: 'Learner record not found.' });
  const learnerKey = learnerRecordKey(learner);
  if (db.learnerAccessCodes.some(entry => entry.learnerKey === learnerKey && entry.schoolId === learner.schoolId && entry.status === 'active' && recordInSchool(entry, actor))) return res.status(409).json({ message: 'This learner already has an active code. Regenerate it instead.' });
  ensureLearnerAccessCode(actor, learner);
  res.status(201).json({ success: true, learner: learnerAccessCodeView(learner, actor, { includeCode: true, includeHistory: true }) });
});

app.post('/api/learner-access-codes/generate-batch', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can generate learner access codes.' });

  const requested = Array.isArray(req.body?.learners) ? req.body.learners : [];
  if (!requested.length) return res.status(400).json({ message: 'Add at least one learner name before generating codes.' });
  if (requested.length > 500) return res.status(400).json({ message: 'Generate up to 500 learner codes per secure batch.' });

  const schoolLearners = tenantRecords(db.students, actor);
  const results = requested.map((row, index) => {
    const inputName = boundedText(row?.learnerName, 160);
    const inputClass = boundedText(row?.className, 120);
    if (!inputName) {
      return { index, inputName, inputClass, status: 'invalid', message: 'Learner name is required.' };
    }

    let matches = schoolLearners.filter(learner => normalizeComparableText(learner.studentName) === normalizeComparableText(inputName));
    if (inputClass) {
      matches = matches.filter(learner => normalizeComparableText(learner.className) === normalizeComparableText(inputClass));
    }

    if (!matches.length) {
      return { index, inputName, inputClass, status: 'not_found', message: 'No learner in this school matches that name and class.' };
    }
    if (matches.length > 1) {
      return { index, inputName, inputClass, status: 'ambiguous', message: 'More than one learner matches. Add the Grade / Class value to identify the correct learner.' };
    }

    const learner = matches[0];
    const learnerKey = learnerRecordKey(learner);
    let codeRecord = db.learnerAccessCodes.find(entry =>
      entry.learnerKey === learnerKey && entry.schoolId === learner.schoolId && entry.status === 'active' && recordInSchool(entry, actor)
    );
    const existed = Boolean(codeRecord);
    if (!codeRecord) codeRecord = ensureLearnerAccessCode(actor, learner);

    return {
      index,
      inputName,
      inputClass,
      status: existed ? 'existing' : 'generated',
      learnerKey,
      learnerName: learner.studentName,
      className: learner.className || '',
      parentName: learner.parentName || '',
      accessCode: decryptField(codeRecord.codeEncrypted),
      issuedAt: codeRecord.issuedAt || null,
      message: existed ? 'Existing active code reused.' : 'New secure learner code generated.'
    };
  });

  res.json({
    success: true,
    generated: results.filter(item => item.status === 'generated').length,
    existing: results.filter(item => item.status === 'existing').length,
    unmatched: results.filter(item => !['generated', 'existing'].includes(item.status)).length,
    results
  });
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
  db.learnerAccessCodes.unshift({ ...tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerKey: previous.learnerKey, codeEncrypted: encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username, replaces: previous.id, source: 'administrator-regeneration' }), schoolId: previous.schoolId, schoolName: previous.schoolName || '' });
  const learner = db.students.find(entry => learnerRecordKey(entry) === previous.learnerKey && entry.schoolId === previous.schoolId && recordInSchool(entry, actor));
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
  const requested = Array.isArray(parent.requestedLearnerLinks) ? [...parent.requestedLearnerLinks] : [];
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
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'Only an administrator or principal may view learner imports.' });
  const job = db.importJobs.find(item => item.id === req.params.id && recordInSchool(item, actor));
  if (!job) return res.status(404).json({ message: 'Import job not found.' });
  res.json({ id: job.id, type: job.type, sourceSystem: job.sourceSystem || null, status: job.status, processedBatches: job.processedBatches.length, totalBatches: job.totalBatches, imported: job.imported, rejected: job.rejected, createdAt: job.createdAt, updatedAt: job.updatedAt });
});

app.post('/api/students/import', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !(hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'Only an administrator or principal may import learner records.' });
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
  const learnerLimit = schoolLearnerLimitState(actor);
  let remainingCapacity = Math.max(0, learnerLimit.hardMaxLearners - learnerLimit.learnerCount);

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
    if (remainingCapacity <= 0) {
      rejected.push({ row: batchNumber * 500 + index + 2, reason: `School package learner limit reached (${learnerLimit.hardMaxLearners}). Renew or move to a larger package before importing more learners.` });
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
    remainingCapacity -= 1;
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
    establishAuthenticatedSession(req, account, error => res.redirect(error ? '/?oauthError=session-failed' : '/?oauth=google'), 'google');
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
    establishAuthenticatedSession(req, account, error => res.redirect(error ? '/?oauthError=session-failed' : '/?oauth=yahoo'), 'yahoo');
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
    establishAuthenticatedSession(req, account, error => res.redirect(error ? '/?oauthError=session-failed' : '/?oauth=microsoft'), 'microsoft');
  } catch (error) {
    logStructured('error', 'oauth.microsoft_signin_failed', { category: 'authentication', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.redirect('/?oauthError=microsoft-sign-in-failed');
  }
});

if (typeof registerSchoolCoreUpgrades === 'function') {
  registerSchoolCoreUpgrades(app, {
    db, getSessionAccount, hasPlatformAccess, accountSchoolId, isSameSchool, recordInSchool, tagSchoolRecord,
    tenantRecords, learnerRecordsVisibleTo, normalizeUsername, normalizeComparableText, limitedText, boundedText, dateKeyInSouthAfrica,
    isParentLinkedToLearner, sendLittleFeetEmail, looksLikeEmailAddress, safeHttpsUrl, validDateKey,
    validSignatureData, encryptField, decryptStoredField, validSecretLength, matchesPin, saveDatabaseState,
    scheduleReplicaSnapshot, logStructured, smtpEmailConfigured, apiEmailConfigured, withPersistentMutation, readOnlySnapshotMode
  });
}

if (typeof registerAdvancedSchoolOperations === 'function') {
  registerAdvancedSchoolOperations(app, {
    db, getSessionAccount, hasPlatformAccess, accountSchoolId, isSameSchool, recordInSchool, tagSchoolRecord,
    tenantRecords, learnerRecordsVisibleTo, normalizeUsername, normalizeComparableText, limitedText, boundedText, dateKeyInSouthAfrica,
    isParentLinkedToLearner, validDateKey, safeHttpsUrl, createParentPaymentRecord, encryptField, decryptStoredField,
    saveDatabaseState, scheduleReplicaSnapshot, logStructured
  });
}

app.use((req, res, next) => {
  const blockedFile = /^\/(?:\.env(?:\.[^/]+)?|server\.js|backup-server\.js|auth-crypto\.js|finance-automation-server\.js|school-core-upgrades-server\.js|advanced-school-operations-server\.js|littlefeet-replica\.json|(?:littlefeet|littlesteps)\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?|package(?:-lock)?\.json|\.render-deploy-release\.json|create_portal_documents\.py|npm-debug\.log)$/i.test(req.path);
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
  if (error?.code === 'AMBIGUOUS_LEARNER') return res.status(409).json({ message: 'More than one learner matches this name. Choose a school and a uniquely identified learner before saving.' });
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
