// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const validateSchoolPosition = (role, position, sector) => {
 if (context.PLATFORM_INTERNAL_ROLES.has(role)) return position || sector ? {error:'Company positions cannot be assigned a school job or sector.'} : {schoolPosition:'',schoolSector:''};
 const positions=context.SCHOOL_POSITION_CATALOG[role] || [], selected=position === undefined || position === '' ? positions[0] : position;
 if (!positions.includes(selected) || (sector !== undefined && sector !== '' && !context.SCHOOL_SECTORS.includes(sector))) return {error:'Choose a supported school position and sector.'};
 return {schoolPosition:selected,schoolSector:sector || 'All School Sectors'};
};

const schoolKey = (value) => context.normalizeComparableText(value).replace(/\s+/g, ' ');

const createSchoolId = () => `school_${context.crypto.randomUUID()}`;

const ensureSchool = (schoolName) => {
  const cleanName = String(schoolName || '').trim() || 'Your School';
  if (!Array.isArray(context.db.schools)) context.db.schools = [];
  let school = context.db.schools.find(entry => context.schoolKey(entry.name) === context.schoolKey(cleanName));
  if (!school) {
    const createdAt = new Date().toISOString();
    school = {
      id: context.createSchoolId(), name: cleanName, status: 'active', createdAt,
      subscriptionStatus: 'trial_pending', trialStartedAt: '', trialEndsAt: ''
    };
    context.db.schools.push(school);
  }
  return school;
};

const accountSchoolId = (account) => {
  if (!account || context.PLATFORM_INTERNAL_ROLES.has(account.role)) return '';
  if (account.schoolId) return account.schoolId;
  const schoolName = String(account.schoolName || '').trim();
  if (!schoolName) return '';
  account.schoolId = context.ensureSchool(schoolName).id;
  return account.schoolId;
};

const registeredSchools = () => {
  const companyOwner = (context.db.users || []).find(context.isConfiguredPlatformOwner) || (context.db.users || []).find(context.hasPlatformAccess);
  const schoolIds = new Set((context.db.users || [])
    .filter(account => !context.PLATFORM_INTERNAL_ROLES.has(account.role) && !context.isAwaitingAccountVerification(account))
    .filter(account => !context.hasPlatformAccess(account) || account === companyOwner)
    .map(account => account.schoolId).filter(Boolean));
  return (context.db.schools || []).filter(school => school.status !== 'deleted' && schoolIds.has(school.id));
};

const isSameSchool = (first, second) => {
  if (!first || !second) return false;
  if (context.hasPlatformAccess(first)) return true;
  const firstSchoolId = context.accountSchoolId(first);
  const secondSchoolId = context.accountSchoolId(second);
  if (firstSchoolId && secondSchoolId) return firstSchoolId === secondSchoolId;
  return !firstSchoolId && !secondSchoolId && context.PLATFORM_INTERNAL_ROLES.has(first.role) && context.PLATFORM_INTERNAL_ROLES.has(second.role);
};

const recordInSchool = (record, actor) => {
  if (!record || !actor) return false;
  if (context.hasPlatformAccess(actor)) return true;
  const actorSchoolId = context.accountSchoolId(actor);
  return actorSchoolId ? record.schoolId === actorSchoolId : !record.schoolId && context.PLATFORM_INTERNAL_ROLES.has(actor.role);
};

const tagSchoolRecord = (actor, record) => {
  const schoolId = context.accountSchoolId(actor);
  const tagged = { ...record, schoolId, schoolName: context.PLATFORM_INTERNAL_ROLES.has(actor.role) ? '' : actor.schoolName || '' };
  if (!schoolId && (context.PLATFORM_INTERNAL_ROLES.has(actor.role) || context.hasPlatformAccess(actor))) tagged.companyScope = true;
  else delete tagged.companyScope;
  return tagged;
};

const tenantRecords = (records, actor) => (Array.isArray(records) ? (context.hasPlatformAccess(actor) ? records.slice() : records.filter(record => context.recordInSchool(record, actor))) : []);

const readSchoolSearchCache = (key, now = Date.now()) => {
  const cached = context.schoolSearchCache.get(key);
  if (!cached) return null;
  if (now - cached.createdAt >= context.SCHOOL_SEARCH_CACHE_TTL_MS) {
    context.schoolSearchCache.delete(key);
    return null;
  }
  return cached;
};

const writeSchoolSearchCache = (key, data, now = Date.now()) => {
  for (const [candidate, entry] of context.schoolSearchCache) {
    if (!entry || now - entry.createdAt >= context.SCHOOL_SEARCH_CACHE_TTL_MS) context.schoolSearchCache.delete(candidate);
  }
  if (context.schoolSearchCache.has(key)) context.schoolSearchCache.delete(key);
  while (context.schoolSearchCache.size >= context.SCHOOL_SEARCH_CACHE_MAX_ENTRIES) {
    context.schoolSearchCache.delete(context.schoolSearchCache.keys().next().value);
  }
  context.schoolSearchCache.set(key, { createdAt: now, data });
};

