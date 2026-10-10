// Existing handlers, registered at their original middleware positions.
function registerStaffQualificationsRoutes(app, context) {
app.get('/api/staff/qualifications', (req,res) => {
  const actor=context.requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=context.tenantRecords(context.db.staffQualifications,actor).map(item=>({...item,status:context.qualificationStatus(item)}));
  res.json((context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))?rows:rows.filter(x=>context.normalizeUsername(x.username)===context.normalizeUsername(actor.username)));
});

app.post('/api/staff/qualifications', (req,res) => {
  const actor=context.requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const target=context.staffAccountInSchool(actor,req.body?.username||actor.username);
  if(!target)return res.status(400).json({message:'Choose a staff member from this school.'});
  if(!(context.hasPlatformAccess(actor)||['admin','principal','school_hr'].includes(actor.role))&&context.normalizeUsername(target.username)!==context.normalizeUsername(actor.username))return res.status(403).json({message:'Staff can add qualifications only to their own record.'});
  const name=context.boundedText(req.body?.name,180),issuingBody=context.boundedText(req.body?.issuingBody,180),obtainedDate=context.boundedText(req.body?.obtainedDate,10),expiryDate=context.boundedText(req.body?.expiryDate,10);
  if(!name||!issuingBody||!context.validIsoDate(obtainedDate)||(expiryDate&&(!context.validIsoDate(expiryDate)||expiryDate<obtainedDate)))return res.status(400).json({message:'Add a qualification, issuing body and valid dates. Expiry cannot be before the obtained date.'});
  const item=context.tagEmploymentRecord(actor,target,{id:context.crypto.randomUUID(),username:target.username,staffName:target.name||target.username,name,issuingBody,obtainedDate,expiryDate,reference:context.boundedText(req.body?.reference,300),createdBy:actor.username,createdAt:new Date().toISOString()});
  context.db.staffQualifications.unshift(item);res.status(201).json({success:true,item:{...item,status:context.qualificationStatus(item)}});
});

app.patch('/api/staff/qualifications/:id', (req,res) => {
  const actor=context.requireSchoolStaff(req); const item=actor&&context.db.staffQualifications.find(x=>x.id===req.params.id&&context.recordInSchool(x,actor));
  if(!item)return res.status(404).json({message:'Qualification not found.'});
  const own=context.normalizeUsername(item.username)===context.normalizeUsername(actor.username),manager=(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role));
  if(!own&&!manager)return res.status(403).json({message:'You cannot update this qualification.'});
  const expiry=context.boundedText(req.body?.expiryDate??item.expiryDate,10),reference=context.boundedText(req.body?.reference??item.reference,300);
  if(expiry&&(!context.validIsoDate(expiry)||expiry<item.obtainedDate))return res.status(400).json({message:'Choose a valid expiry date after the obtained date.'});
  item.expiryDate=expiry;item.reference=reference;item.updatedAt=new Date().toISOString();res.json({success:true,item:{...item,status:context.qualificationStatus(item)}});
});

app.get('/api/staff/kpi-history', (req,res) => {
  const actor=context.requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const requested=context.boundedText(req.query.username||actor.username,160),target=context.staffAccountInSchool(actor,requested);
  if(!target)return res.status(404).json({message:'Staff member not found.'});
  if(!(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))&&context.normalizeUsername(target.username)!==context.normalizeUsername(actor.username))return res.status(403).json({message:'You can view only your own KPI history.'});
  const count=Math.max(1,Math.min(24,Number(req.query.months)||12)),rows=[];const now=new Date();
  for(let i=count-1;i>=0;i--){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-i,1));rows.push(context.monthlyTaskKpi(actor,target.username,d.toISOString().slice(0,7)));}
  res.json({username:target.username,staffName:target.name||target.username,rows});
});

app.get('/api/staff/development-plans', (req,res) => {
  const actor=context.requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=context.tenantRecords(context.db.staffDevelopmentPlans,actor);res.json((context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))?rows:rows.filter(x=>context.normalizeUsername(x.username)===context.normalizeUsername(actor.username)));
});

