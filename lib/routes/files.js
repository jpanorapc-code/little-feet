// Existing handlers, registered at their original middleware positions.
function registerFilesRoutes(app, context) {
app.get('/api/files', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view files.' });
  const entityType = context.boundedText(req.query.entityType, 40);
  const recordId = context.boundedText(req.query.recordId, 180);
  const files = (context.db.fileRecords||[]).filter(file => file.accessState === 'active'
    && (!entityType || file.entityType === entityType) && (!recordId || file.recordId === recordId)
    && context.relatedRecordForFile(file, actor));
  res.json(files.map(context.publicFileMetadata));
});

app.post('/api/files', async (req, res, next) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in before uploading files.' });
  const entityType = context.boundedText(req.body?.entityType, 40);
  const recordId = context.boundedText(req.body?.recordId, 180);
  const probe = {entityType,recordId,schoolId:context.accountSchoolId(actor)};
  const related=recordId&&context.relatedRecordForFile(probe, actor);
  const staffAllowed=context.hasPlatformAccess(actor)||['teacher','principal','admin','staff'].includes(actor.role);
  const parentAllowed=actor.role==='parent'&&['learner','admission_application'].includes(entityType);
  if(!staffAllowed&&!parentAllowed)return res.status(403).json({message:'You cannot upload files for this record.'});
  if (!related) return res.status(404).json({ message: 'The related school record was not found.' });
  let file;
  try {
    file = await context.createStoredFile(actor, { entityType, recordId, purpose: req.body?.purpose, originalFilename: req.body?.originalFilename, dataUrl: req.body?.dataUrl,
      schoolIdOverride:related.schoolId||context.accountSchoolId(actor),schoolNameOverride:related.schoolName||actor.schoolName||'' });
    if(['learner','admission_application'].includes(entityType))context.db.documentAudit.unshift({id:context.crypto.randomUUID(),schoolId:file.schoolId,entityType,recordId,fileId:file.id,action:'uploaded',by:actor.username,at:new Date().toISOString(),details:file.originalFilename});
    await context.saveDatabaseState();
    req.persistenceCommitted = true;
    res.status(201).json({ success: true, file: context.publicFileMetadata(file) });
  } catch (error) {
    if (file) await context.rollbackStoredFile(file);
    next(error);
  }
});

app.get('/api/files/integrity', async (req, res, next) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  if (!context.objectStorage.configured) return res.status(503).json({ message: 'Cloudflare R2 storage is not configured.' });
  try {
    const files = context.tenantRecords(context.db.fileRecords, actor).filter(file => file.accessState === 'active').slice(0, 500);
    const results = [];
    for (const file of files) {
      try {
        const object = await context.objectStorage.head({ key: file.objectKey });
        results.push({ id: file.id, status: Number(object.size) === Number(file.size) ? 'ok' : 'size_mismatch' });
      } catch (error) {
        results.push({ id: file.id, status: (error?.code === 'ENOENT' || Number(error?.$metadata?.httpStatusCode) === 404) ? 'missing' : 'unverified' });
      }
    }
    const issues = results.filter(item => item.status !== 'ok');
    res.json({ checked: results.length, limited: context.tenantRecords(context.db.fileRecords, actor).filter(file => file.accessState === 'active').length > 500, issues });
  } catch (error) { next(error); }
});

