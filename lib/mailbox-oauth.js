'use strict';

const crypto = require('node:crypto');
const { fetchYahooImap } = require('./yahoo-imap');

const PROVIDERS = new Set(['google', 'microsoft', 'zoho', 'yahoo']);
const PROVIDER_LABELS = Object.freeze({
  google: 'Google Gmail',
  microsoft: 'Microsoft Outlook',
  zoho: 'Zoho Mail',
  yahoo: 'Yahoo Mail'
});

const ZOHO_ACCOUNTS_SERVERS = new Set([
  'https://accounts.zoho.com',
  'https://accounts.zoho.eu',
  'https://accounts.zoho.in',
  'https://accounts.zoho.com.au',
  'https://accounts.zoho.jp',
  'https://accounts.zohocloud.ca',
  'https://accounts.zoho.com.cn',
  'https://accounts.zoho.ae',
  'https://accounts.zoho.sa',
  'https://accounts.zoho.uk'
]);

const providerConfig = (provider, env = process.env) => {
  if (provider === 'google') return {
    clientId: String(env.GOOGLE_CLIENT_ID || ''),
    clientSecret: String(env.GOOGLE_CLIENT_SECRET || ''),
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/gmail.readonly'
  };
  if (provider === 'microsoft') return {
    clientId: String(env.MICROSOFT_CLIENT_ID || ''),
    clientSecret: String(env.MICROSOFT_CLIENT_SECRET || ''),
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid profile email offline_access User.Read Mail.Read'
  };
  if (provider === 'zoho') return {
    clientId: String(env.ZOHO_CLIENT_ID || ''),
    clientSecret: String(env.ZOHO_CLIENT_SECRET || ''),
    authorizeUrl: 'https://accounts.zoho.com/oauth/v2/auth',
    tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
    scope: 'ZohoMail.accounts.READ,ZohoMail.folders.READ,ZohoMail.messages.READ'
  };
  if (provider === 'yahoo') return {
    clientId: String(env.YAHOO_CLIENT_ID || ''),
    clientSecret: String(env.YAHOO_CLIENT_SECRET || ''),
    authorizeUrl: 'https://api.login.yahoo.com/oauth2/request_auth',
    tokenUrl: 'https://api.login.yahoo.com/oauth2/get_token',
    scope: 'openid email mail-r'
  };
  return null;
};

const callbackUrl = (provider, origin) => {
  if (!PROVIDERS.has(provider)) throw new Error('Unsupported mailbox provider.');
  const base = String(origin).replace(/\/$/, '');
  // Reuse the already-authorized Google sign-in callback for mailbox consent so
  // customers never need a second Google Cloud redirect URI.
  if (provider === 'google') return base + '/auth/google/callback';
  return base + '/api/email/mailbox/oauth/' + provider + '/callback';
};

const zohoAccountsServer = value => {
  try {
    const origin = new URL(String(value || '')).origin;
    return ZOHO_ACCOUNTS_SERVERS.has(origin) ? origin : '';
  } catch {
    return '';
  }
};

const zohoMailApiBase = value => {
  const accounts = zohoAccountsServer(value);
  if (!accounts) return '';
  const url = new URL(accounts);
  if (!url.hostname.startsWith('accounts.')) return '';
  url.hostname = 'mail.' + url.hostname.slice('accounts.'.length);
  return url.origin;
};

const createAuthorization = ({ provider, origin, env = process.env }) => {
  const config = providerConfig(provider, env);
  if (!config?.clientId || !config.clientSecret) throw new Error(provider + ' mailbox connection is not configured.');
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const params = {
    client_id: config.clientId,
    redirect_uri: callbackUrl(provider, origin),
    response_type: 'code',
    scope: config.scope,
    state
  };
  if (provider === 'google') Object.assign(params, {
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent'
  });
  if (provider === 'microsoft') Object.assign(params, {
    code_challenge: challenge,
    code_challenge_method: 'S256',
    response_mode: 'query'
  });
  if (provider === 'zoho') Object.assign(params, {
    access_type: 'offline',
    prompt: 'consent'
  });
  if (provider === 'yahoo') Object.assign(params, {
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams(params).toString();
  return { url: url.toString(), state, verifier };
};

const parseResponse = async response => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error_description || body.error?.message || body.error || ('Provider returned HTTP ' + response.status)).slice(0, 300));
  return body;
};

const exchangeCode = async ({
  provider,
  code,
  verifier,
  origin,
  callbackParams = {},
  env = process.env,
  fetchImpl = fetch
}) => {
  const config = providerConfig(provider, env);
  if (!config?.clientId || !config.clientSecret) throw new Error('Mailbox provider is not configured.');
  let tokenUrl = config.tokenUrl;
  if (provider === 'zoho') {
    const accountsServer = zohoAccountsServer(callbackParams.accountsServer);
    if (!accountsServer) throw new Error('Zoho did not return a trusted regional accounts server.');
    tokenUrl = accountsServer + '/oauth/v2/token';
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: callbackUrl(provider, origin)
  });
  if (provider === 'google' || provider === 'microsoft' || provider === 'yahoo') body.set('code_verifier', String(verifier || ''));
  if (provider === 'microsoft' || provider === 'zoho') body.set('scope', config.scope);

  const tokens = await parseResponse(await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  }));

  if (provider === 'zoho') {
    const accountsServer = zohoAccountsServer(callbackParams.accountsServer);
    tokens.providerMetadata = {
      accountsServer,
      location: String(callbackParams.location || '').toLowerCase().slice(0, 16),
      apiDomain: String(tokens.api_domain || ''),
      mailApiBase: zohoMailApiBase(accountsServer)
    };
  }
  return tokens;
};

