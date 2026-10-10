// Existing handlers, registered at their original middleware positions.
function registerSchoolsSearchRoutes(app, context) {
app.get('/api/schools/search', async (req, res) => {
  const actor = context.requireAccountManager(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });

  const query = context.boundedText(req.query.q, 120).trim();
  if (query.length < 2) return res.json({ results: [], liveSearchAvailable: true });

  const queryKey = context.schoolKey(query);
  const visibleLocalSchools = new Map();
  const addLocalSchool = (name, id = '') => {
    const cleanName = context.boundedText(name, 160).trim();
    if (!cleanName || !context.schoolKey(cleanName).includes(queryKey)) return;
    if (!context.hasPlatformAccess(actor) && actor.role !== 'crm' && context.schoolKey(cleanName) !== context.schoolKey(actor.schoolName)) return;
    const key = context.schoolKey(cleanName);
    if (!visibleLocalSchools.has(key)) {
      visibleLocalSchools.set(key, { name: cleanName, schoolId: id || '', locality: 'Saved in Little Feet', source: 'Little Feet' });
    }
  };
  (context.db.schools || []).forEach(school => addLocalSchool(school.name, school.id));
  (context.db.users || []).forEach(account => addLocalSchool(account.schoolName, account.schoolId));

  const localResults = [...visibleLocalSchools.values()].slice(0, 8);
  if (actor.role === 'crm') return res.json({ results: localResults, liveSearchAvailable: false });
  const cacheKey = `school-name:${queryKey}`;
  const cached = context.readSchoolSearchCache(cacheKey);
  let publicResults = cached?.data?.results || [];
  let liveSearchAvailable = true;

  if (!cached) {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.search = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        countrycodes: 'za',
        limit: '10',
        dedupe: '1',
        q: `${query} school`
      }).toString();
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'LittleFeetSchoolFinder/1.0' },
        signal: AbortSignal.timeout(12000)
      });
      if (!response.ok) throw new Error(`Nominatim returned ${response.status}`);
      const places = await response.json();
      if (!Array.isArray(places)) throw new Error('Nominatim returned an invalid school-name result.');
      publicResults = places.map(place => {
        const name = context.boundedText(place.name || String(place.display_name || '').split(',')[0], 160).trim();
        const locality = context.boundedText(
          place.address?.suburb || place.address?.neighbourhood || place.address?.city ||
          place.address?.town || place.address?.village || place.address?.municipality || '',
          160
        ).trim();
        return { name, schoolId: '', locality, source: 'OpenStreetMap' };
      }).filter(result => result.name);
      context.writeSchoolSearchCache(cacheKey, { results: publicResults });
    } catch (error) {
      liveSearchAvailable = false;
      context.logStructured('warn', 'school_search.fallback_unavailable', { category: 'integration', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    }
  }

  const merged = [];
  const seen = new Set();
  for (const result of [...localResults, ...publicResults]) {
    const key = context.schoolKey(result.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(result);
    if (merged.length >= 12) break;
  }
  res.json({ results: merged, liveSearchAvailable });
});

