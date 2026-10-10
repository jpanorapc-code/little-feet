// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const learnerRecordKey = (learner) => [learner?.studentName, learner?.className, learner?.contactEmail].map(context.normalizeComparableText).join('|');

const generateLearnerAccessCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segment = () => Array.from(context.crypto.randomBytes(4), byte => alphabet[byte % alphabet.length]).join('');
  return `LF-${segment()}-${segment()}`;
};

const normaliseLearnerLinks = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(context.normalizeComparableText).filter(Boolean))];

const validateLearnerLinks = (value) => {
  const links = context.normaliseLearnerLinks(value);
  return links.length <= 4 ? { links } : { error: 'A parent account can be linked to a maximum of four learners.' };
};

const isParentLinkedToLearner = (parent, learner) => {
  if (!parent || !learner) return false;
  if (parent.role !== 'parent' || parent.parentRelationshipStatus !== 'Administrator approved') return false;
  if (!context.recordInSchool(learner, parent)) return false;
  const name = context.normalizeComparableText(learner.studentName);
  if (!context.normaliseLearnerLinks(parent.linkedLearners).includes(name)) return false;
  // Legacy links contain names. An ambiguous name must never grant access to
  // another child's private records.
  return (context.db.students || []).filter(item => context.recordInSchool(item, parent)
    && context.normalizeComparableText(item.studentName) === name).length === 1;
};

const normaliseAssignedClasses = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(context.normalizeComparableText).filter(Boolean))];

const studentSensitiveView = (student) => ({
  ...student,
  dateOfBirth: context.decryptStoredField(student.dateOfBirth),
  medicalNotes: context.decryptStoredField(student.medicalNotes),
  emergencyContact: context.decryptStoredField(student.emergencyContact),
  authorisedPickups: context.decryptStoredField(student.authorisedPickups)
});

const createUniqueLearnerAccessCode = () => {
  let code;
  do { code = context.generateLearnerAccessCode(); } while (context.accessCodeInUse(code));
  return code;
};

const ensureLearnerAccessCode = (actor, learner) => {
  const learnerKey = context.learnerRecordKey(learner);
  const schoolId = learner.schoolId || context.accountSchoolId(actor);
  const existing = context.db.learnerAccessCodes.find(entry => entry.learnerKey === learnerKey && entry.status === 'active' && entry.schoolId === schoolId);
  if (existing) return existing;
  const accessCode = context.createUniqueLearnerAccessCode();
  const record = context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), learnerKey, codeEncrypted: context.encryptField(accessCode), status: 'active', issuedAt: new Date().toISOString(), issuedBy: actor.username, source: 'automatic-learner-creation' });
  record.schoolId = schoolId;
  record.schoolName = learner.schoolName || actor.schoolName || '';
  context.db.learnerAccessCodes.unshift(record);
  return record;
};

const ensureAllLearnersHaveAccessCodes = () => {
  (context.db.students || []).forEach(learner => {
    const learnerKey = context.learnerRecordKey(learner);
    if (!learner.schoolId || context.db.learnerAccessCodes.some(entry => entry.learnerKey === learnerKey && entry.status === 'active' && entry.schoolId === learner.schoolId)) return;
    const accessCode = context.createUniqueLearnerAccessCode();
    context.db.learnerAccessCodes.unshift({
      id: context.crypto.randomUUID(),
      learnerKey,
      codeEncrypted: context.encryptField(accessCode),
      status: 'active',
      issuedAt: new Date().toISOString(),
      issuedBy: 'system',
      source: 'automatic-legacy-migration',
      schoolId: learner.schoolId,
      schoolName: learner.schoolName || ''
    });
  });
};

const learnerRecordsVisibleTo = (records, actor) => {
  const schoolRecords = context.tenantRecords(records, actor);
  if (actor?.role === 'parent') {
    const linkedLearnerNames = new Set(
      context.tenantRecords(context.db.students, actor)
        .filter(student => context.isParentLinkedToLearner(actor, student))
        .map(student => context.normalizeComparableText(student.studentName))
    );
    return schoolRecords.filter(record => linkedLearnerNames.has(context.normalizeComparableText(record.studentName || record.learnerName)));
  }
  if (actor?.role === 'teacher') {
    const assignedClasses = new Set(context.normaliseAssignedClasses(actor.assignedClasses));
    if (!assignedClasses.size) return [];
    const schoolLearners = context.tenantRecords(context.db.students, actor);
    const outsideClassNames = new Set(schoolLearners
      .filter(student => !assignedClasses.has(context.normalizeComparableText(student.className)))
      .map(student => context.normalizeComparableText(student.studentName)));
    const assignedLearnerIds = new Set(schoolLearners
      .filter(student => assignedClasses.has(context.normalizeComparableText(student.className)))
      .map(student => String(student.id || '')).filter(Boolean));
    const assignedLearners = new Set(
      schoolLearners
        .filter(student => assignedClasses.has(context.normalizeComparableText(student.className)))
        .map(student => context.normalizeComparableText(student.studentName))
        .filter(name => !outsideClassNames.has(name))
    );
    return schoolRecords.filter(record => {
      const learnerId = String(record.learnerId || record.learnerKey || record.studentId || '');
      if (learnerId) return assignedLearnerIds.has(learnerId);
      const recordClass = context.normalizeComparableText(record.className);
      if (recordClass) return assignedClasses.has(recordClass);
      return assignedLearners.has(context.normalizeComparableText(record.studentName || record.learnerName));
    });
  }
  return schoolRecords;
};

