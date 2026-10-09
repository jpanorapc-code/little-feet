const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
const temp = fs.mkdtempSync(path.join(tempRoot, 'deep-integrity-'));
for (const name of ['server.js', 'backup.js', 'auth-crypto.js', 'failover-mode.js', 'finance-automation-server.js', 'school-core-upgrades-server.js', 'advanced-school-operations-server.js']) fs.copyFileSync(path.join(root, name), path.join(temp, name));
fs.cpSync(path.join(root, 'lib'), path.join(temp, 'lib'), { recursive: true });
const pin = 'IntegrityPass1';
const pinHash = crypto.scryptSync(pin, 'little-feet-pin-salt', 64).toString('hex');
const user = (username, role, schoolId) => ({ username, role, schoolId, schoolName: schoolId, name: username, pinHash, verificationStatus: 'Active', assignedClasses: ['Grade R'] });
fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools: ['alpha', 'bravo', 'limited'].map(id => ({ id, name: id, status: 'active', subscriptionStatus: 'active', subscriptionPlanCode: 'micro', subscriptionActiveUntil: '2099-12-31' })),
  users: [user('alpha-admin', 'admin', 'alpha'), user('bravo-admin', 'admin', 'bravo'), user('limit-admin', 'admin', 'limited'), user('alpha-teacher', 'teacher', 'alpha'), {...user('alpha-parent','parent','alpha'), requestedLearnerLinks:['Pending One','Pending Two','Pending Three','Pending Four'], linkedLearners:[], parentRelationshipStatus:'Pending administrator approval'}, { ...user('platform', 'admin', 'bravo'), platformAccess: true }],
  students: [
    { id: 'bravo-shared', schoolId: 'bravo', schoolName: 'bravo', studentName: 'Shared Learner', className: 'Grade R', contactEmail: 'guardian@invalid.test', parentName: 'Bravo Guardian' },
    { id: 'alpha-shared', schoolId: 'alpha', schoolName: 'alpha', studentName: 'Shared Learner', className: 'Grade R', contactEmail: 'guardian@invalid.test', parentName: 'Alpha Guardian' },
    {id:'alpha-unique',schoolId:'alpha',schoolName:'alpha',studentName:'Unique Alpha Learner',className:'Grade R'},
    ...Array.from({ length: 250 }, (_, i) => ({ id: `limited-${i}`, schoolId: 'limited', studentName: `Capacity learner ${i}`, className: 'Grade R' }))
  ],
  registry: [{ id: 'alpha-registry', schoolId: 'alpha', learnerName: 'Shared Learner', className: 'Grade R', guardianName: 'Alpha Guardian' }],
  moduleRecords: {}, staffNotices: [], learnerAccessCodes: []
}));
const port = 20400 + Math.floor(Math.random() * 500);
const origin = `http://127.0.0.1:${port}`;
let child, stderr = '';
const start = async () => {
  child = spawn(process.execPath, ['server.js'], { cwd: temp, env: { ...process.env, NODE_ENV: 'test', PORT: String(port), SESSION_SECRET: 'deep-integrity-session', LF_FIELD_ENCRYPTION_KEY: 'deep-integrity-fields' }, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => { stderr += chunk; });
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(stderr);
    try { if ((await fetch(origin + '/api/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Real application failed to start: ' + stderr);
};
const stop = () => new Promise(resolve => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });
const request = async (route, cookie, method = 'GET', body) => {
  const response = await fetch(origin + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
};
const login = async username => {
  const result = await request('/api/login', null, 'POST', { username, pin });
  assert.equal(result.status, 200, JSON.stringify(result.data)); return result.cookie;
};
const failures = [];
const check = (name, actual, expected) => { console.log(`${name}: ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`); try { assert.deepEqual(actual, expected); } catch { failures.push(name); } };
(async () => {
  try {
    await start();
    let admin = await login('alpha-admin'); const platform = await login('platform'); const teacher = await login('alpha-teacher'); const limited = await login('limit-admin');
    const initialCodes = (await request('/api/learner-access-codes', platform)).data.filter(x => x.learnerName === 'Shared Learner');
    check('Same-name learners have distinct school code records before edits', new Set(initialCodes.map(x => x.codeRecordId)).size, 2);
    const sharedKey = initialCodes[0].learnerKey;
    check('Ambiguous platform print refuses to select another school', (await request('/api/learner-access-codes/'+encodeURIComponent(sharedKey)+'/printable', platform)).status, 409);
    check('Explicit school print uses the correct code', (await request('/api/learner-access-codes/'+encodeURIComponent(sharedKey)+'/printable?schoolId=alpha', platform)).data.accessCode, initialCodes.find(x=>x.schoolId==='alpha').accessCode);
    check('Ambiguous platform issue refuses to choose a school', (await request('/api/learner-access-codes', platform, 'POST', {learnerKey:sharedKey})).status, 409);
    const ambiguousMark = await request('/api/academics/marks',platform,'POST',{learnerName:'Shared Learner',subject:'Maths',assessmentName:'Integrity check',term:'Term 4',year:2026,score:8,maximum:10});
    check('Ambiguous platform mark cannot select another school', ambiguousMark.status, 409);
    const uniqueMark = await request('/api/academics/marks',platform,'POST',{learnerName:'Unique Alpha Learner',subject:'Maths',assessmentName:'Integrity check',term:'Term 4',year:2026,score:8,maximum:10});
    check('Platform mark belongs to learner school',uniqueMark.data.mark?.schoolId,'alpha');
    const parent = await login('alpha-parent');
    const deniedLink = await request('/api/learner-access-codes/redeem',parent,'POST',{accessCode:initialCodes.find(x=>x.schoolId==='alpha').accessCode});
    check('Fifth learner-link request rejects',deniedLink.status,400);
    check('Rejected link request leaves parent unchanged',(await request('/api/accounts',admin)).data.find(x=>x.username==='alpha-parent').requestedLearnerLinks.length,4);
    const originalAlphaCode = (await request('/api/learner-access-codes', admin)).data.find(x => x.learnerName === 'Shared Learner').accessCode;
    const registration = { learnerName: 'Rejected learner', className: 'Grade R', dateOfBirth: '2020-01-01', guardianName: 'Guardian', guardianPhone: '0123456789', address: 'School street' };
    const overflow = await request('/api/registry', limited, 'POST', registration);
    check('Full-school registration rejects', overflow.status, 409);
    check('Rejected registration leaves no register row', (await request('/api/registry', limited)).data.length, 0);
    await request('/api/term', limited, 'POST', { term: 'Term 4' });
    await request('/api/registry/alpha-registry/contact', platform, 'PATCH', { guardianName: 'Updated Alpha Guardian', guardianPhone: '0123456789', guardianEmail: 'updated@invalid.test' });
    const shared = (await request('/api/students/search?childName=Shared', platform)).data;
    check('Contact update targets selected school learner', shared.find(x => x.id === 'alpha-shared').parentName, 'Updated Alpha Guardian');
    check('Contact update preserves other school learner', shared.find(x => x.id === 'bravo-shared').parentName, 'Bravo Guardian');
    check('Changing guardian email preserves printed access code', (await request('/api/learner-access-codes', admin)).data.find(x => x.learnerName === 'Shared Learner').accessCode, originalAlphaCode);
    const invalidDate = await request('/api/registry', admin, 'POST', { ...registration, learnerName: 'Invalid Birthday', dateOfBirth: '2020-02-31' });
    check('Impossible birthday rejected', invalidDate.status, 400);
    const badConsent = await request('/api/consents', admin, 'POST', { learnerName: 'Shared Learner', guardianName: 'Guardian', internalUpdates: 'false', marketingPhotos: 'false' });
    check('String false cannot grant photo consent', badConsent.status, 400);
    const correctConsent = await request('/api/consents', admin, 'POST', { learnerName: 'Shared Learner', guardianName: 'Guardian', internalUpdates: false, marketingPhotos: false });
    check('Explicit refusal preserved', correctConsent.data.record?.marketingPhotos, false);
    await request('/api/consents',platform,'POST',{learnerName:'Shared Learner',guardianName:'Bravo Guardian',internalUpdates:true,marketingPhotos:true});
    check('Platform consent edit preserves other school refusal',(await request('/api/consents',admin)).data.find(x=>x.learnerName==='Shared Learner')?.marketingPhotos,false);
    const privateNotice = await request('/api/staff/notices', admin, 'POST', { title: 'Management notice', message: 'Principal-only personnel review', audience: 'principal', required: true });
    assert.equal(privateNotice.status, 201);
    check('Teacher cannot read principal notice', (await request('/api/staff/notices', teacher)).data.some(x => x.id === privateNotice.data.item.id), false);
    const codes = (await request('/api/learner-access-codes', platform)).data.filter(x => x.learnerName === 'Shared Learner');
    check('Same-name learners have distinct school code records', new Set(codes.map(x => x.codeRecordId)).size, 2);
    const alphaCodes = (await request('/api/learner-access-codes', admin)).data;
    const oldCode = alphaCodes.find(x => x.learnerName === 'Shared Learner');
    const replaced = await request('/api/learner-access-codes/' + oldCode.codeRecordId + '/replace', platform, 'POST', {});
    assert.equal(replaced.status, 200);
    check('Platform replacement preserves learner school', Boolean((await request('/api/learner-access-codes', admin)).data.find(x => x.learnerName === 'Shared Learner')?.accessCode), true);
    await stop(); await start(); admin = await login('alpha-admin'); const limitAfterRestart = await login('limit-admin');
    check('Rejected register row never persists across restart', (await request('/api/registry', limitAfterRestart)).data.length, 0);
    check('Refused consent survives restart', (await request('/api/consents', admin)).data.find(x => x.learnerName === 'Shared Learner')?.marketingPhotos, false);
    assert.deepEqual(failures, [], 'Confirmed integrity failures: ' + failures.join(', '));
    console.log('Deep data integrity regression passed against real HTTP routes and durable SQLite storage.');
  } finally { await stop(); assert.equal(path.dirname(path.resolve(temp)), path.resolve(tempRoot)); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
