const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),records=require('./fixtures/lossless-artwork.json');
const permitted=new Set(records.flatMap(record=>[record.source,record.target]));
const server=http.createServer((req,res)=>{
  const file=req.url.slice(1);
  if(file===''){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Artwork verification</title>');return;}
  if(!permitted.has(file)){res.writeHead(404);res.end();return;}
  fs.createReadStream(path.join(root,file)).pipe(res);
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,channel:process.env.LF_BROWSER_CHANNEL||'msedge'});
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  const results=await page.evaluate(async records=>{
    const render=async url=>{
      const image=new Image();image.src='/'+url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
      return {width:canvas.width,height:canvas.height,pixels:context.getImageData(0,0,canvas.width,canvas.height).data};
    };
    const rows=[];
    for(const record of records){
      const a=await render(record.source),b=await render(record.target);let changedChannels=0,maxDifference=0,changedAlpha=0;
      for(let i=0;i<a.pixels.length;i++){const diff=Math.abs(a.pixels[i]-b.pixels[i]);if(diff){changedChannels++;maxDifference=Math.max(maxDifference,diff);if(i%4===3)changedAlpha++;}}
      rows.push({target:record.target,width:a.width,height:a.height,dimensionsMatch:a.width===b.width&&a.height===b.height,changedChannels,maxDifference,changedAlpha});
    }
    return rows;
  },records);
  console.log(JSON.stringify(results,null,2));
  results.forEach(row=>{assert.ok(row.dimensionsMatch);assert.equal(row.changedChannels,0,row.target+' changes browser-rendered pixels');});
  console.log('All six original/encoded pairs render identical pixels and dimensions in the browser.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));});
