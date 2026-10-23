// Verify button hover grows a frost overlay without blocking interaction or altering layout.
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
  } else fs.createReadStream(file).pipe(res);
});

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless:true, ...(process.env.LF_BROWSER_CHANNEL ? { channel:process.env.LF_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport:{ width:1280, height:900 } });
  await page.route('https://**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:'load' });
  await page.locator('#portalLoader').evaluate(el => el.remove());

  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.id = 'freezeFixture';
    fixture.style.cssText = 'position:fixed;left:20px;top:20px;z-index:99999;';
    fixture.innerHTML = '<button id="freezeButton" type="button" class="action-btn btn-blue">Freeze me</button>';
    document.body.appendChild(fixture);
  });

  const button = page.locator('#freezeButton');
  const beforeBox = await button.boundingBox();
  const before = await button.evaluate(el => {
    const s=getComputedStyle(el,'::before');
    return {
      opacity:s.opacity,
      depth:s.getPropertyValue('--lf-button-frost-depth').trim(),
      pointerEvents:s.pointerEvents,
      mask:s.maskImage || s.webkitMaskImage
    };
  });
  assert.equal(before.pointerEvents,'none');
  assert.ok(before.depth === '0%' || before.depth === '0%');
  assert.match(before.mask,/linear-gradient/i);

  await button.hover();
  await page.waitForTimeout(700);
  const frozen = await button.evaluate(el => {
    const s=getComputedStyle(el,'::before');
    return {
      opacity:Number.parseFloat(s.opacity),
      depth:s.getPropertyValue('--lf-button-frost-depth').trim(),
      animationName:s.animationName,
      background:s.backgroundImage,
      borderColor:s.borderTopColor,
      pointerEvents:s.pointerEvents
    };
  });
  const afterBox = await button.boundingBox();

  assert.ok(frozen.opacity > .75, `Frozen overlay should be clearly visible: ${JSON.stringify(frozen)}`);
  assert.equal(frozen.depth,'58%');
  assert.equal(frozen.animationName,'littleFeetButtonFrostGlint');
  assert.match(frozen.background,/repeating-conic-gradient/i);
  assert.equal(frozen.pointerEvents,'none');
  assert.deepEqual(afterBox,beforeBox,'Freeze overlay must not change button geometry');

  let clicks=0;
  await button.evaluate(el => el.addEventListener('click',()=>{ window.__freezeClicks=(window.__freezeClicks||0)+1; }));
  await button.click();
  clicks=await page.evaluate(()=>window.__freezeClicks||0);
  assert.equal(clicks,1,'Frozen button must remain clickable');

  await page.mouse.move(900,700);
  await page.waitForTimeout(700);
  const thawed=await button.evaluate(el => {
    const s=getComputedStyle(el,'::before');
    return {opacity:Number.parseFloat(s.opacity),depth:s.getPropertyValue('--lf-button-frost-depth').trim()};
  });
  assert.ok(thawed.opacity < .05, `Frost should thaw after hover: ${JSON.stringify(thawed)}`);
  assert.equal(thawed.depth,'0%');

  console.log('Button freeze hover grows inward, stays clickable, preserves geometry and thaws cleanly.');
})().catch(error => {
  console.error(error);
  process.exitCode=1;
}).finally(async()=>{
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
});
