'use strict';

function resolveFailoverMode(env = process.env) {
  const replica = env.LF_REPLICA_MODE === '1';
  const sharedDatabaseRequested = env.LF_SHARED_DATABASE_FAILOVER === '1';
  if (sharedDatabaseRequested && !replica) {
    throw new Error('LF_SHARED_DATABASE_FAILOVER requires LF_REPLICA_MODE=1 to prevent the standby from starting as a primary.');
  }
  const sharedDatabase = replica && sharedDatabaseRequested;
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
