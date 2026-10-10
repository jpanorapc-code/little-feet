// accounts workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function requestOwnAccountDeletion() {
  if (!currentUser || isFullAccessUser()) return alert('Administrators can manage accounts directly from Account Management.');
  if (!confirm('Are you sure you want to request deletion of your account? Your account will stay active until an administrator reviews the request.')) return;
  try {
    const response = await fetch('/api/account-deletion-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to submit the account deletion request.');
    alert('Account deletion request sent to your administrator as a support ticket.');
    if (typeof loadTickets === 'function') loadTickets();
  } catch {
    alert('Unable to reach the account deletion service. Please try again.');
  }
}

async function loadAccounts() {
  const list = document.getElementById('accountsList');
  if (!list || !canManageSchoolAccounts()) return;
  const session = accountSessionGeneration + ":" + workspaceSessionKey();
  try {
    const response = await fetch(`/api/accounts?actorUsername=${encodeURIComponent(currentUser.username)}`);
    const accounts = await response.json();
    if (session !== accountSessionGeneration + ":" + workspaceSessionKey()) return;
    if (!response.ok) throw new Error(accounts?.message || 'Unable to load account records.');
    if (!Array.isArray(accounts)) throw new Error('Account records returned an invalid response.');
    if (!accountRoleCatalog) {
      const catalogResponse = await fetch('/api/accounts/catalog');
      const catalog = await catalogResponse.json();
      if (session !== accountSessionGeneration + ':' + workspaceSessionKey()) return;
      if (!catalogResponse.ok) throw new Error(catalog.message || 'Unable to load positions.');
      accountRoleCatalog = catalog;
    }
    updateAccountRoleFields();
    accountsCache = accounts;
    const accountSelector = document.getElementById('accountEditSelect');
    if (accountSelector) {
      const previousSelection = accountSelector.value;
      accountSelector.innerHTML = `<option value="">Create a new account / select an existing account</option>${accounts.map(account => `<option value="${encodeURIComponent(account.username)}">${escapeWorkspaceText(account.name || account.username)} · ${escapeWorkspaceText(account.username)} · ${escapeWorkspaceText(displayRoleName(account))}</option>`).join('')}`;
      if (previousSelection && [...accountSelector.options].some(option => option.value === previousSelection)) accountSelector.value = previousSelection;
    }
    list.innerHTML = accounts.map(account => `<div class="item-row"><div><strong>${escapeWorkspaceText(account.name)}</strong> <span class="badge-tag info">${escapeWorkspaceText(displayRoleName(account))}</span><p style="margin-top:4px;">${escapeWorkspaceText(account.username)}<br><span style="color:var(--text-muted);">Linked school: ${escapeWorkspaceText(account.schoolName || 'Not linked · Little Feet company account')}${account.schoolSector ? `<br>Sector: ${escapeWorkspaceText(account.schoolSector)}` : ''}${account.schoolStoreUrl ? ' · Web store linked' : ' · No web store linked'}${account.role === 'parent' ? `<br>Requested learners: ${escapeWorkspaceText((account.requestedLearnerLinks || []).join(', ') || 'None')}<br>Approved learners: ${escapeWorkspaceText((account.linkedLearners || []).join(', ') || 'None yet')}<br>Relationship: ${escapeWorkspaceText(account.parentRelationshipStatus || 'Pending administrator approval')}</span>` : '</span>'}${account.verificationStatus ? `<br><span class="meta">Account status: ${escapeWorkspaceText(account.verificationStatus)}</span>` : ''}</p></div><div style="display:flex;gap:8px;flex-wrap:wrap;">${account.canManage !== false && String(account.verificationStatus || '').toLowerCase().includes('pending') ? `<button type="button" class="action-btn btn-green" onclick="approveAccount('${encodeInlineIdentifier(account.username)}')">Approve account</button>` : ''}${account.canManage !== false && account.role === 'parent' && account.requestedLearnerLinks?.length ? `<button type="button" class="action-btn btn-green" onclick="approveRequestedLearnerLinks('${encodeInlineIdentifier(account.username)}')">Approve learner request</button>` : ''}${account.canManage === false ? '<span class="meta">Protected company owner</span>' : `<button type="button" class="action-btn btn-blue" onclick="editAccountByUsername('${encodeInlineIdentifier(account.username)}')">Edit</button>`}${account.canDelete !== false ? `<button type="button" class="action-btn btn-red" onclick="deleteAccount('${encodeInlineIdentifier(account.username)}')">Delete</button>` : ''}</div></div>`).join('');
  } catch (error) {
    if (session !== accountSessionGeneration + ":" + workspaceSessionKey()) return;
    accountsCache = [];
    const accountSelector = document.getElementById('accountEditSelect');
    if (accountSelector) accountSelector.innerHTML = '<option value="">Unable to load accounts — try again</option>';
    list.textContent = error?.message || 'Unable to load account records.';
  }
}

