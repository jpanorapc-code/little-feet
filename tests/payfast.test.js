const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  PAYFAST_PROCESS_URL,
  PAYFAST_VALIDATE_URL,
  phpUrlEncode,
  payFastConfig,
  createPayFastCheckout,
  itnParameterString,
  validatePayFastItn
} = require('../lib/payfast');

const env = {
  LF_PAYFAST_MERCHANT_ID: '12345678',
  LF_PAYFAST_MERCHANT_KEY: 'merchant-key',
  LF_PAYFAST_PASSPHRASE: 'server-only-passphrase'
};

const config = payFastConfig(env);
assert.equal(config.configured, true);
assert.equal(PAYFAST_PROCESS_URL, 'https://www.payfast.co.za/eng/process');
assert.equal(PAYFAST_VALIDATE_URL, 'https://www.payfast.co.za/eng/query/validate');

const checkout = createPayFastCheckout({
  reference: 'LF-ABC12345',
  amount: 400,
  itemName: 'Little Feet Micro / ECD',
  publicOrigin: 'https://littlefeet.co.za',
  buyerName: 'School Principal',
  buyerEmail: 'principal@example.org',
  env
});
assert.equal(checkout.provider, 'payfast');
assert.equal(checkout.checkoutUrl, PAYFAST_PROCESS_URL);
assert.equal(checkout.fields.m_payment_id, 'LF-ABC12345');
assert.equal(checkout.fields.amount, '400.00');
assert.equal(checkout.fields.notify_url, 'https://littlefeet.co.za/api/payments/payfast/notify');
assert.match(checkout.fields.signature, /^[0-9a-f]{32}$/);
assert.equal(Object.hasOwn(checkout.fields, 'passphrase'), false);

const body = {
  m_payment_id: 'LF-ABC12345',
  pf_payment_id: '998877',
  payment_status: 'COMPLETE',
  item_name: 'Little Feet Micro / ECD',
  item_description: '',
  amount_gross: '400.00',
  amount_fee: '-8.00',
  amount_net: '392.00',
  custom_str1: 'little-feet',
  custom_str2: '',
  custom_str3: '',
  custom_str4: '',
  custom_str5: '',
  custom_int1: '',
  custom_int2: '',
  custom_int3: '',
  custom_int4: '',
  custom_int5: '',
  name_first: 'School',
  name_last: 'Principal',
  email_address: 'principal@example.org',
  merchant_id: env.LF_PAYFAST_MERCHANT_ID
};
const paramString = itnParameterString(body);
body.signature = crypto.createHash('md5')
  .update(paramString + '&passphrase=' + phpUrlEncode(env.LF_PAYFAST_PASSPHRASE))
  .digest('hex');

const resolver = {
  resolve4: async host => host === 'www.payfast.co.za' ? ['197.97.145.150'] : [],
  resolve6: async () => []
};
let validatedUrl = '';
const fetchImpl = async (url, options) => {
  validatedUrl = url;
  assert.equal(options.method, 'POST');
  assert.match(String(options.body), /m_payment_id=LF-ABC12345/);
  return { ok: true, text: async () => 'VALID' };
};

(async () => {
  const valid = await validatePayFastItn({
    body,
    requestIp: '197.97.145.150',
    expectedAmount: 400,
    env,
    resolver,
    fetchImpl
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.paymentStatus, 'COMPLETE');
  assert.equal(valid.providerTransactionId, '998877');
  assert.equal(validatedUrl, PAYFAST_VALIDATE_URL);

  const badAmount = await validatePayFastItn({
    body,
    requestIp: '197.97.145.150',
    expectedAmount: 401,
    env,
    resolver,
    fetchImpl
  });
  assert.equal(badAmount.ok, false);
  assert.equal(badAmount.reason, 'amount_mismatch');

  const tampered = { ...body, amount_gross: '401.00' };
  const badSignature = await validatePayFastItn({
    body: tampered,
    requestIp: '197.97.145.150',
    expectedAmount: 401,
    env,
    resolver,
    fetchImpl
  });
  assert.equal(badSignature.ok, false);
  assert.equal(badSignature.reason, 'signature_invalid');

  console.log('PayFast production integration tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
