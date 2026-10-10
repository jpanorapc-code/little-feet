// Existing handlers, registered at their original middleware positions.
function registerAdmissionsApplicationsRoutes(app, context) {
app.get('/api/admissions/applications',(req,res)=>{
  const actor=context.getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view admissions.'});
  let rows=(context.db.admissionsApplications||[]).filter(item=>context.admissionApplicationVisibleTo(item,actor));
  rows=rows.sort((a,b)=>Date.parse(b.updatedAt||b.createdAt)-Date.parse(a.updatedAt||a.createdAt));
  res.json(rows.map(context.admissionApiView));
});

app.get('/api/admissions/applications/:id',(req,res)=>{
  const actor=context.getSessionAccount(req),application=actor&&context.admissionForActor(actor,req.params.id);
  if(!application)return res.status(404).json({message:'Application not found.'});
  res.json(context.admissionApiView(application));
});

app.get('/api/admissions/applications/:id/history',(req,res)=>{
  const actor=context.getSessionAccount(req),application=actor&&context.admissionForActor(actor,req.params.id);
  if(!application)return res.status(404).json({message:'Application not found.'});
  res.json((context.db.admissionsStatusHistory||[]).filter(row=>row.applicationId===application.id).sort((a,b)=>Date.parse(b.changedAt)-Date.parse(a.changedAt)));
});

app.patch('/api/admissions/applications/:id/status',(req,res)=>{
  const actor=context.admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'Admissions management access is required.'});
  const application=(context.db.admissionsApplications||[]).find(item=>item.id===req.params.id&&context.recordInSchool(item,actor));
  if(!application)return res.status(404).json({message:'Application not found.'});
  const nextStatus=context.boundedText(req.body?.status,40),note=context.boundedText(req.body?.note,1200);
  if(!context.ADMISSION_STATUSES.has(nextStatus)||nextStatus==='Enrolled')return res.status(400).json({message:'Choose a valid admissions status. Use Enrol to create the learner record.'});
  if(application.status==='Enrolled')return res.status(409).json({message:'An enrolled application cannot be moved back into the admissions queue.'});
  const previous=application.status;
  application.status=nextStatus;application.reviewNote=note;application.updatedAt=new Date().toISOString();application.updatedBy=actor.username;
  context.db.admissionsStatusHistory.unshift({id:context.crypto.randomUUID(),applicationId:application.id,schoolId:application.schoolId,fromStatus:previous,toStatus:nextStatus,changedBy:actor.username,changedAt:application.updatedAt,note});
  const ticket=(context.db.tickets||[]).find(item=>item.applicationId===application.id&&context.recordInSchool(item,actor));
  if(ticket){ticket.status=['Approved','Rejected','Withdrawn'].includes(nextStatus)?'Completed':'Open';ticket.updatedAt=application.updatedAt;}
  if(nextStatus==='Documents required'){
    const missing=context.admissionDocumentState(application).checklist.filter(item=>item.required&&item.status!=='verified').map(item=>item.label);
    void context.notifyAdmissionParent(application,'Admission documents required',missing.length?('Please upload or replace these required documents: '+missing.join(', ')+'.'):'The school requested additional admission documents.').catch(()=>{});
  }else if(['Waitlisted','Approved','Rejected'].includes(nextStatus)){
    void context.notifyAdmissionParent(application,'School application update',application.learnerName+' application status is now '+nextStatus+'.'+(note?' '+note:'')).catch(()=>{});
  }
  res.json({success:true,application:context.admissionApiView(application)});
});

app.post('/api/admissions/applications/:id/withdraw',(req,res)=>{
  const actor=context.getSessionAccount(req),application=actor&&context.admissionForActor(actor,req.params.id);
  if(!application||actor.role!=='parent'||context.normalizeUsername(application.createdBy)!==context.normalizeUsername(actor.username))return res.status(404).json({message:'Application not found.'});
  if(['Enrolled','Rejected','Withdrawn'].includes(application.status))return res.status(409).json({message:'This application can no longer be withdrawn.'});
  const previous=application.status;application.status='Withdrawn';application.updatedAt=new Date().toISOString();application.updatedBy=actor.username;
  context.db.admissionsStatusHistory.unshift({id:context.crypto.randomUUID(),applicationId:application.id,schoolId:application.schoolId,fromStatus:previous,toStatus:'Withdrawn',changedBy:actor.username,changedAt:application.updatedAt,note:'Withdrawn by parent'});
  res.json({success:true,application:context.admissionApiView(application)});
});

