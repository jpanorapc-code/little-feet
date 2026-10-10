// Existing handlers, registered at their original middleware positions.
function registerPostsRoutes(app, context) {
app.get('/api/posts', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view the school feed.' });
  res.json(context.tenantRecords(context.db.posts, actor).map(post => ({ ...post, mediaUrl: post.mediaFileId ? `/api/files/${encodeURIComponent(post.mediaFileId)}/content` : context.safeStoredMedia(post.mediaUrl, context.validPostMediaData) })));
});

app.post('/api/posts', async (req, res, next) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can post updates.' });
  if (req.body?.mediaUrl !== undefined && req.body.mediaUrl !== null && !context.validPostMediaData(req.body.mediaUrl)) return res.status(400).json({ message: 'Attached media must be a supported PNG, JPEG, or WebP image under 5 MB.' });
  const audience = context.boundedText(req.body?.audience || 'All', 40);
  const caption = context.boundedText(req.body?.caption, 4000);
  if (!context.POST_AUDIENCES.has(audience) || !caption) return res.status(400).json({ message: 'Choose a valid audience and add an update.' });
  const post = context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(),
    audience,
    caption,
    mediaUrl: req.body?.mediaUrl || null,
    createdBy: actor.username,
    createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  let file;
  try {
    if (post.mediaUrl && context.objectStorage.configured) {
      file = await context.createStoredFile(actor, { entityType: 'post', recordId: post.id, purpose: 'school-feed-image', originalFilename: 'school-feed-image', dataUrl: post.mediaUrl });
      post.mediaFileId = file.id; post.mediaUrl = null;
    }
    context.db.posts.unshift(post);
    if (file) { await context.saveDatabaseState(); req.persistenceCommitted = true; }
    res.json({ success: true, post: { ...post, mediaUrl: file ? context.fileContentPath(file) : post.mediaUrl } });
  } catch (error) {
    context.db.posts = context.db.posts.filter(item => item !== post);
    if (file) await context.rollbackStoredFile(file);
    next(error);
  }
});

app.delete('/api/posts/:id', async (req, res, next) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const post = context.db.posts.find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!post) return res.status(404).json({ message: 'School update not found.' });
  const file = post.mediaFileId && context.db.fileRecords.find(item => item.id === post.mediaFileId && context.recordInSchool(item, actor));
  try {
    if (file) { file.accessState = 'pending_delete'; file.updatedAt = new Date().toISOString(); }
    context.db.posts = context.db.posts.filter(p => p !== post);
    if (file) {
      await context.saveDatabaseState(); await context.objectStorage.delete({ key: file.objectKey });
      file.accessState = 'deleted'; file.deletedAt = new Date().toISOString(); await context.saveDatabaseState(); req.persistenceCommitted = true;
    }
    res.json({ success: true });
  } catch (error) {
    if (!context.db.posts.includes(post)) context.db.posts.unshift(post);
    if (file) file.accessState = 'active';
    await context.saveDatabaseState().catch(() => {}); next(error);
  }
});

app.get('/api/schedules', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view schedules.' });
  res.json(context.learnerRecordsVisibleTo(context.db.schedules, actor));
});

app.post('/api/schedules', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can create schedules.' });
  const studentName = context.boundedText(req.body?.studentName, 160);
  const dayOfWeek = context.boundedText(req.body?.dayOfWeek, 20);
  const timeSlot = context.boundedText(req.body?.timeSlot, 80);
  const activity = context.boundedText(req.body?.activity, 1000);
  if (!studentName || !activity) return res.status(400).json({ message: 'Complete the learner and activity.' });
  const item = context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), studentName, dayOfWeek, timeSlot, activity, createdBy: actor.username });
  context.db.schedules.push(item);
  res.json({ success: true, item });
});

app.post('/api/schedules/import', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can import schedules.' });
  const { schedules } = req.body;
  if (!Array.isArray(schedules) || !schedules.length) return res.status(400).json({ message: 'Add at least one schedule record to import.' });
  if (schedules.length > 2000) return res.status(400).json({ message: 'Import up to 2,000 schedule records per file.' });
  {
    const cleanSchedules = schedules.map(item => ({
      studentName: context.boundedText(item?.studentName, 160),
      dayOfWeek: context.boundedText(item?.dayOfWeek, 20),
      timeSlot: context.boundedText(item?.timeSlot, 80),
      activity: context.boundedText(item?.activity, 1000)
    })).filter(item => item.studentName && item.activity);
    context.db.schedules.push(...cleanSchedules.map(item => context.tagSchoolRecord(actor, { ...item, id: context.crypto.randomUUID(), createdBy: actor.username })));
  }
  res.json({ success: true });
});

