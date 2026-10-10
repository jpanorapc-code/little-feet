// Existing handlers, registered at their original middleware positions.
function registerTicketsAssigneesRoutes(app, context) {
app.get('/api/tickets/assignees', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor || !(context.isAdminLike(actor) || ['crm', 'support'].includes(actor.role))) return res.status(403).json({ message: 'Ticket management access is required.' });
  const companyQueueAccess = context.hasPlatformAccess(actor) || ['crm', 'support'].includes(actor.role);
  const accounts = context.db.users.filter(account => !context.isAwaitingAccountVerification(account) && (companyQueueAccess || context.canManageAccount(actor, account)) && (actor.role !== 'crm' || context.PLATFORM_INTERNAL_ROLES.has(account.role) || ['admin','principal'].includes(account.role)));
  res.json(accounts.map(account => ({ username: account.username, name: account.name || account.username, role: account.role, schoolId: account.schoolId || '', schoolName: account.schoolName || '', companyAccount: context.hasPlatformAccess(account) || context.PLATFORM_INTERNAL_ROLES.has(account.role) })));
});

app.get('/api/tickets', (req, res) => {
  const viewer = context.getSessionAccount(req);
  if (!viewer) return res.status(401).json({ message: 'Sign in to view your support tickets.' });
  const schoolTickets = context.PLATFORM_INTERNAL_ROLES.has(viewer.role) ? context.db.tickets : context.tenantRecords(context.db.tickets, viewer);
  if (context.hasPlatformAccess(viewer) || viewer.role === 'support') return res.json(context.db.tickets);
  if (context.isAdminLike(viewer)) return res.json(schoolTickets);
  const visibleTickets = schoolTickets.filter(ticket =>
    context.normalizeUsername(ticket.createdBy) === context.normalizeUsername(viewer.username) ||
    context.normalizeUsername(ticket.assignedTo) === context.normalizeUsername(viewer.username)
  );
  res.json(visibleTickets);
});

app.post('/api/tickets', (req, res) => {
  const assignedTo = context.boundedText(req.body?.assignedTo, 160);
  const creator = context.getSessionAccount(req);
  if (!creator) return res.status(401).json({ message: 'Sign in to create a support ticket.' });
  const canAssignTicket = context.isAdminLike(creator) || ['crm', 'support'].includes(creator.role);
  const assignedAccount = canAssignTicket ? context.findAccountByUsername(assignedTo) : null;
  if (assignedTo && (!assignedAccount || (!context.hasPlatformAccess(creator) && !['crm', 'support'].includes(creator.role) && !context.isSameSchool(creator, assignedAccount)))) {
    return res.status(400).json({ message: 'Choose an account from this school for the ticket assignment.' });
  }
  const department = context.boundedText(req.body?.department || 'Admin', 80);
  const priority = context.boundedText(req.body?.priority || 'Normal', 40);
  const subject = context.boundedText(req.body?.subject, 200);
  const message = context.boundedText(req.body?.message, 5000);
  if (!subject || !message) return res.status(400).json({ message: 'Add a ticket subject and message.' });
  const item = context.tagSchoolRecord(creator, {
    id: context.crypto.randomUUID(),
    department,
    category: context.boundedText(req.body?.category, 100),
    priority,
    subject,
    message,
    ticketType: context.boundedText(req.body?.ticketType || 'Help request', 40),
    meetingDate: context.boundedText(req.body?.meetingDate, 30),
    meetingTime: context.boundedText(req.body?.meetingTime, 20),
    meetingLocation: context.boundedText(req.body?.meetingLocation, 200),
    createdBy: creator.username,
    createdByName: creator.name || creator.username,
    assignedTo: assignedAccount?.username || '',
    status: 'Open',
    monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }),
    createdAt: new Date().toISOString()
  });
  context.db.tickets.unshift(item);
  res.json({ success: true, item });
});
}

function registerTicketsUpdateRoutes(app, context) {
app.post('/api/tickets/update', (req, res) => {
  const { id, status, feedback, updatedBy, assignedTo } = req.body;
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to update a support ticket.' });
  const companyQueueAccess = context.hasPlatformAccess(actor) || actor.role === 'support';
  const ticket = context.db.tickets.find(t => t.id === id && (companyQueueAccess || context.recordInSchool(t, actor) || (context.PLATFORM_INTERNAL_ROLES.has(actor.role) && context.normalizeUsername(t.assignedTo) === context.normalizeUsername(actor.username))));
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found.' });
  const canManage = companyQueueAccess || context.isAdminLike(actor) || context.normalizeUsername(ticket.assignedTo) === context.normalizeUsername(actor.username);
  if (!canManage) return res.status(403).json({ message: 'Only the assigned account or an administrator can update this ticket.' });
  if (status !== undefined && !['Open', 'Completed'].includes(status)) return res.status(400).json({ message: 'Ticket status must be Open or Completed.' });
  let nextAssignee;
  if (assignedTo !== undefined) {
    if (!(context.isAdminLike(actor) || ['crm', 'support'].includes(actor.role))) return res.status(403).json({ message: 'Only an administrator or authorised Little Feet support staff can change ticket assignments.' });
    const assignedAccount = assignedTo ? context.findAccountByUsername(assignedTo) : null;
    if (assignedTo && (!assignedAccount || context.isAwaitingAccountVerification(assignedAccount) || (!companyQueueAccess && !context.isSameSchool(actor, assignedAccount)))) return res.status(400).json({ message: 'Choose an available account for the ticket assignment.' });
    nextAssignee = assignedAccount?.username || '';
  }
  if (nextAssignee !== undefined) ticket.assignedTo = nextAssignee;
  if (status !== undefined) {
    if (!['Open', 'Completed'].includes(status)) return res.status(400).json({ message: 'Ticket status must be Open or Completed.' });
    ticket.status = status;
  }
  if (feedback !== undefined) ticket.feedback = String(feedback || '').trim().slice(0, 5000);
  ticket.updatedBy = actor.username;
  res.json({ success: true, ticket });
});

app.delete('/api/tickets/:id', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const ticket = context.db.tickets.find(entry => entry.id === req.params.id && context.recordInSchool(entry, actor));
  if (!ticket) return res.status(404).json({ message: 'Support ticket not found.' });
  context.db.tickets = context.db.tickets.filter(t => t !== ticket);
  res.json({ success: true });
});
}

module.exports = { registerTicketsAssigneesRoutes, registerTicketsUpdateRoutes };