app.get('/api/nearby-schools', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=1800');
  const latitude = Number.parseFloat(req.query.lat);
  const longitude = Number.parseFloat(req.query.lng);
  const radius = Math.min(Math.max(Number.parseInt(req.query.radius, 10) || 20000, 1000), 20000);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return res.status(400).json({ message: 'A valid latitude and longitude are required.' });
  }

  const cacheKey = `${latitude.toFixed(3)},${longitude.toFixed(3)},${radius}`;
  const cached = context.readSchoolSearchCache(cacheKey);
  if (cached) return res.json({ ...cached.data, cached: true });

  // A bounding-box lookup is significantly faster than searching every school building by radius.
  // The browser applies the exact circular 20 km check before rendering markers.
  const latitudeOffset = radius / 111320;
  const longitudeOffset = radius / (111320 * Math.cos(latitude * Math.PI / 180));
  const south = (latitude - latitudeOffset).toFixed(6);
  const west = (longitude - longitudeOffset).toFixed(6);
  const north = (latitude + latitudeOffset).toFixed(6);
  const east = (longitude + longitudeOffset).toFixed(6);
  const query = `[out:json][timeout:30];nwr[\"amenity\"~\"^(school|kindergarten|childcare|college|university)$\"][\"name\"](${south},${west},${north},${east});out center qt;`;

  try {
    const overpassServices = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass.nchc.org.tw/api/interpreter'
    ];
    // Public providers vary in availability. Use the first successful response
    // rather than making the user wait for a slow service to time out.
    const payload = await Promise.any(overpassServices.map(async serviceUrl => {
      const candidate = await fetch(serviceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'LittleFeetSchoolFinder/1.0' },
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(25000)
      });
      if (!candidate.ok) throw new Error(`${new URL(serviceUrl).host} returned ${candidate.status}`);
      const result = await candidate.json();
      if (!Array.isArray(result.elements)) throw new Error(`${new URL(serviceUrl).host} returned an invalid map result`);
      return result;
    }));

    const data = { elements: Array.isArray(payload.elements) ? payload.elements : [], source: 'OpenStreetMap' };
    context.writeSchoolSearchCache(cacheKey, data);
    res.json(data);
  } catch (error) {
    // If the shared Overpass network is busy, use Nominatim's independent
    // OpenStreetMap search as a fallback. The result is cached above for 30
    // minutes, so repeated map opens do not repeatedly send location lookups.
    try {
      const fallbackUrl = new URL('https://nominatim.openstreetmap.org/search');
      fallbackUrl.search = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        limit: '100',
        bounded: '1',
        viewbox: `${west},${north},${east},${south}`,
        q: 'school'
      }).toString();
      const fallbackResponse = await fetch(fallbackUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'LittleFeetSchoolFinder/1.0' },
        signal: AbortSignal.timeout(15000)
      });
      if (!fallbackResponse.ok) throw new Error(`Nominatim returned ${fallbackResponse.status}`);
      const places = await fallbackResponse.json();
      if (!Array.isArray(places)) throw new Error('Nominatim returned an invalid map result');
      const data = {
        elements: places.map((place, index) => ({
          type: 'node',
          id: `nominatim-${index}`,
          lat: Number(place.lat),
          lon: Number(place.lon),
          tags: {
            name: place.name || String(place.display_name || '').split(',')[0] || 'Nearby school',
            amenity: 'school',
            'addr:street': place.address?.road || '',
            'addr:suburb': place.address?.suburb || place.address?.neighbourhood || '',
            'addr:city': place.address?.city || place.address?.town || place.address?.village || ''
          }
        })).filter(place => Number.isFinite(place.lat) && Number.isFinite(place.lon)),
        source: 'OpenStreetMap fallback'
      };
      if (!data.elements.length) throw new Error('No nearby schools were returned by the fallback');
      context.writeSchoolSearchCache(cacheKey, data);
      res.json(data);
    } catch (fallbackError) {
      context.logStructured('error', 'school_search.nearby_failed', { category: 'integration', requestId: req.requestId, method: req.method, route: req.path, message: error.message, details: `Fallback: ${fallbackError.message}` });
      res.status(502).json({ message: 'Live school data is temporarily unavailable. Please try again shortly.' });
    }
  }
});