app.post('/api/staff/development-plans', (req,res) => {
  const actor=context.requireSchoolStaff(req);if(!actor||!(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)))return res.status(403).json({message:'Management access is required.'});
  const target=context.staffAccountInSchool(actor,req.body?.username),goal=context.boundedText(req.body?.goal,1000);
  if(!target||!goal)return res.status(400).json({message:'Choose a staff member and add a development goal.'});
  const targetDate=context.boundedText(req.body?.targetDate,10);if(targetDate&&!context.validIsoDate(targetDate))return res.status(400).json({message:'Choose a valid target date.'});
  const item=context.tagSchoolRecord(actor,{id:context.crypto.randomUUID(),username:target.username,staffName:target.name||target.username,goal,actions:context.boundedText(req.body?.actions,2000),targetDate,status:'Active',reviewId:context.boundedText(req.body?.reviewId,100),createdBy:actor.username,createdAt:new Date().toISOString()});
  context.db.staffDevelopmentPlans.unshift(item);res.status(201).json({success:true,item});
});

app.patch('/api/staff/development-plans/:id', (req,res) => {
  const actor=context.requireSchoolStaff(req),item=actor&&context.db.staffDevelopmentPlans.find(x=>x.id===req.params.id&&context.recordInSchool(x,actor));
  if(!item)return res.status(404).json({message:'Development plan not found.'});
  const own=context.normalizeUsername(item.username)===context.normalizeUsername(actor.username),manager=(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role));if(!own&&!manager)return res.status(403).json({message:'You cannot update this plan.'});
  const status=context.boundedText(req.body?.status||item.status,30);if(!['Active','Completed','Paused'].includes(status))return res.status(400).json({message:'Choose a valid plan status.'});
  item.status=status;item.staffComment=context.boundedText(req.body?.staffComment??item.staffComment,1500);item.updatedAt=new Date().toISOString();res.json({success:true,item});
});
}

function registerStaffKpiMonthlyRoutes(app, context) {
app.get('/api/staff/kpi-monthly', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const month = context.monthKey(req.query.month);
  const schoolStaff = context.db.users.filter(account => context.staffAccountInSchool(actor, account.username));
  const visible = (context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) ? schoolStaff : schoolStaff.filter(account => context.normalizeUsername(account.username) === context.normalizeUsername(actor.username));
  const rows = visible.map(account => ({ username: account.username, staffName: account.name || account.username, ...context.monthlyTaskKpi(actor, account.username, month) }));
  const ranked = rows.slice().sort((a,b) => b.completionRate - a.completionRate || b.completed - a.completed || a.staffName.localeCompare(b.staffName)).map((row,index)=>({ ...row, rank:index+1 }));
  res.json({ month, rows: ranked });
});
}

function registerStaffMeetingsRoutes(app, context) {
app.get('/api/staff/meetings', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const tickets = context.tenantRecords(context.db.tickets, actor).filter(item => item.ticketType === 'Meeting request' && item.meetingDecision === 'Approved');
  const minutes = context.tenantRecords(context.db.meetingMinutes, actor);
  res.json(tickets.map(ticket => ({ ...ticket, minutes: minutes.find(item => item.ticketId === ticket.id) || null })));
});

app.post('/api/staff/meetings/:id/minutes', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can record meeting minutes.' });
  const ticket = context.db.tickets.find(item => item.id === req.params.id && context.recordInSchool(item, actor) && item.ticketType === 'Meeting request' && item.meetingDecision === 'Approved');
  if (!ticket) return res.status(404).json({ message: 'Approved meeting request not found.' });
  if (context.db.meetingMinutes.some(item => item.ticketId === ticket.id && context.recordInSchool(item, actor))) return res.status(409).json({ message: 'Minutes have already been recorded for this meeting.' });
  const summary = context.boundedText(req.body?.summary, 5000);
  if (!summary) return res.status(400).json({ message: 'Add meeting minutes before saving.' });
  const actions = Array.isArray(req.body?.actions) ? req.body.actions.slice(0, 30) : [];
  const createdTasks = [];
  for (const action of actions) {
    const title = context.boundedText(action?.title, 180);
    if (!title) continue;
    const assignee = context.staffAccountInSchool(actor, action?.assignedTo);
    if (!assignee) return res.status(400).json({ message: 'Every action item must be assigned to staff from this school.' });
    const dueDate = context.boundedText(action?.dueDate, 30);
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ message: 'Choose a valid action-item due date.' });
    createdTasks.push(context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), title, details: `Meeting action · ${ticket.subject}`, priority: context.boundedText(action?.priority || 'Normal', 30), dueDate, status:'Open', assignedTo:assignee.username, assignedToName:assignee.name || assignee.username, createdBy:actor.username, sourceType:'Meeting', sourceId:ticket.id, createdAt:new Date().toISOString() }));
  }
  const item = context.tagSchoolRecord(actor, { id:context.crypto.randomUUID(), ticketId:ticket.id, subject:ticket.subject, summary, attendees:context.boundedText(req.body?.attendees, 2000), decisions:context.boundedText(req.body?.decisions, 4000), actionTaskIds:createdTasks.map(task=>task.id), recordedBy:actor.username, recordedByName:actor.name || actor.username, createdAt:new Date().toISOString() });
  context.db.staffTasks.unshift(...createdTasks); context.db.meetingMinutes.unshift(item); ticket.minutesRecordedAt=item.createdAt; ticket.minutesId=item.id;
  res.status(201).json({ success:true, item, createdTasks });
});

