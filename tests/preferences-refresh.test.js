const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const client = fs.readFileSync(path.join(root, 'backup.js'), 'utf8');
const preferences = fs.readFileSync(path.join(root, 'assets', 'preferences-enhancements.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');

for (const [code, label] of [
  ['en','English'],['af','Afrikaans'],['zu','isiZulu'],['xh','isiXhosa'],['nso','Sepedi'],
  ['st','Sesotho'],['tn','Setswana'],['ss','siSwati'],['ve','Tshivenda'],['ts','itsonga'],['nr','isiNdebele']
]) {
  assert.match(page, new RegExp('<option value="' + code + '">' + label + '<\\/option>'));
}
assert.doesNotMatch(page, /<option value="sasl"/i);
assert.match(page, /South African Sign Language \(SASL\) is an official language/);
assert.match(page, /Text translation is not a substitute for signed content/);

for (const value of ['0','auto','5000','10000','30000','60000','300000','900000','1800000','3600000','7200000','86400000']) {
  assert.match(page, new RegExp('<option value="' + value + '">'));
}
assert.match(page, /onclick="refreshDashboardSafely\(\)"/);
assert.match(page, /Passwords, PINs, one-time codes, signatures and files are never stored/);

assert.match(preferences, /const LANGUAGE_PACKS = Object\.freeze/);
for (const code of ['af','zu','xh','nso','st','tn','ss','ve','ts','nr']) {
  assert.match(preferences, new RegExp('\\n    ' + code + ': \\{'));
}
assert.match(preferences, /untranslated workspace text safely falls back to English|LANGUAGE_PACKS\.en/);
assert.match(preferences, /sessionStorage\.setItem\(draftKey\(\), serialized\)/);
assert.match(preferences, /sessionStorage\.removeItem\(DRAFT_PREFIX/);
assert.doesNotMatch(preferences, /localStorage\.setItem\(draftKey\(/);
assert.match(preferences, /\['password','file','hidden','submit','button','reset'\]/);
assert.match(preferences, /current-password','new-password','one-time-code/);
assert.match(preferences, /SENSITIVE_FIELD/);
assert.match(preferences, /MAX_DRAFT_VALUE = 5000/);
assert.match(preferences, /serialized\.length > 250000/);
assert.match(preferences, /saveDashboardDrafts\(\);[\s\S]*Promise\.resolve\(window\.loadAllData\?\.\(\)\)[\s\S]*window\.loadWorkspaceOnDemand\?\.\(activeTab\)/);
assert.match(preferences, /Date\.now\(\) - lastDraftEditAt < 4000/);
assert.match(preferences, /FAST_TABS\.has\(tabId\) \? 30000 : 120000/);
assert.match(preferences, /allowed = new Set\(\[5000,10000,30000,60000,300000,900000,1800000,3600000,7200000,86400000\]\)/);
assert.match(preferences, /window\.addEventListener\('beforeunload', saveDashboardDrafts\)/);

assert.match(client, /lf_user_preferences_\$\{encodeURIComponent\(currentUser\.username\)\}/);
assert.match(client, /window\.configureDashboardAutoRefresh/);
assert.match(client, /window\.saveDashboardDrafts\?\.\(\)/);
assert.match(client, /window\.restoreDashboardDrafts\?\.\(\)/);
assert.match(client, /window\.clearDashboardDrafts\?\.\(signingOutUsername\)/);

assert.match(serviceWorker, /little-feet-shell-v17/);
assert.match(serviceWorker, /preferences-enhancements\.js\?v=20260925-preferences-v2/);

assert.match(page, /id="loginLanguagePreference"/);
assert.match(preferences, /function setLoginLanguage\(language\)/);
assert.match(preferences, /localStorage\.setItem\('lf_user_preferences'/);
assert.match(preferences, /document\.querySelectorAll\('\[data-lf-i18n\]'\)/);
assert.match(preferences, /initLoginLanguage/);
console.log('Language and draft-safe refresh regression test passed.');
