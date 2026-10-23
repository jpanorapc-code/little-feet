// Verify mobile keeps the visual style while using the lower-cost animation profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frostSource = fs.readFileSync(path.join(root, 'assets/button-frost.js'), 'utf8');
assert.match(frostSource, /MOBILE_DPR_CAP = 1\.35/);
assert.match(frostSource, /MOBILE_FRAME_MS = 40/);
assert.match(frostSource, /createScene\(width, height, lowPower\)/);

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
  } else fs.createReadStream(file).pipe(res);
});

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless:true, ...(process.env.LF_BROWSER_CHANNEL ? { channel:process.env.LF_BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, deviceScaleFactor:2 });
  const page = await context.newPage();
  await page.route('https://**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:'load' });
  await page.locator('#portalLoader').evaluate(el => el.remove());
  await page.addScriptTag({ url:'/assets/button-frost.js?v=20261023-mobile-animation-tune-v1' });

  const icon = page.locator('.ui-icon').first();
  const iconStyle = await icon.evaluate(el => {
    const s=getComputedStyle(el);
    return { name:s.animationName, duration:s.animationDuration, willChange:s.willChange };
  });
  assert.equal(iconStyle.name,'littleFeetIconFloatMobile');
  assert.equal(iconStyle.duration,'4.2s');
  assert.notEqual(iconStyle.willChange,'transform');

  await page.evaluate(() => {
    const dashboard=document.getElementById('dashboardSection');
    dashboard.classList.remove('hidden');
    dashboard.style.display='block';
    const fixture=document.createElement('div');
    fixture.style.cssText='position:fixed;left:10px;top:100px;z-index:99999;';
    fixture.innerHTML='<button id="mobileFrostButton" type="button" class="action-btn btn-blue" style="width:300px;height:64px;">Open workspace</button><div class="card" id="mobileNeonCard" style="width:300px;height:100px;margin-top:12px;">Card</div>';
    dashboard.appendChild(fixture);
  });

  const cardStyle=await page.locator('#mobileNeonCard').evaluate(el=>{
    const s=getComputedStyle(el,'::after');
    return {duration:s.animationDuration,timing:s.animationTimingFunction,filter:s.filter};
  });
  assert.equal(cardStyle.duration,'6.4s');
  assert.match(cardStyle.timing,/steps\(36/);

  const button=page.locator('#mobileFrostButton');
  await button.hover();
  await page.waitForSelector('#mobileFrostButton > .lf-button-frost-canvas');
  const frost=await button.locator('.lf-button-frost-canvas').evaluate((canvas)=>{
    const host=window.__littleFeetButtonFrost;
    const cssWidth=canvas.getBoundingClientRect().width;
    return {
      canvasWidth:canvas.width,
      cssWidth,
      cap:host.mobileDprCap,
      frameMs:host.mobileFrameMs,
      mobile:host.mobileProfile.matches
    };
  });
  assert.equal(frost.mobile,true);
  assert.equal(frost.cap,1.35);
  assert.equal(frost.frameMs,40);
  assert.ok(frost.canvasWidth <= Math.ceil(frost.cssWidth * 1.35) + 1, `Canvas DPR was not capped: ${JSON.stringify(frost)}`);

  console.log('Mobile profile keeps frost/neon/icon motion while reducing render cost.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
});
