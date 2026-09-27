const assert = require('assert');
const {
  RECOVERY_CONFIRMATION,
  stableJson,
  sha256,
  encryptPayload,
  decryptPayload,
  recoverySchemaName,
  readConfiguration
} = require('../lib/operations/recovery-rehearsal');

const secret = 'test-only-recovery-encryption-key-123456789';
const payload = {
  table: 'little_feet_records',
  rows: [{ record_key: 'one', payload: { z: 2, a: 1 } }, { record_key: 'two', payload: ['safe'] }]
};
const encrypted = encryptPayload(payload, secret);
assert.notEqual(encrypted.includes(Buffer.from('record_key')), true, 'Encrypted backup must not reveal row content');
assert.deepEqual(decryptPayload(encrypted, secret), payload);
assert.throws(() => decryptPayload(encrypted, `${secret}-wrong`));
assert.equal(stableJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
assert.equal(sha256('same'), sha256('same'));
assert.match(recoverySchemaName('example'), /^lf_recovery_[a-f0-9]{16}$/);

const base = {
  DATABASE_URL: 'postgres://example.invalid/database',
  CLOUDFLARE_R2_ACCOUNT_ID: 'account',
  CLOUDFLARE_R2_ACCESS_KEY_ID: 'access',
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
  CLOUDFLARE_R2_BUCKET: 'little-feet-live',
  LF_BACKUP_R2_BUCKET: 'little-feet-recovery',
  LF_BACKUP_ENCRYPTION_KEY: secret,
  LF_RECOVERY_CONFIRM: RECOVERY_CONFIRMATION
};
const config = readConfiguration(base);
assert.equal(config.sourceBucket, 'little-feet-live');
assert.equal(config.backupBucket, 'little-feet-recovery');
assert.throws(() => readConfiguration({ ...base, LF_BACKUP_R2_BUCKET: base.CLOUDFLARE_R2_BUCKET }), /separate/);
assert.throws(() => readConfiguration({ ...base, LF_RECOVERY_CONFIRM: '' }), /one-off rehearsal/);
assert.throws(() => readConfiguration({ ...base, LF_BACKUP_ENCRYPTION_KEY: 'short' }), /32 characters/);

console.log('Recovery rehearsal safeguards passed.');