const refreshAccessToken = async ({
  provider,
  refreshToken,
  origin,
  providerMetadata = {},
  env = process.env,
  fetchImpl = fetch
}) => {
  const config = providerConfig(provider, env);
  if (!config?.clientId || !config.clientSecret || !refreshToken) throw new Error('Mailbox refresh credentials are unavailable.');
  let tokenUrl = config.tokenUrl;
  if (provider === 'zoho') {
    const accountsServer = zohoAccountsServer(providerMetadata.accountsServer);
    if (!accountsServer) throw new Error('Zoho regional accounts server is unavailable.');
    tokenUrl = accountsServer + '/oauth/v2/token';
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });
  if (provider === 'microsoft') body.set('scope', config.scope);
  if (provider === 'yahoo') body.set('redirect_uri', callbackUrl(provider, origin));

  const tokens = await parseResponse(await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  }));
  if (provider === 'zoho' && tokens.api_domain) {
    tokens.providerMetadata = { ...providerMetadata, apiDomain: String(tokens.api_domain) };
  }
  return tokens;
};

const headerValue = (headers, name) => String((headers || []).find(item => String(item?.name).toLowerCase() === name)?.value || '').trim();

const fetchGoogleMailbox = async ({ accessToken, limit = 100, cursor = '', fetchImpl = fetch }) => {
  const auth = { Authorization: 'Bearer ' + accessToken };
  const profile = await parseResponse(await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: auth }));
  const query = new URLSearchParams({ labelIds: 'INBOX', maxResults: String(Math.min(200, Math.max(1, limit))) });
  if (cursor) query.set('pageToken', cursor);
  const listed = await parseResponse(await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages?' + query, { headers: auth }));
  const ids = (Array.isArray(listed.messages) ? listed.messages : []).slice(0, limit);
  const messages = [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const rows = await Promise.all(batch.map(async item => {
      const url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(item.id) + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date';
      const message = await parseResponse(await fetchImpl(url, { headers: auth }));
      const headers = message.payload?.headers || [];
      return {
        id: String(message.id),
        subject: headerValue(headers, 'subject') || '(No subject)',
        from: headerValue(headers, 'from') || 'Unknown sender',
        preview: String(message.snippet || '(No message preview)').slice(0, 3500),
        receivedAt: new Date(Number(message.internalDate) || Date.parse(headerValue(headers, 'date')) || Date.now()).toISOString()
      };
    }));
    messages.push(...rows);
  }
  return { email: String(profile.emailAddress || '').toLowerCase(), messages, nextCursor: String(listed.nextPageToken || '') };
};

const validMicrosoftCursor = value => {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    return url.origin === 'https://graph.microsoft.com' && url.pathname.startsWith('/v1.0/me/mailFolders/inbox/messages') ? url.toString() : '';
  } catch {
    return '';
  }
};

