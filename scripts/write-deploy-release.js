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
  const baselinePath = path.join(root, '.littlefeet-release-baseline');
  const baselineParts = String(fs.readFileSync(baselinePath, 'utf8')).trim().split('.').map(Number);
  if (baselineParts.length !== 3 || baselineParts.some(part => !Number.isInteger(part) || part < 0)) throw new Error('Invalid release baseline version.');
  let commitsSinceBaseline = 0;
  try {
    const baselineCommit = git(['log', '-1', '--format=%H', '--', '.littlefeet-release-baseline']);
    if (baselineCommit) commitsSinceBaseline = Math.max(0, Number(git(['rev-list', '--count', `${baselineCommit}..${headSha}`])) || 0);
  } catch {}
  const rawMessage = git(['show', '-s', '--format=%B', headSha]);
  const publishedAt = git(['show', '-s', '--format=%cI', headSha]);
  const messageLines = rawMessage.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const updateLineCount = Math.max(1, messageLines.length);
  const releaseType = commitsSinceBaseline ? 'update' : 'baseline';
  const version = commitsSinceBaseline
    ? `${baselineParts[0]}.${baselineParts[1]}.${baselineParts[2] + commitsSinceBaseline}`
    : `${baselineParts[0]}.${baselineParts[1]}`;
  const isBaseline = commitsSinceBaseline === 0;

  const payload = {
    id: 'render-' + headSha,
    version,
    title: String(isBaseline ? 'Production foundation' : (messageLines[0] || 'Little Feet update')).slice(0, 240),
    summary: isBaseline
      ? 'Secure accounts, automatic subscription activation, private file storage, reliable imports, and performance improvements are now live.'
      : (messageLines.slice(1, 4).join(' · ') || 'The latest Little Feet improvements are now live.'),
    publishedAt,
    source: 'Render',
    commitSha: headSha.slice(0, 7),
    fullCommitSha: headSha,
    commitsSinceBaseline,
    updateLineCount,
    releaseType
  };

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log('Wrote Render deploy release metadata for ' + payload.commitSha + ' (' + payload.version + ').');
} catch (error) {
  console.warn('Skipped Render deploy release metadata generation:', error.message);
  try { fs.rmSync(outputPath, { force: true }); } catch {}
}
