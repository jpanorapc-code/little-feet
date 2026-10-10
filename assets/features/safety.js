// safety workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

async function loadBroadcasts() {
  if (isInternalCompanyRole(currentUser?.role)) return;
  try {
    const userPosition = getCachedAlertPosition();
    const locationQuery = userPosition ? `?lat=${encodeURIComponent(userPosition.latitude)}&lng=${encodeURIComponent(userPosition.longitude)}` : '';
    const res = await fetch(`/api/broadcasts${locationQuery}`);
    const broadcasts = await res.json();
    const listEl = document.getElementById('broadcastList');
    if (!listEl) return;

    if (!res.ok) throw new Error(broadcasts.message || 'Unable to load safety alerts.');
    const visibleBroadcasts = broadcasts;

    const knownAlertIds = new Set(JSON.parse(localStorage.getItem('lf_known_alert_ids') || '[]'));
    const newApplicableAlerts = visibleBroadcasts.filter(alert => !knownAlertIds.has(alert.id));
    if (broadcastsLoaded && newApplicableAlerts.length) playDingSound();
    visibleBroadcasts.forEach(alert => knownAlertIds.add(alert.id));
    localStorage.setItem('lf_known_alert_ids', JSON.stringify([...knownAlertIds].slice(-100)));
    broadcastsLoaded = true;

    updateAlertLocationFilterStatus();
    listEl.innerHTML = visibleBroadcasts.length
      ? visibleBroadcasts.map(b => `
          <div class="item-row" style="border-left-color: #dc2626; flex-direction: column; align-items: flex-start;">
            <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
              <span class="badge-tag urgent">${escapeWorkspaceText(b.bcPriority || 'Urgent Notice')}</span>
              <div style="display:flex;gap:8px;align-items:center;"><span class="meta">${escapeWorkspaceText(b.timestamp || 'Recent')}${b.radiusKm ? ` · ${escapeWorkspaceText(b.radiusKm)}km area` : ''}</span>${(isFullAccessUser() || currentUser?.role === 'principal') ? `<button type="button" onclick="deleteBroadcast('${encodeInlineIdentifier(b.id)}')" class="action-btn btn-red" style="margin:0;padding:4px 8px;">Delete</button>` : ''}</div>
            </div>
            <p style="margin-top:6px; font-size:0.92rem; color:var(--text-dark);">${escapeWorkspaceText(b.bcMessage)}</p>
            <div style="margin-top:7px;"><button type="button" onclick="markBroadcastRead('${encodeInlineIdentifier(b.id)}')" class="action-btn btn-blue" style="padding:4px 8px;display:${(isFullAccessUser() || currentUser?.role === 'principal') ? 'none' : 'inline-block'};">Mark as read</button><span class="meta" style="margin-left:8px;display:${(isFullAccessUser() || currentUser?.role === 'principal') ? 'inline' : 'none'};">${b.readBy?.length || 0} recipient acknowledgement(s)</span></div>
          </div>
        `).join('')
      : '<p style="font-size:0.85rem; color:var(--text-muted);">No alerts apply to your current location.</p>';
  } catch (e) {
    logAppError('ERR_BC_001', 'Unable to fetch campus broadcast alerts.');
  }
}

async function loadSafetyNetwork() {
  const summary = document.getElementById('safetyNetworkSummary');
  const visitorList = document.getElementById('safetyNetworkVisitors');
  if (!summary || !(isFullAccessUser() || currentUser?.role === 'principal')) return;
  try {
    const response = await fetch('/api/safety-network');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load campus safety status.');
    summary.innerHTML = [["Learners marked present", data.presentLearners], ["Visitors on campus", data.visitorsOnCampus], ["Active broadcasts", data.activeBroadcasts], ["Alert acknowledgements", data.acknowledgements]].map(([label, value]) => `<div class="workspace-card"><h3>${value}</h3><p>${label}</p></div>`).join('');
    visitorList.innerHTML = data.visitors.length ? `<h3 class="workspace-heading">Currently on campus</h3>${data.visitors.map(visitor => `<div class="item-row"><div><strong>${escapeWorkspaceText(visitor.visitorName)}</strong><p style="margin-top:4px;">Host: ${escapeWorkspaceText(visitor.host || 'School office')} · ${escapeWorkspaceText(visitor.purpose)}</p><span class="meta">Checked in ${new Date(visitor.checkedInAt).toLocaleString()}</span></div><button type="button" class="action-btn btn-blue" onclick="checkOutCampusVisitor('${visitor.id}')">Check out</button></div>`).join('')}` : '<p class="meta">No approved visitors are currently checked in.</p>';
  } catch (error) { summary.innerHTML = `<p class="meta">${escapeWorkspaceText(safeUserFacingError(error, 'Unable to load this information.'))}</p>`; }
}