const fetchMicrosoftMailbox = async ({ accessToken, limit = 100, cursor = '', fetchImpl = fetch }) => {
  const headers = { Authorization: 'Bearer ' + accessToken, Prefer: 'outlook.body-content-type="text"' };
  const profile = await parseResponse(await fetchImpl('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers }));
  const query = new URLSearchParams({
    '$top': String(Math.min(200, Math.max(1, limit))),
    '$select': 'id,subject,from,receivedDateTime,bodyPreview',
    '$orderby': 'receivedDateTime desc'
  });
  const listUrl = validMicrosoftCursor(cursor) || ('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?' + query);
  const data = await parseResponse(await fetchImpl(listUrl, { headers }));
  return {
    email: String(profile.mail || profile.userPrincipalName || '').toLowerCase(),
    messages: (Array.isArray(data.value) ? data.value : []).slice(0, limit).map(message => ({
      id: String(message.id),
      subject: String(message.subject || '(No subject)'),
      from: String(message.from?.emailAddress?.name || message.from?.emailAddress?.address || 'Unknown sender'),
      preview: String(message.bodyPreview || '(No message preview)').slice(0, 3500),
      receivedAt: new Date(Date.parse(message.receivedDateTime) || Date.now()).toISOString()
    })),
    nextCursor: validMicrosoftCursor(data['@odata.nextLink'])
  };
};

const cleanZohoText = value => String(value || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim();

const fetchZohoMailbox = async ({
  accessToken,
  limit = 100,
  cursor = '',
  providerMetadata = {},
  fetchImpl = fetch
}) => {
  const mailApiBase = String(providerMetadata.mailApiBase || zohoMailApiBase(providerMetadata.accountsServer) || '');
  if (!mailApiBase) throw new Error('Zoho regional Mail API domain is unavailable.');
  const headers = {
    Accept: 'application/json',
    Authorization: 'Zoho-oauthtoken ' + accessToken
  };
  const accounts = await parseResponse(await fetchImpl(mailApiBase + '/api/accounts', { headers }));
  const accountRows = Array.isArray(accounts.data) ? accounts.data : [];
  const account = accountRows.find(item => item?.type === 'ZOHO_ACCOUNT' && item?.enabled !== false)
    || accountRows.find(item => item?.accountId);
  if (!account?.accountId) throw new Error('Zoho Mail did not return an accessible mailbox account.');
  const primary = Array.isArray(account.emailAddress) ? account.emailAddress.find(item => item?.isPrimary)?.mailId : '';
  const email = String(account.primaryEmailAddress || account.mailboxAddress || account.incomingUserName || primary || '').toLowerCase();
  if (!email) throw new Error('Zoho Mail did not identify the connected email address.');

  const folders = await parseResponse(await fetchImpl(mailApiBase + '/api/accounts/' + encodeURIComponent(account.accountId) + '/folders', { headers }));
  const folderRows = Array.isArray(folders.data) ? folders.data : [];
  const inbox = folderRows.find(item => String(item?.path || '').toLowerCase() === '/inbox')
    || folderRows.find(item => String(item?.folderName || '').toLowerCase() === 'inbox' && String(item?.folderType || '').toLowerCase() === 'inbox');
  if (!inbox?.folderId) throw new Error('Zoho Mail Inbox folder could not be located.');

  const start = /^\d+$/.test(String(cursor || '')) ? Number(cursor) : 0;
  const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 100));
  const query = new URLSearchParams({
    folderId: String(inbox.folderId),
    start: String(start),
    limit: String(boundedLimit),
    threadedMails: 'false',
    includeto: 'true'
  });
  const listed = await parseResponse(await fetchImpl(
    mailApiBase + '/api/accounts/' + encodeURIComponent(account.accountId) + '/messages/view?' + query,
    { headers }
  ));
  const rows = Array.isArray(listed.data) ? listed.data : [];
  return {
    email,
    messages: rows.slice(0, boundedLimit).map(message => ({
      id: String(message.messageId),
      subject: cleanZohoText(message.subject || '(No subject)'),
      from: cleanZohoText(message.sender || message.fromAddress || 'Unknown sender'),
      preview: cleanZohoText(message.summary || '(No message preview)').slice(0, 3500),
      receivedAt: new Date(Number(message.receivedTime || message.receivedtime || message.sentDateInGMT) || Date.now()).toISOString()
    })),
    nextCursor: rows.length >= boundedLimit ? String(start + rows.length) : ''
  };
};

const fetchYahooMailbox = async ({
  accessToken,
  limit = 100,
  cursor = '',
  fetchImpl = fetch,
  yahooImapImpl = fetchYahooImap
}) => {
  const profile = await parseResponse(await fetchImpl('https://api.login.yahoo.com/openid/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken, Accept: 'application/json' }
  }));
  const email = String(profile.email || '').toLowerCase();
  if (!email) throw new Error('Yahoo did not identify the connected email address.');
  const result = await yahooImapImpl({ email, accessToken, limit, cursor });
  return { email, messages: result.messages || [], nextCursor: String(result.nextCursor || '') };
};

const fetchMailbox = options => {
  if (options.provider === 'google') return fetchGoogleMailbox(options);
  if (options.provider === 'microsoft') return fetchMicrosoftMailbox(options);
  if (options.provider === 'zoho') return fetchZohoMailbox(options);
  if (options.provider === 'yahoo') return fetchYahooMailbox(options);
  throw new Error('Unsupported mailbox provider.');
};

const revokeMailboxAccess = async ({
  provider,
  refreshToken = '',
  accessToken = '',
  providerMetadata = {},
  fetchImpl = fetch
}) => {
  const token = String(refreshToken || accessToken || '');
  if (!token) return { supported: true, revoked: true };
  if (provider === 'google') {
    const response = await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token })
    });
    if (!response.ok) throw new Error('Google token revocation returned HTTP ' + response.status);
    return { supported: true, revoked: true };
  }
  if (provider === 'zoho') {
    const accountsServer = zohoAccountsServer(providerMetadata.accountsServer);
    if (!accountsServer) return { supported: false, revoked: false };
    const url = accountsServer + '/oauth/v2/token/revoke?token=' + encodeURIComponent(token);
    const response = await fetchImpl(url, { method: 'POST' });
    if (!response.ok) throw new Error('Zoho token revocation returned HTTP ' + response.status);
    return { supported: true, revoked: true };
  }
  return { supported: false, revoked: false };
};

module.exports = {
  PROVIDERS,
  PROVIDER_LABELS,
  providerConfig,
  callbackUrl,
  zohoAccountsServer,
  zohoMailApiBase,
  createAuthorization,
  exchangeCode,
  refreshAccessToken,
  fetchGoogleMailbox,
  fetchMicrosoftMailbox,
  fetchZohoMailbox,
  fetchYahooMailbox,
  fetchMailbox,
  revokeMailboxAccess
};
