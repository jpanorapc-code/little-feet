const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'adversarial-entrypoints-'));
const port = 6800 + Math.floor(Math.random() * 200);
const origin = 'http://127.0.0.1:' + port;
const hash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');

for (const file of ['server.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js', 'manifest.webmanifest', 'service-worker.js']) {
  fs.copyFileSync(path.join(root, file), path.join(temp, file));
}

fs.mkdirSync(path.join(temp, 'output', 'pdf'), { recursive: true });
fs.writeFileSync(path.join(temp, 'output', 'pdf', 'LittleFeet_User_Manual_2026_Updated.pdf'), '%PDF-1.4\npublic-test-document\n');
fs.writeFileSync(path.join(temp, 'output', 'pdf', 'secret-export.pdf'), '%PDF-1.4\nprivate-test-document\n');

const student = {
  id: 'alpha-student-1',
  studentName: 'Alpha Learner',
  className: 'Grade 1',
  parentName: 'Alpha Parent',
  contactEmail: 'alpha-parent@example.test',
  schoolId: 'school-alpha',
  schoolName: 'Alpha School'
};

fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [
    { id: 'school-alpha', name: 'Alpha School', status: 'active' },
    { id: 'school-bravo', name: 'Bravo School', status: 'active' }
  ],
  users: [
    { username: 'alpha-admin', pinHash: hash('AdminPass1'), name: 'Alpha Admin', role: 'admin', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
    { username: 'alpha-principal', pinHash: hash('PrincipalPass1'), name: 'Alpha Principal', role: 'principal', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
    { username: 'alpha-teacher', pinHash: hash('TeacherPass1'), name: 'Alpha Teacher', role: 'teacher', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active', assignedClasses: ['Grade 1'] },
    { username: 'alpha-parent@example.test', pinHash: hash('ParentPass1'), name: 'Alpha Parent', role: 'parent', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active', parentRelationshipStatus: 'Administrator approved', linkedLearners: ['Alpha Learner'] },
    { username: 'bravo-admin', pinHash: hash('BravoAdmin1'), name: 'Bravo Admin', role: 'admin', schoolId: 'school-bravo', schoolName: 'Bravo School', verificationStatus: 'Active' },
    { username: 'rate-target', loginAliases: ['rate-target-alias'], pinHash: hash('TargetPass1'), name: 'Rate Target', role: 'teacher', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active', assignedClasses: ['Grade 1'] }
  ],
  students: [student],
  posts: [],
  moduleRecords: { finance: [], operations: [], care: [], engagement: [], dailyCare: [], portfolio: [], curriculum: [], supplies: [], stock: [], reports: [], safeguarding: [], absences: [], handovers: [], stickyNotes: [] },
  learnerAccessCodes: [],
  parentPayments: [{
    id: 'payment-webhook-target',
    reference: 'LF-WEBHOOK-TEST',
    parentUsername: 'alpha-parent@example.test',
    parentName: 'Alpha Parent',
    learnerName: 'Alpha Learner',
    description: 'Webhook target',
    amountDue: 100,
    dueDate: '2026-09-01',
    arrangementDueDate: '',
    arrangementAmount: null,
    arrangementNote: '',
    parentSignature: '',
    parentSignedAt: '',
    paymentStatus: 'awaiting_payment',
    createdAt: '2026-09-01T08:00:00.000Z',
    createdBy: 'alpha-admin',
    schoolId: 'school-alpha',
    schoolName: 'Alpha School'
  }],
  paymentEvents: [],
  paymentLedger: [],
  schoolBilling: {},
  directMessages: [],
  chatGroups: [],
  groupMessages: {}
}));

const child = spawn(process.execPath, ['server.js'], {
  cwd: temp,
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
    LF_REPLICA_MODE: '1',
    LF_TEST_ALLOW_REPLICA_WRITES: '1',
    LF_TEST_ENFORCE_ORIGIN: '1',
    LF_MAX_API_BODY_MB: '1',
    SESSION_SECRET: 'adversarial-session-secret',
    LF_FIELD_ENCRYPTION_KEY: 'adversarial-field-key',
    LF_PAYMENT_WEBHOOK_SECRET: 'adversarial-webhook-secret'
  },
  stdio: ['ignore', 'ignore', 'pipe']
});

let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const stop = () => new Promise(resolve => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});

