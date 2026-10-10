const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.LF_BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ timezoneId: 'America/Los_Angeles' });
    let requests = 0;
    page.on('request', () => requests++);
    await page.setContent('<main id="dashboardSection"><section class="portal-welcome-banner"><h2>Welcome</h2></section><section class="my-day-hero"><h2>My Day</h2></section></main>');
    await page.addStyleTag({ path: path.resolve(__dirname, '../assets/welcome-clock.css') });
    await page.evaluate(() => { window.registerLittleFeetWorkspace = (_, start) => start(); });
    await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../assets/welcome-clock.js'), 'utf8') });
    await page.evaluate(() => window.syncLittleFeetClock('2026-10-10T22:01:02Z'));
    assert.equal(await page.locator('.welcome-clock').count(), 2);
    assert.equal(await page.locator('time').first().textContent(), '00:01:02');
    await page.waitForFunction(() => document.querySelector('time').textContent !== '00:01:02', { timeout: 5000 });
    assert.match(await page.locator('time').first().textContent(), /^00:01:0[3-7]$/);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('.welcome-clock')].every(el => el.getBoundingClientRect().right <= innerWidth)));
    }
    await page.evaluate(() => document.querySelector('.my-day-hero').innerHTML = '<h2>Reloaded</h2>');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.welcome-clock').count(), 2);
    await page.evaluate(() => document.dispatchEvent(new Event('littlefeet:session-ended')));
    assert.equal(await page.locator('.welcome-clock').count(), 0);
    assert.equal(requests, 0, 'Clock adds no network requests');
    console.log('South African rollover, live ticking, responsive clock, remount and logout passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
