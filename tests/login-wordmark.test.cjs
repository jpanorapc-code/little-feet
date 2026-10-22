// Render the real login markup/cascade and compare animation frames pixel by pixel.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + (req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  const type = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' }[path.extname(file)];
  if (type) res.setHeader('Content-Type', type);
  if (path.extname(file) === '.html') {
    res.end(fs.readFileSync(file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
  } else fs.createReadStream(file).pipe(res);
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.LF_BROWSER_CHANNEL ? { channel: process.env.LF_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route('https://**', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'load' });
  // Scripts are excluded from this CSS harness, so dismiss the startup loader
  // that the real application removes once initialization completes.
  await page.locator('#portalLoader').evaluate(el => el.remove());
  const title = page.locator('#authSection .brand-header h1');
  const slogan = page.locator('#authSection .brand-header p.slogan span');
  for (const [width, height] of [[390, 844], [697, 900], [1440, 1000]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => document.getAnimations().forEach(a => {
      a.pause();
      a.currentTime = a.effect.getTiming().iterations === Infinity ? 0 : a.effect.getComputedTiming().endTime;
    }));
    const styles = await title.evaluate(el => {
      const base = getComputedStyle(el), light = getComputedStyle(el, '::after');
      return { color: base.color, fill: base.webkitTextFillColor, shadow: base.textShadow,
        lightShadow: light.textShadow, padding: base.padding, lightPadding: light.padding,
        strokeWidth: base.webkitTextStrokeWidth, strokeColor: base.webkitTextStrokeColor,
        lightStrokeWidth: light.webkitTextStrokeWidth, duration: light.animationDuration,
        clip: light.backgroundClip, border: base.borderWidth, box: base.boxShadow };
    });
    assert.equal(styles.color, 'rgb(8, 40, 127)');
    assert.equal(styles.fill, styles.color);
    assert.equal(styles.strokeWidth, '1px');
    assert.equal(styles.strokeColor, 'rgb(230, 251, 255)');
    assert.equal(styles.shadow, 'none');
    assert.equal(styles.lightShadow, 'none', 'No inherited full-word shadow may enter the glow filter');
    assert.equal(styles.lightStrokeWidth, '0px', 'Moving streak must stay narrow instead of inheriting the static outline');
    assert.equal(styles.duration, '6.4s', 'Wordmark sweep should be deliberately slower and easier to follow');
    assert.equal(styles.lightPadding, styles.padding, 'Overlay must align on phones too');
    assert.equal(styles.clip, 'text');
    assert.equal(styles.border, '0px');
    assert.equal(styles.box, 'none');

    const sloganStyles = await slogan.evaluate(el => {
      const base = getComputedStyle(el), after = getComputedStyle(el, '::after');
      return {
        color: base.color,
        fill: base.webkitTextFillColor,
        strokeWidth: base.webkitTextStrokeWidth,
        strokeColor: base.webkitTextStrokeColor,
        shadow: base.textShadow,
        animationName: base.animationName,
        afterContent: after.content,
        afterAnimationName: after.animationName
      };
    });
    assert.equal(sloganStyles.color, 'rgb(8, 40, 127)');
    assert.equal(sloganStyles.fill, sloganStyles.color);
    assert.equal(sloganStyles.strokeWidth, '0.5px');
    assert.equal(sloganStyles.strokeColor, 'rgb(247, 253, 255)');
    assert.equal(sloganStyles.shadow, 'none', 'Slogan should use the same clean non-embossed treatment as the brand name');
    assert.equal(sloganStyles.animationName, 'none', 'Slogan must not animate');
    assert.equal(sloganStyles.afterContent, 'none', 'Slogan must not have a running neon overlay');
    assert.equal(sloganStyles.afterAnimationName, 'none', 'Slogan pseudo-element must not animate');
    const visibleWidths = await page.evaluate(() => {
      const titleEl = document.querySelector('#authSection .brand-header h1');
      const sloganEl = document.querySelector('#authSection .brand-header p.slogan span');
      function textWidth(el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().width;
      }
      return { title: textWidth(titleEl), slogan: textWidth(sloganEl) };
    });
    const widthRatio = visibleWidths.slogan / visibleWidths.title;
    assert.ok(widthRatio >= .88 && widthRatio <= 1.04,
      `Slogan should visually fit the brand name width: ${JSON.stringify({ visibleWidths, widthRatio })}`);
    const hide = await page.addStyleTag({ content: '#authSection .brand-header h1::after { opacity:0 !important; }' });
    const base = (await title.screenshot()).toString('base64');
    await hide.evaluate(el => el.remove());
    let previousX = -1;
    let brightPixels = 0;
    for (const fraction of [0.3, 0.5, 0.7]) {
      await page.evaluate(fraction => {
        const sweep = document.getAnimations().find(a => a.animationName === 'loginWordmarkIceSweep');
        if (!sweep) throw new Error('Missing live wordmark animation');
        sweep.currentTime = sweep.effect.getTiming().duration * fraction;
      }, fraction);
      const frame = (await title.screenshot()).toString('base64');
      const result = await page.evaluate(async ({ base, frame }) => {
        async function pixels(data) {
          const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
          return { width: img.width, data: ctx.getImageData(0, 0, img.width, img.height).data };
        }
        const a = await pixels(base), b = await pixels(frame);
        let minX = a.width, maxX = -1, changed = 0, navy = 0, bright = 0;
        for (let i = 0; i < a.data.length; i += 4) {
          const x = (i / 4) % a.width;
          if (Math.max(...[0, 1, 2].map(c => Math.abs(a.data[i + c] - b.data[i + c]))) > 3) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); changed++;
            if (b.data[i] > 150 && b.data[i + 1] > 210 && b.data[i + 2] > 220) bright++;
          } else if (b.data[i] === 8 && b.data[i + 1] === 40 && b.data[i + 2] === 127) navy++;
        }
        return { minX, maxX, changed, navy, bright };
      }, { base, frame });
      console.log(`${width}px frame ${fraction}: ${JSON.stringify(result)}`);
      if (process.env.LF_WORDMARK_SCREENSHOTS) {
        fs.mkdirSync(process.env.LF_WORDMARK_SCREENSHOTS, { recursive: true });
        await title.screenshot({ path: path.join(process.env.LF_WORDMARK_SCREENSHOTS, `wordmark-${width}-${fraction}.png`) });
      }
      assert.ok(result.changed > 10, `Visible moving light: ${JSON.stringify(result)}`);
      // A narrow core may cross a letter counter or a gap at an individual frame.
      brightPixels += result.bright;
      assert.ok(result.maxX - result.minX <= 28, `Glow stays local: ${JSON.stringify(result)}`);
      assert.ok(result.navy > 100, 'Unlit letter faces retain solid navy pixels');
      assert.ok(result.minX > previousX, 'The light travels across the letters');
      previousX = result.minX;
    }
    assert.ok(brightPixels > 0, 'The travelling streak must render a visible pale core');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await title.evaluate(el => getComputedStyle(el, '::after').opacity), '0');
    assert.equal(await title.evaluate(el => getComputedStyle(el).webkitTextFillColor), 'rgb(8, 40, 127)');
    assert.equal(await title.evaluate(el => getComputedStyle(el, '::after').animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  console.log('Login wordmark rendered sweep, navy fill, localized glow, mobile alignment and reduced motion passed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
});
