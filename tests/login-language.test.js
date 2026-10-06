const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const preferences = fs.readFileSync(path.join(root, 'assets', 'preferences-enhancements.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'backup.js'), 'utf8');
const ambient = fs.readFileSync(path.join(root, 'assets', 'ambient-background.js'), 'utf8');

const extractFrozenObject = (source, name) => {
  const pattern = new RegExp('const\\s+' + name + '\\s*=\\s*Object\\.freeze\\((\\{[\\s\\S]*?\\})\\);');
  const match = source.match(pattern);
  assert.ok(match, name + ' must remain a literal Object.freeze translation map');
  return vm.runInNewContext('(' + match[1] + ')');
};

const base = extractFrozenObject(preferences, 'LANGUAGE_PACKS');
const auth = extractFrozenObject(preferences, 'AUTH_LANGUAGE_PACKS');
const languages = ['en','af','zu','xh','nso','st','tn','ss','ve','ts','nr'];

assert.deepEqual(Object.keys(auth).sort(), languages.slice().sort(), 'Every supported login language must have an auth translation pack');

const authKeys = [
  'tagline','displayLanguage','soundOn','muted','playBackground','pauseBackground',
  'backgroundUnavailable','reducedMotionBackground','usernamePlaceholder','showPassword',
  'hidePassword','securityCheck','loadingSecurityCheck','retryingSecurityCheck',
  'securityUnavailable','answerPlaceholder','newCheck','humanCheckQuestion','providerLabel',
  'continueGoogle','continueYahoo','continueMicrosoft','aboutLittleFeet','tickerPlatform',
  'tickerLearning','tickerAttendance','tickerFamily','tickerFinance','tickerSafeguarding',
  'tickerConnected'
];
const existingLoginKeys = [
  'securePortal','accessNote','usernameLabel','passwordLabel','rememberEmail','loginHelp',
  'signIn','otherSignIn','newAccount','createAccount','privacyLink','termsLink'
];

for (const language of languages) {
  for (const key of authKeys) {
    assert.equal(typeof auth[language]?.[key], 'string', language + ' missing login translation: ' + key);
    assert.ok(auth[language][key].trim(), language + ' has empty login translation: ' + key);
  }
  if (language !== 'en') {
    for (const key of existingLoginKeys) {
      assert.equal(typeof base[language]?.[key], 'string', language + ' missing existing login translation: ' + key);
      assert.ok(base[language][key].trim(), language + ' has empty existing login translation: ' + key);
    }
    for (const key of authKeys) {
      assert.notEqual(auth[language][key], auth.en[key], language + ' silently falls back to English for ' + key);
    }
  }
}

const visibleAuthKeys = [
  'tagline','securePortal','accessNote','usernameLabel','passwordLabel','securityCheck',
  'loadingSecurityCheck','newCheck','rememberEmail','loginHelp','signIn','otherSignIn',
  'continueGoogle','continueYahoo','continueMicrosoft','newAccount','createAccount',
  'privacyLink','termsLink','aboutLittleFeet','tickerPlatform','tickerLearning',
  'tickerAttendance','tickerFamily','tickerFinance','tickerSafeguarding','tickerConnected'
];
for (const key of visibleAuthKeys) {
  assert.match(page, new RegExp('data-lf-i18n=["\\\']' + key + '["\\\']'), 'Login page must wire visible text to translation key ' + key);
}
assert.match(page, /data-lf-i18n-placeholder="usernamePlaceholder"/);
assert.match(page, /data-lf-i18n-placeholder="answerPlaceholder"/);
assert.match(page, /data-lf-i18n-aria-label="displayLanguage"/);
assert.match(page, /data-lf-i18n-aria-label="providerLabel"/);
assert.match(page, /data-lf-i18n-title="displayLanguage"/);
assert.match(preferences, /data-lf-i18n-placeholder/);
assert.match(preferences, /data-lf-i18n-aria-label/);
assert.match(preferences, /humanCheckQuestion/);
assert.match(client, /translateLittleFeetText\?\.\('loadingSecurityCheck'\)/);
assert.match(client, /translateLittleFeetText\?\.\('humanCheckQuestion'/);
assert.match(client, /littlefeet:languagechange/);
assert.match(ambient, /translateLittleFeetText\?\.\(key\)/);
assert.match(ambient, /littlefeet:languagechange/);

console.log('Login language coverage test passed for all supported languages.');
