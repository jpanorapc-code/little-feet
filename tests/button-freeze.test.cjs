// Verify the approved V5 frost behavior is live, random, edge-only and never blocks button content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frostSource = fs.readFileSync(path.join(root, 'assets/button-frost.js'), 'utf8');
assert.doesNotMatch(frostSource, /Adobe|531734560|Stock/i, 'Production frost must not contain the Adobe Stock preview');
assert.match(frostSource, /Sparse side islands only/, 'V5 side frost must stay broken into small islands');
assert.match(frostSource, /FREEZE_MS = 3000/, 'Approved V5 freeze should grow slowly');

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
  await page.addScriptTag({ url:'/assets/button-frost.js?v=20261023-v5-frost-v1' });

  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.id = 'freezeFixture';
    fixture.style.cssText = 'position:fixed;left:20px;top:20px;z-index:99999;';
    fixture.innerHTML = '<button id="freezeButton" type="button" class="action-btn btn-blue" style="width:360px;height:70px;">Open workspace</button>';
    document.body.appendChild(fixture);
  });

  const button = page.locator('#freezeButton');
  const beforeBox = await button.boundingBox();
  await button.hover();
  await page.waitForSelector('#freezeButton > .lf-button-frost-canvas');

  const canvasStyle = await button.locator('.lf-button-frost-canvas').evaluate(el => {
    const s = getComputedStyle(el);
    return { pointerEvents:s.pointerEvents, zIndex:s.zIndex, position:s.position, opacity:s.opacity };
  });
  assert.equal(canvasStyle.pointerEvents, 'none');
  assert.equal(canvasStyle.zIndex, '-1', 'Frost canvas must sit behind real button text/icons');
  assert.equal(canvasStyle.position, 'absolute');

  await page.waitForTimeout(1750);
  const snapshotA = await button.locator('.lf-button-frost-canvas').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const w = canvas.width, h = canvas.height;
    let edge = 0, edgeTotal = 0, center = 0, centerTotal = 0, right = 0, rightTotal = 0, checksum = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const a = data[(y * w + x) * 4 + 3];
        checksum = (checksum + a * (1 + ((x + y) % 17))) % 2147483647;
        const edgeBand = y < h * .28 || y > h * .72 || x < w * .09 || x > w * .91;
        const centerBand = x > w * .20 && x < w * .80 && y > h * .30 && y < h * .70;
        const rightBand = x > w * .92;
        if (edgeBand) { edgeTotal++; if (a > 16) edge++; }
        if (centerBand) { centerTotal++; if (a > 16) center++; }
        if (rightBand) { rightTotal++; if (a > 16) right++; }
      }
    }
    return {
      edgeRatio:edge / edgeTotal,
      centerRatio:center / centerTotal,
      rightRatio:right / rightTotal,
      checksum
    };
  });

  assert.ok(snapshotA.edgeRatio > .025, `Frost must visibly grow around edges: ${JSON.stringify(snapshotA)}`);
  assert.ok(snapshotA.centerRatio < snapshotA.edgeRatio * .18, `Button centre must remain clear for text: ${JSON.stringify(snapshotA)}`);
  assert.ok(snapshotA.rightRatio < .48, `Right side must never become a solid ice block: ${JSON.stringify(snapshotA)}`);

  await page.waitForTimeout(550);
  const checksumB = await button.locator('.lf-button-frost-canvas').evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 3; i < data.length; i += 64) sum = (sum + data[i] * (1 + (i % 19))) % 2147483647;
    return sum;
  });
  assert.notEqual(checksumB, snapshotA.checksum, 'Frost must keep subtle random micro-movement after growth');

  let clicks = 0;
  await button.evaluate(el => el.addEventListener('click', () => { window.__freezeClicks=(window.__freezeClicks||0)+1; }));
  await button.click();
  clicks = await page.evaluate(() => window.__freezeClicks || 0);
  assert.equal(clicks, 1, 'Frozen button must remain clickable');
  assert.deepEqual(await button.boundingBox(), beforeBox, 'Frost must never change button geometry');

  await page.mouse.move(900, 700);
  await page.waitForTimeout(700);
  assert.equal(await button.locator('.lf-button-frost-canvas').count(), 0, 'Frost canvas must thaw and be removed after hover');

  await page.emulateMedia({ reducedMotion:'reduce' });
  await button.hover();
  await page.waitForTimeout(120);
  assert.equal(await button.locator('.lf-button-frost-canvas').count(), 0, 'Reduced motion must disable frost animation');

  console.log('V5 button frost is slow, random, edge-only, readable, clickable and free of solid side blocks.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
