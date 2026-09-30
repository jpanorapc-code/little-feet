(() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const json=async(url,opts={})=>{const r=await fetch(url,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Request failed.');return d;};
  const user=()=>window.getLittleFeetCurrentUser?.()||{};
  const staffOptions=async()=>{try{const rows=await json('/api/accounts');return (Array.isArray(rows)?rows:rows.accounts||[]).filter(x=>['teacher','principal','admin'].includes(String(x.role).toLowerCase())).map(x=>`<option value="${esc(x.username)}">${esc(x.name||x.username)}</option>`).join('');}catch{return '';}};
  const statusBadge=s=>`<span class="badge-tag">${esc(s)}</span>`;

  async function qualifications(){
    const host=document.getElementById('qualificationsContent');if(!host)return;
    try{const rows=await json('/api/staff/qualifications'),u=user(),management=(window.isLittleFeetFullAccessUser?.(u) || ['admin','principal'].includes(String(u.role).toLowerCase())),opts=management?await staffOptions():'';
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
    try{const rows=await json('/api/staff/development-plans'),u=user(),management=(window.isLittleFeetFullAccessUser?.(u) || ['admin','principal'].includes(String(u.role).toLowerCase())),opts=management?await staffOptions():'';
      host.innerHTML=`${management?`<div class="card"><h3>Create staff development plan</h3><form id="developmentForm"><label>Staff member<select name="username" required><option value="">Choose staff</option>${opts}</select></label><label>Development goal<textarea name="goal" maxlength="1000" required></textarea></label><label>Actions / support<textarea name="actions" maxlength="2000"></textarea></label><label>Target date<input name="targetDate" type="date"></label><button class="submit-btn">Create plan</button></form></div>`:''}<div class="card"><h3>Development plans</h3><div class="staff-work-list">${rows.length?rows.map(x=>`<article><div>${statusBadge(x.status)} <strong>${esc(x.staffName)}</strong></div><p>${esc(x.goal)}</p><span>${esc(x.actions||'No actions recorded')}${x.targetDate?' · Target '+esc(x.targetDate):''}</span></article>`).join(''):'<p class="meta">No development plans yet.</p>'}</div></div>`;
      document.getElementById('developmentForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await json('/api/staff/development-plans',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });await development();}catch(err){alert(err.message);}});
    }catch(e){host.innerHTML=`<p class="meta">${esc(e.message)}</p>`;}
  }

  let emailInboxSeen=new Set();
  const mailboxProviderName=provider=>({google:'Gmail',microsoft:'Outlook / Microsoft 365',zoho:'Zoho Mail',yahoo:'Yahoo Mail'}[String(provider||'').toLowerCase()]||String(provider||'Mailbox'));
  const mailboxNeedsSync=mailbox=>{
    if(!mailbox?.connected)return false;
    const last=Date.parse(mailbox.lastSyncAt||'');
    return !Number.isFinite(last)||Date.now()-last>=60000;
  };
  const inboxButtons=item=>{
    const destination=item.type==='Email'
      ? (item.providerLink?`<a class="action-btn" href="${esc(item.providerLink)}" target="_blank" rel="noopener noreferrer">Open original</a>`:'')
      : (item.sourceTab?`<button class="action-btn" data-inbox-action="open" data-tab="${esc(item.sourceTab)}">Open</button>`:'');
    return `<div class="actions"><button class="action-btn" data-inbox-action="read" data-id="${esc(item.id)}">${item.read?'Mark unread':'Mark read'}</button><button class="action-btn" data-inbox-action="pin" data-id="${esc(item.id)}">${item.pinned?'Unpin':'Pin'}</button>${destination}<button class="action-btn" data-inbox-action="delete" data-id="${esc(item.id)}">Delete</button></div>`;
  };
  const showInboxPopup=item=>{
    if(item.read||emailInboxSeen.has(item.id))return;emailInboxSeen.add(item.id);
    let stack=document.getElementById('lfNotificationStack');if(!stack){stack=document.createElement('aside');stack.id='lfNotificationStack';stack.className='lf-notification-stack';stack.setAttribute('aria-live','polite');document.body.appendChild(stack);}
    const card=document.createElement('article');card.className='lf-notification-popup'+(item.pinned?' is-pinned':'');card.dataset.id=item.id;card.innerHTML=`<header><strong>${esc(item.title)}</strong><span class="badge-tag">${esc(item.type)}</span></header><p>${esc(item.message)}</p><div class="actions"><button class="action-btn" data-popup-pin>${item.pinned?'Unpin':'Pin'}</button><button class="action-btn" data-popup-close>Close</button></div>`;
    card.querySelector('[data-popup-close]').onclick=()=>card.remove();
    card.querySelector('[data-popup-pin]').onclick=async()=>{const next=!item.pinned;await json('/api/email/inbox/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({pinned:next})});item.pinned=next;card.classList.toggle('is-pinned',next);card.querySelector('[data-popup-pin]').textContent=next?'Unpin':'Pin';await email();};
    stack.prepend(card);
  };
  const mailboxConnectionMarkup=(d,syncError='')=>{
    const mailbox=d.mailbox||{connected:false};
    const providers=d.mailboxProviders||{};
    if(mailbox.connected){
      const last=mailbox.lastSyncAt?new Date(mailbox.lastSyncAt).toLocaleString():'Not synced yet';
      const status=syncError||mailbox.lastSyncStatus==='error'?'Sync needs attention':'Connected';
      return `<div class="workspace-card"><h3>Your personal mailbox</h3><p><strong>${esc(mailboxProviderName(mailbox.provider))}</strong><br>${esc(mailbox.address||'')}</p><p><strong>Status:</strong> ${esc(status)}</p><p><strong>Connection:</strong> Secure provider sign-in</p><p><strong>Last sync:</strong> ${esc(last)}</p><p class="meta">Only this Little Feet user can see this connected mailbox. OAuth tokens stay encrypted on the server.</p>${syncError?`<p class="meta" style="color:#fca5a5;">${esc(syncError)}</p>`:''}<div class="actions"><button id="syncMailboxNow" class="action-btn btn-green" type="button">Sync now</button><button id="disconnectMailbox" class="action-btn btn-red" type="button">Disconnect mailbox</button></div></div>`;
    }

    const buttons=[
      providers.google?`<a class="action-btn btn-blue" href="/auth/email/google">Connect Gmail</a>`:'',
      providers.microsoft?`<a class="action-btn btn-blue" href="/auth/email/microsoft">Connect Outlook / Microsoft 365</a>`:'',
      providers.zoho?`<a class="action-btn btn-blue" href="/auth/email/zoho">Connect Zoho Mail</a>`:'',
      providers.yahoo?`<a class="action-btn btn-blue" href="/auth/email/yahoo">Connect Yahoo Mail</a>`:''
    ].filter(Boolean).join('');
    const providerHelp=buttons
      ? '<p class="meta">Choose your provider, sign in on its own secure page, approve read access, and Little Feet will return you here automatically.</p>'
      : '<p class="meta">Mailbox sign-in is temporarily unavailable because the provider connection has not been enabled on this Little Feet server.</p>';

    return `<div class="workspace-card"><h3>Connect your personal mailbox</h3><p>Choose your email provider. Little Feet will send you to the provider\'s secure sign-in page; your email password is never entered into Little Feet.</p><div class="actions" style="margin-bottom:10px;">${buttons}</div>${providerHelp}</div>`;
  };

  async function email(){
    const host=document.getElementById('emailIntegrationContent');if(!host)return;
    try{
      const d=await json('/api/email/status');
      let inbox=null,syncError='';
      if(mailboxNeedsSync(d.mailbox)){
        try{
          const synced=await json('/api/email/mailbox/sync',{method:'POST',body:'{}'});
          d.mailbox=synced.mailbox||d.mailbox;
          inbox=Array.isArray(synced.inbox)?synced.inbox:null;
        }catch(error){syncError=error.message||'Mailbox sync failed.';}
      }
      if(!inbox)inbox=await json('/api/email/inbox');

      host.innerHTML=`<div class="workspace-grid">${mailboxConnectionMarkup(d,syncError)}<div class="workspace-card"><h3>Little Feet delivery email</h3><p><strong>Delivery channel:</strong> ${d.configured?'Available':'Not configured'}</p><p><strong>Delivery provider:</strong> ${esc(d.provider||'Not configured')}</p><p><strong>Your Little Feet account email:</strong> ${esc(d.address||'No valid email')}</p><p><strong>Address verification:</strong> ${d.verified?'Verified':'Not verified'}</p><p class="meta">${d.configured?'This verifies the address Little Feet uses for platform-generated mail. It is separate from connecting your personal inbox above.':'Little Feet needs its server-side SMTP or email API settings before it can send verification mail.'}</p><button id="requestEmailCode" class="action-btn" type="button" ${d.configured?'':'disabled'}>Send verification code</button><form id="confirmEmailForm" style="margin-top:12px"><label>6-digit code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><button class="submit-btn">Verify address</button></form></div><div class="workspace-card"><h3>What arrives here</h3><p><strong>EMAIL</strong> items are real messages pulled from the mailbox connected by this signed-in user.</p><p><strong>Little Feet</strong> items are platform notifications such as tickets, direct messages, staff notices, payments and alerts.</p><p class="meta">Mailbox connections are per user. A principal, teacher, parent, CRM, Accounts user or future role only sees the mailbox connected to their own Little Feet account.</p></div></div><div class="email-inbox-toolbar"><h3>Email Inbox</h3><div class="actions"><button id="refreshMailboxInbox" class="action-btn btn-green" type="button">Refresh / sync</button><button id="deleteAllInbox" class="action-btn" type="button">Delete all dashboard copies</button></div></div><div class="email-inbox-list">${inbox.length?inbox.map(item=>`<article class="email-inbox-item ${item.read?'':'is-unread'} ${item.pinned?'is-pinned':''}"><header><div><span class="badge-tag">${esc(item.type)}</span> <strong>${esc(item.title)}</strong></div><span class="meta">${new Date(item.createdAt).toLocaleString()}</span></header><p>${esc(item.message)}</p>${inboxButtons(item)}</article>`).join(''):'<p class="meta">No mailbox email or Little Feet notifications yet.</p>'}</div>`;
      inbox.forEach(showInboxPopup);

      document.getElementById('syncMailboxNow')?.addEventListener('click',async()=>{
        try{await json('/api/email/mailbox/sync',{method:'POST',body:'{}'});emailInboxSeen.clear();await email();}catch(error){alert(error.message);}
      });
      document.getElementById('refreshMailboxInbox')?.addEventListener('click',async()=>{
        try{if(d.mailbox?.connected)await json('/api/email/mailbox/sync',{method:'POST',body:'{}'});emailInboxSeen.clear();await email();}catch(error){alert(error.message);}
      });
      document.getElementById('disconnectMailbox')?.addEventListener('click',async()=>{
        if(!confirm('Disconnect this personal mailbox and remove its imported dashboard copies?'))return;
        try{await json('/api/email/mailbox',{method:'DELETE'});emailInboxSeen.clear();await email();}catch(error){alert(error.message);}
      });
      document.getElementById('requestEmailCode')?.addEventListener('click',async()=>{try{await json('/api/email/verification/request',{method:'POST',body:'{}'});alert('Verification code sent. It expires in 10 minutes.');}catch(e){alert(e.message);}});
      document.getElementById('confirmEmailForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await json('/api/email/verification/confirm',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });await email();}catch(err){alert(err.message);}});
      host.querySelectorAll('[data-inbox-action]').forEach(btn=>btn.addEventListener('click',async()=>{
        const action=btn.dataset.inboxAction,id=btn.dataset.id;if(action==='open'){if(btn.dataset.tab)window.switchTab?.(btn.dataset.tab);return;}
        if(action==='delete'){if(!confirm('Delete this dashboard inbox item? The original provider email or Little Feet record will stay in its source system.'))return;await json('/api/email/inbox/'+encodeURIComponent(id),{method:'DELETE'});}
        else {const item=inbox.find(x=>x.id===id);await json('/api/email/inbox/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(action==='read'?{read:!item.read}:{pinned:!item.pinned})});}
        await email();
      }));
      document.getElementById('deleteAllInbox')?.addEventListener('click',async()=>{if(!confirm('Delete all dashboard inbox copies? Original provider emails and Little Feet records will stay in their source systems.'))return;await json('/api/email/inbox',{method:'DELETE'});emailInboxSeen.clear();await email();});
    }catch(e){host.innerHTML=`<p class="meta">${esc(e.message)}</p>`;}
  }
  let emailPoll=null;const startEmailPoll=()=>{if(emailPoll)clearInterval(emailPoll);emailPoll=setInterval(()=>{if(user()?.username&&!document.hidden)email();},30000);};

  const load=()=>{qualifications();kpiHistory();development();email();startEmailPoll();};
  document.addEventListener('littlefeet:session-ready',load);
  if(user()?.username)load();
  window.refreshStaffQualifications=qualifications;window.refreshKpiHistory=kpiHistory;window.refreshStaffDevelopment=development;window.refreshEmailIntegration=email;
})();
