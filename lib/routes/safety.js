// Existing handlers, registered at their original middleware positions.
function registerBroadcastsRoutes(app, context) {
app.get('/api/broadcasts', (req, res) => {
  const requester = context.getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to view safety alerts.' });
  const latitude = Number(req.query.lat);
  const longitude = Number(req.query.lng);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);
  const canSeeAll = (context.hasPlatformAccess(requester) || ['admin', 'principal'].includes(requester.role));
  const visible = context.tenantRecords(context.db.broadcasts, requester).filter(item => {
    if (canSeeAll || !item.location || !Number(item.radiusKm)) return true;
    if (!hasLocation) return false;
    const latDistance = (latitude - Number(item.location.lat)) * 111.32;
    const lngDistance = (longitude - Number(item.location.lng)) * 111.32 * Math.cos(latitude * Math.PI / 180);
    return Math.hypot(latDistance, lngDistance) <= Number(item.radiusKm);
  }).map(item => {
    if (canSeeAll) return item;
    const { location, readBy, ...safeAlert } = item;
    return safeAlert;
  });
  res.json(visible);
});

app.post('/api/broadcasts', (req, res) => {
  const actor = context.requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Only an administrator or principal can dispatch an emergency broadcast.' });
  const bcMessage = String(req.body?.bcMessage || '').trim();
  const bcPriority = String(req.body?.bcPriority || 'Campus Notice').trim().slice(0, 80);
  const latitude = Number(req.body?.location?.lat);
  const longitude = Number(req.body?.location?.lng);
  const radiusKm = Number(req.body?.radiusKm);
  if (!bcMessage || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ message: 'A message and valid alert location are required.' });
  }
  if (bcMessage.length > 2000) return res.status(413).json({ message: 'Emergency alerts are limited to 2,000 characters.' });
  if (!Number.isFinite(radiusKm) || radiusKm < 0.1 || radiusKm > 100) return res.status(400).json({ message: 'Alert radius must be between 0.1 km and 100 km.' });
  const item = context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(),
    bcMessage,
    bcPriority,
    radiusKm,
    location: { lat: latitude, lng: longitude },
    issuedBy: actor.username,
    issuedAt: new Date().toISOString(),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    readBy: []
  });
  context.db.broadcasts.unshift(item);
  res.json({ success: true, item });
});

app.post('/api/broadcasts/:id/read', (req, res) => {
  const requester = context.getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to acknowledge an alert.' });
  const item = context.db.broadcasts.find(entry => entry.id === req.params.id && context.recordInSchool(entry, requester));
  if (!item) return res.status(404).json({ message: 'Alert not found.' });
  if (!item.readBy.includes(requester.username)) item.readBy.push(requester.username);
  res.json({ success: true, readCount: item.readBy.length });
});

app.delete('/api/broadcasts/:id', (req, res) => {
  const actor = context.requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Only authorised safety staff can remove a broadcast.' });
  const broadcast = context.db.broadcasts.find(item => item.id === req.params.id && context.recordInSchool(item, actor));
  if (!broadcast) return res.status(404).json({ message: 'Broadcast not found.' });
  context.db.broadcasts = context.db.broadcasts.filter(item => item !== broadcast);
  res.json({ success: true });
});

app.get('/api/safety-network', (req, res) => {
  const actor = context.requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Safety Network is available to authorised school safety staff.' });
  const presentLearners = context.tenantRecords(context.db.attendance, actor).filter(entry => /present|checked.?in/i.test(String(entry.status || ''))).length;
  const visitorsOnCampus = context.tenantRecords(context.db.campusVisitors, actor).filter(visitor => visitor.status === 'checked-in');
  const activeBroadcasts = context.tenantRecords(context.db.broadcasts, actor).filter(broadcast => !broadcast.closedAt);
  res.json({
    presentLearners,
    visitorsOnCampus: visitorsOnCampus.length,
    activeBroadcasts: activeBroadcasts.length,
    acknowledgements: activeBroadcasts.reduce((total, broadcast) => total + (broadcast.readBy?.length || 0), 0),
    visitors: visitorsOnCampus.map(({ passCodeHash, ...visitor }) => visitor)
  });
});

app.get('/api/campus-visitors', (req, res) => {
  const actor = context.requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Only authorised safety staff can view campus visitors.' });
  res.json(context.tenantRecords(context.db.campusVisitors, actor).map(({ passCodeHash, ...visitor }) => visitor));
});

app.get('/api/visitor-meetings/recipients', (req, res) => {
  const parent = context.getSessionAccount(req);
  if (!parent || parent.role !== 'parent') return res.status(403).json({ message: 'Only a signed-in parent can request a meeting.' });
  res.json(context.db.users.filter(account => ['teacher', 'principal'].includes(account.role) && context.isSameSchool(parent, account) && !String(account.verificationStatus || '').includes('pending')).map(context.safeAccount));
});

