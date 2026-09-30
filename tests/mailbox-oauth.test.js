'use strict';

const assert = require('node:assert/strict');
const {
  PROVIDERS,
  callbackUrl,
  createAuthorization,
  exchangeCode,
  refreshAccessToken,
  fetchGoogleMailbox,
  fetchMicrosoftMailbox,
  fetchZohoMailbox,
  fetchYahooMailbox,
  revokeMailboxAccess
} = require('../lib/mailbox-oauth');

const env = {
  GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret',
  MICROSOFT_CLIENT_ID: 'microsoft-client', MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
  ZOHO_CLIENT_ID: 'zoho-client', ZOHO_CLIENT_SECRET: 'zoho-secret',
  YAHOO_CLIENT_ID: 'yahoo-client', YAHOO_CLIENT_SECRET: 'yahoo-secret'
};

(async () => {
  assert.deepEqual([...PROVIDERS].sort(), ['google', 'microsoft', 'yahoo', 'zoho']);
  for (const provider of PROVIDERS) {
    assert.equal(
      callbackUrl(provider, 'https://littlefeet.co.za/'),
      provider === 'google'
        ? 'https://littlefeet.co.za/auth/google/callback'
        : 'https://littlefeet.co.za/api/email/mailbox/oauth/' + provider + '/callback'
    );
  }

  const googleAuthorization = createAuthorization({ provider: 'google', origin: 'https://littlefeet.co.za', env });
  const googleUrl = new URL(googleAuthorization.url);
  assert.equal(googleUrl.searchParams.get('access_type'), 'offline');
  assert.equal(googleUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(googleUrl.searchParams.has('openid'), false);
  assert.ok(googleAuthorization.state.length >= 32 && googleAuthorization.verifier.length >= 43);

  const zohoAuthorization = createAuthorization({ provider: 'zoho', origin: 'https://littlefeet.co.za', env });
  const zohoUrl = new URL(zohoAuthorization.url);
  assert.equal(zohoUrl.searchParams.get('access_type'), 'offline');
  assert.match(zohoUrl.searchParams.get('scope'), /ZohoMail\.accounts\.READ/);
  assert.match(zohoUrl.searchParams.get('scope'), /ZohoMail\.folders\.READ/);
  assert.match(zohoUrl.searchParams.get('scope'), /ZohoMail\.messages\.READ/);

  const yahooAuthorization = createAuthorization({ provider: 'yahoo', origin: 'https://littlefeet.co.za', env });
  const yahooUrl = new URL(yahooAuthorization.url);
  assert.match(yahooUrl.searchParams.get('scope'), /mail-r/);
  assert.match(yahooUrl.searchParams.get('scope'), /email/);
  assert.equal(yahooUrl.searchParams.get('code_challenge_method'), 'S256');

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

  const zohoExchange = await exchangeCode({
    provider: 'zoho',
    code: 'zoho-code',
    verifier: 'unused-verifier',
    origin: 'https://littlefeet.co.za',
    callbackParams: { accountsServer: 'https://accounts.zoho.eu', location: 'eu' },
    env,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://accounts.zoho.eu/oauth/v2/token');
      assert.equal(options.body.get('code'), 'zoho-code');
      return {
        ok: true,
        json: async () => ({
          access_token: 'zoho-access',
          refresh_token: 'zoho-refresh',
          api_domain: 'https://api.zoho.eu',
          expires_in: 3600
        })
      };
    }
  });
  assert.equal(zohoExchange.providerMetadata.accountsServer, 'https://accounts.zoho.eu');
  assert.equal(zohoExchange.providerMetadata.mailApiBase, 'https://mail.zoho.eu');

  await assert.rejects(
    exchangeCode({
      provider: 'zoho',
      code: 'zoho-code',
      origin: 'https://littlefeet.co.za',
      callbackParams: { accountsServer: 'https://evil.example' },
      env,
      fetchImpl: async () => { throw new Error('must not call'); }
    }),
    /trusted regional accounts server/
  );

  await refreshAccessToken({
    provider: 'google', refreshToken: 'stored-refresh', origin: 'https://littlefeet.co.za', env,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://oauth2.googleapis.com/token');
      assert.equal(options.body.get('grant_type'), 'refresh_token');
      assert.equal(options.body.get('refresh_token'), 'stored-refresh');
      return { ok: true, json: async () => ({ access_token: 'renewed', expires_in: 3600 }) };
    }
  });

  await refreshAccessToken({
    provider: 'yahoo', refreshToken: 'yahoo-refresh', origin: 'https://littlefeet.co.za', env,
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://api.login.yahoo.com/oauth2/get_token');
      assert.equal(options.body.get('redirect_uri'), 'https://littlefeet.co.za/api/email/mailbox/oauth/yahoo/callback');
      return { ok: true, json: async () => ({ access_token: 'renewed-yahoo', refresh_token: 'rotated-yahoo', expires_in: 3600 }) };
    }
  });

  const gmail = await fetchGoogleMailbox({ accessToken: 'token', limit: 2, fetchImpl: async url => {
    const value = String(url);
    if (value.endsWith('/profile')) return { ok: true, json: async () => ({ emailAddress: 'Owner@Example.com' }) };
    if (value.includes('/messages?')) return { ok: true, json: async () => ({ messages: [{ id: 'g1' }, { id: 'g2' }] }) };
    const id = value.includes('/g1?') ? 'g1' : 'g2';
    return { ok: true, json: async () => ({ id, internalDate: '1780236000000', snippet: 'Preview ' + id, payload: { headers: [{ name: 'From', value: 'Sender <sender@example.com>' }, { name: 'Subject', value: 'Subject ' + id }] } }) };
  }});
  assert.equal(gmail.email, 'owner@example.com');
  assert.deepEqual(gmail.messages.map(item => item.id), ['g1', 'g2']);

  const outlook = await fetchMicrosoftMailbox({ accessToken: 'token', limit: 1, fetchImpl: async url => {
    if (String(url).includes('/me?$select=')) return { ok: true, json: async () => ({ mail: 'outlook@example.com' }) };
    return { ok: true, json: async () => ({ value: [{ id: 'm1', subject: 'Microsoft subject', bodyPreview: 'Microsoft preview', receivedDateTime: '2026-09-30T10:00:00Z', from: { emailAddress: { name: 'Microsoft sender', address: 'sender@example.com' } } }] }) };
  }});
  assert.equal(outlook.email, 'outlook@example.com');
  assert.equal(outlook.messages[0].id, 'm1');

  const zoho = await fetchZohoMailbox({
    accessToken: 'zoho-token',
    limit: 1,
    providerMetadata: { accountsServer: 'https://accounts.zoho.eu', mailApiBase: 'https://mail.zoho.eu' },
    fetchImpl: async url => {
      const value = String(url);
      if (value.endsWith('/api/accounts')) return {
        ok: true,
        json: async () => ({ data: [{ type: 'ZOHO_ACCOUNT', enabled: true, accountId: 'za1', primaryEmailAddress: 'Zoho@Example.com' }] })
      };
      if (value.endsWith('/api/accounts/za1/folders')) return {
        ok: true,
        json: async () => ({ data: [{ folderType: 'Inbox', folderName: 'Inbox', path: '/Inbox', folderId: 'inbox1' }] })
      };
      assert.match(value, /\/api\/accounts\/za1\/messages\/view\?/);
      return {
        ok: true,
        json: async () => ({ data: [{ messageId: 'z1', subject: 'Zoho subject', sender: 'Zoho sender', summary: 'Zoho preview', receivedTime: '1780236000000' }] })
      };
    }
  });
  assert.equal(zoho.email, 'zoho@example.com');
  assert.equal(zoho.messages[0].id, 'z1');

  const yahoo = await fetchYahooMailbox({
    accessToken: 'yahoo-token',
    limit: 1,
    fetchImpl: async url => {
      assert.equal(String(url), 'https://api.login.yahoo.com/openid/v1/userinfo');
      return { ok: true, json: async () => ({ email: 'Yahoo@Example.com' }) };
    },
    yahooImapImpl: async options => {
      assert.equal(options.email, 'yahoo@example.com');
      assert.equal(options.accessToken, 'yahoo-token');
      return {
        messages: [{ id: '42:9', subject: 'Yahoo subject', from: 'Yahoo sender', preview: 'Yahoo preview', receivedAt: '2026-09-30T10:00:00.000Z' }],
        nextCursor: '42:8'
      };
    }
  });
  assert.equal(yahoo.email, 'yahoo@example.com');
  assert.equal(yahoo.messages[0].id, '42:9');
  assert.equal(yahoo.nextCursor, '42:8');

  let revokedUrl = '';
  await revokeMailboxAccess({
    provider: 'zoho',
    refreshToken: 'zoho-refresh',
    providerMetadata: { accountsServer: 'https://accounts.zoho.eu' },
    fetchImpl: async url => {
      revokedUrl = String(url);
      return { ok: true, status: 200 };
    }
  });
  assert.match(revokedUrl, /^https:\/\/accounts\.zoho\.eu\/oauth\/v2\/token\/revoke\?token=/);

  console.log('Mailbox OAuth and provider sync regression test passed.');
})().catch(error => { console.error(error); process.exit(1); });
