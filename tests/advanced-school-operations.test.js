const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lf-advanced-'));
fs.symlinkSync(path.join(root,'node_modules'),path.join(tmp,'node_modules'),'junction');
for(const file of ['server.js','school-core-upgrades-server.js','advanced-school-operations-server.js','finance-automation-server.js','failover-mode.js','auth-crypto.js','backup.js','index.html','logo.png','logo-transparent.png','little-feet-mascot.jfif'])fs.copyFileSync(path.join(root,file),path.join(tmp,file));
fs.cpSync(path.join(root,'lib'),path.join(tmp,'lib'),{recursive:true});
fs.cpSync(path.join(root,'assets'),path.join(tmp,'assets'),{recursive:true});

const pin='SyntheticTest1';
const pinHash=crypto.scryptSync(pin,'little-feet-pin-salt',64).toString('hex');
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Johannesburg'});
fs.writeFileSync(path.join(tmp,'littlefeet-replica.json'),JSON.stringify({
  schools:[{id:'s-a',name:'School A',status:'active'},{id:'s-b',name:'School B',status:'active'}],
  users:[
    {username:'a-admin',pinHash,name:'A Admin',role:'admin',schoolId:'s-a',schoolName:'School A',verificationStatus:'Active'},
    {username:'a-teacher',pinHash,name:'A Teacher',role:'teacher',schoolId:'s-a',schoolName:'School A',verificationStatus:'Active'},
    {username:'a-parent',pinHash,name:'A Parent',role:'parent',schoolId:'s-a',schoolName:'School A',verificationStatus:'Active',linkedLearners:['Learner A']},
    {username:'b-admin',pinHash,name:'B Admin',role:'admin',schoolId:'s-b',schoolName:'School B',verificationStatus:'Active'},
    {username:'platform',pinHash,name:'Platform',role:'staff',platformAccess:true,schoolId:'s-a',schoolName:'School A',verificationStatus:'Active'}
  ],
  students:[{id:'la',studentName:'Learner A',className:'Grade R',schoolId:'s-a',schoolName:'School A'},{id:'lb',studentName:'Learner B',className:'Grade R',schoolId:'s-b',schoolName:'School B'}],
  attendance:[{id:'att',studentName:'Learner A',status:'Present',date:today,schoolId:'s-a',schoolName:'School A'}],
  subjectMarks:[
    {id:'m1',learnerName:'Learner A',subject:'Mathematics',assessmentName:'First',term:'Term 4',year:2026,percentage:50,createdAt:'2026-10-01T08:00:00Z',schoolId:'s-a',schoolName:'School A'},
    {id:'m2',learnerName:'Learner A',subject:'Mathematics',assessmentName:'Second',term:'Term 4',year:2026,percentage:80,createdAt:'2026-10-02T08:00:00Z',schoolId:'s-a',schoolName:'School A'}
  ],
  moduleRecords:{},registry:[],directMessages:[],chatGroups:[],groupMessages:{}
}));

const port=19731;
const base='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['server.js'],{cwd:tmp,env:{...process.env,PORT:String(port),NODE_ENV:'test',LF_REPLICA_MODE:'1',LF_TEST_ALLOW_REPLICA_WRITES:'1',LF_FIELD_ENCRYPTION_KEY:'synthetic-test-key',SESSION_SECRET:'synthetic-session-key'},stdio:['ignore','ignore','pipe']});
let stderr='';child.stderr.on('data',d=>stderr+=d.toString());
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const stop=()=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();});
async function request(route,{method='GET',body,cookie}={}){const headers={};if(body!==undefined)headers['content-type']='application/json';if(cookie)headers.cookie=cookie;const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();let data=text;try{data=JSON.parse(text);}catch{}return {response,data,text,cookie:response.headers.get('set-cookie')?.split(';')[0]||cookie};}
async function login(username){const r=await request('/api/login',{method:'POST',body:{username,pin}});assert.equal(r.response.status,200,r.text);return r.cookie;}

