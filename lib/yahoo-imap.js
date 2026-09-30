'use strict';

const tls = require('node:tls');

const DEFAULT_HOST = 'imap.mail.yahoo.com';
const DEFAULT_PORT = 993;
const COMMAND_TIMEOUT_MS = 25000;
const MAX_PREVIEW_BYTES = 3500;

const cleanHeaderValue = value => String(value || '').replace(/\r?\n[ \t]+/g, ' ').trim();

const decodeMimeWords = value => cleanHeaderValue(value).replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g, (match, charset, encoding, payload) => {
  try {
    const bytes = String(encoding).toUpperCase() === 'B'
      ? Buffer.from(payload, 'base64')
      : Buffer.from(String(payload).replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'binary');
    const normalized = String(charset || '').toLowerCase();
    if (!normalized || normalized === 'utf-8' || normalized === 'utf8' || normalized === 'us-ascii') return bytes.toString('utf8');
    if (normalized === 'iso-8859-1' || normalized === 'latin1') return bytes.toString('latin1');
    return bytes.toString('utf8');
  } catch {
    return match;
  }
});

const parseHeaders = raw => {
  const unfolded = String(raw || '').replace(/\r?\n[ \t]+/g, ' ');
  const result = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    if (!result[key]) result[key] = line.slice(index + 1).trim();
  }
  return result;
};

const previewText = raw => String(raw || '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, MAX_PREVIEW_BYTES);

const buildOauthBearerPayload = ({ email, accessToken, host = DEFAULT_HOST, port = DEFAULT_PORT }) => {
  const user = String(email || '').trim();
  const token = String(accessToken || '').trim();
  if (!user || !token) throw new Error('Yahoo IMAP OAuth credentials are incomplete.');
  const value = 'n,a=' + user + ',\x01host=' + host + '\x01port=' + port + '\x01auth=Bearer ' + token + '\x01\x01';
  return Buffer.from(value, 'utf8').toString('base64');
};

class ImapSession {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.waiter = null;
    this.closedError = null;
    socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    socket.on('error', error => {
      this.closedError = error;
      this.drain();
    });
    socket.on('close', () => {
      if (!this.closedError) this.closedError = new Error('Yahoo IMAP connection closed unexpectedly.');
      this.drain();
    });
  }

  waitFor(consume) {
    if (this.waiter) return Promise.reject(new Error('Yahoo IMAP command overlap is not supported.'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.waiter && this.waiter.reject === reject) this.waiter = null;
        reject(new Error('Yahoo IMAP command timed out.'));
      }, COMMAND_TIMEOUT_MS);
      this.waiter = { consume, resolve, reject, timeout };
      this.drain();
    });
  }

  drain() {
    if (!this.waiter) return;
    if (this.closedError) {
      const waiter = this.waiter;
      this.waiter = null;
      clearTimeout(waiter.timeout);
      waiter.reject(this.closedError);
      return;
    }
    let consumed;
    try {
      consumed = this.waiter.consume(this.buffer);
    } catch (error) {
      const waiter = this.waiter;
      this.waiter = null;
      clearTimeout(waiter.timeout);
      waiter.reject(error);
      return;
    }
    if (!consumed) return;
    const waiter = this.waiter;
    this.waiter = null;
    clearTimeout(waiter.timeout);
    this.buffer = this.buffer.subarray(consumed.bytes);
    waiter.resolve(consumed.value);
  }

  readGreeting() {
    return this.waitFor(buffer => {
      const text = buffer.toString('latin1');
      const index = text.indexOf('\r\n');
      if (index < 0) return null;
      const line = text.slice(0, index);
      if (!/^\* (?:OK|PREAUTH)\b/i.test(line)) throw new Error('Yahoo IMAP server did not return a valid greeting.');
      return { bytes: index + 2, value: line };
    });
  }

  async command(tag, command) {
    const pending = this.waitFor(buffer => {
      const text = buffer.toString('latin1');
      const expression = new RegExp('(?:^|\\r\\n)' + tag + ' (OK|NO|BAD)([^\\r\\n]*)\\r\\n', 'i');
      const match = expression.exec(text);
      if (!match) return null;
      const end = match.index + match[0].length;
      const status = String(match[1] || '').toUpperCase();
      const response = text.slice(0, end);
      if (status !== 'OK') throw new Error(('Yahoo IMAP ' + command.split(/\s+/)[0] + ' failed: ' + String(match[2] || '').trim()).slice(0, 300));
      return { bytes: end, value: response };
    });
    this.socket.write(tag + ' ' + command + '\r\n', 'utf8');
    return pending;
  }

  destroy() {
    try { this.socket.end(); } catch {}
    try { this.socket.destroy(); } catch {}
  }
}

const connectTls = ({ host = DEFAULT_HOST, port = DEFAULT_PORT, tlsConnect = tls.connect }) => new Promise((resolve, reject) => {
  let settled = false;
  const socket = tlsConnect({
    host,
    port,
    servername: host,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2'
  }, () => {
    settled = true;
    socket.setTimeout(COMMAND_TIMEOUT_MS, () => socket.destroy(new Error('Yahoo IMAP socket timed out.')));
    resolve(socket);
  });
  socket.once('error', error => {
    if (!settled) reject(error);
  });
});

