// attendance workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function loadAttendance() {
  try {
    const res = await fetch('/api/attendance');
    if (!res.ok) throw new Error('Attendance backend unreadable');
    const list = await res.json();

    document.getElementById('attendanceList').innerHTML = list.length
      ? list.map(a => `
          <div class="item-row">
            <div>
              <strong>${escapeWorkspaceText(a.studentName)}</strong> <span class="meta" style="display:inline;">(${escapeWorkspaceText(a.status)} at ${escapeWorkspaceText(a.timestamp || 'Today')})</span>
            </div>
            <div>
              <button type="button" onclick="toggleAttendance('${a.id}', '${a.status === 'Checked In' ? 'Checked Out' : 'Checked In'}')" class="action-btn ${a.status === 'Checked In' ? 'btn-red' : 'btn-green'}">
                ${a.status === 'Checked In' ? 'Mark Out' : 'Mark In'}
              </button>
              <button type="button" onclick="removeAttendance('${a.id}')" class="action-btn btn-red" style="padding: 4px 8px; font-size: 0.75rem;">🗑️ Delete</button>
            </div>
          </div>`).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No students checked in today.</p>';
  } catch (err) {
    logAppError('ERR_ATT_500', 'Failed to render Attendance Registry roster.');
  }
}

async function importAttendanceExcel() {
  const fileInput = document.getElementById('attExcelFileInput');
  const file = fileInput ? fileInput.files[0] : null;
  if (!file) {
    logAppError('ERR_FILE_404', 'Attendance file import attempted without selecting a file.');
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
      if (rows.length > 2001) throw new Error('Attendance imports are limited to 2,000 records per file.');

      const attendanceData = rows.slice(1).map(row => ({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
        studentName: row[0] ? String(row[0]).trim() : '',
        status: row[1] && String(row[1]).trim() ? String(row[1]).trim() : 'Checked In',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      })).filter(a => a.studentName !== '');

      const res = await fetch('/api/attendance/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attendance: attendanceData })
      });

      if (!res.ok) throw new Error('Backend failed to parse Excel rows.');

      alert('Attendance Excel Sheet imported successfully!');
      fileInput.value = '';
      loadAttendance();
    } catch (err) {
      logAppError('ERR_EXCEL_400', 'File cannot be read: corrupt format or invalid worksheet columns.');
      alert('Error reading Attendance Excel spreadsheet file.');
    }
  };
  reader.readAsArrayBuffer(file);
}

async function toggleAttendance(id, status) {
  await fetch('/api/attendance/toggle', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ id, status }) 
  });
  loadAttendance();
}

async function removeAttendance(id) {
  if (!confirm('Are you sure you want to delete this attendance record?')) return;
  await fetch(`/api/attendance/${id}`, { method: 'DELETE' });
  loadAttendance();
}

function downloadAttendanceTemplate() {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading. Please try again in a moment.');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet([
    { 'Learner Name': 'Example Learner', Status: 'Present' },
    { 'Learner Name': 'Example Learner 2', Status: 'Absent' }
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance import');
  XLSX.writeFile(workbook, 'LittleFeet_Attendance_Import_Template.xlsx');
}