async function loadVisitorMeetingRecipients() {
  const select = document.getElementById('visitorMeetingHost');
  if (!select || currentUser?.role !== 'parent') return;
  try {
    const response = await fetch('/api/visitor-meetings/recipients');
    const people = await response.json();
    if (!response.ok) throw new Error(people.message || 'Unable to load meeting recipients.');
    select.innerHTML = '<option value="">Choose teacher or principal</option>' + people.map(person => `<option value="${escapeWorkspaceText(person.username)}">${escapeWorkspaceText(person.name || person.username)} · ${escapeWorkspaceText(person.role)}</option>`).join('');
  } catch { select.innerHTML = '<option value="">No authorised staff available</option>'; }
}

async function loadVisitorMeetings() {
  const list = document.getElementById('visitorMeetingList');
  if (!list || !(isFullAccessUser() || ['parent','teacher','principal'].includes(currentUser?.role))) return;
  try {
    const response = await fetch('/api/visitor-meetings');
    const meetings = await response.json();
    if (!response.ok) throw new Error(meetings.message || 'Unable to load meeting requests.');
    list.innerHTML = meetings.length ? meetings.map(meeting => {
      const status = String(meeting.status || '').replaceAll('-', ' ');
      let actions = '';
      if (currentUser.role === 'teacher' && meeting.status === 'awaiting-teacher-response') actions = `<button type="button" class="action-btn btn-green" onclick="respondVisitorMeeting('${meeting.id}','accept')">Accept time</button><button type="button" class="action-btn btn-blue" onclick="respondVisitorMeeting('${meeting.id}','counter')">Counter-offer</button>`;
      if (currentUser.role === 'parent' && meeting.status === 'awaiting-parent-confirmation') actions = `<button type="button" class="action-btn btn-green" onclick="confirmVisitorMeeting('${meeting.id}')">Confirm agreed time</button>`;
      if ((isFullAccessUser() || currentUser.role === 'principal') && meeting.status === 'awaiting-principal-approval') actions = `<button type="button" class="action-btn btn-green" onclick="approveVisitorMeeting('${meeting.id}')">Approve & issue QR pass</button>`;
      return `<div class="item-row"><div><strong>${escapeWorkspaceText(meeting.parentName)} → ${escapeWorkspaceText(meeting.hostName)}</strong><p style="margin-top:4px;">${escapeWorkspaceText(meeting.purpose)}<br>Meeting: ${escapeWorkspaceText(meeting.agreedAt || meeting.proposedAt)}</p><span class="meta">Status: ${escapeWorkspaceText(status)}</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;">${actions}</div></div>`;
    }).join('') : '<p class="meta">No meeting requests are waiting for your action.</p>';
  } catch (error) { list.textContent = safeUserFacingError(error, 'Unable to load meeting requests.'); }
}

async function respondVisitorMeeting(id, action) {
  let agreedAt = '';
  if (action === 'counter') { agreedAt = prompt('Enter the alternative meeting date and time (for example 2026-09-05 14:30):') || ''; if (!agreedAt) return; }
  const response = await fetch(`/api/visitor-meetings/${encodeURIComponent(id)}/respond`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action, agreedAt }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to update this meeting.');
  playDingSound(); loadVisitorMeetings();
}

async function confirmVisitorMeeting(id) {
  const response = await fetch(`/api/visitor-meetings/${encodeURIComponent(id)}/confirm`, { method:'POST' });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to confirm this meeting.');
  playDingSound(); loadVisitorMeetings();
}

async function approveVisitorMeeting(id) {
  const response = await fetch(`/api/visitor-meetings/${encodeURIComponent(id)}/approve-visitor`, { method:'POST' });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Unable to approve visitor entry.');
  playDingSound(); loadVisitorMeetings(); loadSafetyNetwork(); printVisitorPass(result.visitor, result.passCode);
}

