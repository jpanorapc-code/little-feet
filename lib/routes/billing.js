// Existing handlers, registered at their original middleware positions.
function registerSubscriptionBillingRoutes(app, context) {
app.get('/api/subscription-billing', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view subscription billing.' });
  if (!(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'district', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'School subscription information is available to authorised school staff only.' });
  const billing = context.subscriptionBillingState(actor);
  const isAdmin = context.isAdminLike(actor);
  const school = context.db.schools.find(entry => entry.id === context.accountSchoolId(actor));
  const { accountNumberEncrypted, payMePayloadEncrypted, ...adminPayment } = billing.payment;
  res.json({
    pricing: context.publicBillingPricing(billing, isAdmin),
    plans: context.schoolSubscriptionPlans.map(plan => ({ ...plan })),
    paymentConfigured: context.billingPaymentConfigured(billing.payment),
    payfastAvailable: context.payFastConfigured(),
    subscription: school ? {
      ...context.schoolSubscriptionAccessState(actor),
      learnerCount: context.schoolLearnerCount(context.accountSchoolId(actor)),
      learnerCapacity: Number(school.subscriptionLearnerCapacity || 0),
      hardMaxLearners: Number(school.subscriptionHardMaxLearners || 0)
    } : { allowed: false, active: false, status: 'unverified', planCode: '', activeUntil: '', trialEndsAt: '' },
    payment: isAdmin ? { ...adminPayment, accountNumber: context.decryptField(accountNumberEncrypted), capitecPayMeConfigured: Boolean(context.decryptField(payMePayloadEncrypted)) } : undefined,
    orders: billing.orders.filter(order => !order.schoolId || order.schoolId === context.accountSchoolId(actor)).map(order => ({ ...order, profitMargin: isAdmin ? order.profitMargin : undefined }))
  });
});

