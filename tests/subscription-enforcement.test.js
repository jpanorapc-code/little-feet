const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tmpRoot = path.join(root, 'tmp');
fs.mkdirSync(tmpRoot, { recursive: true });
const tmp = fs.mkdtempSync(path.join(tmpRoot, 'subscription-enforcement-'));
const port = 7920 + Math.floor(Math.random() * 120);
const base = 'http://127.0.0.1:' + port;
const hash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');

for (const file of ['server.js', 'failover-mode.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js']) {
  fs.copyFileSync(path.join(root, file), path.join(tmp, file));
}
fs.mkdirSync(path.join(tmp, 'lib', 'storage'), { recursive: true });
for (const file of [
  ['storage', 'object-storage.js'],
  ['mailbox-integration.js'],
  ['oauth-identity.js'],
  ['structured-logger.js'],
  ['payfast.js'],
  ['mailbox-oauth.js'],
  ['yahoo-imap.js'],
  ['yahoo-smtp.js']
]) {
  const source = path.join(root, 'lib', ...file);
  const destination = path.join(tmp, 'lib', ...file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const school = {
  id: 'school-alpha',
  name: 'Alpha School',
  status: 'active',
  createdAt: '2026-09-01T08:00:00.000Z',
  trialStartedAt: '2026-09-01T08:00:00.000Z',
  trialEndsAt: '2026-09-15T08:00:00.000Z'
};
const students = Array.from({ length: 31 }, (_, index) => ({
  id: 'existing-' + index,
  studentName: 'Existing Learner ' + (index + 1),
  className: 'Class A',
  contactEmail: '',
  schoolId: school.id,
  schoolName: school.name
}));
const billing = {
  pricing: {
    baseMonthly: 500,
    bundles: {
      5: { costPrice: 0, sellingPrice: 50 },
      20: { costPrice: 0, sellingPrice: 150 },
      100: { costPrice: 0, sellingPrice: 500 }
    },
    lateFeeEnabled: false,
    lateFee: 0
  },
  payment: {
    method: 'payment_link',
    paymentLink: 'https://payments.example.test/alpha',
    accountName: '',
    bankName: '',
    accountNumberEncrypted: '',
    payMePayloadEncrypted: '',
    branchCode: '',
    referencePrefix: 'LF'
  },
  orders: []
};

fs.writeFileSync(path.join(tmp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [school],
  users: [
    { username: 'alpha-principal', pinHash: hash('PrincipalPass1'), name: 'Alpha Principal', role: 'principal', schoolId: school.id, schoolName: school.name, verificationStatus: 'Active' }
  ],
  students,
  learnerAccessCodes: [],
  parentPayments: [],
  parentSubscriptions: [],
  paymentEvents: [],
  paymentLedger: [],
  financeRecurringRules: [],
  financeAdjustments: [],
  financeReconciliationRuns: [],
  payrollProfiles: [],
  payrollRuns: [],
  schoolBilling: { [school.id]: billing },
  subscriptionBilling: billing,
  registry: [],
  moduleRecords: {},
  directMessages: [],
  chatGroups: [],
  groupMessages: {}
}));

const child = spawn(process.execPath, ['server.js'], {
  cwd: tmp,
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', LF_REPLICA_MODE: '1', LF_TEST_ALLOW_REPLICA_WRITES: '1' },
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

async function request(route, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(base + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}

(async () => {
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        if ((await fetch(base + '/api/health')).ok) break;
      } catch {}
      if (attempt === 119) throw new Error('Subscription enforcement test server did not start. ' + stderr);
      await wait(100);
    }

    const login = await request('/api/login', {
      method: 'POST',
      body: { username: 'alpha-principal', pin: 'PrincipalPass1' }
    });
    assert.equal(login.response.status, 200);
    const cookie = login.cookie;
    assert.equal(login.data.user.schoolSubscription.allowed, false);
    assert.equal(login.data.user.schoolSubscription.status, 'trial_expired');

    const blocked = await request('/api/registry', { cookie });
    assert.equal(blocked.response.status, 402);
    assert.equal(blocked.data.code, 'SCHOOL_SUBSCRIPTION_REQUIRED');

    const billingBefore = await request('/api/subscription-billing', { cookie });
    assert.equal(billingBefore.response.status, 200);
    assert.equal(billingBefore.data.subscription.status, 'trial_expired');
    assert.equal(billingBefore.data.subscription.learnerCount, 31);
    assert.deepEqual(
      billingBefore.data.plans.map(plan => [plan.code, plan.overagePerLearner, plan.hardMaxLearners]),
      [['micro', 10, 250], ['standard', 6, 1000], ['enterprise', 0, 1000]]
    );

    const tooLargeMicro = await request('/api/subscription-billing/orders', {
      method: 'POST',
      cookie,
      body: { planCode: 'micro', learnerCapacity: 251 }
    });
    assert.equal(tooLargeMicro.response.status, 409);

    const order = await request('/api/subscription-billing/orders', {
      method: 'POST',
      cookie,
      body: { planCode: 'micro', learnerCapacity: 35 }
    });
    assert.equal(order.response.status, 201, JSON.stringify(order.data));
    assert.equal(order.data.order.baseMonthly, 350);
    assert.equal(order.data.order.learnerCapacity, 35);
    assert.equal(order.data.order.overageLearners, 5);
    assert.equal(order.data.order.overageRate, 10);
    assert.equal(order.data.order.overageTotal, 50);
    assert.equal(order.data.order.monthlyTotal, 400);

    const paid = await request('/api/payments/reconcile', {
      method: 'POST',
      cookie,
      body: {
        eventId: 'subscription-payment-001',
        reference: order.data.order.reference,
        status: 'paid',
        amount: 400,
        bankReference: 'BANK-001'
      }
    });
    assert.equal(paid.response.status, 201, JSON.stringify(paid.data));

    const session = await request('/api/auth/session', { cookie });
    assert.equal(session.response.status, 200);
    assert.equal(session.data.user.schoolSubscription.allowed, true);
    assert.equal(session.data.user.schoolSubscription.status, 'active');

    const billingAfter = await request('/api/subscription-billing', { cookie });
    assert.equal(billingAfter.data.subscription.active, true);
    assert.equal(billingAfter.data.subscription.planCode, 'micro');
    assert.equal(billingAfter.data.subscription.learnerCapacity, 35);

    const rows = Array.from({ length: 5 }, (_, index) => ({
      studentName: 'New Learner ' + (index + 1),
      className: 'Class B',
      parentName: 'Parent ' + (index + 1),
      contactEmail: ''
    }));
    const imported = await request('/api/students/import', {
      method: 'POST',
      cookie,
      body: { students: rows, importId: 'capacity-test-001', batchNumber: 0, totalBatches: 1 }
    });
    assert.equal(imported.response.status, 201, JSON.stringify(imported.data));
    assert.equal(imported.data.imported, 4);
    assert.equal(imported.data.rejected.length, 1);
    assert.match(imported.data.rejected[0].reason, /Paid learner capacity reached/);

    const finalBilling = await request('/api/subscription-billing', { cookie });
    assert.equal(finalBilling.data.subscription.learnerCount, 35);
    assert.equal(finalBilling.data.subscription.learnerCapacity, 35);

    const registerAtCapacity = await request('/api/registry', {
      method: 'POST',
      cookie,
      body: {
        learnerName: 'Blocked Learner',
        className: 'Class C',
        dateOfBirth: '2020-01-01',
        guardianName: 'Capacity Parent',
        guardianPhone: '0600000000',
        guardianEmail: 'capacity@example.test',
        address: 'Test address',
        emergencyContact: '0600000001',
        medicalNotes: '',
        consent: 'Pending verification'
      }
    });
    assert.equal(registerAtCapacity.response.status, 409);
    assert.equal(registerAtCapacity.data.code, 'LEARNER_CAPACITY_REACHED');
    const billingStillAtCapacity = await request('/api/subscription-billing', { cookie });
    assert.equal(billingStillAtCapacity.data.subscription.learnerCount, 35);

    console.log('Subscription enforcement regression test passed.');
  } catch (error) {
    console.error(error);
    if (stderr) console.error(stderr);
    process.exitCode = 1;
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