async function checkInCampusVisitor() {
  const field = document.getElementById('visitorPassCode');
  const response = await fetch('/api/campus-visitors/check-in', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ passCode: field?.value || '' }) });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Visitor entry could not be validated.');
  if (field) field.value = ''; playDingSound(); loadSafetyNetwork(); alert(`${result.visitor.visitorName} is checked in.`);
}

async function checkOutCampusVisitor(id) {
  const response = await fetch(`/api/campus-visitors/${encodeURIComponent(id)}/check-out`, { method:'POST' });
  const result = await response.json();
  if (!response.ok) return alert(result.message || 'Visitor check-out failed.');
  loadSafetyNetwork();
}

async function printVisitorPass(visitor, passCode) {
  const safe = escapeWorkspaceText;
  let qrImage = '';
  if (window.QRCode) {
    const holder = document.createElement('div');
    new window.QRCode(holder, { text: passCode, width: 180, height: 180, correctLevel: window.QRCode.CorrectLevel.M });
    await new Promise(resolve => setTimeout(resolve, 80));
    qrImage = holder.querySelector('canvas')?.toDataURL('image/png') || holder.querySelector('img')?.src || '';
  }
  const popup = window.open('', '_blank', 'width=760,height=900');
  if (!popup) return alert('Allow pop-ups for Little Feet to print the visitor ticket.');
  popup.document.write(`<!doctype html><title>Little Feet Visitor Pass</title><style>body{font-family:Arial;padding:36px;color:#102a43}.pass{max-width:620px;border:3px solid #0d9488;border-radius:18px;padding:30px}.code{font-size:28px;letter-spacing:3px;font-weight:bold;color:#0f766e;padding:18px 0;border-top:1px dashed #0d9488;border-bottom:1px dashed #0d9488}.qr{width:180px;height:180px;display:block;margin:20px auto}.meta{color:#526d82;line-height:1.6}@media print{body{padding:0}}</style><main class="pass"><p> LITTLE FEET · AUTHORISED VISITOR</p><h1>Campus visitor ticket</h1><p><strong>${safe(visitor.visitorName)}</strong><br>${safe(visitor.purpose)}<br>Host: ${safe(visitor.host || 'School office')}<br>Meeting: ${safe(visitor.expectedDate)}</p>${qrImage ? `<img class="qr" src="${qrImage}" alt="QR visitor pass">` : ''}<div class="code">${safe(passCode)}</div><p class="meta">Present this QR ticket at the gate. Security validates it with Little Feet before admitting the visitor. It is single-use and becomes invalid once checked in.</p></main><script>window.onload=()=>window.print();<\/script>`); popup.document.close();
}

function stopVisitorQrScan() {
  visitorScannerStream?.getTracks().forEach(track => track.stop());
  visitorScannerStream = null;
  closeModal();
}

async function scanVisitorPassCode() {
  if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) return alert('This device does not support camera QR scanning. Enter the visitor pass code shown beneath the QR image instead.');
  try {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    openModal('Scan visitor QR ticket', '<p class="meta" style="margin:0 0 10px;">Hold the school-issued QR ticket inside the frame. The server will still validate it before entry is recorded.</p><video id="visitorScannerVideo" autoplay playsinline style="width:100%;border-radius:10px;background:#07111e;"></video><button type="button" class="action-btn btn-blue" style="margin-top:12px;" onclick="stopVisitorQrScan()">Cancel scan</button>');
    visitorScannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
    const video = document.getElementById('visitorScannerVideo');
    if (!video) return stopVisitorQrScan();
    video.srcObject = visitorScannerStream;
    const scanFrame = async () => {
      if (!visitorScannerStream || !video.videoWidth) return visitorScannerStream && requestAnimationFrame(scanFrame);
      try {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue) {
          const field = document.getElementById('visitorPassCode');
          if (field) field.value = codes[0].rawValue.trim().toUpperCase();
          stopVisitorQrScan();
          return;
        }
      } catch { /* Continue scanning while the camera frame settles. */ }
      if (visitorScannerStream) requestAnimationFrame(scanFrame);
    };
    video.onloadedmetadata = () => requestAnimationFrame(scanFrame);
  } catch {
    stopVisitorQrScan();
    alert('Camera access was unavailable. Enter the visitor pass code manually.');
  }
}

