(() => {
  const FRAMEWORKS = Object.freeze({
    ncf_birth_to_four: Object.freeze({
      label: 'NCF Birth–4',
      source: 'Department of Basic Education · National Curriculum Framework',
      areas: Object.freeze([
        'ELDA 1 · Well-being',
        'ELDA 2 · Identity and Belonging',
        'ELDA 3 · Communication',
        'ELDA 4 · Exploring Mathematics',
        'ELDA 5 · Creativity',
        'ELDA 6 · Knowledge and Understanding of the World'
      ])
    }),
    caps_grade_r: Object.freeze({
      label: 'CAPS Grade R',
      source: 'Department of Basic Education · Foundation Phase CAPS',
      areas: Object.freeze([
        'Home Language',
        'Mathematics',
        'Life Skills'
      ])
    })
  });

  const safe = value => typeof window.escapeWorkspaceText === 'function'
    ? window.escapeWorkspaceText(value)
    : String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));

  function updateCurriculumAreas() {
    const frameworkSelect = document.getElementById('curriculumFramework');
    const areaSelect = document.getElementById('curriculumArea');
    if (!frameworkSelect || !areaSelect) return;
    const framework = FRAMEWORKS[frameworkSelect.value] || FRAMEWORKS.ncf_birth_to_four;
    areaSelect.innerHTML = framework.areas.map(area => '<option value="' + safe(area) + '">' + safe(area) + '</option>').join('');
    const source = document.getElementById('curriculumFrameworkSource');
    if (source) source.textContent = framework.source;
  }

  async function saveCurriculumObservation(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const frameworkKey = String(data.get('framework') || '');
    const framework = FRAMEWORKS[frameworkKey];
    const learnerName = String(data.get('learnerName') || '').trim();
    const area = String(data.get('area') || '').trim();
    const observation = String(data.get('observation') || '').trim();
    const evidenceReference = String(data.get('evidenceReference') || '').trim();

    if (!framework || !learnerName || !framework.areas.includes(area) || !observation) {
      alert('Choose a framework area and add the learner observation.');
      return;
    }

    const payload = {
      type: 'Framework observation',
      frameworkKey,
      framework: framework.label,
      area,
      learnerName,
      observation: observation.slice(0, 1200),
      evidenceReference: evidenceReference.slice(0, 240),
      details: (learnerName + ' · ' + framework.label + ' · ' + area + ' · ' + observation).slice(0, 1800),
      recordedBy: window.currentUser?.name || window.currentUser?.username || 'User'
    };

    const response = await fetch('/api/modules/curriculum', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(result.message || 'Unable to save this curriculum observation.');
      return;
    }

    form.reset();
    updateCurriculumAreas();
    await loadCurriculumRecords();
    window.playDingSound?.();
  }

  async function loadCurriculumRecords() {
    const list = document.getElementById('curriculumRecords');
    if (!list || !window.currentUser || !['teacher','principal','admin'].includes(window.currentUser.role)) return;
    try {
      const response = await fetch('/api/modules/curriculum');
      const records = await response.json();
      if (!response.ok) throw new Error(records.message || 'Unable to load curriculum observations.');
      list.innerHTML = records.length ? records.map(record => {
        const framework = safe(record.framework || 'Framework');
        const area = safe(record.area || '');
        const learner = safe(record.learnerName || '');
        const observation = safe(record.observation || record.details || '');
        const evidence = record.evidenceReference ? '<span class="meta">Evidence: ' + safe(record.evidenceReference) + '</span><br>' : '';
        const remove = window.currentUser?.role === 'admin'
          ? '<button type="button" class="action-btn btn-red" onclick="deleteCurriculumObservation(\'' + safe(record.id) + '\')">Delete</button>'
          : '';
        return '<div class="item-row"><div><strong>' + learner + '</strong> <span class="badge-tag info">' + framework + '</span><p style="margin:4px 0;"><strong>' + area + '</strong> · ' + observation + '</p>' + evidence + '<span class="meta">' + safe(record.recordedBy || 'User') + ' · ' + safe(record.createdAt || '') + '</span></div>' + remove + '</div>';
      }).join('') : '<div class="record-empty-state"><span><strong>No framework observations yet</strong><span>Record an NCF or Grade R observation above to start the structured learning timeline.</span></span></div>';
    } catch (error) {
      list.textContent = error.message || 'Unable to load curriculum observations.';
    }
  }

  async function deleteCurriculumObservation(id) {
    if (!confirm('Delete this curriculum observation?')) return;
    const response = await fetch('/api/modules/curriculum/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!response.ok) return alert('Unable to delete this curriculum observation.');
    await loadCurriculumRecords();
  }

  window.updateCurriculumAreas = updateCurriculumAreas;
  window.saveCurriculumObservation = saveCurriculumObservation;
  window.loadCurriculumRecords = loadCurriculumRecords;
  window.deleteCurriculumObservation = deleteCurriculumObservation;

  window.addEventListener('DOMContentLoaded', updateCurriculumAreas);
})();
