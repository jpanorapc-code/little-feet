'use strict';

const crypto = require('node:crypto');

const PROVIDERS = new Set(['google', 'microsoft']);
const providerConfig = (provider, env = process.env) => {
  if (provider === 'google') return {
    clientId: String(env.GOOGLE_CLIENT_ID || ''),
    clientSecret: String(env.GOOGLE_CLIENT_SECRET || ''),
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email https://www.googleapis.com/auth/gmail.readonly'
  };
  if (provider === 'microsoft') return {
    clientId: String(env.MICROSOFT_CLIENT_ID || ''),
    clientSecret: String(env.MICROSOFT_CLIENT_SECRET || ''),
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'openid profile email offline_access User.Read Mail.Read'
  };
  return null;
};

const callbackUrl = (provider, origin) => {
  if (!PROVIDERS.has(provider)) throw new Error('Unsupported mailbox provider.');
  return `${String(origin).replace(/\/$/, '')}/api/email/mailbox/oauth/${provider}/callback`;
};

const createAuthorization = ({ provider, origin, env = process.env }) => {
  const config = providerConfig(provider, env);
  if (!config?.clientId || !config.clientSecret) throw new Error(`${provider} mailbox connection is not configured.`);
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(provider, origin),
    response_type: 'code',
    scope: config.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(provider === 'google' ? { access_type: 'offline', prompt: 'consent' } : { response_mode: 'query' })
  }).toString();
  return { url: url.toString(), state, verifier };
};

const parseResponse = async response => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error_description || body.error?.message || body.error || `Provider returned HTTP ${response.status}`).slice(0, 300));
  return body;
};

const exchangeCode = async ({ provider, code, verifier, origin, env = process.env, fetchImpl = fetch }) => {
  const config = providerConfig(provider, env);
  if (!config?.clientId || !config.clientSecret) throw new Error('Mailbox provider is not configured.');
  return parseResponse(await fetchImpl(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: callbackUrl(provider, origin),
      scope: config.scope
    })
  }));
};

const refreshAccessToken = async ({ provider, refreshToken, env = process.env, fetchImpl = fetch }) => {
  const config = providerConfig(provider, env);
  if (!config?.clientId || !config.clientSecret || !refreshToken) throw new Error('Mailbox refresh credentials are unavailable.');
  return parseResponse(await fetchImpl(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: config.scope
    })
  }));
};

const headerValue = (headers, name) => String((headers || []).find(item => String(item?.name).toLowerCase() === name)?.value || '').trim();
const fetchGoogleMailbox = async ({ accessToken, limit = 100, cursor = '', fetchImpl = fetch }) => {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const profile = await parseResponse(await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: auth }));
  const query = new URLSearchParams({ labelIds: 'INBOX', maxResults: String(Math.min(200, Math.max(1, limit))) });
  if (cursor) query.set('pageToken', cursor);
  const listed = await parseResponse(await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`, { headers: auth }));
  const ids = (Array.isArray(listed.messages) ? listed.messages : []).slice(0, limit);
  const messages = [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const rows = await Promise.all(batch.map(async item => {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
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
  } catch { return ''; }
};
const fetchMicrosoftMailbox = async ({ accessToken, limit = 100, cursor = '', fetchImpl = fetch }) => {
  const headers = { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.body-content-type="text"' };
  const profile = await parseResponse(await fetchImpl('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers }));
  const query = new URLSearchParams({
    '$top': String(Math.min(200, Math.max(1, limit))),
    '$select': 'id,subject,from,receivedDateTime,bodyPreview',
    '$orderby': 'receivedDateTime desc'
  });
  const listUrl = validMicrosoftCursor(cursor) || `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?${query}`;
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

const fetchMailbox = options => options.provider === 'google' ? fetchGoogleMailbox(options) : fetchMicrosoftMailbox(options);

module.exports = {
  PROVIDERS, providerConfig, callbackUrl, createAuthorization, exchangeCode, refreshAccessToken,
  fetchGoogleMailbox, fetchMicrosoftMailbox, fetchMailbox
};
