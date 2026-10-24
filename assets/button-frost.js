(() => {
  'use strict';

  const SELECTOR = [
    '#dashboardSection button:not(:disabled)',
    '#dashboardSection .action-btn:not(:disabled)',
    '#dashboardSection .submit-btn:not(:disabled)',
    '#dashboardSection .nav-btn',
    '#dashboardSection .nav-shortcut',
    '#dashboardSection .nav-more-toggle',
    '#dashboardSection .sidebar-group-toggle',
    '#dashboardSection .sidebar-signout'
  ].join(',');

  const FREEZE_MS = 3200;
  const THAW_MS = 520;
  const active = new Map();
  const finePointer = window.matchMedia('(hover:hover) and (pointer:fine)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion:reduce)');
  const mobileProfile = window.matchMedia('(max-width:820px), (pointer:coarse)');
  const MOBILE_DPR_CAP = 1.35;
  const MOBILE_FRAME_MS = 40;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const random = (min, max) => min + Math.random() * (max - min);
  const ease = value => 1 - Math.pow(1 - clamp(value, 0, 1), 3);

  function addFern(scene, x, y, angle, length, start, depth = 3) {
    const mainEndX = x + Math.cos(angle) * length;
    const mainEndY = y + Math.sin(angle) * length;
    const mainEnd = start + random(.13, .25);
    scene.segments.push({
      x1:x, y1:y, x2:mainEndX, y2:mainEndY,
      start, end:mainEnd, width:random(.82, 1.65),
      alpha:random(.58, .95), phase:random(0, Math.PI * 2), speed:random(1.4, 3.2)
    });

    if (depth <= 1) return;
    const pairs = 2 + Math.floor(Math.random() * 3);
    for (let index = 1; index <= pairs; index += 1) {
      const t = index / (pairs + 1);
      const branchX = x + (mainEndX - x) * t;
      const branchY = y + (mainEndY - y) * t;
      const branchLength = length * random(.19, .34) * (1 - t * .22);
      for (const side of [-1, 1]) {
        const branchAngle = angle + side * random(.58, .98);
        const delay = start + t * random(.08, .20) + random(.01, .08);
        const endX = branchX + Math.cos(branchAngle) * branchLength;
        const endY = branchY + Math.sin(branchAngle) * branchLength;
        scene.segments.push({
          x1:branchX, y1:branchY, x2:endX, y2:endY,
          start:delay, end:delay + random(.08, .18), width:random(.56, 1.08),
          alpha:random(.46, .86), phase:random(0, Math.PI * 2), speed:random(1.8, 3.8)
        });
        if (depth > 2 && Math.random() < .42) {
          const subStart = delay + random(.02, .08);
          const subAngle = branchAngle + side * random(.45, .74);
          const subLength = branchLength * random(.32, .50);
          scene.segments.push({
            x1:endX, y1:endY,
            x2:endX + Math.cos(subAngle) * subLength,
            y2:endY + Math.sin(subAngle) * subLength,
            start:subStart, end:subStart + random(.07, .14), width:random(.44, .82),
            alpha:random(.36, .70), phase:random(0, Math.PI * 2), speed:random(2.0, 4.2)
          });
        }
      }
    }
  }

  function createScene(width, height, lowPower = false) {
    const scene = { segments:[], specks:[], haze:[] };
    const edgeY = Math.min(28, Math.max(11, height * .40));
    const edgeX = Math.min(16, Math.max(5, width * .048));
    const topCount = lowPower
      ? clamp(Math.round(width / 29), 8, 24)
      : clamp(Math.round(width / 18), 12, 38);
    const bottomCount = lowPower
      ? clamp(Math.round(width / 28), 8, 25)
      : clamp(Math.round(width / 17), 12, 40);
    const sideCount = lowPower
      ? clamp(Math.round(height / 24), 2, 3)
      : clamp(Math.round(height / 19), 2, 4);
    const fernDepth = lowPower ? 2 : 3;

    for (let index = 0; index < topCount; index += 1) {
      const x = ((index + random(.05, .95)) / topCount) * width;
      addFern(scene, x, random(0, 1.5), Math.PI / 2 + random(-.72, .72),
        random(edgeY * .62, edgeY), random(0, .44), fernDepth);
    }
    for (let index = 0; index < bottomCount; index += 1) {
      const x = ((index + random(.05, .95)) / bottomCount) * width;
      addFern(scene, x, height - random(0, 1.5), -Math.PI / 2 + random(-.72, .72),
        random(edgeY * .60, edgeY), random(.03, .50), fernDepth);
    }

    // Sparse side islands only. Never draw a full-height side strip.
    for (let index = 0; index < sideCount; index += 1) {
      const y = ((index + random(.15, .85)) / sideCount) * height;
      if (Math.random() < .64) {
        addFern(scene, random(0, 1), y, random(-.58, .58),
          random(edgeX * .52, edgeX), random(.18, .66), fernDepth);
      }
      if (Math.random() < .58) {
        addFern(scene, width - random(0, 1), y + random(-5, 5), Math.PI + random(-.58, .58),
          random(edgeX * .42, edgeX * .92), random(.24, .74), fernDepth);
      }
    }

    const speckCount = lowPower
      ? clamp(Math.round(width * .48), 70, 240)
      : clamp(Math.round(width * .82), 120, 420);
    for (let index = 0; index < speckCount; index += 1) {
      const edge = Math.random();
      let x;
      let y;
      if (edge < .43) {
        x = random(0, width); y = Math.min(edgeY, -Math.log(Math.max(.001, Math.random())) * 2.6);
      } else if (edge < .86) {
        x = random(0, width); y = height - Math.min(edgeY, -Math.log(Math.max(.001, Math.random())) * 2.6);
      } else if (edge < .93) {
        x = Math.min(edgeX, -Math.log(Math.max(.001, Math.random())) * 1.8); y = random(0, height);
      } else {
        x = width - Math.min(edgeX, -Math.log(Math.max(.001, Math.random())) * 1.8); y = random(0, height);
      }
      scene.specks.push({
        x, y, radius:random(.42, 1.65), start:random(.02, .76),
        alpha:random(.34, .82), phase:random(0, Math.PI * 2), speed:random(1.2, 3.8)
      });
    }

    const hazeCount = lowPower
      ? clamp(Math.round(width / 36), 8, 24)
      : clamp(Math.round(width / 22), 12, 42);
    for (let index = 0; index < hazeCount; index += 1) {
      const top = Math.random() < .5;
      scene.haze.push({
        x:random(0, width),
        y:top ? random(0, 3) : height - random(0, 3),
        rx:random(10, 30),
        ry:random(2.5, Math.max(4, edgeY * .42)),
        start:random(.05, .72),
        alpha:random(.055, .16),
        phase:random(0, Math.PI * 2)
      });
    }

    return scene;
  }

  function drawFrame(state, now) {
    if (!state.alive) return;
    const { button, canvas, ctx, width, height, scene, startedAt } = state;
    if (!button.isConnected || !canvas.isConnected || document.hidden) {
      stop(button);
      return;
    }

    if (state.lastFrameAt && (now - state.lastFrameAt) < (state.lowPower ? MOBILE_FRAME_MS : 1000 / 30)) {
      state.raf = requestAnimationFrame(time => drawFrame(state, time));
      return;
    }
    state.lastFrameAt = now;

    const elapsed = now - startedAt;
    const progress = clamp(elapsed / FREEZE_MS, 0, 1);
    const shimmerTime = elapsed / 1000;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    for (const patch of scene.haze) {
      const local = ease((progress - patch.start) / .22);
      if (local <= 0) continue;
      const pulse = .86 + Math.sin(shimmerTime * 1.5 + patch.phase) * .10;
      const gradient = ctx.createRadialGradient(
        patch.x, patch.y, 0,
        patch.x, patch.y, patch.rx
      );
      gradient.addColorStop(0, `rgba(230,251,255,${patch.alpha * local * pulse})`);
      gradient.addColorStop(.55, `rgba(125,211,252,${patch.alpha * .62 * local})`);
      gradient.addColorStop(1, 'rgba(125,211,252,0)');
      ctx.save();
      ctx.scale(1, patch.ry / patch.rx);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(patch.x, patch.y * (patch.rx / patch.ry), patch.rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(125,211,252,.58)';
    ctx.shadowBlur = state.lowPower
      ? Math.min(2.2, Math.max(.9, height * .038))
      : Math.min(3.4, Math.max(1.2, height * .055));

    for (const segment of scene.segments) {
      const local = ease((progress - segment.start) / Math.max(.035, segment.end - segment.start));
      if (local <= 0) continue;
      const dx = segment.x2 - segment.x1;
      const dy = segment.y2 - segment.y1;
      const length = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / length;
      const ny = dx / length;
      const jitter = progress >= 1 ? Math.sin(shimmerTime * segment.speed + segment.phase) * .34 : 0;
      const endX = segment.x1 + dx * local + nx * jitter;
      const endY = segment.y1 + dy * local + ny * jitter;
      const pulse = progress >= 1 ? .90 + Math.sin(shimmerTime * segment.speed + segment.phase) * .10 : 1;

      ctx.strokeStyle = `rgba(230,251,255,${segment.alpha * pulse})`;
      ctx.lineWidth = segment.width;
      ctx.beginPath();
      ctx.moveTo(segment.x1 + nx * jitter * .4, segment.y1 + ny * jitter * .4);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      if (segment.width > .72) {
        ctx.strokeStyle = `rgba(125,211,252,${segment.alpha * .28})`;
        ctx.lineWidth = segment.width * 2.15;
        ctx.beginPath();
        ctx.moveTo(segment.x1, segment.y1);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 0;
    for (const speck of scene.specks) {
      const local = ease((progress - speck.start) / .16);
      if (local <= 0) continue;
      const pulse = .78 + Math.sin(shimmerTime * speck.speed + speck.phase) * .20;
      ctx.fillStyle = `rgba(230,251,255,${speck.alpha * local * pulse})`;
      ctx.beginPath();
      ctx.arc(speck.x, speck.y, speck.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Keep the centre of every button genuinely clear, including buttons whose label is a raw text node.
    // Frost remains dense on the rim, but cannot paint across the readable label zone.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    const clearX = width * .11;
    const clearY = height * .20;
    const clearW = width * .78;
    const clearH = height * .60;
    const radius = Math.min(clearH * .34, 12);
    ctx.beginPath();
    ctx.roundRect(clearX, clearY, clearW, clearH, radius);
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.fill();
    ctx.restore();

    // Preserve the finished frost raster without an endless paint loop.
    state.raf = progress < 1 ? requestAnimationFrame(time => drawFrame(state, time)) : 0;
  }

  function stop(button) {
    const state = active.get(button);
    if (!state) return;
    active.delete(button);
    state.alive = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.canvas.classList.add('is-thawing');
    window.setTimeout(() => state.canvas.remove(), THAW_MS);
  }

  function start(button) {
    if (document.hidden || !finePointer.matches || reducedMotion.matches || active.has(button)) return;
    const rect = button.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 12) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'lf-button-frost-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    const lowPower = mobileProfile.matches;
    const dprCap = lowPower ? MOBILE_DPR_CAP : 2;
    const dpr = Math.min(dprCap, Math.max(1, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext('2d', { alpha:true });
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    button.classList.add('lf-frost-host');
    button.insertBefore(canvas, button.firstChild);

    const state = {
      button, canvas, ctx, width, height,
      scene:createScene(width, height, lowPower),
      lowPower,
      lastFrameAt:0,
      startedAt:performance.now(),
      raf:0,
      alive:true
    };
    active.set(button, state);
    state.raf = requestAnimationFrame(time => drawFrame(state, time));
  }

  document.addEventListener('pointerover', event => {
    const button = event.target.closest?.(SELECTOR);
    if (!button || button.contains(event.relatedTarget)) return;
    start(button);
  }, { passive:true });

  document.addEventListener('pointerout', event => {
    const button = event.target.closest?.(SELECTOR);
    if (!button || button.contains(event.relatedTarget)) return;
    stop(button);
  }, { passive:true });

  const stopAll = () => [...active.keys()].forEach(stop);
  new MutationObserver(records => {
    if (!records.some(record => record.removedNodes.length)) return;
    for (const button of active.keys()) if (!button.isConnected) stop(button);
  }).observe(document.body, { childList:true, subtree:true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });
  document.addEventListener('scroll', stopAll, { capture:true, passive:true });

  reducedMotion.addEventListener?.('change', event => {
    if (!event.matches) return;
    document.querySelectorAll('.lf-button-frost-canvas').forEach(canvas => {
      const button = canvas.parentElement;
      if (button) stop(button);
      else canvas.remove();
    });
  });

  window.__littleFeetButtonFrost = {
    start,
    stop,
    selector:SELECTOR,
    mobileProfile,
    mobileDprCap:MOBILE_DPR_CAP,
    mobileFrameMs:MOBILE_FRAME_MS
  };
})();
