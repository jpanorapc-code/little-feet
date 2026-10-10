// Existing handlers, registered at their original middleware positions.
function registerAccountDeletionRequestRoutes(app, context) {
app.post('/api/account-deletion-request', (req, res) => {
  const requester = context.getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in before requesting account deletion.' });
  if (context.isAdminLike(requester)) return res.status(400).json({ message: 'Administrators can manage accounts directly from Account Management.' });

  const schoolId = context.accountSchoolId(requester);
  const existing = context.db.tickets.find(ticket =>
    context.recordInSchool(ticket, requester) &&
    ticket.category === 'Account deletion request' &&
    context.normalizeUsername(ticket.createdBy) === context.normalizeUsername(requester.username) &&
    ticket.status !== 'Completed'
  );
  if (existing) return res.status(409).json({ message: 'An account deletion request is already waiting for administrator review.', ticketId: existing.id });

  const administrator = context.db.users.find(account =>
    account.role === 'admin' &&
    context.accountSchoolId(account) === schoolId &&
    !String(account.verificationStatus || '').toLowerCase().includes('pending')
  );
  if (!administrator) return res.status(409).json({ message: 'No active administrator is available for this school yet.' });

  const ticket = context.tagSchoolRecord(requester, {
    id: context.crypto.randomUUID(),
    department: 'Admin',
    category: 'Account deletion request',
    priority: 'High',
    subject: `Account deletion request · ${requester.name || requester.username}`,
    message: [
      'ACCOUNT DELETION REQUEST',
      `Name: ${requester.name || 'Not recorded'}`,
      `Username / email: ${requester.username}`,
      `Role: ${requester.role}`,
      `School: ${requester.schoolName || 'Not recorded'}`,
      `Requested at: ${new Date().toISOString()}`,
      '',
      'The signed-in user requested deletion of their Little Feet account. Verify the requester and complete the approved account-deletion process.'
    ].join('\n'),
    createdBy: requester.username,
    createdByName: requester.name || requester.username,
    assignedTo: administrator.username,
    status: 'Open',
    monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }),
    createdAt: new Date().toISOString()
  });
  context.db.tickets.unshift(ticket);
  res.status(201).json({ success: true, ticket: { id: ticket.id, assignedTo: administrator.name || administrator.username, status: ticket.status } });
});

app.post('/api/school-deletion-request', (req, res) => {
  const requester = context.getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in before requesting school deletion.' });
  if (requester.role !== 'principal') {
    return res.status(403).json({ message: 'Only the school principal can request deletion of the entire school account and its linked data.' });
  }

  const existing = context.db.tickets.find(ticket =>
    context.recordInSchool(ticket, requester) &&
    ticket.category === 'School deletion request' &&
    ticket.status !== 'Completed'
  );
  if (existing) return res.status(409).json({ message: 'A school deletion request is already waiting for administrator review.', ticketId: existing.id });

  const administrator = context.db.users.find(account =>
    account.role === 'admin' &&
    context.isSameSchool(requester, account) &&
    !String(account.verificationStatus || '').toLowerCase().includes('pending')
  );
  if (!administrator) return res.status(409).json({ message: 'No active administrator is available for this school yet.' });

  const ticket = context.tagSchoolRecord(requester, {
    id: context.crypto.randomUUID(),
    department: 'Admin',
    category: 'School deletion request',
    priority: 'High',
    subject: `SCHOOL DELETION REQUEST · ${requester.schoolName}`,
    message: [
      'SCHOOL DELETION REQUEST',
      `School: ${requester.schoolName || 'Not recorded'}`,
      `School ID: ${context.accountSchoolId(requester)}`,
      `Requested by: ${requester.name || requester.username}`,
      `Username / email: ${requester.username}`,
      `Role: ${requester.role}`,
      `Requested at: ${new Date().toISOString()}`,
      '',
      'WARNING: Approval permanently deletes every account and every school-scoped record linked to this school. The administrator must verify the request before approval.'
    ].join('\n'),
    createdBy: requester.username,
    createdByName: requester.name || requester.username,
    assignedTo: administrator.username,
    status: 'Open',
    monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }),
    createdAt: new Date().toISOString()
  });
  context.db.tickets.unshift(ticket);
  res.status(201).json({ success: true, ticket: { id: ticket.id, assignedTo: administrator.name || administrator.username, status: ticket.status } });
});
}

function registerSchoolDeletionExecuteRoutes(app, context) {
app.post('/api/school-deletion/execute', async (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const ticketId = String(req.body?.ticketId || '');
  const confirmation = String(req.body?.confirmation || '').trim();
  if (confirmation !== 'DELETE SCHOOL') return res.status(400).json({ message: 'Type DELETE SCHOOL exactly to confirm the permanent deletion.' });

  const ticket = context.db.tickets.find(entry =>
    entry.id === ticketId &&
    entry.category === 'School deletion request' &&
    entry.status !== 'Completed' &&
    context.recordInSchool(entry, actor)
  );
  if (!ticket) return res.status(404).json({ message: 'Open school deletion request not found.' });

  const schoolId = context.accountSchoolId(actor);
  const schoolName = actor.schoolName;
  if (context.db.users.some(account => context.isConfiguredPlatformOwner(account) && context.accountSchoolId(account) === schoolId)) {
    return res.status(409).json({ message: 'This school cannot be deleted because it contains the protected Little Feet owner account.' });
  }
  const schoolFiles = (context.db.fileRecords || []).filter(file => file.schoolId === schoolId && file.accessState !== 'deleted');
  const cleanupJob = context.queueStorageCleanup(schoolId, schoolFiles, 'school-deletion');
  if (cleanupJob) await context.saveDatabaseState();
  context.purgeSchoolData(schoolId);
  await context.saveDatabaseState();

  if (context.postgresPool) {
    await context.postgresPool.query(
      `DELETE FROM little_feet_sessions
       WHERE sess->'littleFeetUser'->>'schoolId' = $1`,
      [schoolId]
    );
  }

  if (cleanupJob) {
    const cleaned = await context.runStorageCleanupJob(cleanupJob);
    await context.saveDatabaseState();
    if (!cleaned) return res.status(503).json({ message: 'The school records were deleted, but private object cleanup requires an automatic retry.', cleanupJobId: cleanupJob.id });
  }

  req.persistenceCommitted = true;
  res.json({ success: true, deletedSchoolId: schoolId, deletedSchoolName: schoolName });
});
}

module.exports = { registerAccountDeletionRequestRoutes, registerSchoolDeletionExecuteRoutes };
