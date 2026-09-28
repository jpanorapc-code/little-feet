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

  let emailInboxSeen=new Set();
  const inboxButtons=item=>`<div class="actions"><button class="action-btn" data-inbox-action="read" data-id="${esc(item.id)}">${item.read?'Mark unread':'Mark read'}</button><button class="action-btn" data-inbox-action="pin" data-id="${esc(item.id)}">${item.pinned?'Unpin':'Pin'}</button><button class="action-btn" data-inbox-action="open" data-tab="${esc(item.sourceTab||'')}">Open</button><button class="action-btn" data-inbox-action="delete" data-id="${esc(item.id)}">Delete</button></div>`;
  const showInboxPopup=item=>{
    if(item.read||emailInboxSeen.has(item.id))return;emailInboxSeen.add(item.id);
    let stack=document.getElementById('lfNotificationStack');if(!stack){stack=document.createElement('aside');stack.id='lfNotificationStack';stack.className='lf-notification-stack';stack.setAttribute('aria-live','polite');document.body.appendChild(stack);}
    const card=document.createElement('article');card.className='lf-notification-popup'+(item.pinned?' is-pinned':'');card.dataset.id=item.id;card.innerHTML=`<header><strong>${esc(item.title)}</strong><span class="badge-tag">${esc(item.type)}</span></header><p>${esc(item.message)}</p><div class="actions"><button class="action-btn" data-popup-pin>${item.pinned?'Unpin':'Pin'}</button><button class="action-btn" data-popup-close>Close</button></div>`;
    card.querySelector('[data-popup-close]').onclick=()=>card.remove();
    card.querySelector('[data-popup-pin]').onclick=async()=>{const next=!item.pinned;await json('/api/email/inbox/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({pinned:next})});item.pinned=next;card.classList.toggle('is-pinned',next);card.querySelector('[data-popup-pin]').textContent=next?'Unpin':'Pin';await email();};
    stack.prepend(card);
  };
  async function email(){
    const host=document.getElementById('emailIntegrationContent');if(!host)return;
    try{const [d,inbox]=await Promise.all([json('/api/email/status'),json('/api/email/inbox')]);
      host.innerHTML=`<div class="workspace-grid"><div class="workspace-card"><h3>Connect Little Feet Email</h3><p><strong>Email channel:</strong> ${d.configured?'Available':'Not configured'}</p><p><strong>Delivery provider:</strong> ${esc(d.provider||'Not configured')}</p><p><strong>Connected account:</strong> ${esc(d.address||'No valid email')}</p><p><strong>Verification:</strong> ${d.verified?'Verified':'Not verified'}</p><p class="meta">${d.configured?'Send a verification code to prove this account owns the email address. Mailbox credentials stay on the Little Feet server and are never sent to the browser.':'Little Feet needs its server-side SMTP or email API settings before it can send the verification code.'}</p><button id="requestEmailCode" class="action-btn" type="button" ${d.configured?'':'disabled'}>Send verification code</button><form id="confirmEmailForm" style="margin-top:12px"><label>6-digit code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><button class="submit-btn">Connect & verify email</button></form></div><div class="workspace-card"><h3>What arrives here</h3><p>Little Feet notifications, tickets assigned to or created by you, direct messages, staff notices and school alerts appear here separately from the normal portal workspaces.</p><p class="meta">Deleting an inbox copy does not delete the original ticket, message, notice or safety record.</p></div></div><div class="email-inbox-toolbar"><h3>Little Feet Email Inbox</h3><button id="deleteAllInbox" class="action-btn" type="button">Delete all</button></div><div class="email-inbox-list">${inbox.length?inbox.map(item=>`<article class="email-inbox-item ${item.read?'':'is-unread'} ${item.pinned?'is-pinned':''}"><header><div><span class="badge-tag">${esc(item.type)}</span> <strong>${esc(item.title)}</strong></div><span class="meta">${new Date(item.createdAt).toLocaleString()}</span></header><p>${esc(item.message)}</p>${inboxButtons(item)}</article>`).join(''):'<p class="meta">No Little Feet email notifications yet.</p>'}</div>`;
      inbox.forEach(showInboxPopup);
      document.getElementById('requestEmailCode')?.addEventListener('click',async()=>{try{await json('/api/email/verification/request',{method:'POST',body:'{}'});alert('Verification code sent. It expires in 10 minutes.');}catch(e){alert(e.message);}});
      document.getElementById('confirmEmailForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await json('/api/email/verification/confirm',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });await email();}catch(err){alert(err.message);}});
      host.querySelectorAll('[data-inbox-action]').forEach(btn=>btn.addEventListener('click',async()=>{
        const action=btn.dataset.inboxAction,id=btn.dataset.id;if(action==='open'){if(btn.dataset.tab)window.switchTab?.(btn.dataset.tab);return;}
        if(action==='delete'){if(!confirm('Delete this inbox item?'))return;await json('/api/email/inbox/'+encodeURIComponent(id),{method:'DELETE'});}
        else {const item=inbox.find(x=>x.id===id);await json('/api/email/inbox/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(action==='read'?{read:!item.read}:{pinned:!item.pinned})});}
        await email();
      }));
      document.getElementById('deleteAllInbox')?.addEventListener('click',async()=>{if(!confirm('Delete all Little Feet Email inbox items? Original tickets, messages and notices will stay in their workspaces.'))return;await json('/api/email/inbox',{method:'DELETE'});emailInboxSeen.clear();await email();});
    }catch(e){host.innerHTML=`<p class="meta">${esc(e.message)}</p>`;}
  }
  let emailPoll=null;const startEmailPoll=()=>{if(emailPoll)clearInterval(emailPoll);emailPoll=setInterval(()=>{if(user()?.username&&!document.hidden)email();},30000);};

  const load=()=>{qualifications();kpiHistory();development();email();startEmailPoll();};
  document.addEventListener('littlefeet:session-ready',load);
  if(user()?.username)load();
  window.refreshStaffQualifications=qualifications;window.refreshKpiHistory=kpiHistory;window.refreshStaffDevelopment=development;window.refreshEmailIntegration=email;
})();
