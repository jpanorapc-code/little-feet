const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { normaliseApiArgument } = require('../scripts/audit-route-connections');

assert.equal(normaliseApiArgument('`/api/broadcasts${locationQuery}`'), '/api/broadcasts');
assert.equal(normaliseApiArgument("'/api/academics/marks'+(learner?'?learnerName='+encodeURIComponent(learner):'')"), '/api/academics/marks');
assert.equal(normaliseApiArgument("'/api/aftercare/sessions/'+encodeURIComponent(id)+'/check-out'"), '/api/aftercare/sessions/value/check-out');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-routing-admissions-'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'junction');
for (const file of ['server.js','school-core-upgrades-server.js','advanced-school-operations-server.js','finance-automation-server.js','failover-mode.js','auth-crypto.js','backup.js','index.html','logo.png','logo-transparent.png','little-feet-mascot.jfif']) {
  fs.copyFileSync(path.join(root, file), path.join(tmp, file));
}
fs.cpSync(path.join(root, 'lib'), path.join(tmp, 'lib'), { recursive: true });
fs.cpSync(path.join(root, 'assets'), path.join(tmp, 'assets'), { recursive: true });

const pin = 'SyntheticPass1';
const pinHash = crypto.scryptSync(pin, 'little-feet-pin-salt', 64).toString('hex');
fs.writeFileSync(path.join(tmp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [{ id:'school-a', name:'School A', status:'active' }],
  users: [
    { username:'principal@test.local', pinHash, name:'Principal A', role:'principal', schoolId:'school-a', schoolName:'School A', verificationStatus:'Active' },
    { username:'admin@test.local', pinHash, name:'Admin A', role:'admin', schoolId:'school-a', schoolName:'School A', verificationStatus:'Active' },
    { username:'parent@test.local', pinHash, name:'Parent A', role:'parent', schoolId:'school-a', schoolName:'School A', verificationStatus:'Active', linkedLearners:[] }
  ],
  students: [],
  registry: [],
  tickets: [],
  admissionsApplications: [],
  admissionsStatusHistory: [],
  fileRecords: [],
  documentAudit: [],
  moduleRecords:{}, directMessages:[], chatGroups:[], groupMessages:{}
}));

const port = 19821;
const base = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['server.js'], {
  cwd: tmp,
  env: { ...process.env, PORT:String(port), NODE_ENV:'test', LF_REPLICA_MODE:'1', LF_TEST_ALLOW_REPLICA_WRITES:'1', LF_FIELD_ENCRYPTION_KEY:'synthetic-routing-key', SESSION_SECRET:'synthetic-routing-session' },
  stdio:['ignore','ignore','pipe']
});
let stderr = '';
child.stderr.on('data', data => { stderr += data.toString(); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const stop = () => new Promise(resolve => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});
async function request(route, { method='GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { response, data, text, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}
async function login(username) {
  const result = await request('/api/login', { method:'POST', body:{ username, pin } });
  assert.equal(result.response.status, 200, result.text);
  return result.cookie;
}

(async () => {
  try {
    for (let i=0; i<120; i++) {
      try { if ((await fetch(base + '/api/health')).ok) break; } catch {}
      if (i === 119) throw new Error('Server did not start: ' + stderr);
      await wait(100);
    }

    const parent = await login('parent@test.local');
    const admin = await login('admin@test.local');

    const unknownApi = await request('/api/definitely-not-a-route', { cookie:admin });
    assert.equal(unknownApi.response.status, 404);
    assert.equal(unknownApi.data.message, 'API route not found.');
    assert.equal(String(unknownApi.response.headers.get('content-type') || '').includes('application/json'), true);

    const unknownPage = await request('/definitely-not-a-page');
    assert.equal(unknownPage.response.status, 404);
    assert.equal(unknownPage.text, '');

    const rootPage = await request('/');
    assert.equal(rootPage.response.status, 200);
    assert.match(rootPage.text, /Little Feet/);

    const createApplication = learnerName => request('/api/school-applications', {
      method:'POST',
      cookie:parent,
      body:{
        schoolName:'School A',
        guardianName:'Parent A',
        contactPhone:'0110000000',
        contactEmail:'parent@test.local',
        learnerName,
        dateOfBirth:'2021-01-15',
        intendedStart:'2027-01-15',
        gradeOrAgeGroup:'Grade R · Reception',
        homeArea:'Synthetic suburb',
        notes:'Synthetic admissions regression.'
      }
    });

    const first = await createApplication('Learner One');
    assert.equal(first.response.status, 201, first.text);
    const firstId = first.data.application.id;

    const prematureEnrol = await request('/api/admissions/applications/' + firstId + '/enrol', {
      method:'POST', cookie:admin, body:{ className:'Grade R', address:'Synthetic address' }
    });
    assert.equal(prematureEnrol.response.status, 409);
    assert.match(prematureEnrol.data.message, /Approve this application/);

    const checklist = await request('/api/admissions/applications/' + firstId + '/checklist', {
      method:'PUT', cookie:admin, body:{ items:[{ key:'birth_certificate', label:'Birth certificate', required:false }] }
    });
    assert.equal(checklist.response.status, 200, checklist.text);

    const approved = await request('/api/admissions/applications/' + firstId + '/status', {
      method:'PATCH', cookie:admin, body:{ status:'Approved', note:'Approved in regression test.' }
    });
    assert.equal(approved.response.status, 200, approved.text);

    const enrolled = await request('/api/admissions/applications/' + firstId + '/enrol', {
      method:'POST', cookie:admin, body:{ className:'Grade R', address:'Synthetic address', consent:'Pending verification' }
    });
    assert.equal(enrolled.response.status, 201, enrolled.text);

    const registry = await request('/api/registry', { cookie:admin });
    assert.equal(registry.response.status, 200, registry.text);
    assert.equal(registry.data.some(row => row.learnerName === 'Learner One'), true);

    const second = await createApplication('Learner Two');
    assert.equal(second.response.status, 201, second.text);
    const secondId = second.data.application.id;
    const withdrawn = await request('/api/admissions/applications/' + secondId + '/withdraw', { method:'POST', cookie:parent, body:{} });
    assert.equal(withdrawn.response.status, 200, withdrawn.text);
    assert.equal(withdrawn.data.application.status, 'Withdrawn');

    const tickets = await request('/api/tickets', { cookie:admin });
    assert.equal(tickets.response.status, 200, tickets.text);
    const withdrawnTicket = tickets.data.find(ticket => ticket.applicationId === secondId);
    assert.ok(withdrawnTicket);
    assert.equal(withdrawnTicket.status, 'Completed');

    console.log('Routing and admissions regression passed');
  } finally {
    await stop();
    fs.rmSync(tmp, { recursive:true, force:true });
  }
})().catch(async error => {
  console.error(error);
  await stop().catch(() => {});
  process.exitCode = 1;
});
