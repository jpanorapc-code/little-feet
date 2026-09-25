(() => {
  const stages = Object.freeze([
    Object.freeze({ id:'ecd-infant', label:'ECD · Infant care', ages:'Birth–12 months', grades:'Before Grade R', institution:'Day care / ECD', framework:'NCF Birth–4' }),
    Object.freeze({ id:'ecd-toddler', label:'ECD · Toddler', ages:'Approx. 1–3 years', grades:'Before Grade R', institution:'Day care / ECD', framework:'NCF Birth–4' }),
    Object.freeze({ id:'ecd-preschool', label:'ECD · Preschool', ages:'Approx. 3–4 years', grades:'Before Grade R', institution:'ECD / preschool', framework:'NCF Birth–4' }),
    Object.freeze({ id:'grade-r', label:'Grade R · Reception', ages:'Typically about 5–6 years', grades:'Grade R', institution:'Primary school or registered Grade R setting', framework:'Foundation Phase' }),
    Object.freeze({ id:'foundation', label:'Foundation Phase', ages:'Approx. 5–9 years', grades:'Grades R–3', institution:'Primary school', framework:'CAPS Foundation Phase' }),
    Object.freeze({ id:'intermediate', label:'Intermediate Phase', ages:'Approx. 10–12 years', grades:'Grades 4–6', institution:'Primary school', framework:'CAPS Intermediate Phase' }),
    Object.freeze({ id:'senior', label:'Senior Phase', ages:'Approx. 13–15 years', grades:'Grades 7–9', institution:'Primary (Grade 7) / secondary school', framework:'CAPS Senior Phase' }),
    Object.freeze({ id:'fet', label:'FET Phase', ages:'Approx. 16–18 years', grades:'Grades 10–12', institution:'Secondary / high school', framework:'CAPS FET Phase' })
  ]);

  const applicationOptions = Object.freeze([
    'ECD · Infant care (Birth–12 months)',
    'ECD · Toddler (Approx. 1–3 years)',
    'ECD · Preschool (Approx. 3–4 years)',
    'Grade R · Reception',
    'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'
  ]);

  const schoolTypes = Object.freeze([
    Object.freeze({ label:'Day care / ECD', range:'Birth to about 5', grades:'Before Grade R; some centres also offer Grade R', note:'NCF is specifically Birth–4. Grade R has separate school-admission and registration requirements.' }),
    Object.freeze({ label:'Primary school', range:'Usually about 5–13', grades:'Typically Grades R–7', note:'CAPS phases inside primary are Foundation R–3, Intermediate 4–6, and Grade 7 begins Senior Phase.' }),
    Object.freeze({ label:'Secondary / high school', range:'Usually about 14–18', grades:'Typically Grades 8–12', note:'Grades 8–9 are Senior Phase; Grades 10–12 are FET.' }),
    Object.freeze({ label:'Combined school', range:'Varies', grades:'May span primary and secondary grades', note:'Use the exact grades offered rather than assuming one age band.' })
  ]);

  function optionMarkup(selected = '') {
    return '<option value="">Choose age group / intended grade</option>' + applicationOptions.map(value =>
      '<option value="' + value.replace(/&/g,'&amp;').replace(/"/g,'&quot;') + '"' + (value === selected ? ' selected' : '') + '>' + value + '</option>'
    ).join('');
  }

  window.LittleFeetEducationStages = Object.freeze({ stages, applicationOptions, schoolTypes, optionMarkup });
})();