function getCachedAlertPosition() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(ALERT_LOCATION_SESSION_KEY) || 'null');
    if (!cached || !Number.isFinite(Number(cached.latitude)) || !Number.isFinite(Number(cached.longitude))) return null;
    return { latitude: Number(cached.latitude), longitude: Number(cached.longitude), capturedAt: cached.capturedAt || null };
  } catch {
    return null;
  }
}

function cacheAlertPosition(position) {
  const cached = {
    latitude: Number(Number(position.latitude).toFixed(5)),
    longitude: Number(Number(position.longitude).toFixed(5)),
    capturedAt: new Date().toISOString()
  };
  sessionStorage.setItem(ALERT_LOCATION_SESSION_KEY, JSON.stringify(cached));
  return cached;
}

function updateAlertLocationFilterStatus() {
  const status = document.getElementById('alertLocationFilterStatus');
  if (!status) return;
  const cached = getCachedAlertPosition();
  status.textContent = cached
    ? `Location filtering enabled for this browser tab · last refreshed ${new Date(cached.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : 'Location filtering is off until you choose to enable it.';
}

function requestCurrentPositionFromUserGesture() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      position => resolve(position.coords),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
    );
  });
}

async function enableAlertLocationFiltering() {
  const position = await requestCurrentPositionFromUserGesture();
  if (!position) return alert('Location access was not available. Little Feet will continue without location-based filtering.');
  cacheAlertPosition(position);
  updateAlertLocationFilterStatus();
  loadBroadcasts();
}

async function setAlertLocation() {
  const position = await requestCurrentPositionFromUserGesture();
  if (!position) return alert('Location access is required to create an area-based alert.');
  cacheAlertPosition(position);
  alertLocation = { lat: position.latitude, lng: position.longitude };
  document.getElementById('bcLocation').value = `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
  updateAlertLocationFilterStatus();
}

async function deleteBroadcast(id) {
  if (!confirm('Delete this emergency alert?')) return;
  await fetch(`/api/broadcasts/${id}`, { method: 'DELETE' });
  loadBroadcasts();
}

async function markBroadcastRead(id) {
  if (!currentUser) return;
  await fetch(`/api/broadcasts/${id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser.username }) });
  loadBroadcasts();
}

function quickCareLog(activity) {
  const learner = prompt(`Who is this ${activity.toLowerCase()} for? Enter learner or class name.`);
  if (!learner || !learner.trim()) return;
  saveWorkspaceRecord(null, 'dailyCare', `${activity}: ${learner.trim()}`);
}

async function loadConsentRecords() {
  const list = document.getElementById('consentRecords');
  if (!list) return;
  const response = await fetch('/api/consents');
  const records = await response.json();
  list.innerHTML = records.length ? records.map(record => `<div class="item-row"><div><strong>${escapeWorkspaceText(record.learnerName)}</strong><p style="margin-top:3px;">Guardian: ${escapeWorkspaceText(record.guardianName)} · Internal updates: ${record.internalUpdates ? 'Allowed' : 'Not allowed'} · Marketing: ${record.marketingPhotos ? 'Allowed' : 'Not allowed'}</p><span class="meta">${escapeWorkspaceText(record.capturedAt)}</span></div></div>`).join('') : '<p class="meta">No consent decisions recorded.</p>';
}

async function loadPickupRecords() {
  const list = document.getElementById('pickupRecords');
  if (!list) return;
  const response = await fetch('/api/pickups');
  const records = await response.json();
  list.innerHTML = records.length ? records.map(record => `<div class="item-row"><div><strong>${escapeWorkspaceText(record.action)} · ${escapeWorkspaceText(record.learnerName)}</strong><p style="margin-top:3px;">Verified adult: ${escapeWorkspaceText(record.pickupAdult)} · Recorded by: ${escapeWorkspaceText(record.recordedBy)}</p><span class="meta">${escapeWorkspaceText(record.timestamp)}</span></div></div>`).join('') : '<p class="meta">No handover audit records recorded.</p>';
}
