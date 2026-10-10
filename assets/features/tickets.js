// tickets workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function canManageTicketQueue() {
  return isFullAccessUser() || ['crm', 'support'].includes(currentUser?.role);
}

function ticketCanBeManaged(ticket) {
  return canManageTicketQueue() || String(ticket.assignedTo || '').toLowerCase() === String(currentUser?.username || '').toLowerCase();
}

function showTicketNotification(ticket) {
  const notice = document.createElement('div');
  notice.className = 'ticket-toast';
  notice.setAttribute('role', 'status');
  notice.innerHTML = `<strong>🎫 New ticket assigned</strong><span>${escapeWorkspaceText(ticket.subject || 'Support request')}</span>`;
  document.body.appendChild(notice);
  window.setTimeout(() => notice.remove(), 8000);
}

function renderTicketAssigneeOptions(selectId, query = '', selected = '') {
  const select = document.getElementById(selectId);
  if (!select) return;
  const search = String(query || '').trim().toLowerCase();
  const schoolAccounts = ticketAssigneeAccounts.filter(account => {
    const matchesSearch = !search || `${account.name || ''} ${account.username || ''}`.toLowerCase().includes(search);
    return matchesSearch;
  });
  const roleGroups = [['teacher', 'Teachers'], ['principal', 'Principals'], ['parent', 'Parents'], ['admin', 'Administrators'], ['district', 'District'], ['school_accounts', 'School Accounts'], ['staff', 'Staff Little Feet'], ['crm', 'CRM Little Feet'], ['accounts', 'Accounts Little Feet'], ['support', 'Support Little Feet']];
  const groupedOptions = roleGroups.map(([role, label]) => {
    const people = schoolAccounts.filter(account => account.role === role);
    return people.length ? `<optgroup label="${label}">${people.map(account => `<option value="${escapeWorkspaceText(account.username)}">${escapeWorkspaceText(account.name || account.username)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  select.innerHTML = `<option value="">Unassigned</option>${groupedOptions}`;
  select.value = [...select.options].some(option => option.value === selected) ? selected : '';
}

function filterTicketAssignees(searchId, selectId) {
  const search = document.getElementById(searchId)?.value || '';
  const selected = document.getElementById(selectId)?.value || '';
  renderTicketAssigneeOptions(selectId, search, selected);
}

async function loadTicketAssignees() {
  if (!document.getElementById('ticketAssignee') || !canManageTicketQueue()) return;
  try {
    const response = await fetch('/api/tickets/assignees');
    const accounts = await response.json();
    if (!response.ok) return;
    const selected = document.getElementById('ticketAssignee').value;
    ticketAssigneeAccounts = accounts;
    renderTicketAssigneeOptions('ticketAssignee', document.getElementById('ticketAssigneeSearch')?.value || '', selected);
  } catch { /* The ticket form remains available without preloading assignees. */ }
}

async function loadTickets(checkForNew = false) {
  try {
    if (!currentUser) return;
    const res = await fetch(`/api/tickets?username=${encodeURIComponent(currentUser.username)}`);
    const tickets = await res.json();
    if (!res.ok) throw new Error('Unable to fetch tickets.');
    const assignedTickets = tickets.filter(ticket => String(ticket.assignedTo || '').toLowerCase() === String(currentUser.username).toLowerCase());
    const newTickets = assignedTickets.filter(ticket => !knownTicketIds.has(ticket.id));
    if (ticketsLoaded && checkForNew && newTickets.length) { showTicketNotification(newTickets[0]); playTicketAlert(); }
    tickets.forEach(ticket => knownTicketIds.add(ticket.id));
    ticketsLoaded = true;
    const filter = document.getElementById('ticketDeptFilter').value;

    const filtered = tickets.filter(t => filter === 'All' || t.department === filter);
    const active = filtered.filter(t => t.status !== 'Completed');
    const completed = filtered.filter(t => t.status === 'Completed');

    document.getElementById('ticketList').innerHTML = active.length
      ? active.map(t => `
          <div class="item-row" style="flex-direction: column; align-items: flex-start;">
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <span class="badge-tag">${escapeWorkspaceText(t.department)}</span> 
                <span class="badge-tag urgent">${escapeWorkspaceText(t.priority)} Priority</span>
                ${t.ticketType === 'Meeting request' ? '<span class="badge-tag">Meeting request</span>' : ''}
                <strong>${escapeWorkspaceText(t.subject)}</strong>
                <p class="meta" style="margin-top:5px;">${t.assignedTo ? `Assigned to: ${escapeWorkspaceText(t.assignedTo)}` : 'Unassigned'}</p>
              </div>
              ${isFullAccessUser() && t.category === 'School deletion request' ? `<button type="button" onclick="executeSchoolDeletion('${encodeInlineIdentifier(t.id)}')" class="action-btn btn-red">Delete entire school</button>` : ''}${isFullAccessUser() ? `<button type="button" onclick="deleteTicket('${encodeInlineIdentifier(t.id)}')" class="action-btn btn-red">🗑️ Delete</button>` : ''}
            </div>
            <p style="margin-top:6px; font-size:0.88rem; color:var(--text-muted);">${escapeWorkspaceText(t.message)}</p>
            ${t.ticketType === 'Meeting request' ? `<p class="meta" style="margin-top:6px;"><strong>Requested meeting:</strong> ${escapeWorkspaceText(t.meetingDate || 'Date not set')} ${escapeWorkspaceText(t.meetingTime || '')}${t.meetingLocation ? ' · ' + escapeWorkspaceText(t.meetingLocation) : ''}</p>` : ''}
            ${t.application ? `<div style="width:100%;padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);font-size:.82rem;line-height:1.55;"><strong>Application details</strong><br><strong>Parent / guardian:</strong> ${escapeWorkspaceText(t.application.guardianName)} · ${escapeWorkspaceText(t.application.contactPhone)} · ${escapeWorkspaceText(t.application.contactEmail)}<br><strong>Learner:</strong> ${escapeWorkspaceText(t.application.learnerName)} · DOB ${escapeWorkspaceText(t.application.dateOfBirth)} · ${escapeWorkspaceText(t.application.gradeOrAgeGroup)}<br><strong>Start date:</strong> ${escapeWorkspaceText(t.application.intendedStart)} · <strong>Area:</strong> ${escapeWorkspaceText(t.application.homeArea)}<br><strong>Note:</strong> ${escapeWorkspaceText(t.application.notes)}</div>` : ''}
            ${t.feedback ? `<div style="background:var(--input-bg); padding:8px; border-radius:4px; font-size:0.8rem; margin-top:6px; color:#2dd4bf; border: 1px solid var(--border-color);"><strong>Feedback from ${escapeWorkspaceText(t.updatedBy)}:</strong> ${escapeWorkspaceText(t.feedback)}</div>` : ''}
            ${ticketCanBeManaged(t) ? `<div style="margin-top: 8px;">
              <button type="button" onclick="editTicketModal('${encodeInlineIdentifier(String(t.id || ''))}', '${encodeInlineIdentifier(String(t.status || 'Open'))}', '${encodeInlineIdentifier(t.feedback || '')}', '${encodeInlineIdentifier(t.assignedTo || '')}')" class="action-btn btn-blue">✏️ Edit & Respond</button>
            </div>` : ''}
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No active tickets in queue.</p>';

    const grouped = {};
    completed.forEach(t => {
      const monthKey = t.monthCategory || 'August 2026';
      if (!grouped[monthKey]) grouped[monthKey] = [];
      grouped[monthKey].push(t);
    });

    let completedHtml = '';
    for (const [month, list] of Object.entries(grouped)) {
      completedHtml += `<h3 style="font-size:0.95rem; color:var(--primary-color); margin: 15px 0 8px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">📅 Submitted Category: ${escapeWorkspaceText(month)}</h3>`;
      completedHtml += list.map(t => `
        <div class="item-row" style="opacity: 0.85; flex-direction: column; align-items: flex-start;">
          <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
            <div><span class="badge-tag" style="background:#16a34a;">Completed</span> <strong>${escapeWorkspaceText(t.subject)}</strong></div>
            ${isFullAccessUser() ? `<button type="button" onclick="deleteTicket('${encodeInlineIdentifier(t.id)}')" class="action-btn btn-red">🗑️ Delete</button>` : ''}
          </div>
          <p style="font-size:0.85rem; margin-top:4px;">${escapeWorkspaceText(t.message)}</p>
          ${t.feedback ? `<p style="font-size:0.78rem; color:#2dd4bf;">Feedback: ${escapeWorkspaceText(t.feedback)}</p>` : ''}
        </div>
      `).join('');
    }

    document.getElementById('completedTicketList').innerHTML = completedHtml || '<p style="font-size:0.85rem; color:var(--text-muted);">No completed tickets archived.</p>';
  } catch (err) {
    logAppError('ERR_TCK_001', 'Failed to fetch Support Desk tickets.');
  }
}

async function deleteTicket(id) {
  if (!isFullAccessUser()) return alert('Only an administrator can delete support tickets.');
  if (!confirm('Are you sure you want to delete this support ticket?')) return;
  const response = await fetch(`/api/tickets/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username }) });
  if (!response.ok) return alert('Unable to delete this ticket.');
  loadTickets();
}

function toggleMeetingTicketFields() {
  const isMeeting = document.getElementById('ticketType')?.value === 'Meeting request';
  const fields = document.getElementById('meetingTicketFields');
  fields?.classList.toggle('hidden', !isMeeting);
  ['ticketMeetingDate','ticketMeetingTime'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.required = isMeeting;
  });
}

