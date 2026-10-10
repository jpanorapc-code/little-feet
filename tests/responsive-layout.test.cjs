// Browser geometry regression; run with an installed Playwright on NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const backupSource = require('../scripts/source-layout').readFrontendSource(root);
const pageSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const workplaceExtendedSource = fs.readFileSync(path.join(root, 'assets', 'workplace-extended.js'), 'utf8');
assert.match(backupSource, /--portal-sidebar-top/, 'Sidebar runtime offset variable must be maintained');
assert.match(backupSource, /addEventListener\(['"]scroll['"],\s*queuePortalHeaderOffsetSync/, 'Sidebar/header offset must resync while the page scrolls');
assert.match(pageSource, /id="lfNotificationStack" class="lf-notification-stack is-collapsed"/, 'Emails control must be present in the header before API loading finishes');
assert.match(pageSource, /workplace-extended\.js\?v=20261009-stage-navigation-v1/, 'Responsive email/header JS must be cache-busted');
assert.doesNotMatch(pageSource, /\.lf-notification-stack\{top:72px;right:8px;bottom:8px/, 'Legacy floating email offset must stay removed');
assert.match(workplaceExtendedSource, /stack\.dataset\.notificationReady==='true'/, 'Existing header email dock must be safely initialised instead of recreated');
const sizes = [[320, 740], [390, 844], [640, 900], [768, 1024], [844, 390], [930, 520], [959, 900], [960, 900], [1024, 768], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440], [3840, 2160]];
let browser;
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml' }[path.extname(file)];
  if (type) res.setHeader('Content-Type', type);
  if (path.extname(file) === '.html') {
    res.end(fs.readFileSync(file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
    return;
  }
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.LF_BROWSER_CHANNEL ? { channel: process.env.LF_BROWSER_CHANNEL } : {}) });
  // Geometry is tested independently of network APIs and animation timing.
  const context = await browser.newContext();
  await context.route('https://**', route => route.abort());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '*, *::before, *::after { animation:none !important; transition:none !important; }' });
  const structure = await page.evaluate(() => {
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('dashboardSection').classList.remove('hidden');
    document.body.classList.add('portal-active');
    document.querySelectorAll('.role-admin, [data-roles]').forEach(el => el.classList.remove('hidden'));
    document.getElementById('displayRole').textContent = 'School Administrator · ADMIN';
    // This geometry harness deliberately strips executable scripts from index.html,
    // so inject the same default avatar markup that backup.js would render.
    document.getElementById('userAvatar').innerHTML = '<svg class="profile-avatar-image profile-avatar-classic" viewBox="0 0 128 128" aria-hidden="true"><use href="/assets/profile/penguin-profile-avatars.svg?v=20261002-avatar-svg-v2#avatar-classic"></use></svg>';
    return [...document.querySelectorAll('.tab-content')].filter(tab => !tab.parentElement.matches('#dashboardSection > .container')).map(tab => tab.id);
  });
  assert.deepEqual(structure, [], 'Every tab must remain inside the shared content container');
  await page.evaluate(() => { window.registerLittleFeetWorkspace = (_, start) => start(); });
  await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'assets', 'welcome-clock.js'), 'utf8') });
  assert.equal(await page.locator('#homeTab .welcome-clock').count(), 1);
  const failures = [];
  let checks = 0;
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const collapsed of [false, true]) {
      const result = await page.evaluate(({ width, collapsed }) => {
        const dashboard = document.getElementById('dashboardSection');
        const sidebar = document.getElementById('mainNavigation');
        dashboard.classList.toggle('sidebar-collapsed', collapsed);
        sidebar.classList.toggle('is-collapsed', collapsed);
        dashboard.classList.remove('sidebar-open');
        const header = dashboard.querySelector('nav');
        document.documentElement.style.setProperty('--portal-header-height', `${header.getBoundingClientRect().height}px`);
        document.documentElement.style.setProperty('--mobile-header-height', `${header.getBoundingClientRect().height}px`);
        const errors = [];
        const dockedSnappedDesktop = window.matchMedia('(min-width: 900px) and (max-width: 1199px) and (hover: hover) and (pointer: fine)').matches;
        const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
        const fits = element => { const r = element.getBoundingClientRect(); return r.left >= -1 && r.right <= document.documentElement.clientWidth + 1; };
        const headerButtons = [...header.querySelectorAll('button')].filter(visible);
        for (const button of headerButtons) if (!fits(button)) errors.push(`header clipped: ${button.textContent.trim()}`);

        const overlaps = (a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          const x = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
          const y = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
          return x > 1 && y > 1;
        };
        for (let i = 0; i < headerButtons.length; i += 1) {
          for (let j = i + 1; j < headerButtons.length; j += 1) {
            if (overlaps(headerButtons[i], headerButtons[j])) {
              errors.push(`header buttons overlap: ${headerButtons[i].textContent.trim()} / ${headerButtons[j].textContent.trim()}`);
            }
          }
        }

        const requiredHeaderControls = [
          ['user switch', '.user-switch-control'],
          ['Emails', '[data-notification-collapse]'],
          ['sound', '[data-portal-audio-mute]'],
          ['theme', '[onclick="toggleDarkMode()"]']
        ];
        for (const [label, selector] of requiredHeaderControls) {
          const control = header.querySelector(selector);
          if (!control || !visible(control)) errors.push(`header control missing: ${label}`);
        }
        const emailButton = header.querySelector('[data-notification-collapse]');
        const emailDock = document.getElementById('lfNotificationStack');
        const userPanel = document.getElementById('navUserPanel');
        if (emailButton && emailDock && userPanel && visible(emailButton)) {
          const emailRect = emailButton.getBoundingClientRect();
          const panelRect = userPanel.getBoundingClientRect();
          const headerRect = header.getBoundingClientRect();
          if (width > 640 && getComputedStyle(userPanel).display !== 'contents' && (emailRect.top < panelRect.top - 1 || emailRect.bottom > panelRect.bottom + 1)) errors.push('Emails control floats outside account row');
          if (emailRect.top < headerRect.top - 1 || emailRect.bottom > headerRect.bottom + 1) errors.push('Emails control floats outside header');
          if (getComputedStyle(emailDock).position === 'fixed') errors.push('Emails dock itself must not be fixed/floating');
        }
        if (width < 960 && !dockedSnappedDesktop) {
          const menu = document.getElementById('navMoreToggle');
          if (!menu || !visible(menu)) errors.push('mobile/tablet Menu control missing');
        }
        if (dockedSnappedDesktop) {
          const menu = document.getElementById('navMoreToggle');
          if (menu && visible(menu)) errors.push('snapped desktop should use the docked sidebar, not a Menu drawer control');
        }
        if (width > 640 && width < 1200) {
          const quickbar = header.querySelector('.nav-quickbar');
          const userPanel = header.querySelector('.nav-user-panel');
          const term = header.querySelector('.nav-term-panel');
          const menu = document.getElementById('navMoreToggle');
          const shortcuts = [...header.querySelectorAll('.nav-shortcut')].filter(visible);
          const quickRow = [...shortcuts, ...(menu && visible(menu) ? [menu] : [])];
          const expectedQuickActions = dockedSnappedDesktop ? 3 : 4;
          if (!quickbar || !userPanel || !term || quickRow.length < expectedQuickActions) errors.push('snapped header controls missing');
          if (quickbar && userPanel) {
            if (getComputedStyle(quickbar).display === 'contents') errors.push('snapped quickbar must remain a real grid wrapper');
            if (getComputedStyle(userPanel).display === 'contents') errors.push('snapped account panel must remain a real flex wrapper');
          }
          if (quickRow.length >= expectedQuickActions) {
            const tops = quickRow.map(el => Math.round(el.getBoundingClientRect().top));
            if (Math.max(...tops) - Math.min(...tops) > 2) errors.push('snapped quick actions are not on one row');
          }
          if (term && quickRow[0]) {
            const termTop = Math.round(term.getBoundingClientRect().top);
            const actionTop = Math.round(quickRow[0].getBoundingClientRect().top);
            if (Math.abs(termTop - actionTop) > 3) errors.push('snapped term and quick actions are not on one row');
          }
          const brand = header.querySelector('.nav-brand');
          if (brand && userPanel) {
            const brandTop = Math.round(brand.getBoundingClientRect().top);
            const panelTop = Math.round(userPanel.getBoundingClientRect().top);
            if (Math.abs(brandTop - panelTop) > 4) errors.push('snapped brand/account row misaligned');
          }
          if (header.getBoundingClientRect().height > 105) errors.push('snapped header is too tall');
        }
        const tabs = [...document.querySelectorAll('.tab-content')];
        for (const tab of tabs) {
          tabs.forEach(t => t.classList.toggle('active', t === tab));
          const bounds = tab.getBoundingClientRect();
          if (!fits(tab)) errors.push(`${tab.id}: outside viewport`);
          if ((width >= 960 || dockedSnappedDesktop) && bounds.left < sidebar.getBoundingClientRect().right - 1) errors.push(`${tab.id}: under sidebar`);
          for (const control of tab.querySelectorAll('input:not([type="hidden"]), select, textarea, button, .card, .workspace-card')) {
            if (!visible(control) || control.closest('.cinematic-journey') || control.classList.contains('sr-only')) continue;
            if (!fits(control)) errors.push(`${tab.id}: clipped ${control.id || control.className || control.tagName}`);
          }
        }
        if (width <= 640) {
          // Measure Home controls while Home is visible, not after the loop has
          // switched to Guide (hidden elements have zero-sized rectangles).
          tabs.forEach(t => t.classList.toggle('active', t.id === 'homeTab'));
          const mapButton = document.getElementById('findSchoolMapButton');
          const mapCard = mapButton?.closest('.card');
          if (mapButton && mapCard) {
            const buttonRect = mapButton.getBoundingClientRect();
            const cardRect = mapCard.getBoundingClientRect();
            if (buttonRect.width >= cardRect.width - 24) errors.push('mobile school map button is oversized');
            if (buttonRect.height > 48) errors.push('mobile school map button is too tall');
          }
          const activeTourCopy = document.querySelector('.portal-tour-slide.is-active .portal-tour-copy');
          const activeTourHeading = document.querySelector('.portal-tour-slide.is-active h2');
          if (activeTourCopy && activeTourCopy.scrollHeight > activeTourCopy.clientHeight + 2) errors.push('mobile portal tour copy is clipped');
          if (activeTourHeading && parseFloat(getComputedStyle(activeTourHeading).fontSize) > 22) errors.push('mobile portal tour heading is oversized');

          const shortcuts = [...header.querySelectorAll('.nav-shortcut')].filter(visible);
          const mobileMenu = document.getElementById('navMoreToggle');
          const quickActions = [...shortcuts, ...(mobileMenu && visible(mobileMenu) ? [mobileMenu] : [])];
          if (quickActions.length >= 4) {
            const tops = quickActions.map(button => Math.round(button.getBoundingClientRect().top));
            if (Math.max(...tops) - Math.min(...tops) > 2) errors.push('mobile Home/Search/Help/Menu are not on one row');
          }
          if (header.getBoundingClientRect().height > 170) errors.push('mobile header is too tall');
          const menuButton = document.getElementById('navMoreToggle');
          if (menuButton && menuButton.getBoundingClientRect().height > 48) errors.push('mobile menu button is too tall');
          const userSwitch = header.querySelector('.user-switch-control');
          const accountAvatar = document.getElementById('userAvatar');
          const accountLabel = document.getElementById('displayRole');
          const serverStatus = document.getElementById('serverStatus');
          const emailControl = header.querySelector('[data-notification-collapse]');
          const soundControl = header.querySelector('[data-portal-audio-mute]');
          const themeControl = header.querySelector('[onclick="toggleDarkMode()"]');
          if (!userSwitch || !visible(userSwitch) || userSwitch.getBoundingClientRect().width > 50) errors.push('mobile account control is missing or oversized');
          if (!accountAvatar || !visible(accountAvatar) || accountAvatar.getBoundingClientRect().width < 28) errors.push('mobile account avatar is missing');
          const avatarSprite = accountAvatar?.querySelector('svg.profile-avatar-image');
          if (!avatarSprite || !visible(avatarSprite)) {
            errors.push('mobile penguin SVG is missing');
          } else {
            const spriteRect = avatarSprite.getBoundingClientRect();
            const use = avatarSprite.querySelector('use');
            const href = use?.getAttribute('href') || '';
            if (spriteRect.width < 30 || spriteRect.height < 30) errors.push('mobile penguin SVG is too small');
            if (!href.includes('penguin-profile-avatars.svg') || !href.includes('#avatar-')) errors.push('mobile penguin SVG source is wrong');
          }
          if (accountLabel && getComputedStyle(accountLabel).display !== 'none') errors.push('mobile long account label should be hidden');
          const toolbarRow = [...quickActions, emailControl, soundControl, themeControl].filter(Boolean).filter(visible);
          if (toolbarRow.length >= 7) {
            const tops = toolbarRow.map(element => Math.round(element.getBoundingClientRect().top));
            if (Math.max(...tops) - Math.min(...tops) > 3) errors.push('mobile task-bar controls are not aligned on one row');
          }

          const termsNotice = document.getElementById('termsNotice');
          if (termsNotice && visible(termsNotice) && width <= 420 && termsNotice.getBoundingClientRect().height > 230) errors.push('mobile privacy notice is too tall');
          const welcomeBanner = document.querySelector('#homeTab > .portal-welcome-banner');
          if (welcomeBanner && visible(welcomeBanner) && welcomeBanner.getBoundingClientRect().height > 200) errors.push('mobile welcome hero is too tall');
        }
        if (width < 960 && !dockedSnappedDesktop) {
          dashboard.classList.add('sidebar-open');
          const navButton = sidebar.querySelector('.nav-btn');
          if (sidebar.getBoundingClientRect().width < 200 || getComputedStyle(sidebar.querySelector('.sidebar-links')).opacity === '0' || getComputedStyle(sidebar.querySelector('.sidebar-links')).pointerEvents === 'none') errors.push('mobile menu inherits collapsed desktop state');
          if (!fits(navButton)) errors.push('mobile menu button clipped');
          dashboard.classList.remove('sidebar-open');
        }
        return { errors, count: tabs.length };
      }, { width, collapsed });
      failures.push(...result.errors.map(message => `${width}x${height}, collapsed=${collapsed}: ${message}`));
      checks += result.count;

      if (width >= 960 && !collapsed) {
        const before = await page.evaluate(() => {
          const sidebar = document.getElementById('mainNavigation');
          const rect = sidebar.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, position: getComputedStyle(sidebar).position };
        });
        await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - innerHeight)));
        const after = await page.evaluate(() => {
          const header = document.querySelector('#dashboardSection > nav');
          const headerRect = header.getBoundingClientRect();
          const headerHeight = Math.ceil(headerRect.height);
          const visibleHeaderBottom = Math.max(0, Math.min(headerHeight, Math.ceil(headerRect.bottom)));
          document.documentElement.style.setProperty('--portal-sidebar-top', `${visibleHeaderBottom}px`);
          const sidebar = document.getElementById('mainNavigation');
          const rect = sidebar.getBoundingClientRect();
          return {
            top: rect.top,
            bottom: rect.bottom,
            position: getComputedStyle(sidebar).position,
            viewport: innerHeight,
            expectedTop: visibleHeaderBottom
            , headerTop: headerRect.top
          };
        });
        if (before.position !== 'fixed' || after.position !== 'fixed') failures.push(`${width}x${height}: desktop sidebar is not fixed`);
        if (Math.abs(after.headerTop) > 1) failures.push(`${width}x${height}: header scrolls out of view`);
        if (Math.abs(after.top - after.expectedTop) > 1) failures.push(`${width}x${height}: desktop sidebar is not attached to the visible header edge`);
        if (Math.abs(after.bottom - after.viewport) > 1) failures.push(`${width}x${height}: desktop sidebar is not pinned to viewport bottom`);
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          document.documentElement.style.removeProperty('--portal-sidebar-top');
        });
      }
    }
  }
  assert.deepEqual(failures, [], `${failures.length} responsive failures:\n${failures.slice(0, 30).join('\n')}`);
  console.log(`Responsive layout passed: ${checks} tab/state/viewport checks across ${sizes.length} phone, tablet, landscape, desktop and TV sizes.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
