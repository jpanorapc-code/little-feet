const { encryptPayload, decryptPayload } = require('./recovery-rehearsal');

const REPLICA_KEY = 'standby/latest.snapshot.enc';
const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;

function replicaConfiguration(env = process.env) {
  const accountId = String(env.CLOUDFLARE_R2_ACCOUNT_ID || '').trim();
  const bucket = String(env.LF_BACKUP_R2_BUCKET || '').trim();
  const accessKeyId = String(env.LF_BACKUP_R2_ACCESS_KEY_ID || env.CLOUDFLARE_R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.LF_BACKUP_R2_SECRET_ACCESS_KEY || env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '').trim();
  const encryptionKey = String(env.LF_BACKUP_ENCRYPTION_KEY || '');
  const missing = [];
  if (!accountId) missing.push('CLOUDFLARE_R2_ACCOUNT_ID');
  if (!bucket) missing.push('LF_BACKUP_R2_BUCKET');
  if (!accessKeyId) missing.push('LF_BACKUP_R2_ACCESS_KEY_ID or CLOUDFLARE_R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('LF_BACKUP_R2_SECRET_ACCESS_KEY or CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  if (encryptionKey.length < 32) missing.push('LF_BACKUP_ENCRYPTION_KEY (at least 32 characters)');
  return { configured: missing.length === 0, missing, accountId, bucket, accessKeyId, secretAccessKey, encryptionKey };
}

function validSnapshot(snapshot) {
  return Boolean(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    && Array.isArray(snapshot.users) && Array.isArray(snapshot.schools));
}

function createReplicaTransport({ env = process.env, store, now = () => new Date() } = {}) {
  const config = replicaConfiguration(env);
  let objectStore = store;
  if (config.configured && !objectStore) {
    const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    });
    objectStore = {
      put: ({ key, body }) => client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: 'application/octet-stream' })),
      async get({ key }) {
        const value = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        if (Number(value.ContentLength || 0) > MAX_SNAPSHOT_BYTES) {
          value.Body?.destroy?.();
          throw new Error('Remote replica snapshot exceeds the 256 MiB safety limit.');
        }
        return { body: Buffer.from(await value.Body.transformToByteArray()), etag: value.ETag, lastModified: value.LastModified };
      }
    };
  }

  return {
    configured: config.configured,
    missing: config.missing,
    key: REPLICA_KEY,
    async publish(state, { applicationSha = 'unrecorded' } = {}) {
      if (!config.configured || !objectStore) throw new Error(`Remote replica transport is not configured: ${config.missing.join(', ')}`);
      if (!validSnapshot(state)) throw new Error('Refusing to publish an invalid application-state snapshot.');
      const capturedAt = now().toISOString();
      const envelope = encryptPayload({
        format: 'little-feet-remote-replica-v1',
        capturedAt,
        applicationSha: String(applicationSha).slice(0, 80),
        state
      }, config.encryptionKey);
      if (envelope.length > MAX_SNAPSHOT_BYTES) throw new Error('Remote replica snapshot exceeds the 256 MiB safety limit.');
      await objectStore.put({ key: REPLICA_KEY, body: envelope });
      return { capturedAt, bytes: envelope.length };
    },
    async load() {
      if (!config.configured || !objectStore) return null;
      let object;
      try { object = await objectStore.get({ key: REPLICA_KEY }); }
      catch (error) {
        if (['NoSuchKey', 'NotFound', 'NoSuchObject', '404'].includes(error?.name) || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
      const body = Buffer.from(object?.body || []);
      if (!body.length || body.length > MAX_SNAPSHOT_BYTES) throw new Error('Remote replica snapshot is empty or exceeds the 256 MiB safety limit.');
      const payload = decryptPayload(body, config.encryptionKey);
      if (payload?.format !== 'little-feet-remote-replica-v1' || !Number.isFinite(Date.parse(payload.capturedAt)) || !validSnapshot(payload.state)) {
        throw new Error('Remote replica snapshot failed format or state validation.');
      }
      return {
        state: payload.state,
        capturedAt: new Date(payload.capturedAt).toISOString(),
        applicationSha: String(payload.applicationSha || 'unrecorded'),
        etag: String(object?.etag || '')
      };
    }
  };
}

module.exports = { REPLICA_KEY, MAX_SNAPSHOT_BYTES, replicaConfiguration, validSnapshot, createReplicaTransport };