const requireSchoolStaff = (req) => {
  const account = context.getSessionAccount(req);
  return account && (context.hasPlatformAccess(account) || ['teacher', 'principal', 'admin', 'staff', 'crm', 'accounts', 'support', 'school_accounts', 'school_staff', 'school_hr'].includes(account.role)) ? account : null;
};

const schoolPlanForCode = code => context.schoolSubscriptionPlans.find(plan => plan.code === String(code || '').trim().toLowerCase()) || null;

const bookRecordsForSchool = actor => (context.db.bookRegister || []).filter(record => context.bookRecordVisibleTo(record, actor));

const resolveManagedAccountScope = (actor, role, requestedSchoolName) => {
  const internalRole = context.PLATFORM_INTERNAL_ROLES.has(role);
  const cleanSchoolName = context.boundedText(requestedSchoolName, 160);
  if (internalRole && !context.hasPlatformAccess(actor)) {
    return { error: 'Only Little Feet platform staff can create or assign company-level roles.' };
  }
  if (internalRole && !cleanSchoolName) return { schoolId: '', schoolName: '' };
  const effectiveSchoolName = cleanSchoolName || context.boundedText(actor.schoolName, 160);
  if (!effectiveSchoolName) return { error: 'Choose a linked school for school-facing accounts.' };
  if (actor.role === 'crm') {
    const school = context.db.schools.find(item => context.schoolKey(item.name) === context.schoolKey(effectiveSchoolName));
    return school ? { schoolId: school.id, schoolName: school.name } : { error: 'Choose an existing Little Feet client school. Only an administrator can set up a new school.' };
  }
  if (!context.hasPlatformAccess(actor) && context.schoolKey(effectiveSchoolName) !== context.schoolKey(actor.schoolName)) {
    return { error: 'Administrators can manage accounts only for their own school.' };
  }
  const school = context.ensureSchool(effectiveSchoolName);
  return { schoolId: school.id, schoolName: school.name };
};

const staffAccountInSchool = (actor, username) => {
  const account = context.findAccountByUsername(context.boundedText(username, 160));
  if (!account || !['teacher','principal','admin','school_accounts','staff','crm','accounts','support','school_staff','school_hr'].includes(account.role) || context.isAwaitingAccountVerification(account)) return null;
  const companyAccount = context.hasPlatformAccess(account) || context.PLATFORM_INTERNAL_ROLES.has(account.role);
  if (companyAccount && !context.hasPlatformAccess(actor) && context.normalizeUsername(actor.username) !== context.normalizeUsername(account.username)) return null;
  return context.isSameSchool(actor, account) ? account : null;
};

const tagEmploymentRecord = (actor, employee, record) => {
  const company = context.hasPlatformAccess(employee) || context.PLATFORM_INTERNAL_ROLES.has(employee.role);
  return context.tagSchoolRecord({ ...actor, schoolId: company ? '' : context.accountSchoolId(employee), schoolName: company ? '' : employee.schoolName }, record);
};

const purgeSchoolData = schoolId => {
  const chatGroupIds = new Set((context.db.chatGroups || []).filter(group => group.schoolId === schoolId).map(group => String(group.id)));
  for (const [key, value] of Object.entries(context.db)) {
    if (!Array.isArray(value)) continue;
    if (key === 'storageCleanupJobs') continue;
    if (key === 'schools') {
      context.db.schools = value.filter(record => record.id !== schoolId);
      continue;
    }
    if (key === 'releaseNotes') continue;
    context.db[key] = value.filter(record => record?.schoolId !== schoolId);
  }
  for (const [moduleName, records] of Object.entries(context.db.moduleRecords || {})) {
    context.db.moduleRecords[moduleName] = (records || []).filter(record => record?.schoolId !== schoolId);
  }
  for (const groupId of chatGroupIds) delete context.db.groupMessages[groupId];
  if (context.db.schoolBilling && typeof context.db.schoolBilling === 'object') delete context.db.schoolBilling[schoolId];
  if (context.db.schoolTerms && typeof context.db.schoolTerms === 'object') delete context.db.schoolTerms[schoolId];
};
return { validateSchoolPosition, schoolKey, createSchoolId, ensureSchool, accountSchoolId, registeredSchools, isSameSchool, recordInSchool, tagSchoolRecord, tenantRecords, readSchoolSearchCache, writeSchoolSearchCache, requireSchoolStaff, schoolPlanForCode, bookRecordsForSchool, resolveManagedAccountScope, staffAccountInSchool, tagEmploymentRecord, purgeSchoolData };
}
module.exports = { createHelpers };
