(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const json=async(url,opts={})=>{const r=await fetch(url,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Request failed.');return d;};
  const user=()=>window.getLittleFeetCurrentUser?.()||{};
  const staffOptions=async()=>{try{const rows=await json('/api/accounts');return (Array.isArray(rows)?rows:rows.accounts||[]).filter(x=>['teacher','principal','admin'].includes(String(x.role).toLowerCase())).map(x=>`<option value="${esc(x.username)}">${esc(x.name||x.username)}</option>`).join('');}catch{return '';}};
  const statusBadge=s=>`<span class="badge-tag">${esc(s)}</span>`;

  async function qualifications(){
    const host=document.getElementById('qualificationsContent');if(!host)return;
    try{const rows=await json('/api/staff/qualifications'),u=user(),management=['admin','principal'].includes(String(u.role).toLowerCase()),opts=management?await staffOptions():'';
      host.innerHTML=`<div class="workspace-grid"><div class="workspace-card"><h3>Add qualification / certificate</h3><form id="qualificationForm">${management?`<label>Staff member<select name="username" required><option value="">Choose staff</option>${opts}</select></label>`:''}<label>Qualification<input name="name" maxlength="180" required></label><label>Issuing body<input name="issuingBody" maxlength="180" required></label><div class="flex-form-row"><label>Obtained<input name="obtainedDate" type="date" required></label><label>Expiry (optional)<input name="expiryDate" type="date"></label></div><label>Certificate / reference<input name="reference" maxlength="300" placeholder="Certificate number or approved document reference"></label><button class="submit-btn">Save qualification</button></form></div><div class="workspace-card"><h3>Compliance overview</h3><div class="staff-work-list">${rows.length?rows.map(x=>`<article><div>${statusBadge(x.status)} <strong>${esc(x.name)}</strong></div><span>${esc(x.staffName)} · ${esc(x.issuingBody)}</span><span>Obtained ${esc(x.obtainedDate)}${x.expiryDate?` · Expires ${esc(x.expiryDate)}`:' · No expiry'}</span>${x.reference?`<span>Reference: ${esc(x.reference)}</span>`:''}</article>`).join(''):'<p class="meta">No qualifications recorded yet.</p>'}</div></div></div>`;
      document.getElementById('qualificationForm')?.addEventListener('submit',async e=>{e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget));try{await json('/api/staff/qualifications',{method:'POST',body:JSON.stringify(body)});await qualifications();window.refreshMyDay?.();}catch(err){alert(err.message);}});
    }catch(e){host.innerHTML=`<p class="meta">${esc(e.message)}</p>`;}
  }

  async function kpiHistory(){
    const host=document.getElementById('kpiHistoryContent');if(!host)return;
    try{const d=await json('/api/staff/kpi-history?months=12');const max=100;host.innerHTML=`<div class="card"><h3>${esc(d.staffName)} · 12-month task KPI trend</h3><div class="staff-kpi-scoreboard">${d.rows.map(x=>`<article><strong>${esc(x.month)}</strong><span>${x.completed}/${x.total} tasks · ${esc(x.band)}</span><div class="staff-kpi-bar"><i style="width:${Math.min(max,x.completionRate)}%"></i></div><b>${x.completionRate}%</b></article>`).join('')}</div><p class="meta">KPI is calculated from completed staff tasks for each month.</p></div>`;}catch(e){host.innerHTML=`<p class="meta">${esc(e.message)}</p>`;}
  }

  async function development(){
    const host=document.getElementById('staffDevelopmentContent');if(!host)return;
    try{const rows=await json('/api/staff/development-plans'),u=user(),management=['admin','principal'].includes(String(u.role).toLowerCase()),opts=management?await staffOptions():'';
      host.innerHTML=`${management?`<div class="card"><h3>Create staff development plan</h3><form id="developmentForm"><label>Staff member<select name="username" required><option value="">Choose staff</option>${opts}</select></label><label>Development goal<textarea name="goal" maxlength="1000" required></textarea></label><label>Actions / support<textarea name="actions" maxlength="2000"></textarea></label><label>Target date<input name="targetDate" type="date"></label><button class="submit-btn">Create plan</button></form></div>`:''}<div class="card"><h3>Development plans</h3><div class="staff-work-list">${rows.length?rows.map(x=>`<article><div>${statusBadge(x.status)} <strong>${esc(x.staffName)}</strong></div><p>${esc(x.goal)}</p><span>${esc(x.actions||'No actions recorded')}${x.targetDate?' · Target '+esc(x.targetDate):''}</span></article>`).join(''):'<p class="meta">No development plans yet.</p>'}</div></div>`;
      document.getElementById('developmentForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await json('/api/staff/development-plans',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });await development();}catch(err){alert(err.message);}});
    }catch(e){host.innerHTML=`<p class="meta">${esc(e.message)}</p>`;}
  }

  async function email(){
    const host=document.getElementById('emailIntegrationContent');if(!host)return;
    try{const d=await json('/api/email/status');host.innerHTML=`<div class="workspace-grid"><div class="workspace-card"><h3>Email delivery</h3><p><strong>Provider:</strong> ${d.configured?'Configured':'Not configured'}</p><p><strong>Account email:</strong> ${esc(d.address||'No valid email')}</p><p><strong>Verification:</strong> ${d.verified?'Verified':'Not verified'}</p><p class="meta">Email is a separate delivery channel from Little Feet in-app notifications. Security lockout alerts use the same protected server-side provider configuration.</p></div><div class="workspace-card"><h3>Verify account email</h3><button id="requestEmailCode" class="action-btn" type="button">Send verification code</button><form id="confirmEmailForm" style="margin-top:12px"><label>6-digit code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><button class="submit-btn">Verify email</button></form></div></div>`;
      document.getElementById('requestEmailCode')?.addEventListener('click',async()=>{try{await json('/api/email/verification/request',{method:'POST',body:'{}'});alert('Verification code sent. It expires in 10 minutes.');}catch(e){alert(e.message);}});
      document.getElementById('confirmEmailForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await json('/api/email/verification/confirm',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });await email();}catch(err){alert(err.message);}});
    }catch(e){host.innerHTML=`<p class="meta">${esc(e.message)}</p>`;}
  }
  const load=()=>{qualifications();kpiHistory();development();email();};
  document.addEventListener('littlefeet:session-ready',load);
  if(user()?.username)load();
  window.refreshStaffQualifications=qualifications;window.refreshKpiHistory=kpiHistory;window.refreshStaffDevelopment=development;window.refreshEmailIntegration=email;
})();