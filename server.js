const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 5000;
const schoolSearchCache = new Map();
const loginAttempts = new Map();
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
let activeRequestCount = 0;
let persistenceReady = Promise.resolve();
const fieldKey = crypto.createHash('sha256').update(process.env.LF_FIELD_ENCRYPTION_KEY || 'LittleFeet-development-key-change-before-production').digest();
if (!process.env.LF_FIELD_ENCRYPTION_KEY) console.warn('Using a development field-encryption key. Set LF_FIELD_ENCRYPTION_KEY before production.');
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
const isSameSchool = (first, second) => normalizeComparableText(first?.schoolName) && normalizeComparableText(first?.schoolName) === normalizeComparableText(second?.schoolName);
const canUseDirectChat = (first, second) => {
  if (!first || !second || first.username === second.username || !isSameSchool(first, second)) return false;
  const parent = first.role === 'parent' ? first : second.role === 'parent' ? second : null;
  if (!parent) return true;
  const staffMember = parent === first ? second : first;
  if (staffMember.role === 'principal') return true;
  if (staffMember.role !== 'teacher') return false;
  const learnerClasses = new Set(db.students.filter(learner => isParentLinkedToLearner(parent, learner)).map(learner => normalizeComparableText(learner.className)).filter(Boolean));
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'little-feet-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax' }
}));
app.use((req, res, next) => {
  persistenceReady.then(() => {
    activeRequestCount += 1;
    res.on('finish', () => {
      activeRequestCount = Math.max(0, activeRequestCount - 1);
      if (!req.method || req.method === 'GET' || replicaMode) return;
      void saveDatabaseState();
      scheduleReplicaSnapshot();
    });
    next();
  }).catch(next);
});

// Serve static files from current directory
app.use(express.static(__dirname));

