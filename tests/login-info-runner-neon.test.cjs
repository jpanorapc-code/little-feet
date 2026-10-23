// Verify the login information ticker keeps its text/fades while gaining six moving neon streaks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/styles/source/05-light-and-dark.css'), 'utf8');
assert.match(source, /loginInfoRunnerNeonLines/);
assert.match(source, /steps\(270,end\)/);
assert.match(source, /260px 2px,[\s\S]*190px 1px,[\s\S]*130px 2px,[\s\S]*235px 2px,[\s\S]*170px 1px,[\s\S]*115px 2px/);

const server = http.createServer((req,res)=>{
  const pathname=req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0];
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
    res.writeHead(404);res.end();return;
  }
  const type={'.html':'text/html','.css':'text/css','.js':'application/javascript'}[path.extname(file)];
  if(type) res.setHeader('Content-Type',type);
  if(path.extname(file)==='.html'){
    res.end(fs.readFileSync(file,'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));
  } else fs.createReadStream(file).pipe(res);
});

let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,...(process.env.LF_BROWSER_CHANNEL?{channel:process.env.LF_BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.route('https://**',route=>route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'load'});
  await page.locator('#portalLoader').evaluate(el=>el.remove());

  const runner=page.locator('.login-info-runner');
  const beforeText=await runner.innerText();
  const style=await runner.evaluate(el=>{
    const s=getComputedStyle(el);
    return {
      animationName:s.animationName,
      animationDuration:s.animationDuration,
      backgroundImage:s.backgroundImage,
      backgroundSize:s.backgroundSize,
      height:s.height
    };
  });
  assert.equal(style.animationName,'loginInfoRunnerNeonLines');
  assert.equal(style.animationDuration,'10.8s');
  assert.ok((style.backgroundImage.match(/linear-gradient/g)||[]).length>=7,'Expected six neon gradients plus the base banner gradient');
  assert.match(style.backgroundSize,/260px 2px/);
  assert.match(style.backgroundSize,/115px 2px/);

  const fades=await runner.evaluate(el=>({
    before:getComputedStyle(el,'::before').backgroundImage,
    after:getComputedStyle(el,'::after').backgroundImage,
    track:getComputedStyle(el.querySelector('.login-info-runner-track')).animationName
  }));
  assert.match(fades.before,/linear-gradient/i,'Left fade must remain intact');
  assert.match(fades.after,/linear-gradient/i,'Right fade must remain intact');
  assert.equal(fades.track,'loginInfoRunner','Ticker text must keep its original scrolling animation');
  assert.equal(await runner.innerText(),beforeText,'Ticker wording must not change');

  await page.setViewportSize({width:390,height:844});
  const mobileTiming=await runner.evaluate(el=>getComputedStyle(el).animationTimingFunction);
  assert.match(mobileTiming,/steps\(270/,'Mobile neon should use 25 FPS-equivalent stepping');

  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await runner.evaluate(el=>getComputedStyle(el).animationName);
  assert.equal(reduced,'none');

  console.log('Login info runner has six independent icy streaks while preserving ticker text, fades and reduced-motion behavior.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
});
