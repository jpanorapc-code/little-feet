// Verify the shared Little Feet icon system animates without changing icon colour or sidebar chevron state.
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
  const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
  await page.route('https://**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:'load' });
  await page.locator('#portalLoader').evaluate(el => el.remove());

  const icons = await page.locator('.ui-icon').evaluateAll(elements => elements.map(el => {
    const style = getComputedStyle(el);
    return {
      animationName:style.animationName,
      animationDuration:style.animationDuration,
      color:style.color,
      width:style.width,
      height:style.height
    };
  }));
  assert.ok(icons.length >= 20, `Expected shared icon system to cover many portal icons, got ${icons.length}`);
  for (const icon of icons) {
    assert.equal(icon.animationName, 'littleFeetIconFloat');
    assert.equal(icon.animationDuration, '2.8s');
    assert.ok(icon.color, 'Icon colour must remain defined by its existing context');
    assert.notEqual(icon.width, '0px');
    assert.notEqual(icon.height, '0px');
  }

  await page.locator('#dashboardSection').evaluate(el => { el.classList.remove('hidden'); el.style.display='block'; });
  const chevron = page.locator('.sidebar-chevron').first();
  await chevron.evaluate(el => el.closest('[data-nav-group]').classList.remove('is-collapsed'));
  await page.waitForTimeout(250);
  const before = await chevron.evaluate(el => getComputedStyle(el).transform);
  await chevron.locator('xpath=..').evaluate(button => button.closest('[data-nav-group]')?.classList.add('is-collapsed'));
  await page.waitForTimeout(250);
  const after = await chevron.evaluate(el => getComputedStyle(el).transform);
  assert.notEqual(before, after, 'Sidebar chevron rotation must remain independent of icon animation');

  await page.emulateMedia({ reducedMotion:'reduce' });
  const reduced = await page.locator('.ui-icon').first().evaluate(el => ({
    animationName:getComputedStyle(el).animationName,
    transform:getComputedStyle(el).transform
  }));
  assert.equal(reduced.animationName, 'none');
  assert.equal(reduced.transform, 'none');

  console.log(`Animated icon system verified on ${icons.length} rendered .ui-icon elements with reduced-motion fallback.`);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
