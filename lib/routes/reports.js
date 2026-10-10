// Existing handlers, registered at their original middleware positions.
function registerReportSigningPinRoutes(app, context) {
app.post('/api/report-signing-pin', (req, res) => {
  const { pin } = req.body;
  const user = context.getSessionAccount(req);
  if (!user || !context.validSecretLength(pin, { min: 4, max: 128 })) return res.status(400).json({ message: 'Choose a signing PIN between 4 and 128 characters.' });
  user.reportSigningPinHash = context.hashPin(pin);
  res.json({ success: true });
});

app.get('/api/report-reviews', (req, res) => {
  const user = context.getSessionAccount(req);
  if (!user) return res.status(401).json({ message: 'Sign in to view reports.' });
  if (!(context.hasPlatformAccess(user) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(user.role))) return res.status(403).json({ message: 'This role cannot access learner reports.' });
  const reports = user.role === 'parent'
    ? context.tenantRecords(context.db.reportReviews, user).filter(report => context.normalizeUsername(report.parentUsername) === context.normalizeUsername(user.username))
    : context.learnerRecordsVisibleTo(context.db.reportReviews, user);
  res.json(reports.map(context.reportReviewView));
});

app.post('/api/report-reviews', (req, res) => {
  const studentName = context.limitedText(req.body?.studentName, 160);
  const reportTitle = context.limitedText(req.body?.reportTitle, 240);
  const period = context.limitedText(req.body?.period, 120);
  const parentUsername = context.limitedText(req.body?.parentUsername, 160);
  const signatureData = req.body?.signatureData;
  const signingPin = req.body?.signingPin;
  const teacher = context.getSessionAccount(req);
  if (!teacher || !teacher.reportSigningPinHash || !context.validSecretLength(signingPin) || !context.matchesPin(signingPin, teacher.reportSigningPinHash)) return res.status(403).json({ message: 'Set and enter your teacher signing PIN before publishing a report.' });
  const parent = parentUsername ? context.findAccountByUsername(parentUsername) : null;
  if (!(context.hasPlatformAccess(teacher) || ['teacher', 'principal', 'admin', 'staff'].includes(teacher.role)) || !parent || parent.role !== 'parent' || !context.isSameSchool(teacher, parent)) return res.status(400).json({ message: 'Choose an authorised teacher and a linked parent account.' });
  const learner = context.learnerRecordsVisibleTo(context.db.students, teacher).find(entry => context.normalizeComparableText(entry.studentName) === context.normalizeComparableText(studentName));
  if (!learner) return res.status(403).json({ message: 'You do not have access to that learner.' });
  if (!context.isParentLinkedToLearner(parent, learner)) return res.status(400).json({ message: 'Choose the approved parent account linked to this learner.' });
  if (!studentName || !reportTitle || !period || !parentUsername || !context.validSignatureData(signatureData)) return res.status(400).json({ message: 'Complete the report details within the allowed limits and provide a valid signature.' });
  const report = context.tagSchoolRecord(teacher, { id: context.crypto.randomUUID(), studentName, className: learner.className || '', reportTitle, period, teacherUsername: teacher.username, parentUsername: parent.username, teacherSignature: context.encryptField(signatureData), teacherSignedAt: new Date().toISOString(), parentSignature: null, parentSignedAt: null, status: 'Awaiting parent signature', createdAt: new Date().toISOString() });
  context.db.reportReviews.unshift(report);
  res.status(201).json({ success: true, report: context.reportReviewView(report) });
});

app.post('/api/report-reviews/:id/sign', (req, res) => {
  const { signatureData, signingPin } = req.body;
  const user = context.getSessionAccount(req);
  const report = context.db.reportReviews.find(entry => entry.id === req.params.id && context.recordInSchool(entry, user));
  if (!report || !user || user.role !== 'parent' || context.normalizeUsername(report.parentUsername) !== context.normalizeUsername(user.username)) return res.status(403).json({ message: 'Only the linked parent account can sign this report.' });
  if (!user.reportSigningPinHash || !context.validSecretLength(signingPin) || !context.matchesPin(signingPin, user.reportSigningPinHash)) return res.status(403).json({ message: 'Set and enter your parent signing PIN before signing.' });
  if (!context.validSignatureData(signatureData)) return res.status(400).json({ message: 'Add a valid signature before confirming.' });
  report.parentSignature = context.encryptField(signatureData);
  report.parentSignedAt = new Date().toISOString();
  report.status = 'Complete - teacher and parent signed';
  res.json({ success: true, report: context.reportReviewView(report) });
});
}

module.exports = { registerReportSigningPinRoutes };
