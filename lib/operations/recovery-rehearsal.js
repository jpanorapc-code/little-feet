const crypto = require('crypto');

const RECOVERY_CONFIRMATION = 'PRODUCTION-ISOLATED-RESTORE';
const TABLES = Object.freeze([
  {
    name: 'little_feet_app_state',
    orderBy: 'state_key',
    createSql: `CREATE TABLE little_feet_app_state (
      state_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`
  },
  {
    name: 'little_feet_records',
    orderBy: 'collection, record_key',
    createSql: `CREATE TABLE little_feet_records (
      collection TEXT NOT NULL,
      record_key TEXT NOT NULL,
      school_id TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (collection, record_key)
    )`
  },
  {
    name: 'little_feet_metadata',
    orderBy: 'state_key',
    createSql: `CREATE TABLE little_feet_metadata (
      state_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    )`
  },
  {
    name: 'little_feet_sessions',
    orderBy: 'sid',
    createSql: `CREATE TABLE little_feet_sessions (
      sid TEXT PRIMARY KEY,
      sess JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )`
  }
]);

const stableJson = value => JSON.stringify(value, (_key, candidate) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return candidate;
  return Object.fromEntries(Object.entries(candidate).sort(([first], [second]) => first.localeCompare(second)));
});

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

const encryptPayload = (value, secret) => {
  const key = crypto.createHash('sha256').update(String(secret)).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(stableJson(value));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.from(JSON.stringify({
    format: 'little-feet-recovery-v1',
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    plaintextSha256: sha256(plaintext)
  }));
};

const decryptPayload = (envelopeBytes, secret) => {
  const envelope = JSON.parse(Buffer.from(envelopeBytes).toString('utf8'));
  if (envelope.format !== 'little-feet-recovery-v1' || envelope.cipher !== 'aes-256-gcm') {
    throw new Error('Unsupported recovery payload format.');
  }
  const key = crypto.createHash('sha256').update(String(secret)).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final()
  ]);
  if (sha256(plaintext) !== envelope.plaintextSha256) throw new Error('Recovery payload integrity check failed.');
  return JSON.parse(plaintext.toString('utf8'));
};

const recoverySchemaName = id => `lf_recovery_${sha256(id).slice(0, 16)}`;

const readConfiguration = (env = process.env) => {
  const required = [
    'DATABASE_URL',
    'CLOUDFLARE_R2_ACCOUNT_ID',
    'CLOUDFLARE_R2_ACCESS_KEY_ID',
    'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    'CLOUDFLARE_R2_BUCKET',
    'LF_BACKUP_R2_BUCKET',
    'LF_BACKUP_ENCRYPTION_KEY'
  ];
  const missing = required.filter(name => !String(env[name] || '').trim());
  if (missing.length) throw new Error(`Missing recovery configuration: ${missing.join(', ')}`);
  if (env.LF_RECOVERY_CONFIRM !== RECOVERY_CONFIRMATION) {
    throw new Error(`Set LF_RECOVERY_CONFIRM=${RECOVERY_CONFIRMATION} for this one-off rehearsal.`);
  }
  if (env.CLOUDFLARE_R2_BUCKET.trim() === env.LF_BACKUP_R2_BUCKET.trim()) {
    throw new Error('The recovery bucket must be separate from the live application bucket.');
  }
  if (String(env.LF_BACKUP_ENCRYPTION_KEY).length < 32) {
    throw new Error('LF_BACKUP_ENCRYPTION_KEY must contain at least 32 characters.');
  }
  return {
    databaseUrl: env.DATABASE_URL,
    accountId: env.CLOUDFLARE_R2_ACCOUNT_ID.trim(),
    accessKeyId: String(env.LF_BACKUP_R2_ACCESS_KEY_ID || env.CLOUDFLARE_R2_ACCESS_KEY_ID).trim(),
    secretAccessKey: String(env.LF_BACKUP_R2_SECRET_ACCESS_KEY || env.CLOUDFLARE_R2_SECRET_ACCESS_KEY).trim(),
    sourceBucket: env.CLOUDFLARE_R2_BUCKET.trim(),
    backupBucket: env.LF_BACKUP_R2_BUCKET.trim(),
    encryptionKey: env.LF_BACKUP_ENCRYPTION_KEY,
    maximumBytes: Math.max(1024 * 1024, Math.min(1024 * 1024 * 1024, Number(env.LF_BACKUP_MAX_BYTES) || 256 * 1024 * 1024)),
    applicationSha: String(env.RENDER_GIT_COMMIT || env.GITHUB_SHA || 'unrecorded').trim()
  };
};

module.exports = {
  RECOVERY_CONFIRMATION,
  TABLES,
  stableJson,
  sha256,
  encryptPayload,
  decryptPayload,
  recoverySchemaName,
  readConfiguration
};
