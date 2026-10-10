// Existing handlers, registered at their original middleware positions.
function registerBookRegisterRoutes(app, context) {
app.get('/api/book-register', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Book register access is required.' });
  const className = context.normalizeComparableText(req.query.className);
  let records = context.bookRecordsForSchool(actor);
  if (className) records = records.filter(record => context.normalizeComparableText(record.className) === className);
  res.json({ records: records.map(context.bookRecordView), summary: { total: records.length, returned: records.filter(record => record.status === 'returned').length, outstanding: records.filter(record => record.status !== 'returned').length, unsignedParents: records.filter(record => !record.parentSignature).length, penalties: context.cents(records.reduce((sum, record) => sum + (context.billingAmount(record.penaltyAmount) || 0), 0)) }, generatedAt: new Date().toISOString() });
});

app.get('/api/book-register/parents', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'School book-register management is required.' });
  res.json(context.db.users.filter(account => account.role === 'parent' && context.isSameSchool(actor, account)).map(account => ({ username: account.username, name: account.name || account.username, linkedLearners: account.linkedLearners || [] })));
});

app.post('/api/book-register', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can issue books.' });
  const parent = context.parentPaymentParentForSchool(req.body?.parentUsername, actor);
  const bookTitle = String(req.body?.bookTitle || '').trim().slice(0, 200);
  const learnerName = String(req.body?.learnerName || '').trim().slice(0, 160);
  const issueCondition = String(req.body?.issueCondition || '').trim().slice(0, 500);
  if (!parent || !bookTitle || !learnerName || !issueCondition) return res.status(400).json({ message: 'Choose a parent and enter the book, learner, and condition before handover.' });
  const bookPrice = context.billingAmount(req.body?.bookPrice);
  if (bookPrice === null || bookPrice < 0) return res.status(400).json({ message: 'Enter a valid replacement price for the book.' });
  const record = context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(), bookTitle, bookCode: String(req.body?.bookCode || '').trim().slice(0, 80), bookPrice, learnerName,
    className: String(req.body?.className || '').trim().slice(0, 120), parentUsername: parent.username, parentName: parent.name || parent.username,
    issueCondition, issuedAt: String(req.body?.issuedAt || '').trim() || new Date().toISOString(), adminSignature: String(req.body?.adminSignature || actor.name || actor.username).trim().slice(0, 160),
    adminSignedAt: new Date().toISOString(), parentSignature: '', parentSignedAt: '', returnCondition: '', returnedAt: '',
    returnAdminSignature: '', returnAdminSignedAt: '', returnParentSignature: '', returnParentSignedAt: '', returnStatus: '', penaltyAmount: 0, status: 'awaiting_parent_signature',
    notes: String(req.body?.notes || '').trim().slice(0, 500), createdAt: new Date().toISOString()
  });
  if (!Array.isArray(context.db.bookRegister)) context.db.bookRegister = [];
  context.db.bookRegister.unshift(record);
  res.status(201).json({ success: true, record: context.bookRecordView(record) });
});

app.post('/api/book-register/import', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Only a principal or administrator can import the book register.' });
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ message: 'Add at least one checklist row to import.' });
  if (rows.length > 2000) return res.status(400).json({ message: 'Import up to 2,000 book-register records per file.' });
  const imported = [], rejected = [];
  rows.forEach((row, index) => {
    const result = context.createBookRecordFromImport(row, actor);
    if (result.error) rejected.push({ row: index + 2, error: result.error });
    else { context.db.bookRegister.unshift(result.record); imported.push(context.bookRecordView(result.record)); }
  });
  res.status(imported.length ? 201 : 400).json({ success: Boolean(imported.length), imported: imported.length, rejected, records: imported });
});
}

function registerBookRegisterSignRoutes(app, context) {
app.post('/api/book-register/:id/sign', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || actor.role !== 'parent') return res.status(403).json({ message: 'Only the linked parent can sign this handover or return.' });
  const record = (context.db.bookRegister || []).find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor) && context.normalizeUsername(entry.parentUsername) === context.normalizeUsername(actor.username));
  const signature = String(req.body?.signature || '').trim().slice(0, 160);
  const action = String(req.body?.action || 'received').trim().toLowerCase();
  if (!record || !signature) return res.status(400).json({ message: 'A parent signature is required.' });
  if (action === 'returned') {
    if (record.status !== 'returned') return res.status(409).json({ message: 'The school must record the returned book condition before the parent can sign the return.' });
    record.returnParentSignature = signature; record.returnParentSignedAt = new Date().toISOString();
  } else {
    record.parentSignature = signature; record.parentSignedAt = new Date().toISOString(); record.status = 'issued';
  }
  res.json({ success: true, record: context.bookRecordView(record) });
});

app.put('/api/book-register/:id/return', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can record returned books.' });
  const record = (context.db.bookRegister || []).find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  const returnCondition = String(req.body?.returnCondition || '').trim().slice(0, 500);
  const returnStatus = ['returned_good', 'damaged', 'lost'].includes(String(req.body?.returnStatus || '')) ? String(req.body.returnStatus) : '';
  const signature = String(req.body?.returnAdminSignature || actor.name || actor.username).trim().slice(0, 160);
  if (!record || !returnCondition || !returnStatus) return res.status(400).json({ message: 'Record the condition and choose returned, damaged, or lost.' });
  record.returnCondition = returnCondition; record.returnStatus = returnStatus; record.penaltyAmount = ['damaged', 'lost'].includes(returnStatus) ? (context.billingAmount(record.bookPrice) || 0) : 0; record.returnedAt = new Date().toISOString(); record.returnAdminSignature = signature; record.returnAdminSignedAt = new Date().toISOString(); record.status = 'returned';
  res.json({ success: true, record: context.bookRecordView(record) });
});
}

module.exports = { registerBookRegisterRoutes, registerBookRegisterSignRoutes };