function hideAccountSchoolSearchResults() {
  const box = document.getElementById('accountSchoolSearchResults');
  if (!box) return;
  box.style.display = 'none';
  box.innerHTML = '';
}

function selectAccountSchool(encodedName) {
  const name = decodeURIComponent(String(encodedName || ''));
  const linkedSchool = document.getElementById('accountSchoolName');
  const search = document.getElementById('accountSchoolSearch');
  if (linkedSchool) linkedSchool.value = name;
  if (search) search.value = name;
  hideAccountSchoolSearchResults();
  linkedSchool?.dispatchEvent(new Event('change', { bubbles:true }));
}

async function searchAccountSchools(query, token) {
  const box = document.getElementById('accountSchoolSearchResults');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<div class="meta" style="padding:9px 10px;">Searching schools…</div>';
  try {
    const response = await fetch(`/api/schools/search?q=${encodeURIComponent(query)}`, { cache:'no-store' });
    const data = await response.json();
    if (token !== accountSchoolSearchToken) return;
    if (!response.ok) throw new Error(data.message || 'Unable to search schools.');
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      box.innerHTML = `<div class="meta" style="padding:9px 10px;">No school matched “${escapeWorkspaceText(query)}”. ${currentUser?.role === 'crm' ? 'Choose a registered client school.' : 'You can still type the linked school name manually.'}</div>`;
      return;
    }
    box.innerHTML = results.map(result => {
      const encodedName = escapeWorkspaceText(encodeURIComponent(result.name || ''));
      const locality = result.locality ? ` · ${escapeWorkspaceText(result.locality)}` : '';
      const source = escapeWorkspaceText(result.source || 'School search');
      return `<button type="button" data-account-school-choice="${encodedName}" style="display:block;width:100%;padding:10px 11px;border:0;border-bottom:1px solid var(--border-color);background:transparent;color:var(--text-dark);text-align:left;cursor:pointer;"><strong>${escapeWorkspaceText(result.name || '')}</strong><br><span class="meta">${source}${locality}</span></button>`;
    }).join('');
    box.querySelectorAll('[data-account-school-choice]').forEach(button => {
      button.addEventListener('click', () => selectAccountSchool(button.dataset.accountSchoolChoice));
    });
  } catch (error) {
    if (token !== accountSchoolSearchToken) return;
    box.innerHTML = `<div class="meta" style="padding:9px 10px;">${escapeWorkspaceText(safeUserFacingError(error, 'School search is temporarily unavailable.'))} You can still enter the linked school manually.</div>`;
  }
}

function queueAccountSchoolSearch(force = false) {
  const field = document.getElementById('accountSchoolSearch');
  const box = document.getElementById('accountSchoolSearchResults');
  if (!field || !box) return;
  const query = field.value.trim();
  window.clearTimeout(accountSchoolSearchTimer);
  if (query.length < 2) {
    accountSchoolSearchToken += 1;
    if (force && query.length) {
      box.style.display = 'block';
      box.innerHTML = '<div class="meta" style="padding:9px 10px;">Type at least 2 characters to search.</div>';
    } else hideAccountSchoolSearchResults();
    return;
  }
  const token = ++accountSchoolSearchToken;
  accountSchoolSearchTimer = window.setTimeout(() => searchAccountSchools(query, token), force ? 0 : 280);
}

