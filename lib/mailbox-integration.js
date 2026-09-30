'use strict';

const tls = require('tls');

const normalizeAppPassword = value => String(value || '').replace(/\s+/g, '');

const cleanText = (value, max = 12000) => String(value || '')
  .replace(/\0/g, '')
  .replace(/\r/g, '')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{4,}/g, '\n\n\n')
  .trim()
  .slice(0, max);

const stripHtml = value => cleanText(String(value || '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p\s*>/gi, '\n\n')
  .replace(/<\/div\s*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'"));

const decodeBase64Url = value => {
  const normal = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normal + '='.repeat((4 - (normal.length % 4)) % 4);
  try { return Buffer.from(padded, 'base64').toString('utf8'); } catch { return ''; }
};

const decodeQuotedPrintable = value => String(value || '')
  .replace(/=\r?\n/g, '')
  .replace(/=([0-9A-F]{2})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

const decodeMimeWord = token => {
  const match = /^=\?([^?]+)\?([bq])\?([^?]*)\?=$/i.exec(String(token || ''));
  if (!match) return token;
  try {
    if (match[2].toLowerCase() === 'b') return Buffer.from(match[3], 'base64').toString('utf8');
    return decodeQuotedPrintable(match[3].replace(/_/g, ' '));
  } catch {
    return token;
  }
};

const decodeMimeWords = value => String(value || '').replace(/=\?[^?]+\?[bq]\?[^?]*\?=/gi, decodeMimeWord);

const parseHeaders = raw => {
  const unfolded = String(raw || '').replace(/\r?\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const name = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (!headers[name]) headers[name] = decodeMimeWords(value);
  }
  return headers;
};

const decodeTransfer = (body, encoding) => {
  const type = String(encoding || '').trim().toLowerCase();
  try {
    if (type === 'base64') return Buffer.from(String(body || '').replace(/\s+/g, ''), 'base64').toString('utf8');
    if (type === 'quoted-printable') return decodeQuotedPrintable(body);
  } catch {}
  return String(body || '');
};

const mimeBoundary = contentType => {
  const match = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
  return match?.[1] || match?.[2] || '';
};

const extractMimeText = (headerMap, rawBody) => {
  const contentType = String(headerMap['content-type'] || '').toLowerCase();
  const topEncoding = headerMap['content-transfer-encoding'];
  const boundary = mimeBoundary(contentType);

  if (boundary) {
    const parts = String(rawBody || '').split('--' + boundary);
    let htmlFallback = '';
    for (const part of parts) {
      const split = /\r?\n\r?\n/.exec(part);
      if (!split) continue;
      const index = split.index;
      const partHeaders = parseHeaders(part.slice(0, index));
      const partBody = part.slice(index + split[0].length);
      const partType = String(partHeaders['content-type'] || '').toLowerCase();
      const decoded = decodeTransfer(partBody, partHeaders['content-transfer-encoding']);
      if (partType.includes('text/plain')) return cleanText(decoded);
      if (!htmlFallback && partType.includes('text/html')) htmlFallback = stripHtml(decoded);
    }
    if (htmlFallback) return htmlFallback;
  }

  const decoded = decodeTransfer(rawBody, topEncoding);
  return contentType.includes('text/html') ? stripHtml(decoded) : cleanText(decoded);
};

const gmailPayloadText = payload => {
  if (!payload || typeof payload !== 'object') return '';
  const mimeType = String(payload.mimeType || '').toLowerCase();
  if (mimeType === 'text/plain' && payload.body?.data) return cleanText(decodeBase64Url(payload.body.data));
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const text = gmailPayloadText(part);
      if (text && String(part.mimeType || '').toLowerCase() === 'text/plain') return text;
    }
    for (const part of payload.parts) {
      const text = gmailPayloadText(part);
      if (text) return text;
    }
  }
  if (mimeType === 'text/html' && payload.body?.data) return stripHtml(decodeBase64Url(payload.body.data));
  if (payload.body?.data) return cleanText(decodeBase64Url(payload.body.data));
  return '';
};

const mapLimit = async (values, limit, mapper) => {
  const output = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, values.length || 1)) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return output;
};

const fetchJson = async (fetchImpl, url, options = {}) => {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Mailbox provider request failed.');
    error.status = response.status;
    error.providerBody = data;
    throw error;
  }
  return data;
};

