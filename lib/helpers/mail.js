// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const looksLikeEmailAddress = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const accountSecurityEmail = account => {
  const candidates = [account?.email, account?.username, ...(Array.isArray(account?.loginAliases) ? account.loginAliases : [])];
  return candidates.map(value => String(value || '').trim()).find(context.looksLikeEmailAddress) || '';
};

const sendLoginLockoutEmail = async account => {
  const to = context.accountSecurityEmail(account);
  if (!to) return false;
  return context.sendLittleFeetEmail({
    to,
    subject: 'Little Feet sign-in temporarily locked',
    text: [
      `Hello ${String(account?.name || 'Little Feet user').trim()},`,
      '',
      'Little Feet blocked sign-in attempts to your account for 10 minutes after three unsuccessful password or PIN attempts.',
      `Lock started: ${new Date().toISOString()}`,
      '',
      'If this was you, wait 10 minutes before trying again.',
      'If this was not you, contact your school administrator and change your password or PIN as soon as you can.',
      '',
      'Little Feet security'
    ].join('\n')
  });
};

const sendSuccessfulLoginEmail = async (req, account, authMethod = 'password') => {
  const to = context.accountSecurityEmail(account);
  if (!to) return false;
  const requestSummary = context.loginSecurityRequestSummary(req);
  const signedInAt = new Date().toISOString();
  const accountName = String(account?.name || 'Little Feet user').trim();
  const imageUrl = 'https://littlefeet.co.za/assets/security/login-security-alert.jpg';
  const text = [
    `Hello ${accountName},`,
    '',
    'A successful sign-in to your Little Feet account was detected.',
    `Time: ${signedInAt}`,
    `Sign-in method: ${authMethod}`,
    `Network address: ${requestSummary.network}`,
    `Browser/device: ${requestSummary.device}`,
    '',
    'If this was you, no action is needed.',
    'If this was not you, change your password or PIN and contact your school administrator immediately.',
    '',
    'Little Feet security'
  ].join('\n');
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#071426;font-family:Arial,Helvetica,sans-serif;color:#eef7ff;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#071426;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#0d2038;border:1px solid #1f4d70;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:0;">
            <img src="${imageUrl}" width="620" alt="Little Feet login security alert" style="display:block;width:100%;max-width:620px;height:auto;border:0;">
          </td></tr>
          <tr><td style="padding:24px 28px 28px;">
            <div style="font-size:22px;font-weight:700;color:#ffffff;margin-bottom:14px;">New sign-in detected</div>
            <p style="margin:0 0 16px;line-height:1.6;color:#d8e9f7;">Hello ${context.emailHtmlText(accountName)},</p>
            <p style="margin:0 0 18px;line-height:1.6;color:#d8e9f7;">A successful sign-in to your Little Feet account was detected.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#09192c;border-radius:10px;margin:0 0 18px;">
              <tr><td style="padding:14px 16px;color:#b9d5e9;line-height:1.7;">
                <strong style="color:#ffffff;">Time:</strong> ${context.emailHtmlText(signedInAt)}<br>
                <strong style="color:#ffffff;">Sign-in method:</strong> ${context.emailHtmlText(authMethod)}<br>
                <strong style="color:#ffffff;">Network address:</strong> ${context.emailHtmlText(requestSummary.network)}<br>
                <strong style="color:#ffffff;">Browser/device:</strong> ${context.emailHtmlText(requestSummary.device)}
              </td></tr>
            </table>
            <p style="margin:0 0 8px;line-height:1.6;color:#d8e9f7;">If this was you, no action is needed.</p>
            <p style="margin:0;line-height:1.6;color:#ffd4d4;"><strong>If this was not you:</strong> change your password or PIN and contact your school administrator immediately.</p>
            <p style="margin:22px 0 0;color:#7fb4d7;font-size:13px;">Little Feet security</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  return context.sendLittleFeetEmail({
    to,
    subject: 'Little Feet security: new sign-in',
    text,
    html
  });
};

const emailInboxVisibleTo = (item, actor) => item && context.normalizeUsername(item.username) === context.normalizeUsername(actor.username) && (item.type === 'Email' || context.recordInSchool(item, actor));

