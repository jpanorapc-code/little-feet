const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temporaryDirectory = fs.mkdtempSync(path.join(root, 'tmp', 'tenant-isolation-'));
const port = 5600 + Math.floor(Math.random() * 300);
const pinHash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');
const schools = [
  { id: 'school-alpha', name: 'Alpha School', status: 'active' },
  { id: 'school-bravo', name: 'Bravo School', status: 'active' }
];

fs.copyFileSync(path.join(root, 'server.js'), path.join(temporaryDirectory, 'server.js'));
fs.writeFileSync(path.join(temporaryDirectory, 'littlefeet-replica.json'), JSON.stringify({
  schools,
  users: [
    { username: 'alpha-admin', pinHash: pinHash('AlphaPass1'), name: 'Alpha Administrator', role: 'admin', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
    { username: 'bravo-admin', pinHash: pinHash('BravoPass1'), name: 'Bravo Administrator', role: 'admin', schoolId: 'school-bravo', schoolName: 'Bravo School', verificationStatus: 'Active' }
  ],
  students: [], learnerAccessCodes: [], storeProducts: [], storeOrders: [], registry: [], schools,
  schoolBilling: {}, moduleRecords: {}, directMessages: [], chatGroups: [], groupMessages: {}
}));

const child = spawn(process.execPath, ['server.js'], {
  cwd: temporaryDirectory,
  env: { ...process.env, PORT: String(port), LF_REPLICA_MODE: '1', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});

const stopChild = () => new Promise(resolve => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Temporary test server did not start.');
};

const request = async (route, { method = 'GET', body, cookie } = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
};

(async () => {
  try {
    await waitForServer();
    const readiness = await request('/api/ready');
    assert.equal(readiness.response.status, 503);
    assert.equal(readiness.data.checks.database, false);
    const alphaLogin = await request('/api/login', { method: 'POST', body: { username: 'alpha-admin', pin: 'AlphaPass1' } });
    const bravoLogin = await request('/api/login', { method: 'POST', body: { username: 'bravo-admin', pin: 'BravoPass1' } });
    assert.equal(alphaLogin.response.status, 200);
    assert.equal(bravoLogin.response.status, 200);

    const imported = await request('/api/students/import', { method: 'POST', cookie: alphaLogin.cookie, body: { students: [{ studentName: 'Alpha Learner', className: 'A1', parentName: 'Alpha Parent', contactEmail: 'alpha.parent@example.test' }] } });
    assert.equal(imported.response.status, 201);
    const alphaCodes = await request('/api/learner-access-codes', { cookie: alphaLogin.cookie });
    const bravoCodes = await request('/api/learner-access-codes', { cookie: bravoLogin.cookie });
    assert.equal(alphaCodes.data.length, 1);
    assert.equal(bravoCodes.data.length, 0);

    const issued = await request('/api/learner-access-codes', { method: 'POST', cookie: alphaLogin.cookie, body: { learnerKey: alphaCodes.data[0].learnerKey } });
    assert.equal(issued.response.status, 201);
    const blockedPrint = await request(`/api/learner-access-codes/${encodeURIComponent(alphaCodes.data[0].learnerKey)}/printable`, { cookie: bravoLogin.cookie });
    assert.equal(blockedPrint.response.status, 404);

    const product = await request('/api/store/products', { method: 'POST', cookie: alphaLogin.cookie, body: { name: 'Alpha School Shirt', price: 50, stockQuantity: 12 } });
    assert.equal(product.response.status, 201);
    const bravoStore = await request('/api/store', { cookie: bravoLogin.cookie });
    assert.equal(bravoStore.data.products.length, 0);

    const billing = await request('/api/subscription-billing', { method: 'PUT', cookie: bravoLogin.cookie, body: { baseMonthly: 1000, lateFeeEnabled: true, lateFee: 50, bundles: { 5: { costPrice: 100, sellingPrice: 150 }, 20: { costPrice: 200, sellingPrice: 275 }, 100: { costPrice: 500, sellingPrice: 700 } }, payment: { method: 'payment_link', paymentLink: 'https://payments.example.test/bravo', referencePrefix: 'BRAVO' } } });
    assert.equal(billing.response.status, 200);
    const alphaBilling = await request('/api/subscription-billing', { cookie: alphaLogin.cookie });
    assert.equal(alphaBilling.data.pricing.baseMonthly, 0);

    console.log('Tenant isolation test passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stopChild();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})();
