// records workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function saveWorkspaceRecord(event, module, defaultDetails) {
  if (event) event.preventDefault();
  const detailsInput = event?.target?.querySelector('[name="details"]');
  const details = detailsInput?.value.trim() || defaultDetails;
  if (!details) return;
  const response = await fetch(`/api/modules/${module}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: defaultDetails, details, recordedBy: currentUser?.name || currentUser?.username || 'User' }) });
  if (!response.ok) return alert('Unable to save this record.');
  if (event) event.target.reset();
  await loadWorkspaceRecords(module);
  playDingSound();
}

async function saveStickyNote(event) {
  event.preventDefault();
  const form = event.target;
  const noteId = form.querySelector('[name="noteId"]')?.value || '';
  const title = form.querySelector('[name="noteTitle"]')?.value.trim() || '';
  const details = form.querySelector('[name="details"]')?.value.trim() || '';
  const colour = form.querySelector('[name="colour"]')?.value || 'yellow';
  if (!title || !details) return;
  const response = await fetch(noteId ? `/api/modules/stickyNotes/${encodeURIComponent(noteId)}` : '/api/modules/stickyNotes', { method: noteId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: title, details, colour, recordedBy: currentUser?.name || currentUser?.username || 'User' }) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return alert(payload.message || 'Unable to save this sticky note.');
  }
  cancelStickyNoteEdit();
  await loadStickyNotes();
  playDingSound();
}

function bindStickyNoteForm() {
  const form = document.getElementById('stickyNoteForm');
  if (!form || form.dataset.stickySubmitBound === 'true') return;
  form.addEventListener('submit', saveStickyNote);
  form.dataset.stickySubmitBound = 'true';
}

async function editStickyNote(id) {
  const form = document.getElementById('stickyNoteForm');
  if (!form) return;
  try {
    const response = await fetch('/api/modules/stickyNotes');
    const records = await response.json();
    const note = Array.isArray(records) ? records.find(record => record.id === id) : null;
    if (!response.ok || !note) throw new Error('Sticky note not found.');
    form.querySelector('[name="noteId"]').value = note.id;
    form.querySelector('[name="noteTitle"]').value = note.type || '';
    form.querySelector('[name="details"]').value = note.details || '';
    form.querySelector('[name="colour"]').value = stickyNoteColour(note);
    document.getElementById('stickyNoteSubmit').textContent = 'Save changes';
    document.getElementById('cancelStickyNoteEdit').classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    form.querySelector('[name="noteTitle"]').focus();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to open this sticky note.')); }
}

function cancelStickyNoteEdit() {
  const form = document.getElementById('stickyNoteForm');
  if (!form) return;
  form.reset();
  form.querySelector('[name="noteId"]').value = '';
  document.getElementById('stickyNoteSubmit').textContent = 'Add sticky note';
  document.getElementById('cancelStickyNoteEdit').classList.add('hidden');
}

async function loadStickyNotes() {
  const board = document.getElementById('stickyNotesRecords');
  const canUseStickyNotes = isFullAccessUser() || ['teacher', 'principal'].includes(currentUser?.role);
  if (!canUseStickyNotes) {
    document.getElementById('stickyNotesOverlay')?.replaceChildren();
    document.getElementById('stickyNotesOverlay')?.classList.add('hidden');
    document.getElementById('stickyNotesLauncher')?.classList.add('hidden');
    return;
  }
  try {
    const response = await fetch('/api/modules/stickyNotes');
    const records = await response.json();
    if (!response.ok) throw new Error('Unable to load notes');
    if (board) board.innerHTML = records.length ? records.map(record => `<article class="sticky-note sticky-note--${stickyNoteColour(record)}" title="Double-click to open this floating note" ondblclick="openStickyNote('${record.id}')"><div class="sticky-note-actions"><button type="button" class="sticky-note-edit" title="Edit sticky note" aria-label="Edit ${escapeWorkspaceText(record.type)}" onclick="event.stopPropagation();editStickyNote('${record.id}')" ondblclick="event.stopPropagation()">Edit</button><button type="button" class="sticky-note-delete" title="Delete permanently" aria-label="Delete ${escapeWorkspaceText(record.type)} permanently" onclick="event.stopPropagation();deleteStickyNote('${record.id}')" ondblclick="event.stopPropagation()">×</button></div><strong>${escapeWorkspaceText(record.type || 'Reminder')}</strong><p>${escapeWorkspaceText(record.details || '')}</p><span>${escapeWorkspaceText(record.recordedBy || 'User')} · ${escapeWorkspaceText(record.updatedAt ? `Edited ${record.updatedAt}` : record.createdAt || '')}</span></article>`).join('') : '<div class="record-empty-state"><span class="record-empty-icon" aria-hidden="true">🗒️</span><span><strong>No sticky notes yet</strong><span>Add a staff reminder to begin.</span></span></div>';
    renderFloatingStickyNotes(records);
  } catch { if (board) board.textContent = 'Unable to load sticky notes.'; }
}

function stickyNoteColour(record) {
  return ['yellow', 'teal', 'blue', 'rose'].includes(record?.colour) ? record.colour : 'yellow';
}

function stickyNotePositionKey(id) {
  return `lf_sticky_note_position_${currentUser?.username || 'user'}_${id}`;
}

function stickyNoteClosedKey(id) {
  return `lf_sticky_note_closed_${currentUser?.username || 'user'}_${id}`;
}

function closeStickyNote(id) {
  localStorage.setItem(stickyNoteClosedKey(id), 'true');
  loadStickyNotes();
}

async function deleteStickyNote(id) {
  if (!confirm('Permanently delete this sticky note? This cannot be undone.')) return;
  try {
    const response = await fetch(`/api/modules/stickyNotes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.message || 'Unable to delete this sticky note.');
    }
    localStorage.removeItem(stickyNoteClosedKey(id));
    localStorage.removeItem(stickyNotePositionKey(id));
    await loadStickyNotes();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to delete this sticky note.')); }
}

