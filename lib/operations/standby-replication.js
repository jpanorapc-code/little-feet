const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { encryptPayload, decryptPayload, sha256 } = require('./recovery-rehearsal');

const SNAPSHOT_FORMAT = 'little-feet-standby-snapshot-v1';
const MANIFEST_FORMAT = 'little-feet-standby-manifest-v1';

const clampInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
};

const cleanPrefix = value => String(value || 'standby')
  .trim()
  .replace(/^\/+|\/+$/g, '')
  .replace(/[^a-zA-Z0-9/_-]+/g, '-')
  .replace(/\/{2,}/g, '/')
  .slice(0, 120) || 'standby';

function readStandbyReplicationConfiguration(env = process.env) {
  const enabled = String(env.LF_STANDBY_SYNC_ENABLED || '').trim() === '1';
  if (!enabled) return { enabled: false, configured: false };

  const accountId = String(env.CLOUDFLARE_R2_ACCOUNT_ID || '').trim();
  const accessKeyId = String(env.LF_BACKUP_R2_ACCESS_KEY_ID || env.CLOUDFLARE_R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.LF_BACKUP_R2_SECRET_ACCESS_KEY || env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = String(env.LF_BACKUP_R2_BUCKET || '').trim();
  const encryptionKey = String(env.LF_BACKUP_ENCRYPTION_KEY || '');
  const missing = [];
  if (!accountId) missing.push('CLOUDFLARE_R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('LF_BACKUP_R2_ACCESS_KEY_ID or CLOUDFLARE_R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('LF_BACKUP_R2_SECRET_ACCESS_KEY or CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  if (!bucket) missing.push('LF_BACKUP_R2_BUCKET');
  if (!encryptionKey) missing.push('LF_BACKUP_ENCRYPTION_KEY');
  if (missing.length) throw new Error(`Missing standby replication configuration: ${missing.join(', ')}`);
  if (encryptionKey.length < 32) throw new Error('LF_BACKUP_ENCRYPTION_KEY must contain at least 32 characters.');

  return {
    enabled: true,
    configured: true,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    encryptionKey,
    prefix: cleanPrefix(env.LF_STANDBY_R2_PREFIX || 'standby'),
    publishIntervalMs: clampInteger(env.LF_STANDBY_PUBLISH_INTERVAL_MS, 30000, 5000, 300000),
    pollIntervalMs: clampInteger(env.LF_STANDBY_POLL_INTERVAL_MS, 5000, 2000, 60000),
    maxAgeMs: clampInteger(env.LF_STANDBY_MAX_AGE_MS, 180000, 30000, 3600000),
    maximumBytes: clampInteger(env.LF_STANDBY_SNAPSHOT_MAX_BYTES, 64 * 1024 * 1024, 1024 * 1024, 512 * 1024 * 1024),
    retention: clampInteger(env.LF_STANDBY_SNAPSHOT_RETENTION, 120, 5, 500),
    applicationSha: String(env.RENDER_GIT_COMMIT || env.GITHUB_SHA || 'unrecorded').trim()
  };
}

const bodyBuffer = async body => {
  if (Buffer.isBuffer(body)) return body;
  if (body?.transformToByteArray) return Buffer.from(await body.transformToByteArray());
  if (body?.arrayBuffer) return Buffer.from(await body.arrayBuffer());
  throw new Error('Unsupported standby snapshot response body.');
};

function createStandbyReplication({ env = process.env, client: providedClient = null } = {}) {
  const config = readStandbyReplicationConfiguration(env);
  if (!config.enabled) {
    return {
      enabled: false,
      configured: false,
      config,
      async publish() { return null; },
      async fetchLatest() { return null; },
      async prune() { return 0; },
      close() {}
    };
  }

  const client = providedClient || new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  });
  const latestKey = `${config.prefix}/latest.json`;
  const snapshotsPrefix = `${config.prefix}/snapshots/`;

  const put = (key, body, contentType, metadata = {}) => client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata
  }));

  const get = async key => {
    const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    return bodyBuffer(result.Body);
  };

  const prune = async () => {
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: snapshotsPrefix,
      MaxKeys: 1000
    }));
    const objects = (listed.Contents || [])
      .filter(item => item.Key)
      .sort((first, second) => new Date(second.LastModified || 0) - new Date(first.LastModified || 0));
    const expired = objects.slice(config.retention);
    for (const item of expired) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: item.Key }));
    }
    return expired.length;
  };

  const publish = async ({ state, capturedAt = new Date().toISOString(), applicationSha = config.applicationSha } = {}) => {
    if (!state || typeof state !== 'object') throw new Error('A complete application state is required for standby replication.');
    const snapshot = {
      format: SNAPSHOT_FORMAT,
      capturedAt,
      applicationSha,
      state
    };
    const encrypted = encryptPayload(snapshot, config.encryptionKey);
    if (encrypted.length > config.maximumBytes) {
      throw new Error(`Standby snapshot exceeds LF_STANDBY_SNAPSHOT_MAX_BYTES (${encrypted.length} bytes).`);
    }
    const ciphertextSha256 = sha256(encrypted);
    const timestampKey = String(capturedAt).replace(/[^0-9TZ]/g, '');
    const objectKey = `${snapshotsPrefix}${timestampKey}-${ciphertextSha256.slice(0, 16)}.json.enc`;
    await put(objectKey, encrypted, 'application/octet-stream', {
      format: SNAPSHOT_FORMAT,
      capturedat: capturedAt,
      applicationsha: applicationSha.slice(0, 120)
    });
    const manifest = {
      format: MANIFEST_FORMAT,
      capturedAt,
      applicationSha,
      objectKey,
      ciphertextSha256,
      bytes: encrypted.length
    };
    await put(latestKey, Buffer.from(JSON.stringify(manifest)), 'application/json', {
      format: MANIFEST_FORMAT,
      capturedat: capturedAt
    });
    return manifest;
  };

  const fetchLatest = async () => {
    const manifestBytes = await get(latestKey);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest?.format !== MANIFEST_FORMAT || !manifest.objectKey || !manifest.ciphertextSha256 || !manifest.capturedAt) {
      throw new Error('Standby snapshot manifest is invalid.');
    }
    const encrypted = await get(manifest.objectKey);
    if (sha256(encrypted) !== manifest.ciphertextSha256) throw new Error('Standby snapshot ciphertext integrity check failed.');
    const snapshot = decryptPayload(encrypted, config.encryptionKey);
    if (snapshot?.format !== SNAPSHOT_FORMAT || !snapshot.state || snapshot.capturedAt !== manifest.capturedAt) {
      throw new Error('Standby snapshot payload is invalid.');
    }
    const capturedMs = Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(capturedMs)) throw new Error('Standby snapshot capturedAt is invalid.');
    const ageMs = Math.max(0, Date.now() - capturedMs);
    return {
      state: snapshot.state,
      capturedAt: snapshot.capturedAt,
      applicationSha: snapshot.applicationSha || manifest.applicationSha || '',
      objectKey: manifest.objectKey,
      ciphertextSha256: manifest.ciphertextSha256,
      bytes: Number(manifest.bytes || encrypted.length),
      ageMs,
      stale: ageMs > config.maxAgeMs
    };
  };

  return {
    enabled: true,
    configured: true,
    config,
    latestKey,
    snapshotsPrefix,
    publish,
    fetchLatest,
    prune,
    close() { if (!providedClient) client.destroy(); }
  };
}

module.exports = {
  SNAPSHOT_FORMAT,
  MANIFEST_FORMAT,
  readStandbyReplicationConfiguration,
  createStandbyReplication
};
