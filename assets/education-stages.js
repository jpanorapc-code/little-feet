(() => {
  const ecdCareBands = Object.freeze([
    Object.freeze({ id:'ecd-baby', label:'ECD · Baby', ages:'Birth–11 months', application:'ECD · Baby (Birth–11 months)', framework:'NCF Birth–4', records:'Guardian and emergency contacts · authorised pickup · feeding/nutrition · allergies/medication · sleep/nap · diaper/care logs · attendance · consent · developmental observations' }),
    Object.freeze({ id:'ecd-one', label:'ECD · 1-year-olds', ages:'12–23 months', application:'ECD · 1-year-olds (12–23 months)', framework:'NCF Birth–4', records:'Guardian and emergency contacts · authorised pickup · nutrition · allergies/medication · sleep · diaper/toileting care · attendance · consent · NCF observations' }),
    Object.freeze({ id:'ecd-two', label:'ECD · 2-year-olds', ages:'24–35 months', application:'ECD · 2-year-olds (24–35 months)', framework:'NCF Birth–4', records:'Guardian and emergency contacts · authorised pickup · meals · allergies/medication · sleep/toileting · attendance · consent · NCF language, movement, social and play observations' }),
    Object.freeze({ id:'ecd-three', label:'ECD · 3-year-olds', ages:'36–47 months', application:'ECD · 3-year-olds (36–47 months)', framework:'NCF Birth–4', records:'Guardian and emergency contacts · authorised pickup · health/allergy notes · attendance · consent · daily care · NCF developmental observations · learning evidence' }),
    Object.freeze({ id:'ecd-four', label:'ECD · 4-year-olds', ages:'48–59 months', application:'ECD · 4-year-olds (48–59 months)', framework:'NCF Birth–4', records:'Guardian and emergency contacts · authorised pickup · health/allergy notes · attendance · consent · NCF observations · school-readiness learning evidence' }),
    Object.freeze({ id:'ecd-five', label:'ECD · 5-year-olds', ages:'60–71 months', application:'ECD · 5-year-olds (60–71 months)', framework:'ECD / transition to Grade R', records:'Guardian and emergency contacts · authorised pickup · attendance · consent · health/allergy notes · transition/readiness observations · confirm whether the learner is in Grade R or remains in an ECD programme' })
  ]);

  const stages = Object.freeze([
    ...ecdCareBands,
    Object.freeze({ id:'grade-r', label:'Grade R · Reception', ages:'Public-school admission: age 4 turning 5 by 30 June of the admission year; many learners are 5–6 during Grade R', grades:'Grade R', institution:'Primary school or registered Grade R setting', framework:'Foundation Phase', records:'Grade R placement · guardian/emergency contacts · attendance · consent · pickup controls · Foundation learning observations · reports · admission-document verification status' }),
    Object.freeze({ id:'foundation', label:'Foundation Phase', ages:'Approx. 5–9 years', grades:'Grades R–3', institution:'Primary school', framework:'CAPS Foundation Phase', records:'Grade/class · guardian/emergency contacts · attendance · timetable · Home Language · Mathematics · Life Skills · assessments · reports · consent' }),
    Object.freeze({ id:'intermediate', label:'Intermediate Phase', ages:'Approx. 10–12 years', grades:'Grades 4–6', institution:'Primary school', framework:'CAPS Intermediate Phase', records:'Grade/class · guardian/emergency contacts · attendance · timetable · subject learning evidence · assessments · reports · consent · transfer/previous-report status where applicable' }),
    Object.freeze({ id:'senior', label:'Senior Phase', ages:'Approx. 13–15 years', grades:'Grades 7–9', institution:'Primary (Grade 7) / secondary school', framework:'CAPS Senior Phase', records:'Grade/class · subjects · timetable · guardian/emergency contacts · attendance · assessment evidence · reports · subject-choice preparation · transfer/previous-report status where applicable' }),
    Object.freeze({ id:'fet', label:'FET Phase', ages:'Approx. 16–18 years', grades:'Grades 10–12', institution:'Secondary / high school', framework:'CAPS FET Phase', records:'Grade · subject package · timetable · guardian/emergency contacts · attendance · assessment tasks · reports · Grade 12/NSC preparation records where applicable' })
  ]);

  const applicationOptions = Object.freeze([
    ...ecdCareBands.map(item => item.application),
    'Grade R · Reception',
    'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'
  ]);

  const legacyApplicationOptions = Object.freeze([
    'ECD · Infant care (Birth–12 months)',
    'ECD · Toddler (Approx. 1–3 years)',
    'ECD · Preschool (Approx. 3–4 years)'
  ]);

  const schoolTypes = Object.freeze([
    Object.freeze({
      label:'Day care / ECD',
      range:'Birth through the pre-school years',
      grades:'Before Grade R; some centres may also offer Grade R',
      note:'Use the exact care band by age in months. NCF is specifically Birth–4. For a 5-year-old, confirm whether the learner remains in an ECD programme or is entering Grade R; public-school Grade R admission is age 4 turning 5 by 30 June of the admission year.',
      records:'Emergency/guardian contacts, authorised pickup, nutrition/care routines, allergies/medication where lawfully required, consent, attendance and age-appropriate developmental observations.'
    }),
    Object.freeze({
      label:'Primary school',
      range:'Usually about 5–13',
      grades:'Typically Grades R–7',
      note:'Foundation R–3, Intermediate 4–6, and Grade 7 starts Senior Phase.',
      records:'Grade/class, guardian/emergency contacts, attendance, timetable, learning evidence, assessments, reports, consent and transfer/previous-report status where applicable.'
    }),
    Object.freeze({
      label:'Secondary / high school',
      range:'Usually about 14–18',
      grades:'Typically Grades 8–12',
      note:'Grades 8–9 are Senior Phase; Grades 10–12 are FET.',
      records:'Grade, subject package, timetable, guardian/emergency contacts, attendance, assessment tasks/evidence, reports and transfer/previous-report status where applicable.'
    }),
    Object.freeze({
      label:'Combined school',
      range:'Varies',
      grades:'May span primary and secondary grades',
      note:'Use the learner’s exact grade/phase rather than assuming one age band.',
      records:'Use the matching phase guidance for each learner.'
    })
  ]);

  const escapeHtml = value => String(value || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  function optionMarkup(selected = '') {
    const ecd = ecdCareBands.map(item =>
      '<option value="' + escapeHtml(item.application) + '"' + (item.application === selected ? ' selected' : '') + '>' + escapeHtml(item.application) + '</option>'
    ).join('');
    const grades = ['Grade R · Reception','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'].map(value =>
      '<option value="' + value + '"' + (value === selected ? ' selected' : '') + '>' + value + '</option>'
    ).join('');
    return '<option value="">Choose age group / intended grade</option><optgroup label="Day care / ECD">' + ecd + '</optgroup><optgroup label="School grades">' + grades + '</optgroup>';
  }

  function stageForSelection(value = '') {
    const text = String(value || '').trim();
    const ecd = ecdCareBands.find(item => item.application === text || item.label === text);
    if (ecd) return ecd;
    if (/^Grade R/.test(text)) return stages.find(item => item.id === 'grade-r');
    const grade = Number(/^Grade (\d{1,2})$/.exec(text)?.[1] || 0);
    if (grade >= 1 && grade <= 3) return stages.find(item => item.id === 'foundation');
    if (grade >= 4 && grade <= 6) return stages.find(item => item.id === 'intermediate');
    if (grade >= 7 && grade <= 9) return stages.find(item => item.id === 'senior');
    if (grade >= 10 && grade <= 12) return stages.find(item => item.id === 'fet');
    if (/infant/i.test(text)) return ecdCareBands[0];
    if (/toddler/i.test(text)) return ecdCareBands[2];
    if (/preschool/i.test(text)) return ecdCareBands[4];
    return null;
  }

  function updateRegistryStageGuidance(value) {
    const target = document.getElementById('registryStageGuidance');
    if (!target) return;
    const stage = stageForSelection(value);
    if (!stage) {
      target.innerHTML = '<strong>Choose an age group or grade</strong><span>Use the suggested values so Little Feet can show the right day-care, primary or high-school record guidance.</span>';
      return;
    }
    target.innerHTML = '<strong>' + escapeHtml(stage.label) + ' · ' + escapeHtml(stage.ages || stage.grades || '') + '</strong><span>' + escapeHtml(stage.records || '') + '</span>';
  }

  window.updateRegistryStageGuidance = updateRegistryStageGuidance;
  window.LittleFeetEducationStages = Object.freeze({ ecdCareBands, stages, applicationOptions, legacyApplicationOptions, schoolTypes, optionMarkup, stageForSelection });
})();