app.put('/api/admissions/applications/:id/checklist',(req,res)=>{
  const actor=context.admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'Admissions management access is required.'});
  const application=(context.db.admissionsApplications||[]).find(item=>item.id===req.params.id&&context.recordInSchool(item,actor));
  if(!application)return res.status(404).json({message:'Application not found.'});
  const incoming=Array.isArray(req.body?.items)?req.body.items:[];
  if(!incoming.length)return res.status(400).json({message:'Add at least one checklist item.'});
  const existing=new Map((application.checklist||[]).map(item=>[item.key,item]));
  if(incoming.length>30)return res.status(400).json({message:'Use no more than 30 checklist items.'});
  const checklist=incoming.map(raw=>{
    const key=context.boundedText(raw?.key,80).replace(/[^a-z0-9_-]/gi,'_').toLowerCase(),label=context.limitedText(raw?.label,160);
    const old=existing.get(key)||{};
    return {key,label:label||old.label||key,required:Boolean(raw?.required),status:old.status||'missing',verifiedAt:old.verifiedAt||'',verifiedBy:old.verifiedBy||''};
  }).filter(item=>item.key&&item.label);
  if(checklist.length!==incoming.length||new Set(checklist.map(item=>item.key)).size!==checklist.length)return res.status(400).json({message:'Checklist items must have valid, unique names.'});
  application.checklist=checklist;
  application.updatedAt=new Date().toISOString();application.updatedBy=actor.username;
  res.json({success:true,application:context.admissionApiView(application)});
});

app.post('/api/admissions/applications/:id/documents/:fileId/verify',(req,res)=>{
  const actor=context.admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'Admissions management access is required.'});
  const application=(context.db.admissionsApplications||[]).find(item=>item.id===req.params.id&&context.recordInSchool(item,actor));
  if(!application)return res.status(404).json({message:'Application not found.'});
  const file=(context.db.fileRecords||[]).find(item=>item.id===req.params.fileId&&item.entityType==='admission_application'&&item.recordId===application.id&&item.accessState==='active');
  if(!file)return res.status(404).json({message:'Application document not found.'});
  const status=context.boundedText(req.body?.status,30),reason=context.boundedText(req.body?.reason,500);
  if(!['Verified','Rejected'].includes(status))return res.status(400).json({message:'Choose Verified or Rejected.'});
  if(status==='Rejected'&&!reason)return res.status(400).json({message:'Add a reason when rejecting a document.'});
  file.verificationStatus=status;file.verifiedAt=status==='Verified'?new Date().toISOString():'';file.verifiedBy=status==='Verified'?actor.username:'';file.rejectionReason=status==='Rejected'?reason:'';
  context.db.documentAudit.unshift({id:context.crypto.randomUUID(),schoolId:application.schoolId,entityType:'admission_application',recordId:application.id,fileId:file.id,action:status==='Verified'?'verified':'rejected',by:actor.username,at:new Date().toISOString(),details:reason||''});
  const item=(application.checklist||[]).find(row=>row.key===file.purpose);
  if(item){item.status=status==='Verified'?'verified':'rejected';item.verifiedAt=file.verifiedAt;item.verifiedBy=file.verifiedBy;}
  application.updatedAt=new Date().toISOString();application.updatedBy=actor.username;
  if(status==='Rejected')void context.notifyAdmissionParent(application,'Admission document rejected','The school rejected '+file.originalFilename+'. Reason: '+reason).catch(()=>{});
  res.json({success:true,file:context.publicFileMetadata(file),application:context.admissionApiView(application)});
});