app.put('/api/subscription-billing', async (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator can change subscription pricing or payment details.' });
  const baseMonthly = context.billingAmount(req.body?.baseMonthly);
  const lateFee = context.billingAmount(req.body?.lateFee);
  const bundles = {};
  for (const capacity of context.billingBundleSizes) {
    const costPrice = context.billingAmount(req.body?.bundles?.[capacity]?.costPrice);
    const sellingPrice = context.billingAmount(req.body?.bundles?.[capacity]?.sellingPrice);
    if (costPrice === null || sellingPrice === null || sellingPrice < costPrice) return res.status(400).json({ message: `Set a valid selling price at or above the cost price for the ${capacity}-learner bundle.` });
    bundles[capacity] = { costPrice, sellingPrice };
  }
  if (baseMonthly === null || lateFee === null) return res.status(400).json({ message: 'Enter valid non-negative pricing amounts.' });
  const requestedPaymentMethod = String(req.body?.payment?.method || 'payment_link').trim().toLowerCase();
  const paymentMethod = ['bank_transfer', 'payfast'].includes(requestedPaymentMethod) ? requestedPaymentMethod : 'payment_link';
  const rawPaymentLink = context.limitedText(req.body?.payment?.paymentLink || '', 2048);
  const accountName = context.limitedText(req.body?.payment?.accountName || '', 160);
  const bankName = context.limitedText(req.body?.payment?.bankName || '', 160);
  const accountNumber = context.limitedText(req.body?.payment?.accountNumber || '', 64);
  const branchCode = context.limitedText(req.body?.payment?.branchCode || '', 32);
  const referencePrefix = String(req.body?.payment?.referencePrefix || 'LF').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) || 'LF';
  if (rawPaymentLink === null || accountName === null || bankName === null || accountNumber === null || branchCode === null) {
    return res.status(400).json({ message: 'Payment configuration contains a field that is too long.' });
  }
  const paymentLink = rawPaymentLink ? context.safeHttpsUrl(rawPaymentLink) : '';
  if (paymentMethod === 'payment_link') {
    if (!paymentLink) return res.status(400).json({ message: 'Enter a valid HTTPS payment link without embedded credentials.' });
  } else if (paymentMethod === 'payfast') {
    if (!context.payFastConfigured()) return res.status(409).json({ message: 'PayFast automatic confirmation is not configured on the server yet.' });
  } else if (!accountName || !bankName || !accountNumber) {
    return res.status(400).json({ message: 'Account name, bank name, and account number are required for bank transfers.' });
  }
  const billing = context.subscriptionBillingState(actor);
  const paymentInput = req.body?.payment || {};
  const hasPayMePayload = Object.prototype.hasOwnProperty.call(paymentInput, 'capitecPayMePayload');
  const capitecPayMePayload = String(paymentInput.capitecPayMePayload || '').trim();
  if (capitecPayMePayload && (!capitecPayMePayload.startsWith('000201') || !capitecPayMePayload.includes('za.co.capitec.electrum.payme') || capitecPayMePayload.length > 512)) {
    return res.status(400).json({ message: 'Enter a valid Capitec Pay Me QR payload.' });
  }
  const payMePayloadEncrypted = hasPayMePayload
    ? (capitecPayMePayload ? context.encryptField(capitecPayMePayload) : '')
    : String(billing.payment.payMePayloadEncrypted || '');
  billing.pricing = { baseMonthly, bundles, lateFeeEnabled: Boolean(req.body?.lateFeeEnabled), lateFee };
  billing.payment = { method: paymentMethod, paymentLink: paymentMethod === 'payment_link' ? paymentLink : '', accountName: paymentMethod === 'bank_transfer' ? accountName : '', bankName: paymentMethod === 'bank_transfer' ? bankName : '', accountNumberEncrypted: paymentMethod === 'bank_transfer' ? context.encryptField(accountNumber) : '', payMePayloadEncrypted: paymentMethod === 'bank_transfer' ? payMePayloadEncrypted : '', branchCode: paymentMethod === 'bank_transfer' ? branchCode : '', referencePrefix };
  billing.updatedAt = new Date().toISOString();
  context.db.subscriptionBilling = {
    ...billing,
    pricing: { ...billing.pricing, bundles: { ...billing.pricing.bundles } },
    payment: { ...billing.payment },
    orders: Array.isArray(context.db.subscriptionBilling?.orders) ? context.db.subscriptionBilling.orders : []
  };
  // Payment destinations must survive a restart. Commit this high-value setting
  // before acknowledging the request instead of relying only on the normal
  // post-response persistence queue.
  await context.saveDatabaseState();
  if (context.postgresPool) {
    const schoolBillingKey = `schoolBilling:${context.accountSchoolId(actor)}`;
    const persisted = await context.postgresPool.query(
      'SELECT state_key, payload FROM little_feet_metadata WHERE state_key = ANY($1::text[])',
      [[schoolBillingKey, 'subscriptionBilling']]
    );
    const destinationStored = persisted.rows.some(row => context.billingPaymentConfigured(row.payload?.payment || {}));
    if (!destinationStored) throw new Error('The payment destination could not be confirmed in persistent storage.');
  }
  context.writeReplicaSnapshot();
  req.persistenceCommitted = true;
  res.json({ success: true, pricing: context.publicBillingPricing(billing, true), paymentConfigured: true });
});

