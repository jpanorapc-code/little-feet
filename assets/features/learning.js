// learning workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function loadPosts() {
  if (isInternalCompanyRole(currentUser?.role)) return;
  try {
    const res = await fetch('/api/posts');
    const posts = await res.json();
    document.getElementById('postList').innerHTML = posts.length
      ? posts.map(p => `
          <div class="item-row" style="flex-direction: column; align-items: flex-start;">
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <span class="badge-tag info">Audience: ${escapeWorkspaceText(p.audience || 'All')}</span>
                <p style="font-size:0.95rem; margin-top:6px; color: var(--text-dark);">${escapeWorkspaceText(p.caption)}</p>
              </div>
              <button type="button" onclick="deletePost('${encodeInlineIdentifier(p.id)}')" class="action-btn btn-red">🗑️ Delete</button>
            </div>
            ${p.mediaUrl ? `<img src="${p.mediaUrl}" class="post-item" onclick="openModal('Media File Preview', '<img src=\\'${p.mediaUrl}\\' style=\\'max-width:100%; max-height:80vh; object-fit:contain; border-radius:6px;\\'>')">` : ''}
            <div class="meta"><span>Posted by Staff (${escapeWorkspaceText(p.createdAt || 'Recent')})</span></div>
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No updates published yet.</p>';
  } catch (err) {
    logAppError('ERR_POST_001', 'Failed to retrieve Activity Feed posts.');
  }
}

async function deletePost(id) {
  if (!confirm('Are you sure you want to delete this activity post?')) return;
  await fetch(`/api/posts/${id}`, { method: 'DELETE' });
  loadPosts();
}

async function loadSchedules() {
  try {
    const res = await fetch('/api/schedules');
    const list = await res.json();
    document.getElementById('scheduleList').innerHTML = list.length
      ? list.map(s => `
          <div class="item-row">
            <div>
              <span class="badge-tag">${escapeWorkspaceText(s.dayOfWeek)}</span>
              <strong>${escapeWorkspaceText(s.studentName)}</strong> - <span style="color:#0d9488; font-weight:600;">${escapeWorkspaceText(s.timeSlot)}</span>
              <p style="font-size:0.88rem; margin-top:4px; color: var(--text-muted);">Activity / Subject: ${escapeWorkspaceText(s.activity)}</p>
            </div>
            <button type="button" onclick="deleteSchedule('${encodeInlineIdentifier(s.id)}')" class="action-btn btn-red">🗑️ Delete</button>
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No active schedule records found.</p>';
  } catch (err) {
    logAppError('ERR_SCHED_001', 'Could not load student schedules.');
  }
}

async function deleteSchedule(id) {
  if (!confirm('Delete this submitted schedule record?')) return;
  await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
  loadSchedules();
}

async function exportScheduleExcel() {
  const res = await fetch('/api/schedules');
  const list = await res.json();
  if (!list.length) return alert('No schedules available to export.');

  const exportData = list.map(s => ({
    "ID": s.id,
    "Student Name": s.studentName,
    "Day of Week": s.dayOfWeek,
    "Time Slot Block": s.timeSlot,
    "Activity Module": s.activity
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Test Results Schedule");
  XLSX.writeFile(workbook, "LittleFeet_TestResultsSchedule.xlsx");
}

async function importScheduleExcel() {
  const fileInput = document.getElementById('excelFileInput');
  const file = fileInput ? fileInput.files[0] : null;
  if (!file) {
    logAppError('ERR_FILE_404', 'Excel file import attempted without selecting a file.');
    return alert('Select a valid Excel (.xlsx / .xls) or CSV file.');
  }
  const fileError = validateSpreadsheetFile(file);
  if (fileError) return alert(fileError);

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      if (rows.length > 2001) throw new Error('Schedule imports are limited to 2,000 records per file.');

      const schedules = rows.slice(1).map(row => ({
        id: row[0] ? String(row[0]) : Date.now().toString(),
        studentName: row[1] || '',
        dayOfWeek: row[2] || 'Monday',
        timeSlot: row[3] || '',
        activity: row[4] || ''
      })).filter(s => s.studentName.trim() !== '');

      const res = await fetch('/api/schedules/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedules })
      });

      if (!res.ok) throw new Error('Backend failed to parse Excel rows.');

      alert('Excel batch sync complete!');
      fileInput.value = '';
      loadSchedules();
    } catch (err) {
      logAppError('ERR_EXCEL_400', 'File cannot be read: corrupt format or invalid worksheet columns.');
      alert('Error reading Excel spreadsheet file.');
    }
  };
  reader.readAsArrayBuffer(file);
}

