const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'backup.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const requiredServerPatterns = [
  /req\.session\.destroy\(/,
  /crypto\.timingSafeEqual\(/,
  /offsiteBackup:\s*false/,
  /app\.disable\(['"]x-powered-by['"]\)/,
  /Content-Security-Policy/,
  /Cross-origin state changes are not allowed/,
  /littlefeet\.sid/,
  /message:\s*['"]An unexpected server error occurred\./
];
for (const pattern of requiredServerPatterns) assert.match(server, pattern);
assert.doesNotMatch(server, /script-src[^\n]*unsafe-eval/);
assert.match(server, /safeHttpsUrl/);
assert.match(server, /account\s*!==\s*target/);
assert.match(server, /\^\[0-9a-f\]\{64\}\$/);
assert.doesNotMatch(page, /autocomplete="section-managed-account url"/);
assert.match(page, /id="accountStoreUrl"[^>]*autocomplete="off"/);
assert.match(page, /id="accountDeleteButton"/);\nassert.match(page, /Delete this user\/account/);
assert.match(client, /Are you sure you want to delete this user\/account\? This cannot be undone\./);
assert.match(client, /function deleteSelectedAccount\(/);

const forbiddenClientPatterns = [
  /\$\{p\.caption\}/,
  /\$\{p\.audience\s*\|\|/,
  /\$\{s\.studentName\}/,
  /\$\{s\.activity\}/,
  /\$\{w\.studentName\}/,
  /\$\{w\.title\}/,
  /\$\{t\.subject\}/,
  /\$\{t\.message\}/,
  /\$\{t\.feedback\}/,
  /\$\{b\.bcMessage\}/,
  /\$\{b\.bcPriority\s*\|\|/
];
for (const pattern of forbiddenClientPatterns) {
  assert.doesNotMatch(client, pattern, `Unsafe raw interpolation still present: ${pattern}`);
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /sk_live_[0-9A-Za-z]{16,}/,
  /xox[baprs]-[0-9A-Za-z-]{20,}/
];

const skipDirs = new Set(['.git', 'node_modules', 'tmp', 'output']);
const textExts = new Set(['.js', '.json', '.yml', '.yaml', '.html', '.css', '.md', '.txt']);
const walk = dir => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (textExts.has(path.extname(entry.name).toLowerCase())) {
      const content = fs.readFileSync(full, 'utf8');
      for (const pattern of secretPatterns) {
        assert.doesNotMatch(content, pattern, `Potential committed secret pattern found in ${path.relative(root, full)}`);
      }
    }
  }
};
walk(root);

console.log('Security regression test passed.');