app.post('/api/schools/enrich', async (req, res) => {
  const { name, latitude, longitude } = req.body || {};
  if (!name || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return res.status(400).json({ message: 'A school name and valid map coordinates are required.' });
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(424).json({ message: 'Verified Google Places enrichment is not configured for this school. Public fields remain sourced from OpenStreetMap.' });
  }
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri,places.location'
      },
      body: JSON.stringify({
        textQuery: `${String(name).trim()} school`,
        locationBias: { circle: { center: { latitude: Number(latitude), longitude: Number(longitude) }, radius: 3000 } },
        maxResultCount: 1
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error(`Google Places returned ${response.status}.`);
    const place = (await response.json()).places?.[0];
    if (!place) return res.status(404).json({ message: 'No verified public listing was found for this school.' });
    const expectedName = context.normalizeComparableText(name);
    const returnedName = context.normalizeComparableText(place.displayName?.text);
    if (!returnedName || (!returnedName.includes(expectedName) && !expectedName.includes(returnedName))) {
      return res.status(409).json({ message: 'The public listing did not clearly match this school, so no details were applied.' });
    }
    res.json({
      source: 'Google Places',
      name: place.displayName?.text || String(name),
      address: place.formattedAddress || '',
      phone: place.internationalPhoneNumber || place.nationalPhoneNumber || '',
      website: place.websiteUri || '',
      mapsUrl: place.googleMapsUri || ''
    });
  } catch (error) {
    context.logStructured('error', 'school_search.enrichment_failed', { category: 'integration', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.status(502).json({ message: 'Verified public-school lookup is temporarily unavailable. Please try again later.' });
  }
});

app.get('/api/term', (req, res) => {
  const actor = context.getSessionAccount(req);
  if (!actor) return res.status(401).json({ message: 'Sign in to view the academic term.' });
  res.json({ term: context.db.schoolTerms?.[context.accountSchoolId(actor)] || context.db.term });
});

app.post('/api/term', (req, res) => {
  const actor = context.requireAdmin(req);
  if (!actor) return res.status(403).json({ message: 'Administrator access is required.' });
  const { term } = req.body;
  if (!context.db.schoolTerms || typeof context.db.schoolTerms !== 'object') context.db.schoolTerms = {};
  if (term) context.db.schoolTerms[context.accountSchoolId(actor)] = String(term).slice(0, 200);
  res.json({ term: context.db.schoolTerms[context.accountSchoolId(actor)] || context.db.term });
});
}

function registerSchoolApplicationsRoutes(app, context) {
app.post('/api/school-applications', (req, res) => {
  const applicant = context.getSessionAccount(req);
  if (!applicant || String(applicant.verificationStatus || '').toLowerCase().includes('pending')) {
    return res.status(403).json({ message: 'Use an active, verified Little Feet account before applying to a school.' });
  }
  if (applicant.role !== 'parent') return res.status(403).json({ message: 'School applications can only be submitted from a verified parent account.' });
  const schoolName = String(req.body?.schoolName || '').trim().slice(0, 160);
  const guardianName = String(req.body?.guardianName || '').trim().slice(0, 120);
  const contactPhone = String(req.body?.contactPhone || '').trim().slice(0, 50);
  const contactEmail = String(req.body?.contactEmail || '').trim().slice(0, 160);
  const learnerName = String(req.body?.learnerName || '').trim().slice(0, 120);
  const dateOfBirth = String(req.body?.dateOfBirth || '').trim().slice(0, 20);
  const intendedStart = String(req.body?.intendedStart || '').trim().slice(0, 20);
  const gradeOrAgeGroup = context.boundedText(req.body?.gradeOrAgeGroup, 80);
  const educationStage = context.educationStageForSelection(gradeOrAgeGroup);
  const homeArea = String(req.body?.homeArea || '').trim().slice(0, 160);
  const notes = String(req.body?.notes || '').trim().slice(0, 1200);
  if (!schoolName || !guardianName || !contactPhone || !contactEmail || !learnerName || !dateOfBirth || !intendedStart || !gradeOrAgeGroup || !homeArea || !notes) {
    return res.status(400).json({ message: 'Complete the contact, learner, start-date, age/grade, area and application details.' });
  }
  if (!context.APPLICATION_STAGE_SELECTIONS.has(gradeOrAgeGroup)) {
    return res.status(400).json({ message: 'Choose a recognised Little Feet age group or school grade.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(contactEmail)) return res.status(400).json({ message: 'Enter a valid contact email address.' });
  if (!context.validDateKey(dateOfBirth) || dateOfBirth >= context.dateKeyInSouthAfrica()) return res.status(400).json({ message: 'Enter a valid learner date of birth.' });
  if (!context.validDateKey(intendedStart)) return res.status(400).json({ message: 'Enter a valid intended start date.' });
  const principal = context.db.users.find(account => account.role === 'principal' && context.normalizeComparableText(account.schoolName) === context.normalizeComparableText(schoolName) && !String(account.verificationStatus || '').toLowerCase().includes('pending'));
  if (!principal) return res.status(409).json({ message: 'This school is not yet available for Little Feet applications. Ask the school to activate its principal account first.' });
  const targetSchoolId=context.accountSchoolId(principal);
  const duplicate=(context.db.admissionsApplications||[]).find(item=>item.schoolId===targetSchoolId&&context.normalizeUsername(item.createdBy)===context.normalizeUsername(applicant.username)&&context.normalizeComparableText(item.learnerName)===context.normalizeComparableText(learnerName)&&!['Rejected','Withdrawn','Enrolled'].includes(item.status));
  if(duplicate)return res.status(409).json({message:'An active application for this learner already exists at this school.',applicationId:duplicate.id,status:duplicate.status});
  const createdAt=new Date().toISOString();
  const application = {
    id:context.crypto.randomUUID(), applicationNumber:'LF-'+new Date().getUTCFullYear()+'-'+context.crypto.randomBytes(4).toString('hex').toUpperCase(),
    schoolId:targetSchoolId, schoolName, guardianName,
    contactPhone:context.encryptField(contactPhone), contactEmail:context.encryptField(contactEmail),
    learnerName, dateOfBirth:context.encryptField(dateOfBirth), intendedStart,
    gradeOrAgeGroup, educationStage, homeArea:context.encryptField(homeArea), notes:context.encryptField(notes),
    checklist:context.admissionChecklistDefaults(), status:'Submitted', createdBy:applicant.username,
    createdByName:applicant.name||applicant.username, assignedTo:principal.username,
    createdAt, updatedAt:createdAt, convertedLearnerId:'', convertedRegistryId:''
  };
  context.db.admissionsApplications.unshift(application);
  context.db.admissionsStatusHistory.unshift({id:context.crypto.randomUUID(),applicationId:application.id,schoolId:targetSchoolId,fromStatus:'',toStatus:'Submitted',changedBy:applicant.username,changedAt:createdAt,note:'Application submitted'});
  const ticket = {
    id: context.crypto.randomUUID(), department: 'Admissions', category: 'School application', priority: 'Normal', subject: `School application · ${learnerName}`,
    message: `Application ${application.applicationNumber} for ${schoolName}`, applicationId:application.id, schoolName, createdBy: applicant.username, createdByName: applicant.name || applicant.username,
    assignedTo: principal.username, schoolId: targetSchoolId, status: 'Open', monthCategory: new Date().toLocaleString('en-ZA', { month: 'long', year: 'numeric' }), createdAt
  };
  context.db.tickets.unshift(ticket);
  res.status(201).json({ success: true, application: { id:application.id, applicationNumber:application.applicationNumber, assignedTo: principal.name || principal.username, status: application.status }, ticketId:ticket.id });
});
}

module.exports = { registerSchoolsSearchRoutes, registerSchoolApplicationsRoutes };
