const crypto = require('crypto');

const ELDA_AREAS = Object.freeze([
  'ELDA 1 · Well-being',
  'ELDA 2 · Identity and Belonging',
  'ELDA 3 · Communication',
  'ELDA 4 · Exploring Mathematics',
  'ELDA 5 · Creativity',
  'ELDA 6 · Knowledge and Understanding of the World'
]);

function registerAdvancedSchoolOperations(app, deps) {
  const {
    db, getSessionAccount, hasPlatformAccess, accountSchoolId, isSameSchool, recordInSchool, tagSchoolRecord,
    tenantRecords, normalizeUsername, normalizeComparableText, limitedText, boundedText, dateKeyInSouthAfrica,
    isParentLinkedToLearner, validDateKey, createParentPaymentRecord, logStructured
  } = deps;

  const collections = [
    'eldaSkillCatalogue','eldaAssessments','aftercareSettings','aftercarePlans','aftercareSessions',
    'staffClockSessions','staffRatioSettings','dayCareBookings','dayCareCapacitySettings',
    'mealPlans','dietaryProfiles','learnerGroups','pickupPasses','academicAnalyticsSettings','schoolGroups'
  ];
  collections.forEach(name => { if (!Array.isArray(db[name])) db[name] = []; });

  const nowIso = () => new Date().toISOString();
  const staffActor = req => {
    const actor = getSessionAccount(req);
    return actor && (hasPlatformAccess(actor) || ['teacher','principal','admin','staff','school_accounts'].includes(actor.role)) ? actor : null;
  };
  const managementActor = req => {
    const actor = getSessionAccount(req);
    return actor && (hasPlatformAccess(actor) || ['principal','admin','staff','school_accounts'].includes(actor.role)) ? actor : null;
  };
  const parentActor = req => {
    const actor = getSessionAccount(req);
    return actor?.role === 'parent' ? actor : null;
  };
  const schoolRecords = (name, actor) => tenantRecords(db[name] || [], actor);
  const schoolLearners = actor => tenantRecords(db.students || [], actor);
  const findLearner = (actor, name) => schoolLearners(actor).find(row => normalizeComparableText(row.studentName) === normalizeComparableText(name));
  const parentCanSee = (actor, learner) => actor?.role === 'parent' && learner && isParentLinkedToLearner(actor, learner);
  const canSeeLearner = (actor, learner) => Boolean(actor && learner && (hasPlatformAccess(actor) || ['teacher','principal','admin','staff','school_accounts'].includes(actor.role) || parentCanSee(actor, learner)));
  const cleanMoney = value => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && n <= 1000000 ? Math.round(n * 100) / 100 : null;
  };
  const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
  const minutesFromTime = value => {
    const [h,m] = String(value || '').split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const safeDate = value => validDateKey(value) || '';
  const findParentForLearner = (actor, learnerName) => (db.users || []).find(account =>
    account.role === 'parent' && isSameSchool(actor, account) &&
    (account.linkedLearners || []).some(name => normalizeComparableText(name) === normalizeComparableText(learnerName))
  );

  // ELDA catalogue + assessment engine. Catalogue is importable so Little Feet can
  // lawfully load an official/licensed full catalogue without copying a competitor's database.
  app.get('/api/elda/areas',(req,res)=>{
    const actor=getSessionAccount(req); if(!actor)return res.status(401).json({message:'Sign in to view ELDA areas.'});
    res.json(ELDA_AREAS.map((label,index)=>({id:'ELDA-'+(index+1),label})));
  });
  app.get('/api/elda/catalogue',(req,res)=>{
    const actor=staffActor(req)||parentActor(req);if(!actor)return res.status(403).json({message:'School access is required.'});
    const rows=schoolRecords('eldaSkillCatalogue',actor);
    res.json({skills:rows,total:rows.length,capacity:964,complete:rows.length>=964,sourceRequired:rows.length<964});
  });
  app.post('/api/elda/catalogue/import',(req,res)=>{
    const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});
    const rows=Array.isArray(req.body?.rows)?req.body.rows:[];
    if(!rows.length||rows.length>2000)return res.status(400).json({message:'Import between 1 and 2000 ELDA skill rows.'});
    let created=0,updated=0;
    for(const input of rows){
      const code=limitedText(input?.code,80),label=limitedText(input?.label,500),area=limitedText(input?.area,120);
      const ageBand=boundedText(input?.ageBand,80),phase=boundedText(input?.phase,80),source=boundedText(input?.source,240);
      if(!code||!label||!ELDA_AREAS.includes(area)||!source)continue;
      let row=schoolRecords('eldaSkillCatalogue',actor).find(item=>normalizeComparableText(item.code)===normalizeComparableText(code));
      if(row){Object.assign(row,{label,area,ageBand,phase,source,updatedAt:nowIso(),updatedBy:actor.username});updated++;}
      else{row=tagSchoolRecord(actor,{id:crypto.randomUUID(),code,label,area,ageBand,phase,source,createdAt:nowIso(),createdBy:actor.username});db.eldaSkillCatalogue.push(row);created++;}
    }
    res.status(201).json({success:true,created,updated,total:schoolRecords('eldaSkillCatalogue',actor).length});
  });
  app.get('/api/elda/assessments',(req,res)=>{
    const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view ELDA assessments.'});
    let rows=schoolRecords('eldaAssessments',actor);
    if(actor.role==='parent') rows=rows.filter(row=>{const learner=findLearner(actor,row.learnerName);return parentCanSee(actor,learner);});
    const learner=boundedText(req.query?.learnerName,160);if(learner)rows=rows.filter(row=>normalizeComparableText(row.learnerName)===normalizeComparableText(learner));
    res.json(rows);
  });
  app.post('/api/elda/assessments',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
    const learner=findLearner(actor,req.body?.learnerName);if(!learner)return res.status(404).json({message:'Learner not found in this school.'});
    const skill=schoolRecords('eldaSkillCatalogue',actor).find(row=>row.id===req.body?.skillId);
    if(!skill)return res.status(400).json({message:'Choose a skill from the school ELDA catalogue.'});
    const rating=Number(req.body?.rating);if(!Number.isInteger(rating)||rating<1||rating>4)return res.status(400).json({message:'Rating must be 1 to 4.'});
    const row=tagSchoolRecord(actor,{id:crypto.randomUUID(),learnerName:learner.studentName,skillId:skill.id,skillCode:skill.code,skillLabel:skill.label,area:skill.area,rating,evidence:boundedText(req.body?.evidence,1600),observedAt:safeDate(req.body?.observedAt)||dateKeyInSouthAfrica(),createdAt:nowIso(),createdBy:actor.username});
    db.eldaAssessments.unshift(row);res.status(201).json({success:true,assessment:row});
  });
  app.get('/api/elda/summary/:learnerName',(req,res)=>{
    const actor=getSessionAccount(req),learner=actor&&findLearner(actor,req.params.learnerName);
    if(!actor||!canSeeLearner(actor,learner))return res.status(403).json({message:'You cannot view this learner.'});
    const catalogue=schoolRecords('eldaSkillCatalogue',actor),assessments=schoolRecords('eldaAssessments',actor).filter(row=>normalizeComparableText(row.learnerName)===normalizeComparableText(learner.studentName));
    const latest=new Map();assessments.forEach(row=>{if(!latest.has(row.skillId))latest.set(row.skillId,row);});
    const areas={};ELDA_AREAS.forEach(area=>{const ids=catalogue.filter(s=>s.area===area).map(s=>s.id);const rated=ids.map(id=>latest.get(id)).filter(Boolean);areas[area]={skills:ids.length,assessed:rated.length,average:rated.length?Math.round(rated.reduce((a,b)=>a+Number(b.rating||0),0)/rated.length*10)/10:0};});
    res.json({learnerName:learner.studentName,catalogueSize:catalogue.length,assessedSkills:latest.size,areas});
  });

  // Aftercare plans, check-in/out and late-fee billing.
  const aftercareSetting = actor => {
    let row=schoolRecords('aftercareSettings',actor)[0];
    if(!row){row=tagSchoolRecord(actor,{id:crypto.randomUUID(),closeTime:'17:30',lateFeePer15Minutes:0,defaultDailyRate:0,updatedAt:nowIso()});db.aftercareSettings.unshift(row);}
    return row;
  };
  app.get('/api/aftercare/settings',(req,res)=>{const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});res.json(aftercareSetting(actor));});
  app.put('/api/aftercare/settings',(req,res)=>{
    const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});
    if(!validTime(req.body?.closeTime))return res.status(400).json({message:'Use a valid close time.'});
    const lateFee=cleanMoney(req.body?.lateFeePer15Minutes),rate=cleanMoney(req.body?.defaultDailyRate);if(lateFee===null||rate===null)return res.status(400).json({message:'Rates must be valid non-negative amounts.'});
    const row=aftercareSetting(actor);Object.assign(row,{closeTime:req.body.closeTime,lateFeePer15Minutes:lateFee,defaultDailyRate:rate,updatedAt:nowIso(),updatedBy:actor.username});res.json({success:true,settings:row});
  });
  app.get('/api/aftercare/plans',(req,res)=>{
    const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view aftercare plans.'});
    let rows=schoolRecords('aftercarePlans',actor);if(actor.role==='parent')rows=rows.filter(row=>{const learner=findLearner(actor,row.learnerName);return parentCanSee(actor,learner);});res.json(rows);
  });
  app.post('/api/aftercare/plans',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
    const learner=findLearner(actor,req.body?.learnerName);if(!learner)return res.status(404).json({message:'Learner not found.'});
    const type=['monthly','selected_days','adhoc','holiday'].includes(req.body?.planType)?req.body.planType:null;
    const days=Array.isArray(req.body?.days)?[...new Set(req.body.days.map(x=>boundedText(x,20)).filter(Boolean))].slice(0,31):[];
    const rate=req.body?.dailyRate==null||req.body.dailyRate===''?aftercareSetting(actor).defaultDailyRate:cleanMoney(req.body.dailyRate);
    if(!type||rate===null)return res.status(400).json({message:'Choose a plan type and valid daily rate.'});
    const row=tagSchoolRecord(actor,{id:crypto.randomUUID(),learnerName:learner.studentName,planType:type,days,dailyRate:rate,active:req.body?.active!==false,createdAt:nowIso(),createdBy:actor.username});db.aftercarePlans.unshift(row);res.status(201).json({success:true,plan:row});
  });
  app.get('/api/aftercare/sessions',(req,res)=>{
    const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view aftercare sessions.'});
    let rows=schoolRecords('aftercareSessions',actor);if(actor.role==='parent')rows=rows.filter(row=>{const learner=findLearner(actor,row.learnerName);return parentCanSee(actor,learner);});res.json(rows);
  });
  app.post('/api/aftercare/check-in',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
    const learner=findLearner(actor,req.body?.learnerName);if(!learner)return res.status(404).json({message:'Learner not found.'});
    const existing=schoolRecords('aftercareSessions',actor).find(row=>row.date===dateKeyInSouthAfrica()&&normalizeComparableText(row.learnerName)===normalizeComparableText(learner.studentName)&&!row.checkOutAt);
    if(existing)return res.status(409).json({message:'Learner is already checked into aftercare.'});
    const row=tagSchoolRecord(actor,{id:crypto.randomUUID(),learnerName:learner.studentName,date:dateKeyInSouthAfrica(),checkInAt:nowIso(),checkOutAt:'',lateMinutes:0,lateFee:0,billingStatus:'not_due',createdBy:actor.username});db.aftercareSessions.unshift(row);res.status(201).json({success:true,session:row});
  });
  app.post('/api/aftercare/sessions/:id/check-out',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
    const row=schoolRecords('aftercareSessions',actor).find(item=>item.id===req.params.id);if(!row)return res.status(404).json({message:'Aftercare session not found.'});if(row.checkOutAt)return res.status(409).json({message:'Learner is already checked out.'});
    row.checkOutAt=nowIso();const setting=aftercareSetting(actor);
    const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).split(':').map(Number);
    const late=Math.max(0,local[0]*60+local[1]-minutesFromTime(setting.closeTime));row.lateMinutes=late;row.lateFee=late?Math.ceil(late/15)*setting.lateFeePer15Minutes:0;row.billingStatus=row.lateFee>0?'pending':'not_due';
    if(row.lateFee>0){
      const parent=findParentForLearner(actor,row.learnerName);
      if(parent&&typeof createParentPaymentRecord==='function'){
        const due=new Date(Date.now()+7*86400000).toLocaleDateString('en-CA',{timeZone:'Africa/Johannesburg'});
        const result=createParentPaymentRecord({parentUsername:parent.username,learnerName:row.learnerName,description:'Aftercare late pickup fee · '+row.date,amountDue:row.lateFee,dueDate:due},actor);
        if(!result.error){db.parentPayments.unshift(result.record);row.billingStatus='invoice_created';row.parentPaymentId=result.record.id;}
        else{row.billingStatus='billing_pending_configuration';row.billingMessage=boundedText(result.error,240);}
      }
    }
    row.checkedOutBy=actor.username;res.json({success:true,session:row});
  });

  // Staff kiosk clocking + live ratio monitoring.
  app.get('/api/staff-clock',(req,res)=>{const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});res.json(schoolRecords('staffClockSessions',actor));});
  app.post('/api/staff-clock/action',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
    const action=['clock_in','clock_out','step_out','return'].includes(req.body?.action)?req.body.action:null;if(!action)return res.status(400).json({message:'Choose a valid clock action.'});
    const username=boundedText(req.body?.username||actor.username,160);const target=(db.users||[]).find(a=>normalizeUsername(a.username)===normalizeUsername(username)&&isSameSchool(actor,a));
    if(!target||!['teacher','principal','admin','staff','school_accounts'].includes(target.role))return res.status(404).json({message:'Staff account not found.'});
    if(normalizeUsername(target.username)!==normalizeUsername(actor.username)&&!managementActor(req))return res.status(403).json({message:'Only management can clock another staff member.'});
    let open=schoolRecords('staffClockSessions',actor).find(row=>normalizeUsername(row.username)===normalizeUsername(target.username)&&!row.clockOutAt);
    if(action==='clock_in'){if(open)return res.status(409).json({message:'Staff member is already clocked in.'});open=tagSchoolRecord(actor,{id:crypto.randomUUID(),username:target.username,name:target.name||target.username,date:dateKeyInSouthAfrica(),clockInAt:nowIso(),clockOutAt:'',breaks:[],status:'working'});db.staffClockSessions.unshift(open);}
    else{if(!open)return res.status(409).json({message:'Staff member is not clocked in.'});if(action==='clock_out'){open.clockOutAt=nowIso();open.status='complete';}else if(action==='step_out'){if(open.status==='stepped_out')return res.status(409).json({message:'Staff member is already stepped out.'});open.breaks.push({outAt:nowIso(),returnAt:''});open.status='stepped_out';}else{const br=[...open.breaks].reverse().find(x=>!x.returnAt);if(!br)return res.status(409).json({message:'No open step-out was found.'});br.returnAt=nowIso();open.status='working';}}
    open.updatedBy=actor.username;open.updatedAt=nowIso();res.json({success:true,session:open});
  });
  const ratioSetting=actor=>{let row=schoolRecords('staffRatioSettings',actor)[0];if(!row){row=tagSchoolRecord(actor,{id:crypto.randomUUID(),maxChildrenPerStaff:10,updatedAt:nowIso()});db.staffRatioSettings.unshift(row);}return row;};
  app.get('/api/staff-ratio/settings',(req,res)=>{const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});res.json(ratioSetting(actor));});
  app.put('/api/staff-ratio/settings',(req,res)=>{const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});const value=Number(req.body?.maxChildrenPerStaff);if(!Number.isInteger(value)||value<1||value>50)return res.status(400).json({message:'Ratio must be between 1 and 50 children per staff member.'});const row=ratioSetting(actor);row.maxChildrenPerStaff=value;row.updatedAt=nowIso();row.updatedBy=actor.username;res.json({success:true,settings:row});});
  app.get('/api/staff-ratio/live',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
    const today=dateKeyInSouthAfrica(),present=new Set(schoolRecords('attendance',actor).filter(r=>r.date===today&&normalizeComparableText(r.status)==='present').map(r=>normalizeComparableText(r.studentName)));
    const aftercare=new Set(schoolRecords('aftercareSessions',actor).filter(r=>r.date===today&&!r.checkOutAt).map(r=>normalizeComparableText(r.learnerName)));
    const children=new Set([...present,...aftercare]);const activeStaff=schoolRecords('staffClockSessions',actor).filter(r=>r.date===today&&!r.clockOutAt&&r.status==='working');
    const max=ratioSetting(actor).maxChildrenPerStaff,required=children.size?Math.ceil(children.size/max):0;
    res.json({date:today,children:children.size,activeStaff:activeStaff.length,maxChildrenPerStaff:max,requiredStaff:required,withinRatio:activeStaff.length>=required,shortfall:Math.max(0,required-activeStaff.length)});
  });

  // Temporary/day-care bookings with capacity and waiting list.
  const capacityFor=(actor,className,date)=>{const row=schoolRecords('dayCareCapacitySettings',actor).find(x=>normalizeComparableText(x.className)===normalizeComparableText(className)&&(!x.date||x.date===date));return row?.capacity||20;};
  app.get('/api/day-care/capacity',(req,res)=>{const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});res.json(schoolRecords('dayCareCapacitySettings',actor));});
  app.put('/api/day-care/capacity',(req,res)=>{const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});const className=limitedText(req.body?.className,120),date=req.body?.date?safeDate(req.body.date):'',capacity=Number(req.body?.capacity);if(!className||!Number.isInteger(capacity)||capacity<1||capacity>500||req.body?.date&&!date)return res.status(400).json({message:'Enter class, optional valid date and capacity 1–500.'});let row=schoolRecords('dayCareCapacitySettings',actor).find(x=>normalizeComparableText(x.className)===normalizeComparableText(className)&&String(x.date||'')===date);if(!row){row=tagSchoolRecord(actor,{id:crypto.randomUUID(),className,date,capacity,createdAt:nowIso()});db.dayCareCapacitySettings.push(row);}else row.capacity=capacity;row.updatedAt=nowIso();res.json({success:true,setting:row});});
  app.get('/api/day-care/bookings',(req,res)=>{const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view bookings.'});let rows=schoolRecords('dayCareBookings',actor);if(actor.role==='parent')rows=rows.filter(r=>normalizeUsername(r.parentUsername)===normalizeUsername(actor.username));res.json(rows);});
  app.post('/api/day-care/bookings',(req,res)=>{
    const actor=getSessionAccount(req);if(!actor||!(actor.role==='parent'||staffActor(req)))return res.status(403).json({message:'Parent or school staff access is required.'});
    const childName=limitedText(req.body?.childName,160),className=limitedText(req.body?.className,120),date=safeDate(req.body?.date),rate=cleanMoney(req.body?.rate||0);if(!childName||!className||!date||rate===null)return res.status(400).json({message:'Enter child, class, date and valid rate.'});
    const capacity=capacityFor(actor,className,date),confirmed=schoolRecords('dayCareBookings',actor).filter(r=>r.date===date&&normalizeComparableText(r.className)===normalizeComparableText(className)&&r.status==='confirmed').length;
    const status=confirmed>=capacity?'waitlisted':'confirmed';
    const row=tagSchoolRecord(actor,{id:crypto.randomUUID(),childName,className,date,rate,status,parentUsername:actor.role==='parent'?actor.username:boundedText(req.body?.parentUsername,160),extras:Array.isArray(req.body?.extras)?req.body.extras.map(x=>boundedText(x,120)).filter(Boolean).slice(0,20):[],createdAt:nowIso(),createdBy:actor.username});db.dayCareBookings.unshift(row);res.status(201).json({success:true,booking:row,capacity,confirmed});
  });
  app.patch('/api/day-care/bookings/:id',(req,res)=>{const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});const row=schoolRecords('dayCareBookings',actor).find(x=>x.id===req.params.id);if(!row)return res.status(404).json({message:'Booking not found.'});if(['confirmed','waitlisted','cancelled','attended'].includes(req.body?.status))row.status=req.body.status;row.updatedAt=nowIso();row.updatedBy=actor.username;res.json({success:true,booking:row});});

  // Meal planning + dietary requirements + kitchen counts.
  app.get('/api/meals/plans',(req,res)=>{const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});res.json(schoolRecords('mealPlans',actor));});
  app.post('/api/meals/plans',(req,res)=>{const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});const date=safeDate(req.body?.date),meal=limitedText(req.body?.meal,120),menu=limitedText(req.body?.menu,1200);if(!date||!meal||!menu)return res.status(400).json({message:'Enter date, meal and menu.'});const row=tagSchoolRecord(actor,{id:crypto.randomUUID(),date,meal,menu,notes:boundedText(req.body?.notes,1000),createdAt:nowIso(),createdBy:actor.username});db.mealPlans.unshift(row);res.status(201).json({success:true,plan:row});});
  app.get('/api/meals/dietary',(req,res)=>{const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view dietary profiles.'});let rows=schoolRecords('dietaryProfiles',actor);if(actor.role==='parent')rows=rows.filter(r=>{const learner=findLearner(actor,r.learnerName);return parentCanSee(actor,learner);});res.json(rows);});
  app.post('/api/meals/dietary',(req,res)=>{const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});const learner=findLearner(actor,req.body?.learnerName);if(!learner)return res.status(404).json({message:'Learner not found.'});let row=schoolRecords('dietaryProfiles',actor).find(r=>normalizeComparableText(r.learnerName)===normalizeComparableText(learner.studentName));const data={learnerName:learner.studentName,allergies:boundedText(req.body?.allergies,800),requirements:boundedText(req.body?.requirements,800),notes:boundedText(req.body?.notes,800),updatedAt:nowIso(),updatedBy:actor.username};if(row)Object.assign(row,data);else{row=tagSchoolRecord(actor,{id:crypto.randomUUID(),...data});db.dietaryProfiles.push(row);}res.status(201).json({success:true,profile:row});});
  app.get('/api/meals/kitchen-counts',(req,res)=>{const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});const date=safeDate(req.query?.date)||dateKeyInSouthAfrica();const names=new Set(schoolRecords('attendance',actor).filter(r=>r.date===date&&normalizeComparableText(r.status)==='present').map(r=>normalizeComparableText(r.studentName)));schoolRecords('dayCareBookings',actor).filter(r=>r.date===date&&['confirmed','attended'].includes(r.status)).forEach(r=>names.add(normalizeComparableText(r.childName)));const dietary=schoolRecords('dietaryProfiles',actor).filter(r=>names.has(normalizeComparableText(r.learnerName)));res.json({date,totalMeals:names.size,dietaryCount:dietary.length,dietary});});

  // Flexible learner groups.
  app.get('/api/learner-groups',(req,res)=>{const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});res.json(schoolRecords('learnerGroups',actor));});
  app.post('/api/learner-groups',(req,res)=>{const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});const name=limitedText(req.body?.name,160),type=limitedText(req.body?.type,80);if(!name||!type)return res.status(400).json({message:'Enter a group name and type.'});const row=tagSchoolRecord(actor,{id:crypto.randomUUID(),name,type,members:[],createdAt:nowIso(),createdBy:actor.username});db.learnerGroups.unshift(row);res.status(201).json({success:true,group:row});});
  app.post('/api/learner-groups/:id/members',(req,res)=>{const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});const group=schoolRecords('learnerGroups',actor).find(r=>r.id===req.params.id);if(!group)return res.status(404).json({message:'Group not found.'});const names=[...new Set((Array.isArray(req.body?.learnerNames)?req.body.learnerNames:[]).map(x=>boundedText(x,160)).filter(Boolean))];for(const name of names)if(!findLearner(actor,name))return res.status(404).json({message:'Learner not found: '+name});group.members=names;group.updatedAt=nowIso();group.updatedBy=actor.username;res.json({success:true,group});});
  app.delete('/api/learner-groups/:id',(req,res)=>{const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});const before=db.learnerGroups.length;db.learnerGroups=db.learnerGroups.filter(r=>!(r.id===req.params.id&&recordInSchool(r,actor)));if(db.learnerGroups.length===before)return res.status(404).json({message:'Group not found.'});res.json({success:true});});

  // Heavy academic analytics over the real subject-mark records.
  const analyticsSetting=actor=>{let row=schoolRecords('academicAnalyticsSettings',actor)[0];if(!row){row=tagSchoolRecord(actor,{id:crypto.randomUUID(),passMark:50,distinctionMark:80,updatedAt:nowIso()});db.academicAnalyticsSettings.unshift(row);}return row;};
  app.get('/api/academics/analytics/settings',(req,res)=>{const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});res.json(analyticsSetting(actor));});
  app.put('/api/academics/analytics/settings',(req,res)=>{const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});const pass=Number(req.body?.passMark),dist=Number(req.body?.distinctionMark);if(!Number.isFinite(pass)||!Number.isFinite(dist)||pass<0||pass>100||dist<pass||dist>100)return res.status(400).json({message:'Enter valid pass and distinction percentages.'});const row=analyticsSetting(actor);row.passMark=pass;row.distinctionMark=dist;row.updatedAt=nowIso();res.json({success:true,settings:row});});
  app.get('/api/academics/analytics',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
    let marks=schoolRecords('subjectMarks',actor);const term=boundedText(req.query?.term,80),year=Number(req.query?.year)||0,subject=boundedText(req.query?.subject,120);if(term)marks=marks.filter(r=>normalizeComparableText(r.term)===normalizeComparableText(term));if(year)marks=marks.filter(r=>Number(r.year)===year);if(subject)marks=marks.filter(r=>normalizeComparableText(r.subject)===normalizeComparableText(subject));
    const byLearner=new Map();for(const mark of marks){const key=mark.learnerName,arr=byLearner.get(key)||[];arr.push(mark);byLearner.set(key,arr);}
    const rows=[...byLearner.entries()].map(([learnerName,items])=>({learnerName,average:Math.round(items.reduce((a,b)=>a+Number(b.percentage||0),0)/items.length*10)/10,assessments:items.length})).sort((a,b)=>b.average-a.average);
    const set=analyticsSetting(actor);rows.forEach((r,i)=>{r.rank=i+1;r.outcome=r.average>=set.distinctionMark?'Distinction':r.average>=set.passMark?'Pass':'At risk';});
    const subjects={};for(const mark of marks){const key=mark.subject;const arr=subjects[key]||[];arr.push(Number(mark.percentage||0));subjects[key]=arr;}
    const subjectDistribution=Object.entries(subjects).map(([name,vals])=>({subject:name,average:Math.round(vals.reduce((a,b)=>a+b,0)/vals.length*10)/10,distinctions:vals.filter(v=>v>=set.distinctionMark).length,failures:vals.filter(v=>v<set.passMark).length,count:vals.length}));
    res.json({settings:set,learners:rows,subjectDistribution,distinctions:rows.filter(r=>r.outcome==='Distinction'),failures:rows.filter(r=>r.outcome==='At risk')});
  });

  // Parent QR pickup token. Only a hash is persisted; plaintext exists only in the creation response/QR.
  app.get('/api/pickup-passes',(req,res)=>{const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view pickup passes.'});let rows=schoolRecords('pickupPasses',actor);if(actor.role==='parent')rows=rows.filter(r=>normalizeUsername(r.parentUsername)===normalizeUsername(actor.username));res.json(rows.map(({tokenHash,...safe})=>safe));});
  app.post('/api/pickup-passes',(req,res)=>{
    const actor=parentActor(req)||managementActor(req);if(!actor)return res.status(403).json({message:'Parent or management access is required.'});
    const learner=findLearner(actor,req.body?.learnerName);if(!learner||actor.role==='parent'&&!parentCanSee(actor,learner))return res.status(403).json({message:'You cannot create a pickup pass for this learner.'});
    const token='LFP-'+crypto.randomBytes(18).toString('base64url');const expiresMinutes=Math.max(5,Math.min(720,Number(req.body?.expiresMinutes)||60));
    const row=tagSchoolRecord(actor,{id:crypto.randomUUID(),learnerName:learner.studentName,parentUsername:actor.role==='parent'?actor.username:boundedText(req.body?.parentUsername,160),collectorName:limitedText(req.body?.collectorName,160),tokenHash:crypto.createHash('sha256').update(token).digest('hex'),status:'active',createdAt:nowIso(),expiresAt:new Date(Date.now()+expiresMinutes*60000).toISOString(),createdBy:actor.username});db.pickupPasses.unshift(row);res.status(201).json({success:true,pass:{...row,tokenHash:undefined,token}});
  });
  app.post('/api/pickup-passes/redeem',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});const token=String(req.body?.token||'').trim();if(!token)return res.status(400).json({message:'Pickup token is required.'});const hash=crypto.createHash('sha256').update(token).digest('hex');const row=schoolRecords('pickupPasses',actor).find(r=>r.tokenHash===hash);if(!row)return res.status(404).json({message:'Pickup pass not found.'});if(row.status!=='active')return res.status(409).json({message:'Pickup pass has already been used or cancelled.'});if(Date.parse(row.expiresAt)<=Date.now()){row.status='expired';return res.status(410).json({message:'Pickup pass has expired.'});}row.status='used';row.usedAt=nowIso();row.usedBy=actor.username;res.json({success:true,pass:{id:row.id,learnerName:row.learnerName,collectorName:row.collectorName,status:row.status,usedAt:row.usedAt}});
  });

  // Cross-school owner dashboard is deliberately limited to platform-level users.
  app.get('/api/school-groups',(req,res)=>{const actor=getSessionAccount(req);if(!actor||!hasPlatformAccess(actor))return res.status(403).json({message:'Little Feet platform access is required.'});res.json(db.schoolGroups||[]);});
  app.post('/api/school-groups',(req,res)=>{const actor=getSessionAccount(req);if(!actor||!hasPlatformAccess(actor))return res.status(403).json({message:'Little Feet platform access is required.'});const name=limitedText(req.body?.name,160),schoolIds=[...new Set((Array.isArray(req.body?.schoolIds)?req.body.schoolIds:[]).map(String))];const known=new Set((db.schools||[]).map(s=>String(s.id)));if(!name||!schoolIds.length||schoolIds.some(id=>!known.has(id)))return res.status(400).json({message:'Enter a group name and valid school IDs.'});const row={id:crypto.randomUUID(),name,schoolIds,createdAt:nowIso(),createdBy:actor.username};db.schoolGroups.unshift(row);res.status(201).json({success:true,group:row});});
  app.get('/api/school-groups/:id/dashboard',(req,res)=>{const actor=getSessionAccount(req);if(!actor||!hasPlatformAccess(actor))return res.status(403).json({message:'Little Feet platform access is required.'});const group=(db.schoolGroups||[]).find(r=>r.id===req.params.id);if(!group)return res.status(404).json({message:'School group not found.'});const sites=group.schoolIds.map(id=>{const school=(db.schools||[]).find(s=>String(s.id)===String(id));const learners=(db.students||[]).filter(r=>String(r.schoolId)===String(id));const today=dateKeyInSouthAfrica();const present=(db.attendance||[]).filter(r=>String(r.schoolId)===String(id)&&r.date===today&&normalizeComparableText(r.status)==='present').length;const staff=(db.users||[]).filter(r=>String(r.schoolId)===String(id)&&['teacher','principal','admin','staff','school_accounts'].includes(r.role)).length;const bookings=(db.dayCareBookings||[]).filter(r=>String(r.schoolId)===String(id)&&r.date===today&&r.status==='confirmed').length;return {schoolId:id,schoolName:school?.name||id,learners:learners.length,presentToday:present,staff,dayCareBookingsToday:bookings};});res.json({group:{id:group.id,name:group.name},sites,totals:{learners:sites.reduce((a,b)=>a+b.learners,0),presentToday:sites.reduce((a,b)=>a+b.presentToday,0),staff:sites.reduce((a,b)=>a+b.staff,0)}});});

  logStructured?.('info','advanced_school_operations.registered',{category:'startup',result:'ready',details:'ELDA, aftercare, ratios, day care, meals, groups, analytics, pickup passes and multi-site routes registered'});
}

module.exports = { registerAdvancedSchoolOperations, ELDA_AREAS };
