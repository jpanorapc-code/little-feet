// Verify the login card's real moving neon rim is reused across portal card surfaces.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0];
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  const type = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript' }[path.extname(file)];
  if (type) res.setHeader('Content-Type', type);
  if (path.extname(file) === '.html') {
    res.end(fs.readFileSync(file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  } else {
    fs.createReadStream(file).pipe(res);
  }
});

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless:true, ...(process.env.LF_BROWSER_CHANNEL ? { channel:process.env.LF_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
  await page.route('https://**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:'load' });
  await page.locator('#portalLoader').evaluate(el => el.remove());

  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'portalCardNeonFixture';
    host.innerHTML = `
      <div class="card" data-neon="after">Card</div>
      <div id="schoolDayTab"><div class="workspace-card" data-neon="before">Workspace</div></div>
      <div class="workspace-results-panel" data-neon="after">Results</div>
      <div class="store-item" data-neon="after">Store</div>
      <div class="chat-shell" data-neon="after">Chat</div>
      <div class="guide-link-card" data-neon="after">Guide</div>
      <div class="modal-card" data-neon="after">Modal</div>
      <div class="executive-kpi" data-neon="after">KPI</div>
      <div class="executive-chart-card" data-neon="after">Chart</div>
      <div class="portal-welcome-banner" data-neon="after">Welcome</div>
      <div class="my-day-hero" data-neon="before">My Day hero</div>
      <div class="my-day-attention" data-neon="after">Attention</div>
      <button class="my-day-action" data-neon="after">Action</button>
      <div class="staff-work-card" data-neon="after">Staff</div>
      <div class="parent-contact-card" data-neon="after">Contact</div>
    `;
    document.body.appendChild(host);
    const runtimeMyDayStyle = document.createElement('style');
    runtimeMyDayStyle.textContent = '.my-day-hero::after{content:none;}';
    document.head.appendChild(runtimeMyDayStyle);
  });

  const results = await page.locator('#portalCardNeonFixture [data-neon]').evaluateAll(elements =>
    elements.map(el => {
      const pseudo = el.dataset.neon === 'before' ? '::before' : '::after';
      const style = getComputedStyle(el, pseudo);
      return {
        className:el.className,
        pseudo,
        content:style.content,
        animationName:style.animationName,
        animationDuration:style.animationDuration,
        backgroundImage:style.backgroundImage,
        pointerEvents:style.pointerEvents
      };
    })
  );

  for (const item of results) {
    assert.notEqual(item.content, 'none', `Missing neon pseudo on ${item.className} ${item.pseudo}`);
    assert.equal(item.animationName, 'portalCardIceOrbit', `Wrong animation on ${item.className} ${item.pseudo}`);
    assert.equal(item.animationDuration, '3.2s', `Portal neon must match login orbit speed on ${item.className}`);
    assert.match(item.backgroundImage, /conic-gradient/i, `Missing orbit gradient on ${item.className}`);
    assert.equal(item.pointerEvents, 'none');
  }

  const preserved = await page.evaluate(() => ({
    workspaceAfter: getComputedStyle(document.querySelector('#schoolDayTab .workspace-card'), '::after').backgroundImage,
    resultsBefore: getComputedStyle(document.querySelector('.workspace-results-panel'), '::before').content,
    myDayAfter: getComputedStyle(document.querySelector('.my-day-hero'), '::after').content,
    welcomeBeforeAnimation: getComputedStyle(document.querySelector('.portal-welcome-banner'), '::before').animationName,
    loginAnimation: getComputedStyle(document.querySelector('#authSection > .auth-card'), '::after').animationName
  }));
  assert.match(preserved.workspaceAfter, /radial-gradient/i, 'Workspace decorative ::after must remain intact');
  assert.notEqual(preserved.resultsBefore, 'none', 'Results decorative ::before must remain intact');
  assert.equal(preserved.myDayAfter, 'none', 'My Day runtime ::after remains reserved');
  assert.equal(preserved.welcomeBeforeAnimation, 'adminMascotGlow', 'Welcome artwork glow must remain intact');
  assert.equal(preserved.loginAnimation, 'loginIceOrbit', 'Login card keeps its original dedicated orbit');

  await page.emulateMedia({ reducedMotion:'reduce' });
  const reduced = await page.locator('#portalCardNeonFixture .card').evaluate(el => getComputedStyle(el, '::after').animationName);
  assert.equal(reduced, 'none');

  console.log(`Portal card neon verified on ${results.length} card surface types without replacing existing decorations.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