async function openStickyNote(id) {
  localStorage.removeItem(stickyNoteClosedKey(id));
  await loadStickyNotes();
  const note = [...document.querySelectorAll('#stickyNotesOverlay [data-note-id]')].find(entry => entry.dataset.noteId === id);
  if (note) {
    note.classList.add('is-dragging');
    window.setTimeout(() => note.classList.remove('is-dragging'), 380);
  }
}

function readStickyNotePosition(id, index) {
  try {
    const saved = JSON.parse(localStorage.getItem(stickyNotePositionKey(id)) || 'null');
    if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) return saved;
  } catch {}
  return { left: Math.min(window.innerWidth - 260, 24 + (index % 4) * 34), top: Math.min(window.innerHeight - 210, 112 + (index % 5) * 38) };
}

function clampStickyNotePosition(note, left, top) {
  const width = note.offsetWidth || 244;
  const height = note.offsetHeight || 178;
  return { left: Math.round(Math.max(10, Math.min(left, window.innerWidth - width - 10))), top: Math.round(Math.max(76, Math.min(top, window.innerHeight - height - 10))) };
}

function renderFloatingStickyNotes(records) {
  const overlay = document.getElementById('stickyNotesOverlay');
  const launcher = document.getElementById('stickyNotesLauncher');
  if (!overlay) return;
  if (launcher) launcher.classList.toggle('hidden', !records.length);
  overlay.replaceChildren();
  const visibleRecords = records.filter(record => localStorage.getItem(stickyNoteClosedKey(record.id)) !== 'true');
  overlay.classList.toggle('hidden', !visibleRecords.length);
  visibleRecords.forEach((record, index) => {
    const note = document.createElement('article');
    note.className = `floating-sticky-note floating-sticky-note--${stickyNoteColour(record)}`;
    note.dataset.noteId = record.id;
    note.innerHTML = `<div class="floating-sticky-note-handle" aria-label="Drag ${escapeWorkspaceText(record.type || 'sticky note')}" title="Drag to move"><span>Drag note</span><span><button type="button" class="floating-sticky-note-edit" aria-label="Edit ${escapeWorkspaceText(record.type || 'sticky note')}" title="Edit sticky note">Edit</button><button type="button" class="floating-sticky-note-delete" aria-label="Close ${escapeWorkspaceText(record.type || 'sticky note')}" title="Close note (keeps it saved)">×</button></span></div><strong>${escapeWorkspaceText(record.type || 'Reminder')}</strong><p>${escapeWorkspaceText(record.details || '')}</p><span>${escapeWorkspaceText(record.recordedBy || 'User')} · ${escapeWorkspaceText(record.updatedAt ? `Edited ${record.updatedAt}` : record.createdAt || '')}</span>`;
    overlay.append(note);
    const saved = readStickyNotePosition(record.id, index);
    const position = clampStickyNotePosition(note, saved.left, saved.top);
    note.style.left = `${position.left}px`;
    note.style.top = `${position.top}px`;
    note.querySelector('.floating-sticky-note-handle')?.addEventListener('pointerdown', event => startStickyNoteDrag(event, note));
    note.querySelector('.floating-sticky-note-edit')?.addEventListener('pointerdown', event => event.stopPropagation());
    note.querySelector('.floating-sticky-note-edit')?.addEventListener('click', event => { event.stopPropagation(); editStickyNote(record.id); });
    note.querySelector('.floating-sticky-note-delete')?.addEventListener('pointerdown', event => event.stopPropagation());
    note.querySelector('.floating-sticky-note-delete')?.addEventListener('click', event => { event.stopPropagation(); closeStickyNote(record.id); });
  });
}