const fetchGmailMessages = async ({ accessToken, fetchImpl = global.fetch, limit = 30 }) => {
  if (!accessToken) throw new Error('Gmail access token is missing.');
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('labelIds', 'INBOX');
  listUrl.searchParams.set('maxResults', String(Math.max(1, Math.min(50, limit))));
  const list = await fetchJson(fetchImpl, listUrl, { headers: { Authorization: 'Bearer ' + accessToken } });
  const refs = Array.isArray(list.messages) ? list.messages : [];
  const rows = await mapLimit(refs, 5, async ref => {
    const detailUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages/' + encodeURIComponent(ref.id));
    detailUrl.searchParams.set('format', 'full');
    const message = await fetchJson(fetchImpl, detailUrl, { headers: { Authorization: 'Bearer ' + accessToken } });
    const headers = Object.fromEntries((message.payload?.headers || []).map(header => [String(header.name || '').toLowerCase(), decodeMimeWords(header.value || '')]));
    const receivedAt = headers.date && !Number.isNaN(Date.parse(headers.date))
      ? new Date(headers.date).toISOString()
      : (message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString());
    return {
      externalId: String(message.id || ref.id),
      subject: cleanText(headers.subject || '(No subject)', 300),
      from: cleanText(headers.from || 'Unknown sender', 300),
      receivedAt,
      body: cleanText(gmailPayloadText(message.payload) || message.snippet || '', 12000),
      providerLink: message.threadId ? 'https://mail.google.com/mail/u/0/#inbox/' + encodeURIComponent(message.threadId) : ''
    };
  });
  return rows.filter(Boolean).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
};

const fetchMicrosoftMessages = async ({ accessToken, fetchImpl = global.fetch, limit = 30 }) => {
  if (!accessToken) throw new Error('Microsoft access token is missing.');
  const url = new URL('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages');
  url.searchParams.set('$top', String(Math.max(1, Math.min(50, limit))));
  url.searchParams.set('$select', 'id,subject,from,receivedDateTime,body,bodyPreview,webLink');
  url.searchParams.set('$orderby', 'receivedDateTime desc');
  const data = await fetchJson(fetchImpl, url, {
    headers: { Authorization: 'Bearer ' + accessToken, Prefer: 'outlook.body-content-type="html"' }
  });
  return (Array.isArray(data.value) ? data.value : []).map(message => ({
    externalId: String(message.id || ''),
    subject: cleanText(message.subject || '(No subject)', 300),
    from: cleanText(message.from?.emailAddress?.name
      ? message.from.emailAddress.name + ' <' + String(message.from.emailAddress.address || '') + '>'
      : message.from?.emailAddress?.address || 'Unknown sender', 300),
    receivedAt: message.receivedDateTime && !Number.isNaN(Date.parse(message.receivedDateTime))
      ? new Date(message.receivedDateTime).toISOString()
      : new Date().toISOString(),
    body: cleanText(message.body?.contentType === 'html' ? stripHtml(message.body.content) : (message.body?.content || message.bodyPreview || ''), 12000),
    providerLink: /^https:\/\//i.test(String(message.webLink || '')) ? String(message.webLink) : ''
  })).filter(message => message.externalId);
};


const ZOHO_MAIL_BASES = Object.freeze({
  us: 'https://mail.zoho.com',
  com: 'https://mail.zoho.com',
  eu: 'https://mail.zoho.eu',
  in: 'https://mail.zoho.in',
  au: 'https://mail.zoho.com.au',
  jp: 'https://mail.zoho.jp',
  ca: 'https://mail.zohocloud.ca',
  cn: 'https://mail.zoho.com.cn',
  ae: 'https://mail.zoho.ae',
  sa: 'https://mail.zoho.sa'
});
const ZOHO_MAIL_BASE_SET = new Set(Object.values(ZOHO_MAIL_BASES));

const zohoMailBaseForLocation = location => {
  const key = String(location || '').trim().toLowerCase();
  return ZOHO_MAIL_BASES[key] || '';
};

const validateZohoMailBase = value => {
  const clean = String(value || '').replace(/\/+$/, '');
  if (!ZOHO_MAIL_BASE_SET.has(clean)) throw new Error('Unsupported Zoho Mail data centre.');
  return clean;
};

const zohoAuthHeaders = accessToken => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  Authorization: 'Zoho-oauthtoken ' + accessToken
});

