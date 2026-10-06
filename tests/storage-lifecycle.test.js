const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(root, 'tmp', 'storage-lifecycle-'));
const objectRoot = path.join(temp, 'objects');
const port = 7600 + Math.floor(Math.random() * 200);
const origin = `http://127.0.0.1:${port}`;
const pinHash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');
const pngA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const pngB = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4x8AAAAASUVORK5CYII=';

for (const file of ['server.js', 'failover-mode.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js']) fs.copyFileSync(path.join(root, file), path.join(temp, file));
fs.mkdirSync(path.join(temp, 'lib', 'storage'), { recursive: true });
fs.copyFileSync(path.join(root, 'lib', 'storage', 'object-storage.js'), path.join(temp, 'lib', 'storage', 'object-storage.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-integration.js'), path.join(temp, 'lib', 'mailbox-integration.js'));
fs.copyFileSync(path.join(root, 'lib', 'oauth-identity.js'), path.join(temp, 'lib', 'oauth-identity.js'));
fs.copyFileSync(path.join(root, 'lib', 'structured-logger.js'), path.join(temp, 'lib', 'structured-logger.js'));
fs.copyFileSync(path.join(root, 'lib', 'payfast.js'), path.join(temp, 'lib', 'payfast.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-oauth.js'), path.join(temp, 'lib', 'mailbox-oauth.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-imap.js'), path.join(temp, 'lib', 'yahoo-imap.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-smtp.js'), path.join(temp, 'lib', 'yahoo-smtp.js'));
fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [{ id: 'school-alpha', name: 'Alpha School', status: 'active' }, { id: 'school-bravo', name: 'Bravo School', status: 'active' }],
  users: [
    { username: 'alpha-admin', pinHash: pinHash('AlphaPass1'), name: 'Alpha Admin', role: 'admin', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
    { username: 'alpha-teacher', pinHash: pinHash('TeacherPass1'), name: 'Alpha Teacher', role: 'teacher', schoolId: 'school-alpha', schoolName: 'Alpha School', verificationStatus: 'Active' },
    { username: 'bravo-admin', pinHash: pinHash('BravoPass1'), name: 'Bravo Admin', role: 'admin', schoolId: 'school-bravo', schoolName: 'Bravo School', verificationStatus: 'Active' }
  ],
  students: [], posts: [], worksheets: [], fileRecords: [], importJobs: [], learnerAccessCodes: [], schoolBilling: {}, moduleRecords: {}, directMessages: [], chatGroups: [], groupMessages: {}
}));

let child;
let stderr = '';
const start = async () => {
  stderr = '';
  child = spawn(process.execPath, ['server.js'], { cwd: temp, env: { ...process.env, PORT: String(port), NODE_ENV: 'test', SESSION_SECRET: 'storage-test-session', LF_FIELD_ENCRYPTION_KEY: 'storage-test-fields', LF_LOCAL_OBJECT_STORAGE_DIR: objectRoot }, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { if ((await fetch(`${origin}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Storage test server did not start. ${stderr}`);
};
const stop = () => new Promise(resolve => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });
const request = async (route, { method = 'GET', body, cookie } = {}) => {
  const response = await fetch(origin + route, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let data = text; try { data = JSON.parse(text); } catch {}
  return { response, data, bytes: Buffer.from(await (async () => text)()), cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
};
const login = async (username, pin) => {
  const result = await request('/api/login', { method: 'POST', body: { username, pin } });
  assert.equal(result.response.status, 200, result.data?.message);
  return result.cookie;
};

(async () => {
  try {
    await start();
    let alphaCookie = await login('alpha-admin', 'AlphaPass1');
    const created = await request('/api/posts', { method: 'POST', cookie: alphaCookie, body: { audience: 'All', caption: 'Storage lifecycle', mediaUrl: pngA } });
    assert.equal(created.response.status, 200, created.data?.message);
    assert.match(created.data.post.mediaUrl, /^\/api\/files\/[^/]+\/content$/);
    const contentUrl = created.data.post.mediaUrl;
    const fileId = decodeURIComponent(contentUrl.split('/')[3]);
    const firstRead = await fetch(origin + contentUrl, { headers: { cookie: alphaCookie } });
    assert.equal(firstRead.status, 200);
    assert.match(firstRead.headers.get('content-type') || '', /^image\/png/);

    const bravoCookie = await login('bravo-admin', 'BravoPass1');
    assert.equal((await fetch(origin + contentUrl, { headers: { cookie: bravoCookie } })).status, 404, 'Cross-tenant file read must fail closed.');

    const invalid = await request('/api/files/' + fileId, { method: 'PUT', cookie: alphaCookie, body: { originalFilename: 'attack.png', dataUrl: 'data:image/png;base64,JVBERi0xLjQK' } });
    assert.equal(invalid.response.status, 400, 'MIME/signature mismatch must be rejected.');

    const replaced = await request('/api/files/' + fileId, { method: 'PUT', cookie: alphaCookie, body: { originalFilename: '../../replacement.png', dataUrl: pngB } });
    assert.equal(replaced.response.status, 200, replaced.data?.message);
    assert.equal(replaced.data.file.originalFilename, 'replacement.png');
    assert.equal((await fetch(origin + contentUrl, { headers: { cookie: alphaCookie } })).status, 404, 'Replaced file must no longer be readable.');
    const replacementUrl = replaced.data.file.contentUrl;

    await stop();
    await start();
    alphaCookie = await login('alpha-admin', 'AlphaPass1');
    assert.equal((await fetch(origin + replacementUrl, { headers: { cookie: alphaCookie } })).status, 200, 'File must survive an application restart.');

    const staffUpload = await request('/api/files', { method: 'POST', cookie: alphaCookie, body: { entityType: 'staff', recordId: 'alpha-teacher', purpose: 'profile-photo', originalFilename: 'teacher.png', dataUrl: pngA } });
    assert.equal(staffUpload.response.status, 201, staffUpload.data?.message);
    const staffFileUrl = staffUpload.data.file.contentUrl;
    assert.equal((await fetch(origin + staffFileUrl, { headers: { cookie: alphaCookie } })).status, 200);
    const deletedAccount = await request('/api/accounts/alpha-teacher', { method: 'DELETE', cookie: alphaCookie });
    assert.equal(deletedAccount.response.status, 200, deletedAccount.data?.message);
    assert.equal((await fetch(origin + staffFileUrl, { headers: { cookie: alphaCookie } })).status, 404, 'Deleting a staff account must retire its private objects.');

    const deleted = await request('/api/posts/' + created.data.post.id, { method: 'DELETE', cookie: alphaCookie });
    assert.equal(deleted.response.status, 200, deleted.data?.message);
    assert.equal((await fetch(origin + replacementUrl, { headers: { cookie: alphaCookie } })).status, 404, 'Deleting the related record must retire its object.');
    assert.doesNotMatch(stderr, /Unhandled|uncaught/i);
    console.log('Private object-storage lifecycle and cross-tenant authorization test passed.');
  } finally {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
