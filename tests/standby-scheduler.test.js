const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync(path.join(root, 'tmp', 'standby-scheduler-'));
for (const name of fs.readdirSync(root).filter(name => name.endsWith('.js'))) {
  fs.copyFileSync(path.join(root, name), path.join(fixture, name));
}
fs.cpSync(path.join(root, 'lib'), path.join(fixture, 'lib'), { recursive: true });
fs.writeFileSync(path.join(fixture, 'littlefeet-replica.json'), JSON.stringify({
  schools: [{ id: 'standby-school', name: 'Standby School', status: 'active' }],
  users: [{ username: 'standby-admin', name: 'Standby Admin', role: 'admin', schoolId: 'standby-school', schoolName: 'Standby School', verificationStatus: 'Active' }],
  students: [],
  communicationCampaigns: [{ id: 'due-campaign', schoolId: 'standby-school', createdBy: 'standby-admin', audience: 'all', title: 'Standby regression', message: 'Local test delivery', channels: ['push'], status: 'scheduled', scheduledAt: '2020-01-01T00:00:00Z', deliveries: [] }]
}));
let deliveries = 0;
const gateway = http.createServer((req, res) => {
  deliveries += 1;
  req.resume();
  res.setHeader('Content-Type', 'application/json');
  res.end('{}');
});
let child;
let stderr = '';
(async () => {
  try {
    await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
    const port = 24000 + Math.floor(Math.random() * 1000);
    child = spawn(process.execPath, ['server.js'], {
      cwd: fixture,
      env: { ...process.env, NODE_ENV: 'test', PORT: String(port), LF_REPLICA_MODE: '1', SESSION_SECRET: 'standby-regression-session', LF_PUSH_API_KEY: 'local-regression-key', LF_PUSH_API_URL: `http://127.0.0.1:${gateway.address().port}/push` },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    let ready = false;
    for (let i = 0; i < 150; i += 1) {
      if (child.exitCode !== null) throw new Error(stderr);
      try { ready = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Standby must start before its scheduler can be checked.');
    await new Promise(resolve => setTimeout(resolve, 65000));
    assert.equal(deliveries, 0, 'A read-only standby must never send a scheduled campaign from its snapshot.');
    console.log('Read-only standby scheduler regression passed: no provider deliveries across a scheduler interval.');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    }
    await new Promise(resolve => gateway.close(resolve));
    const relative = path.relative(path.join(root, 'tmp'), fixture);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