const parseUidValidity = response => {
  const match = String(response || '').match(/\[UIDVALIDITY\s+(\d+)\]/i);
  return match ? match[1] : '';
};

const parseSearchUids = response => {
  const match = String(response || '').match(/(?:^|\r\n)\* SEARCH([^\r\n]*)/i);
  if (!match) return [];
  return match[1].trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isSafeInteger).sort((a, b) => a - b);
};

const parseCursor = cursor => {
  const match = String(cursor || '').match(/^(\d+):(\d+)$/);
  return match ? { uidValidity: match[1], beforeUid: Number(match[2]) } : null;
};

const literalValues = block => {
  const values = [];
  const expression = /\{(\d+)\}\r\n/g;
  let match;
  while ((match = expression.exec(block))) {
    const length = Number(match[1]);
    const start = expression.lastIndex;
    const end = start + length;
    if (!Number.isSafeInteger(length) || length < 0 || end > block.length) break;
    values.push(block.slice(start, end));
    expression.lastIndex = end;
  }
  return values;
};

const parseFetchMessages = ({ response, uidValidity }) => {
  const text = String(response || '');
  const starts = Array.from(text.matchAll(/(?:^|\r\n)\* \d+ FETCH \(/g)).map(match => match.index + (match[0].startsWith('\r\n') ? 2 : 0));
  const messages = [];
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = index + 1 < starts.length ? starts[index + 1] : text.length;
    const block = text.slice(start, end);
    const uidMatch = block.match(/\bUID\s+(\d+)/i);
    if (!uidMatch) continue;
    const literals = literalValues(block);
    const headers = parseHeaders(literals[0] || '');
    const body = previewText(literals[1] || '');
    const internalDate = block.match(/\bINTERNALDATE\s+"([^"]+)"/i);
    const dateValue = headers.date || (internalDate ? internalDate[1] : '');
    const receivedAt = new Date(Date.parse(dateValue) || Date.now()).toISOString();
    messages.push({
      id: uidValidity + ':' + uidMatch[1],
      subject: decodeMimeWords(headers.subject || '(No subject)'),
      from: decodeMimeWords(headers.from || 'Unknown sender'),
      preview: body || '(No message preview)',
      receivedAt
    });
  }
  return messages;
};

const fetchYahooImap = async ({
  email,
  accessToken,
  limit = 100,
  cursor = '',
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  tlsConnect = tls.connect
}) => {
  const socket = await connectTls({ host, port, tlsConnect });
  const session = new ImapSession(socket);
  let tagNumber = 1;
  const nextTag = () => 'A' + String(tagNumber++).padStart(4, '0');
  try {
    await session.readGreeting();
    const capabilities = await session.command(nextTag(), 'CAPABILITY');
    if (!/\bAUTH=OAUTHBEARER\b/i.test(capabilities)) throw new Error('Yahoo IMAP server did not advertise OAUTHBEARER.');
    const payload = buildOauthBearerPayload({ email, accessToken, host, port });
    await session.command(nextTag(), 'AUTHENTICATE OAUTHBEARER ' + payload);
    const selected = await session.command(nextTag(), 'SELECT INBOX');
    const uidValidity = parseUidValidity(selected);
    if (!uidValidity) throw new Error('Yahoo IMAP did not provide UIDVALIDITY for INBOX.');

    const parsedCursor = parseCursor(cursor);
    if (parsedCursor && parsedCursor.uidValidity !== uidValidity) return { messages: [], nextCursor: '' };
    const upperBound = parsedCursor && parsedCursor.beforeUid;
    const search = await session.command(nextTag(), upperBound ? 'UID SEARCH UID 1:' + upperBound : 'UID SEARCH ALL');
    const allUids = parseSearchUids(search);
    const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 100));
    const selectedUids = allUids.slice(-boundedLimit);
    if (!selectedUids.length) return { messages: [], nextCursor: '' };

    const fetch = await session.command(
      nextTag(),
      'UID FETCH ' + selectedUids.join(',') + ' (UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] BODY.PEEK[TEXT]<0.' + MAX_PREVIEW_BYTES + '>)'
    );
    const messages = parseFetchMessages({ response: fetch, uidValidity })
      .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
    const oldestSelected = selectedUids[0];
    const hasOlder = allUids.length > selectedUids.length && oldestSelected > 1;
    return {
      messages,
      nextCursor: hasOlder ? uidValidity + ':' + (oldestSelected - 1) : ''
    };
  } finally {
    try {
      if (!socket.destroyed) await session.command(nextTag(), 'LOGOUT');
    } catch {}
    session.destroy();
  }
};

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  buildOauthBearerPayload,
  parseHeaders,
  parseUidValidity,
  parseSearchUids,
  parseFetchMessages,
  fetchYahooImap
};
