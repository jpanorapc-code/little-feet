// Existing handlers, registered at their original middleware positions.
function registerPurchaseRequestsRoutes(app, context) {
app.get('/api/purchase-requests', (req,res) => {
  const actor=context.requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=context.tenantRecords(context.db.purchaseRequests,actor);
  res.json((context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))?rows:rows.filter(x=>context.normalizeUsername(x.requestedBy)===context.normalizeUsername(actor.username)));
});

app.post('/api/purchase-requests', (req,res) => {
  const actor=context.requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const itemName=context.boundedText(req.body?.itemName,180),reason=context.boundedText(req.body?.reason,2000),quantity=Math.max(1,Math.min(9999,Number(req.body?.quantity)||1)),estimatedUnitCost=Number(req.body?.estimatedUnitCost||0);
  if(!itemName||!reason||!Number.isFinite(estimatedUnitCost)||estimatedUnitCost<0)return res.status(400).json({message:'Add an item, reason, quantity and valid estimated cost.'});
  const item=context.tagSchoolRecord(actor,{id:context.crypto.randomUUID(),itemName,reason,quantity,estimatedUnitCost:Number(estimatedUnitCost.toFixed(2)),estimatedTotal:Number((quantity*estimatedUnitCost).toFixed(2)),supplier:context.boundedText(req.body?.supplier,180),category:context.boundedText(req.body?.category||'General',80),requestedBy:actor.username,requestedByName:actor.name||actor.username,status:'Pending',financeStatus:'Awaiting approval',createdAt:new Date().toISOString()});
  context.db.purchaseRequests.unshift(item);res.status(201).json({success:true,item});
});

app.patch('/api/purchase-requests/:id/finance', (req,res) => {
  const actor=context.requireSchoolStaff(req);if(!actor||!(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)))return res.status(403).json({message:'Management access is required for purchase fulfilment.'});
  const item=context.db.purchaseRequests.find(x=>x.id===req.params.id&&context.recordInSchool(x,actor));if(!item)return res.status(404).json({message:'Purchase request not found.'});
  if(item.status!=='Approved')return res.status(409).json({message:'The purchase request must be approved first.'});
  const status=context.boundedText(req.body?.financeStatus,40);if(!['Approved for purchase','Ordered','Received'].includes(status))return res.status(400).json({message:'Choose a valid finance fulfilment status.'});
  item.financeStatus=status;item.financeUpdatedBy=actor.username;item.financeUpdatedAt=new Date().toISOString();res.json({success:true,item});
});

app.get('/api/resources/bookings', (req,res) => {
  const actor=context.requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  res.json(context.tenantRecords(context.db.resourceBookings,actor).filter(x=>x.status!=='Cancelled'));
});

app.post('/api/resources/bookings', (req,res) => {
  const actor=context.requireSchoolStaff(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const resource=context.boundedText(req.body?.resource,160),date=context.boundedText(req.body?.date,30),startTime=context.boundedText(req.body?.startTime,10),endTime=context.boundedText(req.body?.endTime,10),purpose=context.boundedText(req.body?.purpose,500);
  if(!resource||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)||endTime<=startTime)return res.status(400).json({message:'Choose a resource, valid date and a start time before the end time.'});
  const conflict=context.tenantRecords(context.db.resourceBookings,actor).find(x=>x.status!=='Cancelled'&&context.normalizeComparableText(x.resource)===context.normalizeComparableText(resource)&&x.date===date&&startTime<x.endTime&&endTime>x.startTime);
  if(conflict)return res.status(409).json({message:`${resource} is already booked from ${conflict.startTime} to ${conflict.endTime}.`,conflict:{id:conflict.id,startTime:conflict.startTime,endTime:conflict.endTime,bookedByName:conflict.bookedByName}});
  const item=context.tagSchoolRecord(actor,{id:context.crypto.randomUUID(),resource,date,startTime,endTime,purpose,resourceType:context.boundedText(req.body?.resourceType||'Other',60),bookedBy:actor.username,bookedByName:actor.name||actor.username,status:'Booked',createdAt:new Date().toISOString()});
  context.db.resourceBookings.unshift(item);res.status(201).json({success:true,item});
});

app.patch('/api/resources/bookings/:id', (req,res) => {
  const actor=context.requireSchoolStaff(req);const item=actor&&context.db.resourceBookings.find(x=>x.id===req.params.id&&context.recordInSchool(x,actor));if(!item)return res.status(404).json({message:'Booking not found.'});
  if(!(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))&&context.normalizeUsername(item.bookedBy)!==context.normalizeUsername(actor.username))return res.status(403).json({message:'You can only cancel your own booking.'});
  if(req.body?.status!=='Cancelled')return res.status(400).json({message:'Bookings can only be cancelled here.'});item.status='Cancelled';item.cancelledBy=actor.username;item.cancelledAt=new Date().toISOString();res.json({success:true,item});
});
}

function registerMaintenanceRoutes(app, context) {
app.get('/api/maintenance', (req,res) => {
  const actor=context.requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const rows=context.tenantRecords(context.db.maintenanceOrders,actor);
  res.json((context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role))?rows:rows.filter(x=>context.normalizeUsername(x.reportedBy)===context.normalizeUsername(actor.username)||context.normalizeUsername(x.assignedTo)===context.normalizeUsername(actor.username)));
});

