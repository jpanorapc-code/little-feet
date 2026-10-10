const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = require('../scripts/source-layout').readBackendSource(root);
const client = require('../scripts/source-layout').readFrontendSource(root);
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const requiredServerPatterns = [
  /req\.session\.destroy\(/,
  /crypto\.timingSafeEqual\(/,
  /offsiteBackup:\s*Boolean\(process\.env\.LF_BACKUP_R2_BUCKET && process\.env\.LF_BACKUP_REHEARSAL_ID\)/,
  /monitoring:\s*Boolean\(process\.env\.LF_MONITORING_DSN \|\| process\.env\.LF_MONITORING_PROVIDER\)/,
  /app\.disable\(['"]x-powered-by['"]\)/,
  /Content-Security-Policy/,
  /X-Permitted-Cross-Domain-Policies/,
  /Cross-Origin-Resource-Policy/,
  /Cross-origin state changes are not allowed/,
  /littlefeet\.sid/,
  /message:\s*['"]An unexpected server error occurred\./
];
for (const pattern of requiredServerPatterns) assert.match(server, pattern);
assert.doesNotMatch(server, /script-src[^\n]*unsafe-eval/);
assert.match(server, /X-DNS-Prefetch-Control/);
assert.match(server, /Origin-Agent-Cluster/);
assert.match(server, /upgrade-insecure-requests/);
assert.match(server, /block-all-mixed-content/);
assert.match(server, /frame-src 'none'/);
assert.match(server, /manifest-src 'self'/);
assert.match(server, /worker-src 'self' blob:/);
assert.match(server, /Vendor integrity check failed/);
assert.match(server, /sha256-yVBhl8r4CaB1tt7h2g02\+xnacVj\/6KiOewyWxdhiPJk=/);
assert.match(server, /sha256-20nQCchB9co0qIjJZRGuk2\/Z9VM\+kNiyxNV1lvTlZBo=/);
assert.match(page, /leaflet@1\.9\.4\/dist\/leaflet\.css" integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H"/);
assert.match(page, /MarkerCluster\.css" integrity="sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO\+BR5Csr6Dhqq\+nZs59P0pPKQJkEV"/);
assert.match(page, /MarkerCluster\.Default\.css" integrity="sha384-wgw\+aLYNQ7dlhK47ZPK7FRACiq7ROZwgFNg0m04avm4CaXS\+Z9Y7nMu8yNjBKYC\+"/);
assert.match(server, /safeHttpsUrl/);
assert.match(server, /account\s*!==\s*target/);
assert.match(server, /\^\[0-9a-f\]\{64\}\$/);
assert.doesNotMatch(page, /autocomplete="section-managed-account url"/);
assert.match(page, /id="accountStoreUrl"[^>]*autocomplete="off"/);
assert.match(page, /id="accountDeleteButton"/);
assert.match(page, /Delete this user\/account/);
assert.match(client, /Are you sure you want to delete this user\/account\? This cannot be undone\./);
assert.match(client, /function deleteSelectedAccount\(/);
assert.match(page, /Request account deletion/);
assert.match(client, /function requestOwnAccountDeletion\(/);
assert.match(server, /app\.post\('\/api\/account-deletion-request'/);
assert.match(server, /Account deletion request/);
assert.match(page, /Request full school deletion/);
assert.match(client, /function requestSchoolDeletion\(/);
assert.match(client, /function executeSchoolDeletion\(/);
assert.match(server, /school-deletion-request/);
assert.match(server, /school-deletion\/execute/);
assert.match(server, /LF_API_MUTATION_RATE_LIMIT/);
assert.match(server, /LF_API_READ_RATE_LIMIT/);
assert.match(server, /Backup server is read-only/);
assert.match(server, /!readOnlySnapshotMode && !process\.env\.DATABASE_URL/);
assert.match(server, /status: readiness\.ready \? 'READY' : 'NOT_READY'/);
assert.doesNotMatch(server, /res\.json\(\{ status: 'OK', database:/);
assert.match(server, /MODERATION_EXEMPT_FIELDS/);
assert.match(server, /'pin', 'password', 'passcode', 'verificationcode'/);
assert.match(server, /'signature', 'signaturedata', 'mediaurl', 'photourl'/);
assert.match(server, /state: true/);
assert.match(server, /if \(!actor\) return res\.json\(\{ status: persistenceAvailable \? status : 'DATABASE_UNAVAILABLE'/);
assert.match(server, /while \(publicRateLimits\.size > 10000\)/);
assert.match(server, /Math\.min\(6, Number\(process\.env\.PG_POOL_MAX\) \|\| 5\)/);
assert.match(server, /id: crypto\.randomUUID\(\),\r?\n    studentName,/);
assert.match(server, /Ticket status must be Open or Completed/);
assert.match(client, /escapeWorkspaceText\(b\.category\)/);
assert.match(client, /escapeWorkspaceText\(currentFeedback/);
assert.match(server, /Messages are limited to 4,000 characters/);
assert.match(server, /Emergency alerts are limited to 2,000 characters/);
assert.match(server, /Alert radius must be between 0\.1 km and 100 km/);
assert.doesNotMatch(server, /\{ id: crypto\.randomUUID\(\), \.\.\.req\.body/);
assert.doesNotMatch(server, /\{ id: crypto\.randomUUID\(\), \.\.\.item/);

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
  /\$\{b\.bcPriority\s*\|\|/,
  /\$\{b\.category\}/,
  /\$\{b\.studentName\}/,
  /\$\{b\.note\}/
];
for (const pattern of forbiddenClientPatterns) {
  assert.doesNotMatch(client, pattern, `Unsafe raw interpolation still present: ${pattern}`);
}

const publicClientFiles = [
  path.join(root, 'index.html'),
  path.join(root, 'backup.js'),
  ...fs.readdirSync(path.join(root, 'assets'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => path.join(root, 'assets', entry.name))
];
const forbiddenPublicSourcePatterns = [
  /process\.env/,
  /DATABASE_URL/,
  /SESSION_SECRET/,
  /LF_FIELD_ENCRYPTION_KEY/,
  /LF_SMTP_PASSWORD/,
  /LF_EMAIL_API_KEY/,
  /GOOGLE_CLIENT_SECRET/,
  /MICROSOFT_CLIENT_SECRET/,
  /R2_SECRET_ACCESS_KEY/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /postgres(?:ql)?:\/\//i,
  /mongodb(?:\+srv)?:\/\//i
];
for (const file of publicClientFiles) {
  const content = fs.readFileSync(file, 'utf8');
  for (const pattern of forbiddenPublicSourcePatterns) {
    assert.doesNotMatch(content, pattern, `Sensitive server-only material leaked into public client source: ${path.relative(root, file)} -> ${pattern}`);
  }
}

assert.match(server, /blockedSourceMap = \/\\\.map\$\/i\.test\(req\.path\)/);
assert.match(server, /auth-crypto\\\.js/);
assert.match(server, /finance-automation-server\\\.js/);
assert.match(server, /scripts\|lib/);

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
