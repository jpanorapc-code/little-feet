const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readBackendSource, readFrontendSource } = require('../scripts/source-layout');
const root = path.resolve(__dirname, '..');
const contract = require('./fixtures/controlled-split-contract.json');
const backend = readBackendSource(root) + ['finance-automation-server.js','school-core-upgrades-server.js','advanced-school-operations-server.js'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
const routes = [...backend.matchAll(/app\.(get|post|put|patch|delete)\(\s*(['"])(\/(?:api|auth)\/[^'"]+)\2/g)].map(m=>m[1].toUpperCase()+' '+m[3]).sort();
assert.deepEqual(routes, contract.routes, 'Every existing route and method must survive the controlled split');
const handlers = [...readFrontendSource(root).matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]).sort();
assert.deepEqual(handlers, contract.handlers, 'No browser handler can be removed or duplicated');
const server = fs.readFileSync(path.join(root,'server.js'),'utf8');
const modules = new Map([...server.matchAll(/const ([a-z]+Routes) = require\('([^']+)'\);/g)].map(m=>[m[1],require(path.join(root,m[2]))]));
const used = new Set();
for (const match of server.matchAll(/\b([a-z]+Routes)\.([A-Za-z0-9_]+)\(app, routeContext\);/g)) {
  assert.equal(typeof modules.get(match[1])?.[match[2]], 'function', 'Registration must refer to its own module export: '+match[0]);
  assert.equal(used.has(match[1]+'.'+match[2]), false, 'A registration must run only once');
  used.add(match[1]+'.'+match[2]);
}
assert.equal(used.size, [...modules.values()].reduce((sum,module)=>sum+Object.keys(module).length,0), 'Every domain registration must be wired');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const entry = html.indexOf('<script src="backup.js?');
for (const file of fs.readdirSync(path.join(root,'assets','features'))) {
  const marker='<script src="'+path.posix.join('/', 'assets', 'features', file)+'?';
  assert.ok(html.includes(marker), 'Feature must be loaded: '+file);
  assert.ok(html.indexOf(marker)<entry, 'Global handlers must load before entry-point wiring');
}
console.log(`Controlled split contract passed: ${routes.length} routes, ${handlers.length} declarations, ${used.size} registrations and deferred feature order.`);
