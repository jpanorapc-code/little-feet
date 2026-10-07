(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const user=()=>window.getLittleFeetCurrentUser?.()||null;
  const full=()=>Boolean(user()&&window.isLittleFeetFullAccessUser?.(user()));
  const staff=()=>Boolean(user()&&(full()||['teacher','principal','admin','staff','school_accounts'].includes(String(user().role||'').toLowerCase())));
  const management=()=>Boolean(user()&&(full()||['principal','admin','staff','school_accounts'].includes(String(user().role||'').toLowerCase())));
  const api=async(url,options={})=>{const response=await fetch(url,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});const text=await response.text();let data={};try{data=text?JSON.parse(text):{};}catch{data={message:text};}if(!response.ok)throw new Error(data.message||'Request failed.');return data;};
  const body=form=>Object.fromEntries(new FormData(form).entries());
  const mountCard=(tabId,id,html)=>{
    const tab=document.getElementById(tabId);if(!tab||document.getElementById(id))return null;
    const card=document.createElement('div');card.id=id;card.className='card';card.innerHTML=html;tab.appendChild(card);return card;
  };
  const message=(id,text,kind='')=>{const el=document.getElementById(id);if(el){el.textContent=text;el.className='meta'+(kind?' '+kind:'');}};
  const waitAlert=error=>alert(error?.message||String(error));

  async function refreshElda(){
    const status=document.getElementById('lfEldaStatus'),list=document.getElementById('lfEldaSummary');if(!status||!list)return;
    const catalogue=await api('/api/elda/catalogue');
    status.innerHTML='<strong>'+catalogue.total+'</strong> skills loaded · engine capacity '+catalogue.capacity+(catalogue.complete?' · full catalogue loaded':' · official/licensed catalogue still incomplete');
    const learner=document.getElementById('lfEldaLearner')?.value.trim();
    if(!learner){list.innerHTML='<p class="meta">Enter a learner to view ELDA progress.</p>';return;}
    try{const summary=await api('/api/elda/summary/'+encodeURIComponent(learner));list.innerHTML=Object.entries(summary.areas||{}).map(([area,row])=>'<div class="item-row"><div><strong>'+esc(area)+'</strong><p>'+row.assessed+' / '+row.skills+' assessed · average '+row.average+'/4</p></div></div>').join('')||'<p class="meta">No ELDA skills loaded yet.</p>';}catch(error){list.innerHTML='<p class="meta">'+esc(error.message)+'</p>';}
  }
  async function importEldaFile(file){
    if(!file)return;
    let rows=[];
    if(/\.csv$/i.test(file.name)){
      const text=await file.text(),lines=text.split(/\r?\n/).filter(Boolean),headers=lines.shift().split(',').map(x=>x.trim().toLowerCase());
      rows=lines.map(line=>{const cells=line.split(',');const row={};headers.forEach((h,i)=>row[h]=String(cells[i]||'').trim());return {code:row.code,label:row.label,area:row.area,ageBand:row.ageband||row.age_band,phase:row.phase,source:row.source};});
    }else if(window.XLSX){
      const bytes=await file.arrayBuffer(),book=XLSX.read(bytes),sheet=book.Sheets[book.SheetNames[0]];
      rows=XLSX.utils.sheet_to_json(sheet,{defval:''}).map(row=>({code:row.Code||row.code,label:row.Label||row.label,area:row.Area||row.area,ageBand:row['Age Band']||row.ageBand||row.ageband,phase:row.Phase||row.phase,source:row.Source||row.source}));
    }else throw new Error('Excel parser is not available. Use CSV.');
    const result=await api('/api/elda/catalogue/import',{method:'POST',body:JSON.stringify({rows})});
    alert('ELDA catalogue import: '+result.created+' created, '+result.updated+' updated.');await refreshElda();
  }
  function setupElda(){
    if(!staff())return;
    const card=mountCard('progressTab','lfAdvancedEldaCard','<div class="card-header-bar"><div><h2>ELDA Development Engine</h2><p class="meta">Real NCF Birth–4 catalogue, observations and developmental progress. Import only an official or licensed skill catalogue.</p></div><span class="badge-tag info">ELDA</span></div><div id="lfEldaStatus" class="meta">Loading catalogue…</div><div class="workspace-grid" style="margin-top:12px;"><label>Official/licensed catalogue<input id="lfEldaImport" type="file" accept=".xlsx,.xls,.csv"></label><input id="lfEldaLearner" placeholder="Learner name"><button id="lfEldaRefresh" type="button" class="action-btn btn-blue">View learner progress</button></div><form id="lfEldaAssessmentForm" class="workspace-grid" style="margin-top:12px;"><input name="learnerName" placeholder="Learner name" required><select name="skillId" id="lfEldaSkill" required><option value="">Load a catalogue first</option></select><select name="rating" required><option value="1">1 · Emerging</option><option value="2">2 · Developing</option><option value="3">3 · Consistent</option><option value="4">4 · Secure</option></select><input name="observedAt" type="date"><textarea name="evidence" placeholder="Observation evidence"></textarea><button class="submit-btn">Save ELDA observation</button></form><div id="lfEldaSummary" class="record-list"></div>');
    if(!card)return;
    const loadSkills=async()=>{const data=await api('/api/elda/catalogue');const select=card.querySelector('#lfEldaSkill');select.innerHTML=data.skills.length?data.skills.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.code)+' · '+esc(s.label)+'</option>').join(''):'<option value="">No catalogue loaded</option>';};
    card.querySelector('#lfEldaImport').addEventListener('change',e=>importEldaFile(e.target.files?.[0]).then(loadSkills).catch(waitAlert));
    card.querySelector('#lfEldaRefresh').addEventListener('click',()=>refreshElda().catch(waitAlert));
    card.querySelector('#lfEldaAssessmentForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/elda/assessments',{method:'POST',body:JSON.stringify(body(e.currentTarget))});e.currentTarget.reset();await refreshElda();}catch(error){waitAlert(error);}});
    Promise.all([loadSkills(),refreshElda()]).catch(()=>{});
  }

  async function refreshAftercare(){
    const list=document.getElementById('lfAftercareList');if(!list)return;
    const [settings,sessions]=await Promise.all([api('/api/aftercare/settings'),api('/api/aftercare/sessions')]);
    document.getElementById('lfAftercareClose').value=settings.closeTime||'17:30';
    document.getElementById('lfAftercareLateFee').value=settings.lateFeePer15Minutes??0;
    document.getElementById('lfAftercareRate').value=settings.defaultDailyRate??0;
    list.innerHTML=sessions.slice(0,40).map(row=>'<div class="item-row"><div><strong>'+esc(row.learnerName)+'</strong><p>'+esc(row.date)+' · '+(row.checkOutAt?'Checked out':'Currently in aftercare')+(row.lateFee?' · late fee R'+Number(row.lateFee).toFixed(2):'')+'</p><span class="meta">'+esc(row.billingStatus||'')+'</span></div>'+(row.checkOutAt?'':'<button type="button" class="action-btn btn-blue" onclick="checkoutLittleFeetAftercare(\''+esc(row.id)+'\')">Check out</button>')+'</div>').join('')||'<p class="meta">No aftercare sessions yet.</p>';
  }
  window.checkoutLittleFeetAftercare=async id=>{try{await api('/api/aftercare/sessions/'+encodeURIComponent(id)+'/check-out',{method:'POST',body:'{}'});await refreshAftercare();await refreshRatio();}catch(error){waitAlert(error);}};
  function setupAftercare(){
    if(!staff())return;
    const card=mountCard('attendanceTab','lfAftercareCard','<div class="card-header-bar"><div><h2>Aftercare Management</h2><p class="meta">Plans, afternoon check-in/out, late pickup calculation and real parent billing when school payment setup is available.</p></div><span class="badge-tag info">AFTERCARE</span></div>'+(management()?'<form id="lfAftercareSettings" class="workspace-grid"><label>Close time<input id="lfAftercareClose" name="closeTime" type="time" required></label><label>Late fee per 15 minutes<input id="lfAftercareLateFee" name="lateFeePer15Minutes" type="number" min="0" step="0.01"></label><label>Default daily rate<input id="lfAftercareRate" name="defaultDailyRate" type="number" min="0" step="0.01"></label><button class="submit-btn">Save aftercare rules</button></form>':'')+'<form id="lfAftercareCheckIn" class="workspace-grid"><input name="learnerName" placeholder="Learner name" required><button class="submit-btn">Check learner into aftercare</button></form><div id="lfAftercareList" class="record-list"></div>');
    if(!card)return;
    card.querySelector('#lfAftercareSettings')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/aftercare/settings',{method:'PUT',body:JSON.stringify(body(e.currentTarget))});await refreshAftercare();}catch(error){waitAlert(error);}});
    card.querySelector('#lfAftercareCheckIn').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/aftercare/check-in',{method:'POST',body:JSON.stringify(body(e.currentTarget))});e.currentTarget.reset();await refreshAftercare();await refreshRatio();}catch(error){waitAlert(error);}});
    refreshAftercare().catch(()=>{});
  }

  async function refreshRatio(){
    const host=document.getElementById('lfRatioLive');if(!host)return;
    const data=await api('/api/staff-ratio/live');
    host.innerHTML='<div class="item-row"><div><strong>'+data.children+' children · '+data.activeStaff+' active staff</strong><p>Rule: max '+data.maxChildrenPerStaff+' children per active staff · required '+data.requiredStaff+'</p><span class="meta">'+(data.withinRatio?'Within configured ratio':'SHORTFALL: '+data.shortfall+' staff')+'</span></div></div>';
  }
  function setupRatio(){
    if(!staff())return;
    const card=mountCard('attendanceTab','lfStaffRatioCard','<div class="card-header-bar"><div><h2>Live Staff-to-Child Ratio</h2><p class="meta">Uses today\'s present learners, active aftercare children and staff clock status.</p></div><span class="badge-tag info">RATIO</span></div>'+(management()?'<form id="lfRatioSettings" class="workspace-grid"><label>Maximum children per active staff<input name="maxChildrenPerStaff" type="number" min="1" max="50" value="10"></label><button class="submit-btn">Save ratio rule</button></form>':'')+'<button id="lfRefreshRatio" type="button" class="action-btn btn-blue">Refresh live ratio</button><div id="lfRatioLive" class="record-list"></div>');
    if(!card)return;
    if(management())api('/api/staff-ratio/settings').then(x=>{card.querySelector('[name="maxChildrenPerStaff"]').value=x.maxChildrenPerStaff;}).catch(()=>{});
    card.querySelector('#lfRatioSettings')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/staff-ratio/settings',{method:'PUT',body:JSON.stringify(body(e.currentTarget))});await refreshRatio();}catch(error){waitAlert(error);}});
    card.querySelector('#lfRefreshRatio').addEventListener('click',()=>refreshRatio().catch(waitAlert));refreshRatio().catch(()=>{});
  }

  async function refreshClock(){
    const host=document.getElementById('lfStaffClockList');if(!host||!management())return;
    const rows=await api('/api/staff-clock');host.innerHTML=rows.slice(0,30).map(r=>'<div class="item-row"><div><strong>'+esc(r.name||r.username)+'</strong><p>'+esc(r.date)+' · '+esc(r.status)+'</p><span class="meta">'+esc(r.clockInAt||'')+(r.clockOutAt?' → '+esc(r.clockOutAt):'')+'</span></div></div>').join('')||'<p class="meta">No clock records yet.</p>';
  }
  function setupClock(){
    if(!staff())return;
    const card=mountCard('staffWorkTab','lfStaffClockCard','<div class="card-header-bar"><div><h2>Staff Clock-In Kiosk</h2><p class="meta">Clock in, step out, return and clock out. Management can view the live shift ledger.</p></div><span class="badge-tag info">TIMECARD</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button data-clock="clock_in" class="action-btn btn-green" type="button">Clock in</button><button data-clock="step_out" class="action-btn btn-blue" type="button">Step out</button><button data-clock="return" class="action-btn btn-blue" type="button">Return</button><button data-clock="clock_out" class="action-btn btn-red" type="button">Clock out</button></div>'+(management()?'<div id="lfStaffClockList" class="record-list" style="margin-top:12px;"></div>':''));
    if(!card)return;
    card.querySelectorAll('[data-clock]').forEach(btn=>btn.addEventListener('click',async()=>{try{await api('/api/staff-clock/action',{method:'POST',body:JSON.stringify({action:btn.dataset.clock})});await refreshClock();await refreshRatio();}catch(error){waitAlert(error);}}));refreshClock().catch(()=>{});
  }

  async function refreshDayCare(){
    const host=document.getElementById('lfDayCareList');if(!host)return;const rows=await api('/api/day-care/bookings');host.innerHTML=rows.slice(0,40).map(r=>'<div class="item-row"><div><strong>'+esc(r.childName)+'</strong><p>'+esc(r.className)+' · '+esc(r.date)+' · '+esc(r.status)+'</p><span class="meta">R'+Number(r.rate||0).toFixed(2)+'</span></div></div>').join('')||'<p class="meta">No temporary-care bookings yet.</p>';
  }
  function setupDayCare(){
    if(!staff())return;
    const card=mountCard('operationsTab','lfDayCareCard','<div class="card-header-bar"><div><h2>Day Visitor & Holiday Care</h2><p class="meta">Book individual care days with class capacity and automatic waiting-list status.</p></div><span class="badge-tag info">CARE BOOKING</span></div><form id="lfDayCareForm" class="workspace-grid"><input name="childName" placeholder="Child name" required><input name="className" placeholder="Class / group" required><input name="date" type="date" required><input name="rate" type="number" min="0" step="0.01" placeholder="Daily rate"><input name="parentUsername" placeholder="Parent username if applicable"><button class="submit-btn">Create booking</button></form><div id="lfDayCareList" class="record-list"></div>');
    if(!card)return;card.querySelector('#lfDayCareForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/day-care/bookings',{method:'POST',body:JSON.stringify(body(e.currentTarget))});e.currentTarget.reset();await refreshDayCare();}catch(error){waitAlert(error);}});refreshDayCare().catch(()=>{});
  }

  async function refreshMeals(){
    const host=document.getElementById('lfMealList');if(!host)return;const plans=await api('/api/meals/plans');host.innerHTML=plans.slice(0,20).map(r=>'<div class="item-row"><div><strong>'+esc(r.date)+' · '+esc(r.meal)+'</strong><p>'+esc(r.menu)+'</p></div></div>').join('')||'<p class="meta">No meal plans yet.</p>';
  }
  function setupMeals(){
    if(!staff())return;
    const card=mountCard('operationsTab','lfMealsCard','<div class="card-header-bar"><div><h2>Meals & Nutrition</h2><p class="meta">Weekly/daily menu planning, learner dietary requirements and kitchen headcounts.</p></div><span class="badge-tag info">KITCHEN</span></div>'+(management()?'<form id="lfMealPlanForm" class="workspace-grid"><input name="date" type="date" required><input name="meal" placeholder="Meal, e.g. Lunch" required><input name="menu" placeholder="Menu" required><textarea name="notes" placeholder="Kitchen notes"></textarea><button class="submit-btn">Save meal plan</button></form>':'')+'<form id="lfDietaryForm" class="workspace-grid"><input name="learnerName" placeholder="Learner name" required><input name="allergies" placeholder="Allergies"><input name="requirements" placeholder="Dietary requirements"><textarea name="notes" placeholder="Notes"></textarea><button class="submit-btn">Save dietary profile</button></form><button id="lfKitchenCounts" type="button" class="action-btn btn-blue">Show today\'s kitchen count</button><p id="lfKitchenCountText" class="meta"></p><div id="lfMealList" class="record-list"></div>');
    if(!card)return;card.querySelector('#lfMealPlanForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/meals/plans',{method:'POST',body:JSON.stringify(body(e.currentTarget))});e.currentTarget.reset();await refreshMeals();}catch(error){waitAlert(error);}});card.querySelector('#lfDietaryForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/meals/dietary',{method:'POST',body:JSON.stringify(body(e.currentTarget))});e.currentTarget.reset();}catch(error){waitAlert(error);}});card.querySelector('#lfKitchenCounts').addEventListener('click',async()=>{try{const x=await api('/api/meals/kitchen-counts');message('lfKitchenCountText',x.totalMeals+' meals today · '+x.dietaryCount+' with dietary requirements');}catch(error){waitAlert(error);}});refreshMeals().catch(()=>{});
  }

  async function refreshGroups(){
    const host=document.getElementById('lfLearnerGroupList');if(!host)return;const rows=await api('/api/learner-groups');window.__lfLearnerGroups=rows;host.innerHTML=rows.map(r=>'<div class="item-row"><div><strong>'+esc(r.name)+'</strong><p>'+esc(r.type)+' · '+(r.members||[]).length+' learner(s)</p><span class="meta">'+esc((r.members||[]).join(', '))+'</span></div></div>').join('')||'<p class="meta">No learner groups yet.</p>';
  }
  function setupGroups(){
    if(!staff())return;const card=mountCard('operationsTab','lfLearnerGroupsCard','<div class="card-header-bar"><div><h2>Learner Groups</h2><p class="meta">Create sports teams, societies, tour groups and any other learner grouping outside normal classes.</p></div><span class="badge-tag info">GROUPS</span></div><form id="lfLearnerGroupForm" class="workspace-grid"><input name="name" placeholder="Group name" required><input name="type" placeholder="Type, e.g. Soccer / Society / Tour" required><button class="submit-btn">Create group</button></form><form id="lfGroupMembersForm" class="workspace-grid"><select name="groupId" id="lfGroupSelect"></select><textarea name="members" placeholder="Learner names, one per line"></textarea><button class="submit-btn">Save group members</button></form><div id="lfLearnerGroupList" class="record-list"></div>');if(!card)return;
    const syncSelect=async()=>{await refreshGroups();card.querySelector('#lfGroupSelect').innerHTML=(window.__lfLearnerGroups||[]).map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join('');};
    card.querySelector('#lfLearnerGroupForm').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/learner-groups',{method:'POST',body:JSON.stringify(body(e.currentTarget))});e.currentTarget.reset();await syncSelect();}catch(error){waitAlert(error);}});
    card.querySelector('#lfGroupMembersForm').addEventListener('submit',async e=>{e.preventDefault();try{const data=body(e.currentTarget),names=String(data.members||'').split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean);await api('/api/learner-groups/'+encodeURIComponent(data.groupId)+'/members',{method:'POST',body:JSON.stringify({learnerNames:names})});await syncSelect();}catch(error){waitAlert(error);}});syncSelect().catch(()=>{});
  }

  async function refreshAcademicAnalytics(){
    const host=document.getElementById('lfAdvancedAnalyticsList');if(!host)return;const term=document.getElementById('lfAnalyticsTerm')?.value.trim()||'',subject=document.getElementById('lfAnalyticsSubject')?.value.trim()||'',data=await api('/api/academics/analytics?term='+encodeURIComponent(term)+'&subject='+encodeURIComponent(subject));
    host.innerHTML='<h4>Learner ranking</h4>'+data.learners.slice(0,50).map(r=>'<div class="item-row"><div><strong>#'+r.rank+' '+esc(r.learnerName)+'</strong><p>'+r.average+'% · '+esc(r.outcome)+' · '+r.assessments+' assessment(s)</p></div></div>').join('')+'<h4 style="margin-top:14px;">Subject distribution</h4>'+data.subjectDistribution.map(r=>'<div class="item-row"><div><strong>'+esc(r.subject)+'</strong><p>Average '+r.average+'% · '+r.distinctions+' distinction(s) · '+r.failures+' below pass mark</p></div></div>').join('');
  }
  function setupAcademicAnalytics(){
    if(!staff())return;const card=mountCard('analyticsTab','lfAdvancedAcademicAnalytics','<div class="card-header-bar"><div><h2>Academic Ranking & Distribution</h2><p class="meta">Grade ranking, distinctions, learners below the configured pass mark and subject distributions from real subject marks.</p></div><span class="badge-tag info">ACADEMIC</span></div><div class="workspace-grid"><input id="lfAnalyticsTerm" placeholder="Term filter (optional)"><input id="lfAnalyticsSubject" placeholder="Subject filter (optional)"><button id="lfRunAdvancedAnalytics" type="button" class="action-btn btn-blue">Run analysis</button></div><div id="lfAdvancedAnalyticsList" class="record-list"></div>');if(!card)return;card.querySelector('#lfRunAdvancedAnalytics').addEventListener('click',()=>refreshAcademicAnalytics().catch(waitAlert));refreshAcademicAnalytics().catch(()=>{});
  }

  async function refreshPickupPasses(){
    const host=document.getElementById('lfPickupPassList');if(!host)return;const rows=await api('/api/pickup-passes');host.innerHTML=rows.slice(0,30).map(r=>'<div class="item-row"><div><strong>'+esc(r.learnerName)+'</strong><p>'+esc(r.collectorName||'Parent/guardian')+' · '+esc(r.status)+'</p><span class="meta">Expires '+esc(r.expiresAt)+'</span></div></div>').join('')||'<p class="meta">No active/recent pickup passes.</p>';
  }
  function setupPickupPass(){
    const u=user();if(!u||!(u.role==='parent'||management()))return;const target=u.role==='parent'?'safeguardingTab':'safeguardingTab';const card=mountCard(target,'lfPickupQrCard','<div class="card-header-bar"><div><h2>Parent QR Pickup Pass</h2><p class="meta">Creates a one-time short-lived pickup token. Only its hash is stored after creation.</p></div><span class="badge-tag info">PICKUP</span></div><form id="lfPickupPassForm" class="workspace-grid"><input name="learnerName" placeholder="Learner name" required><input name="collectorName" placeholder="Collector name"><input name="expiresMinutes" type="number" min="5" max="720" value="60"><button class="submit-btn">Create pickup pass</button></form><div id="lfPickupQrOutput"></div><div id="lfPickupPassList" class="record-list"></div>');if(!card)return;
    card.querySelector('#lfPickupPassForm').addEventListener('submit',async e=>{e.preventDefault();try{const result=await api('/api/pickup-passes',{method:'POST',body:JSON.stringify(body(e.currentTarget))});const out=card.querySelector('#lfPickupQrOutput');out.innerHTML='<div class="workspace-card"><strong>One-time pickup token</strong><p class="meta">Show this QR/token at collection. It expires automatically and can only be used once.</p><div id="lfPickupQrCanvas"></div><code style="word-break:break-all;">'+esc(result.pass.token)+'</code></div>';if(window.QRCode)new QRCode(out.querySelector('#lfPickupQrCanvas'),{text:result.pass.token,width:180,height:180});await refreshPickupPasses();}catch(error){waitAlert(error);}});refreshPickupPasses().catch(()=>{});
  }

  function setupMultiSite(){
    if(!full())return;const card=mountCard('homeTab','lfMultiSiteCard','<div class="card-header-bar"><div><h2>Multi-Site School Group</h2><p class="meta">Platform-level owner view across selected Little Feet school tenants. Cross-school access remains restricted to Little Feet platform roles.</p></div><span class="badge-tag info">MULTI-SITE</span></div><form id="lfSchoolGroupForm" class="workspace-grid"><input name="name" placeholder="Group name" required><textarea name="schoolIds" placeholder="School IDs, one per line" required></textarea><button class="submit-btn">Create school group</button></form><select id="lfSchoolGroupSelect"></select><button id="lfLoadSchoolGroup" type="button" class="action-btn btn-blue">Load group dashboard</button><div id="lfSchoolGroupDashboard" class="record-list"></div>');if(!card)return;
    const refresh=async()=>{const groups=await api('/api/school-groups');card.querySelector('#lfSchoolGroupSelect').innerHTML=groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join('');};
    card.querySelector('#lfSchoolGroupForm').addEventListener('submit',async e=>{e.preventDefault();try{const d=body(e.currentTarget),schoolIds=String(d.schoolIds).split(/\r?\n|,/).map(x=>x.trim()).filter(Boolean);await api('/api/school-groups',{method:'POST',body:JSON.stringify({name:d.name,schoolIds})});e.currentTarget.reset();await refresh();}catch(error){waitAlert(error);}});
    card.querySelector('#lfLoadSchoolGroup').addEventListener('click',async()=>{try{const id=card.querySelector('#lfSchoolGroupSelect').value;if(!id)return;const d=await api('/api/school-groups/'+encodeURIComponent(id)+'/dashboard');card.querySelector('#lfSchoolGroupDashboard').innerHTML=d.sites.map(s=>'<div class="item-row"><div><strong>'+esc(s.schoolName)+'</strong><p>'+s.learners+' learners · '+s.presentToday+' present today · '+s.staff+' staff · '+s.dayCareBookingsToday+' day-care bookings</p></div></div>').join('');}catch(error){waitAlert(error);}});refresh().catch(()=>{});
  }

  function setupAdvancedSchoolOperations(){
    setupElda();setupAftercare();setupRatio();setupClock();setupDayCare();setupMeals();setupGroups();setupAcademicAnalytics();setupPickupPass();setupMultiSite();
  }
  document.addEventListener('littlefeet:session-ready',setupAdvancedSchoolOperations);
  window.addEventListener('DOMContentLoaded',()=>setTimeout(setupAdvancedSchoolOperations,900));
})();