app.post('/api/subscription-billing/orders', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['principal', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Only a principal, administrator, or school accounts user can create a school subscription payment request.' });
  const requestedPlanCode = String(req.body?.planCode || '').trim().toLowerCase();
  const requestedPlan = context.schoolSubscriptionPlans.find(plan => plan.code === requestedPlanCode);
  if (requestedPlanCode && !requestedPlan) return res.status(400).json({ message: 'Choose a valid school subscription plan.' });
  const requestedBundle = Number(req.body?.bundleCapacity || 0);
  if (!requestedPlan && ![0, ...context.billingBundleSizes].includes(requestedBundle)) return res.status(400).json({ message: 'Choose a valid extra-learner bundle.' });
  const billing = context.subscriptionBillingState(actor);
  if (!context.billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'The payment destination must be configured by an administrator first.' });
  const bundle = requestedBundle ? billing.pricing.bundles[requestedBundle] : { costPrice: 0, sellingPrice: 0 };
  if (!requestedPlan && billing.pricing.baseMonthly <= 0) return res.status(409).json({ message: 'Choose one of the published school plans.' });
  if (!requestedPlan && requestedBundle && bundle.sellingPrice <= 0) return res.status(409).json({ message: 'That learner bundle is not available yet. Ask an administrator to set its selling price.' });
  const reference = `${billing.payment.referencePrefix}-${context.crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const currentLearners = context.schoolLearnerCount(context.accountSchoolId(actor));
  if (requestedPlan && currentLearners > requestedPlan.hardMaxLearners) {
    return res.status(409).json({ message: `${requestedPlan.name} supports up to ${requestedPlan.hardMaxLearners.toLocaleString('en-ZA')} learners including paid overage. Choose a larger package.` });
  }
  const planCharge = requestedPlan ? context.planPriceForLearners(requestedPlan, currentLearners) : null;
  const monthlyTotal = requestedPlan ? planCharge.monthlyTotal : Math.round((billing.pricing.baseMonthly + bundle.sellingPrice) * 100) / 100;
  const order = {
    id: context.crypto.randomUUID(), reference, schoolId: context.accountSchoolId(actor), schoolName: actor.schoolName, requestedBy: actor.username,
    planCode: requestedPlan?.code || '', planName: requestedPlan?.name || '', learnerCapacity: requestedPlan?.maxLearners || 0,
    hardMaxLearners: requestedPlan?.hardMaxLearners || 0, learnerCount: requestedPlan ? currentLearners : 0,
    overageLearners: requestedPlan ? planCharge.overageLearners : 0, overageRate: requestedPlan ? planCharge.overageRate : 0,
    baseMonthly: requestedPlan ? requestedPlan.monthlyPrice : billing.pricing.baseMonthly, bundleCapacity: requestedPlan ? 0 : requestedBundle, bundlePrice: requestedPlan ? 0 : bundle.sellingPrice,
    monthlyTotal, lateFeeAccepted: Boolean(req.body?.lateFeeAccepted), lateFee: Boolean(req.body?.lateFeeAccepted) && billing.pricing.lateFeeEnabled ? billing.pricing.lateFee : 0,
    profitMargin: requestedPlan ? 0 : Math.round((bundle.sellingPrice - bundle.costPrice) * 100) / 100,
    status: 'awaiting_payment', paymentStatus: 'awaiting_payment', createdAt: new Date().toISOString()
  };
  billing.orders.unshift(order);
  res.status(201).json({ success: true, order: { ...order, profitMargin: undefined }, payment: context.paymentInstructions(billing, reference) });
});
}

function registerParentSubscriptionRoutes(app, context) {
app.get('/api/parent-subscription', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['parent', 'admin', 'staff', 'school_accounts'].includes(actor.role))) return res.status(403).json({ message: 'Parent subscription access is required.' });
  const records = (context.db.parentSubscriptions || []).filter(record => context.recordInSchool(record, actor) && (context.isAdminLike(actor) || context.normalizeUsername(record.parentUsername) === context.normalizeUsername(actor.username)));
  res.json({ active: context.isAdminLike(actor) ? undefined : context.parentSubscriptionActive(actor), pricePerChild: 29, latest: records[0] ? { reference: records[0].reference, status: records[0].paymentStatus, amount: records[0].amount, createdAt: records[0].createdAt } : null, parents: context.isAdminLike(actor) ? context.db.users.filter(account => account.role === 'parent' && context.isSameSchool(actor, account)).map(account => ({ username: account.username, name: account.name, active: context.parentSubscriptionActive(account), status: account.parentSubscriptionStatus || 'basic', grantedUntil: account.parentSubscriptionGrantedUntil || '' })) : undefined, paymentConfigured: context.billingPaymentConfigured(context.subscriptionBillingState(actor).payment) });
});

app.post('/api/parent-subscription/orders', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || actor.role !== 'parent') return res.status(403).json({ message: 'Only a parent can start a parent subscription.' });
  const billing = context.subscriptionBillingState(actor);
  if (!context.billingPaymentConfigured(billing.payment)) return res.status(409).json({ message: 'The school payment destination is not configured yet.' });
  const children = Math.max(1, Math.min(4, (actor.linkedLearners || []).length));
  const amount = children * 29;
  const reference = `${billing.payment.referencePrefix}-PLUS-${context.crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const order = context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), reference, parentUsername: actor.username, parentName: actor.name || actor.username, children, amount, paymentStatus: 'awaiting_payment', termDays: 30, createdAt: new Date().toISOString() });
  if (!Array.isArray(context.db.parentSubscriptions)) context.db.parentSubscriptions = [];
  context.db.parentSubscriptions.unshift(order);
  res.status(201).json({ success: true, order, payment: context.paymentInstructions(billing, reference) });
});
}

module.exports = { registerSubscriptionBillingRoutes, registerParentSubscriptionRoutes };
