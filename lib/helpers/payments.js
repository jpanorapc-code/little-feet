// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const payFastConfigured = () => Boolean(
  process.env.LF_PAYFAST_MERCHANT_ID && process.env.LF_PAYFAST_MERCHANT_KEY && process.env.LF_PAYFAST_PASSPHRASE
  && (!context.isProduction || context.payFastMode === 'live')
);

const payFastHost = () => context.payFastMode === 'sandbox' ? 'sandbox.payfast.co.za' : 'www.payfast.co.za';

const payFastProcessUrl = () => `https://${context.payFastHost()}/eng/process`;

const payFastValidationUrl = () => process.env.NODE_ENV === 'test' && process.env.LF_PAYFAST_TEST_VALIDATION_URL
  ? String(process.env.LF_PAYFAST_TEST_VALIDATION_URL)
  : `https://${context.payFastHost()}/eng/query/validate`;

const payFastUrlEncode = value => encodeURIComponent(String(value ?? '').trim())
  .replace(/%20/g, '+')
  .replace(/[!'()*~]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  .replace(/%[0-9a-f]{2}/gi, token => token.toUpperCase());

const payFastParamString = (entries, passphrase = '') => {
  const pairs = [];
  for (const [key, value] of entries) {
    if (key === 'signature' || value === '' || value == null) continue;
    pairs.push(`${key}=${context.payFastUrlEncode(value)}`);
  }
  if (passphrase) pairs.push(`passphrase=${context.payFastUrlEncode(passphrase)}`);
  return pairs.join('&');
};

const payFastSignature = entries => context.crypto.createHash('md5')
  .update(context.payFastParamString(entries, String(process.env.LF_PAYFAST_PASSPHRASE || '')))
  .digest('hex');

const payFastRawEntries = req => {
  if (Buffer.isBuffer(req.rawBody) && req.rawBody.length) return [...new URLSearchParams(req.rawBody.toString('utf8')).entries()];
  return Object.entries(req.body || {}).map(([key, value]) => [key, String(value ?? '')]);
};

const payFastSourceIsValid = async req => {
  if (process.env.NODE_ENV === 'test' && process.env.LF_PAYFAST_TEST_ALLOW_LOCAL_ITN === '1') return true;
  const sourceIp = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (context.PAYFAST_PUBLISHED_CIDRS.some(cidr => context.ipv4InCidr(sourceIp, cidr))) return true;
  if (context.payFastResolvedIps.expiresAt <= Date.now()) {
    const hosts = ['www.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za', ...(context.payFastMode === 'sandbox' ? ['sandbox.payfast.co.za'] : [])];
    const resolved = (await Promise.all(hosts.map(host => context.dns.resolve4(host).catch(() => [])))).flat();
    context.payFastResolvedIps = { expiresAt: Date.now() + (10 * 60 * 1000), values: new Set(resolved) };
  }
  return context.payFastResolvedIps.values.has(sourceIp);
};

const payFastServerValidates = async paramString => {
  const response = await fetch(context.payFastValidationUrl(), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: paramString,
    signal: AbortSignal.timeout(10000)
  });
  return response.ok && String(await response.text()).trim() === 'VALID';
};

const billingPaymentConfigured = (payment) => payment?.method === 'payfast'
  ? context.payFastConfigured()
  : payment?.method === 'payment_link'
    ? Boolean(payment.paymentLink)
    : Boolean(payment?.accountName && payment?.bankName && payment?.accountNumberEncrypted);

const donationBillingState = () => {
  const globalBilling = context.subscriptionBillingState();
  if (context.billingPaymentConfigured(globalBilling.payment)) return globalBilling;
  const configuredSchoolBilling = Object.values(context.db.schoolBilling || {}).find(state => context.billingPaymentConfigured(state?.payment || {}));
  return configuredSchoolBilling || globalBilling;
};

const paymentInstructions = (billing, reference) => {
  const payment = billing.payment;
  if (payment.method === 'payfast') return { method: 'PayFast', provider: 'payfast', automaticConfirmation: true, paymentLink: `/api/payments/payfast/checkout?reference=${encodeURIComponent(reference)}`, reference };
  if (payment.method === 'payment_link') return { method: 'Online payment', paymentLink: payment.paymentLink, reference };
  return {
    method: 'Bank transfer', accountName: payment.accountName, bankName: payment.bankName,
    accountNumber: context.decryptField(payment.accountNumberEncrypted), branchCode: payment.branchCode, reference,
    capitecPayMePayload: context.decryptField(payment.payMePayloadEncrypted)
  };
};

const cents = value => Math.round(Number(value || 0) * 100) / 100;

const parentPaymentAmount = record => context.billingAmount(record.arrangementAmount) > 0 ? context.billingAmount(record.arrangementAmount) : (context.billingAmount(record.amountDue) || 0);

const parentPaymentDueDate = record => {
  const original = context.validDateKey(record.dueDate) || context.dateKeyInSouthAfrica();
  const arrangement = context.validDateKey(record.arrangementDueDate);
  return arrangement && arrangement > original ? arrangement : original;
};

const parentPaymentFinancials = (record, asOf = context.dateKeyInSouthAfrica()) => {
  const originalEffectiveAmount = context.parentPaymentAmount(record);
  const creditTotal = context.cents((context.db.financeAdjustments || [])
    .filter(adjustment => adjustment.type === 'credit' && adjustment.schoolId === record.schoolId && String(adjustment.reference || '').toUpperCase() === String(record.reference || '').toUpperCase())
    .reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0));
  const amountDue = Math.max(0, context.cents(originalEffectiveAmount - creditTotal));
  const events = (context.db.paymentEvents || []).filter(event => event.targetType === 'parent_payment' && event.schoolId === record.schoolId && String(event.reference || '').toUpperCase() === String(record.reference || '').toUpperCase());
  const paid = context.cents(events.filter(event => event.status === 'paid').reduce((sum, event) => sum + Number(event.amount || 0), 0));
  const refunded = context.cents(events.filter(event => event.status === 'refunded').reduce((sum, event) => sum + Number(event.amount || 0), 0));
  const paidAmount = Math.max(0, context.cents(paid - refunded));
  const balance = Math.max(0, context.cents(amountDue - paidAmount));
  const effectiveDueDate = context.parentPaymentDueDate(record);
  const overdue = balance > 0 && effectiveDueDate < asOf;
  const daysPastDue = overdue
    ? Math.max(1, Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(effectiveDueDate + 'T00:00:00Z')) / 86400000))
    : 0;
  return {
    amountDue, originalAmount: context.billingAmount(record.amountDue) || amountDue,
    effectiveAmountBeforeCredits: originalEffectiveAmount, creditTotal,
    arrangementAmount: context.billingAmount(record.arrangementAmount) || null,
    paidAmount, balance, arrears: overdue ? balance : 0, dueDate: context.validDateKey(record.dueDate),
    effectiveDueDate, daysPastDue, status: balance <= 0 ? 'paid' : overdue ? 'in_arrears' : paidAmount > 0 ? 'partially_paid' : 'awaiting_payment',
    arrangementActive: Boolean(context.validDateKey(record.arrangementDueDate) && effectiveDueDate === record.arrangementDueDate && effectiveDueDate >= asOf),
    arrangementNote: String(record.arrangementNote || '').trim()
  };
};

