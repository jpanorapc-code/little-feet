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
module.exports = { readBackendSource, readFrontendSource };