const emailSourceKey = item => `${item.type}:${item.sourceId}`;

const dismissEmailSource = (actor, item) => {
  if (!item?.sourceId) return;
  const key = context.emailSourceKey(item);
  if (!context.tenantRecords(context.db.emailDismissals, actor).some(entry => context.normalizeUsername(entry.username) === context.normalizeUsername(actor.username) && entry.sourceKey === key)) {
    context.db.emailDismissals.unshift(context.tagSchoolRecord(actor, { id: context.crypto.randomUUID(), username: actor.username, sourceKey: key, dismissedAt: new Date().toISOString() }));
  }
};

const addEmailInboxItem = (actor, data) => {
  if (!actor) return null;
  const item = context.tagSchoolRecord(actor, {
    id: context.crypto.randomUUID(), username: actor.username, type: context.boundedText(data.type || 'Notification', 40),
    title: context.boundedText(data.title || 'Little Feet notification', 200), message: context.boundedText(data.message, 4000),
    sourceId: context.boundedText(data.sourceId, 160), sourceTab: context.boundedText(data.sourceTab, 80),
    sender: context.boundedText(data.sender, 300), provider: context.boundedText(data.provider, 40),
    providerLink: context.safeHttpsUrl(data.providerLink) || '',
    read: false, pinned: false,
    createdAt: data.createdAt && !Number.isNaN(Date.parse(data.createdAt)) ? new Date(data.createdAt).toISOString() : new Date().toISOString()
  });
  context.db.emailInbox.unshift(item); return item;
};

const emailInboxPreferenceDefaults = actor => {
  const role = String(actor?.role || '');
  if (context.hasPlatformAccess(actor)) return { mail:true, tickets:true, messages:true, notices:true, alerts:true };
  if (role === 'parent') return { mail:true, tickets:true, messages:true, payments:true, subscriptions:true };
  if (role === 'district') return { mail:true, tickets:true, alerts:true };
  if (role === 'crm' || role === 'support') return { mail:true, tickets:true, messages:true };
  if (role === 'school_accounts') return { mail:true, tickets:true };
  return { mail:true, tickets:true, messages:true, notices:true, alerts:true };
};

const emailInboxPreferenceKeys = actor => Object.keys(context.emailInboxPreferenceDefaults(actor));

const emailInboxPreferencesFor = actor => context.emailInboxPreferenceDefaults(actor);

const emailInboxTypeKey = type => ({
  Email:'mail', Ticket:'tickets', Message:'messages', Notice:'notices', Alert:'alerts', Payment:'payments', Subscription:'subscriptions'
})[type] || '';

const emailInboxTypeEnabled = (actor, type) => {
  const key = context.emailInboxTypeKey(type);
  if (!key || !context.emailInboxPreferenceKeys(actor).includes(key)) return false;
  return context.emailInboxPreferencesFor(actor)[key] !== false;
};

