const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const requiredR2Variables = Object.freeze([
  'CLOUDFLARE_R2_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET'
]);

const cleanSegment = value => String(value || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'record';
const tenantSegment = schoolId => crypto.createHash('sha256').update(String(schoolId || '')).digest('hex').slice(0, 32);
const objectKeyFor = ({ schoolId, entityType, recordId, extension }) =>
  `schools/${tenantSegment(schoolId)}/${cleanSegment(entityType)}/${cleanSegment(recordId)}/${crypto.randomUUID()}.${cleanSegment(extension)}`;

const createLocalAdapter = root => ({
  kind: 'local',
  configured: true,
  async put({ key, body }) {
    const file = path.join(root, ...String(key).split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body, { flag: 'wx' });
    return { etag: crypto.createHash('sha256').update(body).digest('hex') };
  },
  async get({ key }) {
    return { body: await fs.readFile(path.join(root, ...String(key).split('/'))) };
  },
  async head({ key }) {
    const stat = await fs.stat(path.join(root, ...String(key).split('/')));
    return { size: stat.size };
  },
  async delete({ key }) {
    try { await fs.unlink(path.join(root, ...String(key).split('/'))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
});

const createR2Adapter = config => {
  // Loaded only when all production R2 settings exist. This keeps local and
  // replica operation independent from Cloudflare credentials.
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
  });
  return {
    kind: 'cloudflare-r2',
    configured: true,
    async put({ key, body, contentType, metadata }) {
      const result = await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata }));
      return { etag: String(result.ETag || '').replace(/^"|"$/g, '') };
    },
    async get({ key }) {
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      return { body: Buffer.from(await result.Body.transformToByteArray()), contentType: result.ContentType, etag: result.ETag };
    },
    async head({ key }) {
      const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      return { size: Number(result.ContentLength || 0), contentType: result.ContentType, etag: result.ETag };
    },
    async delete({ key }) { await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })); }
  };
};

function createObjectStorage({ env = process.env, rootDir = __dirname } = {}) {
  const missing = requiredR2Variables.filter(name => !String(env[name] || '').trim());
  if (!missing.length) {
    return createR2Adapter({
      accountId: env.CLOUDFLARE_R2_ACCOUNT_ID.trim(),
      accessKeyId: env.CLOUDFLARE_R2_ACCESS_KEY_ID.trim(),
      secretAccessKey: env.CLOUDFLARE_R2_SECRET_ACCESS_KEY.trim(),
      bucket: env.CLOUDFLARE_R2_BUCKET.trim()
    });
  }
  if (env.NODE_ENV !== 'production' && env.LF_REPLICA_MODE !== '1') {
    return createLocalAdapter(path.resolve(env.LF_LOCAL_OBJECT_STORAGE_DIR || path.join(rootDir, 'tmp', 'object-storage')));
  }
  return {
    kind: 'unconfigured', configured: false, missing,
    async put() { throw new Error('Cloudflare R2 storage is not configured.'); },
    async get() { throw new Error('Cloudflare R2 storage is not configured.'); },
    async head() { throw new Error('Cloudflare R2 storage is not configured.'); },
    async delete() { throw new Error('Cloudflare R2 storage is not configured.'); }
  };
}

module.exports = { createObjectStorage, objectKeyFor, requiredR2Variables };
