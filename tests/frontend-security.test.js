const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'backup.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const requiredFrontendProtections = [
  'escapeWorkspaceText(p.caption)',
  'escapeWorkspaceText(s.studentName)',
  'escapeWorkspaceText(w.studentName)',
  'escapeWorkspaceText(b.studentName)',
  'escapeWorkspaceText(a.studentName)',
  'escapeWorkspaceText(t.message)',
  'safeWorkspaceImageUrl(p.mediaUrl)',
  'safeWorkspaceImageUrl(item.photoUrl)',
  'safeWorkspaceExternalUrl(store.webStoreUrl)'
];
for (const snippet of requiredFrontendProtections) {
  assert.ok(frontend.includes(snippet), `Missing frontend protection: ${snippet}`);
}

const forbiddenFrontendSnippets = [
  '${p.caption}</p>',
  '<strong>${s.studentName}</strong>',
  '<strong>${w.studentName}</strong>',
  '— ${b.studentName}</span>',
  '<strong>${a.studentName}</strong>',
  '>${t.message}</p>'
];
for (const snippet of forbiddenFrontendSnippets) {
  assert.ok(!frontend.includes(snippet), `Unsafe frontend rendering returned: ${snippet}`);
}

assert.ok(server.includes('const safeAccount = ({ pin, pinHash, reportSigningPinHash, ...account })'));
assert.ok(server.includes('Content-Security-Policy'));
assert.ok(server.includes('Strict-Transport-Security'));
assert.ok(server.includes('teacherCanAccessLearnerRecord'));
assert.ok(server.includes('pg_try_advisory_lock'));
assert.ok(server.includes('Refusing to start production without required secret'));
assert.ok(server.includes('req.session.regenerate'));
assert.ok(server.includes("Staff group channels are available only to authorised school staff."));
assert.ok(server.includes("Staff group messages are available only to authorised school staff."));
assert.ok(frontend.includes("if (currentUser?.role === 'parent')"));
assert.ok(frontend.includes("btnGroup?.classList.toggle('hidden', parentDirectOnly)"));
assert.ok(frontend.includes('escapeWorkspaceText(t.feedback)'));
assert.ok(frontend.includes('escapeWorkspaceText(currentFeedback ||'));

console.log('Frontend and server security regression test passed.');
