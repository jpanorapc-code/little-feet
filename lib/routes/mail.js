// Existing handlers, registered at their original middleware positions.
function registerEmailInboxRoutes(app, context) {
app.get('/api/email/inbox',(req,res)=>{
  const actor=context.getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to view your Little Feet email inbox.'});
  res.json(context.buildEmailInbox(actor));
});

app.patch('/api/email/inbox/:id',(req,res)=>{
  const actor=context.getSessionAccount(req),item=actor&&context.db.emailInbox.find(x=>x.id===req.params.id&&context.emailInboxVisibleTo(x,actor));
  if(!item)return res.status(404).json({message:'Inbox item not found.'});
  if(typeof req.body?.read==='boolean')item.read=req.body.read;if(typeof req.body?.pinned==='boolean')item.pinned=req.body.pinned;
  item.updatedAt=new Date().toISOString();res.json({success:true,item});
});

app.delete('/api/email/inbox/:id',(req,res)=>{
  const actor=context.getSessionAccount(req),item=actor&&context.db.emailInbox.find(x=>x.id===req.params.id&&context.emailInboxVisibleTo(x,actor));
  if(!item)return res.status(404).json({message:'Inbox item not found.'});context.dismissEmailSource(actor,item);context.db.emailInbox=context.db.emailInbox.filter(x=>x!==item);res.json({success:true});
});

app.delete('/api/email/inbox',(req,res)=>{
  const actor=context.getSessionAccount(req);if(!actor)return res.status(401).json({message:'Sign in to manage your Little Feet email inbox.'});
  const visible=context.db.emailInbox.filter(x=>context.emailInboxVisibleTo(x,actor));visible.forEach(item=>context.dismissEmailSource(actor,item));const before=context.db.emailInbox.length;context.db.emailInbox=context.db.emailInbox.filter(x=>!context.emailInboxVisibleTo(x,actor));res.json({success:true,deleted:before-context.db.emailInbox.length});
});
}

function registerEmailForwardingSetupRoutes(app, context) {
app.post('/api/email/forwarding/setup', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to create your forwarding address.' });
  if (!context.inboundEmailConfigured()) {
    return res.status(503).json({ message: 'Inbound email receiving is not configured on this Little Feet server yet.' });
  }
  const address = context.ensureForwardingAddress(actor);
  res.json({ success: true, forwarding: context.publicForwardingStatus(actor), address });
});
}

function registerEmailMailboxStatusRoutes(app, context) {
app.get('/api/email/mailbox/status', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to manage a mailbox.' });
  res.json(context.mailboxConnectionStatus(actor));
});

app.get('/api/email/mailbox/connect/:provider', (req, res) => {
  const actor = context.getSessionAccount(req);
  const provider = String(req.params.provider || '').toLowerCase();
  if (!actor) return res.redirect('/?mailboxError=sign-in-required');
  if (!context.MAILBOX_PROVIDERS.has(provider)) return res.redirect('/?mailboxError=provider-unsupported');
  try {
    const authorization = context.createMailboxAuthorization({ provider, origin: context.publicOrigin() });
    req.session.mailboxOAuth = {
      provider, state: authorization.state, verifier: authorization.verifier,
      username: context.normalizeUsername(actor.username), createdAt: Date.now()
    };
    req.session.save(error => res.redirect(error ? '/?mailboxError=session-failed' : authorization.url));
  } catch (error) {
    context.logStructured('error', 'mailbox.authorization_setup_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.redirect('/?mailboxError=mailbox-connection-failed');
  }
});
}

function registerEmailMailboxOauthCallbackRoutes(app, context) {
app.get('/api/email/mailbox/oauth/:provider/callback', async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  return context.completeMailboxOAuth(req, res, provider);
});

