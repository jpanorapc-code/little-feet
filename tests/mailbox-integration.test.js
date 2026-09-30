'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  decodeMimeWords,
  extractMimeText,
  gmailPayloadText,
  fetchGmailMessages,
  fetchMicrosoftMessages,
  fetchImapMessages
} = require('../lib/mailbox-integration');

(async () => {
  assert.equal(decodeMimeWords('=?UTF-8?B?SGVsbG8=?='), 'Hello');

  const multipart = '--b\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nHello=20world\r\n--b--\r\n';
  assert.equal(extractMimeText({ 'content-type': 'multipart/alternative; boundary="b"' }, multipart), 'Hello world');

  assert.equal(
    gmailPayloadText({ mimeType:'text/plain', body:{ data:Buffer.from('Hello Gmail').toString('base64url') } }),
    'Hello Gmail'
  );

  const gmailFetch = async (url, options = {}) => {
    const target = String(url);
    assert.equal(options.headers.Authorization, 'Bearer token');
    if (target.includes('/messages?')) return { ok:true, json:async()=>({ messages:[{ id:'g1' }] }) };
    if (target.includes('/messages/g1')) return {
      ok:true,
      json:async()=>({
        id:'g1',
        threadId:'t1',
        internalDate:String(Date.parse('2026-09-30T10:00:00Z')),
        payload:{
          mimeType:'text/plain',
          headers:[
            { name:'Subject', value:'Gmail subject' },
            { name:'From', value:'Sender <a@example.com>' },
            { name:'Date', value:'Wed, 30 Sep 2026 10:00:00 +0000' }
          ],
          body:{ data:Buffer.from('Gmail body').toString('base64url') }
        }
      })
    };
    throw new Error('Unexpected Gmail URL');
  };
  const gmail = await fetchGmailMessages({ accessToken:'token', fetchImpl:gmailFetch });
  assert.equal(gmail.length, 1);
  assert.equal(gmail[0].subject, 'Gmail subject');
  assert.equal(gmail[0].body, 'Gmail body');

  const microsoftFetch = async (_url, options = {}) => {
    assert.equal(options.headers.Authorization, 'Bearer token');
    return {
      ok:true,
      json:async()=>({ value:[{
        id:'m1',
        subject:'Microsoft subject',
        from:{ emailAddress:{ name:'Sender', address:'s@example.com' } },
        receivedDateTime:'2026-09-30T11:00:00Z',
        body:{ contentType:'html', content:'<p>Hello <b>Microsoft</b></p>' },
        webLink:'https://outlook.office.com/mail/inbox/id/m1'
      }] })
    };
  };
  const microsoft = await fetchMicrosoftMessages({ accessToken:'token', fetchImpl:microsoftFetch });
  assert.equal(microsoft.length, 1);
  assert.equal(microsoft[0].subject, 'Microsoft subject');
  assert.match(microsoft[0].body, /Hello\s+Microsoft/);

  class FakeSocket extends EventEmitter {
    constructor() {
      super();
      process.nextTick(() => {
        this.emit('secureConnect');
        setImmediate(() => this.emit('data', Buffer.from('* OK ready\r\n')));
      });
    }
    write(data) {
      const line = String(data).trim();
      const tag = line.split(' ')[0];
      if (line.includes(' LOGIN ')) setImmediate(() => this.emit('data', Buffer.from(tag + ' OK LOGIN completed\r\n')));
      else if (line.includes(' SELECT INBOX')) setImmediate(() => this.emit('data', Buffer.from('* 2 EXISTS\r\n' + tag + ' OK SELECT completed\r\n')));
      else if (line.includes(' UID SEARCH SINCE ')) setImmediate(() => this.emit('data', Buffer.from('* SEARCH 10 11\r\n' + tag + ' OK SEARCH completed\r\n')));
      else if (line.includes(' UID FETCH 11 ')) this.replyFetch(tag, 11, 'Newest', 'Newest body', '12:00:00');
      else if (line.includes(' UID FETCH 10 ')) this.replyFetch(tag, 10, 'Older', 'Older body', '11:00:00');
      else if (line.includes(' LOGOUT')) setImmediate(() => this.emit('data', Buffer.from('* BYE\r\n' + tag + ' OK LOGOUT completed\r\n')));
      else throw new Error('Unexpected IMAP command');
      return true;
    }
    replyFetch(tag, uid, subject, body, time) {
      const headers = [
        'From: Sender <sender@example.com>',
        'Subject: ' + subject,
        'Date: Wed, 30 Sep 2026 ' + time + ' +0000',
        'Message-ID: <' + uid + '@example.com>',
        'Content-Type: text/plain; charset=utf-8',
        '',
        ''
      ].join('\r\n');
      setImmediate(() => this.emit('data', Buffer.from(
        '* ' + uid + ' FETCH (UID ' + uid + ' BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] {' + Buffer.byteLength(headers) + '}\r\n' +
        headers +
        ' BODY[TEXT]<0> {' + Buffer.byteLength(body) + '}\r\n' +
        body + ')\r\n' +
        tag + ' OK FETCH completed\r\n'
      )));
    }
    end() {}
    destroy() {}
  }

  const imap = await fetchImapMessages({
    host:'imap.example.com',
    port:993,
    address:'user@example.com',
    password:'app-password',
    connect:()=>new FakeSocket(),
    limit:2
  });
  assert.equal(imap.length, 2);
  assert.equal(imap[0].subject, 'Newest');
  assert.equal(imap[0].body, 'Newest body');
  assert.equal(imap[1].subject, 'Older');

  console.log('Mailbox integration regression test passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
