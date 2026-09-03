const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
const schoolSearchCache = new Map();
const loginAttempts = new Map();
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
let activeRequestCount = 0;
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
const normaliseLearnerLinks = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(normalizeComparableText).filter(Boolean))];
const validateLearnerLinks = (value) => {
  const links = normaliseLearnerLinks(value);
  return links.length <= 4 ? { links } : { error: 'A parent account can be linked to a maximum of four learners.' };
};
const isParentLinkedToLearner = (parent, learner) => {
  if (!parent || !learner) return false;
  return normalizeUsername(learner.contactEmail) === normalizeUsername(parent.username)
    || normaliseLearnerLinks(parent.linkedLearners).includes(normalizeComparableText(learner.studentName));
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
app.use((req, res, next) => {
  activeRequestCount += 1;
  res.on('finish', () => {
    activeRequestCount = Math.max(0, activeRequestCount - 1);
    if (!req.method || req.method === 'GET' || replicaMode) return;
    scheduleReplicaSnapshot();
  });
  next();
});

// Serve static files from current directory
app.use(express.static(__dirname));

// In-Memory Database Store
const db = {
  term: "Academic Term 3: Active Session | Campus Hours: 07:00 - 17:30 SAST",
  users: [
    { username: "admin@gmail.com", pin: "Test", role: "admin", name: "System Admin", schoolName: "Little Feet ECD Portal", schoolStoreUrl: "" },
    { username: "Teacher@gmail.com", pin: "Test", role: "teacher", name: "Sarah Educator", schoolName: "Little Feet ECD Portal", schoolStoreUrl: "" },
    { username: "Parent@gmail.com", pin: "Test", role: "parent", name: "John Parent", schoolName: "Little Feet ECD Portal", schoolStoreUrl: "", subscription: "plus" },
    { username: "Principle@gmail.com", pin: "Test", role: "principal", name: "Maya Principal", schoolName: "Little Feet ECD Portal", schoolStoreUrl: "" },
    { username: "District@gmail.com", pin: "Test", role: "district", name: "District Officer", schoolName: "Little Feet ECD Portal", schoolStoreUrl: "" }
  ].map(user => ({ ...user, pinHash: hashPin(user.pin), pin: undefined })),
  posts: [
    {
      id: "1",
      audience: "All",
      caption: "Welcome to our updated Little Feet ECD & High School Learning Portal!",
      mediaUrl: null,
      createdAt: "Today at 08:00 AM"
    }
  ],
  schedules: [],
  worksheets: [],
  badges: [],
  tickets: [],
  attendance: [],
  broadcasts: [],
  registry: [],
  moduleRecords: { finance: [], operations: [], care: [], engagement: [], dailyCare: [], portfolio: [], supplies: [], stock: [], reports: [], safeguarding: [] },
  consentRecords: [],
  pickupLogs: [],
  reportReviews: [],
  releaseNotes: [
    { id: '2026-08-safeguarding', version: '2.8', title: 'Safeguarding and family records', summary: 'Added consent, pickup audit, staff verification, parent report review, and digital signing controls.', publishedAt: '2026-08-28T08:00:00.000Z' },
    { id: '2026-08-workflows', version: '2.7', title: 'Daily classroom workflows', summary: 'Added care logging, progress records, stock intake, and spreadsheet templates.', publishedAt: '2026-08-27T08:00:00.000Z' }
  ],
  chatGroups: [
    { id: "general", groupName: "General Staff Lounge" },
    { id: "toddlers", groupName: "Toddler Educators" }
  ],
  groupMessages: {
    general: [
      { sender: "System Administrator", message: "Welcome to the internal group channel.", timestamp: "07:00 AM", textColor: "#2dd4bf" }
    ]
  },
  directMessages: [],
  importAudit: [],
  students: [
    { studentName: "Liam Smith", className: "Preschool", parentName: "John Parent", contactEmail: "Parent@gmail.com", medicalNotes: encryptField("Peanut Allergy"), emergencyContact: encryptField("John Parent · 071 000 0000"), authorisedPickups: encryptField("John Parent, Sam Smith") },
    { studentName: "Emma Watson", className: "Toddlers", parentName: "Sarah Educator", contactEmail: "Teacher@gmail.com", medicalNotes: encryptField("None"), emergencyContact: encryptField("Sarah Educator · 072 000 0000"), authorisedPickups: encryptField("Sarah Educator") }
  ]
};

// Local standby replication. The primary snapshots app data after writes; a
// backup process reads the latest snapshot so it can be promoted if required.
const replicaMode = process.env.LF_REPLICA_MODE === '1';
const replicaFile = path.join(__dirname, 'littlefeet-replica.json');
let replicaTimer = null;
let replicaSnapshotTimer = null;
function loadReplicaSnapshot() {
  try {
    if (!fs.existsSync(replicaFile)) return;
    const saved = JSON.parse(fs.readFileSync(replicaFile, 'utf8'));
    Object.keys(db).forEach(key => { if (Object.hasOwn(saved, key)) db[key] = saved[key]; });
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
function scheduleReplicaSnapshot() {
  if (replicaMode || replicaSnapshotTimer) return;
  replicaSnapshotTimer = setTimeout(() => {
    replicaSnapshotTimer = null;
    writeReplicaSnapshot();
  }, 250);
}
loadReplicaSnapshot();
if (replicaMode) {
  replicaTimer = setInterval(loadReplicaSnapshot, 2000);
} else {
  writeReplicaSnapshot();
}

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
    res.json({ user: safeUser });
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
  const verifiedLinks = requestedLinks.filter(link => db.students.some(student => normalizeComparableText(student.studentName) === link && normalizeComparableText(student.parentName) === normalizeComparableText(name)));
  const account = { username: String(username).trim(), pinHash: hashPin(pin), name: String(name).trim(), role, schoolName: String(schoolName).trim(), schoolStoreUrl: '', linkedLearners: verifiedLinks, subscription: role === 'parent' ? 'basic' : 'school', verificationStatus: role === 'parent' ? 'Active' : 'Self-registered — school verification pending', termsAcceptedAt: new Date().toISOString(), termsVersion: '2026-08' };
  db.users.push(account);
  const { pin: _pin, pinHash: _pinHash, ...safeAccount } = account;
  res.status(201).json({ success: true, account: safeAccount });
});

const safeAccount = ({ pin, pinHash, ...account }) => account;
const requireAdmin = (username) => {
  const account = findAccountByUsername(username);
  return account?.role === 'admin' ? account : null;
};
app.get('/api/accounts', (req, res) => {
  if (!requireAdmin(req.query.actorUsername)) return res.status(403).json({ message: 'Administrator access is required.' });
  res.json(db.users.map(safeAccount));
});
app.post('/api/accounts', (req, res) => {
  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, actorUsername } = req.body;
  if (!requireAdmin(actorUsername)) return res.status(403).json({ message: 'Administrator access is required.' });
  const allowedRoles = ['parent', 'teacher', 'principal', 'district', 'admin'];
  if (!username || !pin || !name || !schoolName || !allowedRoles.includes(role)) return res.status(400).json({ message: 'Name, username, password, role, and school name are required.' });
  if (db.users.some(account => accountMatchesUsername(account, username))) return res.status(409).json({ message: 'That username is already in use.' });
  const linkValidation = role === 'parent' ? validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const account = { username: String(username).trim(), pinHash: hashPin(pin), name: String(name).trim(), role, schoolName: String(schoolName).trim(), schoolStoreUrl: String(schoolStoreUrl || '').trim(), linkedLearners: linkValidation.links };
  db.users.push(account);
  res.status(201).json({ success: true, account: safeAccount(account) });
});
app.put('/api/accounts/:username', (req, res) => {
  if (!requireAdmin(req.body.actorUsername)) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = db.users.find(entry => entry.username === req.params.username);
  if (!account) return res.status(404).json({ message: 'Account not found.' });
  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners } = req.body;
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
  res.json({ success: true, account: safeAccount(account) });
});
app.delete('/api/accounts/:username', (req, res) => {
  if (!requireAdmin(req.body?.actorUsername)) return res.status(403).json({ message: 'Administrator access is required.' });
  if (normalizeUsername(req.params.username) === 'admin@gmail.com') return res.status(400).json({ message: 'The primary system admin cannot be deleted.' });
  const previousLength = db.users.length;
  db.users = db.users.filter(account => account.username !== req.params.username);
  if (db.users.length === previousLength) return res.status(404).json({ message: 'Account not found.' });
  res.json({ success: true });
});
app.post('/api/accounts/:username/approve', (req, res) => {
  if (!requireAdmin(req.body?.actorUsername)) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = findAccountByUsername(req.params.username);
  if (!account) return res.status(404).json({ message: 'Account not found.' });
  account.verificationStatus = 'Active';
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
  const query = `[out:json][timeout:12];nwr[\"amenity\"~\"^(school|kindergarten|childcare|college|university)$\"][\"name\"](${south},${west},${north},${east});out center tags;`;

  try {
    const overpassServices = [
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass.nchc.org.tw/api/interpreter'
    ];
    // Public providers vary in availability. Use the first successful response
    // rather than making the user wait for a slow service to time out.
    const response = await Promise.any(overpassServices.map(async serviceUrl => {
      const candidate = await fetch(serviceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'LittleFeetSchoolFinder/1.0' },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(12000)
      });
      if (!candidate.ok) throw new Error(`${new URL(serviceUrl).host} returned ${candidate.status}`);
      return candidate;
    }));

    const payload = await response.json();
    const data = { elements: Array.isArray(payload.elements) ? payload.elements : [], source: 'OpenStreetMap' };
    schoolSearchCache.set(cacheKey, { createdAt: Date.now(), data });
    res.json(data);
  } catch (error) {
    console.error('Nearby school search failed:', error.message);
    res.status(502).json({ message: 'Live school data is temporarily unavailable. Please try again shortly.' });
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
  res.json(db.tickets);
});
app.post('/api/tickets', (req, res) => {
  const item = { ...req.body, status: "Open", monthCategory: "August 2026" };
  db.tickets.unshift(item);
  res.json({ success: true, item });
});
app.post('/api/tickets/update', (req, res) => {
  const { id, status, feedback, updatedBy } = req.body;
  const ticket = db.tickets.find(t => t.id === id);
  if (ticket) {
    if (status) ticket.status = status;
    if (feedback !== undefined) ticket.feedback = feedback;
    if (updatedBy) ticket.updatedBy = updatedBy;
  }
  res.json({ success: true });
});
app.delete('/api/tickets/:id', (req, res) => {
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
    sender,
    message,
    textColor: textColor || "#2dd4bf",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  db.groupMessages[groupId].push(msgObj);
  res.json({ success: true, msgObj });
});

