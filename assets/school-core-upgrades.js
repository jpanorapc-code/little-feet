(() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const user = () => window.getLittleFeetCurrentUser?.() || null;
  const staff = () => {
    const u=user();
    return Boolean(u && (window.isLittleFeetFullAccessUser?.(u) || ['teacher','principal','admin','staff'].includes(String(u.role||'').toLowerCase())));
  };
  const management = () => {
    const u=user();
    return Boolean(u && (window.isLittleFeetFullAccessUser?.(u) || ['principal','admin','staff'].includes(String(u.role||'').toLowerCase())));
  };
  const api = async (url, options={}) => {
    const response = await fetch(url,{...options,headers:{...(options.body ? {'Content-Type':'application/json'} : {}),...(options.headers||{})}});
    const text = await response.text();
    let data={}; try{data=text?JSON.parse(text):{};}catch{data={message:text};}
    if(!response.ok) throw new Error(data.message || 'Request failed.');
    return data;
  };
  const addCard = (tabId,id,html) => {
    const tab=document.getElementById(tabId);
    if(!tab || document.getElementById(id)) return null;
    const wrap=document.createElement('div');
    wrap.id=id; wrap.className='card'; wrap.innerHTML=html; tab.appendChild(wrap); return wrap;
  };
  const money = value => new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(Number(value)||0);
  const formBody = form => Object.fromEntries(new FormData(form).entries());
  const toDataUrl = file => new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});

  async function refreshMarks(){
    const host=document.getElementById('lfSubjectMarksList'); if(!host) return;
    const learner=document.getElementById('lfMarksFilterLearner')?.value.trim()||'';
    const data=await api('/api/academics/marks'+(learner?'?learnerName='+encodeURIComponent(learner):''));
    const summary=(data.subjects||[]).map(row=>'<div class="item-row"><strong>'+esc(row.subject)+'</strong><span>'+esc(row.percentage)+'% · '+esc(row.assessments)+' assessment(s)</span></div>').join('');
    window.__littleFeetSubjectMarks=data.marks||[];
    const rows=(data.marks||[]).slice(0,80).map(row=>'<div class="item-row"><div><strong>'+esc(row.learnerName)+' · '+esc(row.subject)+'</strong><p>'+esc(row.assessmentName)+' · '+esc(row.score)+'/'+esc(row.maximum)+' · '+esc(row.percentage)+'% · weight '+esc(row.weight)+'</p><span class="meta">'+esc(row.term)+' '+esc(row.year)+' · revision '+esc(row.revision||1)+'</span></div><div style="display:flex;gap:7px;flex-wrap:wrap;"><button type="button" class="action-btn btn-blue" onclick="editLittleFeetSubjectMark(\''+esc(row.id)+'\')">Edit</button><button type="button" class="action-btn btn-blue" onclick="viewLittleFeetMarkHistory(\''+esc(row.id)+'\')">History</button><button type="button" class="action-btn btn-red" onclick="deleteLittleFeetSubjectMark(\''+esc(row.id)+'\')">Delete</button></div></div>').join('');
    host.innerHTML=(summary?'<h4>Subject totals</h4>'+summary:'')+'<h4 style="margin-top:14px;">Mark records</h4>'+(rows||'<p class="meta">No subject marks yet.</p>');
  }
  window.editLittleFeetSubjectMark=async id=>{
    const row=(window.__littleFeetSubjectMarks||[]).find(item=>item.id===id);if(!row)return;
    const score=prompt('Score',String(row.score));if(score===null)return;
    const maximum=prompt('Out of',String(row.maximum));if(maximum===null)return;
    const weight=prompt('Weight',String(row.weight));if(weight===null)return;
    const comment=prompt('Comment',String(row.comment||''));if(comment===null)return;
    try{await api('/api/academics/marks/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({score:Number(score),maximum:Number(maximum),weight:Number(weight),comment})});await refreshMarks();}catch(err){alert(err.message);}
  };
  window.deleteLittleFeetSubjectMark=async id=>{
    if(!confirm('Delete this mark? The change stays in the mark history.'))return;
    try{await api('/api/academics/marks/'+encodeURIComponent(id),{method:'DELETE'});await refreshMarks();}catch(err){alert(err.message);}
  };
  window.viewLittleFeetMarkHistory=async id=>{
    try{
      const rows=await api('/api/academics/marks/'+encodeURIComponent(id)+'/history');
      const html=rows.map(row=>'<div class="item-row"><div><strong>'+esc(row.action)+' · '+esc(row.changedBy)+'</strong><p>'+esc(row.changedAt)+'</p><span class="meta">'+esc(row.after?.score??'')+'/'+esc(row.after?.maximum??'')+' · '+esc(row.after?.percentage??'')+'%</span></div></div>').join('')||'<p>No history.</p>';
      window.openModal?.('Mark history',html);
    }catch(err){alert(err.message);}
  };
  function setupMarks(){
    if(!staff()) return;
    const card=addCard('worksheetsTab','lfSubjectMarksCard','<div class="card-header-bar"><div><h2>Subject Marks</h2><p class="meta">Real weighted marks with edit history. Existing Learning Evidence stays unchanged.</p></div><span class="badge-tag info">LIVE RECORDS</span></div><form id="lfSubjectMarkForm" class="workspace-grid"><input name="learnerName" placeholder="Learner name" required><input name="className" placeholder="Class / grade"><input name="subject" placeholder="Subject" required><input name="assessmentName" placeholder="Assessment name" required><input name="term" placeholder="Term e.g. Term 4" required><input name="year" type="number" min="2000" max="2100" value="'+new Date().getFullYear()+'" required><input name="score" type="number" min="0" step="0.01" placeholder="Score" required><input name="maximum" type="number" min="0.01" step="0.01" placeholder="Out of" required><input name="weight" type="number" min="0.01" max="100" step="0.01" value="1" placeholder="Weight" required><input name="comment" placeholder="Teacher comment"><button class="submit-btn">Save subject mark</button></form><div class="flex-form-row" style="margin-top:16px;"><input id="lfMarksFilterLearner" placeholder="Filter learner"><button id="lfRefreshMarks" type="button" class="action-btn btn-blue">Refresh marks</button></div><div id="lfSubjectMarksList" class="record-list"></div>');
    if(!card) return;
    card.querySelector('#lfSubjectMarkForm').addEventListener('submit',async e=>{e.preventDefault();try{const body=formBody(e.currentTarget);['score','maximum','weight','year'].forEach(k=>body[k]=Number(body[k]));await api('/api/academics/marks',{method:'POST',body:JSON.stringify(body)});e.currentTarget.reset();e.currentTarget.elements.year.value=new Date().getFullYear();e.currentTarget.elements.weight.value='1';await refreshMarks();window.playDingSound?.();}catch(err){alert(err.message);}});
    card.querySelector('#lfRefreshMarks').addEventListener('click',()=>refreshMarks().catch(err=>alert(err.message)));
    refreshMarks().catch(()=>{});
  }

  async function refreshReportCards(){
    const host=document.getElementById('lfReportCardList'); if(!host) return;
    const rows=await api('/api/academics/report-cards');
    host.innerHTML=rows.length?rows.slice(0,40).map(row=>'<div class="item-row"><div><strong>'+esc(row.learnerName)+' · '+esc(row.term)+' '+esc(row.year)+'</strong><p>Overall '+esc(row.average)+'% · '+esc(row.promotionOutcome||'No promotion result yet')+'</p><span class="meta">'+esc(row.createdAt)+(row.lastEmailedAt?' · emailed '+esc(row.lastEmailedAt):'')+'</span></div><div style="display:flex;gap:7px;flex-wrap:wrap;"><button type="button" class="action-btn btn-blue" onclick="window.printLittleFeetReportCard(\''+esc(row.id)+'\')">Print / PDF</button>'+(staff()?'<button type="button" class="action-btn btn-green" onclick="window.useLittleFeetReportForSignoff(\''+esc(row.id)+'\')">Use sign-off</button><button type="button" class="action-btn btn-blue" onclick="window.emailLittleFeetReportCard(\''+esc(row.id)+'\')">Email parent</button>':'')+'</div></div>').join(''):'<p class="meta">No generated report cards yet.</p>';
    window.__littleFeetReportCards=rows;
  }
  window.printLittleFeetReportCard=id=>window.open('/api/academics/report-cards/'+encodeURIComponent(id)+'/print','_blank','noopener');
  window.useLittleFeetReportForSignoff=id=>{
    const row=(window.__littleFeetReportCards||[]).find(item=>item.id===id);if(!row)return;
    document.getElementById('reportStudent').value=row.learnerName||'';
    document.getElementById('reportTitle').value='Report Card · '+row.term+' '+row.year;
    document.getElementById('reportPeriod').value=row.term+' '+row.year;
    if(row.parentUsername && document.getElementById('reportParentUsername')) document.getElementById('reportParentUsername').value=row.parentUsername;
    document.getElementById('teacherReportPublisher')?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  window.emailLittleFeetReportCard=async id=>{try{const result=await api('/api/academics/report-cards/'+encodeURIComponent(id)+'/email',{method:'POST',body:'{}'});alert('Report card emailed to '+result.sentTo+'.');await refreshReportCards();}catch(err){alert(err.message);}};
  function setupReportCards(){
    if(!staff() && user()?.role!=='parent') return;
    const maker=staff()?'<form id="lfReportCardForm" class="workspace-grid"><input name="learnerName" placeholder="Learner name" required><input name="term" placeholder="Term e.g. Term 4" required><input name="year" type="number" min="2000" max="2100" value="'+new Date().getFullYear()+'" required><label>Report period start<input name="periodStart" type="date"></label><label>Report period end<input name="periodEnd" type="date"></label><textarea name="teacherComment" placeholder="Teacher comment"></textarea><input name="promotionOutcome" placeholder="Promotion / progression result"><button class="submit-btn">Build report card</button></form>':'<p class="meta">Your school report cards appear here when a teacher creates them.</p>';
    const card=addCard('reportsTab','lfReportCardMaker','<div class="card-header-bar"><div><h2>Report Cards</h2><p class="meta">Built from real subject marks, attendance and discipline records. Existing signed report flow stays in place.</p></div><span class="badge-tag info">REAL DATA</span></div>'+maker+'<div id="lfReportCardList" class="record-list"></div>');
    if(!card)return;
    card.querySelector('#lfReportCardForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const body=formBody(e.currentTarget);body.year=Number(body.year);await api('/api/academics/report-cards',{method:'POST',body:JSON.stringify(body)});await refreshReportCards();window.playDingSound?.();}catch(err){alert(err.message);}});
    refreshReportCards().catch(()=>{});
  }

  async function refreshDiscipline(){
    const host=document.getElementById('lfDisciplineList');if(!host)return;
    const rows=await api('/api/discipline');
    const grouped=new Map();
    for(const row of rows){const key=row.learnerName;const item=grouped.get(key)||{points:0,count:0};item.points+=Number(row.pointDelta||0);item.count++;grouped.set(key,item);}
    const totals=[...grouped.entries()].map(([name,item])=>'<div class="item-row"><strong>'+esc(name)+'</strong><span>'+esc(item.points)+' points · '+esc(item.count)+' record(s)</span></div>').join('');
    const records=rows.slice(0,60).map(row=>'<div class="item-row"><div><strong>'+esc(row.learnerName)+' · '+esc(row.kind)+' · '+esc(row.category)+'</strong><p>'+esc(row.details)+'</p><span class="meta">'+esc(row.points)+' point(s) · '+esc(row.requiredAction||'Normal')+' · '+esc(row.status||'Open')+(row.parentNotificationStatus?' · parent '+esc(row.parentNotificationStatus):'')+'</span></div><button type="button" class="action-btn btn-blue" onclick="printLittleFeetDiscipline(\''+esc(row.id)+'\')">Print</button></div>').join('');
    host.innerHTML=(totals?'<h4>Learner totals</h4>'+totals:'')+(records?'<h4 style="margin-top:14px;">Conduct records</h4>'+records:'')||'<p class="meta">No discipline records yet.</p>';
  }
  window.printLittleFeetDiscipline=id=>window.open('/api/discipline/'+encodeURIComponent(id)+'/print','_blank','noopener');
  async function loadDisciplineSettings(){
    const form=document.getElementById('lfDisciplineSettings');if(!form)return;
    try{const s=await api('/api/discipline/settings');form.elements.warning.value=s.warning;form.elements.parentMeeting.value=s.parentMeeting;form.elements.principalReview.value=s.principalReview;}catch{}
  }
  function setupDiscipline(){
    if(!staff() && user()?.role!=='parent') return;
    const target=user()?.role==='parent'?'reportsTab':'safeguardingTab';
    const settings=management()?'<form id="lfDisciplineSettings" class="workspace-grid"><label>Warning points<input name="warning" type="number" min="1" required></label><label>Parent meeting points<input name="parentMeeting" type="number" min="2" required></label><label>Principal review points<input name="principalReview" type="number" min="3" required></label><button class="action-btn btn-blue">Save point rules</button></form>':'';
    const entry=staff()?'<form id="lfDisciplineForm" class="workspace-grid"><input name="learnerName" placeholder="Learner name" required><select name="kind"><option value="demerit">Demerit</option><option value="merit">Merit</option></select><input name="category" placeholder="Category" required><input name="points" type="number" min="1" max="100" value="1" required><textarea name="details" placeholder="What happened?" required></textarea><input name="actionTaken" placeholder="Action taken"><label><input name="parentNotified" type="checkbox"> Email linked parent if email is ready</label><button class="submit-btn">Save conduct record</button></form>':'<p class="meta">Only conduct records marked for parent view are shown here.</p>';
    const card=addCard(target,'lfDisciplineCard','<div class="card-header-bar"><div><h2>Discipline & Conduct</h2><p class="meta">Merits, demerits, points, actions and parent-visible history.</p></div><span class="badge-tag info">CONDUCT</span></div>'+settings+entry+'<div id="lfDisciplineList" class="record-list"></div>');
    if(!card)return;
    card.querySelector('#lfDisciplineSettings')?.addEventListener('submit',async e=>{e.preventDefault();try{const body=formBody(e.currentTarget);for(const k of ['warning','parentMeeting','principalReview'])body[k]=Number(body[k]);await api('/api/discipline/settings',{method:'PUT',body:JSON.stringify(body)});await loadDisciplineSettings();}catch(err){alert(err.message);}});
    card.querySelector('#lfDisciplineForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const body=formBody(e.currentTarget);body.points=Number(body.points);body.parentNotified=e.currentTarget.elements.parentNotified.checked;const result=await api('/api/discipline',{method:'POST',body:JSON.stringify(body)});if(body.parentNotified&&result.record.parentNotificationStatus!=='sent')alert('Record saved. Parent email status: '+result.record.parentNotificationStatus+'.');e.currentTarget.reset();e.currentTarget.elements.points.value='1';await refreshDiscipline();}catch(err){alert(err.message);}});
    loadDisciplineSettings();refreshDiscipline().catch(()=>{});
  }

  async function refreshAssets(){
    const host=document.getElementById('lfAssetList');if(!host)return;
    const rows=await api('/api/assets');window.__littleFeetAssets=rows;
    host.innerHTML=rows.length?rows.slice(0,100).map(row=>'<div class="item-row"><div><strong>'+esc(row.assetCode)+' · '+esc(row.name)+'</strong><p>'+esc(row.category||'Uncategorised')+' · '+esc(row.location||'No location')+' · '+esc(row.condition||'')+' · '+esc(row.status||'')+'</p><span class="meta">'+money(row.purchaseValue)+'</span></div>'+(management()?'<div style="display:flex;gap:7px;flex-wrap:wrap;"><button type="button" class="action-btn btn-blue" onclick="editLittleFeetAsset(\''+esc(row.id)+'\')">Edit</button><button type="button" class="action-btn btn-red" onclick="deleteLittleFeetAsset(\''+esc(row.id)+'\')">Delete</button></div>':'')+'</div>').join(''):'<p class="meta">No assets registered yet.</p>';
  }
  window.editLittleFeetAsset=async id=>{
    const row=(window.__littleFeetAssets||[]).find(item=>item.id===id);if(!row)return;
    const name=prompt('Asset name',row.name||'');if(name===null)return;
    const location=prompt('Room / location',row.location||'');if(location===null)return;
    const condition=prompt('Condition',row.condition||'Good');if(condition===null)return;
    const status=prompt('Status',row.status||'In service');if(status===null)return;
    try{await api('/api/assets/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({name,location,condition,status})});await refreshAssets();}catch(err){alert(err.message);}
  };
  window.deleteLittleFeetAsset=async id=>{
    if(!confirm('Delete this asset from the register?'))return;
    try{await api('/api/assets/'+encodeURIComponent(id),{method:'DELETE'});await refreshAssets();}catch(err){alert(err.message);}
  };
  async function importLittleFeetAssets(file){
    if(!file)return;
    if(typeof XLSX==='undefined')throw new Error('Spreadsheet reader is still loading.');
    const buffer=await file.arrayBuffer(),workbook=XLSX.read(buffer,{type:'array'}),sheet=workbook.Sheets[workbook.SheetNames[0]];
    const raw=XLSX.utils.sheet_to_json(sheet,{defval:''});
    const rows=raw.map(row=>({
      assetCode:row['Asset Code']||row['assetCode']||row['Code']||row['code'],
      name:row['Asset Name']||row['name']||row['Name'],
      category:row['Category']||row['category'],
      location:row['Location']||row['location'],
      supplier:row['Supplier']||row['supplier'],
      serialNumber:row['Serial Number']||row['serialNumber'],
      purchaseDate:row['Purchase Date']||row['purchaseDate'],
      purchaseValue:row['Purchase Value']||row['purchaseValue']||0,
      condition:row['Condition']||row['condition']||'Good',
      status:row['Status']||row['status']||'In service',
      notes:row['Notes']||row['notes']||''
    })).filter(row=>String(row.assetCode||'').trim()&&String(row.name||'').trim());
    if(!rows.length)throw new Error('No asset rows found. Use Asset Code and Asset Name columns.');
    const result=await api('/api/assets/import',{method:'POST',body:JSON.stringify({rows})});
    alert('Imported '+result.created+' asset(s). Skipped '+result.skipped+'.');await refreshAssets();
  }
  window.exportLittleFeetAssets=()=>{
    const rows=window.__littleFeetAssets||[];if(!rows.length)return alert('No assets to export.');
    const keys=['assetCode','name','category','location','supplier','serialNumber','purchaseDate','purchaseValue','condition','status','notes'];
    const csv=[keys.join(','),...rows.map(row=>keys.map(k=>'"'+String(row[k]??'').replace(/"/g,'""')+'"').join(','))].join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='LittleFeet_Asset_Register.csv';a.click();URL.revokeObjectURL(a.href);
  };
  function setupAssets(){
    if(!staff())return;
    const card=addCard('operationsTab','lfAssetRegisterCard','<div class="card-header-bar"><div><h2>Asset Register</h2><p class="meta">Keeps the existing asset checks and adds the full school asset list.</p></div><span class="badge-tag info">REGISTER</span></div>'+(management()?'<form id="lfAssetForm" class="workspace-grid"><input name="assetCode" placeholder="Asset code" required><input name="name" placeholder="Asset name" required><input name="category" placeholder="Category"><input name="location" placeholder="Room / location"><input name="supplier" placeholder="Supplier"><input name="serialNumber" placeholder="Serial number"><input name="purchaseDate" type="date"><input name="purchaseValue" type="number" min="0" step="0.01" placeholder="Purchase value"><input name="condition" placeholder="Condition" value="Good"><input name="status" placeholder="Status" value="In service"><textarea name="notes" placeholder="Notes"></textarea><button class="submit-btn">Add asset</button></form><div class="flex-form-row"><input id="lfAssetImport" type="file" accept=".xlsx,.xls,.csv"><button id="lfAssetImportButton" type="button" class="action-btn btn-blue">Import Excel / CSV</button></div>':'')+'<button type="button" class="action-btn btn-blue" onclick="exportLittleFeetAssets()">Export CSV</button><div id="lfAssetList" class="record-list"></div>');
    if(!card)return;
    card.querySelector('#lfAssetForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const body=formBody(e.currentTarget);body.purchaseValue=Number(body.purchaseValue||0);await api('/api/assets',{method:'POST',body:JSON.stringify(body)});e.currentTarget.reset();e.currentTarget.elements.condition.value='Good';e.currentTarget.elements.status.value='In service';await refreshAssets();}catch(err){alert(err.message);}});
    card.querySelector('#lfAssetImportButton')?.addEventListener('click',async()=>{try{await importLittleFeetAssets(document.getElementById('lfAssetImport')?.files?.[0]);}catch(err){alert(err.message);}});
    refreshAssets().catch(()=>{});
  }

  async function refreshCommunication(){
    const status=document.getElementById('lfCommunicationStatus'),list=document.getElementById('lfCampaignList');if(!status||!list)return;
    const [config,rows,templates]=await Promise.all([api('/api/communications/config'),api('/api/communications/campaigns'),api('/api/communications/templates').catch(()=>[])]);
    status.innerHTML='<strong>Email:</strong> '+(config.email?'ready':'not configured')+' · <strong>SMS:</strong> '+(config.sms?'ready':'not configured')+' · <strong>Push:</strong> '+(config.push?'ready':'not configured')+' · <strong>WhatsApp:</strong> '+(config.whatsapp?'ready':'not configured');
    ['email','sms','push','whatsapp'].forEach(ch=>{const el=document.querySelector('#lfCampaignForm input[value="'+ch+'"]');if(el){el.disabled=!config[ch];el.closest('label').title=config[ch]?'':'Provider is not configured. Little Feet will not fake delivery.';}});
    const templateSelect=document.getElementById('lfCampaignTemplate');
    if(templateSelect){
      const current=templateSelect.value;
      templateSelect.innerHTML='<option value="">No template</option>'+templates.map(t=>'<option value="'+esc(t.id)+'">'+esc(t.name)+'</option>').join('');
      templateSelect.value=templates.some(t=>t.id===current)?current:'';
      window.__littleFeetCommunicationTemplates=templates;
    }
    list.innerHTML=rows.length?rows.slice(0,30).map(row=>{const sent=(row.deliveries||[]).filter(d=>d.status==='sent').length;const failed=(row.deliveries||[]).filter(d=>d.status!=='sent').length;const state=row.status==='scheduled'?'Scheduled '+esc(row.scheduledAt):row.status==='blocked'?'Blocked: '+esc(row.error||'provider unavailable'):sent+' sent · '+failed+' not sent';return '<div class="item-row"><div><strong>'+esc(row.title)+'</strong><p>'+esc(row.audience)+' · '+esc((row.channels||[]).join(', '))+'</p><span class="meta">'+state+'</span></div></div>';}).join(''):'<p class="meta">No campaigns sent or scheduled yet.</p>';
  }
  function setupCommunication(){
    if(!staff())return;
    const mount=document.getElementById('lfCommunicationHubMount');
    if(!mount||document.getElementById('lfCommunicationHub'))return;
    const card=document.createElement('div');
    card.id='lfCommunicationHub';
    card.className='workspace-card';
    card.style.marginTop='16px';
    card.innerHTML='<div class="card-header-bar"><div><h3>Direct Message Campaigns</h3><p class="meta">Send now or schedule Email, SMS, Push or WhatsApp. Only real configured providers can be selected.</p></div><span class="badge-tag info">DELIVERY</span></div><div id="lfCommunicationStatus" class="meta">Checking available channels…</div><form id="lfCampaignForm" class="workspace-grid" style="margin-top:12px;"><select id="lfCampaignTemplate" aria-label="Message template"><option value="">No template</option></select><input name="title" placeholder="Message title" required><textarea name="message" placeholder="Message" required></textarea><select name="audience" aria-label="Campaign audience"><option value="all">All school accounts</option><option value="parents">Parents</option><option value="teachers">Teachers</option><option value="staff">Staff</option><option value="class">One class</option></select><input name="className" placeholder="Class name" hidden disabled><label>Schedule for later (optional)<input name="scheduledAt" type="datetime-local"></label><div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;"><strong class="meta">Send by:</strong><label><input type="checkbox" name="channels" value="email"> Email</label><label><input type="checkbox" name="channels" value="sms"> SMS</label><label><input type="checkbox" name="channels" value="push"> Push</label><label><input type="checkbox" name="channels" value="whatsapp"> WhatsApp</label></div><button class="submit-btn">Send / schedule campaign</button></form><details style="margin-top:14px;"><summary style="cursor:pointer;font-weight:700;">Reusable message templates</summary><form id="lfCommunicationTemplateForm" class="workspace-grid" style="margin-top:10px;"><input name="name" placeholder="Template name" required><input name="title" placeholder="Default title" required><textarea name="message" placeholder="Default message" required></textarea><button class="submit-btn">Save template</button></form></details><h4 style="margin-top:16px;">Campaign history</h4><div id="lfCampaignList" class="record-list"></div>';
    mount.appendChild(card);
    const form=card.querySelector('#lfCampaignForm');
    const audience=form.elements.audience,className=form.elements.className;
    const syncClassField=()=>{const show=audience.value==='class';className.hidden=!show;className.disabled=!show;className.required=show;if(!show)className.value='';};
    audience.addEventListener('change',syncClassField);syncClassField();
    card.querySelector('#lfCampaignTemplate').addEventListener('change',e=>{const template=(window.__littleFeetCommunicationTemplates||[]).find(t=>t.id===e.target.value);if(template){form.elements.title.value=template.title||'';form.elements.message.value=template.message||'';}});
    card.querySelector('#lfCommunicationTemplateForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/communications/templates',{method:'POST',body:JSON.stringify(formBody(e.currentTarget))});e.currentTarget.reset();await refreshCommunication();}catch(err){alert(err.message);}});
    form.addEventListener('submit',async e=>{e.preventDefault();try{const body=formBody(e.currentTarget);body.channels=[...e.currentTarget.querySelectorAll('input[name="channels"]:checked')].map(x=>x.value);if(!body.scheduledAt)delete body.scheduledAt;await api('/api/communications/campaigns',{method:'POST',body:JSON.stringify(body)});e.currentTarget.reset();syncClassField();await refreshCommunication();}catch(err){alert(err.message);}});
    refreshCommunication().catch(()=>{});
  }

  async function refreshGradeR(){
    const select=document.getElementById('lfGradeRSkill'),summary=document.getElementById('lfGradeRSummary');if(!select||!summary)return;
    if(!select.dataset.loaded){
      const skills=await api('/api/grade-r/skills');select.innerHTML=skills.map(skill=>'<option value="'+esc(skill.id)+'">'+esc(skill.subject)+' · '+esc(skill.label)+'</option>').join('');select.dataset.loaded='1';
    }
    const learner=document.getElementById('lfGradeRLearner')?.value.trim();
    const term=document.getElementById('lfGradeRTerm')?.value.trim()||'';
    if(!learner){summary.innerHTML='<p class="meta">Enter a learner and save or refresh to see progress.</p>';return;}
    try{const data=await api('/api/grade-r/summary/'+encodeURIComponent(learner)+(term?'?term='+encodeURIComponent(term):''));summary.innerHTML='<div class="workspace-grid">'+Object.entries(data.subjectSummary||{}).map(([subject,row])=>'<div class="workspace-card"><strong>'+esc(subject)+'</strong><p>'+esc(row.assessed)+' / '+esc(row.total)+' skills checked</p><span class="meta">Average rating '+esc(row.average)+'/4</span></div>').join('')+'</div>';}catch(err){summary.innerHTML='<p class="meta">'+esc(err.message)+'</p>';}
  }
  function setupGradeR(){
    if(!staff() && user()?.role!=='parent')return;
    const gradeTarget=user()?.role==='parent'?'reportsTab':'progressTab';
    const card=addCard(gradeTarget,'lfGradeRSkillsCard','<div class="card-header-bar"><div><h2>Grade R Skills</h2><p class="meta">98 Little Feet observation skills mapped to CAPS Home Language, Mathematics and Life Skills.</p></div><span class="badge-tag info">98 SKILLS</span></div>'+(staff()?'<form id="lfGradeRForm" class="workspace-grid"><input id="lfGradeRLearner" name="learnerName" placeholder="Grade R learner" required><input id="lfGradeRTerm" name="term" placeholder="Term e.g. Term 4" required><select id="lfGradeRSkill" name="skillId"></select><select name="rating"><option value="1">1 · Not yet</option><option value="2">2 · Developing</option><option value="3">3 · Achieved</option><option value="4">4 · Strong / consistent</option></select><input name="observedAt" type="date"><textarea name="evidence" placeholder="Observation / evidence"></textarea><button class="submit-btn">Save skill observation</button></form>':'<input id="lfGradeRLearner" placeholder="Learner name"><input id="lfGradeRTerm" placeholder="Term e.g. Term 4"><button id="lfGradeRRefresh" type="button" class="action-btn btn-blue">View progress</button><select id="lfGradeRSkill" class="hidden"></select>')+'<div id="lfGradeRSummary"></div>');
    if(!card)return;
    const form=card.querySelector('#lfGradeRForm');if(form){form.elements.observedAt.value=new Date().toISOString().slice(0,10);form.addEventListener('submit',async e=>{e.preventDefault();try{const body=formBody(e.currentTarget);body.rating=Number(body.rating);await api('/api/grade-r/assessments',{method:'POST',body:JSON.stringify(body)});await refreshGradeR();}catch(err){alert(err.message);}});}
    card.querySelector('#lfGradeRRefresh')?.addEventListener('click',()=>refreshGradeR());
    refreshGradeR().catch(()=>{});
  }

  const SIGNATURES={};
  function attachSignatureCanvas(id){
    const canvas=document.getElementById(id);if(!canvas||SIGNATURES[id])return;
    const ctx=canvas.getContext('2d');ctx.lineWidth=2;ctx.lineCap='round';ctx.strokeStyle='#102a43';let drawing=false,has=false;
    const point=e=>{const r=canvas.getBoundingClientRect(),src=e.touches?.[0]||e;return{x:(src.clientX-r.left)*(canvas.width/r.width),y:(src.clientY-r.top)*(canvas.height/r.height)};};
    const start=e=>{drawing=true;const p=point(e);ctx.beginPath();ctx.moveTo(p.x,p.y);e.preventDefault();};
    const move=e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke();has=true;e.preventDefault();};
    const stop=()=>{drawing=false;};
    canvas.addEventListener('pointerdown',start);canvas.addEventListener('pointermove',move);window.addEventListener('pointerup',stop);
    SIGNATURES[id]={has:()=>has,data:()=>has?canvas.toDataURL('image/png'):'',clear:()=>{ctx.clearRect(0,0,canvas.width,canvas.height);has=false;}};
  }
  window.clearLittleFeetCoreSignature=id=>SIGNATURES[id]?.clear();
  async function refreshDsdIncidents(){
    const host=document.getElementById('lfDsdIncidentList');if(!host)return;
    const rows=await api('/api/dsd-incidents');
    window.__littleFeetDsdIncidents=rows;
    const principalSelect=document.getElementById('lfDsdPrincipalIncident');
    const parentSelect=document.getElementById('lfDsdParentIncident');
    if(principalSelect){
      principalSelect.innerHTML='<option value="">Choose incident to review</option>'+rows.filter(row=>!row.principalSignedAt).map(row=>'<option value="'+esc(row.id)+'">'+esc(row.incidentNumber)+' · '+esc(row.learnerName)+'</option>').join('');
    }
    if(parentSelect){
      parentSelect.innerHTML='<option value="">Choose incident to acknowledge</option>'+rows.filter(row=>row.principalSignedAt&&!row.parentSignedAt).map(row=>'<option value="'+esc(row.id)+'">'+esc(row.incidentNumber)+' · '+esc(row.learnerName)+'</option>').join('');
    }
    host.innerHTML=rows.length?rows.slice(0,30).map(row=>'<div class="item-row"><div><strong>'+esc(row.incidentNumber)+' · '+esc(row.learnerName)+'</strong><p>'+esc(row.incidentType||'Incident')+' · '+esc(row.location)+' · '+esc(row.status)+'</p><span class="meta">'+esc(row.incidentDate)+' '+esc(row.incidentTime)+' · body areas: '+esc((row.bodyRegions||[]).join(', ')||'none marked')+'</span></div><div style="display:flex;gap:7px;flex-wrap:wrap;"><button type="button" class="action-btn btn-blue" onclick="printLittleFeetDsdIncident(\''+esc(row.id)+'\')">Print form</button><button type="button" class="action-btn btn-blue" onclick="viewLittleFeetIncidentEvidence(\''+esc(row.id)+'\')">Evidence</button></div></div>').join(''):'<p class="meta">No DSD incident forms yet.</p>';
  }
  window.printLittleFeetDsdIncident=id=>window.open('/api/dsd-incidents/'+encodeURIComponent(id)+'/print','_blank','noopener');
  window.viewLittleFeetIncidentEvidence=async id=>{
    try{
      const files=await api('/api/files?entityType=dsd_incident&recordId='+encodeURIComponent(id));
      const html=files.length?files.map(file=>'<div class="item-row"><a href="'+esc(file.contentUrl)+'" target="_blank" rel="noopener">'+esc(file.originalFilename)+'</a><span class="meta">'+esc(file.purpose)+' · '+Math.round(Number(file.size||0)/1024)+' KB</span></div>').join(''):'<p>No evidence files attached.</p>';
      window.openModal?.('Incident evidence',html);
    }catch(err){alert(err.message);}
  };
  function setupDsdIncidents(){
    if(!staff() && user()?.role!=='parent')return;
    const regions=['head','face','neck','left-shoulder','right-shoulder','chest','abdomen','back','left-arm','right-arm','left-hand','right-hand','left-leg','right-leg','left-foot','right-foot'];
    const target=user()?.role==='parent'?'reportsTab':'careTab';
    const staffForm=staff()?'<form id="lfDsdIncidentForm"><div class="workspace-grid"><input name="learnerName" placeholder="Child name" required><input name="incidentDate" type="date" required><input name="incidentTime" type="time" required><input name="location" placeholder="Where did it occur?" required><input name="incidentType" placeholder="Incident / injury type"><textarea name="description" placeholder="Description of accident / injury / incident" required></textarea><textarea name="witnesses" placeholder="Who witnessed it?"></textarea><textarea name="injuriesOrSymptoms" placeholder="Injuries or symptoms and body part"></textarea><div style="grid-column:1/-1;"><strong>Body map</strong><div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:7px;">'+regions.map(r=>'<label><input type="checkbox" name="bodyRegions" value="'+r+'"> '+r.replaceAll('-',' ')+'</label>').join('')+'</div></div><label><input type="checkbox" name="bloodPresent"> Blood present</label><input name="bloodAmount" placeholder="How much blood?"><input name="bloodLocation" placeholder="Where was the blood?"><textarea name="firstAid" placeholder="What was done for the child / first aid?"></textarea><textarea name="medicalReferral" placeholder="Further medical attention required?"></textarea><textarea name="parentNotification" placeholder="How was the parent notified?"></textarea><input name="parentNotifiedAt" placeholder="When was the parent notified?"><input name="parentCollectedAt" placeholder="When did the parent collect the child?"><textarea name="parentAdvice" placeholder="What advice was given to the parent?"></textarea><input name="personInCharge" placeholder="Who was in charge?"><textarea name="preventiveMeasures" placeholder="Measures needed to prevent this happening again"></textarea><textarea name="treatment" placeholder="Extra treatment notes"></textarea><textarea name="correctiveAction" placeholder="Corrective action / follow-up"></textarea><textarea name="staffStatement" placeholder="Staff statement"></textarea><textarea name="principalReview" placeholder="Principal review / notes"></textarea><label>Evidence photos<input id="lfDsdPhotos" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><input name="signingPin" type="password" placeholder="Staff signing PIN"><div><span class="form-label">Staff signature</span><canvas id="lfDsdStaffSignature" class="signature-pad" width="520" height="140"></canvas><button type="button" class="action-btn btn-blue" onclick="clearLittleFeetCoreSignature(\'lfDsdStaffSignature\')">Clear signature</button></div></div><button class="submit-btn">Save incident form</button></form>':'';
    const principalForm=management()?'<div class="workspace-card" style="margin-top:16px;"><h3>Principal review & signature</h3><form id="lfDsdPrincipalForm" class="workspace-grid"><select id="lfDsdPrincipalIncident" name="incidentId" required><option value="">Choose incident to review</option></select><textarea name="principalReview" placeholder="Principal review"></textarea><input name="signingPin" type="password" placeholder="Signing PIN" required><div><span class="form-label">Principal signature</span><canvas id="lfDsdPrincipalSignature" class="signature-pad" width="520" height="140"></canvas><button type="button" class="action-btn btn-blue" onclick="clearLittleFeetCoreSignature(\'lfDsdPrincipalSignature\')">Clear signature</button></div><button class="submit-btn">Sign principal review</button></form></div>':'';
    const parentForm=user()?.role==='parent'?'<div class="workspace-card" style="margin-top:16px;"><h3>Parent acknowledgement</h3><p class="meta">Choose an incident reviewed by the principal, read it, then sign it.</p><form id="lfDsdParentForm" class="workspace-grid"><select id="lfDsdParentIncident" name="incidentId" required><option value="">Choose incident to acknowledge</option></select><textarea name="acknowledgement" placeholder="Parent note or acknowledgement">Acknowledged</textarea><input name="signingPin" type="password" placeholder="Signing PIN" required><div><span class="form-label">Parent signature</span><canvas id="lfDsdParentSignature" class="signature-pad" width="520" height="140"></canvas><button type="button" class="action-btn btn-blue" onclick="clearLittleFeetCoreSignature(\'lfDsdParentSignature\')">Clear signature</button></div><button class="submit-btn">Acknowledge incident</button></form></div>':'';
    const card=addCard(target,'lfDsdIncidentCard','<div class="card-header-bar"><div><h2>DSD Incident & Injury Form</h2><p class="meta">Real incident record with body areas, treatment, parent notice, review, signatures and private evidence files.</p></div><span class="badge-tag info">DSD INCIDENT RECORD</span></div>'+staffForm+principalForm+parentForm+'<h3 class="workspace-heading">Incident records</h3><div id="lfDsdIncidentList" class="record-list"></div>');
    if(!card)return;
    ['lfDsdStaffSignature','lfDsdPrincipalSignature','lfDsdParentSignature'].forEach(attachSignatureCanvas);
    const form=card.querySelector('#lfDsdIncidentForm');
    form?.addEventListener('submit',async e=>{e.preventDefault();try{
      const body=formBody(e.currentTarget);
      body.bodyRegions=[...e.currentTarget.querySelectorAll('input[name="bodyRegions"]:checked')].map(x=>x.value);
      body.bloodPresent=Boolean(e.currentTarget.elements.bloodPresent?.checked);
      const sig=SIGNATURES.lfDsdStaffSignature;if(sig?.has())body.signatureData=sig.data();
      const created=await api('/api/dsd-incidents',{method:'POST',body:JSON.stringify(body)});
      const files=[...(document.getElementById('lfDsdPhotos')?.files||[])];
      for(const file of files){
        try{await api('/api/files',{method:'POST',body:JSON.stringify({entityType:'dsd_incident',recordId:created.incident.id,purpose:'incident-evidence',originalFilename:file.name,dataUrl:await toDataUrl(file)})});}
        catch(err){alert('Incident saved. One evidence file was not uploaded: '+err.message);break;}
      }
      e.currentTarget.reset();sig?.clear();e.currentTarget.elements.incidentDate.value=new Date().toISOString().slice(0,10);await refreshDsdIncidents();
    }catch(err){alert(err.message);}});
    card.querySelector('#lfDsdPrincipalForm')?.addEventListener('submit',async e=>{e.preventDefault();try{
      const body=formBody(e.currentTarget),sig=SIGNATURES.lfDsdPrincipalSignature;if(!sig?.has())return alert('Add principal signature.');
      body.signatureData=sig.data();const id=body.incidentId;delete body.incidentId;
      await api('/api/dsd-incidents/'+encodeURIComponent(id)+'/principal-sign',{method:'POST',body:JSON.stringify(body)});
      e.currentTarget.reset();sig.clear();await refreshDsdIncidents();
    }catch(err){alert(err.message);}});
    card.querySelector('#lfDsdParentForm')?.addEventListener('submit',async e=>{e.preventDefault();try{
      const body=formBody(e.currentTarget),sig=SIGNATURES.lfDsdParentSignature;if(!sig?.has())return alert('Add parent signature.');
      body.signatureData=sig.data();const id=body.incidentId;delete body.incidentId;
      await api('/api/dsd-incidents/'+encodeURIComponent(id)+'/parent-acknowledge',{method:'POST',body:JSON.stringify(body)});
      e.currentTarget.reset();sig.clear();await refreshDsdIncidents();
    }catch(err){alert(err.message);}});
    if(form)form.elements.incidentDate.value=new Date().toISOString().slice(0,10);
    refreshDsdIncidents().catch(()=>{});
  }

  async function refreshAttendanceUpgrade(){
    const host=document.getElementById('lfAttendanceInsights'),form=document.getElementById('lfAttendanceSettings');if(!host)return;
    const data=await api('/api/attendance/insights?days=30');
    if(form&&management()){form.elements.cutoffTime.value=data.settings.cutoffTime||'09:00';form.elements.autoAbsent.checked=Boolean(data.settings.autoAbsent);form.elements.notifyParents.checked=Boolean(data.settings.notifyParents);form.elements.remindStaff.checked=Boolean(data.settings.remindStaff);}
    const dates=Object.entries(data.byDate||{}).sort((a,b)=>b[0].localeCompare(a[0])).slice(0,14);
    host.innerHTML=dates.length?dates.map(([date,row])=>{const present=(row.Present||0)+(row['Checked In']||0),absent=row.Absent||0,late=row.Late||0,total=Math.max(1,present+absent+late+(row.Excused||0)),rate=Math.round((present/total)*100);return '<div class="item-row"><div style="width:100%;"><strong>'+esc(date)+'</strong><span style="float:right;">'+esc(rate)+'% present</span><progress max="100" value="'+esc(rate)+'" style="width:100%;"></progress><span class="meta">Present '+esc(present)+' · Absent '+esc(absent)+' · Late '+esc(late)+'</span></div></div>';}).join(''):'<p class="meta">No attendance history yet.</p>';
  }
  function setupAttendanceUpgrade(){
    if(!staff())return;
    const card=addCard('attendanceTab','lfSmartAttendanceCard','<div class="card-header-bar"><div><h2>Smart Attendance</h2><p class="meta">Keeps the current register and adds a real cutoff, auto-absent run, parent email and 30-day view.</p></div><span class="badge-tag info">AUTOMATION</span></div>'+(management()?'<form id="lfAttendanceSettings" class="workspace-grid"><label>Attendance cutoff<input name="cutoffTime" type="time" value="09:00" required></label><label><input name="autoAbsent" type="checkbox"> Auto mark missing learners absent after cutoff</label><label><input name="notifyParents" type="checkbox"> Email linked parent when auto-absent is created</label><label><input name="remindStaff" type="checkbox"> Email school staff when learners are still missing after cutoff</label><button class="submit-btn">Save attendance rules</button></form>':'')+'<button id="lfRunAttendanceNow" type="button" class="action-btn btn-blue">Run smart attendance now</button><div id="lfAttendanceInsights" class="record-list"></div>');
    if(!card)return;
    card.querySelector('#lfAttendanceSettings')?.addEventListener('submit',async e=>{e.preventDefault();try{const body={cutoffTime:e.currentTarget.elements.cutoffTime.value,autoAbsent:e.currentTarget.elements.autoAbsent.checked,notifyParents:e.currentTarget.elements.notifyParents.checked,remindStaff:e.currentTarget.elements.remindStaff.checked};await api('/api/attendance/automation/settings',{method:'PUT',body:JSON.stringify(body)});await refreshAttendanceUpgrade();}catch(err){alert(err.message);}});
    card.querySelector('#lfRunAttendanceNow').addEventListener('click',async()=>{try{const result=await api('/api/attendance/automation/run',{method:'POST',body:'{}'});alert('Created '+result.created+' absence record(s).'+(result.skipped?' '+result.skipped:''));await refreshAttendanceUpgrade();window.loadAttendance?.();}catch(err){alert(err.message);}});
    refreshAttendanceUpgrade().catch(()=>{});
  }

  function start(){
    if(!user()) return;
    setupMarks();
    setupReportCards();
    setupDiscipline();
    setupAssets();
    setupCommunication();
    setupGradeR();
    setupDsdIncidents();
    setupAttendanceUpgrade();
  }
  document.addEventListener('littlefeet:session-ready',()=>setTimeout(start,0));
  window.addEventListener('DOMContentLoaded',()=>setTimeout(start,0));
})();