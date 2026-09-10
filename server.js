const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';
const schoolSearchCache = new Map();
const loginAttempts = new Map();
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_API_BODY_MB = Math.max(1, Math.min(10, Number(process.env.LF_MAX_API_BODY_MB) || 8));
let activeRequestCount = 0;
let persistenceReady = Promise.resolve();
const fieldEncryptionConfigured = Boolean(process.env.LF_FIELD_ENCRYPTION_KEY);
const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);
const fieldKey = crypto.createHash('sha256').update(process.env.LF_FIELD_ENCRYPTION_KEY || 'LittleFeet-development-key-change-before-production').digest();
const CURRENT_RELEASE_NOTES = Object.freeze([
  Object.freeze({
    id: '2026-09-10-payments-books', version: '3.1', title: 'Payments, arrears and book returns',
    summary: 'Added Capitec bank-transfer instructions and fixed-price school plan payments, parent arrears and arrangements, paid Plus access, finance exports, and signed book issue and return reports.',
    publishedAt: '2026-09-10T05:30:00.000+02:00'
  }),
  Object.freeze({
    id: '2026-09-10-media-imports', version: '3.0', title: 'Audio, timetable and data-import improvements',
    summary: 'Added remembered sound controls, login and wallpaper music, the secret Easter-egg loop, custom wallpaper uploads, proper time pickers, large spreadsheet imports, and cleaner chat diagnostics.',
    publishedAt: '2026-09-10T04:30:00.000+02:00'
  }),
  Object.freeze({
    id: '2026-09-09-production-ready', version: '2.9', title: 'Secure production foundation',
    summary: 'Added PostgreSQL persistence, durable sessions, encrypted sensitive fields, administrator super-view, live diagnostics, tenant isolation, and capacity testing for large schools.',
    publishedAt: '2026-09-09T18:00:00.000+02:00'
  }),
  Object.freeze({
    id: '2026-08-safeguarding', version: '2.8', title: 'Safeguarding and family records',
    summary: 'Added consent, pickup audit, staff verification, parent report review, and digital signing controls.',
    publishedAt: '2026-08-28T08:00:00.000Z'
  }),
  Object.freeze({
    id: '2026-08-workflows', version: '2.7', title: 'Daily classroom workflows',
    summary: 'Added care logging, progress records, stock intake, and spreadsheet templates.',
    publishedAt: '2026-08-27T08:00:00.000Z'
  })
]);
if (!fieldEncryptionConfigured) console.warn('Using a development field-encryption key. Set LF_FIELD_ENCRYPTION_KEY before production.');
if (!sessionSecretConfigured) console.warn('Using a development session secret. Set SESSION_SECRET before production.');
const hashPin = (pin) => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');
const matchesPin = (pin, hash) => {
  const expected = Buffer.from(hash || '', 'hex');
  const actual = Buffer.from(hashPin(pin), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
};
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
  if (!account.schoolId) account.schoolId = ensureSchool(account.schoolName).id;
  return account.schoolId;
};
const isSameSchool = (first, second) => Boolean(first && second && accountSchoolId(first) === (second.schoolId || ensureSchool(second.schoolName).id));
const recordInSchool = (record, actor) => Boolean(record && actor && record.schoolId === accountSchoolId(actor));
const tagSchoolRecord = (actor, record) => ({ ...record, schoolId: accountSchoolId(actor), schoolName: actor.schoolName });
const tenantRecords = (records, actor) => (Array.isArray(records) ? records.filter(record => recordInSchool(record, actor)) : []);
const canUseDirectChat = (first, second) => {
  if (!first || !second || first.username === second.username || !isSameSchool(first, second)) return false;
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
const loginAttemptKey = (req, username) => `${req.ip}:${normalizeUsername(username)}`;
const activeLoginAttempt = (key) => {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.firstAttempt > LOGIN_ATTEMPT_WINDOW_MS) { loginAttempts.delete(key); return null; }
  return entry;
};

// Middleware for parsing JSON & URL-encoded bodies (supports Base64 media files)
app.disable('x-powered-by');
app.use((req, res, next) => {
  req.requestId = String(req.get('x-request-id') || crypto.randomUUID()).slice(0, 100);
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=()');
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
app.set('trust proxy', 1);
app.use((req, res, next) => {
  persistenceReady.then(() => {
    activeRequestCount += 1;
    res.on('finish', () => {
      activeRequestCount = Math.max(0, activeRequestCount - 1);
      if (!req.method || req.method === 'GET' || replicaMode || req.persistenceCommitted) return;
      void saveDatabaseState();
      scheduleReplicaSnapshot();
    });
    next();
  }).catch(next);
});
// Always revalidate application code so a newly deployed fix cannot be hidden by
// an older browser cache. Versioned media remains cacheable for performance.
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (/\.(?:html|js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  }
}));

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
  broadcasts: [],
  campusVisitors: [],
  visitorMeetings: [],
  registry: [],
  moduleRecords: { finance: [], operations: [], care: [], engagement: [], dailyCare: [], portfolio: [], supplies: [], stock: [], reports: [], safeguarding: [], absences: [], handovers: [] },
  consentRecords: [],
  pickupLogs: [],
  reportReviews: [],
  releaseNotes: CURRENT_RELEASE_NOTES.map(note => ({ ...note })),
  chatGroups: [],
  groupMessages: {},
  directMessages: [],
  importAudit: [],
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
  systemErrors: [],
  subscriptionBilling: {
    pricing: { baseMonthly: 0, bundles: { 5: { costPrice: 0, sellingPrice: 0 }, 20: { costPrice: 0, sellingPrice: 0 }, 100: { costPrice: 0, sellingPrice: 0 } }, lateFeeEnabled: false, lateFee: 0 },
    payment: { method: 'payment_link', paymentLink: '', accountName: '', bankName: '', accountNumberEncrypted: '', branchCode: '', referencePrefix: 'LF' },
    orders: []
  }
};

// PostgreSQL is used whenever DATABASE_URL is configured (the production path).
// SQLite remains a local-development fallback; the JSON replica is a portable
// standby snapshot for the backup service.
const replicaMode = process.env.LF_REPLICA_MODE === '1';
const databaseFile = path.join(__dirname, 'littlefeet.db');
const replicaFile = path.join(__dirname, 'littlefeet-replica.json');
let replicaTimer = null;
let replicaSnapshotTimer = null;
let stateDatabase = null;
let postgresPool = null;
let postgresSaveChain = Promise.resolve();
let postgresPersistenceSnapshot = new Map();

