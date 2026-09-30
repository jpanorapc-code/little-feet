const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp', 'import-jobs-'));
const port = 7850 + Math.floor(Math.random() * 100);
const origin = `http://127.0.0.1:${port}`;
const hash = pin => crypto.scryptSync(pin, 'little-feet-pin-salt', 64).toString('hex');
for (const file of ['server.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js']) fs.copyFileSync(path.join(root, file), path.join(temp, file));
fs.mkdirSync(path.join(temp, 'lib', 'storage'), { recursive: true });
fs.copyFileSync(path.join(root, 'lib', 'storage', 'object-storage.js'), path.join(temp, 'lib', 'storage', 'object-storage.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-integration.js'), path.join(temp, 'lib', 'mailbox-integration.js'));
fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [{ id: 'school-alpha', name: 'Alpha School' }, { id: 'school-bravo', name: 'Bravo School' }],
  users: [
    { username: 'alpha-admin', pinHash: hash('AlphaPass1'), name: 'Alpha Admin', role: 'admin', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
    { username: 'bravo-admin', pinHash: hash('BravoPass1'), name: 'Bravo Admin', role: 'admin', schoolId: 'school-bravo', schoolName: 'Bravo School', verificationStatus: 'Active' }
  ], students: [], importJobs: [], importAudit: [], learnerAccessCodes: [], schoolBilling: {}, moduleRecords: {}, directMessages: [], chatGroups: [], groupMessages: {}
}));

let child;
const start = async () => {
  child = spawn(process.execPath, ['server.js'], { cwd: temp, env: { ...process.env, PORT: String(port), NODE_ENV: 'test', SESSION_SECRET: 'import-session', LF_FIELD_ENCRYPTION_KEY: 'import-fields' }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 120; i += 1) { try { if ((await fetch(origin + '/api/health')).ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Import test server did not start.');
};
const stop = () => new Promise(resolve => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });
const call = async (route, { method = 'GET', body, cookie } = {}) => {
  const response = await fetch(origin + route, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
};
const login = async (username, pin) => { const result = await call('/api/login', { method: 'POST', body: { username, pin } }); assert.equal(result.response.status, 200); return result.cookie; };

(async () => {
  try {
    await start();
    let alpha = await login('alpha-admin', 'AlphaPass1');
    const importId = 'import_alpha_20260927';
    const first = await call('/api/students/import', { method: 'POST', cookie: alpha, body: { importId, batchNumber: 0, totalBatches: 2, students: [
      { studentName: 'Learner One', className: 'Grade 1', contactEmail: 'one@example.test' },
      { studentName: '', className: 'Grade 1' }
    ] } });
    assert.equal(first.response.status, 201);
    assert.equal(first.data.imported, 1);
    assert.equal(first.data.rejected.length, 1);
    const replay = await call('/api/students/import', { method: 'POST', cookie: alpha, body: { importId, batchNumber: 0, totalBatches: 2, students: [{ studentName: 'Should Not Duplicate', className: 'Grade 2' }] } });
    assert.equal(replay.response.status, 200);
    assert.equal(replay.data.duplicateBatch, true);
    const second = await call('/api/students/import', { method: 'POST', cookie: alpha, body: { importId, batchNumber: 1, totalBatches: 2, students: [
      { studentName: 'Learner Two', className: 'Grade 2', contactEmail: 'two@example.test' },
      { studentName: 'Learner One', className: 'Grade 1', contactEmail: 'one@example.test' }
    ] } });
    assert.equal(second.response.status, 201);
    assert.equal(second.data.status, 'completed');
    assert.deepEqual([second.data.progress.imported, second.data.progress.rejected], [2, 2]);

    const bravo = await login('bravo-admin', 'BravoPass1');
    assert.equal((await call('/api/students/import/' + importId, { cookie: bravo })).response.status, 404, 'Other schools must not see import progress.');
    const oversized = await call('/api/students/import', { method: 'POST', cookie: alpha, body: { importId: 'oversized_import', batchNumber: 0, totalBatches: 1, students: Array.from({ length: 501 }, (_, index) => ({ studentName: 'L' + index, className: 'G1' })) } });
    assert.equal(oversized.response.status, 400);
    const oversizedSchedules = await call('/api/schedules/import', { method: 'POST', cookie: alpha, body: { schedules: Array.from({ length: 2001 }, (_, index) => ({ studentName: 'L' + index, dayOfWeek: 'Monday', timeSlot: '08:00', activity: 'Class' })) } });
    assert.equal(oversizedSchedules.response.status, 400, 'Schedule imports must reject rather than silently truncate oversized batches.');
    const oversizedAttendance = await call('/api/attendance/import', { method: 'POST', cookie: alpha, body: { attendance: Array.from({ length: 2001 }, (_, index) => ({ studentName: 'L' + index, status: 'Checked In' })) } });
    assert.equal(oversizedAttendance.response.status, 400, 'Attendance imports must reject rather than silently truncate oversized batches.');
    const oversizedBooks = await call('/api/book-register/import', { method: 'POST', cookie: alpha, body: { rows: Array.from({ length: 2001 }, () => ({})) } });
    assert.equal(oversizedBooks.response.status, 400, 'Book-register imports must reject rather than silently truncate oversized batches.');

    await stop(); await start(); alpha = await login('alpha-admin', 'AlphaPass1');
    const restored = await call('/api/students/import/' + importId, { cookie: alpha });
    assert.equal(restored.response.status, 200);
    assert.deepEqual([restored.data.status, restored.data.imported, restored.data.rejected], ['completed', 2, 2]);
    const learners = await call('/api/students/search', { cookie: alpha });
    assert.equal(learners.data.length, 2, 'Only validated, non-duplicate records should persist.');
    console.log('Bounded resumable learner-import lifecycle test passed.');
  } finally { await stop(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
