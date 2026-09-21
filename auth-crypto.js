const crypto = require('crypto');

const CURRENT_PIN_HASH_VERSION = 'scrypt-v1';
const LEGACY_PIN_SALT = 'little-feet-pin-salt';
const SCRYPT_KEY_LENGTH = 64;

const derivePinHash = (pin, salt) => crypto.scryptSync(String(pin), salt, SCRYPT_KEY_LENGTH).toString('hex');

const hashPin = (pin) => {
  const salt = crypto.randomBytes(16).toString('base64url');
  return `${CURRENT_PIN_HASH_VERSION}$${salt}$${derivePinHash(pin, salt)}`;
};

const matchesPin = (pin, storedHash) => {
  const encoded = String(storedHash || '');
  const parts = encoded.split('$');
  let expectedHex = encoded;
  let actualHex;

  if (parts.length === 3 && parts[0] === CURRENT_PIN_HASH_VERSION) {
    const [, salt, hash] = parts;
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(salt) || !/^[a-f0-9]{128}$/i.test(hash)) return false;
    expectedHex = hash;
    actualHex = derivePinHash(pin, salt);
  } else {
    if (!/^[a-f0-9]{128}$/i.test(expectedHex)) return false;
    actualHex = derivePinHash(pin, LEGACY_PIN_SALT);
  }

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
};

const pinHashNeedsUpgrade = (storedHash) => !String(storedHash || '').startsWith(`${CURRENT_PIN_HASH_VERSION}$`);

module.exports = { hashPin, matchesPin, pinHashNeedsUpgrade };