app.post('/api/maintenance', (req,res) => {
  const actor=context.requireSchoolStaff(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
  const title=context.boundedText(req.body?.title,180),location=context.boundedText(req.body?.location,180);
  if(!title||!location)return res.status(400).json({message:'Add an issue and location.'});
  const item=context.tagSchoolRecord(actor,{id:context.crypto.randomUUID(),title,details:context.boundedText(req.body?.details,3000),location,category:context.boundedText(req.body?.category||'General',80),priority:context.boundedText(req.body?.priority||'Normal',30),status:'Open',reportedBy:actor.username,reportedByName:actor.name||actor.username,assignedTo:'',assignedToName:'',createdAt:new Date().toISOString()});
  context.db.maintenanceOrders.unshift(item);res.status(201).json({success:true,item});
});

app.patch('/api/maintenance/:id', (req,res) => {
  const actor=context.requireSchoolStaff(req);const item=actor&&context.db.maintenanceOrders.find(x=>x.id===req.params.id&&context.recordInSchool(x,actor));if(!item)return res.status(404).json({message:'Work order not found.'});
  const manager=(context.hasPlatformAccess(actor) || ['admin','principal','school_hr'].includes(actor.role)),assigned=context.normalizeUsername(item.assignedTo)===context.normalizeUsername(actor.username);
  if(!manager&&!assigned)return res.status(403).json({message:'Only management or the assigned staff member can update this work order.'});
  if(req.body?.assignedTo!==undefined){if(!manager)return res.status(403).json({message:'Only management can assign work orders.'});const account=req.body.assignedTo?context.staffAccountInSchool(actor,req.body.assignedTo):null;if(req.body.assignedTo&&!account)return res.status(400).json({message:'Choose staff from this school.'});item.assignedTo=account?.username||'';item.assignedToName=account?.name||account?.username||'';}
  if(req.body?.status!==undefined){const status=context.boundedText(req.body.status,30);if(!context.MAINTENANCE_STATUSES.has(status))return res.status(400).json({message:'Choose a valid work-order status.'});item.status=status;if(status==='Completed'){item.completedAt=new Date().toISOString();item.completionNotes=context.boundedText(req.body?.completionNotes,2000);}}
  item.updatedAt=new Date().toISOString();res.json({success:true,item});
});
}

function registerApprovalsRoutes(app, context) {
app.get('/api/approvals', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'School management access is required.' });
  const leave = context.tenantRecords(context.db.staffLeave, actor).filter(item => item.status === 'Pending').map(item => ({
    id: item.id, type: 'Leave', title: `${item.staffName} · ${item.leaveType}`, detail: `${item.startDate} to ${item.endDate}`, createdAt: item.createdAt, actions: ['Approve', 'Reject']
  }));
  const meetings = context.tenantRecords(context.db.tickets, actor).filter(item => item.ticketType === 'Meeting request' && item.status !== 'Completed').map(item => ({
    id: item.id, type: 'Meeting', title: item.subject, detail: [item.createdByName || item.createdBy, item.meetingDate, item.meetingTime, item.meetingLocation].filter(Boolean).join(' · '), createdAt: item.createdAt, actions: ['Approve', 'Reject']
  }));
  const purchases = context.tenantRecords(context.db.purchaseRequests, actor).filter(item => item.status === 'Pending').map(item => ({ id:item.id, type:'Purchase', title:`${item.itemName} × ${item.quantity}`, detail:`${item.requestedByName} · Estimated R${item.estimatedTotal.toFixed(2)} · ${item.reason}`, createdAt:item.createdAt, actions:['Approve','Reject'] }));
  res.json([...leave, ...meetings, ...purchases].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))));
});

app.post('/api/approvals/:type/:id', (req, res) => {
  const actor = context.requireSchoolStaff(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['admin', 'principal'].includes(actor.role))) return res.status(403).json({ message: 'School management access is required.' });
  const decision = context.boundedText(req.body?.decision, 20);
  if (!['Approve', 'Reject'].includes(decision)) return res.status(400).json({ message: 'Choose Approve or Reject.' });
  if (req.params.type === 'Leave') {
    const item = context.db.staffLeave.find(record => record.id === req.params.id && context.recordInSchool(record, actor));
    if (!item || item.status !== 'Pending') return res.status(404).json({ message: 'Pending leave request not found.' });
    item.status = decision === 'Approve' ? 'Approved' : 'Rejected'; item.reviewedBy = actor.username; item.reviewedAt = new Date().toISOString();
    return res.json({ success: true, item });
  }
  if (req.params.type === 'Purchase') {
    const item=context.db.purchaseRequests.find(record=>record.id===req.params.id&&context.recordInSchool(record,actor));
    if(!item||item.status!=='Pending')return res.status(404).json({message:'Pending purchase request not found.'});
    item.status=decision==='Approve'?'Approved':'Rejected';item.financeStatus=decision==='Approve'?'Approved for purchase':'Rejected';item.reviewedBy=actor.username;item.reviewedAt=new Date().toISOString();
    return res.json({success:true,item});
  }
  if (req.params.type === 'Meeting') {
    const item = context.db.tickets.find(record => record.id === req.params.id && context.recordInSchool(record, actor) && record.ticketType === 'Meeting request' && record.status !== 'Completed');
    if (!item) return res.status(404).json({ message: 'Meeting request not found.' });
    item.meetingDecision = decision === 'Approve' ? 'Approved' : 'Rejected'; item.meetingDecisionBy = actor.username; item.meetingDecisionAt = new Date().toISOString(); item.status = 'Completed';
    return res.json({ success: true, item });
  }
  res.status(400).json({ message: 'Unsupported approval type.' });
});
}

module.exports = { registerPurchaseRequestsRoutes, registerMaintenanceRoutes, registerApprovalsRoutes };
