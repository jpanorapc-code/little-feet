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
    { username: 'alpha-parent', pinHash: pinHash('ParentPass1'), name: 'Alpha Parent', role: 'parent', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active', parentRelationshipStatus: 'Administrator approved', linkedLearners: ['alpha learner'], subscription: 'basic' },
    { username: 'bravo-admin', pinHash: pinHash('BravoPass1'), name: 'Bravo Administrator', role: 'admin', schoolId: 'school-bravo', schoolName: 'Bravo School', verificationStatus: 'Active' },
    { username: 'bravo-parent', pinHash: pinHash('ParentPass1'), name: 'Bravo Parent', role: 'parent', schoolId: 'school-bravo', schoolName: 'Bravo School', verificationStatus: 'Active', parentRelationshipStatus: 'Administrator approved', linkedLearners: ['bravo learner'], subscription: 'basic' }
  ],
  students: [], learnerAccessCodes: [], storeProducts: [], storeOrders: [], parentPayments: [], parentSubscriptions: [], bookRegister: [], registry: [], schools,
  schoolBilling: {}, moduleRecords: {}, directMessages: [], chatGroups: [], groupMessages: {},
  releaseNotes: [{ id: '2026-08-safeguarding', version: '2.8', title: 'Old saved release', summary: 'This stale database value must be replaced by the deployed release catalogue.', publishedAt: '2026-08-28T08:00:00.000Z' }]
}));

