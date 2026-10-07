const crypto = require('crypto');

const GRADE_R_SKILLS = Object.freeze([
  ...[
    'Listens attentively to short stories','Follows two-step oral instructions','Takes part in conversations','Takes turns when speaking',
    'Speaks in clear age-appropriate sentences','Retells a familiar story in order','Describes people, objects and events','Uses new vocabulary in context',
    'Asks and answers simple questions','Identifies rhyming words','Identifies beginning sounds','Identifies ending sounds',
    'Claps and counts syllables','Blends simple sounds orally','Segments simple words orally','Recognises own written name',
    'Recognises familiar labels and signs','Handles books correctly','Tracks print from left to right','Identifies book front, back and title',
    'Predicts a story from pictures','Sequences a picture story','Distinguishes pictures from print','Recognises familiar letters',
    'Links familiar letters to sounds','Forms basic pre-writing patterns','Uses a controlled pencil grip','Copies lines, curves and simple shapes',
    'Attempts to write own name','Draws to communicate meaning','Explains own drawing or early writing','Joins in songs and rhymes',
    'Uses language in dramatic play','Listens and responds in the home language'
  ].map((label,index)=>({id:'HL-'+String(index+1).padStart(2,'0'),subject:'Home Language',label})),
  ...[
    'Counts aloud from 1 to 10','Counts objects to 10 with one-to-one matching','Recognises numerals 1 to 10','Orders numerals 1 to 10',
    'Compares more, less and equal groups','Recognises small quantities without counting','Matches numerals to quantities','Solves simple addition stories with objects',
    'Solves simple subtraction stories with objects','Splits small quantities into parts','Copies and extends repeating patterns','Creates a simple repeating pattern',
    'Sorts objects by one feature','Sorts objects by two features','Explains how objects were grouped','Recognises circle, square, triangle and rectangle',
    'Describes simple shape features','Builds pictures and objects from shapes','Uses position words correctly','Follows simple direction words',
    'Compares object length','Compares object mass','Compares container capacity','Orders familiar daily events',
    'Shows awareness of days of the week','Reads a simple picture graph','Collects and sorts simple data','Compares groups on a simple graph',
    'Recognises simple symmetry','Counts forwards and backwards in a small range','Estimates a small group before counting','Shares and groups objects in practical problems'
  ].map((label,index)=>({id:'MATH-'+String(index+1).padStart(2,'0'),subject:'Mathematics',label})),
  ...[
    'Talks about own identity and interests','Names important family and community roles','Identifies common emotions','Uses simple calming strategies',
    'Shows growing independence','Follows personal hygiene routines','Washes hands correctly','Manages age-appropriate toilet routines',
    'Identifies healthy food choices','Explains why drinking water matters','Follows classroom safety rules','Uses basic road-safety rules',
    'Identifies trusted adults and unsafe stranger situations','Understands basic body privacy and boundaries','Seeks adult help when needed','Runs and jumps with control',
    'Balances with growing control','Throws and catches a large ball','Uses scissors with growing control','Threads and manipulates small objects',
    'Uses drawing and painting tools','Keeps a simple beat or rhythm','Takes part in movement and dance','Uses imagination in role play',
    'Plays cooperatively with others','Shares and takes turns','Uses simple ways to solve peer conflict','Shows respect for differences',
    'Cares for classroom and environment','Observes weather and seasonal change','Notices basic features of living things and nature','Follows classroom routines and responsibilities'
  ].map((label,index)=>({id:'LS-'+String(index+1).padStart(2,'0'),subject:'Life Skills',label}))
]);

const BODY_REGIONS = new Set([
  'head','face','neck','left-shoulder','right-shoulder','chest','abdomen','back',
  'left-arm','right-arm','left-hand','right-hand','left-leg','right-leg','left-foot','right-foot'
]);

