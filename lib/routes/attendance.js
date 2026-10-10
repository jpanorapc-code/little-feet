// Existing handlers, registered at their original middleware positions.
function registerAttendanceRoutes(app, context) {
app.get('/api/attendance', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view attendance.' });
  res.json(context.learnerRecordsVisibleTo(context.db.attendance, actor));
});

app.post('/api/attendance', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can record attendance.' });
  const studentName = context.boundedText(req.body?.studentName, 160);
  const status = context.boundedText(req.body?.status || 'Checked In', 40);
  if (!studentName || !context.ATTENDANCE_STATUSES.has(status)) return res.status(400).json({ message: 'Enter a learner and valid attendance status.' });
  const item = context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), studentName, status, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), recordedBy: actor.username });
  context.db.attendance.unshift(item);
  res.json({ success: true, item });
});

app.post('/api/attendance/import', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can import attendance.' });
  const { attendance } = req.body;
  if (!Array.isArray(attendance) || !attendance.length) return res.status(400).json({ message: 'Add at least one attendance record to import.' });
  if (attendance.length > 2000) return res.status(400).json({ message: 'Import up to 2,000 attendance records per file.' });
  {
    const cleanAttendance = attendance.map(item => ({
      studentName: context.boundedText(item?.studentName, 160),
      status: context.boundedText(item?.status || 'Checked In', 40)
    })).filter(item => item.studentName && context.ATTENDANCE_STATUSES.has(item.status));
    context.db.attendance.unshift(...cleanAttendance.map(item => context.tagSchoolRecord(actor, { ...item, id: context.crypto.randomUUID(), timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), recordedBy: actor.username })));
  }
  res.json({ success: true });
});

app.post('/api/attendance/toggle', (req, res) => {
  const actor = context.getSessionAccount(req);
  const { id } = req.body;
  const status = context.boundedText(req.body?.status, 40);
  const item = context.db.attendance.find(a => a.id === id && context.recordInSchool(a, actor));
  if (!actor || !item || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(404).json({ message: 'Attendance record not found.' });
  if (!context.ATTENDANCE_STATUSES.has(status)) return res.status(400).json({ message: 'Choose a valid attendance status.' });
  item.status = status;
  res.json({ success: true });
});

app.delete('/api/attendance/:id', (req, res) => {
  const actor = context.getSessionAccount(req);
  const item = context.db.attendance.find(a => a.id === req.params.id && context.recordInSchool(a, actor));
  if (!actor || !item || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(404).json({ message: 'Attendance record not found.' });
  context.db.attendance = context.db.attendance.filter(a => a !== item);
  res.json({ success: true });
});

app.post('/api/attendance/clear', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can clear attendance.' });
  context.db.attendance = context.db.attendance.filter(item => !context.recordInSchool(item, actor));
  res.json({ success: true });
});
}

module.exports = { registerAttendanceRoutes };