function resetAccountForm() {
  const form = document.getElementById('accountForm');
  if (!form) return;
  form.reset();
  const accountSelector = document.getElementById('accountEditSelect');
  if (accountSelector) accountSelector.value = '';
  const schoolSearch = document.getElementById('accountSchoolSearch');
  if (schoolSearch) schoolSearch.value = '';
  hideAccountSchoolSearchResults();
  document.getElementById('accountOriginalUsername').value = '';
  document.getElementById('accountSaveButton').textContent = 'Create account';
  const deleteButton = document.getElementById('accountDeleteButton');
  if (deleteButton) deleteButton.style.display = 'none';
  const resetLoginButton = document.getElementById('accountResetLoginWaitButton');
  if (resetLoginButton) resetLoginButton.style.display = 'none';
  document.getElementById('accountPinHint').textContent = '*';
  document.getElementById('accountPin').placeholder = 'Required for a new account';
  updateAccountRoleFields();
}

function updateAccountRoleFields() {
  const roleSelect = document.getElementById('accountRole');
  const companyAccess = Boolean(currentUser && (currentUser.role === 'admin' && currentUser.platformAccess === true));
  roleSelect?.querySelectorAll('option').forEach(option => { const denied = isInternalCompanyRole(option.value) && !companyAccess; option.disabled = denied; option.hidden = denied; });
  const companyGroup = roleSelect?.querySelector('optgroup[data-company-roles]');
  if (companyGroup) companyGroup.hidden = !companyAccess;
  if (roleSelect?.selectedOptions[0]?.disabled) roleSelect.value = 'parent';
  const role = roleSelect?.value || 'parent';
  const schoolField = document.getElementById('accountSchoolName');
  const schoolRequired = document.getElementById('accountSchoolRequired');
  const schoolHelp = document.getElementById('accountSchoolHelp');
  const internalRole = isInternalCompanyRole(role);
  const positionField = document.getElementById('accountPosition');
  const sectorField = document.getElementById('accountSector');
  for (const field of [positionField, sectorField]) { field?.closest('.school-position-field')?.classList.toggle('hidden', internalRole); if (field) field.disabled = internalRole; }
  if (positionField && accountRoleCatalog) { const value=positionField.value; positionField.replaceChildren(...(accountRoleCatalog.positions[role] || []).map(name => new Option(name,name))); if ([...positionField.options].some(option => option.value===value)) positionField.value=value; }
  if (sectorField && accountRoleCatalog && !sectorField.options.length) sectorField.replaceChildren(...accountRoleCatalog.sectors.map(name => new Option(name,name)));
  document.getElementById('accountAssignedClasses')?.closest('div')?.classList.toggle('hidden', role !== 'teacher');
  document.getElementById('accountLinkedLearners')?.closest('div[style*="grid-column"]')?.classList.toggle('hidden', role !== 'parent');
  document.getElementById('accountStoreUrl')?.closest('div')?.classList.toggle('hidden', internalRole);
  const descriptions = { school_hr:'Manage staff tasks, leave, qualifications and performance reviews for the linked school.', school_staff:'Assigned school work, leave, qualifications and communication. No learner grades, medical files, finance or user administration.', parent:'Access to approved linked children and family payments.', teacher:'Assigned classrooms, learner records and teaching tools.', principal:'School leadership, operations and staff management.', district:'School oversight and permitted reports.', admin:'Manage users and administration for the linked school.', school_accounts:'Finance and payment records for the linked school.', staff:'Personal company tasks, leave, training and communication.', crm:'Client follow-ups and school user management for registered clients.', accounts:'Little Feet subscription invoices and confirmed payment records.', support:'Client support tickets, assignments and service communication.' };
  const hint = document.getElementById('accountRoleDescription');
  if (hint) hint.textContent = descriptions[role] || '';

  if (schoolField) {
    schoolField.required = !internalRole;
    schoolField.placeholder = internalRole ? 'Optional · link to a school only if needed' : 'e.g. Little Feet ECD Portal';
  }
  if (schoolRequired) schoolRequired.textContent = internalRole ? '(optional)' : '*';
  if (schoolHelp) schoolHelp.textContent = internalRole
    ? 'Little Feet company staff can work without a school link. A school link is an association; company-role permissions still apply.'
    : 'Required for school-facing accounts.';
}

