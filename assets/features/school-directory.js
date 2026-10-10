// school-directory workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function southAfricaNow(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    year: Number(parts.year), weekday: parts.weekday,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function campusHours() {
  const text = document.getElementById('currentTermText')?.textContent || '';
  const match = text.match(/Campus Hours:\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/i);
  if (!match) return { open: 7 * 60, close: 17 * 60 + 30, label: '07:00 - 17:30' };
  const open = Number(match[1]) * 60 + Number(match[2]);
  const close = Number(match[3]) * 60 + Number(match[4]);
  return { open, close, label: `${match[1].padStart(2, '0')}:${match[2]} - ${match[3].padStart(2, '0')}:${match[4]}` };
}

function updateSchoolDayStatus() {
  const pill = document.getElementById('navLivePill');
  if (!pill) return;
  const now = southAfricaNow();
  const hours = campusHours();
  const calendar = SA_PUBLIC_SCHOOL_CALENDAR[now.year];
  const weekday = !['Sat', 'Sun'].includes(now.weekday);
  const inTerm = !calendar || calendar.terms.some(([start, end]) => now.dateKey >= start && now.dateKey <= end);
  const holiday = Boolean(calendar?.closed.has(now.dateKey));
  const withinHours = now.minutes >= hours.open && now.minutes < hours.close;
  const open = weekday && inTerm && !holiday && withinHours;
  pill.textContent = open ? 'School day in progress' : 'School closed';
  pill.classList.toggle('is-closed', !open);
  let reason = `Campus hours ${hours.label} SAST`;
  if (!weekday) reason = 'Closed for the weekend';
  else if (holiday) reason = 'Closed for a South African public or special school holiday';
  else if (!inTerm) reason = 'Closed during the official public-school break';
  else if (now.minutes < hours.open) reason = `Opens at ${hours.label.split(' - ')[0]} SAST`;
  else if (now.minutes >= hours.close) reason = `Closed at ${hours.label.split(' - ')[1]} SAST`;
  pill.title = `${reason} · ${now.dateKey}`;
  pill.setAttribute('aria-label', `${pill.textContent}. ${reason}`);
}

async function loadAcademicTerm() {
  if (isInternalCompanyRole(currentUser?.role)) return;
  try {
    const res = await fetch('/api/term');
    const data = await res.json();
    if (data.term) {
      document.getElementById('currentTermText').textContent = data.term;
      updateSchoolDayStatus();
    }
  } catch (err) {
    logAppError('ERR_TERM_LOAD', 'Failed to load academic term.');
  }
}

function editTermModal() {
  const currentText = document.getElementById('currentTermText').textContent;
  const html = `
    <form id="editTermForm">
      <label for="termInput">Academic Term Description & Status:</label>
      <input type="text" id="termInput" value="${currentText.replace(/"/g, '&quot;')}" required>
      <button type="submit" class="submit-btn">💾 Save Academic Term</button>
    </form>`;
  openModal('Edit Academic Term Ribbon', html);

  document.getElementById('editTermForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newTerm = document.getElementById('termInput').value.trim();
    if (!newTerm) return;

    await fetch('/api/term', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ term: newTerm })
    });
    document.getElementById('currentTermText').textContent = newTerm;
    updateSchoolDayStatus();
    closeModal();
    playDingSound();
  });
}

