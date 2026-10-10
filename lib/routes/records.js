// Existing handlers, registered at their original middleware positions.
function registerModulesRoutes(app, context) {
app.get('/api/modules/:module', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'Authorised school staff can view workspace records.' });
  const records = context.moduleRecordCollection(req.params.module);
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  res.json(context.tenantRecords(records, actor));
});

app.post('/api/modules/:module', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can save workspace records.' });
  const records = context.moduleRecordCollection(req.params.module);
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });

  let payload;
  if (req.params.module === 'curriculum') {
    const allowedFrameworks = new Set(['NCF Birth–4', 'CAPS Grade R']);
    const allowedAreas = new Set([
      'ELDA 1 · Well-being',
      'ELDA 2 · Identity and Belonging',
      'ELDA 3 · Communication',
      'ELDA 4 · Exploring Mathematics',
      'ELDA 5 · Creativity',
      'ELDA 6 · Knowledge and Understanding of the World',
      'Home Language',
      'Mathematics',
      'Life Skills'
    ]);
    const framework = String(req.body?.framework || '').trim();
    const area = String(req.body?.area || '').trim();
    const learnerName = String(req.body?.learnerName || '').trim().slice(0, 160);
    const observation = String(req.body?.observation || '').trim().slice(0, 1200);
    const evidenceReference = String(req.body?.evidenceReference || '').trim().slice(0, 240);
    if (!allowedFrameworks.has(framework) || !allowedAreas.has(area) || !learnerName || !observation) {
      return res.status(400).json({ message: 'Choose a supported NCF or Grade R framework area and enter an observation.' });
    }
    if (framework === 'NCF Birth–4' && !area.startsWith('ELDA ')) return res.status(400).json({ message: 'Choose an NCF ELDA for this observation.' });
    if (framework === 'CAPS Grade R' && area.startsWith('ELDA ')) return res.status(400).json({ message: 'Choose a Grade R CAPS area for this observation.' });
    payload = {
      type: 'Framework observation',
      frameworkKey: framework === 'NCF Birth–4' ? 'ncf_birth_to_four' : 'caps_grade_r',
      framework,
      area,
      learnerName,
      observation,
      evidenceReference,
      details: (learnerName + ' · ' + framework + ' · ' + area + ' · ' + observation).slice(0, 1800),
      recordedBy: actor.name || actor.username
    };
  } else {
    payload = {
      type: context.boundedText(req.body?.type, 160),
      details: context.boundedText(req.body?.details, 1800),
      recordedBy: context.boundedText(req.body?.recordedBy || actor.name || actor.username, 160),
      ...(req.params.module === 'stickyNotes' ? { colour: context.boundedText(req.body?.colour, 20) } : {})
    };
    if (!payload.type || !payload.details) return res.status(400).json({ message: 'Add a record type and details.' });
  }

  const record = context.tagSchoolRecord(actor, { ...payload, id: context.crypto.randomUUID(), ...(req.params.module === 'stickyNotes' ? { createdBy: actor.username } : {}), createdAt: new Date().toLocaleString() });
  records.unshift(record);
  res.json({ success: true, record });
});

app.patch('/api/modules/stickyNotes/:id', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can edit sticky notes.' });
  const records = context.moduleRecordCollection('stickyNotes');
  const record = records?.find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!record) return res.status(404).json({ message: 'Sticky note not found.' });
  if (!context.isAdminLike(actor) && record.createdBy !== actor.username) return res.status(403).json({ message: 'You can edit only sticky notes you created.' });
  const type = context.boundedText(req.body?.type, 160);
  const details = context.boundedText(req.body?.details, 1800);
  const colour = context.boundedText(req.body?.colour, 20);
  if (!type || !details) return res.status(400).json({ message: 'Add a note title and reminder.' });
  if (!['yellow', 'teal', 'blue', 'rose'].includes(colour)) return res.status(400).json({ message: 'Choose a supported note colour.' });
  record.type = type;
  record.details = details;
  record.colour = colour;
  record.updatedAt = new Date().toLocaleString();
  res.json({ success: true, record });
});

app.delete('/api/modules/:module/:id', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const records = context.moduleRecordCollection(req.params.module);
  if (!records) return res.status(404).json({ message: 'Unknown workspace.' });
  const record = records.find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!record) return res.status(404).json({ message: 'Workspace record not found.' });
  context.db.moduleRecords[req.params.module] = records.filter(entry => entry !== record);
  res.json({ success: true });
});

app.get('/api/parent-contacts', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) {
    return res.status(403).json({ message: 'Authorised school staff can view parent contact details.' });
  }
  const contacts = context.learnerRecordsVisibleTo(context.db.registry, actor)
    .map(context.registryRecordView)
    .map(record => ({
      id: record.id || [record.schoolId, record.learnerName, record.guardianName].map(value => String(value || '')).join('|'),
      learnerName: record.learnerName || '',
      className: record.className || '',
      guardianName: record.guardianName || '',
      guardianPhone: record.guardianPhone || '',
      guardianEmail: record.guardianEmail || '',
      emergencyContact: record.emergencyContact || ''
    }))
    .sort((first, second) => {
      const classOrder = String(first.className || '').localeCompare(String(second.className || ''), undefined, { numeric: true, sensitivity: 'base' });
      return classOrder || String(first.learnerName || '').localeCompare(String(second.learnerName || ''), undefined, { sensitivity: 'base' });
    });
  res.set('Cache-Control', 'no-store');
  res.json(contacts);
});

