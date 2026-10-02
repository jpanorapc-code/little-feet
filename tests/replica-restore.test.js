const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'replica-restore-'));
const port = 6100 + Math.floor(Math.random() * 300);
const pinHash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');

for (const file of ['server.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js']) {
  fs.copyFileSync(path.join(root, file), path.join(temp, file));
}
fs.mkdirSync(path.join(temp, 'lib', 'storage'), { recursive: true });
fs.mkdirSync(path.join(temp, 'lib', 'operations'), { recursive: true });
fs.copyFileSync(path.join(root, 'lib', 'storage', 'object-storage.js'), path.join(temp, 'lib', 'storage', 'object-storage.js'));
fs.copyFileSync(path.join(root, 'lib', 'operations', 'standby-replication.js'), path.join(temp, 'lib', 'operations', 'standby-replication.js'));
fs.copyFileSync(path.join(root, 'lib', 'operations', 'recovery-rehearsal.js'), path.join(temp, 'lib', 'operations', 'recovery-rehearsal.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-integration.js'), path.join(temp, 'lib', 'mailbox-integration.js'));
fs.copyFileSync(path.join(root, 'lib', 'oauth-identity.js'), path.join(temp, 'lib', 'oauth-identity.js'));
fs.copyFileSync(path.join(root, 'lib', 'structured-logger.js'), path.join(temp, 'lib', 'structured-logger.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-oauth.js'), path.join(temp, 'lib', 'mailbox-oauth.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-imap.js'), path.join(temp, 'lib', 'yahoo-imap.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-smtp.js'), path.join(temp, 'lib', 'yahoo-smtp.js'));

const snapshot = users => ({
  schools: [{ id: 'school-alpha', name: 'Alpha School', status: 'active' }],
  users,
  students: [],
  learnerAccessCodes: [],
  storeProducts: [],
  storeOrders: [],
  parentPayments: [],
  parentSubscriptions: [],
  bookRegister: [],
  registry: [],
  schoolBilling: {},
  moduleRecords: {},
  directMessages: [],
  chatGroups: [],
  groupMessages: {}
});

const admin = { username: 'alpha-admin', pinHash: pinHash('AlphaPass1'), name: 'Alpha Admin', role: 'admin', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' };
const teacher = { username: 'alpha-teacher', pinHash: pinHash('TeacherPass1'), name: 'Alpha Teacher', role: 'teacher', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active', assignedClasses: [] };
const replicaFile = path.join(temp, 'littlefeet-replica.json');
fs.writeFileSync(replicaFile, JSON.stringify(snapshot([admin])));

const child = spawn(process.execPath, ['server.js'], {
  cwd: temp,
  env: { ...process.env, PORT: String(port), LF_REPLICA_MODE: '1', NODE_ENV: 'test' },
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
const request = async (route, options = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  const data = await response.json();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || options.cookie };
};
const authed = async (route, cookie) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { cookie } });
  return { response, data: await response.json() };
};

(async () => {
  try {
    for (let i = 0; i < 100; i += 1) {
      try {
        const h = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (h.ok) break;
      } catch {}
      await wait(100);
      if (i === 99) throw new Error(`Replica test server failed to start. ${stderr}`);
    }

    const standbyHealth = await request('/api/health');
    assert.equal(standbyHealth.response.status, 200);
    assert.equal(standbyHealth.data.instance, 'STANDBY');
    assert.equal(standbyHealth.data.readOnly, true);
    assert.equal(standbyHealth.response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');

    const runtimeConfigResponse = await fetch(`http://127.0.0.1:${port}/runtime-config.js`);
    assert.equal(runtimeConfigResponse.status, 200);
    const runtimeConfigSource = await runtimeConfigResponse.text();
    assert.match(runtimeConfigSource, /"instance":"STANDBY"/);
    assert.match(runtimeConfigSource, /"readOnly":true/);

    const failoverStatus = await request('/api/failover-status');
    assert.equal(failoverStatus.response.status, 200);
    assert.equal(failoverStatus.data.instance, 'STANDBY');
    assert.equal(failoverStatus.data.readOnly, true);

        const login = await request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alpha-admin', pin: 'AlphaPass1' })
    });
    assert.equal(login.response.status, 200);
    const cookie = login.cookie;
    const initial = await authed('/api/accounts', cookie);
    assert.equal(initial.response.status, 200);
    assert.deepEqual(initial.data.map(a => a.username), ['alpha-admin']);

    const blockedMutation = await request('/api/term', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ term: 'This must never be acknowledged on standby' })
    });
    assert.equal(blockedMutation.response.status, 503);
    assert.match(blockedMutation.data.message, /read-only/i);
    assert.match(blockedMutation.data.message, /not saved/i);
    assert.equal(blockedMutation.response.headers.get('retry-after'), '30');

    fs.writeFileSync(replicaFile, '{corrupt json');
    await wait(2300);
    const afterCorrupt = await authed('/api/accounts', cookie);
    assert.equal(afterCorrupt.response.status, 200);
    assert.deepEqual(afterCorrupt.data.map(a => a.username), ['alpha-admin']);

    fs.writeFileSync(replicaFile, JSON.stringify(snapshot([admin, teacher])));
    await wait(2300);
    const afterValidRestore = await authed('/api/accounts', cookie);
    assert.equal(afterValidRestore.response.status, 200);
    assert.deepEqual(afterValidRestore.data.map(a => a.username).sort(), ['alpha-admin', 'alpha-teacher']);

    console.log('Replica restore test passed.');
  } finally {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