app.delete('/api/schedules/:id', (req, res) => {
  const actor = context.getSessionAccount(req);
  const item = context.db.schedules.find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!actor || !item || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(404).json({ message: 'Schedule item not found.' });
  context.db.schedules = context.db.schedules.filter(s => s !== item);
  res.json({ success: true });
});

app.get('/api/worksheets', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view learning files.' });
  res.json(context.learnerRecordsVisibleTo(context.db.worksheets, actor).map(worksheet => ({ ...worksheet, photoUrl: worksheet.photoFileId ? `/api/files/${encodeURIComponent(worksheet.photoFileId)}/content` : context.safeStoredMedia(worksheet.photoUrl) })));
});

app.post('/api/worksheets', async (req, res, next) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can add learning files.' });
  if (req.body?.photoUrl !== undefined && req.body.photoUrl !== null && !context.validWorksheetMediaData(req.body.photoUrl)) return res.status(400).json({ message: 'Attached evidence must be a supported PNG, JPEG, GIF, or WebP image under 5 MB.' });
  const studentName = context.boundedText(req.body?.studentName, 160);
  const title = context.boundedText(req.body?.title, 240);
  const hasGrade = req.body?.grade !== undefined && req.body?.grade !== null && String(req.body.grade).trim() !== '';
  const grade = hasGrade ? Number(req.body.grade) : null;
  if (!studentName || !title || (hasGrade && (!Number.isFinite(grade) || grade < 0 || grade > 100))) return res.status(400).json({ message: 'Enter a learner and title; when supplied, the grade must be between 0 and 100.' });
  const item = context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(), studentName, title, ...(hasGrade ? { grade } : {}),
    photoUrl: req.body?.photoUrl || null,
    submittedBy: actor.username,
    uploadedAt: new Date().toLocaleDateString(),
    createdAt: new Date().toISOString()
  });
  let file;
  try {
    if (item.photoUrl && context.objectStorage.configured) {
      file = await context.createStoredFile(actor, { entityType: 'worksheet', recordId: item.id, purpose: 'learning-evidence', originalFilename: 'learning-evidence', dataUrl: item.photoUrl });
      item.photoFileId = file.id; item.photoUrl = null;
    }
    context.db.worksheets.unshift(item);
    if (file) { await context.saveDatabaseState(); req.persistenceCommitted = true; }
    res.json({ success: true, item: { ...item, photoUrl: file ? context.fileContentPath(file) : item.photoUrl } });
  } catch (error) {
    context.db.worksheets = context.db.worksheets.filter(record => record !== item);
    if (file) await context.rollbackStoredFile(file);
    next(error);
  }
});

app.delete('/api/worksheets/:id', async (req, res, next) => {
  const actor = context.getSessionAccount(req);
  const item = context.db.worksheets.find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!actor || !item || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(404).json({ message: 'Learning file not found.' });
  const file = item.photoFileId && context.db.fileRecords.find(record => record.id === item.photoFileId && context.recordInSchool(record, actor));
  try {
    if (file) { file.accessState = 'pending_delete'; file.updatedAt = new Date().toISOString(); }
    context.db.worksheets = context.db.worksheets.filter(w => w !== item);
    if (file) {
      await context.saveDatabaseState(); await context.objectStorage.delete({ key: file.objectKey });
      file.accessState = 'deleted'; file.deletedAt = new Date().toISOString(); await context.saveDatabaseState(); req.persistenceCommitted = true;
    }
    res.json({ success: true });
  } catch (error) {
    if (!context.db.worksheets.includes(item)) context.db.worksheets.unshift(item);
    if (file) file.accessState = 'active';
    await context.saveDatabaseState().catch(() => {}); next(error);
  }
});

