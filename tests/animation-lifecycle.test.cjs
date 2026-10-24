const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({ headless:true, ...(process.env.LF_BROWSER_CHANNEL ? {channel:process.env.LF_BROWSER_CHANNEL} : {}) });
  try {
    const page = await browser.newPage({ viewport:{width:1280,height:800} });
    await page.setContent('<div id="dashboardSection"><div id="visible" class="card" style="height:100px">Card <svg class="ui-icon"></svg></div><button id="frost" style="width:300px;height:70px">Open workspace</button><div style="height:1800px"></div><div id="outside" class="workspace-card" style="height:100px">Off screen</div></div>');
    await page.addStyleTag({path:path.join(root,'assets/styles/portal.css')});
    await page.addScriptTag({path:path.join(root,'assets/animation-visibility.js')});
    await page.addScriptTag({path:path.join(root,'assets/button-frost.js')});
    await page.waitForFunction(() => document.querySelector('#visible').dataset.lfMotion === 'running');
    assert.equal(await page.locator('#outside').evaluate(el => getComputedStyle(el,'::before').animationPlayState), 'paused');
    assert.equal(await page.locator('#visible').evaluate(el => getComputedStyle(el,'::after').animationPlayState), 'running');
    await page.evaluate(() => {
      window.paintCount = 0;
      const clear = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function(...args) { window.paintCount++; return clear.apply(this,args); };
    });
    await page.locator('#frost').hover();
    await page.waitForTimeout(3700);
    const complete = await page.evaluate(() => window.paintCount);
    assert.ok(complete > 10 && complete <= 100, `Expected bounded growth paints, got ${complete}`);
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.paintCount), complete, 'Finished frost must stop repainting');
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
    assert.equal(await page.locator('#visible').evaluate(el => getComputedStyle(el,'::after').animationPlayState), 'paused');
    assert.equal(await page.locator('#visible').evaluate(el => getComputedStyle(el).animationPlayState), 'running', 'Card entrance fades must finish so scrolling cannot leave content translucent');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.lf-button-frost-canvas').count(), 0, 'Scroll releases hovered frost');
    assert.equal(await page.locator('#visible').evaluate(el => getComputedStyle(el,'::after').animationPlayState), 'running');
    await page.locator('#outside').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('#outside').dataset.lfMotion === 'running' && document.querySelector('#visible').dataset.lfMotion === 'paused');
    await page.evaluate(() => {
      const card = document.createElement('div'); card.className='card'; card.id='dynamic'; card.textContent='Dynamic';
      document.querySelector('#outside').append(card);
    });
    await page.waitForFunction(() => document.querySelector('#dynamic').dataset.lfMotion === 'running');
    await page.waitForTimeout(200);
    await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await page.locator('#dynamic').evaluate(el => getComputedStyle(el,'::after').animationPlayState), 'paused');
    await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal(await page.locator('#dynamic').evaluate(el => getComputedStyle(el,'::after').animationPlayState), 'running');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('#dynamic').evaluate(el => getComputedStyle(el,'::after').animationName), 'none');
    console.log(`Animation lifecycle passed: ${complete} frost paints, zero after completion; offscreen, scrolling, background, dynamic cards and reduced motion verified.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