app.post('/api/admissions/applications/:id/enrol',(req,res)=>{
  const actor=context.admissionsManagementActor(req);if(!actor)return res.status(403).json({message:'Admissions management access is required.'});
  const application=(context.db.admissionsApplications||[]).find(item=>item.id===req.params.id&&context.recordInSchool(item,actor));
  if(!application)return res.status(404).json({message:'Application not found.'});
  if(application.status==='Enrolled')return res.status(409).json({message:'This application is already enrolled.',learnerId:application.convertedLearnerId});
  if(!['Approved','Under review','Documents required','Waitlisted','Submitted'].includes(application.status))return res.status(409).json({message:'This application cannot be enrolled from its current status.'});
  const documentState=context.admissionDocumentState(application);
  if(!documentState.complete)return res.status(409).json({message:'Verify all required admission documents before enrolment.',missingRequired:documentState.missingRequired});
  const className=context.limitedText(req.body?.className||application.gradeOrAgeGroup,120),address=context.limitedText(req.body?.address||context.decryptStoredField(application.homeArea),500);
  const emergencyContact=context.limitedText(req.body?.emergencyContact,500),medicalNotes=context.limitedText(req.body?.medicalNotes,2000),consent=context.limitedText(req.body?.consent||'Pending verification',120);
  if(!className||!address)return res.status(400).json({message:'Enter the learner class/grade and home address before enrolment.'});
  const guardianName=application.guardianName,guardianPhone=context.decryptStoredField(application.contactPhone),guardianEmail=context.decryptStoredField(application.contactEmail),dateOfBirth=context.decryptStoredField(application.dateOfBirth);
  const applicantParent=(context.db.users||[]).find(account=>account.role==='parent'&&context.normalizeUsername(account.username)===context.normalizeUsername(application.createdBy));
  if(applicantParent&&context.accountSchoolId(applicantParent)&&context.accountSchoolId(applicantParent)!==application.schoolId)return res.status(409).json({message:'The parent account belongs to another school. Resolve its school assignment before enrolling this application.'});
  const admissionActor={...actor,schoolId:application.schoolId,schoolName:application.schoolName};
  const schoolLearners=(context.db.students||[]).filter(student=>student.schoolId===application.schoolId);
  const schoolRegistry=(context.db.registry||[]).filter(row=>row.schoolId===application.schoolId);
  if(schoolLearners.some(student=>context.normalizeComparableText(student.studentName)===context.normalizeComparableText(application.learnerName))||schoolRegistry.some(row=>context.normalizeComparableText(row.learnerName)===context.normalizeComparableText(application.learnerName)))return res.status(409).json({message:'A learner with this name already exists. Resolve the learner identity before enrolling; no existing learner has been linked or changed.'});
  if(applicantParent&&context.normaliseLearnerLinks(applicantParent.linkedLearners).length>=4)return res.status(409).json({message:'This parent account is already linked to four learners. Resolve the account links before enrolment.'});
  let learner=schoolLearners.find(student=>context.normalizeComparableText(student.studentName)===context.normalizeComparableText(application.learnerName)&&context.normalizeComparableText(student.className)===context.normalizeComparableText(className));
  if(!learner){
    const learnerLimit=context.schoolLearnerLimitState(admissionActor);if(!learnerLimit.allowed)return res.status(409).json({message:`The ${learnerLimit.planCode||'current'} school package has reached its learner limit.`});
    learner=context.tagSchoolRecord(admissionActor,{id:context.crypto.randomUUID(),studentName:application.learnerName,className,parentName:guardianName,contactEmail:guardianEmail||'',dateOfBirth:context.encryptField(dateOfBirth),medicalNotes:context.encryptField(medicalNotes||''),emergencyContact:context.encryptField(emergencyContact||''),authorisedPickups:context.encryptField(''),registeredAt:new Date().toISOString(),registeredBy:actor.username,admissionApplicationId:application.id});
    context.db.students.push(learner);context.ensureLearnerAccessCode(actor,learner);
  }
  let registry=schoolRegistry.find(row=>context.normalizeComparableText(row.learnerName)===context.normalizeComparableText(application.learnerName)&&context.normalizeComparableText(row.className)===context.normalizeComparableText(className));
  if(!registry){
    registry=context.tagSchoolRecord(admissionActor,{id:context.crypto.randomUUID(),learnerName:application.learnerName,className,dateOfBirth:context.encryptField(dateOfBirth),guardianName,guardianPhone:context.encryptField(guardianPhone),guardianEmail:context.encryptField(guardianEmail||''),address:context.encryptField(address),emergencyContact:context.encryptField(emergencyContact||''),medicalNotes:context.encryptField(medicalNotes||''),consent,createdAt:new Date().toISOString(),createdBy:actor.username,admissionApplicationId:application.id});
    context.db.registry.unshift(registry);
  }
  const parent=(context.db.users||[]).find(account=>account.role==='parent'&&context.normalizeUsername(account.username)===context.normalizeUsername(application.createdBy));
  if(parent){
    const links=new Set(Array.isArray(parent.linkedLearners)?parent.linkedLearners:[]);
    links.add(application.learnerName);parent.linkedLearners=[...links];
    parent.parentRelationshipStatus='Administrator approved';
    parent.parentRelationshipApprovedAt=new Date().toISOString();
    parent.parentRelationshipApprovedBy=actor.username;
    if(!parent.schoolId){parent.schoolId=application.schoolId;parent.schoolName=application.schoolName;}
  }
  const priorStatus=application.status;application.status='Enrolled';application.convertedLearnerId=learner.id;application.convertedRegistryId=registry.id;application.enrolledAt=new Date().toISOString();application.enrolledBy=actor.username;application.updatedAt=application.enrolledAt;
  context.db.admissionsStatusHistory.unshift({id:context.crypto.randomUUID(),applicationId:application.id,schoolId:application.schoolId,fromStatus:priorStatus,toStatus:'Enrolled',changedBy:actor.username,changedAt:application.enrolledAt,note:'Converted to learner register'});
  const ticket=(context.db.tickets||[]).find(item=>item.applicationId===application.id&&context.recordInSchool(item,actor));if(ticket){ticket.status='Completed';ticket.updatedAt=application.enrolledAt;}
  void context.notifyAdmissionParent(application,'Application enrolled',application.learnerName+' has been enrolled into '+className+' at '+application.schoolName+'.').catch(()=>{});
  res.status(201).json({success:true,application:context.admissionApiView(application),learnerKey:context.learnerRecordKey(learner),registryId:registry.id});
});
}

module.exports = { registerAdmissionsApplicationsRoutes };
