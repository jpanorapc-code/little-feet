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
