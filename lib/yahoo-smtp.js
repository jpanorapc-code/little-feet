'use strict';

const tls = require('node:tls');
const crypto = require('node:crypto');
const COMMAND_TIMEOUT_MS = 25000;

const smtpLine = value => String(value || '').replace(/[\r\n]+/g, ' ').trim();
const readReply = socket => new Promise((resolve, reject) => {
  let buffer = '';
  const timer = setTimeout(() => finish(new Error('Yahoo SMTP command timed out.')), COMMAND_TIMEOUT_MS);
  const finish = (error, value) => { clearTimeout(timer); socket.off('data', onData); socket.off('error', onError); error ? reject(error) : resolve(value); };
  const onError = error => finish(error);
  const onData = chunk => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/).filter(Boolean);
    const last = lines[lines.length - 1] || '';
    if (/^\d{3} /.test(last)) finish(null, { code: Number(last.slice(0, 3)), text: buffer });
  };
  socket.on('data', onData); socket.once('error', onError);
});

const sendYahooSmtp = async ({ email, accessToken, to, subject, text, tlsConnect = tls.connect }) => {
  const socket = tlsConnect({ host: 'smtp.mail.yahoo.com', port: 465, servername: 'smtp.mail.yahoo.com', rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  socket.setTimeout(COMMAND_TIMEOUT_MS, () => socket.destroy(new Error('Yahoo SMTP socket timed out.')));
  const command = async (value, accepted) => {
    const pending = readReply(socket); socket.write(value + '\r\n'); const reply = await pending;
    if (!accepted.includes(reply.code)) throw new Error(`Yahoo SMTP rejected ${value.split(/\s+/)[0]} with ${reply.code}.`);
    return reply;
  };
  try {
    const greeting = await readReply(socket); if (greeting.code !== 220) throw new Error('Yahoo SMTP did not return a valid greeting.');
    await command('EHLO littlefeet.co.za', [250]);
    const xoauth = Buffer.from(`user=${email}\x01auth=Bearer ${accessToken}\x01\x01`, 'utf8').toString('base64');
    await command('AUTH XOAUTH2 ' + xoauth, [235]);
    await command(`MAIL FROM:<${email}>`, [250]);
    await command(`RCPT TO:<${to}>`, [250, 251]);
    await command('DATA', [354]);
    const id = `<${crypto.randomUUID()}@littlefeet.co.za>`;
    const message = [`From: ${email}`, `To: ${to}`, `Subject: ${smtpLine(subject)}`, `Message-ID: ${id}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', String(text || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')].join('\r\n');
    await command(message + '\r\n.', [250]);
    await command('QUIT', [221]).catch(() => {});
    return { id };
  } finally { socket.end(); }
};

module.exports = { sendYahooSmtp };
