const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const databaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
const caFile = String(process.env.TEST_POSTGRES_CA_FILE || '').trim();
if (!databaseUrl || !caFile) throw new Error('Use a disposable TLS-enabled PostgreSQL database and set TEST_DATABASE_URL and TEST_POSTGRES_CA_FILE.');
const ca = fs.readFileSync(caFile, 'utf8');
const fixture = fs.mkdtempSync(path.join(root, 'tmp', 'postgres-tls-'));
for (const name of fs.readdirSync(root).filter(name => name.endsWith('.js'))) fs.copyFileSync(path.join(root, name), path.join(fixture, name));
fs.cpSync(path.join(root, 'lib'), path.join(fixture, 'lib'), { recursive: true });

async function checkStartup({ trusted, urlMode, renderMode = false }) {
  const port = 26500 + Math.floor(Math.random() * 200);
  const url = new URL(databaseUrl);
  url.searchParams.delete('ssl');
  url.searchParams.delete('sslrootcert');
  if (urlMode) url.searchParams.set('sslmode', 'require');
  else url.searchParams.delete('sslmode');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: fixture,
    env: { ...process.env, DATABASE_URL: url.toString(), PGSSLMODE: '', RENDER: renderMode ? 'true' : '', LF_REPLICA_MODE: '0', LF_SHARED_DATABASE_FAILOVER: '0', NODE_ENV: 'test', PORT: String(port), SESSION_SECRET: 'tls-regression-session', LF_POSTGRES_CA_CERT: trusted ? ca.replace(/\n/g, '\\n') : '' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  try {
    let ready = false;
    for (let i = 0; i < 200; i += 1) {
      if (child.exitCode !== null) break;
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const shouldConnect = trusted || urlMode || renderMode;
    if (shouldConnect) {
      assert.ok(ready, (urlMode || renderMode) && !trusted
        ? 'Render/sslmode=require must allow an encrypted connection to a self-signed private endpoint. ' + errors
        : 'The application must connect when the database certificate is explicitly trusted. ' + errors);
    } else {
      assert.equal(ready, false, 'Default verified TLS must reject an untrusted certificate.');
      assert.ok(child.exitCode !== null && child.exitCode !== 0, 'Untrusted verified TLS must fail startup. ' + errors);
      assert.match(errors, /certificate|self.signed/i);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  }
}

(async () => {
  try {
    await checkStartup({ trusted: false, urlMode: false });
    await checkStartup({ trusted: false, urlMode: true });
    await checkStartup({ trusted: false, urlMode: false, renderMode: true });
    await checkStartup({ trusted: true, urlMode: true });
    console.log('PostgreSQL TLS integration passed: verified TLS rejects untrusted certificates, Render defaults to encrypted require mode for self-signed private endpoints, explicit sslmode=require works, and an explicit trusted CA connects successfully.');
  } finally {
    const relative = path.relative(path.join(root, 'tmp'), fixture);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