// In-Memory Database Store
const db = {
  term: "Academic Term 3: Active Session | Campus Hours: 07:00 - 17:30 SAST",
  users: [],
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
  releaseNotes: [
    { id: '2026-08-safeguarding', version: '2.8', title: 'Safeguarding and family records', summary: 'Added consent, pickup audit, staff verification, parent report review, and digital signing controls.', publishedAt: '2026-08-28T08:00:00.000Z' },
    { id: '2026-08-workflows', version: '2.7', title: 'Daily classroom workflows', summary: 'Added care logging, progress records, stock intake, and spreadsheet templates.', publishedAt: '2026-08-27T08:00:00.000Z' }
  ],
  chatGroups: [],
  groupMessages: {},
  directMessages: [],
  importAudit: [],
  students: [],
  learnerAccessCodes: [],
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
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS little_feet_app_state (
      state_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function applySavedState(saved) {
  if (!saved || typeof saved !== 'object') return false;
  const moduleDefaults = db.moduleRecords;
  Object.keys(db).forEach(key => {
    if (key !== 'moduleRecords' && Object.hasOwn(saved, key)) db[key] = saved[key];
  });
  if (Object.hasOwn(saved, 'moduleRecords')) db.moduleRecords = { ...moduleDefaults, ...(saved.moduleRecords || {}) };
  removeLegacyDemoRecords();
  return true;
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
    try {
      await postgresPool.query(`
        INSERT INTO little_feet_app_state (state_key, payload, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (state_key) DO UPDATE SET
          payload = EXCLUDED.payload,
          updated_at = NOW()
      `, ['primary', JSON.stringify(db)]);
    } catch (error) {
      console.error('Unable to save PostgreSQL application state:', error.message);
    }
    return;
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
    const { pin: _pin, pinHash: _pinHash, ...safeUser } = user;
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
  db.users.push(account);
  const { pin: _pin, pinHash: _pinHash, ...safeAccount } = account;
  res.status(201).json({ success: true, account: safeAccount });
});

const safeAccount = ({ pin, pinHash, ...account }) => account;
const getSessionAccount = (req) => {
  const username = req.session?.littleFeetUser?.username;
  return username ? findAccountByUsername(username) : null;
};
const requireAdmin = (req) => {
  const account = getSessionAccount(req);
  return account?.role === 'admin' ? account : null;
};

const billingBundleSizes = [5, 20, 100];
const billingDefaults = () => ({
  pricing: { baseMonthly: 0, bundles: { 5: { costPrice: 0, sellingPrice: 0 }, 20: { costPrice: 0, sellingPrice: 0 }, 100: { costPrice: 0, sellingPrice: 0 } }, lateFeeEnabled: false, lateFee: 0 },
  payment: { method: 'payment_link', paymentLink: '', accountName: '', bankName: '', accountNumberEncrypted: '', branchCode: '', referencePrefix: 'LF' },
  orders: []
});
const subscriptionBillingState = () => {
  const defaults = billingDefaults();
  const existing = db.subscriptionBilling || {};
  db.subscriptionBilling = {
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
  return db.subscriptionBilling;
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
const paymentInstructions = (billing, reference) => {
  const payment = billing.payment;
  if (payment.method === 'payment_link') return { method: 'Online payment', paymentLink: payment.paymentLink, reference };
  return {
    method: 'Bank transfer', accountName: payment.accountName, bankName: payment.bankName,
    accountNumber: decryptField(payment.accountNumberEncrypted), branchCode: payment.branchCode, reference
  };
};

app.get('/api/subscription-billing', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view subscription billing.' });
  const billing = subscriptionBillingState();
  const isAdmin = actor.role === 'admin';
  const { accountNumberEncrypted, ...adminPayment } = billing.payment;
  res.json({
    pricing: publicBillingPricing(billing, isAdmin),
    paymentConfigured: billingPaymentConfigured(billing.payment),
    payment: isAdmin ? { ...adminPayment, accountNumber: decryptField(accountNumberEncrypted) } : undefined,
    orders: (isAdmin ? billing.orders : billing.orders.filter(order => normalizeComparableText(order.schoolName) === normalizeComparableText(actor.schoolName))).map(order => ({ ...order, profitMargin: isAdmin ? order.profitMargin : undefined }))
  });
});

app.put('/api/subscription-billing', (req, res) => {
  if (!requireAdmin(req)) return res.status(403).json({ message: 'Only an administrator can change subscription pricing or payment details.' });
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
  const billing = subscriptionBillingState();
  billing.pricing = { baseMonthly, bundles, lateFeeEnabled: Boolean(req.body?.lateFeeEnabled), lateFee };
  billing.payment = { method: paymentMethod, paymentLink: paymentMethod === 'payment_link' ? paymentLink : '', accountName: paymentMethod === 'bank_transfer' ? accountName : '', bankName: paymentMethod === 'bank_transfer' ? bankName : '', accountNumberEncrypted: paymentMethod === 'bank_transfer' ? encryptField(accountNumber) : '', branchCode: paymentMethod === 'bank_transfer' ? branchCode : '', referencePrefix };
  billing.updatedAt = new Date().toISOString();
  res.json({ success: true, pricing: publicBillingPricing(billing, true), paymentConfigured: true });
});

app.post('/api/subscription-billing/orders', (req, res) => {
  const actor = getSessionAccount(req);
  if (!actor || !['principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Only a principal or administrator can create a school subscription payment request.' });
  const requestedBundle = Number(req.body?.bundleCapacity || 0);
  if (![0, ...billingBundleSizes].includes(requestedBundle)) return res.status(400).json({ message: 'Choose a valid extra-learner bundle.' });
  const billing = subscriptionBillingState();
  if (billing.pricing.baseMonthly <= 0 || !billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'Subscription pricing and the payment destination must be configured by an administrator first.' });
  const bundle = requestedBundle ? billing.pricing.bundles[requestedBundle] : { costPrice: 0, sellingPrice: 0 };
  if (requestedBundle && bundle.sellingPrice <= 0) return res.status(409).json({ message: 'That learner bundle is not available yet. Ask an administrator to set its selling price.' });
  const reference = `${billing.payment.referencePrefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const monthlyTotal = Math.round((billing.pricing.baseMonthly + bundle.sellingPrice) * 100) / 100;
  const order = {
    id: crypto.randomUUID(), reference, schoolName: actor.schoolName, requestedBy: actor.username,
    baseMonthly: billing.pricing.baseMonthly, bundleCapacity: requestedBundle, bundlePrice: bundle.sellingPrice,
    monthlyTotal, lateFeeAccepted: Boolean(req.body?.lateFeeAccepted), lateFee: Boolean(req.body?.lateFeeAccepted) && billing.pricing.lateFeeEnabled ? billing.pricing.lateFee : 0,
    profitMargin: Math.round((bundle.sellingPrice - bundle.costPrice) * 100) / 100,
    status: 'awaiting payment', createdAt: new Date().toISOString()
  };
  billing.orders.unshift(order);
  res.status(201).json({ success: true, order: { ...order, profitMargin: undefined }, payment: paymentInstructions(billing, reference) });
});

app.get('/api/accounts', (req, res) => {
  if (!requireAdmin(req)) return res.status(403).json({ message: 'Administrator access is required.' });
  res.json(db.users.map(safeAccount));
});
app.post('/api/accounts', (req, res) => {
  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses } = req.body;
  if (!requireAdmin(req)) return res.status(403).json({ message: 'Administrator access is required.' });
  const allowedRoles = ['parent', 'teacher', 'principal', 'district', 'admin'];
  if (!username || !pin || !name || !schoolName || !allowedRoles.includes(role)) return res.status(400).json({ message: 'Name, username, password, role, and school name are required.' });
  if (db.users.some(account => accountMatchesUsername(account, username))) return res.status(409).json({ message: 'That username is already in use.' });
  const linkValidation = role === 'parent' ? validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const account = { username: String(username).trim(), pinHash: hashPin(pin), name: String(name).trim(), role, schoolName: String(schoolName).trim(), schoolStoreUrl: String(schoolStoreUrl || '').trim(), linkedLearners: linkValidation.links, parentRelationshipStatus: role === 'parent' ? 'Administrator approved' : undefined, verificationStatus: 'Active', assignedClasses: role === 'teacher' ? normaliseAssignedClasses(assignedClasses) : [] };
  db.users.push(account);
  res.status(201).json({ success: true, account: safeAccount(account) });
});
app.put('/api/accounts/:username', (req, res) => {
  if (!requireAdmin(req)) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = db.users.find(entry => entry.username === req.params.username);
  if (!account) return res.status(404).json({ message: 'Account not found.' });
  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses } = req.body;
  const allowedRoles = ['parent', 'teacher', 'principal', 'district', 'admin'];
  if (username && username !== account.username && db.users.some(entry => entry.username.toLowerCase() === String(username).toLowerCase())) return res.status(409).json({ message: 'That username is already in use.' });
  if (username) account.username = String(username).trim();
  if (pin) account.pinHash = hashPin(pin);
  if (name) account.name = String(name).trim();
  if (role && allowedRoles.includes(role)) account.role = role;
  if (schoolName) account.schoolName = String(schoolName).trim();
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
  if (!requireAdmin(req)) return res.status(403).json({ message: 'Administrator access is required.' });
  const target = findAccountByUsername(req.params.username);
  if (target?.role === 'admin' && db.users.filter(account => account.role === 'admin').length <= 1) return res.status(400).json({ message: 'Create another administrator before removing the final administrator account.' });
  const previousLength = db.users.length;
  db.users = db.users.filter(account => account.username !== req.params.username);
  if (db.users.length === previousLength) return res.status(404).json({ message: 'Account not found.' });
  res.json({ success: true });
});
app.post('/api/accounts/:username/approve', (req, res) => {
  if (!requireAdmin(req)) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = findAccountByUsername(req.params.username);
  if (!account) return res.status(404).json({ message: 'Account not found.' });
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
  res.json({ term: db.term });
});
app.post('/api/term', (req, res) => {
  const { term } = req.body;
  if (term) db.term = term;
  res.json({ term: db.term });
});

// Posts
app.get('/api/posts', (req, res) => {
  res.json(db.posts);
});
app.post('/api/posts', (req, res) => {
  const post = req.body;
  post.createdAt = post.createdAt || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  db.posts.unshift(post);
  res.json({ success: true, post });
});
app.delete('/api/posts/:id', (req, res) => {
  db.posts = db.posts.filter(p => p.id !== req.params.id);
  res.json({ success: true });
});

// Schedules
app.get('/api/schedules', (req, res) => {
  res.json(db.schedules);
});
app.post('/api/schedules', (req, res) => {
  const item = { id: Date.now().toString(), ...req.body };
  db.schedules.push(item);
  res.json({ success: true, item });
});
app.post('/api/schedules/import', (req, res) => {
  const { schedules } = req.body;
  if (Array.isArray(schedules)) {
    db.schedules.push(...schedules);
  }
  res.json({ success: true });
});
app.delete('/api/schedules/:id', (req, res) => {
  db.schedules = db.schedules.filter(s => s.id !== req.params.id);
  res.json({ success: true });
});

// Worksheets
app.get('/api/worksheets', (req, res) => {
  res.json(db.worksheets);
});
app.post('/api/worksheets', (req, res) => {
  const item = { ...req.body, uploadedAt: new Date().toLocaleDateString(), createdAt: new Date().toISOString() };
  db.worksheets.unshift(item);
  res.json({ success: true, item });
});
app.delete('/api/worksheets/:id', (req, res) => {
  db.worksheets = db.worksheets.filter(w => w.id !== req.params.id);
  res.json({ success: true });
});

// Badges
app.get('/api/badges', (req, res) => {
  const requester = findAccountByUsername(req.query.username);
  if (!requester) return res.status(401).json({ message: 'Sign in to view badges.' });
  if (requester.role !== 'parent') return res.json(db.badges);

  const linkedLearners = new Set(
    db.students
      .filter(student => isParentLinkedToLearner(requester, student))
      .map(student => String(student.studentName).toLocaleLowerCase('en-US'))
  );
  res.json(db.badges.filter(badge => linkedLearners.has(String(badge.studentName || '').toLocaleLowerCase('en-US'))));
});
app.post('/api/badges', (req, res) => {
  const actor = findAccountByUsername(req.body.actorUsername);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) {
    return res.status(403).json({ message: 'Only authorised school staff can award badges.' });
  }
  const { actorUsername: _actorUsername, ...item } = req.body;
  item.awardedBy = actor.username;
  db.badges.unshift(item);
  res.json({ success: true, item });
});
app.delete('/api/badges/:id', (req, res) => {
  const actor = findAccountByUsername(req.body?.actorUsername);
  if (!actor || !['teacher', 'principal', 'admin'].includes(actor.role)) {
    return res.status(403).json({ message: 'Only authorised school staff can remove badges.' });
  }
  db.badges = db.badges.filter(b => b.id !== req.params.id);
  res.json({ success: true });
});

// Analytics
app.get('/api/analytics/:studentName', (req, res) => {
  const name = req.params.studentName;
  const requester = findAccountByUsername(req.query.username);
  if (!requester) return res.status(401).json({ message: 'Sign in to view growth analytics.' });
  const student = db.students.find(entry => normalizeComparableText(entry.studentName) === normalizeComparableText(name));
  if (!student) return res.status(404).json({ message: 'Learner record not found.' });
  if (requester.role === 'parent' && !isParentLinkedToLearner(requester, student)) return res.status(403).json({ message: 'Parents may only view analytics for their linked learner.' });
  const studentWorksheets = db.worksheets.filter(w => w.studentName.toLowerCase() === name.toLowerCase() && Number.isFinite(Number(w.grade))).reverse();
  if (!studentWorksheets.length) return res.json({ totalAssessments: 0, subscription: requester.subscription || 'school', studentName: name });
  const scores = studentWorksheets.map(item => Number(item.grade));
  const averageScore = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
  const first = studentWorksheets[0];
  const latest = studentWorksheets.at(-1);
  const pointChange = Number(latest.grade) - Number(first.grade);
  const percentageChange = Number(first.grade) ? Math.round((pointChange / Number(first.grade)) * 1000) / 10 : null;
  const best = studentWorksheets.reduce((bestItem, item) => Number(item.grade) > Number(bestItem.grade) ? item : bestItem);
  const worst = studentWorksheets.reduce((worstItem, item) => Number(item.grade) < Number(worstItem.grade) ? item : worstItem);
  const hasPremiumDetail = requester.role !== 'parent' || requester.subscription === 'plus';
  res.json({ totalAssessments: scores.length, averageScore, latestScore: Number(latest.grade), baselineScore: Number(first.grade), pointChange, percentageChange, trend: pointChange > 0 ? 'Improved' : pointChange < 0 ? 'Declined' : 'Maintained', best: hasPremiumDetail ? { title: best.title || 'Assessment', score: Number(best.grade) } : null, worst: hasPremiumDetail ? { title: worst.title || 'Assessment', score: Number(worst.grade) } : null, subscription: requester.subscription || 'school', detailedInsights: hasPremiumDetail });
});

// Attendance
app.get('/api/attendance', (req, res) => {
  res.json(db.attendance);
});
app.post('/api/attendance', (req, res) => {
  const item = { ...req.body, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  db.attendance.unshift(item);
  res.json({ success: true, item });
});
app.post('/api/attendance/import', (req, res) => {
  const { attendance } = req.body;
  if (Array.isArray(attendance)) {
    db.attendance.unshift(...attendance);
  }
  res.json({ success: true });
});
app.post('/api/attendance/toggle', (req, res) => {
  const { id, status } = req.body;
  const item = db.attendance.find(a => a.id === id);
  if (item) item.status = status;
  res.json({ success: true });
});
app.delete('/api/attendance/:id', (req, res) => {
  db.attendance = db.attendance.filter(a => a.id !== req.params.id);
  res.json({ success: true });
});
app.post('/api/attendance/clear', (req, res) => {
  db.attendance = [];
  res.json({ success: true });
});

// Tickets
app.get('/api/tickets', (req, res) => {
  const viewer = findAccountByUsername(req.query.username);
  if (!viewer) return res.status(401).json({ message: 'Sign in to view your support tickets.' });
  if (viewer.role === 'admin') return res.json(db.tickets);
  const visibleTickets = db.tickets.filter(ticket =>
    normalizeUsername(ticket.createdBy) === normalizeUsername(viewer.username) ||
    normalizeUsername(ticket.assignedTo) === normalizeUsername(viewer.username)
  );
  res.json(visibleTickets);
});
app.post('/api/tickets', (req, res) => {
  const { createdBy, assignedTo, ...ticketDetails } = req.body;
  const creator = findAccountByUsername(createdBy);
  if (!creator) return res.status(401).json({ message: 'Sign in to create a support ticket.' });
  const assignedAccount = creator.role === 'admin' ? findAccountByUsername(assignedTo) : null;
  if (assignedTo && (!assignedAccount || !isSameSchool(creator, assignedAccount))) {
    return res.status(400).json({ message: 'Choose an account from this school for the ticket assignment.' });
  }
  const item = {
    ...ticketDetails,
    id: String(ticketDetails.id || crypto.randomUUID()),
    createdBy: creator.username,
    createdByName: creator.name || creator.username,
    assignedTo: assignedAccount?.username || '',
    status: 'Open',
    monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }),
    createdAt: new Date().toISOString()
  };
  db.tickets.unshift(item);
  res.json({ success: true, item });
});
app.post('/api/tickets/update', (req, res) => {
  const { id, status, feedback, updatedBy, assignedTo } = req.body;
  const actor = findAccountByUsername(updatedBy);
  if (!actor) return res.status(401).json({ message: 'Sign in to update a support ticket.' });
  const ticket = db.tickets.find(t => t.id === id);
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
  if (!requireAdmin(req)) return res.status(403).json({ message: 'Administrator access is required.' });
  db.tickets = db.tickets.filter(t => t.id !== req.params.id);
  res.json({ success: true });
});

// Chat - Groups
app.get('/api/chat/groups', (req, res) => {
  res.json(db.chatGroups);
});
app.post('/api/chat/groups', (req, res) => {
  const { groupName } = req.body;
  const id = Date.now().toString();
  db.chatGroups.push({ id, groupName });
  db.groupMessages[id] = [];
  res.json({ success: true, id });
});
app.delete('/api/chat/groups/:id', (req, res) => {
  const id = req.params.id;
  if (id === 'general') return res.status(400).json({ message: "Cannot delete General group." });
  db.chatGroups = db.chatGroups.filter(g => g.id !== id);
  delete db.groupMessages[id];
  res.json({ success: true });
});

// Chat - Messages
app.get('/api/chat/messages/:groupId', (req, res) => {
  const msgs = db.groupMessages[req.params.groupId] || [];
  res.json(msgs);
});
app.post('/api/chat/messages', (req, res) => {
  const { groupId, sender, message, textColor } = req.body;
  if (!db.groupMessages[groupId]) db.groupMessages[groupId] = [];
  const msgObj = {
    id: crypto.randomUUID(),
    sender,
    message,
    textColor: textColor || "#2dd4bf",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  db.groupMessages[groupId].push(msgObj);
  res.json({ success: true, msgObj });
});
app.delete('/api/chat/messages/:groupId/:messageId', (req, res) => {
  if (!requireAdmin(req)) return res.status(403).json({ message: 'Administrator access is required.' });
  const messages = db.groupMessages[req.params.groupId];
  if (!messages) return res.status(404).json({ message: 'Chat group not found.' });
  const previousLength = messages.length;
  db.groupMessages[req.params.groupId] = messages.filter(message => message.id !== req.params.messageId);
  if (db.groupMessages[req.params.groupId].length === previousLength) return res.status(404).json({ message: 'Message not found.' });
  res.json({ success: true });
});

// Chat - Direct
app.get('/api/chat/direct/users', (req, res) => {
  const viewer = findAccountByUsername(req.query.username);
  if (!viewer) return res.status(401).json({ message: 'A valid signed-in account is required.' });
  res.json(db.users.filter(user => canUseDirectChat(viewer, user)).map(safeAccount));
});
app.get('/api/chat/direct/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  const viewer = findAccountByUsername(user1);
  const contact = findAccountByUsername(user2);
  if (!canUseDirectChat(viewer, contact)) return res.status(403).json({ message: 'This private conversation is not available for these accounts.' });
  const msgs = db.directMessages.filter(
    m => (m.sender === user1 && m.recipient === user2) || (m.sender === user2 && m.recipient === user1)
  );
  res.json(msgs);
});
app.post('/api/chat/direct', (req, res) => {
  const { sender, recipient, message, textColor } = req.body;
  const senderAccount = findAccountByUsername(sender);
  const recipientAccount = findAccountByUsername(recipient);
  if (!canUseDirectChat(senderAccount, recipientAccount)) return res.status(403).json({ message: 'You can only message approved contacts at your school.' });
  if (!String(message || '').trim()) return res.status(400).json({ message: 'A message is required.' });
  const msgObj = {
    id: crypto.randomUUID(),
    sender,
    recipient,
    message,
    textColor: textColor || "#2dd4bf",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  db.directMessages.push(msgObj);
  res.json({ success: true, msgObj });
});
app.delete('/api/chat/direct/:messageId', (req, res) => {
  if (!requireAdmin(req)) return res.status(403).json({ message: 'Administrator access is required.' });
  const previousLength = db.directMessages.length;
  db.directMessages = db.directMessages.filter(message => message.id !== req.params.messageId);
  if (db.directMessages.length === previousLength) return res.status(404).json({ message: 'Message not found.' });
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
  const visible = db.broadcasts.filter(item => {
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
  const item = {
    id: Date.now().toString(),
    ...req.body,
    issuedBy: actor.username,
    issuedAt: new Date().toISOString(),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    readBy: []
  };
  db.broadcasts.unshift(item);
  res.json({ success: true, item });
});
app.post('/api/broadcasts/:id/read', (req, res) => {
  const requester = getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to acknowledge an alert.' });
  const item = db.broadcasts.find(entry => entry.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'Alert not found.' });
  if (!item.readBy.includes(requester.username)) item.readBy.push(requester.username);
  res.json({ success: true, readCount: item.readBy.length });
});
app.delete('/api/broadcasts/:id', (req, res) => {
  if (!requireSafetyStaff(req)) return res.status(403).json({ message: 'Only authorised safety staff can remove a broadcast.' });
  db.broadcasts = db.broadcasts.filter(item => item.id !== req.params.id);
  res.json({ success: true });
});

app.get('/api/safety-network', (req, res) => {
  if (!requireSafetyStaff(req)) return res.status(403).json({ message: 'Safety Network is available to authorised school safety staff.' });
  const presentLearners = db.attendance.filter(entry => /present|checked.?in/i.test(String(entry.status || ''))).length;
  const visitorsOnCampus = db.campusVisitors.filter(visitor => visitor.status === 'checked-in');
  const activeBroadcasts = db.broadcasts.filter(broadcast => !broadcast.closedAt);
  res.json({
    presentLearners,
    visitorsOnCampus: visitorsOnCampus.length,
    activeBroadcasts: activeBroadcasts.length,
    acknowledgements: activeBroadcasts.reduce((total, broadcast) => total + (broadcast.readBy?.length || 0), 0),
    visitors: visitorsOnCampus.map(({ passCodeHash, ...visitor }) => visitor)
  });
});

app.get('/api/campus-visitors', (req, res) => {
  if (!requireSafetyStaff(req)) return res.status(403).json({ message: 'Only authorised safety staff can view campus visitors.' });
  res.json(db.campusVisitors.map(({ passCodeHash, ...visitor }) => visitor));
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
    if (user.role === 'parent') return normalizeUsername(meeting.parentUsername) === normalizeUsername(user.username);
    if (user.role === 'teacher') return normalizeUsername(meeting.hostUsername) === normalizeUsername(user.username);
    return normalizeComparableText(meeting.schoolName) === normalizeComparableText(user.schoolName);
  });
  res.json(meetings);
});

app.post('/api/visitor-meetings', (req, res) => {
  const parent = getSessionAccount(req);
  const host = findAccountByUsername(req.body?.hostUsername);
  const proposedAt = String(req.body?.proposedAt || '').trim();
  const purpose = String(req.body?.purpose || '').trim();
  if (!parent || parent.role !== 'parent' || !host || !['teacher', 'principal'].includes(host.role) || !isSameSchool(parent, host) || !proposedAt || !purpose) return res.status(400).json({ message: 'Choose an authorised teacher or principal, a proposed time, and a meeting purpose.' });
  const meeting = { id: crypto.randomUUID(), schoolName: parent.schoolName, parentUsername: parent.username, parentName: parent.name || parent.username, hostUsername: host.username, hostName: host.name || host.username, proposedAt, agreedAt: null, purpose, status: 'awaiting-teacher-response', requestedAt: new Date().toISOString() };
  db.visitorMeetings.unshift(meeting);
  res.status(201).json({ success: true, meeting });
});

app.post('/api/visitor-meetings/:id/respond', (req, res) => {
  const staff = getSessionAccount(req);
  const meeting = db.visitorMeetings.find(entry => entry.id === req.params.id);
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
  const meeting = db.visitorMeetings.find(entry => entry.id === req.params.id);
  if (!parent || !meeting || parent.role !== 'parent' || normalizeUsername(meeting.parentUsername) !== normalizeUsername(parent.username) || meeting.status !== 'awaiting-parent-confirmation') return res.status(403).json({ message: 'This meeting cannot be confirmed by this account.' });
  meeting.status = 'awaiting-principal-approval';
  meeting.parentConfirmedAt = new Date().toISOString();
  res.json({ success: true, meeting });
});

app.post('/api/visitor-meetings/:id/approve-visitor', (req, res) => {
  const principal = getSessionAccount(req);
  const meeting = db.visitorMeetings.find(entry => entry.id === req.params.id);
  if (!principal || !meeting || !['principal', 'admin'].includes(principal.role) || !isSameSchool(principal, meeting) || meeting.status !== 'awaiting-principal-approval') return res.status(403).json({ message: 'Only the principal or administrator can issue visitor authorisation after both parties agree.' });
  const passCode = `LFV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const visitor = { id: crypto.randomUUID(), meetingId: meeting.id, visitorName: meeting.parentName, purpose: meeting.purpose, host: meeting.hostName, expectedDate: meeting.agreedAt, status: 'approved', approvedBy: principal.username, approvedAt: new Date().toISOString(), passCodeHash: hashPin(passCode) };
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
  const visitor = db.campusVisitors.find(entry => entry.status === 'approved' && matchesPin(passCode, entry.passCodeHash));
  if (!visitor) return res.status(404).json({ message: 'Visitor pass not found, already used, or not approved.' });
  visitor.status = 'checked-in';
  visitor.checkedInAt = new Date().toISOString();
  visitor.checkedInBy = actor.username;
  res.json({ success: true, visitor: { ...visitor, passCodeHash: undefined } });
});

app.post('/api/campus-visitors/:id/check-out', (req, res) => {
  const actor = requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Only authorised safety staff can check out a visitor.' });
  const visitor = db.campusVisitors.find(entry => entry.id === req.params.id && entry.status === 'checked-in');
  if (!visitor) return res.status(404).json({ message: 'Checked-in visitor not found.' });
  visitor.status = 'checked-out';
  visitor.checkedOutAt = new Date().toISOString();
  visitor.checkedOutBy = actor.username;
  res.json({ success: true });
});

// Store details belong to the school connected to the signed-in account.
app.get('/api/store', (req, res) => {
  const user = db.users.find(entry => entry.username === req.query.username);
  if (!user) return res.status(404).json({ message: 'School account not found.' });
  res.json({ schoolName: user.schoolName || 'Your school', webStoreUrl: user.schoolStoreUrl || null });
});

// Internal operational records for the advanced workspaces. External providers are configured separately.
app.get('/api/modules/:module', (req, res) => {
  const records = db.moduleRecords[req.params.module];
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  res.json(records);
});
app.post('/api/modules/:module', (req, res) => {
  const records = db.moduleRecords[req.params.module];
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  const record = { id: Date.now().toString(), ...req.body, createdAt: new Date().toLocaleString() };
  records.unshift(record);
  res.json({ success: true, record });
});
app.delete('/api/modules/:module/:id', (req, res) => {
  const records = db.moduleRecords[req.params.module];
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  db.moduleRecords[req.params.module] = records.filter(record => record.id !== req.params.id);
  res.json({ success: true });
});

app.get('/api/registry', (req, res) => res.json(db.registry));
app.post('/api/registry', (req, res) => {
  const required = ['learnerName', 'dateOfBirth', 'guardianName', 'guardianPhone', 'address'];
  if (required.some(field => !String(req.body[field] || '').trim())) return res.status(400).json({ message: 'Complete all required registry fields.' });
  const record = { id: Date.now().toString(), ...req.body, createdAt: new Date().toLocaleString() };
  db.registry.unshift(record);
  res.json({ success: true, record });
});

app.get('/api/consents', (req, res) => res.json(db.consentRecords));
app.post('/api/consents', (req, res) => {
  const { learnerName, guardianName, internalUpdates, marketingPhotos } = req.body;
  if (!learnerName || !guardianName) return res.status(400).json({ message: 'Learner and guardian details are required.' });
  const record = { id: Date.now().toString(), learnerName: String(learnerName), guardianName: String(guardianName), internalUpdates: Boolean(internalUpdates), marketingPhotos: Boolean(marketingPhotos), capturedAt: new Date().toISOString(), version: 'POPIA consent v1' };
  db.consentRecords = db.consentRecords.filter(entry => entry.learnerName.toLowerCase() !== record.learnerName.toLowerCase());
  db.consentRecords.unshift(record);
  res.status(201).json({ success: true, record });
});

app.post('/api/pickups/verify', (req, res) => {
  const { learnerName, pickupAdult, verificationCode, action, recordedBy } = req.body;
  if (!learnerName || !pickupAdult || !verificationCode || !action) return res.status(400).json({ message: 'Learner, pickup adult, verification code, and action are required.' });
  const entry = { id: Date.now().toString(), learnerName: String(learnerName), pickupAdult: String(pickupAdult), verificationCode: hashPin(verificationCode), action: String(action), recordedBy: String(recordedBy || 'Staff'), timestamp: new Date().toISOString() };
  db.pickupLogs.unshift(entry);
  res.status(201).json({ success: true, entry: { ...entry, verificationCode: undefined } });
});
app.get('/api/pickups', (req, res) => res.json(db.pickupLogs.map(({ verificationCode, ...entry }) => entry)));

app.get('/api/release-notes', (req, res) => res.json(db.releaseNotes));

app.post('/api/report-signing-pin', (req, res) => {
  const { username, pin } = req.body;
  const user = findAccountByUsername(username);
  if (!user || !pin || String(pin).length < 4) return res.status(400).json({ message: 'Choose a signing PIN with at least 4 characters.' });
  user.reportSigningPinHash = hashPin(pin);
  res.json({ success: true });
});

app.get('/api/report-reviews', (req, res) => {
  const username = String(req.query.username || '');
  const user = findAccountByUsername(username);
  if (!user) return res.status(401).json({ message: 'Sign in to view reports.' });
  const reports = user.role === 'parent'
    ? db.reportReviews.filter(report => normalizeUsername(report.parentUsername) === normalizeUsername(user.username))
    : db.reportReviews;
  res.json(reports);
});
app.post('/api/report-reviews', (req, res) => {
  const { studentName, reportTitle, period, teacherUsername, parentUsername, signatureData, signingPin } = req.body;
  const teacher = findAccountByUsername(teacherUsername);
  const parent = findAccountByUsername(parentUsername);
  if (!teacher || !teacher.reportSigningPinHash || !matchesPin(signingPin, teacher.reportSigningPinHash)) return res.status(403).json({ message: 'Set and enter your teacher signing PIN before publishing a report.' });
  if (!['teacher', 'principal', 'admin'].includes(teacher.role) || !parent || parent.role !== 'parent') return res.status(400).json({ message: 'Choose an authorised teacher and a linked parent account.' });
  if (!studentName || !reportTitle || !period || !parentUsername || !signatureData) return res.status(400).json({ message: 'Complete the report details and teacher signature.' });
  const report = { id: Date.now().toString(), studentName: String(studentName), reportTitle: String(reportTitle), period: String(period), teacherUsername: teacher.username, parentUsername: parent.username, teacherSignature: signatureData, teacherSignedAt: new Date().toISOString(), parentSignature: null, parentSignedAt: null, status: 'Awaiting parent signature', createdAt: new Date().toISOString() };
  db.reportReviews.unshift(report);
  res.status(201).json({ success: true, report });
});
app.post('/api/report-reviews/:id/sign', (req, res) => {
  const { username, signatureData, signingPin } = req.body;
  const report = db.reportReviews.find(entry => entry.id === req.params.id);
  const user = findAccountByUsername(username);
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

const learnerAccessCodeView = (learner) => {
  const key = learnerRecordKey(learner);
  const activeCode = db.learnerAccessCodes.find(entry => entry.learnerKey === key && entry.status === 'active');
  return {
    learnerKey: key,
    learnerName: learner.studentName,
    className: learner.className,
    parentName: learner.parentName || '',
    contactEmail: learner.contactEmail || '',
    codeRecordId: activeCode?.id || null,
    accessCode: activeCode ? decryptField(activeCode.codeEncrypted) : null,
    issuedAt: activeCode?.issuedAt || null,
    issuedBy: activeCode?.issuedBy || null
  };
};

app.get('/api/learner-access-codes', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator may manage codes, and a principal may print them.' });
  res.json(db.students.map(learnerAccessCodeView));
});

app.post('/api/learner-access-codes', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor || actor.role !== 'admin') return res.status(403).json({ message: 'Only an administrator can issue learner access codes.' });
  const learner = db.students.find(entry => learnerRecordKey(entry) === String(req.body?.learnerKey || ''));
  if (!learner) return res.status(404).json({ message: 'Learner record not found.' });
  const learnerKey = learnerRecordKey(learner);
  if (db.learnerAccessCodes.some(entry => entry.learnerKey === learnerKey && entry.status === 'active')) return res.status(409).json({ message: 'This learner already has an active code. Replace it instead.' });
  let accessCode = normaliseAccessCode(req.body?.manualCode);
  if (accessCode && !/^LF-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(accessCode)) return res.status(400).json({ message: 'Use the format LF-AB12-CD34, or leave the field blank to generate a code.' });
  const codeInUse = (candidate) => db.learnerAccessCodes.some(entry => entry.status === 'active' && decryptField(entry.codeEncrypted) === candidate);
  if (accessCode && codeInUse(accessCode)) return res.status(409).json({ message: 'That access code is already in use. Choose another code or generate one.' });
  while (!accessCode || codeInUse(accessCode)) accessCode = generateLearnerAccessCode();
  const record = { id: crypto.randomUUID(), learnerKey, codeEncrypted: encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username };
  db.learnerAccessCodes.unshift(record);
  res.status(201).json({ success: true, learner: learnerAccessCodeView(learner) });
});