function startStickyNoteDrag(event, note) {
  if (event.button !== undefined && event.button !== 0) return;
  if (event.target.closest('button')) return;
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY, left: parseFloat(note.style.left) || 10, top: parseFloat(note.style.top) || 76 };
  note.classList.add('is-dragging');
  note.setPointerCapture?.(event.pointerId);
  const move = moveEvent => {
    const next = clampStickyNotePosition(note, start.left + moveEvent.clientX - start.x, start.top + moveEvent.clientY - start.y);
    note.style.left = `${next.left}px`;
    note.style.top = `${next.top}px`;
  };
  const finish = finishEvent => {
    note.classList.remove('is-dragging');
    note.releasePointerCapture?.(finishEvent.pointerId);
    localStorage.setItem(stickyNotePositionKey(note.dataset.noteId), JSON.stringify({ left: parseFloat(note.style.left), top: parseFloat(note.style.top) }));
    note.removeEventListener('pointermove', move);
    note.removeEventListener('pointerup', finish);
    note.removeEventListener('pointercancel', finish);
  };
  note.addEventListener('pointermove', move);
  note.addEventListener('pointerup', finish);
  note.addEventListener('pointercancel', finish);
}

async function loadWorkspaceRecords(module) {
  const list = document.getElementById(`${module}Records`);
  if (!list) return;
  try {
    const response = await fetch(`/api/modules/${module}`);
    const records = await response.json();
    const emptyIconName = { edit: 'icon-edit', document: 'icon-document', handover: 'icon-handover' }[list.dataset.emptyIcon] || 'icon-document';
    const emptyIcon = `<svg class="ui-icon" aria-hidden="true"><use href="#${emptyIconName}"></use></svg>`;
    const emptyTitle = escapeWorkspaceText(list.dataset.emptyTitle || 'No records yet');
    const emptyText = escapeWorkspaceText(list.dataset.emptyText || 'New records will appear here after they are saved.');
    list.innerHTML = records.length ? records.map(record => `<div class="item-row"><div><strong>${escapeWorkspaceText(record.type || 'Record')}</strong><p style="margin-top:3px;">${escapeWorkspaceText(record.details)}</p><span class="meta">${escapeWorkspaceText(record.recordedBy || 'User')} · ${escapeWorkspaceText(record.createdAt || '')}</span></div>${isFullAccessUser() ? `<button type="button" class="action-btn btn-red" onclick="deleteWorkspaceRecord('${module}','${record.id}')">Delete</button>` : ''}</div>`).join('') : `<div class="record-empty-state"><span class="record-empty-icon" aria-hidden="true">${emptyIcon}</span><span><strong>${emptyTitle}</strong><span>${emptyText}</span></span></div>`;
  } catch { list.textContent = 'Unable to load workspace records.'; }
}

async function deleteWorkspaceRecord(module, id) {
  if (!confirm('Delete this record?')) return;
  await fetch(`/api/modules/${module}/${id}`, { method: 'DELETE' });
  loadWorkspaceRecords(module);
}
