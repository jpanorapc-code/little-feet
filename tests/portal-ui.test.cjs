// Optional interaction check: use an installed Playwright via NODE_PATH.
// No browser/tooling dependency is added to the deployed application.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(tempRoot, 'source-browser-'));
const port = 6500 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;
const roles = ['admin', 'principal', 'teacher', 'parent', 'district'];
const pin = 'SectionBrowserPass1';
const pinHash = crypto.scryptSync(pin, 'little-feet-pin-salt', 64).toString('hex');
let child;
let browser;
let stderr = '';

async function main() {
  for (const file of ['server.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js', 'index.html', 'logo.png', 'logo-transparent.png', 'little-feet-mascot.jfif']) {
    fs.copyFileSync(path.join(root, file), path.join(fixture, file));
  }
  fs.cpSync(path.join(root, 'assets'), path.join(fixture, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'littlefeet-replica.json'), JSON.stringify({
    schools: [{ id: 'browser-school', name: 'Browser Test School', status: 'active' }],
    users: roles.map(role => ({
      username: `browser-${role}`, name: `Browser ${role}`, role, pinHash,
      schoolId: 'browser-school', schoolName: 'Browser Test School', verificationStatus: 'Active',
      parentRelationshipStatus: 'Administrator approved', linkedLearners: ['browser learner'],
      assignedClasses: ['a1'], subscription: 'basic'
    })),
    students: [{ id: 'browser-learner', studentName: 'Browser Learner', className: 'A1', schoolId: 'browser-school', schoolName: 'Browser Test School' }],
    posts: [], learnerAccessCodes: [], schoolBilling: {}, moduleRecords: {}, directMessages: [], chatGroups: [], groupMessages: {}
  }));
  child = spawn(process.execPath, ['server.js'], { cwd: fixture, env: { ...process.env, NODE_ENV: 'test', PORT: String(port), LF_REPLICA_MODE: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(`Fixture server exited: ${stderr}`);
    try { ready = (await fetch(`${origin}/api/health`)).ok; } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Fixture server did not start: ${stderr}`);
  for (const file of ['/source/bundles.json', '/source/server/01-configuration.js', '/server.js', '/littlefeet-replica.json']) {
    assert.equal((await fetch(origin + file)).status, 404, `Private file exposed: ${file}`);
  }
  const served = await (await fetch(`${origin}/backup.js`)).text();
  assert.equal(served, fs.readFileSync(path.join(root, 'backup.js'), 'utf8'));
  browser = await chromium.launch({ headless: true, ...(process.env.LF_BROWSER_CHANNEL ? { channel: process.env.LF_BROWSER_CHANNEL } : {}) });
  const summary = [];
  for (const role of roles) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    const failedApi = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(`${origin}/api/`) && response.status() >= 500) failedApi.push(`${response.status()} ${response.url()}`);
    });
    page.on('dialog', dialog => dialog.dismiss());
    const navigationResponse = await page.goto(origin, { waitUntil: 'networkidle' });
    assert.equal(navigationResponse.status(), 200, (await page.content()).slice(0, 1200));
    assert.equal(await page.locator('#ambientBackgroundVideo').count(), 1, (await page.content()).slice(0, 1200));
    await page.waitForFunction(() => document.getElementById('ambientBackgroundVideo').readyState >= 2);
    const media = await page.locator('#ambientBackgroundVideo').evaluate(v => ({ muted:v.muted, loop:v.loop, duration:v.duration, width:v.videoWidth, height:v.videoHeight }));
    assert.ok(media.muted && media.loop && media.duration > 49 && media.duration < 52, 'Silent half-speed video configuration');
    await page.waitForFunction(() => !document.getElementById('ambientBackgroundVideo').paused);
    await page.locator('#backgroundMotionToggle').click();
    assert.equal(await page.locator('#ambientBackgroundVideo').evaluate(v => v.paused), true);
    await page.locator('#backgroundMotionToggle').click();
    await page.waitForFunction(() => !document.getElementById('ambientBackgroundVideo').paused);
    if (role === 'admin') {
      await page.setViewportSize({width:390,height:844});
      const fits = await page.locator('.login-audio-compact').evaluate(el => el.getBoundingClientRect().right <= document.querySelector('.auth-card').getBoundingClientRect().right);
      assert.ok(fits, 'Mobile Sound button must fit inside login card');
      await page.screenshot({ path:path.join(root,'tmp','mobile-login-video.png') });
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(() => document.getElementById('ambientBackgroundVideo').paused);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.setViewportSize({width:1440,height:1000});
    }
    await page.locator('#loginPinToggle').click();
    assert.equal(await page.locator('#loginPin').getAttribute('type'), 'text');
    await page.locator('#loginPinToggle').click();
    assert.equal(await page.locator('#loginPin').getAttribute('type'), 'password');
    await page.locator('#loginUsername').fill(`browser-${role}`);
    await page.locator('#loginPin').fill(pin);
    await page.locator('#loginForm button[type="submit"]').click();
    await page.locator('#dashboardSection').waitFor({ state: 'visible' });
    await page.waitForLoadState('networkidle');
    const missingHandlers = await page.evaluate(() => {
      const missing = new Set();
      for (const element of document.querySelectorAll('[onclick], [onchange], [onsubmit]')) {
        for (const attribute of ['onclick', 'onchange', 'onsubmit']) {
          const handler = element.getAttribute(attribute) || '';
          const name = handler.match(/^\s*([A-Za-z_$][\w$]*)\s*\(/)?.[1];
          if (name && typeof window[name] !== 'function') missing.add(name);
        }
      }
      return [...missing];
    });
    assert.deepEqual(missingHandlers, [], `${role}: disconnected inline handlers`);
    const navigation = await page.locator('.nav-btn').evaluateAll(buttons => buttons.filter(button => !button.closest('li')?.classList.contains('hidden')).map(button => button.getAttribute('onclick')));
    for (const onclick of navigation) {
      const tab = onclick.match(/switchTab\('([^']+)'/)?.[1];
      assert.ok(tab, `Unrecognised navigation: ${onclick}`);
      const target = page.locator(`.nav-btn[onclick=${JSON.stringify(onclick)}]`);
      await target.click();
      assert.equal(await page.locator(`#${tab}`).evaluate(element => element.classList.contains('active')), true, `${role}: ${tab} did not activate`);
      await page.waitForLoadState('networkidle');
    }
    await page.locator('[onclick="openGlobalSearch()"]').click();
    await page.locator('#appModal').waitFor({ state: 'visible' });
    await page.locator('#appModal [onclick="closeModal()"]').click();
    await page.locator('#appModal').waitFor({ state: 'hidden' });
    if (role === 'admin') {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForFunction(() => Math.abs(document.querySelector('#dashboardSection > nav').getBoundingClientRect().top) <= 1);
      await page.waitForFunction(() => Math.abs(document.getElementById('mainNavigation').getBoundingClientRect().top - document.querySelector('#dashboardSection > nav').getBoundingClientRect().bottom) <= 1);
      await page.locator('.nav-btn[onclick="switchTab(\'feedTab\', this)"]').click();
      await page.evaluate(() => scrollTo(0,0));
      await page.screenshot({ path: path.join(root,'tmp','desktop-video-ui.png') });
      await page.locator('[onclick="toggleDarkMode()"]').click();
      await page.screenshot({ path: path.join(root,'tmp','desktop-light-ui.png') });
      await page.setViewportSize({width:390,height:844});
      await page.locator('#navMoreToggle').click();
      await page.locator('.nav-btn[onclick="switchTab(\'homeTab\', this)"]').click();
      await page.evaluate(() => scrollTo(0,0));
      await page.screenshot({ path: path.join(root,'tmp','mobile-video-ui.png') });
      await page.locator('#navMoreToggle').click();
      await page.setViewportSize({width:1440,height:1000});
    }
    await page.locator('.sidebar-signout').click();
    await page.locator('#authSection').waitFor({ state: 'visible' });
    await page.waitForLoadState('networkidle');
    const session = await page.evaluate(() => fetch('/api/auth/session').then(response => response.json()));
    assert.equal(session.authenticated, false, `${role}: logout did not clear server session`);
    assert.deepEqual(errors, [], `${role}: browser runtime errors`);
    assert.deepEqual(failedApi, [], `${role}: failed API requests`);
    summary.push({ role, navigationButtons: navigation.length, missingHandlers, runtimeErrors: errors.length });
    await context.close();
  }
  console.log('Browser source regression passed:', JSON.stringify(summary));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  const relative = path.relative(tempRoot, path.resolve(fixture));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Unsafe fixture cleanup path');
  fs.rmSync(fixture, { recursive: true, force: true });
});
