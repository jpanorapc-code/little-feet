const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'adversarial-sensitive-'));
const port = 7150 + Math.floor(Math.random() * 150);
const base = 'http://127.0.0.1:' + port;
const hash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');

for (const file of ['server.js', 'auth-crypto.js', 'backup.js', 'manifest.webmanifest', 'service-worker.js']) {
  fs.copyFileSync(path.join(root, file), path.join(temp, file));
}
fs.mkdirSync(path.join(temp, 'output', 'pdf'), { recursive: true });
fs.writeFileSync(path.join(temp, 'output', 'pdf', 'LittleFeet_User_Manual_2026_Updated.pdf'), '%PDF-1.4\npublic-test-document\n');
fs.writeFileSync(path.join(temp, 'output', 'pdf', 'secret-export.pdf'), '%PDF-1.4\nprivate-test-document\n');

fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [{ id:'school-alpha', name:'Alpha School', status:'active' }],
  users: [
    { username:'alpha-admin', pinHash:hash('AdminPass1'), name:'Alpha Admin', role:'admin', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active' },
    { username:'alpha-principal', pinHash:hash('PrincipalPass1'), name:'Alpha Principal', role:'principal', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active' },
    { username:'alpha-teacher', pinHash:hash('TeacherPass1'), name:'Alpha Teacher', role:'teacher', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active', assignedClasses:['Grade 1'] },
    { username:'alpha-parent@example.test', pinHash:hash('ParentPass1'), name:'Alpha Parent', role:'parent', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active', parentRelationshipStatus:'Administrator approved', linkedLearners:['Alpha Learner'] }
  ],
  students:[{ id:'alpha-student', studentName:'Alpha Learner', className:'Grade 1', parentName:'Alpha Parent', contactEmail:'alpha-parent@example.test', schoolId:'school-alpha', schoolName:'Alpha School' }],
  registry:[], consentRecords:[], pickupLogs:[], visitorMeetings:[], campusVisitors:[], reportReviews:[],
  moduleRecords:{ finance:[], operations:[], care:[], engagement:[], dailyCare:[], portfolio:[], curriculum:[], supplies:[], stock:[], reports:[], safeguarding:[], absences:[], handovers:[], stickyNotes:[] },
  directMessages:[], chatGroups:[], groupMessages:{}, learnerAccessCodes:[], parentPayments:[], paymentEvents:[], paymentLedger:[], schoolBilling:{}
}));

const child = spawn(process.execPath, ['server.js'], {
  cwd: temp,
  env: {
    ...process.env,
    PORT:String(port),
    NODE_ENV:'test',
    LF_REPLICA_MODE:'1',
    LF_TEST_ALLOW_REPLICA_WRITES:'1',
    LF_TEST_ENFORCE_ORIGIN:'1',
    LF_MAX_API_BODY_MB:'1',
    SESSION_SECRET:'sensitive-test-session-secret',
    LF_FIELD_ENCRYPTION_KEY:'sensitive-test-field-key'
  },
  stdio:['ignore','ignore','pipe']
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const stop = () => new Promise(resolve => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});

async function request(route, { method='GET', body, cookie, origin=true } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (origin && cookie && !['GET','HEAD','OPTIONS'].includes(method)) headers.origin = base;
  const response = await fetch(base + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect:'manual'
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { response, data, text, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}

const raw = route => new Promise((resolve, reject) => {
  const req = http.request({ hostname:'127.0.0.1', port, path:route, method:'GET' }, res => {
    let body='';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status:res.statusCode, body, headers:res.headers }));
  });
  req.on('error', reject);
  req.end();
});

async function login(username, pin) {
  const result = await request('/api/login', { method:'POST', body:{ username, pin }, origin:false });
  assert.equal(result.response.status, 200, 'login failed: ' + username + ' ' + result.text);
  return result.cookie;
}

(async () => {
  try {
    for (let i=0; i<120; i+=1) {
      try {
        const health = await fetch(base + '/api/health');
        if (health.ok) break;
      } catch {}
      if (i === 119) throw new Error('Sensitive-input test server failed to start. ' + stderr);
      await wait(100);
    }

    // Retest method A: arbitrary output files and traversal are private.
    const publicManual = await raw('/output/pdf/LittleFeet_User_Manual_2026_Updated.pdf');
    assert.equal(publicManual.status, 200);
    assert.match(publicManual.headers['content-type'] || '', /application\/pdf/);
    for (const route of [
      '/output/pdf/secret-export.pdf',
      '/output/pdf/%2e%2e/%2e%2e/server.js',
      '/output/%2e%2e/server.js'
    ]) {
      const result = await raw(route);
      assert.equal(result.status, 404, 'unexpected output exposure: ' + route);
      assert.doesNotMatch(result.body, /private-test-document|const express = require/);
    }

    // Retest method B: giant identifiers/secrets fail before expensive auth work.
    const hugeUsername = await request('/api/login', { method:'POST', body:{ username:'u'.repeat(5000), pin:'WrongPass1' }, origin:false });
    assert.equal(hugeUsername.response.status, 401);
    const hugeLoginPin = await request('/api/login', { method:'POST', body:{ username:'alpha-admin', pin:'p'.repeat(5000) }, origin:false });
    assert.equal(hugeLoginPin.response.status, 401);

    const admin = await login('alpha-admin', 'AdminPass1');
    const principal = await login('alpha-principal', 'PrincipalPass1');
    const teacher = await login('alpha-teacher', 'TeacherPass1');
    const parent = await login('alpha-parent@example.test', 'ParentPass1');

    const hugeSigningPin = await request('/api/report-signing-pin', { method:'POST', cookie:teacher, body:{ pin:'9'.repeat(5000) } });
    assert.equal(hugeSigningPin.response.status, 400);
    const normalSigningPin = await request('/api/report-signing-pin', { method:'POST', cookie:teacher, body:{ pin:'TeacherSign1' } });
    assert.equal(normalSigningPin.response.status, 200);

    const hugeReportVerify = await request('/api/report-reviews', {
      method:'POST', cookie:teacher,
      body:{
        studentName:'Alpha Learner',
        reportTitle:'Term report',
        period:'Term 3',
        parentUsername:'alpha-parent@example.test',
        signingPin:'x'.repeat(5000),
        signatureData:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      }
    });
    assert.equal(hugeReportVerify.response.status, 403);

    const hugePickupPin = await request('/api/pickups/verify', {
      method:'POST', cookie:teacher,
      body:{ learnerName:'Alpha Learner', pickupAdult:'Alpha Parent', verificationCode:'7'.repeat(5000), action:'Pickup / release' }
    });
    assert.equal(hugePickupPin.response.status, 400);
    const invalidPickupAction = await request('/api/pickups/verify', {
      method:'POST', cookie:teacher,
      body:{ learnerName:'Alpha Learner', pickupAdult:'Alpha Parent', verificationCode:'1234', action:'Override security' }
    });
    assert.equal(invalidPickupAction.response.status, 400);

    const hugeVisitorPass = await request('/api/campus-visitors/check-in', {
      method:'POST', cookie:principal,
      body:{ passCode:'LFV-' + 'A'.repeat(5000) }
    });
    assert.equal(hugeVisitorPass.response.status, 404);

    // Retest method C: sensitive records reject overflow rather than truncate.
    const hugeRegistry = await request('/api/registry', {
      method:'POST', cookie:teacher,
      body:{
        learnerName:'Alpha Learner', className:'Grade 1', dateOfBirth:'2019-01-01',
        guardianName:'G'.repeat(161), guardianPhone:'0123456789',
        guardianEmail:'alpha-parent@example.test', address:'Pretoria',
        emergencyContact:'', medicalNotes:'', consent:'Pending verification'
      }
    });
    assert.equal(hugeRegistry.response.status, 400);

    const futureDob = await request('/api/registry', {
      method:'POST', cookie:teacher,
      body:{
        learnerName:'Alpha Learner', className:'Grade 1', dateOfBirth:'2999-01-01',
        guardianName:'Alpha Parent', guardianPhone:'0123456789',
        guardianEmail:'alpha-parent@example.test', address:'Pretoria',
        emergencyContact:'', medicalNotes:'', consent:'Pending verification'
      }
    });
    assert.equal(futureDob.response.status, 400);

    const validRegistry = await request('/api/registry', {
      method:'POST', cookie:teacher,
      body:{
        learnerName:'Alpha Learner', className:'Grade 1', dateOfBirth:'2019-01-01',
        guardianName:'Alpha Parent', guardianPhone:'0123456789',
        guardianEmail:'alpha-parent@example.test', address:'Pretoria',
        emergencyContact:'Grandparent 0123450000', medicalNotes:'No known allergies', consent:'Verified'
      }
    });
    assert.equal(validRegistry.response.status, 201);

    const hugeConsent = await request('/api/consents', {
      method:'POST', cookie:teacher,
      body:{ learnerName:'L'.repeat(161), guardianName:'Alpha Parent', internalUpdates:true, marketingPhotos:false }
    });
    assert.equal(hugeConsent.response.status, 400);
    const validConsent = await request('/api/consents', {
      method:'POST', cookie:teacher,
      body:{ learnerName:'Alpha Learner', guardianName:'Alpha Parent', internalUpdates:true, marketingPhotos:false }
    });
    assert.equal(validConsent.response.status, 201);

    const hugeMeeting = await request('/api/visitor-meetings', {
      method:'POST', cookie:parent,
      body:{ hostUsername:'alpha-teacher', proposedAt:'2026-10-01T10:00', purpose:'P'.repeat(1201) }
    });
    assert.equal(hugeMeeting.response.status, 400);
    const validMeeting = await request('/api/visitor-meetings', {
      method:'POST', cookie:parent,
      body:{ hostUsername:'alpha-teacher', proposedAt:'2026-10-01T10:00', purpose:'Discuss learner progress' }
    });
    assert.equal(validMeeting.response.status, 201);

    // Normal admin session must still work after all probes.
    const session = await request('/api/auth/session', { cookie:admin });
    assert.equal(session.response.status, 200);
    assert.equal(session.data.authenticated, true);

    console.log('Sensitive-input adversarial regression test passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stop();
    fs.rmSync(temp, { recursive:true, force:true });
  }
})();
