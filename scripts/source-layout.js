const fs = require('node:fs');
const path = require('node:path');
const filesIn = directory => fs.existsSync(directory)
  ? fs.readdirSync(directory).filter(name=>name.endsWith('.js')).sort().map(name=>path.join(directory,name))
  : [];
const readBackendSource = root => [path.join(root,'server.js'), ...filesIn(path.join(root,'lib','routes')), ...filesIn(path.join(root,'lib','helpers'))]
  // Existing structural assertions check the original binding names. Strip only
  // the dependency-injection qualifier; runtime tests execute the real modules.
  .map(file=>fs.readFileSync(file,'utf8').replace(/\bcontext\./g, '')).join('\n');
const readFrontendSource = root => [path.join(root,'backup.js'), ...filesIn(path.join(root,'assets','features'))]
  .map(file=>fs.readFileSync(file,'utf8')).join('\n');
// Structural assertions can follow extracted styles at their original position.
// Browsers still load the actual external stylesheet from index.html.
const readPageSource = root => fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(
  /<link rel="stylesheet" href="\/assets\/styles\/portal\.css\?[^\"]+">/,
  link => `${link}\n<style>${fs.readFileSync(path.join(root, 'assets/styles/portal.css'), 'utf8')}</style>`
);
module.exports = { readBackendSource, readFrontendSource, readPageSource };
