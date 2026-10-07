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

for (const file of ['server.js','school-core-upgrades-server.js','advanced-school-operations-server.js','finance-automation-server.js','failover-mode.js','auth-crypto.js','backup.js']) {
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
    {username:'alpha-teacher',pinHash:hash('TeacherPass1'),reportSigningPinHash:hash('Sign1234'),name:'Alpha Teacher',role:'teacher',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active',assignedClasses:['Grade R']},
    {username:'alpha-teacher-other',pinHash:hash('TeacherPass2'),name:'Other Teacher',role:'teacher',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active',assignedClasses:['Grade 1']},
    {username:'alpha-parent',email:'parent@alpha.test',pinHash:hash('ParentPass1'),reportSigningPinHash:hash('Sign1234'),name:'Alpha Parent',role:'parent',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active',parentRelationshipStatus:'Administrator approved',linkedLearners:['Alpha Learner']},
    {username:'bravo-admin',pinHash:hash('BravoPass1'),name:'Bravo Admin',role:'admin',schoolId:'school-bravo',schoolName:'Bravo School',verificationStatus:'Active'}
  ],
  students:[
    {id:'alpha-learner',studentName:'Alpha Learner',className:'Grade R',schoolId:'school-alpha',schoolName:'Alpha School'},
    {id:'bravo-learner',studentName:'Bravo Learner',className:'Grade R',schoolId:'school-bravo',schoolName:'Bravo School'}
  ],
  registry:[{id:'alpha-registry',learnerName:'Alpha Learner',guardianName:'Alpha Parent',guardianEmail:'parent@alpha.test',guardianPhone:'+27110000001',schoolId:'school-alpha',schoolName:'Alpha School'}],
  attendance:[
    {id:'att-in',studentName:'Alpha Learner',status:'Present',date:'2026-10-07',schoolId:'school-alpha',schoolName:'Alpha School'},
    {id:'att-out',studentName:'Alpha Learner',status:'Absent',date:'2026-09-01',schoolId:'school-alpha',schoolName:'Alpha School'}
  ], moduleRecords:{}, directMessages:[], chatGroups:[], groupMessages:{}
}));

