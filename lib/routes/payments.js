// Existing handlers, registered at their original middleware positions.
function registerParentPaymentsParentsRoutes(app, context) {
app.get('/api/parent-payments/parents', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['principal', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'School finance access is required.' });
  res.json(context.db.users.filter(account => account.role === 'parent' && context.isSameSchool(actor, account)).map(account => ({ username: account.username, name: account.name || account.username, linkedLearners: account.linkedLearners || [] })));
});

app.get('/api/parent-payments', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || context.allowedParentPaymentRoles.has(actor.role))) return res.status(403).json({ message: 'Parent payment access is required.' });
  let records = (context.db.parentPayments || []).filter(record => context.recordInSchool(record, actor));
  if (actor.role === 'parent') records = records.filter(record => context.normalizeUsername(record.parentUsername) === context.normalizeUsername(actor.username));
  const payments = records.map(record => context.parentPaymentView(record, actor));
  res.json({ payments, summary: context.parentPaymentSummary(records), ageing: context.parentPaymentAgeing(records), recalculatedAt: new Date().toISOString() });
});

app.post('/api/parent-payments', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['principal', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only a principal, administrator, or school accounts user can create parent payment requests.' });
  const result = context.createParentPaymentRecord(req.body, actor);
  if (result.error) return res.status(400).json({ message: result.error });
  if (!Array.isArray(context.db.parentPayments)) context.db.parentPayments = [];
  context.db.parentPayments.unshift(result.record);
  const schoolRecords = context.db.parentPayments.filter(record => context.recordInSchool(record, actor));
  res.status(201).json({ success: true, payment: context.parentPaymentView(result.record, actor), summary: context.parentPaymentSummary(schoolRecords), ageing: context.parentPaymentAgeing(schoolRecords) });
});

app.post('/api/parent-payments/:id/acknowledge', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || actor.role !== 'parent') return res.status(403).json({ message: 'Only the parent account can confirm this payment request.' });
  const record = (context.db.parentPayments || []).find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor) && context.normalizeUsername(entry.parentUsername) === context.normalizeUsername(actor.username));
  const signature = String(req.body?.signature || '').trim().slice(0, 160);
  if (!record || !signature) return res.status(400).json({ message: 'A parent signature is required.' });
  record.parentSignature = signature; record.parentSignedAt = new Date().toISOString();
  res.json({ success: true, payment: context.parentPaymentView(record, actor) });
});
}

function registerPaymentsLedgerRoutes(app, context) {
app.get('/api/payments/ledger', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['admin', 'principal', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'School finance access is required.' });
  res.json((context.db.paymentLedger || []).filter(entry => entry.schoolId === context.accountSchoolId(actor)));
});

app.post('/api/payments/reconcile', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['principal', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only a principal, administrator, or school accounts user can reconcile a school payment.' });
  const eventId = String(req.body?.eventId || '').trim().slice(0, 160);
  if (!eventId) return res.status(400).json({ message: 'A unique reconciliation event ID is required.' });
  const result = context.applyPaymentEvent({
    eventId: `manual:${context.accountSchoolId(actor)}:${eventId}`,
    reference: req.body?.reference,
    status: req.body?.status,
    amount: req.body?.amount,
    providerTransactionId: req.body?.bankReference,
    source: 'manual-bank-reconciliation',
    receivedAt: new Date().toISOString()
  }, actor);
  if (result.error) return res.status(400).json({ message: result.error });
  res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate, event: result.event });
});

