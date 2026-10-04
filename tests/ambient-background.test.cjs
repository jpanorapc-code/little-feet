// Optional interaction check: use an installed Playwright via NODE_PATH.
// No browser/tooling dependency is added to the deployed application.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const tempRoot = path.join(require('node:os').tmpdir(), 'little-feet-browser');
fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
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
    // External fonts/maps are outside this isolated local portal regression.
    await context.route('https://**', route => route.abort());
    const page = await context.newPage();
    const errors = [];
    const failedApi = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(`${origin}/api/`) && response.status() >= 500) failedApi.push(`${response.status()} ${response.url()}`);
    });
    page.on('dialog', dialog => dialog.dismiss());
    const navigationResponse = await page.goto(origin, { waitUntil: 'domcontentloaded' });
    assert.equal(navigationResponse.status(), 200, (await page.content()).slice(0, 1200));
    if (role === 'admin') {
      await page.waitForFunction(() => {
        const login = document.getElementById('loginBackgroundVideo');
        const portal = document.getElementById('ambientBackgroundVideo');
        return login?.readyState >= 2 && !login.paused && login.currentTime > 0 && portal?.paused;
      });
      const loginMedia = await page.locator('#loginBackgroundVideo').evaluate(v => ({muted:v.muted,loop:v.loop,duration:v.duration}));
      assert.ok(loginMedia.muted && loginMedia.loop && loginMedia.duration > 1, JSON.stringify(loginMedia));
      await page.locator('#backgroundMotionToggle').click();
      assert.ok(await page.locator('#loginBackgroundVideo').evaluate(v => v.paused));
      await page.locator('#backgroundMotionToggle').click();
      await page.waitForFunction(() => !document.getElementById('loginBackgroundVideo').paused);
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(() => document.getElementById('loginBackgroundVideo').paused);
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.waitForFunction(() => !document.getElementById('loginBackgroundVideo').paused);

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

      // The combined Antarctic soundtrack must be one persistent looping
      // audio instance shared by login and the signed-in portal.
      const loginMix = await page.evaluate(() => {
        const audio = window.getLittleFeetAntarcticMixAudio?.();
        if (!audio) return null;
        audio.__littleFeetRegressionMarker = 'same-audio-instance';
        return {
          src: audio.currentSrc || audio.src,
          loop: audio.loop,
          muted: audio.muted,
          volume: audio.volume
        };
      });
      assert.ok(loginMix, 'Combined Antarctic soundtrack must be initialised on the login page');
      assert.ok(loginMix.src.includes('little-feet-antarctic-mix.mp3'), JSON.stringify(loginMix));
      assert.equal(loginMix.loop, true, 'Combined Antarctic soundtrack must loop');
      assert.equal(loginMix.muted, false, 'Combined Antarctic soundtrack should start unmuted when Little Feet sound is on');
      assert.ok(loginMix.volume > 0 && loginMix.volume <= 1, JSON.stringify(loginMix));

      // A real user gesture must unlock audible playback, not just create
      // an Audio element with the right metadata.
      await page.locator('#loginUsername').click();
      await page.waitForFunction(() => {
        const audio = window.getLittleFeetAntarcticMixAudio?.();
        return audio && !audio.paused && !audio.muted;
      });
      const loginPlaybackStart = await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.currentTime || 0);
      await page.waitForTimeout(180);
      const loginPlaybackAfter = await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.currentTime || 0);
      assert.ok(loginPlaybackAfter > loginPlaybackStart, 'Antarctic mix currentTime must advance after login-page user interaction');

      await page.locator('.login-audio-compact').click();
      assert.equal(await page.locator('.login-audio-compact span').textContent(), 'Muted');
      assert.equal(await page.locator('.login-audio-compact use').getAttribute('href'), '#icon-volume-off');
      assert.equal(await page.locator('.login-audio-compact').getAttribute('aria-pressed'), 'true');
      assert.ok(await page.locator('.login-audio-compact').evaluate(el => el.classList.contains('is-muted')), 'Muted button should expose a muted visual state');
      assert.equal(await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.paused), true, 'Login mute button must pause the Antarctic mix');
      assert.equal(await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.muted), true, 'Login mute button must mute the Antarctic mix');

      await page.locator('.login-audio-compact').click();
      await page.waitForFunction(() => {
        const audio = window.getLittleFeetAntarcticMixAudio?.();
        return audio && !audio.paused && !audio.muted;
      });
      assert.equal(await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.muted), false, 'Login unmute button must unmute the Antarctic mix');
      assert.equal(await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.paused), false, 'Login unmute button must restart audible Antarctic playback');
      await page.setViewportSize({width:390,height:844});
      const mobileLoginState = await page.evaluate(() => {
        const card = document.querySelector('.auth-card').getBoundingClientRect();
        const language = document.querySelector('.login-language-pill').getBoundingClientRect();
        const audio = document.querySelector('.login-audio-compact').getBoundingClientRect();
        const username = document.getElementById('loginUsername');
        const pinInput = document.getElementById('loginPin');
        const submit = document.querySelector('#loginForm button[type="submit"]');
        const hit = element => {
          const rect = element.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          const top = document.elementFromPoint(x, y);
          return top === element || element.contains(top);
        };
        return {
          toolsFit: audio.right <= card.right + 1 && audio.left >= language.right - 1,
          usernameHit: hit(username),
          pinHit: hit(pinInput),
          submitHit: hit(submit),
          brandPointerEvents: getComputedStyle(document.querySelector('.brand-header')).pointerEvents,
          cardPointerEvents: getComputedStyle(document.querySelector('.auth-card')).pointerEvents
        };
      });
      const rememberWidth = await page.locator('#rememberLogin').evaluate(el => el.getBoundingClientRect().width);
      assert.ok(rememberWidth <= 24, 'Remember-email checkbox must not stretch across the mobile form');
      assert.ok(mobileLoginState.toolsFit, 'Mobile login language and sound controls must not overlap or escape the card');
      assert.ok(mobileLoginState.usernameHit, 'Mobile username field must receive taps');
      assert.ok(mobileLoginState.pinHit, 'Mobile PIN field must receive taps');
      assert.ok(mobileLoginState.submitHit, 'Mobile login submit button must receive taps');
      assert.equal(mobileLoginState.brandPointerEvents, 'none', 'Decorative mobile brand layer must not steal form taps');
      assert.equal(mobileLoginState.cardPointerEvents, 'auto', 'Mobile login card must remain interactive');
      await page.screenshot({ path:path.join(root,'tmp','mobile-login-video.png') });
    }
    await page.locator('#loginPinToggle').click();
    assert.equal(await page.locator('#loginPin').getAttribute('type'), 'text');
    await page.locator('#loginPinToggle').click();
    assert.equal(await page.locator('#loginPin').getAttribute('type'), 'password');
    await page.locator('#loginUsername').fill(`browser-${role}`);
    await page.locator('#loginPin').fill(pin);
    if (role === 'admin') await page.locator('#rememberLogin').check();
    await page.locator('#loginForm button[type="submit"]').click();
    await page.locator('#dashboardSection').waitFor({ state: 'visible' });
    await page.locator('#authSection').waitFor({ state: 'hidden' });
    await page.waitForLoadState('domcontentloaded');
    if (role === 'admin') {
      // Admin signs in while the viewport is still phone-sized. Restore desktop
      // only after the mobile login has successfully transitioned into the portal.
      await page.setViewportSize({width:1440,height:1000});
      await page.waitForFunction(() => {
        const login = document.getElementById('loginBackgroundVideo');
        const portal = document.getElementById('ambientBackgroundVideo');
        return login?.paused && portal?.readyState >= 2 && !portal.paused && portal.currentTime > 0;
      });
      const portalMix = await page.evaluate(() => {
        const audio = window.getLittleFeetAntarcticMixAudio?.();
        return audio ? {
          marker: audio.__littleFeetRegressionMarker,
          src: audio.currentSrc || audio.src,
          loop: audio.loop,
          muted: audio.muted
        } : null;
      });
      assert.ok(portalMix, 'Combined Antarctic soundtrack must remain available inside the portal');
      assert.equal(portalMix.marker, 'same-audio-instance', 'Login and portal must share the same Antarctic audio instance');
      assert.ok(portalMix.src.includes('little-feet-antarctic-mix.mp3'), JSON.stringify(portalMix));
      assert.equal(portalMix.loop, true);
      assert.equal(portalMix.muted, false);

      const portalMute = page.locator('#dashboardSection [data-portal-audio-mute]').first();
      await portalMute.click();
      assert.equal(await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.paused), true, 'Portal mute button must pause the Antarctic mix');
      assert.equal(await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.muted), true, 'Portal mute button must mute the Antarctic mix');
      await portalMute.click();
      await page.waitForFunction(() => {
        const audio = window.getLittleFeetAntarcticMixAudio?.();
        return audio && !audio.paused && !audio.muted;
      });
      assert.equal(await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.muted), false, 'Portal unmute button must unmute the Antarctic mix');
      assert.equal(await page.evaluate(() => window.getLittleFeetAntarcticMixAudio?.()?.paused), false, 'Portal unmute button must restart audible Antarctic playback');
    }
    if (role === 'admin') {
      const mediaSources = await page.evaluate(() => ['loginBackgroundVideo','ambientBackgroundVideo'].map(id => document.getElementById(id).currentSrc));
      assert.equal(mediaSources[0], mediaSources[1], 'Login and portal must use the same clean video');
      for (const icon of ['classic','lady','tough','cute','happy','cool','boss','smart-lady']) {
        await page.evaluate(icon => selectProfileIcon(icon), icon);
        const selected = await page.locator('.user-avatar use').first().getAttribute('href');
        assert.ok(selected.endsWith('#avatar-' + icon), 'Selected portrait must appear in the header');
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
      await page.locator('.nav-btn[onclick="switchTab(\'feedTab\', this)"]').click();
      await page.evaluate(() => scrollTo(0,0));
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--panel-bg').trim()), '#08287F');
      await page.screenshot({ path: path.join(root,'tmp','desktop-video-ui.png') });
      await page.locator('[onclick="toggleDarkMode()"]').click();
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--panel-bg').trim()), '#0059b3');
      for (const [width,height] of [[390,844],[768,1024],[1920,1080],[3840,2160]]) {
        await page.setViewportSize({width,height});
        const bounds = await page.locator('.ambient-background').boundingBox();
        assert.equal(bounds.width,width); assert.equal(bounds.height,height);
      }
      await page.setViewportSize({width:1440,height:1000});
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
    if (role === 'admin') {
      await page.waitForFunction(() => {
        const login = document.getElementById('loginBackgroundVideo');
        const portal = document.getElementById('ambientBackgroundVideo');
        return login?.readyState >= 2 && !login.paused && portal?.paused;
      });
    }
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
