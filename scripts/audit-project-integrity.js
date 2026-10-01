'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignoredDirs = new Set(['.git', 'node_modules', 'tmp', 'output']);
const codeExtensions = new Set(['.js', '.cjs', '.mjs', '.html', '.css', '.json', '.webmanifest', '.yml', '.yaml']);
const staticExtensions = new Set([
  '.js', '.cjs', '.mjs', '.css', '.html', '.json', '.webmanifest',
  '.png', '.jpg', '.jpeg', '.webp', '.avif', '.svg', '.gif', '.jfif',
  '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.glb', '.gltf', '.bin', '.wasm',
  '.txt', '.pdf', '.csv', '.ico'
]);

const walk = dir => {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(rel);
  }
  return out;
};

const files = walk(root);
const fileSet = new Set(files);
const failures = [];
const notes = [];

const fail = (type, file, detail) => failures.push({ type, file, detail });
const note = (type, file, detail) => notes.push({ type, file, detail });
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const codeFiles = files.filter(rel => codeExtensions.has(path.extname(rel).toLowerCase()));

for (const rel of codeFiles) {
  const source = read(rel);
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    if (/^(<{7}|={7}|>{7})/.test(lines[i])) fail('merge-marker', rel, `line ${i + 1}: ${lines[i].trim()}`);
    if (/\b(?:TODO|FIXME)\b/i.test(lines[i]) && !rel.startsWith('tests/')) {
      note('todo', rel, `line ${i + 1}: ${lines[i].trim().slice(0, 180)}`);
    }
  }

  const ext = path.extname(rel).toLowerCase();
  if (ext === '.json' || ext === '.webmanifest') {
    try { JSON.parse(source); }
    catch (error) { fail('invalid-json', rel, error.message); }
  }

  if (ext === '.js' || ext === '.cjs' || ext === '.mjs') {
    const moduleSyntax = ext === '.mjs' || /^\s*(?:import|export)\s/m.test(source);
    const args = moduleSyntax ? ['--input-type=module', '--check'] : ['--check', path.join(root, rel)];
    const result = moduleSyntax
      ? spawnSync(process.execPath, args, { input: source, encoding: 'utf8' })
      : spawnSync(process.execPath, args, { encoding: 'utf8' });
    if (result.status !== 0) {
      fail('javascript-syntax', rel, String(result.stderr || result.stdout || 'syntax check failed').trim().slice(0, 500));
    }
  }
}

for (const rel of files.filter(file => file.endsWith('.html'))) {
  const source = read(rel);
  const counts = new Map();
  for (const match of source.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  for (const [id, count] of counts) if (count > 1) fail('duplicate-html-id', rel, `${id} appears ${count} times`);
}

const shouldCheckStatic = ref => {
  if (!ref || ref === '/') return false;
  if (!ref.startsWith('/')) return false;
  const clean = ref.split(/[?#]/)[0];
  if (/^\/(?:api|auth|vendor)(?:\/|$)/.test(clean)) return false;
  if (clean === '/') return false;
  return clean.startsWith('/assets/') || staticExtensions.has(path.extname(clean).toLowerCase()) ||
    ['/logo.png','/logo-transparent.png','/little-feet-mascot.jfif','/manifest.webmanifest','/backup.js','/paia.html'].includes(clean);
};

for (const rel of codeFiles.filter(file => /\.(?:html|css|js|cjs|mjs)$/i.test(file))) {
  const source = read(rel);
  const refs = [];
  for (const match of source.matchAll(/(?:src|href|poster)\s*=\s*["'](\/[^"'<>]+)["']/g)) refs.push(match[1]);
  for (const match of source.matchAll(/url\(\s*["']?(\/[^)"']+)["']?\s*\)/g)) refs.push(match[1]);

  for (const ref of refs) {
    if (!shouldCheckStatic(ref)) continue;
    const clean = ref.split(/[?#]/)[0].replace(/^\/+/, '');
    if (!fileSet.has(clean)) fail('missing-static-reference', rel, ref);
  }
}

for (const rel of codeFiles.filter(file => /\.(?:js|cjs)$/i.test(file))) {
  const source = read(rel);
  const dir = path.posix.dirname(rel);
  for (const match of source.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const base = path.posix.normalize(path.posix.join(dir, match[1]));
    const candidates = [base, `${base}.js`, `${base}.cjs`, `${base}.json`, `${base}/index.js`];
    if (!candidates.some(candidate => fileSet.has(candidate))) fail('missing-relative-require', rel, match[1]);
  }
}

const serviceWorker = read('service-worker.js');
const shellBlock = serviceWorker.match(/const\s+SHELL_ASSETS\s*=\s*\[([\s\S]*?)\];/);
assert.ok(shellBlock, 'service-worker.js must define SHELL_ASSETS');
for (const match of shellBlock[1].matchAll(/["']([^"']+)["']/g)) {
  const ref = match[1];
  if (ref === '/') continue;
  const clean = ref.split(/[?#]/)[0].replace(/^\/+/, '');
  if (shouldCheckStatic(ref) && !fileSet.has(clean)) fail('missing-service-worker-asset', 'service-worker.js', ref);
}

const pkg = JSON.parse(read('package.json'));
for (const [name, script] of Object.entries(pkg.scripts || {})) {
  for (const match of script.matchAll(/(?:^|&&|;)\s*node\s+([^\s;&|]+)/g)) {
    const target = match[1].replace(/^\.\//, '');
    if (!fileSet.has(target)) fail('missing-package-script-target', 'package.json', `${name}: ${target}`);
  }
}

const requiredWorkflowFiles = [
  '.github/workflows/ci.yml',
  '.github/workflows/mailbox-regression.yml',
  '.github/workflows/keepalive.yml',
  '.github/workflows/production-monitor.yml'
];
for (const workflow of requiredWorkflowFiles) if (!fileSet.has(workflow)) fail('missing-workflow', workflow, 'required workflow is absent');

const zeroByte = files.filter(rel => fs.statSync(path.join(root, rel)).size === 0 && !/\.keep$/.test(rel));
for (const rel of zeroByte) fail('zero-byte-file', rel, 'unexpected empty file');

if (failures.length) {
  console.error('Project integrity audit FAILED');
  for (const item of failures) console.error(`- [${item.type}] ${item.file}: ${item.detail}`);
  if (notes.length) {
    console.error('Non-blocking notes:');
    for (const item of notes) console.error(`- [${item.type}] ${item.file}: ${item.detail}`);
  }
  process.exit(1);
}

console.log(`Project integrity audit passed: ${files.length} repository files, ${codeFiles.length} code/config files, all JavaScript syntax, local static references, relative requires, HTML IDs, JSON files, service-worker shell assets, package script targets and required workflows validated.`);
if (notes.length) {
  console.log(`Non-blocking TODO/FIXME notes: ${notes.length}`);
  for (const item of notes) console.log(`- ${item.file}: ${item.detail}`);
}
