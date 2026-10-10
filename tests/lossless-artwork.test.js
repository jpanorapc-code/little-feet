const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const records = require('./fixtures/lossless-artwork.json');
for (const record of records) {
  const original = fs.readFileSync(path.join(root, record.source));
  const encoded = fs.readFileSync(path.join(root, record.target));
  assert.equal(crypto.createHash('sha256').update(original).digest('hex'), record.sourceSha256);
  assert.equal(crypto.createHash('sha256').update(encoded).digest('hex'), record.targetSha256);
  if(record.target.endsWith('.webp')) {
    assert.equal(encoded.toString('ascii', 0, 4), 'RIFF');
    assert.equal(encoded.toString('ascii', 8, 12), 'WEBP');
  } else assert.equal(encoded.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(encoded.length < original.length);
}
console.log(`Lossless artwork integrity passed: ${records.length} verified original/encoded pairs, ${records.reduce((sum,record)=>sum+record.beforeBytes-record.afterBytes,0)} bytes saved; decoded pixel equality is checked by the generation pipeline and browser test.`);
