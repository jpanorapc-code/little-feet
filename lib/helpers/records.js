// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const registryRecordView = (record) => ({
  ...record,
  dateOfBirth: context.decryptStoredField(record.dateOfBirth),
  guardianPhone: context.decryptStoredField(record.guardianPhone),
  guardianEmail: context.decryptStoredField(record.guardianEmail),
  address: context.decryptStoredField(record.address),
  emergencyContact: context.decryptStoredField(record.emergencyContact),
  medicalNotes: context.decryptStoredField(record.medicalNotes)
});

const moduleRecordCollection = moduleName =>
  Object.hasOwn(context.db.moduleRecords || {}, moduleName) && Array.isArray(context.db.moduleRecords[moduleName])
    ? context.db.moduleRecords[moduleName]
    : null;
return { registryRecordView, moduleRecordCollection };
}
module.exports = { createHelpers };
