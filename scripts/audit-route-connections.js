const fs = require('fs');
const path = require('path');

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readFirstArgument(source, openParenIndex) {
  let start = openParenIndex + 1;
  while (/\s/.test(source[start] || '')) start += 1;
  let quote = '';
  let escaped = false;
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue; }
    if (ch === ')') {
      if (depth === 0) return { argument: source.slice(start, i).trim(), end: i };
      depth -= 1;
      continue;
    }
    if (ch === ']' || ch === '}') { if (depth > 0) depth -= 1; continue; }
    if (ch === ',' && depth === 0) return { argument: source.slice(start, i).trim(), end: i };
  }
  return null;
}

function splitTopLevelPlus(expression) {
  const parts = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { if (depth > 0) depth -= 1; continue; }
    if (ch === '+' && depth === 0) { parts.push(expression.slice(start, i)); start = i + 1; }
  }
  parts.push(expression.slice(start));
  return parts;
}

function normaliseApiArgument(expression) {
  const parts = splitTopLevelPlus(expression);
  let route = '';
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const first = part[0];
    const last = part[part.length - 1];
    if ((first === "'" || first === '"' || first === '`') && last === first) {
      let text = part.slice(1, -1);
      if (first === '`') {
        text = text.replace(/\$\{([\s\S]*?)\}/g, (_match, expression) =>
          /\b(?:query|search|params|qs)\b/i.test(expression) ? '' : 'value'
        );
      } else {
        text = text.replace(/\\(['"\\])/g, '$1');
      }
      route += text;
    } else if (/\b(?:query|search|params|qs)\b/i.test(part) || /['"`]\?/.test(part)) {
      continue;
    } else {
      route += 'value';
    }
  }
  return route.split('?')[0];
}

function auditRouteConnections(root = path.resolve(__dirname, '..')) {
  const serverFiles = ['server.js', 'finance-automation-server.js', 'school-core-upgrades-server.js', 'advanced-school-operations-server.js'];
  const routePattern = /app\.(get|post|put|patch|delete)\(\s*(['"])(\/api\/[^'"]+)\2/g;
  const routes = [];

  for (const relative of serverFiles) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) continue;
    const source = fs.readFileSync(full, 'utf8');
    for (const match of source.matchAll(routePattern)) {
      const template = match[3];
      const expression = '^' + template.split('/').map(part => part.startsWith(':') ? '[^/]+' : escapeRegex(part)).join('/') + '$';
      routes.push({ method: match[1].toUpperCase(), template, expression: new RegExp(expression), file: relative });
    }
  }

  const sourceFiles = ['backup.js', 'index.html'];
  const assetsRoot = path.join(root, 'assets');
  const walk = directory => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.js$/i.test(entry.name)) sourceFiles.push(path.relative(root, full));
    }
  };
  walk(assetsRoot);

  const calls = [];
  const invocationPattern = /\b(?:fetch|api)\s*\(/g;
  for (const relative of sourceFiles) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) continue;
    const source = fs.readFileSync(full, 'utf8');
    for (const match of source.matchAll(invocationPattern)) {
      const openParenIndex = match.index + match[0].lastIndexOf('(');
      const parsed = readFirstArgument(source, openParenIndex);
      if (!parsed) continue;
      const route = normaliseApiArgument(parsed.argument);
      if (!route.startsWith('/api/')) continue;
      const tail = source.slice(parsed.end, parsed.end + 500);
      const method = /method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i.exec(tail)?.[1]?.toUpperCase() || 'GET';
      const line = source.slice(0, match.index).split('\n').length;
      calls.push({ method, route, file: relative, line });
    }
  }

  const unmatched = calls.filter(call => !routes.some(route => route.method === call.method && route.expression.test(call.route)));
  return { routes, calls, unmatched };
}

if (require.main === module) {
  const result = auditRouteConnections();
  if (result.unmatched.length) {
    console.error('Frontend API calls without a matching server route:');
    result.unmatched.forEach(call => console.error(call.method + ' ' + call.route + ' (' + call.file + ':' + call.line + ')'));
    process.exitCode = 1;
  } else {
    console.log('Route connection audit passed: ' + result.calls.length + ' frontend API calls matched ' + result.routes.length + ' server routes.');
  }
}

module.exports = { auditRouteConnections, readFirstArgument, normaliseApiArgument };
