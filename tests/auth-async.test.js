const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { hashPin, hashPinAsync, matchesPin, matchesPinAsync } = require('../auth-crypto');
const { createLoginVerificationQueue } = require('../lib/auth/login-verification');
(async () => {
  const pin = 'AsyncPasswordCompatibility1';
  const legacy = crypto.scryptSync(pin, 'little-feet-pin-salt', 64).toString('hex');
  for (const hash of [legacy, hashPin(pin), await hashPinAsync(pin)]) {
    assert.equal(await matchesPinAsync(pin, hash), true);
    assert.equal(await matchesPinAsync('wrong', hash), false);
    assert.equal(matchesPin(pin, hash), true);
  }
  assert.equal(await matchesPinAsync(pin, 'invalid'), false);
  let heartbeat = false;
  const timer = setTimeout(() => { heartbeat = true; }, 0);
  await matchesPinAsync(pin, legacy);
  clearTimeout(timer);
  assert.equal(heartbeat, true, 'Password verification must yield the event loop');
  const run = createLoginVerificationQueue(), events = [];
  await Promise.all([run(async () => { events.push('first'); await new Promise(r=>setTimeout(r,10)); events.push('finish'); }), run(() => events.push('second'))]);
  assert.deepEqual(events, ['first','finish','second']);
  await assert.rejects(run(() => { throw new Error('verification failed'); }));
  assert.equal(await run(() => 'recovered'), 'recovered', 'A failed verification must release the queue');
  console.log('Async authentication passed: compatible hashes, responsive event loop, serial lockout turns and error recovery.');
})().catch(error => { console.error(error); process.exitCode=1; });