const schoolLearnerCount = schoolId => (context.db.students || []).filter(student => student.schoolId === schoolId).length;

const planPriceForLearners = (plan, learnerCount) => {
  const count = Math.max(0, Number(learnerCount) || 0);
  const overageLearners = Math.max(0, count - plan.maxLearners);
  return {
    learnerCount: count,
    overageLearners,
    overageRate: plan.overagePerLearner,
    monthlyTotal: Math.round((plan.monthlyPrice + (overageLearners * plan.overagePerLearner)) * 100) / 100
  };
};

const schoolLearnerLimitState = actor => {
  const schoolId = context.accountSchoolId(actor);
  const school = context.db.schools.find(entry => entry.id === schoolId);
  const count = context.schoolLearnerCount(schoolId);
  const access = context.schoolSubscriptionAccessState(actor);
  if (!school || context.hasPlatformAccess(actor)) return { allowed: true, learnerCount: count, hardMaxLearners: 1000, planCode: '' };
  if (access.status === 'trial') return { allowed: count < 1000, learnerCount: count, hardMaxLearners: 1000, planCode: 'trial' };
  const plan = context.schoolPlanForCode(school.subscriptionPlanCode);
  const hardMaxLearners = plan?.hardMaxLearners || 1000;
  return { allowed: count < hardMaxLearners, learnerCount: count, hardMaxLearners, planCode: plan?.code || '' };
};

const clientLearnerLinkError = (actor, scope, links) => {
  if (actor.role !== 'crm') return '';
  return links.some(name => context.db.students.filter(student => student.schoolId === scope.schoolId && context.normalizeComparableText(student.studentName) === context.normalizeComparableText(name)).length !== 1)
    ? 'Choose uniquely identified learners enrolled at the selected school.' : '';
};

const findLearnerAccessCodeActor = (req) => {
  const actor = context.getSessionAccount(req);
  return actor && (context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) ? actor : null;
};

const learnerAccessCodeView = (learner, actor, { includeCode = false, includeHistory = false } = {}) => {
  const key = context.learnerRecordKey(learner);
  const activeCode = context.db.learnerAccessCodes.find(entry => entry.learnerKey === key && entry.schoolId === learner.schoolId && entry.status === 'active' && context.recordInSchool(entry, actor));
  const history = context.db.learnerAccessCodes
    .filter(entry => entry.learnerKey === key && entry.schoolId === learner.schoolId && context.recordInSchool(entry, actor))
    .map(entry => ({
      id: entry.id,
      status: entry.status,
      issuedAt: entry.issuedAt || null,
      issuedBy: entry.issuedBy || null,
      changedAt: entry.replacedAt || entry.revokedAt || entry.redeemedAt || null,
      changedBy: entry.replacedBy || entry.revokedBy || entry.redeemedBy || null
    }))
    .sort((left, right) => String(right.issuedAt || '').localeCompare(String(left.issuedAt || '')));
  return {
    learnerKey: key,
    schoolId: learner.schoolId || '',
    learnerName: learner.studentName,
    className: learner.className,
    parentName: learner.parentName || '',
    contactEmail: learner.contactEmail || '',
    codeRecordId: activeCode?.id || null,
    // A code is only shown in the administrator's register. Principals receive
    // a print action, not a list of credentials, and teachers never receive one.
    accessCode: includeCode && activeCode ? context.decryptField(activeCode.codeEncrypted) : null,
    issuedAt: activeCode?.issuedAt || null,
    issuedBy: activeCode?.issuedBy || null,
    hasPrintableForm: Boolean(activeCode),
    codeHistory: includeHistory ? history : []
  };
};
return { learnerRecordKey, generateLearnerAccessCode, normaliseLearnerLinks, validateLearnerLinks, isParentLinkedToLearner, normaliseAssignedClasses, studentSensitiveView, createUniqueLearnerAccessCode, ensureLearnerAccessCode, ensureAllLearnersHaveAccessCodes, learnerRecordsVisibleTo, schoolLearnerCount, planPriceForLearners, schoolLearnerLimitState, clientLearnerLinkError, findLearnerAccessCodeActor, learnerAccessCodeView };
}
module.exports = { createHelpers };