app.get('/api/visitor-meetings', (req, res) => {
  const user = context.getSessionAccount(req);
  if (!user || !(context.hasPlatformAccess(user) || ['parent', 'teacher', 'principal', 'admin', 'staff'].includes(user.role))) return res.status(403).json({ message: 'You are not authorised to view meeting requests.' });
  const meetings = context.db.visitorMeetings.filter(meeting => {
    if (!context.recordInSchool(meeting, user)) return false;
    if (user.role === 'parent') return context.normalizeUsername(meeting.parentUsername) === context.normalizeUsername(user.username);
    if (user.role === 'teacher') return context.normalizeUsername(meeting.hostUsername) === context.normalizeUsername(user.username);
    return true;
  });
  res.json(meetings);
});

app.post('/api/visitor-meetings', (req, res) => {
  const parent = context.getSessionAccount(req);
  const host = context.findAccountByUsername(context.limitedText(req.body?.hostUsername, 160) || '');
  const proposedAt = context.limitedText(req.body?.proposedAt, 80);
  const purpose = context.limitedText(req.body?.purpose, 1200);
  if (!parent || parent.role !== 'parent' || !host || !['teacher', 'principal'].includes(host.role) || !context.isSameSchool(parent, host) || !proposedAt || !purpose) return res.status(400).json({ message: 'Choose an authorised teacher or principal, a proposed time, and a meeting purpose within the allowed limits.' });
  const meeting = context.tagSchoolRecord(parent, { id: context.crypto.randomUUID(), parentUsername: parent.username, parentName: parent.name || parent.username, hostUsername: host.username, hostName: host.name || host.username, proposedAt, agreedAt: null, purpose, status: 'awaiting-teacher-response', requestedAt: new Date().toISOString() });
  context.db.visitorMeetings.unshift(meeting);
  res.status(201).json({ success: true, meeting });
});

app.post('/api/visitor-meetings/:id/respond', (req, res) => {
  const staff = context.getSessionAccount(req);
  const meeting = context.db.visitorMeetings.find(entry => entry.id === req.params.id && context.recordInSchool(entry, staff));
  const action = String(req.body?.action || '');
  const agreedAt = String(req.body?.agreedAt || '').trim();
  if (!staff || !meeting || !['teacher', 'principal'].includes(staff.role) || context.normalizeUsername(meeting.hostUsername) !== context.normalizeUsername(staff.username) || meeting.status !== 'awaiting-teacher-response' || !['accept', 'counter'].includes(action)) return res.status(403).json({ message: 'This meeting cannot be updated by this account.' });
  meeting.agreedAt = action === 'accept' ? meeting.proposedAt : agreedAt;
  if (!meeting.agreedAt) return res.status(400).json({ message: 'Provide an alternative meeting time.' });
  meeting.status = 'awaiting-parent-confirmation';
  meeting.respondedAt = new Date().toISOString();
  res.json({ success: true, meeting });
});

app.post('/api/visitor-meetings/:id/confirm', (req, res) => {
  const parent = context.getSessionAccount(req);
  const meeting = context.db.visitorMeetings.find(entry => entry.id === req.params.id && context.recordInSchool(entry, parent));
  if (!parent || !meeting || parent.role !== 'parent' || context.normalizeUsername(meeting.parentUsername) !== context.normalizeUsername(parent.username) || meeting.status !== 'awaiting-parent-confirmation') return res.status(403).json({ message: 'This meeting cannot be confirmed by this account.' });
  meeting.status = 'awaiting-principal-approval';
  meeting.parentConfirmedAt = new Date().toISOString();
  res.json({ success: true, meeting });
});

