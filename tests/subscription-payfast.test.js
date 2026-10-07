const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tmpRoot = path.join(root, 'tmp');
fs.mkdirSync(tmpRoot, { recursive: true });
const temporaryDirectory = fs.mkdtempSync(path.join(tmpRoot, 'subscription-payfast-'));
const port = 7900 + Math.floor(Math.random() * 100);
const validationPort = 8000 + Math.floor(Math.random() * 100);
const base = 'http://127.0.0.1:' + port;
const merchantId = '10000100';
const merchantKey = 'test-merchant-key';
const passphrase = 'LittleFeetRealIntegrationTest';
const pinHash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');

for (const file of ['server.js','failover-mode.js','finance-automation-server.js','auth-crypto.js','backup.js']) {
  fs.copyFileSync(path.join(root, file), path.join(temporaryDirectory, file));
}
fs.mkdirSync(path.join(temporaryDirectory, 'lib', 'storage'), { recursive: true });
for (const file of [
  ['lib/storage/object-storage.js','lib/storage/object-storage.js'],
  ['lib/mailbox-integration.js','lib/mailbox-integration.js'],
  ['lib/oauth-identity.js','lib/oauth-identity.js'],
  ['lib/structured-logger.js','lib/structured-logger.js'],
  ['lib/mailbox-oauth.js','lib/mailbox-oauth.js'],
  ['lib/yahoo-imap.js','lib/yahoo-imap.js'],
  ['lib/yahoo-smtp.js','lib/yahoo-smtp.js']
]) fs.copyFileSync(path.join(root, file[0]), path.join(temporaryDirectory, file[1]));

const now = Date.now();
const iso = value => new Date(value).toISOString();
const students = Array.from({ length: 35 }, (_, index) => ({
  id: 'alpha-student-' + index,
  schoolId: 'school-alpha',
  schoolName: 'Alpha School',
  studentName: 'Existing Learner ' + (index + 1),
  className: 'Class A',
  parentName: 'Parent ' + (index + 1),
  contactEmail: 'parent' + index + '@example.test'
}));
const payfastBilling = prefix => ({
  pricing: { baseMonthly: 0, bundles: { 5:{costPrice:0,sellingPrice:0}, 20:{costPrice:0,sellingPrice:0}, 100:{costPrice:0,sellingPrice:0} }, lateFeeEnabled:false, lateFee:0 },
  payment: { method:'payfast', paymentLink:'', accountName:'', bankName:'', accountNumberEncrypted:'', payMePayloadEncrypted:'', branchCode:'', referencePrefix:prefix },
  orders: []
});

fs.writeFileSync(path.join(temporaryDirectory, 'littlefeet-replica.json'), JSON.stringify({
  schools: [
    { id:'school-alpha', name:'Alpha School', status:'active', createdAt:iso(now), subscriptionStatus:'trial_pending', trialStartedAt:'', trialEndsAt:'' },
    { id:'school-trial-expired', name:'Expired Trial School', status:'active', createdAt:'2026-01-01T00:00:00.000Z', subscriptionStatus:'trial', trialStartedAt:'2026-01-01T00:00:00.000Z', trialEndsAt:'2026-01-15T00:00:00.000Z' },
    { id:'school-paid-expired', name:'Expired Paid School', status:'active', createdAt:'2026-01-01T00:00:00.000Z', subscriptionStatus:'active', subscriptionPlanCode:'standard', subscriptionActiveUntil:'2026-01-31', trialStartedAt:'2026-01-01T00:00:00.000Z', trialEndsAt:'2026-01-15T00:00:00.000Z' }
  ],
  users: [
    { username:'alpha-admin@example.test', pinHash:pinHash('AdminPass1'), name:'Alpha Administrator', role:'admin', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active' },
    { username:'alpha-principal@example.test', pinHash:pinHash('AlphaPass1'), name:'Alpha Principal', role:'principal', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active' },
    { username:'alpha-parent@example.test', pinHash:pinHash('ParentPass1'), name:'Alpha Parent', role:'parent', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active', parentRelationshipStatus:'Administrator approved', linkedLearners:[] },
    { username:'expired-trial@example.test', pinHash:pinHash('TrialPass1'), name:'Expired Trial Principal', role:'principal', schoolId:'school-trial-expired', schoolName:'Expired Trial School', verificationStatus:'Active' },
    { username:'expired-paid@example.test', pinHash:pinHash('PaidPass1'), name:'Expired Paid Principal', role:'principal', schoolId:'school-paid-expired', schoolName:'Expired Paid School', verificationStatus:'Active' }
  ],
  students,
  learnerAccessCodes:[],
  storeProducts:[{ id:'alpha-shirt', schoolId:'school-alpha', schoolName:'Alpha School', name:'Alpha School Shirt', price:50, stockQuantity:10, reservedQuantity:0, active:true, createdAt:iso(now), createdBy:'alpha-admin@example.test' }],
  storeOrders:[], parentPayments:[], parentSubscriptions:[], bookRegister:[], registry:[],
  schoolBilling: {
    'school-alpha': payfastBilling('ALPHA'),
    'school-trial-expired': payfastBilling('TRIAL'),
    'school-paid-expired': payfastBilling('PAID')
  },
  subscriptionBilling: payfastBilling('LF'),
  paymentEvents:[], paymentLedger:[], financeAdjustments:[], financeRecurringRules:[], financeReconciliationRuns:[],
  payrollProfiles:[], payrollRuns:[], importAudit:[], importJobs:[], moduleRecords:{}, directMessages:[], chatGroups:[], groupMessages:{}
}));

const validationServer = http.createServer((req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('METHOD'); }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    assert.match(body, /m_payment_id=ALPHA-/);
    res.writeHead(200, { 'content-type':'text/plain' });
    res.end('VALID');
  });
});