function registerSchoolCoreUpgrades(app, deps) {
  const {
    db, getSessionAccount, hasPlatformAccess, accountSchoolId, isSameSchool, recordInSchool, tagSchoolRecord,
    tenantRecords, normalizeUsername, normalizeComparableText, limitedText, boundedText, dateKeyInSouthAfrica,
    isParentLinkedToLearner, sendLittleFeetEmail, looksLikeEmailAddress, safeHttpsUrl, validDateKey,
    validSignatureData, encryptField, decryptStoredField, validSecretLength, matchesPin, saveDatabaseState,
    scheduleReplicaSnapshot, logStructured, smtpEmailConfigured, apiEmailConfigured
  } = deps;

  const nowIso = () => new Date().toISOString();
  const staffActor = req => {
    const actor = getSessionAccount(req);
    return actor && (hasPlatformAccess(actor) || ['teacher','principal','admin','staff'].includes(actor.role)) ? actor : null;
  };
  const managementActor = req => {
    const actor = getSessionAccount(req);
    return actor && (hasPlatformAccess(actor) || ['principal','admin','staff'].includes(actor.role)) ? actor : null;
  };
  const communicationActor = req => {
    const actor = getSessionAccount(req);
    return actor && (hasPlatformAccess(actor) || ['teacher','principal','admin','staff','crm','support'].includes(actor.role)) ? actor : null;
  };
  const schoolRecords = (name, actor) => tenantRecords(db[name] || [], actor);
  const cleanNumber = (value, min, max) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  };
  const schoolLearners = actor => tenantRecords(db.students || [], actor);
  const findLearner = (actor, name) => schoolLearners(actor).find(row => normalizeComparableText(row.studentName) === normalizeComparableText(name));
  const parentCanSeeLearner = (actor, learner) => actor?.role === 'parent' && learner && isParentLinkedToLearner(actor, learner);
  const canSeeLearner = (actor, learner) => Boolean(actor && learner && (hasPlatformAccess(actor) || ['teacher','principal','admin','staff'].includes(actor.role) || parentCanSeeLearner(actor, learner)));
  const parentForLearner = (actor, learner) => (db.users || []).find(account =>
    account.role === 'parent' && isSameSchool(actor, account) && isParentLinkedToLearner(account, learner)
  );

  const weightedSubjectSummary = marks => {
    const groups = new Map();
    marks.forEach(mark => {
      const key = String(mark.subject || '').trim();
      if (!key) return;
      const group = groups.get(key) || { subject:key, weightedTotal:0, weightTotal:0, assessments:0 };
      const weight = Number(mark.weight) > 0 ? Number(mark.weight) : 1;
      group.weightedTotal += Number(mark.percentage || 0) * weight;
      group.weightTotal += weight;
      group.assessments += 1;
      groups.set(key, group);
    });
    return [...groups.values()].map(group => ({
      subject: group.subject,
      assessments: group.assessments,
      percentage: group.weightTotal ? Math.round((group.weightedTotal / group.weightTotal) * 100) / 100 : 0
    })).sort((a,b)=>a.subject.localeCompare(b.subject));
  };

  app.get('/api/academics/marks', (req,res) => {
    const actor = getSessionAccount(req);
    if (!actor) return res.status(401).json({message:'Sign in to view marks.'});
    let rows = schoolRecords('subjectMarks', actor);
    const learnerName = boundedText(req.query?.learnerName,160);
    if (learnerName) {
      const learner = findLearner(actor, learnerName);
      if (!canSeeLearner(actor, learner)) return res.status(403).json({message:'You cannot view that learner.'});
      rows = rows.filter(row => normalizeComparableText(row.learnerName) === normalizeComparableText(learnerName));
    } else if (actor.role === 'parent') {
      const allowed = new Set(schoolLearners(actor).filter(learner => parentCanSeeLearner(actor, learner)).map(learner => normalizeComparableText(learner.studentName)));
      rows = rows.filter(row => allowed.has(normalizeComparableText(row.learnerName)));
    }
    for (const key of ['subject','term','year']) if (req.query?.[key]) rows = rows.filter(row => String(row[key]) === String(req.query[key]));
    res.json({marks:rows, subjects:weightedSubjectSummary(rows)});
  });

  app.post('/api/academics/marks', (req,res) => {
    const actor = staffActor(req);
    if (!actor) return res.status(403).json({message:'Teacher or management access is required.'});
    const learnerName = limitedText(req.body?.learnerName,160);
    const learner = learnerName && findLearner(actor, learnerName);
    if (!learner) return res.status(404).json({message:'Choose a learner in your school.'});
    const subject = limitedText(req.body?.subject,120);
    const assessmentName = limitedText(req.body?.assessmentName,180);
    const term = limitedText(req.body?.term,60);
    const year = Math.trunc(Number(req.body?.year));
    const score = cleanNumber(req.body?.score,0,100000);
    const maximum = cleanNumber(req.body?.maximum,0.01,100000);
    const weight = cleanNumber(req.body?.weight ?? 1,0.01,100);
    if (!subject || !assessmentName || !term || !Number.isInteger(year) || year < 2000 || year > 2100 || score === null || maximum === null || score > maximum || weight === null) {
      return res.status(400).json({message:'Add a valid learner, subject, term, year, score, total and weight.'});
    }
    const record = tagSchoolRecord(actor,{
      id:crypto.randomUUID(), learnerName, learnerKey:learner.id || '', className:boundedText(learner.className,120),
      subject, assessmentName, term, year, score, maximum, weight,
      percentage:Math.round((score/maximum)*10000)/100,
      comment:boundedText(req.body?.comment,600), createdBy:actor.username, createdAt:nowIso(), updatedAt:nowIso(), revision:1
    });
    db.subjectMarks.unshift(record);
    db.markHistory.unshift(tagSchoolRecord(actor,{id:crypto.randomUUID(),markId:record.id,action:'created',changedBy:actor.username,changedAt:nowIso(),before:null,after:{...record}}));
    res.status(201).json({success:true,mark:record});
  });

  app.patch('/api/academics/marks/:id', (req,res) => {
    const actor = staffActor(req);
    const mark = actor && (db.subjectMarks || []).find(row => row.id === req.params.id && recordInSchool(row,actor));
    if (!mark) return res.status(404).json({message:'Mark record not found.'});
    const before = {...mark};
    const score = req.body?.score === undefined ? mark.score : cleanNumber(req.body.score,0,100000);
    const maximum = req.body?.maximum === undefined ? mark.maximum : cleanNumber(req.body.maximum,0.01,100000);
    const weight = req.body?.weight === undefined ? mark.weight : cleanNumber(req.body.weight,0.01,100);
    if (score === null || maximum === null || weight === null || score > maximum) return res.status(400).json({message:'Score, total or weight is not valid.'});
    for (const key of ['subject','assessmentName','term']) {
      if (req.body?.[key] === undefined) continue;
      const value=limitedText(req.body[key],key==='subject'?120:180);
      if(!value)return res.status(400).json({message:key+' cannot be blank.'});
      mark[key]=value;
    }
    if(req.body?.comment!==undefined)mark.comment=boundedText(req.body.comment,600);
    if (req.body?.year !== undefined) {
      const year = Math.trunc(Number(req.body.year));
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return res.status(400).json({message:'Year is not valid.'});
      mark.year = year;
    }
    mark.score=score; mark.maximum=maximum; mark.weight=weight; mark.percentage=Math.round((score/maximum)*10000)/100;
    mark.updatedAt=nowIso(); mark.revision=Number(mark.revision||1)+1;
    db.markHistory.unshift(tagSchoolRecord(actor,{id:crypto.randomUUID(),markId:mark.id,action:'updated',changedBy:actor.username,changedAt:nowIso(),before,after:{...mark}}));
    res.json({success:true,mark});
  });

  app.get('/api/academics/marks/:id/history', (req,res) => {
    const actor = staffActor(req);
    const mark = actor && (db.subjectMarks || []).find(row => row.id === req.params.id && recordInSchool(row,actor));
    if (!mark) return res.status(404).json({message:'Mark record not found.'});
    res.json(schoolRecords('markHistory',actor).filter(row=>row.markId===mark.id));
  });
  app.delete('/api/academics/marks/:id', (req,res) => {
    const actor=staffActor(req);
    const index=actor?(db.subjectMarks||[]).findIndex(row=>row.id===req.params.id&&recordInSchool(row,actor)):-1;
    if(index<0)return res.status(404).json({message:'Mark record not found.'});
    const [mark]=db.subjectMarks.splice(index,1);
    db.markHistory.unshift(tagSchoolRecord(actor,{id:crypto.randomUUID(),markId:mark.id,action:'deleted',changedBy:actor.username,changedAt:nowIso(),before:{...mark},after:null}));
    res.json({success:true,mark});
  });

  const reportViewAllowed = (actor, report) => {
    if (!actor || !report || !recordInSchool(report,actor)) return false;
    if (hasPlatformAccess(actor) || ['teacher','principal','admin','staff'].includes(actor.role)) return true;
    const learner = findLearner(actor, report.learnerName);
    return parentCanSeeLearner(actor,learner);
  };
  const buildReport = (actor, learner, body) => {
    const year = Math.trunc(Number(body?.year));
    const term = limitedText(body?.term,60);
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !term) return {error:'Choose a valid year and term.'};
    const periodStart=validDateKey(body?.periodStart)||'',periodEnd=validDateKey(body?.periodEnd)||'';
    if((periodStart&&!periodEnd)||(!periodStart&&periodEnd)|| (periodStart&&periodEnd&&periodStart>periodEnd)) return {error:'Choose both report start and end dates, with the start before the end.'};
    const marks = schoolRecords('subjectMarks',actor).filter(row => normalizeComparableText(row.learnerName)===normalizeComparableText(learner.studentName) && Number(row.year)===year && String(row.term)===term);
    const subjects = weightedSubjectSummary(marks);
    const average = subjects.length ? Math.round((subjects.reduce((sum,row)=>sum+row.percentage,0)/subjects.length)*100)/100 : 0;
    const inReportDates=value=>{const key=String(value||'').slice(0,10);return periodStart&&periodEnd?key>=periodStart&&key<=periodEnd:key.startsWith(String(year));};
    const attendance = schoolRecords('attendance',actor).filter(row => normalizeComparableText(row.studentName)===normalizeComparableText(learner.studentName) && inReportDates(row.date||row.createdAt));
    const attendanceSummary = attendance.reduce((out,row)=>{const key=String(row.status||'Present');out[key]=(out[key]||0)+1;return out;},{});
    const discipline = schoolRecords('disciplineRecords',actor).filter(row => normalizeComparableText(row.learnerName)===normalizeComparableText(learner.studentName) && inReportDates(row.createdAt));
    const disciplinePoints = discipline.reduce((sum,row)=>sum+Number(row.pointDelta||0),0);
    return {year,term,periodStart,periodEnd,subjects,average,attendanceSummary,disciplinePoints};
  };

  app.get('/api/academics/report-cards', (req,res) => {
    const actor=getSessionAccount(req);
    if(!actor) return res.status(401).json({message:'Sign in to view report cards.'});
    res.json(schoolRecords('reportCards',actor).filter(row=>reportViewAllowed(actor,row)));
  });

  app.post('/api/academics/report-cards', (req,res) => {
    const actor=staffActor(req);
    if(!actor) return res.status(403).json({message:'Teacher or management access is required.'});
    const learnerName=limitedText(req.body?.learnerName,160), learner=learnerName&&findLearner(actor,learnerName);
    if(!learner) return res.status(404).json({message:'Choose a learner in your school.'});
    const built=buildReport(actor,learner,req.body);
    if(built.error) return res.status(400).json({message:built.error});
    const record=tagSchoolRecord(actor,{
      id:crypto.randomUUID(), learnerName, learnerKey:learner.id||'', className:boundedText(learner.className,120),
      ...built, teacherComment:boundedText(req.body?.teacherComment,2000), promotionOutcome:boundedText(req.body?.promotionOutcome,120),
      parentUsername:parentForLearner(actor,learner)?.username || '',
      createdBy:actor.username, createdAt:nowIso(), updatedAt:nowIso(), status:'Generated'
    });
    db.reportCards.unshift(record);
    res.status(201).json({success:true,reportCard:record});
  });

  app.get('/api/academics/report-cards/:id/print', (req,res) => {
    const actor=getSessionAccount(req);
    const report=actor&&(db.reportCards||[]).find(row=>row.id===req.params.id&&reportViewAllowed(actor,row));
    if(!report) return res.status(404).send('Report card not found.');
    const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const subjects=(report.subjects||[]).map(row=>'<tr><td>'+esc(row.subject)+'</td><td>'+esc(row.assessments)+'</td><td>'+esc(row.percentage)+'%</td></tr>').join('');
    res.setHeader('Cache-Control','private, no-store');
    res.type('html').send('<!doctype html><html><head><meta charset="utf-8"><title>Little Feet report card</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#102a43}h1{margin-bottom:4px}table{border-collapse:collapse;width:100%;margin:18px 0}td,th{border:1px solid #b8c8d8;padding:8px;text-align:left}.meta{color:#52677a}.box{border:1px solid #b8c8d8;padding:12px;margin-top:14px}@media print{button{display:none}}</style></head><body><h1>Little Feet Report Card</h1><div class="meta">'+esc(report.schoolName||'')+'</div><h2>'+esc(report.learnerName)+'</h2><p>'+esc(report.className||'')+' · '+esc(report.term)+' '+esc(report.year)+'</p><table><thead><tr><th>Subject</th><th>Assessments</th><th>Result</th></tr></thead><tbody>'+subjects+'</tbody></table><p><strong>Overall:</strong> '+esc(report.average)+'%</p><div class="box"><strong>Teacher comment</strong><p>'+esc(report.teacherComment||'')+'</p></div><div class="box"><strong>Promotion / progression</strong><p>'+esc(report.promotionOutcome||'Not recorded')+'</p></div><div class="box"><strong>Attendance</strong><pre>'+esc(JSON.stringify(report.attendanceSummary||{},null,2))+'</pre></div><button onclick="window.print()">Print / Save PDF</button></body></html>');
  });
  app.post('/api/academics/report-cards/:id/email', async (req,res,next) => {
    const actor=staffActor(req);
    const report=actor&&(db.reportCards||[]).find(row=>row.id===req.params.id&&recordInSchool(row,actor));
    if(!report)return res.status(404).json({message:'Report card not found.'});
    const learner=findLearner(actor,report.learnerName);
    const parent=learner&&parentForLearner(actor,learner);
    const to=parent&&[parent.email,parent.username,...(parent.loginAliases||[])].find(looksLikeEmailAddress);
    if(!to)return res.status(409).json({message:'No linked parent email is available for this learner.'});
    if(!(smtpEmailConfigured?.()||apiEmailConfigured?.()))return res.status(409).json({message:'Email delivery is not configured. Nothing was marked as sent.'});
    try{
      const subject='Little Feet report card · '+report.learnerName+' · '+report.term+' '+report.year;
      const lines=(report.subjects||[]).map(row=>row.subject+': '+row.percentage+'%').join('\n');
      const sent=await sendLittleFeetEmail({to,subject,text:[subject,'',lines,'','Overall: '+report.average+'%','Teacher comment: '+(report.teacherComment||''),'Promotion / progression: '+(report.promotionOutcome||'Not recorded'),'','Sign in to Little Feet to review the full record.'].join('\n')});
      if(!sent)return res.status(502).json({message:'The email provider did not accept the report card. Nothing was marked as sent.'});
      report.lastEmailedAt=nowIso();report.lastEmailedTo=to;report.updatedAt=nowIso();
      res.json({success:true,sentTo:to,sentAt:report.lastEmailedAt});
    }catch(error){next(error);}
  });

  const disciplineSettingsFor = actor => {
    let item=schoolRecords('disciplineSettings',actor)[0];
    if(!item){
      item=tagSchoolRecord(actor,{id:crypto.randomUUID(),warning:10,parentMeeting:20,principalReview:30,updatedAt:nowIso()});
      db.disciplineSettings.unshift(item);
    }
    return item;
  };
  app.get('/api/discipline/settings',(req,res)=>{
    const actor=staffActor(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
    res.json(disciplineSettingsFor(actor));
  });
  app.put('/api/discipline/settings',(req,res)=>{
    const actor=managementActor(req); if(!actor)return res.status(403).json({message:'Management access is required.'});
    const values=['warning','parentMeeting','principalReview'].map(key=>Math.trunc(Number(req.body?.[key])));
    if(values.some(value=>!Number.isInteger(value)||value<1||value>999)||!(values[0]<values[1]&&values[1]<values[2])) return res.status(400).json({message:'Use three increasing point limits.'});
    const item=disciplineSettingsFor(actor);
    [item.warning,item.parentMeeting,item.principalReview]=values; item.updatedAt=nowIso(); item.updatedBy=actor.username;
    res.json({success:true,settings:item});
  });
  app.get('/api/discipline',(req,res)=>{
    const actor=getSessionAccount(req); if(!actor)return res.status(401).json({message:'Sign in to view discipline records.'});
    let rows=schoolRecords('disciplineRecords',actor);
    if(actor.role==='parent') {
      const allowed=new Set(schoolLearners(actor).filter(learner=>parentCanSeeLearner(actor,learner)).map(learner=>normalizeComparableText(learner.studentName)));
      rows=rows.filter(row=>allowed.has(normalizeComparableText(row.learnerName)) && row.parentVisible!==false);
    }
    if(req.query?.learnerName) rows=rows.filter(row=>normalizeComparableText(row.learnerName)===normalizeComparableText(req.query.learnerName));
    res.json(rows);
  });
  app.post('/api/discipline',async(req,res,next)=>{
    const actor=staffActor(req); if(!actor)return res.status(403).json({message:'Teacher or management access is required.'});
    const learnerName=limitedText(req.body?.learnerName,160), learner=learnerName&&findLearner(actor,learnerName);
    if(!learner)return res.status(404).json({message:'Choose a learner in your school.'});
    const kind=['merit','demerit'].includes(req.body?.kind)?req.body.kind:null;
    const points=cleanNumber(req.body?.points,1,100);
    const category=limitedText(req.body?.category,120), details=limitedText(req.body?.details,1600);
    if(!kind||points===null||!category||!details)return res.status(400).json({message:'Add type, points, category and details.'});
    const record=tagSchoolRecord(actor,{id:crypto.randomUUID(),learnerName,learnerKey:learner.id||'',className:boundedText(learner.className,120),kind,points,pointDelta:kind==='demerit'?points:-points,category,details,actionTaken:boundedText(req.body?.actionTaken,1000),parentNotified:Boolean(req.body?.parentNotified),parentVisible:req.body?.parentVisible!==false,parentNotificationStatus:'not_requested',recordedBy:actor.username,createdAt:nowIso(),status:'Open'});
    db.disciplineRecords.unshift(record);
    const all=schoolRecords('disciplineRecords',actor).filter(row=>normalizeComparableText(row.learnerName)===normalizeComparableText(learnerName));
    const total=all.reduce((sum,row)=>sum+Number(row.pointDelta||0),0), settings=disciplineSettingsFor(actor);
    const action=total>=settings.principalReview?'Principal review':total>=settings.parentMeeting?'Parent meeting':total>=settings.warning?'Warning':'Normal';
    record.requiredAction=action;
    if(record.parentNotified){
      const parent=parentForLearner(actor,learner),to=parent&&[parent.email,parent.username,...(parent.loginAliases||[])].find(looksLikeEmailAddress);
      if(!to) record.parentNotificationStatus='no_parent_email';
      else if(!(smtpEmailConfigured?.()||apiEmailConfigured?.())) record.parentNotificationStatus='email_not_configured';
      else {
        try{
          record.parentNotificationStatus=(await sendLittleFeetEmail({
            to,subject:'Little Feet conduct update · '+learnerName,
            text:[learnerName+' has a new school conduct record.','Type: '+kind,'Category: '+category,'Points: '+points,'Action: '+(record.actionTaken||'No action recorded'),'','Sign in to Little Feet to view the record.'].join('\n')
          }))?'sent':'provider_rejected';
          if(record.parentNotificationStatus==='sent')record.parentNotifiedAt=nowIso();
        }catch(error){
          record.parentNotificationStatus='failed';
          logStructured?.('warn','discipline.parent_notification_failed',{category:'discipline',schoolId:accountSchoolId(actor),message:error.message});
        }
      }
    }
    res.status(201).json({success:true,record,totalPoints:total,action});
  });
  app.get('/api/discipline/:id/print',(req,res)=>{
    const actor=getSessionAccount(req),row=actor&&(db.disciplineRecords||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
    if(!row)return res.status(404).send('Discipline record not found.');
    const learner=findLearner(actor,row.learnerName);
    if(!(hasPlatformAccess(actor)||['teacher','principal','admin','staff'].includes(actor.role)||parentCanSeeLearner(actor,learner)))return res.status(403).send('Not allowed.');
    const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    res.setHeader('Cache-Control','private, no-store');
    res.type('html').send('<!doctype html><html><head><meta charset="utf-8"><title>Little Feet conduct record</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#102a43}.box{border:1px solid #b8c8d8;padding:14px;margin:12px 0}@media print{button{display:none}}</style></head><body><h1>Learner Conduct Record</h1><p><strong>'+esc(row.learnerName)+'</strong> · '+esc(row.className||'')+'</p><div class="box"><strong>'+esc(row.kind)+' · '+esc(row.category)+'</strong><p>'+esc(row.details)+'</p><p>Points: '+esc(row.points)+' · Required action: '+esc(row.requiredAction||'Normal')+'</p></div><div class="box"><strong>Action taken</strong><p>'+esc(row.actionTaken||'Not recorded')+'</p></div><p>Parent notice: '+esc(row.parentNotificationStatus||'not requested')+'</p><p>Recorded by '+esc(row.recordedBy)+' on '+esc(row.createdAt)+'</p><button onclick="window.print()">Print / Save PDF</button></body></html>');
  });

  app.patch('/api/discipline/:id',(req,res)=>{
    const actor=staffActor(req), row=actor&&(db.disciplineRecords||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
    if(!row)return res.status(404).json({message:'Discipline record not found.'});
    for(const key of ['actionTaken','status']) if(req.body?.[key]!==undefined) row[key]=boundedText(req.body[key],1000);
    if(req.body?.parentNotified!==undefined) row.parentNotified=Boolean(req.body.parentNotified);
    row.updatedAt=nowIso(); row.updatedBy=actor.username;
    res.json({success:true,record:row});
  });

  app.get('/api/assets',(req,res)=>{
    const actor=staffActor(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
    res.json(schoolRecords('assetRegister',actor));
  });
  app.post('/api/assets',(req,res)=>{
    const actor=managementActor(req); if(!actor)return res.status(403).json({message:'Management access is required.'});
    const assetCode=limitedText(req.body?.assetCode,80), name=limitedText(req.body?.name,180);
    if(!assetCode||!name)return res.status(400).json({message:'Asset code and name are required.'});
    if(schoolRecords('assetRegister',actor).some(row=>normalizeComparableText(row.assetCode)===normalizeComparableText(assetCode))) return res.status(409).json({message:'That asset code already exists.'});
    const record=tagSchoolRecord(actor,{id:crypto.randomUUID(),assetCode,name,category:boundedText(req.body?.category,100),location:boundedText(req.body?.location,160),supplier:boundedText(req.body?.supplier,160),serialNumber:boundedText(req.body?.serialNumber,160),purchaseDate:validDateKey(req.body?.purchaseDate)||'',purchaseValue:cleanNumber(req.body?.purchaseValue,0,100000000)??0,condition:boundedText(req.body?.condition||'Good',80),status:boundedText(req.body?.status||'In service',80),notes:boundedText(req.body?.notes,1000),createdBy:actor.username,createdAt:nowIso(),updatedAt:nowIso()});
    db.assetRegister.unshift(record); res.status(201).json({success:true,asset:record});
  });
  app.patch('/api/assets/:id',(req,res)=>{
    const actor=managementActor(req), row=actor&&(db.assetRegister||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
    if(!row)return res.status(404).json({message:'Asset not found.'});
    for(const key of ['name','category','location','supplier','serialNumber','condition','status','notes']) if(req.body?.[key]!==undefined) row[key]=boundedText(req.body[key],key==='notes'?1000:180);
    if(req.body?.purchaseDate!==undefined) row.purchaseDate=validDateKey(req.body.purchaseDate)||'';
    if(req.body?.purchaseValue!==undefined){const value=cleanNumber(req.body.purchaseValue,0,100000000);if(value===null)return res.status(400).json({message:'Purchase value is not valid.'});row.purchaseValue=value;}
    row.updatedAt=nowIso(); row.updatedBy=actor.username; res.json({success:true,asset:row});
  });
  app.delete('/api/assets/:id',(req,res)=>{
    const actor=managementActor(req), index=actor?(db.assetRegister||[]).findIndex(item=>item.id===req.params.id&&recordInSchool(item,actor)):-1;
    if(index<0)return res.status(404).json({message:'Asset not found.'});
    const [removed]=db.assetRegister.splice(index,1); res.json({success:true,asset:removed});
  });
  app.post('/api/assets/import',(req,res)=>{
    const actor=managementActor(req); if(!actor)return res.status(403).json({message:'Management access is required.'});
    const rows=Array.isArray(req.body?.rows)?req.body.rows:[];
    if(!rows.length||rows.length>500)return res.status(400).json({message:'Import between 1 and 500 assets.'});
    let created=0,skipped=0;
    for(const raw of rows){
      const assetCode=limitedText(raw.assetCode||raw.code,80), name=limitedText(raw.name,180);
      if(!assetCode||!name||schoolRecords('assetRegister',actor).some(row=>normalizeComparableText(row.assetCode)===normalizeComparableText(assetCode))){skipped++;continue;}
      db.assetRegister.unshift(tagSchoolRecord(actor,{id:crypto.randomUUID(),assetCode,name,category:boundedText(raw.category,100),location:boundedText(raw.location,160),supplier:boundedText(raw.supplier,160),serialNumber:boundedText(raw.serialNumber,160),purchaseDate:validDateKey(raw.purchaseDate)||'',purchaseValue:cleanNumber(raw.purchaseValue,0,100000000)??0,condition:boundedText(raw.condition||'Good',80),status:boundedText(raw.status||'In service',80),notes:boundedText(raw.notes,1000),createdBy:actor.username,createdAt:nowIso(),updatedAt:nowIso(),source:'import'}));created++;
    }
    res.status(201).json({success:true,created,skipped});
  });

  app.get('/api/grade-r/skills',(req,res)=>{
    const actor=getSessionAccount(req); if(!actor)return res.status(401).json({message:'Sign in to view Grade R skills.'});
    res.json(GRADE_R_SKILLS);
  });
  app.get('/api/grade-r/assessments',(req,res)=>{
    const actor=getSessionAccount(req); if(!actor)return res.status(401).json({message:'Sign in to view Grade R assessments.'});
    let rows=schoolRecords('gradeRSkillAssessments',actor);
    if(actor.role==='parent'){
      const allowed=new Set(schoolLearners(actor).filter(l=>parentCanSeeLearner(actor,l)).map(l=>normalizeComparableText(l.studentName)));
      rows=rows.filter(row=>allowed.has(normalizeComparableText(row.learnerName)));
    }
    if(req.query?.learnerName) rows=rows.filter(row=>normalizeComparableText(row.learnerName)===normalizeComparableText(req.query.learnerName));
    if(req.query?.term) rows=rows.filter(row=>String(row.term||'')===String(req.query.term));
    res.json(rows);
  });
  app.post('/api/grade-r/assessments',(req,res)=>{
    const actor=staffActor(req); if(!actor)return res.status(403).json({message:'Teacher or management access is required.'});
    const learnerName=limitedText(req.body?.learnerName,160), learner=learnerName&&findLearner(actor,learnerName);
    if(!learner)return res.status(404).json({message:'Choose a learner in your school.'});
    const skill=GRADE_R_SKILLS.find(item=>item.id===req.body?.skillId), rating=Math.trunc(Number(req.body?.rating));
    if(!skill||![1,2,3,4].includes(rating))return res.status(400).json({message:'Choose a Grade R skill and a rating from 1 to 4.'});
    const term=boundedText(req.body?.term,60);
    if(!term)return res.status(400).json({message:'Choose a term for this Grade R skill observation.'});
    const record=tagSchoolRecord(actor,{id:crypto.randomUUID(),learnerName,learnerKey:learner.id||'',skillId:skill.id,subject:skill.subject,skill:skill.label,rating,term,evidence:boundedText(req.body?.evidence,1200),observedAt:validDateKey(req.body?.observedAt)||dateKeyInSouthAfrica(),recordedBy:actor.username,createdAt:nowIso()});
    db.gradeRSkillAssessments.unshift(record); res.status(201).json({success:true,assessment:record});
  });
  app.get('/api/grade-r/summary/:learnerName',(req,res)=>{
    const actor=getSessionAccount(req), learner=actor&&findLearner(actor,req.params.learnerName);
    if(!canSeeLearner(actor,learner))return res.status(403).json({message:'You cannot view that learner.'});
    const requestedTerm=boundedText(req.query?.term,60);
    const rows=schoolRecords('gradeRSkillAssessments',actor).filter(row=>normalizeComparableText(row.learnerName)===normalizeComparableText(learner.studentName) && (!requestedTerm || String(row.term||'')===requestedTerm));
    const latest=new Map(); rows.forEach(row=>{if(!latest.has(row.skillId))latest.set(row.skillId,row);});
    const assessed=[...latest.values()], subjectSummary={};
    for(const subject of ['Home Language','Mathematics','Life Skills']){
      const group=assessed.filter(row=>row.subject===subject);
      subjectSummary[subject]={assessed:group.length,total:GRADE_R_SKILLS.filter(skill=>skill.subject===subject).length,average:group.length?Math.round((group.reduce((sum,row)=>sum+row.rating,0)/group.length)*100)/100:0};
    }
    res.json({learnerName:learner.studentName,term:requestedTerm||'all',totalSkills:GRADE_R_SKILLS.length,assessedSkills:assessed.length,subjectSummary,latest:assessed});
  });

  const incidentView = row => {
    const {staffSignature,principalSignature,parentSignature,...safeRow}=row;
    return {
      ...safeRow,
      staffSigned:Boolean(staffSignature&&row.staffSignedAt),
      principalSigned:Boolean(principalSignature&&row.principalSignedAt),
      parentSigned:Boolean(parentSignature&&row.parentSignedAt)
    };
  };
  app.get('/api/dsd-incidents',(req,res)=>{
    const actor=getSessionAccount(req); if(!actor)return res.status(401).json({message:'Sign in to view incidents.'});
    let rows=schoolRecords('dsdIncidents',actor);
    if(actor.role==='parent'){
      const allowed=new Set(schoolLearners(actor).filter(l=>parentCanSeeLearner(actor,l)).map(l=>normalizeComparableText(l.studentName)));
      rows=rows.filter(row=>allowed.has(normalizeComparableText(row.learnerName)));
    } else if(!(hasPlatformAccess(actor)||['teacher','principal','admin','staff'].includes(actor.role))) return res.status(403).json({message:'Incident access is restricted.'});
    res.json(rows.map(incidentView));
  });
  app.post('/api/dsd-incidents',(req,res)=>{
    const actor=staffActor(req); if(!actor)return res.status(403).json({message:'School staff access is required.'});
    const learnerName=limitedText(req.body?.learnerName,160), learner=learnerName&&findLearner(actor,learnerName);
    if(!learner)return res.status(404).json({message:'Choose a learner in your school.'});
    const incidentDate=validDateKey(req.body?.incidentDate), incidentTime=/^([01]\d|2[0-3]):[0-5]\d$/.test(String(req.body?.incidentTime||''))?String(req.body.incidentTime):'';
    const location=limitedText(req.body?.location,180), description=limitedText(req.body?.description,3000);
    const bodyRegions=[...new Set((Array.isArray(req.body?.bodyRegions)?req.body.bodyRegions:[]).filter(region=>BODY_REGIONS.has(region)))];
    if(!incidentDate||!incidentTime||!location||!description)return res.status(400).json({message:'Date, time, place and incident description are required.'});
    const sequence=schoolRecords('dsdIncidents',actor).length+1;
    const signingPin=req.body?.signingPin, signatureData=req.body?.signatureData;
    if(signatureData && (!actor.reportSigningPinHash||!validSecretLength(signingPin)||!matchesPin(signingPin,actor.reportSigningPinHash)||!validSignatureData(signatureData))) return res.status(403).json({message:'A valid staff signing PIN and signature are required for signed submission.'});
    const record=tagSchoolRecord(actor,{
      id:crypto.randomUUID(),incidentNumber:String(incidentDate).replaceAll('-','')+'-'+String(sequence).padStart(4,'0'),
      learnerName,learnerKey:learner.id||'',className:boundedText(learner.className,120),
      incidentDate,incidentTime,location,incidentType:boundedText(req.body?.incidentType,120),description,
      witnesses:boundedText(req.body?.witnesses,1000),bodyRegions,injuriesOrSymptoms:boundedText(req.body?.injuriesOrSymptoms,1600),
      bloodPresent:Boolean(req.body?.bloodPresent),bloodAmount:boundedText(req.body?.bloodAmount,240),bloodLocation:boundedText(req.body?.bloodLocation,500),
      firstAid:boundedText(req.body?.firstAid,1600),treatment:boundedText(req.body?.treatment,1600),medicalReferral:boundedText(req.body?.medicalReferral,1000),
      parentNotification:boundedText(req.body?.parentNotification,1000),parentNotifiedAt:boundedText(req.body?.parentNotifiedAt,120),
      parentCollectedAt:boundedText(req.body?.parentCollectedAt,120),parentAdvice:boundedText(req.body?.parentAdvice,1200),
      personInCharge:boundedText(req.body?.personInCharge,240),correctiveAction:boundedText(req.body?.correctiveAction,1600),
      preventiveMeasures:boundedText(req.body?.preventiveMeasures,1600),staffStatement:boundedText(req.body?.staffStatement,2000),principalReview:boundedText(req.body?.principalReview,1600),
      parentAcknowledgement:'',evidenceFileIds:[],staffUsername:actor.username,staffSignature:signatureData?encryptField(signatureData):null,
      staffSignedAt:signatureData?nowIso():null,principalSignature:null,principalSignedAt:null,parentSignature:null,parentSignedAt:null,
      status:'Open',createdAt:nowIso(),updatedAt:nowIso()
    });
    db.dsdIncidents.unshift(record);res.status(201).json({success:true,incident:incidentView(record)});
  });
  app.get('/api/dsd-incidents/:id/print',(req,res)=>{
    const actor=getSessionAccount(req),row=actor&&(db.dsdIncidents||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
    const learner=row&&findLearner(actor,row.learnerName);
    if(!row||!(hasPlatformAccess(actor)||['teacher','principal','admin','staff'].includes(actor?.role)||parentCanSeeLearner(actor,learner)))return res.status(404).send('Incident not found.');
    const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    const line=(label,value)=>'<div class="line"><strong>'+esc(label)+':</strong> '+esc(value||'Not recorded')+'</div>';
    const signatureHtml=(stored,signedAt)=>{
      const data=stored?decryptStoredField(stored):'';
      return validSignatureData(data)?'<img class="signature-image" alt="Stored signature" src="'+esc(data)+'"><p>'+esc('Signed '+signedAt)+'</p>':'<p>Not signed</p>';
    };
    res.setHeader('Cache-Control','private, no-store');
    res.type('html').send('<!doctype html><html><head><meta charset="utf-8"><title>Little Feet incident report</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#102a43}.line{padding:7px 0;border-bottom:1px solid #d9e2ec}.sig{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin-top:24px}.box{border:1px solid #b8c8d8;padding:12px;margin:12px 0}.signature-image{display:block;width:100%;max-width:260px;height:90px;object-fit:contain;border-bottom:1px solid #b8c8d8;margin:10px 0}@media(max-width:760px){.sig{grid-template-columns:1fr}}@media print{button{display:none}}</style></head><body><h1>Incident / Injury Report</h1><p>'+esc(row.schoolName||'')+' · '+esc(row.incidentNumber)+'</p>'+line('Child',row.learnerName)+line('Date',row.incidentDate)+line('Time',row.incidentTime)+line('Where did it occur',row.location)+line('Description',row.description)+line('Witnesses',row.witnesses)+line('Injuries or symptoms',row.injuriesOrSymptoms)+line('Body areas',(row.bodyRegions||[]).join(', '))+line('Blood present',row.bloodPresent?'Yes':'No')+line('Amount of blood',row.bloodAmount)+line('Where was the blood',row.bloodLocation)+line('First aid / what was done',row.firstAid)+line('Further medical attention',row.medicalReferral)+line('Parent notified',row.parentNotification)+line('When parent was notified',row.parentNotifiedAt)+line('When parent collected child',row.parentCollectedAt)+line('Advice given to parent',row.parentAdvice)+line('Person in charge',row.personInCharge)+line('Measures to prevent repeat',row.preventiveMeasures||row.correctiveAction)+'<div class="sig"><div class="box"><strong>Staff</strong>'+signatureHtml(row.staffSignature,row.staffSignedAt)+'</div><div class="box"><strong>Principal</strong>'+signatureHtml(row.principalSignature,row.principalSignedAt)+'</div><div class="box"><strong>Parent</strong>'+signatureHtml(row.parentSignature,row.parentSignedAt)+'</div></div><button onclick="window.print()">Print / Save PDF copy</button></body></html>');
  });

  app.post('/api/dsd-incidents/:id/principal-sign',(req,res)=>{
    const actor=managementActor(req),row=actor&&(db.dsdIncidents||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
    if(!row)return res.status(404).json({message:'Incident not found.'});
    if(!actor.reportSigningPinHash||!validSecretLength(req.body?.signingPin)||!matchesPin(req.body.signingPin,actor.reportSigningPinHash)||!validSignatureData(req.body?.signatureData)) return res.status(403).json({message:'Enter your signing PIN and add a valid signature.'});
    row.principalReview=boundedText(req.body?.principalReview||row.principalReview,1600);row.principalSignature=encryptField(req.body.signatureData);row.principalSignedAt=nowIso();row.status='Awaiting parent acknowledgement';row.updatedAt=nowIso();
    res.json({success:true,incident:incidentView(row)});
  });
  app.post('/api/dsd-incidents/:id/parent-acknowledge',(req,res)=>{
    const actor=getSessionAccount(req),row=actor&&(db.dsdIncidents||[]).find(item=>item.id===req.params.id&&recordInSchool(item,actor));
    const learner=row&&findLearner(actor,row.learnerName);
    if(!row||actor?.role!=='parent'||!parentCanSeeLearner(actor,learner))return res.status(403).json({message:'Only the linked parent can acknowledge this incident.'});
    if(!actor.reportSigningPinHash||!validSecretLength(req.body?.signingPin)||!matchesPin(req.body.signingPin,actor.reportSigningPinHash)||!validSignatureData(req.body?.signatureData)) return res.status(403).json({message:'Enter your signing PIN and add a valid signature.'});
    row.parentAcknowledgement=boundedText(req.body?.acknowledgement||'Acknowledged',1000);row.parentSignature=encryptField(req.body.signatureData);row.parentSignedAt=nowIso();row.status='Complete';row.updatedAt=nowIso();
    res.json({success:true,incident:incidentView(row)});
  });

  const providerEndpoint = (name) => {
    const raw=String(process.env[name]||'').trim();
    if(process.env.NODE_ENV==='test' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(raw)) return raw;
    return safeHttpsUrl(raw);
  };
  const sendGateway = async (kind,payload) => {
    const prefix=kind==='sms'?'LF_SMS':kind==='whatsapp'?'LF_WHATSAPP':'LF_PUSH';
    const endpoint=providerEndpoint(prefix+'_API_URL'),key=String(process.env[prefix+'_API_KEY']||'').trim();
    if(!endpoint||!key)return {ok:false,status:'not_configured'};
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify(payload)});
    if(!response.ok)throw new Error(kind.toUpperCase()+' provider returned HTTP '+response.status);
    return {ok:true,status:'sent'};
  };
  const communicationConfig = () => ({
    email:Boolean(smtpEmailConfigured?.() || apiEmailConfigured?.()),
    sms:Boolean(providerEndpoint('LF_SMS_API_URL')&&String(process.env.LF_SMS_API_KEY||'').trim()&&String(process.env.LF_SMS_FROM||'').trim()),
    push:Boolean(providerEndpoint('LF_PUSH_API_URL')&&String(process.env.LF_PUSH_API_KEY||'').trim()),
    whatsapp:Boolean(providerEndpoint('LF_WHATSAPP_API_URL')&&String(process.env.LF_WHATSAPP_API_KEY||'').trim()&&String(process.env.LF_WHATSAPP_FROM||'').trim())
  });
  const communicationPhone=(actor,recipient)=>{
    const direct=boundedText(recipient.phone||recipient.mobile||recipient.contactPhone,60);
    if(direct)return direct;
    if(recipient.role!=='parent')return '';
    const emailCandidates=[recipient.email,recipient.username,...(recipient.loginAliases||[])].filter(Boolean).map(normalizeUsername);
    const registry=tenantRecords(db.registry||[],actor).find(row=>{
      const guardianEmail=normalizeUsername(decryptStoredField(row.guardianEmail)||'');
      const guardianName=normalizeComparableText(row.guardianName||'');
      return (guardianEmail&&emailCandidates.includes(guardianEmail)) || (guardianName&&guardianName===normalizeComparableText(recipient.name||''));
    });
    return registry?boundedText(decryptStoredField(registry.guardianPhone)||'',60):'';
  };
  const communicationRecipients=(actor,audience,className)=>{
    const users=(db.users||[]).filter(account=>isSameSchool(actor,account)&&account.verificationStatus==='Active');
    let selected=users;
    if(audience==='parents') selected=users.filter(a=>a.role==='parent');
    else if(audience==='teachers') selected=users.filter(a=>a.role==='teacher');
    else if(audience==='staff') selected=users.filter(a=>['teacher','principal','admin','school_accounts'].includes(a.role));
    if(audience==='class'&&className){
      const classKey=normalizeComparableText(className);
      const names=new Set(schoolLearners(actor).filter(l=>normalizeComparableText(l.className)===classKey).map(l=>normalizeComparableText(l.studentName)));
      selected=users.filter(account=>{
        if(account.role==='parent')return (account.linkedLearners||[]).some(name=>names.has(normalizeComparableText(name)));
        if(account.role==='teacher')return (account.assignedClasses||[]).some(name=>normalizeComparableText(name)===classKey);
        return false;
      });
    }
    return selected;
  };
  app.get('/api/communications/config',(req,res)=>{
    const actor=communicationActor(req);if(!actor)return res.status(403).json({message:'Communication access is required.'});res.json(communicationConfig());
  });
  app.get('/api/communications/campaigns',(req,res)=>{
    const actor=communicationActor(req);if(!actor)return res.status(403).json({message:'Communication access is required.'});res.json(schoolRecords('communicationCampaigns',actor));
  });
  const executeCommunicationCampaign=async(campaign,actor)=>{
    const recipients=communicationRecipients(actor,campaign.audience,campaign.className);
    if(!recipients.length){campaign.status='failed';campaign.error='No matching recipients were found.';campaign.executedAt=nowIso();return campaign;}
    campaign.deliveries=[];
    for(const recipient of recipients){
      for(const channel of campaign.channels){
        const delivery={recipient:recipient.username,channel,status:'failed',at:nowIso()};
        try{
          if(channel==='email'){
            const to=[recipient.email,recipient.username,...(recipient.loginAliases||[])].find(looksLikeEmailAddress);
            if(!to) delivery.status='no_address';
            else delivery.status=(await sendLittleFeetEmail({to,subject:campaign.title,text:campaign.message,html:'<p>'+String(campaign.message).replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])).replace(/\n/g,'<br>')+'</p>'}))?'sent':'not_configured';
          } else if(channel==='sms'){
            const phone=communicationPhone(actor,recipient);
            if(!phone) delivery.status='no_address';
            else delivery.status=(await sendGateway('sms',{from:String(process.env.LF_SMS_FROM||''),to:phone,message:campaign.message,reference:campaign.id})).status;
          } else if(channel==='whatsapp'){
            const phone=communicationPhone(actor,recipient);
            if(!phone) delivery.status='no_address';
            else delivery.status=(await sendGateway('whatsapp',{from:String(process.env.LF_WHATSAPP_FROM||''),to:phone,message:campaign.message,reference:campaign.id})).status;
          } else {
            delivery.status=(await sendGateway('push',{recipient:recipient.username,title:campaign.title,message:campaign.message,reference:campaign.id,schoolId:accountSchoolId(actor)})).status;
          }
        }catch(error){delivery.status='failed';delivery.error=boundedText(error.message,240);}
        campaign.deliveries.push(delivery);
      }
    }
    campaign.status='completed';campaign.executedAt=nowIso();return campaign;
  };
  app.get('/api/communications/inbox',(req,res)=>{
    const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view messages.'});
    const username=normalizeUsername(actor.username);
    const rows=schoolRecords('communicationCampaigns',actor).filter(campaign=>(campaign.deliveries||[]).some(d=>normalizeUsername(d.recipient)===username&&d.status==='sent')).map(campaign=>{
      const deliveries=(campaign.deliveries||[]).filter(d=>normalizeUsername(d.recipient)===username&&d.status==='sent');
      return {id:campaign.id,title:campaign.title,message:campaign.message,channels:deliveries.map(d=>d.channel),createdAt:campaign.executedAt||campaign.createdAt,readAt:deliveries.find(d=>d.openedAt)?.openedAt||''};
    });
    res.json(rows);
  });
  app.post('/api/communications/campaigns/:id/read',(req,res)=>{
    const actor=getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to acknowledge this message.'});
    const campaign=schoolRecords('communicationCampaigns',actor).find(row=>row.id===req.params.id);if(!campaign)return res.status(404).json({message:'Campaign not found.'});
    const username=normalizeUsername(actor.username),deliveries=(campaign.deliveries||[]).filter(d=>normalizeUsername(d.recipient)===username&&d.status==='sent');
    if(!deliveries.length)return res.status(403).json({message:'This campaign was not delivered to your account.'});
    const openedAt=nowIso();deliveries.forEach(d=>{if(!d.openedAt)d.openedAt=openedAt;});res.json({success:true,readAt:openedAt});
  });

  app.post('/api/communications/campaigns',async(req,res,next)=>{
    const actor=communicationActor(req);if(!actor)return res.status(403).json({message:'Communication access is required.'});
    const title=limitedText(req.body?.title,180),message=limitedText(req.body?.message,3000),audience=['all','parents','teachers','staff','class'].includes(req.body?.audience)?req.body.audience:null;
    const channels=[...new Set((Array.isArray(req.body?.channels)?req.body.channels:[]).filter(c=>['email','sms','push','whatsapp'].includes(c)))];
    if(!title||!message||!audience||!channels.length)return res.status(400).json({message:'Add title, message, audience and at least one channel.'});
    const config=communicationConfig(),unavailable=channels.filter(channel=>!config[channel]);
    if(unavailable.length)return res.status(409).json({message:'Not configured: '+unavailable.join(', ')+'. No fake delivery was recorded.'});
    const className=boundedText(req.body?.className,120);
    if(audience==='class'&&!className)return res.status(400).json({message:'Enter the class name for a one-class campaign.'});
    const scheduledAt=String(req.body?.scheduledAt||'').trim();
    const scheduledMs=scheduledAt?Date.parse(scheduledAt):NaN;
    if(scheduledAt&&(!Number.isFinite(scheduledMs)||scheduledMs<=Date.now()))return res.status(400).json({message:'Scheduled time must be a valid future date and time.'});
    const recipients=communicationRecipients(actor,audience,className);if(!recipients.length)return res.status(400).json({message:'No matching recipients were found.'});
    const campaign=tagSchoolRecord(actor,{id:crypto.randomUUID(),title,message,audience,className,channels,scheduledAt:scheduledAt||'',status:scheduledAt?'scheduled':'sending',createdBy:actor.username,createdAt:nowIso(),deliveries:[]});
    try{
      db.communicationCampaigns.unshift(campaign);
      if(!scheduledAt)await executeCommunicationCampaign(campaign,actor);
      res.status(201).json({success:true,campaign});
    }catch(error){next(error);}
  });
  const runScheduledCommunicationCampaigns=async()=>{
    const due=(db.communicationCampaigns||[]).filter(c=>c.status==='scheduled'&&c.scheduledAt&&Date.parse(c.scheduledAt)<=Date.now());
    let changed=false;
    for(const campaign of due){
      const actor=(db.users||[]).find(account=>normalizeUsername(account.username)===normalizeUsername(campaign.createdBy)&&accountSchoolId(account)===campaign.schoolId);
      if(!actor){campaign.status='failed';campaign.error='Campaign creator account is unavailable.';campaign.executedAt=nowIso();changed=true;continue;}
      const config=communicationConfig(),unavailable=(campaign.channels||[]).filter(channel=>!config[channel]);
      if(unavailable.length){campaign.status='blocked';campaign.error='Not configured at send time: '+unavailable.join(', ');campaign.executedAt=nowIso();changed=true;continue;}
      await executeCommunicationCampaign(campaign,actor);changed=true;
    }
    if(changed){await saveDatabaseState();scheduleReplicaSnapshot?.();}
  };
  const scheduledCommunicationTimer=setInterval(()=>{runScheduledCommunicationCampaigns().catch(error=>logStructured?.('error','communications.schedule_failed',{category:'communications',message:error.message}));},60000);
  scheduledCommunicationTimer.unref?.();

  const attendanceSettingFor=actor=>{
    let setting=schoolRecords('attendanceAutomationSettings',actor)[0];
    if(!setting){setting=tagSchoolRecord(actor,{id:crypto.randomUUID(),cutoffTime:'09:00',autoAbsent:false,notifyParents:false,remindStaff:false,lastReminderDate:'',updatedAt:nowIso()});db.attendanceAutomationSettings.unshift(setting);}
    return setting;
  };
  app.get('/api/attendance/automation/settings',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});res.json(attendanceSettingFor(actor));
  });
  app.put('/api/attendance/automation/settings',(req,res)=>{
    const actor=managementActor(req);if(!actor)return res.status(403).json({message:'Management access is required.'});
    const cutoff=String(req.body?.cutoffTime||'');if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff))return res.status(400).json({message:'Use a valid cutoff time.'});
    const setting=attendanceSettingFor(actor);setting.cutoffTime=cutoff;setting.autoAbsent=Boolean(req.body?.autoAbsent);setting.notifyParents=Boolean(req.body?.notifyParents);setting.remindStaff=Boolean(req.body?.remindStaff);setting.updatedAt=nowIso();setting.updatedBy=actor.username;res.json({success:true,settings:setting});
  });
  const isSchoolDate=dateKey=>{
    const d=new Date(dateKey+'T12:00:00+02:00'),day=d.getDay();if(day===0||day===6)return false;
    const calendars={2026:{terms:[['2026-01-14','2026-03-27'],['2026-04-08','2026-06-26'],['2026-07-21','2026-09-23'],['2026-10-06','2026-12-11']],closed:new Set(['2026-04-27','2026-05-01','2026-06-15','2026-06-16','2026-08-10','2026-09-24'])},2027:{terms:[['2027-01-13','2027-03-19'],['2027-04-06','2027-06-25'],['2027-07-20','2027-10-01'],['2027-10-11','2027-12-10']],closed:new Set(['2027-04-26','2027-04-27','2027-06-16','2027-08-09','2027-09-24'])}};
    const cal=calendars[d.getFullYear()];return !cal||(!cal.closed.has(dateKey)&&cal.terms.some(([start,end])=>dateKey>=start&&dateKey<=end));
  };
  const runAttendanceAutomation=async actor=>{
    const setting=attendanceSettingFor(actor),date=dateKeyInSouthAfrica();
    let stateChanged=false;
    if(!isSchoolDate(date))return {date,created:0,notified:0,staffReminded:0,stateChanged,skipped:'school_closed'};
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).split(':').map(Number);
    const nowMinutes=parts[0]*60+parts[1],cut=setting.cutoffTime.split(':').map(Number),cutMinutes=cut[0]*60+cut[1];
    if(nowMinutes<cutMinutes)return {date,created:0,notified:0,staffReminded:0,stateChanged,skipped:'before_cutoff'};
    const existing=new Set(schoolRecords('attendance',actor).filter(row=>String(row.date||'')===date).map(row=>normalizeComparableText(row.studentName)));
    const missing=schoolLearners(actor).filter(learner=>!existing.has(normalizeComparableText(learner.studentName)));
    let staffReminded=0;
    if(setting.remindStaff && missing.length && setting.lastReminderDate!==date && (smtpEmailConfigured?.()||apiEmailConfigured?.())){
      const recipients=(db.users||[]).filter(account=>isSameSchool(actor,account)&&account.verificationStatus==='Active'&&['teacher','principal','admin'].includes(account.role));
      for(const account of recipients){
        const to=[account.email,account.username,...(account.loginAliases||[])].find(looksLikeEmailAddress);
        if(!to)continue;
        try{
          const sent=await sendLittleFeetEmail({to,subject:'Little Feet attendance reminder · '+date,text:missing.length+' learner(s) still have no attendance record after the '+setting.cutoffTime+' cutoff. Open Daily Attendance to review the register.'});
          if(sent)staffReminded++;
        }catch(error){logStructured?.('warn','attendance.staff_reminder_failed',{category:'attendance',schoolId:accountSchoolId(actor),message:error.message});}
      }
      setting.lastReminderDate=date;setting.lastReminderAt=nowIso();stateChanged=true;
    }
    if(!setting.autoAbsent)return {date,created:0,notified:0,staffReminded,missing:missing.length,stateChanged,skipped:'auto_absent_disabled'};
    let created=0,notified=0;
    for(const learner of missing){
      db.attendance.unshift(tagSchoolRecord(actor,{id:crypto.randomUUID(),studentName:learner.studentName,status:'Absent',date,time:setting.cutoffTime,recordedBy:'attendance-automation',createdAt:nowIso(),automation:true}));
      existing.add(normalizeComparableText(learner.studentName));created++;stateChanged=true;
      if(setting.notifyParents){
        const parent=parentForLearner(actor,learner),to=parent&&[parent.email,parent.username,...(parent.loginAliases||[])].find(looksLikeEmailAddress);
        if(to&&(smtpEmailConfigured?.()||apiEmailConfigured?.())){try{if(await sendLittleFeetEmail({to,subject:'Little Feet attendance: '+learner.studentName+' marked absent',text:learner.studentName+' was marked absent after the school attendance cutoff. Contact the school if this is incorrect.'}))notified++;}catch(error){logStructured?.('warn','attendance.parent_notification_failed',{category:'attendance',schoolId:accountSchoolId(actor),message:error.message});}}
      }
    }
    setting.lastRunDate=date;setting.lastRunAt=nowIso();stateChanged=true;return {date,created,notified,staffReminded,missing:missing.length,stateChanged};
  };
  app.post('/api/attendance/automation/run',async(req,res,next)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
    try{res.json({success:true,...await runAttendanceAutomation(actor)});}catch(error){next(error);}
  });
  app.get('/api/attendance/insights',(req,res)=>{
    const actor=staffActor(req);if(!actor)return res.status(403).json({message:'School staff access is required.'});
    const days=Math.max(7,Math.min(90,Number(req.query?.days)||30)),cutoff=Date.now()-days*86400000;
    const rows=schoolRecords('attendance',actor).filter(row=>Date.parse((row.date||'')+'T12:00:00Z')>=cutoff);
    const byDate={};for(const row of rows){const date=row.date||String(row.createdAt||'').slice(0,10);if(!date)continue;(byDate[date]||={Present:0,Absent:0,Late:0,Excused:0,'Checked In':0,'Checked Out':0});const key=row.status||'Present';byDate[date][key]=(byDate[date][key]||0)+1;}
    res.json({days,byDate,settings:attendanceSettingFor(actor)});
  });

  const automationTimer=setInterval(async()=>{
    const schools=[...new Set((db.attendanceAutomationSettings||[]).filter(s=>s.autoAbsent||s.remindStaff).map(s=>s.schoolId).filter(Boolean))];
    for(const schoolId of schools){
      const actor=(db.users||[]).find(u=>u.schoolId===schoolId&&u.verificationStatus==='Active'&&['principal','admin'].includes(u.role));
      if(!actor)continue;
      try{const result=await runAttendanceAutomation(actor);if(result.stateChanged){await saveDatabaseState();scheduleReplicaSnapshot?.();}}catch(error){logStructured?.('error','attendance.automation_failed',{category:'attendance',schoolId,message:error.message});}
    }
  },5*60*1000);
  automationTimer.unref?.();

  return {GRADE_R_SKILLS};
}

module.exports={registerSchoolCoreUpgrades,GRADE_R_SKILLS};
