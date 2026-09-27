const crypto = require('crypto');
const { Pool } = require('pg');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const {
  TABLES,
  stableJson,
  sha256,
  encryptPayload,
  decryptPayload,
  recoverySchemaName,
  readConfiguration
} = require('../lib/operations/recovery-rehearsal');

const config = readConfiguration();
const startedAt = new Date();
const recoveryId = `${startedAt.toISOString().replace(/[-:.]/g, '')}-${crypto.randomBytes(4).toString('hex')}`;
const backupPrefix = `recovery-sets/${recoveryId}`;
const schema = recoverySchemaName(recoveryId);
const restoredObjectKeys = [];
let sourceProbeKey = '';
let client;

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 15000
});
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
});

const readObject = async (bucket, key) => {
  const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await result.Body.transformToByteArray());
};
const putObject = (bucket, key, body, contentType = 'application/octet-stream', metadata = {}) =>
  r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, Metadata: metadata }));
const deleteObject = (bucket, key) => r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
const quoteIdentifier = value => `"${String(value).replace(/"/g, '""')}"`;

const insertRows = async (table, rows) => {
  if (!rows.length) return;
  const destination = `${quoteIdentifier(schema)}.${quoteIdentifier(table.name)}`;
  for (const row of rows) {
    if (table.name === 'little_feet_records') {
      await client.query(`INSERT INTO ${destination} (collection, record_key, school_id, payload, updated_at) VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [row.collection, row.record_key, row.school_id, JSON.stringify(row.payload), row.updated_at]);
    } else if (table.name === 'little_feet_sessions') {
      await client.query(`INSERT INTO ${destination} (sid, sess, expires_at) VALUES ($1,$2::jsonb,$3)`,
        [row.sid, JSON.stringify(row.sess), row.expires_at]);
    } else {
      await client.query(`INSERT INTO ${destination} (state_key, payload, updated_at) VALUES ($1,$2::jsonb,$3)`,
        [row.state_key, JSON.stringify(row.payload), row.updated_at]);
    }
  }
};

const run = async () => {
  client = await pool.connect();
  const manifest = {
    format: 'little-feet-coordinated-recovery-v1',
    recoveryId,
    applicationSha: config.applicationSha,
    capturedAt: startedAt.toISOString(),
    source: { database: 'postgresql', objectStorage: 'cloudflare-r2' },
    target: { databaseSchema: schema, objectStorageBucket: config.backupBucket },
    tables: [],
    objects: [],
    queryPlanIndexes: [],
    rehearsal: { verified: false }
  };

  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query(`LOCK TABLE little_feet_app_state, little_feet_records, little_feet_metadata, little_feet_sessions IN SHARE MODE`);

    let totalPlaintextBytes = 0;
    const snapshots = new Map();
    for (const table of TABLES) {
      const result = await client.query(`SELECT * FROM ${quoteIdentifier(table.name)} ORDER BY ${table.orderBy}`);
      const payload = { table: table.name, rows: result.rows };
      const plaintext = Buffer.from(stableJson(payload));
      totalPlaintextBytes += plaintext.length;
      if (totalPlaintextBytes > config.maximumBytes) throw new Error('Database recovery payload exceeded LF_BACKUP_MAX_BYTES.');
      const encrypted = encryptPayload(payload, config.encryptionKey);
      const key = `${backupPrefix}/postgres/${table.name}.json.enc`;
      await putObject(config.backupBucket, key, encrypted, 'application/octet-stream', { recoveryid: recoveryId, table: table.name });
      snapshots.set(table.name, payload);
      manifest.tables.push({ name: table.name, rows: result.rowCount, plaintextSha256: sha256(plaintext), backupKey: key });
    }

    const indexResult = await client.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename IN ('little_feet_records','little_feet_sessions') ORDER BY indexname`);
    manifest.queryPlanIndexes = indexResult.rows;

    const activeFileKeys = new Set((snapshots.get('little_feet_records')?.rows || [])
      .filter(row => row.collection === 'array:fileRecords' && row.payload?.accessState === 'active' && row.payload?.objectKey)
      .map(row => String(row.payload.objectKey)));
    sourceProbeKey = `recovery-probes/${recoveryId}.txt`;
    const probeBytes = Buffer.from(`Little Feet coordinated recovery probe ${recoveryId}`);
    await putObject(config.sourceBucket, sourceProbeKey, probeBytes, 'text/plain', { recoveryid: recoveryId });
    activeFileKeys.add(sourceProbeKey);

    for (const sourceKey of activeFileKeys) {
      const body = await readObject(config.sourceBucket, sourceKey);
      const backupKey = `${backupPrefix}/r2/${sourceKey}`;
      await putObject(config.backupBucket, backupKey, body, 'application/octet-stream', { recoveryid: recoveryId });
      manifest.objects.push({ sourceKey, backupKey, size: body.length, sha256: sha256(body), probe: sourceKey === sourceProbeKey });
    }
    await client.query('COMMIT');

    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    for (const table of TABLES) {
      await client.query(`SET search_path TO ${quoteIdentifier(schema)}`);
      await client.query(table.createSql);
      const entry = manifest.tables.find(item => item.name === table.name);
      const restored = decryptPayload(await readObject(config.backupBucket, entry.backupKey), config.encryptionKey);
      if (restored.table !== table.name || sha256(Buffer.from(stableJson(restored))) !== entry.plaintextSha256) {
        throw new Error(`Database backup verification failed for ${table.name}.`);
      }
      await insertRows(table, restored.rows);
      const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table.name)}`);
      if (count.rows[0].count !== entry.rows) throw new Error(`Restored row count mismatch for ${table.name}.`);
    }
    await client.query('RESET search_path');

    for (const entry of manifest.objects) {
      const backupBody = await readObject(config.backupBucket, entry.backupKey);
      if (backupBody.length !== entry.size || sha256(backupBody) !== entry.sha256) throw new Error(`Backup object verification failed for ${entry.sourceKey}.`);
      const restoreKey = `${backupPrefix}/rehearsal-restore/${entry.sourceKey}`;
      await putObject(config.backupBucket, restoreKey, backupBody, 'application/octet-stream', { recoveryid: recoveryId });
      restoredObjectKeys.push(restoreKey);
      const restoredHead = await r2.send(new HeadObjectCommand({ Bucket: config.backupBucket, Key: restoreKey }));
      if (Number(restoredHead.ContentLength) !== entry.size) throw new Error(`Restored object size mismatch for ${entry.sourceKey}.`);
      const restoredBody = await readObject(config.backupBucket, restoreKey);
      if (sha256(restoredBody) !== entry.sha256) throw new Error(`Restored object hash mismatch for ${entry.sourceKey}.`);
    }

    manifest.rehearsal = {
      verified: true,
      completedAt: new Date().toISOString(),
      databaseTables: manifest.tables.length,
      databaseRows: manifest.tables.reduce((sum, table) => sum + table.rows, 0),
      objects: manifest.objects.length,
      isolatedSchema: schema,
      isolatedObjectPrefix: `${backupPrefix}/rehearsal-restore/`,
      cleanupVerified: false
    };

    await client.query(`DROP SCHEMA ${quoteIdentifier(schema)} CASCADE`);
    for (const key of restoredObjectKeys) await deleteObject(config.backupBucket, key);
    restoredObjectKeys.length = 0;
    manifest.rehearsal.cleanupVerified = true;
    const manifestBody = Buffer.from(JSON.stringify(manifest, null, 2));
    await putObject(config.backupBucket, `${backupPrefix}/manifest.json`, manifestBody, 'application/json', { recoveryid: recoveryId, verified: 'true' });
    console.log(JSON.stringify({
      status: 'VERIFIED',
      recoveryId,
      applicationSha: manifest.applicationSha,
      databaseTables: manifest.rehearsal.databaseTables,
      databaseRows: manifest.rehearsal.databaseRows,
      objects: manifest.rehearsal.objects,
      backupPrefix,
      cleanupVerified: true,
      durationMs: Date.now() - startedAt.getTime()
    }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client) {
      await client.query('RESET search_path').catch(() => {});
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`).catch(() => {});
    }
    for (const key of restoredObjectKeys) await deleteObject(config.backupBucket, key).catch(() => {});
    if (sourceProbeKey) await deleteObject(config.sourceBucket, sourceProbeKey).catch(() => {});
    client?.release();
    await pool.end();
    r2.destroy();
  }
};

run().catch(error => {
  console.error(JSON.stringify({ status: 'FAILED', message: String(error.message || error).slice(0, 500), recoveryId }));
  process.exitCode = 1;
});
