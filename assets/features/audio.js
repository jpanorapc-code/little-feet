// audio workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function getPortalAudioContext() {
  if (!portalAudioContext || portalAudioContext.state === 'closed') portalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  return portalAudioContext;
}

function announcePortalAudioState() {
  try {
    window.dispatchEvent(new CustomEvent('littlefeet:audiochange', { detail: { muted: portalAudioMuted } }));
  } catch { /* Audio state broadcast is optional. */ }
}

function unlockPortalAudio() {
  try {
    if (portalAudioMuted) return;
    const ctx = getPortalAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch { /* Sound remains optional when unavailable on a device. */ }
}

function getLittleFeetAntarcticAudio() {
  const audio = document.getElementById('littleFeetAntarcticAudio');
  if (!audio) return null;
  audio.loop = true;
  audio.volume = 0.56;
  audio.muted = portalAudioMuted;
  return audio;
}

function removeLittleFeetAntarcticUnlockListeners() {
  document.removeEventListener('pointerdown', startLittleFeetAntarcticAudioFromGesture, true);
  document.removeEventListener('keydown', startLittleFeetAntarcticAudioFromGesture, true);
}

function installLittleFeetAntarcticUnlockListeners() {
  if (portalAudioMuted || littleFeetAntarcticAudioPlaying) return;
  document.addEventListener('pointerdown', startLittleFeetAntarcticAudioFromGesture, true);
  document.addEventListener('keydown', startLittleFeetAntarcticAudioFromGesture, true);
}

function startLittleFeetAntarcticAudioFromGesture() {
  if (portalAudioMuted) return;
  const audio = getLittleFeetAntarcticAudio();
  if (!audio) return;
  audio.muted = false;
  const playAttempt = audio.play();
  if (!playAttempt?.then) {
    littleFeetAntarcticAudioPlaying = true;
    removeLittleFeetAntarcticUnlockListeners();
    return;
  }
  playAttempt.then(() => {
    littleFeetAntarcticAudioPlaying = true;
    removeLittleFeetAntarcticUnlockListeners();
  }).catch(() => {
    littleFeetAntarcticAudioPlaying = false;
    installLittleFeetAntarcticUnlockListeners();
  });
}

function pauseLittleFeetAntarcticAudio() {
  const audio = getLittleFeetAntarcticAudio();
  if (!audio) return;
  audio.muted = true;
  audio.pause();
  littleFeetAntarcticAudioPlaying = false;
}

function playDingSound() {
  if (portalAudioMuted) return;
  try {
    const ctx = getPortalAudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio is optional; a blocked browser audio context is not an application fault.
  }
}

function playTicketAlert() {
  if (portalAudioMuted) return;
  try {
    const ctx = getPortalAudioContext();
    if (ctx.state === 'suspended') return;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 6.4);
    master.connect(ctx.destination);
    const pattern = [659.25, 783.99, 987.77, 783.99, 659.25, 523.25, 659.25, 880];
    Array.from({ length: 25 }, (_, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + index * 0.25;
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(pattern[index % pattern.length], start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.42, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);
      oscillator.connect(gain); gain.connect(master);
      oscillator.start(start); oscillator.stop(start + 0.22);
    });
  } catch { /* Browser sound is optional and can be disabled by device settings. */ }
}

function handleMascotLegacyTap(event) {
  event?.stopPropagation();
  windtLegacyTapCount += 1;
  if (windtLegacyTapTimer) clearTimeout(windtLegacyTapTimer);
  if (windtLegacyTapCount >= 5) {
    windtLegacyTapCount = 0;
    openWindtLegacy();
    return;
  }
  windtLegacyTapTimer = setTimeout(() => {
    windtLegacyTapCount = 0;
    goToMainMenu();
  }, 650);
}