class PostgresSessionStore extends session.Store {
  constructor() {
    super();
    this.cleanupTimer = setInterval(() => {
      if (postgresPool) postgresPool.query('DELETE FROM little_feet_sessions WHERE expires_at <= NOW()').catch(error => {
        console.error('Session cleanup failed:', error.message);
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
    max: Math.max(2, Math.min(12, Number(process.env.PG_POOL_MAX) || 8)),
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
  return true;
}

function syncCurrentReleaseNotes() {
  const notesById = new Map((Array.isArray(db.releaseNotes) ? db.releaseNotes : [])
    .filter(note => note && note.id)
    .map(note => [String(note.id), note]));
  CURRENT_RELEASE_NOTES.forEach(note => notesById.set(note.id, { ...note }));
  db.releaseNotes = [...notesById.values()].sort((first, second) => {
    const dateDifference = Date.parse(second.publishedAt || '') - Date.parse(first.publishedAt || '');
    return Number.isFinite(dateDifference) && dateDifference !== 0
      ? dateDifference
      : String(second.version || '').localeCompare(String(first.version || ''), undefined, { numeric: true });
  });
}

function migrateSchoolTenancy() {
  if (!Array.isArray(db.schools)) db.schools = [];
  db.users.forEach(account => {
    const school = ensureSchool(account.schoolName);
    account.schoolId = account.schoolId || school.id;
    account.schoolName = school.name;
  });
  const defaultSchoolId = db.users.find(account => account.role === 'admin')?.schoolId || db.users[0]?.schoolId || ensureSchool('Your School').id;
  const collections = ['posts', 'schedules', 'worksheets', 'badges', 'tickets', 'attendance', 'broadcasts', 'campusVisitors', 'visitorMeetings', 'registry', 'consentRecords', 'pickupLogs', 'reportReviews', 'learnerAccessCodes', 'storeProducts', 'storeOrders', 'parentPayments', 'parentSubscriptions', 'bookRegister', 'paymentEvents', 'paymentLedger', 'systemErrors', 'importAudit', 'chatGroups', 'directMessages'];
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
      console.error('Unable to load PostgreSQL application state:', error.message);
      throw error;
    }
  }
  if (!stateDatabase) return false;
  try {
    const row = stateDatabase.prepare('SELECT payload FROM app_state WHERE state_key = ?').get('primary');
    if (!row) return false;
    return applySavedState(JSON.parse(row.payload));
  } catch (error) {
    console.error('Unable to load SQLite application state:', error.message);
    return false;
  }
}

async function saveDatabaseState() {
  if (replicaMode) return;
  if (postgresPool) {
    postgresSaveChain = postgresSaveChain.then(async () => {
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
        console.error('Unable to save normalized PostgreSQL state:', error.message);
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
    console.error('Unable to save SQLite application state:', error.message);
  }
}
function loadReplicaSnapshot() {
  try {
    if (!fs.existsSync(replicaFile)) return;
    const saved = JSON.parse(fs.readFileSync(replicaFile, 'utf8'));
    applySavedState(saved);
  } catch (error) {
    console.error('Unable to load standby snapshot:', error.message);
  }
}
function writeReplicaSnapshot() {
  if (replicaMode) return;
  try {
    const stagingFile = `${replicaFile}.next`;
    fs.writeFileSync(stagingFile, JSON.stringify({ ...db, replicatedAt: new Date().toISOString() }), 'utf8');
    fs.renameSync(stagingFile, replicaFile);
  } catch (error) {
    console.error('Unable to write standby snapshot:', error.message);
  }
}
function ensureBootstrapAdministrator() {
  if (db.users.some(account => account.role === 'admin')) return;
  const username = String(process.env.LF_BOOTSTRAP_ADMIN_USERNAME || '').trim();
  const pin = String(process.env.LF_BOOTSTRAP_ADMIN_PIN || '');
  if (!username || !pin) {
    console.warn('No administrator account exists. Set LF_BOOTSTRAP_ADMIN_USERNAME and LF_BOOTSTRAP_ADMIN_PIN to create the first real school administrator.');
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
  ensureBootstrapAdministrator();
  migrateSchoolTenancy();
  syncCurrentReleaseNotes();
  await saveDatabaseState();
  writeReplicaSnapshot();
}

persistenceReady = initialisePersistence();

// API Endpoints
// Auth
app.post('/api/login', (req, res) => {
  const { username, pin } = req.body;
  const normalizedUsername = normalizeUsername(username);
  const attemptKey = loginAttemptKey(req, normalizedUsername);
  const previousAttempts = activeLoginAttempt(attemptKey);
  if (previousAttempts?.count >= MAX_LOGIN_ATTEMPTS) {
    return res.status(429).json({ message: 'Too many unsuccessful sign-in attempts. Please wait 15 minutes or contact your school administrator.' });
  }
  const user = normalizedUsername && db.users.find(u => accountMatchesUsername(u, normalizedUsername) && matchesPin(pin, u.pinHash));
  if (user) {
    if (String(user.verificationStatus || '').includes('verification pending')) {
      return res.status(403).json({ message: 'This account is waiting for school approval. Please contact your school administrator.' });
    }
    loginAttempts.delete(attemptKey);
    const safeUser = safeAccount(user);
    req.session.littleFeetUser = safeUser;
    req.session.save(error => {
      if (error) return res.status(500).json({ message: 'Unable to establish a secure sign-in session. Please try again.' });
      res.json({ user: safeUser });
    });
  } else {
    loginAttempts.set(attemptKey, { count: (previousAttempts?.count || 0) + 1, firstAttempt: previousAttempts?.firstAttempt || Date.now() });
    res.status(401).json({ message: "Invalid Staff ID / Parent Email or PIN." });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: activeRequestCount > 2 ? 'BUSY' : 'OK', instance: replicaMode ? 'STANDBY' : 'PRIMARY', activeRequests: activeRequestCount, timestamp: new Date() });
});

// A lightweight heartbeat used by the repository's free scheduled monitor. It
// touches the configured datastore so both the web service and a free pilot
// PostgreSQL project remain active without exposing application records.
app.get('/api/keepalive', async (_req, res) => {
  try {
    if (postgresPool) await postgresPool.query('SELECT 1');
    else if (stateDatabase) stateDatabase.prepare('SELECT 1').get();
    res.json({ status: 'OK', database: postgresPool ? 'postgresql' : stateDatabase ? 'sqlite' : 'replica', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Keepalive database probe failed:', error.message);
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
    bootstrapAccount: db.users.some(account => account.role === 'admin')
  };
  return { checks, ready: Object.values(checks).every(Boolean) };
};

// A separate readiness endpoint lets hosting monitor liveness without treating
// a missing production secret as a healthy, launch-ready configuration.
app.get('/api/ready', (req, res) => {
  const readiness = runtimeReadiness();
  res.status(readiness.ready ? 200 : 503).json({ ...readiness, environment: isProduction ? 'production' : 'development' });
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
    monitoring: Boolean(process.env.LF_MONITORING_DSN),
    offsiteBackup: Boolean(process.env.LF_BACKUP_BUCKET)
  };
  const missingActions = [];
  if (!readiness.checks.database) missingActions.push('Connect a persistent PostgreSQL DATABASE_URL.');
  if (!readiness.checks.fieldEncryption) missingActions.push('Set LF_FIELD_ENCRYPTION_KEY.');
  if (!readiness.checks.sessionSecret) missingActions.push('Set a strong SESSION_SECRET.');
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
  const selfRegistrationRoles = ['parent', 'teacher', 'principal'];
  if (!username || !pin || !name || !schoolName || !selfRegistrationRoles.includes(role)) {
    return res.status(400).json({ message: 'Complete all fields and choose Parent, Teacher, or Principal.' });
  }
  if (!termsAccepted) return res.status(400).json({ message: 'You must accept the school privacy notice and terms before creating an account.' });
  if (String(pin).length < 4) return res.status(400).json({ message: 'Choose a password or PIN with at least 4 characters.' });
  if (db.users.some(account => accountMatchesUsername(account, username))) return res.status(409).json({ message: 'That username is already in use.' });
  const linkValidation = role === 'parent' ? validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const requestedLinks = linkValidation.links;
  const account = {
    username: String(username).trim(), pinHash: hashPin(pin), name: String(name).trim(), role,
    schoolName: String(schoolName).trim(), schoolStoreUrl: '', linkedLearners: [],
    requestedLearnerLinks: role === 'parent' ? requestedLinks : [],
    parentRelationshipStatus: role === 'parent' ? 'Pending administrator approval' : undefined,
    subscription: role === 'parent' ? 'basic' : 'school',
    verificationStatus: 'Self-registered — school verification pending',
    termsAcceptedAt: new Date().toISOString(), termsVersion: '2026-08'
  };
  account.schoolId = ensureSchool(account.schoolName).id;
  db.users.push(account);
  const { pin: _pin, pinHash: _pinHash, ...safeAccount } = account;
  res.status(201).json({ success: true, account: safeAccount });
});

const safeAccount = ({ pin, pinHash, ...account }) => ({
  ...account,
  ...(account.role === 'parent' ? { subscription: parentSubscriptionActive(account) ? 'plus' : 'basic', parentSubscriptionActive: parentSubscriptionActive(account) } : {})
});
const getSessionAccount = (req) => {
  const username = req.session?.littleFeetUser?.username;
  return username ? findAccountByUsername(username) : null;
};
const requireAdmin = (req) => {
  const account = getSessionAccount(req);
  return account?.role === 'admin' ? account : null;
};
const recordSystemError = (error, req = null, extra = {}) => {
  if (!Array.isArray(db.systemErrors)) db.systemErrors = [];
  const actor = req ? getSessionAccount(req) : null;
  const entry = {
    id: crypto.randomUUID(), requestId: req?.requestId || '', schoolId: actor ? accountSchoolId(actor) : '',
    method: String(req?.method || extra.method || 'SYSTEM').slice(0, 12),
    route: String(req?.originalUrl || extra.route || '').split('?')[0].slice(0, 240),
    name: String(error?.name || 'Error').slice(0, 80), message: String(error?.message || 'Unknown server error').slice(0, 500),
    severity: extra.severity || 'error', status: 'open', createdAt: new Date().toISOString()
  };
  db.systemErrors.unshift(entry);
  if (db.systemErrors.length > 5000) db.systemErrors.length = 5000;
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
      openErrors: (db.systemErrors || []).filter(entry => entry.status === 'open' && (!entry.schoolId || entry.schoolId === schoolId)).length
    },
    persistence: postgresPool ? 'record-based-postgresql' : replicaMode ? 'read-only-replica' : 'local-sqlite',
    activeRequests: activeRequestCount, generatedAt: new Date().toISOString()
  });
});

app.get('/api/system-errors', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const schoolId = accountSchoolId(actor);
  res.json((db.systemErrors || []).filter(entry => !entry.schoolId || entry.schoolId === schoolId).slice(0, 250));
});

app.patch('/api/system-errors/:id', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const entry = (db.systemErrors || []).find(item => item.id === req.params.id && (!item.schoolId || item.schoolId === accountSchoolId(actor)));
  if (!entry) return res.status(404).json({ message: 'System error report not found.' });
  const status = String(req.body?.status || 'acknowledged').toLowerCase();
  if (!['acknowledged', 'resolved'].includes(status)) return res.status(400).json({ message: 'Choose acknowledged or resolved.' });
  entry.status = status;
  entry.updatedAt = new Date().toISOString();
  entry.updatedBy = actor.username;
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
  payment: { method: 'payment_link', paymentLink: '', accountName: '', bankName: '', accountNumberEncrypted: '', branchCode: '', referencePrefix: 'LF' },
  orders: []
});
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
const billingPaymentConfigured = (payment) => payment.method === 'payment_link'
  ? Boolean(payment.paymentLink)
  : Boolean(payment.accountName && payment.bankName && payment.accountNumberEncrypted);
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
    accountNumber: decryptField(payment.accountNumberEncrypted), branchCode: payment.branchCode, reference
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
const cents = value => Math.round(Number(value || 0) * 100) / 100;
const parentPaymentAmount = record => billingAmount(record.arrangementAmount) > 0 ? billingAmount(record.arrangementAmount) : (billingAmount(record.amountDue) || 0);
const parentPaymentDueDate = record => {
  const original = validDateKey(record.dueDate) || dateKeyInSouthAfrica();
  const arrangement = validDateKey(record.arrangementDueDate);
  return arrangement && arrangement > original ? arrangement : original;
};
const parentPaymentFinancials = (record, asOf = dateKeyInSouthAfrica()) => {
  const amountDue = parentPaymentAmount(record);
  const events = (db.paymentEvents || []).filter(event => event.targetType === 'parent_payment' && String(event.reference || '').toUpperCase() === String(record.reference || '').toUpperCase());
  const paid = cents(events.filter(event => event.status === 'paid').reduce((sum, event) => sum + Number(event.amount || 0), 0));
  const refunded = cents(events.filter(event => event.status === 'refunded').reduce((sum, event) => sum + Number(event.amount || 0), 0));
  const paidAmount = Math.max(0, cents(paid - refunded));
  const balance = Math.max(0, cents(amountDue - paidAmount));
  const effectiveDueDate = parentPaymentDueDate(record);
  const overdue = balance > 0 && effectiveDueDate < asOf;
  return {
    amountDue, originalAmount: billingAmount(record.amountDue) || amountDue,
    arrangementAmount: billingAmount(record.arrangementAmount) || null,
    paidAmount, balance, arrears: overdue ? balance : 0, dueDate: validDateKey(record.dueDate),
    effectiveDueDate, status: balance <= 0 ? 'paid' : overdue ? 'in_arrears' : paidAmount > 0 ? 'partially_paid' : 'awaiting_payment',
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
const parentPaymentView = (record, actor) => {
  const financials = parentPaymentFinancials(record);
  const paymentHistory = (db.paymentEvents || []).filter(event => event.targetType === 'parent_payment' && String(event.reference || '').toUpperCase() === String(record.reference || '').toUpperCase()).map(event => ({ amount: billingAmount(event.amount) || 0, status: event.status, receivedAt: event.receivedAt, providerTransactionId: event.providerTransactionId || '' }));
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
  if (numericAmount === null || numericAmount <= 0) return { error: 'Payment amount must be greater than zero.' };
  if (target.type === 'parent_payment') {
    const current = parentPaymentFinancials(target.record);
    const remaining = normalStatus === 'refunded' ? current.paidAmount : Math.max(0, cents(expectedAmount - current.paidAmount));
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
  target.record.paymentUpdatedAt = timestamp;
  if (normalStatus === 'paid') target.record.paidAt = timestamp;
  if (normalStatus === 'refunded') target.record.refundedAt = timestamp;
  if (target.type === 'parent_subscription') {
    const parent = findAccountByUsername(target.record.parentUsername);
    if (parent && normalStatus === 'paid') {
      parent.parentSubscriptionStatus = 'paid'; parent.subscription = 'plus'; parent.parentSubscriptionPaidAt = timestamp;
      parent.parentSubscriptionGrantedUntil = target.record.grantedUntil || '';
    } else if (parent && normalStatus === 'refunded') {
      parent.parentSubscriptionStatus = 'basic'; parent.subscription = 'basic'; parent.parentSubscriptionGrantedUntil = '';
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
  const billing = subscriptionBillingState(actor);
  const isAdmin = actor.role === 'admin';
  const { accountNumberEncrypted, ...adminPayment } = billing.payment;
  res.json({
    pricing: publicBillingPricing(billing, isAdmin),
    plans: schoolSubscriptionPlans.map(plan => ({ ...plan })),
    paymentConfigured: billingPaymentConfigured(billing.payment),
    payment: isAdmin ? { ...adminPayment, accountNumber: decryptField(accountNumberEncrypted) } : undefined,
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
  const paymentLink = String(req.body?.payment?.paymentLink || '').trim();
  const accountName = String(req.body?.payment?.accountName || '').trim();
  const bankName = String(req.body?.payment?.bankName || '').trim();
  const accountNumber = String(req.body?.payment?.accountNumber || '').trim();
  const branchCode = String(req.body?.payment?.branchCode || '').trim();
  const referencePrefix = String(req.body?.payment?.referencePrefix || 'LF').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) || 'LF';
  if (paymentMethod === 'payment_link') {
    try {
      const parsed = new URL(paymentLink);
      if (parsed.protocol !== 'https:') throw new Error('Unsafe protocol');
    } catch { return res.status(400).json({ message: 'Enter a valid HTTPS payment link.' }); }
  } else if (!accountName || !bankName || !accountNumber) {
    return res.status(400).json({ message: 'Account name, bank name, and account number are required for bank transfers.' });
  }
  const billing = subscriptionBillingState(actor);
  billing.pricing = { baseMonthly, bundles, lateFeeEnabled: Boolean(req.body?.lateFeeEnabled), lateFee };
  billing.payment = { method: paymentMethod, paymentLink: paymentMethod === 'payment_link' ? paymentLink : '', accountName: paymentMethod === 'bank_transfer' ? accountName : '', bankName: paymentMethod === 'bank_transfer' ? bankName : '', accountNumberEncrypted: paymentMethod === 'bank_transfer' ? encryptField(accountNumber) : '', branchCode: paymentMethod === 'bank_transfer' ? branchCode : '', referencePrefix };
  billing.updatedAt = new Date().toISOString();
  // Payment destinations must survive a restart. Commit this high-value setting
  // before acknowledging the request instead of relying only on the normal
  // post-response persistence queue.
  await saveDatabaseState();
  writeReplicaSnapshot();
  req.persistenceCommitted = true;
  res.json({ success: true, pricing: publicBillingPricing(billing, true), paymentConfigured: true });
});

app.post('/api/subscription-billing/orders', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Only a principal or administrator can create a school subscription payment request.' });
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
    status: 'awaiting payment', createdAt: new Date().toISOString()
  };
  billing.orders.unshift(order);
  res.status(201).json({ success: true, order: { ...order, profitMargin: undefined }, payment: paymentInstructions(billing, reference) });
});

const allowedParentPaymentRoles = new Set(['parent', 'principal', 'admin']);
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

app.get('/api/parent-payments/parents', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'School finance access is required.' });
  res.json(db.users.filter(account => account.role === 'parent' && isSameSchool(actor, account)).map(account => ({ username: account.username, name: account.name || account.username, linkedLearners: account.linkedLearners || [] })));
});

app.get('/api/parent-payments', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !allowedParentPaymentRoles.has(actor.role)) return res.status(403).json({ message: 'Parent payment access is required.' });
  let records = (db.parentPayments || []).filter(record => recordInSchool(record, actor));
  if (actor.role === 'parent') records = records.filter(record => normalizeUsername(record.parentUsername) === normalizeUsername(actor.username));
  const payments = records.map(record => parentPaymentView(record, actor));
  res.json({ payments, summary: parentPaymentSummary(records), recalculatedAt: new Date().toISOString() });
});