function editAccount(account) {
  if (account.canManage === false) return alert('Only the company owner can change this protected owner account.');
  const accountSelector = document.getElementById('accountEditSelect');
  if (accountSelector) accountSelector.value = encodeInlineIdentifier(account.username);
  document.getElementById('accountOriginalUsername').value = account.username;
  document.getElementById('accountName').value = account.name || '';
  document.getElementById('accountUsername').value = account.username || '';
  document.getElementById('accountRole').value = account.role || 'parent';
  document.getElementById('accountSchoolName').value = account.schoolName || '';
  const schoolSearch = document.getElementById('accountSchoolSearch');
  if (schoolSearch) schoolSearch.value = account.schoolName || '';
  hideAccountSchoolSearchResults();
  updateAccountRoleFields();
  if (document.getElementById('accountPosition') && account.schoolPosition) document.getElementById('accountPosition').value = account.schoolPosition;
  if (document.getElementById('accountSector') && account.schoolSector) document.getElementById('accountSector').value = account.schoolSector;
  document.getElementById('accountStoreUrl').value = account.schoolStoreUrl || '';
  document.getElementById('accountAssignedClasses').value = (account.assignedClasses || []).join(', ');
  document.getElementById('accountLinkedLearners').value = (account.linkedLearners || []).join(', ');
  document.getElementById('accountPin').value = '';
  document.getElementById('accountPinHint').textContent = '(leave empty to keep password)';
  document.getElementById('accountPin').placeholder = 'Enter only to reset password';
  document.getElementById('accountSaveButton').textContent = 'Save account changes';
  const deleteButton = document.getElementById('accountDeleteButton');
  if (deleteButton) deleteButton.style.display = account.canDelete === false ? 'none' : 'inline-flex';
  const resetLoginButton = document.getElementById('accountResetLoginWaitButton');
  if (resetLoginButton) resetLoginButton.style.display = 'inline-flex';
  document.getElementById('accountsTab').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function editAccountByUsername(encodedUsername) {
  const account = accountsCache.find(entry => entry.username === decodeURIComponent(encodedUsername));
  if (account) editAccount(account);
}

function selectAccountForEditing(encodedUsername) {
  if (!encodedUsername) {
    resetAccountForm();
    return;
  }
  const account = accountsCache.find(entry => entry.username === decodeURIComponent(encodedUsername));
  if (!account) {
    resetAccountForm();
    return alert('That account is no longer available. Refresh the account list and try again.');
  }
  editAccount(account);
}

async function openLearnerLinkPicker() {
  const role = document.getElementById('accountRole')?.value;
  if (role !== 'parent') return alert('Linked learners can only be assigned to a parent account. Choose the Parent role first.');
  const schoolName = document.getElementById('accountSchoolName')?.value.trim();
  if (currentUser?.role === 'crm' && !schoolName) return alert('Choose the client school first.');
  const session = accountSessionGeneration + ":" + workspaceSessionKey();
  try {
    const response = await fetch(currentUser?.role === 'crm' ? `/api/accounts/learner-options?schoolName=${encodeURIComponent(schoolName)}` : `/api/students/search?username=${encodeURIComponent(currentUser?.username || '')}`);
    const learners = await response.json();
    if (session !== accountSessionGeneration + ":" + workspaceSessionKey()) return;
    if (!response.ok) return alert(learners.message || 'Unable to load learner records.');
    if (!learners.length) return alert('No learner records are available to link yet. Add or import learners first.');
    const field = document.getElementById('accountLinkedLearners');
    const selected = new Set((field?.value || '').split(',').map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
    const options = learners.map(learner => {
      const name = String(learner.studentName || '');
      return `<label style="display:flex;align-items:center;gap:9px;padding:10px;border:1px solid var(--border-color);border-radius:8px;cursor:pointer;"><input type="checkbox" name="linkedLearners" class="learner-link-choice" value="${escapeWorkspaceText(name)}" ${selected.has(name.toLocaleLowerCase()) ? 'checked' : ''}><span><strong>${escapeWorkspaceText(name)}</strong><br><span class="meta">${escapeWorkspaceText(learner.className || 'Class not recorded')}</span></span></label>`;
    }).join('');
    openModal('Choose linked learners', `<p style="margin:0 0 12px;color:var(--text-muted);">Select up to four children for this parent account.</p><div id="learnerLinkChoices" style="display:grid;gap:8px;max-height:46vh;overflow:auto;">${options}</div><button type="button" class="submit-btn" style="margin-top:14px;" onclick="saveLearnerLinks()">Save linked learners</button>`);
  } catch {    alert('Unable to load learner records. Please try again.');
  }
}

function saveLearnerLinks() {
  const choices = [...document.querySelectorAll('.learner-link-choice:checked')];
  if (choices.length > 4) return alert('A parent account can be linked to a maximum of four learners.');
  const field = document.getElementById('accountLinkedLearners');
  if (field) field.value = choices.map(choice => choice.value).join(', ');
  closeModal();
}

async function deleteAccount(encodedUsername) {
  if (!confirm('Are you sure you want to delete this user/account? This cannot be undone.')) return;
  const response = await fetch(`/api/accounts/${encodedUsername}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser?.username }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to delete account.');
  loadAccounts();
}

async function deleteSelectedAccount() {
  const originalUsername = document.getElementById('accountOriginalUsername')?.value;
  if (!originalUsername) return alert('Choose an account to edit before deleting it.');
  await deleteAccount(encodeURIComponent(originalUsername));
  resetAccountForm();
}

async function resetSelectedAccountLoginWait() {
  const originalUsername = document.getElementById('accountOriginalUsername')?.value;
  if (!originalUsername) return alert('Choose an account first.');
  const account = accountsCache.find(entry => entry.username === originalUsername);
  const label = account?.name || originalUsername;
  if (!confirm(`Clear the 10-minute sign-in wait for ${label}? This does not change the password.`)) return;
  try {
    const response = await fetch(`/api/accounts/${encodeURIComponent(originalUsername)}/reset-login-lockout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const result = await response.json();
    if (!response.ok) return alert(result.message || 'Unable to reset the sign-in wait.');
    alert(result.message || 'The sign-in wait has been cleared.');
    playDingSound();
  } catch {
    alert('Unable to reset the sign-in wait. Please try again.');
  }
}

async function approveAccount(encodedUsername) {
  const response = await fetch(`/api/accounts/${encodedUsername}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser?.username })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to approve this account.');
  loadAccounts();
  playDingSound();
}

async function approveRequestedLearnerLinks(encodedUsername) {
  if (!canManageSchoolAccounts()) return alert('Account management access is required to approve learner relationships.');
  const account = accountsCache.find(entry => entry.username === decodeURIComponent(encodedUsername));
  if (!account?.requestedLearnerLinks?.length) return alert('There are no pending learner requests for this account.');
  const requested = account.requestedLearnerLinks.join(', ');
  if (!confirm(`Approve ${requested} for ${account.name || account.username}?`)) return;
  const response = await fetch(`/api/accounts/${encodeURIComponent(account.username)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: account.username, name: account.name, role: account.role, schoolName: account.schoolName, schoolStoreUrl: account.schoolStoreUrl, assignedClasses: (account.assignedClasses || []).join(', '), linkedLearners: requested })
  });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to approve the learner relationship.');
  await loadAccounts();
  playDingSound();
}