app.get('/api/staff/notices', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const staff = context.tenantRecords(context.db.users, actor).filter(account => (context.hasPlatformAccess(account) || ['teacher', 'principal', 'admin', 'staff'].includes(account.role)) && !String(account.verificationStatus || '').toLowerCase().includes('pending'));
  const management = context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role);
  const rows = context.tenantRecords(context.db.staffNotices, actor)
    .filter(notice => management || notice.audience === 'All staff' || notice.audience === actor.role)
    .map(notice => {
    const acknowledgedBy = Array.isArray(notice.acknowledgedBy) ? notice.acknowledgedBy : [];
    const acknowledged = acknowledgedBy.some(entry => context.normalizeUsername(entry.username) === context.normalizeUsername(actor.username));
    const eligible = staff.filter(account => notice.audience === 'All staff' || account.role === notice.audience);
    return { ...notice, acknowledged, acknowledgedCount: eligible.filter(account => acknowledgedBy.some(entry => context.normalizeUsername(entry.username) === context.normalizeUsername(account.username))).length, audienceCount: eligible.length,
      outstanding: (context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)) ? eligible.filter(account => !acknowledgedBy.some(entry => context.normalizeUsername(entry.username) === context.normalizeUsername(account.username))).map(account => ({ username: account.username, name: account.name || account.username })) : undefined };
  });
  res.json(rows);
});

app.post('/api/staff/notices', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can publish staff notices.' });
  const title = context.boundedText(req.body?.title, 180), message = context.boundedText(req.body?.message, 5000);
  if (!title || !message) return res.status(400).json({ message: 'Add a notice title and message.' });
  const audience = ['All staff','teacher','principal','admin'].includes(req.body?.audience) ? req.body.audience : 'All staff';
  const dueDate = context.boundedText(req.body?.dueDate, 30);
  if (dueDate && !context.validDateKey(dueDate)) return res.status(400).json({ message: 'Choose a valid acknowledgement due date.' });
  const item = context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), title, message, audience, required: req.body?.required !== false, dueDate, createdBy: actor.username, createdByName: actor.name || actor.username, acknowledgedBy: [], createdAt: new Date().toISOString() });
  context.db.staffNotices.unshift(item); res.status(201).json({ success:true, item });
});

app.post('/api/staff/notices/:id/acknowledge', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  const item = actor && context.db.staffNotices.find(record => record.id === req.params.id && context.recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Staff notice not found.' });
  if (item.audience !== 'All staff' && item.audience !== actor.role) return res.status(403).json({ message: 'This notice is not addressed to your role.' });
  item.acknowledgedBy = Array.isArray(item.acknowledgedBy) ? item.acknowledgedBy : [];
  if (!item.acknowledgedBy.some(entry => context.normalizeUsername(entry.username) === context.normalizeUsername(actor.username))) item.acknowledgedBy.push({ username: actor.username, name: actor.name || actor.username, acknowledgedAt: new Date().toISOString() });
  res.json({ success:true, item });
});
}

function registerStaffPerformanceReviewsRoutes(app, context) {
app.get('/api/staff/performance-reviews', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = context.tenantRecords(context.db.performanceReviews, actor);
  if ((context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role))) return res.json(records);
  res.json(records.filter(item => context.normalizeUsername(item.username) === context.normalizeUsername(actor.username)));
});

