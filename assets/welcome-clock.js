(() => {
  'use strict';
  const formatter = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let baseTime = Date.now(), baseTick = performance.now(), timer, observer;
  const render = () => {
    const now = new Date(baseTime + performance.now() - baseTick);
    const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
    document.querySelectorAll('.welcome-clock').forEach(clock => {
      const time = clock.querySelector('time');
      time.textContent = `${parts.hour}:${parts.minute}:${parts.second}`;
      time.dateTime = now.toISOString();
      clock.querySelector('.clock-hour').style.transform = `rotate(${Number(parts.hour) * 30 + Number(parts.minute) / 2}deg)`;
      clock.querySelector('.clock-minute').style.transform = `rotate(${Number(parts.minute) * 6 + Number(parts.second) / 10}deg)`;
      clock.querySelector('.clock-second').style.transform = `rotate(${Number(parts.second) * 6}deg)`;
    });
  };
  window.syncLittleFeetClock = (timestamp, roundTrip = 0) => {
    const value = Date.parse(timestamp);
    if (!Number.isFinite(value)) return;
    baseTime = value + Math.max(0, Math.min(Number(roundTrip) || 0, 10000)) / 2;
    baseTick = performance.now();
    render();
  };
  const mount = () => {
    document.querySelectorAll('.portal-welcome-banner, .my-day-hero').forEach(banner => {
      if (banner.querySelector('.welcome-clock')) return;
      const clock = document.createElement('div');
      clock.className = 'welcome-clock';
      clock.innerHTML = '<div class="clock-face" aria-hidden="true"><span class="clock-twelve">12</span><span class="clock-three">3</span><span class="clock-six">6</span><span class="clock-nine">9</span><i class="clock-hand clock-hour"></i><i class="clock-hand clock-minute"></i><i class="clock-hand clock-second"></i><b class="clock-pin"></b></div><div class="clock-readout"><time aria-label="Current time in South Africa"></time><span>South Africa · SAST</span></div>';
      banner.append(clock);
    });
    render();
  };
  const schedule = () => {
    clearInterval(timer);
    if (!document.hidden) { render(); timer = setInterval(render, 1000); }
  };
  const start = () => {
    observer?.disconnect();
    mount();
    observer = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && !node.closest('.welcome-clock')))) mount();
    });
    const dashboard = document.getElementById('dashboardSection');
    if (dashboard) observer.observe(dashboard, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', schedule);
    schedule();
  };
  document.addEventListener('littlefeet:session-ended', () => {
    clearInterval(timer); observer?.disconnect();
    document.removeEventListener('visibilitychange', schedule);
    document.querySelectorAll('.welcome-clock').forEach(clock => clock.remove());
  });
  if (typeof window.registerLittleFeetWorkspace === 'function') window.registerLittleFeetWorkspace('welcome-clock', start);
  else document.addEventListener('littlefeet:session-ready', start);
})();
