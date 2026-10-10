// Existing handlers, registered at their original middleware positions.
function registerExecutiveOverviewRoutes(app, context) {
app.get('/api/executive-overview', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });

  const platformWide = context.hasPlatformAccess(actor);
  const scoped = records => platformWide ? (Array.isArray(records) ? records.slice() : []) : context.tenantRecords(records, actor);
  const visibleAccounts = platformWide
    ? (context.db.users || []).filter(account => !context.isAwaitingAccountVerification(account))
    : (context.db.users || []).filter(account => !context.isAwaitingAccountVerification(account) && !context.PLATFORM_INTERNAL_ROLES.has(account.role) && context.isSameSchool(actor, account));

  const schools = platformWide
    ? context.registeredSchools()
    : (context.db.schools || []).filter(school => school.id === context.accountSchoolId(actor));
  const learners = scoped(context.db.students);
  const tasks = scoped(context.db.staffTasks);
  const leave = scoped(context.db.staffLeave);
  const cover = scoped(context.db.teacherCover);
  const maintenance = scoped(context.db.maintenanceOrders);
  const purchases = scoped(context.db.purchaseRequests);
  const tickets = scoped(context.db.tickets);
  const reviews = scoped(context.db.performanceReviews);
  const payments = scoped(context.db.parentPayments);
  const consents = scoped(context.db.consentRecords);

  const groupedCount = (records, select) => {
    const counts = new Map();
    records.forEach(record => {
      const key = select(record);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  };
  const chartRows = (counts, preferredOrder = []) => {
    const order = new Map(preferredOrder.map((label, index) => [label, index]));
    return [...counts.entries()]
      .filter(([, value]) => Number(value) > 0)
      .map(([label, value]) => ({ label, value: Number(value) }))
      .sort((first, second) => {
        const firstOrder = order.has(first.label) ? order.get(first.label) : 999;
        const secondOrder = order.has(second.label) ? order.get(second.label) : 999;
        return firstOrder - secondOrder || second.value - first.value || first.label.localeCompare(second.label);
      });
  };

  const accountGroups = groupedCount(visibleAccounts, account => {
    if (account.role === 'parent') return 'Parents';
    if (account.role === 'teacher') return 'Teachers';
    if (['admin', 'principal'].includes(account.role)) return 'Leadership';
    if (account.role === 'school_accounts') return 'School accounts';
    if (context.PLATFORM_INTERNAL_ROLES.has(account.role)) return 'Little Feet team';
    if (account.role === 'district') return 'District';
    return 'Other';
  });

  const attentionCounts = new Map([
    ['Open tasks', tasks.filter(item => item.status !== 'Completed').length],
    ['Pending leave', leave.filter(item => item.status === 'Pending').length],
    ['Cover needed', cover.filter(item => item.status === 'Needs Cover').length],
    ['Maintenance', maintenance.filter(item => item.status !== 'Completed').length],
    ['Purchases', purchases.filter(item => item.status === 'Pending').length],
    ['Open tickets', tickets.filter(item => item.status !== 'Completed').length]
  ]);
  const openAttention = [...attentionCounts.values()].reduce((sum, value) => sum + Number(value || 0), 0);

  const reviewCounts = groupedCount(reviews, item => ['Draft', 'Shared', 'Acknowledged'].includes(item.status) ? item.status : 'Other');
  const ratedReviews = reviews.map(item => Number(item.averageRating)).filter(Number.isFinite);
  const averageReviewRating = ratedReviews.length
    ? Number((ratedReviews.reduce((sum, rating) => sum + rating, 0) / ratedReviews.length).toFixed(2))
    : null;

  const paymentFinancials = payments.map(record => context.parentPaymentFinancials(record));
  const financeSummary = context.parentPaymentSummary(payments);
  const financeCounts = new Map([
    ['Collected', context.cents(financeSummary.paidAmount)],
    ['Outstanding', context.cents(financeSummary.balance)]
  ]);

  const openFaults = (context.db.systemErrors || []).filter(entry =>
    entry.status === 'open' && (platformWide || !entry.schoolId || entry.schoolId === context.accountSchoolId(actor))
  ).length;

  let setup = { show: false, complete: true, steps: {} };
  if (!platformWide && actor.role === 'admin') {
    const steps = {
      learners: learners.length > 0,
      people: visibleAccounts.some(account => ['parent', 'teacher', 'principal', 'school_accounts'].includes(account.role)),
      consent: consents.length > 0,
      finance: context.billingPaymentConfigured(context.subscriptionBillingState(actor).payment) || payments.length > 0
    };
    setup = { show: !Object.values(steps).every(Boolean), complete: Object.values(steps).every(Boolean), steps };
  }

  res.json({
    scope: platformWide ? 'platform' : 'school',
    generatedAt: new Date().toISOString(),
    kpis: {
      schools: schools.length,
      learners: learners.length,
      accounts: visibleAccounts.length,
      openAttention,
      outstandingBalance: context.cents(financeSummary.balance),
      arrears: context.cents(financeSummary.arrears),
      averageReviewRating,
      openFaults
    },
    charts: {
      accounts: chartRows(accountGroups, ['Parents', 'Teachers', 'Leadership', 'School accounts', 'Little Feet team', 'District', 'Other']),
      attention: chartRows(attentionCounts, ['Open tasks', 'Pending leave', 'Cover needed', 'Maintenance', 'Purchases', 'Open tickets']),
      finance: chartRows(financeCounts, ['Collected', 'Outstanding']),
      reviews: chartRows(reviewCounts, ['Draft', 'Shared', 'Acknowledged', 'Other'])
    },
    setup
  });
});
}

module.exports = { registerExecutiveOverviewRoutes };
