// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const bookRecordVisibleTo = (record, actor) => {
  if (!context.recordInSchool(record, actor)) return false;
  if (actor.role !== 'parent') return true;
  return context.normalizeUsername(record.parentUsername) === context.normalizeUsername(actor.username);
};

const bookRecordView = record => ({
  id: record.id, bookTitle: record.bookTitle, bookCode: record.bookCode, bookPrice: context.billingAmount(record.bookPrice) || 0, learnerName: record.learnerName,
  className: record.className, parentUsername: record.parentUsername, parentName: record.parentName, issueCondition: record.issueCondition,
  issuedAt: record.issuedAt, adminSignature: record.adminSignature, adminSignedAt: record.adminSignedAt,
  parentSignature: record.parentSignature, parentSignedAt: record.parentSignedAt, returnCondition: record.returnCondition,
  returnedAt: record.returnedAt, returnAdminSignature: record.returnAdminSignature, returnAdminSignedAt: record.returnAdminSignedAt,
  returnParentSignature: record.returnParentSignature, returnParentSignedAt: record.returnParentSignedAt, returnStatus: record.returnStatus || '', penaltyAmount: context.billingAmount(record.penaltyAmount) || 0, status: record.status,
  notes: record.notes, createdAt: record.createdAt
});
return { bookRecordVisibleTo, bookRecordView };
}
module.exports = { createHelpers };