const fetchZohoMessages = async ({ accessToken, mailApiBase, address, fetchImpl = global.fetch, limit = 30 }) => {
  if (!accessToken) throw new Error('Zoho access token is missing.');
  const base = validateZohoMailBase(mailApiBase);
  const headers = zohoAuthHeaders(accessToken);
  const accounts = await fetchJson(fetchImpl, base + '/api/accounts', { headers });
  const rows = Array.isArray(accounts.data) ? accounts.data : [];
  const wanted = String(address || '').trim().toLowerCase();
  const account = rows.find(item => {
    const candidates = [
      item?.primaryEmailAddress,
      item?.mailboxAddress,
      item?.incomingUserName,
      ...(Array.isArray(item?.emailAddress) ? item.emailAddress.map(entry => entry?.mailId) : [])
    ].filter(Boolean).map(value => String(value).trim().toLowerCase());
    return wanted && candidates.includes(wanted);
  }) || rows.find(item => item?.type === 'ZOHO_ACCOUNT' && item?.enabled !== false) || rows.find(item => item?.accountId);
  if (!account?.accountId) throw new Error('Zoho Mail did not return an accessible mailbox account.');

  const accountId = String(account.accountId);
  const folders = await fetchJson(fetchImpl, base + '/api/accounts/' + encodeURIComponent(accountId) + '/folders', { headers });
  const folderRows = Array.isArray(folders.data) ? folders.data : [];
  const inbox = folderRows.find(folder => String(folder?.folderType || '').toLowerCase() === 'inbox' && String(folder?.path || '').toLowerCase() === '/inbox')
    || folderRows.find(folder => String(folder?.folderType || '').toLowerCase() === 'inbox')
    || folderRows.find(folder => String(folder?.folderName || '').toLowerCase() === 'inbox');
  if (!inbox?.folderId) throw new Error('Zoho Mail Inbox folder was not found.');

  const folderId = String(inbox.folderId);
  const listUrl = new URL(base + '/api/accounts/' + encodeURIComponent(accountId) + '/messages/view');
  listUrl.searchParams.set('folderId', folderId);
  listUrl.searchParams.set('start', '1');
  listUrl.searchParams.set('limit', String(Math.max(1, Math.min(50, limit))));
  listUrl.searchParams.set('status', 'all');
  listUrl.searchParams.set('sortBy', 'date');
  listUrl.searchParams.set('sortorder', 'false');
  const listing = await fetchJson(fetchImpl, listUrl, { headers });
  const messages = Array.isArray(listing.data) ? listing.data : [];

  const mapped = await mapLimit(messages, 5, async message => {
    const messageId = String(message?.messageId || '');
    if (!messageId) return null;
    let body = cleanText(message?.summary || '', 12000);
    try {
      const contentUrl = base + '/api/accounts/' + encodeURIComponent(accountId)
        + '/folders/' + encodeURIComponent(String(message.folderId || folderId))
        + '/messages/' + encodeURIComponent(messageId) + '/content';
      const content = await fetchJson(fetchImpl, contentUrl, { headers });
      if (content?.data?.content) body = stripHtml(content.data.content);
    } catch {
      // A message summary is still useful if Zoho withholds a particular body.
    }
    const stamp = Number(message.receivedTime || message.sentDateInGMT || 0);
    const receivedAt = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp).toISOString() : new Date().toISOString();
    const senderName = cleanText(message.sender || '', 160);
    const senderAddress = cleanText(message.fromAddress || '', 254);
    return {
      externalId: messageId,
      subject: cleanText(message.subject || '(No subject)', 300),
      from: cleanText(senderName && senderAddress ? senderName + ' <' + senderAddress + '>' : (senderAddress || senderName || 'Unknown sender'), 300),
      receivedAt,
      body,
      providerLink: ''
    };
  });

  return mapped.filter(Boolean).sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
};

class ImapSession {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.literalBytes = 0;
    this.tokens = [];
    this.waiters = [];
    this.sequence = 0;
    this.closedError = null;
    socket.on('data', chunk => this.onData(Buffer.from(chunk)));
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('Mailbox connection closed.')));
  }

  fail(error) {
    if (this.closedError) return;
    this.closedError = error instanceof Error ? error : new Error(String(error || 'Mailbox connection failed.'));
    while (this.waiters.length) this.waiters.shift().reject(this.closedError);
  }

  push(token) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(token);
    else this.tokens.push(token);
  }

  next() {
    if (this.tokens.length) return Promise.resolve(this.tokens.shift());
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length) {
      if (this.literalBytes > 0) {
        if (this.buffer.length < this.literalBytes) return;
        const literal = this.buffer.subarray(0, this.literalBytes);
        this.buffer = this.buffer.subarray(this.literalBytes);
        this.literalBytes = 0;
        this.push({ literal });
        continue;
      }
      const end = this.buffer.indexOf('\r\n');
      if (end < 0) return;
      const line = this.buffer.subarray(0, end).toString('utf8');
      this.buffer = this.buffer.subarray(end + 2);
      this.push({ line });
      const match = /\{(\d+)\}$/.exec(line);
      if (match) this.literalBytes = Number(match[1]);
    }
  }

  async greeting() {
    const token = await this.next();
    if (!token.line || !/^\* (?:OK|PREAUTH)\b/i.test(token.line)) throw new Error('Mailbox server did not accept the secure connection.');
  }

  async command(command) {
    const tag = 'LF' + String(++this.sequence).padStart(4, '0');
    this.socket.write(tag + ' ' + command + '\r\n');
    const response = [];
    while (true) {
      const token = await this.next();
      response.push(token);
      if (token.line && token.line.toUpperCase().startsWith(tag + ' ')) {
        if (!new RegExp('^' + tag + ' OK\\b', 'i').test(token.line)) {
          const detail = token.line.slice(tag.length).trim().replace(/[\r\n]/g, ' ').slice(0, 240);
          const error = new Error(/^LOGIN\s/i.test(command)
            ? 'Mailbox authentication was rejected.'
            : 'Mailbox server rejected the request.');
          error.imapDetail = detail;
          error.imapCommand = String(command || '').split(' ')[0].toUpperCase();
          throw error;
        }
        return response;
      }
    }
  }

  destroy() {
    try { this.socket.end(); } catch {}
    try { this.socket.destroy(); } catch {}
  }
}

