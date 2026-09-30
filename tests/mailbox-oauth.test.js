'use strict';

const assert = require('node:assert/strict');
const { callbackUrl, createAuthorization, exchangeCode, refreshAccessToken, fetchGoogleMailbox, fetchMicrosoftMailbox } = require('../lib/mailbox-oauth');

const env = {
  GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret',
  MICROSOFT_CLIENT_ID: 'microsoft-client', MICROSOFT_CLIENT_SECRET: 'microsoft-secret'
};

(async () => {
  assert.equal(callbackUrl('google', 'https://littlefeet.co.za/'), 'https://littlefeet.co.za/api/email/mailbox/oauth/google/callback');
  const authorization = createAuthorization({ provider: 'google', origin: 'https://littlefeet.co.za', env });
  const authorizationUrl = new URL(authorization.url);
  assert.equal(authorizationUrl.searchParams.get('access_type'), 'offline');
  assert.match(authorizationUrl.searchParams.get('scope'), /gmail\.readonly/);
  assert.ok(authorization.state.length >= 32 && authorization.verifier.length >= 43);

  const exchanged = await exchangeCode({
    provider: 'microsoft', code: 'auth-code', verifier: 'pkce-verifier', origin: 'https://littlefeet.co.za', env,
    fetchImpl: async (url, options) => {
      assert.match(String(url), /oauth2\/v2\.0\/token$/);
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('code_verifier'), 'pkce-verifier');
      return { ok: true, json: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }) };
    }
  });
  assert.equal(exchanged.refresh_token, 'refresh');

  await refreshAccessToken({
    provider: 'google', refreshToken: 'stored-refresh', env,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://oauth2.googleapis.com/token');
      assert.equal(options.body.get('grant_type'), 'refresh_token');
      assert.equal(options.body.get('refresh_token'), 'stored-refresh');
      return { ok: true, json: async () => ({ access_token: 'renewed', expires_in: 3600 }) };
    }
  });

  const gmail = await fetchGoogleMailbox({ accessToken: 'token', limit: 2, fetchImpl: async url => {
    const value = String(url);
    if (value.endsWith('/profile')) return { ok: true, json: async () => ({ emailAddress: 'Owner@Example.com' }) };
    if (value.includes('/messages?')) return { ok: true, json: async () => ({ messages: [{ id: 'g1' }, { id: 'g2' }] }) };
    const id = value.includes('/g1?') ? 'g1' : 'g2';
    return { ok: true, json: async () => ({ id, internalDate: '1780236000000', snippet: `Preview ${id}`, payload: { headers: [{ name: 'From', value: 'Sender <sender@example.com>' }, { name: 'Subject', value: `Subject ${id}` }] } }) };
  }});
  assert.equal(gmail.email, 'owner@example.com');
  assert.deepEqual(gmail.messages.map(item => item.id), ['g1', 'g2']);

  const outlook = await fetchMicrosoftMailbox({ accessToken: 'token', limit: 1, fetchImpl: async url => {
    if (String(url).includes('/me?$select=')) return { ok: true, json: async () => ({ mail: 'outlook@example.com' }) };
    return { ok: true, json: async () => ({ value: [{ id: 'm1', subject: 'Microsoft subject', bodyPreview: 'Microsoft preview', receivedDateTime: '2026-09-30T10:00:00Z', from: { emailAddress: { name: 'Microsoft sender', address: 'sender@example.com' } } }] }) };
  }});
  assert.equal(outlook.email, 'outlook@example.com');
  assert.equal(outlook.messages[0].id, 'm1');

  console.log('Mailbox OAuth and provider sync regression test passed.');
})().catch(error => { console.error(error); process.exit(1); });
