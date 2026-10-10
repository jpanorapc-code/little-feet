// Keep attempt counters atomic while scrypt runs in Node's worker pool.
// This preserves the previous serial verification order without blocking GETs.
function createLoginVerificationQueue() {
  let tail = Promise.resolve();
  return async function withLoginVerification(task) {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await task(); }
    finally { release(); }
  };
}
module.exports = { createLoginVerificationQueue };