app.post('/api/parent-payments', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Only a principal or administrator can create parent payment requests.' });
  const result = createParentPaymentRecord(req.body, actor);
  if (result.error) return res.status(400).json({ message: result.error });
  if (!Array.isArray(db.parentPayments)) db.parentPayments = [];
  db.parentPayments.unshift(result.record);
  res.status(201).json({ success: true, payment: parentPaymentView(result.record, actor), summary: parentPaymentSummary(db.parentPayments.filter(record => recordInSchool(record, actor))) });
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
  if (!actor || !['parent', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Parent subscription access is required.' });
  const records = (db.parentSubscriptions || []).filter(record => recordInSchool(record, actor) && (actor.role === 'admin' || normalizeUsername(record.parentUsername) === normalizeUsername(actor.username)));
  res.json({ active: actor.role === 'admin' ? undefined : parentSubscriptionActive(actor), pricePerChild: 29, latest: records[0] ? { reference: records[0].reference, status: records[0].paymentStatus, amount: records[0].amount, createdAt: records[0].createdAt } : null, parents: actor.role === 'admin' ? db.users.filter(account => account.role === 'parent' && isSameSchool(actor, account)).map(account => ({ username: account.username, name: account.name, active: parentSubscriptionActive(account), status: account.parentSubscriptionStatus || 'basic', grantedUntil: account.parentSubscriptionGrantedUntil || '' })) : undefined, paymentConfigured: billingPaymentConfigured(subscriptionBillingState(actor).payment) });
});

app.post('/api/parent-subscription/orders', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || actor.role !== 'parent') return res.status(403).json({ message: 'Only a parent can start a parent subscription.' });
  const billing = subscriptionBillingState(actor);
  if (!billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'The school payment destination is not configured yet.' });
  const children = Math.max(1, Math.min(4, (actor.linkedLearners || []).length));
  const amount = children * 29;
  const reference = `${billing.payment.referencePrefix}-PLUS-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const order = tagSchoolRecord(actor, { id: crypto.randomUUID(), reference, parentUsername: actor.username, parentName: actor.name || actor.username, children, amount, paymentStatus: 'awaiting_payment', grantedUntil: String(req.body?.grantedUntil || '').trim(), createdAt: new Date().toISOString() });
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
  if (!actor || !['parent', 'teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Book register access is required.' });
  const className = normalizeComparableText(req.query.className);
  let records = bookRecordsForSchool(actor);
  if (className) records = records.filter(record => normalizeComparableText(record.className) === className);
  res.json({ records: records.map(bookRecordView), summary: { total: records.length, returned: records.filter(record => record.status === 'returned').length, outstanding: records.filter(record => record.status !== 'returned').length, unsignedParents: records.filter(record => !record.parentSignature).length, penalties: cents(records.reduce((sum, record) => sum + (billingAmount(record.penaltyAmount) || 0), 0)) }, generatedAt: new Date().toISOString() });
});

app.get('/api/book-register/parents', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'School book-register management is required.' });
  res.json(db.users.filter(account => account.role === 'parent' && isSameSchool(actor, account)).map(account => ({ username: account.username, name: account.name || account.username, linkedLearners: account.linkedLearners || [] })));
});

app.post('/api/book-register', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can issue books.' });
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
  if (!actor || !['principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Only a principal or administrator can import the book register.' });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 2000) : [];
  if (!rows.length) return res.status(400).json({ message: 'Add at least one checklist row to import.' });
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
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can record returned books.' });
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
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  res.json((db.paymentLedger || []).filter(entry => entry.schoolId === accountSchoolId(actor)));
});

app.post('/api/payments/reconcile', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Only a principal or administrator can reconcile a school payment.' });
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
  res.json(db.users.filter(account => isSameSchool(actor, account)).map(safeAccount));
});
app.post('/api/accounts', (req, res) => {
  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses } = req.body;
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const allowedRoles = ['parent', 'teacher', 'principal', 'district', 'admin'];
  if (!username || !pin || !name || !allowedRoles.includes(role)) return res.status(400).json({ message: 'Name, username, password, and role are required.' });
  if (schoolName && schoolKey(schoolName) !== schoolKey(actor.schoolName)) return res.status(403).json({ message: 'Administrators can create accounts only for their own school.' });
  if (db.users.some(account => accountMatchesUsername(account, username))) return res.status(409).json({ message: 'That username is already in use.' });
  const linkValidation = role === 'parent' ? validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const account = { username: String(username).trim(), pinHash: hashPin(pin), name: String(name).trim(), role, schoolName: actor.schoolName, schoolId: accountSchoolId(actor), schoolStoreUrl: String(schoolStoreUrl || '').trim(), linkedLearners: linkValidation.links, parentRelationshipStatus: role === 'parent' ? 'Administrator approved' : undefined, verificationStatus: 'Active', assignedClasses: role === 'teacher' ? normaliseAssignedClasses(assignedClasses) : [] };
  db.users.push(account);
  res.status(201).json({ success: true, account: safeAccount(account) });
});
app.put('/api/accounts/:username', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = db.users.find(entry => entry.username === req.params.username);
  if (!account || !isSameSchool(actor, account)) return res.status(404).json({ message: 'Account not found.' });
  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses } = req.body;
  const allowedRoles = ['parent', 'teacher', 'principal', 'district', 'admin'];
  if (username && username !== account.username && db.users.some(entry => entry.username.toLowerCase() === String(username).toLowerCase())) return res.status(409).json({ message: 'That username is already in use.' });
  if (username) account.username = String(username).trim();
  if (pin) account.pinHash = hashPin(pin);
  if (name) account.name = String(name).trim();
  if (role && allowedRoles.includes(role)) account.role = role;
  if (schoolName && schoolKey(schoolName) !== schoolKey(actor.schoolName)) return res.status(403).json({ message: 'An account cannot be moved to another school from this workspace.' });
  account.schoolName = actor.schoolName;
  account.schoolId = accountSchoolId(actor);
  account.schoolStoreUrl = String(schoolStoreUrl || '').trim();
  const linkValidation = account.role === 'parent' ? validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  account.linkedLearners = linkValidation.links;
  if (account.role === 'parent') {
    account.parentRelationshipStatus = linkValidation.links.length ? 'Administrator approved' : 'Pending administrator approval';
    account.requestedLearnerLinks = [];
  }
  account.assignedClasses = account.role === 'teacher' ? normaliseAssignedClasses(assignedClasses) : [];
  res.json({ success: true, account: safeAccount(account) });
});
app.delete('/api/accounts/:username', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const target = findAccountByUsername(req.params.username);
  if (!target || !isSameSchool(actor, target)) return res.status(404).json({ message: 'Account not found.' });
  if (target.role === 'admin' && db.users.filter(account => account.role === 'admin' && isSameSchool(actor, account)).length <= 1) return res.status(400).json({ message: 'Create another administrator before removing the final administrator account.' });
  const previousLength = db.users.length;
  db.users = db.users.filter(account => account.username !== req.params.username);
  if (db.users.length === previousLength) return res.status(404).json({ message: 'Account not found.' });
  res.json({ success: true });
});
app.post('/api/accounts/:username/approve', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = findAccountByUsername(req.params.username);
  if (!account || !isSameSchool(actor, account)) return res.status(404).json({ message: 'Account not found.' });
  account.verificationStatus = 'Active';
  if (account.role === 'parent' && !account.linkedLearners?.length) account.parentRelationshipStatus = 'Pending administrator approval';
  account.approvedAt = new Date().toISOString();
  scheduleReplicaSnapshot();
  res.json({ success: true, account: safeAccount(account) });
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
  const cached = schoolSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 30 * 60 * 1000) {
    return res.json({ ...cached.data, cached: true });
  }

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
    schoolSearchCache.set(cacheKey, { createdAt: Date.now(), data });
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
      schoolSearchCache.set(cacheKey, { createdAt: Date.now(), data });
      res.json(data);
    } catch (fallbackError) {
      console.error('Nearby school search failed:', error.message, '| fallback failed:', fallbackError.message);
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
    console.error('School enrichment failed:', error.message);
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

// Posts
app.get('/api/posts', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view the school feed.' });
  res.json(tenantRecords(db.posts, actor));
});
app.post('/api/posts', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can post updates.' });
  const post = tagSchoolRecord(actor, req.body || {});
  post.createdAt = post.createdAt || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  db.posts.unshift(post);
  res.json({ success: true, post });
});
app.delete('/api/posts/:id', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const post = db.posts.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!post) return res.status(404).json({ message: 'School update not found.' });
  db.posts = db.posts.filter(p => p !== post);
  res.json({ success: true });
});

// Schedules
app.get('/api/schedules', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view schedules.' });
  res.json(tenantRecords(db.schedules, actor));
});
app.post('/api/schedules', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can create schedules.' });
  const item = tagSchoolRecord(actor, { id: crypto.randomUUID(), ...req.body });
  db.schedules.push(item);
  res.json({ success: true, item });
});
app.post('/api/schedules/import', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can import schedules.' });
  const { schedules } = req.body;
  if (Array.isArray(schedules)) {
    db.schedules.push(...schedules.slice(0, 2000).map(item => tagSchoolRecord(actor, { id: crypto.randomUUID(), ...item })));
  }
  res.json({ success: true });
});
app.delete('/api/schedules/:id', (req, res) => {
  const actor = getSessionAccount(req);
  const item = db.schedules.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!actor || !item || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(404).json({ message: 'Schedule item not found.' });
  db.schedules = db.schedules.filter(s => s !== item);
  res.json({ success: true });
});

// Worksheets
app.get('/api/worksheets', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view learning files.' });
  res.json(tenantRecords(db.worksheets, actor));
});
app.post('/api/worksheets', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can add learning files.' });
  const item = tagSchoolRecord(actor, { ...req.body, uploadedAt: new Date().toLocaleDateString(), createdAt: new Date().toISOString() });
  db.worksheets.unshift(item);
  res.json({ success: true, item });
});
app.delete('/api/worksheets/:id', (req, res) => {
  const actor = getSessionAccount(req);
  const item = db.worksheets.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!actor || !item || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(404).json({ message: 'Learning file not found.' });
  db.worksheets = db.worksheets.filter(w => w !== item);
  res.json({ success: true });
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
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) {
    return res.status(403).json({ message: 'Only authorised school staff can award badges.' });
  }
  const { actorUsername: _actorUsername, ...item } = req.body;
  item.awardedBy = actor.username;
  db.badges.unshift(tagSchoolRecord(actor, item));
  res.json({ success: true, item });
});
app.delete('/api/badges/:id', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) {
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

// Attendance
app.get('/api/attendance', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view attendance.' });
  res.json(tenantRecords(db.attendance, actor));
});
app.post('/api/attendance', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can record attendance.' });
  const item = tagSchoolRecord(actor, { ...req.body, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  db.attendance.unshift(item);
  res.json({ success: true, item });
});
app.post('/api/attendance/import', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can import attendance.' });
  const { attendance } = req.body;
  if (Array.isArray(attendance)) {
    db.attendance.unshift(...attendance.slice(0, 2000).map(item => tagSchoolRecord(actor, { id: crypto.randomUUID(), ...item })));
  }
  res.json({ success: true });
});
app.post('/api/attendance/toggle', (req, res) => {
  const actor = getSessionAccount(req);
  const { id, status } = req.body;
  const item = db.attendance.find(a => a.id === id && recordInSchool(a, actor));
  if (!actor || !item || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(404).json({ message: 'Attendance record not found.' });
  if (item) item.status = status;
  res.json({ success: true });
});
app.delete('/api/attendance/:id', (req, res) => {
  const actor = getSessionAccount(req);
  const item = db.attendance.find(a => a.id === req.params.id && recordInSchool(a, actor));
  if (!actor || !item || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(404).json({ message: 'Attendance record not found.' });
  db.attendance = db.attendance.filter(a => a !== item);
  res.json({ success: true });
});
app.post('/api/attendance/clear', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can clear attendance.' });
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
  const gradeOrAgeGroup = String(req.body?.gradeOrAgeGroup || '').trim().slice(0, 80);
  const homeArea = String(req.body?.homeArea || '').trim().slice(0, 160);
  const notes = String(req.body?.notes || '').trim().slice(0, 1200);
  if (!schoolName || !guardianName || !contactPhone || !contactEmail || !learnerName || !dateOfBirth || !intendedStart || !gradeOrAgeGroup || !homeArea || !notes) {
    return res.status(400).json({ message: 'Complete the contact, learner, start-date, age/grade, area and application details.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(contactEmail)) return res.status(400).json({ message: 'Enter a valid contact email address.' });
  const principal = db.users.find(account => account.role === 'principal' && normalizeComparableText(account.schoolName) === normalizeComparableText(schoolName) && !String(account.verificationStatus || '').toLowerCase().includes('pending'));
  if (!principal) return res.status(409).json({ message: 'This school is not yet available for Little Feet applications. Ask the school to activate its principal account first.' });
  const application = { guardianName, contactPhone, contactEmail, learnerName, dateOfBirth, intendedStart, gradeOrAgeGroup, homeArea, notes };
  const ticket = {
    id: crypto.randomUUID(), department: 'Admissions', category: 'School application', priority: 'Normal', subject: `School application · ${learnerName}`,
    message: `Application for ${schoolName}`, application, schoolName, createdBy: applicant.username, createdByName: applicant.name || applicant.username,
    assignedTo: principal.username, schoolId: accountSchoolId(principal), status: 'Open', monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }), createdAt: new Date().toISOString()
  };
  db.tickets.unshift(ticket);
  res.status(201).json({ success: true, ticket: { id: ticket.id, assignedTo: principal.name || principal.username, status: ticket.status } });
});

app.get('/api/tickets', (req, res) => {
  const viewer = getSessionAccount(req);
  if (!viewer) return res.status(401).json({ message: 'Sign in to view your support tickets.' });
  const schoolTickets = tenantRecords(db.tickets, viewer);
  if (viewer.role === 'admin') return res.json(schoolTickets);
  const visibleTickets = schoolTickets.filter(ticket =>
    normalizeUsername(ticket.createdBy) === normalizeUsername(viewer.username) ||
    normalizeUsername(ticket.assignedTo) === normalizeUsername(viewer.username)
  );
  res.json(visibleTickets);
});
app.post('/api/tickets', (req, res) => {
  const { createdBy, assignedTo, ...ticketDetails } = req.body;
  const creator = getSessionAccount(req);
  if (!creator) return res.status(401).json({ message: 'Sign in to create a support ticket.' });
  const assignedAccount = creator.role === 'admin' ? findAccountByUsername(assignedTo) : null;
  if (assignedTo && (!assignedAccount || !isSameSchool(creator, assignedAccount))) {
    return res.status(400).json({ message: 'Choose an account from this school for the ticket assignment.' });
  }
  const item = tagSchoolRecord(creator, {
    ...ticketDetails,
    id: String(ticketDetails.id || crypto.randomUUID()),
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
app.post('/api/tickets/update', (req, res) => {
  const { id, status, feedback, updatedBy, assignedTo } = req.body;
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to update a support ticket.' });
  const ticket = db.tickets.find(t => t.id === id && recordInSchool(t, actor));
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found.' });
  const canManage = actor.role === 'admin' || normalizeUsername(ticket.assignedTo) === normalizeUsername(actor.username);
  if (!canManage) return res.status(403).json({ message: 'Only the assigned account or an administrator can update this ticket.' });
  if (assignedTo !== undefined) {
    if (actor.role !== 'admin') return res.status(403).json({ message: 'Only an administrator can change ticket assignments.' });
    const assignedAccount = assignedTo ? findAccountByUsername(assignedTo) : null;
    if (assignedTo && (!assignedAccount || !isSameSchool(actor, assignedAccount))) return res.status(400).json({ message: 'Choose an account from this school for the ticket assignment.' });
    ticket.assignedTo = assignedAccount?.username || '';
  }
  if (status) ticket.status = status;
  if (feedback !== undefined) ticket.feedback = feedback;
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
  res.json(tenantRecords(db.chatGroups, actor));
});
app.post('/api/chat/groups', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can create groups.' });
  const { groupName } = req.body;
  const id = crypto.randomUUID();
  db.chatGroups.push(tagSchoolRecord(actor, { id, groupName: String(groupName || '').trim().slice(0, 120) }));
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
  const group = db.chatGroups.find(entry => entry.id === req.params.groupId && recordInSchool(entry, actor));
  if (!actor || !group) return res.status(404).json({ message: 'Chat group not found.' });
  const msgs = db.groupMessages[req.params.groupId] || [];
  res.json(msgs);
});
app.post('/api/chat/messages', (req, res) => {
  const { groupId, sender, message, textColor } = req.body;
  const actor = getSessionAccount(req);
  const group = db.chatGroups.find(entry => entry.id === groupId && recordInSchool(entry, actor));
  if (!actor || !group) return res.status(404).json({ message: 'Chat group not found.' });
  if (!db.groupMessages[groupId]) db.groupMessages[groupId] = [];
  const msgObj = {
    id: crypto.randomUUID(),
    sender: actor.username,
    message,
    textColor: textColor || "#2dd4bf",
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
  if (!String(message || '').trim()) return res.status(400).json({ message: 'A message is required.' });
  const msgObj = tagSchoolRecord(senderAccount, {
    id: crypto.randomUUID(),
    sender: senderAccount.username,
    recipient,
    message,
    textColor: textColor || "#2dd4bf",
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
  return account && ['admin', 'principal'].includes(account.role) ? account : null;
};
app.get('/api/broadcasts', (req, res) => {
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to view safety alerts.' });
  const latitude = Number(req.query.lat);
  const longitude = Number(req.query.lng);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const canSeeAll = ['admin', 'principal'].includes(requester.role);
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
  if (!String(req.body?.bcMessage || '').trim() || !req.body?.location) return res.status(400).json({ message: 'A message and alert location are required.' });
  const item = tagSchoolRecord(actor, {
    id: Date.now().toString(),
    ...req.body,
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
  if (!user || !['parent', 'teacher', 'principal', 'admin'].includes(user.role)) return res.status(403).json({ message: 'You are not authorised to view meeting requests.' });
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
  const host = findAccountByUsername(req.body?.hostUsername);
  const proposedAt = String(req.body?.proposedAt || '').trim();
  const purpose = String(req.body?.purpose || '').trim();
  if (!parent || parent.role !== 'parent' || !host || !['teacher', 'principal'].includes(host.role) || !isSameSchool(parent, host) || !proposedAt || !purpose) return res.status(400).json({ message: 'Choose an authorised teacher or principal, a proposed time, and a meeting purpose.' });
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
  if (!principal || !meeting || !['principal', 'admin'].includes(principal.role) || !isSameSchool(principal, meeting) || meeting.status !== 'awaiting-principal-approval') return res.status(403).json({ message: 'Only the principal or administrator can issue visitor authorisation after both parties agree.' });
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
  res.json({ schoolName, products, canManage: user.role === 'admin', webStoreUrl: user.schoolStoreUrl || null });
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
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Stock-room access is required.' });
  res.json(tenantRecords(db.storeOrders || [], actor));
});

// Internal operational records for the advanced workspaces. External providers are configured separately.
app.get('/api/modules/:module', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view this workspace.' });
  const records = db.moduleRecords[req.params.module];
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  res.json(tenantRecords(records, actor));
});
app.post('/api/modules/:module', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can save workspace records.' });
  const records = db.moduleRecords[req.params.module];
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  const record = tagSchoolRecord(actor, { id: crypto.randomUUID(), ...req.body, createdAt: new Date().toLocaleString() });
  records.unshift(record);
  res.json({ success: true, record });
});
app.delete('/api/modules/:module/:id', (req, res) => {
  const actor = requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const records = db.moduleRecords[req.params.module];
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  const record = records.find(entry => entry.id === req.params.id && recordInSchool(entry, actor));
  if (!record) return res.status(404).json({ message: 'Workspace record not found.' });
  db.moduleRecords[req.params.module] = records.filter(entry => entry !== record);
  res.json({ success: true });
});

app.get('/api/registry', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view the register.' });
  res.json(tenantRecords(db.registry, actor));
});
app.post('/api/registry', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can add register records.' });
  const required = ['learnerName', 'dateOfBirth', 'guardianName', 'guardianPhone', 'address'];
  if (required.some(field => !String(req.body[field] || '').trim())) return res.status(400).json({ message: 'Complete all required registry fields.' });
  const record = tagSchoolRecord(actor, { id: crypto.randomUUID(), ...req.body, createdAt: new Date().toLocaleString() });
  db.registry.unshift(record);
  res.json({ success: true, record });
});

app.get('/api/consents', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view consent records.' });
  res.json(tenantRecords(db.consentRecords, actor));
});
app.post('/api/consents', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can save consent records.' });
  const { learnerName, guardianName, internalUpdates, marketingPhotos } = req.body;
  if (!learnerName || !guardianName) return res.status(400).json({ message: 'Learner and guardian details are required.' });
  const record = tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerName: String(learnerName), guardianName: String(guardianName), internalUpdates: Boolean(internalUpdates), marketingPhotos: Boolean(marketingPhotos), capturedAt: new Date().toISOString(), version: 'POPIA consent v1' });
  db.consentRecords = db.consentRecords.filter(entry => !recordInSchool(entry, actor) || entry.learnerName.toLowerCase() !== record.learnerName.toLowerCase());
  db.consentRecords.unshift(record);
  res.status(201).json({ success: true, record });
});

app.post('/api/pickups/verify', (req, res) => {
  const actor = getSessionAccount(req);
  const { learnerName, pickupAdult, verificationCode, action } = req.body;
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Authorised school staff can record pickups.' });
  if (!learnerName || !pickupAdult || !verificationCode || !action) return res.status(400).json({ message: 'Learner, pickup adult, verification code, and action are required.' });
  const entry = tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerName: String(learnerName), pickupAdult: String(pickupAdult), verificationCode: hashPin(verificationCode), action: String(action), recordedBy: actor.username, timestamp: new Date().toISOString() });
  db.pickupLogs.unshift(entry);
  res.status(201).json({ success: true, entry: { ...entry, verificationCode: undefined } });
});
app.get('/api/pickups', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view pickup records.' });
  res.json(tenantRecords(db.pickupLogs, actor).map(({ verificationCode, ...entry }) => entry));
});

app.get('/api/release-notes', (req, res) => res.json((db.releaseNotes || []).slice().sort((first, second) => Date.parse(second.publishedAt || '') - Date.parse(first.publishedAt || ''))));

app.post('/api/report-signing-pin', (req, res) => {
  const { pin } = req.body;
  const user = getSessionAccount(req);
  if (!user || !pin || String(pin).length < 4) return res.status(400).json({ message: 'Choose a signing PIN with at least 4 characters.' });
  user.reportSigningPinHash = hashPin(pin);
  res.json({ success: true });
});

app.get('/api/report-reviews', (req, res) => {
  const user = getSessionAccount(req);
  if (!user) return res.status(401).json({ message: 'Sign in to view reports.' });
  const reports = user.role === 'parent'
    ? tenantRecords(db.reportReviews, user).filter(report => normalizeUsername(report.parentUsername) === normalizeUsername(user.username))
    : tenantRecords(db.reportReviews, user);
  res.json(reports);
});
app.post('/api/report-reviews', (req, res) => {
  const { studentName, reportTitle, period, teacherUsername, parentUsername, signatureData, signingPin } = req.body;
  const teacher = getSessionAccount(req);
  const parent = findAccountByUsername(parentUsername);
  if (!teacher || !teacher.reportSigningPinHash || !matchesPin(signingPin, teacher.reportSigningPinHash)) return res.status(403).json({ message: 'Set and enter your teacher signing PIN before publishing a report.' });
  if (!['teacher', 'principal', 'admin'].includes(teacher.role) || !parent || parent.role !== 'parent' || !isSameSchool(teacher, parent)) return res.status(400).json({ message: 'Choose an authorised teacher and a linked parent account.' });
  if (!studentName || !reportTitle || !period || !parentUsername || !signatureData) return res.status(400).json({ message: 'Complete the report details and teacher signature.' });
  const report = tagSchoolRecord(teacher, { id: crypto.randomUUID(), studentName: String(studentName), reportTitle: String(reportTitle), period: String(period), teacherUsername: teacher.username, parentUsername: parent.username, teacherSignature: signatureData, teacherSignedAt: new Date().toISOString(), parentSignature: null, parentSignedAt: null, status: 'Awaiting parent signature', createdAt: new Date().toISOString() });
  db.reportReviews.unshift(report);
  res.status(201).json({ success: true, report });
});
app.post('/api/report-reviews/:id/sign', (req, res) => {
  const { signatureData, signingPin } = req.body;
  const user = getSessionAccount(req);
  const report = db.reportReviews.find(entry => entry.id === req.params.id && recordInSchool(entry, user));
  if (!report || !user || user.role !== 'parent' || normalizeUsername(report.parentUsername) !== normalizeUsername(user.username)) return res.status(403).json({ message: 'Only the linked parent account can sign this report.' });
  if (!user.reportSigningPinHash || !matchesPin(signingPin, user.reportSigningPinHash)) return res.status(403).json({ message: 'Set and enter your parent signing PIN before signing.' });
  if (!signatureData) return res.status(400).json({ message: 'Add your signature before confirming.' });
  report.parentSignature = signatureData;
  report.parentSignedAt = new Date().toISOString();
  report.status = 'Complete - teacher and parent signed';
  res.json({ success: true, report });
});

// School-controlled learner access codes. Codes are encrypted at rest and are
// available only to the school roles that issue or print the physical handout.
const findLearnerAccessCodeActor = (req) => {
  const actor = getSessionAccount(req);
  return actor && ['admin', 'principal'].includes(actor.role) ? actor : null;
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
  if (!actor) return res.status(403).json({ message: 'Only an administrator may manage codes, and a principal may print them.' });
  const isAdmin = actor.role === 'admin';
  res.json(tenantRecords(db.students, actor).map(learner => learnerAccessCodeView(learner, actor, { includeCode: isAdmin, includeHistory: isAdmin })));
});

// This is deliberately a separate, credential-free view. It lets an
// administrator verify exactly what teachers can use: learner details and an
// issued/not-issued indicator, never an access code or its history.
app.get('/api/learner-access-codes/teacher-preview', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || actor.role !== 'admin') return res.status(403).json({ message: 'Only an administrator can open the teacher-view preview.' });
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
  if (!actor || actor.role !== 'admin') return res.status(403).json({ message: 'Only an administrator can issue learner access codes.' });
  const learner = db.students.find(entry => learnerRecordKey(entry) === String(req.body?.learnerKey || '') && recordInSchool(entry, actor));
  if (!learner) return res.status(404).json({ message: 'Learner record not found.' });
  const learnerKey = learnerRecordKey(learner);
  if (db.learnerAccessCodes.some(entry => entry.learnerKey === learnerKey && entry.status === 'active' && recordInSchool(entry, actor))) return res.status(409).json({ message: 'This learner already has an active code. Replace it instead.' });
  let accessCode = normaliseAccessCode(req.body?.manualCode);
  if (accessCode && !/^LF-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(accessCode)) return res.status(400).json({ message: 'Use the format LF-AB12-CD34, or leave the field blank to generate a code.' });
  const codeInUse = (candidate) => db.learnerAccessCodes.some(entry => entry.status === 'active' && recordInSchool(entry, actor) && decryptField(entry.codeEncrypted) === candidate);
  if (accessCode && codeInUse(accessCode)) return res.status(409).json({ message: 'That access code is already in use. Choose another code or generate one.' });
  while (!accessCode || codeInUse(accessCode)) accessCode = generateLearnerAccessCode();
  const record = tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerKey, codeEncrypted: encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username });
  db.learnerAccessCodes.unshift(record);
  res.status(201).json({ success: true, learner: learnerAccessCodeView(learner, actor, { includeCode: true, includeHistory: true }) });
});

app.post('/api/learner-access-codes/:id/replace', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor || actor.role !== 'admin') return res.status(403).json({ message: 'Only an administrator can replace learner access codes.' });
  const previous = db.learnerAccessCodes.find(entry => entry.id === req.params.id && entry.status === 'active' && recordInSchool(entry, actor));
  if (!previous) return res.status(404).json({ message: 'The active code was not found.' });
  previous.status = 'replaced';
  previous.replacedAt = new Date().toISOString();
  previous.replacedBy = actor.username;
  let accessCode;
  do { accessCode = generateLearnerAccessCode(); } while (db.learnerAccessCodes.some(entry => entry.status === 'active' && recordInSchool(entry, actor) && decryptField(entry.codeEncrypted) === accessCode));
  db.learnerAccessCodes.unshift(tagSchoolRecord(actor, { id: crypto.randomUUID(), learnerKey: previous.learnerKey, codeEncrypted: encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username, replaces: previous.id }));
  const learner = db.students.find(entry => learnerRecordKey(entry) === previous.learnerKey && recordInSchool(entry, actor));
  res.json({ success: true, learner: learner ? learnerAccessCodeView(learner, actor, { includeCode: true, includeHistory: true }) : null });
});

app.post('/api/learner-access-codes/:id/revoke', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor || actor.role !== 'admin') return res.status(403).json({ message: 'Only an administrator can invalidate learner access codes.' });
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
  let results = tenantRecords(db.students, requester);
  if (requester.role === 'parent') results = results.filter(student => isParentLinkedToLearner(requester, student));
  if (className) {
    results = results.filter(s => s.className.toLowerCase().includes(className.toLowerCase()));
  }
  if (childName) {
    results = results.filter(s => s.studentName.toLowerCase().includes(childName.toLowerCase()));
  }
  res.json(results.map(student => ({ ...student, medicalNotes: decryptField(student.medicalNotes), emergencyContact: decryptField(student.emergencyContact), authorisedPickups: decryptField(student.authorisedPickups) })));
});

app.get('/api/household', (req, res) => {
  const parent = getSessionAccount(req);
  if (!parent || parent.role !== 'parent') return res.status(403).json({ message: 'Only parent accounts can view linked learner records.' });
  res.json(tenantRecords(db.students, parent).filter(student => isParentLinkedToLearner(parent, student)).map(student => ({ ...student, medicalNotes: decryptField(student.medicalNotes), emergencyContact: decryptField(student.emergencyContact), authorisedPickups: decryptField(student.authorisedPickups) })));
});

// Secure bulk learner import. The browser previews spreadsheet rows first; this
// endpoint applies the authoritative duplicate check and encrypts sensitive fields.
app.post('/api/students/import', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['admin', 'principal'].includes(actor.role)) return res.status(403).json({ message: 'Only an administrator or principal may import learner records.' });
  const incoming = Array.isArray(req.body?.students) ? req.body.students : [];
  if (!incoming.length) return res.status(400).json({ message: 'No learner records were supplied.' });
  if (incoming.length > 1000) return res.status(400).json({ message: 'Import up to 1,000 learner records at a time.' });

  const recordKey = (student) => [student.studentName, student.className, student.contactEmail].map(normalizeComparableText).join('|');
  const knownRecords = new Set(tenantRecords(db.students, actor).map(recordKey));
  const seenInFile = new Set();
  const rejected = [];
  let imported = 0;

  incoming.forEach((row, index) => {
    const studentName = String(row?.studentName || '').trim();
    const className = String(row?.className || '').trim();
    const parentName = String(row?.parentName || '').trim();
    const contactEmail = String(row?.contactEmail || '').trim();
    if (!studentName || !className) {
      rejected.push({ row: index + 2, reason: 'Learner name and class/grade are required.' });
      return;
    }
    const candidate = { studentName, className, contactEmail };
    const key = recordKey(candidate);
    if (knownRecords.has(key) || seenInFile.has(key)) {
      rejected.push({ row: index + 2, reason: 'Duplicate learner record already exists.' });
      return;
    }
    seenInFile.add(key);
    knownRecords.add(key);
    db.students.push(tagSchoolRecord(actor, {
      studentName,
      className,
      parentName,
      contactEmail,
      medicalNotes: encryptField(String(row?.medicalNotes || '').trim()),
      emergencyContact: encryptField(String(row?.emergencyContact || '').trim()),
      authorisedPickups: encryptField(String(row?.authorisedPickups || '').trim()),
      importedAt: new Date().toISOString(),
      importedBy: actor.username
    }));
    imported += 1;
  });

  db.importAudit.unshift(tagSchoolRecord(actor, { id: crypto.randomUUID(), importedAt: new Date().toISOString(), importedBy: actor.username, imported, rejected: rejected.length }));
  res.status(201).json({ success: true, imported, rejected, message: `${imported} learner record${imported === 1 ? '' : 's'} imported.` });
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
const yahooCallbackUrl = 'https://littlefeet.co.za/auth/yahoo/callback';
const microsoftCallbackUrl = 'https://littlefeet.co.za/auth/microsoft/callback';
if (googleSignInConfigured) passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "https://littlefeet.co.za/auth/google/callback"
  },
  (accessToken, refreshToken, profile, done) => {
    const user = {
      googleId: profile.id,
      displayName: profile.displayName,
      email: profile.emails?.[0]?.value || '',
      photo: profile.photos?.[0]?.value || ''
    };
    return done(null, user);
  }
));

app.get('/api/auth/providers', (req, res) => res.json({ google: googleSignInConfigured, yahoo: yahooSignInConfigured, microsoft: microsoftSignInConfigured }));
app.get('/api/auth/session', (req, res) => {
  const account = getSessionAccount(req);
  if (!account) return res.status(401).json({ message: 'No active sign-in session.' });
  res.json({ user: safeAccount(account) });
});
app.post('/api/auth/logout', (req, res) => {
  req.session?.destroy(() => res.json({ success: true }));
});

app.get('/auth/google', (req, res, next) => {
  if (!googleSignInConfigured) return res.redirect('/?oauthError=google-not-configured');
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    const email = req.user?.email;
    const account = findAccountByUsername(email);
    if (!account) return res.redirect('/?oauthError=account-not-linked');
    req.session.littleFeetUser = safeAccount(account);
    res.redirect('/?oauth=google');
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
  res.redirect(authorizationUrl.toString());
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
    const account = findAccountByUsername(profile.email);
    if (!profileResponse.ok || !account) return res.redirect('/?oauthError=account-not-linked');
    req.session.littleFeetUser = safeAccount(account);
    res.redirect('/?oauth=yahoo');
  } catch (error) {
    console.error('Yahoo sign-in failed:', error.message);
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
  res.redirect(authorizationUrl.toString());
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
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileResponse.json();
    const account = findAccountByUsername(profile.mail || profile.userPrincipalName);
    if (!profileResponse.ok || !account) return res.redirect('/?oauthError=account-not-linked');
    req.session.littleFeetUser = safeAccount(account);
    res.redirect('/?oauth=microsoft');
  } catch (error) {
    console.error('Microsoft sign-in failed:', error.message);
    res.redirect('/?oauthError=microsoft-sign-in-failed');
  }
});

// Wildcard Catch-All (Serves Frontend)
app.use((error, req, res, _next) => {
  const report = recordSystemError(error, req);
  console.error(`[${report.requestId || report.id}] ${report.method} ${report.route}: ${report.message}`);
  if (!replicaMode && (!req.method || req.method === 'GET')) void saveDatabaseState();
  scheduleReplicaSnapshot();
  res.status(Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500).json({
    message: 'An unexpected server error occurred. The administrator report has been created.',
    requestId: report.requestId || report.id
  });
});

app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
persistenceReady.then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(error => {
  console.error('Database startup failed:', error.message);
  process.exit(1);
});