app.patch('/api/registry/:id/contact', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) {
    return res.status(403).json({ message: 'Authorised school staff can update parent contact details.' });
  }
  const record = context.learnerRecordsVisibleTo(context.db.registry, actor).find(entry => entry.id === req.params.id);
  if (!record) return res.status(404).json({ message: 'Learner contact record not found.' });

  const guardianName = context.limitedText(req.body?.guardianName, 160);
  const guardianPhone = context.limitedText(req.body?.guardianPhone, 80);
  const guardianEmail = context.limitedText(req.body?.guardianEmail, 160);
  const emergencyContact = context.limitedText(req.body?.emergencyContact, 500);
  if (!guardianName || !guardianPhone || guardianEmail === null || emergencyContact === null) {
    return res.status(400).json({ message: 'Enter the parent or guardian name and phone number, and keep all contact fields within their allowed length.' });
  }

  record.guardianName = guardianName;
  record.guardianPhone = context.encryptField(guardianPhone);
  record.guardianEmail = context.encryptField(guardianEmail || '');
  record.emergencyContact = context.encryptField(emergencyContact || '');
  record.updatedAt = new Date().toISOString();
  record.updatedBy = actor.username;

  const learner = context.tenantRecords(context.db.students, actor).find(student =>
    student.schoolId === record.schoolId
    && context.normalizeComparableText(student.studentName) === context.normalizeComparableText(record.learnerName)
    && context.normalizeComparableText(student.className) === context.normalizeComparableText(record.className)
  );
  if (learner) {
    const previousLearnerKey = context.learnerRecordKey(learner);
    learner.parentName = guardianName;
    learner.contactEmail = guardianEmail || '';
    learner.emergencyContact = context.encryptField(emergencyContact || '');
    learner.updatedAt = record.updatedAt;
    learner.updatedBy = actor.username;
    // Updating a guardian's contact address must not invalidate an already
    // printed learner code or affect a matching learner in another school.
    for (const code of context.db.learnerAccessCodes) {
      if (code.schoolId === learner.schoolId && code.learnerKey === previousLearnerKey) code.learnerKey = context.learnerRecordKey(learner);
    }
  }

  res.json({ success: true, record: context.registryRecordView(record) });
});

app.get('/api/registry', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can view the learner register.' });
  res.json(context.learnerRecordsVisibleTo(context.db.registry, actor).map(context.registryRecordView));
});

app.post('/api/registry', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can add register records.' });
  const learnerName = context.limitedText(req.body?.learnerName, 160);
  const className = context.limitedText(req.body?.className, 120);
  const dateOfBirth = context.limitedText(req.body?.dateOfBirth, 20);
  const guardianName = context.limitedText(req.body?.guardianName, 160);
  const guardianPhone = context.limitedText(req.body?.guardianPhone, 80);
  const guardianEmail = context.limitedText(req.body?.guardianEmail, 160);
  const address = context.limitedText(req.body?.address, 500);
  const emergencyContact = context.limitedText(req.body?.emergencyContact, 500);
  const medicalNotes = context.limitedText(req.body?.medicalNotes, 2000);
  const consent = context.limitedText(req.body?.consent || 'Pending verification', 120);
  if (!learnerName || !dateOfBirth || !guardianName || !guardianPhone || !address || guardianEmail === null || className === null || emergencyContact === null || medicalNotes === null || consent === null) {
    return res.status(400).json({ message: 'Complete the required learner fields and keep each field within its allowed length.' });
  }
  if (!context.validDateKey(dateOfBirth) || dateOfBirth >= context.dateKeyInSouthAfrica()) return res.status(400).json({ message: 'Enter a valid learner date of birth.' });
  if (actor.role === 'teacher' && (!className || !context.normaliseAssignedClasses(actor.assignedClasses).includes(context.normalizeComparableText(className)))) {
    return res.status(403).json({ message: 'Teachers can register learners only in their assigned classes.' });
  }
  const record = context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(),
    learnerName,
    className,
    dateOfBirth: context.encryptField(dateOfBirth),
    guardianName,
    guardianPhone: context.encryptField(guardianPhone),
    guardianEmail: context.encryptField(guardianEmail || ''),
    address: context.encryptField(address),
    emergencyContact: context.encryptField(emergencyContact || ''),
    medicalNotes: context.encryptField(medicalNotes || ''),
    consent,
    createdAt: new Date().toISOString(),
    createdBy: actor.username
  });
  let learner = context.tenantRecords(context.db.students, actor).find(student =>
    student.schoolId === record.schoolId
    && context.normalizeComparableText(student.studentName) === context.normalizeComparableText(learnerName)
    && context.normalizeComparableText(student.className) === context.normalizeComparableText(className)
  );
  if (!learner) {
    const learnerLimit = context.schoolLearnerLimitState(actor);
    if (!learnerLimit.allowed) return res.status(409).json({ message: `The ${learnerLimit.planCode || 'current'} school package has reached its ${learnerLimit.hardMaxLearners.toLocaleString('en-ZA')}-learner limit. Renew or move to a larger package before adding another learner.` });
    learner = context.tagSchoolRecord(actor, {
      id: context.crypto.randomUUID(),
      studentName: learnerName,
      className,
      parentName: guardianName,
      contactEmail: guardianEmail || '',
      dateOfBirth: context.encryptField(dateOfBirth),
      medicalNotes: context.encryptField(medicalNotes || ''),
      emergencyContact: context.encryptField(emergencyContact || ''),
      authorisedPickups: context.encryptField(''),
      registeredAt: new Date().toISOString(),
      registeredBy: actor.username
    });
    context.db.students.push(learner);
    context.ensureLearnerAccessCode(actor, learner);
  }
  context.db.registry.unshift(record);
  res.status(201).json({ success: true, record: context.registryRecordView(record), learnerKey: context.learnerRecordKey(learner) });
});
}

module.exports = { registerModulesRoutes };
