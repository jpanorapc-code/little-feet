'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  stripHtml,
  verifyResendWebhook,
  fetchResendReceivedEmail
} = require('../lib/mailbox-integration');

(async () => {
  assert.match(stripHtml('<p>Hello <b>forwarded</b> email</p>'), /Hello\s+forwarded\s+email/);

  const secretBytes = Buffer.from('little-feet-inbound-webhook-test-key');
  const secret = 'whsec_' + secretBytes.toString('base64');
  const timestamp = 1780236000;
  const webhookId = 'msg_test_inbound_1';
  const payload = JSON.stringify({
    type: 'email.received',
    data: {
      email_id: '550e8400-e29b-41d4-a716-446655440000',
      to: ['lf-0123456789abcdef01234567@inbox.example.test']
    }
  });
  const signature = crypto
    .createHmac('sha256', secretBytes)
    .update(webhookId + '.' + timestamp + '.' + payload)
    .digest('base64');

  const event = verifyResendWebhook({
    rawBody: Buffer.from(payload),
    headers: {
      'svix-id': webhookId,
      'svix-timestamp': String(timestamp),
      'svix-signature': 'v1,' + signature
    },
    secret,
    nowSeconds: timestamp
  });
  assert.equal(event.type, 'email.received');
  assert.equal(event.data.email_id, '550e8400-e29b-41d4-a716-446655440000');

  assert.throws(() => verifyResendWebhook({
    rawBody: Buffer.from(payload),
    headers: {
      'svix-id': webhookId,
      'svix-timestamp': String(timestamp),
      'svix-signature': 'v1,invalid'
    },
    secret,
    nowSeconds: timestamp
  }), /signature is invalid/);

  assert.throws(() => verifyResendWebhook({
    rawBody: Buffer.from(payload),
    headers: {
      'svix-id': webhookId,
      'svix-timestamp': String(timestamp - 1000),
      'svix-signature': 'v1,' + signature
    },
    secret,
    nowSeconds: timestamp
  }), /timestamp is outside/);

  const received = await fetchResendReceivedEmail({
    emailId: '550e8400-e29b-41d4-a716-446655440000',
    apiKey: 're_test_key',
    fetchImpl: async (url, options = {}) => {
      assert.equal(String(url), 'https://api.resend.com/emails/receiving/550e8400-e29b-41d4-a716-446655440000');
      assert.equal(options.headers.Authorization, 'Bearer re_test_key');
      return {
        ok: true,
        json: async () => ({
          id: '550e8400-e29b-41d4-a716-446655440000',
          message_id: '<forwarded-1@example.com>',
          to: ['lf-0123456789abcdef01234567@inbox.example.test'],
          received_for: ['lf-0123456789abcdef01234567@inbox.example.test'],
          from: 'Sender <sender@example.com>',
          subject: 'Forwarded test',
          text: 'Hello from the real inbound API shape.',
          html: '<p>Hello from HTML.</p>',
          created_at: '2026-09-30T14:00:00.000Z',
          attachments: [{ id: 'att-1', filename: 'note.pdf', content_type: 'application/pdf' }]
        })
      };
    }
  });

  assert.equal(received.subject, 'Forwarded test');
  assert.equal(received.from, 'Sender <sender@example.com>');
  assert.equal(received.text, 'Hello from the real inbound API shape.');
  assert.equal(received.attachmentCount, 1);
  assert.deepEqual(received.to, ['lf-0123456789abcdef01234567@inbox.example.test']);

  console.log('Inbound email forwarding regression test passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
