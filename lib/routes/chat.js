// Existing handlers, registered at their original middleware positions.
function registerChatGroupsRoutes(app, context) {
app.get('/api/chat/groups', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view school chat groups.' });
  if (!context.CHAT_ROLES.has(actor.role)) return res.status(403).json({ message: 'This role cannot access school chat.' });
  res.json(context.tenantRecords(context.db.chatGroups, actor));
});

app.post('/api/chat/groups', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.hasPlatformAccess(actor) || ['teacher', 'principal', 'admin', 'staff'].includes(actor.role))) return res.status(403).json({ message: 'Authorised school staff can create groups.' });
  const groupName = String(req.body?.groupName || '').trim();
  if (!groupName) return res.status(400).json({ message: 'A group name is required.' });
  if (groupName.length > 120) return res.status(413).json({ message: 'Group names are limited to 120 characters.' });
  const id = context.crypto.randomUUID();
  context.db.chatGroups.push(context.tagSchoolRecord(actor, { id, groupName }));
  context.db.groupMessages[id] = [];
  res.json({ success: true, id });
});

app.delete('/api/chat/groups/:id', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const id = req.params.id;
  const group = context.db.chatGroups.find(entry => entry.id === id && context.recordInSchool(entry, actor));
  if (!group) return res.status(404).json({ message: 'Chat group not found.' });
  context.db.chatGroups = context.db.chatGroups.filter(g => g !== group);
  delete context.db.groupMessages[id];
  res.json({ success: true });
});

app.get('/api/chat/messages/:groupId', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !context.CHAT_ROLES.has(actor.role)) return res.status(403).json({ message: 'This role cannot access school chat.' });
  const group = context.db.chatGroups.find(entry => entry.id === req.params.groupId && context.recordInSchool(entry, actor));
  if (!group) return res.status(404).json({ message: 'Chat group not found.' });
  const msgs = context.db.groupMessages[req.params.groupId] || [];
  res.json(msgs);
});

app.post('/api/chat/messages', (req, res) => {
  const { groupId, message, textColor } = req.body;
  const actor = context.getSessionAccount(req);
  if (!actor || !context.CHAT_ROLES.has(actor.role)) return res.status(403).json({ message: 'This role cannot access school chat.' });
  const group = context.db.chatGroups.find(entry => entry.id === groupId && context.recordInSchool(entry, actor));
  if (!group) return res.status(404).json({ message: 'Chat group not found.' });
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) return res.status(400).json({ message: 'A message is required.' });
  if (cleanMessage.length > 4000) return res.status(413).json({ message: 'Messages are limited to 4,000 characters.' });
  if (!context.db.groupMessages[groupId]) context.db.groupMessages[groupId] = [];
  const msgObj = {
    id: context.crypto.randomUUID(),
    sender: actor.username,
    message: cleanMessage,
    textColor: context.safeTextColor(textColor),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  context.db.groupMessages[groupId].push(msgObj);
  res.json({ success: true, msgObj });
});

app.delete('/api/chat/messages/:groupId/:messageId', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const group = context.db.chatGroups.find(entry => entry.id === req.params.groupId && context.recordInSchool(entry, actor));
  if (!group) return res.status(404).json({ message: 'Chat group not found.' });
  const messages = context.db.groupMessages[req.params.groupId];
  if (!messages) return res.status(404).json({ message: 'Chat group not found.' });
  const previousLength = messages.length;
  context.db.groupMessages[req.params.groupId] = messages.filter(message => message.id !== req.params.messageId);
  if (context.db.groupMessages[req.params.groupId].length === previousLength) return res.status(404).json({ message: 'Message not found.' });
  res.json({ success: true });
});

app.get('/api/chat/direct/users', (req, res) => {
  const viewer = context.getSessionAccount(req);
  if (!viewer) return res.status(401).json({ message: 'A valid signed-in account is required.' });
  if (!context.CHAT_ROLES.has(viewer.role)) return res.status(403).json({ message: 'This role cannot access direct chat.' });
  res.json(context.db.users.filter(user => context.canUseDirectChat(viewer, user)).map(user => ({ username:user.username, name:user.name || user.username, role:user.role })));
});

app.get('/api/chat/direct/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  const viewer = context.getSessionAccount(req);
  const contact = context.findAccountByUsername(user2);
  if (!viewer || context.normalizeUsername(user1) !== context.normalizeUsername(viewer.username) || !context.canUseDirectChat(viewer, contact)) return res.status(403).json({ message: 'This private conversation is not available for these accounts.' });
  const msgs = context.db.directMessages.filter(
    m => ((m.sender === user1 && m.recipient === user2) || (m.sender === user2 && m.recipient === user1))
  );
  res.json(msgs);
});

app.post('/api/chat/direct', (req, res) => {
  const { recipient, message, textColor } = req.body;
  const senderAccount = context.getSessionAccount(req);
  const recipientAccount = context.findAccountByUsername(recipient);
  if (!context.canUseDirectChat(senderAccount, recipientAccount)) return res.status(403).json({ message: 'You can only message approved contacts at your school.' });
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) return res.status(400).json({ message: 'A message is required.' });
  if (cleanMessage.length > 4000) return res.status(413).json({ message: 'Messages are limited to 4,000 characters.' });
  const messageScope = context.PLATFORM_INTERNAL_ROLES.has(senderAccount.role) && !context.PLATFORM_INTERNAL_ROLES.has(recipientAccount.role) ? recipientAccount : senderAccount;
  const msgObj = context.tagSchoolRecord(messageScope, {
    id: context.crypto.randomUUID(),
    sender: senderAccount.username,
    recipient: recipientAccount.username,
    message: cleanMessage,
    textColor: context.safeTextColor(textColor),
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
  context.db.directMessages.push(msgObj);
  res.json({ success: true, msgObj });
});

app.delete('/api/chat/direct/:messageId', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const message = context.db.directMessages.find(entry => entry.id === req.params.messageId && context.recordInSchool(entry, actor));
  if (!message) return res.status(404).json({ message: 'Message not found.' });
  context.db.directMessages = context.db.directMessages.filter(entry => entry !== message);
  res.json({ success: true });
});
}

module.exports = { registerChatGroupsRoutes };
