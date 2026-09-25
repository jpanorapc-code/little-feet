const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'backup.js'), 'utf8');
const robots = fs.readFileSync(path.join(root, 'robots.txt'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
const checklist = fs.readFileSync(path.join(root, 'VIDEO_REVIEW_CHECKLIST.md'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const mobilePwa = fs.readFileSync(path.join(root, 'assets', 'mobile-pwa.js'), 'utf8');
const curriculum = fs.readFileSync(path.join(root, 'assets', 'curriculum-frameworks.js'), 'utf8');
const auroraWallpaper = fs.readFileSync(path.join(root, 'assets', '4k', 'little-feet-aurora-stars-4k.svg'), 'utf8');
const starGlowMask = fs.readFileSync(path.join(root, 'assets', '4k', 'little-feet-star-glow-mask-4k.svg'), 'utf8');

assert.match(page, /<meta name="description" content="Little Feet is an early childhood development portal/);
assert.match(page, /<meta name="robots" content="index,follow,max-image-preview:large">/);
assert.ok(page.includes('<link rel="canonical" href="https://littlefeet.co.za/">'));
assert.ok(page.includes('<script type="application/ld+json">'));
assert.equal((page.match(/<h1\b/gi) || []).length, 1, 'The public document should expose one primary H1.');
assert.match(page, /<h1 role="button" tabindex="0"/);
assert.match(page, /rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(page, /name="theme-color" content="#0d9488"/);
assert.match(page, /id="pwaInstallButton"/);
assert.match(page, /curriculumObservationForm/);
assert.match(page, /NCF Birth–4/);
assert.match(page, /CAPS Grade R/);

for (const asset of ['xlsx.js', 'qrcode.js', 'leaflet.js', 'leaflet-markercluster.js']) {
  assert.match(page, new RegExp('<script src="\\/vendor\\/' + asset.replace('.', '\\.') + '" defer><\\/script>'));
}

assert.match(page, /id="appModal" class="modal-overlay hidden" role="dialog" aria-modal="true" aria-labelledby="modalTitle"/);
assert.match(page, /class="modal-close"[^>]*aria-label="Close dialog"/);
assert.match(client, /let modalReturnFocus = null/);
assert.match(client, /modal\.querySelector\('\.modal-close'\)\?\.focus\(\)/);
assert.match(client, /event\.key !== 'Escape'/);
assert.match(client, /modalReturnFocus\?\.isConnected/);

assert.match(page, /id="wallpaperImage"[^>]*loading="lazy"[^>]*decoding="async"/);
assert.match(page, /little-feet-aurora-stars-4k\.svg/);
assert.match(page, /@keyframes portalGlowPulse/);
assert.match(page, /little-feet-star-glow-mask-4k\.svg/);
assert.match(page, /#authSection::before[\s\S]*little-feet-aurora-stars-4k\.svg/);
assert.match(page, /#authSection::after[\s\S]*little-feet-star-glow-mask-4k\.svg/);
assert.match(page, /#authSection::after[\s\S]*animation:portalGlowPulse 5\.8s/);
const whiteStarCount = (auroraWallpaper.match(/fill="#ffffff"/g) || []).length;
const trackedCoreCount = (starGlowMask.match(/class="tracked-star-core"/g) || []).length;
const trackedHaloCount = (starGlowMask.match(/class="tracked-star-halo"/g) || []).length;
assert.equal(whiteStarCount, 457, 'The current 4K wallpaper should expose the expected pure-white star count.');
assert.equal(trackedCoreCount, whiteStarCount, 'Every white star must have one pulsating core glow.');
assert.equal(trackedHaloCount, whiteStarCount, 'Every white star must have one matching halo glow.');
assert.match(starGlowMask, /data-tracked-white-stars="457"/);
assert.match(page, /animation:portalGlowPulse 5\.8s/);
assert.match(page, /will-change:opacity/);
assert.doesNotMatch(page, /portal-ribbons/);
assert.doesNotMatch(page, /standby-ribbon/);
assert.doesNotMatch(page, /ribbonDrift/);
assert.doesNotMatch(page, /filter:blur\(34px\)/);
assert.doesNotMatch(page, /animation:portalAuroraDrift/);
assert.doesNotMatch(page, /auroraStrobe/);
assert.match(page, /prefers-reduced-motion: reduce/);
assert.match(page, /body\.portal-active\.light-mode \{ background-color:var\(--bg-dark\); \}/);
assert.match(page, /backup\.js\?v=20260925-aurora-v1/);
assert.doesNotMatch(page, /little-feet-wallpaper-no-moon-4k\.jpg/);
assert.doesNotMatch(page, /campfire wallpaper/i);
assert.match(client, /classList\.add\('has-custom-wallpaper'\)/);
assert.match(client, /classList\.remove\('has-custom-wallpaper'\)/);
assert.match(client, /northern lights wallpaper is active/);

assert.match(page, /href="#privacy-safeguarding"/);
assert.match(page, /href="#terms-of-service"/);
assert.match(page, /href="#copyright-content"/);
assert.match(page, /Copyright &amp; Content Reporting/);

assert.match(server, /app\.get\('\/manifest\.webmanifest'/);
assert.match(server, /app\.get\('\/service-worker\.js'/);
assert.match(server, /app\.get\('\/robots\.txt'/);
assert.match(server, /app\.get\('\/sitemap\.xml'/);
assert.match(robots, /User-agent: \*/);
assert.match(robots, /Disallow: \/api\//);
assert.ok(robots.includes('Sitemap: https://littlefeet.co.za/sitemap.xml'));
assert.ok(sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
assert.ok(sitemap.includes('<loc>https://littlefeet.co.za/</loc>'));
assert.match(checklist, /Source set reviewed: the 19 videos/);
assert.match(checklist, /Rules applied during this review/);
assert.match(server, /RENDER_GIT_COMMIT/);
assert.match(server, /RENDER_GIT_REPO_SLUG/);
assert.match(server, /releaseVersionForUpdateLines = updateLineCount => Number\(updateLineCount\) <= 8 \? '8\.2\.9' : '9\.0'/);
assert.match(server, /commit\?\.stats\?\.total/);
assert.match(server, /source: 'Render'/);
assert.match(client, /Render deploy/);
assert.match(client, /update line/);
assert.match(client, /<svg viewBox="0 0 24 24"/);

const parsedManifest = JSON.parse(manifest);
assert.equal(parsedManifest.display, 'standalone');
assert.equal(parsedManifest.scope, '/');
assert.equal(parsedManifest.theme_color, '#0d9488');
assert.match(serviceWorker, /isPrivateRequest/);
assert.match(serviceWorker, /url\.pathname\.startsWith\('\/api\/'\)/);
assert.match(serviceWorker, /event\.request\.mode === 'navigate'/);
assert.match(mobilePwa, /beforeinstallprompt/);
assert.match(mobilePwa, /navigator\.serviceWorker\.register\('\/service-worker\.js'/);
assert.match(curriculum, /ELDA 1 · Well-being/);
assert.match(curriculum, /ELDA 6 · Knowledge and Understanding of the World/);
assert.match(curriculum, /CAPS Grade R/);

assert.match(page, /name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/);
assert.match(page, /Cross-device layout hardening/);
assert.match(page, /@media \(max-width:360px\)/);
assert.match(page, /@media \(max-width:900px\) and \(max-height:600px\) and \(orientation:landscape\)/);
assert.match(page, /\.modal-overlay \{[\s\S]*safe-area-inset-top[\s\S]*safe-area-inset-right/);
assert.match(page, /\.app-sidebar \{[\s\S]*max-width:calc\(100vw/);
assert.match(page, /cinematic\.css\?v=20260925-cinematic-v11/);

console.log('Web quality regression test passed.');
