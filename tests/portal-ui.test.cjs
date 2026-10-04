// Optional interaction check: use an installed Playwright via NODE_PATH.
// No browser/tooling dependency is added to the deployed application.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
// Express treats the managed .codex parent directory as a dotfile path when
// serving the fixture. Keep the test-only copy in the system temp directory.
const tempRoot = path.join(require('node:os').tmpdir(), 'little-feet-browser');
fs.mkdirSync(tempRoot, { recursive: true });
const fixture = fs.mkdtempSync(path.join(tempRoot, 'source-browser-'));
fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'junction');
const port = 18000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const roles = ['admin', 'principal', 'teacher', 'parent', 'district'];
const pin = 'SectionBrowserPass1';
const pinHash = crypto.scryptSync(pin, 'little-feet-pin-salt', 64).toString('hex');
let child;
let browser;
let stderr = '';

async function main() {
  for (const file of ['server.js', 'failover-mode.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js', 'index.html', 'logo.png', 'logo-transparent.png', 'little-feet-mascot.jfif']) {
    fs.copyFileSync(path.join(root, file), path.join(fixture, file));
  }
  // Keep the browser fixture aligned with every local server dependency.
  // Copying only object-storage became stale once mailbox/oauth modules were added.
  fs.cpSync(path.join(root, 'lib'), path.join(fixture, 'lib'), { recursive: true });
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
    await context.route('https://**', route => route.abort());
    const page = await context.newPage();
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.__littleFeetFetchStacks = [];
      window.fetch = (...args) => {
        const input = args[0];
        const url = typeof input === 'string' ? input : (input?.url || '');
        if (String(url).includes('/api/staff/tasks')) {
          window.__littleFeetFetchStacks.push({ url:String(url), stack:new Error('Little Feet fetch trace').stack || '' });
        }
        return nativeFetch(...args);
      };
    });
    const errors = [];
    const failedApi = [];
    const apiRequestCounts = new Map();
    page.on('request', request => {
      try {
        const url = new URL(request.url());
        if (url.origin === origin && url.pathname.startsWith('/api/')) {
          apiRequestCounts.set(url.pathname, (apiRequestCounts.get(url.pathname) || 0) + 1);
        }
      } catch {}
    });
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(`${origin}/api/`) && response.status() >= 500) failedApi.push(`${response.status()} ${response.url()}`);
    });
    page.on('dialog', dialog => dialog.dismiss());
    const navigationResponse = await page.goto(origin, { waitUntil: 'domcontentloaded' });
    assert.equal(navigationResponse.status(), 200, (await page.content()).slice(0, 1200));
    if (role === 'admin') {
      const desktopToolsFit = await page.evaluate(() => {
        const card = document.querySelector('.auth-card').getBoundingClientRect();
        const language = document.querySelector('.login-language-pill').getBoundingClientRect();
        const audio = document.querySelector('.login-audio-compact').getBoundingClientRect();
        return audio.right <= card.right + 1 && audio.left >= language.right - 1;
      });
      assert.ok(desktopToolsFit, 'Desktop login language and sound controls must not overlap or escape the card');
      assert.equal(await page.locator('.login-audio-compact span').textContent(), 'Sound On');
      assert.equal(await page.locator('.login-audio-compact use').getAttribute('href'), '#icon-volume');
      assert.equal(await page.locator('.login-audio-compact').getAttribute('aria-pressed'), 'false');
      await page.locator('.login-audio-compact').click();
      assert.equal(await page.locator('.login-audio-compact span').textContent(), 'Muted');
      assert.equal(await page.locator('.login-audio-compact use').getAttribute('href'), '#icon-volume-off');
      assert.equal(await page.locator('.login-audio-compact').getAttribute('aria-pressed'), 'true');
      assert.ok(await page.locator('.login-audio-compact').evaluate(el => el.classList.contains('is-muted')), 'Muted button should expose a muted visual state');
      await page.locator('.login-audio-compact').click();
      await page.waitForFunction(() => {
        const audio = window.getLittleFeetAntarcticAudio?.();
        return audio && !audio.paused && !audio.muted;
      }, null, { timeout:10000 });
      await page.setViewportSize({width:390,height:844});
      const mobileToolsFit = await page.evaluate(() => {
        const card = document.querySelector('.auth-card').getBoundingClientRect();
        const language = document.querySelector('.login-language-pill').getBoundingClientRect();
        const audio = document.querySelector('.login-audio-compact').getBoundingClientRect();
        return audio.right <= card.right + 1 && audio.left >= language.right - 1;
      });
      assert.ok(mobileToolsFit, 'Mobile login language and sound controls must not overlap or escape the card');
      await page.screenshot({ path:path.join(root,'tmp','mobile-login-video.png') });
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
    await page.waitForLoadState('domcontentloaded');
    if (role === 'admin') {
      // Profile avatars are a device-local preference: selecting one must not
      // create any API traffic, and the transparent penguin must survive reload.
      await page.locator('.nav-btn[onclick="switchTab(\'settingsTab\', this)"]').click();
      await page.locator('#settingsTab').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.profile-icon-choice').count(), 8, 'Settings should expose eight penguin profile avatars');
      // Initial dashboard loaders can still be settling when Settings first opens.
      // Wait for a short quiet window so this assertion measures the avatar click
      // itself rather than unrelated startup API traffic.
      let requestsBeforeAvatar = 0;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const before = [...apiRequestCounts.values()].reduce((sum, value) => sum + value, 0);
        await page.waitForTimeout(150);
        const after = [...apiRequestCounts.values()].reduce((sum, value) => sum + value, 0);
        if (after === before) {
          requestsBeforeAvatar = after;
          break;
        }
        requestsBeforeAvatar = after;
      }
      await page.locator('.profile-icon-choice[data-profile-icon="lady"]').click();
      await page.waitForTimeout(100);
      const requestsAfterAvatar = [...apiRequestCounts.values()].reduce((sum, value) => sum + value, 0);
      assert.equal(requestsAfterAvatar, requestsBeforeAvatar, 'Changing profile avatar must not call the API');
      assert.equal(await page.locator('#userAvatar .profile-avatar-lady').count(), 1, 'Selected penguin should render in the top bar');
      assert.equal(await page.locator('#userAvatar').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'Top-bar avatar background should remain transparent');

      const summaryEndpoints = [
        '/api/tickets',
        '/api/broadcasts',
        '/api/staff/tasks',
        '/api/staff/leave',
        '/api/staff/cover',
        '/api/staff/performance-reviews',
        '/api/staff/notices',
        '/api/maintenance',
        '/api/resources/bookings',
        '/api/purchase-requests',
        '/api/staff/qualifications'
      ];
      const sessionOwnedEndpoints = [...summaryEndpoints, '/api/accounts', '/api/approvals', '/api/staff/meetings', '/api/executive-overview'];

      // Reproduce the production failure mode: restore an already-authenticated session
      // during page load, when old delayed window.load initializers used to stack.
      // Let the just-completed interactive login finish its own startup first so
      // no late request from the old document contaminates the reload count.
      await page.waitForTimeout(1200);
      apiRequestCounts.clear();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('#dashboardSection').waitFor({ state: 'visible' });
      await page.waitForTimeout(1200);
      await page.locator('#executiveHomeOverview').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#userAvatar .profile-avatar-lady').count(), 1, 'Penguin profile choice should persist after authenticated reload');
      assert.equal(await page.locator('#executiveHomeOverview [data-executive-chart]').count(), 4, 'Executive Home should render four live chart cards');
      assert.ok((apiRequestCounts.get('/api/executive-overview') || 0) <= 1, `Executive Home overview should use one aggregate request, saw ${apiRequestCounts.get('/api/executive-overview') || 0}`);

      for (const endpoint of summaryEndpoints) {
        const count = apiRequestCounts.get(endpoint) || 0;
        const trace = endpoint === '/api/staff/tasks' && count > 2
          ? await page.evaluate(() => window.__littleFeetFetchStacks || [])
          : [];
        assert.ok(count <= 2, `Session restore duplicated ${endpoint}: ${count} calls\n${JSON.stringify(trace, null, 2)}`);
      }

      // Repeated session-ready notifications in the same session must reuse the
      // initializer promise and add no requests.
      const beforeRepeatedSession = new Map(sessionOwnedEndpoints.map(endpoint => [endpoint, apiRequestCounts.get(endpoint) || 0]));
      await page.evaluate(() => {
        document.dispatchEvent(new CustomEvent('littlefeet:session-ready'));
        document.dispatchEvent(new CustomEvent('littlefeet:session-ready'));
      });
      await page.waitForTimeout(400);
      for (const endpoint of sessionOwnedEndpoints) {
        assert.equal(apiRequestCounts.get(endpoint) || 0, beforeRepeatedSession.get(endpoint), `Repeated session-ready reloaded ${endpoint}`);
      }
    }
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
      await page.waitForLoadState('domcontentloaded');
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
    await page.waitForLoadState('domcontentloaded');
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
