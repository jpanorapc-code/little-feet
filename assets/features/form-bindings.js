// form-bindings workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function addFormTemplates(form, label, templates, applyTemplate) {
  if (!form || form.dataset.templatesReady) return;
  form.dataset.templatesReady = 'true';
  const bar = document.createElement('div');
  bar.className = 'form-template-bar';
  const select = document.createElement('select');
  select.name = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_template`;
  select.id = `${form.id || 'form'}_template`;
  select.setAttribute('aria-label', `${label} template`);
  select.innerHTML = `<option value="">Choose a ${label.toLowerCase()} template…</option>${templates.map((template, index) => `<option value="${index}">${template.label}</option>`).join('')}`;
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'action-btn btn-blue'; button.textContent = 'Use template';
  button.addEventListener('click', () => { const template = templates[Number(select.value)]; if (!template) return; applyTemplate(template); });
  const hint = document.createElement('span'); hint.textContent = 'Templates save time; review every field before saving.';
  bar.append(select, button, hint); form.prepend(bar);
}

function setupFormTemplates() {
  addFormTemplates(document.getElementById('scheduleForm'), 'schedule', [
    { label: 'Morning learning block', day: 'Monday', time: '08:00 - 08:30', activity: 'Morning circle: welcome, weather, and attendance' },
    { label: 'Literacy activity', day: 'Tuesday', time: '09:00 - 09:45', activity: 'Early literacy: story time, sounds, and name writing' },
    { label: 'Outdoor movement', day: 'Wednesday', time: '10:00 - 10:40', activity: 'Outdoor play: gross-motor movement and cooperative games' }
  ], template => { const [start, end] = template.time.split(' - '); document.getElementById('schDay').value = template.day; document.getElementById('schStartTime').value = start; document.getElementById('schEndTime').value = end; document.getElementById('schActivity').value = template.activity; });

  addFormTemplates(document.getElementById('ticketForm'), 'support request', [
    { label: 'Fee or payment question', department: 'Finance', priority: 'Normal', subject: 'Request for account assistance', message: 'Please review the account and advise on the next steps.' },
    { label: 'Medical information update', department: 'Medical', priority: 'High', subject: 'Learner medical information update', message: 'Please contact me to confirm the correct process for updating this learner’s medical information.' },
    { label: 'General school query', department: 'Admin', priority: 'Normal', subject: 'School administration query', message: 'Please provide guidance or arrange a suitable time to discuss this request.' },
    { label: 'Request a meeting', department: 'Principal & School Leadership', priority: 'Medium', subject: 'Meeting request', message: 'I would like to arrange a meeting to discuss the following matter: [add details].' }
  ], template => { document.getElementById('ticketDept').value = template.department; document.getElementById('ticketPriority').value = template.priority; document.getElementById('ticketSubject').value = template.subject; document.getElementById('ticketMessage').value = template.message; });

  addFormTemplates(document.getElementById('broadcastForm'), 'alert', [
    { label: 'Weather closure notice', priority: 'Weather Alert', message: 'Important: The school is monitoring severe weather conditions. Please check this notice for the next update and follow school collection instructions.' },
    { label: 'Health and safety notice', priority: 'Urgent Medical', message: 'Important safety notice: Please follow the school’s collection and access instructions. Contact the school office if you need assistance.' },
    { label: 'General campus notice', priority: 'Campus Notice', message: 'School notice: Please review this update and contact the school office if you have questions.' }
  ], template => { document.getElementById('bcPriority').value = template.priority; document.getElementById('bcMessage').value = template.message; });

  addFormTemplates(document.getElementById('reportPublishForm'), 'report', [
    { label: 'Monthly learning summary', title: 'Monthly learning summary', period: new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' }) },
    { label: 'Assessment feedback', title: 'Assessment feedback and next steps', period: new Date().toLocaleString(undefined, { month: 'long', year: 'numeric' }) },
    { label: 'Term progress report', title: 'Term progress report', period: 'Term 3, 2026' }
  ], template => { document.getElementById('reportTitle').value = template.title; document.getElementById('reportPeriod').value = template.period; });

  const incidentForm = document.querySelector("form[onsubmit*=\"'care','Incident report'\"]");
  addFormTemplates(incidentForm, 'incident report', [
    { label: 'Minor playground incident', details: 'Learner: [name]. Time: [time]. Location: playground. Objective facts: [what was observed]. Immediate action: [first aid / supervision]. Parent notified: [yes/no].' },
    { label: 'Behaviour observation', details: 'Learner: [name]. Time: [time]. Location: [area]. Objective facts: [what was observed]. Support provided: [action]. Parent notified: [yes/no].' }
  ], template => { const input = incidentForm.querySelector('[name="details"]'); if (input) input.value = template.details; });
}

function setupFormListeners() {
  const signingPinForm = document.getElementById('signingPinForm');
  if (signingPinForm) signingPinForm.addEventListener('submit', async event => {
    event.preventDefault();
    const response = await fetch('/api/report-signing-pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser?.username, pin: document.getElementById('reportSigningPin').value }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to save signing PIN.');
    signingPinForm.reset(); alert('Signing PIN saved.');
  });

  const reportPublishForm = document.getElementById('reportPublishForm');
  if (reportPublishForm) reportPublishForm.addEventListener('submit', async event => {
    event.preventDefault();
    const signature = reportSignaturePads.teacherSignaturePad;
    if (!signature?.hasStroke()) return alert('Add the teacher signature before publishing.');
    const response = await fetch('/api/report-reviews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentName: document.getElementById('reportStudent').value.trim(), reportTitle: document.getElementById('reportTitle').value.trim(), period: document.getElementById('reportPeriod').value.trim(), parentUsername: document.getElementById('reportParentUsername').value.trim(), teacherUsername: currentUser?.username, signingPin: document.getElementById('reportTeacherPin').value, signatureData: signature.canvas.toDataURL('image/png') }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to publish report.');
    reportPublishForm.reset(); clearSignature('teacherSignaturePad'); loadReportReviews(); playDingSound();
  });

  const accountForm = document.getElementById('accountForm');
  if (accountForm) {
    accountForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const originalUsername = document.getElementById('accountOriginalUsername').value;
      const body = {
        name: document.getElementById('accountName').value.trim(),
        username: document.getElementById('accountUsername').value.trim(),
        pin: document.getElementById('accountPin').value,
        role: document.getElementById('accountRole').value,
        schoolName: document.getElementById('accountSchoolName').value.trim(),
        schoolStoreUrl: document.getElementById('accountStoreUrl').value.trim(),
        assignedClasses: document.getElementById('accountAssignedClasses').value.trim(),
        linkedLearners: document.getElementById('accountLinkedLearners').value.trim(),
        schoolPosition: isInternalCompanyRole(document.getElementById('accountRole').value) ? '' : document.getElementById('accountPosition')?.value,
        schoolSector: isInternalCompanyRole(document.getElementById('accountRole').value) ? '' : document.getElementById('accountSector')?.value,
        actorUsername: currentUser?.username
      };
      if (!originalUsername && !body.pin) return alert('Set a password or PIN for the new account.');
      if (!isInternalCompanyRole(body.role) && !body.schoolName) return alert('Choose a linked school for this school-facing account.');
      const response = await fetch(originalUsername ? `/api/accounts/${encodeURIComponent(originalUsername)}` : '/api/accounts', { method: originalUsername ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) return alert(result.message || 'Unable to save account.');
      resetAccountForm();
      loadAccounts();
      playDingSound();
    });
  }

  const registryForm = document.getElementById('registryForm');
  if (registryForm) {
    registryForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(registryForm).entries());
      const response = await fetch('/api/registry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const result = await response.json();
      if (!response.ok) return alert(result.message || 'Unable to save learner registry record.');
      registryForm.reset();
      await loadRegistry();
      playDingSound();
    });
  }

  const parentContactEditForm = document.getElementById('parentContactEditForm');
  if (parentContactEditForm) {
    parentContactEditForm.addEventListener('submit', async event => {
      event.preventDefault();
      const recordId = document.getElementById('parentContactEditId').value;
      if (!recordId) return alert('Choose a parent contact to edit.');
      const body = {
        guardianName: document.getElementById('parentContactEditGuardianName').value.trim(),
        guardianPhone: document.getElementById('parentContactEditGuardianPhone').value.trim(),
        guardianEmail: document.getElementById('parentContactEditGuardianEmail').value.trim(),
        emergencyContact: document.getElementById('parentContactEditEmergency').value.trim()
      };
      const response = await fetch(`/api/registry/${encodeURIComponent(recordId)}/contact`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) return alert(result.message || 'Unable to update the parent contact.');
      closeParentContactEditor();
      await Promise.allSettled([loadParentContacts(), loadRegistry()]);
      showParentContactNotice('Contact details updated.');
      playDingSound();
    });
  }

    const consentForm = document.getElementById('consentForm');
  if (consentForm) consentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch('/api/consents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ learnerName: document.getElementById('consentLearner').value.trim(), guardianName: document.getElementById('consentGuardian').value.trim(), internalUpdates: document.getElementById('consentInternal').checked, marketingPhotos: document.getElementById('consentMarketing').checked }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to record consent.');
    consentForm.reset(); loadConsentRecords(); playDingSound();
  });

  const pickupForm = document.getElementById('pickupForm');
  if (pickupForm) pickupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const response = await fetch('/api/pickups/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ learnerName: document.getElementById('pickupLearner').value.trim(), pickupAdult: document.getElementById('pickupAdult').value.trim(), verificationCode: document.getElementById('pickupCode').value, action: document.getElementById('pickupAction').value, recordedBy: currentUser?.name || currentUser?.username }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to create the audit record.');
    pickupForm.reset(); loadPickupRecords(); playDingSound();
  });

  const chatForm = document.getElementById('chatForm');
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const groupId = document.getElementById('chatGroupSelect').value;
      const message = document.getElementById('chatInput').value;
      const textColor = document.getElementById('chatColorPicker').value;

      if (!groupId) return alert('Create or select a staff group channel first.');
      if (!message.trim() || !currentUser) return;

      await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, sender: currentUser.username, message, textColor })
      });

      document.getElementById('chatInput').value = '';
      loadGroupChatMessages();
      playDingSound();
    });
  }

  const directForm = document.getElementById('directChatForm');
  if (directForm) {
    directForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const recipient = document.getElementById('directRecipientSelect').value;
      const message = document.getElementById('directChatInput').value;
      const textColor = document.getElementById('directChatColorPicker').value;

      if (!recipient) return alert('Select a chat recipient first.');
      if (!message.trim() || !currentUser) return;

      await fetch('/api/chat/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: currentUser.username, recipient, message, textColor })
      });

      document.getElementById('directChatInput').value = '';
      loadDirectChatMessages();
      playDingSound();
    });
  }

  const bcForm = document.getElementById('broadcastForm');
  if (bcForm) {
    bcForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        bcPriority: document.getElementById('bcPriority').value,
        bcMessage: document.getElementById('bcMessage').value,
        radiusKm: Number(document.getElementById('bcRadius').value) || 5,
        location: alertLocation
      };

      if (!alertLocation) return alert('Use your current location before dispatching an area-based alert.');

      await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      bcForm.reset();
      alertLocation = null;
      document.getElementById('bcLocation').value = '';
      loadBroadcasts();
      playDingSound();
    });
  }

  const visitorMeetingForm = document.getElementById('visitorMeetingRequestForm');
  if (visitorMeetingForm) visitorMeetingForm.addEventListener('submit', async event => {
    event.preventDefault();
    const response = await fetch('/api/visitor-meetings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ hostUsername: document.getElementById('visitorMeetingHost').value, proposedAt: document.getElementById('visitorMeetingTime').value, purpose: document.getElementById('visitorMeetingPurpose').value.trim() }) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to submit the meeting request.');
    visitorMeetingForm.reset();
    playDingSound();
    loadVisitorMeetings();
  });

  const lookupForm = document.getElementById('studentLookupForm');
  if (lookupForm) {
    lookupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const className = document.getElementById('lookupClass').value;
      const childName = document.getElementById('lookupChild').value;

      try {
        const res = await fetch(`/api/students/search?className=${encodeURIComponent(className)}&childName=${encodeURIComponent(childName)}&username=${encodeURIComponent(currentUser?.username || '')}`);
        const results = await res.json();
        const box = document.getElementById('lookupResults');

        box.innerHTML = results.length
          ? results.map(s => `
              <div class="item-row" style="flex-direction: column; align-items: flex-start;">
                <strong>${escapeWorkspaceText(s.studentName)}</strong> <span class="badge-tag info">${s.className}</span>
                <div style="font-size:0.85rem; margin-top:4px;">
                  <p>Guardian: <strong>${escapeWorkspaceText(s.parentName)}</strong> (${escapeWorkspaceText(s.contactEmail)})</p>
                  <p style="color:#ef4444; margin-top:2px;"><strong>⚕ Medical / allergy card:</strong> ${escapeWorkspaceText(s.medicalNotes)}</p>
                  <p style="margin-top:2px;"><strong>Emergency:</strong> ${escapeWorkspaceText(s.emergencyContact || 'Not recorded')}<br><strong>Authorised pickup:</strong> ${escapeWorkspaceText(s.authorisedPickups || 'Not recorded')}</p>
                </div>
              </div>
            `).join('')
          : '<p style="font-size:0.85rem; color:var(--text-muted);">No student records matched your query parameters.</p>';
      } catch (err) {
        logAppError('ERR_LOOKUP_500', 'Failed to perform student information query.');
      }
    });
  }
}