app.get('/api/payments/payfast/checkout', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).send('Sign in to continue to payment.');
  if (!context.payFastConfigured()) return res.status(503).send('PayFast automatic payment confirmation is not configured.');
  const reference = String(req.query?.reference || '').trim().toUpperCase();
  const target = context.findPaymentTarget(reference, actor);
  if (!target) return res.status(404).send('Payment request not found.');
  const billing = context.subscriptionBillingState(actor);
  if (billing.payment.method !== 'payfast') return res.status(409).send('This payment request is not configured for PayFast.');
  const amount = context.expectedPaymentAmount(target);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).send('Payment amount is invalid.');
  const origin = context.publicOrigin();
  const nameParts = String(actor.name || actor.username || 'Little Feet customer').trim().split(/\s+/);
  const fields = [
    ['merchant_id', String(process.env.LF_PAYFAST_MERCHANT_ID || '')],
    ['merchant_key', String(process.env.LF_PAYFAST_MERCHANT_KEY || '')],
    ['return_url', `${origin}/?payment=complete&reference=${encodeURIComponent(reference)}`],
    ['cancel_url', `${origin}/?payment=cancelled&reference=${encodeURIComponent(reference)}`],
    ['notify_url', `${origin}/api/payments/payfast/itn`],
    ['name_first', nameParts[0] || 'Customer'],
    ['name_last', nameParts.slice(1).join(' ') || ''],
    ['email_address', /^\S+@\S+\.\S+$/.test(String(actor.username || '')) ? actor.username : ''],
    ['m_payment_id', reference],
    ['amount', amount.toFixed(2)],
    ['item_name', String(target.record.planName || target.record.description || target.record.productName || 'Little Feet payment').slice(0, 100)],
    ['item_description', `Little Feet ${target.type.replaceAll('_', ' ')} · ${reference}`.slice(0, 255)]
  ];
  const signature = context.payFastSignature(fields);
  const hiddenFields = [...fields, ['signature', signature]].filter(([, value]) => value !== '').map(([name, value]) => `<input type="hidden" name="${context.htmlAttributeEscape(name)}" value="${context.htmlAttributeEscape(value)}">`).join('');
  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Continue to PayFast</title></head><body><form id="payfast" method="post" action="${context.htmlAttributeEscape(context.payFastProcessUrl())}">${hiddenFields}<noscript><button type="submit">Continue to PayFast</button></noscript></form><script>document.getElementById('payfast').submit();</script></body></html>`);
});

app.post('/api/payments/payfast/itn', async (req, res) => {
  if (!context.payFastConfigured()) return res.status(503).send('PayFast is not configured.');
  const entries = context.payFastRawEntries(req);
  const data = Object.fromEntries(entries);
  const suppliedSignature = String(data.signature || '').trim().toLowerCase();
  const merchantId = String(data.merchant_id || '').trim();
  const reference = String(data.m_payment_id || '').trim().toUpperCase();
  const providerPaymentId = String(data.pf_payment_id || '').trim();
  const amount = Number(data.amount_gross);
  if (merchantId !== String(process.env.LF_PAYFAST_MERCHANT_ID || '').trim()) return res.status(401).send('Invalid merchant.');
  if (!/^[0-9a-f]{32}$/.test(suppliedSignature)) return res.status(401).send('Invalid signature.');
  const unsignedEntries = entries.filter(([key]) => key !== 'signature');
  const paramString = context.payFastParamString(unsignedEntries);
  const expectedSignature = context.crypto.createHash('md5').update(`${paramString}&passphrase=${context.payFastUrlEncode(String(process.env.LF_PAYFAST_PASSPHRASE || ''))}`).digest('hex');
  const suppliedBuffer = Buffer.from(suppliedSignature, 'hex'), expectedBuffer = Buffer.from(expectedSignature, 'hex');
  if (suppliedBuffer.length !== expectedBuffer.length || !context.crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return res.status(401).send('Invalid signature.');
  if (!await context.payFastSourceIsValid(req)) return res.status(401).send('Invalid PayFast source.');
  const target = context.findPaymentTarget(reference);
  if (!target) return res.status(404).send('Unknown payment reference.');
  const expectedAmount = context.expectedPaymentAmount(target);
  if (!Number.isFinite(amount) || Math.abs(amount - expectedAmount) > 0.01) return res.status(400).send('Payment amount mismatch.');
  let confirmed = false;
  try { confirmed = await context.payFastServerValidates(paramString); } catch (error) {
    context.logStructured('error', 'payments.payfast_validation_failed', { category: 'payments', message: error.message, result: 'failed' });
    return res.status(503).send('Unable to validate payment with PayFast.');
  }
  if (!confirmed) return res.status(401).send('PayFast did not validate this notification.');
  const paymentStatus = String(data.payment_status || '').trim().toUpperCase();
  if (paymentStatus !== 'COMPLETE' && paymentStatus !== 'CANCELLED') return res.status(200).send('IGNORED');
  const result = context.applyPaymentEvent({
    eventId: `payfast:${providerPaymentId || context.crypto.createHash('sha256').update(paramString).digest('hex').slice(0, 32)}`,
    reference,
    status: paymentStatus === 'COMPLETE' ? 'paid' : 'failed',
    amount,
    providerTransactionId: providerPaymentId,
    source: 'payfast-itn',
    receivedAt: new Date().toISOString()
  });
  if (result.error) return res.status(400).send(result.error);
  res.status(200).json({ success: true, duplicate: result.duplicate });
});

app.post('/api/payments/webhook', (req, res) => {
  const secret = String(process.env.LF_PAYMENT_WEBHOOK_SECRET || '');
  if (!secret) return res.status(503).json({ message: 'Payment webhook processing is not configured.' });
  const supplied = String(req.get('x-little-feet-signature') || '').trim().toLowerCase().replace(/^sha256=/, '');
  if (!/^[0-9a-f]{64}$/.test(supplied)) return res.status(401).json({ message: 'Invalid payment webhook signature.' });
  const expected = context.crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from('')).digest('hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (suppliedBuffer.length !== expectedBuffer.length || !context.crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    return res.status(401).json({ message: 'Invalid payment webhook signature.' });
  }
  const eventId = String(req.body?.eventId || '').trim().slice(0, 160);
  if (!eventId) return res.status(400).json({ message: 'A provider event ID is required.' });
  const result = context.applyPaymentEvent({
    eventId: `webhook:${eventId}`,
    reference: req.body?.reference,
    status: req.body?.status,
    amount: req.body?.amount,
    providerTransactionId: req.body?.transactionId,
    source: String(req.body?.provider || 'payment-webhook').trim().slice(0, 80),
    receivedAt: String(req.body?.occurredAt || '').trim() || new Date().toISOString()
  });
  if (result.error) return res.status(400).json({ message: result.error });
  res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate });
});

app.get('/api/donations/payment', (req, res) => {
  const billing = context.donationBillingState();
  res.json({ configured: context.billingPaymentConfigured(billing.payment), method: billing.payment.method });
});

app.post('/api/donations/intents', (req, res) => {
  const amount = context.billingAmount(req.body?.amount);
  if (amount === null || amount <= 0) return res.status(400).json({ message: 'Enter a donation amount greater than zero.' });
  const billing = context.donationBillingState();
  if (!context.billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'Donations are not available until an administrator configures the payment destination.' });
  const donorName = String(req.body?.donorName || '').trim().slice(0, 120);
  const donorEmail = String(req.body?.donorEmail || '').trim().slice(0, 160);
  const reference = `${billing.payment.referencePrefix}-DONATE-${context.crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const donation = { id: context.crypto.randomUUID(), reference, amount, donorName, donorEmail, status: 'awaiting payment', createdAt: new Date().toISOString() };
  if (!Array.isArray(context.db.donations)) context.db.donations = [];
  context.db.donations.unshift(donation);
  res.status(201).json({ success: true, donation, payment: context.paymentInstructions(billing, reference) });
});
}

module.exports = { registerParentPaymentsParentsRoutes, registerPaymentsLedgerRoutes };
