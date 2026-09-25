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
const validPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const oversizedPng = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1, 0xff).toString('base64')}`;
const schools = [
  { id: 'school-alpha', name: 'Alpha School', status: 'active' },
  { id: 'school-bravo', name: 'Bravo School', status: 'active' }
];

fs.copyFileSync(path.join(root, 'server.js'), path.join(temporaryDirectory, 'server.js'));
fs.copyFileSync(path.join(root, 'auth-crypto.js'), path.join(temporaryDirectory, 'auth-crypto.js'));
fs.copyFileSync(path.join(root, 'backup.js'), path.join(temporaryDirectory, 'backup.js'));
fs.writeFileSync(path.join(temporaryDirectory, 'littlefeet-replica.json'), JSON.stringify({
  schools,
  users: [
    { username: 'alpha-admin', pinHash: pinHash('AlphaPass1'), name: 'Alpha Administrator', role: 'admin', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
    { username: 'alpha-teacher', pinHash: pinHash('TeacherPass1'), name: 'Alpha Teacher', role: 'teacher', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active', assignedClasses: ['a1'] },
    { username: 'alpha-principal', pinHash: pinHash('PrincipalPass1'), name: 'Alpha Principal', role: 'principal', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
    { username: 'alpha-district', pinHash: pinHash('DistrictPass1'), name: 'Alpha District', role: 'district', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
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
  env: { ...process.env, PORT: String(port), LF_REPLICA_MODE: '1', LF_TEST_ALLOW_REPLICA_WRITES: '1', NODE_ENV: 'test', LF_PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret', LF_BACKUP_BUCKET: 'configured-but-not-used' },
  stdio: ['ignore', 'ignore', 'pipe']
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

const rawRequest = async (route) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`);
  return { response, body: await response.text() };
};