app.post('/api/learner-access-codes/:id/replace', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor || actor.role !== 'admin') return res.status(403).json({ message: 'Only an administrator can replace learner access codes.' });
  const previous = db.learnerAccessCodes.find(entry => entry.id === req.params.id && entry.status === 'active');
  if (!previous) return res.status(404).json({ message: 'The active code was not found.' });
  previous.status = 'replaced';
  previous.replacedAt = new Date().toISOString();
  previous.replacedBy = actor.username;
  let accessCode;
  do { accessCode = generateLearnerAccessCode(); } while (db.learnerAccessCodes.some(entry => entry.status === 'active' && decryptField(entry.codeEncrypted) === accessCode));
  db.learnerAccessCodes.unshift({ id: crypto.randomUUID(), learnerKey: previous.learnerKey, codeEncrypted: encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username, replaces: previous.id });
  const learner = db.students.find(entry => learnerRecordKey(entry) === previous.learnerKey);
  res.json({ success: true, learner: learner ? learnerAccessCodeView(learner) : null });
});

app.post('/api/learner-access-codes/:id/revoke', (req, res) => {
  const actor = findLearnerAccessCodeActor(req);
  if (!actor || actor.role !== 'admin') return res.status(403).json({ message: 'Only an administrator can invalidate learner access codes.' });
  const record = db.learnerAccessCodes.find(entry => entry.id === req.params.id && entry.status === 'active');
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
  const codeRecord = db.learnerAccessCodes.find(entry => entry.status === 'active' && decryptField(entry.codeEncrypted) === suppliedCode);
  if (!codeRecord) return res.status(404).json({ message: 'That learner access code is invalid, has already been used, or has been replaced. Ask the school administrator for a new form.' });
  const learner = db.students.find(entry => learnerRecordKey(entry) === codeRecord.learnerKey);
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
  const requester = findAccountByUsername(req.query.username);
  if (!requester) return res.status(401).json({ message: 'Sign in to search learner records.' });
  let results = db.students;
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
  const parent = findAccountByUsername(req.query.username);
  if (!parent || parent.role !== 'parent') return res.status(403).json({ message: 'Only parent accounts can view linked learner records.' });
  res.json(db.students.filter(student => isParentLinkedToLearner(parent, student)).map(student => ({ ...student, medicalNotes: decryptField(student.medicalNotes), emergencyContact: decryptField(student.emergencyContact), authorisedPickups: decryptField(student.authorisedPickups) })));
});

