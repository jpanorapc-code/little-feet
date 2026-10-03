(() => {
  const loginVideo = document.getElementById('loginBackgroundVideo');
  const portalVideo = document.getElementById('ambientBackgroundVideo');
  const button = document.getElementById('backgroundMotionToggle');
  if ((!loginVideo && !portalVideo) || !button) return;

  const videos = [loginVideo, portalVideo].filter(Boolean);
  const preference = 'lf_background_paused';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false;
  try { userPaused = localStorage.getItem(preference) === 'true'; } catch {}

  videos.forEach(video => {
    video.muted = true;
    video.defaultMuted = true;
  });

  function activeVideo() {
    return document.body.classList.contains('portal-active') ? (portalVideo || loginVideo) : (loginVideo || portalVideo);
  }

  function render() {
    const active = activeVideo();
    const unavailable = active?.dataset.playbackState === 'error';
    const paused = !active || active.paused;
    button.textContent = unavailable ? 'Background unavailable' : (paused ? 'Play background' : 'Pause background');
    button.setAttribute('aria-pressed', String(!paused && !unavailable));
    button.disabled = reducedMotion.matches || unavailable;
    button.title = reducedMotion.matches ? 'Background motion follows your reduced-motion setting' : button.textContent;
  }

  async function sync() {
    const active = activeVideo();
    for (const video of videos) {
      if (video !== active && !video.paused) video.pause();
    }
    if (!active) return render();

    if (userPaused || reducedMotion.matches || document.hidden) {
      active.pause();
    } else {
      try {
        await active.play();
        active.dataset.playbackState = 'playing';
      } catch (error) {
        active.dataset.playbackState = 'blocked';
        void window.reportLittleFeetClientLog?.({
          severity: 'info',
          code: 'AMBIENT_VIDEO_AUTOPLAY_BLOCKED',
          message: error?.name || 'Background video autoplay was blocked.',
          source: 'assets/ambient-background.js'
        });
      }
    }
    render();
  }

  button.addEventListener('click', () => {
    userPaused = !(activeVideo()?.paused ?? true);
    try { localStorage.setItem(preference, String(userPaused)); } catch {}
    void sync();
  });

  videos.forEach(video => {
    video.addEventListener('play', render);
    video.addEventListener('pause', render);
    video.addEventListener('error', () => {
      video.dataset.playbackState = 'error';
      render();
    });
  });

  document.addEventListener('visibilitychange', sync);
  document.addEventListener('littlefeet:session-ready', sync);
  document.addEventListener('littlefeet:session-ended', sync);
  new MutationObserver(() => { void sync(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  reducedMotion.addEventListener('change', sync);
  void sync();
})();