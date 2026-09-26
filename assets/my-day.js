(function () {
  'use strict';

  const STAFF_ROLES = new Set(['teacher', 'principal', 'admin']);
  const STYLE_ID = 'littleFeetMyDayStyles';

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
      .my-day-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:18px;}
      .my-day-action{min-width:0;min-height:142px;text-align:left;padding:18px;border:1px solid var(--border-color);border-radius:12px;background:linear-gradient(145deg,var(--panel-bg),rgba(15,43,72,.72));color:var(--text-dark);cursor:pointer;transition:transform .16s ease,border-color .16s ease,background .16s ease;}
      .my-day-action:hover,.my-day-action:focus-visible{transform:translateY(-2px);border-color:rgba(94,234,212,.7);outline:none;}
      .my-day-action strong{display:block;margin-bottom:6px;color:#5eead4;font-size:1rem;}
      .my-day-action span{display:block;color:var(--text-muted);font-size:.84rem;line-height:1.45;}
      .my-day-action b{display:inline-block;margin-top:13px;color:#99f6e4;font-size:.78rem;}
      .my-day-section-title{margin:4px 0 12px;font-size:1rem;color:var(--text-dark);}
      .my-day-note{padding:14px 16px;border-left:3px solid var(--primary-color);border-radius:8px;background:rgba(13,148,136,.08);color:var(--text-muted);font-size:.84rem;line-height:1.45;}
      @media(max-width:600px){.my-day-hero{padding:19px 17px}.my-day-grid{grid-template-columns:1fr}.my-day-action{min-height:0}.my-day-hero::after{width:130px;height:130px;opacity:.12}}
      @media(prefers-reduced-motion:reduce){.my-day-action{transition:none}.my-day-action:hover,.my-day-action:focus-visible{transform:none}}
    `;
    document.head.appendChild(style);
  };

  const action = (tab, title, description, label = 'Open workspace →') =>
    `<button type="button" class="my-day-action" data-my-day-open="${esc(tab)}"><strong>${esc(title)}</strong><span>${esc(description)}</span><b>${esc(label)}</b></button>`;

  const buildTab = user => {
    if (document.getElementById('myDayTab')) return;
    const container = document.querySelector('#dashboardSection .container');
    if (!container) return;

    const role = String(user.role || '').toLowerCase();
    const firstName = String(user.name || user.displayName || 'there').trim().split(/\s+/)[0];
    const today = new Intl.DateTimeFormat(undefined, { weekday:'long', day:'numeric', month:'long', year:'numeric' }).format(new Date());

    const management = role === 'admin' || role === 'principal'
      ? action('operationsTab', 'School operations', 'Review operational records, school workflows and items that need management attention.')
      : action('progressTab', 'Development', 'Jump into learner development records and today\'s classroom evidence.');

    const adminOnly = role === 'admin'
      ? action('accountsTab', 'People & accounts', 'Manage staff and family accounts, links and access from one place.')
      : '';

    const tab = document.createElement('div');
    tab.id = 'myDayTab';
    tab.className = 'tab-content';
    tab.innerHTML = `
      <section class="my-day-hero" aria-labelledby="myDayHeading">
        <div class="my-day-kicker">Your working day</div>
        <h2 id="myDayHeading">Good day, ${esc(firstName)}.</h2>
        <p>Everything you are most likely to need today, without hunting through the portal. Little Feet keeps the full workspaces intact — My Day is the front door to them.</p>
        <span class="my-day-date">${esc(today)}</span>
      </section>

      <h3 class="my-day-section-title">Start here</h3>
      <section class="my-day-grid" aria-label="Today's main work">
        ${action('attendanceTab', 'Daily attendance', 'Capture or review today\'s learner attendance before the school day gets away from you.')}
        ${action('scheduleTab', 'Timetable', 'See timetable records and the day\'s scheduled learning activities.')}
        ${action('schoolDayTab', 'School Day Hub', 'Open the existing day-to-day school workspace for live operational work.')}
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

    const guide = document.getElementById('guideTab');
    if (guide) container.insertBefore(tab, guide);
    else container.appendChild(tab);

    tab.addEventListener('click', event => {
      const button = event.target.closest('[data-my-day-open]');
      if (button) open(button.dataset.myDayOpen);
    });
  };

  const buildNav = () => {
    if (document.querySelector('[data-my-day-nav]')) return;
    const homeButton = document.querySelector('#mainNavigation button[onclick*="homeTab"]');
    const homeItem = homeButton?.closest('li');
    if (!homeItem) return;

    const item = document.createElement('li');
    item.dataset.roles = 'teacher,principal,admin';
    item.dataset.myDayNav = 'true';
    item.innerHTML = '<button type="button" class="nav-btn">My Day</button>';
    item.querySelector('button').addEventListener('click', function () {
      if (typeof window.switchTab === 'function') window.switchTab('myDayTab', this);
      else open('myDayTab');
    });
    homeItem.insertAdjacentElement('afterend', item);
  };

  const getSessionUser = async () => {
    try {
      const response = await fetch('/api/session', { credentials:'same-origin', headers:{ Accept:'application/json' } });
      if (!response.ok) return null;
      const payload = await response.json();
      return payload?.user || payload?.account || null;
    } catch {
      return null;
    }
  };

  const init = async () => {
    if (!document.getElementById('dashboardSection')) return;
    const user = await getSessionUser();
    const role = String(user?.role || '').toLowerCase();
    if (!user || !STAFF_ROLES.has(role)) return;
    addStyles();
    buildNav();
    buildTab(user);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
