'use strict';

const crypto = require('crypto');

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

const headerValue = (headers, name) => {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const wanted = String(name || '').toLowerCase();
  const key = Object.keys(headers).find(candidate => String(candidate).toLowerCase() === wanted);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
};

const verifyResendWebhook = ({
  rawBody,
  headers,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300
}) => {
  const webhookId = headerValue(headers, 'svix-id') || headerValue(headers, 'webhook-id');
  const timestampText = headerValue(headers, 'svix-timestamp') || headerValue(headers, 'webhook-timestamp');
  const signatureHeader = headerValue(headers, 'svix-signature') || headerValue(headers, 'webhook-signature');
  const cleanSecret = String(secret || '').trim();
  const timestamp = Number(timestampText);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');

  if (!webhookId || !Number.isFinite(timestamp) || !signatureHeader || !cleanSecret.startsWith('whsec_')) {
    throw new Error('Inbound email webhook signature is incomplete.');
  }
  if (Math.abs(Number(nowSeconds) - timestamp) > Math.max(1, Number(toleranceSeconds) || 300)) {
    throw new Error('Inbound email webhook timestamp is outside the allowed window.');
  }

  let key;
  try {
    key = Buffer.from(cleanSecret.slice(6), 'base64');
  } catch {
    throw new Error('Inbound email webhook secret is invalid.');
  }
  if (!key.length) throw new Error('Inbound email webhook secret is invalid.');

  const signed = Buffer.concat([
    Buffer.from(webhookId + '.' + timestampText + '.', 'utf8'),
    body
  ]);
  const expected = crypto.createHmac('sha256', key).update(signed).digest();

  const valid = signatureHeader.split(/\s+/).filter(Boolean).some(entry => {
    const comma = entry.indexOf(',');
    if (comma <= 0 || entry.slice(0, comma) !== 'v1') return false;
    let candidate;
    try { candidate = Buffer.from(entry.slice(comma + 1), 'base64'); } catch { return false; }
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  });
  if (!valid) throw new Error('Inbound email webhook signature is invalid.');

  let event;
  try { event = JSON.parse(body.toString('utf8')); }
  catch { throw new Error('Inbound email webhook payload is invalid JSON.'); }
  return event;
};

const fetchResendReceivedEmail = async ({
  emailId,
  apiKey,
  fetchImpl = global.fetch,
  timeoutMs = 10000
}) => {
  const id = String(emailId || '').trim();
  const key = String(apiKey || '').trim();
  if (!id || !key) throw new Error('Inbound email retrieval is not configured.');

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 10000)) : null;
  timer?.unref?.();
  try {
    const response = await fetchImpl('https://api.resend.com/emails/receiving/' + encodeURIComponent(id), {
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + key },
      signal: controller?.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error('Inbound email provider could not retrieve the received message.');
      error.status = response.status;
      throw error;
    }
    return {
      id: String(data.id || id),
      messageId: cleanText(data.message_id || '', 300),
      to: Array.isArray(data.to) ? data.to.map(value => cleanText(value, 320)).filter(Boolean) : [],
      receivedFor: Array.isArray(data.received_for) ? data.received_for.map(value => cleanText(value, 320)).filter(Boolean) : [],
      from: cleanText(data.from || 'Unknown sender', 300),
      subject: cleanText(data.subject || '(No subject)', 300),
      text: cleanText(data.text || '', 12000),
      htmlText: stripHtml(data.html || ''),
      createdAt: data.created_at && !Number.isNaN(Date.parse(data.created_at))
        ? new Date(data.created_at).toISOString()
        : new Date().toISOString(),
      attachmentCount: Array.isArray(data.attachments) ? data.attachments.length : 0
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

module.exports = {
  cleanText,
  stripHtml,
  verifyResendWebhook,
  fetchResendReceivedEmail
};