const request = async (route, { method = 'GET', body, cookie, originHeader, headers = {} } = {}) => {
  const requestHeaders = { ...headers };
  if (body !== undefined && !requestHeaders['content-type']) requestHeaders['content-type'] = 'application/json';
  if (cookie) requestHeaders.cookie = cookie;
  if (originHeader) requestHeaders.origin = originHeader;
  const response = await fetch(origin + route, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return {
    response,
    data,
    text,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie
  };
};

const rawPathRequest = route => new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port, path: route, method: 'GET' }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
  });
  req.on('error', reject);
  req.end();
});

const login = async (username, pin, suppliedCookie = '') => {
  const result = await request('/api/login', {
    method: 'POST',
    body: { username, pin },
    headers: suppliedCookie ? { cookie: suppliedCookie } : {}
  });
  assert.equal(result.response.status, 200, 'Login failed for ' + username + ': ' + result.text);
  return result;
};

(async () => {
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const health = await fetch(origin + '/api/health');
        if (health.ok) break;
      } catch {}
      await wait(100);
      if (attempt === 119) throw new Error('Adversarial test server did not start. ' + stderr);
    }

    // 1. Static-file and path traversal attacks.
    for (const route of [
      '/.env',
      '/server.js',
      '/backup-server.js',
      '/package.json',
      '/littlefeet.db',
      '/littlefeet-replica.json',
      '/tests/security-regression.test.js',
      '/tmp/anything',
      '/uploads/anything',
      '/output/pdf/secret-export.pdf',
      '/output/pdf/%2e%2e%2fserver.js',
      '/output/pdf/%252e%252e%252fserver.js',
      '/output/pdf/LittleFeet_User_Manual_2026_Updated.pdf%00.js',
      '/output/%2e%2e/server.js',
      '/output/pdf/%2e%2e/%2e%2e/server.js',
      '/vendor/server.js',
      '/vendor/%2e%2e%2fserver.js',
      '/%2e%2e/server.js',
      '/.%2e/%2e%2e/server.js'
    ]) {
      const result = await rawPathRequest(route);
      assert.equal(result.status, 404, 'Sensitive/static traversal route leaked: ' + route + ' -> ' + result.status);
      assert.doesNotMatch(result.body, /const express = require|DATABASE_URL|SESSION_SECRET|pinHash/i);
    }

    const allowedPublicDocument = await rawPathRequest('/output/pdf/LittleFeet_User_Manual_2026_Updated.pdf');
    assert.equal(allowedPublicDocument.status, 200, 'Allowlisted public manual must remain available.');
    assert.match(allowedPublicDocument.headers['content-type'] || '', /application\/pdf/);

    // 2. Parser attacks: malformed and oversized JSON must fail closed.
    const malformed = await request('/api/signup', {
      method: 'POST',
      body: '{"username":',
      headers: { 'content-type': 'application/json' }
    });
    assert.ok([400, 422].includes(malformed.response.status), 'Malformed JSON was not rejected.');

    const oversize = await request('/api/signup', {
      method: 'POST',
      body: JSON.stringify({ username: 'x'.repeat(1100000) }),
      headers: { 'content-type': 'application/json' }
    });
    assert.equal(oversize.response.status, 413, 'Oversized API body was not rejected.');

    const wrongContentType = await request('/api/login', {
      method: 'POST',
      body: 'username=alpha-admin&pin=AdminPass1',
      headers: { 'content-type': 'text/plain' }
    });
    assert.equal(wrongContentType.response.status, 415, 'Unsupported API content type did not fail closed.');

    const fakeMultipart = await request('/api/login', {
      method: 'POST',
      body: '--attack-boundary\r\nContent-Disposition: form-data; name="username"\r\n\r\nalpha-admin\r\n--attack-boundary--',
      headers: { 'content-type': 'multipart/form-data; boundary=attack-boundary' }
    });
    assert.equal(fakeMultipart.response.status, 415, 'Unexpected multipart API body did not fail closed.');

    const deepPayload = '{"payload":' + '['.repeat(12000) + '"safe"' + ']'.repeat(12000) + '}';
    const deepRequest = await request('/api/signup', {
      method: 'POST',
      body: deepPayload,
      headers: { 'content-type': 'application/json' }
    });
    assert.notEqual(deepRequest.response.status, 500, 'Deep JSON caused an internal server error.');

    let nestedPayload = { leaf: 'safe' };
    for (let depth = 0; depth < 70; depth += 1) nestedPayload = { child: nestedPayload };
    const nestedRequest = await request('/api/signup', {
      method: 'POST',
      body: { username: 'nested@example.test', pin: 'Password1', name: 'Nested', role: 'parent', schoolName: 'Alpha School', termsAccepted: true, nestedPayload }
    });
    assert.equal(nestedRequest.response.status, 400, 'Payload nesting above the structural limit was accepted.');

    const widePayload = Object.fromEntries(Array.from({ length: 5001 }, (_, index) => ['field' + index, index]));
    const wideRequest = await request('/api/signup', {
      method: 'POST',
      body: { username: 'wide@example.test', pin: 'Password1', name: 'Wide', role: 'parent', schoolName: 'Alpha School', termsAccepted: true, widePayload }
    });
    assert.equal(wideRequest.response.status, 400, 'Payload node-count limit was bypassed.');
    const healthAfterParserAttacks = await request('/api/health');
    assert.equal(healthAfterParserAttacks.response.status, 200, 'Parser attacks destabilised the server.');

    // 3. Authentication injection and privilege escalation.
    const injection = await request('/api/login', {
      method: 'POST',
      body: { username: "' OR 1=1 --", pin: "' OR 1=1 --" }
    });
    assert.equal(injection.response.status, 401);

    const oversizedLoginUsername = await request('/api/login', {
      method: 'POST',
      body: { username: 'u'.repeat(5000), pin: 'WrongPass1' }
    });
    assert.equal(oversizedLoginUsername.response.status, 401);
    const oversizedLoginPin = await request('/api/login', {
      method: 'POST',
      body: { username: 'alpha-admin', pin: 'p'.repeat(5000) }
    });
    assert.equal(oversizedLoginPin.response.status, 401);

    const elevatedSignup = await request('/api/signup', {
      method: 'POST',
      body: { username: 'evil-admin', pin: 'Password1', name: 'Evil', role: 'admin', schoolName: 'Alpha School', termsAccepted: true }
    });
    assert.equal(elevatedSignup.response.status, 400);

    let distributedAttempt;
    for (let index = 1; index <= 21; index += 1) {
      distributedAttempt = await request('/api/login', {
        method: 'POST',
        body: { username: index % 2 ? ' RATE-TARGET ' : 'rate-target-alias', pin: 'WrongPass' + index },
        headers: { 'x-forwarded-for': '203.0.113.' + index }
      });
    }
    assert.equal(distributedAttempt.response.status, 429, 'Changing source IPs plus rotating a login alias bypassed the account-level spray defense.');

    // 4. Session fixation: an attacker-supplied cookie must not survive successful login.
    const fixedCookie = 'connect.sid=s%3Aattacker-fixed-session.fake';
    const alphaAdmin = await login('alpha-admin', 'AdminPass1', fixedCookie);
    assert.ok(alphaAdmin.cookie && !alphaAdmin.cookie.includes('attacker-fixed-session'), 'Session fixation cookie survived login regeneration.');
    const alphaTeacher = await login('alpha-teacher', 'TeacherPass1');
    const alphaPrincipal = await login('alpha-principal', 'PrincipalPass1');
    const alphaParent = await login('alpha-parent@example.test', 'ParentPass1');
    const bravoAdmin = await login('bravo-admin', 'BravoAdmin1');

    // Expensive-secret and sensitive-record fields must fail before hashing/encryption/storage.
    const oversizedReportPin = await request('/api/report-signing-pin', {
      method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
      body: { pin: '9'.repeat(5000) }
    });
    assert.equal(oversizedReportPin.response.status, 400);
    const validReportPin = await request('/api/report-signing-pin', {
      method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
      body: { pin: 'TeacherSign1' }
    });
    assert.equal(validReportPin.response.status, 200);
    const oversizedReportAttempt = await request('/api/report-reviews', {
      method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
      body: {
        studentName: 'Alpha Learner',
        reportTitle: 'Term report',
        period: 'Term 3',
        parentUsername: 'alpha-parent@example.test',
        signingPin: 'x'.repeat(5000),
        signatureData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      }
    });
    assert.equal(oversizedReportAttempt.response.status, 403);

    const oversizedPickupCode = await request('/api/pickups/verify', {
      method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
      body: { learnerName: 'Alpha Learner', pickupAdult: 'Alpha Parent', verificationCode: '7'.repeat(5000), action: 'Pickup / release' }
    });
    assert.equal(oversizedPickupCode.response.status, 400);
    const invalidPickupAction = await request('/api/pickups/verify', {
      method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
      body: { learnerName: 'Alpha Learner', pickupAdult: 'Alpha Parent', verificationCode: '1234', action: 'Override security' }
    });
    assert.equal(invalidPickupAction.response.status, 400);

    const oversizedRegistry = await request('/api/registry', {
      method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
      body: {
        learnerName: 'Alpha Learner', className: 'Grade 1', dateOfBirth: '2019-01-01',
        guardianName: 'G'.repeat(161), guardianPhone: '0123456789', guardianEmail: 'alpha-parent@example.test',
        address: 'Pretoria', emergencyContact: '', medicalNotes: '', consent: 'Pending verification'
      }
    });
    assert.equal(oversizedRegistry.response.status, 400);
    const futureRegistryDob = await request('/api/registry', {
      method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
      body: {
        learnerName: 'Alpha Learner', className: 'Grade 1', dateOfBirth: '2999-01-01',
        guardianName: 'Alpha Parent', guardianPhone: '0123456789', guardianEmail: 'alpha-parent@example.test',
        address: 'Pretoria', emergencyContact: '', medicalNotes: '', consent: 'Pending verification'
      }
    });
    assert.equal(futureRegistryDob.response.status, 400);

    const oversizedConsent = await request('/api/consents', {
      method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
      body: { learnerName: 'L'.repeat(161), guardianName: 'Alpha Parent', internalUpdates: true, marketingPhotos: false }
    });
    assert.equal(oversizedConsent.response.status, 400);

    const oversizedMeeting = await request('/api/visitor-meetings', {
      method: 'POST', cookie: alphaParent.cookie, originHeader: origin,
      body: { hostUsername: 'alpha-teacher', proposedAt: '2026-10-01T10:00', purpose: 'P'.repeat(1201) }
    });
    assert.equal(oversizedMeeting.response.status, 400);

    const malformedVisitorPass = await request('/api/campus-visitors/check-in', {
      method: 'POST', cookie: alphaPrincipal.cookie, originHeader: origin,
      body: { passCode: 'LFV-' + 'A'.repeat(5000) }
    });
    assert.equal(malformedVisitorPass.response.status, 404);

    // 5. Same-origin mutation enforcement.
    const crossOrigin = await request('/api/modules/operations', {
      method: 'POST',
      cookie: alphaTeacher.cookie,
      originHeader: 'https://evil.example',
      body: { type: 'Attack', details: 'Cross-site write attempt' }
    });
    assert.equal(crossOrigin.response.status, 403);

    const missingOrigin = await request('/api/modules/operations', {
      method: 'POST',
      cookie: alphaTeacher.cookie,
      body: { type: 'Attack', details: 'Missing origin write attempt' }
    });
    assert.equal(missingOrigin.response.status, 403);

    const crossSiteReferer = await request('/api/modules/operations', {
      method: 'POST',
      cookie: alphaTeacher.cookie,
      headers: { referer: 'https://evil.example/attack' },
      body: { type: 'Attack', details: 'Cross-site Referer write attempt' }
    });
    assert.equal(crossSiteReferer.response.status, 403);

    const sameSiteReferer = await request('/api/modules/operations', {
      method: 'POST',
      cookie: alphaTeacher.cookie,
      headers: { referer: origin + '/dashboard' },
      body: { type: 'Routine check', details: 'Legitimate same-origin Referer write' }
    });
    assert.equal(sameSiteReferer.response.status, 200);

    const sameOrigin = await request('/api/modules/operations', {
      method: 'POST',
      cookie: alphaTeacher.cookie,
      originHeader: origin,
      body: { type: 'Routine check', details: 'Legitimate same-origin write' }
    });
    assert.equal(sameOrigin.response.status, 200);

    // 6. Prototype/module-name abuse must not reach inherited object properties.
    for (const moduleName of ['__proto__', 'constructor', 'prototype', 'toString']) {
      const read = await request('/api/modules/' + encodeURIComponent(moduleName), { cookie: alphaAdmin.cookie });
      assert.equal(read.response.status, 404, 'Inherited module name was reachable: ' + moduleName);
      const write = await request('/api/modules/' + encodeURIComponent(moduleName), {
        method: 'POST', cookie: alphaAdmin.cookie, originHeader: origin,
        body: { type: 'Attack', details: 'Prototype route probe' }
      });
      assert.equal(write.response.status, 404, 'Inherited module name accepted a write: ' + moduleName);
    }

    // 7. Tenant IDOR: Bravo must not delete Alpha records by guessing IDs.
    const alphaPost = await request('/api/posts', {
      method: 'POST',
      cookie: alphaTeacher.cookie,
      originHeader: origin,
      body: { audience: 'Foundation', caption: 'Alpha-only update' }
    });
    assert.equal(alphaPost.response.status, 200);
    const bravoDelete = await request('/api/posts/' + encodeURIComponent(alphaPost.data.post.id), {
      method: 'DELETE', cookie: bravoAdmin.cookie, originHeader: origin
    });
    assert.equal(bravoDelete.response.status, 404);
    const alphaPosts = await request('/api/posts', { cookie: alphaAdmin.cookie });
    assert.equal(alphaPosts.data.length, 1);

    const alphaModule = await request('/api/modules/operations', {
      method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
      body: { type: 'IDOR record', details: 'Alpha-only operational record' }
    });
    assert.equal(alphaModule.response.status, 200);
    const bravoModuleDelete = await request('/api/modules/operations/' + encodeURIComponent(alphaModule.data.record.id), {
      method: 'DELETE', cookie: bravoAdmin.cookie, originHeader: origin
    });
    assert.equal(bravoModuleDelete.response.status, 404, 'Cross-tenant generic-module delete was accepted.');

    const bravoAccountUpdate = await request('/api/accounts/alpha-teacher', {
      method: 'PUT', cookie: bravoAdmin.cookie, originHeader: origin,
      body: { name: 'Taken over', role: 'admin', schoolName: 'Bravo School' }
    });
    assert.equal(bravoAccountUpdate.response.status, 404, 'Cross-tenant account update was accepted.');

    // 8. Media/content attacks.
    for (const mediaUrl of [
      'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+',
      'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'javascript:alert(1)',
      'https://evil.example/payload.svg'
    ]) {
      const result = await request('/api/posts', {
        method: 'POST', cookie: alphaTeacher.cookie, originHeader: origin,
        body: { audience: 'Foundation', caption: 'Media probe', mediaUrl }
      });
      assert.equal(result.response.status, 400, 'Unsafe post media was accepted: ' + mediaUrl.slice(0, 32));
    }

    // 9. URL scheme and credential injection in administrator-managed external links.
    for (const schoolStoreUrl of [
      'javascript:alert(1)',
      'http://127.0.0.1:10000/private',
      'https://user:password@example.com/store'
    ]) {
      const result = await request('/api/accounts', {
        method: 'POST',
        cookie: alphaAdmin.cookie,
        originHeader: origin,
        body: {
          username: 'probe-' + crypto.randomUUID() + '@example.test',
          pin: 'Password1',
          name: 'URL Probe',
          role: 'teacher',
          schoolName: 'Alpha School',
          schoolStoreUrl
        }
      });
      assert.equal(result.response.status, 400, 'Unsafe external URL was accepted: ' + schoolStoreUrl);
    }

    // 10. Education-stage tampering: only canonical age/grade values are accepted.
    const tamperedApplication = await request('/api/school-applications', {
      method: 'POST',
      cookie: alphaParent.cookie,
      originHeader: origin,
      body: {
        schoolName: 'Alpha School',
        guardianName: 'Alpha Parent',
        contactEmail: 'alpha-parent@example.test',
        contactPhone: '0123456789',
        learnerName: 'Alpha Learner',
        dateOfBirth: '2019-01-01',
        gradeOrAgeGroup: '<script>alert(1)</script>',
        intendedStart: '2027-01-15',
        homeArea: 'Pretoria',
        notes: 'Application test'
      }
    });
    assert.equal(tamperedApplication.response.status, 400);

    // 11. Learner-code credential exposure: admin sees codes, principal sees status only,
    // but principal retains the legitimate one-at-a-time printable form workflow.
    const learnerKey = ['Alpha Learner', 'Grade 1', 'alpha-parent@example.test'].map(value => value.trim().toLowerCase()).join('|');
    const issueCode = await request('/api/learner-access-codes', {
      method: 'POST',
      cookie: alphaAdmin.cookie,
      originHeader: origin,
      body: { learnerKey }
    });
    assert.equal(issueCode.response.status, 201);
    const issuedCode = issueCode.data.learner.accessCode;
    assert.match(issuedCode, /^LF-/);

    const adminCodes = await request('/api/learner-access-codes', { cookie: alphaAdmin.cookie });
    assert.equal(adminCodes.response.status, 200);
    assert.equal(adminCodes.data[0].accessCode, issuedCode);

    const principalCodes = await request('/api/learner-access-codes', { cookie: alphaPrincipal.cookie });
    assert.equal(principalCodes.response.status, 200);
    assert.equal(principalCodes.data[0].accessCode, null);
    assert.equal(principalCodes.data[0].hasPrintableForm, true);

    const principalBulk = await request('/api/learner-access-codes/printable-list', { cookie: alphaPrincipal.cookie });
    assert.equal(principalBulk.response.status, 403);

    const principalPrintable = await request('/api/learner-access-codes/' + encodeURIComponent(learnerKey) + '/printable', { cookie: alphaPrincipal.cookie });
    assert.equal(principalPrintable.response.status, 200);
    assert.equal(principalPrintable.data.accessCode, issuedCode);

    const parentCodes = await request('/api/learner-access-codes', { cookie: alphaParent.cookie });
    assert.equal(parentCodes.response.status, 403);

    // 12. Signed webhook boundary: unsigned/forged bodies fail, valid bodies apply once,
    // and a replay is idempotent rather than duplicating money.
    const webhookPayload = {
      eventId: 'evt-1',
      reference: 'LF-WEBHOOK-TEST',
      status: 'paid',
      amount: 100,
      transactionId: 'txn-1',
      provider: 'test-provider',
      occurredAt: '2026-09-25T08:00:00.000Z'
    };
    const webhookRaw = JSON.stringify(webhookPayload);
    const unsignedWebhook = await request('/api/payments/webhook', {
      method: 'POST',
      body: webhookRaw,
      headers: { 'content-type': 'application/json' }
    });
    assert.equal(unsignedWebhook.response.status, 401);

    const forgedWebhook = await request('/api/payments/webhook', {
      method: 'POST',
      body: webhookRaw,
      headers: { 'content-type': 'application/json', 'x-little-feet-signature': 'sha256=' + '00'.repeat(32) }
    });
    assert.equal(forgedWebhook.response.status, 401);

    const validWebhookSignature = crypto.createHmac('sha256', 'adversarial-webhook-secret').update(webhookRaw).digest('hex');
    const validWebhook = await request('/api/payments/webhook', {
      method: 'POST',
      body: webhookRaw,
      headers: { 'content-type': 'application/json', 'x-little-feet-signature': 'sha256=' + validWebhookSignature }
    });
    assert.equal(validWebhook.response.status, 201);
    assert.equal(validWebhook.data.duplicate, false);

    const replayWebhook = await request('/api/payments/webhook', {
      method: 'POST',
      body: webhookRaw,
      headers: { 'content-type': 'application/json', 'x-little-feet-signature': 'sha256=' + validWebhookSignature }
    });
    assert.equal(replayWebhook.response.status, 200);
    assert.equal(replayWebhook.data.duplicate, true);

    const tamperedRaw = JSON.stringify({ ...webhookPayload, amount: 9999 });
    const tamperedWebhook = await request('/api/payments/webhook', {
      method: 'POST',
      body: tamperedRaw,
      headers: { 'content-type': 'application/json', 'x-little-feet-signature': 'sha256=' + validWebhookSignature }
    });
    assert.equal(tamperedWebhook.response.status, 401);

    // 13. Bulk-import boundary: lower roles cannot import and oversized batches fail atomically.
    const teacherImport = await request('/api/students/import', {
      method: 'POST',
      cookie: alphaTeacher.cookie,
      originHeader: origin,
      body: { students: [{ studentName: 'Injected Learner', className: 'Grade 1' }] }
    });
    assert.equal(teacherImport.response.status, 403);

    const tooManyStudents = Array.from({ length: 1001 }, (_, index) => ({ studentName: 'Learner ' + index, className: 'Grade 1' }));
    const oversizedImport = await request('/api/students/import', {
      method: 'POST',
      cookie: alphaPrincipal.cookie,
      originHeader: origin,
      body: { students: tooManyStudents }
    });
    assert.equal(oversizedImport.response.status, 400);
    const studentSearchAfterRejectedImport = await request('/api/students/search?className=Grade%201', { cookie: alphaAdmin.cookie });
    assert.equal(studentSearchAfterRejectedImport.response.status, 200);
    assert.equal(studentSearchAfterRejectedImport.data.filter(entry => /^Learner \d+$/.test(entry.studentName || '')).length, 0);

    // 14. OAuth source guards: Google state, Yahoo state, and Microsoft state + PKCE must remain present.
    const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.match(serverSource, /state:\s*true/);
    assert.match(serverSource, /req\.query\.state !== req\.session\.yahooOAuthState/);
    assert.match(serverSource, /req\.query\.state !== req\.session\.microsoftOAuthState/);
    assert.match(serverSource, /code_challenge_method:\s*'S256'/);
    assert.match(serverSource, /code_verifier:\s*verifier/);

    // 15. Ensure attack attempts did not corrupt normal state.
    const health = await request('/api/health', { cookie: alphaAdmin.cookie });
    assert.equal(health.response.status, 200);
    assert.ok(['OK', 'BUSY'].includes(health.data.status));

    console.log('Adversarial entry-point regression test passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
