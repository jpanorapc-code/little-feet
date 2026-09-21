const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hashPin, matchesPin, pinHashNeedsUpgrade } = require('../auth-crypto');

const first = hashPin('CorrectHorseBatteryStaple');
const second = hashPin('CorrectHorseBatteryStaple');

assert.notEqual(first, second, 'Matching passwords must receive different random salts.');
assert.match(first, /^scrypt-v1\$[A-Za-z0-9_-]+\$[a-f0-9]{128}$/);
assert.equal(matchesPin('CorrectHorseBatteryStaple', first), true);
assert.equal(matchesPin('incorrect', first), false);
assert.equal(pinHashNeedsUpgrade(first), false);

const legacy = crypto.scryptSync('LegacyPass1', 'little-feet-pin-salt', 64).toString('hex');
assert.equal(matchesPin('LegacyPass1', legacy), true);
assert.equal(matchesPin('incorrect', legacy), false);
assert.equal(pinHashNeedsUpgrade(legacy), true);
assert.equal(matchesPin('anything', 'invalid-hash'), false);

console.log('Authentication hash migration test passed.');