function editTicketModal(encodedId, encodedStatus, encodedFeedback, encodedAssignee) {
  const id = decodeURIComponent(encodedId || '');
  const currentStatus = decodeURIComponent(encodedStatus || 'Open');
  const currentFeedback = decodeURIComponent(encodedFeedback || '');
  const currentAssignee = decodeURIComponent(encodedAssignee || '');
  const html = `
    <form id="editTicketForm">
      <div>
        <label for="editFeedback">Admin Feedback & Notes</label>
        <textarea id="editFeedback" rows="3" required>${escapeWorkspaceText(currentFeedback || '')}</textarea>
      </div>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
        <input type="checkbox" id="editCompleted" ${currentStatus === 'Completed' ? 'checked' : ''} style="width:auto; margin-bottom:0;">
        <label for="editCompleted" style="margin-bottom:0;">Mark Ticket as Completed</label>
      </div>
      ${canManageTicketQueue() ? '<div><label for="editTicketAssigneeSearch">Find an account</label><input id="editTicketAssigneeSearch" type="search" placeholder="Search a school user or company employee" oninput="filterTicketAssignees(\'editTicketAssigneeSearch\', \'editTicketAssignee\')"><label for="editTicketAssignee">Assign to account</label><select id="editTicketAssignee"><option value="">Unassigned</option></select></div>' : ''}
      <button type="submit" class="submit-btn">Save Ticket Resolution</button>
    </form>`;
  openModal('Edit Support Ticket', html);
  if (canManageTicketQueue()) loadTicketAssignees().then(() => renderTicketAssigneeOptions('editTicketAssignee', '', currentAssignee));

  document.getElementById('editTicketForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = document.getElementById('editFeedback').value;
    const status = document.getElementById('editCompleted').checked ? 'Completed' : 'Open';
    const response = await fetch('/api/tickets/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, feedback, updatedBy: currentUser ? currentUser.username : 'Admin', assignedTo: canManageTicketQueue() ? document.getElementById('editTicketAssignee')?.value : undefined })
    });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to update this ticket.');
    closeModal();
    loadTickets();
    playDingSound();
  });
}

