// notices workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function showWellbeingBanner() {
  const banner = document.getElementById('wellbeingBanner');
  const text = document.getElementById('wellbeingBannerText');
  if (!banner || !text || localStorage.getItem('lf_wellbeing_banner_hidden') === 'true') return;
  const last = Number(localStorage.getItem('lf_wellbeing_tip_index'));
  const choices = wellbeingTips.map((_, index) => index).filter(index => index !== last);
  const next = choices[Math.floor(Math.random() * choices.length)];
  localStorage.setItem('lf_wellbeing_tip_index', String(next));
  text.textContent = wellbeingTips[next];
  banner.classList.remove('hidden');
}

function dismissWellbeingBanner() {
  document.getElementById('wellbeingBanner')?.classList.add('hidden');
  localStorage.setItem('lf_wellbeing_banner_hidden', 'true');
}

function dismissTermsNotice() {
  document.getElementById('termsNotice')?.classList.add('hidden');
  localStorage.setItem('lf_terms_notice_acknowledged', 'true');
}

async function loadReleaseNotes() {
  const board = document.getElementById('updatesBoard');
  if (!board) return;
  try {
    const response = await fetch('/api/release-notes', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load release notes.');
    const payload = await response.json();
    const notes = (Array.isArray(payload) ? payload : []).slice().sort((first, second) => Date.parse(second.publishedAt || '') - Date.parse(first.publishedAt || ''));
    const latest = notes[0];
    const seen = localStorage.getItem('lf_latest_release_seen');
    if (!latest || seen === latest.id) {
      board.innerHTML = '';
      board.classList.add('hidden');
      return;
    }
    board.innerHTML = `<div class="card-header-bar"><div><h2>✨ What’s new</h2><span class="meta">Latest platform improvements</span></div><button type="button" class="action-btn btn-blue" onclick="dismissReleaseNotes('${latest.id}')">Mark as read</button></div>${notes.slice(0, 3).map(note => {
      return `<div class="item-row"><div><strong>Version ${escapeWorkspaceText(note.version)} · ${escapeWorkspaceText(note.title)}</strong><p style="margin-top:4px;color:var(--text-muted);">${escapeWorkspaceText(note.summary)}</p><span class="meta" style="display:block;margin-top:5px;">${new Date(note.publishedAt).toLocaleDateString('en-ZA', { day:'2-digit', month:'short', year:'numeric' })}</span></div></div>`;
    }).join('')}`;
    board.classList.remove('hidden');
  } catch { board.classList.add('hidden'); }
}

function dismissReleaseNotes(id) {
  localStorage.setItem('lf_latest_release_seen', id);
  document.getElementById('updatesBoard')?.classList.add('hidden');
}