async function loadWorksheets() {
  try {
    const res = await fetch('/api/worksheets');
    const list = await res.json();
    document.getElementById('worksheetList').innerHTML = list.length
      ? list.map(w => `
          <div class="item-row" style="flex-direction: column; align-items: flex-start;">
            <div style="width: 100%; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;">
              <div>
                <strong>${escapeWorkspaceText(w.studentName)}</strong> — ${escapeWorkspaceText(w.title)} 
                <span class="badge-tag" style="background-color: #16a34a; margin-left: 6px;">Score: ${escapeWorkspaceText(w.grade)}%</span>
              </div>
              <div>
                ${w.photoUrl ? `<button type="button" onclick="viewWorksheetFile('${encodeInlineIdentifier(w.id)}')" class="action-btn btn-blue">👁️ View Attached File</button>` : ''}
                <button type="button" onclick="deleteWorksheet('${encodeInlineIdentifier(w.id)}')" class="action-btn btn-red">🗑️ Delete</button>
              </div>
            </div>
            
            <div class="meta" style="margin-top:8px;">
              <span>Submitted By: <strong style="color:var(--primary-color);">${escapeWorkspaceText(w.submittedBy || 'Educator')}</strong></span>
              <span>• Upload Date: ${escapeWorkspaceText(w.uploadedAt || 'Recently')}</span>
            </div>
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No graded worksheets uploaded.</p>';
  } catch (err) {
    logAppError('ERR_WS_001', 'Unable to fetch worksheet submissions portfolio.');
  }
}

async function viewWorksheetFile(id) {
  try {
    const res = await fetch('/api/worksheets');
    const list = await res.json();
    const item = list.find(w => w.id === id);
    if (item && item.photoUrl) {
      openModal(`Submission File View: ${item.studentName}`, `
        <div style="text-align:center;">
          <p style="font-size:0.85rem; margin-bottom:10px;">Submitted by: <strong>${escapeWorkspaceText(item.submittedBy)}</strong> | Title: ${escapeWorkspaceText(item.title)}</p>
          <img src="${item.photoUrl}" style="max-width:100%; max-height:75vh; border-radius:6px; border:1px solid var(--border-color); object-fit:contain;">
        </div>
      `);
    } else {
      logAppError('ERR_FILE_404', `File content missing for ID: ${id}`);
      alert('File payload could not be read.');
    }
  } catch (e) {
    logAppError('ERR_WS_404', 'Error retrieving submission file preview.');
  }
}

async function deleteWorksheet(id) {
  if (!confirm('Delete this graded submission file record?')) return;
  await fetch(`/api/worksheets/${id}`, { method: 'DELETE' });
  loadWorksheets();
}

function canManageBadges() {
  return isFullAccessUser() || ['teacher', 'principal'].includes(currentUser?.role);
}

async function loadBadges() {
  try {
    if (!currentUser) return;
    const res = await fetch(`/api/badges?username=${encodeURIComponent(currentUser.username)}`);
    if (!res.ok) throw new Error('Unable to load badges.');
    const list = await res.json();
    const wall = document.getElementById('badgeWallLog');
    if (!wall) return;

    wall.innerHTML = list.length
      ? list.map(b => `
          <div class="item-row" style="justify-content: space-between; align-items: flex-start;">
            <div>
              <span class="badge-tag" style="background:#10b981;">${escapeWorkspaceText(b.category)}</span>
              <strong style="font-size:1.05rem; color:#fff;">${escapeWorkspaceText(b.title || b.awardName)}</strong>
              <span style="color:#a7f3d0;">— ${escapeWorkspaceText(b.studentName)}</span>
              <p style="font-size:0.88rem; margin-top:4px; font-style:italic; color:var(--text-muted);">"${escapeWorkspaceText(b.note)}"</p>
            </div>
            ${canManageBadges() ? `<button type="button" onclick="deleteBadge('${encodeInlineIdentifier(String(b.id || ''))}')" class="action-btn btn-red">🗑️ Delete</button>` : ''}
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No milestone badges awarded yet.</p>';
  } catch (err) {
    logAppError('ERR_BDG_001', 'Failed to render digital badges archive.');
  }
}

function syncMilestoneChoice(value = badgeCategory?.value) {
  milestoneChoices.forEach(choice => {
    const selected = choice.dataset.value === value;
    choice.classList.toggle('is-selected', selected);
    choice.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

async function deleteBadge(encodedId) {
  if (!canManageBadges()) return alert('Only authorised school staff can remove badges.');
  if (!confirm('Are you sure you want to delete this awarded badge?')) return;
  const id = decodeURIComponent(String(encodedId || ''));
  const response = await fetch(`/api/badges/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actorUsername: currentUser.username }) });
  if (!response.ok) {
    const result = await response.json();
    return alert(result.message || 'Unable to remove this badge.');
  }
  loadBadges();
}

function downloadScheduleTemplate() {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading. Please try again in a moment.');
  const rows = [
    { 'ID (optional)': '', 'Student Name': 'Example Learner', 'Day of Week': 'Monday', 'Time Slot Block': '08:00 - 09:00', 'Activity Module': 'Morning circle and literacy' },
    { 'ID (optional)': '', 'Student Name': 'Example Learner', 'Day of Week': 'Monday', 'Time Slot Block': '09:00 - 10:00', 'Activity Module': 'Outdoor play' }
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Schedule import');
  XLSX.writeFile(workbook, 'LittleFeet_Schedule_Import_Template.xlsx');
}
