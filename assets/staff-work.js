(function () {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let user = null, accounts = [];

  const api = async (url, options={}) => {
    const response = await fetch(url, { credentials:'same-origin', ...options, headers:{ Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.message || 'Request failed.');
    return data;
  };
  const optionList = (roles=['teacher','principal','admin']) => accounts.filter(a=>roles.includes(a.role)).map(a=>`<option value="${esc(a.username)}">${esc(a.name || a.username)} · ${esc(a.role)}</option>`).join('');

  const render = async () => {
    const [tasks, leave, cover, reviews] = await Promise.all([api('/api/staff/tasks'),api('/api/staff/leave'),api('/api/staff/cover'),api('/api/staff/performance-reviews')]);
    const root=document.getElementById('staffWorkContent'); if(!root) return;
    const manager=['admin','principal'].includes(user.role);
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
        <section class="staff-work-card"><h3>Performance Reviews · KPI</h3>
          ${manager?`<form id="staffKpiForm"><select name="username" required><option value="">Staff member…</option>${optionList()}</select><input name="reviewPeriod" maxlength="120" placeholder="Review period, e.g. Term 3 2026"><input name="reviewDate" type="date"><input name="kpi1" maxlength="120" placeholder="KPI 1 · e.g. Classroom practice" required><select name="rating1"><option value="5">5 · Exceptional</option><option value="4">4 · Strong</option><option value="3" selected>3 · Meets expectations</option><option value="2">2 · Developing</option><option value="1">1 · Needs support</option></select><input name="kpi2" maxlength="120" placeholder="KPI 2 · e.g. Administration"><select name="rating2"><option value="5">5</option><option value="4">4</option><option value="3" selected>3</option><option value="2">2</option><option value="1">1</option></select><input name="kpi3" maxlength="120" placeholder="KPI 3 · e.g. Family communication"><select name="rating3"><option value="5">5</option><option value="4">4</option><option value="3" selected>3</option><option value="2">2</option><option value="1">1</option></select><textarea name="strengths" maxlength="2500" placeholder="Strengths"></textarea><textarea name="development" maxlength="2500" placeholder="Development areas"></textarea><textarea name="goals" maxlength="2500" placeholder="Goals / next review targets"></textarea><button class="submit-btn">Create KPI review</button></form>`:''}
          <div class="staff-work-list">${reviews.length?reviews.map(r=>`<article><strong>${esc(r.staffName)} · ${esc(r.reviewPeriod||r.reviewDate)}</strong><span>Overall KPI: ${esc(r.averageRating)} / 5 · ${esc(r.status)}</span><span>${r.criteria.map(k=>esc(k.name)+': '+esc(k.rating)+'/5').join(' · ')}</span>${manager&&r.status==='Draft'?`<button data-review-share="${esc(r.id)}">Share with staff member</button>`:''}${!manager&&r.status==='Shared'?`<textarea data-review-comment="${esc(r.id)}" maxlength="2500" placeholder="Your comment on this review"></textarea><button data-review-ack="${esc(r.id)}">Acknowledge review</button>`:''}</article>`).join(''):'<p>No performance reviews yet.</p>'}</div>
ion>
      </div>`;
    bind();
  };
  const bind=()=>{
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
    user=window.getLittleFeetCurrentUser?.(); if(!user||!['teacher','principal','admin'].includes(user.role)) return;
    if(['admin','principal'].includes(user.role)) { try { accounts=await api('/api/accounts'); } catch { accounts=[]; } }
    else accounts=[user];
    await render().catch(err=>{const r=document.getElementById('staffWorkContent');if(r)r.innerHTML='<p>'+esc(err.message)+'</p>';});
  };
  window.refreshStaffWork=init;
  document.addEventListener('littlefeet:session-ready',init);
  window.addEventListener('load',()=>setTimeout(init,250));
})();