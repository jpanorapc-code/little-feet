const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const legal = fs.readFileSync(path.join(root, 'assets', 'legal-notices.js'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

assert.match(page, /openPopiaPrivacyNotice\(\)/);
assert.match(page, /openTermsOfService\(\)/);
assert.match(page, /Privacy &amp; POPIA/);
assert.match(page, /I confirm I am authorised to create this account and have read and accept/);
assert.match(page, /class="legal-inline-link"/);
assert.match(page, /assets\/legal-notices\.js\?v=20260925-legal-v1/);

assert.match(server, /LITTLE_FEET_PRIVACY_VERSION = 'POPIA-2026-09-v2'/);
assert.match(server, /LITTLE_FEET_TERMS_VERSION = 'TOS-ZA-2026-09-v2'/);
assert.match(server, /termsAcceptedAt: new Date\(\)\.toISOString\(\)/);
assert.match(server, /privacyAcceptedAt: new Date\(\)\.toISOString\(\)/);
assert.match(server, /termsVersion: LITTLE_FEET_TERMS_VERSION/);
assert.match(server, /privacyVersion: LITTLE_FEET_PRIVACY_VERSION/);
assert.match(server, /POPIA-consent-2026-09-v2/);

for (const phrase of [
  'Protection of Personal Information Act 4 of 2013',
  'Children’s Act 38 of 2005',
  'accountability',
  'processing limitation',
  'purpose specification',
  'security safeguards',
  'data-subject participation',
  'Children',
  'special personal information',
  'section 72',
  'Information Regulator',
  'access',
  'correction',
  'deletion',
  'object to processing',
  'Electronic Communications and Transactions Act 25 of 2002',
  'Consumer Protection Act 68 of 2008',
  'PAYE, UIF, SDL'
]) {
  assert.ok(legal.toLowerCase().includes(phrase.toLowerCase()), 'Missing legal notice concept: ' + phrase);
}
assert.match(legal, /Little Feet does not treat school-held personal information as a product for sale/);
assert.match(legal, /does not replace the school’s own privacy notice/);
assert.match(legal, /Nothing in these Terms excludes or limits rights or remedies that cannot lawfully be excluded/);
assert.match(legal, /inforegulator\.org\.za/);
assert.match(sw, /assets\/legal-notices\.js\?v=20260925-legal-v1/);

console.log('South African legal notice regression test passed.');
