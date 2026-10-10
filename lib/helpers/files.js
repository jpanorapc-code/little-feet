// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const safeOriginalFilename = (value, extension) => {
  const leaf = String(value || `upload.${extension}`).split(/[\\/]/).pop().normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').slice(0, 180);
  const safeLeaf = leaf || `upload.${extension}`;
  return context.path.extname(safeLeaf) ? safeLeaf : `${safeLeaf}.${extension}`;
};

const decodeSupportedFileDataUrl = (value, suppliedName = '') => {
  if (typeof value !== 'string') return null;
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  const rule = match && context.FILE_TYPE_RULES[match[1].toLowerCase()];
  if (!rule || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > rule.maxBytes || !rule.validate(bytes)) return null;
  const filename = context.safeOriginalFilename(suppliedName, rule.extension);
  const suppliedExtension = context.path.extname(filename).slice(1).toLowerCase();
  const compatibleExtensions = rule.extension === 'jpg' ? new Set(['jpg', 'jpeg']) : new Set([rule.extension]);
  if (suppliedExtension && !compatibleExtensions.has(suppliedExtension)) return null;
  return { mimeType: match[1].toLowerCase(), bytes, extension: rule.extension, filename };
};

const validSignatureData = value => Boolean(context.decodeImageDataUrl(value, ['image/png'], 512 * 1024));

