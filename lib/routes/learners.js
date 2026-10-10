// Existing handlers, registered at their original middleware positions.
function registerLearnerAccessCodesRoutes(app, context) {
app.get('/api/learner-access-codes', (req, res) => {
  const actor = context.findLearnerAccessCodeActor(req);
  if (!actor) return res.status(403).json({ message: 'Only administrators and principals may view learner codes.' });
  const isAdmin = context.isAdminLike(actor);
  res.json(context.tenantRecords(context.db.students, actor).map(learner => context.learnerAccessCodeView(learner, actor, { includeCode: isAdmin, includeHistory: isAdmin })));
});

app.get('/api/learner-access-codes/printable-list', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !context.isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator may print the full learner-code register.' });
  const learners = context.tenantRecords(context.db.students, actor).map(learner => context.learnerAccessCodeView(learner, actor, { includeCode: true, includeHistory: false }));
  res.json({
    schoolName: actor.schoolName,
    generatedAt: new Date().toISOString(),
    learners: learners.filter(entry => entry.accessCode).map(entry => ({
      learnerName: entry.learnerName,
      className: entry.className,
      parentName: entry.parentName,
      accessCode: entry.accessCode,
      issuedAt: entry.issuedAt
    }))
  });
});

app.get('/api/learner-access-codes/teacher-preview', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !context.isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can open the teacher-view preview.' });
  res.json(context.tenantRecords(context.db.students, actor).map(learner => {
    const key = context.learnerRecordKey(learner);
    return {
      learnerName: learner.studentName,
      className: learner.className,
      parentName: learner.parentName || '',
      codeIssued: context.db.learnerAccessCodes.some(entry => entry.learnerKey === key && entry.schoolId === learner.schoolId && entry.status === 'active' && context.recordInSchool(entry, actor))
    };
  }));
});

