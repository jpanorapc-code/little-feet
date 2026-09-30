const assert = require('node:assert/strict');
const { providerEmails, resolveOAuthAccount, publicOrigin, oauthCallbackUrl } = require('../lib/oauth-identity');

const accounts = [
  { username: 'admin@littlefeet.co.za', loginAliases: ['owner@littlefeet.co.za'], verificationStatus: 'Active' },
  { username: 'pending@example.test', verificationStatus: 'Self-registered — school verification pending' }
];

assert.deepEqual(providerEmails('microsoft', {
  mail: null,
  userPrincipalName: 'tenant-user@example.onmicrosoft.com',
  otherMails: ['ADMIN@littlefeet.co.za']
}), ['admin@littlefeet.co.za', 'tenant-user@example.onmicrosoft.com']);
assert.equal(resolveOAuthAccount('google', { email: 'OWNER@littlefeet.co.za', emailVerified: true }, accounts).account, accounts[0]);
assert.equal(resolveOAuthAccount('yahoo', { email: 'pending@example.test' }, accounts).error, 'account-pending');
assert.equal(resolveOAuthAccount('google', { email: 'unverified@example.test', emailVerified: false }, accounts).error, 'oauth-email-missing');
assert.equal(resolveOAuthAccount('microsoft', { mail: 'missing@example.test' }, accounts).error, 'account-not-linked');
assert.equal(resolveOAuthAccount('google', { email: 'shared@example.test' }, [
  { username: 'first@example.test', loginAliases: ['shared@example.test'], verificationStatus: 'Active' },
  { username: 'second@example.test', loginAliases: ['shared@example.test'], verificationStatus: 'Active' }
]).error, 'account-link-ambiguous');

assert.equal(publicOrigin({ NODE_ENV: 'production', LF_PUBLIC_ORIGIN: 'https://portal.littlefeet.co.za/path' }), 'https://portal.littlefeet.co.za');
assert.equal(publicOrigin({ NODE_ENV: 'production', LF_PUBLIC_ORIGIN: 'http://littlefeet.co.za' }), 'https://littlefeet.co.za');
assert.equal(oauthCallbackUrl('microsoft', { NODE_ENV: 'production', LF_PUBLIC_ORIGIN: 'https://littlefeet.co.za' }), 'https://littlefeet.co.za/auth/microsoft/callback');

console.log('OAuth identity compatibility regression test passed.');
