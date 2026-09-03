const { spawn } = require('child_process');

const backupPort = process.env.BACKUP_PORT || '5001';
const child = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: backupPort, LF_REPLICA_MODE: '1' },
  stdio: 'inherit'
});

child.on('exit', code => process.exit(code || 0));

