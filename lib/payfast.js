'use strict';

const crypto = require('crypto');
const dns = require('node:dns').promises;

const PAYFAST_PROCESS_URL = 'https://www.payfast.co.za/eng/process';
const PAYFAST_VALIDATE_URL = 'https://www.payfast.co.za/eng/query/validate';
const PAYFAST_HOSTS = Object.freeze(['www.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za']);

const PAYMENT_FIELD_ORDER = Object.freeze([
  'merchant_id', 'merchant_key', 'return_url', 'cancel_url', 'notify_url', 'notify_method',
  'name_first', 'name_last', 'email_address', 'cell_number',
  'm_payment_id', 'amount', 'item_name', 'item_description',
  'custom_int1', 'custom_int2', 'custom_int3', 'custom_int4', 'custom_int5',
  'custom_str1', 'custom_str2', 'custom_str3', 'custom_str4', 'custom_str5',
  'email_confirmation', 'confirmation_address', 'currency', 'payment_method',
  'subscription_type', 'billing_date', 'recurring_amount', 'frequency', 'cycles',
  'subscription_notify_email', 'subscription_notify_webhook', 'subscription_notify_buyer'
]);

const phpUrlEncode = value => encodeURIComponent(String(value ?? '').trim())
  .replace(/%20/g, '+')
  .replace(/[!'()*~]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%[0-9a-f]{2}/gi, match => match.toUpperCase());

const cleanConfiguredValue = value => String(value || '').trim();

const payFastConfig = (env = process.env) => {
  const merchantId = cleanConfiguredValue(env.LF_PAYFAST_MERCHANT_ID);
  const merchantKey = cleanConfiguredValue(env.LF_PAYFAST_MERCHANT_KEY);
  const passphrase = cleanConfiguredValue(env.LF_PAYFAST_PASSPHRASE);
  return {
    merchantId,
    merchantKey,
    passphrase,
    configured: Boolean(merchantId && merchantKey && passphrase)
  };
};

const signatureParameterString = (data, passphrase, fieldOrder = PAYMENT_FIELD_ORDER) => {
  const fields = [];
  for (const key of fieldOrder) {
    const value = data?.[key];
    if (value === undefined || value === null || String(value).trim() === '') continue;
    fields.push(`${key}=${phpUrlEncode(value)}`);
  }
  if (passphrase) fields.push(`passphrase=${phpUrlEncode(passphrase)}`);
  return fields.join('&');
};

const generatePaymentSignature = (data, passphrase) =>
  crypto.createHash('md5').update(signatureParameterString(data, passphrase)).digest('hex');

const createPayFastCheckout = ({ reference, amount, itemName, publicOrigin, buyerName = '', buyerEmail = '', env = process.env }) => {
  const config = payFastConfig(env);
  if (!config.configured) return null;
  const numericAmount = Number(amount);
  if (!reference || !Number.isFinite(numericAmount) || numericAmount <= 0) throw new Error('A valid payment reference and amount are required.');
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:') throw new Error('PayFast requires a public HTTPS origin.');

  const nameParts = String(buyerName || '').trim().split(/\s+/).filter(Boolean);
  const fields = {
    merchant_id: config.merchantId,
    merchant_key: config.merchantKey,
    return_url: `${origin.origin}/?payment=success&reference=${encodeURIComponent(reference)}`,
    cancel_url: `${origin.origin}/?payment=cancelled&reference=${encodeURIComponent(reference)}`,
    notify_url: `${origin.origin}/api/payments/payfast/notify`,
    name_first: nameParts[0] || '',
    name_last: nameParts.slice(1).join(' '),
    email_address: String(buyerEmail || '').trim(),
    m_payment_id: String(reference).slice(0, 100),
    amount: numericAmount.toFixed(2),
    item_name: String(itemName || 'Little Feet subscription').trim().slice(0, 100),
    custom_str1: 'little-feet'
  };
  fields.signature = generatePaymentSignature(fields, config.passphrase);
  return {
    provider: 'payfast',
    method: 'PayFast',
    checkoutUrl: PAYFAST_PROCESS_URL,
    fields
  };
};

const itnParameterString = body => Object.entries(body || {})
  .filter(([key, value]) => key !== 'signature' && value !== undefined && value !== null && String(value).trim() !== '')
  .map(([key, value]) => `${key}=${phpUrlEncode(value)}`)
  .join('&');

const timingSafeHexEqual = (left, right) => {
  const a = String(left || '').trim().toLowerCase();
  const b = String(right || '').trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(a) || !/^[0-9a-f]{32}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
};

const verifyItnSignature = (body, passphrase) => {
  const paramString = itnParameterString(body);
  const salted = passphrase ? `${paramString}&passphrase=${phpUrlEncode(passphrase)}` : paramString;
  const expected = crypto.createHash('md5').update(salted).digest('hex');
  return timingSafeHexEqual(body?.signature, expected);
};

const normalizeIp = value => String(value || '').trim().replace(/^::ffff:/, '').split('%')[0];

const resolvePayFastAddresses = async (resolver = dns) => {
  const resolved = new Set();
  await Promise.all(PAYFAST_HOSTS.map(async host => {
    const [v4, v6] = await Promise.all([
      resolver.resolve4(host).catch(() => []),
      resolver.resolve6(host).catch(() => [])
    ]);
    [...v4, ...v6].map(normalizeIp).filter(Boolean).forEach(ip => resolved.add(ip));
  }));
  return resolved;
};

const verifyPayFastSource = async (requestIp, resolver = dns) => {
  const candidate = normalizeIp(requestIp);
  if (!candidate) return false;
  const addresses = await resolvePayFastAddresses(resolver);
  return addresses.has(candidate);
};

const validatePayFastServerConfirmation = async (body, fetchImpl = fetch) => {
  const payload = new URLSearchParams();
  Object.entries(body || {}).forEach(([key, value]) => {
    if (key === 'signature' || value === undefined || value === null) return;
    payload.append(key, String(value));
  });
  const response = await fetchImpl(PAYFAST_VALIDATE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'LittleFeetPayFast/1.0'
    },
    body: payload.toString(),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) return false;
  return (await response.text()).trim().startsWith('VALID');
};

const validatePayFastItn = async ({ body, requestIp, expectedAmount, env = process.env, fetchImpl = fetch, resolver = dns }) => {
  const config = payFastConfig(env);
  if (!config.configured) return { ok: false, reason: 'not_configured' };
  if (String(body?.merchant_id || '').trim() !== config.merchantId) return { ok: false, reason: 'merchant_mismatch' };
  if (!verifyItnSignature(body, config.passphrase)) return { ok: false, reason: 'signature_invalid' };
  if (!await verifyPayFastSource(requestIp, resolver)) return { ok: false, reason: 'source_invalid' };

  const amount = Number(body?.amount_gross);
  const expected = Number(expectedAmount);
  if (!Number.isFinite(amount) || !Number.isFinite(expected) || Math.abs(amount - expected) > 0.01) {
    return { ok: false, reason: 'amount_mismatch' };
  }
  if (!await validatePayFastServerConfirmation(body, fetchImpl)) return { ok: false, reason: 'server_confirmation_failed' };
  return {
    ok: true,
    paymentStatus: String(body?.payment_status || '').trim().toUpperCase(),
    providerTransactionId: String(body?.pf_payment_id || '').trim(),
    reference: String(body?.m_payment_id || '').trim(),
    amount
  };
};

module.exports = {
  PAYFAST_PROCESS_URL,
  PAYFAST_VALIDATE_URL,
  PAYMENT_FIELD_ORDER,
  phpUrlEncode,
  payFastConfig,
  signatureParameterString,
  generatePaymentSignature,
  createPayFastCheckout,
  itnParameterString,
  verifyItnSignature,
  verifyPayFastSource,
  validatePayFastServerConfirmation,
  validatePayFastItn
};
