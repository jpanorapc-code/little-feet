const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'login-security-'));
const port = 6750 + Math.floor(Math.random() * 200);
const hash = pin => crypto.scryptSync(String(pin), 'little-feet-pin-salt', 64).toString('hex');
assert.equal(fs.existsSync(path.join(root, 'assets', 'security', 'login-security-alert.jpg')), true, 'login security artwork must exist');

for (const file of ['server.js', 'failover-mode.js', 'finance-automation-server.js', 'auth-crypto.js']) {
  fs.copyFileSync(path.join(root, file), path.join(temp, file));
}
fs.cpSync(path.join(root, 'lib'), path.join(temp, 'lib'), { recursive: true });

fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
  schools: [{
    id: 'school-security',
    name: 'Security Test School',
    status: 'active',
    subscriptionStatus: 'active',
    subscriptionActiveUntil: '2099-12-31'
  }],
  users: [{
    username: 'security@example.com',
    email: 'security@example.com',
    pinHash: hash('SecurePass1'),
    name: 'Security User',
    role: 'admin',
    schoolId: 'school-security',
    schoolName: 'Security Test School',
    verificationStatus: 'Active'
  }],
  moduleRecords: {},
  schoolBilling: {},
  directMessages: [],
  chatGroups: [],
  groupMessages: {}
}));

