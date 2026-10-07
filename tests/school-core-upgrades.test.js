const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tmpRoot = path.join(root, 'tmp');
fs.mkdirSync(tmpRoot, { recursive: true });
const tmp = fs.mkdtempSync(path.join(tmpRoot, 'school-core-upgrades-'));
const port = 7900 + Math.floor(Math.random() * 80);
const base = 'http://127.0.0.1:' + port;
const gatewayPort = port + 1000;
const gatewayRequests = [];
const gateway = http.createServer((req,res)=>{let raw='';req.setEncoding('utf8');req.on('data',chunk=>{raw+=chunk;});req.on('end',()=>{let body={};try{body=JSON.parse(raw||'{}');}catch{}gatewayRequests.push({url:req.url,body});res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'accepted'}));});});
gateway.listen(gatewayPort,'127.0.0.1');
const hash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');
const signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

for (const file of ['server.js','school-core-upgrades-server.js','finance-automation-server.js','failover-mode.js','auth-crypto.js','backup.js']) {
  fs.copyFileSync(path.join(root, file), path.join(tmp, file));
}
for (const dir of [['lib','storage'],['lib']]) fs.mkdirSync(path.join(tmp,...dir), { recursive: true });
for (const file of [
  ['lib','storage','object-storage.js'],['lib','mailbox-integration.js'],['lib','oauth-identity.js'],
  ['lib','structured-logger.js'],['lib','mailbox-oauth.js'],['lib','yahoo-imap.js'],['lib','yahoo-smtp.js']
]) fs.copyFileSync(path.join(root,...file), path.join(tmp,...file));

