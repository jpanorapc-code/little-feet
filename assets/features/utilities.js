// utilities workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function upgradeLegacyIcons() {
  const iconFor = (value = '') => {
    const first = Array.from(String(value).trim())[0];
    return ({ '📣':'alert', '📢':'alert', '🚨':'alert', '💳':'finance', '💰':'finance', '🛍':'finance', '🛡':'safety', '🤝':'handover', '📦':'operations', '⚙':'operations', '🖼':'image', '📅':'document', '📁':'book', '📚':'book', '📊':'chart', '💬':'chat', '🧷':'heart-star', '🌱':'growth', '🏆':'award', '🎨':'palette', '🏫':'home', '👤':'user', '🧑':'user', '👨':'users', '🐾':'heart-star', '🌟':'award', '📍':'pin', '🌍':'globe', '⬇':'download', '👥':'users', '📨':'send', '🔍':'search', '📝':'edit', '📋':'document', '🔐':'lock', '📥':'download', '🩺':'safety', '💾':'save', '🗑':'trash', '👁':'eye', '✏':'edit', '🖨':'print', '♻':'refresh', '🎫':'help', '✨':'award', '🚪':'lock', '✕':'close' })[first] || 'heart-star';
  };
  const svg = name => `<span class="professional-icon" aria-hidden="true"><svg class="ui-icon"><use href="#icon-${name}"></use></svg></span>`;
  document.querySelectorAll('.card-header-bar h2:not(.icon-label), .guide-link-card h3:not(.icon-label), .workspace-card h3:not(.icon-label), .action-btn:not(.icon-label), .submit-btn:not(.icon-label)').forEach(heading => {
    const text = heading.textContent.trim();
    if (!/^[\p{Extended_Pictographic}]/u.test(text)) return;
    heading.classList.add('icon-label');
    heading.innerHTML = `${svg(iconFor(text))}<span>${text.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '')}</span>`;
  });
  document.querySelectorAll('.profile-icon-choice').forEach(button => {
    if (button.querySelector('.ui-icon, .profile-avatar-image')) return;
    const value = button.dataset.profileIcon || button.textContent.trim();
    button.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="#icon-${iconFor(value)}"></use></svg>`;
  });
}

function observeProfessionalIcons() {
  const portal = document.getElementById('portalApp') || document.body;
  if (!portal || portal.dataset.iconObserverReady === 'true') return;
  portal.dataset.iconObserverReady = 'true';
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      upgradeLegacyIcons();
    });
  }).observe(portal, { childList:true, subtree:true });
}

function setupSignaturePads() {
  ['teacherSignaturePad', 'parentSignaturePad'].forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.lineWidth = 2.5; context.lineCap = 'round'; context.strokeStyle = '#0f2b48';
    let drawing = false; let hasStroke = false;
    const position = event => { const rect = canvas.getBoundingClientRect(); const point = event.touches?.[0] || event; return { x: (point.clientX - rect.left) * (canvas.width / rect.width), y: (point.clientY - rect.top) * (canvas.height / rect.height) }; };
    const start = event => { drawing = true; const point = position(event); context.beginPath(); context.moveTo(point.x, point.y); event.preventDefault(); };
    const move = event => { if (!drawing) return; const point = position(event); context.lineTo(point.x, point.y); context.stroke(); hasStroke = true; event.preventDefault(); };
    const stop = () => { drawing = false; };
    canvas.addEventListener('pointerdown', start); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointerleave', stop);
    reportSignaturePads[id] = { canvas, context, hasStroke: () => hasStroke, clear: () => { context.clearRect(0, 0, canvas.width, canvas.height); hasStroke = false; } };
  });
}

function clearSignature(id) { reportSignaturePads[id]?.clear(); }

function fileInputForFile(file) {
  return [...document.querySelectorAll('input[type="file"]')].find(input => input.files?.[0] === file) || null;
}

function setFileLimitWarning(file, message = '') {
  const input = fileInputForFile(file);
  if (!input) return;
  const warningId = `${input.id || 'file'}LimitWarning`;
  let warning = document.getElementById(warningId);
  if (!warning) {
    warning = document.createElement('div');
    warning.id = warningId;
    warning.setAttribute('role', 'alert');
    warning.setAttribute('aria-live', 'assertive');
    warning.style.cssText = 'display:none;margin:7px 0 10px;padding:9px 11px;border:1px solid #f59e0b;border-radius:7px;background:rgba(245,158,11,.12);color:var(--text-dark);font-size:.82rem;font-weight:700;line-height:1.45;';
    input.insertAdjacentElement('afterend', warning);
  }
  warning.textContent = message;
  warning.style.display = message ? 'block' : 'none';
}

function escapeWorkspaceText(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
