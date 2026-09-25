const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'strengthening-'));
const port = 6400 + Math.floor(Math.random() * 250);
const hash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');

for (const file of ['server.js', 'auth-crypto.js', 'backup.js', 'manifest.webmanifest', 'service-worker.js']) {
  fs.copyFileSync(path.join(root, file), path.join(temp, file));
}

fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [{ id: 'school-alpha', name: 'Alpha ECD', status: 'active' }],
  users: [
    { username: 'alpha-admin', pinHash: hash('AdminPass1'), name: 'Alpha Admin', role: 'admin', schoolId: 'school-alpha', schoolName: 'Alpha ECD', verificationStatus: 'Active' },
    { username: 'alpha-teacher', pinHash: hash('TeacherPass1'), name: 'Alpha Teacher', role: 'teacher', schoolId: 'school-alpha', schoolName: 'Alpha ECD', verificationStatus: 'Active', assignedClasses: ['Owls'] },
    { username: 'alpha-parent', pinHash: hash('ParentPass1'), name: 'Alpha Parent', role: 'parent', schoolId: 'school-alpha', schoolName: 'Alpha ECD', verificationStatus: 'Active', parentRelationshipStatus: 'Administrator approved', linkedLearners: ['Alpha Learner'] }
  ],
  parentPayments: [{
    id: 'payment-old', reference: 'LF-PARENT-AGE', parentUsername: 'alpha-parent', parentName: 'Alpha Parent', learnerName: 'Alpha Learner',
    description: 'Historic school fee', amountDue: 500, dueDate: '2020-01-01', arrangementDueDate: '', arrangementAmount: null, arrangementNote: '',
    parentSignature: '', parentSignedAt: '', paymentStatus: 'awaiting_payment', createdAt: '2020-01-01T08:00:00.000Z', createdBy: 'alpha-admin',
    schoolId: 'school-alpha', schoolName: 'Alpha ECD'
  }],
  paymentEvents: [{
    id: 'paid-part', targetType: 'parent_payment', reference: 'LF-PARENT-AGE', status: 'paid', amount: 150,
    receivedAt: '2020-02-01T08:00:00.000Z', schoolId: 'school-alpha', schoolName: 'Alpha ECD'
  }],
  moduleRecords: {},
  schoolBilling: {},
  directMessages: [],
  chatGroups: [],
  groupMessages: {}
}));

const child = spawn(process.execPath, ['server.js'], {
  cwd: temp,
  env: { ...process.env, PORT: String(port), LF_REPLICA_MODE: '1', LF_TEST_ALLOW_REPLICA_WRITES: '1', NODE_ENV: 'test' },
  stdio: ['ignore', 'ignore', 'pipe']
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

const stop = () => new Promise(resolve => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = async (route, { method = 'GET', body, cookie } = {}) => {
  const response = await fetch('http://127.0.0.1:' + port + route, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
};

(async () => {
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const health = await fetch('http://127.0.0.1:' + port + '/api/health');
        if (health.ok) break;
      } catch {}
      await wait(100);
      if (attempt === 119) throw new Error('Strengthening test server did not start. ' + stderr);
    }

    const manifest = await request('/manifest.webmanifest');
    assert.equal(manifest.response.status, 200);
    assert.equal(manifest.data.display, 'standalone');
    const serviceWorker = await request('/service-worker.js');
    assert.equal(serviceWorker.response.status, 200);
    assert.equal(serviceWorker.response.headers.get('service-worker-allowed'), '/');
    assert.match(String(serviceWorker.data), /url\.pathname\.startsWith\('\/api\/'\)/);

    const admin = await request('/api/login', { method: 'POST', body: { username: 'alpha-admin', pin: 'AdminPass1' } });
    const teacher = await request('/api/login', { method: 'POST', body: { username: 'alpha-teacher', pin: 'TeacherPass1' } });
    const parent = await request('/api/login', { method: 'POST', body: { username: 'alpha-parent', pin: 'ParentPass1' } });
    assert.equal(admin.response.status, 200);
    assert.equal(teacher.response.status, 200);
    assert.equal(parent.response.status, 200);

    const saved = await request('/api/modules/curriculum', {
      method: 'POST', cookie: teacher.cookie, body: {
        framework: 'NCF Birth–4', area: 'ELDA 3 · Communication', learnerName: 'Alpha Learner',
        observation: 'Uses words and gestures to explain a play idea to a peer.', evidenceReference: 'Learning file 1'
      }
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.data.record.framework, 'NCF Birth–4');
    assert.equal(saved.data.record.area, 'ELDA 3 · Communication');

    const curriculum = await request('/api/modules/curriculum', { cookie: admin.cookie });
    assert.equal(curriculum.response.status, 200);
    assert.equal(curriculum.data.length, 1);
    assert.equal(curriculum.data[0].learnerName, 'Alpha Learner');

    const parentWrite = await request('/api/modules/curriculum', {
      method: 'POST', cookie: parent.cookie, body: { framework: 'CAPS Grade R', area: 'Mathematics', learnerName: 'Alpha Learner', observation: 'Blocked write.' }
    });
    assert.equal(parentWrite.response.status, 403);

    const mismatchedArea = await request('/api/modules/curriculum', {
      method: 'POST', cookie: teacher.cookie, body: { framework: 'NCF Birth–4', area: 'Mathematics', learnerName: 'Alpha Learner', observation: 'Wrong mapping.' }
    });
    assert.equal(mismatchedArea.response.status, 400);

    const payments = await request('/api/parent-payments', { cookie: parent.cookie });
    assert.equal(payments.response.status, 200);
    assert.equal(payments.data.summary.balance, 350);
    assert.equal(payments.data.ageing.totalOpen, 350);
    assert.equal(payments.data.ageing.days90plus, 350);
    assert.ok(payments.data.payments[0].daysPastDue > 90);

    console.log('Strengthening regression test passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