const parentPaymentSummary = records => (records || []).reduce((summary, record) => {
  const financials = context.parentPaymentFinancials(record);
  summary.count += 1;
  summary.amountDue = context.cents(summary.amountDue + financials.amountDue);
  summary.paidAmount = context.cents(summary.paidAmount + financials.paidAmount);
  summary.balance = context.cents(summary.balance + financials.balance);
  summary.arrears = context.cents(summary.arrears + financials.arrears);
  if (financials.status === 'paid') summary.paid += 1;
  else if (financials.status === 'in_arrears') summary.inArrears += 1;
  return summary;
}, { count: 0, paid: 0, inArrears: 0, amountDue: 0, paidAmount: 0, balance: 0, arrears: 0 });

const parentPaymentAgeing = records => {
  const buckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, totalOpen: 0 };
  (records || []).forEach(record => {
    const financials = context.parentPaymentFinancials(record);
    if (financials.balance <= 0) return;
    buckets.totalOpen = context.cents(buckets.totalOpen + financials.balance);
    if (!financials.daysPastDue) buckets.current = context.cents(buckets.current + financials.balance);
    else if (financials.daysPastDue <= 30) buckets.days1to30 = context.cents(buckets.days1to30 + financials.balance);
    else if (financials.daysPastDue <= 60) buckets.days31to60 = context.cents(buckets.days31to60 + financials.balance);
    else if (financials.daysPastDue <= 90) buckets.days61to90 = context.cents(buckets.days61to90 + financials.balance);
    else buckets.days90plus = context.cents(buckets.days90plus + financials.balance);
  });
  return buckets;
};

