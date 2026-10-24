// Verify V5 frost stays dashboard-only and never damages login/auth controls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const frostSource = fs.readFileSync(path.join(root, 'assets/button-frost.js'), 'utf8');
assert.match(frostSource, /#dashboardSection button:not\(:disabled\)/, 'Frost must be scoped to the signed-in dashboard');
assert.doesNotMatch(frostSource, /Adobe|531734560|Stock/i, 'Production frost must not contain Adobe Stock preview content');
assert.match(frostSource, /Sparse side islands only/, 'Side frost must remain broken into islands');
assert.match(frostSource, /FREEZE_MS = 3200/, 'Frost growth must stay slow');

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
  await page.addScriptTag({ url:'/assets/button-frost.js?v=20261023-v5-frost-v3' });

  // Login page must remain structurally and visually untouched by frost host rules.
  const authCard = page.locator('#authSection > .auth-card');
  const authCardBefore = await authCard.evaluate(el => {
    const s=getComputedStyle(el);
    return { overflow:s.overflow, isolation:s.isolation, position:s.position };
  });
  const loginButton = page.locator('#loginForm .submit-btn');
  const loginBefore = await loginButton.evaluate(el => {
    const s=getComputedStyle(el);
    return { overflow:s.overflow, isolation:s.isolation, position:s.position };
  });
  await loginButton.hover();
  await page.waitForTimeout(180);
  assert.equal(await loginButton.locator('.lf-button-frost-canvas').count(), 0, 'Login button must never receive frost canvas');
  const loginAfter = await loginButton.evaluate(el => {
    const s=getComputedStyle(el);
    return { overflow:s.overflow, isolation:s.isolation, position:s.position };
  });
  assert.deepEqual(loginAfter, loginBefore, 'Login button styling must remain unchanged');
  const authCardAfter = await authCard.evaluate(el => {
    const s=getComputedStyle(el);
    return { overflow:s.overflow, isolation:s.isolation, position:s.position };
  });
  assert.deepEqual(authCardAfter, authCardBefore, 'Login card styling must remain unchanged');

  // Create a visible dashboard fixture because dashboard is hidden before authentication in this test shell.
  await page.evaluate(() => {
    const dashboard = document.getElementById('dashboardSection');
    dashboard.classList.remove('hidden');
    dashboard.style.display='block';
    const fixture=document.createElement('div');
    fixture.style.cssText='position:fixed;left:20px;top:20px;z-index:99999;';
    fixture.innerHTML='<button id="freezeButton" type="button" class="action-btn btn-blue" style="width:360px;height:70px;">Open workspace</button>';
    dashboard.appendChild(fixture);
  });

  const button=page.locator('#freezeButton');
  await button.hover();
  // Compare the same hover state; the existing button lifts on hover.
  await page.waitForTimeout(350);
  const beforeBox=await button.boundingBox();
  await page.waitForSelector('#freezeButton > .lf-button-frost-canvas');
  const canvasStyle=await button.locator('.lf-button-frost-canvas').evaluate(el=>{
    const s=getComputedStyle(el);
    return {pointerEvents:s.pointerEvents,zIndex:s.zIndex,position:s.position};
  });
  assert.equal(canvasStyle.pointerEvents,'none');
  assert.equal(canvasStyle.zIndex,'1','Frost must render above the button paint so detail is visible');

  await page.waitForTimeout(2200);
  const snapshot=await button.locator('.lf-button-frost-canvas').evaluate(canvas=>{
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const w=canvas.width,h=canvas.height;
    let edge=0,edgeTotal=0,center=0,centerTotal=0,right=0,rightTotal=0;
    for(let y=0;y<h;y+=2){
      for(let x=0;x<w;x+=2){
        const a=data[(y*w+x)*4+3];
        const edgeBand=y<h*.34||y>h*.66||x<w*.08||x>w*.92;
        const centerBand=x>w*.18&&x<w*.82&&y>h*.36&&y<h*.64;
        const rightBand=x>w*.93;
        if(edgeBand){edgeTotal++;if(a>16)edge++;}
        if(centerBand){centerTotal++;if(a>16)center++;}
        if(rightBand){rightTotal++;if(a>16)right++;}
      }
    }
    return {edgeRatio:edge/edgeTotal,centerRatio:center/centerTotal,rightRatio:right/rightTotal};
  });
  assert.ok(snapshot.edgeRatio>.065,`Frost should be visibly dense around edges: ${JSON.stringify(snapshot)}`);
  assert.ok(snapshot.centerRatio<.01,`Center must be explicitly cleared for label readability: ${JSON.stringify(snapshot)}`);
  assert.ok(snapshot.rightRatio<.58,`Right edge must remain broken rather than becoming a solid slab: ${JSON.stringify(snapshot)}`);
  assert.deepEqual(await button.boundingBox(),beforeBox,'Frost must not change button geometry');

  let clicks=0;
  await button.evaluate(el=>el.addEventListener('click',()=>{window.__freezeClicks=(window.__freezeClicks||0)+1;}));
  await button.click();
  clicks=await page.evaluate(()=>window.__freezeClicks||0);
  assert.equal(clicks,1,'Frozen dashboard button must remain clickable');

  await page.mouse.move(900,700);
  await page.waitForTimeout(750);
  assert.equal(await button.locator('.lf-button-frost-canvas').count(),0,'Frost should thaw away after hover');

  console.log('Dashboard frost is denser and visible while login/auth controls remain untouched.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
});
