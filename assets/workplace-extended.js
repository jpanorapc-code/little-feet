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
  const notificationPreferenceKey=()=>`littlefeet-notifications:${String(user()?.username||'guest').toLowerCase()}`;
  const notificationPreferences=()=>{try{return JSON.parse(localStorage.getItem(notificationPreferenceKey())||'{}');}catch{return {};}};
  const saveNotificationPreferences=value=>localStorage.setItem(notificationPreferenceKey(),JSON.stringify(value));
  const ensureNotificationStack=()=>{
    let stack=document.getElementById('lfNotificationStack');
    const dock=document.getElementById('navUserPanel');
    if(stack){
      if(dock&&stack.parentElement!==dock)dock.appendChild(stack);
      return stack;
    }
    stack=document.createElement('aside');stack.id='lfNotificationStack';stack.className='lf-notification-stack is-collapsed';stack.setAttribute('aria-label','Email notifications');
    stack.innerHTML='<div class="lf-notification-controls"><button class="action-btn" type="button" data-notification-collapse aria-expanded="false">▸ Emails</button><button class="action-btn" type="button" data-notification-dnd></button><button class="action-btn" type="button" data-notification-close-all>Close all</button></div><div class="lf-notification-items" aria-live="polite"></div>';
    const preferences=notificationPreferences();
    const collapse=stack.querySelector('[data-notification-collapse]');
    const dnd=stack.querySelector('[data-notification-dnd]');dnd.textContent=preferences.dnd?'Do not disturb: On':'Do not disturb: Off';dnd.classList.toggle('is-active',Boolean(preferences.dnd));
    const setCollapsed=collapsed=>{stack.classList.toggle('is-collapsed',collapsed);collapse.textContent=collapsed?'▸ Emails':'▾ Emails';collapse.setAttribute('aria-expanded',String(!collapsed));};
    collapse.onclick=()=>setCollapsed(!stack.classList.contains('is-collapsed'));
    dnd.onclick=()=>{const current=notificationPreferences(),next=!current.dnd;saveNotificationPreferences({...current,dnd:next});dnd.textContent=next?'Do not disturb: On':'Do not disturb: Off';dnd.classList.toggle('is-active',next);if(next){stack.querySelector('.lf-notification-items').replaceChildren();setCollapsed(true);}};
    stack.querySelector('[data-notification-close-all]').onclick=()=>{stack.querySelector('.lf-notification-items').replaceChildren();setCollapsed(true);};
    (dock||document.body).appendChild(stack);return stack;
  };
  const inboxButtons=item=>{
    const destination=item.type==='Email'
      ? ''
      : (item.sourceTab?`<button class="action-btn" data-inbox-action="open" data-tab="${esc(item.sourceTab)}">Open</button>`:'');
    const reply=item.type==='Email'?`<button class="action-btn" data-inbox-action="reply" data-id="${esc(item.id)}">Reply</button>`:'';
    return `<div class="actions"><button class="action-btn" data-inbox-action="read" data-id="${esc(item.id)}">${item.read?'Mark unread':'Mark read'}</button><button class="action-btn" data-inbox-action="pin" data-id="${esc(item.id)}">${item.pinned?'Unpin':'Pin'}</button>${reply}${destination}<button class="action-btn" data-inbox-action="delete" data-id="${esc(item.id)}">Delete</button></div>`;
  };
  const showInboxPopup=item=>{
    if(item.read||emailInboxSeen.has(item.id))return;emailInboxSeen.add(item.id);
    const stack=ensureNotificationStack();if(notificationPreferences().dnd)return;
    stack.classList.remove('is-collapsed');
    const collapse=stack.querySelector('[data-notification-collapse]');if(collapse){collapse.textContent='▾ Emails';collapse.setAttribute('aria-expanded','true');}
    const card=document.createElement('article');card.className='lf-notification-popup'+(item.pinned?' is-pinned':'');card.dataset.id=item.id;card.innerHTML=`<header><strong>${esc(item.title)}</strong><span class="badge-tag">${esc(item.type)}</span></header><p>${esc(item.message)}</p><div class="actions"><button class="action-btn" data-popup-pin>${item.pinned?'Unpin':'Pin'}</button><button class="action-btn" data-popup-close>Close</button></div>`;
    card.querySelector('[data-popup-close]').onclick=()=>card.remove();
    card.querySelector('[data-popup-pin]').onclick=async()=>{const next=!item.pinned;await json('/api/email/inbox/'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({pinned:next})});item.pinned=next;card.classList.toggle('is-pinned',next);card.querySelector('[data-popup-pin]').textContent=next?'Unpin':'Pin';await email();};
    stack.querySelector('.lf-notification-items').prepend(card);
  };
  const forwardingMarkup=d=>{
    const forwarding=d.forwarding||{configured:false,address:''};
    if(!forwarding.configured){
      return '<div class="workspace-card"><h3>Receive email in Little Feet</h3><p>Inbound email receiving is not configured on this Little Feet server yet.</p><p class="meta">Once receiving is configured, each user gets a private forwarding address here. No mailbox password or provider OAuth is required.</p></div>';
    }
    if(!forwarding.address){
      return '<div class="workspace-card"><h3>Receive email in Little Feet</h3><p>Create your private Little Feet forwarding address, then forward new incoming mail from your normal email provider to it.</p><p class="meta">Your normal mailbox stays the source. Little Feet receives a dashboard copy of new messages that are forwarded to your private address.</p><button id="createForwardingAddress" class="action-btn btn-green" type="button">Create my forwarding address</button></div>';
    }
    const last=forwarding.lastReceivedAt?new Date(forwarding.lastReceivedAt).toLocaleString():'No forwarded email received yet';
    return `<div class="workspace-card"><h3>Receive email in Little Feet</h3><p><strong>Your private forwarding address</strong></p><div class="actions"><input id="forwardingAddress" type="text" readonly value="${esc(forwarding.address)}" style="flex:1;min-width:220px;"><button id="copyForwardingAddress" class="action-btn btn-green" type="button">Copy address</button></div><p><strong>Last received:</strong> ${esc(last)}</p><p class="meta">In Gmail, Outlook, Zoho, Yahoo or another provider that supports forwarding, forward new incoming mail to this address. Provider confirmation emails sent here will appear in the inbox below. Keep this private address out of public pages.</p></div>`;
  };
  const mailboxMarkup=status=>{
    const labels={google:'Google Gmail',microsoft:'Microsoft Outlook',zoho:'Zoho Mail',yahoo:'Yahoo Mail'};
    if(status.connected){
      const provider=labels[status.provider]||status.provider||'Connected mailbox';
      const last=status.lastSyncAt?new Date(status.lastSyncAt).toLocaleString():'Initial sync pending';
      return `<div class="workspace-card"><h3>Connected mailbox</h3><p><strong>${esc(provider)}</strong> · ${esc(status.email)}</p><p><strong>Last synced:</strong> ${esc(last)}</p>${status.initialSyncComplete?'':`<p class="meta">Older inbox messages are still being imported in safe batches.</p>`}${status.lastError?`<p class="meta">Last issue: ${esc(status.lastError)}</p>`:''}<div class="actions"><button id="syncConnectedMailbox" class="action-btn btn-green" type="button">Sync now</button><button id="disconnectConnectedMailbox" class="action-btn" type="button">Disconnect</button></div><p class="meta">Little Feet imports the inbox in safe batches and checks for new mail while this dashboard is open. Your mailbox remains the source.</p></div>`;
    }
    const google=status.availableProviders?.google?'<a class="action-btn btn-green" href="/api/email/mailbox/connect/google">Connect Google Gmail</a>':'';
    const microsoft=status.availableProviders?.microsoft?'<a class="action-btn btn-green" href="/api/email/mailbox/connect/microsoft">Connect Microsoft Outlook</a>':'';
    const zoho=status.availableProviders?.zoho?'<a class="action-btn btn-green" href="/api/email/mailbox/connect/zoho">Connect Zoho Mail</a>':'';
    const yahoo=status.availableProviders?.yahoo?'<a class="action-btn btn-green" href="/api/email/mailbox/connect/yahoo">Connect Yahoo Mail</a>':'';
    const buttons=google+microsoft+zoho+yahoo;
    return `<div class="workspace-card"><h3>Connect your email inbox</h3><p>Connect a mailbox to import its recent inbox and keep new incoming messages synced on this dashboard.</p><div class="actions">${buttons}</div><p class="meta">Little Feet requests read-only mailbox access. Passwords are never stored. ${buttons?'Choose your provider to continue securely.':'Mailbox providers must first be enabled by the Little Feet server administrator.'}</p></div>`;
  };

  async function email(){
    const host=document.getElementById('emailIntegrationContent');if(!host)return;
    try{
      const [d,mailbox,inbox]=await Promise.all([json('/api/email/status'),json('/api/email/mailbox/status'),json('/api/email/inbox')]);
      const compose=mailbox.connected?`<div class="workspace-card email-compose-card"><h3>Compose email</h3><form id="mailboxComposeForm"><label>To<input name="to" type="email" maxlength="254" autocomplete="off" required></label><label>Subject<input name="subject" maxlength="300" required></label><label>Message<textarea name="text" maxlength="20000" rows="7" required></textarea></label><div class="actions"><button class="submit-btn" type="submit">Send email</button><button class="action-btn" id="clearComposeEmail" type="button">Clear</button></div><p class="meta">Sent securely through your connected ${esc(mailbox.email)} mailbox.</p></form></div>`:'';
      host.innerHTML=`<div class="workspace-grid">${mailboxMarkup(mailbox)}${compose}${forwardingMarkup(d)}<div class="workspace-card"><h3>Little Feet delivery email</h3><p><strong>Delivery channel:</strong> ${d.configured?'Available':'Not configured'}</p><p><strong>Delivery provider:</strong> ${esc(d.provider||'Not configured')}</p><p><strong>Your Little Feet account email:</strong> ${esc(d.address||'No valid email')}</p><p><strong>Address verification:</strong> ${d.verified?'Verified':'Not verified'}</p><p class="meta">${d.configured?'This verifies the address Little Feet uses for platform-generated mail. It is separate from receiving mailbox email.':'Little Feet needs its server-side SMTP or email API settings before it can send verification mail.'}</p><button id="requestEmailCode" class="action-btn" type="button" ${d.configured?'':'disabled'}>Send verification code</button><form id="confirmEmailForm" style="margin-top:12px"><label>6-digit code<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><button class="submit-btn">Verify address</button></form></div></div><div class="email-inbox-toolbar"><h3>Email Inbox</h3><div class="actions"><button id="refreshForwardedInbox" class="action-btn btn-green" type="button">Refresh and sync</button><button id="deleteAllInbox" class="action-btn" type="button">Delete all dashboard copies</button></div></div><div class="email-inbox-list">${inbox.length?inbox.map(item=>`<article class="email-inbox-item ${item.read?'':'is-unread'} ${item.pinned?'is-pinned':''}"><header><div><span class="badge-tag">${esc(item.type)}</span> <strong>${esc(item.title)}</strong></div><span class="meta">${new Date(item.createdAt).toLocaleString()}</span></header><p>${esc(item.message)}</p>${inboxButtons(item)}</article>`).join(''):'<p class="meta">No mailbox email, forwarded email or Little Feet notifications yet.</p>'}</div>`;
      const notificationStack=ensureNotificationStack();inbox.forEach(showInboxPopup);if(!notificationStack.querySelector('.lf-notification-popup')){notificationStack.classList.add('is-collapsed');notificationStack.querySelector('[data-notification-collapse]').textContent='▸ Emails';}

      const composeForm=document.getElementById('mailboxComposeForm');
      composeForm?.addEventListener('submit',async event=>{event.preventDefault();const submit=composeForm.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='Sending…';try{await json('/api/email/mailbox/send',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(composeForm)))});composeForm.reset();alert('Email sent from your connected mailbox.');}catch(error){alert(error.message);}finally{submit.disabled=false;submit.textContent='Send email';}});
      document.getElementById('clearComposeEmail')?.addEventListener('click',()=>composeForm?.reset());

      document.getElementById('syncConnectedMailbox')?.addEventListener('click',async()=>{try{await json('/api/email/mailbox/sync',{method:'POST',body:'{}'});emailInboxSeen.clear();await email();}catch(error){alert(error.message);}});
      document.getElementById('disconnectConnectedMailbox')?.addEventListener('click',async()=>{if(!confirm('Disconnect this mailbox from Little Feet? Imported dashboard copies will remain until you delete them.'))return;try{await json('/api/email/mailbox',{method:'DELETE'});await email();}catch(error){alert(error.message);}});

      document.getElementById('createForwardingAddress')?.addEventListener('click',async()=>{
        try{await json('/api/email/forwarding/setup',{method:'POST',body:'{}'});await email();}catch(error){alert(error.message);}
      });
      document.getElementById('copyForwardingAddress')?.addEventListener('click',async()=>{
        const input=document.getElementById('forwardingAddress'),value=input?.value||'';if(!value)return;
        try{await navigator.clipboard.writeText(value);alert('Forwarding address copied.');}
        catch{input?.select();document.execCommand?.('copy');alert('Forwarding address copied.');}
      });
      document.getElementById('refreshForwardedInbox')?.addEventListener('click',async()=>{try{if(mailbox.connected)await json('/api/email/mailbox/sync',{method:'POST',body:'{}'});}catch(error){alert(error.message);}emailInboxSeen.clear();await email();});
      document.getElementById('requestEmailCode')?.addEventListener('click',async()=>{try{await json('/api/email/verification/request',{method:'POST',body:'{}'});alert('Verification code sent. It expires in 10 minutes.');}catch(e){alert(e.message);}});
      document.getElementById('confirmEmailForm')?.addEventListener('submit',async e=>{e.preventDefault();try{await json('/api/email/verification/confirm',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });await email();}catch(err){alert(err.message);}});
      host.querySelectorAll('[data-inbox-action]').forEach(btn=>btn.addEventListener('click',async()=>{
        const action=btn.dataset.inboxAction,id=btn.dataset.id;if(action==='open'){if(btn.dataset.tab)window.switchTab?.(btn.dataset.tab);return;}
        if(action==='reply'){const item=inbox.find(x=>x.id===id),form=document.getElementById('mailboxComposeForm');if(!item||!form)return;const address=(String(item.sender||'').match(/<([^<>\s]+@[^<>\s]+)>/)||[])[1]||String(item.sender||'').trim();form.elements.to.value=address;form.elements.subject.value=/^re:/i.test(item.title)?item.title:'Re: '+item.title;form.elements.text.focus();form.scrollIntoView({behavior:'smooth',block:'center'});return;}
        if(action==='delete'){if(!confirm('Delete this dashboard inbox item? The original email or Little Feet record will stay in its source system.'))return;await json('/api/email/inbox/'+encodeURIComponent(id),{method:'DELETE'});}
        else {const item=inbox.find(x=>x.id===id);await json('/api/email/inbox/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify(action==='read'?{read:!item.read}:{pinned:!item.pinned})});}
        await email();
      }));
      document.getElementById('deleteAllInbox')?.addEventListener('click',async()=>{if(!confirm('Delete all dashboard inbox copies? Original forwarded emails and Little Feet records will stay in their source systems.'))return;await json('/api/email/inbox',{method:'DELETE'});emailInboxSeen.clear();await email();});
    }catch(e){host.innerHTML=`<p class="meta">${esc(e.message)}</p>`;}
  }
  let emailPoll=null;const startEmailPoll=()=>{if(emailPoll)clearInterval(emailPoll);emailPoll=setInterval(async()=>{if(!user()?.username||document.hidden||!document.getElementById('emailIntegrationContent'))return;try{const status=await json('/api/email/mailbox/status');if(status.connected)await json('/api/email/mailbox/sync',{method:'POST',body:'{}'});await email();}catch{}},60000);};

  const load=()=>{qualifications();kpiHistory();development();email();startEmailPoll();};
  document.addEventListener('littlefeet:session-ready',load);
  if(user()?.username)load();
  window.refreshStaffQualifications=qualifications;window.refreshKpiHistory=kpiHistory;window.refreshStaffDevelopment=development;window.refreshEmailIntegration=email;
})();
