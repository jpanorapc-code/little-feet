// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const ensureSchoolTrialStarted = account => {
  if (!account || context.hasPlatformAccess(account) || !['principal', 'admin', 'school_accounts'].includes(account.role)) return null;
  const school = context.db.schools.find(entry => entry.id === context.accountSchoolId(account));
  if (!school || school.subscriptionStatus !== 'trial_pending') return school || null;
  const startedAt = new Date().toISOString();
  school.subscriptionStatus = 'trial';
  school.trialStartedAt = startedAt;
  school.trialEndsAt = new Date(Date.now() + (14 * 24 * 60 * 60 * 1000)).toISOString();
  return school;
};

const billingDefaults = () => ({
  pricing: { baseMonthly: 0, bundles: { 5: { costPrice: 0, sellingPrice: 0 }, 20: { costPrice: 0, sellingPrice: 0 }, 100: { costPrice: 0, sellingPrice: 0 } }, lateFeeEnabled: false, lateFee: 0 },
  payment: { method: 'payment_link', paymentLink: '', accountName: '', bankName: '', accountNumberEncrypted: '', payMePayloadEncrypted: '', branchCode: '', referencePrefix: 'LF' },
  orders: []
});

const subscriptionBillingState = (actor = null) => {
  const defaults = context.billingDefaults();
  const schoolId = actor ? context.accountSchoolId(actor) : null;
  if (schoolId) {
    if (!context.db.schoolBilling || typeof context.db.schoolBilling !== 'object') context.db.schoolBilling = {};
    if (!context.db.schoolBilling[schoolId]) context.db.schoolBilling[schoolId] = context.db.subscriptionBilling || {};
  }
  const existing = schoolId ? context.db.schoolBilling[schoolId] : (context.db.subscriptionBilling || {});
  const state = {
    ...defaults,
    ...existing,
    pricing: {
      ...defaults.pricing,
      ...(existing.pricing || {}),
      bundles: { ...defaults.pricing.bundles, ...((existing.pricing || {}).bundles || {}) }
    },
    payment: { ...defaults.payment, ...(existing.payment || {}) },
    orders: Array.isArray(existing.orders) ? existing.orders : []
  };
  // The platform owner receives subscription and donation payments. A saved
  // global destination is therefore the safe fallback for a school record that
  // predates payment setup or was created by an older release.
  if (schoolId && !context.billingPaymentConfigured(state.payment) && context.billingPaymentConfigured(context.db.subscriptionBilling?.payment)) {
    state.payment = { ...defaults.payment, ...context.db.subscriptionBilling.payment };
  }
  if (schoolId) context.db.schoolBilling[schoolId] = state;
  else context.db.subscriptionBilling = state;
  return state;
};

const billingAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1000000 ? Math.round(amount * 100) / 100 : null;
};

const publicBillingPricing = (billing, includeCosts = false) => ({
  baseMonthly: billing.pricing.baseMonthly,
  lateFeeEnabled: Boolean(billing.pricing.lateFeeEnabled),
  lateFee: billing.pricing.lateFee,
  bundles: context.billingBundleSizes.map(capacity => ({
    capacity,
    sellingPrice: billing.pricing.bundles[capacity]?.sellingPrice || 0,
    ...(includeCosts ? { costPrice: billing.pricing.bundles[capacity]?.costPrice || 0 } : {})
  }))
});

const schoolSubscriptionAccessState = account => {
  if (!account || context.hasPlatformAccess(account) || context.PLATFORM_INTERNAL_ROLES.has(account.role)) return { allowed: true, active: true, status: 'platform', trialEndsAt: '', activeUntil: '' };
  const schoolId = context.accountSchoolId(account);
  const school = context.db.schools.find(entry => entry.id === schoolId);
  if (!school) return { allowed: false, active: false, status: 'unverified', trialEndsAt: '', activeUntil: '' };
  const activeUntil = /^\d{4}-\d{2}-\d{2}$/.test(String(school.subscriptionActiveUntil || '')) ? String(school.subscriptionActiveUntil) : '';
  if (school.subscriptionStatus === 'active') {
    const allowed = !activeUntil || activeUntil >= context.dateKeyInSouthAfrica();
    return { allowed, active: allowed, status: allowed ? 'active' : 'expired', planCode: school.subscriptionPlanCode || '', activeUntil, trialEndsAt: school.trialEndsAt || '' };
  }
  if (['refunded', 'expired', 'cancelled', 'canceled'].includes(String(school.subscriptionStatus || '').toLowerCase())) {
    return { allowed: false, active: false, status: String(school.subscriptionStatus).toLowerCase(), planCode: school.subscriptionPlanCode || '', activeUntil, trialEndsAt: school.trialEndsAt || '' };
  }
  if (school.subscriptionStatus === 'trial_pending') {
    return { allowed: false, active: false, status: 'trial_pending', planCode: '', activeUntil, trialStartedAt: '', trialEndsAt: '' };
  }
  const trialEndMs = Date.parse(school.trialEndsAt || '');
  const allowed = Number.isFinite(trialEndMs) && trialEndMs >= Date.now();
  return { allowed, active: false, status: allowed ? 'trial' : 'trial_expired', planCode: '', activeUntil, trialStartedAt: school.trialStartedAt || '', trialEndsAt: school.trialEndsAt || '' };
};

const parentSubscriptionActive = account => {
  if (!account || account.role !== 'parent') return true;
  const grantedUntil = context.validDateKey(account.parentSubscriptionGrantedUntil);
  if (String(account.parentSubscriptionStatus || '').toLowerCase() === 'paid') return !grantedUntil || grantedUntil >= context.dateKeyInSouthAfrica();
  return Boolean(grantedUntil && grantedUntil >= context.dateKeyInSouthAfrica());
};

const extendSubscriptionDate = (currentEndDate, fromTimestamp = new Date().toISOString()) => {
  const today = context.validDateKey(String(fromTimestamp || '').slice(0, 10)) || context.dateKeyInSouthAfrica();
  const current = context.validDateKey(currentEndDate);
  const base = current && current >= today ? current : today;
  const expiry = new Date(`${base}T12:00:00.000Z`);
  expiry.setUTCDate(expiry.getUTCDate() + 30);
  return expiry.toISOString().slice(0, 10);
};
return { ensureSchoolTrialStarted, billingDefaults, subscriptionBillingState, billingAmount, publicBillingPricing, schoolSubscriptionAccessState, parentSubscriptionActive, extendSubscriptionDate };
}
module.exports = { createHelpers };
