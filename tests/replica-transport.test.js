const assert = require('node:assert/strict');
const { createReplicaTransport, replicaConfiguration, REPLICA_KEY } = require('../lib/operations/replica-transport');

const key = 'test-only-encryption-key-long-enough-123456';
const env = {
  CLOUDFLARE_R2_ACCOUNT_ID: 'account-test',
  LF_BACKUP_R2_BUCKET: 'little-feet-recovery-test',
  LF_BACKUP_R2_ACCESS_KEY_ID: 'access-test',
  LF_BACKUP_R2_SECRET_ACCESS_KEY: 'secret-test',
  LF_BACKUP_ENCRYPTION_KEY: key
};
const state = { users: [{ username: 'admin', pinHash: 'private-value' }], schools: [{ id: 'school-a' }], students: [] };
const objects = new Map();
const store = {
  async put({ key: objectKey, body }) { objects.set(objectKey, Buffer.from(body)); },
  async get({ key: objectKey }) {
    if (!objects.has(objectKey)) { const error = new Error('missing'); error.name = 'NoSuchKey'; throw error; }
    return { body: objects.get(objectKey), etag: 'test-etag' };
  }
};
let clock = new Date('2026-10-03T10:00:00.000Z');
const primary = createReplicaTransport({ env, store, now: () => clock });
const standby = createReplicaTransport({ env, store, now: () => clock });

(async () => {
  assert.equal(replicaConfiguration({}).configured, false);
  assert.ok(replicaConfiguration({}).missing.includes('LF_BACKUP_ENCRYPTION_KEY (at least 32 characters)'));
  assert.equal(primary.configured, true);
  assert.equal(await standby.load(), null, 'a fresh standby must report no replica before the first publication');

  const published = await primary.publish(state, { applicationSha: 'test-sha' });
  assert.equal(published.capturedAt, '2026-10-03T10:00:00.000Z');
  const raw = objects.get(REPLICA_KEY).toString('utf8');
  assert.equal(raw.includes('private-value'), false, 'private application data must not be plaintext in object storage');
  const loaded = await standby.load();
  assert.deepEqual(loaded.state, state);
  assert.equal(loaded.applicationSha, 'test-sha');
  assert.equal(loaded.etag, 'test-etag');

  clock = new Date('2026-10-03T10:01:00.000Z');
  const secondState = { ...state, students: [{ id: 'learner-1', schoolId: 'school-a' }] };
  await primary.publish(secondState, { applicationSha: 'next-sha' });
  assert.deepEqual((await standby.load()).state, secondState, 'a later atomic publication must be visible to a separate standby');

  const wrongKey = createReplicaTransport({ env: { ...env, LF_BACKUP_ENCRYPTION_KEY: `${key}wrong` }, store });
  await assert.rejects(() => wrongKey.load(), /Unsupported state or unable to authenticate data|authenticate|Unsupported state/i);
  await assert.rejects(() => primary.publish({ users: [], schools: 'invalid' }), /invalid application-state/i);

  objects.set(REPLICA_KEY, Buffer.from('{broken'));
  await assert.rejects(() => standby.load());
  console.log('Remote replica transport tests passed: configuration, encrypted cross-instance publish/load, update, invalid state, key mismatch, and corruption.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
