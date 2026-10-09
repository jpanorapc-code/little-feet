(function () {
  'use strict';
let sessionGeneration=0;
const staleSession=()=>Object.assign(new Error('Your session changed. Please refresh this screen.'),{code:'SESSION_CHANGED'});
document.addEventListener('littlefeet:session-ended',()=>{sessionGeneration++;user=null;accounts=[];["staffWorkContent"].forEach(id=>document.getElementById(id)?.replaceChildren());});

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let user = null, accounts = [];

  const api = async (url, options={}) => {
    const generation=sessionGeneration;
    const response = await fetch(url, { credentials:'same-origin', ...options, headers:{ Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(()=>({}));
    if(generation!==sessionGeneration)throw staleSession();
    if (!response.ok) throw new Error(data.message || 'Request failed.');
    return data;
  };
  const optionList = (roles=['teacher','principal','admin','school_accounts','school_hr','school_staff','staff','crm','accounts','support']) => accounts.filter(a=>roles.includes(a.role)).map(a=>`<option value="${esc(a.username)}">${esc(a.name || a.username)} · ${esc(a.role)}</option>`).join('');

  const render = async () => {
    const selectedMonth = document.getElementById('staffKpiMonth')?.value || new Date().toISOString().slice(0,7);
    const [tasks, leave, cover, reviews, kpi] = await Promise.all([api('/api/staff/tasks'),api('/api/staff/leave'),(['school_staff','school_hr','staff','crm','accounts','support'].includes(user.role) ? Promise.resolve([]) : api('/api/staff/cover')),api('/api/staff/performance-reviews'),api('/api/staff/kpi-monthly?month='+encodeURIComponent(selectedMonth))]);
    const root=document.getElementById('staffWorkContent'); if(!root) return;
    const manager=(window.isLittleFeetFullAccessUser?.(user) || ['admin','principal','school_hr'].includes(user.role));
    root.innerHTML=`
      <div class="staff-work-grid">
        <section class="staff-work-card"><h3>Staff Tasks</h3>
          <form id="staffTaskForm"><input name="title" maxlength="180" placeholder="What needs to be done?" required>
          ${manager?`<select name="assignedTo" required><option value="">Assign to…</option>${optionList()}</select>`:''}
          <input name="dueDate" type="date"><select name="priority"><option>Normal</option><option>High</option><option>Urgent</option></select>
          <textarea name="details" maxlength="3000" placeholder="Details (optional)"></textarea><button class="submit-btn">Add task</button></form>
          <div class="staff-work-list">${tasks.length?tasks.map(t=>`<article><strong>${esc(t.title)}</strong><span>${esc(t.assignedToName||t.assignedTo)} · ${esc(t.priority)}${t.dueDate?' · due '+esc(t.dueDate):''}</span><select data-task="${esc(t.id)}"><option ${t.status==='Open'?'selected':''}>Open</option><option ${t.status==='In Progress'?'selected':''}>In Progress</option><option ${t.status==='Completed'?'selected':''}>Completed</option></select></article>`).join(''):'<p>No staff tasks yet.</p>'}</div>
        </section>
        <section class="staff-work-card"><h3>Leave & Absence</h3>
          <form id="staffLeaveForm"><select name="leaveType"><option>Annual leave</option><option>Sick leave</option><option>Family responsibility</option><option>Training</option><option>Other</option></select><input name="startDate" type="date" required><input name="endDate" type="date" required><textarea name="reason" maxlength="1500" placeholder="Reason / note"></textarea><button class="submit-btn">Request leave</button></form>
          <div class="staff-work-list">${leave.length?leave.map(l=>`<article><strong>${esc(l.staffName)} · ${esc(l.leaveType)}</strong><span>${esc(l.startDate)} → ${esc(l.endDate)} · ${esc(l.status)}</span>${manager&&l.status==='Pending'?`<div><button data-leave="${esc(l.id)}" data-status="Approved">Approve</button><button data-leave="${esc(l.id)}" data-status="Rejected">Reject</button></div>`:''}</article>`).join(''):'<p>No leave requests yet.</p>'}</div>
        </section>
        <section class="staff-work-card"><h3>Teacher Cover</h3>
          ${manager?`<form id="staffCoverForm"><select name="absentTeacher" required><option value="">Absent teacher…</option>${optionList(['teacher'])}</select><select name="coverTeacher"><option value="">Needs cover</option>${optionList(['teacher'])}</select><input name="date" type="date" required><input name="period" placeholder="Period / time"><input name="className" placeholder="Class"><textarea name="notes" maxlength="1500" placeholder="Cover notes"></textarea><button class="submit-btn">Create cover</button></form>`:''}
          <div class="staff-work-list">${cover.length?cover.map(x=>`<article><strong>${esc(x.absentTeacherName)} · ${esc(x.className||'Class')}</strong><span>${esc(x.date)}${x.period?' · '+esc(x.period):''} · ${x.coverTeacherName?'Cover: '+esc(x.coverTeacherName):'Needs cover'} · ${esc(x.status)}</span>${x.coverTeacher===user.username&&x.status==='Assigned'?`<button data-cover="${esc(x.id)}">Mark completed</button>`:''}</article>`).join(''):'<p>No teacher cover records yet.</p>'}</div>
        </section>
        <section class="staff-work-card staff-kpi-dashboard"><h3>Monthly KPI scoreboard</h3>
          <label>Month <input id="staffKpiMonth" type="month" value="${esc(kpi.month)}"></label>
          <div class="staff-kpi-scoreboard">${kpi.rows.length?kpi.rows.map(row=>`<article><strong>#${row.rank} · ${esc(row.staffName)}</strong><span>${row.completed}/${row.total} tasks completed · ${row.completionRate}% · ${esc(row.band)}</span><div class="staff-kpi-bar"><i style="width:${Math.max(0,Math.min(100,row.completionRate))}%"></i></div></article>`).join(''):'<p>No assigned tasks for this month yet.</p>'}</div>
          <div class="staff-kpi-graph" aria-label="Monthly task completion graph">${kpi.rows.map(row=>`<div title="${esc(row.staffName)}: ${row.completionRate}%"><span>${esc(row.staffName)}</span><b><i style="height:${Math.max(3,row.completionRate)}%"></i></b><em>${row.completionRate}%</em></div>`).join('')}</div>
        </section>
        <section class="staff-work-card"><h3>Performance Reviews · KPI</h3>
          ${manager?`<form id="staffKpiForm"><select name="username" required><option value="">Staff member…</option>${optionList()}</select><input name="reviewPeriod" type="month" value="${esc(kpi.month)}" required><input name="reviewDate" type="date"><input name="kpi1" maxlength="120" placeholder="KPI 1 · e.g. Classroom practice" required><select name="rating1"><option value="5">5 · Exceptional</option><option value="4">4 · Strong</option><option value="3" selected>3 · Meets expectations</option><option value="2">2 · Developing</option><option value="1">1 · Needs support</option></select><input name="kpi2" maxlength="120" placeholder="KPI 2 · e.g. Administration"><select name="rating2"><option value="5">5</option><option value="4">4</option><option value="3" selected>3</option><option value="2">2</option><option value="1">1</option></select><input name="kpi3" maxlength="120" placeholder="KPI 3 · e.g. Family communication"><select name="rating3"><option value="5">5</option><option value="4">4</option><option value="3" selected>3</option><option value="2">2</option><option value="1">1</option></select><textarea name="strengths" maxlength="2500" placeholder="Strengths"></textarea><textarea name="development" maxlength="2500" placeholder="Development areas"></textarea><textarea name="goals" maxlength="2500" placeholder="Goals / next review targets"></textarea><button class="submit-btn">Create KPI review</button></form>`:''}
          <div class="staff-work-list">${reviews.length?reviews.map(r=>`<article><strong>${esc(r.staffName)} · ${esc(r.reviewPeriod||r.reviewDate)}</strong><span>Overall KPI: ${esc(r.averageRating)} / 5 · ${esc(r.status)}</span><span>${r.criteria.map(k=>esc(k.name)+': '+esc(k.rating)+'/5').join(' · ')}</span>${manager&&r.status==='Draft'?`<button data-review-share="${esc(r.id)}">Share with staff member</button>`:''}${!manager&&r.status==='Shared'?`<textarea data-review-comment="${esc(r.id)}" maxlength="2500" placeholder="Your comment on this review"></textarea><button data-review-ack="${esc(r.id)}">Acknowledge review</button>`:''}</article>`).join(''):'<p>No performance reviews yet.</p>'}</div>
        </section>
      </div>`;
    if (['school_staff','school_hr','staff','crm','accounts','support'].includes(user.role)) [...root.querySelectorAll('.staff-work-card')].find(card => card.querySelector('h3')?.textContent === 'Teacher Cover')?.remove();
    bind();
  };
  const bind=()=>{
    document.getElementById('staffKpiMonth')?.addEventListener('change',render);
    document.getElementById('staffTaskForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/api/staff/tasks',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});await render();});
    document.getElementById('staffLeaveForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/api/staff/leave',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});await render();});
    document.getElementById('staffCoverForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/api/staff/cover',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});await render();});
    document.querySelectorAll('[data-task]').forEach(el=>el.addEventListener('change',async()=>{await api('/api/staff/tasks/'+encodeURIComponent(el.dataset.task),{method:'PATCH',body:JSON.stringify({status:el.value})});await render();}));
    document.querySelectorAll('[data-leave]').forEach(el=>el.addEventListener('click',async()=>{await api('/api/staff/leave/'+encodeURIComponent(el.dataset.leave),{method:'PATCH',body:JSON.stringify({status:el.dataset.status})});await render();}));
    document.querySelectorAll('[data-cover]').forEach(el=>el.addEventListener('click',async()=>{await api('/api/staff/cover/'+encodeURIComponent(el.dataset.cover),{method:'PATCH',body:JSON.stringify({status:'Completed'})});await render();}));
    document.getElementById('staffKpiForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const raw=Object.fromEntries(f);const criteria=[1,2,3].map(n=>({name:raw['kpi'+n],rating:Number(raw['rating'+n])})).filter(k=>k.name);await api('/api/staff/performance-reviews',{method:'POST',body:JSON.stringify({...raw,criteria})});await render();});
    document.querySelectorAll('[data-review-share]').forEach(el=>el.addEventListener('click',async()=>{await api('/api/staff/performance-reviews/'+encodeURIComponent(el.dataset.reviewShare),{method:'PATCH',body:JSON.stringify({status:'Shared'})});await render();}));
    document.querySelectorAll('[data-review-ack]').forEach(el=>el.addEventListener('click',async()=>{const id=el.dataset.reviewAck;const comment=document.querySelector('[data-review-comment="'+CSS.escape(id)+'"]')?.value||'';await api('/api/staff/performance-reviews/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({employeeComment:comment,acknowledged:true})});await render();}));
  };
  const init=async()=>{
    user=window.getLittleFeetCurrentUser?.(); if(!user||!(window.isLittleFeetFullAccessUser?.(user) || ['teacher','principal','admin','school_accounts','school_hr','school_staff','staff','crm','accounts','support'].includes(user.role))) return;
    if((window.isLittleFeetFullAccessUser?.(user) || ['admin','principal','school_hr'].includes(user.role))) { try { accounts=await api('/api/staff/directory'); } catch(error) { if(error.code==='SESSION_CHANGED')return; accounts=[]; } }
    else accounts=[user];
    await render().catch(err=>{if(err.code==='SESSION_CHANGED')return;const r=document.getElementById('staffWorkContent');if(r)r.innerHTML='<p>'+esc(err.message)+'</p>';});
  };
  window.refreshStaffWork=init;
  if(typeof window.registerLittleFeetWorkspace==='function') window.registerLittleFeetWorkspace('staff-work',init);
  else document.addEventListener('littlefeet:session-ready',init);
})();