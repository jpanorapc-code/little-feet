'use strict';

const assert = require('node:assert/strict');
const {
  buildOauthBearerPayload,
  parseUidValidity,
  parseSearchUids,
  parseFetchMessages
} = require('../lib/yahoo-imap');

const encoded = buildOauthBearerPayload({
  email: 'user@yahoo.com',
  accessToken: 'abc123'
});
const decoded = Buffer.from(encoded, 'base64').toString('utf8');
assert.equal(decoded, 'n,a=user@yahoo.com,\x01host=imap.mail.yahoo.com\x01port=993\x01auth=Bearer abc123\x01\x01');

assert.equal(parseUidValidity('* OK [UIDVALIDITY 987654] UIDs valid\r\nA0001 OK done\r\n'), '987654');
assert.deepEqual(parseSearchUids('* SEARCH 1 9 3 20\r\nA0002 OK done\r\n'), [1, 3, 9, 20]);

const header = 'From: Sender <sender@example.com>\r\nSubject: Yahoo test\r\nDate: Wed, 30 Sep 2026 10:00:00 +0000\r\nMessage-ID: <m1@example.com>\r\n\r\n';
const body = 'This is a Yahoo preview.';
const response = '* 1 FETCH (UID 42 INTERNALDATE "30-Sep-2026 10:00:00 +0000" BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] {' + Buffer.byteLength(header, 'latin1') + '}\r\n' + header + ' BODY[TEXT]<0> {' + Buffer.byteLength(body, 'latin1') + '}\r\n' + body + ')\r\nA0003 OK done\r\n';
const messages = parseFetchMessages({ response, uidValidity: '777' });
assert.equal(messages.length, 1);
assert.equal(messages[0].id, '777:42');
assert.equal(messages[0].subject, 'Yahoo test');
assert.match(messages[0].from, /sender@example\.com/);
assert.equal(messages[0].preview, body);

console.log('Yahoo IMAP OAUTHBEARER parser regression test passed.');