app.get('/api/learner-access-codes/:learnerKey/printable', (req, res) => {
  const actor = context.findLearnerAccessCodeActor(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator or principal can print learner code forms.' });
  const learnerKey = String(req.params.learnerKey || '');
  const matches = context.tenantRecords(context.db.students, actor).filter(entry => context.learnerRecordKey(entry) === learnerKey && (!req.query.schoolId || entry.schoolId === req.query.schoolId));
  if (matches.length > 1) return res.status(409).json({ message: 'Choose the learner’s school before printing this code.' });
  const learner = matches[0];
  if (!learner) return res.status(404).json({ message: 'Learner record not found.' });
  const activeCode = context.db.learnerAccessCodes.find(entry => entry.learnerKey === learnerKey && entry.schoolId === learner.schoolId && entry.status === 'active' && context.recordInSchool(entry, actor));
  if (!activeCode) return res.status(404).json({ message: 'There is no active code available to print for this learner.' });
  res.json({
    learnerName: learner.studentName,
    className: learner.className,
    parentName: learner.parentName || '',
    accessCode: context.decryptField(activeCode.codeEncrypted),
    issuedAt: activeCode.issuedAt || null
  });
});

app.post('/api/learner-access-codes', (req, res) => {
  const actor = context.findLearnerAccessCodeActor(req);
  if (!actor || !context.isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can repair a missing learner access code.' });
  const matches = context.tenantRecords(context.db.students, actor).filter(entry => context.learnerRecordKey(entry) === String(req.body?.learnerKey || '') && (!req.body?.schoolId || entry.schoolId === req.body.schoolId));
  if (matches.length > 1) return res.status(409).json({ message: 'Choose the learner’s school before issuing this code.' });
  const learner = matches[0];
  if (!learner) return res.status(404).json({ message: 'Learner record not found.' });
  const learnerKey = context.learnerRecordKey(learner);
  if (context.db.learnerAccessCodes.some(entry => entry.learnerKey === learnerKey && entry.schoolId === learner.schoolId && entry.status === 'active' && context.recordInSchool(entry, actor))) return res.status(409).json({ message: 'This learner already has an active code. Regenerate it instead.' });
  context.ensureLearnerAccessCode(actor, learner);
  res.status(201).json({ success: true, learner: context.learnerAccessCodeView(learner, actor, { includeCode: true, includeHistory: true }) });
});

app.post('/api/learner-access-codes/generate-batch', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !context.isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can generate learner access codes.' });

  const requested = Array.isArray(req.body?.learners) ? req.body.learners : [];
  if (!requested.length) return res.status(400).json({ message: 'Add at least one learner name before generating codes.' });
  if (requested.length > 500) return res.status(400).json({ message: 'Generate up to 500 learner codes per secure batch.' });

  const schoolLearners = context.tenantRecords(context.db.students, actor);
  const results = requested.map((row, index) => {
    const inputName = context.boundedText(row?.learnerName, 160);
    const inputClass = context.boundedText(row?.className, 120);
    if (!inputName) {
      return { index, inputName, inputClass, status: 'invalid', message: 'Learner name is required.' };
    }

    let matches = schoolLearners.filter(learner => context.normalizeComparableText(learner.studentName) === context.normalizeComparableText(inputName));
    if (inputClass) {
      matches = matches.filter(learner => context.normalizeComparableText(learner.className) === context.normalizeComparableText(inputClass));
    }

    if (!matches.length) {
      return { index, inputName, inputClass, status: 'not_found', message: 'No learner in this school matches that name and class.' };
    }
    if (matches.length > 1) {
      return { index, inputName, inputClass, status: 'ambiguous', message: 'More than one learner matches. Add the Grade / Class value to identify the correct learner.' };
    }

    const learner = matches[0];
    const learnerKey = context.learnerRecordKey(learner);
    let codeRecord = context.db.learnerAccessCodes.find(entry =>
      entry.learnerKey === learnerKey && entry.schoolId === learner.schoolId && entry.status === 'active' && context.recordInSchool(entry, actor)
    );
    const existed = Boolean(codeRecord);
    if (!codeRecord) codeRecord = context.ensureLearnerAccessCode(actor, learner);

    return {
      index,
      inputName,
      inputClass,
      status: existed ? 'existing' : 'generated',
      learnerKey,
      learnerName: learner.studentName,
      className: learner.className || '',
      parentName: learner.parentName || '',
      accessCode: context.decryptField(codeRecord.codeEncrypted),
      issuedAt: codeRecord.issuedAt || null,
      message: existed ? 'Existing active code reused.' : 'New secure learner code generated.'
    };
  });

  res.json({
    success: true,
    generated: results.filter(item => item.status === 'generated').length,
    existing: results.filter(item => item.status === 'existing').length,
    unmatched: results.filter(item => !['generated', 'existing'].includes(item.status)).length,
    results
  });
});

app.post('/api/learner-access-codes/:id/replace', (req, res) => {
  const actor = context.findLearnerAccessCodeActor(req);
  if (!actor || !context.isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can replace learner access codes.' });
  const previous = context.db.learnerAccessCodes.find(entry => entry.id === req.params.id && entry.status === 'active' && context.recordInSchool(entry, actor));
  if (!previous) return res.status(404).json({ message: 'The active code was not found.' });
  previous.status = 'replaced';
  previous.replacedAt = new Date().toISOString();
  previous.replacedBy = actor.username;
  const accessCode = context.createUniqueLearnerAccessCode();
  context.db.learnerAccessCodes.unshift({ ...context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), learnerKey: previous.learnerKey, codeEncrypted: context.encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username, replaces: previous.id, source: 'administrator-regeneration' }), schoolId: previous.schoolId, schoolName: previous.schoolName || '' });
  const learner = context.db.students.find(entry => context.learnerRecordKey(entry) === previous.learnerKey && entry.schoolId === previous.schoolId && context.recordInSchool(entry, actor));
  res.json({ success: true, learner: learner ? context.learnerAccessCodeView(learner, actor, { includeCode: true, includeHistory: true }) : null });
});

app.post('/api/learner-access-codes/:id/revoke', (req, res) => {
  const actor = context.findLearnerAccessCodeActor(req);
  if (!actor || !context.isAdminLike(actor)) return res.status(403).json({ message: 'Only an administrator can invalidate learner access codes.' });
  const record = context.db.learnerAccessCodes.find(entry => entry.id === req.params.id && entry.status === 'active' && context.recordInSchool(entry, actor));
  if (!record) return res.status(404).json({ message: 'The active code was not found.' });
  record.status = 'revoked';
  record.revokedAt = new Date().toISOString();
  record.revokedBy = actor.username;
  res.json({ success: true });
});

