// Existing handlers, registered at their original middleware positions.
function registerAccountsParentSubscriptionRoutes(app, context) {
app.patch('/api/accounts/:username/parent-subscription', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator can grant parent subscription access.' });
  const parent = context.findAccountByUsername(req.params.username);
  if (!parent || parent.role !== 'parent' || !context.isSameSchool(actor, parent)) return res.status(404).json({ message: 'Parent account not found.' });
  const status = String(req.body?.status || '').toLowerCase() === 'paid' ? 'paid' : 'basic';
  const grantedUntil = context.validDateKey(req.body?.grantedUntil);
  if (req.body?.grantedUntil && !grantedUntil) return res.status(400).json({ message: 'Enter a valid access end date.' });
  parent.parentSubscriptionStatus = status;
  parent.parentSubscriptionGrantedUntil = status === 'paid' ? grantedUntil : '';
  parent.parentSubscriptionUpdatedAt = new Date().toISOString();
  parent.parentSubscriptionUpdatedBy = actor.username;
  parent.subscription = context.parentSubscriptionActive(parent) ? 'plus' : 'basic';
  res.json({ success: true, account: context.safeAccount(parent) });
});
}

function registerAccountsCatalogRoutes(app, context) {
app.get('/api/accounts/catalog', (req,res) => {
 if (!context.requireAccountManager(req)) return res.status(403).json({message:'Account management access is required.'});
 res.json({positions:context.SCHOOL_POSITION_CATALOG,sectors:context.SCHOOL_SECTORS});
});

app.get('/api/accounts', (req, res) => {
  const actor = context.requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const visibleAccounts = context.hasPlatformAccess(actor)
    ? context.db.users
    : context.db.users.filter(account => context.canManageAccount(actor, account));
  res.json(visibleAccounts.map(account => ({ ...context.safeAccount(account), canManage: context.canManageAccount(actor, account), canDelete: context.canManageAccount(actor, account) && !context.isConfiguredPlatformOwner(account) })));
});
}

function registerAccountsLearnerOptionsRoutes(app, context) {
app.get('/api/accounts/learner-options', (req, res) => {
  const actor = context.requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Account management access is required.' });
  const school = context.db.schools.find(item => context.schoolKey(item.name) === context.schoolKey(req.query.schoolName));
  if (!school || (!context.hasPlatformAccess(actor) && actor.role !== 'crm' && school.id !== context.accountSchoolId(actor))) return res.status(404).json({ message: 'School not found.' });
  res.json(context.db.students.filter(learner => learner.schoolId === school.id).map(learner => ({ id: learner.id, studentName: learner.studentName, className: learner.className })));
});
}

function registerAccountsRoutes(app, context) {
app.post('/api/accounts', (req, res) => {
  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses, schoolPosition, schoolSector } = req.body;
  const actor = context.requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const cleanUsername = context.boundedText(username, 160);
  const cleanName = context.boundedText(name, 160);
  if (!cleanUsername || !pin || !cleanName || !context.ACCOUNT_ROLES.has(role)) return res.status(400).json({ message: 'Name, username, password, and a supported role are required.' });
  if (String(pin).length < 4 || String(pin).length > 128) return res.status(400).json({ message: 'Passwords must be between 4 and 128 characters.' });
  if (context.db.users.some(account => context.accountMatchesUsername(account, cleanUsername))) return res.status(409).json({ message: 'That username is already in use.' });

  const linkValidation = role === 'parent' ? context.validateLearnerLinks(linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const normalisedStoreUrl = context.safeHttpsUrl(schoolStoreUrl);
  if (String(schoolStoreUrl || '').trim() && !normalisedStoreUrl) return res.status(400).json({ message: 'School web-store links must use a valid HTTPS URL.' });

  const position = context.validateSchoolPosition(role, schoolPosition, schoolSector);
  if (position.error) return res.status(400).json({message:position.error});
  const scope = context.resolveManagedAccountScope(actor, role, schoolName);
  if (scope.error) return res.status(403).json({ message: scope.error });
  const learnerError = context.clientLearnerLinkError(actor, scope, linkValidation.links);
  if (learnerError) return res.status(400).json({ message: learnerError });

  const account = {
    username: cleanUsername,
    pinHash: context.hashPin(pin),
    name: cleanName,
    role,
    ...position,
    schoolName: scope.schoolName,
    schoolId: scope.schoolId,
    schoolStoreUrl: normalisedStoreUrl,
    linkedLearners: linkValidation.links,
    parentRelationshipStatus: role === 'parent' ? 'Administrator approved' : undefined,
    verificationStatus: 'Active',
    assignedClasses: role === 'teacher' ? context.normaliseAssignedClasses(assignedClasses).slice(0, 30) : [],
    platformAccess: context.FULL_PLATFORM_ROLES.has(role)
  };
  context.db.users.push(account);
  res.status(201).json({ success: true, account: context.safeAccount(account) });
});
}

