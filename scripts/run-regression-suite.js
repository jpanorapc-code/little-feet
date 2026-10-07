'use strict';

const { spawnSync } = require('node:child_process');

const commands = [
  "node scripts/audit-route-connections.js",
  "node tests/auth-crypto.test.js",
  "node tests/login-security.test.js",
  "node tests/login-language.test.js",
  "node tests/oauth-identity.test.js",
  "node tests/mailbox-integration.test.js",
  "node tests/mailbox-oauth.test.js",
  "node tests/yahoo-imap.test.js",
  "node tests/tenant-isolation.test.js",
  "node tests/subscription-payfast.test.js",
  "node tests/security-regression.test.js",
  "node tests/failover-mode.test.js",
  "node tests/replica-restore.test.js",
  "node tests/replica-transport.test.js",
  "node tests/owner-account-migration.test.js",
  "node tests/storage-lifecycle.test.js",
  "node tests/import-jobs.test.js",
  "node tests/sa-sams-integration.test.js",
  "node tests/recovery-rehearsal.test.js",
  "node tests/cinematic-navigation.test.js",
  "node tests/web-quality.test.js",
  "node tests/strengthening-regression.test.js",
  "node tests/adversarial-security.test.js",
  "node tests/adversarial-entrypoints.test.js",
  "node tests/adversarial-sensitive-inputs.test.js",
  "node tests/authorization-matrix.test.js",
  "node tests/render-release-metadata.test.js",
  "node tests/finance-automation.test.js",
  "node tests/school-core-upgrades.test.js",
  "node tests/advanced-school-operations.test.js",
  "node tests/preferences-refresh.test.js",
  "node tests/legal-compliance.test.js"
];

const assertionMarker = /(?:AssertionError|ERR_ASSERTION|assertion failed)/i;
let failed = false;

for (const command of commands) {
  const match = /^node\s+(.+)$/.exec(command);
  if (!match) {
    console.error('Unsupported regression command:', command);
    failed = true;
    break;
  }
  const script = match[1];
  console.log('\n> ' + command);
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8'
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const combined = String(result.stdout || '') + '\n' + String(result.stderr || '');
  if (result.error || result.status !== 0 || assertionMarker.test(combined)) {
    if (result.error) console.error(result.error);
    if (result.status === 0 && assertionMarker.test(combined)) {
      console.error('Regression suite detected assertion-failure output despite a zero exit code.');
    }
    failed = true;
    break;
  }
}

if (failed) process.exit(1);
console.log('\nLittle Feet regression suite passed with no hidden assertion failures.');
