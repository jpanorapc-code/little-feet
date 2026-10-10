// Real isolated server and browser; optional Playwright stays outside deployed dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'little-feet-assets-'));
let child, browser, errors = '';
(async () => {
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(fixture, 'node_modules'), 'junction');
  for (const file of ['server.js','auth-crypto.js','failover-mode.js','finance-automation-server.js','school-core-upgrades-server.js','advanced-school-operations-server.js','backup.js','index.html','service-worker.js','manifest.webmanifest','logo.png','logo-transparent.png','little-feet-mascot.jfif']) fs.copyFileSync(path.join(root,file),path.join(fixture,file));
  for (const directory of ['assets','lib']) fs.cpSync(path.join(root,directory),path.join(fixture,directory),{recursive:true});
  if (process.env.LF_ASSET_BASELINE) {
    assert.match(process.env.LF_ASSET_BASELINE, /^[0-9a-f]{40}$/);
    for (const file of ['index.html','service-worker.js','assets/ambient-background.js','assets/features/school-directory.js']) {
      fs.writeFileSync(path.join(fixture,file), execFileSync('git',['show',`${process.env.LF_ASSET_BASELINE}:${file}`],{cwd:root,maxBuffer:2000000}));
    }
  }
  const pin = 'AssetBrowserPass1';
  fs.writeFileSync(path.join(fixture,'littlefeet-replica.json'), JSON.stringify({schools:[{id:'asset-school',name:'Asset Test School'}],users:[{username:'asset-owner',name:'Asset Test Owner',role:'admin',platformAccess:true,schoolId:'asset-school',schoolName:'Asset Test School',verificationStatus:'Active',pinHash:crypto.scryptSync(pin,'little-feet-pin-salt',64).toString('hex')}],students:[],moduleRecords:{}}));
  const port = 19000 + Math.floor(Math.random()*1000), origin = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath,['server.js'],{cwd:fixture,env:{...process.env,NODE_ENV:'test',PORT:String(port),LF_REPLICA_MODE:'1',LF_OWNER_ADMIN_USERNAME:'asset-owner'},stdio:['ignore','ignore','pipe']});
  child.stderr.on('data',chunk=>{errors += chunk;});
  let ready=false;
  for(let i=0;i<200;i++) { if(child.exitCode!==null) throw new Error(errors); try {ready=(await fetch(origin+'/api/health')).ok;} catch {} if(ready)break; await new Promise(resolve=>setTimeout(resolve,100)); }
  assert.ok(ready,errors);
  browser=await chromium.launch({headless:true,channel:process.env.LF_BROWSER_CHANNEL || 'msedge'});
  const metrics=[];
  for(const motion of ['reduce','no-preference']) {
    const context=await browser.newContext({reducedMotion:motion,serviceWorkers:'block'});
    const page=await context.newPage();
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    await network.send('Network.setBlockedURLs', { urls: ['https://*'] });
    let received = new Map(), urls = new Map();
    network.on('Network.requestWillBeSent', event => urls.set(event.requestId, event.request.url));
    network.on('Network.dataReceived', event => received.set(event.requestId, (received.get(event.requestId) || 0) + event.encodedDataLength));
    network.on('Network.loadingFinished', event => received.set(event.requestId, event.encodedDataLength));
    for(const visit of ['cold','warm']) {
      received = new Map(); urls = new Map();
      await page.goto(origin,{waitUntil:'load'});
      await page.waitForTimeout(1800);
      const result=await page.evaluate(()=>({
        htmlBytes:performance.getEntriesByType('navigation')[0].encodedBodySize,
        domReadyMs:Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),
        loadMs:Math.round(performance.getEntriesByType('navigation')[0].loadEventEnd),
        paint:performance.getEntriesByType('paint').map(entry=>({name:entry.name,ms:Math.round(entry.startTime)})),
        resources:performance.getEntriesByType('resource').filter(entry=>entry.name.startsWith(location.origin)).map(entry=>({url:new URL(entry.name).pathname,transfer:entry.transferSize,body:entry.encodedBodySize,type:entry.initiatorType})),
        nodes:document.querySelectorAll('*').length,
        loginVisible:document.getElementById('loginForm').getBoundingClientRect().width>0
      }));
      result.networkBytes=[...received.entries()].filter(([id])=>urls.get(id)?.startsWith(origin)).reduce((sum,[,bytes])=>sum+bytes,0);
      result.mediaBytes=[...received.entries()].filter(([id])=>/\.(?:mp3|mp4)(?:\?|$)/.test(urls.get(id)||'')).reduce((sum,[,bytes])=>sum+bytes,0);
      result.scriptBodyBytes=result.resources.filter(entry=>entry.type==='script').reduce((sum,entry)=>sum+entry.body,0);
      assert.ok(result.loginVisible,'Real login form must render');
      if(process.env.LF_ASSERT_ASSET_LOADING==='1' && motion==='reduce') assert.ok(!result.resources.some(entry=>/\.(?:mp3|mp4)$/.test(entry.url)),'Paused motion and muted sound must not fetch media');
      metrics.push({motion,visit,...result});
      if (process.env.LF_ASSERT_ASSET_LOADING === '1') {
        assert.ok(!result.resources.some(entry => /\/vendor\/leaflet/.test(entry.url)), 'Map libraries must not load on the login page');
      }
    }
    received = new Map(); urls = new Map();
    await page.evaluate(() => performance.clearResourceTimings());
    await page.locator('#loginUsername').fill('asset-owner');
    await page.locator('#loginPin').fill(pin);
    const started = Date.now();
    await page.locator('#loginForm button[type="submit"]').click();
    await page.locator('#dashboardSection').waitFor({state:'visible'});
    const dashboardReadyMs = Date.now()-started;
    await page.waitForTimeout(1800);
    const dashboardResources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>entry.name.startsWith(location.origin)).map(entry=>({url:new URL(entry.name).pathname,transfer:entry.transferSize,body:entry.encodedBodySize,type:entry.initiatorType})));
    metrics.push({motion,visit:'dashboard',dashboardReadyMs,resources:dashboardResources,
      networkBytes:[...received.entries()].filter(([id])=>urls.get(id)?.startsWith(origin)).reduce((sum,[,bytes])=>sum+bytes,0),
      mediaBytes:[...received.entries()].filter(([id])=>/\.(?:mp3|mp4)(?:\?|$)/.test(urls.get(id)||'')).reduce((sum,[,bytes])=>sum+bytes,0)
    });
    if (motion === 'no-preference' && process.env.LF_ASSERT_ASSET_LOADING === '1') {
      for (const image of await page.locator('.portal-tour-image').all()) {
        if (!(await image.isVisible())) continue;
        await image.scrollIntoViewIfNeeded();
        await page.waitForFunction(element => element.complete && element.naturalWidth > 0, await image.elementHandle());
        assert.match(await image.getAttribute('src'), /^assets\/4k\/tour-[a-z-]+\.png$/, 'The original full-quality tour image appears when scrolled into view');
      }
      await network.send('Network.setBlockedURLs', { urls: [] });
      const mapRequests=[];
      page.on('request',request=>{if(/leaflet|MarkerCluster/.test(request.url()))mapRequests.push(request.url());});
      const loaded = await page.evaluate(async () => {
        await Promise.all([window.loadLittleFeetMap(), window.loadLittleFeetMap()]);
        await window.loadLittleFeetMap();
        return {version:window.L.version, cluster:typeof window.L.markerClusterGroup, styles:[...document.querySelectorAll('link[rel="stylesheet"]')].filter(el=>/unpkg.com/.test(el.href)).every(el=>el.sheet)};
      });
      assert.equal(loaded.version,'1.9.4');
      assert.equal(loaded.cluster,'function');
      assert.ok(loaded.styles,'Real map styles must load with their integrity checks');
      assert.equal(mapRequests.length,5,'Concurrent map opening shares two scripts and three styles without duplicates');
      console.log('Real Leaflet and clustering libraries load on demand, once, with verified styles.');
    }
    await context.close();
  }
  if (process.env.LF_ASSERT_ASSET_LOADING === '1') {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    context.on('response', response => { if(response.status() >= 400) console.log('Service-worker check HTTP failure:', response.status(), new URL(response.url()).pathname); });
    await page.goto(origin, { waitUntil: 'load' });
    await page.evaluate(async () => { await navigator.serviceWorker.register('/service-worker.js'); });
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active?.state === 'activated';
    }, null, { timeout: 45000 });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.evaluate(async () => { await fetch('/api/health'); });
    const cache = await page.evaluate(async () => {
      const keys = await caches.keys();
      const shell = await caches.open(keys.find(key => key.startsWith('little-feet-shell-')));
      const urls = (await shell.keys()).map(request => new URL(request.url).pathname);
      return { urls, styles: Boolean(await shell.match('/assets/styles/portal.css?v=20261010-styles-v1')) };
    });
    assert.ok(cache.styles, 'Extracted stylesheet must be installed with the actual service worker');
    assert.ok(!cache.urls.some(url => /^\/(?:api|auth)\//.test(url) || url === '/' || url.endsWith('.html')), 'Private requests and HTML remain uncached');
    assert.ok(!cache.urls.includes('/assets/4k/cinematic-admin-assistant.png'), 'Unused large artwork must not be downloaded by shell installation');
    // Stop the actual fixture server: browser offline emulation can leave a
    // service-worker network context online, which would not test a real outage.
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    await context.setOffline(true);
    const offlineCss = await page.evaluate(async () => (await fetch('/assets/styles/portal.css?v=20261010-styles-v1')).status);
    assert.equal(offlineCss, 200, 'Installed styles remain available offline');
    const offlinePage = await page.goto(origin, { waitUntil: 'domcontentloaded' });
    assert.equal(offlinePage.status(), 503, 'Offline navigation must not replay any authenticated page');
    assert.match(await page.locator('body').textContent(), /Little Feet is offline/);
    await context.close();
    console.log('Actual service worker caches extracted styles, excludes private data and unused artwork, and serves styles offline.');
  }
  const output=process.argv[2];
  if(output)fs.writeFileSync(path.resolve(output),JSON.stringify(metrics,null,2));
  console.log(JSON.stringify(metrics.map(({resources,...result})=>({...result,requests:resources.length,transferBytes:resources.reduce((n,entry)=>n+entry.transfer,0),largest:resources.sort((a,b)=>b.body-a.body).slice(0,8)})),null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(child && child.exitCode===null) await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
  const relative=path.relative(os.tmpdir(),fixture);assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  fs.rmSync(fixture,{recursive:true,force:true});
});
