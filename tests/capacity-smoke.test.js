const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporaryDirectory = fs.mkdtempSync(path.join(root, 'tmp', 'capacity-smoke-'));
const port = 6000 + Math.floor(Math.random() * 300);
const sharedPinHash = crypto.scryptSync('CapacityPass1', 'little-feet-pin-salt', 64).toString('hex');
const schools = Array.from({ length: 1500 }, (_, index) => ({ id: `school-${index + 1}`, name: `Capacity School ${index + 1}`, status: 'active' }));
const users = schools.map((school, index) => ({ username: `capacity-admin-${index + 1}`, pinHash: sharedPinHash, name: `Capacity Administrator ${index + 1}`, role: 'admin', schoolId: school.id, schoolName: school.name, verificationStatus: 'Active' }));
const students = Array.from({ length: 2000 }, (_, index) => {
  const school = schools[index < 1000 ? 0 : 1];
  return {
    id: `pilot-learner-${index + 1}`,
    studentName: `Pilot Learner ${index + 1}`,
    className: `Class ${Math.floor((index % 1000) / 25) + 1}`,
    schoolId: school.id,
    schoolName: school.name
  };
});

fs.copyFileSync(path.join(root, 'server.js'), path.join(temporaryDirectory, 'server.js'));
fs.writeFileSync(path.join(temporaryDirectory, 'littlefeet-replica.json'), JSON.stringify({ schools, users, students, learnerAccessCodes: [], schoolBilling: {}, moduleRecords: {}, directMessages: [], chatGroups: [], groupMessages: {} }));

const child = spawn(process.execPath, ['server.js'], { cwd: temporaryDirectory, env: { ...process.env, PORT: String(port), LF_REPLICA_MODE: '1', NODE_ENV: 'test' }, stdio: ['ignore', 'ignore', 'pipe'] });
let childErrorOutput = '';
child.stderr.on('data', chunk => { childErrorOutput += chunk.toString(); });
const stopChild = () => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });
const waitForServer = async () => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Capacity test server did not start.${childErrorOutput ? `\n${childErrorOutput}` : ''}`);
};
const fetchWithRetry = async (url, options, attempts = 5) => {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fetch(url, options); } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw lastError;
};

(async () => {
  const startedAt = Date.now();
  try {
    await waitForServer();
    const loginResponses = await Promise.all(Array.from({ length: 50 }, (_, index) => fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: `capacity-admin-${index + 1}`, pin: 'CapacityPass1' })
    })));
    loginResponses.forEach(response => assert.equal(response.status, 200));
    const healthResponses = [];
    for (let batch = 0; batch < 5; batch += 1) {
      healthResponses.push(...await Promise.all(Array.from({ length: 90 }, () => fetchWithRetry(`http://127.0.0.1:${port}/api/health`))));
    }
    healthResponses.forEach(response => assert.equal(response.status, 200));
    console.log(`Capacity stress test passed for 1,500 school tenants, two 1,000-learner pilot schools, and 500 sustained requests at up to 90 concurrent connections in ${Date.now() - startedAt} ms.`);
  } catch (error) {
    console.error(error);
    console.error(`Temporary server exit code: ${child.exitCode === null ? 'still running' : child.exitCode}`);
    if (childErrorOutput) console.error(childErrorOutput);
    process.exitCode = 1;
  } finally {
    await stopChild();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})();
