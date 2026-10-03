'use strict';

function resolveFailoverMode(env = process.env) {
  const replica = env.LF_REPLICA_MODE === '1';
  const sharedDatabase = replica && env.LF_SHARED_DATABASE_FAILOVER === '1';
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (sharedDatabase && !databaseUrl) {
    throw new Error('LF_SHARED_DATABASE_FAILOVER requires DATABASE_URL so the standby has a durable shared write path.');
  }
  return Object.freeze({
    replica,
    sharedDatabase,
    readOnlySnapshot: replica && !sharedDatabase,
    databaseUrl
  });
}

module.exports = { resolveFailoverMode };