app.post('/api/learner-access-codes/redeem', (req, res) => {
  const parent = context.getSessionAccount(req);
  if (!parent || parent.role !== 'parent') return res.status(403).json({ message: 'Only a signed-in parent or guardian can use a learner access code.' });
  const suppliedCode = context.normaliseAccessCode(req.body?.accessCode);
  const codeRecord = context.db.learnerAccessCodes.find(entry => entry.status === 'active' && context.recordInSchool(entry, parent) && context.decryptField(entry.codeEncrypted) === suppliedCode);
  if (!codeRecord) return res.status(404).json({ message: 'That learner access code is invalid, has already been used, or has been replaced. Ask the school administrator for a new form.' });
  const learner = context.db.students.find(entry => context.learnerRecordKey(entry) === codeRecord.learnerKey && context.recordInSchool(entry, parent));
  if (!learner) return res.status(404).json({ message: 'The learner record linked to this code is no longer available.' });
  if (context.normaliseLearnerLinks(parent.linkedLearners).includes(context.normalizeComparableText(learner.studentName))) return res.status(409).json({ message: 'This learner is already linked to your account.' });
  const requested = Array.isArray(parent.requestedLearnerLinks) ? [...parent.requestedLearnerLinks] : [];
  if (!requested.some(name => context.normalizeComparableText(name) === context.normalizeComparableText(learner.studentName))) requested.push(learner.studentName);
  const linkValidation = context.validateLearnerLinks(requested);
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  parent.requestedLearnerLinks = requested;
  parent.parentRelationshipStatus = 'Pending administrator approval';
  codeRecord.status = 'redeemed';
  codeRecord.redeemedAt = new Date().toISOString();
  codeRecord.redeemedBy = parent.username;
  res.json({ success: true, learnerName: learner.studentName, message: 'Learner link request sent to the school administrator for approval.' });
});

app.get('/api/students/search', (req, res) => {
  const { className, childName } = req.query;
  const requester = context.getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to search learner records.' });
  let results = context.learnerRecordsVisibleTo(context.db.students, requester);
  if (className) {
    results = results.filter(s => s.className.toLowerCase().includes(className.toLowerCase()));
  }
  if (childName) {
    results = results.filter(s => s.studentName.toLowerCase().includes(childName.toLowerCase()));
  }
  if (requester.role === 'district') {
    return res.json(results.map(student => ({ id: student.id || null, studentName: student.studentName, className: student.className })));
  }
  if (!(context.hasPlatformAccess(requester) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(requester.role))) return res.status(403).json({ message: 'This role cannot access learner records.' });
  res.json(results.map(context.studentSensitiveView));
});

app.get('/api/household', (req, res) => {
  const parent = context.getSessionAccount(req);
  if (!parent || parent.role !== 'parent') return res.status(403).json({ message: 'Only parent accounts can view linked learner records.' });
  res.json(context.tenantRecords(context.db.students, parent).filter(student => context.isParentLinkedToLearner(parent, student)).map(context.studentSensitiveView));
});

app.get('/api/students/import/:id', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'Only an administrator or principal may view learner imports.' });
  const job = context.db.importJobs.find(item => item.id === req.params.id && context.recordInSchool(item, actor));
  if (!job) return res.status(404).json({ message: 'Import job not found.' });
  res.json({ id: job.id, type: job.type, sourceSystem: job.sourceSystem || null, status: job.status, processedBatches: job.processedBatches.length, totalBatches: job.totalBatches, imported: job.imported, rejected: job.rejected, createdAt: job.createdAt, updatedAt: job.updatedAt });
});

