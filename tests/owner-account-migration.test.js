const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'owner-account-migration-'));
const port = 6500 + Math.floor(Math.random() * 300);

for (const file of ['server.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js']) {
  fs.copyFileSync(path.join(root, file), path.join(temp, file));
}
fs.mkdirSync(path.join(temp, 'lib', 'storage'), { recursive: true });
fs.copyFileSync(path.join(root, 'lib', 'storage', 'object-storage.js'), path.join(temp, 'lib', 'storage', 'object-storage.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-integration.js'), path.join(temp, 'lib', 'mailbox-integration.js'));
fs.copyFileSync(path.join(root, 'lib', 'oauth-identity.js'), path.join(temp, 'lib', 'oauth-identity.js'));
fs.copyFileSync(path.join(root, 'lib', 'mailbox-oauth.js'), path.join(temp, 'lib', 'mailbox-oauth.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-imap.js'), path.join(temp, 'lib', 'yahoo-imap.js'));
fs.copyFileSync(path.join(root, 'lib', 'yahoo-smtp.js'), path.join(temp, 'lib', 'yahoo-smtp.js'));

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = async (route, options = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, options);
  const data = await response.json();
  return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || options.cookie };
};

let child;
let stderr = '';
const start = async extraEnv => {
  stderr = '';
  child = spawn(process.execPath, ['server.js'], {
    cwd: temp,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      SESSION_SECRET: 'owner-migration-test-session-secret',
      LF_FIELD_ENCRYPTION_KEY: 'owner-migration-test-field-key',
      ...extraEnv
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`Owner migration test server failed to start. ${stderr}`);
};
const stop = () => new Promise(resolve => {
  if (!child || child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});
const login = (username, pin) => request('/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username, pin })
});

(async () => {
  try {
    await start({
      LF_BOOTSTRAP_ADMIN_USERNAME: 'previous-admin@example.test',
      LF_BOOTSTRAP_ADMIN_PIN: 'PreviousPassword1',
      LF_BOOTSTRAP_ADMIN_NAME: 'Previous Admin',
      LF_BOOTSTRAP_SCHOOL_NAME: 'Migration Test School'
    });
    const previousLogin = await login('previous-admin@example.test', 'PreviousPassword1');
    assert.equal(previousLogin.response.status, 200);
    const createSecond = await request('/api/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: previousLogin.cookie },
      body: JSON.stringify({
        username: 'second-user@example.test',
        pin: 'SecondPassword1',
        name: 'Second User',
        role: 'teacher'
      })
    });
    assert.equal(createSecond.response.status, 201);
    await stop();

    const resetEnvironment = {
      LF_OWNER_RESET_ALL_ACCOUNTS: '1',
      LF_OWNER_ACCOUNT_RESET_ID: 'owner-reset-test-v1',
      LF_OWNER_ADMIN_USERNAME: 'owner@example.test',
      LF_OWNER_ADMIN_PIN: 'OwnerPassword1',
      LF_OWNER_ADMIN_NAME: 'Official Owner'
    };
    await start(resetEnvironment);
    assert.equal((await login('previous-admin@example.test', 'PreviousPassword1')).response.status, 401);
    assert.equal((await login('second-user@example.test', 'SecondPassword1')).response.status, 401);
    const ownerLogin = await login('owner@example.test', 'OwnerPassword1');
    assert.equal(ownerLogin.response.status, 200);
    const accounts = await request('/api/accounts', { headers: { cookie: ownerLogin.cookie } });
    assert.equal(accounts.response.status, 200);
    assert.deepEqual(accounts.data.map(account => ({ username: account.username, role: account.role, name: account.name })), [
      { username: 'owner@example.test', role: 'admin', name: 'Official Owner' }
    ]);
    await stop();

    await start({ ...resetEnvironment, LF_OWNER_ADMIN_PIN: 'ChangedValueMustNotReapply' });
    assert.equal((await login('owner@example.test', 'OwnerPassword1')).response.status, 200);
    assert.equal((await login('owner@example.test', 'ChangedValueMustNotReapply')).response.status, 401);
    await stop();

    console.log('One-time owner account migration test passed.');
  } finally {
    await stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