fs.writeFileSync(path.join(tmp, 'littlefeet-replica.json'), JSON.stringify({
  schools:[
    {id:'school-alpha',name:'Alpha School',status:'active'},
    {id:'school-bravo',name:'Bravo School',status:'active'}
  ],
  users:[
    {username:'alpha-admin',pinHash:hash('AdminPass1'),reportSigningPinHash:hash('Sign1234'),name:'Alpha Admin',role:'admin',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active'},
    {username:'alpha-teacher',pinHash:hash('TeacherPass1'),reportSigningPinHash:hash('Sign1234'),name:'Alpha Teacher',role:'teacher',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active'},
    {username:'alpha-parent',email:'parent@alpha.test',phone:'+27110000001',pinHash:hash('ParentPass1'),reportSigningPinHash:hash('Sign1234'),name:'Alpha Parent',role:'parent',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active',parentRelationshipStatus:'Administrator approved',linkedLearners:['Alpha Learner']},
    {username:'bravo-admin',pinHash:hash('BravoPass1'),name:'Bravo Admin',role:'admin',schoolId:'school-bravo',schoolName:'Bravo School',verificationStatus:'Active'}
  ],
  students:[
    {id:'alpha-learner',studentName:'Alpha Learner',className:'Grade R',schoolId:'school-alpha',schoolName:'Alpha School'},
    {id:'bravo-learner',studentName:'Bravo Learner',className:'Grade R',schoolId:'school-bravo',schoolName:'Bravo School'}
  ],
  attendance:[], moduleRecords:{}, directMessages:[], chatGroups:[], groupMessages:{}
}));

const child=spawn(process.execPath,['server.js'],{
  cwd:tmp,
  env:{...process.env,PORT:String(port),NODE_ENV:'test',LF_REPLICA_MODE:'1',LF_TEST_ALLOW_REPLICA_WRITES:'1',LF_EMAIL_FROM:'noreply@littlefeet.test',LF_EMAIL_API_KEY:'email-test',LF_EMAIL_API_URL:'http://127.0.0.1:'+gatewayPort+'/email',LF_SMS_FROM:'LittleFeet',LF_SMS_API_KEY:'sms-test',LF_SMS_API_URL:'http://127.0.0.1:'+gatewayPort+'/sms',LF_PUSH_API_KEY:'push-test',LF_PUSH_API_URL:'http://127.0.0.1:'+gatewayPort+'/push'},
  stdio:['ignore','ignore','pipe']
});
let stderr=''; child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stop=()=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();});
const stopGateway=()=>new Promise(resolve=>gateway.close(()=>resolve()));

async function request(route,{method='GET',body,cookie}={}){
  const headers={};
  if(body!==undefined) headers['content-type']='application/json';
  if(cookie) headers.cookie=cookie;
  const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();
  let data=text; try{data=JSON.parse(text);}catch{}
  return {response,data,text,cookie:response.headers.get('set-cookie')?.split(';')[0]||cookie};
}
async function login(username,pin){
  const result=await request('/api/login',{method:'POST',body:{username,pin}});
  assert.equal(result.response.status,200,'login failed '+username+' '+result.text);
  return result.cookie;
}

(async()=>{
  try{
    for(let i=0;i<120;i++){
      try{if((await fetch(base+'/api/health')).ok)break;}catch{}
      if(i===119)throw new Error('School core test server did not start. '+stderr);
      await wait(100);
    }

    const admin=await login('alpha-admin','AdminPass1');
    const teacher=await login('alpha-teacher','TeacherPass1');
    const parent=await login('alpha-parent','ParentPass1');
    const bravo=await login('bravo-admin','BravoPass1');

    const skills=await request('/api/grade-r/skills',{cookie:teacher});
    assert.equal(skills.response.status,200);
    assert.equal(skills.data.length,98);
    assert.equal(skills.data.filter(row=>row.subject==='Home Language').length,34);
    assert.equal(skills.data.filter(row=>row.subject==='Mathematics').length,32);
    assert.equal(skills.data.filter(row=>row.subject==='Life Skills').length,32);

    const mark=await request('/api/academics/marks',{method:'POST',cookie:teacher,body:{
      learnerName:'Alpha Learner',subject:'Mathematics',assessmentName:'Numbers 1',term:'Term 4',year:2026,score:18,maximum:20,weight:2,comment:'Good work'
    }});
    assert.equal(mark.response.status,201,mark.text);
    assert.equal(mark.data.mark.percentage,90);

    const parentMarks=await request('/api/academics/marks?learnerName=Alpha%20Learner',{cookie:parent});
    assert.equal(parentMarks.response.status,200);
    assert.equal(parentMarks.data.marks.length,1);
    assert.equal(parentMarks.data.subjects[0].percentage,90);

    const crossMark=await request('/api/academics/marks',{method:'POST',cookie:bravo,body:{
      learnerName:'Alpha Learner',subject:'Mathematics',assessmentName:'Attack',term:'Term 4',year:2026,score:10,maximum:10,weight:1
    }});
    assert.equal(crossMark.response.status,404);

    const edit=await request('/api/academics/marks/'+mark.data.mark.id,{method:'PATCH',cookie:teacher,body:{score:19}});
    assert.equal(edit.response.status,200);
    assert.equal(edit.data.mark.percentage,95);
    const history=await request('/api/academics/marks/'+mark.data.mark.id+'/history',{cookie:teacher});
    assert.equal(history.response.status,200);
    assert.equal(history.data.length,2);

    const report=await request('/api/academics/report-cards',{method:'POST',cookie:teacher,body:{
      learnerName:'Alpha Learner',term:'Term 4',year:2026,teacherComment:'Steady progress',promotionOutcome:'Progress to next phase'
    }});
    assert.equal(report.response.status,201,report.text);
    assert.equal(report.data.reportCard.subjects[0].percentage,95);
    const parentReports=await request('/api/academics/report-cards',{cookie:parent});
    assert.equal(parentReports.response.status,200);
    assert.equal(parentReports.data.length,1);
    const emailed=await request('/api/academics/report-cards/'+report.data.reportCard.id+'/email',{method:'POST',cookie:teacher,body:{}});
    assert.equal(emailed.response.status,200,emailed.text);
    assert.equal(gatewayRequests.some(row=>row.url==='/email'&&row.body.subject.includes('report card')),true);
    const printable=await request('/api/academics/report-cards/'+report.data.reportCard.id+'/print',{cookie:parent});
    assert.equal(printable.response.status,200);
    assert.match(printable.text,/Little Feet Report Card/);

    const conduct=await request('/api/discipline',{method:'POST',cookie:teacher,body:{
      learnerName:'Alpha Learner',kind:'demerit',category:'Class conduct',points:3,details:'Repeated disruption',actionTaken:'Teacher discussion',parentNotified:true
    }});
    assert.equal(conduct.response.status,201);
    assert.equal(conduct.data.totalPoints,3);
    assert.equal(conduct.data.record.parentNotificationStatus,'sent');
    const parentConduct=await request('/api/discipline',{cookie:parent});
    assert.equal(parentConduct.response.status,200);
    assert.equal(parentConduct.data.length,1);

    const asset=await request('/api/assets',{method:'POST',cookie:admin,body:{assetCode:'TAB-001',name:'Class tablet',category:'IT',location:'Grade R',purchaseValue:2500,condition:'Good',status:'In service'}});
    assert.equal(asset.response.status,201);
    const duplicateAsset=await request('/api/assets',{method:'POST',cookie:admin,body:{assetCode:'TAB-001',name:'Duplicate'}});
    assert.equal(duplicateAsset.response.status,409);
    const assetImport=await request('/api/assets/import',{method:'POST',cookie:admin,body:{rows:[{assetCode:'CHAIR-001',name:'Class chair',category:'Furniture',location:'Grade R'}]}});
    assert.equal(assetImport.response.status,201);
    assert.equal(assetImport.data.created,1);
    const bravoAssets=await request('/api/assets',{cookie:bravo});
    assert.equal(bravoAssets.response.status,200);
    assert.equal(bravoAssets.data.length,0);

    const gradeR=await request('/api/grade-r/assessments',{method:'POST',cookie:teacher,body:{learnerName:'Alpha Learner',skillId:'MATH-01',rating:3,evidence:'Counts during morning activity'}});
    assert.equal(gradeR.response.status,201);
    const gradeSummary=await request('/api/grade-r/summary/Alpha%20Learner',{cookie:parent});
    assert.equal(gradeSummary.response.status,200);
    assert.equal(gradeSummary.data.totalSkills,98);
    assert.equal(gradeSummary.data.assessedSkills,1);

    const incident=await request('/api/dsd-incidents',{method:'POST',cookie:teacher,body:{
      learnerName:'Alpha Learner',incidentDate:'2026-10-07',incidentTime:'10:15',location:'Playground',incidentType:'Minor injury',
      description:'Learner tripped while running.',witnesses:'Teacher present',bodyRegions:['left-leg'],firstAid:'Cleaned area',
      treatment:'Cold pack',parentNotification:'Parent called',correctiveAction:'Checked play area',staffStatement:'Observed fall directly',
      signingPin:'Sign1234',signatureData:signature
    }});
    assert.equal(incident.response.status,201,incident.text);
    assert.equal(incident.data.incident.bodyRegions[0],'left-leg');
    assert.ok(incident.data.incident.staffSignedAt);
    const principalSign=await request('/api/dsd-incidents/'+incident.data.incident.id+'/principal-sign',{method:'POST',cookie:admin,body:{principalReview:'Reviewed and action accepted',signingPin:'Sign1234',signatureData:signature}});
    assert.equal(principalSign.response.status,200,principalSign.text);
    assert.equal(principalSign.data.incident.status,'Awaiting parent acknowledgement');
    const parentAck=await request('/api/dsd-incidents/'+incident.data.incident.id+'/parent-acknowledge',{method:'POST',cookie:parent,body:{acknowledgement:'Read and acknowledged',signingPin:'Sign1234',signatureData:signature}});
    assert.equal(parentAck.response.status,200,parentAck.text);
    assert.equal(parentAck.data.incident.status,'Complete');
    const parentIncidents=await request('/api/dsd-incidents',{cookie:parent});
    assert.equal(parentIncidents.response.status,200);
    assert.equal(parentIncidents.data.length,1);

    const settings=await request('/api/attendance/automation/settings',{method:'PUT',cookie:admin,body:{cutoffTime:'09:00',autoAbsent:true,notifyParents:false}});
    assert.equal(settings.response.status,200);
    assert.equal(settings.data.settings.autoAbsent,true);
    const insights=await request('/api/attendance/insights?days=30',{cookie:teacher});
    assert.equal(insights.response.status,200);
    assert.equal(insights.data.settings.cutoffTime,'09:00');

    const config=await request('/api/communications/config',{cookie:teacher});
    assert.equal(config.response.status,200);
    assert.deepEqual(config,{email:true,sms:true,push:true});
    const campaign=await request('/api/communications/campaigns',{method:'POST',cookie:teacher,body:{title:'School update',message:'Real provider test',audience:'parents',channels:['email','sms','push']}});
    assert.equal(campaign.response.status,201,campaign.text);
    assert.equal(campaign.data.campaign.deliveries.length,3);
    assert.equal(campaign.data.campaign.deliveries.every(row=>row.status==='sent'),true);
    assert.equal(gatewayRequests.some(row=>row.url==='/sms'),true);
    assert.equal(gatewayRequests.some(row=>row.url==='/push'),true);

    console.log('School core upgrades test passed');
  } finally {
    await stop();
    await stopGateway();
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})().catch(async error=>{console.error(error);await stop();await stopGateway().catch(()=>{});process.exitCode=1;});