(async()=>{
 try{
  for(let i=0;i<120;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(i===119)throw new Error(stderr);await wait(100);}
  const admin=await login('a-admin'),teacher=await login('a-teacher'),parent=await login('a-parent'),bravo=await login('b-admin'),platform=await login('platform');

  const imported=await request('/api/elda/catalogue/import',{method:'POST',cookie:admin,body:{rows:[{code:'WB-001',label:'Development skill one',area:'ELDA 1 · Well-being',ageBand:'48–59 months',phase:'Birth–4',source:'School-approved official mapping'}]}});
  assert.equal(imported.response.status,201,imported.text);
  assert.equal((await request('/api/elda/catalogue',{cookie:bravo})).data.total,0);
  const catalogue=await request('/api/elda/catalogue',{cookie:teacher});
  assert.equal((await request('/api/elda/assessments',{method:'POST',cookie:teacher,body:{learnerName:'Learner A',skillId:catalogue.data.skills[0].id,rating:3,evidence:'Observed in class'}})).response.status,201);
  assert.equal((await request('/api/elda/summary/Learner%20A',{cookie:parent})).data.assessedSkills,1);

  assert.equal((await request('/api/aftercare/settings',{method:'PUT',cookie:admin,body:{closeTime:'00:00',lateFeePer15Minutes:5,defaultDailyRate:40}})).response.status,200);
  const checkin=await request('/api/aftercare/check-in',{method:'POST',cookie:teacher,body:{learnerName:'Learner A'}});
  const checkout=await request('/api/aftercare/sessions/'+checkin.data.session.id+'/check-out',{method:'POST',cookie:teacher,body:{}});
  assert.ok(checkout.data.session.lateFee>0);
  assert.ok(['invoice_created','billing_pending_configuration'].includes(checkout.data.session.billingStatus));

  assert.equal((await request('/api/staff-clock/action',{method:'POST',cookie:teacher,body:{action:'clock_in'}})).response.status,200);
  await request('/api/staff-ratio/settings',{method:'PUT',cookie:admin,body:{maxChildrenPerStaff:1}});
  assert.equal((await request('/api/staff-ratio/live',{cookie:teacher})).data.withinRatio,true);

  await request('/api/day-care/capacity',{method:'PUT',cookie:admin,body:{className:'Holiday',date:'2026-12-15',capacity:1}});
  const b1=await request('/api/day-care/bookings',{method:'POST',cookie:admin,body:{childName:'Visitor 1',className:'Holiday',date:'2026-12-15',rate:0}});
  const b2=await request('/api/day-care/bookings',{method:'POST',cookie:admin,body:{childName:'Visitor 2',className:'Holiday',date:'2026-12-15',rate:0}});
  assert.equal(b1.data.booking.status,'confirmed');assert.equal(b2.data.booking.status,'waitlisted');

  const dietary=await request('/api/meals/dietary',{method:'POST',cookie:teacher,body:{learnerName:'Learner A',allergies:'Synthetic restriction',requirements:'Synthetic requirement',notes:'Synthetic note'}});
  assert.equal(dietary.response.status,201,dietary.text);
  const dietaryView=await request('/api/meals/dietary',{cookie:parent});
  assert.equal(dietaryView.data[0].allergies,'Synthetic restriction');
  await wait(120);
  const persisted=fs.readFileSync(path.join(tmp,'littlefeet-replica.json'),'utf8');
  assert.equal(persisted.includes('Synthetic restriction'),false,'Dietary details must be encrypted at rest');

  const aiConfig=await request('/api/ai/observation/config',{cookie:teacher});
  assert.equal(aiConfig.response.status,200);
  assert.equal(aiConfig.data.ready,false);
  const aiAttempt=await request('/api/ai/observation-assist',{method:'POST',cookie:teacher,body:{observation:'Synthetic classroom observation'}});
  assert.equal(aiAttempt.response.status,409,'AI must not fabricate output without a configured provider');

  const group=await request('/api/learner-groups',{method:'POST',cookie:teacher,body:{name:'Team A',type:'Sport'}});
  const members=await request('/api/learner-groups/'+group.data.group.id+'/members',{method:'POST',cookie:teacher,body:{learnerNames:['Learner A']}});
  assert.deepEqual(members.data.group.members,['Learner A']);

  await request('/api/academics/subject-assignments',{method:'POST',cookie:teacher,body:{learnerName:'Learner A',subject:'Mathematics',action:'add',effectiveDate:'2026-10-07'}});
  const analytics=await request('/api/academics/analytics?term=Term%204&subject=Mathematics',{cookie:teacher});
  assert.equal(analytics.data.learners[0].change,30);assert.equal(analytics.data.subjectChanges.length,1);

  const pass=await request('/api/pickup-passes',{method:'POST',cookie:parent,body:{learnerName:'Learner A',collectorName:'Parent A',expiresMinutes:60}});
  const token=pass.data.pass.token;assert.match(token,/^LFP-/);
  assert.equal((await request('/api/pickup-passes/redeem',{method:'POST',cookie:admin,body:{token}})).response.status,200);
  assert.equal((await request('/api/pickup-passes/redeem',{method:'POST',cookie:admin,body:{token}})).response.status,409);

  assert.equal((await request('/api/school-groups',{method:'POST',cookie:admin,body:{name:'Denied',schoolIds:['s-a','s-b']}})).response.status,403);
  const sg=await request('/api/school-groups',{method:'POST',cookie:platform,body:{name:'Group',schoolIds:['s-a','s-b']}});
  assert.equal((await request('/api/school-groups/'+sg.data.group.id+'/dashboard',{cookie:platform})).data.sites.length,2);

  console.log('Advanced school operations regression passed');
 }finally{await stop();fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(async error=>{console.error(error);await stop().catch(()=>{});process.exitCode=1;});