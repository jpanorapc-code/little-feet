const crypto = require('crypto');

const CURRENT_PIN_HASH_VERSION = 'scrypt-v1';
const LEGACY_PIN_SALT = 'little-feet-pin-salt';
const SCRYPT_KEY_LENGTH = 64;

const derivePinHash = (pin, salt) => crypto.scryptSync(String(pin), salt, SCRYPT_KEY_LENGTH).toString('hex');
const derivePinHashAsync = (pin, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(String(pin), salt, SCRYPT_KEY_LENGTH, (error, key) => error ? reject(error) : resolve(key.toString('hex')));
});

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
const hashPinAsync = async pin => {
  const salt = crypto.randomBytes(16).toString('base64url');
  return `${CURRENT_PIN_HASH_VERSION}$${salt}$${await derivePinHashAsync(pin, salt)}`;
};
const matchesPinAsync = async (pin, storedHash) => {
  const encoded = String(storedHash || '');
  const parts = encoded.split('$');
  const versioned = parts.length === 3 && parts[0] === CURRENT_PIN_HASH_VERSION;
  const expectedHex = versioned ? parts[2] : encoded;
  if (!/^[a-f0-9]{128}$/i.test(expectedHex) || (versioned && !/^[A-Za-z0-9_-]{16,128}$/.test(parts[1]))) return false;
  const actual = Buffer.from(await derivePinHashAsync(pin, versioned ? parts[1] : LEGACY_PIN_SALT), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
};

module.exports = { hashPin, matchesPin, pinHashNeedsUpgrade, hashPinAsync, matchesPinAsync };
