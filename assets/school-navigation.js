(() => {
  const moved = new Map();
  let stageContext = '';
  let curriculumContext = '';
  let frameworkOptions = [];
  const stages = {
    preschoolTab: { stage: 'preschool', tools: ['curriculum', 'reports'] },
    gradeRTab: { stage: 'gradeR', tools: ['curriculum', 'reports'] },
    primarySchoolTab: { stage: 'primary', tools: ['marks', 'reports', 'conduct'] },
    highSchoolTab: { stage: 'high', tools: ['marks', 'reports', 'conduct'] }
  };
  const tools = {
    curriculum: { label: 'Curriculum observations', roles: 'teacher,principal,admin', nodes: () => [document.getElementById('curriculumObservationForm')?.closest('.workspace-card'), document.getElementById('curriculumRecords')?.closest('.workspace-results-panel')] },
    marks: { label: 'Subject marks & assessments', roles: 'teacher,principal,admin', nodes: () => [document.getElementById('lfSubjectMarksCard')], refresh: () => window.refreshLittleFeetSubjectMarks?.() },
    reports: { label: 'Report cards', roles: 'parent,teacher,principal,admin', nodes: () => [document.getElementById('lfReportCardMaker')], refresh: () => window.refreshLittleFeetReportCards?.() },
    conduct: { label: 'Discipline & conduct', roles: 'parent,teacher,principal,admin', nodes: () => [document.getElementById('lfDisciplineCard')], refresh: () => window.refreshLittleFeetDiscipline?.() }
  };
  function restore(refresh = true) {
    const hadCurriculum = Boolean(curriculumContext), ids = [...moved.keys()].map(node=>node.id);
    for (const [node, original] of moved) {
      if (!node.isConnected || !original.parent.isConnected) continue;
      original.parent.insertBefore(node, original.next?.parentNode === original.parent ? original.next : null);
    }
    moved.clear();
    stageContext = '';
    curriculumContext = '';
    for (const [option, disabled] of frameworkOptions) option.disabled=disabled; frameworkOptions=[];
    if (refresh && window.getLittleFeetCurrentUser?.()) {
      if (hadCurriculum) void window.loadCurriculumRecords?.();
      for (const [key, tool] of Object.entries(tools)) if (key!=='curriculum' && tool.nodes().some(node=>ids.includes(node?.id))) Promise.resolve(tool.refresh?.()).catch(()=>{});
    }
  }
  window.restoreEducationTools = tabId => {
    if (!moved.size || [...moved.keys()].every(node => node.closest('.tab-content')?.id === tabId)) return;
    restore();
  };
  window.getEducationStageContext = () => stageContext;
  window.getCurriculumStageContext = () => curriculumContext;
  window.matchesEducationStageRecord = record => {
    if (!stageContext) return true;
    const value = String(record.className || record.grade || record.learner?.className || record.snapshot?.className || record.snapshot?.learner?.className || '').trim();
    if (/(?:grade|gr)\.?\s*r\b|^reception\b/i.test(value)) return stageContext === 'gradeR';
    if (/preschool|toddler|infant|baby/i.test(value)) return stageContext === 'preschool';
    const match = value.match(/(?:grade|gr|year)\.?\s*(\d{1,2})(?:\s*[a-z])?\b/i) || value.match(/^(\d{1,2})(?:\s*[a-z])?$/i);
    const grade = match ? Number(match[1]) : 0;
    return stageContext === 'primary' ? grade >= 1 && grade <= 7 : stageContext === 'high' ? grade >= 8 && grade <= 12 : false;
  };
  window.openEducationTool = async (tabId, toolId) => {
    const definition = stages[tabId], tool = tools[toolId], user = window.getLittleFeetCurrentUser?.();
    if (!definition?.tools.includes(toolId) || !user || !tool.roles.split(',').includes(user.role)) return;
    const nodes = tool.nodes();
    const page = document.getElementById(tabId), host = page?.querySelector('.education-tool-host'), status = page?.querySelector('[data-education-stage-status]');
    if (!host || nodes.some(node => !node)) {
      if (status) status.textContent = 'This tool is still loading. Please try again in a moment.';
      return;
    }
    restore(false);
    if (toolId==='marks') document.getElementById('lfMarksFilterLearner').value='';
    for (const node of nodes) {
      moved.set(node, { parent: node.parentNode, next: node.nextSibling });
      host.append(node);
    }
    stageContext = definition.stage;
    if (toolId === 'curriculum') {
      curriculumContext = definition.stage === 'gradeR' ? 'caps_grade_r' : 'ncf_birth_to_four';
      const selector=document.getElementById('curriculumFramework');
      frameworkOptions=[...selector.options].map(option=>[option,option.disabled]);
      selector.value = curriculumContext;
      [...selector.options].forEach(option=>{option.disabled=option.value!==curriculumContext;});
      window.updateCurriculumAreas?.();
    }
    if (status) status.textContent = 'Records with no recognised class or grade remain available under Shared Learning.';
    try {
      if (toolId === 'curriculum') await window.loadCurriculumRecords?.();
      else await tool.refresh?.();
    } catch (error) {
      if (user === window.getLittleFeetCurrentUser?.() && status) status.textContent = error.message || 'Unable to load this tool.';
    }
    if (user === window.getLittleFeetCurrentUser?.()) nodes[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  window.refreshEducationWorkspace = async id => {
    if (id==='gradeRTab') await window.refreshLittleFeetGradeR?.();
    if (id==='preschoolTab') await window.refreshLittleFeetElda?.();
    for (const [key, tool] of Object.entries(tools)) if (tool.nodes().some(node=>node?.closest('.tab-content')?.id===id)) {
      if (key==='curriculum') await window.loadCurriculumRecords?.(); else await tool.refresh?.();
    }
  };
  function mount() {
    for (const [id, definition] of Object.entries(stages)) {
      const actions = document.querySelector(`[data-education-stage="${id}"]`);
      if (!actions || actions.childElementCount) continue;
      for (const toolId of definition.tools) {
        const tool = tools[toolId], button = document.createElement('button');
        button.type = 'button'; button.className = 'action-btn btn-blue'; button.textContent = tool.label;
        button.dataset.roles = tool.roles;
        button.addEventListener('click', () => window.openEducationTool(id, toolId));
        actions.append(button);
      }
    }
  }
  document.addEventListener('littlefeet:session-ended', () => {
    restore();
    document.querySelectorAll('[data-education-stage-status]').forEach(node => { node.textContent = ''; });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
