(() => {
  const dashboard = document.getElementById('dashboardSection');
  const journey = document.getElementById('littleFeetCinematicJourney');
  const stage = document.getElementById('littleFeetCinematicStage');
  if (!dashboard || !journey || !stage) return;

  let started = false;
  let observer = null;

  const showFallback = (message, error) => {
    journey.classList.add('cinematic-fallback');
    stage.classList.remove('is-ready');
    const loading = stage.querySelector('.cinematic-loading');
    if (loading) loading.textContent = message;
    if (error) console.error('Little Feet cinematic failed to load:', error);
  };

  const start = () => {
    if (started || dashboard.classList.contains('hidden')) return;
    started = true;
    observer?.disconnect();
    requestAnimationFrame(() => {
      import('/assets/cinematic.js?v=20260926-cinematic-v45')
        .catch(error => showFallback('3D could not load · cinematic controls remain available', error));
    });
  };

  if (dashboard.classList.contains('hidden')) {
    observer = new MutationObserver(() => start());
    observer.observe(dashboard, { attributes: true, attributeFilter: ['class'] });
  } else {
    start();
  }

  window.addEventListener('pageshow', start, { once: true });
})();
