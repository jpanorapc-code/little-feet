const assert = require('node:assert/strict');
const {
  SNAPSHOT_FORMAT,
  MANIFEST_FORMAT,
  readStandbyReplicationConfiguration,
  createStandbyReplication
} = require('../lib/operations/standby-replication');

class FakeR2Client {
  constructor() {
    this.objects = new Map();
    this.tick = 0;
  }

  async send(command) {
    const name = command.constructor.name;
    const input = command.input;
    if (name === 'PutObjectCommand') {
      this.tick += 1;
      const body = Buffer.isBuffer(input.Body) ? Buffer.from(input.Body) : Buffer.from(String(input.Body || ''));
      this.objects.set(input.Key, {
        body,
        contentType: input.ContentType || '',
        metadata: input.Metadata || {},
        lastModified: new Date(1700000000000 + this.tick * 1000)
      });
      return { ETag: '"fake-etag"' };
    }
    if (name === 'GetObjectCommand') {
      const found = this.objects.get(input.Key);
      if (!found) throw new Error(`Missing fake object ${input.Key}`);
      return {
        ContentType: found.contentType,
        Body: { transformToByteArray: async () => Uint8Array.from(found.body) }
      };
    }
    if (name === 'ListObjectsV2Command') {
      const contents = [...this.objects.entries()]
        .filter(([key]) => key.startsWith(input.Prefix || ''))
        .map(([Key, value]) => ({ Key, LastModified: value.lastModified, Size: value.body.length }))
        .slice(0, input.MaxKeys || 1000);
      return { Contents: contents };
    }
    if (name === 'DeleteObjectCommand') {
      this.objects.delete(input.Key);
      return {};
    }
    throw new Error(`Unsupported fake command ${name}`);
  }
}

const secret = 'standby-replication-test-secret-key-1234567890';
const baseEnv = {
  LF_STANDBY_SYNC_ENABLED: '1',
  CLOUDFLARE_R2_ACCOUNT_ID: 'account',
  LF_BACKUP_R2_ACCESS_KEY_ID: 'access',
  LF_BACKUP_R2_SECRET_ACCESS_KEY: 'secret',
  LF_BACKUP_R2_BUCKET: 'little-feet-backup',
  LF_BACKUP_ENCRYPTION_KEY: secret,
  LF_STANDBY_R2_PREFIX: 'standby/test',
  LF_STANDBY_MAX_AGE_MS: '30000',
  LF_STANDBY_SNAPSHOT_RETENTION: '5',
  RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567'
};

assert.deepEqual(readStandbyReplicationConfiguration({}), { enabled: false, configured: false });
assert.throws(
  () => readStandbyReplicationConfiguration({ LF_STANDBY_SYNC_ENABLED: '1' }),
  /Missing standby replication configuration/
);
assert.throws(
  () => readStandbyReplicationConfiguration({ ...baseEnv, LF_BACKUP_ENCRYPTION_KEY: 'short' }),
  /32 characters/
);

(async () => {
  const fake = new FakeR2Client();
  const transport = createStandbyReplication({ env: baseEnv, client: fake });
  assert.equal(transport.enabled, true);
  assert.equal(transport.configured, true);

  const state = {
    users: [{ username: 'admin', role: 'admin' }],
    schools: [{ id: 'school-one', name: 'School One' }],
    registry: [],
    replicatedAt: new Date().toISOString()
  };
  const published = await transport.publish({
    state,
    capturedAt: state.replicatedAt,
    applicationSha: baseEnv.RENDER_GIT_COMMIT
  });
  assert.equal(published.format, MANIFEST_FORMAT);
  assert.match(published.objectKey, /^standby\/test\/snapshots\//);
  assert.ok(fake.objects.has('standby/test/latest.json'));

  const encryptedBody = fake.objects.get(published.objectKey).body.toString('utf8');
  assert.equal(encryptedBody.includes('"username":"admin"'), false, 'R2 standby payload must remain encrypted');

  const restored = await transport.fetchLatest();
  assert.deepEqual(restored.state, state);
  assert.equal(restored.applicationSha, baseEnv.RENDER_GIT_COMMIT);
  assert.equal(restored.stale, false);

  for (let index = 1; index <= 6; index += 1) {
    const capturedAt = new Date(Date.now() + index * 1000).toISOString();
    await transport.publish({
      state: { ...state, marker: index, replicatedAt: capturedAt },
      capturedAt,
      applicationSha: baseEnv.RENDER_GIT_COMMIT
    });
  }
  const removed = await transport.prune();
  assert.equal(removed, 2);
  const remainingSnapshots = [...fake.objects.keys()].filter(key => key.startsWith('standby/test/snapshots/'));
  assert.equal(remainingSnapshots.length, 5);

  const staleCapturedAt = new Date(Date.now() - 60000).toISOString();
  const staleManifest = await transport.publish({
    state: { ...state, replicatedAt: staleCapturedAt },
    capturedAt: staleCapturedAt,
    applicationSha: baseEnv.RENDER_GIT_COMMIT
  });
  const stale = await transport.fetchLatest();
  assert.equal(stale.stale, true);

  const damaged = fake.objects.get(staleManifest.objectKey);
  damaged.body = Buffer.concat([damaged.body, Buffer.from('tamper')]);
  await assert.rejects(() => transport.fetchLatest(), /integrity check failed/);

  assert.equal(SNAPSHOT_FORMAT, 'little-feet-standby-snapshot-v1');
  transport.close();
  console.log('Standby replication safeguards passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