const imapQuote = value => '"' + String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

const connectTls = ({ host, port, connect = tls.connect, timeoutMs = 15000 }) => new Promise((resolve, reject) => {
  let settled = false;
  const socket = connect({ host, port, servername: host, rejectUnauthorized: true });
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    socket.destroy();
    reject(new Error('Mailbox connection timed out.'));
  }, timeoutMs);
  timer.unref?.();
  const done = (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (error) reject(error);
    else resolve(socket);
  };
  socket.once('secureConnect', () => done());
  socket.once('error', done);
});

const imapSearchDate = (days = 90) => {
  const value = new Date(Date.now() - Math.max(1, days) * 86400000);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(value.getUTCDate()).padStart(2, '0') + '-' + months[value.getUTCMonth()] + '-' + value.getUTCFullYear();
};

const fetchImapMessages = async ({ host, port = 993, address, password, accessToken, connect = tls.connect, limit = 30 }) => {
  const normalizedPassword = normalizeAppPassword(password);
  const oauthToken = String(accessToken || '').trim();
  if (!host || !address || (!normalizedPassword && !oauthToken)) throw new Error('Mailbox IMAP settings are incomplete.');
  const socket = await connectTls({ host, port, connect });
  const session = new ImapSession(socket);
  try {
    await session.greeting();
    if (oauthToken) {
      const xoauth2 = Buffer.from('user=' + address + '\x01auth=Bearer ' + oauthToken + '\x01\x01').toString('base64');
      await session.command('AUTHENTICATE XOAUTH2 ' + xoauth2);
    } else {
      await session.command('LOGIN ' + imapQuote(address) + ' ' + imapQuote(normalizedPassword));
    }
    await session.command('SELECT INBOX');
    const search = await session.command('UID SEARCH SINCE ' + imapSearchDate(90));
    const searchLine = search.find(token => token.line && /^\* SEARCH\b/i.test(token.line))?.line || '';
    const ids = searchLine.replace(/^\* SEARCH\s*/i, '').trim().split(/\s+/).filter(value => /^\d+$/.test(value));
    const selected = ids.slice(-Math.max(1, Math.min(50, limit))).reverse();
    const rows = [];

    for (const uid of selected) {
      const response = await session.command('UID FETCH ' + uid + ' (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.12000>)');
      const literals = response.filter(token => token.literal).map(token => token.literal.toString('utf8'));
      const headerText = literals[0] || '';
      const bodyText = literals[1] || '';
      const headers = parseHeaders(headerText);
      const receivedAt = headers.date && !Number.isNaN(Date.parse(headers.date)) ? new Date(headers.date).toISOString() : new Date().toISOString();
      rows.push({
        externalId: headers['message-id'] || 'uid:' + uid,
        subject: cleanText(headers.subject || '(No subject)', 300),
        from: cleanText(headers.from || 'Unknown sender', 300),
        receivedAt,
        body: cleanText(extractMimeText(headers, bodyText), 12000),
        providerLink: ''
      });
    }

    await session.command('LOGOUT').catch(() => {});
    return rows.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
  } finally {
    session.destroy();
  }
};

module.exports = {
  normalizeAppPassword,
  cleanText,
  stripHtml,
  decodeMimeWords,
  parseHeaders,
  extractMimeText,
  gmailPayloadText,
  fetchGmailMessages,
  fetchMicrosoftMessages,
  fetchZohoMessages,
  zohoMailBaseForLocation,
  validateZohoMailBase,
  fetchImapMessages,
  ImapSession
};
