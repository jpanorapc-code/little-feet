'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const databaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required for the shared PostgreSQL failover rehearsal.');
const primaryPort = 18000 + Math.floor(Math.random() * 5000);
const standbyPort = primaryPort + 1;
const commonEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  PGSSLMODE: 'disable',
  SESSION_SECRET: 'integration-test-shared-session-secret',
  LF_BOOTSTRAP_ADMIN_USERNAME: 'failover-admin@example.test',
  LF_BOOTSTRAP_ADMIN_PIN: 'FailoverPass123',
  LF_BOOTSTRAP_ADMIN_NAME: 'Failover Test Administrator',
  LF_ALLOWED_BROWSER_ORIGINS: 'https://littlefeet.co.za',
  LF_TEST_ENFORCE_ORIGIN: '1'
};

function startServer(port, overrides = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...commonEnv, PORT: String(port), ...overrides },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let logs = '';
  child.stderr.on('data', chunk => { logs += chunk.toString(); });
  return { child, get logs() { return logs; } };
}

async function waitForServer(port, server) {
  for (let i = 0; i < 150; i += 1) {
    if (server.child.exitCode !== null) throw new Error(`Failover test server exited: ${server.logs}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Failover test server did not start: ${server.logs}`);
}

async function stopServer(server) {
  if (!server || server.child.exitCode !== null) return;
  await new Promise(resolve => {
    server.child.once('exit', resolve);
    server.child.kill();
  });
}

async function request(port, route, { cookie = '', method = 'GET', body, origin = false } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (origin) {
    headers.origin = 'https://littlefeet.co.za';
    headers['x-forwarded-proto'] = 'https';
  }
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}

(async () => {
  let primary;
  let standby;
  try {
    primary = startServer(primaryPort);
    await waitForServer(primaryPort, primary);
    const primaryLogin = await request(primaryPort, '/api/login', {
      method: 'POST', body: { username: commonEnv.LF_BOOTSTRAP_ADMIN_USERNAME, pin: commonEnv.LF_BOOTSTRAP_ADMIN_PIN }
    });
    assert.equal(primaryLogin.response.status, 200, JSON.stringify(primaryLogin.data));
    const initialWrite = await request(primaryPort, '/api/term', {
      method: 'POST', cookie: primaryLogin.cookie, origin: true, body: { term: 'Primary is live' }
    });
    assert.equal(initialWrite.response.status, 200, JSON.stringify(initialWrite.data));

    standby = startServer(standbyPort, { LF_REPLICA_MODE: '1', LF_SHARED_DATABASE_FAILOVER: '1' });
    await waitForServer(standbyPort, standby);
    const readiness = await request(standbyPort, '/api/failover-readiness');
    assert.equal(readiness.response.status, 200, JSON.stringify(readiness.data));
    assert.equal(readiness.data.ready, true, JSON.stringify(readiness.data));
    assert.equal(readiness.data.mode, 'shared-postgresql-writable');
    assert.equal(readiness.data.writeCapable, true);

    const standbyLogin = await request(standbyPort, '/api/login', {
      method: 'POST', body: { username: commonEnv.LF_BOOTSTRAP_ADMIN_USERNAME, pin: commonEnv.LF_BOOTSTRAP_ADMIN_PIN }
    });
    assert.equal(standbyLogin.response.status, 200, JSON.stringify(standbyLogin.data));
    const standbyRead = await request(standbyPort, '/api/term', { cookie: standbyLogin.cookie });
    assert.equal(standbyRead.data.term, 'Primary is live');

    await stopServer(primary);
    primary = null;
    const failoverWrite = await request(standbyPort, '/api/term', {
      method: 'POST', cookie: standbyLogin.cookie, origin: true, body: { term: 'Standby remains writable' }
    });
    assert.equal(failoverWrite.response.status, 200, JSON.stringify(failoverWrite.data));
    assert.equal(failoverWrite.data.term, 'Standby remains writable');
    const persistedRead = await request(standbyPort, '/api/term', { cookie: standbyLogin.cookie });
    assert.equal(persistedRead.data.term, 'Standby remains writable');
    console.log('Shared PostgreSQL failover integration passed: primary and standby share durable writes; standby stayed writable after primary shutdown.');
  } finally {
    await stopServer(standby);
    await stopServer(primary);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
