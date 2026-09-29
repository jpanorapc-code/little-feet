(function () {
  'use strict';

  const STAFF_ROLES = new Set(['teacher', 'principal', 'admin', 'staff']);
  const STYLE_ID = 'littleFeetMyDayStyles';
  let currentUser = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  const open = tabId => {
    if (typeof window.openWorkspace === 'function') window.openWorkspace(tabId);
    else if (typeof window.switchTab === 'function') window.switchTab(tabId);
  };

  const addStyles = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .my-day-hero{position:relative;overflow:hidden;margin-bottom:18px;padding:24px;border:1px solid rgba(94,234,212,.32);border-radius:16px;background:linear-gradient(135deg,rgba(13,148,136,.18),rgba(15,43,72,.94));}
      .my-day-hero::after{content:"";position:absolute;right:-28px;bottom:-36px;width:180px;height:180px;background:url('/assets/4k/sidebar-penguin-hq.png') center/contain no-repeat;opacity:.18;pointer-events:none;}
      .my-day-kicker{color:#99f6e4;font-size:.72rem;font-weight:800;letter-spacing:.11em;text-transform:uppercase;}
      .my-day-hero h2{position:relative;z-index:1;margin:5px 0 6px;font-size:clamp(1.35rem,3vw,2rem);}
      .my-day-hero p{position:relative;z-index:1;max-width:700px;color:var(--text-muted);line-height:1.5;}
      .my-day-date{display:inline-flex;margin-top:14px;padding:6px 10px;border:1px solid rgba(94,234,212,.25);border-radius:999px;background:rgba(7,17,30,.3);color:#ccfbf1;font-size:.8rem;font-weight:700;}
      .my-day-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:12px;margin-bottom:20px;align-items:stretch;}
      .my-day-action{min-width:0;min-height:132px;height:100%;text-align:left;padding:16px 17px;border:1px solid rgba(94,234,212,.26);border-radius:12px;background:linear-gradient(145deg,rgba(13,42,92,.94),rgba(10,36,77,.9));color:var(--text-dark);cursor:pointer;transition:transform .16s ease,border-color .16s ease,background .16s ease;display:flex;flex-direction:column;}
      .my-day-action:hover,.my-day-action:focus-visible{transform:translateY(-2px);border-color:rgba(94,234,212,.7);outline:none;}
      .my-day-action strong{display:block;margin-bottom:6px;color:#5eead4;font-size:.94rem;line-height:1.25;}
      .my-day-action span{display:block;color:var(--text-muted);font-size:.80rem;line-height:1.42;}
      .my-day-action b{display:inline-block;margin-top:auto;padding-top:11px;color:#99f6e4;font-size:.74rem;}
      .my-day-section-title{margin:4px 0 12px;font-size:1rem;color:var(--text-dark);}
      .my-day-note{padding:14px 16px;border-left:3px solid var(--primary-color);border-radius:8px;background:rgba(13,148,136,.08);color:var(--text-muted);font-size:.84rem;line-height:1.45;}
      .my-day-attention{margin-bottom:18px;padding:18px;border:1px solid rgba(94,234,212,.3);border-radius:14px;background:linear-gradient(145deg,rgba(13,148,136,.11),rgba(15,43,72,.72));}
      .my-day-attention-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;}
      .my-day-attention-head h3{margin:0;font-size:1rem;}
      .my-day-attention-count{min-width:32px;padding:5px 9px;border-radius:999px;background:var(--primary-color);color:#fff;text-align:center;font-size:.78rem;font-weight:800;}
      .my-day-attention-list{display:grid;gap:8px;}
      .my-day-attention-item{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:11px 12px;border:1px solid var(--border-color);border-radius:9px;background:rgba(7,17,30,.24);color:var(--text-dark);text-align:left;cursor:pointer;}
      .my-day-attention-item:hover,.my-day-attention-item:focus-visible{border-color:rgba(94,234,212,.65);outline:none;}
      .my-day-attention-item span{color:var(--text-muted);font-size:.8rem;}
      .my-day-attention-empty{margin:0;color:var(--text-muted);font-size:.84rem;}
      .my-day-attention-refresh{border:0;background:transparent;color:#99f6e4;cursor:pointer;font-weight:700;font-size:.78rem;}
      @media(max-width:600px){.my-day-hero{padding:19px 17px}.my-day-grid{grid-template-columns:1fr}.my-day-action{min-height:0}.my-day-hero::after{width:130px;height:130px;opacity:.12}}
      @media(prefers-reduced-motion:reduce){.my-day-action{transition:none}.my-day-action:hover,.my-day-action:focus-visible{transform:none}}
    `;
    document.head.appendChild(style);
  };

  const action = (tab, title, description, label = 'Open workspace →') =>
    `<button type="button" class="my-day-action" data-my-day-open="${esc(tab)}"><strong>${esc(title)}</strong><span>${esc(description)}</span><b>${esc(label)}</b></button>`;

  const buildTab = user => {
    const container = document.querySelector('#dashboardSection .container');
    if (!container) return;
    let tab = document.getElementById('myDayTab');
    if (tab?.dataset.myDayReady === 'true') return;

    const role = String(user.role || '').toLowerCase();
    const firstName = String(user.name || user.displayName || 'there').trim().split(/\s+/)[0];
    const today = new Intl.DateTimeFormat(undefined, { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date());

    const management = role === 'admin' || role === 'principal'
      ? action('operationsTab', 'School operations', 'Review operational records, school workflows and items that need management attention.')
      : action('progressTab', 'Development', 'Jump into learner development records and today\'s classroom evidence.');

    const adminOnly = role === 'admin'
      ? action('accountsTab', 'People & accounts', 'Manage staff and family accounts, links and access from one place.')
      : '';

    if (!tab) {
      tab = document.createElement('div');
      tab.id = 'myDayTab';
      tab.className = 'tab-content';
      tab.dataset.roles = 'teacher,principal,admin,staff';
      const guide = document.getElementById('guideTab');
      if (guide) container.insertBefore(tab, guide);
      else container.appendChild(tab);
    }
    tab.dataset.myDayReady = 'true';
    tab.innerHTML = `
      <section class="my-day-hero" aria-labelledby="myDayHeading">
        <div class="my-day-kicker">Your working day</div>
        <h2 id="myDayHeading">Good day, ${esc(firstName)}.</h2>
        <p>Everything you are most likely to need today, without hunting through the portal. Little Feet keeps the full workspaces intact — My Day is the front door to them.</p>
        <span class="my-day-date">${esc(today)}</span>
      </section>

      <section class="my-day-attention" aria-labelledby="myDayAttentionHeading">
        <div class="my-day-attention-head"><h3 id="myDayAttentionHeading">Needs my attention</h3><div><button type="button" class="my-day-attention-refresh" id="myDayAttentionRefresh">Refresh</button> <span class="my-day-attention-count" id="myDayAttentionCount">…</span></div></div>
        <div class="my-day-attention-list" id="myDayAttentionList"><p class="my-day-attention-empty">Checking your current Little Feet workspaces…</p></div>
      </section>

      <h3 class="my-day-section-title">Start here</h3>
      <section class="my-day-grid" aria-label="Today's main work">
        ${action('attendanceTab', 'Daily attendance', 'Capture or review today\'s learner attendance before the school day gets away from you.')}
        ${action('scheduleTab', 'Timetable', 'See timetable records and the day\'s scheduled learning activities.')}
        ${action('schoolDayTab', 'School Day Hub', 'Open the existing day-to-day school workspace for live operational work.')}\n        ${action('staffWorkTab', 'Staff Work', 'Manage staff tasks, leave requests and teacher cover from one workplace.')}\n        ${action('staffNoticesTab', 'Staff Notice Board', 'Read staff notices and acknowledge required updates.')}\n        ${action('meetingMinutesTab', 'Meetings & Minutes', 'Turn approved meetings into minutes, decisions and assigned action tasks.')}\n        ${action('maintenanceTab', 'Maintenance', 'Report issues, assign work orders and track repairs to completion.')}\n        ${action('resourceBookingTab', 'Resource Booking', 'Reserve rooms, facilities, vehicles and equipment without double-booking.')}\n        ${action('purchaseRequestsTab', 'Purchase Requests', 'Request supplies and equipment, then track approval and fulfilment.')}\n        ${action('qualificationsTab', 'Training & Qualifications', 'Track certificates, renewals and staff compliance expiries.')}\n        ${action('kpiHistoryTab', 'KPI History', 'Review your monthly task-performance trend over time.')}\n        ${action('staffDevelopmentTab', 'Staff Development', 'Follow development goals created from performance feedback.')}\n        ${['admin','principal'].includes(role) ? action('approvalsTab', 'Approvals Centre', 'Review leave and meeting requests waiting for a management decision.') : ''}
        ${action('chatTab', 'Messages', 'Open school conversations and follow up on communication that needs a response.')}
      </section>

      <h3 class="my-day-section-title">Keep the day moving</h3>
      <section class="my-day-grid" aria-label="Workday shortcuts">
        ${management}
        ${action('notesTab', 'Sticky notes', 'Keep quick working notes close while you move between school tasks.')}
        ${action('ticketsTab', 'Support & tickets', 'Check open support items or raise something that needs attention.')}
        ${action('broadcastsTab', 'Safety alerts', 'Go straight to important safety communication and current alerts.')}
        ${adminOnly}
      </section>

      <p class="my-day-note"><strong>My Day does not duplicate school records.</strong> It brings the existing Little Feet workspaces together into one daily starting point, so updates stay in their original systems and permissions continue to apply.</p>
    `;

    tab.addEventListener('click', event => {
      const button = event.target.closest('[data-my-day-open]');
      if (button) open(button.dataset.myDayOpen);
    });
    document.getElementById('myDayAttentionRefresh')?.addEventListener('click', loadAttention);
    loadAttention();
  };

  const buildNav = () => {
    if (document.querySelector('[data-my-day-nav]')) return;
    const homeButton = document.querySelector('#mainNavigation button[onclick*="homeTab"]');
    const homeItem = homeButton?.closest('li');
    if (!homeItem) return;

    const item = document.createElement('li');
    item.dataset.roles = 'teacher,principal,admin,staff';
    item.dataset.myDayNav = 'true';
    item.innerHTML = '<button type="button" class="nav-btn">My Day</button>';
    item.querySelector('button').addEventListener('click', function () {
      if (typeof window.switchTab === 'function') window.switchTab('myDayTab', this);
      else open('myDayTab');
    });
    homeItem.insertAdjacentElement('afterend', item);
  };


  const fetchJson = async url => {
    try {
      const response = await fetch(url, { credentials:'same-origin', headers:{ Accept:'application/json' } });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      // My Day is an optional dashboard summary. A transient/offline API failure
      // must not become an unhandled promise rejection or break the signed-in UI.
      console.warn('[My Day] Unable to load dashboard summary endpoint:', url, error);
      return null;
    }
  };

  const loadAttention = async () => {
    const list = document.getElementById('myDayAttentionList');
    const badge = document.getElementById('myDayAttentionCount');
    if (!list || !badge || !currentUser) return;
    list.innerHTML = '<p class="my-day-attention-empty">Checking your current Little Feet workspaces…</p>';

    const username = String(currentUser.username || '').toLowerCase();
    const [tickets, broadcasts, tasks, leave, cover, reviews, notices, maintenance, bookings, purchases, qualifications] = await Promise.all([
      fetchJson('/api/tickets'),
      fetchJson('/api/broadcasts'),
      fetchJson('/api/staff/tasks'),
      fetchJson('/api/staff/leave'),
      fetchJson('/api/staff/cover'),
      fetchJson('/api/staff/performance-reviews'),
      fetchJson('/api/staff/notices'),
      fetchJson('/api/maintenance'),
      fetchJson('/api/resources/bookings'),
      fetchJson('/api/purchase-requests'),
      fetchJson('/api/staff/qualifications')
    ]);

    const items = [];
    if (Array.isArray(qualifications)) {
      const expired = qualifications.filter(x => x.status === 'Expired');
      const expiring = qualifications.filter(x => x.status === 'Expiring soon');
      if (expired.length) items.push({ tab:'qualificationsTab', title:`${expired.length} qualification${expired.length===1?'':'s'} expired`, detail:'Review staff compliance' });
      if (expiring.length) items.push({ tab:'qualificationsTab', title:`${expiring.length} qualification${expiring.length===1?'':'s'} expiring within 30 days`, detail:'Plan renewals' });
    }
    if (Array.isArray(tickets)) {
      const assigned = tickets.filter(ticket =>
        String(ticket.status || '').toLowerCase() !== 'completed' &&
        String(ticket.assignedTo || '').toLowerCase() === username
      );
      const mine = tickets.filter(ticket =>
        String(ticket.status || '').toLowerCase() !== 'completed' &&
        String(ticket.createdBy || '').toLowerCase() === username &&
        String(ticket.assignedTo || '').toLowerCase() !== username
      );
      if (assigned.length) items.push({ tab:'ticketsTab', title:`${assigned.length} support item${assigned.length === 1 ? '' : 's'} assigned to you`, detail:'Open your Support Desk queue' });
      if (mine.length) items.push({ tab:'ticketsTab', title:`${mine.length} open ticket${mine.length === 1 ? '' : 's'} you are following`, detail:'Review status and responses' });
    }

    if (Array.isArray(tasks)) {
      const activeTasks = tasks.filter(item => String(item.status || '').toLowerCase() !== 'completed' && String(item.assignedTo || '').toLowerCase() === username);
      const today = new Date().toISOString().slice(0, 10);
      const overdue = activeTasks.filter(item => item.dueDate && item.dueDate < today);
      const dueToday = activeTasks.filter(item => item.dueDate === today);
      if (overdue.length) items.push({ tab:'staffWorkTab', title:`${overdue.length} overdue staff task${overdue.length === 1 ? '' : 's'}`, detail:'Open Staff Work' });
      if (dueToday.length) items.push({ tab:'staffWorkTab', title:`${dueToday.length} task${dueToday.length === 1 ? '' : 's'} due today`, detail:'Open Staff Work' });
    }
    if (Array.isArray(leave)) {
      const pendingLeave = leave.filter(item => String(item.status || '') === 'Pending');
      if (['admin','principal'].includes(String(currentUser.role || '').toLowerCase()) && pendingLeave.length) items.push({ tab:'approvalsTab', title:`${pendingLeave.length} leave request${pendingLeave.length === 1 ? '' : 's'} awaiting approval`, detail:'Review leave requests' });
    }
    if (Array.isArray(cover)) {
      const needsCover = cover.filter(item => String(item.status || '') === 'Needs Cover');
      const assignedToMe = cover.filter(item => String(item.status || '') === 'Assigned' && String(item.coverTeacher || '').toLowerCase() === username);
      if (['admin','principal'].includes(String(currentUser.role || '').toLowerCase()) && needsCover.length) items.push({ tab:'staffWorkTab', title:`${needsCover.length} class cover request${needsCover.length === 1 ? '' : 's'} unassigned`, detail:'Assign teacher cover' });
      if (assignedToMe.length) items.push({ tab:'staffWorkTab', title:`${assignedToMe.length} cover assignment${assignedToMe.length === 1 ? '' : 's'} for you`, detail:'Review teacher cover' });
    }
    if (Array.isArray(reviews)) {
      const sharedReviews = reviews.filter(item => String(item.status || '') === 'Shared' && String(item.username || '').toLowerCase() === username);
      if (sharedReviews.length) items.push({ tab:'staffWorkTab', title:`${sharedReviews.length} performance review${sharedReviews.length === 1 ? '' : 's'} awaiting acknowledgement`, detail:'Review your KPI feedback' });
    }
    if (Array.isArray(notices)) {
      const myRole = String(currentUser.role || '').toLowerCase();
      const pendingNotices = notices.filter(item => item.required && !item.acknowledged && (item.audience === 'All staff' || String(item.audience).toLowerCase() === myRole));
      if (pendingNotices.length) items.push({ tab:'staffNoticesTab', title:`${pendingNotices.length} staff notice${pendingNotices.length === 1 ? '' : 's'} awaiting acknowledgement`, detail:'Read staff notices' });
    }
    if (Array.isArray(maintenance)) {
      const mine = maintenance.filter(item => item.status !== 'Completed' && String(item.assignedTo || '').toLowerCase() === username);
      const unassigned = ['admin','principal'].includes(String(currentUser.role || '').toLowerCase()) ? maintenance.filter(item => item.status !== 'Completed' && !item.assignedTo) : [];
      if (mine.length) items.push({ tab:'maintenanceTab', title:`${mine.length} maintenance work order${mine.length===1?'':'s'} assigned to you`, detail:'Open maintenance' });
      if (unassigned.length) items.push({ tab:'maintenanceTab', title:`${unassigned.length} unassigned maintenance issue${unassigned.length===1?'':'s'}`, detail:'Assign work orders' });
    }
    if (Array.isArray(bookings)) {
      const today = new Date().toISOString().slice(0,10);
      const mineToday = bookings.filter(item => item.date === today && String(item.bookedBy || '').toLowerCase() === username);
      if (mineToday.length) items.push({ tab:'resourceBookingTab', title:`${mineToday.length} resource booking${mineToday.length===1?'':'s'} today`, detail:mineToday.map(x=>`${x.resource} ${x.startTime}`).join(' · ') });
    }
    if (Array.isArray(purchases)) {
      const pendingMine=purchases.filter(x=>x.status==='Pending'&&String(x.requestedBy||'').toLowerCase()===username);
      const awaitingManagement=['admin','principal'].includes(String(currentUser.role||'').toLowerCase())?purchases.filter(x=>x.status==='Pending'):[];
      if(pendingMine.length)items.push({tab:'purchaseRequestsTab',title:`${pendingMine.length} purchase request${pendingMine.length===1?'':'s'} awaiting approval`,detail:'View purchase requests'});
      if(awaitingManagement.length)items.push({tab:'approvalsTab',title:`${awaitingManagement.length} purchase request${awaitingManagement.length===1?'':'s'} need approval`,detail:'Open Approvals Centre'});
    }
    if (Array.isArray(broadcasts) && broadcasts.length) {
      items.push({ tab:'broadcastsTab', title:`${broadcasts.length} current safety alert${broadcasts.length === 1 ? '' : 's'}`, detail:'Review Safety Alerts' });
    }

    badge.textContent = String(items.reduce((sum, item) => sum + (Number.parseInt(item.title, 10) || 0), 0));
    list.innerHTML = items.length
      ? items.map(item => `<button type="button" class="my-day-attention-item" data-my-day-open="${esc(item.tab)}"><strong>${esc(item.title)}</strong><span>${esc(item.detail)} →</span></button>`).join('')
      : '<p class="my-day-attention-empty">Nothing from your connected Little Feet queues needs attention right now.</p>';
  };

  const getSessionUser = async () => {
    try {
      const response = await fetch('/api/auth/session', { credentials:'same-origin', headers:{ Accept:'application/json' } });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.authenticated ? (payload.user || null) : null;
    } catch {
      return null;
    }
  };

  const init = async () => {
    if (!document.getElementById('dashboardSection')) return;
    const user = window.getLittleFeetCurrentUser?.() || await getSessionUser();
    const role = String(user?.role || '').toLowerCase();
    if (!user || !STAFF_ROLES.has(role)) return;
    currentUser = user;
    addStyles();
    buildNav();
    buildTab(user);
    loadAttention();
  };

  let repairQueued = false;
  const queueRepair = () => {
    if (repairQueued || !currentUser) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      const role = String(currentUser?.role || '').toLowerCase();
      if (!STAFF_ROLES.has(role)) return;
      const tab = document.getElementById('myDayTab');
      if (!document.querySelector('[data-my-day-nav]') || !tab || tab.dataset.myDayReady !== 'true') init();
    });
  };

  const watchMyDayMounts = () => {
    const dashboard = document.getElementById('dashboardSection');
    if (!dashboard || dashboard.dataset.myDayObserverReady === 'true') return;
    dashboard.dataset.myDayObserverReady = 'true';
    new MutationObserver(queueRepair).observe(dashboard, { childList:true, subtree:true });
  };

  const start = async () => {
    await init();
    watchMyDayMounts();
  };

  // Initialise on page load, login/session restore, bfcache restore, and tab visibility changes.
  // The static nav/tab plus the observer make My Day self-healing if another UI refresh replaces DOM.
  document.addEventListener('littlefeet:session-ready', start);
  window.addEventListener('pageshow', start);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();