async function loadSchoolProximityMap() {
  const container = document.getElementById('schoolMapContainer');
  const findButton = document.getElementById('findSchoolMapButton');
  const closeButton = document.getElementById('closeSchoolMapButton');
  if (!container) return;
  const requestToken = ++schoolMapRequestToken;
  container.classList.remove('hidden');
  closeButton?.classList.remove('hidden');
  findButton?.setAttribute('aria-expanded', 'true');
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  container.innerHTML = '📍 Requesting location permission and searching live school data…';
  navigator.geolocation.getCurrentPosition(async (position) => {
    if (requestToken !== schoolMapRequestToken) return;
    const userLat = position.coords.latitude;
    const userLng = position.coords.longitude;
    const userPos = [userLat, userLng];
    container.innerHTML = '<div id="interactiveMap" style="width:100%; height:100%; border-radius:8px;"></div>';

    if (typeof L === 'undefined') {
      container.textContent = 'Map service could not be loaded. Please refresh the page and try again.';
      return;
    }
    if (mapInstance) mapInstance.remove();

    // Disabling Leaflet's mobile tap shim prevents one physical tap being
    // interpreted as a marker click followed by a map click that closes the card.
    mapInstance = L.map('interactiveMap', { closePopupOnClick: false, tap: false }).setView(userPos, 12);
    mapInstance.on('click', () => {
      hideSchoolPinCard();
      mapInstance.closePopup();
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(mapInstance);
    const userLocationIcon = L.divIcon({ className: '', html: '<div class="user-location-pin" title="Your current location"></div>', iconSize: [30, 30], iconAnchor: [15, 15] });
    L.marker(userPos, { icon: userLocationIcon, zIndexOffset: 1000 }).addTo(mapInstance).bindPopup(`<strong>📍 Your Current Location</strong><br>Lat: ${userLat.toFixed(5)}, Long: ${userLng.toFixed(5)}`, { autoClose: false, closeOnClick: false, keepInView: true }).openPopup();
    L.circle(userPos, { color: '#2dd4bf', fillColor: '#14b8a6', fillOpacity: 0.14, radius: 20000 }).addTo(mapInstance);
    const latitudeOffset = 20000 / 111320;
    const longitudeOffset = 20000 / (111320 * Math.cos(userLat * Math.PI / 180));
    mapInstance.fitBounds([[userLat - latitudeOffset, userLng - longitudeOffset], [userLat + latitudeOffset, userLng + longitudeOffset]], { padding: [22, 22], maxZoom: 13 });

    const status = L.control({ position: 'topright' });
    status.onAdd = () => {
      const element = L.DomUtil.create('div');
      element.style.cssText = 'background:#fff; color:#0f172a; padding:8px 10px; border-radius:4px; box-shadow:0 1px 5px rgba(0,0,0,.35); font-size:12px; font-weight:600;';
      element.textContent = 'Loading live nearby schools…';
      return element;
    };
    status.addTo(mapInstance);

    const escapeHtml = (value) => String(value || 'Not listed in OpenStreetMap').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const distanceInMetres = (lat, lng) => {
      const radians = (degrees) => degrees * Math.PI / 180;
      const earthRadius = 6371000;
      const latDifference = radians(lat - userLat);
      const lngDifference = radians(lng - userLng);
      const a = Math.sin(latDifference / 2) ** 2 + Math.cos(radians(userLat)) * Math.cos(radians(lat)) * Math.sin(lngDifference / 2) ** 2;
      return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    try {
      const cacheKey = `lf_nearby_school_cache_${userLat.toFixed(2)}_${userLng.toFixed(2)}`;
      let payload;
      let usingCachedResults = false;
      try {
        const schoolSearchUrl = `/api/nearby-schools?lat=${encodeURIComponent(userLat)}&lng=${encodeURIComponent(userLng)}&radius=20000`;
        let lastSearchError;
        // Public map providers occasionally reject a single request while they are
        // healthy again a moment later. Retry twice before using the saved result.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const response = await fetch(schoolSearchUrl, { cache: 'no-store' });
            const candidate = await response.json();
            if (!response.ok) throw new Error(candidate.message || 'Unable to load live nearby schools.');
            payload = candidate;
            break;
          } catch (error) {
            lastSearchError = error;
            if (attempt < 2) await new Promise(resolve => window.setTimeout(resolve, 700 * (attempt + 1)));
          }
        }
        if (!payload) throw lastSearchError || new Error('Unable to load live nearby schools.');
        // Storage can be blocked in private browsing or restricted web views.
        // Map pins must still render when caching is unavailable.
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), payload })); } catch { /* live result remains usable without a cache */ }
      } catch (liveError) {
        let cached = null;
        try { cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null'); } catch { cached = null; }
        if (!cached?.payload?.elements?.length || Date.now() - Number(cached.savedAt || 0) > 24 * 60 * 60 * 1000) throw liveError;
        payload = cached.payload;
        usingCachedResults = true;
      }

      if (requestToken !== schoolMapRequestToken || !mapInstance) return;
      const seenSchools = new Set();
      const nearbySchools = payload.elements.map((place) => {
        const tags = place.tags || {};
        const lat = Number(place.lat ?? place.center?.lat);
        const lng = Number(place.lon ?? place.center?.lon);
        const name = tags.name || tags['name:en'] || 'Unnamed education facility';
        return { tags, lat, lng, name, key: `${name.toLowerCase()}|${lat.toFixed(5)}|${lng.toFixed(5)}` };
      }).filter((school) => Number.isFinite(school.lat) && Number.isFinite(school.lng) && distanceInMetres(school.lat, school.lng) <= 20000)
        .filter((school) => !seenSchools.has(school.key) && seenSchools.add(school.key))
        .sort((a, b) => distanceInMetres(a.lat, a.lng) - distanceInMetres(b.lat, b.lng));

      const safeExternalUrl = (value) => {
        if (!value) return '';
        const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        try {
          const url = new URL(candidate);
          return /^https?:$/.test(url.protocol) ? url.href : '';
        } catch {
          return '';
        }
      };
      const markerLayer = typeof L.markerClusterGroup === 'function'
        ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, chunkedLoading: true, chunkInterval: 80, chunkDelay: 15, animate: false, removeOutsideVisibleBounds: true, zoomToBoundsOnClick: true })
        : L.layerGroup();

      nearbySchools.forEach((school) => {
        const street = [school.tags['addr:housenumber'], school.tags['addr:street']].filter(Boolean).join(' ') || 'Not listed in OpenStreetMap';
        const suburb = school.tags['addr:suburb'] || school.tags['addr:neighbourhood'] || school.tags['addr:district'] || 'Not listed in OpenStreetMap';
        const town = school.tags['addr:city'] || school.tags['addr:town'] || school.tags['addr:village'] || 'Not listed in OpenStreetMap';
        const category = school.tags.amenity || school.tags.building || 'education facility';
        const phone = school.tags['contact:phone'] || school.tags.phone || school.tags['contact:mobile'] || school.tags.mobile || '';
        const email = school.tags['contact:email'] || school.tags.email || '';
        const website = safeExternalUrl(school.tags['contact:website'] || school.tags.website || '');
        const imageUrl = safeExternalUrl(school.tags.image || school.tags['contact:image'] || '');
        const contactSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(`${school.name} ${town} contact`)}`;
        const photo = imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(school.name)}" style="display:block; width:100%; max-height:130px; margin:0 0 8px; object-fit:cover; border-radius:5px;">`
          : '<p class="school-muted" style="font-size:0.75rem; margin:7px 0 0;"><strong>Photo:</strong> Not publicly listed in OpenStreetMap.</p>';
        const contact = `<p style="font-size:0.8rem; margin:7px 0 0;"><strong>Phone:</strong> ${phone ? `<a href="tel:${escapeHtml(phone)}">${escapeHtml(phone)}</a>` : 'Not publicly listed'}<br><strong>Email:</strong> ${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : 'Not publicly listed'}<br><strong>Website:</strong> ${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener noreferrer">Visit school website</a>` : `Not publicly listed · <a href="${escapeHtml(contactSearchUrl)}" target="_blank" rel="noopener noreferrer">Find official contact</a>`}</p>`;
        school.details = { street, suburb, town, category, phone, email, website, imageUrl };
        const content = `<div class="school-popup" style="padding:4px; font-family:sans-serif; min-width:240px; max-width:290px;"><h3 style="margin:0 0 6px; font-size:0.95rem;">🏫 ${escapeHtml(school.name)}</h3>${photo}<p style="font-size:0.8rem; margin:0 0 4px;"><strong>Type:</strong> ${escapeHtml(category)}<br><strong>Coordinates:</strong> Lat ${school.lat.toFixed(5)}, Long ${school.lng.toFixed(5)}</p><p style="font-size:0.8rem; margin:0;"><strong>Street Address:</strong> ${escapeHtml(street)}<br><strong>Suburb:</strong> ${escapeHtml(suburb)}<br><strong>Town / City:</strong> ${escapeHtml(town)}</p>${contact}<div class="school-enrichment" style="margin-top:9px;"><button type="button" class="action-btn btn-green" style="margin:0 0 7px;" onclick="openSchoolDetail(${nearbySchools.indexOf(school)})">View details / apply</button><button type="button" class="action-btn btn-blue" style="margin:0;" onclick="enrichSchoolPin(this, decodeURIComponent('${encodeInlineIdentifier(school.name)}'), ${school.lat}, ${school.lng})">Check verified public details</button><p class="school-muted" style="font-size:.72rem;margin:6px 0 0;">Uses verified public details only. No AI-generated school details are saved automatically.</p></div></div>`;
        const marker = L.marker([school.lat, school.lng], { riseOnHover: true }).bindPopup(content, { autoClose: false, closeOnClick: false, closeOnEscapeKey: false, keepInView: true, autoPanPadding: [20, 20], maxWidth: 310 });
        marker.on('click', event => {
          if (event.originalEvent) L.DomEvent.stop(event.originalEvent);
          showSchoolPinCard(nearbySchools.indexOf(school));
          // Open after Leaflet's built-in marker handler has finished so the
          // popup is not toggled away by the same tap on mobile browsers.
          window.setTimeout(() => marker.openPopup(), 0);
        });
        markerLayer.addLayer(marker);
      });
      markerLayer.addTo(mapInstance);
      mapInstance.on('popupopen', event => {
        const popupElement = event.popup.getElement();
        if (popupElement) {
          L.DomEvent.disableClickPropagation(popupElement);
          L.DomEvent.disableScrollPropagation(popupElement);
        }
      });
      nearbySchoolRecords = nearbySchools;
      renderNearbySchoolPicker();
      status.getContainer().textContent = usingCachedResults
        ? `${nearbySchools.length} recent school results shown - live refresh will retry next time`
        : `${nearbySchools.length} live education facilities found within 20 km`;
    } catch (error) {
      status.getContainer().textContent = 'Live school search unavailable. Please try again shortly.';
      logAppError('ERR_MAP_SCHOOLS', 'Unable to load live nearby school data.');
    }

    setTimeout(() => {
      if (requestToken === schoolMapRequestToken && mapInstance) mapInstance.invalidateSize();
    }, 300);
  }, () => {
    if (requestToken !== schoolMapRequestToken) return;
    logAppError('ERR_MAP_GEO', 'Unable to retrieve device location for map search.');
    container.textContent = 'Unable to detect your location. Enable browser location access, then try again.';
    alert('Unable to detect your location. Please enable browser location access.');
  });
}

function closeSchoolProximityMap() {
  schoolMapRequestToken += 1;
  if (mapInstance) {
    mapInstance.remove();
    mapInstance = null;
  }
  nearbySchoolRecords = [];
  hideSchoolPinCard();

  const container = document.getElementById('schoolMapContainer');
  if (container) {
    container.innerHTML = '📍 Press "Find schools near me" to render interactive map pins.';
    container.classList.add('hidden');
  }

  const panel = document.getElementById('schoolPickerPanel');
  const picker = document.getElementById('nearbySchoolPicker');
  panel?.classList.add('hidden');
  if (picker) picker.innerHTML = '';

  document.getElementById('closeSchoolMapButton')?.classList.add('hidden');
  document.getElementById('findSchoolMapButton')?.setAttribute('aria-expanded', 'false');
}

function renderNearbySchoolPicker() {
  const panel = document.getElementById('schoolPickerPanel');
  const picker = document.getElementById('nearbySchoolPicker');
  if (!panel || !picker || !nearbySchoolRecords.length) return;
  picker.innerHTML = nearbySchoolRecords.map((school, index) => `<option value="${index}">${escapeWorkspaceText(school.name)} · ${school.lat.toFixed(5)}, ${school.lng.toFixed(5)}</option>`).join('');
  panel.classList.remove('hidden');
}

function openSelectedSchoolDetail() { openSchoolDetail(Number(document.getElementById('nearbySchoolPicker')?.value)); }

function showSchoolPinCard(index) {
  const school = nearbySchoolRecords[index];
  const card = document.getElementById('schoolPinCard');
  const picker = document.getElementById('nearbySchoolPicker');
  if (!school || !card) return;
  if (picker) picker.value = String(index);
  const detail = school.details || {};
  const address = [detail.street, detail.suburb, detail.town].filter(value => value && value !== 'Not listed in OpenStreetMap').join(', ') || 'Address not publicly listed';
  card.innerHTML = `<div style="display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;"><div><strong>🏫 ${escapeWorkspaceText(school.name)}</strong><p class="meta" style="margin:5px 0 0;">${escapeWorkspaceText(detail.category || 'Education facility')} · ${escapeWorkspaceText(address)}</p><p class="meta" style="margin:4px 0 0;">Tap elsewhere on the map to close this selection.</p></div><div style="display:flex;gap:7px;align-items:center;"><button type="button" class="action-btn btn-green" onclick="openSchoolDetail(${index})">View details / apply</button><button type="button" class="action-btn btn-blue" aria-label="Close selected school" onclick="hideSchoolPinCard()">×</button></div></div>`;
  card.classList.remove('hidden');
}

function hideSchoolPinCard() {
  const card = document.getElementById('schoolPinCard');
  if (!card) return;
  card.classList.add('hidden');
  card.innerHTML = '';
}

function openSchoolDetail(index) {
  const school = nearbySchoolRecords[index];
  if (!school) return;
  const detail = school.details || {};
  const coordinates = `${school.lat.toFixed(5)}, ${school.lng.toFixed(5)}`;
  const verifiedParent = currentUser?.role === 'parent' && !String(currentUser?.verificationStatus || '').toLowerCase().includes('pending');
  const application = verifiedParent
    ? `<section style="border-top:1px solid var(--border-color);padding-top:14px;"><h3 style="margin:0 0 5px;">Apply to this school</h3><p style="margin:0 0 12px;color:var(--text-muted);font-size:.84rem;">Your verified Little Feet account is required. The application is sent directly to this school’s principal when its school account is active. Do not include medical or other sensitive details here.</p><div style="padding:10px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);margin-bottom:12px;"><strong>Which age group?</strong><p class="meta" style="margin:5px 0 0;">Day care / ECD usually covers birth to about 5; primary schools typically Grades R–7; secondary/high schools typically Grades 8–12. Curriculum phases overlap those school types, so choose the learner’s exact intended grade where possible.</p></div><form onsubmit="submitSchoolApplication(event, ${index})" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;"><label>Parent / guardian name<input name="guardianName" autocomplete="section-applicant name" required value="${escapeWorkspaceText(currentUser.name || '')}"></label><label>Contact email<input name="contactEmail" type="email" autocomplete="section-applicant email" required value="${escapeWorkspaceText(currentUser.username || '')}"></label><label>Contact phone<input name="contactPhone" autocomplete="section-applicant tel" required inputmode="tel"></label><label>Learner name<input name="learnerName" autocomplete="section-learner name" required></label><label>Date of birth<input name="dateOfBirth" type="date" autocomplete="section-learner bday" required></label><label>Age group / intended grade<select name="gradeOrAgeGroup" required>${window.LittleFeetEducationStages?.optionMarkup?.() || '<option value="">Choose age group / intended grade</option><option>Grade R · Reception</option><option>Grade 1</option><option>Grade 2</option><option>Grade 3</option><option>Grade 4</option><option>Grade 5</option><option>Grade 6</option><option>Grade 7</option><option>Grade 8</option><option>Grade 9</option><option>Grade 10</option><option>Grade 11</option><option>Grade 12</option>'}</select></label><label>Intended start date<input name="intendedStart" type="date" required></label><label>Home area / suburb<input name="homeArea" autocomplete="section-applicant address-level2" required></label><label style="grid-column:1/-1;">Application note<textarea name="notes" required rows="3" placeholder="Why you are applying, preferred contact time, and any non-sensitive information the school should know."></textarea></label><label for="schoolApplicationConsent" style="grid-column:1/-1;display:flex;gap:8px;align-items:flex-start;"><input id="schoolApplicationConsent" name="applicationConsent" type="checkbox" required> I confirm these details are accurate and I am authorised to apply for this learner.</label><button class="submit-btn" style="grid-column:1/-1;">Send application to principal</button></form></section>`
    : `<section style="border-top:1px solid var(--border-color);padding-top:14px;"><h3 style="margin:0 0 5px;">Apply to this school</h3><p style="margin:0;color:var(--text-muted);">Applications require an active, verified parent account. Sign in with your approved Little Feet parent account first.</p></section>`;
  openModal('School details', `<div style="display:grid;gap:12px;"><div><h3 style="margin:0 0 5px;">${escapeWorkspaceText(school.name)}</h3><p style="margin:0;color:var(--text-muted);">${escapeWorkspaceText(detail.category || 'Education facility')} · ${escapeWorkspaceText(detail.street || 'Address not listed')}, ${escapeWorkspaceText(detail.suburb || '')}, ${escapeWorkspaceText(detail.town || '')}</p></div><div><label for="schoolCoordinates">Coordinates</label><input id="schoolCoordinates" readonly value="${coordinates}"><button type="button" class="action-btn btn-blue" style="margin-top:8px;" onclick="navigator.clipboard?.writeText(document.getElementById('schoolCoordinates').value); this.textContent='Copied'">Copy coordinates</button></div>${application}</div>`);
}

