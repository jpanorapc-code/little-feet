'use strict';

const assert = require('node:assert/strict');
const { resolveFailoverMode } = require('../failover-mode');

assert.deepEqual(resolveFailoverMode({}), {
  replica: false, sharedDatabase: false, readOnlySnapshot: false, databaseUrl: ''
});
assert.deepEqual(resolveFailoverMode({ LF_REPLICA_MODE: '1' }), {
  replica: true, sharedDatabase: false, readOnlySnapshot: true, databaseUrl: ''
});
assert.deepEqual(resolveFailoverMode({ LF_REPLICA_MODE: '1', LF_SHARED_DATABASE_FAILOVER: '1', DATABASE_URL: 'postgres://db' }), {
  replica: true, sharedDatabase: true, readOnlySnapshot: false, databaseUrl: 'postgres://db'
});
assert.throws(() => resolveFailoverMode({ LF_REPLICA_MODE: '1', LF_SHARED_DATABASE_FAILOVER: '1' }),
  /requires DATABASE_URL/i);
assert.deepEqual(resolveFailoverMode({ LF_SHARED_DATABASE_FAILOVER: '1', DATABASE_URL: 'postgres://db' }), {
  replica: false, sharedDatabase: false, readOnlySnapshot: false, databaseUrl: 'postgres://db'
});

console.log('Failover mode configuration tests passed.');
