const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const metadataPath = path.join(root, '.render-deploy-release.json');
const tempRoot = path.join(root, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const temp = fs.mkdtempSync(path.join(tempRoot, 'render-release-'));
const port = 7450 + Math.floor(Math.random() * 120);

const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();

try {
  run(process.execPath, [path.join(root, 'scripts', 'write-deploy-release.js')]);
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const head = run('git', ['rev-parse', 'HEAD']).toLowerCase();
  const messageLines = run('git', ['show', '-s', '--format=%B', head]).split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  assert.equal(metadata.fullCommitSha, head);
  assert.equal(metadata.title, messageLines[0]);
  assert.equal(metadata.updateLineCount, Math.max(1, messageLines.length));
  assert.equal(metadata.version, metadata.updateLineCount <= 8 ? '8.2.9' : '9.0');

  for (const file of ['server.js', 'finance-automation-server.js', 'auth-crypto.js', 'backup.js', 'manifest.webmanifest', 'service-worker.js', '.render-deploy-release.json']) {
    fs.copyFileSync(path.join(root, file), path.join(temp, file));
  }
  fs.writeFileSync(path.join(temp, 'littlefeet-replica.json'), JSON.stringify({
    schools: [], users: [], students: [], moduleRecords: {}, directMessages: [], chatGroups: [], groupMessages: {}, schoolBilling: {}
  }));

  const child = spawn(process.execPath, ['server.js'], {
    cwd: temp,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      RENDER: 'true',
      RENDER_GIT_COMMIT: head,
      RENDER_GIT_REPO_SLUG: '',
      LF_REPLICA_MODE: '1',
      LF_TEST_ALLOW_REPLICA_WRITES: '1'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const stop = () => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });

  (async () => {
    try {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        try {
          const health = await fetch('http://127.0.0.1:' + port + '/api/health');
          if (health.ok) break;
        } catch {}
        if (attempt === 119) throw new Error('Render release test server did not start. ' + stderr);
        await wait(100);
      }

      const response = await fetch('http://127.0.0.1:' + port + '/api/release-notes');
      assert.equal(response.status, 200);
      const notes = await response.json();
      assert.equal(notes.length, 1);
      assert.equal(notes[0].title, metadata.title);
      assert.equal(notes[0].version, metadata.version);
      assert.equal(notes[0].commitSha, head.slice(0, 7));
      assert.equal(notes[0].updateLineCount, metadata.updateLineCount);
      assert.equal(notes[0].source, 'Render');
      assert.notEqual(notes[0].title, 'Live Render deployment · ' + head.slice(0, 7));

      console.log('Render deploy release metadata regression test passed.');
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    } finally {
      await stop();
      fs.rmSync(temp, { recursive: true, force: true });
      fs.rmSync(metadataPath, { force: true });
    }
  })();
} catch (error) {
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(metadataPath, { force: true });
  throw error;
}