app.post('/api/staff/performance-reviews', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can create performance reviews.' });
  const employee = context.staffAccountInSchool(actor, req.body?.username);
  if (!employee) return res.status(400).json({ message: 'Choose a staff member from this school.' });
  const criteriaInput = Array.isArray(req.body?.criteria) ? req.body.criteria : [];
  const criteria = criteriaInput.slice(0, 20).map(entry => ({
    name: context.boundedText(entry?.name, 120),
    rating: Number(entry?.rating),
    comment: context.boundedText(entry?.comment, 1000)
  })).filter(entry => entry.name && context.KPI_RATINGS.has(entry.rating));
  if (!criteria.length) return res.status(400).json({ message: 'Add at least one KPI with a rating from 1 to 5.' });
  const averageRating = Number((criteria.reduce((sum, entry) => sum + entry.rating, 0) / criteria.length).toFixed(2));
  const item = context.tagEmploymentRecord(actor, employee, {
    id: context.crypto.randomUUID(), username: employee.username, staffName: employee.name || employee.username,
    reviewPeriod: context.monthKey(req.body?.reviewPeriod), reviewDate: context.boundedText(req.body?.reviewDate, 30) || new Date().toISOString().slice(0, 10),
    criteria, averageRating, strengths: context.boundedText(req.body?.strengths, 2500), development: context.boundedText(req.body?.development, 2500),
    goals: context.boundedText(req.body?.goals, 2500), managerComment: context.boundedText(req.body?.managerComment, 2500),
    employeeComment: '', status: 'Draft', reviewedBy: actor.username, reviewedByName: actor.name || actor.username, createdAt: new Date().toISOString()
  });
  context.db.performanceReviews.unshift(item);
  res.status(201).json({ success: true, item });
});

app.patch('/api/staff/performance-reviews/:id', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  const item = actor && context.db.performanceReviews.find(record => record.id === req.params.id && context.recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Performance review not found.' });
  const isEmployee = context.normalizeUsername(item.username) === context.normalizeUsername(actor.username);
  const isManager = (context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role));
  if (!isEmployee && !isManager) return res.status(403).json({ message: 'You cannot update this performance review.' });
  if (isEmployee) {
    item.employeeComment = context.boundedText(req.body?.employeeComment, 2500);
    if (req.body?.acknowledged === true) { item.status = 'Acknowledged'; item.acknowledgedAt = new Date().toISOString(); }
  } else {
    const nextStatus = context.boundedText(req.body?.status || item.status, 30);
    if (!['Draft', 'Shared', 'Acknowledged'].includes(nextStatus)) return res.status(400).json({ message: 'Choose a valid review status.' });
    item.status = nextStatus;
    if (nextStatus === 'Shared' && !item.sharedAt) item.sharedAt = new Date().toISOString();
  }
  item.updatedAt = new Date().toISOString();
  res.json({ success: true, item });
});
}

function registerStaffDirectoryRoutes(app, context) {
app.get('/api/staff/directory', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'Staff access is required.' });
  const manager = context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role);
  const accounts = context.db.users.filter(account => context.staffAccountInSchool(actor, account.username) && (manager || context.normalizeUsername(account.username) === context.normalizeUsername(actor.username)));
  res.json(accounts.map(account => ({ username: account.username, name: account.name || account.username, role: account.role, schoolId: account.schoolId || '', schoolName: account.schoolName || '' })));
});

app.get('/api/staff/tasks', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = context.tenantRecords(context.db.staffTasks, actor);
  if ((context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role))) return res.json(records);
  res.json(records.filter(item => context.normalizeUsername(item.assignedTo) === context.normalizeUsername(actor.username) || context.normalizeUsername(item.createdBy) === context.normalizeUsername(actor.username)));
});

app.post('/api/staff/tasks', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const assignee = context.staffAccountInSchool(actor, req.body?.assignedTo || actor.username);
  const title = context.boundedText(req.body?.title, 180);
  if (!assignee || !title) return res.status(400).json({ message: 'Choose a staff member from this school and add a task title.' });
  if (!(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)) && context.normalizeUsername(assignee.username) !== context.normalizeUsername(actor.username)) return res.status(403).json({ message: 'Teachers can create tasks for themselves. Management can assign tasks to staff.' });
  const item = context.tagEmploymentRecord(actor, assignee, { id: context.crypto.randomUUID(), title, details: context.boundedText(req.body?.details, 3000), priority: context.boundedText(req.body?.priority || 'Normal', 30), dueDate: context.boundedText(req.body?.dueDate, 30), status: 'Open', assignedTo: assignee.username, assignedToName: assignee.name || assignee.username, createdBy: actor.username, createdAt: new Date().toISOString() });
  context.db.staffTasks.unshift(item);
  res.status(201).json({ success: true, item });
});

app.patch('/api/staff/tasks/:id', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  const item = actor && context.db.staffTasks.find(record => record.id === req.params.id && context.recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Task not found.' });
  const canManage = (context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) || context.normalizeUsername(item.assignedTo) === context.normalizeUsername(actor.username);
  if (!canManage) return res.status(403).json({ message: 'You cannot update this task.' });
  const status = context.boundedText(req.body?.status || item.status, 30);
  if (!context.WORK_TASK_STATUSES.has(status)) return res.status(400).json({ message: 'Choose a valid task status.' });
  item.status = status;
  item.updatedAt = new Date().toISOString();
  res.json({ success: true, item });
});

