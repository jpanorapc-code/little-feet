const { spawn } = require('child_process');

// Render injects PORT for each service; BACKUP_PORT remains an explicit local override.
const backupPort = process.env.BACKUP_PORT || process.env.PORT || '5001';
const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: backupPort, LF_REPLICA_MODE: '1' },
  stdio: 'inherit'
});

child.on('exit', code => process.exit(code || 0));

// Render and local test runners stop this launcher process first. Forward the
// signal so the actual server does not outlive its supervisor and retain the
// launcher's inherited stdout/stderr handles.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (!child.kill(signal)) process.exit(0);
  });
}