const buildEmailInbox = actor => {
  const isParent = actor?.role === 'parent';
  const parentUsername = context.normalizeUsername(actor?.username);
  const parentAllowedTypes = new Set(['Email', 'Ticket', 'Message', 'Payment', 'Subscription']);

  // Parent inboxes are deliberately isolated from staff notices, internal school alerts,
  // and other operational material. Remove any legacy items that were created before
  // this boundary existed so old data cannot keep leaking into a parent account.
  if (isParent) {
    context.db.emailInbox = context.db.emailInbox.filter(item => !context.emailInboxVisibleTo(item, actor) || parentAllowedTypes.has(item.type));
  }

  const openTicketIds = new Set(
    context.tenantRecords(context.db.tickets, actor)
      .filter(ticket => ticket.status !== 'Completed' && (!isParent || context.normalizeUsername(ticket.createdBy) === parentUsername))
      .map(ticket => ticket.id)
  );
  context.db.emailInbox = context.db.emailInbox.filter(item => !(context.emailInboxVisibleTo(item, actor) && item.type === 'Ticket' && !openTicketIds.has(item.sourceId)));

  const existing = context.tenantRecords(context.db.emailInbox, actor)
    .filter(item => context.emailInboxVisibleTo(item, actor))
    .filter(item => !isParent || parentAllowedTypes.has(item.type))
    .filter(item => context.emailInboxTypeEnabled(actor, item.type));
  const known = new Set(existing.map(item => item.type + ':' + item.sourceId));
  const dismissed = new Set(context.tenantRecords(context.db.emailDismissals, actor).filter(item => context.normalizeUsername(item.username) === parentUsername).map(item => item.sourceKey));
  const add = (type, sourceId, title, message, sourceTab) => {
    if (!context.emailInboxTypeEnabled(actor, type)) return;
    const key=type+':'+sourceId;if(!sourceId||known.has(key)||dismissed.has(key))return;
    const item=context.addEmailInboxItem(actor,{type,sourceId,title,message,sourceTab});if(item){existing.push(item);known.add(key);}
  };

  if (isParent) {
    // Parent-facing only: their own support requests, messages addressed to them,
    // their payment requests and their own LittleSteps subscription activity.
    context.tenantRecords(context.db.tickets, actor)
      .filter(t => t.status !== 'Completed' && context.normalizeUsername(t.createdBy) === parentUsername)
      .forEach(t => add('Ticket', t.id, t.subject, t.feedback || t.message || 'Support ticket update', 'ticketsTab'));
    context.tenantRecords(context.db.directMessages, actor)
      .filter(m => context.normalizeUsername(m.recipient) === parentUsername)
      .forEach(m => add('Message', m.id, 'Message from ' + (m.sender || 'Little Feet'), m.message, 'chatTab'));
    (context.db.parentPayments || [])
      .filter(record => context.recordInSchool(record, actor) && context.normalizeUsername(record.parentUsername) === parentUsername)
      .forEach(record => add(
        'Payment',
        record.id,
        record.description || 'Parent payment request',
        `${record.learnerName ? record.learnerName + ' · ' : ''}${record.reference || 'Payment'} · ${String(record.paymentStatus || 'awaiting payment').replaceAll('_',' ')}`,
        'parentPaymentsTab'
      ));
    (context.db.parentSubscriptions || [])
      .filter(record => context.recordInSchool(record, actor) && context.normalizeUsername(record.parentUsername) === parentUsername)
      .forEach(record => add(
        'Subscription',
        record.id,
        'LittleSteps subscription',
        `${record.reference || 'Subscription'} · ${String(record.paymentStatus || 'awaiting payment').replaceAll('_',' ')}`,
        'parentPaymentsTab'
      ));
    return existing.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  context.tenantRecords(context.db.tickets, actor).filter(t=>t.status!=='Completed'&&(context.normalizeUsername(t.createdBy)===parentUsername||context.normalizeUsername(t.assignedTo)===parentUsername))
    .forEach(t=>add('Ticket',t.id,t.subject,t.feedback||t.message||'Support ticket update','ticketsTab'));
  context.tenantRecords(context.db.staffNotices, actor).filter(n=>n.audience==='All staff'||n.audience===actor.role)
    .forEach(n=>add('Notice',n.id,n.title,n.message,'staffNoticesTab'));
  context.tenantRecords(context.db.directMessages, actor).filter(m=>context.normalizeUsername(m.recipient)===parentUsername)
    .forEach(m=>add('Message',m.id,'Message from '+(m.sender||'Little Feet'),m.message,'chatTab'));
  context.tenantRecords(context.db.broadcasts, actor).forEach(b=>add('Alert',b.id,b.bcPriority||'School alert',b.bcMessage,'broadcastsTab'));
  return existing.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
};

const emailHeaderText = value => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);

const smtpConfig = () => {
  const port = Number(process.env.LF_SMTP_PORT || 465);
  return {
    host: String(process.env.LF_SMTP_HOST || '').trim(),
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 465,
    username: String(process.env.LF_SMTP_USERNAME || '').trim(),
    password: String(process.env.LF_SMTP_PASSWORD || ''),
    from: String(process.env.LF_EMAIL_FROM || process.env.LF_SMTP_USERNAME || '').trim(),
    fromName: context.emailHeaderText(process.env.LF_EMAIL_FROM_NAME || 'Little Feet')
  };
};

