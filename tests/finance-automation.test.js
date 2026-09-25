const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tmpRoot = path.join(root, 'tmp');
fs.mkdirSync(tmpRoot, { recursive: true });
const tmp = fs.mkdtempSync(path.join(tmpRoot, 'finance-automation-'));
const port = 7550 + Math.floor(Math.random() * 120);
const base = 'http://127.0.0.1:' + port;
const hash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');

for (const file of ['server.js','finance-automation-server.js','auth-crypto.js','backup.js']) {
  fs.copyFileSync(path.join(root, file), path.join(tmp, file));
}

const billing = prefix => ({
  pricing:{baseMonthly:500,bundles:{5:{costPrice:0,sellingPrice:50},20:{costPrice:0,sellingPrice:150},100:{costPrice:0,sellingPrice:500}},lateFeeEnabled:false,lateFee:0},
  payment:{method:'payment_link',paymentLink:'https://payments.example.test/'+prefix,accountName:'',bankName:'',accountNumberEncrypted:'',payMePayloadEncrypted:'',branchCode:'',referencePrefix:prefix},
  orders:[]
});

fs.writeFileSync(path.join(tmp, 'littlefeet-replica.json'), JSON.stringify({
  schools:[
    {id:'school-alpha',name:'Alpha School',status:'active'},
    {id:'school-bravo',name:'Bravo School',status:'active'}
  ],
  users:[
    {username:'alpha-admin',pinHash:hash('AdminPass1'),name:'Alpha Admin',role:'admin',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active'},
    {username:'alpha-principal',pinHash:hash('PrincipalPass1'),name:'Alpha Principal',role:'principal',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active'},
    {username:'alpha-teacher',pinHash:hash('TeacherPass1'),name:'Alpha Teacher',role:'teacher',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active'},
    {username:'alpha-parent',pinHash:hash('ParentPass1'),name:'Alpha Parent',role:'parent',schoolId:'school-alpha',schoolName:'Alpha School',verificationStatus:'Active',parentRelationshipStatus:'Administrator approved',linkedLearners:['Alpha Learner']},
    {username:'bravo-admin',pinHash:hash('BravoPass1'),name:'Bravo Admin',role:'admin',schoolId:'school-bravo',schoolName:'Bravo School',verificationStatus:'Active'},
    {username:'bravo-parent',pinHash:hash('ParentPass1'),name:'Bravo Parent',role:'parent',schoolId:'school-bravo',schoolName:'Bravo School',verificationStatus:'Active',parentRelationshipStatus:'Administrator approved',linkedLearners:['Bravo Learner']}
  ],
  students:[], moduleRecords:{}, directMessages:[], chatGroups:[], groupMessages:{},
  parentPayments:[], parentSubscriptions:[], paymentEvents:[], paymentLedger:[],
  financeRecurringRules:[], financeAdjustments:[], financeReconciliationRuns:[], payrollProfiles:[], payrollRuns:[],
  schoolBilling:{'school-alpha':billing('ALPHA'),'school-bravo':billing('BRAVO')}
}));

const child=spawn(process.execPath,['server.js'],{
  cwd:tmp,
  env:{...process.env,PORT:String(port),NODE_ENV:'test',LF_REPLICA_MODE:'1',LF_TEST_ALLOW_REPLICA_WRITES:'1'},
  stdio:['ignore','ignore','pipe']
});
let stderr=''; child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stop=()=>new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill();});

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
  const r=await request('/api/login',{method:'POST',body:{username,pin}});
  assert.equal(r.response.status,200,'login failed '+username+' '+r.text);
  return r.cookie;
}

