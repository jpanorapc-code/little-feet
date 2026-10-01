'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { auditRouteConnections } = require('../scripts/audit-route-connections');

const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.html', '.css', '.json', '.webmanifest']);
const WALK_IGNORES = new Set(['.git', 'node_modules', 'tmp', 'output']);
const PUBLIC_SOURCE_FILES = ['index.html', 'backup.js', 'service-worker.js'];

const lineForIndex = (source, index) => source.slice(0, Math.max(0, index)).split(/\r?\n/).length;
const safeDetail = value => String(value || '').replace(/[\r\n]+/g, ' ').slice(0, 600);

function walk(root, directory = root) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && WALK_IGNORES.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(root, full));
    else out.push(path.relative(root, full).replace(/\\/g, '/'));
  }
  return out;
}

function finding({ severity = 'info', check, file = '', line = null, issue, cause, evidence = '' }) {
  return {
    severity,
    check: String(check || 'inspection').slice(0, 120),
    file: String(file || '').slice(0, 240),
    line: Number.isInteger(line) && line > 0 ? line : null,
    issue: String(issue || '').slice(0, 500),
    cause: String(cause || '').slice(0, 700),
    evidence: safeDetail(evidence)
  };
}

function runProductionSafeSiteInspection(root, runtime = {}) {
  const startedAt = Date.now();
  const findings = [];
  const files = walk(root);
  const fileSet = new Set(files);

  const add = entry => findings.push(finding(entry));

  const routeAudit = auditRouteConnections(root);
  for (const item of routeAudit.unmatched) {
    add({
      severity: 'error',
      check: 'route-connection',
      file: item.file,
      line: item.line,
      issue: `${item.method} ${item.route} has no matching server route.`,
      cause: 'The browser is calling an API route that the server does not currently register. That action will fail or return 404.',
      evidence: `${item.method} ${item.route}`
    });
  }

  const syntaxFiles = files.filter(file => ['.js', '.cjs', '.mjs'].includes(path.extname(file).toLowerCase()));
  for (const relative of syntaxFiles) {
    const full = path.join(root, relative);
    const source = fs.readFileSync(full, 'utf8');
    const ext = path.extname(relative).toLowerCase();
    const moduleSyntax = ext === '.mjs' || /^\s*(?:import|export)\s/m.test(source);
    const result = moduleSyntax
      ? spawnSync(process.execPath, ['--input-type=module', '--check'], { input: source, encoding: 'utf8', timeout: 5000 })
      : spawnSync(process.execPath, ['--check', full], { encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) continue;
    const output = String(result.stderr || result.stdout || 'JavaScript syntax check failed');
    const lineMatch = output.match(/:(\d+)(?::\d+)?\)?(?:\s|$)/);
    add({
      severity: 'error',
      check: 'javascript-syntax',
      file: relative,
      line: lineMatch ? Number(lineMatch[1]) : null,
      issue: 'JavaScript syntax check failed.',
      cause: 'The deployed JavaScript contains syntax that Node.js cannot parse. The affected code may fail to load or execute.',
      evidence: output.slice(0, 500)
    });
  }

  const htmlFiles = files.filter(file => file.endsWith('.html'));
  for (const relative of htmlFiles) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const ids = new Map();
    for (const match of source.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) {
      const list = ids.get(match[1]) || [];
      list.push(lineForIndex(source, match.index));
      ids.set(match[1], list);
    }
    for (const [id, lines] of ids) {
      if (lines.length < 2) continue;
      add({
        severity: 'error',
        check: 'duplicate-html-id',
        file: relative,
        line: lines[1],
        issue: `HTML id "${id}" appears ${lines.length} times.`,
        cause: 'Duplicate IDs make DOM lookup ambiguous and can cause buttons, forms, or scripts to target the wrong element.',
        evidence: `Lines: ${lines.join(', ')}`
      });
    }
  }

  const refsPattern = /(?:src|href|poster)\s*=\s*["'](\/[^"'<>]+)["']/g;
  for (const relative of files.filter(file => /\.(?:html|js|css)$/i.test(file))) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const match of source.matchAll(refsPattern)) {
      const ref = match[1].split(/[?#]/)[0];
      if (!ref.startsWith('/assets/') && !['/backup.js', '/manifest.webmanifest', '/service-worker.js', '/paia.html'].includes(ref)) continue;
      const target = ref.replace(/^\/+/, '');
      if (fileSet.has(target)) continue;
      add({
        severity: 'error',
        check: 'missing-static-reference',
        file: relative,
        line: lineForIndex(source, match.index),
        issue: `Referenced local file is missing: ${ref}`,
        cause: 'The deployed page or script points to a local asset that is not present in the repository. The browser will return 404 for this resource.',
        evidence: ref
      });
    }
  }

  const publicSecretPatterns = [
    ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, 'A private key marker exists in public browser source.'],
    ['database-url', /postgres(?:ql)?:\/\/[^\s"'<>]+/gi, 'A database connection string exists in public browser source.'],
    ['live-secret', /\b(?:sk_live_|xox[baprs]-|gh[pousr]_)[A-Za-z0-9_-]{16,}/g, 'A credential-shaped secret exists in public browser source.']
  ];
  for (const relative of PUBLIC_SOURCE_FILES.filter(file => fileSet.has(file))) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const [check, pattern, issue] of publicSecretPatterns) {
      for (const match of source.matchAll(pattern)) {
        add({
          severity: 'critical',
          check,
          file: relative,
          line: lineForIndex(source, match.index),
          issue,
          cause: 'Browser-delivered source is visible to every visitor. Server credentials must never be embedded in these files.',
          evidence: '[credential pattern redacted]'
        });
      }
    }
  }

  const riskyClientPatterns = [
    ['eval-usage', /\beval\s*\(/g, 'Use of eval() was found in browser code.', 'eval() executes strings as code and increases injection risk.'],
    ['new-function', /\bnew\s+Function\s*\(/g, 'Use of new Function() was found in browser code.', 'Dynamic code execution can turn untrusted text into executable JavaScript.'],
    ['document-write', /\bdocument\.write\s*\(/g, 'Use of document.write() was found in browser code.', 'document.write() can overwrite the document and is a fragile injection surface.']
  ];
  for (const relative of PUBLIC_SOURCE_FILES.filter(file => fileSet.has(file))) {
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const [check, pattern, issue, cause] of riskyClientPatterns) {
      for (const match of source.matchAll(pattern)) {
        add({ severity: 'warn', check, file: relative, line: lineForIndex(source, match.index), issue, cause, evidence: match[0] });
      }
    }
  }

  const serverSource = fileSet.has('server.js') ? fs.readFileSync(path.join(root, 'server.js'), 'utf8') : '';
  const requiredProtectionPatterns = [
    ['source-protection-server', /server\\\.js/i, 'Backend server source is explicitly blocked from public requests.'],
    ['source-protection-lib', /scripts\|lib/, 'Backend lib and scripts directories are explicitly blocked from public requests.'],
    ['security-csp', /Content-Security-Policy/, 'A Content-Security-Policy header is configured.'],
    ['security-hsts', /Strict-Transport-Security/, 'HSTS is configured for production.'],
    ['security-frame', /X-Frame-Options/, 'Clickjacking protection is configured.']
  ];
  for (const [check, pattern, label] of requiredProtectionPatterns) {
    if (pattern.test(serverSource)) continue;
    add({
      severity: 'critical',
      check,
      file: 'server.js',
      line: null,
      issue: `Required protection missing: ${label}`,
      cause: 'The deployed server source no longer contains a protection Little Feet expects at the HTTP boundary.',
      evidence: check
    });
  }

  for (const problem of runtime.productionConfigurationErrors || []) {
    add({
      severity: 'critical',
      check: 'production-configuration',
      file: 'runtime',
      line: null,
      issue: `Required production configuration is missing: ${problem}`,
      cause: 'The production process does not have this required secure setting available.',
      evidence: problem
    });
  }

  const recentFaults = Array.isArray(runtime.systemErrors) ? runtime.systemErrors.slice(0, 100) : [];
  for (const fault of recentFaults.filter(item => item.status === 'open').slice(0, 25)) {
    add({
      severity: fault.severity === 'error' ? 'error' : 'warn',
      check: 'open-runtime-fault',
      file: fault.route || 'runtime',
      line: null,
      issue: `${fault.name || 'Error'}: ${fault.message || 'Open runtime fault'}`,
      cause: 'This is a real unresolved runtime fault already captured by Little Feet. Trace its Request ID in Inspect & Logs for the request timeline.',
      evidence: fault.requestId || fault.id
    });
  }

  const rank = { critical: 4, error: 3, warn: 2, info: 1 };
  findings.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0) || String(a.file).localeCompare(String(b.file)) || Number(a.line || 0) - Number(b.line || 0));

  const summary = {
    critical: findings.filter(item => item.severity === 'critical').length,
    errors: findings.filter(item => item.severity === 'error').length,
    warnings: findings.filter(item => item.severity === 'warn').length,
    routeCallsChecked: routeAudit.calls.length,
    serverRoutesChecked: routeAudit.routes.length,
    filesChecked: files.filter(file => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase())).length,
    passed: !findings.some(item => item.severity === 'critical' || item.severity === 'error')
  };

  return {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    summary,
    findings
  };
}

module.exports = { runProductionSafeSiteInspection };
