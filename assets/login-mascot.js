/* Small, smoothed eye movements using the mascot's original painted eyes. */
(() => {
  'use strict';
  const svg = document.querySelector('#authSection .login-iceberg-emblem');
  const head = svg?.querySelector('.penguin-idle-head');
  const eyes = Array.from(svg?.querySelectorAll('.penguin-cursor-eye') || []);
  if (!head || eyes.length !== 2) return;

  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const states = eyes.map(el => ({ el, cx: +el.dataset.eyeX, cy: +el.dataset.eyeY, x: 0, y: 0 }));
  let pointer = null;
  let frame = 0;
  let previousTime = 0;
  const clamp = value => Math.max(-1, Math.min(1, value));
  const enabled = () => finePointer.matches && !reducedMotion.matches && !document.hidden && !document.body.classList.contains('portal-active');

  function draw(time) {
    frame = 0;
    const dt = previousTime ? Math.min(50, time - previousTime) : 16;
    previousTime = time;
    const blend = 1 - Math.exp(-dt / 90);
    let point = null;
    if (pointer && enabled()) {
      const matrix = head.getScreenCTM();
      if (matrix) {
        const screenPoint = svg.createSVGPoint();
        screenPoint.x = pointer.x;
        screenPoint.y = pointer.y;
        point = screenPoint.matrixTransform(matrix.inverse());
      }
    }
    let moving = false;
    for (const eye of states) {
      // A short elliptical travel range keeps the irises inside the glasses.
      let dx = point ? clamp((point.x - eye.cx) / 700) : 0;
      let dy = point ? clamp((point.y - eye.cy) / 600) : 0;
      const length = Math.max(1, Math.hypot(dx, dy));
      const targetX = dx / length * 3.5;
      const targetY = dy / length * 2.8;
      eye.x += (targetX - eye.x) * blend;
      eye.y += (targetY - eye.y) * blend;
      if (Math.abs(targetX - eye.x) + Math.abs(targetY - eye.y) > .015) moving = true;
      else { eye.x = targetX; eye.y = targetY; }
      eye.el.setAttribute('transform', `translate(${eye.x.toFixed(3)} ${eye.y.toFixed(3)})`);
    }
    if (moving) frame = requestAnimationFrame(draw);
    else previousTime = 0;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }
  function reset() { pointer = null; schedule(); }
  function sync() {
    if (enabled()) return;
    pointer = null;
    cancelAnimationFrame(frame);
    frame = previousTime = 0;
    for (const eye of states) {
      eye.x = eye.y = 0;
      eye.el.removeAttribute('transform');
    }
  }
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || !enabled()) return;
    pointer = { x: event.clientX, y: event.clientY };
    schedule();
  }, { passive: true });
  document.addEventListener('pointerout', event => { if (!event.relatedTarget) reset(); }, { passive: true });
  window.addEventListener('blur', reset);
  window.addEventListener('scroll', () => { if (pointer && enabled()) schedule(); }, { passive: true });
  window.addEventListener('resize', reset);
  document.addEventListener('visibilitychange', sync);
  finePointer.addEventListener('change', sync);
  reducedMotion.addEventListener('change', sync);
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
})();
