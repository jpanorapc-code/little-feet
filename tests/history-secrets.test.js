const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const history = execFileSync('git', ['log', '--all', '-p', '--no-ext-diff', '--no-renames'], {
  encoding: 'utf8',
  maxBuffer: 100 * 1024 * 1024
});

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /sk_live_[0-9A-Za-z]{16,}/,
  /xox[baprs]-[0-9A-Za-z-]{20,}/
];

for (const pattern of secretPatterns) {
  assert.doesNotMatch(history, pattern, `Potential secret pattern found in Git history: ${pattern}`);
}

console.log('Git history secret-pattern scan passed.');
