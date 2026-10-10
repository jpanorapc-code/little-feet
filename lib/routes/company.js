// Existing handlers, registered at their original middleware positions.
function registerCompanyClientsRoutes(app, context) {
app.get('/api/company/clients', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || actor.role === 'crm')) return res.status(403).json({ message: 'Sales access is required.' });
  const notes = context.db.moduleRecords.companyClients || [];
  res.json(context.registeredSchools().map(school => ({
    id: school.id, name: school.name, area: school.area || school.city || '',
    status: school.subscriptionStatus || school.status || '',
    note: notes.find(record => record.clientSchoolId === school.id && record.createdBy === actor.username)?.details || ''
  })));
});

app.put('/api/company/clients/:id', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || actor.role === 'crm')) return res.status(403).json({ message: 'Sales access is required.' });
  if (!context.db.schools.some(school => school.id === req.params.id)) return res.status(404).json({ message: 'School not found.' });
  const details = context.limitedText(req.body?.note, 2000);
  if (details === null || typeof req.body?.note !== 'string') return res.status(400).json({ message: 'Enter a note of no more than 2,000 characters.' });
  const records = context.db.moduleRecords.companyClients ||= [];
  let record = records.find(item => item.clientSchoolId === req.params.id && item.createdBy === actor.username);
  if (!record) { record = { id: context.crypto.randomUUID(), clientSchoolId: req.params.id, createdBy: actor.username, schoolId: '', schoolName: '', companyScope: true }; records.push(record); }
  record.details = details; record.updatedAt = new Date().toISOString();
  res.json({ success: true });
});

app.get('/api/company/billing', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || actor.role === 'accounts')) return res.status(403).json({ message: 'Company accounts access is required.' });
  const orders = Object.entries(context.db.schoolBilling || {}).flatMap(([schoolId, billing]) => (billing.orders || []).map(order => ({
    schoolId, schoolName: context.db.schools.find(school => school.id === schoolId)?.name || schoolId,
    reference: order.reference, amount: order.monthlyTotal, status: order.paymentStatus || order.status || '', createdAt: order.createdAt
  })));
  const ledger = (context.db.paymentLedger || []).filter(entry => entry.targetType === 'subscription').map(entry => ({
    reference: entry.reference, amount: entry.amount, status: entry.status, createdAt: entry.createdAt, schoolId: entry.schoolId
  }));
  res.json({ orders, ledger });
});

app.post('/api/company/billing/reconcile', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || actor.role === 'accounts')) return res.status(403).json({ message: 'Company accounts access is required.' });
  const eventId = context.limitedText(req.body?.eventId, 160), bankReference = context.limitedText(req.body?.bankReference, 160);
  if (!eventId || !bankReference) return res.status(400).json({ message: 'A unique event ID and bank reference are required.' });
  const target = context.findPaymentTarget(req.body?.reference);
  if (!target || target.type !== 'subscription') return res.status(404).json({ message: 'School subscription invoice not found.' });
  const school = context.db.schools.find(item => item.id === target.schoolId);
  if (!school) return res.status(404).json({ message: 'School not found.' });
  const scope = { ...actor, role: 'admin', platformAccess: false, schoolId: school.id, schoolName: school.name };
  const result = context.applyPaymentEvent({ eventId: `company:${eventId}`, reference: target.record.reference, status: 'paid', amount: req.body?.amount,
    providerTransactionId: bankReference, source: 'manual-bank-reconciliation', receivedAt: new Date().toISOString() }, scope);
  if (result.error) return res.status(400).json({ message: result.error });
  res.status(result.duplicate ? 200 : 201).json({ success: true, duplicate: result.duplicate });
});
}

module.exports = { registerCompanyClientsRoutes };