app.get('/api/badges', (req, res) => {
  const requester = context.getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to view badges.' });
  const badges = context.tenantRecords(context.db.badges, requester);
  if (requester.role !== 'parent') return res.json(badges);

  const linkedLearners = new Set(
    context.tenantRecords(context.db.students, requester)
      .filter(student => context.isParentLinkedToLearner(requester, student))
      .map(student => String(student.studentName).toLocaleLowerCase('en-US'))
  );
  res.json(badges.filter(badge => linkedLearners.has(String(badge.studentName || '').toLocaleLowerCase('en-US'))));
});

app.post('/api/badges', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) {
    return res.status(403).json({ message: 'Only authorised school staff can award badges.' });
  }
  const studentName = String(req.body?.studentName || '').trim().slice(0, 160);
  const category = String(req.body?.category || '').trim().slice(0, 80);
  const title = String(req.body?.title || req.body?.awardName || '').trim().slice(0, 160);
  const note = String(req.body?.note || '').trim().slice(0, 1000);
  if (!studentName || !category || !title) return res.status(400).json({ message: 'Choose a learner, milestone category, and badge title.' });
  const item = context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(),
    studentName,
    category,
    title,
    note,
    awardedBy: actor.username,
    createdAt: new Date().toISOString()
  });
  context.db.badges.unshift(item);
  res.json({ success: true, item });
});

app.delete('/api/badges/:id', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) {
    return res.status(403).json({ message: 'Only authorised school staff can remove badges.' });
  }
  const badge = context.db.badges.find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!badge) return res.status(404).json({ message: 'Badge not found.' });
  context.db.badges = context.db.badges.filter(b => b !== badge);
  res.json({ success: true });
});

app.get('/api/analytics/:studentName', (req, res) => {
  const name = req.params.studentName;
  const requester = context.getSessionAccount(req);
  if (!requester) return res.status(401).json({ message: 'Sign in to view growth analytics.' });
  if (!(context.hasPlatformAccess(requester) || ['parent', 'teacher', 'principal', 'district', 'admin', 'staff'].includes(requester.role))) return res.status(403).json({ message: 'Learner analytics access is restricted.' });
  const student = context.learnerRecordsVisibleTo(context.db.students, requester).find(entry => context.normalizeComparableText(entry.studentName) === context.normalizeComparableText(name));
  if (!student) return res.status(404).json({ message: 'Learner record not found.' });
  if (requester.role === 'parent' && !context.isParentLinkedToLearner(requester, student)) return res.status(403).json({ message: 'Parents may only view analytics for their linked learner.' });
  const studentWorksheets = context.learnerRecordsVisibleTo(context.db.worksheets, requester).filter(w => w.studentName.toLowerCase() === name.toLowerCase() && Number.isFinite(Number(w.grade))).reverse();
  if (!studentWorksheets.length) return res.json({ totalAssessments: 0, subscription: requester.subscription || 'school', studentName: name });
  const scores = studentWorksheets.map(item => Number(item.grade));
  const averageScore = Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
  const first = studentWorksheets[0];
  const latest = studentWorksheets.at(-1);
  const pointChange = Number(latest.grade) - Number(first.grade);
  const percentageChange = Number(first.grade) ? Math.round((pointChange / Number(first.grade)) * 1000) / 10 : null;
  const best = studentWorksheets.reduce((bestItem, item) => Number(item.grade) > Number(bestItem.grade) ? item : bestItem);
  const worst = studentWorksheets.reduce((worstItem, item) => Number(item.grade) < Number(worstItem.grade) ? item : worstItem);
  const hasPremiumDetail = requester.role !== 'parent' || context.parentSubscriptionActive(requester);
  res.json({ totalAssessments: scores.length, averageScore, latestScore: Number(latest.grade), baselineScore: Number(first.grade), pointChange, percentageChange, trend: pointChange > 0 ? 'Improved' : pointChange < 0 ? 'Declined' : 'Maintained', best: hasPremiumDetail ? { title: best.title || 'Assessment', score: Number(best.grade) } : null, worst: hasPremiumDetail ? { title: worst.title || 'Assessment', score: Number(worst.grade) } : null, subscription: requester.role === 'parent' ? (hasPremiumDetail ? 'plus' : 'basic') : (requester.subscription || 'school'), detailedInsights: hasPremiumDetail });
});
}

module.exports = { registerPostsRoutes };
