const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, '.render-deploy-release.json');

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

try {
  const envSha = String(process.env.RENDER_GIT_COMMIT || '').trim().toLowerCase();
  const headSha = /^[0-9a-f]{40}$/.test(envSha) ? envSha : git(['rev-parse', 'HEAD']).toLowerCase();
  const rawMessage = git(['show', '-s', '--format=%B', headSha]);
  const publishedAt = git(['show', '-s', '--format=%cI', headSha]);
  const messageLines = rawMessage.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const updateLineCount = Math.max(1, messageLines.length);
  const releaseType = updateLineCount <= 8 ? 'patch' : 'update';
  const version = updateLineCount <= 8 ? '8.2.9' : '9.0';

  const payload = {
    id: 'render-' + headSha,
    version,
    title: String(messageLines[0] || ('Deploy ' + headSha.slice(0, 7))).slice(0, 240),
    summary: messageLines.slice(1, 4).join(' · ') || 'Pulled from the deployed Git commit during the Render build.',
    publishedAt,
    source: 'Render',
    commitSha: headSha.slice(0, 7),
    fullCommitSha: headSha,
    updateLineCount,
    releaseType
  };

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log('Wrote Render deploy release metadata for ' + payload.commitSha + ' (' + payload.version + ').');
} catch (error) {
  console.warn('Skipped Render deploy release metadata generation:', error.message);
  try { fs.rmSync(outputPath, { force: true }); } catch {}
}
