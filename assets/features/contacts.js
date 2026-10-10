// contacts workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function clearAttendanceRegistry() {
  if (!confirm("Are you sure you want to clear Today's Attendance Registry?")) return;
  await fetch('/api/attendance/clear', { method: 'POST' });
  loadAttendance();
}

function parentContactSearchText(record) {
  return [
    record?.learnerName,
    record?.className,
    record?.guardianName,
    record?.guardianPhone,
    record?.guardianEmail,
    record?.emergencyContact
  ].map(value => String(value || '').toLowerCase()).join(' ');
}

function parentContactTelHref(value) {
  const phone = String(value || '').trim();
  if (!phone) return '';
  const cleaned = phone.replace(/[^0-9+*#,;]/g, '');
  return cleaned ? `tel:${cleaned}` : '';
}

function showParentContactNotice(message) {
  const notice = document.createElement('div');
  notice.className = 'ticket-toast';
  notice.setAttribute('role', 'status');
  notice.innerHTML = `<strong>Parent Contacts</strong><span>${escapeWorkspaceText(message)}</span>`;
  document.body.appendChild(notice);
  window.setTimeout(() => notice.remove(), 2800);
}

async function copyParentContactText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch {}
  textarea.remove();
  return copied;
}

function parentContactRecordById(encodedId) {
  let id = '';
  try { id = decodeURIComponent(String(encodedId || '')); } catch { return null; }
  return parentContactRecords.find(record => String(record.id) === id) || null;
}

async function copyParentContactField(encodedId, field) {
  const record = parentContactRecordById(encodedId);
  const allowed = new Set(['guardianName', 'guardianPhone', 'guardianEmail', 'emergencyContact', 'learnerName', 'className']);
  if (!record || !allowed.has(field)) return;
  const value = String(record[field] || '').trim();
  if (!value) return showParentContactNotice('No value has been recorded for that field.');
  const copied = await copyParentContactText(value);
  showParentContactNotice(copied ? 'Copied to clipboard.' : 'Copy failed. Select and copy the value manually.');
}

async function copyParentContactSummary(encodedId) {
  const record = parentContactRecordById(encodedId);
  if (!record) return;
  const summary = [
    `Learner: ${record.learnerName || 'Not supplied'}`,
    `Class: ${record.className || 'Not supplied'}`,
    `Parent / guardian: ${record.guardianName || 'Not supplied'}`,
    `Guardian phone: ${record.guardianPhone || 'Not supplied'}`,
    `Guardian email: ${record.guardianEmail || 'Not supplied'}`,
    `Emergency contact: ${record.emergencyContact || 'Not supplied'}`
  ].join('\n');
  const copied = await copyParentContactText(summary);
  showParentContactNotice(copied ? 'Full contact details copied.' : 'Copy failed. Select and copy the details manually.');
}

function openRegistryForNewContact() {
  closeParentContactEditor();
  const form = document.getElementById('registryForm');
  form?.reset();
  switchTab('registryTab', null);
  window.setTimeout(() => {
    document.getElementById('registryLearnerName')?.focus();
    document.getElementById('registryTab')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 80);
}

function openParentContactEditor(encodedId) {
  const record = parentContactRecordById(encodedId);
  const editor = document.getElementById('parentContactEditor');
  if (!record || !editor) return;
  document.getElementById('parentContactEditId').value = String(record.id || '');
  document.getElementById('parentContactEditGuardianName').value = record.guardianName || '';
  document.getElementById('parentContactEditGuardianPhone').value = record.guardianPhone || '';
  document.getElementById('parentContactEditGuardianEmail').value = record.guardianEmail || '';
  document.getElementById('parentContactEditEmergency').value = record.emergencyContact || '';
  const learner = document.getElementById('parentContactEditLearner');
  if (learner) learner.textContent = [record.learnerName || 'Unnamed learner', record.className || 'Class pending'].join(' · ');
  editor.classList.remove('hidden');
  window.setTimeout(() => editor.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 20);
}

function closeParentContactEditor() {
  const editor = document.getElementById('parentContactEditor');
  const form = document.getElementById('parentContactEditForm');
  form?.reset();
  if (editor) editor.classList.add('hidden');
  const id = document.getElementById('parentContactEditId');
  if (id) id.value = '';
  const learner = document.getElementById('parentContactEditLearner');
  if (learner) learner.textContent = '';
}

function renderParentContacts(records) {
  const list = document.getElementById('parentContactList');
  const count = document.getElementById('parentContactCount');
  if (!list) return;
  const visible = Array.isArray(records) ? records : [];
  if (count) count.textContent = `${visible.length} CONTACT${visible.length === 1 ? '' : 'S'}`;
  if (!visible.length) {
    list.innerHTML = '<p style="font-size:.84rem;color:var(--text-muted);">No matching parent or guardian contacts were found.</p>';
    return;
  }
  list.innerHTML = visible.map(record => {
    const encodedId = encodeInlineIdentifier(String(record.id || ''));
    const phone = String(record.guardianPhone || '').trim();
    const email = String(record.guardianEmail || '').trim();
    const emergency = String(record.emergencyContact || '').trim();
    const telHref = parentContactTelHref(phone);
    return `<article class="parent-contact-card">
      <div>
        <h3>${escapeWorkspaceText(record.learnerName || 'Unnamed learner')} <span class="badge-tag info parent-contact-class">${escapeWorkspaceText(record.className || 'Class pending')}</span></h3>
        <div class="parent-contact-details">
          <div class="parent-contact-field"><span>Parent / guardian</span><strong>${escapeWorkspaceText(record.guardianName || 'Not supplied')}</strong></div>
          <div class="parent-contact-field"><span>Guardian phone</span><strong>${escapeWorkspaceText(phone || 'Not supplied')}</strong></div>
          <div class="parent-contact-field"><span>Guardian email</span><strong>${escapeWorkspaceText(email || 'Not supplied')}</strong></div>
          <div class="parent-contact-field"><span>Emergency contact</span><strong>${escapeWorkspaceText(emergency || 'Not supplied')}</strong></div>
        </div>
      </div>
      <div class="parent-contact-actions">
        ${telHref ? `<a class="action-btn btn-green" href="${escapeWorkspaceText(telHref)}">Call guardian</a>` : '<button type="button" class="action-btn" disabled>No phone saved</button>'}
        <button type="button" class="action-btn btn-blue" onclick="copyParentContactField('${encodedId}','guardianPhone')" ${phone ? '' : 'disabled'}>Copy phone</button>
        <button type="button" class="action-btn btn-blue" onclick="copyParentContactField('${encodedId}','guardianEmail')" ${email ? '' : 'disabled'}>Copy email</button>
        <button type="button" class="action-btn btn-blue" onclick="copyParentContactField('${encodedId}','emergencyContact')" ${emergency ? '' : 'disabled'}>Copy emergency</button>
        <button type="button" class="action-btn btn-blue" onclick="copyParentContactSummary('${encodedId}')">Copy all details</button>
        <button type="button" class="action-btn" onclick="openParentContactEditor('${encodedId}')">Edit contact</button>
      </div>
    </article>`;
  }).join('');
}

function filterParentContacts() {
  const query = String(document.getElementById('parentContactSearch')?.value || '').trim().toLowerCase();
  const filtered = query ? parentContactRecords.filter(record => parentContactSearchText(record).includes(query)) : parentContactRecords;
  renderParentContacts(filtered);
}

async function loadParentContacts() {
  const list = document.getElementById('parentContactList');
  if (!list) return;
  list.innerHTML = '<p style="font-size:.84rem;color:var(--text-muted);">Loading parent contacts…</p>';
  try {
    const response = await fetch('/api/parent-contacts');
    const records = await response.json();
    if (!response.ok) throw new Error(records?.message || 'Unable to load parent contacts.');
    parentContactRecords = Array.isArray(records) ? records : [];
    filterParentContacts();
  } catch (error) {
    parentContactRecords = [];
    const count = document.getElementById('parentContactCount');
    if (count) count.textContent = '0 CONTACTS';
    list.textContent = safeUserFacingError(error, 'Unable to load parent contacts.');
  }
}

async function loadRegistry() {
  const list = document.getElementById('registryList');
  if (!list) return;
  try {
    const response = await fetch('/api/registry');
    const records = await response.json();
    list.innerHTML = records.length ? records.map(record => `<div class="item-row"><div><strong>${escapeWorkspaceText(record.learnerName)}</strong> <span class="badge-tag info">${escapeWorkspaceText(record.className || 'Class pending')}</span><p style="margin-top:4px;">Guardian: ${escapeWorkspaceText(record.guardianName)} · ${escapeWorkspaceText(record.guardianPhone)}<br>Medical notes: ${escapeWorkspaceText(record.medicalNotes || 'None recorded')}</p><span class="meta">Registered ${escapeWorkspaceText(record.createdAt)}</span></div></div>`).join('') : '<p style="font-size:.84rem;color:var(--text-muted);">No learner registry records saved yet.</p>';
  } catch { list.textContent = 'Unable to load learner registry.'; }
}