const smtpEmailConfigured = () => {
  const config = context.smtpConfig();
  return Boolean(config.host && config.username && config.password && context.looksLikeEmailAddress(config.from));
};

const apiEmailConfigured = () => Boolean(
  context.looksLikeEmailAddress(process.env.LF_EMAIL_FROM) &&
  String(process.env.LF_EMAIL_API_KEY || '').trim()
);

const emailDeliveryProvider = () => {
  if (context.smtpEmailConfigured()) {
    const host = context.smtpConfig().host.toLowerCase();
    return host.includes('zoho') ? 'Zoho SMTP' : 'SMTP';
  }
  if (context.apiEmailConfigured()) return 'Email API';
  return 'Not configured';
};

const emailHtmlText = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const smtpSend = async ({to,subject,text,html}) => {
  const config = context.smtpConfig();
  if (!context.smtpEmailConfigured()) return false;
  if (config.port !== 465) throw new Error('Little Feet SMTP currently requires implicit TLS on port 465.');

  const responseQueue = [];
  const waiters = [];
  let lineBuffer = '';
  let responseLines = [];
  let terminalError = null;

  const deliver = response => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(response);
    else responseQueue.push(response);
  };
  const failAll = error => {
    if (terminalError) return;
    terminalError = error instanceof Error ? error : new Error(String(error || 'SMTP connection failed.'));
    while (waiters.length) waiters.shift().reject(terminalError);
  };
  const nextResponse = () => {
    if (responseQueue.length) return Promise.resolve(responseQueue.shift());
    if (terminalError) return Promise.reject(terminalError);
    return new Promise((resolve,reject)=>waiters.push({resolve,reject}));
  };
  const expect = async (allowed, label) => {
    const response = await nextResponse();
    if (!allowed.includes(response.code)) throw new Error(`SMTP ${label} failed with ${response.code}: ${response.text}`);
    return response;
  };

  const socket = context.tls.connect({
    host: config.host,
    port: config.port,
    servername: config.host,
    rejectUnauthorized: true
  });
  socket.setTimeout(15000, () => {
    const error = new Error('SMTP connection timed out.');
    failAll(error);
    socket.destroy(error);
  });
  socket.on('error', failAll);
  socket.on('close', () => {
    if (waiters.length && !terminalError) failAll(new Error('SMTP connection closed unexpectedly.'));
  });
  socket.on('data', chunk => {
    lineBuffer += chunk.toString('utf8');
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line) continue;
      responseLines.push(line);
      if (/^\d{3} /.test(line)) {
        const code = Number(line.slice(0,3));
        deliver({ code, text: responseLines.join(' | ').slice(0,1200) });
        responseLines = [];
      }
    }
  });

  try {
    await new Promise((resolve,reject)=>{
      if (socket.authorized) return resolve();
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    await expect([220], 'greeting');
    const command = async (value, allowed, label) => {
      socket.write(`${value}\r\n`);
      return expect(allowed, label);
    };
    await command('EHLO littlefeet.co.za', [250], 'EHLO');
    await command('AUTH LOGIN', [334], 'authentication');
    await command(Buffer.from(config.username).toString('base64'), [334], 'username');
    await command(Buffer.from(config.password).toString('base64'), [235], 'password');
    await command(`MAIL FROM:<${config.from}>`, [250], 'sender');
    await command(`RCPT TO:<${to}>`, [250,251], 'recipient');
    await command('DATA', [354], 'data');

    const cleanSubject = context.emailHeaderText(subject || 'Little Feet');
    const cleanText = String(text || '').replace(/\r?\n/g, '\r\n');
    const cleanHtml = String(html || '').replace(/\r?\n/g, '\r\n');
    const fromHeader = config.fromName ? `${config.fromName} <${config.from}>` : config.from;
    const messageHeaders = [
      `From: ${fromHeader}`,
      `To: ${to}`,
      `Subject: ${cleanSubject}`,
      'MIME-Version: 1.0',
      `Date: ${new Date().toUTCString()}`
    ];
    let messageBody;
    if (cleanHtml) {
      const boundary = `lf-alt-${context.crypto.randomBytes(12).toString('hex')}`;
      messageHeaders.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
      messageBody = [
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        cleanText,
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        cleanHtml,
        `--${boundary}--`
      ].join('\r\n');
    } else {
      messageHeaders.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit');
      messageBody = cleanText;
    }
    const message = `${messageHeaders.join('\r\n')}\r\n\r\n${messageBody}`.replace(/^\./gm, '..');
    socket.write(`${message}\r\n.\r\n`);
    await expect([250], 'message delivery');
    socket.write('QUIT\r\n');
    await expect([221], 'QUIT').catch(()=>{});
    socket.end();
    return true;
  } catch (error) {
    socket.destroy();
    throw error;
  }
};

const sendLittleFeetEmail = async ({to,subject,text,html}) => {
  if (!context.looksLikeEmailAddress(to)) return false;
  if (context.smtpEmailConfigured()) return context.smtpSend({to,subject,text,html});

  const from=String(process.env.LF_EMAIL_FROM||'').trim(),apiKey=String(process.env.LF_EMAIL_API_KEY||'').trim();
  if(!context.looksLikeEmailAddress(from)||!apiKey)return false;
  const rawEndpoint=String(process.env.LF_EMAIL_API_URL||'https://api.resend.com/emails').trim();
  const testLoopbackEndpoint=process.env.NODE_ENV==='test' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(rawEndpoint)
    ? rawEndpoint
    : '';
  const endpoint=context.safeHttpsUrl(rawEndpoint)||testLoopbackEndpoint;
  if(!endpoint)throw new Error('Invalid LF_EMAIL_API_URL');
  const payload={from,to:[to],subject:context.emailHeaderText(subject),text:String(text||'')};
  if(String(html||'').trim())payload.html=String(html);
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(payload)});
  if(!response.ok)throw new Error(`Email provider returned HTTP ${response.status}`);
  return true;
};

