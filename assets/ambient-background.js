(() => {
  const video = document.getElementById('ambientBackgroundVideo');
  const button = document.getElementById('backgroundMotionToggle');
  if (!video || !button) return;
  const preference = 'lf_background_paused';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false;
  try { userPaused = localStorage.getItem(preference) === 'true'; } catch {}
  video.muted = true;
  video.defaultMuted = true;
  function render() {
    const paused = video.paused;
    button.textContent = paused ? 'Play background' : 'Pause background';
    button.setAttribute('aria-pressed', String(!paused));
    button.disabled = reducedMotion.matches;
    button.title = reducedMotion.matches ? 'Background motion follows your reduced-motion setting' : button.textContent;
  }
  async function sync() {
    if (userPaused || reducedMotion.matches || document.hidden) video.pause();
    else {
      try { await video.play(); }
      catch (error) {
        // Autoplay can be denied by the browser; keep the poster and a retry control.
        video.dataset.playbackState = 'blocked';
        console.info('Background video could not autoplay:', error.name);
      }
    }
    render();
  }
  button.addEventListener('click', () => {
    userPaused = !video.paused;
    try { localStorage.setItem(preference, String(userPaused)); } catch {}
    void sync();
  });
  video.addEventListener('play', render);
  video.addEventListener('pause', render);
  video.addEventListener('error', () => {
    video.dataset.playbackState = 'error';
    button.textContent = 'Background unavailable';
    button.disabled = true;
    console.warn('Background video unavailable; showing the poster.');
  });
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', sync);
  void sync();
})();