app.put('/api/files/:id', async (req, res, next) => {
  const actor = context.getSessionAccount(req);
  const previous = actor && context.db.fileRecords.find(item => item.id === req.params.id && item.accessState === 'active' && context.relatedRecordForFile(item,actor));
  if (!previous || !context.canManageFile(previous, actor)) return res.status(404).json({ message: 'File not found.' });
  let replacement;
  let previousObjectDeleted = false;
  try {
    replacement = await context.createStoredFile(actor, {
      entityType: previous.entityType, recordId: previous.recordId, purpose: previous.purpose,
      originalFilename: req.body?.originalFilename, dataUrl: req.body?.dataUrl
    });
    replacement.replacesFileId = previous.id;
    previous.accessState = 'replaced'; previous.replacedByFileId = replacement.id; previous.updatedAt = new Date().toISOString();
    const related = context.relatedRecordForFile(replacement, actor);
    if (related && previous.entityType === 'post' && related.mediaFileId === previous.id) related.mediaFileId = replacement.id;
    if (related && previous.entityType === 'worksheet' && related.photoFileId === previous.id) related.photoFileId = replacement.id;
    await context.saveDatabaseState();
    await context.objectStorage.delete({ key: previous.objectKey });
    previousObjectDeleted = true;
    previous.accessState = 'deleted'; previous.deletedAt = new Date().toISOString();
    await context.saveDatabaseState();
    req.persistenceCommitted = true;
    res.json({ success: true, file: context.publicFileMetadata(replacement) });
  } catch (error) {
    if (replacement && !previousObjectDeleted) await context.rollbackStoredFile(replacement);
    previous.accessState = previousObjectDeleted ? 'deleted' : 'active';
    if (!previousObjectDeleted) { delete previous.replacedByFileId; delete previous.deletedAt; }
    await context.saveDatabaseState().catch(() => {});
    next(error);
  }
});

app.get('/api/files/:id/content', async (req, res, next) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to download files.' });
  const file = context.db.fileRecords.find(item => item.id === req.params.id && item.accessState === 'active');
  if (!file || !context.relatedRecordForFile(file, actor)) return res.status(404).json({ message: 'File not found.' });
  try {
    const object = await context.objectStorage.get({ key: file.objectKey });
    const bytes = Buffer.from(object.body);
    if (bytes.length !== file.size || context.crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      return res.status(409).json({ message: 'The stored file failed its integrity check. An administrator must restore or replace it.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', `inline; filename="${context.safeOriginalFilename(file.originalFilename, 'bin').replace(/["\\]/g, '_')}"`);
    res.send(bytes);
  } catch (error) {
    if (String(error?.name || '').includes('NoSuchKey') || Number(error?.$metadata?.httpStatusCode) === 404 || error?.code === 'ENOENT') {
      return res.status(404).json({ message: 'The file metadata exists, but the stored object is missing. An administrator must restore or replace it.' });
    }
    next(error);
  }
});

app.delete('/api/files/:id', async (req, res, next) => {
  const actor = context.getSessionAccount(req);
  const file = actor && context.db.fileRecords.find(item => item.id === req.params.id && item.accessState === 'active' && context.relatedRecordForFile(item,actor));
  if (!file || !context.canManageFile(file, actor)) return res.status(404).json({ message: 'File not found.' });
  try {
    const related = context.relatedRecordForFile(file, actor);
    file.accessState = 'pending_delete'; file.updatedAt = new Date().toISOString();
    if (related && file.entityType === 'post' && related.mediaFileId === file.id) related.mediaFileId = null;
    if (related && file.entityType === 'worksheet' && related.photoFileId === file.id) related.photoFileId = null;
    await context.saveDatabaseState();
    await context.objectStorage.delete({ key: file.objectKey });
    file.accessState = 'deleted'; file.deletedAt = new Date().toISOString(); file.deletedBy = actor.username;
    await context.saveDatabaseState();
    req.persistenceCommitted = true;
    res.json({ success: true });
  } catch (error) {
    file.accessState = 'active'; delete file.deletedAt; delete file.deletedBy;
    const related = context.relatedRecordForFile(file, actor);
    if (related && file.entityType === 'post') related.mediaFileId = file.id;
    if (related && file.entityType === 'worksheet') related.photoFileId = file.id;
    await context.saveDatabaseState().catch(() => {});
    next(error);
  }
});
}