app.post('/api/students/import', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'Only an administrator or principal may import learner records.' });
  const incoming = Array.isArray(req.body?.students) ? req.body.students : [];
  const sourceSystem = context.boundedText(req.body?.sourceSystem, 40);
  if (sourceSystem && sourceSystem !== 'SA-SAMS') return res.status(400).json({ message: 'Unsupported learner import source.' });
  if (!incoming.length) return res.status(400).json({ message: 'No learner records were supplied.' });
  if (incoming.length > 500) return res.status(400).json({ message: 'Import up to 500 learner records per bounded batch.' });
  const requestedJobId = context.boundedText(req.body?.importId, 80);
  const jobId = requestedJobId || context.crypto.randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(jobId)) return res.status(400).json({ message: 'Invalid import job identifier.' });
  const batchNumber = Number(req.body?.batchNumber ?? 0);
  const totalBatches = Number(req.body?.totalBatches ?? 1);
  if (!Number.isSafeInteger(batchNumber) || batchNumber < 0 || !Number.isSafeInteger(totalBatches) || totalBatches < 1 || totalBatches > 400 || batchNumber >= totalBatches) {
    return res.status(400).json({ message: 'Invalid import batch sequence. Imports support up to 400 batches (200,000 supplied rows).' });
  }
  let job = context.db.importJobs.find(item => item.id === jobId && context.recordInSchool(item, actor));
  if (job && context.normalizeUsername(job.createdBy) !== context.normalizeUsername(actor.username)) return res.status(403).json({ message: 'This import belongs to another account.' });
  if (!job) {
    job = context.tagSchoolRecord(actor, { id: jobId, type: sourceSystem === 'SA-SAMS' ? 'sa-sams-learners' : 'learners', sourceSystem: sourceSystem || null, status: 'in_progress', totalBatches, processedBatches: [], imported: 0, rejected: 0, createdBy: actor.username, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    context.db.importJobs.unshift(job);
    const completedForSchool = context.db.importJobs.filter(item => item !== job && item.status === 'completed' && context.recordInSchool(item, actor));
    const expiredJobIds = new Set(completedForSchool.slice(100).map(item => item.id));
    if (expiredJobIds.size) {
      context.db.importJobs = context.db.importJobs.filter(item => !expiredJobIds.has(item.id));
      context.db.importAudit = context.db.importAudit.filter(item => !expiredJobIds.has(item.importId));
    }
  }
  if (job.totalBatches !== totalBatches) return res.status(409).json({ message: 'This import job was started with a different batch count.' });
  if ((job.sourceSystem || '') !== (sourceSystem || '')) return res.status(409).json({ message: 'This import job was started from a different source system.' });
  const priorBatch = job.processedBatches.find(item => item.batchNumber === batchNumber);
  if (priorBatch) return res.json({ success: true, duplicateBatch: true, importId: job.id, status: job.status, imported: priorBatch.imported, rejected: priorBatch.rejectedRows, progress: { processedBatches: job.processedBatches.length, totalBatches, imported: job.imported, rejected: job.rejected } });

  const recordKey = (student) => [student.studentName, student.className, student.contactEmail].map(context.normalizeComparableText).join('|');
  const knownRecords = new Set(context.tenantRecords(context.db.students, actor).map(recordKey));
  const seenInFile = new Set();
  const rejected = [];
  let imported = 0;
  const learnerLimit = context.schoolLearnerLimitState(actor);
  let remainingCapacity = Math.max(0, learnerLimit.hardMaxLearners - learnerLimit.learnerCount);

  incoming.forEach((row, index) => {
    const studentName = context.boundedText(row?.studentName, 160);
    const className = context.boundedText(row?.className, 120);
    const parentName = context.boundedText(row?.parentName, 160);
    const contactEmail = context.boundedText(row?.contactEmail, 160);
    if (!studentName || !className) {
      rejected.push({ row: batchNumber * 500 + index + 2, reason: 'Learner name and class/grade are required.' });
      return;
    }
    const candidate = { studentName, className, contactEmail };
    const key = recordKey(candidate);
    if (knownRecords.has(key) || seenInFile.has(key)) {
      rejected.push({ row: batchNumber * 500 + index + 2, reason: 'Duplicate learner record already exists.' });
      return;
    }
    if (remainingCapacity <= 0) {
      rejected.push({ row: batchNumber * 500 + index + 2, reason: `School package learner limit reached (${learnerLimit.hardMaxLearners}). Renew or move to a larger package before importing more learners.` });
      return;
    }
    seenInFile.add(key);
    knownRecords.add(key);
    const learner = context.tagSchoolRecord(actor, {
      id: context.crypto.randomUUID(),
      studentName,
      className,
      parentName,
      contactEmail,
      medicalNotes: context.encryptField(context.boundedText(row?.medicalNotes, 2000)),
      emergencyContact: context.encryptField(context.boundedText(row?.emergencyContact, 500)),
      authorisedPickups: context.encryptField(context.boundedText(row?.authorisedPickups, 1000)),
      importedAt: new Date().toISOString(),
      importedBy: actor.username
    });
    context.db.students.push(learner);
    context.ensureLearnerAccessCode(actor, learner);
    imported += 1;
    remainingCapacity -= 1;
  });

  job.processedBatches.push({ batchNumber, imported, rejected: rejected.length, rejectedRows: rejected.slice(0, 100), rejectedRowsTruncated: rejected.length > 100, processedAt: new Date().toISOString() });
  job.processedBatches.sort((a, b) => a.batchNumber - b.batchNumber);
  job.imported += imported; job.rejected += rejected.length; job.updatedAt = new Date().toISOString();
  job.status = job.processedBatches.length === totalBatches ? 'completed' : 'in_progress';
  context.db.importAudit.unshift(context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), importId: job.id, sourceSystem: job.sourceSystem || null, batchNumber, importedAt: job.updatedAt, importedBy: actor.username, imported, rejected: rejected.length }));
  res.status(201).json({ success: true, importId: job.id, status: job.status, imported, rejected, progress: { processedBatches: job.processedBatches.length, totalBatches, imported: job.imported, rejected: job.rejected }, message: `${imported} learner record${imported === 1 ? '' : 's'} imported.` });
});
}

module.exports = { registerLearnerAccessCodesRoutes };