const delivered = [];
const mailServer = http.createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try { delivered.push(JSON.parse(raw || '{}')); } catch { delivered.push({ raw }); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'test-delivery' }));
  });
});

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => server.close(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let child;
let stderr = '';

const stopChild = () => new Promise(resolve => {
  if (!child || child.exitCode !== null) return resolve();
  child.once('exit', resolve);
  child.kill();
});

const request = async (route, { method = 'GET', body, cookie, headers = {} } = {}) => {
  const response = await fetch('http://127.0.0.1:' + port + route, {
    method,
    headers: {
      ...headers,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual'
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return {
    response,
    data,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie
  };
};

const solvePrompt = prompt => {
  const match = /^What is (\d+) ([+−]) (\d+)\?$/.exec(String(prompt || ''));
  assert.ok(match, 'human-check prompt should be a small arithmetic question');
  const left = Number(match[1]);
  const right = Number(match[3]);
  return String(match[2] === '+' ? left + right : left - right);
};

const challenge = async cookie => {
  const startedAt = Date.now();
  const result = await request('/api/auth/human-check', { cookie });
  const elapsedMs = Date.now() - startedAt;
  assert.equal(result.response.status, 200);
  assert.equal(result.data.required, true);
  assert.match(result.response.headers.get('cache-control') || '', /no-store/i);
  assert.equal(result.response.headers.get('set-cookie'), null, 'human check must not create or touch a login session');
  assert.ok(elapsedMs < 2000, `human check should return quickly; took ${elapsedMs}ms`);
  assert.ok(result.data.challengeId);
  return {
    cookie,
    id: result.data.challengeId,
    answer: solvePrompt(result.data.prompt)
  };
};

const login = async ({ username = 'security@example.com', pin = 'SecurePass1', cookie, companyWebsite = '' } = {}) => {
  const check = await challenge(cookie);
  const result = await request('/api/login', {
    method: 'POST',
    cookie: check.cookie,
    body: {
      username,
      pin,
      humanCheckId: check.id,
      humanCheckAnswer: check.answer,
      companyWebsite
    }
  });
  return { ...result, challenge: check };
};

const waitForMail = async subjectPart => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = delivered.find(message => String(message.subject || '').includes(subjectPart));
    if (found) return found;
    await wait(50);
  }
  throw new Error('Expected email was not delivered: ' + subjectPart);
};

(async () => {
  const mailPort = await listen(mailServer);
  child = spawn(process.execPath, ['server.js'], {
    cwd: temp,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      LF_REPLICA_MODE: '1',
      LF_TEST_ALLOW_REPLICA_WRITES: '1',
      LF_TEST_REQUIRE_HUMAN_CHECK: '1',
      LF_EMAIL_FROM: 'security@littlefeet.test',
      LF_EMAIL_API_KEY: 'test-key',
      LF_EMAIL_API_URL: 'http://127.0.0.1:' + mailPort + '/emails'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        const health = await fetch('http://127.0.0.1:' + port + '/api/health');
        if (health.ok) break;
      } catch {}
      await wait(100);
      if (attempt === 119) throw new Error('Login security test server did not start. ' + stderr);
    }

    // A stale browser session cookie must not make the pre-login human check
    // wait for or depend on the database-backed session store.
    const staleCookieChallenge = await challenge('littlefeet.sid=s%3Astale.invalid');
    assert.ok(staleCookieChallenge.id);

    const missingCheck = await request('/api/login', {
      method: 'POST',
      body: { username: 'security@example.com', pin: 'SecurePass1' }
    });
    assert.equal(missingCheck.response.status, 400);
    assert.equal(missingCheck.data.humanCheckRequired, true);

    const unknown = await login({ username: 'nobody@example.com', pin: 'WrongPass1' });
    assert.equal(unknown.response.status, 401);

    const wrongKnown = await login({ username: 'security@example.com', pin: 'WrongPass1' });
    assert.equal(wrongKnown.response.status, 401);
    assert.equal(wrongKnown.data.message, unknown.data.message, 'unknown and incorrect accounts must return the same safe login error');

    const successful = await login();
    assert.equal(successful.response.status, 200);
    assert.equal(successful.data.user.username, 'security@example.com');
    assert.ok(successful.cookie);

    const notification = await waitForMail('new sign-in');
    assert.deepEqual(notification.to, ['security@example.com']);
    assert.match(String(notification.text || ''), /successful sign-in/i);
    assert.match(String(notification.text || ''), /Sign-in method: password/i);
    assert.match(String(notification.text || ''), /Network address:/i);
    assert.match(String(notification.text || ''), /Browser\/device:/i);
    assert.match(String(notification.html || ''), /New sign-in detected/i);
    assert.match(String(notification.html || ''), /https:\/\/littlefeet\.co\.za\/assets\/security\/login-security-alert\.jpg/);
    assert.match(String(notification.html || ''), /Little Feet security/i);
    assert.doesNotMatch(JSON.stringify(notification), /SecurePass1|WrongPass1/);

    const protectedBeforeLogout = await request('/api/registry', { cookie: successful.cookie });
    assert.equal(protectedBeforeLogout.response.status, 200);

    const logs = await request('/api/system-logs?search=auth.login', { cookie: successful.cookie });
    assert.equal(logs.response.status, 200);
    assert.match(JSON.stringify(logs.data), /auth\.login_succeeded/);
    assert.doesNotMatch(JSON.stringify(logs.data), /SecurePass1|WrongPass1/);

    const logout = await request('/api/auth/logout', { method: 'POST', cookie: successful.cookie });
    assert.equal(logout.response.status, 200);
    const protectedAfterLogout = await request('/api/registry', { cookie: successful.cookie });
    assert.ok([401, 403].includes(protectedAfterLogout.response.status));

    const trapped = await login({ companyWebsite: 'https://bot.invalid/' });
    assert.equal(trapped.response.status, 400);
    assert.equal(trapped.data.humanCheckRequired, true);

    const replayCheck = await challenge();
    const firstUse = await request('/api/login', {
      method: 'POST',
      cookie: replayCheck.cookie,
      body: {
        username: 'security@example.com',
        pin: 'WrongPass1',
        humanCheckId: replayCheck.id,
        humanCheckAnswer: replayCheck.answer,
        companyWebsite: ''
      }
    });
    assert.equal(firstUse.response.status, 401);
    const replay = await request('/api/login', {
      method: 'POST',
      cookie: replayCheck.cookie,
      body: {
        username: 'security@example.com',
        pin: 'SecurePass1',
        humanCheckId: replayCheck.id,
        humanCheckAnswer: replayCheck.answer,
        companyWebsite: ''
      }
    });
    assert.equal(replay.response.status, 400);
    assert.equal(replay.data.humanCheckRequired, true);

    let locked;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      locked = await login({ username: 'security@example.com', pin: 'WrongPass1' });
    }
    assert.equal(locked.response.status, 429);
    assert.ok(Number(locked.response.headers.get('retry-after')) > 0);
    const lockoutNotice = await waitForMail('temporarily locked');
    assert.doesNotMatch(JSON.stringify(lockoutNotice), /SecurePass1|WrongPass1/);

    console.log('Login security notification and human-check regression test passed.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await stopChild();
    await close(mailServer);
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