function registerLearnerDocumentsRoutes(app, context) {
app.get('/api/learner-documents',(req,res)=>{
  const actor=context.getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view learner documents.'});
  let learners=[];
  if(actor.role==='parent')learners=(context.db.students||[]).filter(learner=>context.isParentLinkedToLearner(actor,learner));
  else if(actor.role==='teacher')learners=context.learnerRecordsVisibleTo(context.db.students,actor);
  else if(context.hasPlatformAccess(actor)||['principal','admin','staff'].includes(actor.role))learners=context.tenantRecords(context.db.students,actor);
  else return res.status(403).json({message:'You cannot view learner documents.'});
  const learnerIds=new Set(learners.map(item=>item.id));
  const files=(context.db.fileRecords||[]).filter(file=>file.entityType==='learner'&&file.accessState==='active'&&learnerIds.has(file.recordId)&&context.relatedRecordForFile(file,actor));
  res.json(learners.map(learner=>({learner:{id:learner.id,studentName:learner.studentName,className:learner.className},documents:files.filter(file=>file.recordId===learner.id).map(context.publicFileMetadata)})));
});

app.patch('/api/learner-documents/:learnerId/:fileId',(req,res)=>{
  const actor=context.admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'School management access is required.'});
  const learner=context.tenantRecords(context.db.students,actor).find(item=>item.id===req.params.learnerId);if(!learner)return res.status(404).json({message:'Learner not found.'});
  const file=(context.db.fileRecords||[]).find(item=>item.id===req.params.fileId&&item.entityType==='learner'&&item.recordId===learner.id&&item.accessState==='active');
  if(!file)return res.status(404).json({message:'Learner document not found.'});
  const expiryDate=context.boundedText(req.body?.expiryDate,10);
  if(expiryDate&&!context.validDateKey(expiryDate))return res.status(400).json({message:'Choose a valid expiry date.'});
  const purpose=context.boundedText(req.body?.purpose||file.purpose,80);if(!purpose)return res.status(400).json({message:'Document type is required.'});
  file.expiryDate=expiryDate;file.purpose=purpose;file.updatedAt=new Date().toISOString();
  context.db.documentAudit.unshift({id:context.crypto.randomUUID(),schoolId:learner.schoolId,entityType:'learner',recordId:learner.id,fileId:file.id,action:'metadata_updated',by:actor.username,at:file.updatedAt,details:expiryDate?('Expiry '+expiryDate):'Expiry cleared'});
  res.json({success:true,file:context.publicFileMetadata(file)});
});

app.get('/api/learner-documents/:learnerId/audit',(req,res)=>{
  const actor=context.getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view document history.'});
  const learner=(context.db.students||[]).find(item=>item.id===req.params.learnerId);
  if(!learner||!context.relatedRecordForFile({entityType:'learner',recordId:learner.id,schoolId:learner.schoolId},actor))return res.status(404).json({message:'Learner not found.'});
  res.json((context.db.documentAudit||[]).filter(row=>row.entityType==='learner'&&row.recordId===learner.id).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)));
});

app.post('/api/learner-documents/:learnerId/:fileId/verify',(req,res)=>{
  const actor=context.admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'School management access is required.'});
  const learner=context.tenantRecords(context.db.students,actor).find(item=>item.id===req.params.learnerId);if(!learner)return res.status(404).json({message:'Learner not found.'});
  const file=(context.db.fileRecords||[]).find(item=>item.id===req.params.fileId&&item.entityType==='learner'&&item.recordId===learner.id&&item.accessState==='active');
  if(!file)return res.status(404).json({message:'Learner document not found.'});
  const status=context.boundedText(req.body?.status,30),reason=context.boundedText(req.body?.reason,500);if(!['Verified','Rejected'].includes(status))return res.status(400).json({message:'Choose Verified or Rejected.'});if(status==='Rejected'&&!reason)return res.status(400).json({message:'Add a rejection reason.'});
  file.verificationStatus=status;file.verifiedAt=status==='Verified'?new Date().toISOString():'';file.verifiedBy=status==='Verified'?actor.username:'';file.rejectionReason=status==='Rejected'?reason:'';
  context.db.documentAudit.unshift({id:context.crypto.randomUUID(),schoolId:learner.schoolId,entityType:'learner',recordId:learner.id,fileId:file.id,action:status==='Verified'?'verified':'rejected',by:actor.username,at:new Date().toISOString(),details:reason||''});
  res.json({success:true,file:context.publicFileMetadata(file)});
});
}

module.exports = { registerFilesRoutes, registerLearnerDocumentsRoutes };