const child = spawn(process.execPath, ['server.js'], {
  cwd: temporaryDirectory,
  env: {
    ...process.env,
    PORT:String(port),
    NODE_ENV:'test',
    LF_REPLICA_MODE:'1',
    LF_TEST_ALLOW_REPLICA_WRITES:'1',
    LF_PUBLIC_ORIGIN:base,
    LF_PAYFAST_MODE:'live',
    LF_PAYFAST_MERCHANT_ID:merchantId,
    LF_PAYFAST_MERCHANT_KEY:merchantKey,
    LF_PAYFAST_PASSPHRASE:passphrase,
    LF_PAYFAST_TEST_VALIDATION_URL:'http://127.0.0.1:' + validationPort + '/eng/query/validate',
    LF_PAYFAST_TEST_ALLOW_LOCAL_ITN:'1'
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
const stopValidation = () => new Promise(resolve => validationServer.close(() => resolve()));

async function request(route, { method='GET', body, cookie, form } = {}) {
  const headers = {};
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = form;
  }
  if (cookie) headers.cookie = cookie;
  const response = await fetch(base + route, { method, headers, body:payload, redirect:'manual' });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { response, data, text, cookie:response.headers.get('set-cookie')?.split(';')[0] || cookie };
}
async function login(username, pin) {
  const result = await request('/api/login', { method:'POST', body:{username,pin} });
  assert.equal(result.response.status, 200, 'login failed for ' + username + ': ' + result.text);
  return result.cookie;
}
const encodePayFast = value => encodeURIComponent(String(value ?? '').trim())
  .replace(/%20/g, '+')
  .replace(/[!'()*~]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%[0-9a-f]{2}/gi, token => token.toUpperCase());
const parameterString = entries => entries
  .filter(([key,value]) => key !== 'signature' && value !== '' && value != null)
  .map(([key,value]) => key + '=' + encodePayFast(value)).join('&');
const sign = entries => crypto.createHash('md5')
  .update(parameterString(entries) + '&passphrase=' + encodePayFast(passphrase))
  .digest('hex');

(async () => {
  try {
    await new Promise((resolve, reject) => validationServer.listen(validationPort, '127.0.0.1', error => error ? reject(error) : resolve()));
    for (let attempt=0; attempt<150; attempt+=1) {
      try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
      if (attempt === 149) throw new Error('Subscription test server did not start. ' + stderr);
      await wait(100);
    }

    const alpha = await login('alpha-principal@example.test','AlphaPass1');
    const alphaBilling = await request('/api/subscription-billing', { cookie:alpha });
    assert.equal(alphaBilling.response.status, 200);
    assert.equal(alphaBilling.data.subscription.status, 'trial');
    assert.equal(alphaBilling.data.subscription.allowed, true);
    assert.ok(Date.parse(alphaBilling.data.subscription.trialEndsAt) > Date.now());
    assert.equal(alphaBilling.data.subscription.learnerCount, 35);
    assert.equal(alphaBilling.data.payfastAvailable, true);

    const microOrder = await request('/api/subscription-billing/orders', {
      method:'POST', cookie:alpha, body:{ planCode:'micro' }
    });
    assert.equal(microOrder.response.status, 201, microOrder.text);
    assert.equal(microOrder.data.order.baseMonthly, 350);
    assert.equal(microOrder.data.order.learnerCount, 35);
    assert.equal(microOrder.data.order.overageLearners, 5);
    assert.equal(microOrder.data.order.overageRate, 10);
    assert.equal(microOrder.data.order.monthlyTotal, 400);
    assert.equal(microOrder.data.payment.provider, 'payfast');
    assert.equal(microOrder.data.payment.automaticConfirmation, true);

    const reference = microOrder.data.order.reference;
    const checkout = await request('/api/payments/payfast/checkout?reference=' + encodeURIComponent(reference), { cookie:alpha });
    assert.equal(checkout.response.status, 200, checkout.text);
    assert.match(checkout.text, /https:\/\/www\.payfast\.co\.za\/eng\/process/);
    assert.match(checkout.text, new RegExp('name="m_payment_id" value="' + reference + '"'));
    assert.match(checkout.text, /name="amount" value="400\.00"/);
    assert.match(checkout.text, /name="signature" value="[0-9a-f]{32}"/);
    assert.equal(checkout.text.includes(passphrase), false);

    const itnFields = [
      ['m_payment_id', reference],
      ['pf_payment_id', 'PF-LITTLE-FEET-001'],
      ['payment_status', 'COMPLETE'],
      ['item_name', 'Micro / ECD'],
      ['item_description', 'Little Feet subscription'],
      ['amount_gross', '400.00'],
      ['amount_fee', '-9.20'],
      ['amount_net', '390.80'],
      ['merchant_id', merchantId]
    ];
    const signature = sign(itnFields);
    const form = parameterString(itnFields) + '&signature=' + signature;
    const itn = await request('/api/payments/payfast/itn', { method:'POST', form });
    assert.equal(itn.response.status, 200, itn.text);
    assert.equal(itn.data.success, true);
    assert.equal(itn.data.duplicate, false);

    const afterPayment = await request('/api/subscription-billing', { cookie:alpha });
    assert.equal(afterPayment.data.subscription.status, 'active');
    assert.equal(afterPayment.data.subscription.allowed, true);
    assert.equal(afterPayment.data.subscription.planCode, 'micro');
    assert.match(afterPayment.data.subscription.activeUntil, /^\d{4}-\d{2}-\d{2}$/);

    const duplicateItn = await request('/api/payments/payfast/itn', { method:'POST', form });
    assert.equal(duplicateItn.response.status, 200);
    assert.equal(duplicateItn.data.duplicate, true);

    const badSignatureForm = parameterString(itnFields) + '&signature=' + '0'.repeat(32);
    const badItn = await request('/api/payments/payfast/itn', { method:'POST', form:badSignatureForm });
    assert.equal(badItn.response.status, 401);

    const alphaAdmin = await login('alpha-admin@example.test','AdminPass1');
    const alphaParent = await login('alpha-parent@example.test','ParentPass1');

    const initialStore = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(initialStore.response.status, 200);
    assert.equal(initialStore.data.products[0].stockQuantity, 10);
    assert.equal(initialStore.data.products[0].physicalStockQuantity, 10);
    assert.equal(initialStore.data.products[0].reservedQuantity, 0);

    const storeOrder = await request('/api/store/orders', {
      method:'POST', cookie:alphaParent, body:{ productId:'alpha-shirt', quantity:2 }
    });
    assert.equal(storeOrder.response.status, 201, storeOrder.text);
    assert.equal(storeOrder.data.order.amount, 100);
    assert.equal(storeOrder.data.order.stockReservationStatus, 'reserved');
    assert.ok(Date.parse(storeOrder.data.reservationExpiresAt) > Date.now());

    const reservedStore = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(reservedStore.data.products[0].stockQuantity, 8);
    assert.equal(reservedStore.data.products[0].physicalStockQuantity, 10);
    assert.equal(reservedStore.data.products[0].reservedQuantity, 2);

    const storePaidFields = [
      ['m_payment_id', storeOrder.data.order.reference],
      ['pf_payment_id', 'PF-STORE-001'],
      ['payment_status', 'COMPLETE'],
      ['item_name', 'Alpha School Shirt'],
      ['item_description', 'Little Feet store order'],
      ['amount_gross', '100.00'],
      ['amount_fee', '-2.30'],
      ['amount_net', '97.70'],
      ['merchant_id', merchantId]
    ];
    const storePaidSignature = sign(storePaidFields);
    const storePaid = await request('/api/payments/payfast/itn', {
      method:'POST', form:parameterString(storePaidFields) + '&signature=' + storePaidSignature
    });
    assert.equal(storePaid.response.status, 200, storePaid.text);
    assert.equal(storePaid.data.success, true);

    const paidInventory = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(paidInventory.data.products[0].stockQuantity, 8);
    assert.equal(paidInventory.data.products[0].physicalStockQuantity, 8);
    assert.equal(paidInventory.data.products[0].reservedQuantity, 0);
    let storeOrders = await request('/api/store/orders', { cookie:alphaAdmin });
    const paidOrder = storeOrders.data.find(order => order.id === storeOrder.data.order.id);
    assert.equal(paidOrder.paymentStatus, 'paid');
    assert.equal(paidOrder.fulfilmentStatus, 'ready_to_prepare');
    assert.match(paidOrder.status, /ready to prepare/i);

    const preparing = await request('/api/store/orders/' + encodeURIComponent(paidOrder.id) + '/fulfilment', {
      method:'PATCH', cookie:alphaAdmin, body:{status:'preparing'}
    });
    assert.equal(preparing.response.status, 200, preparing.text);
    assert.equal(preparing.data.order.fulfilmentStatus, 'preparing');

    const refunded = await request('/api/payments/reconcile', {
      method:'POST', cookie:alphaAdmin, body:{
        eventId:'store-refund-one', reference:storeOrder.data.order.reference,
        status:'refunded', amount:100, bankReference:'REFUND-STORE-001'
      }
    });
    assert.equal(refunded.response.status, 201, refunded.text);
    const refundedInventory = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(refundedInventory.data.products[0].physicalStockQuantity, 10);
    assert.equal(refundedInventory.data.products[0].reservedQuantity, 0);
    storeOrders = await request('/api/store/orders', { cookie:alphaAdmin });
    const refundedOrder = storeOrders.data.find(order => order.id === storeOrder.data.order.id);
    assert.equal(refundedOrder.paymentStatus, 'refunded');
    assert.equal(refundedOrder.fulfilmentStatus, 'refunded');
    assert.match(refundedOrder.status, /stock returned/i);

    const duplicateRefund = await request('/api/payments/reconcile', {
      method:'POST', cookie:alphaAdmin, body:{
        eventId:'store-refund-second-provider-event', reference:storeOrder.data.order.reference,
        status:'refunded', amount:100, bankReference:'REFUND-STORE-001-DUP'
      }
    });
    assert.equal(duplicateRefund.response.status, 200, duplicateRefund.text);
    assert.equal(duplicateRefund.data.duplicate, true);
    const afterDuplicateRefund = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(afterDuplicateRefund.data.products[0].physicalStockQuantity, 10);

    const failedOrder = await request('/api/store/orders', {
      method:'POST', cookie:alphaParent, body:{ productId:'alpha-shirt', quantity:3 }
    });
    assert.equal(failedOrder.response.status, 201, failedOrder.text);
    const failedReserved = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(failedReserved.data.products[0].stockQuantity, 7);
    assert.equal(failedReserved.data.products[0].physicalStockQuantity, 10);
    assert.equal(failedReserved.data.products[0].reservedQuantity, 3);

    const failedFields = [
      ['m_payment_id', failedOrder.data.order.reference],
      ['pf_payment_id', 'PF-STORE-CANCELLED-001'],
      ['payment_status', 'CANCELLED'],
      ['item_name', 'Alpha School Shirt'],
      ['item_description', 'Little Feet store order'],
      ['amount_gross', '150.00'],
      ['amount_fee', '0.00'],
      ['amount_net', '150.00'],
      ['merchant_id', merchantId]
    ];
    const failedSignature = sign(failedFields);
    const failedPayment = await request('/api/payments/payfast/itn', {
      method:'POST', form:parameterString(failedFields) + '&signature=' + failedSignature
    });
    assert.equal(failedPayment.response.status, 200, failedPayment.text);
    assert.equal(failedPayment.data.success, true);
    const afterFailed = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(afterFailed.data.products[0].stockQuantity, 10);
    assert.equal(afterFailed.data.products[0].physicalStockQuantity, 10);
    assert.equal(afterFailed.data.products[0].reservedQuantity, 0);

    const latePaid = await request('/api/payments/reconcile', {
      method:'POST', cookie:alphaAdmin, body:{
        eventId:'store-late-paid-one', reference:failedOrder.data.order.reference,
        status:'paid', amount:150, bankReference:'BANK-STORE-LATE-001'
      }
    });
    assert.equal(latePaid.response.status, 201, latePaid.text);
    const afterLatePaid = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(afterLatePaid.data.products[0].physicalStockQuantity, 7);
    assert.equal(afterLatePaid.data.products[0].reservedQuantity, 0);

    const lateRefund = await request('/api/payments/reconcile', {
      method:'POST', cookie:alphaAdmin, body:{
        eventId:'store-late-refund-one', reference:failedOrder.data.order.reference,
        status:'refunded', amount:150, bankReference:'REFUND-STORE-LATE-001'
      }
    });
    assert.equal(lateRefund.response.status, 201, lateRefund.text);
    const afterLateRefund = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(afterLateRefund.data.products[0].physicalStockQuantity, 10);

    const cancelledOrder = await request('/api/store/orders', {
      method:'POST', cookie:alphaParent, body:{ productId:'alpha-shirt', quantity:4 }
    });
    assert.equal(cancelledOrder.response.status, 201, cancelledOrder.text);
    const beforeCancel = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(beforeCancel.data.products[0].stockQuantity, 6);
    assert.equal(beforeCancel.data.products[0].physicalStockQuantity, 10);
    assert.equal(beforeCancel.data.products[0].reservedQuantity, 4);
    const cancelled = await request('/api/store/orders/' + encodeURIComponent(cancelledOrder.data.order.id) + '/cancel', {
      method:'POST', cookie:alphaParent, body:{}
    });
    assert.equal(cancelled.response.status, 200, cancelled.text);
    const afterCancel = await request('/api/store', { cookie:alphaAdmin });
    assert.equal(afterCancel.data.products[0].stockQuantity, 10);
    assert.equal(afterCancel.data.products[0].physicalStockQuantity, 10);
    assert.equal(afterCancel.data.products[0].reservedQuantity, 0);

    const expiredTrial = await login('expired-trial@example.test','TrialPass1');
    const expiredTrialSession = await request('/api/auth/session', { cookie:expiredTrial });
    assert.equal(expiredTrialSession.data.user.schoolSubscriptionAccess.status, 'trial_expired');
    assert.equal(expiredTrialSession.data.user.schoolSubscriptionAccess.allowed, false);
    assert.equal((await request('/api/posts', { cookie:expiredTrial })).response.status, 402);
    assert.equal((await request('/api/subscription-billing', { cookie:expiredTrial })).response.status, 200);

    const expiredPaid = await login('expired-paid@example.test','PaidPass1');
    const expiredPaidSession = await request('/api/auth/session', { cookie:expiredPaid });
    assert.equal(expiredPaidSession.data.user.schoolSubscriptionAccess.status, 'expired');
    assert.equal(expiredPaidSession.data.user.schoolSubscriptionAccess.allowed, false);
    assert.equal((await request('/api/posts', { cookie:expiredPaid })).response.status, 402);
    assert.equal((await request('/api/subscription-billing', { cookie:expiredPaid })).response.status, 200);

    const incoming = Array.from({ length:216 }, (_, index) => ({
      studentName:'Imported Learner ' + (index + 1),
      className:'Class B',
      parentName:'Imported Parent ' + (index + 1),
      contactEmail:'imported' + index + '@example.test'
    }));
    const imported = await request('/api/students/import', {
      method:'POST', cookie:alpha, body:{ importId:'subscription-limit-job-001', batchNumber:0, totalBatches:1, students:incoming }
    });
    assert.equal(imported.response.status, 201, imported.text);
    assert.equal(imported.data.imported, 215);
    assert.equal(imported.data.rejected.length, 1);
    assert.match(imported.data.rejected[0].reason, /learner limit reached/i);

    const ceilingOrder = await request('/api/subscription-billing/orders', {
      method:'POST', cookie:alpha, body:{ planCode:'micro', lateFeeAccepted:true }
    });
    assert.equal(ceilingOrder.response.status, 201, ceilingOrder.text);
    assert.equal(ceilingOrder.data.order.learnerCount, 250);
    assert.equal(ceilingOrder.data.order.overageLearners, 220);
    assert.equal(ceilingOrder.data.order.monthlyTotal, 2550);

    console.log('Real subscription, expiry, overage, package-limit, PayFast ITN, and school-store stock/payment lifecycle regression test passed.');
  } catch (error) {
    console.error(error);
    if (stderr) console.error(stderr);
    process.exitCode = 1;
  } finally {
    await stop();
    await stopValidation();
    fs.rmSync(temporaryDirectory, { recursive:true, force:true });
  }
})();
