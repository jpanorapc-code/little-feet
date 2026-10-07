const fs = require('fs');
const path = require('path');

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
      const expression = '^' + template.split('/').map(part =>
        part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      ).join('/') + '$';
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
  const callPatterns = [
    { via: 'fetch', pattern: /fetch\(\s*([`'"])(\/api\/[^\`'"]+)\1\s*(?:,\s*\{([\s\S]{0,260}?)\})?/g },
    { via: 'api', pattern: /(?<![A-Za-z0-9_$])api\(\s*([`'"])(\/api\/[^\`'"]+)\1\s*(?:,\s*\{([\s\S]{0,260}?)\})?/g }
  ];
  for (const relative of sourceFiles) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) continue;
    const source = fs.readFileSync(full, 'utf8');
    for (const { via, pattern } of callPatterns) {
      for (const match of source.matchAll(pattern)) {
        const tail = source.slice(match.index + match[0].length, match.index + match[0].length + 360);
        const concatenated = tail.trimStart().startsWith('+');
        const rawRoute = match[2].replace(/\$\{[^}]*query[^}]*\}/ig, '').replace(/\$\{[^}]+\}/g, 'value');
        const route = rawRoute.split('?')[0] + (concatenated && !rawRoute.includes('?') ? 'value' : '');
        const method = /method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i.exec((match[3] || '') + (concatenated ? tail : ''))?.[1]?.toUpperCase() || 'GET';
        const line = source.slice(0, match.index).split('\n').length;
        calls.push({ method, route, file: relative, line, via });
      }
    }
  }

  const callMatchesRoute = (call, route) => {
    if (route.method !== call.method) return false;
    if (route.expression.test(call.route)) return true;
    const dynamicAt = call.route.indexOf('value');
    if (dynamicAt < 0) return false;
    const staticPrefix = call.route.slice(0, dynamicAt);
    return Boolean(staticPrefix) && route.template.startsWith(staticPrefix);
  };
  const unmatched = calls.filter(call => !routes.some(route => callMatchesRoute(call, route)));
  return { routes, calls, unmatched };
}

if (require.main === module) {
  const result = auditRouteConnections();
  if (result.unmatched.length) {
    console.error('Frontend API calls without a matching server route:');
    result.unmatched.forEach(call => console.error(`${call.method} ${call.route} (${call.file}:${call.line})`));
    process.exitCode = 1;
  } else {
    console.log(`Route connection audit passed: ${result.calls.length} literal frontend API calls matched ${result.routes.length} server routes.`);
  }
}

module.exports = { auditRouteConnections };