const inboundEmailDomain = () => {
  const value = String(process.env.LF_INBOUND_EMAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, '');
  return /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && value.includes('.') ? value : '';
};

const inboundEmailApiKey = () => String(process.env.LF_INBOUND_EMAIL_API_KEY || process.env.LF_EMAIL_API_KEY || '').trim();

const inboundEmailConfigured = () => Boolean(
  context.inboundEmailDomain()
  && context.inboundEmailApiKey()
  && /^whsec_[A-Za-z0-9+/=_-]+$/.test(context.inboundWebhookSecret())
);

const validForwardingAlias = value => /^lf-[a-f0-9]{24}$/.test(String(value || ''));

const forwardingAddressFor = actor => {
  const domain = context.inboundEmailDomain();
  const alias = actor?.emailForwarding?.aliasToken;
  return domain && context.validForwardingAlias(alias) ? String(alias).toLowerCase() + '@' + domain : '';
};

const publicForwardingStatus = actor => ({
  configured: context.inboundEmailConfigured(),
  address: context.forwardingAddressFor(actor),
  createdAt: actor?.emailForwarding?.createdAt || null,
  lastReceivedAt: actor?.emailForwarding?.lastReceivedAt || null
});

const ensureForwardingAddress = actor => {
  if (!actor) return '';
  if (!actor.emailForwarding || !context.validForwardingAlias(actor.emailForwarding.aliasToken)) {
    actor.emailForwarding = {
      aliasToken: 'lf-' + context.crypto.randomBytes(12).toString('hex'),
      createdAt: new Date().toISOString(),
      lastReceivedAt: null
    };
  }
  return context.forwardingAddressFor(actor);
};

const forwardingActorForRecipients = recipients => {
  const addresses = new Set((Array.isArray(recipients) ? recipients : [])
    .map(context.normalizeEnvelopeAddress)
    .filter(Boolean));
  return (context.db.users || []).find(account => {
    const address = context.forwardingAddressFor(account);
    return address && addresses.has(address);
  }) || null;
};

