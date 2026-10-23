// Verify the login information ticker uses one continuous solid icy glow line.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/styles/source/05-light-and-dark.css'), 'utf8');
assert.doesNotMatch(source, /loginInfoRunnerNeonLines/, 'Old moving multi-line runner must be removed');
assert.match(source, /border-top:2px solid #bff7ff/);
assert.match(source, /0 -3px 12px rgba\(125,211,252,.72\)/);

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
      borderTopWidth:s.borderTopWidth,
      borderTopStyle:s.borderTopStyle,
      borderTopColor:s.borderTopColor,
      boxShadow:s.boxShadow,
      backgroundImage:s.backgroundImage
    };
  });
  assert.equal(style.animationName,'loginInfoRunnerGlowPulse','Solid glow line should pulse in place');
  assert.equal(style.animationDuration,'2.8s');
  assert.equal(style.borderTopWidth,'2px');
  assert.equal(style.borderTopStyle,'solid');
  assert.match(style.boxShadow,/rgb\(125, 211, 252\)/);
  assert.equal((style.backgroundImage.match(/linear-gradient/g)||[]).length,1,'Banner should keep only its base background gradient');

  await page.setViewportSize({width:390,height:844});
  const mobileTiming=await runner.evaluate(el=>getComputedStyle(el).animationTimingFunction);
  assert.match(mobileTiming,/steps\\(70/,'Mobile pulse should be stepped at roughly 25 FPS');

  const fades=await runner.evaluate(el=>({
    before:getComputedStyle(el,'::before').backgroundImage,
    after:getComputedStyle(el,'::after').backgroundImage,
    track:getComputedStyle(el.querySelector('.login-info-runner-track')).animationName
  }));
  assert.match(fades.before,/linear-gradient/i,'Left fade must remain intact');
  assert.match(fades.after,/linear-gradient/i,'Right fade must remain intact');
  assert.equal(fades.track,'loginInfoRunner','Ticker text must keep scrolling');
  assert.equal(await runner.innerText(),beforeText,'Ticker wording must not change');

  await page.emulateMedia({reducedMotion:'reduce'});
  const reduced=await runner.evaluate(el=>getComputedStyle(el).animationName);
  assert.equal(reduced,'none');

  console.log('Login info runner uses one continuous pulsing icy glow line while ticker motion and fades remain intact.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(browser) await browser.close();
  await new Promise(resolve=>server.close(resolve));
});