async function submitSchoolApplication(event, index) {
  event.preventDefault();
  const school = nearbySchoolRecords[index];
  if (!school) return;
  const form = event.currentTarget;
  const value = name => String(form.elements[name]?.value || '').trim();
  try {
    const response = await fetch('/api/school-applications', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ schoolName: school.name, guardianName: value('guardianName'), contactEmail: value('contactEmail'), contactPhone: value('contactPhone'), learnerName: value('learnerName'), dateOfBirth: value('dateOfBirth'), gradeOrAgeGroup: value('gradeOrAgeGroup'), intendedStart: value('intendedStart'), homeArea: value('homeArea'), notes: value('notes') }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to send the school application.');
    closeModal();
    alert(`Application sent to ${result.application.assignedTo}. Your admissions reference is ${result.application.applicationNumber}.`);
    loadTickets();
    window.refreshLittleFeetAdmissions?.();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to send the school application.')); }
}

async function enrichSchoolPin(button, schoolName, latitude, longitude) {
  const panel = button?.closest('.school-enrichment');
  if (!panel) return;
  button.disabled = true;
  button.textContent = 'Checking verified details…';
  try {
    const response = await fetch('/api/schools/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: schoolName, latitude, longitude })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Verified public lookup was unavailable.');
    const escape = value => escapeWorkspaceText(value || 'Not publicly listed');
    const website = /^https:\/\//i.test(result.website || '') ? `<a href="${escape(result.website)}" target="_blank" rel="noopener noreferrer">Visit school website</a>` : 'Not publicly listed';
    panel.innerHTML = `<p style="font-size:.8rem;margin:0;"><strong>Verified public details</strong><br><strong>Address:</strong> ${escape(result.address)}<br><strong>Phone:</strong> ${result.phone ? `<a href="tel:${escape(result.phone)}">${escape(result.phone)}</a>` : 'Not publicly listed'}<br><strong>Website:</strong> ${website}</p><p class="school-muted" style="font-size:.72rem;margin:6px 0 0;">Source: ${escape(result.source)}. Review public details with the school before relying on them.</p>`;
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Check verified public details';
    const notice = document.createElement('p');
    notice.className = 'school-muted';
    notice.style.cssText = 'font-size:.72rem;margin:6px 0 0;';
    notice.textContent = safeUserFacingError(error, 'Verified school details could not be loaded.');
    panel.querySelector('.school-enrichment-error')?.remove();
    notice.classList.add('school-enrichment-error');
    panel.append(notice);
  }
}