const receivedEmailSourceId = emailId => 'resend:' + String(emailId || '').trim();

const mailboxConnectionStatus = actor => {
  const connection = actor?.mailboxConnection;
  const connected = Boolean(connection?.version === 2 && context.MAILBOX_PROVIDERS.has(connection.provider));
  return {
    connected,
    provider: connected ? connection.provider : '',
    email: connected ? connection.email : '',
    connectedAt: connected ? connection.connectedAt : null,
    lastSyncAt: connected ? connection.lastSuccessfulSyncAt || null : null,
    initialSyncComplete: connected ? Boolean(connection.initialSyncComplete) : false,
    lastError: connected ? connection.lastError || '' : '',
    availableProviders: {
      google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
      zoho: Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET),
      yahoo: Boolean(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET)
    }
  };
};

const mailboxSyncLimit = initial => {
  const requested = Number(initial ? process.env.LF_MAILBOX_INITIAL_SYNC_LIMIT : process.env.LF_MAILBOX_SYNC_LIMIT);
  const fallback = initial ? 100 : 50;
  return Math.max(1, Math.min(200, Number.isSafeInteger(requested) ? requested : fallback));
};

const mailboxAccessToken = async actor => {
  const connection = actor?.mailboxConnection;
  if (!connection || connection.version !== 2 || !context.MAILBOX_PROVIDERS.has(connection.provider)) throw new Error('Connect a supported mailbox first.');
  let accessToken = context.decryptField(connection.accessToken);
  if (accessToken && Number(connection.accessTokenExpiresAt || 0) > Date.now() + 60_000) return accessToken;
  const refreshToken = context.decryptField(connection.refreshToken);
  const tokens = await context.refreshMailboxAccessToken({
    provider: connection.provider,
    refreshToken,
    origin: context.publicOrigin(),
    providerMetadata: connection.providerMetadata || {}
  });
  accessToken = String(tokens.access_token || '');
  if (!accessToken) throw new Error('The mailbox provider did not return an access token.');
  connection.accessToken = context.encryptField(accessToken);
  if (tokens.refresh_token) connection.refreshToken = context.encryptField(tokens.refresh_token);
  if (tokens.providerMetadata) connection.providerMetadata = { ...(connection.providerMetadata || {}), ...tokens.providerMetadata };
  connection.accessTokenExpiresAt = Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000;
  return accessToken;
};

const syncConnectedMailbox = async (actor, { initial = false } = {}) => {
  const connection = actor?.mailboxConnection;
  if (!connection) throw new Error('Connect a mailbox first.');
  if (!initial && connection.lastAttemptAt && Date.now() - Date.parse(connection.lastAttemptAt) < 30_000) {
    return { added: 0, skipped: true, lastSyncAt: connection.lastSuccessfulSyncAt || null };
  }
  connection.lastAttemptAt = new Date().toISOString();
  try {
    const accessToken = await context.mailboxAccessToken(actor);
    const limit = context.mailboxSyncLimit(initial);
    const mailboxOptions = {
      provider: connection.provider,
      accessToken,
      limit,
      providerMetadata: connection.providerMetadata || {}
    };
    const batches = [await context.fetchMailbox(mailboxOptions)];
    if (!initial && connection.backlogCursor) {
      batches.push(await context.fetchMailbox({ ...mailboxOptions, cursor: connection.backlogCursor }));
    }
    if (!batches[0].email) throw new Error('The mailbox provider did not identify the connected email address.');
    connection.email = context.boundedText(batches[0].email, 254).toLowerCase();
    connection.backlogCursor = initial ? context.boundedText(batches[0].nextCursor, 2000) : context.boundedText(batches[1]?.nextCursor, 2000);
    connection.initialSyncComplete = !connection.backlogCursor;
    let added = 0;
    for (const message of batches.flatMap(batch => batch.messages)) {
      const sourceId = `mailbox:${connection.provider}:${message.id}`;
      const duplicate = (context.db.emailInbox || []).some(item => item.type === 'Email'
        && item.sourceId === sourceId
        && context.normalizeUsername(item.username) === context.normalizeUsername(actor.username));
      if (duplicate) continue;
      context.addEmailInboxItem(actor, {
        type: 'Email', sourceId, title: message.subject,
        message: `From: ${message.from}\n\n${message.preview}`,
        sender: message.from, provider: context.MAILBOX_PROVIDER_LABELS[connection.provider] || connection.provider,
        sourceTab: 'emailIntegrationTab', createdAt: message.receivedAt
      });
      added += 1;
    }
    connection.lastSuccessfulSyncAt = new Date().toISOString();
    connection.lastError = '';
    return { added, skipped: false, email: connection.email, lastSyncAt: connection.lastSuccessfulSyncAt };
  } catch (error) {
    context.logStructured('error', 'mailbox.provider_sync_failed', { category: 'mailbox', message: error.message });
    connection.lastError = 'Mailbox sync is temporarily unavailable. Please try again.';
    throw error;
  }
};

