const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp', 'sa-sams-'));
const port = 7950 + Math.floor(Math.random() * 100);
const origin = `http://127.0.0.1:${port}`;
const hash = pin => crypto.scryptSync(pin, 'little-feet-pin-salt', 64).toString('hex');
for (const file of ['server.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js']) fs.copyFileSync(path.join(root, file), path.join(temp, file));
fs.mkdirSync(path.join(temp, 'lib', 'storage'), { recursive: true });
fs.mkdirSync(path.join(temp, 'lib', 'operations'), { recursive: true });
fs.copyFileSync(path.join(root, 'lib', 'storage', 'object-storage.js'), path.join(temp, 'lib', 'storage', 'object-storage.js'));
for (const file of ['replica-transport.js', 'recovery-rehearsal.js']) fs.copyFileSync(path.join(root, 'lib', 'operations', file), path.join(temp, 'lib', 'operations', file));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-integration.js'), path.join(temp, 'lib', 'mailbox-integration.js'));
fs.copyFileSync(path.join(root, 'lib', 'oauth-identity.js'), path.join(temp, 'lib', 'oauth-identity.js'));
fs.copyFileSync(path.join(root, 'lib', 'structured-logger.js'), path.join(temp, 'lib', 'structured-logger.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-oauth.js'), path.join(temp, 'lib', 'mailbox-oauth.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-imap.js'), path.join(temp, 'lib', 'yahoo-imap.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-smtp.js'), path.join(temp, 'lib', 'yahoo-smtp.js'));
fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [{ id: 'school-alpha', name: 'Alpha School' }, { id: 'school-bravo', name: 'Bravo School' }],
  users: [
    { username: 'alpha-admin', pinHash: hash('AlphaPass1'), name: 'Alpha Admin', role: 'admin', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
    { username: 'bravo-admin', pinHash: hash('BravoPass1'), name: 'Bravo Admin', role: 'admin', schoolId: 'school-bravo', schoolName: 'Bravo School', verificationStatus: 'Active' }
  ], students: [], importJobs: [], importAudit: [], learnerAccessCodes: [], schoolBilling: {}, moduleRecords: {}, directMessages: [], chatGroups: [], groupMessages: {}
}));

let child;
const start = async () => {
  child = spawn(process.execPath, ['server.js'], { cwd: temp, env: { ...process.env, PORT: String(port), NODE_ENV: 'test', SESSION_SECRET: 'sasams-session', LF_FIELD_ENCRYPTION_KEY: 'sasams-fields' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 120; i += 1) { try { if ((await fetch(origin + '/api/health')).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('SA-SAMS test server did not start.');
};
const stop = () => new Promise(resolve => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });
const call = async (route, { method = 'GET', body, cookie } = {}) => {
  const response = await fetch(origin + route, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
};
const login = async (username, pin) => {
  const result = await call('/api/login', { method: 'POST', body: { username, pin } });
  assert.equal(result.response.status, 200);
  return result.cookie;
};

(async () => {
  try {
    await start();
    const alpha = await login('alpha-admin', 'AlphaPass1');
    const importId = 'sasams_alpha_20260929';
    const imported = await call('/api/students/import', {
      method: 'POST', cookie: alpha,
      body: {
        importId, batchNumber: 0, totalBatches: 1, sourceSystem: 'SA-SAMS',
        students: [
          { studentName: 'Lerato Molefe', className: 'Grade 4A', parentName: 'Nomsa Molefe', contactEmail: 'nomsa@example.test', emergencyContact: '0710000000' },
          { studentName: '', className: 'Grade 5B' }
        ]
      }
    });
    assert.equal(imported.response.status, 201);
    assert.equal(imported.data.imported, 1);
    assert.equal(imported.data.rejected.length, 1);

    const job = await call('/api/students/import/' + importId, { cookie: alpha });
    assert.equal(job.response.status, 200);
    assert.equal(job.data.type, 'sa-sams-learners');
    assert.equal(job.data.sourceSystem, 'SA-SAMS');
    assert.equal(job.data.status, 'completed');

    const learners = await call('/api/students/search', { cookie: alpha });
    assert.equal(learners.response.status, 200);
    assert.equal(learners.data.length, 1);
    assert.equal(learners.data[0].studentName, 'Lerato Molefe');
    assert.equal(learners.data[0].className, 'Grade 4A');

    const bravo = await login('bravo-admin', 'BravoPass1');
    assert.equal((await call('/api/students/import/' + importId, { cookie: bravo })).response.status, 404, 'Another school must not see the SA-SAMS import job.');
    assert.equal((await call('/api/students/search', { cookie: bravo })).data.length, 0, 'Another school must not see imported learners.');

    const badSource = await call('/api/students/import', { method: 'POST', cookie: alpha, body: { importId: 'unsupported_source_1', sourceSystem: 'Fake-SAMS', students: [{ studentName: 'Nope', className: 'G1' }] } });
    assert.equal(badSource.response.status, 400);

    console.log('Real SA-SAMS learner import, audit metadata and tenant-isolation test passed.');
  } finally {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