const child = spawn(process.execPath, ['server.js'], {
  cwd: temporaryDirectory,
  env: { ...process.env, PORT: String(port), LF_REPLICA_MODE: '1', NODE_ENV: 'test', LF_PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let childErrorOutput = '';
child.stderr.on('data', chunk => { childErrorOutput += chunk.toString(); });

const stopChild = () => new Promise(resolve => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});

const waitForServer = async () => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Temporary test server did not start.${childErrorOutput ? `\n${childErrorOutput}` : ''}`);
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
    const keepalive = await request('/api/keepalive');
    assert.equal(keepalive.response.status, 200);
    assert.equal(keepalive.data.status, 'OK');
    const alphaLogin = await request('/api/login', { method: 'POST', body: { username: 'alpha-admin', pin: 'AlphaPass1' } });
    const alphaParentLogin = await request('/api/login', { method: 'POST', body: { username: 'alpha-parent', pin: 'ParentPass1' } });
    const bravoLogin = await request('/api/login', { method: 'POST', body: { username: 'bravo-admin', pin: 'BravoPass1' } });
    const bravoParentLogin = await request('/api/login', { method: 'POST', body: { username: 'bravo-parent', pin: 'ParentPass1' } });
    assert.equal(alphaLogin.response.status, 200);
    assert.equal(alphaParentLogin.response.status, 200);
    assert.equal(bravoLogin.response.status, 200);
    assert.equal(bravoParentLogin.response.status, 200);
    const diagnostics = await request('/api/system-diagnostics', { cookie: alphaLogin.cookie });
    assert.equal(diagnostics.response.status, 200);
    assert.equal(diagnostics.data.persistence, 'read-only-replica');
    const liveStatus = await request('/api/system-status', { cookie: alphaLogin.cookie });
    assert.equal(liveStatus.response.status, 200);
    assert.equal(liveStatus.data.status, 'operational');
    assert.equal(liveStatus.data.recentUpdates[0].version, '3.1');
    const releaseNotes = await request('/api/release-notes');
    assert.equal(releaseNotes.response.status, 200);
    assert.deepEqual(releaseNotes.data.slice(0, 3).map(note => note.version), ['3.1', '3.0', '2.9']);
    assert.equal(releaseNotes.data.find(note => note.id === '2026-08-safeguarding').title, 'Safeguarding and family records');

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

    const alphaBillingConfigured = await request('/api/subscription-billing', { method: 'PUT', cookie: alphaLogin.cookie, body: { baseMonthly: 500, lateFeeEnabled: false, lateFee: 0, bundles: { 5: { costPrice: 0, sellingPrice: 50 }, 20: { costPrice: 0, sellingPrice: 150 }, 100: { costPrice: 0, sellingPrice: 500 } }, payment: { method: 'bank_transfer', accountName: 'Alpha School', bankName: 'Test Bank', accountNumber: '123456789', branchCode: '000000', referencePrefix: 'ALPHA' } } });
    assert.equal(alphaBillingConfigured.response.status, 200);
    const publishedPlans = await request('/api/subscription-billing', { cookie: alphaLogin.cookie });
    assert.deepEqual(publishedPlans.data.plans.map(plan => [plan.code, plan.monthlyPrice]), [['micro', 350], ['standard', 1500], ['enterprise', 7500]]);
    const enterpriseOrder = await request('/api/subscription-billing/orders', { method: 'POST', cookie: alphaLogin.cookie, body: { planCode: 'enterprise' } });
    assert.equal(enterpriseOrder.response.status, 201);
    assert.equal(enterpriseOrder.data.order.monthlyTotal, 7500);
    assert.equal(enterpriseOrder.data.order.learnerCapacity, 1000);
    assert.equal(enterpriseOrder.data.payment.bankName, 'Test Bank');

    const parentPayment = await request('/api/parent-payments', { method: 'POST', cookie: alphaLogin.cookie, body: { parentUsername: 'alpha-parent', learnerName: 'Alpha Learner', description: 'Term fees', amountDue: 500, dueDate: '2020-01-01', arrangementDueDate: '2021-01-01', arrangementAmount: 400, arrangementNote: 'Approved reduced amount and later date' } });
    assert.equal(parentPayment.response.status, 201);
    assert.equal(parentPayment.data.payment.amountDue, 400);
    assert.equal(parentPayment.data.payment.arrears, 400);
    const partPayment = await request('/api/payments/reconcile', { method: 'POST', cookie: alphaLogin.cookie, body: { eventId: 'parent-payment-1', reference: parentPayment.data.payment.reference, status: 'paid', amount: 150, bankReference: 'PARENT-BANK-001' } });
    assert.equal(partPayment.response.status, 201);
    const alphaParentPayments = await request('/api/parent-payments', { cookie: alphaParentLogin.cookie });
    const bravoParentPayments = await request('/api/parent-payments', { cookie: bravoParentLogin.cookie });
    assert.equal(alphaParentPayments.data.summary.arrears, 250);
    assert.equal(alphaParentPayments.data.payments[0].paymentHistory.length, 1);
    assert.equal(bravoParentPayments.data.payments.length, 0);

    const parentSubscription = await request('/api/parent-subscription/orders', { method: 'POST', cookie: alphaParentLogin.cookie, body: {} });
    assert.equal(parentSubscription.response.status, 201);
    assert.equal(parentSubscription.data.order.amount, 29);
    const subscriptionPayment = await request('/api/payments/reconcile', { method: 'POST', cookie: alphaLogin.cookie, body: { eventId: 'parent-subscription-1', reference: parentSubscription.data.order.reference, status: 'paid', amount: 29, bankReference: 'PLUS-BANK-001' } });
    assert.equal(subscriptionPayment.response.status, 201);
    const refreshedParentSession = await request('/api/auth/session', { cookie: alphaParentLogin.cookie });
    assert.equal(refreshedParentSession.data.user.subscription, 'plus');

    const issuedBook = await request('/api/book-register', { method: 'POST', cookie: alphaLogin.cookie, body: { bookTitle: 'Mathematics Grade 4', bookCode: 'MATH-001', bookPrice: 250, learnerName: 'Alpha Learner', className: 'Grade 4A', parentUsername: 'alpha-parent', issueCondition: 'New, no markings', adminSignature: 'Alpha Administrator' } });
    assert.equal(issuedBook.response.status, 201);
    const signedReceipt = await request(`/api/book-register/${issuedBook.data.record.id}/sign`, { method: 'POST', cookie: alphaParentLogin.cookie, body: { action: 'received', signature: 'Alpha Parent' } });
    assert.equal(signedReceipt.response.status, 200);
    const returnedBook = await request(`/api/book-register/${issuedBook.data.record.id}/return`, { method: 'PUT', cookie: alphaLogin.cookie, body: { returnStatus: 'damaged', returnCondition: 'Water damaged cover', returnAdminSignature: 'Alpha Administrator' } });
    assert.equal(returnedBook.response.status, 200);
    assert.equal(returnedBook.data.record.penaltyAmount, 250);
    const signedReturn = await request(`/api/book-register/${issuedBook.data.record.id}/sign`, { method: 'POST', cookie: alphaParentLogin.cookie, body: { action: 'returned', signature: 'Alpha Parent' } });
    assert.equal(signedReturn.response.status, 200);
    const importedBooks = await request('/api/book-register/import', { method: 'POST', cookie: alphaLogin.cookie, body: { rows: [{ 'Book Title': 'English Grade 4', 'Book Code': 'ENG-001', 'Learner Name': 'Alpha Learner', Class: 'Grade 4A', 'Parent Username': 'alpha-parent', 'Book replacement price': 180, 'Condition at handover': 'Good' }] } });
    assert.equal(importedBooks.response.status, 201);
    const alphaBooks = await request('/api/book-register?className=Grade%204A', { cookie: alphaLogin.cookie });
    const bravoBooks = await request('/api/book-register', { cookie: bravoLogin.cookie });
    assert.equal(alphaBooks.data.summary.total, 2);
    assert.equal(alphaBooks.data.summary.returned, 1);
    assert.equal(alphaBooks.data.summary.penalties, 250);
    assert.equal(bravoBooks.data.records.length, 0);

    const subscriptionOrder = await request('/api/subscription-billing/orders', { method: 'POST', cookie: alphaLogin.cookie, body: { bundleCapacity: 5 } });
    assert.equal(subscriptionOrder.response.status, 201);
    assert.equal(subscriptionOrder.data.order.monthlyTotal, 550);
    const reconciliation = await request('/api/payments/reconcile', { method: 'POST', cookie: alphaLogin.cookie, body: { eventId: 'bank-statement-line-1', reference: subscriptionOrder.data.order.reference, status: 'paid', amount: 550, bankReference: 'BANK-001' } });
    assert.equal(reconciliation.response.status, 201);
    const duplicateReconciliation = await request('/api/payments/reconcile', { method: 'POST', cookie: alphaLogin.cookie, body: { eventId: 'bank-statement-line-1', reference: subscriptionOrder.data.order.reference, status: 'paid', amount: 550, bankReference: 'BANK-001' } });
    assert.equal(duplicateReconciliation.response.status, 200);
    assert.equal(duplicateReconciliation.data.duplicate, true);
    const alphaLedger = await request('/api/payments/ledger', { cookie: alphaLogin.cookie });
    const bravoLedger = await request('/api/payments/ledger', { cookie: bravoLogin.cookie });
    assert.equal(alphaLedger.data.length, 3);
    assert.deepEqual(new Set(alphaLedger.data.map(entry => entry.targetType)), new Set(['subscription', 'parent_subscription', 'parent_payment']));
    assert.equal(bravoLedger.data.length, 0);

    console.log('Tenant isolation test passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stopChild();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})();