function openWindtLegacy() {
  if (!currentUser) return;
  openModal('The Windt Legacy 🐧', `<article style="display:grid;gap:14px;line-height:1.7;"><div style="padding:16px;border:1px solid rgba(45,212,191,.5);border-radius:14px;background:radial-gradient(circle at 80% 15%,rgba(45,212,191,.18),rgba(7,17,30,.15));"><p style="margin:0;color:#99f6e4;font-size:.76rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;">A note for one day</p><h3 style="margin:5px 0 0;font-size:1.4rem;">To my son,</h3></div><p style="margin:0;">Your little feet and your small penguin waddle gave Little Feet its heart. When you were one year and four months old, you inspired this place more than you could have known.</p><p style="margin:0;">Through the late nights, the hard moments, and every small step of building, you kept me inspired to work hard and to care deeply. You changed me into a better man. I still have faults, and I am still learning, but you gave me a reason to keep becoming better.</p><p style="margin:0;">If you find this one day, I want you to know that I am proud of you. I will always love you. If it were not for you, I would never have come this far.</p><p style="margin:0;font-weight:700;color:var(--primary-color);">Every little step matters — especially yours.</p><details style="border-top:1px solid rgba(45,212,191,.35);padding-top:12px;"><summary style="cursor:pointer;color:#99f6e4;font-weight:800;">’n Brief van Pa</summary><div style="display:grid;gap:12px;margin-top:12px;color:var(--text-dark);"><p style="margin:0;">My seun ek is so trots op jou so ver as wat jy gekom het, as ek nie daar meer is nie ek is jammer jy is die beste ding wat in my lewe gebeur het en ek weet jy gan n success wees in lewe pa glo vas jy sal kan beter doen as wat ek sou kon, asseblief kyk mooi na jou ma as ek nie meer daar is nie.</p><p style="margin:0;">Btw jou middle naam is based op my child hood game hero Marcus Fenix jou ma wou nie hê ek moes jou dit noem nie maar pa het inageval want jy deserve die beste.</p><p style="margin:0;">Die Windt Legacy gan nie oor wat gedoen was nie en aan gaan met dit nie dit gaan oor wat jy voor sit vir jou familie sodat die volgende generation kan streef en nog beter doen as die laaste.</p><p style="margin:0;font-weight:700;color:var(--primary-color);">Christiaan Windt in and out, love you my Potato.</p></div></details></article>`);
  playWindtLegacyNote();
}

function portalAudioPreferenceKey() {
  const username = String(currentUser?.username || '').trim().toLowerCase();
  return username ? `lf_portal_audio_muted:${username}` : '';
}

function updatePortalAudioControls() {
  document.querySelectorAll('[data-portal-audio-mute]').forEach(button => {
    const muteLabel = window.translateLittleFeetText?.('soundOn') || button.dataset.muteLabel || 'Sound On';
    const unmuteLabel = window.translateLittleFeetText?.('muted') || button.dataset.unmuteLabel || 'Muted';
    const iconId = portalAudioMuted ? 'icon-volume-off' : 'icon-volume';
    button.innerHTML = `<svg class="ui-icon" aria-hidden="true"><use href="#${iconId}"></use></svg><span>${portalAudioMuted ? unmuteLabel : muteLabel}</span>`;
    button.classList.toggle('is-muted', portalAudioMuted);
    button.setAttribute('aria-pressed', String(portalAudioMuted));
    button.setAttribute('aria-label', portalAudioMuted ? 'Sound muted. Turn Little Feet sound on' : 'Sound on. Mute Little Feet sound');
    button.title = portalAudioMuted ? 'Sound muted — click to turn sound on' : 'Sound on — click to mute';
  });
}

function stopAllPortalAudio() {
  pauseLittleFeetAntarcticAudio();
  stopWindtLegacyNote();
  stopWallpaperTheme();
}

function loadPortalAudioPreference() {
  try {
    const accountKey = portalAudioPreferenceKey();
    const accountValue = accountKey ? localStorage.getItem(accountKey) : null;
    const savedValue = portalAudioChangedBeforeLogin ? localStorage.getItem('lf_portal_audio_muted_last') : (accountValue === null ? localStorage.getItem('lf_portal_audio_muted_last') : accountValue);
    portalAudioMuted = savedValue === 'true';
    if (accountKey && portalAudioChangedBeforeLogin) {
      localStorage.setItem(accountKey, String(portalAudioMuted));
      portalAudioChangedBeforeLogin = false;
    }
  } catch { portalAudioMuted = false; }
  if (portalAudioMuted) stopAllPortalAudio();
  else installLittleFeetAntarcticUnlockListeners();
  updatePortalAudioControls();
  announcePortalAudioState();
}

function togglePortalAudioMute() {
  portalAudioMuted = !portalAudioMuted;
  if (!currentUser) portalAudioChangedBeforeLogin = true;
  try {
    localStorage.setItem('lf_portal_audio_muted_last', String(portalAudioMuted));
    const accountKey = portalAudioPreferenceKey();
    if (accountKey) localStorage.setItem(accountKey, String(portalAudioMuted));
  } catch {}
  if (portalAudioMuted) {
    stopAllPortalAudio();
  } else {
    unlockPortalAudio();
    startLittleFeetAntarcticAudioFromGesture();
    if (document.getElementById('wallpaperOverlay')?.classList.contains('is-visible')) startWallpaperTheme();
  }
  updatePortalAudioControls();
  announcePortalAudioState();
}

function playWindtLegacyNote() {
  stopWindtLegacyNote();
  if (portalAudioMuted) return;
  windtLegacyAudio = new Audio('assets/audio/little-feet-note.mp3');
  windtLegacyAudio.loop = true;
  windtLegacyAudio.volume = 0.62;
  windtLegacyAudio.play().catch(() => {});
}

function stopWindtLegacyNote() {
  if (!windtLegacyAudio) return;
  windtLegacyAudio.pause();
  windtLegacyAudio.currentTime = 0;
  windtLegacyAudio = null;
}