const parentPaymentView = (record, actor) => {
  const financials = context.parentPaymentFinancials(record);
  const paymentHistory = (context.db.paymentEvents || []).filter(event => event.targetType === 'parent_payment' && event.schoolId === record.schoolId && String(event.reference || '').toUpperCase() === String(record.reference || '').toUpperCase()).map(event => ({ amount: context.billingAmount(event.amount) || 0, status: event.status, receivedAt: event.receivedAt, providerTransactionId: event.providerTransactionId || '' }));
  return {
    id: record.id, reference: record.reference, parentUsername: record.parentUsername, parentName: record.parentName,
    learnerName: record.learnerName, description: record.description, createdAt: record.createdAt, createdBy: record.createdBy, parentSignature: record.parentSignature || '', parentSignedAt: record.parentSignedAt || '',
    ...financials, paymentHistory, payment: context.paymentInstructions(context.subscriptionBillingState(actor), record.reference)
  };
};

const canonicalPaymentStatus = value => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const findPaymentTarget = (reference, actor = null) => {
  const cleanReference = String(reference || '').trim().toUpperCase();
  if (!cleanReference) return null;
  const schoolId = actor ? context.accountSchoolId(actor) : null;
  for (const [billingSchoolId, billing] of Object.entries(context.db.schoolBilling || {})) {
    if (schoolId && billingSchoolId !== schoolId) continue;
    const order = (billing.orders || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference);
    if (order) return { type: 'subscription', record: order, schoolId: billingSchoolId };
  }
  const parentSubscription = (context.db.parentSubscriptions || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference && (!schoolId || entry.schoolId === schoolId));
  if (parentSubscription) return { type: 'parent_subscription', record: parentSubscription, schoolId: parentSubscription.schoolId };
  const parentPayment = (context.db.parentPayments || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference && (!schoolId || entry.schoolId === schoolId));
  if (parentPayment) return { type: 'parent_payment', record: parentPayment, schoolId: parentPayment.schoolId };
  const storeOrder = (context.db.storeOrders || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference && (!schoolId || entry.schoolId === schoolId));
  if (storeOrder) return { type: 'store', record: storeOrder, schoolId: storeOrder.schoolId };
  const donation = (context.db.donations || []).find(entry => String(entry.reference || '').toUpperCase() === cleanReference);
  if (donation && !actor) return { type: 'donation', record: donation, schoolId: donation.schoolId || '' };
  return null;
};

const expectedPaymentAmount = target => Number(target.type === 'subscription' ? target.record.monthlyTotal : target.type === 'parent_payment' ? context.parentPaymentAmount(target.record) : target.record.amount);