const child=spawn(process.execPath,['server.js'],{
  cwd:tmp,
  env:{...process.env,PORT:String(port),NODE_ENV:'test',LF_REPLICA_MODE:'1',LF_TEST_ALLOW_REPLICA_WRITES:'1',LF_EMAIL_FROM:'noreply@littlefeet.test',LF_EMAIL_API_KEY:'email-test',LF_EMAIL_API_URL:'http://127.0.0.1:'+gatewayPort+'/email',LF_SMS_FROM:'LittleFeet',LF_SMS_API_KEY:'sms-test',LF_SMS_API_URL:'http://127.0.0.1:'+gatewayPort+'/sms',LF_PUSH_API_KEY:'push-test',LF_PUSH_API_URL:'http://127.0.0.1:'+gatewayPort+'/push',LF_WHATSAPP_FROM:'LittleFeet',LF_WHATSAPP_API_KEY:'whatsapp-test',LF_WHATSAPP_API_URL:'http://127.0.0.1:'+gatewayPort+'/whatsapp'},
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

    const invalidYearEdit=await request('/api/academics/marks/'+mark.data.mark.id,{method:'PATCH',cookie:teacher,body:{year:'banana'}});
    assert.equal(invalidYearEdit.response.status,400);
    const blankSubjectEdit=await request('/api/academics/marks/'+mark.data.mark.id,{method:'PATCH',cookie:teacher,body:{subject:'   '}});
    assert.equal(blankSubjectEdit.response.status,400);
    const markAfterRejectedEdits=await request('/api/academics/marks?learnerName=Alpha%20Learner',{cookie:teacher});
    assert.equal(markAfterRejectedEdits.data.marks[0].year,2026);
    assert.equal(markAfterRejectedEdits.data.marks[0].subject,'Mathematics');

    const report=await request('/api/academics/report-cards',{method:'POST',cookie:teacher,body:{
      learnerName:'Alpha Learner',term:'Term 4',year:2026,periodStart:'2026-10-01',periodEnd:'2026-10-31',teacherComment:'Steady progress',promotionOutcome:'Progress to next phase'
    }});
    assert.equal(report.response.status,201,report.text);
    assert.equal(report.data.reportCard.subjects[0].percentage,95);
    assert.equal(report.data.reportCard.attendanceSummary.Present,1);
    assert.equal(report.data.reportCard.attendanceSummary.Absent,undefined);
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
    assert.equal(conduct.data.record.requiredAction,'Normal');
    const conductPrint=await request('/api/discipline/'+conduct.data.record.id+'/print',{cookie:parent});
    assert.equal(conductPrint.response.status,200);
    assert.match(conductPrint.text,/Learner Conduct Record/);

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

    const gradeR=await request('/api/grade-r/assessments',{method:'POST',cookie:teacher,body:{learnerName:'Alpha Learner',term:'Term 4',skillId:'MATH-01',rating:3,evidence:'Counts during morning activity'}});
    assert.equal(gradeR.response.status,201);
    const gradeSummary=await request('/api/grade-r/summary/Alpha%20Learner?term=Term%204',{cookie:parent});
    assert.equal(gradeSummary.response.status,200);
    assert.equal(gradeSummary.data.totalSkills,98);
    assert.equal(gradeSummary.data.assessedSkills,1);

    const incident=await request('/api/dsd-incidents',{method:'POST',cookie:teacher,body:{
      learnerName:'Alpha Learner',incidentDate:'2026-10-07',incidentTime:'10:15',location:'Playground',incidentType:'Minor injury',
      description:'Learner tripped while running.',witnesses:'Teacher present',injuriesOrSymptoms:'Scrape on left knee',bodyRegions:['left-leg'],
      bloodPresent:true,bloodAmount:'Small amount',bloodLocation:'Left knee',firstAid:'Cleaned area',treatment:'Cold pack',
      medicalReferral:'Not required',parentNotification:'Parent called',parentNotifiedAt:'10:30',parentCollectedAt:'12:00',
      parentAdvice:'Keep area clean and watch for swelling',personInCharge:'Alpha Teacher',preventiveMeasures:'Inspect running surface',
      correctiveAction:'Checked play area',staffStatement:'Observed fall directly',signingPin:'Sign1234',signatureData:signature
    }});
    assert.equal(incident.response.status,201,incident.text);
    assert.equal(incident.data.incident.bodyRegions[0],'left-leg');
    assert.equal(incident.data.incident.bloodPresent,true);
    assert.equal(incident.data.incident.bloodAmount,'Small amount');
    assert.equal(incident.data.incident.personInCharge,'Alpha Teacher');
    assert.equal(incident.data.incident.preventiveMeasures,'Inspect running surface');
    assert.ok(incident.data.incident.staffSignedAt);
    assert.equal(incident.data.incident.staffSigned,true);
    assert.equal(Object.prototype.hasOwnProperty.call(incident.data.incident,'staffSignature'),false,'Normal incident JSON must not expose decrypted signature image data');
    const incidentPrint=await request('/api/dsd-incidents/'+incident.data.incident.id+'/print',{cookie:teacher});
    assert.equal(incidentPrint.response.status,200);
    assert.match(incidentPrint.text,/Amount of blood/);
    assert.match(incidentPrint.text,/Measures to prevent repeat/);
    assert.match(incidentPrint.text,/class="signature-image"/,'Printable DSD form must render stored signatures');
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
    assert.deepEqual(config.data,{email:true,sms:true,push:true,whatsapp:true});
    const campaign=await request('/api/communications/campaigns',{method:'POST',cookie:teacher,body:{title:'School update',message:'Real provider test',audience:'parents',channels:['email','sms','push','whatsapp']}});
    assert.equal(campaign.response.status,201,campaign.text);
    assert.equal(campaign.data.campaign.deliveries.length,4);
    assert.equal(campaign.data.campaign.deliveries.every(row=>row.status==='sent'),true);
    assert.equal(gatewayRequests.some(row=>row.url==='/sms'),true);
    assert.equal(gatewayRequests.some(row=>row.url==='/sms'&&row.body.to==='+27110000001'),true);
    assert.equal(gatewayRequests.some(row=>row.url==='/push'),true);
    assert.equal(gatewayRequests.some(row=>row.url==='/whatsapp'),true);
    const parentInbox=await request('/api/communications/inbox',{cookie:parent});
    assert.equal(parentInbox.response.status,200,parentInbox.text);
    assert.equal(parentInbox.data.some(row=>row.id===campaign.data.campaign.id),true);
    const readReceipt=await request('/api/communications/campaigns/'+campaign.data.campaign.id+'/read',{method:'POST',cookie:parent,body:{}});
    assert.equal(readReceipt.response.status,200,readReceipt.text);
    const parentInboxAfterRead=await request('/api/communications/inbox',{cookie:parent});
    assert.ok(parentInboxAfterRead.data.find(row=>row.id===campaign.data.campaign.id).readAt);
    const scheduledAt=new Date(Date.now()+10*60*1000).toISOString();
    const scheduled=await request('/api/communications/campaigns',{method:'POST',cookie:teacher,body:{title:'Later update',message:'Scheduled provider test',audience:'parents',channels:['email'],scheduledAt}});
    assert.equal(scheduled.response.status,201,scheduled.text);
    assert.equal(scheduled.data.campaign.status,'scheduled');
    assert.equal(scheduled.data.campaign.deliveries.length,0);
    const template=await request('/api/communications/templates',{method:'POST',cookie:teacher,body:{name:'Reminder',title:'Reminder title',message:'Reminder body'}});
    assert.equal(template.response.status,201,template.text);

    const classCampaign=await request('/api/communications/campaigns',{method:'POST',cookie:teacher,body:{title:'Grade R update',message:'Class-only test',audience:'class',className:'Grade R',channels:['push']}});
    assert.equal(classCampaign.response.status,201,classCampaign.text);
    assert.deepEqual(classCampaign.data.campaign.deliveries.map(row=>row.recipient).sort(),['alpha-parent','alpha-teacher'],'Class campaign must exclude unrelated staff and management');

    console.log('School core upgrades test passed');
  } finally {
    await stop();
    await stopGateway();
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})().catch(async error=>{console.error(error);await stop().catch(()=>{});await stopGateway().catch(()=>{});process.exit(1);});