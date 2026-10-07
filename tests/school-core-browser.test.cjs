const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const root=path.resolve(__dirname,'..');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'little-feet-school-core-browser-'));
fs.symlinkSync(path.join(root,'node_modules'),path.join(fixture,'node_modules'),'junction');
for(const file of ['server.js','school-core-upgrades-server.js','advanced-school-operations-server.js','finance-automation-server.js','failover-mode.js','auth-crypto.js','backup.js','index.html','logo.png','logo-transparent.png','little-feet-mascot.jfif']){
  fs.copyFileSync(path.join(root,file),path.join(fixture,file));
}
fs.cpSync(path.join(root,'lib'),path.join(fixture,'lib'),{recursive:true});
fs.cpSync(path.join(root,'assets'),path.join(fixture,'assets'),{recursive:true});

const pin='BrowserCorePass1';
const pinHash=crypto.scryptSync(pin,'little-feet-pin-salt',64).toString('hex');
fs.writeFileSync(path.join(fixture,'littlefeet-replica.json'),JSON.stringify({
  schools:[{id:'core-school',name:'Core Browser School',status:'active'}],
  users:[
    {username:'core-admin',name:'Core Admin',role:'admin',pinHash,schoolId:'core-school',schoolName:'Core Browser School',verificationStatus:'Active'},
    {username:'core-parent',name:'Core Parent',role:'parent',pinHash,schoolId:'core-school',schoolName:'Core Browser School',verificationStatus:'Active',parentRelationshipStatus:'Administrator approved',linkedLearners:['Core Learner']}
  ],
  students:[{id:'core-learner',studentName:'Core Learner',className:'Grade R',schoolId:'core-school',schoolName:'Core Browser School'}],
  moduleRecords:{},attendance:[],directMessages:[],chatGroups:[],groupMessages:{}
}));