app.post('/api/visitor-meetings/:id/approve-visitor', (req, res) => {
  const principal = context.getSessionAccount(req);
  const meeting = context.db.visitorMeetings.find(entry => entry.id === req.params.id && context.recordInSchool(entry, principal));
  if (!principal || !meeting || !(context.hasPlatformAccess(principal) || ['principal', 'admin', 'staff'].includes(principal.role)) || !context.isSameSchool(principal, meeting) || meeting.status !== 'awaiting-principal-approval') return res.status(403).json({ message: 'Only the principal or administrator can issue visitor authorisation after both parties agree.' });
  const passCode = `LFV-${context.crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const visitor = context.tagSchoolRecord(principal, { id: context.crypto.randomUUID(), meetingId: meeting.id, visitorName: meeting.parentName, purpose: meeting.purpose, host: meeting.hostName, expectedDate: meeting.agreedAt, status: 'approved', approvedBy: principal.username, approvedAt: new Date().toISOString(), passCodeHash: context.hashPin(passCode) });
  context.db.campusVisitors.unshift(visitor);
  meeting.status = 'visitor-authorised';
  meeting.visitorId = visitor.id;
  meeting.principalApprovedAt = new Date().toISOString();
  res.json({ success: true, visitor: { ...visitor, passCodeHash: undefined }, passCode });
});

app.post('/api/campus-visitors/check-in', (req, res) => {
  const actor = context.requireSafetyStaff(req);
  const passCode = String(req.body?.passCode || '').trim().toUpperCase();
  if (!actor || !passCode) return res.status(403).json({ message: 'An authorised staff member and visitor pass are required.' });
  if (!/^LFV-[A-F0-9]{8}$/.test(passCode)) return res.status(404).json({ message: 'Visitor pass not found, already used, or not approved.' });
  const visitor = context.db.campusVisitors.find(entry => entry.status === 'approved' && context.recordInSchool(entry, actor) && context.matchesPin(passCode, entry.passCodeHash));
  if (!visitor) return res.status(404).json({ message: 'Visitor pass not found, already used, or not approved.' });
  visitor.status = 'checked-in';
  visitor.checkedInAt = new Date().toISOString();
  visitor.checkedInBy = actor.username;
  res.json({ success: true, visitor: { ...visitor, passCodeHash: undefined } });
});

app.post('/api/campus-visitors/:id/check-out', (req, res) => {
  const actor = context.requireSafetyStaff(req);
  if (!actor) return res.status(403).json({ message: 'Only authorised safety staff can check out a visitor.' });
  const visitor = context.db.campusVisitors.find(entry => entry.id === req.params.id && entry.status === 'checked-in' && context.recordInSchool(entry, actor));
  if (!visitor) return res.status(404).json({ message: 'Checked-in visitor not found.' });
  visitor.status = 'checked-out';
  visitor.checkedOutAt = new Date().toISOString();
  visitor.checkedOutBy = actor.username;
  res.json({ success: true });
});
}

function registerConsentsRoutes(app, context) {
app.get('/api/consents', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher','principal','admin','staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can view consent records.' });
  res.json(context.learnerRecordsVisibleTo(context.db.consentRecords, actor));
});

app.post('/api/consents', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can save consent records.' });
  const learnerName = context.limitedText(req.body?.learnerName, 160);
  const guardianName = context.limitedText(req.body?.guardianName, 160);
  const { internalUpdates, marketingPhotos } = req.body;
  if (!learnerName || !guardianName) return res.status(400).json({ message: 'Learner and guardian details are required and must be within 160 characters.' });
  if ((internalUpdates !== undefined && typeof internalUpdates !== 'boolean') || (marketingPhotos !== undefined && typeof marketingPhotos !== 'boolean')) {
    return res.status(400).json({ message: 'Consent choices must be true or false.' });
  }
  const matches = context.db.students.filter(student => student.schoolId === context.accountSchoolId(actor) && context.normalizeComparableText(student.studentName) === context.normalizeComparableText(learnerName));
  if (actor.role === 'teacher' && (matches.length !== 1 || !context.learnerRecordsVisibleTo(matches, actor).length)) return res.status(403).json({ message: 'Choose a uniquely identified learner in your assigned classes.' });
  const learner = matches.length === 1 ? matches[0] : null;
  const record = context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), learnerName, learnerId: learner?.id || '', className: learner?.className || '', guardianName, internalUpdates: Boolean(internalUpdates), marketingPhotos: Boolean(marketingPhotos), capturedAt: new Date().toISOString(), version: 'POPIA-consent-2026-09-v2' });
  context.db.consentRecords = context.db.consentRecords.filter(entry => entry.schoolId !== record.schoolId || context.normalizeComparableText(entry.learnerName) !== context.normalizeComparableText(record.learnerName));
  context.db.consentRecords.unshift(record);
  res.status(201).json({ success: true, record });
});

app.post('/api/pickups/verify', (req, res) => {
  const actor = context.getSessionAccount(req);
  const learnerName = context.limitedText(req.body?.learnerName, 160);
  const pickupAdult = context.limitedText(req.body?.pickupAdult, 160);
  const verificationCode = req.body?.verificationCode;
  const action = context.limitedText(req.body?.action, 40);
  const allowedActions = new Set(['Check-in', 'Pickup / release']);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can record pickups.' });
  if (!learnerName || !pickupAdult || !context.validSecretLength(verificationCode) || !allowedActions.has(action)) return res.status(400).json({ message: 'Learner, pickup adult, a valid verification code, and a supported action are required.' });
  const matches = context.db.students.filter(student => student.schoolId === context.accountSchoolId(actor) && context.normalizeComparableText(student.studentName) === context.normalizeComparableText(learnerName));
  if (actor.role === 'teacher' && (matches.length !== 1 || !context.learnerRecordsVisibleTo(matches, actor).length)) return res.status(403).json({ message: 'Choose a uniquely identified learner in your assigned classes.' });
  const learner = matches.length === 1 ? matches[0] : null;
  const entry = context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), learnerName, learnerId: learner?.id || '', className: learner?.className || '', pickupAdult, verificationCode: context.hashPin(verificationCode), action, recordedBy: actor.username, timestamp: new Date().toISOString() });
  context.db.pickupLogs.unshift(entry);
  res.status(201).json({ success: true, entry: { ...entry, verificationCode: undefined } });
});

app.get('/api/pickups', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher','principal','admin','staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can view pickup records.' });
  res.json(context.learnerRecordsVisibleTo(context.db.pickupLogs, actor).map(({ verificationCode, ...entry }) => entry));
});
}

module.exports = { registerBroadcastsRoutes, registerConsentsRoutes };