app.post('/api/email/mailbox/sync', async (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to sync a mailbox.' });
  try {
    const result = await context.syncConnectedMailbox(actor);
    await context.saveDatabaseState();
    res.json({ success: true, ...result, mailbox: context.mailboxConnectionStatus(actor) });
  } catch (error) {
    context.logStructured('error', 'mailbox.sync_request_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.status(502).json({ message: 'Mailbox sync is temporarily unavailable. Please try again.' });
  }
});

app.post('/api/email/mailbox/send', async (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to send mailbox email.' });
  if (!actor.mailboxConnection) return res.status(409).json({ message: 'Connect a mailbox before sending email.' });
  const to = context.boundedText(req.body?.to, 254), subject = context.boundedText(req.body?.subject, 300), text = context.boundedText(req.body?.text, 20000);
  if (!to || !subject || !text) return res.status(400).json({ message: 'Recipient, subject and message are required.' });
  try {
    const accessToken = await context.mailboxAccessToken(actor);
    const result = await context.sendMailboxMessage({ provider: actor.mailboxConnection.provider, accessToken, from: actor.mailboxConnection.email, to, subject, text, providerMetadata: actor.mailboxConnection.providerMetadata || {} });
    actor.mailboxConnection.lastSentAt = new Date().toISOString();
    await context.saveDatabaseState();
    res.status(201).json({ success: true, provider: result.provider, id: result.id || '', sentAt: actor.mailboxConnection.lastSentAt });
  } catch (error) {
    context.logStructured('error', 'mailbox.send_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.status(502).json({ message: 'Email could not be sent right now. Please try again.' });
  }
});

app.delete('/api/email/mailbox', async (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to disconnect a mailbox.' });
  const connection = actor.mailboxConnection;
  if (!connection) return res.json({ success: true, revoked: false });
  let revoked = false;
  try {
    const refreshToken = context.decryptField(connection.refreshToken);
    const accessToken = context.decryptField(connection.accessToken);
    const result = await context.revokeMailboxAccess({
      provider: connection.provider,
      refreshToken,
      accessToken,
      providerMetadata: connection.providerMetadata || {}
    });
    revoked = Boolean(result?.revoked);
  } catch (error) {
    context.logStructured('warn', 'mailbox.token_revocation_warning', { category: 'mailbox', details: `Provider ${connection.provider || 'Mailbox'}`, message: error.message });
  } finally {
    delete actor.mailboxConnection;
    await context.saveDatabaseState();
  }
  res.json({ success: true, revoked });
});

app.post('/api/email/inbound/resend', async (req, res) => {
  if (!context.inboundEmailConfigured()) return res.status(503).json({ message: 'Inbound email receiving is not configured.' });

  let event;
  try {
    event = context.verifyResendWebhook({
      rawBody: req.rawBody,
      headers: req.headers,
      secret: context.inboundWebhookSecret()
    });
  } catch (error) {
    return res.status(401).json({ message: 'Invalid inbound email webhook signature.' });
  }

  if (event?.type !== 'email.received') return res.json({ received: true, ignored: true });

  const emailId = context.boundedText(event?.data?.email_id, 120);
  if (!emailId) return res.status(400).json({ message: 'Inbound email event did not include an email id.' });

  try {
    const received = await context.fetchResendReceivedEmail({
      emailId,
      apiKey: context.inboundEmailApiKey()
    });
    const recipients = [
      ...(Array.isArray(event?.data?.to) ? event.data.to : []),
      ...(Array.isArray(received.to) ? received.to : []),
      ...(Array.isArray(received.receivedFor) ? received.receivedFor : [])
    ];
    const actor = context.forwardingActorForRecipients(recipients);
    if (!actor) return res.status(202).json({ received: true, routed: false });

    const sourceId = context.receivedEmailSourceId(emailId);
    const duplicate = (context.db.emailInbox || []).find(item =>
      item.type === 'Email'
      && item.sourceId === sourceId
      && context.normalizeUsername(item.username) === context.normalizeUsername(actor.username)
    );
    if (duplicate) return res.json({ received: true, routed: true, duplicate: true });

    const body = received.text || received.htmlText || '(No message body)';
    const attachmentNote = received.attachmentCount
      ? `\n\n[${received.attachmentCount} attachment${received.attachmentCount === 1 ? '' : 's'} received. Attachment viewing will be added separately.]`
      : '';
    context.addEmailInboxItem(actor, {
      type: 'Email',
      sourceId,
      title: received.subject || '(No subject)',
      message: 'From: ' + (received.from || 'Unknown sender') + '\n\n' + body + attachmentNote,
      sender: received.from || 'Unknown sender',
      provider: 'Forwarded email',
      sourceTab: 'emailIntegrationTab',
      createdAt: received.createdAt
    });
    context.ensureForwardingAddress(actor);
    actor.emailForwarding.lastReceivedAt = received.createdAt || new Date().toISOString();
    actor.emailForwarding.lastEmailId = emailId;

    res.json({ received: true, routed: true });
  } catch (error) {
    context.logStructured('error', 'mailbox.inbound_processing_failed', { category: 'mailbox', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.status(502).json({ message: 'Inbound email could not be processed yet; the provider may retry.' });
  }
});
}

function registerEmailStatusRoutes(app, context) {
app.get('/api/email/status',(req,res)=>{
  const actor=context.emailActor(req);if(!actor)return res.status(401).json({message:'Sign in to manage your account email.'});
  const address=context.accountSecurityEmail(actor);
  res.json({
    configured:context.smtpEmailConfigured()||context.apiEmailConfigured(),
    provider:context.emailDeliveryProvider(),
    address,
    verified:Boolean(actor.emailVerifiedAt),
    verifiedAt:actor.emailVerifiedAt||null,
    forwarding:context.publicForwardingStatus(actor)
  });
});

app.post('/api/email/verification/request',async(req,res,next)=>{
  try{const actor=context.emailActor(req);if(!actor)return res.status(401).json({message:'Sign in to verify your account email.'});const to=context.accountSecurityEmail(actor);if(!to)return res.status(400).json({message:'Your account does not have a valid email address.'});
    const code=String(context.crypto.randomInt(100000,1000000)),hash=context.crypto.createHash('sha256').update(code).digest('hex');context.emailVerificationTokens.set(context.normalizeUsername(actor.username),{hash,expiresAt:Date.now()+10*60*1000});
    const sent=await context.sendLittleFeetEmail({to,subject:'Verify your Little Feet email',text:`Your Little Feet verification code is ${code}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`});
    if(!sent){context.emailVerificationTokens.delete(context.normalizeUsername(actor.username));return res.status(503).json({message:'Email delivery is not configured yet. Configure the Little Feet SMTP or email API environment settings.'});}res.json({success:true,expiresInSeconds:600,provider:context.emailDeliveryProvider()});
  }catch(error){context.emailVerificationTokens.delete(context.normalizeUsername(context.getSessionAccount(req)?.username));next(error);}
});

app.post('/api/email/verification/confirm',(req,res)=>{
  const actor=context.emailActor(req);if(!actor)return res.status(401).json({message:'Sign in to verify your account email.'});const key=context.normalizeUsername(actor.username),entry=context.emailVerificationTokens.get(key),code=context.boundedText(req.body?.code,6);
  if(!entry||entry.expiresAt<Date.now()){context.emailVerificationTokens.delete(key);return res.status(400).json({message:'Verification code expired. Request a new one.'});}
  const hash=context.crypto.createHash('sha256').update(code).digest('hex');if(code.length!==6||hash!==entry.hash)return res.status(400).json({message:'Verification code is incorrect.'});
  actor.emailVerifiedAt=new Date().toISOString();context.emailVerificationTokens.delete(key);res.json({success:true,verifiedAt:actor.emailVerifiedAt});
});
}

module.exports = { registerEmailInboxRoutes, registerEmailForwardingSetupRoutes, registerEmailMailboxStatusRoutes, registerEmailMailboxOauthCallbackRoutes, registerEmailStatusRoutes };
