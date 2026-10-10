const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Preserve the original cascade; thematic files include later overrides.
const files = [
  '01-foundations.css', '02-workspace-layout.css', '03-executive-and-panels.css',
  '04-surface-themes.css', '05-light-and-dark.css', '06-workplace-and-identity.css',
  '07-responsive-header.css', '08-login-and-positions.css'
];
const css = files.map(file => fs.readFileSync(path.join(root, 'assets/styles/source', file), 'utf8')).join('');
fs.writeFileSync(path.join(root, 'assets/styles/portal.css'), css);
console.log(`Portal stylesheet built from ${files.length} ordered source files (${Buffer.byteLength(css)} bytes).`);