async function requestSchoolDeletion() {
  if (!currentUser || currentUser.role !== 'principal') return alert('Only the school principal can request deletion of the entire school workspace.');
  if (!confirm('Are you sure you want to request deletion of the ENTIRE school workspace? This includes all school accounts and all data linked to this school.')) return;
  try {
    const response = await fetch('/api/school-deletion-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to submit the school deletion request.');
    alert('Full school deletion request sent to the administrator as a high-priority support ticket.');
    if (typeof loadTickets === 'function') loadTickets();
  } catch {
    alert('Unable to reach the school deletion service. Please try again.');
  }
}

async function executeSchoolDeletion(ticketId) {
  if (!isFullAccessUser()) return alert('Administrator access is required.');
  const confirmation = prompt('This permanently deletes every account and all data linked to this school. Type DELETE SCHOOL exactly to continue.');
  if (confirmation === null) return;
  if (confirmation.trim() !== 'DELETE SCHOOL') return alert('School deletion cancelled. The confirmation text did not match.');
  const response = await fetch('/api/school-deletion/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticketId, confirmation: confirmation.trim() })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to delete the school workspace.');
  alert(`School workspace deleted: ${result.deletedSchoolName || result.deletedSchoolId}. You will now be signed out.`);
  window.location.reload();
}
