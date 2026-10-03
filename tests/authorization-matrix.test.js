const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'authorization-matrix-'));
const port = 7350 + Math.floor(Math.random() * 120);
const base = 'http://127.0.0.1:' + port;
const hash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');

for (const file of ['server.js','failover-mode.js','finance-automation-server.js','auth-crypto.js','backup.js']) {
  fs.copyFileSync(path.join(root, file), path.join(temp, file));
}
fs.mkdirSync(path.join(temp, 'lib', 'storage'), { recursive: true });
fs.copyFileSync(path.join(root, 'lib', 'storage', 'object-storage.js'), path.join(temp, 'lib', 'storage', 'object-storage.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-integration.js'), path.join(temp, 'lib', 'mailbox-integration.js'));
fs.copyFileSync(path.join(root, 'lib', 'oauth-identity.js'), path.join(temp, 'lib', 'oauth-identity.js'));
fs.copyFileSync(path.join(root, 'lib', 'structured-logger.js'), path.join(temp, 'lib', 'structured-logger.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-oauth.js'), path.join(temp, 'lib', 'mailbox-oauth.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-imap.js'), path.join(temp, 'lib', 'yahoo-imap.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-smtp.js'), path.join(temp, 'lib', 'yahoo-smtp.js'));

fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools:[{ id:'school-alpha', name:'Alpha School', status:'active' }],
  users:[
    { username:'alpha-admin', pinHash:hash('AdminPass1'), name:'Alpha Admin', role:'admin', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active' },
    { username:'alpha-principal', pinHash:hash('PrincipalPass1'), name:'Alpha Principal', role:'principal', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active' },
    { username:'alpha-teacher', pinHash:hash('TeacherPass1'), name:'Alpha Teacher', role:'teacher', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active', assignedClasses:['Grade 1'] },
    { username:'alpha-district@example.test', pinHash:hash('DistrictPass1'), name:'Alpha District', role:'district', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active' },
    { username:'littlefeet-staff', pinHash:hash('StaffPass1'), name:'Little Feet Staff', role:'staff', schoolId:'', schoolName:'', verificationStatus:'Active' },
    { username:'littlefeet-crm', pinHash:hash('CrmPass1'), name:'Little Feet CRM', role:'crm', schoolId:'', schoolName:'', verificationStatus:'Active' },
    { username:'alpha-parent@example.test', pinHash:hash('ParentPass1'), name:'Alpha Parent', role:'parent', schoolId:'school-alpha', schoolName:'Alpha School', verificationStatus:'Active', parentRelationshipStatus:'Administrator approved', linkedLearners:['Alpha Learner'] }
  ],
  students:[{ id:'student-1', studentName:'Alpha Learner', className:'Grade 1', parentName:'Alpha Parent', contactEmail:'alpha-parent@example.test', schoolId:'school-alpha', schoolName:'Alpha School' }],
  moduleRecords:{ finance:[], operations:[], care:[], engagement:[], dailyCare:[], portfolio:[], curriculum:[], supplies:[], stock:[], reports:[], safeguarding:[], absences:[], handovers:[], stickyNotes:[] },
  chatGroups:[], groupMessages:{}, directMessages:[], registry:[], consentRecords:[], pickupLogs:[],
  storeProducts:[], storeOrders:[], tickets:[], broadcasts:[], campusVisitors:[], visitorMeetings:[],
  learnerAccessCodes:[], parentPayments:[], parentSubscriptions:[], paymentEvents:[], paymentLedger:[], schoolBilling:{}
}));

const child = spawn(process.execPath, ['server.js'], {
  cwd:temp,
  env:{
    ...process.env,
    PORT:String(port),
    NODE_ENV:'test',
    LF_REPLICA_MODE:'1',
    LF_TEST_ALLOW_REPLICA_WRITES:'1',
    LF_TEST_ENFORCE_ORIGIN:'1',
    SESSION_SECRET:'matrix-session-secret',
    LF_FIELD_ENCRYPTION_KEY:'matrix-field-secret'
  },
  stdio:['ignore','ignore','pipe']
});
let stderr='';
child.stderr.on('data', chunk => { stderr += chunk.toString(); });

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const stop = () => new Promise(resolve => {
  if (child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});

async function request(route,{method='GET',body,cookie}={}){
  const headers={};
  if(body!==undefined) headers['content-type']='application/json';
  if(cookie) headers.cookie=cookie;
  if(cookie && !['GET','HEAD','OPTIONS'].includes(method)) headers.origin=base;
  const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});
  const text=await response.text();
  let data=text; try{data=JSON.parse(text);}catch{}
  return {response,data,text,cookie:response.headers.get('set-cookie')?.split(';')[0]||cookie};
}
async function login(username,pin){
  const result=await request('/api/login',{method:'POST',body:{username,pin}});
  assert.equal(result.response.status,200,'login failed '+username+' '+result.text);
  return result.cookie;
}
function assertDenied(result,label){
  assert.ok([401,403,404].includes(result.response.status),label+' unexpectedly allowed: '+result.response.status+' '+result.text);
}