const applyStorePaymentState = (target, normalStatus, timestamp) => {
  const order = target.record;
  const quantity = Math.max(0, Number.parseInt(order?.quantity, 10) || 0);
  const product = context.storeProductForOrder(order);

  if (normalStatus === 'paid') {
    if (order.stockAccountingVersion === 2) {
      if (order.stockReservationStatus === 'reserved') {
        if (product) {
          product.stockQuantity = Math.max(0, (Number(product.stockQuantity) || 0) - quantity);
          product.reservedQuantity = Math.max(0, (Number(product.reservedQuantity) || 0) - quantity);
        }
        order.stockReservationStatus = 'consumed';
        order.stockConsumedAt = timestamp;
      } else if (['released', 'expired'].includes(order.stockReservationStatus)) {
        if (product && context.storeAvailableQuantity(product) >= quantity) {
          product.stockQuantity = Math.max(0, (Number(product.stockQuantity) || 0) - quantity);
          order.stockReservationStatus = 'consumed_after_release';
          order.stockConsumedAt = timestamp;
        } else {
          order.stockReservationStatus = 'paid_stock_review';
        }
      }
    } else {
      order.stockReservationStatus = order.stockReservationStatus || 'consumed_legacy';
    }
    const needsReview = order.stockReservationStatus === 'paid_stock_review';
    order.status = needsReview ? 'paid - stock review required' : 'paid - ready to prepare';
    order.fulfilmentStatus = needsReview ? 'stock_review_required' : 'ready_to_prepare';
    context.updateStoreRoomRecord(
      order,
      needsReview ? 'PAID · STOCK REVIEW REQUIRED' : 'PAID · READY TO PREPARE',
      `Paid store order · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`
    );
    return;
  }

  if (normalStatus === 'failed') {
    context.releaseStoreReservation(order, timestamp, 'failed');
    return;
  }

  if (normalStatus === 'refunded') {
    if (order.stockAccountingVersion === 2 && ['consumed', 'consumed_after_release'].includes(order.stockReservationStatus)) {
      if (product) product.stockQuantity = Math.max(0, (Number(product.stockQuantity) || 0) + quantity);
      order.stockReservationStatus = 'returned';
      order.stockReturnedAt = timestamp;
      order.status = 'refunded - stock returned';
      order.fulfilmentStatus = 'refunded';
      context.updateStoreRoomRecord(order, 'Refunded · stock returned', `Store refund confirmed · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
    } else if (order.stockReservationStatus === 'paid_stock_review') {
      order.status = 'refunded - no stock adjustment required';
      order.fulfilmentStatus = 'refunded';
      order.stockReservationStatus = 'refunded_without_stock';
      order.stockReturnedAt = timestamp;
      context.updateStoreRoomRecord(order, 'Refunded · no stock adjustment', `Store refund confirmed · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
    } else {
      context.releaseStoreReservation(order, timestamp, 'refunded');
    }
  }
};

const applyPaymentEvent = ({ eventId, reference, status, amount, providerTransactionId, source, receivedAt }, actor = null) => {
  if (!Array.isArray(context.db.paymentEvents)) context.db.paymentEvents = [];
  if (!Array.isArray(context.db.paymentLedger)) context.db.paymentLedger = [];
  const existing = context.db.paymentEvents.find(event => event.eventId === eventId);
  if (existing) return { duplicate: true, event: existing };
  const target = context.findPaymentTarget(reference, actor);
  if (!target) return { error: 'Payment reference was not found.' };
  const numericAmount = context.billingAmount(amount);
  const expectedAmount = context.expectedPaymentAmount(target);
  const normalStatus = context.canonicalPaymentStatus(status);
  if (!context.paymentStatuses.has(normalStatus)) return { error: 'Payment status is not supported.' };
  const settledEvent = context.db.paymentEvents.find(event => event.status === 'paid'
    && event.targetType === target.type && event.schoolId === target.schoolId
    && String(event.reference || '').toUpperCase() === String(target.record.reference || '').toUpperCase());
  const refundedEvent = context.db.paymentEvents.find(event => event.status === 'refunded'
    && event.targetType === target.type && event.schoolId === target.schoolId
    && String(event.reference || '').toUpperCase() === String(target.record.reference || '').toUpperCase());
  if (normalStatus === 'paid' && settledEvent) return { duplicate: true, event: settledEvent, target: target.record };
  if (normalStatus === 'refunded' && target.type !== 'parent_payment' && refundedEvent) return { duplicate: true, event: refundedEvent, target: target.record };
  if (normalStatus === 'refunded' && target.type !== 'parent_payment' && !settledEvent) return { error: 'A payment can be refunded only after it has been confirmed as paid.' };
  if (target.type === 'store' && normalStatus === 'failed' && settledEvent) return { error: 'A paid store order cannot be changed back to failed.' };
  if (numericAmount === null || numericAmount <= 0) return { error: 'Payment amount must be greater than zero.' };
  if (target.type === 'parent_payment') {
    const current = context.parentPaymentFinancials(target.record);
    const remaining = normalStatus === 'refunded' ? current.paidAmount : current.balance;
    if (numericAmount > remaining || (normalStatus !== 'failed' && remaining <= 0)) return { error: `Payment amount cannot exceed the remaining balance of ${remaining.toFixed(2)}.` };
  } else if (numericAmount !== expectedAmount) {
    return { error: `Payment amount must match the expected amount of ${expectedAmount.toFixed(2)}.` };
  }
  const timestamp = receivedAt || new Date().toISOString();
  const event = {
    eventId, reference: target.record.reference, status: normalStatus, amount: numericAmount,
    providerTransactionId: String(providerTransactionId || '').trim().slice(0, 160), source,
    schoolId: target.schoolId, targetType: target.type, receivedAt: timestamp
  };
  target.record.paymentStatus = normalStatus;
  if (target.type === 'subscription') target.record.status = normalStatus;
  target.record.paymentUpdatedAt = timestamp;
  if (normalStatus === 'paid') target.record.paidAt = timestamp;
  if (normalStatus === 'refunded') target.record.refundedAt = timestamp;
  if (target.type === 'parent_subscription') {
    const parent = context.findAccountByUsername(target.record.parentUsername);
    if (parent && normalStatus === 'paid') {
      parent.parentSubscriptionStatus = 'paid'; parent.subscription = 'plus'; parent.parentSubscriptionPaidAt = timestamp;
      parent.parentSubscriptionGrantedUntil = context.extendSubscriptionDate(parent.parentSubscriptionGrantedUntil, timestamp);
      target.record.grantedUntil = parent.parentSubscriptionGrantedUntil;
    } else if (parent && normalStatus === 'refunded') {
      parent.parentSubscriptionStatus = 'basic'; parent.subscription = 'basic'; parent.parentSubscriptionGrantedUntil = '';
    }
  } else if (target.type === 'subscription') {
    const school = context.db.schools.find(entry => entry.id === target.schoolId);
    if (school && normalStatus === 'paid') {
      school.subscriptionStatus = 'active';
      school.subscriptionPlanCode = target.record.planCode || '';
      school.subscriptionLearnerCapacity = target.record.learnerCapacity || 0;
      school.subscriptionHardMaxLearners = target.record.hardMaxLearners || 0;
      school.subscriptionActivatedAt = timestamp;
      school.subscriptionActiveUntil = context.extendSubscriptionDate(school.subscriptionActiveUntil, timestamp);
      target.record.activeUntil = school.subscriptionActiveUntil;
    } else if (school && normalStatus === 'refunded') {
      school.subscriptionStatus = 'refunded';
      school.subscriptionActiveUntil = '';
    }
  } else if (target.type === 'store') {
    context.applyStorePaymentState(target, normalStatus, timestamp);
  }
  context.db.paymentEvents.unshift(event);
  context.db.paymentLedger.unshift({
    id: context.crypto.randomUUID(), eventId, reference: target.record.reference, schoolId: target.schoolId,
    targetType: target.type, amount: numericAmount, status: normalStatus, source, createdAt: timestamp,
    recordedBy: actor?.username || 'signed-webhook'
  });
  return { duplicate: false, event, target: target.record };
};

const parentPaymentParentForSchool = (username, actor) => {
  const parent = context.findAccountByUsername(username);
  return parent && parent.role === 'parent' && context.isSameSchool(actor, parent) ? parent : null;
};

const createParentPaymentRecord = (body, actor) => {
  const parent = context.parentPaymentParentForSchool(body?.parentUsername, actor);
  if (!parent) return { error: 'Choose a parent account from this school.' };
  const amountDue = context.billingAmount(body?.amountDue);
  const dueDate = context.validDateKey(body?.dueDate);
  const arrangementDueDate = context.validDateKey(body?.arrangementDueDate);
  const hasArrangementAmount = body?.arrangementAmount !== '' && body?.arrangementAmount != null;
  const arrangementAmount = hasArrangementAmount ? context.billingAmount(body.arrangementAmount) : null;
  if (amountDue === null || amountDue <= 0 || !dueDate) return { error: 'Enter a positive amount and a valid due date.' };
  if (body?.arrangementDueDate && !arrangementDueDate) return { error: 'Enter a valid approved later date.' };
  if (arrangementDueDate && arrangementDueDate <= dueDate) return { error: 'The approved later date must be after the original due date.' };
  if (hasArrangementAmount && (arrangementAmount === null || arrangementAmount <= 0 || arrangementAmount > amountDue)) return { error: 'The approved arrangement amount must be positive and no more than the original amount.' };
  const description = String(body?.description || '').trim().slice(0, 240);
  if (!description) return { error: 'Add a short description for this parent payment.' };
  const billing = context.subscriptionBillingState(actor);
  if (!context.billingPaymentConfigured(billing.payment)) return { error: 'Configure the school payment destination before creating a parent payment.' };
  const reference = `${billing.payment.referencePrefix}-PARENT-${context.crypto.randomUUID().split('-')[0].toUpperCase()}`;
  const record = context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(), reference, parentUsername: parent.username, parentName: parent.name || parent.username,
    learnerName: String(body?.learnerName || '').trim().slice(0, 160), description, amountDue, dueDate,
    arrangementDueDate: arrangementDueDate || '', arrangementAmount, arrangementNote: String(body?.arrangementNote || '').trim().slice(0, 500), parentSignature: '', parentSignedAt: '',
    paymentStatus: 'awaiting_payment', createdAt: new Date().toISOString(), createdBy: actor.username
  });
  return { record };
};
return { payFastConfigured, payFastHost, payFastProcessUrl, payFastValidationUrl, payFastUrlEncode, payFastParamString, payFastSignature, payFastRawEntries, payFastSourceIsValid, payFastServerValidates, billingPaymentConfigured, donationBillingState, paymentInstructions, cents, parentPaymentAmount, parentPaymentDueDate, parentPaymentFinancials, parentPaymentSummary, parentPaymentAgeing, parentPaymentView, canonicalPaymentStatus, findPaymentTarget, expectedPaymentAmount, applyStorePaymentState, applyPaymentEvent, parentPaymentParentForSchool, createParentPaymentRecord };
}
module.exports = { createHelpers };