// Chat - Direct
app.get('/api/chat/direct/users', (req, res) => {
  res.json(db.users);
});
app.get('/api/chat/direct/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  const msgs = db.directMessages.filter(
    m => (m.sender === user1 && m.recipient === user2) || (m.sender === user2 && m.recipient === user1)
  );
  res.json(msgs);
});
app.post('/api/chat/direct', (req, res) => {
  const { sender, recipient, message, textColor } = req.body;
  const msgObj = {
    sender,
    recipient,
    message,
    textColor: textColor || "#2dd4bf",
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  db.directMessages.push(msgObj);
  res.json({ success: true, msgObj });
});

// Emergency Broadcasts
app.get('/api/broadcasts', (req, res) => {
  res.json(db.broadcasts);
});
app.post('/api/broadcasts', (req, res) => {
  const item = {
    id: Date.now().toString(),
    ...req.body,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    readBy: []
  };
  db.broadcasts.unshift(item);
  res.json({ success: true, item });
});
app.post('/api/broadcasts/:id/read', (req, res) => {
  const item = db.broadcasts.find(entry => entry.id === req.params.id);
  if (!item) return res.status(404).json({ message: 'Alert not found.' });
  const username = String(req.body.username || '').trim();
  if (username && !item.readBy.includes(username)) item.readBy.push(username);
  res.json({ success: true, readCount: item.readBy.length });
});
app.delete('/api/broadcasts/:id', (req, res) => {
  db.broadcasts = db.broadcasts.filter(item => item.id !== req.params.id);
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

// Fallback to index.html. Express 5 requires a named wildcard parameter.
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