const completeMailboxOAuth = async (req, res, provider) => {
  const actor = context.getSessionAccount(req);
  const pending = req.session?.mailboxOAuth;
  if (req.session) delete req.session.mailboxOAuth;
  const valid = actor && context.MAILBOX_PROVIDERS.has(provider) && pending?.provider === provider
    && pending.state === req.query.state && pending.username === context.normalizeUsername(actor.username)
    && Date.now() - Number(pending.createdAt || 0) < 10 * 60_000 && req.query.code && !req.query.error;
  if (!valid) return res.redirect('/?mailboxError=mailbox-connection-failed');
  const previousConnection = actor.mailboxConnection;
  try {
    const tokens = await context.exchangeMailboxCode({
      provider,
      code: String(req.query.code),
      verifier: pending.verifier,
      origin: context.publicOrigin(),
      callbackParams: {
        accountsServer: String(req.query['accounts-server'] || ''),
        location: String(req.query.location || '')
      }
    });
    if (!tokens.access_token || !tokens.refresh_token) throw new Error('The provider did not grant renewable mailbox access.');
    actor.mailboxConnection = {
      version: 2, provider, email: '',
      accessToken: context.encryptField(tokens.access_token), refreshToken: context.encryptField(tokens.refresh_token),
      accessTokenExpiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
      connectedAt: new Date().toISOString(), lastSuccessfulSyncAt: null, lastError: '',
      backlogCursor: '', initialSyncComplete: false,
      providerMetadata: tokens.providerMetadata || {}
    };
    await context.syncConnectedMailbox(actor, { initial: true });
    await context.saveDatabaseState();
    return res.redirect('/?mailbox=connected');
  } catch (error) {
    if (previousConnection) actor.mailboxConnection = previousConnection;
    else delete actor.mailboxConnection;
    context.logStructured('error', 'mailbox.connection_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, details: `Provider ${provider}`, message: error.message });
    return res.redirect('/?mailboxError=mailbox-connection-failed');
  }
};

const emailActor = req => context.getSessionAccount(req);
return { looksLikeEmailAddress, accountSecurityEmail, sendLoginLockoutEmail, sendSuccessfulLoginEmail, emailInboxVisibleTo, emailSourceKey, dismissEmailSource, addEmailInboxItem, emailInboxPreferenceDefaults, emailInboxPreferenceKeys, emailInboxPreferencesFor, emailInboxTypeKey, emailInboxTypeEnabled, buildEmailInbox, emailHeaderText, smtpConfig, smtpEmailConfigured, apiEmailConfigured, emailDeliveryProvider, emailHtmlText, smtpSend, sendLittleFeetEmail, inboundEmailDomain, inboundEmailApiKey, inboundEmailConfigured, validForwardingAlias, forwardingAddressFor, publicForwardingStatus, ensureForwardingAddress, forwardingActorForRecipients, receivedEmailSourceId, mailboxConnectionStatus, mailboxSyncLimit, mailboxAccessToken, syncConnectedMailbox, completeMailboxOAuth, emailActor };
}
module.exports = { createHelpers };
