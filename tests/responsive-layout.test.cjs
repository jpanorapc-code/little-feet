// Browser geometry regression; run with an installed Playwright on NODE_PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const sizes = [[320, 740], [390, 844], [640, 900], [768, 1024], [844, 390], [959, 900], [960, 900], [1024, 768], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440], [3840, 2160]];
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
    return [...document.querySelectorAll('.tab-content')].filter(tab => !tab.parentElement.matches('#dashboardSection > .container')).map(tab => tab.id);
  });
  assert.deepEqual(structure, [], 'Every tab must remain inside the shared content container');
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
        const visible = element => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
        const fits = element => { const r = element.getBoundingClientRect(); return r.left >= -1 && r.right <= document.documentElement.clientWidth + 1; };
        const headerButtons = [...header.querySelectorAll('button')].filter(visible);
        for (const button of headerButtons) if (!fits(button)) errors.push(`header clipped: ${button.textContent.trim()}`);
        const tabs = [...document.querySelectorAll('.tab-content')];
        for (const tab of tabs) {
          tabs.forEach(t => t.classList.toggle('active', t === tab));
          const bounds = tab.getBoundingClientRect();
          if (!fits(tab)) errors.push(`${tab.id}: outside viewport`);
          if (width >= 960 && bounds.left < sidebar.getBoundingClientRect().right - 1) errors.push(`${tab.id}: under sidebar`);
          for (const control of tab.querySelectorAll('input:not([type="hidden"]), select, textarea, button, .card, .workspace-card')) {
            if (!visible(control) || control.closest('.cinematic-journey') || control.classList.contains('sr-only')) continue;
            if (!fits(control)) errors.push(`${tab.id}: clipped ${control.id || control.className || control.tagName}`);
          }
        }
        if (width <= 640) {
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
        }
        if (width < 960) {
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
    }
  }
  assert.deepEqual(failures, [], `${failures.length} responsive failures:\n${failures.slice(0, 30).join('\n')}`);
  console.log(`Responsive layout passed: ${checks} tab/state/viewport checks across ${sizes.length} phone, tablet, landscape, desktop and TV sizes.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