app.get('/api/staff/leave', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = context.tenantRecords(context.db.staffLeave, actor);
  res.json((context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) ? records : records.filter(item => context.normalizeUsername(item.username) === context.normalizeUsername(actor.username)));
});

app.post('/api/staff/leave', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const startDate = context.boundedText(req.body?.startDate, 30);
  const endDate = context.boundedText(req.body?.endDate || startDate, 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) return res.status(400).json({ message: 'Choose a valid leave date range.' });
  const item = context.tagEmploymentRecord(actor, actor, { id: context.crypto.randomUUID(), username: actor.username, staffName: actor.name || actor.username, leaveType: context.boundedText(req.body?.leaveType || 'Annual leave', 80), startDate, endDate, reason: context.boundedText(req.body?.reason, 1500), status: 'Pending', createdAt: new Date().toISOString() });
  context.db.staffLeave.unshift(item);
  res.status(201).json({ success: true, item });
});

app.patch('/api/staff/leave/:id', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  const item = actor && context.db.staffLeave.find(record => record.id === req.params.id && context.recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Leave request not found.' });
  const requestedStatus = context.boundedText(req.body?.status, 30);
  if (!context.LEAVE_STATUSES.has(requestedStatus)) return res.status(400).json({ message: 'Choose a valid leave status.' });
  const ownCancellation = requestedStatus === 'Cancelled' && context.normalizeUsername(item.username) === context.normalizeUsername(actor.username) && item.status === 'Pending';
  if (!(context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) && !ownCancellation) return res.status(403).json({ message: 'Management approval is required.' });
  item.status = requestedStatus;
  item.reviewedBy = actor.username;
  item.reviewedAt = new Date().toISOString();
  res.json({ success: true, item });
});

app.get('/api/staff/cover', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor) return res.status(403).json({ message: 'School staff access is required.' });
  const records = context.tenantRecords(context.db.teacherCover, actor);
  res.json((context.hasPlatformAccess(actor) || ['admin', 'principal', 'school_hr'].includes(actor.role)) ? records : records.filter(item => [item.absentTeacher, item.coverTeacher].some(username => context.normalizeUsername(username) === context.normalizeUsername(actor.username))));
});

app.post('/api/staff/cover', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'Only school management can create cover assignments.' });
  const absent = context.staffAccountInSchool(actor, req.body?.absentTeacher);
  const cover = req.body?.coverTeacher ? context.staffAccountInSchool(actor, req.body.coverTeacher) : null;
  const date = context.boundedText(req.body?.date, 30);
  if (!absent || absent.role !== 'teacher' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Choose an absent teacher and a valid cover date.' });
  if (cover && cover.role !== 'teacher') return res.status(400).json({ message: 'Cover must be assigned to a teacher.' });
  const item = context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), absentTeacher: absent.username, absentTeacherName: absent.name || absent.username, coverTeacher: cover?.username || '', coverTeacherName: cover ? (cover.name || cover.username) : '', date, period: context.boundedText(req.body?.period, 80), className: context.boundedText(req.body?.className, 120), notes: context.boundedText(req.body?.notes, 1500), status: cover ? 'Assigned' : 'Needs Cover', createdBy: actor.username, createdAt: new Date().toISOString() });
  context.db.teacherCover.unshift(item);
  res.status(201).json({ success: true, item });
});

app.patch('/api/staff/cover/:id', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  const item = actor && context.db.teacherCover.find(record => record.id === req.params.id && context.recordInSchool(record, actor));
  if (!item) return res.status(404).json({ message: 'Cover assignment not found.' });
  if (!(context.hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role)) && context.normalizeUsername(item.coverTeacher) !== context.normalizeUsername(actor.username)) return res.status(403).json({ message: 'You cannot update this cover assignment.' });
  const status = context.boundedText(req.body?.status || item.status, 30);
  if (!context.COVER_STATUSES.has(status)) return res.status(400).json({ message: 'Choose a valid cover status.' });
  item.status = status;
  item.updatedAt = new Date().toISOString();
  res.json({ success: true, item });
});
}

module.exports = { registerStaffQualificationsRoutes, registerStaffKpiMonthlyRoutes, registerStaffMeetingsRoutes, registerStaffPerformanceReviewsRoutes, registerStaffDirectoryRoutes };