function registerAccountsRoutes2(app, context) {
app.put('/api/accounts/:username', (req, res) => {
  const actor = context.requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = context.findAccountByUsername(req.params.username);
  if (!context.canManageAccount(actor, account)) return res.status(404).json({ message: 'Account not found.' });

  const { username, pin, name, role, schoolName, schoolStoreUrl, linkedLearners, assignedClasses, schoolPosition, schoolSector } = req.body;
  const cleanUpdatedUsername = username === undefined ? '' : context.limitedText(username, 160);
  const cleanUpdatedName = name === undefined ? '' : context.limitedText(name, 160);
  const nextRole = role || account.role;
  if (username !== undefined && !cleanUpdatedUsername) return res.status(400).json({ message: 'Usernames must be between 1 and 160 characters.' });
  if (name !== undefined && !cleanUpdatedName) return res.status(400).json({ message: 'Names must be between 1 and 160 characters.' });
  if (role !== undefined && !context.ACCOUNT_ROLES.has(role)) return res.status(400).json({ message: 'Choose a supported account role.' });
  if (cleanUpdatedUsername && context.db.users.some(entry => entry !== account && context.accountMatchesUsername(entry, cleanUpdatedUsername))) return res.status(409).json({ message: 'That username is already in use.' });

  if (context.isConfiguredPlatformOwner(account) && nextRole !== 'admin') {
    return res.status(400).json({ message: 'The configured Little Feet owner account must remain an administrator.' });
  }
  if (account.role === 'admin' && nextRole !== 'admin' && !context.isConfiguredPlatformOwner(account)) {
    const schoolId = context.accountSchoolId(account);
    const remainingAdmins = context.db.users.filter(entry => entry !== account && entry.role === 'admin' && context.accountSchoolId(entry) === schoolId);
    if (schoolId && remainingAdmins.length < 1) return res.status(400).json({ message: 'Create another administrator before changing the final administrator account to another role.' });
  }

  if (context.isConfiguredPlatformOwner(account) && cleanUpdatedUsername && context.normalizeUsername(cleanUpdatedUsername) !== context.configuredPlatformOwnerUsername()) {
    return res.status(400).json({ message: 'The configured Little Feet owner username cannot be renamed here.' });
  }
  if (pin && (String(pin).length < 4 || String(pin).length > 128)) return res.status(400).json({ message: 'Passwords must be between 4 and 128 characters.' });
  const normalisedStoreUrl = schoolStoreUrl === undefined ? (account.schoolStoreUrl || '') : context.safeHttpsUrl(schoolStoreUrl);
  if (schoolStoreUrl !== undefined && String(schoolStoreUrl || '').trim() && !normalisedStoreUrl) return res.status(400).json({ message: 'School web-store links must use a valid HTTPS URL.' });
  const previousRole = account.role;
  const previousUsername = account.username;
  const linkValidation = nextRole === 'parent' ? context.validateLearnerLinks(linkedLearners === undefined && previousRole === 'parent' ? account.linkedLearners : linkedLearners) : { links: [] };
  if (linkValidation.error) return res.status(400).json({ message: linkValidation.error });
  const nextClasses = nextRole === 'teacher' ? context.normaliseAssignedClasses(assignedClasses === undefined && previousRole === 'teacher' ? account.assignedClasses : assignedClasses).slice(0, 30) : [];
  const nextPinHash = pin ? context.hashPin(pin) : account.pinHash;
  const nextPlatformAccess = context.FULL_PLATFORM_ROLES.has(nextRole) || context.isConfiguredPlatformOwner(account) || (previousRole === nextRole && nextRole === 'admin' && account.platformAccess === true);
  const position = context.validateSchoolPosition(nextRole, schoolPosition === undefined && previousRole === nextRole ? account.schoolPosition : schoolPosition, schoolSector === undefined && previousRole === nextRole ? account.schoolSector : schoolSector);
  if (position.error) return res.status(400).json({message:position.error});
  const scope = context.resolveManagedAccountScope(actor, nextRole, schoolName === undefined ? account.schoolName : schoolName);
  if (scope.error) return res.status(403).json({ message: scope.error });
  if (actor.role === 'crm' && scope.schoolId !== context.accountSchoolId(account)) return res.status(403).json({ message: 'CRM staff cannot move an existing user to another school.' });
  const learnerError = context.clientLearnerLinkError(actor, scope, linkValidation.links);
  if (learnerError) return res.status(400).json({ message: learnerError });

  Object.assign(account, {
    username: cleanUpdatedUsername || account.username, name: cleanUpdatedName || account.name,
    pinHash: nextPinHash, role: nextRole, ...position, schoolName: scope.schoolName, schoolId: scope.schoolId,
    platformAccess: nextPlatformAccess, schoolStoreUrl: normalisedStoreUrl,
    linkedLearners: linkedLearners === undefined && previousRole === nextRole && nextRole === 'parent' ? [...(account.linkedLearners || [])] : linkValidation.links,
    assignedClasses: assignedClasses === undefined && previousRole === nextRole && nextRole === 'teacher' ? [...(account.assignedClasses || [])] : nextClasses
  });
  context.migrateAccountReferences(previousUsername, account.username);
  if (nextRole === 'parent') {
    if (previousRole !== 'parent' || linkedLearners !== undefined) {
      account.parentRelationshipStatus = linkValidation.links.length ? 'Administrator approved' : 'Pending administrator approval';
      account.requestedLearnerLinks = [];
    }
  } else {
    delete account.parentRelationshipStatus;
    delete account.requestedLearnerLinks;
  }
  res.json({ success: true, account: context.safeAccount(account) });
});

app.delete('/api/accounts/:username', async (req, res, next) => {
  const actor = context.requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const target = context.findAccountByUsername(req.params.username);
  if (!context.canManageAccount(actor, target)) return res.status(404).json({ message: 'Account not found.' });
  if (context.isConfiguredPlatformOwner(target)) return res.status(400).json({ message: 'The configured Little Feet owner account cannot be deleted.' });
  if (target.role === 'admin') {
    const schoolId = context.accountSchoolId(target);
    const remainingAdmins = context.db.users.filter(account => account !== target && account.role === 'admin' && context.accountSchoolId(account) === schoolId);
    if (schoolId && remainingAdmins.length < 1) return res.status(400).json({ message: 'Create another administrator before removing the final administrator account.' });
  }
  try {
    const targetSchoolId = context.accountSchoolId(target);
    const staffFiles = (context.db.fileRecords || []).filter(file => file.schoolId === targetSchoolId
      && file.entityType === 'staff' && context.normalizeUsername(file.recordId) === context.normalizeUsername(target.username)
      && file.accessState !== 'deleted');
    const cleanupJob = context.queueStorageCleanup(targetSchoolId || 'platform', staffFiles, 'staff-account-deletion');
    if (cleanupJob) await context.saveDatabaseState();
    context.db.users = context.db.users.filter(account => account !== target);
    staffFiles.forEach(file => { file.accessState = 'deleted'; file.deletedAt = new Date().toISOString(); file.deletedBy = actor.username; });
    await context.saveDatabaseState();
    if (cleanupJob) {
      const cleaned = await context.runStorageCleanupJob(cleanupJob);
      await context.saveDatabaseState();
      if (!cleaned) return res.status(503).json({ message: 'The account was deleted, but its private-file cleanup requires an automatic retry.', cleanupJobId: cleanupJob.id });
    }
    req.persistenceCommitted = true;
    res.json({ success: true });
  } catch (error) { next(error); }
});

app.post('/api/accounts/:username/reset-login-lockout', (req, res) => {
  const actor = context.requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = context.findAccountByUsername(req.params.username);
  if (!context.canManageAccount(actor, account)) return res.status(404).json({ message: 'Account not found.' });
  const clearedBuckets = context.clearLoginLockoutForAccount(account);
  res.json({
    success: true,
    clearedBuckets,
    account: context.safeAccount(account),
    message: 'The 10-minute sign-in wait has been cleared. The account can try the correct password again now.'
  });
});

app.post('/api/accounts/:username/approve', (req, res) => {
  const actor = context.requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const account = context.findAccountByUsername(req.params.username);
  if (!context.canManageAccount(actor, account)) return res.status(404).json({ message: 'Account not found.' });
  account.verificationStatus = 'Active';
  if (account.role === 'parent' && !account.linkedLearners?.length) account.parentRelationshipStatus = 'Pending administrator approval';
  account.approvedAt = new Date().toISOString();
  context.scheduleReplicaSnapshot();
  res.json({ success: true, account: context.safeAccount(account) });
});
}

module.exports = { registerAccountsParentSubscriptionRoutes, registerAccountsCatalogRoutes, registerAccountsLearnerOptionsRoutes, registerAccountsRoutes, registerAccountsRoutes2 };