const sendPublicRootFile = (req, res) => {
  if (/\.js$/i.test(req.path)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(req.path.slice(1), { root: context.__dirname });
};

const loginHumanCheckSignature = ({ nonce, expiresAt, clientHash, answer }) => context.crypto
  .createHmac('sha256', context.loginHumanCheckKey)
  .update(`${nonce}\n${expiresAt}\n${clientHash}\n${String(answer ?? '').trim()}`)
  .digest('hex');

const queueStorageCleanup = (schoolId, files, reason) => {
  const objectKeys = [...new Set((files || []).map(file => file?.objectKey).filter(Boolean))];
  if (!objectKeys.length) return null;
  const job = { id: context.crypto.randomUUID(), targetSchoolId: schoolId, reason, pendingKeys: objectKeys, failedKeys: [], status: 'pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  context.db.storageCleanupJobs.unshift(job);
  return job;
};

const runStorageCleanupJob = async job => {
  if (!job || !context.objectStorage.configured) return false;
  const failed = [];
  for (const key of job.pendingKeys || []) {
    try { await context.objectStorage.delete({ key }); } catch { failed.push(key); }
  }
  job.pendingKeys = failed;
  job.failedKeys = failed;
  job.status = failed.length ? 'retry_required' : 'completed';
  job.updatedAt = new Date().toISOString();
  if (!failed.length) {
    const completedForSchool = context.db.storageCleanupJobs.filter(item => item.status === 'completed' && item.targetSchoolId === job.targetSchoolId);
    const expiredIds = new Set(completedForSchool.slice(100).map(item => item.id));
    if (expiredIds.size) context.db.storageCleanupJobs = context.db.storageCleanupJobs.filter(item => !expiredIds.has(item.id));
  }
  return !failed.length;
};

const retryPendingStorageCleanup = async () => {
  if (!context.objectStorage.configured) return;
  for (const job of context.db.storageCleanupJobs.filter(item => item.status !== 'completed').slice(0, 25)) await context.runStorageCleanupJob(job);
};

const fileContentPath = file => `/api/files/${encodeURIComponent(file.id)}/content`;

const publicFileMetadata = file => ({
  id: file.id, entityType: file.entityType, recordId: file.recordId, purpose: file.purpose,
  originalFilename: file.originalFilename, contentType: file.contentType, size: file.size,
  sha256: file.sha256, uploadedBy: file.uploadedBy, createdAt: file.createdAt,
  updatedAt: file.updatedAt || file.createdAt, accessState: file.accessState,
  verificationStatus:file.verificationStatus||'Pending review', verifiedAt:file.verifiedAt||'', verifiedBy:file.verifiedBy||'',
  rejectionReason:file.rejectionReason||'', expiryDate:file.expiryDate||'', contentUrl: file.accessState === 'active' ? context.fileContentPath(file) : null
});

const relatedRecordForFile = (file, actor) => {
  if (!file || !actor) return null;
  if (file.entityType === 'admission_application') {
    const application=(context.db.admissionsApplications||[]).find(item=>item.id===file.recordId);
    return context.admissionApplicationVisibleTo(application,actor)?application:null;
  }
  if (file.entityType === 'learner') {
    const learner=context.db.students.find(item=>item.id===file.recordId);
    if(!learner)return null;
    if(context.hasPlatformAccess(actor) || (context.recordInSchool(learner,actor)&&['principal','admin','staff'].includes(actor.role)))return learner;
    if(actor.role==='teacher')return context.learnerRecordsVisibleTo(context.db.students,actor).some(item=>item.id===learner.id)?learner:null;
    return actor.role==='parent'&&context.isParentLinkedToLearner(actor,learner)?learner:null;
  }
  if (!context.recordInSchool(file, actor)) return null;
  if (file.entityType === 'staff') return context.db.users.find(item => context.normalizeUsername(item.username) === context.normalizeUsername(file.recordId) && context.isSameSchool(item, actor));
  if (file.entityType === 'school') return context.db.schools.find(item => item.id === file.recordId && item.id === context.accountSchoolId(actor));
  if (file.entityType === 'post') return context.db.posts.find(item => item.id === file.recordId && context.recordInSchool(item, actor));
  if (file.entityType === 'worksheet') return context.learnerRecordsVisibleTo(context.db.worksheets, actor).find(item => item.id === file.recordId);
  if (file.entityType === 'dsd_incident') {
    const incident = context.learnerRecordsVisibleTo(context.db.dsdIncidents || [], actor).find(item => item.id === file.recordId);
    if (!incident) return null;
    if (context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role)) return incident;
    if (actor.role !== 'parent') return null;
    const learner = context.db.students.find(item => context.normalizeComparableText(item.studentName) === context.normalizeComparableText(incident.learnerName) && context.recordInSchool(item,actor));
    return learner && context.isParentLinkedToLearner(actor, learner) ? incident : null;
  }
  return null;
};

const canManageFile = (file, actor) => Boolean(actor && context.relatedRecordForFile(file,actor)
  && ((context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) || context.normalizeUsername(file.uploadedBy) === context.normalizeUsername(actor.username)));

const createStoredFile = async (actor, { entityType, recordId, purpose, originalFilename, dataUrl, schoolIdOverride, schoolNameOverride }) => {
  if (!context.objectStorage.configured) {
    const error = new Error('Private file storage is not configured. Ask an administrator to configure Cloudflare R2.');
    error.status = 503;
    throw error;
  }
  if (!context.FILE_ENTITY_TYPES.has(entityType)) {
    const error = new Error('Choose a supported file relationship.'); error.status = 400; throw error;
  }
  const decoded = context.decodeSupportedFileDataUrl(dataUrl, originalFilename);
  if (!decoded) {
    const error = new Error('Unsupported or invalid file. Allowed: PNG, JPEG, GIF, WebP, PDF up to 5 MB; TXT or CSV up to 2 MB.');
    error.status = 400;
    throw error;
  }
  const id = context.crypto.randomUUID();
  const storageSchoolId=schoolIdOverride||context.accountSchoolId(actor),storageSchoolName=schoolNameOverride||actor.schoolName||'';
  const key = context.objectKeyFor({ schoolId: storageSchoolId, entityType, recordId, extension: decoded.extension });
  const sha256 = context.crypto.createHash('sha256').update(decoded.bytes).digest('hex');
  const result = await context.objectStorage.put({
    key, body: decoded.bytes, contentType: decoded.mimeType,
    metadata: { fileid: id, tenant: context.crypto.createHash('sha256').update(storageSchoolId).digest('hex') }
  });
  const record = {
    id, entityType, recordId: context.boundedText(recordId, 180), purpose: context.boundedText(purpose || 'attachment', 80),
    storageProvider: context.objectStorage.kind, objectKey: key, originalFilename: decoded.filename,
    contentType: decoded.mimeType, size: decoded.bytes.length, sha256, etag: context.boundedText(result.etag, 180),
    uploadedBy: actor.username, createdAt: new Date().toISOString(), accessState: 'active',
    verificationStatus:'Pending review', verifiedAt:'', verifiedBy:'', rejectionReason:'',
    schoolId:storageSchoolId, schoolName:storageSchoolName
  };
  context.db.fileRecords.unshift(record);
  return record;
};

const rollbackStoredFile = async file => {
  context.db.fileRecords = context.db.fileRecords.filter(item => item !== file);
  await context.objectStorage.delete({ key: file.objectKey }).catch(() => {});
};
return { safeOriginalFilename, decodeSupportedFileDataUrl, validSignatureData, sendPublicRootFile, loginHumanCheckSignature, queueStorageCleanup, runStorageCleanupJob, retryPendingStorageCleanup, fileContentPath, publicFileMetadata, relatedRecordForFile, canManageFile, createStoredFile, rollbackStoredFile };
}
module.exports = { createHelpers };