// Secure bulk learner import. The browser previews spreadsheet rows first; this
// endpoint applies the authoritative duplicate check and encrypts sensitive fields.
app.post('/api/students/import', (req, res) => {
  const actor = findAccountByUsername(req.body?.actorUsername);
  if (!actor || !['admin', 'principal'].includes(actor.role)) return res.status(403).json({ message: 'Only an administrator or principal may import learner records.' });
  const incoming = Array.isArray(req.body?.students) ? req.body.students : [];
  if (!incoming.length) return res.status(400).json({ message: 'No learner records were supplied.' });
  if (incoming.length > 1000) return res.status(400).json({ message: 'Import up to 1,000 learner records at a time.' });

  const recordKey = (student) => [student.studentName, student.className, student.contactEmail].map(normalizeComparableText).join('|');
  const knownRecords = new Set(db.students.map(recordKey));
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
    db.students.push({
      studentName,
      className,
      parentName,
      contactEmail,
      medicalNotes: encryptField(String(row?.medicalNotes || '').trim()),
      emergencyContact: encryptField(String(row?.emergencyContact || '').trim()),
      authorisedPickups: encryptField(String(row?.authorisedPickups || '').trim()),
      importedAt: new Date().toISOString(),
      importedBy: actor.username
    });
    imported += 1;
  });

  db.importAudit.unshift({ id: crypto.randomUUID(), importedAt: new Date().toISOString(), importedBy: actor.username, imported, rejected: rejected.length });
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
