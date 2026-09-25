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

assert.match(page, /<meta name="description" content="Little Feet is an early childhood development portal/);
assert.match(page, /<meta name="robots" content="index,follow,max-image-preview:large">/);
assert.match(page, /<link rel="canonical" href="https://littlefeet.co.za/">/);
assert.match(page, /<script type="application/ld+json">/);
assert.equal((page.match(/<h1\b/gi) || []).length, 1, 'The public document should expose one primary H1.');
assert.match(page, /<h1 role="button" tabindex="0"/);

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
assert.match(page, /href="#privacy-safeguarding"/);
assert.match(page, /href="#terms-of-service"/);
assert.match(page, /href="#copyright-content"/);
assert.match(page, /Copyright &amp; Content Reporting/);

assert.match(server, /app\.get\('\/robots\.txt'/);
assert.match(server, /app\.get\('\/sitemap\.xml'/);
assert.match(robots, /User-agent: \*/);
assert.match(robots, /Disallow: \/api\//);
assert.match(robots, /Sitemap: https:\/\/littlefeet\.co\.za\/sitemap\.xml/);
assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
assert.match(sitemap, /<loc>https:\/\/littlefeet\.co\.za\/<\/loc>/);
assert.match(checklist, /Source set reviewed: the 19 videos/);
assert.match(checklist, /Rules applied during this review/);

console.log('Web quality regression test passed.');
