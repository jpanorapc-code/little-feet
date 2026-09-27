const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const routePattern = /app\.(get|post|put|patch|delete)\(\s*(['"])(\/api\/[^'"]+)\2/g;
const routes = [];
for (const match of server.matchAll(routePattern)) {
  const template = match[3];
  const expression = '^' + template.split('/').map(part => part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$';
  routes.push({ method: match[1].toUpperCase(), template, expression: new RegExp(expression) });
}

const sourceFiles = ['backup.js', 'index.html'];
const walk = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.js$/i.test(entry.name)) sourceFiles.push(path.relative(root, full));
  }
};
walk(path.join(root, 'assets'));

const calls = [];
const fetchPattern = /fetch\(\s*([`'"])(\/api\/[^`'"]+)\1\s*(?:,\s*\{([\s\S]{0,260}?)\})?/g;
for (const relative of sourceFiles) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const match of source.matchAll(fetchPattern)) {
    const tail = source.slice(match.index + match[0].length, match.index + match[0].length + 360);
    const concatenated = tail.trimStart().startsWith('+');
    const route = (match[2].replace(/\$\{[^}]*query[^}]*\}/ig, '').replace(/\$\{[^}]+\}/g, 'value') + (concatenated ? 'value' : '')).split('?')[0];
    const method = /method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i.exec((match[3] || '') + (concatenated ? tail : ''))?.[1]?.toUpperCase() || 'GET';
    calls.push({ method, route, file: relative });
  }
}

const unmatched = calls.filter(call => !routes.some(route => route.method === call.method && route.expression.test(call.route)));
if (unmatched.length) {
  console.error('Frontend API calls without a matching server route:');
  unmatched.forEach(call => console.error(`${call.method} ${call.route} (${call.file})`));
  process.exitCode = 1;
} else {
  console.log(`Route connection audit passed: ${calls.length} literal frontend API calls matched ${routes.length} server routes.`);
}