const port=19400+Math.floor(Math.random()*300);
const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['server.js'],{cwd:fixture,env:{...process.env,NODE_ENV:'test',PORT:String(port),LF_REPLICA_MODE:'1',LF_TEST_ALLOW_REPLICA_WRITES:'1'},stdio:['ignore','ignore','pipe']});
let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
let browser;
const stop=()=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  try{
    let ready=false;
    for(let i=0;i<120;i++){
      if(child.exitCode!==null)throw new Error('Fixture server exited: '+stderr);
      try{ready=(await fetch(origin+'/api/health')).ok;}catch{}
      if(ready)break;await wait(100);
    }
    assert.ok(ready,'School core browser fixture did not start: '+stderr);
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[],failedApi=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{if(response.url().startsWith(origin+'/api/')&&response.status()>=500)failedApi.push(response.status()+' '+response.url());});
    page.on('dialog',dialog=>dialog.accept());
    await page.goto(origin,{waitUntil:'domcontentloaded'});
    await page.locator('#loginUsername').fill('core-admin');
    await page.locator('#loginPin').fill(pin);
    await page.locator('#loginForm button[type="submit"]').click();
    await page.locator('#dashboardSection').waitFor({state:'visible'});

    for(const selector of ['#lfSubjectMarksCard','#lfReportCardMaker','#lfDisciplineCard','#lfAssetRegisterCard','#lfCommunicationHub','#lfGradeRSkillsCard','#lfDsdIncidentCard','#lfSmartAttendanceCard','#lfAdvancedEldaCard','#lfAftercareCard','#lfStaffRatioCard','#lfStaffClockCard','#lfDayCareCard','#lfMealsCard','#lfLearnerGroupsCard','#lfAdvancedAcademicAnalytics','#lfPickupQrCard','#lfCommunicationInboxCard','#lfStaffAdmissionsCard','#lfLearnerDocumentVault']){
      await page.locator(selector).waitFor({state:'attached'});
    }

    const openTab=async tabId=>{
      await page.evaluate(id=>{
        const button=[...document.querySelectorAll('.nav-btn')].find(node=>String(node.getAttribute('onclick')||'').includes("switchTab('"+id+"'"));
        window.switchTab(id,button||null);
      },tabId);
      await page.locator('#'+tabId).waitFor({state:'visible'});
    };

    await openTab('worksheetsTab');
    await page.locator('#lfSubjectMarkForm input[name="learnerName"]').fill('Core Learner');
    await page.locator('#lfSubjectMarkForm input[name="subject"]').fill('Mathematics');
    await page.locator('#lfSubjectMarkForm input[name="assessmentName"]').fill('Number work');
    await page.locator('#lfSubjectMarkForm input[name="term"]').fill('Term 4');
    await page.locator('#lfSubjectMarkForm input[name="score"]').fill('18');
    await page.locator('#lfSubjectMarkForm input[name="maximum"]').fill('20');
    await page.locator('#lfSubjectMarkForm button[type="submit"]').click();
    await assert.doesNotReject(async()=>page.locator('#lfSubjectMarksList').getByText('90%').first().waitFor({state:'visible'}));

    await openTab('reportsTab');
    await page.locator('#lfReportCardForm input[name="learnerName"]').fill('Core Learner');
    await page.locator('#lfReportCardForm input[name="term"]').fill('Term 4');
    await page.locator('#lfReportCardForm textarea[name="teacherComment"]').fill('Good progress');
    await page.locator('#lfReportCardForm input[name="promotionOutcome"]').fill('Progress');
    await page.locator('#lfReportCardForm button[type="submit"]').click();
    await page.locator('#lfReportCardList').getByText('Core Learner').first().waitFor({state:'visible'});

    await openTab('safeguardingTab');
    await page.locator('#lfDisciplineForm input[name="learnerName"]').fill('Core Learner');
    await page.locator('#lfDisciplineForm input[name="category"]').fill('Class conduct');
    await page.locator('#lfDisciplineForm textarea[name="details"]').fill('Needs a conduct note');
    await page.locator('#lfDisciplineForm input[name="points"]').fill('2');
    await page.locator('#lfDisciplineForm button[type="submit"]').click();
    await page.locator('#lfDisciplineList').getByText('Core Learner').first().waitFor({state:'visible'});

    await openTab('progressTab');
    assert.equal(await page.locator('#lfEldaAiAssist').isDisabled(),true,'AI assist must stay disabled when no approved provider is configured');

    await openTab('operationsTab');
    await page.locator('#lfAssetForm input[name="assetCode"]').fill('CORE-001');
    await page.locator('#lfAssetForm input[name="name"]').fill('Class tablet');
    await page.locator('#lfAssetForm input[name="location"]').fill('Grade R');
    await page.locator('#lfAssetForm button[type="submit"]').click();
    await page.locator('#lfAssetList').getByText('CORE-001').first().waitFor({state:'visible'});

    await openTab('progressTab');
    await page.locator('#lfGradeRForm input[name="learnerName"]').fill('Core Learner');
    await page.locator('#lfGradeRForm input[name="term"]').fill('Term 4');
    await page.locator('#lfGradeRForm select[name="rating"]').selectOption('3');
    await page.locator('#lfGradeRForm textarea[name="evidence"]').fill('Observed in class');
    await page.locator('#lfGradeRForm button[type="submit"]').click();
    await page.locator('#lfGradeRSummary').getByText('1 /').first().waitFor({state:'visible'});

    await openTab('careTab');
    await page.locator('#lfDsdIncidentForm input[name="learnerName"]').fill('Core Learner');
    await page.locator('#lfDsdIncidentForm input[name="incidentDate"]').fill('2026-10-07');
    await page.locator('#lfDsdIncidentForm input[name="incidentTime"]').fill('10:15');
    await page.locator('#lfDsdIncidentForm input[name="location"]').fill('Playground');
    await page.locator('#lfDsdIncidentForm input[name="incidentType"]').fill('Minor injury');
    await page.locator('#lfDsdIncidentForm textarea[name="description"]').fill('Learner tripped while playing.');
    await page.locator('#lfDsdIncidentForm input[name="bodyRegions"][value="left-leg"]').check();
    await page.locator('#lfDsdIncidentForm button[type="submit"]').click();
    await page.locator('#lfDsdIncidentList').getByText('Core Learner').first().waitFor({state:'visible'});

    await openTab('attendanceTab');
    await page.locator('#lfAttendanceSettings input[name="cutoffTime"]').fill('09:00');
    await page.locator('#lfAttendanceSettings input[name="autoAbsent"]').check();
    await page.locator('#lfAttendanceSettings input[name="remindStaff"]').check();
    await page.locator('#lfAttendanceSettings button[type="submit"]').click();
    await wait(150);
    assert.equal(await page.locator('#lfAttendanceSettings input[name="autoAbsent"]').isChecked(),true);
    assert.equal(await page.locator('#lfAttendanceSettings input[name="remindStaff"]').isChecked(),true);

    await openTab('engagementTab');
    assert.equal(await page.locator('#lfCommunicationHubMount #lfCommunicationHub').count(),1,'Campaign sender must be embedded inside Communication & Engagement');
    assert.equal(await page.locator('#engagementTab > #lfCommunicationHub').count(),0,'Campaign sender must not render as a separate top-level card');
    await page.locator('#lfCommunicationHub').getByText('Direct Message Campaigns').waitFor({state:'visible'});
    const classField=page.locator('#lfCampaignForm input[name="className"]');
    assert.equal(await classField.isHidden(),true,'Class name must stay hidden for broad audiences');
    await page.locator('#lfCampaignForm select[name="audience"]').selectOption('class');
    assert.equal(await classField.isVisible(),true,'Class name must appear for one-class campaigns');
    assert.equal(await classField.isEnabled(),true,'Class name must be enabled for one-class campaigns');
    await page.locator('#lfCampaignForm select[name="audience"]').selectOption('all');
    assert.equal(await classField.isHidden(),true,'Class name must hide again when class audience is not selected');
    assert.equal(await page.locator('#lfCampaignForm input[value="sms"]').isDisabled(),true,'SMS must not pretend to be ready without provider config');
    assert.equal(await page.locator('#lfCampaignForm input[value="push"]').isDisabled(),true,'Push must not pretend to be ready without provider config');
    assert.equal(await page.locator('#lfCampaignForm input[value="whatsapp"]').isDisabled(),true,'WhatsApp must not pretend to be ready without provider config');
    assert.equal(await page.locator('#lfCampaignForm input[name="scheduledAt"]').count(),1,'Campaigns must expose real schedule-for-later input');
    assert.equal(await page.locator('#lfCommunicationTemplateForm').count(),1,'Communication templates must be available');

    await openTab('operationsTab');
    await page.locator('#lfLearnerGroupForm input[name="name"]').fill('Browser Team');
    await page.locator('#lfLearnerGroupForm input[name="type"]').fill('Sport');
    await page.locator('#lfLearnerGroupForm button[type="submit"]').click();
    await page.locator('#lfLearnerGroupList').getByText('Browser Team').waitFor({state:'visible'});
    await page.locator('#lfDayCareForm input[name="childName"]').fill('Holiday Child');
    await page.locator('#lfDayCareForm input[name="className"]').fill('Holiday Group');
    await page.locator('#lfDayCareForm input[name="date"]').fill('2026-12-15');
    await page.locator('#lfDayCareForm input[name="rate"]').fill('0');
    await page.locator('#lfDayCareForm button[type="submit"]').click();
    await page.locator('#lfDayCareList').getByText('Holiday Child').waitFor({state:'visible'});

    await openTab('staffWorkTab');
    await page.locator('#lfStaffClockCard button[data-clock="clock_in"]').click();
    await page.waitForTimeout(150);

    await openTab('attendanceTab');
    await page.locator('#lfRefreshRatio').click();
    await page.locator('#lfRatioLive').waitFor({state:'visible'});

    assert.deepEqual(errors,[],'New school core UI must not throw browser errors: '+errors.join(' | '));
    assert.deepEqual(failedApi,[],'New school core UI must not produce server errors: '+failedApi.join(' | '));
    console.log('School core browser regression passed');
  }finally{
    if(browser)await browser.close();
    await stop();
    fs.rmSync(fixture,{recursive:true,force:true});
  }
})().catch(async error=>{console.error(error);if(browser)await browser.close().catch(()=>{});await stop();process.exitCode=1;});