(async()=>{
  try{
    for(let i=0;i<120;i+=1){
      try{if((await fetch(base+'/api/health')).ok)break;}catch{}
      if(i===119)throw new Error('Finance test server did not start. '+stderr);
      await wait(100);
    }

    const admin=await login('alpha-admin','AdminPass1');
    const principal=await login('alpha-principal','PrincipalPass1');
    const teacher=await login('alpha-teacher','TeacherPass1');
    const parent=await login('alpha-parent','ParentPass1');
    const bravoAdmin=await login('bravo-admin','BravoPass1');

    assert.equal((await request('/api/finance/automation',{cookie:admin})).response.status,200);
    assert.equal((await request('/api/finance/automation',{cookie:teacher})).response.status,403);
    assert.equal((await request('/api/finance/automation',{cookie:parent})).response.status,403);

    const rule=await request('/api/finance/recurring-rules',{
      method:'POST',cookie:principal,
      body:{name:'Monthly fees',parentUsername:'*',amount:400,dueDay:1,description:'School fees · {month}',learnerName:''}
    });
    assert.equal(rule.response.status,201);

    const firstRun=await request('/api/finance/recurring-runs',{method:'POST',cookie:principal,body:{force:true}});
    assert.equal(firstRun.response.status,201);
    assert.equal(firstRun.data.created.length,1);
    const invoice=firstRun.data.created[0];
    assert.equal(invoice.parentUsername,'alpha-parent');
    assert.equal(invoice.amountDue,400);

    const duplicateRun=await request('/api/finance/recurring-runs',{method:'POST',cookie:principal,body:{force:true}});
    assert.equal(duplicateRun.response.status,200);
    assert.equal(duplicateRun.data.created.length,0);
    assert.ok(duplicateRun.data.skipped.some(row=>row.reason==='Already generated for period'));

    const parentPayments=await request('/api/parent-payments',{cookie:parent});
    assert.equal(parentPayments.data.payments.length,1);
    assert.equal(parentPayments.data.summary.balance,400);

    const statementBefore=await request('/api/finance/statements?from=2020-01-01&to=2099-12-31&parentUsername=bravo-parent',{cookie:parent});
    assert.equal(statementBefore.response.status,200);
    assert.equal(statementBefore.data.parent.username,'alpha-parent');
    assert.equal(statementBefore.data.closingBalance,400);

    const crossSchoolAdjustment=await request('/api/finance/adjustments',{
      method:'POST',cookie:bravoAdmin,body:{paymentId:invoice.id,type:'credit',amount:10,reason:'Cross-school attempt'}
    });
    assert.equal(crossSchoolAdjustment.response.status,400);

    const payment=await request('/api/payments/reconcile',{
      method:'POST',cookie:principal,
      body:{eventId:'finance-part-payment',reference:invoice.reference,status:'paid',amount:150,bankReference:'BANK-150'}
    });
    assert.equal(payment.response.status,201);

    const overCredit=await request('/api/finance/adjustments',{
      method:'POST',cookie:principal,body:{paymentId:invoice.id,type:'credit',amount:251,reason:'Too much credit'}
    });
    assert.equal(overCredit.response.status,400);

    const credit=await request('/api/finance/adjustments',{
      method:'POST',cookie:principal,body:{paymentId:invoice.id,type:'credit',amount:100,reason:'Approved fee credit'}
    });
    assert.equal(credit.response.status,201);
    assert.equal(credit.data.payment.creditTotal,100);
    assert.equal(credit.data.payment.balance,150);

    const overRefund=await request('/api/finance/adjustments',{
      method:'POST',cookie:principal,body:{paymentId:invoice.id,type:'refund',amount:151,reason:'Too much refund'}
    });
    assert.equal(overRefund.response.status,400);

    const refund=await request('/api/finance/adjustments',{
      method:'POST',cookie:principal,body:{paymentId:invoice.id,type:'refund',amount:50,reason:'Approved refund',bankReference:'REF-50'}
    });
    assert.equal(refund.response.status,201);
    assert.equal(refund.data.payment.paidAmount,100);
    assert.equal(refund.data.payment.balance,200);

    const secondInvoice=await request('/api/parent-payments',{
      method:'POST',cookie:principal,
      body:{parentUsername:'alpha-parent',learnerName:'Alpha Learner',description:'Trip fee',amountDue:100,dueDate:'2026-09-25'}
    });
    assert.equal(secondInvoice.response.status,201);

    const lines=[
      {id:'bank-line-1',reference:secondInvoice.data.payment.reference,amount:100,date:'2026-09-25',bankReference:'AUTO-100',description:'Exact payment'},
      {id:'bank-line-2',reference:'NOT-A-REFERENCE',amount:75,date:'2026-09-25',bankReference:'FAKE-75',description:'Unknown'},
      {id:'bank-line-3',reference:invoice.reference,amount:999,date:'2026-09-25',bankReference:'BAD-AMOUNT',description:'Mismatch'},
      {id:'bank-line-4',reference:invoice.reference,amount:-5,date:'2026-09-25',bankReference:'NEGATIVE',description:'Invalid'}
    ];
    const preview=await request('/api/finance/reconciliation/preview',{method:'POST',cookie:principal,body:{lines}});
    assert.equal(preview.response.status,200);
    assert.equal(preview.data.counts.matched,1);
    assert.equal(preview.data.counts.unmatched,1);
    assert.equal(preview.data.counts.amount_mismatch,1);
    assert.equal(preview.data.counts.invalid,1);

    const apply=await request('/api/finance/reconciliation/apply',{method:'POST',cookie:principal,body:{lines}});
    assert.equal(apply.response.status,201);
    assert.equal(apply.data.run.appliedCount,1);
    assert.equal(apply.data.failed.length,0);

    const applyAgain=await request('/api/finance/reconciliation/apply',{method:'POST',cookie:principal,body:{lines}});
    assert.equal(applyAgain.response.status,201);
    assert.equal(applyAgain.data.run.appliedCount,0);

    const teacherProfileWrite=await request('/api/finance/payroll/profiles/alpha-teacher',{
      method:'PUT',cookie:teacher,body:{employeeNumber:'T-1',baseGross:10000,defaultAllowances:500,defaultDeductions:1000}
    });
    assert.equal(teacherProfileWrite.response.status,403);

    const crossSchoolProfile=await request('/api/finance/payroll/profiles/alpha-teacher',{
      method:'PUT',cookie:bravoAdmin,body:{employeeNumber:'T-1',baseGross:10000,defaultAllowances:500,defaultDeductions:1000}
    });
    assert.equal(crossSchoolProfile.response.status,404);

    const badProfile=await request('/api/finance/payroll/profiles/alpha-teacher',{
      method:'PUT',cookie:principal,body:{employeeNumber:'T-1',baseGross:100,defaultAllowances:0,defaultDeductions:101}
    });
    assert.equal(badProfile.response.status,400);

    const profile=await request('/api/finance/payroll/profiles/alpha-teacher',{
      method:'PUT',cookie:principal,body:{employeeNumber:'T-1',payFrequency:'monthly',baseGross:10000,defaultAllowances:500,defaultDeductions:1000,active:true}
    });
    assert.equal(profile.response.status,200);

    const payroll=await request('/api/finance/payroll/runs',{
      method:'POST',cookie:principal,
      body:{periodStart:'2026-09-01',periodEnd:'2026-09-30',payDate:'2026-09-25',note:'September payroll'}
    });
    assert.equal(payroll.response.status,201);
    assert.equal(payroll.data.run.totals.gross,10500);
    assert.equal(payroll.data.run.totals.deductions,1000);
    assert.equal(payroll.data.run.totals.net,9500);
    assert.match(payroll.data.run.complianceNote,/does not calculate PAYE, UIF, SDL/);

    const approved=await request('/api/finance/payroll/runs/'+payroll.data.run.id+'/approve',{method:'POST',cookie:principal,body:{}});
    assert.equal(approved.response.status,200);
    assert.equal(approved.data.run.status,'approved');
    const approvedAgain=await request('/api/finance/payroll/runs/'+payroll.data.run.id+'/approve',{method:'POST',cookie:principal,body:{}});
    assert.equal(approvedAgain.data.duplicate,true);

    const statementAfter=await request('/api/finance/statements?from=2020-01-01&to=2099-12-31&parentUsername=alpha-parent',{cookie:admin});
    assert.equal(statementAfter.response.status,200);
    assert.equal(statementAfter.data.closingBalance,200);
    assert.ok(statementAfter.data.rows.some(row=>row.type==='credit'));
    assert.ok(statementAfter.data.rows.some(row=>row.type==='refund'));

    const journal=await request('/api/finance/accounting-export?from=2020-01-01&to=2099-12-31',{cookie:principal});
    assert.equal(journal.response.status,200);
    assert.equal(journal.data.totalDebits,journal.data.totalCredits);
    assert.ok(journal.data.rows.some(row=>row.sourceType==='parent_invoice'));
    assert.ok(journal.data.rows.some(row=>row.sourceType==='credit_note'));
    assert.ok(journal.data.rows.some(row=>row.sourceType==='payment'));
    assert.ok(journal.data.rows.some(row=>row.sourceType==='payroll'));

    const overview=await request('/api/finance/automation',{cookie:principal});
    assert.equal(overview.data.counts.activeRecurringRules,1);
    assert.equal(overview.data.counts.payrollProfiles,1);
    assert.equal(overview.data.payrollRuns[0].status,'approved');
    assert.ok(overview.data.recentAdjustments.length>=2);
    assert.ok(overview.data.recentReconciliationRuns.length>=2);

    console.log('Finance automation regression test passed.');
  } catch(error){
    console.error(error);
    if(stderr)console.error(stderr);
    process.exitCode=1;
  } finally {
    await stop();
    fs.rmSync(tmp,{recursive:true,force:true});
  }
})();