(async()=>{
  try{
    for(let i=0;i<120;i+=1){
      try{const health=await fetch(base+'/api/health');if(health.ok)break;}catch{}
      if(i===119) throw new Error('Matrix server failed to start. '+stderr);
      await wait(100);
    }

    const admin=await login('alpha-admin','AdminPass1');
    const principal=await login('alpha-principal','PrincipalPass1');
    const teacher=await login('alpha-teacher','TeacherPass1');
    const district=await login('alpha-district@example.test','DistrictPass1');
    const staff=await login('littlefeet-staff','StaffPass1');
    const crm=await login('littlefeet-crm','CrmPass1');
    const parent=await login('alpha-parent@example.test','ParentPass1');

    // Administrators can clear the 10-minute sign-in wait for a managed account
    // without changing that account's password.
    assert.equal((await request('/api/login',{method:'POST',body:{username:'alpha-teacher',pin:'WrongPass1'}})).response.status,401);
    assert.equal((await request('/api/login',{method:'POST',body:{username:'alpha-teacher',pin:'WrongPass1'}})).response.status,401);
    assert.equal((await request('/api/login',{method:'POST',body:{username:'alpha-teacher',pin:'WrongPass1'}})).response.status,429);
    assert.equal((await request('/api/login',{method:'POST',body:{username:'alpha-teacher',pin:'TeacherPass1'}})).response.status,429);
    assertDenied(
      await request('/api/accounts/alpha-teacher/reset-login-lockout',{method:'POST',cookie:principal,body:{}}),
      'principal login lockout reset'
    );
    const resetLoginWait=await request('/api/accounts/alpha-teacher/reset-login-lockout',{method:'POST',cookie:admin,body:{}});
    assert.equal(resetLoginWait.response.status,200);
    assert.equal(resetLoginWait.data.success,true);
    assert.match(resetLoginWait.data.message,/sign-in wait has been cleared/i);
    assert.equal((await request('/api/login',{method:'POST',body:{username:'alpha-teacher',pin:'TeacherPass1'}})).response.status,200);

    // Anonymous users must not read private operational data.
    for(const route of ['/api/accounts','/api/schools/search?q=L','/api/email/status','/api/registry','/api/parent-contacts','/api/modules/operations','/api/chat/groups','/api/store','/api/parent-payments','/api/report-reviews','/api/household','/api/learner-access-codes','/api/safety-network']){
      assertDenied(await request(route),'anonymous '+route);
    }

    // Parent: family-facing features remain, school-internal management is denied.
    assert.equal((await request('/api/store',{cookie:parent})).response.status,200);
    assert.equal((await request('/api/chat/groups',{cookie:parent})).response.status,200);
    assert.equal((await request('/api/chat/direct/users',{cookie:parent})).response.status,200);
    const parentEmailStatus=await request('/api/email/status',{cookie:parent});
    assert.equal(parentEmailStatus.response.status,200);
    assert.equal(parentEmailStatus.data.address,'alpha-parent@example.test');
    assertDenied(await request('/api/subscription-billing',{cookie:parent}),'parent school billing');
    assertDenied(await request('/api/modules/operations',{method:'POST',cookie:parent,body:{type:'probe',details:'probe'}}),'parent module write');
    assertDenied(await request('/api/store/products',{method:'POST',cookie:parent,body:{name:'probe',price:1,stockQuantity:1}}),'parent store admin');
    assertDenied(await request('/api/broadcasts',{method:'POST',cookie:parent,body:{bcMessage:'probe',bcPriority:'Urgent',location:{lat:-25,lng:28},radiusKm:1}}),'parent broadcast create');
    assertDenied(await request('/api/learner-access-codes',{cookie:parent}),'parent learner codes');
    assertDenied(await request('/api/parent-contacts',{cookie:parent}),'parent contact directory');

    // Teacher: classroom workflows stay available, admin/principal surfaces stay denied.
    assert.equal((await request('/api/modules/operations',{method:'POST',cookie:teacher,body:{type:'Routine',details:'Classroom record'}})).response.status,200);
    assertDenied(await request('/api/accounts',{method:'POST',cookie:teacher,body:{username:'x',pin:'1234',name:'x',role:'teacher'}}),'teacher account admin');
    assertDenied(await request('/api/payments/reconcile',{method:'POST',cookie:teacher,body:{eventId:'x',reference:'x',status:'paid',amount:1}}),'teacher reconciliation');
    assertDenied(await request('/api/safety-network',{cookie:teacher}),'teacher safety-network admin view');
    assertDenied(await request('/api/learner-access-codes',{cookie:teacher}),'teacher learner codes');
    assert.equal((await request('/api/parent-contacts',{cookie:teacher})).response.status,200);

    // Principal: operational leadership is preserved, platform-admin controls remain admin-only.
    assert.equal((await request('/api/subscription-billing',{cookie:principal})).response.status,200);
    assertDenied(await request('/api/accounts',{method:'POST',cookie:principal,body:{username:'x',pin:'1234',name:'x',role:'teacher'}}),'principal account admin');
    assertDenied(await request('/api/schools/search?q=L',{cookie:principal}),'principal school search');
    assert.equal((await request('/api/payments/ledger',{cookie:principal})).response.status,200);
    assertDenied(await request('/api/store/products',{method:'POST',cookie:principal,body:{name:'probe',price:1,stockQuantity:1}}),'principal store product admin');
    assertDenied(await request('/api/learner-access-codes/printable-list',{cookie:principal}),'principal bulk code export');
    assert.equal((await request('/api/parent-contacts',{cookie:principal})).response.status,200);

    // District: approved overview/search surfaces only; private chat/learner registers are blocked.
    assert.equal((await request('/api/subscription-billing',{cookie:district})).response.status,200);
    assertDenied(await request('/api/registry',{cookie:district}),'district registry');
    assertDenied(await request('/api/parent-contacts',{cookie:district}),'district parent contacts');
    assertDenied(await request('/api/modules/operations',{cookie:district}),'district modules');
    assertDenied(await request('/api/chat/groups',{cookie:district}),'district group chat');
    assertDenied(await request('/api/chat/direct/users',{cookie:district}),'district direct chat');
    const districtEmailStatus=await request('/api/email/status',{cookie:district});
    assert.equal(districtEmailStatus.response.status,200);
    assert.equal(districtEmailStatus.data.address,'alpha-district@example.test');

    // Little Feet company roles: Staff and CRM are company-wide full-platform roles.
    const staffAccounts=await request('/api/accounts',{cookie:staff});
    assert.equal(staffAccounts.response.status,200);
    const staffSchoolSearch=await request('/api/schools/search?q=L',{cookie:staff});
    assert.equal(staffSchoolSearch.response.status,200);
    assert.deepEqual(staffSchoolSearch.data.results,[]);
    assert.ok(staffAccounts.data.some(account=>account.username==='alpha-admin'));
    const staffCreatesCrm=await request('/api/accounts',{method:'POST',cookie:staff,body:{username:'new-crm-user',pin:'Password1',name:'New CRM User',role:'crm',schoolName:''}});
    assert.equal(staffCreatesCrm.response.status,201);
    assert.equal(staffCreatesCrm.data.account.schoolName,'');
    const schoolAdminCreatesCrm=await request('/api/accounts',{method:'POST',cookie:admin,body:{username:'blocked-crm-user',pin:'Password1',name:'Blocked CRM User',role:'crm',schoolName:''}});
    assert.equal(schoolAdminCreatesCrm.response.status,403);
    const crmAccounts=await request('/api/accounts',{cookie:crm});
    assert.equal(crmAccounts.response.status,200);
    assert.ok(crmAccounts.data.some(account=>account.username==='alpha-admin'));
    assert.equal((await request('/api/tickets',{cookie:crm})).response.status,200);

    // Username collision by truncation must fail rather than create ambiguous identities.
    const prefix='a'.repeat(160);
    const createLongPrefix=await request('/api/accounts',{method:'POST',cookie:admin,body:{username:prefix,pin:'Password1',name:'Prefix User',role:'teacher',schoolName:'Alpha School'}});
    assert.equal(createLongPrefix.response.status,201);
    const createSecond=await request('/api/accounts',{method:'POST',cookie:admin,body:{username:'rename-target',pin:'Password1',name:'Rename Target',role:'teacher',schoolName:'Alpha School'}});
    assert.equal(createSecond.response.status,201);
    const truncationCollision=await request('/api/accounts/rename-target',{method:'PUT',cookie:admin,body:{username:prefix+'Z'}});
    assert.equal(truncationCollision.response.status,400);
    const accountsAfterCollision=await request('/api/accounts',{cookie:admin});
    assert.equal(accountsAfterCollision.data.filter(account=>account.username===prefix).length,1);

    // The last administrator cannot demote itself.
    const finalAdminDemotion=await request('/api/accounts/alpha-admin',{method:'PUT',cookie:admin,body:{role:'teacher'}});
    assert.equal(finalAdminDemotion.response.status,400);

    // But role changes still work after another administrator exists.
    const secondAdmin=await request('/api/accounts',{method:'POST',cookie:admin,body:{username:'alpha-admin-2',pin:'Password1',name:'Second Admin',role:'admin',schoolName:'Alpha School'}});
    assert.equal(secondAdmin.response.status,201);
    const safeDemotion=await request('/api/accounts/alpha-admin',{method:'PUT',cookie:admin,body:{role:'principal'}});
    assert.equal(safeDemotion.response.status,200);
    assert.equal(safeDemotion.data.account.role,'principal');

    console.log('Authorization matrix regression test passed.');
  }catch(error){
    console.error(error);
    process.exitCode=1;
  }finally{
    await stop();
    fs.rmSync(temp,{recursive:true,force:true});
  }
})();
