const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'tmp'), { recursive:true });
const fixture = fs.mkdtempSync(path.join(root, 'tmp', 'registered-schools-'));
const port = 19500 + Math.floor(Math.random()*400);
const base = `http://127.0.0.1:${port}`;
const pin = 'RegisteredSchoolPass1';
const pinHash = crypto.scryptSync(pin, 'little-feet-pin-salt', 64).toString('hex');
for (const file of ['server.js','failover-mode.js','finance-automation-server.js','auth-crypto.js','school-core-upgrades-server.js','advanced-school-operations-server.js']) fs.copyFileSync(path.join(root,file),path.join(fixture,file));
fs.cpSync(path.join(root,'lib'),path.join(fixture,'lib'),{recursive:true});
fs.symlinkSync(path.join(root,'node_modules'),path.join(fixture,'node_modules'),'junction');
fs.writeFileSync(path.join(fixture,'littlefeet-replica.json'),JSON.stringify({
  schools:[{id:'own',name:'Little Feet',status:'active'},{id:'pending',name:'Awaiting Registration School',status:'active'},{id:'orphan',name:'Legacy school entry',status:'active'}],
  users:[{username:'company-admin',name:'Company Administrator',role:'admin',platformAccess:true,schoolId:'orphan',schoolName:'Legacy school entry',pinHash,verificationStatus:'Active'},{username:'owner',name:'Owner',role:'admin',platformAccess:true,schoolId:'own',schoolName:'Old profile name',pinHash,verificationStatus:'Active'},{username:'pending-principal',name:'Pending Principal',role:'principal',schoolId:'pending',schoolName:'Awaiting Registration School',pinHash,verificationStatus:'Self-registered — school verification pending'}],
  students:[],posts:[],moduleRecords:{}
}));
let stderr='';
const child=spawn(process.execPath,['server.js'],{cwd:fixture,env:{...process.env,NODE_ENV:'test',PORT:String(port),LF_REPLICA_MODE:'1',LF_TEST_ALLOW_REPLICA_WRITES:'1',LF_OWNER_ADMIN_USERNAME:'owner'},stdio:['ignore','ignore','pipe']});
child.stderr.on('data',chunk=>{stderr+=chunk;});
const request=async(route,options={})=>{
  const response=await fetch(base+route,{method:options.body?'POST':'GET',headers:{'content-type':'application/json',...(options.cookie?{cookie:options.cookie}:{})},...(options.body?{body:JSON.stringify(options.body)}:{})});
  return {response,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
};
(async()=>{
  try {
    let ready=false;
    for(let i=0;i<150;i++){if(child.exitCode!==null)throw Error(stderr);try{ready=(await fetch(base+'/api/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}
    assert.ok(ready,stderr);
    const login=await request('/api/login',{body:{username:'owner',pin}});
    assert.equal(login.response.status,200);
    const overview=await request('/api/executive-overview',{cookie:login.cookie});
    assert.equal(overview.data.kpis.schools,1,'Pending and orphan school records must not become registered schools');
    assert.equal(overview.data.kpis.accounts,2,'Pending users must not become active accounts');
    const clients=await request('/api/company/clients',{cookie:login.cookie});
    assert.deepEqual(clients.data.map(s=>s.id),['own']);
    assert.equal(clients.data[0].name,'Little Feet','Stable school ID wins over stale profile name');
    const approved=await request('/api/accounts/pending-principal/approve',{cookie:login.cookie,body:{}});
    assert.equal(approved.response.status,200);
    const after=await request('/api/executive-overview',{cookie:login.cookie});
    assert.equal(after.data.kpis.schools,2,'Actual approval must add the school without hardcoding a count');
    assert.equal(after.data.kpis.accounts,3);
    const afterClients=await request('/api/company/clients',{cookie:login.cookie});
    assert.deepEqual(afterClients.data.map(s=>s.id).sort(),['own','pending']);
    console.log('Registered school overview passed: own profile counted, pending/orphan excluded, stale name preserved by ID, approval adds actual school.');
  } catch(error){console.error(error);process.exitCode=1;}
  finally {if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill();});fs.rmSync(fixture,{recursive:true,force:true});}
})();