(async () => {
  try {
    await waitForServer();
    const health = await request('/api/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.response.headers.get('cache-control'), 'no-store');
    assert.equal(Object.prototype.hasOwnProperty.call(health.data, 'instance'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(health.data, 'activeRequests'), false);
    const readiness = await request('/api/ready');
    assert.equal(readiness.response.status, 503);
    assert.equal(readiness.data.ready, false);
    assert.equal(readiness.data.status, 'NOT_READY');
    assert.equal(Object.prototype.hasOwnProperty.call(readiness.data, 'checks'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(readiness.data, 'environment'), false);
    const keepalive = await request('/api/keepalive');
    assert.equal(keepalive.response.status, 200);
    assert.equal(keepalive.data.status, 'OK');
    assert.equal(Object.prototype.hasOwnProperty.call(keepalive.data, 'database'), false);
    for (const privatePath of ['/server.js', '/auth-crypto.js', '/package.json', '/littlefeet-replica.json', '/littlefeet.db']) {
      const privateFile = await rawRequest(privatePath);
      assert.equal(privateFile.response.status, 404);
    }
    const publicBundle = await rawRequest('/backup.js');
    assert.equal(publicBundle.response.status, 200);
    assert.match(publicBundle.body, /function logout\(/);
    const anonymousSession = await request('/api/auth/session');
    assert.equal(anonymousSession.response.status, 200);
    assert.equal(anonymousSession.data.authenticated, false);
    assert.equal(anonymousSession.data.user, null);
    const alphaLogin = await request('/api/login', { method: 'POST', body: { username: 'alpha-admin', pin: 'AlphaPass1' } });
    const alphaTeacherLogin = await request('/api/login', { method: 'POST', body: { username: 'alpha-teacher', pin: 'TeacherPass1' } });
    const alphaPrincipalLogin = await request('/api/login', { method: 'POST', body: { username: 'alpha-principal', pin: 'PrincipalPass1' } });
    const alphaDistrictLogin = await request('/api/login', { method: 'POST', body: { username: 'alpha-district', pin: 'DistrictPass1' } });
    const alphaParentLogin = await request('/api/login', { method: 'POST', body: { username: 'alpha-parent', pin: 'ParentPass1' } });
    const bravoLogin = await request('/api/login', { method: 'POST', body: { username: 'bravo-admin', pin: 'BravoPass1' } });
    const bravoParentLogin = await request('/api/login', { method: 'POST', body: { username: 'bravo-parent', pin: 'ParentPass1' } });
    assert.equal(alphaLogin.response.status, 200);
    assert.equal(alphaTeacherLogin.response.status, 200);
    assert.equal(alphaPrincipalLogin.response.status, 200);
    assert.equal(alphaDistrictLogin.response.status, 200);
    assert.equal(alphaParentLogin.response.status, 200);
    assert.equal(bravoLogin.response.status, 200);
    assert.equal(bravoParentLogin.response.status, 200);
    const authenticatedHealth = await request('/api/health', { cookie: alphaLogin.cookie });
    assert.equal(authenticatedHealth.response.status, 200);
    assert.equal(authenticatedHealth.data.instance, 'STANDBY');
    assert.equal(Number.isInteger(authenticatedHealth.data.activeRequests), true);
    const originalAlphaCookie = alphaLogin.cookie;
    const migratedAlphaLogin = await request('/api/login', { method: 'POST', cookie: originalAlphaCookie, body: { username: 'alpha-admin', pin: 'AlphaPass1' } });
    assert.equal(migratedAlphaLogin.response.status, 200);
    assert.notEqual(migratedAlphaLogin.cookie, originalAlphaCookie);
    const replacedAlphaSession = await request('/api/auth/session', { cookie: originalAlphaCookie });
    assert.equal(replacedAlphaSession.response.status, 200);
    assert.equal(replacedAlphaSession.data.authenticated, false);
    assert.equal(replacedAlphaSession.data.user, null);
    alphaLogin.cookie = migratedAlphaLogin.cookie;
    const diagnostics = await request('/api/system-diagnostics', { cookie: alphaLogin.cookie });
    assert.equal(diagnostics.response.status, 200);
    assert.equal(diagnostics.data.persistence, 'read-only-replica');
    const productionReadiness = await request('/api/production-readiness', { cookie: alphaLogin.cookie });
    assert.equal(productionReadiness.response.status, 200);
    assert.equal(productionReadiness.data.integrations.offsiteBackup, false);
    const liveStatus = await request('/api/system-status', { cookie: alphaLogin.cookie });
    assert.equal(liveStatus.response.status, 200);
    assert.equal(liveStatus.data.status, 'operational');
    assert.equal(liveStatus.data.recentUpdates[0].version, '3.2');
    const releaseNotes = await request('/api/release-notes');
    assert.equal(releaseNotes.response.status, 200);
    assert.deepEqual(releaseNotes.data.slice(0, 3).map(note => note.version), ['3.2', '3.1', '3.0']);
    assert.equal(releaseNotes.data.find(note => note.id === '2026-08-safeguarding').title, 'Safeguarding and family records');

    const opaqueCredentialSignup = await request('/api/signup', {
      method: 'POST',
      body: {
        username: 'credential-test@example.test',
        pin: 'fuckPass1',
        name: 'Credential Test',
        role: 'parent',
        schoolName: 'Credential Test School',
        termsAccepted: true,
        linkedLearners: []
      }
    });
    assert.equal(opaqueCredentialSignup.response.status, 201);

    const oversizedBroadcast = await request('/api/broadcasts', {
      method: 'POST',
      cookie: alphaLogin.cookie,
      body: { bcPriority: 'Campus Notice', bcMessage: 'x'.repeat(2001), radiusKm: 5, location: { lat: -25.7, lng: 28.2 } }
    });
    assert.equal(oversizedBroadcast.response.status, 413);

    const stickyNote = await request('/api/modules/stickyNotes', { method: 'POST', cookie: alphaLogin.cookie, body: { type: 'Call family', details: 'Confirm the pickup time after 15:00.', colour: 'teal', recordedBy: 'Alpha Administrator' } });
    assert.equal(stickyNote.response.status, 200);
    const alphaStickyNotes = await request('/api/modules/stickyNotes', { cookie: alphaLogin.cookie });
    const bravoStickyNotes = await request('/api/modules/stickyNotes', { cookie: bravoLogin.cookie });
    const parentStickyNote = await request('/api/modules/stickyNotes', { method: 'POST', cookie: alphaParentLogin.cookie, body: { type: 'Unauthorised', details: 'This must not be saved.' } });
    assert.equal(alphaStickyNotes.data.length, 1);
    assert.equal(alphaStickyNotes.data[0].type, 'Call family');
    assert.equal(bravoStickyNotes.data.length, 0);
    assert.equal(parentStickyNote.response.status, 403);
    const parentStickyNotes = await request('/api/modules/stickyNotes', { cookie: alphaParentLogin.cookie });
    assert.equal(parentStickyNotes.response.status, 403);
    const blockedStickyNote = await request('/api/modules/stickyNotes', { method: 'POST', cookie: alphaLogin.cookie, body: { type: 'Follow-up', details: 'This contains f.u.c.k wording and must not be saved.' } });
    assert.equal(blockedStickyNote.response.status, 422);
    const moderatedStickyNotes = await request('/api/modules/stickyNotes', { cookie: alphaLogin.cookie });
    assert.equal(moderatedStickyNotes.data.length, 1);

    const imported = await request('/api/students/import', { method: 'POST', cookie: alphaLogin.cookie, body: { students: [{ studentName: 'Alpha Learner', className: 'A1', parentName: 'Alpha Parent', contactEmail: 'alpha.parent@example.test' }] } });
    assert.equal(imported.response.status, 201);
    const alphaCodes = await request('/api/learner-access-codes', { cookie: alphaLogin.cookie });
    const bravoCodes = await request('/api/learner-access-codes', { cookie: bravoLogin.cookie });
    assert.equal(alphaCodes.data.length, 1);
    assert.equal(bravoCodes.data.length, 0);

    const duplicateCode = await request('/api/learner-access-codes', { method: 'POST', cookie: alphaLogin.cookie, body: { learnerKey: alphaCodes.data[0].learnerKey } });
    assert.equal(duplicateCode.response.status, 409);
    const blockedPrint = await request(`/api/learner-access-codes/${encodeURIComponent(alphaCodes.data[0].learnerKey)}/printable`, { cookie: bravoLogin.cookie });
    assert.equal(blockedPrint.response.status, 404);

    const secondLearner = await request('/api/students/import', { method: 'POST', cookie: alphaLogin.cookie, body: { students: [{ studentName: 'Alpha Other Learner', className: 'A2', parentName: 'Another Parent', contactEmail: 'another.parent@example.test' }] } });
    assert.equal(secondLearner.response.status, 201);
    const generatedSchedule = await request('/api/schedules', { method: 'POST', cookie: alphaLogin.cookie, body: { id: 'alpha-schedule-linked', studentName: 'Alpha Learner', activity: 'Reading' } });
    assert.equal(generatedSchedule.response.status, 200);
    assert.notEqual(generatedSchedule.data.item.id, 'alpha-schedule-linked');
    assert.match(generatedSchedule.data.item.id, /^[0-9a-f-]{36}$/i);
    await request('/api/schedules', { method: 'POST', cookie: alphaLogin.cookie, body: { id: 'alpha-schedule-other', studentName: 'Alpha Other Learner', activity: 'Painting' } });
    await request('/api/worksheets', { method: 'POST', cookie: alphaLogin.cookie, body: { id: 'alpha-worksheet-linked', studentName: 'Alpha Learner', title: 'Letters' } });
    await request('/api/worksheets', { method: 'POST', cookie: alphaLogin.cookie, body: { id: 'alpha-worksheet-other', studentName: 'Alpha Other Learner', title: 'Numbers' } });
    await request('/api/attendance', { method: 'POST', cookie: alphaLogin.cookie, body: { id: 'alpha-attendance-linked', studentName: 'Alpha Learner', status: 'Present' } });
    await request('/api/attendance', { method: 'POST', cookie: alphaLogin.cookie, body: { id: 'alpha-attendance-other', studentName: 'Alpha Other Learner', status: 'Present' } });

    const parentSchedules = await request('/api/schedules', { cookie: alphaParentLogin.cookie });
    const parentWorksheets = await request('/api/worksheets', { cookie: alphaParentLogin.cookie });
    const parentAttendance = await request('/api/attendance', { cookie: alphaParentLogin.cookie });
    assert.deepEqual(parentSchedules.data.map(item => item.studentName), ['Alpha Learner']);
    assert.deepEqual(parentWorksheets.data.map(item => item.studentName), ['Alpha Learner']);
    assert.deepEqual(parentAttendance.data.map(item => item.studentName), ['Alpha Learner']);

    const registryRecord = await request('/api/registry', { method: 'POST', cookie: alphaLogin.cookie, body: { learnerName: 'Alpha Learner', dateOfBirth: '2020-01-01', guardianName: 'Alpha Parent', guardianPhone: '0000000000', address: 'Test address' } });
    const consentRecord = await request('/api/consents', { method: 'POST', cookie: alphaLogin.cookie, body: { learnerName: 'Alpha Learner', guardianName: 'Alpha Parent', internalUpdates: true, marketingPhotos: false } });
    const pickupRecord = await request('/api/pickups/verify', { method: 'POST', cookie: alphaLogin.cookie, body: { learnerName: 'Alpha Learner', pickupAdult: 'Alpha Parent', verificationCode: '2468', action: 'Pickup' } });
    assert.equal(registryRecord.response.status, 201);
    assert.equal(consentRecord.response.status, 201);
    assert.equal(pickupRecord.response.status, 201);
    assert.equal((await request('/api/registry', { cookie: alphaParentLogin.cookie })).response.status, 403);
    assert.equal((await request('/api/consents', { cookie: alphaParentLogin.cookie })).response.status, 403);
    assert.equal((await request('/api/pickups', { cookie: alphaParentLogin.cookie })).response.status, 403);
    assert.equal((await request('/api/registry', { cookie: alphaTeacherLogin.cookie })).data.length, 1);
    assert.equal((await request('/api/consents', { cookie: alphaPrincipalLogin.cookie })).data.length, 1);
    assert.equal((await request('/api/pickups', { cookie: alphaTeacherLogin.cookie })).data.length, 1);
    assert.equal((await request('/api/registry', { cookie: alphaDistrictLogin.cookie })).response.status, 403);
    assert.equal((await request('/api/consents', { cookie: alphaDistrictLogin.cookie })).response.status, 403);
    assert.equal((await request('/api/pickups', { cookie: alphaDistrictLogin.cookie })).response.status, 403);
    assert.equal((await request('/api/chat/groups', { cookie: alphaDistrictLogin.cookie })).response.status, 403);
    assert.equal((await request('/api/chat/direct/users', { cookie: alphaDistrictLogin.cookie })).response.status, 403);
    assert.equal((await request('/api/registry', { cookie: bravoLogin.cookie })).data.length, 0);
    assert.equal((await request('/api/consents', { cookie: bravoLogin.cookie })).data.length, 0);
    assert.equal((await request('/api/pickups', { cookie: bravoLogin.cookie })).data.length, 0);

    const product = await request('/api/store/products', { method: 'POST', cookie: alphaLogin.cookie, body: { name: 'Alpha School Shirt', price: 50, stockQuantity: 12 } });
    assert.equal(product.response.status, 201);
    const bravoStore = await request('/api/store', { cookie: bravoLogin.cookie });
    assert.equal(bravoStore.data.products.length, 0);

    const billing = await request('/api/subscription-billing', { method: 'PUT', cookie: bravoLogin.cookie, body: { baseMonthly: 1000, lateFeeEnabled: true, lateFee: 50, bundles: { 5: { costPrice: 100, sellingPrice: 150 }, 20: { costPrice: 200, sellingPrice: 275 }, 100: { costPrice: 500, sellingPrice: 700 } }, payment: { method: 'payment_link', paymentLink: 'https://payments.example.test/bravo', referencePrefix: 'BRAVO' } } });
    assert.equal(billing.response.status, 200);
    const alphaBilling = await request('/api/subscription-billing', { cookie: alphaLogin.cookie });
    assert.equal(alphaBilling.data.pricing.baseMonthly, 0);

    const alphaBillingConfigured = await request('/api/subscription-billing', { method: 'PUT', cookie: alphaLogin.cookie, body: { baseMonthly: 500, lateFeeEnabled: false, lateFee: 0, bundles: { 5: { costPrice: 0, sellingPrice: 50 }, 20: { costPrice: 0, sellingPrice: 150 }, 100: { costPrice: 0, sellingPrice: 500 } }, payment: { method: 'bank_transfer', accountName: 'Alpha School', bankName: 'Test Bank', accountNumber: '123456789', branchCode: '000000', referencePrefix: 'ALPHA', capitecPayMePayload: '00020126380028za.co.capitec.electrum.payme6304TEST' } } });
    assert.equal(alphaBillingConfigured.response.status, 200);
    const publishedPlans = await request('/api/subscription-billing', { cookie: alphaLogin.cookie });
    assert.deepEqual(publishedPlans.data.plans.map(plan => [plan.code, plan.monthlyPrice]), [['micro', 350], ['standard', 1500], ['enterprise', 7500]]);
    const enterpriseOrder = await request('/api/subscription-billing/orders', { method: 'POST', cookie: alphaLogin.cookie, body: { planCode: 'enterprise' } });
    assert.equal(enterpriseOrder.response.status, 201);
    assert.equal(enterpriseOrder.data.order.monthlyTotal, 7500);
    assert.equal(enterpriseOrder.data.order.learnerCapacity, 1000);
    assert.equal(enterpriseOrder.data.payment.bankName, 'Test Bank');
    assert.equal(enterpriseOrder.data.payment.capitecPayMePayload, '00020126380028za.co.capitec.electrum.payme6304TEST');

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

    const bravoParentCookie = bravoParentLogin.cookie;
    const deletionRequest = await request('/api/account-deletion-request', { method: 'POST', cookie: bravoParentCookie, body: {} });
    assert.equal(deletionRequest.response.status, 201);
    assert.equal(deletionRequest.data.success, true);
    assert.equal(deletionRequest.data.ticket.status, 'Open');
    const duplicateDeletionRequest = await request('/api/account-deletion-request', { method: 'POST', cookie: bravoParentCookie, body: {} });
    assert.equal(duplicateDeletionRequest.response.status, 409);
    const bravoAdminTickets = await request('/api/tickets', { cookie: bravoLogin.cookie });
    assert.equal(bravoAdminTickets.response.status, 200);
    const deletionTicket = bravoAdminTickets.data.find(ticket => ticket.category === 'Account deletion request' && ticket.createdBy === 'bravo-parent');
    assert.ok(deletionTicket);
    assert.equal(deletionTicket.assignedTo, 'bravo-admin');
    assert.match(deletionTicket.message, /ACCOUNT DELETION REQUEST/);
    assert.match(deletionTicket.message, /Name: Bravo Parent/);
    assert.match(deletionTicket.message, /Username \/ email: bravo-parent/);
    assert.match(deletionTicket.message, /Role: parent/);
    assert.match(deletionTicket.message, /School: Bravo School/);
    assert.match(deletionTicket.message, /Requested at:/);
    const adminDeletionRequest = await request('/api/account-deletion-request', { method: 'POST', cookie: bravoLogin.cookie, body: {} });
    assert.equal(adminDeletionRequest.response.status, 400);
    const teacherSchoolDeletionRequest = await request('/api/school-deletion-request', { method: 'POST', cookie: alphaTeacherLogin.cookie, body: {} });
    assert.equal(teacherSchoolDeletionRequest.response.status, 403);
    const principalSchoolDeletionRequest = await request('/api/school-deletion-request', { method: 'POST', cookie: alphaPrincipalLogin.cookie, body: {} });
    assert.equal(principalSchoolDeletionRequest.response.status, 201);
    const duplicateSchoolDeletionRequest = await request('/api/school-deletion-request', { method: 'POST', cookie: alphaPrincipalLogin.cookie, body: {} });
    assert.equal(duplicateSchoolDeletionRequest.response.status, 409);
    const alphaAdminTicketsForDeletion = await request('/api/tickets', { cookie: alphaLogin.cookie });
    const schoolDeletionTicket = alphaAdminTicketsForDeletion.data.find(ticket => ticket.category === 'School deletion request');
    assert.ok(schoolDeletionTicket);
    assert.equal(schoolDeletionTicket.assignedTo, 'alpha-admin');
    assert.match(schoolDeletionTicket.message, /SCHOOL DELETION REQUEST/);
    assert.match(schoolDeletionTicket.message, /School: Alpha School/);
    assert.match(schoolDeletionTicket.message, /Role: principal/);


    const logout = await request('/api/auth/logout', { method: 'POST', cookie: bravoParentCookie });
    assert.equal(logout.response.status, 200);
    assert.equal(logout.data.success, true);
    const loggedOutBravoSession = await request('/api/auth/session', { cookie: bravoParentCookie });
    assert.equal(loggedOutBravoSession.response.status, 200);
    assert.equal(loggedOutBravoSession.data.authenticated, false);
    assert.equal(loggedOutBravoSession.data.user, null);

    const unauthenticatedMedia = await request('/api/posts', { method: 'POST', body: { caption: 'Unauthorised', mediaUrl: validPng } });
    assert.equal(unauthenticatedMedia.response.status, 403);
    const parentMedia = await request('/api/posts', { method: 'POST', cookie: alphaParentLogin.cookie, body: { caption: 'Parent cannot post', mediaUrl: validPng } });
    assert.equal(parentMedia.response.status, 403);
    const validPost = await request('/api/posts', { method: 'POST', cookie: alphaTeacherLogin.cookie, body: { caption: 'Valid media', mediaUrl: validPng } });
    assert.equal(validPost.response.status, 200);
    const invalidMedia = [
      'data:image/png;base64,SGVsbG8=',
      validPng.replace('data:image/png', 'data:image/jpeg'),
      'javascript:alert(1)',
      oversizedPng
    ];
    for (const mediaUrl of invalidMedia) {
      const rejectedPost = await request('/api/posts', { method: 'POST', cookie: alphaTeacherLogin.cookie, body: { caption: 'Rejected media', mediaUrl } });
      assert.equal(rejectedPost.response.status, 400);
    }
    const validWorksheet = await request('/api/worksheets', { method: 'POST', cookie: alphaTeacherLogin.cookie, body: { studentName: 'Media Test Learner', title: 'Valid image', grade: 90, photoUrl: validPng } });
    assert.equal(validWorksheet.response.status, 200);
    const invalidWorksheet = await request('/api/worksheets', { method: 'POST', cookie: alphaTeacherLogin.cookie, body: { studentName: 'Media Test Learner', title: 'Invalid image', grade: 90, photoUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } });
    assert.equal(invalidWorksheet.response.status, 400);
    const bravoPosts = await request('/api/posts', { cookie: bravoLogin.cookie });
    assert.equal(bravoPosts.data.length, 0);

    const rejectedSchoolRemoval = await request('/api/school-deletion/execute', { method: 'POST', cookie: alphaLogin.cookie, body: { ticketId: schoolDeletionTicket.id, confirmation: 'not confirmed' } });
    assert.equal(rejectedSchoolRemoval.response.status, 400);
    const approvedSchoolRemoval = await request('/api/school-deletion/execute', { method: 'POST', cookie: alphaLogin.cookie, body: { ticketId: schoolDeletionTicket.id, confirmation: 'DELETE SCHOOL' } });
    assert.equal(approvedSchoolRemoval.response.status, 200);
    assert.equal(approvedSchoolRemoval.data.deletedSchoolId, 'school-alpha');

    const deletedAlphaSession = await request('/api/auth/session', { cookie: alphaLogin.cookie });
    assert.equal(deletedAlphaSession.data.authenticated, false);
    const survivingBravoSession = await request('/api/auth/session', { cookie: bravoLogin.cookie });
    assert.equal(survivingBravoSession.data.authenticated, true);
    const survivingBravoAccounts = await request('/api/accounts', { cookie: bravoLogin.cookie });
    assert.ok(survivingBravoAccounts.data.some(account => account.username === 'bravo-admin'));
    assert.ok(survivingBravoAccounts.data.some(account => account.username === 'bravo-parent'));

    console.log('Tenant isolation test passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stopChild();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
})();
