
import * as THREE from '/vendor/three.module.js';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
  const x = clamp((value - a) / Math.max(0.0001, b - a));
  return x * x * (3 - 2 * x);
};
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

// Keep the authored scene at full detail. Runtime performance is managed
// separately so a machine is never punished just because it reports more RAM,
// CPU cores, a high-DPI display, or a high-refresh monitor.
const SCENE_DETAIL = 'high';

const sharedGeometry = {};
const getSharedGeometry = (key, factory) => {
  if (!sharedGeometry[key]) sharedGeometry[key] = factory();
  return sharedGeometry[key];
};

const stationBlueprints = [
  { at: 0.05, title: 'Surface', kicker: 'Little Feet · cinematic home', text: 'Meet the Little Feet penguin on the ice. Move your mouse gently — the camera is alive.', candidates: [['feedTab','School Feed']] },
  { at: 0.24, title: 'Take the plunge', kicker: 'Scroll to dive', text: 'Keep scrolling. The mascot leaves the ice, crosses the waterline, and the portal opens beneath the surface.', candidates: [['scheduleTab','Timetable'],['feedTab','School Feed']] },
  { at: 0.43, title: 'The school day', kicker: 'Upper reef', text: 'Daily work sits in brighter water: attendance, schedules and the rhythm of the school day.', candidates: [['attendanceTab','Attendance'],['schoolDayTab','School Day'],['scheduleTab','Timetable']] },
  { at: 0.62, title: 'Learning glow', kicker: 'Living curriculum', text: 'Learning records, progress and reports become a luminous reef rather than another flat menu.', candidates: [['progressTab','Development'],['reportsTab','Reports'],['worksheetsTab','Learning Files']] },
  { at: 0.79, title: 'Connected reef', kicker: 'People & communication', text: 'Messages and support live deeper in the scene, with neon signals moving through the water.', candidates: [['chatTab','Messages'],['ticketsTab','Support'],['engagementTab','Family Engagement']] },
  { at: 0.94, title: 'Deep control', kicker: 'Operations & management', text: 'The deepest station is calmer and more structured — finance, administration and settings when your role allows it.', candidates: [['financeTab','Finance'],['accountsTab','Accounts'],['settingsTab','Settings']] }
];

function accessibleNavTarget(candidates) {
  for (const [tabId, label] of candidates) {
    const button = [...document.querySelectorAll('.nav-btn')].find(candidate => candidate.getAttribute('onclick')?.includes("'" + tabId + "'"));
    if (button && !button.closest('li')?.classList.contains('hidden')) return { tabId, label };
  }
  return { tabId: 'homeTab', label: 'Home' };
}

function shapePenguinGeometry(radius = 1, segments = 32, rings = 24, profile = 'body') {
  const geometry = new THREE.SphereGeometry(radius, segments, rings);
  const attr = geometry.attributes.position;

  for (let index = 0; index < attr.count; index += 1) {
    let x = attr.getX(index);
    let y = attr.getY(index);
    let z = attr.getZ(index);
    const ny = y / radius;
    const front = Math.max(0, z / radius);

    if (profile === 'body') {
      // Pear-shaped penguin torso: narrower chest, fuller lower body, subtly
      // projected breast. This keeps the silhouette readable from every angle.
      const lowerFullness = 1 + (1 - Math.abs(ny + .18)) * .12;
      const shoulderTaper = 1 - Math.max(0, ny) * .18;
      x *= lowerFullness * shoulderTaper;
      z *= 1 + (1 - Math.abs(ny)) * .035;
      z += front * (1 - Math.abs(ny)) * .045;
      y *= 1.02;
    } else if (profile === 'head') {
      // Slightly broader crown and flatter face instead of a perfect sphere.
      x *= 1 + Math.max(0, ny) * .04;
      z *= 1 - front * .035;
      y *= .98;
    } else if (profile === 'belly') {
      x *= .98;
      z *= .72;
      y *= 1.06;
    } else if (profile === 'flipper') {
      x *= 1 - Math.max(0, ny) * .14;
      z *= .62;
      y *= 1.08;
    }

    attr.setXYZ(index, x, y, z);
  }

  attr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createMascot() {
  const group = new THREE.Group();
  group.name = 'LittleFeetMascotV2';

  // Match the video/reference mascot without using expensive transmission or
  // procedural texture maps. The surface reads soft and slightly velvety under
  // the existing scene lights while keeping the material path cheap.
  const blue = new THREE.MeshStandardMaterial({
    color: 0x1979b9,
    roughness: .70,
    metalness: 0
  });
  const blueDark = new THREE.MeshStandardMaterial({
    color: 0x083d6c,
    roughness: .74,
    metalness: 0
  });
  const white = new THREE.MeshStandardMaterial({
    color: 0xf5fbfd,
    roughness: .82,
    metalness: 0
  });
  const orange = new THREE.MeshStandardMaterial({
    color: 0xf4a31d,
    roughness: .62,
    metalness: 0
  });
  const orangeDark = new THREE.MeshStandardMaterial({
    color: 0xc96e12,
    roughness: .68,
    metalness: 0
  });
  const frame = new THREE.MeshStandardMaterial({
    color: 0x16364f,
    roughness: .38,
    metalness: .12
  });
  const lens = new THREE.MeshBasicMaterial({
    color: 0xaeefff,
    transparent: true,
    opacity: .16,
    depthWrite: false
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x02080d,
    roughness: .26,
    metalness: 0
  });

  const body = new THREE.Mesh(shapePenguinGeometry(1, 34, 26, 'body'), blue);
  body.scale.set(.88, 1.38, .70);
  body.position.y = -.02;
  group.add(body);

  // White chest patch follows the body instead of looking like a separate ball.
  const belly = new THREE.Mesh(shapePenguinGeometry(.76, 30, 22, 'belly'), white);
  belly.scale.set(.74, 1.12, .30);
  belly.position.set(0, -.20, .60);
  group.add(belly);

  const chestRig = new THREE.Group();
  chestRig.position.set(0, .24, 0);
  group.add(chestRig);

  const headRig = new THREE.Group();
  headRig.position.set(0, 1.16, .03);
  chestRig.add(headRig);

  const head = new THREE.Mesh(shapePenguinGeometry(.82, 34, 26, 'head'), blueDark);
  head.scale.set(.99, .94, .92);
  head.position.y = .01;
  headRig.add(head);

  // Reference has a soft white mask wrapping the cheeks and lower face.
  const facePatch = new THREE.Mesh(shapePenguinGeometry(.61, 28, 20, 'belly'), white);
  facePatch.scale.set(.86, .78, .26);
  facePatch.position.set(0, -.08, .63);
  headRig.add(facePatch);

  const cheekL = new THREE.Mesh(new THREE.SphereGeometry(.16, 16, 12), white);
  const cheekR = cheekL.clone();
  cheekL.scale.set(1.12, .72, .35);
  cheekR.scale.copy(cheekL.scale);
  cheekL.position.set(-.26, -.02, .69);
  cheekR.position.set(.26, -.02, .69);
  headRig.add(cheekL, cheekR);

  // Short rounded beak, broad from the front and compact in profile.
  const beak = new THREE.Mesh(new THREE.ConeGeometry(.19, .38, 4, 1, false), orange);
  beak.rotation.x = Math.PI / 2;
  beak.rotation.z = Math.PI / 4;
  beak.scale.set(1.42, .64, .88);
  beak.position.set(0, -.16, .97);
  headRig.add(beak);

  const lowerBeak = new THREE.Mesh(new THREE.SphereGeometry(.17, 18, 10), orangeDark);
  lowerBeak.scale.set(1.12, .30, .54);
  lowerBeak.position.set(0, -.225, .93);
  headRig.add(lowerBeak);

  const eyeGeo = new THREE.SphereGeometry(.102, 18, 14);
  const eyeL = new THREE.Mesh(eyeGeo, black);
  const eyeR = new THREE.Mesh(eyeGeo, black);
  eyeL.position.set(-.235, .105, .84);
  eyeR.position.set(.235, .105, .84);
  headRig.add(eyeL, eyeR);

  // Chunkier dark frames with very cheap translucent lenses.
  const ringGeo = new THREE.TorusGeometry(.235, .048, 10, 28);
  const ringL = new THREE.Mesh(ringGeo, frame);
  const ringR = new THREE.Mesh(ringGeo, frame);
  ringL.position.set(-.25, .105, .945);
  ringR.position.set(.25, .105, .945);
  const lensGeo = new THREE.CircleGeometry(.205, 24);
  const lensL = new THREE.Mesh(lensGeo, lens);
  const lensR = new THREE.Mesh(lensGeo, lens);
  lensL.position.set(-.25, .105, .950);
  lensR.position.set(.25, .105, .950);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(.17, .05, .05), frame);
  bridge.position.set(0, .105, .945);
  const templeL = new THREE.Mesh(new THREE.BoxGeometry(.34, .035, .035), frame);
  const templeR = templeL.clone();
  templeL.position.set(-.46, .11, .86);
  templeR.position.set(.46, .11, .86);
  templeL.rotation.y = -.22;
  templeR.rotation.y = .22;
  headRig.add(lensL, lensR, ringL, ringR, bridge, templeL, templeR);

  const leftShoulder = new THREE.Group();
  const rightShoulder = new THREE.Group();
  leftShoulder.position.set(-.72, .18, -.02);
  rightShoulder.position.set(.72, .18, -.02);
  chestRig.add(leftShoulder, rightShoulder);

  const flipperGeometry = shapePenguinGeometry(.52, 24, 16, 'flipper');
  const leftFlipperMesh = new THREE.Mesh(flipperGeometry, blueDark);
  const rightFlipperMesh = new THREE.Mesh(flipperGeometry, blueDark);
  leftFlipperMesh.scale.set(.42, 1.42, .31);
  rightFlipperMesh.scale.copy(leftFlipperMesh.scale);
  leftFlipperMesh.position.set(-.12, -.49, -.02);
  rightFlipperMesh.position.set(.12, -.49, -.02);
  leftFlipperMesh.rotation.z = .10;
  rightFlipperMesh.rotation.z = -.10;
  leftShoulder.add(leftFlipperMesh);
  rightShoulder.add(rightFlipperMesh);

  const leftHip = new THREE.Group();
  const rightHip = new THREE.Group();
  leftHip.position.set(-.35, -1.06, .18);
  rightHip.position.set(.35, -1.06, .18);
  group.add(leftHip, rightHip);

  const footGeo = shapePenguinGeometry(.34, 20, 14, 'belly');
  const footLMesh = new THREE.Mesh(footGeo, orange);
  const footRMesh = new THREE.Mesh(footGeo, orange);
  footLMesh.scale.set(1.12, .24, .72);
  footRMesh.scale.copy(footLMesh.scale);
  footLMesh.position.set(-.03, -.27, .04);
  footRMesh.position.set(.03, -.27, .04);
  footLMesh.rotation.z = -.06;
  footRMesh.rotation.z = .06;
  leftHip.add(footLMesh);
  rightHip.add(footRMesh);

  const tailRig = new THREE.Group();
  tailRig.position.set(0, -.83, -.55);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(.27, .64, 5), blueDark);
  tail.rotation.x = Math.PI / 2;
  tail.scale.set(1.06, 1, .40);
  tail.position.z = -.19;
  tailRig.add(tail);
  group.add(tailRig);

  // Keep the established animation contract intact so the existing swim,
  // return-swim, idle, gaze, feet and tail logic continue working unchanged.
  group.userData = {
    body, belly, chestRig, head, headRig, beak, lowerBeak,
    leftFlipper: leftShoulder, rightFlipper: rightShoulder,
    leftFlipperMesh, rightFlipperMesh,
    eyeL, eyeR, footL: leftHip, footR: rightHip, footLMesh, footRMesh,
    tailRig, tail,
    eyeLBase: eyeL.position.clone(), eyeRBase: eyeR.position.clone(),
    headRigBase: headRig.position.clone(),
    bodyBaseScale: body.scale.clone(), bellyBaseScale: belly.scale.clone(),
    beakBaseScale: beak.scale.clone(), lowerBeakBaseScale: lowerBeak.scale.clone()
  };

  group.scale.setScalar(.92);
  return group;
}

function roughenIceGeometry(geometry, strength = .10) {
  const attr = geometry.attributes.position;
  for (let index = 0; index < attr.count; index += 1) {
    const x = attr.getX(index);
    const y = attr.getY(index);
    const z = attr.getZ(index);
    const angle = Math.atan2(z, x);
    const edgeNoise =
      Math.sin(angle * 5.0 + y * 2.7) * .46 +
      Math.sin(angle * 9.0 - y * 4.1) * .29 +
      Math.cos(angle * 13.0 + y * 1.8) * .18;
    const radial = 1 + edgeNoise * strength;
    attr.setXYZ(index, x * radial, y + Math.sin(angle * 7.0) * strength * .16, z * radial);
  }
  attr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createIceShelf() {
  const group = new THREE.Group();
  const top = new THREE.Mesh(
    roughenIceGeometry(new THREE.CylinderGeometry(3.45, 3.05, .62, 52, 4), .075),
    new THREE.MeshPhysicalMaterial({
      color: 0xe9fbff,
      roughness: .27,
      metalness: .01,
      clearcoat: .84,
      clearcoatRoughness: .16,
      transmission: .16,
      ior: 1.31,
      thickness: .82
    })
  );
  top.position.y = .02;
  top.receiveShadow = true;
  top.castShadow = true;
  group.add(top);

  const underside = new THREE.Mesh(
    roughenIceGeometry(new THREE.CylinderGeometry(3.0, 2.05, 1.42, 44, 4), .12),
    new THREE.MeshPhysicalMaterial({
      color: 0x7fcde8,
      roughness: .36,
      clearcoat: .38,
      clearcoatRoughness: .26,
      transmission: .08,
      ior: 1.31,
      thickness: 1.1
    })
  );
  underside.position.y = -.88;
  underside.castShadow = true;
  group.add(underside);
  return group;
}

function createBubbles(count, spread, depth, size) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - .5) * spread;
    positions[i * 3 + 1] = -Math.random() * depth;
    positions[i * 3 + 2] = (Math.random() - .5) * spread;
    seeds[i] = Math.random();
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.PointsMaterial({
    color: 0xbefcff,
    size,
    transparent: true,
    opacity: .46,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(geometry, material);
  points.userData = {
    basePositions: Float32Array.from(positions),
    depth,
    riseSpeed: .55 + Math.random() * .45
  };
  return points;
}

function createStationRing(color) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    getSharedGeometry('stationRingOuter', () => new THREE.TorusGeometry(2.15, .055, 12, 80)),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 4.2, roughness: .16, metalness: .3 })
  );
  ring.rotation.y = Math.PI / 2.25;
  const inner = new THREE.Mesh(
    getSharedGeometry('stationRingInner', () => new THREE.TorusGeometry(1.52, .024, 10, 72)),
    new THREE.MeshBasicMaterial({ color: 0xd7ffff, transparent: true, opacity: .62, blending: THREE.AdditiveBlending })
  );
  inner.rotation.copy(ring.rotation);
  group.add(ring, inner);
  return group;
}


// Background depth is image-based. The former 3D mist/terrace/haze helpers were
// removed to avoid blob silhouettes and unnecessary rendering work.

function initCinematicJourney() {
  const journey = document.getElementById('littleFeetCinematicJourney');
  const stage = document.getElementById('littleFeetCinematicStage');
  const canvas = document.getElementById('littleFeetCinematicCanvas');
  const title = document.getElementById('cinematicTitle');
  const kicker = document.getElementById('cinematicKicker');
  const copy = document.getElementById('cinematicCopy');
  const progressBar = document.getElementById('cinematicProgressBar');
  const depthLabel = document.getElementById('cinematicDepthLabel');
  const stopContainer = document.getElementById('cinematicDepthMeter');
  const pauseButton = document.getElementById('cinematicPause');
  const depthBackdropImage = document.getElementById('cinematicDepthBackdrop');
  const dashboard = document.getElementById('dashboardSection');
  if (!journey || !stage || !canvas || !title || !kicker || !copy || !progressBar || !depthLabel || !stopContainer) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stations = stationBlueprints.map(station => ({ ...station, target: accessibleNavTarget(station.candidates) }));
  const refreshStationTargets = () => {
    stations.forEach((station, index) => {
      station.target = accessibleNavTarget(station.candidates);
      const button = stopContainer.children[index];
      if (button) button.textContent = station.target.label;
    });
  };

  stopContainer.replaceChildren(...stations.map((station, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cinematic-stop';
    button.textContent = station.target.label;
    button.dataset.station = String(index);
    button.addEventListener('click', () => {
      refreshJourneyMetrics();
      window.scrollTo({ top: journeyTop + journeyTravel * station.at, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });
    return button;
  }));

  const openButton = document.getElementById('cinematicOpenCurrent');
  openButton?.addEventListener('click', () => {
    refreshStationTargets();
    const current = stations[Number(stage.dataset.station || 0)] || stations[0];
    if (current?.target?.tabId && typeof window.openWorkspace === 'function') window.openWorkspace(current.target.tabId);
  });

  document.getElementById('cinematicSkip')?.addEventListener('click', () => {
    const destination = journey.offsetTop + journey.offsetHeight + 14;
    window.scrollTo({ top: destination, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });

  let activeStation = -1;
  const updateCopy = (index) => {
    if (index === activeStation) return;
    refreshStationTargets();
    activeStation = index;
    stage.dataset.station = String(index);
    const station = stations[index];
    title.textContent = station.title;
    kicker.textContent = station.kicker;
    copy.textContent = station.text;
    [...stopContainer.children].forEach((button, buttonIndex) => button.classList.toggle('is-current', buttonIndex === index));
    if (openButton) openButton.textContent = 'Open ' + station.target.label;
  };

  const updateProgressUI = (progress) => {
    progressBar.style.width = (progress * 100).toFixed(2) + '%';
    const depth = progress < .235 ? 'Surface' : Math.max(1, Math.round((progress - .215) * 44)) + ' m below';
    depthLabel.textContent = depth;

    // A station becomes active when its scroll milestone is actually reached.
    // This keeps the text/tab destination synchronized with what the mascot is
    // physically doing instead of switching early because another stop is
    // mathematically "nearest".
    let reached = 0;
    stations.forEach((station, index) => {
      if (progress >= station.at - .003) reached = index;
    });
    updateCopy(reached);
  };

  if (reduceMotion.matches) {
    journey.classList.add('cinematic-fallback');
    stage.dataset.cinematicFallback = 'reduced-motion';
    stage.querySelector('.cinematic-loading').textContent = 'Reduced motion mode · cinematic controls remain available';
    updateProgressUI(0);
    return;
  }

  const quality = SCENE_DETAIL;
  let performanceTier = 'balanced';
  let renderPixelRatioTarget = .78;
  let maxRenderPixels = 1280 * 720;
  let displayPixelRatioLimit = .88;
  let renderFpsCap = 30;
  let measuredRefreshHz = 60;

  const classifyViewport = () => {
    const viewportWidth = Math.max(1, Math.round(window.visualViewport?.width || window.innerWidth));
    const viewportHeight = Math.max(1, Math.round(window.visualViewport?.height || window.innerHeight));
    const shortSide = Math.min(viewportWidth, viewportHeight);
    const longSide = Math.max(viewportWidth, viewportHeight);
    const aspect = longSide / Math.max(1, shortSide);
    const dpr = Math.max(.5, Number(window.devicePixelRatio || 1));
    const coarse = window.matchMedia('(pointer: coarse)').matches;

    let name = 'desktop';
    if (shortSide <= 520 || (coarse && longSide <= 950)) name = 'phone';
    else if (coarse || (shortSide <= 900 && longSide <= 1400)) name = 'tablet';
    else if (viewportHeight <= 720) name = 'legacy-low-height';
    else if (aspect >= 1.7 && viewportWidth >= 1600) name = 'wide-tv-monitor';

    return { name, viewportWidth, viewportHeight, shortSide, longSide, aspect, dpr, coarse };
  };

  let viewportProfile = classifyViewport();

  const applyViewportProfile = () => {
    viewportProfile = classifyViewport();
    if (viewportProfile.name === 'phone') {
      maxRenderPixels = 960 * 540;
      displayPixelRatioLimit = .90;
    } else if (viewportProfile.name === 'tablet') {
      maxRenderPixels = 1152 * 648;
      displayPixelRatioLimit = .86;
    } else if (viewportProfile.name === 'legacy-low-height') {
      maxRenderPixels = 960 * 540;
      displayPixelRatioLimit = .78;
    } else {
      // 1080p/1440p/4K TVs and monitors still render the cinematic internally
      // near 720p. CSS scales it to the panel, avoiding a 4K GPU/CPU penalty.
      maxRenderPixels = 1280 * 720;
      displayPixelRatioLimit = .88;
    }

    stage.dataset.viewportClass = viewportProfile.name;
    stage.dataset.viewportCss = `${viewportProfile.viewportWidth}x${viewportProfile.viewportHeight}`;
    stage.dataset.devicePixelRatio = viewportProfile.dpr.toFixed(2);
  };

  const fpsCapForRefresh = hz => {
    if (!Number.isFinite(hz) || hz <= 0) return 30;
    if (hz < 28) return Math.max(15, Math.min(30, Math.round(hz)));
    if (hz < 38) return 30;
    if (hz < 56) return Math.max(20, Math.min(30, Math.round(hz / 2)));
    return 30;
  };

  const measureDisplayRefresh = () => {
    if (typeof window.requestAnimationFrame !== 'function') return;
    const samples = [];
    let previous = null;

    const sample = timestamp => {
      if (document.hidden) {
        previous = null;
        window.requestAnimationFrame(sample);
        return;
      }
      if (previous !== null) {
        const delta = timestamp - previous;
        if (delta >= 5 && delta <= 80) samples.push(delta);
      }
      previous = timestamp;

      if (samples.length < 24) {
        window.requestAnimationFrame(sample);
        return;
      }

      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)];
      measuredRefreshHz = Math.max(1, Math.round(1000 / median));
      renderFpsCap = fpsCapForRefresh(measuredRefreshHz);
      stage.dataset.displayRefreshHz = String(measuredRefreshHz);
      stage.dataset.renderFpsCap = String(renderFpsCap);
    };

    window.requestAnimationFrame(sample);
  };

  applyViewportProfile();
  measureDisplayRefresh();

  let renderer;
  let rendererError = null;
  const rendererOptions = {
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  };

  try {
    // Let Three.js perform the real capability test. The old preflight used
    // failIfMajorPerformanceCaveat:true, which can reject otherwise-working
    // WebGL2 contexts on laptops, remote sessions and software-fallback GPUs.
    renderer = new THREE.WebGLRenderer(rendererOptions);
  } catch (error) {
    rendererError = error;
    try {
      // A second attempt with the browser default GPU preference avoids false
      // negatives when "high-performance" is unavailable but WebGL2 still works.
      renderer = new THREE.WebGLRenderer({ ...rendererOptions, powerPreference: 'default' });
      rendererError = null;
    } catch (fallbackError) {
      rendererError = fallbackError;
    }
  }

  if (!renderer) {
    journey.classList.add('cinematic-fallback');
    stage.dataset.cinematicFallback = 'webgl-renderer-unavailable';
    stage.querySelector('.cinematic-loading').textContent = '3D unavailable · cinematic controls remain available';
    console.error('Little Feet cinematic WebGL renderer unavailable:', rendererError);
    return;
  }
  stage.dataset.cinematicFallback = '';
  stage.dataset.cinematicQuality = quality;
  stage.dataset.cinematicBatching = 'hero-only-v2';
  stage.dataset.performanceMode = 'true-capped-scheduler-v3';
  stage.dataset.renderFpsCap = String(renderFpsCap);
  stage.dataset.backgroundPause = 'offscreen-hard-stop-v2';
  stage.dataset.compressionProfile = 'safe-webgl-v15-local-css-water-no-shader';

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.32;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(renderPixelRatioTarget);

  const scene = new THREE.Scene();
  const clearColorScratch = new THREE.Color();
  scene.fog = new THREE.FogExp2(0x052b4a, .018);

  const camera = new THREE.PerspectiveCamera(48, 1, .1, 130);
  // Keep the opening frame wide enough to show the mascot and the ice edge together.
  camera.position.set(.8, 3.8, 11.8);
  camera.lookAt(-1.35, 1.55, 0);

  const ambient = new THREE.HemisphereLight(0xc8fbff, 0x031226, 2.2);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 4.4);
  sun.position.set(-8, 12, 8);
  sun.castShadow = false;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -18;
  }
  scene.add(sun);

  const cyanLight = new THREE.PointLight(0x35f2ff, 13, 18, 2);
  cyanLight.position.set(-4, -8, 3);
  scene.add(cyanLight);
  const violetLight = new THREE.PointLight(0x8c61ff, 10, 16, 2);
  violetLight.position.set(5, -19, -2);
  scene.add(violetLight);

  const ice = createIceShelf();
  ice.position.set(-2.2, .30, -.25);
  scene.add(ice);

  const mascot = createMascot();
  mascot.position.set(-2.15, 2.0, .35);
  mascot.rotation.y = 0;
  scene.add(mascot);

  // The downloaded Riley action is kept only as an archived/reference asset.
  // Do not load or evaluate it in the browser: the procedural mascot rig below
  // provides the swim motion without per-frame imported-bone sampling.
  stage.dataset.swimSource = 'little-feet-mascot-v2';
  stage.dataset.mascotModel = 'video-reference-v2';

  // Microbubble wake for strong underwater strokes. It is hidden on the
  // surface and fades in only when the mascot is actually propelling.
  const mascotTrail = createBubbles(quality === 'high' ? 56 : quality === 'medium' ? 34 : 18, 1.05, 2.7, .055);
  mascotTrail.position.set(0, .15, -.65);
  mascotTrail.material.opacity = 0;
  mascot.add(mascotTrail);

  const splashRing = new THREE.Mesh(
    new THREE.TorusGeometry(.72, .045, 8, 48),
    new THREE.MeshBasicMaterial({
      color: 0xe4ffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  splashRing.rotation.x = Math.PI / 2;
  splashRing.position.set(-.65, -.12, .05);
  scene.add(splashRing);

  const bubbleCount = quality === 'high' ? 620 : quality === 'medium' ? 320 : 180;
  const bubbles = createBubbles(bubbleCount, 26, 42, quality === 'high' ? .075 : .09);
  bubbles.position.y = -.7;
  scene.add(bubbles);

  const dust = createBubbles(Math.round(bubbleCount * .42), 35, 52, .035);
  dust.material.color.setHex(0x70c6ff);
  dust.material.opacity = .2;
  dust.position.y = -2;
  scene.add(dust);

  const ringData = [
    { y: -7.7, x: -4.3, color: 0x55fff2 },
    { y: -15.5, x: 4.4, color: 0x3ac8ff },
    { y: -23.6, x: -4.7, color: 0x9a6cff },
    { y: -31.8, x: 4.5, color: 0xc9ff5e }
  ];
  const rings = ringData.map(item => {
    const ring = createStationRing(item.color);
    ring.position.set(item.x, item.y, -3);
    scene.add(ring);
    return ring;
  });

  // Depth is now supplied by the portrait background and lightweight 2D parallax.
  // The old 3D mist/terrace/haze backdrop created the blob silhouettes, so it is not added.

  const clock = new THREE.Clock();
  const pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0, activity: 0, lastX: 0, lastY: 0 };
  let scrollProgress = 0;
  let smoothProgress = 0;
  let previousRawProgress = 0;
  let scrollMotion = 0;
  let scrollDirection = 1;
  let lastSettledStation = -1;
  let mascotSoundUnlocked = false;
  let lastMascotChirpAt = 0;
  let lastMascotSoundBand = -1;
  let mascotChirpUntil = 0;
  let mascotChirpTimeline = [];
  let nextMascotChirpAt = performance.now() + 5200;
  let splashSoundArmed = true;
  let cinematicAudio = null;
  let cinematicAudioStarting = false;
  let penguinCallBuffer = null;
  let penguinCallLoading = null;
  let activePenguinCallSource = null;
  let activePenguinCallUntil = 0;
  const penguinCallSegments = [
    { offset: .08, duration: .72 },
    { offset: .83, duration: .43 },
    { offset: 1.30, duration: .225 },
    { offset: 1.59, duration: .405 },
    { offset: 2.04, duration: .18 }
  ];

  const portalSoundMuted = () => {
    if (typeof window.isPortalAudioMuted === 'function') return window.isPortalAudioMuted();
    try { return localStorage.getItem('lf_portal_audio_muted_last') === 'true'; }
    catch { return false; }
  };

  const portalContext = () => {
    try {
      if (typeof window.getPortalAudioContext !== 'function') return null;
      return window.getPortalAudioContext();
    } catch {
      return null;
    }
  };

  const ensureCinematicAudio = () => {
    if (cinematicAudio || cinematicAudioStarting || portalSoundMuted()) return cinematicAudio;
    const ctx = portalContext();
    if (!ctx || ctx.state !== 'running') return null;
    cinematicAudioStarting = true;
    try {
      const master = ctx.createGain();
      const surfaceGain = ctx.createGain();
      const underwaterGain = ctx.createGain();
      master.gain.value = 0.0001;
      surfaceGain.gain.value = 0.0001;
      underwaterGain.gain.value = 0.0001;
      surfaceGain.connect(master);
      underwaterGain.connect(master);
      master.connect(ctx.destination);

      const makeNoiseLoop = (seconds = 2.2) => {
        const length = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        let previous = 0;
        for (let index = 0; index < length; index += 1) {
          const white = Math.random() * 2 - 1;
          previous = previous * .94 + white * .06;
          data[index] = previous;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        return source;
      };

      // Surface surf: filtered broadband wash with a slow swell.
      const surf = makeNoiseLoop(2.7);
      const surfFilter = ctx.createBiquadFilter();
      surfFilter.type = 'bandpass';
      surfFilter.frequency.value = 1150;
      surfFilter.Q.value = .6;
      const surfTone = ctx.createOscillator();
      const surfToneGain = ctx.createGain();
      surfTone.type = 'sine';
      surfTone.frequency.value = .19;
      surfToneGain.gain.value = .015;
      surf.connect(surfFilter);
      surfFilter.connect(surfaceGain);
      surfTone.connect(surfToneGain);
      surfToneGain.connect(surfaceGain);

      // Underwater ambience: low-passed current plus a very quiet deep hum.
      const underwater = makeNoiseLoop(3.1);
      const underwaterFilter = ctx.createBiquadFilter();
      underwaterFilter.type = 'lowpass';
      underwaterFilter.frequency.value = 360;
      underwaterFilter.Q.value = .45;
      const deepHum = ctx.createOscillator();
      const deepHumGain = ctx.createGain();
      deepHum.type = 'sine';
      deepHum.frequency.value = 74;
      deepHumGain.gain.value = .018;
      underwater.connect(underwaterFilter);
      underwaterFilter.connect(underwaterGain);
      deepHum.connect(deepHumGain);
      deepHumGain.connect(underwaterGain);

      surf.start();
      surfTone.start();
      underwater.start();
      deepHum.start();

      cinematicAudio = {
        ctx, master, surfaceGain, underwaterGain,
        sources: [surf, surfTone, underwater, deepHum]
      };
      cinematicAudioStarting = false;
      return cinematicAudio;
    } catch {
      cinematicAudioStarting = false;
      cinematicAudio = null;
      return null;
    }
  };

  const setCinematicAudioMix = (submerged, audible) => {
    const audio = ensureCinematicAudio();
    if (!audio) return;
    const now = audio.ctx.currentTime;
    const muted = portalSoundMuted() || !audible || document.hidden;
    const masterTarget = muted ? 0.0001 : 0.12;
    const surfaceTarget = muted ? 0.0001 : Math.max(0.0001, (1 - submerged) * .72);
    const underwaterTarget = muted ? 0.0001 : Math.max(0.0001, submerged * .58);
    audio.master.gain.cancelScheduledValues(now);
    audio.surfaceGain.gain.cancelScheduledValues(now);
    audio.underwaterGain.gain.cancelScheduledValues(now);
    audio.master.gain.setTargetAtTime(masterTarget, now, .16);
    audio.surfaceGain.gain.setTargetAtTime(surfaceTarget, now, .22);
    audio.underwaterGain.gain.setTargetAtTime(underwaterTarget, now, .22);
  };

  const stopCinematicAudio = () => {
    const audio = cinematicAudio;
    cinematicAudio = null;
    cinematicAudioStarting = false;
    if (!audio) return;
    audio.sources.forEach(source => {
      try { source.stop(); } catch { /* Already stopped. */ }
      try { source.disconnect(); } catch { /* Optional cleanup. */ }
    });
    try { audio.surfaceGain.disconnect(); } catch { /* Optional cleanup. */ }
    try { audio.underwaterGain.disconnect(); } catch { /* Optional cleanup. */ }
    try { audio.master.disconnect(); } catch { /* Optional cleanup. */ }
  };

  const scheduleNextMascotChirp = (nowMs = performance.now(), progress = smoothProgress) => {
    // Real penguin calls should feel occasional and unpredictable, not looped.
    // Use a shorter gap while the user is actively travelling through the scene.
    const underwater = progress > .28;
    const minGap = underwater ? 3200 : 2600;
    const variation = underwater ? 5200 : 4200;
    nextMascotChirpAt = nowMs + minGap + Math.random() * variation;
  };

  const ensurePenguinCallBuffer = () => {
    if (penguinCallBuffer) return Promise.resolve(penguinCallBuffer);
    if (penguinCallLoading) return penguinCallLoading;
    const ctx = portalContext();
    if (!ctx) return Promise.resolve(null);

    penguinCallLoading = fetch('/assets/audio/penguin-calls-sprite.mp3?v=20260924-call-v1', { cache: 'force-cache' })
      .then(response => {
        if (!response.ok) throw new Error(`penguin call HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(bytes => ctx.decodeAudioData(bytes))
      .then(buffer => {
        penguinCallBuffer = buffer;
        stage.dataset.penguinCallAudio = 'ready';
        return buffer;
      })
      .catch(error => {
        console.warn('Little Feet penguin call audio unavailable.', error);
        stage.dataset.penguinCallAudio = 'unavailable';
        return null;
      })
      .finally(() => { penguinCallLoading = null; });

    return penguinCallLoading;
  };

  const playMascotChirp = (variant = 0) => {
    if (!mascotSoundUnlocked || portalSoundMuted() || document.hidden) return false;
    if (!journey.classList.contains('is-active')) return false;

    const nowMs = performance.now();
    if (nowMs < activePenguinCallUntil || nowMs - lastMascotChirpAt < 1200) return false;

    const ctx = portalContext();
    if (!ctx || ctx.state !== 'running' || !penguinCallBuffer) {
      ensurePenguinCallBuffer();
      return false;
    }

    const randomIndex = Math.floor(Math.random() * penguinCallSegments.length);
    const segment = penguinCallSegments[(randomIndex + variant) % penguinCallSegments.length];
    const duration = Math.min(segment.duration, Math.max(.05, penguinCallBuffer.duration - segment.offset));
    if (duration <= .05) return false;

    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = penguinCallBuffer;
      gain.gain.setValueAtTime(.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.22, ctx.currentTime + .012);
      gain.gain.setValueAtTime(.22, ctx.currentTime + Math.max(.02, duration - .045));
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + duration);
      source.connect(gain);
      gain.connect(ctx.destination);

      source.start(ctx.currentTime, segment.offset, duration);
      activePenguinCallSource = source;
      activePenguinCallUntil = nowMs + duration * 1000 + 80;
      source.onended = () => {
        if (activePenguinCallSource === source) activePenguinCallSource = null;
      };

      lastMascotChirpAt = nowMs;
      mascotChirpTimeline = [{
        startMs: nowMs,
        peakMs: nowMs + Math.min(90, duration * 350),
        endMs: nowMs + duration * 1000
      }];
      mascotChirpUntil = nowMs + duration * 1000;
      scheduleNextMascotChirp(nowMs, smoothProgress);
      stage.dataset.lastPenguinCall = String((randomIndex + variant) % penguinCallSegments.length);
      return true;
    } catch {
      activePenguinCallSource = null;
      activePenguinCallUntil = 0;
      return false;
    }
  };

  const playWaterSplash = () => {
    if (!mascotSoundUnlocked || portalSoundMuted() || document.hidden) return;
    const ctx = portalContext();
    if (!ctx || ctx.state !== 'running') return;
    try {
      const duration = .48;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) {
        const fade = 1 - index / data.length;
        data[index] = (Math.random() * 2 - 1) * fade * fade;
      }
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1150, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + duration);
      filter.Q.value = .65;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.11, ctx.currentTime + .018);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.buffer = buffer;
      source.start();
    } catch { /* Splash audio is non-critical and must never break the portal. */ }
  };

  const unlockMascotSound = () => {
    const ctx = portalContext();
    mascotSoundUnlocked = Boolean(ctx && ctx.state === 'running') || mascotSoundUnlocked;
    if (ctx?.state === 'suspended' && !portalSoundMuted()) {
      ctx.resume().then(() => {
        mascotSoundUnlocked = true;
        ensureCinematicAudio();
        ensurePenguinCallBuffer();
      }).catch(() => {});
    } else if (mascotSoundUnlocked) {
      ensureCinematicAudio();
      ensurePenguinCallBuffer();
    }
  };

  // The portal may already have unlocked audio during sign-in. Reuse that state
  // so a user who immediately starts scrolling still hears the mascot.
  const existingPortalContext = portalContext();
  mascotSoundUnlocked = Boolean(existingPortalContext && existingPortalContext.state === 'running');

  window.addEventListener('pointerdown', unlockMascotSound, { passive: true });
  window.addEventListener('keydown', unlockMascotSound);
  window.addEventListener('touchstart', unlockMascotSound, { passive: true });
  window.addEventListener('littlefeet:audiochange', event => {
    const muted = Boolean(event.detail?.muted);
    if (!muted) unlockMascotSound();
    setCinematicAudioMix(smoothProgress > .225 ? 1 : 0, !muted && journey.classList.contains('is-active'));
  });

  // A deterministic dive path keeps the mascot tied to the same scroll
  // milestones as the underwater stations instead of letting camera math
  // accidentally make it appear to float upward.
  const diveKeyframes = [
    { at: 0.00, x: -2.20, y:  2.00, z:  0.35, pitch: 0.00, roll:  0.00 },
    { at: 0.10, x: -2.20, y:  2.00, z:  0.35, pitch: 0.00, roll:  0.00 },
    { at: 0.14, x: -2.05, y:  1.82, z:  0.34, pitch: 0.08, roll:  0.00 },
    { at: 0.17, x: -1.25, y:  2.55, z:  0.28, pitch: 0.20, roll: -0.10 },
    { at: 0.20, x:  0.65, y:  2.28, z:  0.18, pitch: 0.56, roll: -0.18 },
    { at: 0.225,x:  2.20, y:  0.82, z:  0.08, pitch: 0.96, roll: -0.24 },
    { at: 0.24, x:  2.72, y: -0.90, z: -0.04, pitch: 1.18, roll: -0.18 },
    { at: 0.29, x:  3.05, y: -2.45, z: -0.18, pitch: 0.96, roll: -0.08 },
    { at: 0.43, x: -5.10, y: -7.45, z: -0.55, pitch: 0.88, roll:  0.18 },
    { at: 0.62, x:  5.35, y: -15.25, z: 0.20, pitch: 0.82, roll: -0.16 },
    { at: 0.79, x: -5.45, y: -23.35, z: -0.42, pitch: 0.86, roll:  0.16 },
    { at: 0.94, x:  5.00, y: -31.35, z: 0.05, pitch: 0.78, roll: -0.14 },
    { at: 1.00, x:  0.00, y: -35.80, z: 0.00, pitch: 0.66, roll:  0.00 }
  ];

  const sampleDivePath = (progress) => {
    const p = clamp(progress);
    for (let index = 0; index < diveKeyframes.length - 1; index += 1) {
      const from = diveKeyframes[index];
      const to = diveKeyframes[index + 1];
      if (p > to.at) continue;
      const t = smoothstep(from.at, to.at, p);
      return {
        x: lerp(from.x, to.x, t),
        y: lerp(from.y, to.y, t),
        z: lerp(from.z, to.z, t),
        pitch: lerp(from.pitch, to.pitch, t),
        roll: lerp(from.roll, to.roll, t)
      };
    }
    return diveKeyframes[diveKeyframes.length - 1];
  };

  const nearestStationPose = (progress) => {
    let index = 0;
    let distance = Infinity;
    stations.forEach((station, stationIndex) => {
      const candidate = Math.abs(progress - station.at);
      if (candidate < distance) {
        distance = candidate;
        index = stationIndex;
      }
    });
    const influence = 1 - smoothstep(.012, .052, distance);
    const settle = influence * (1 - smoothstep(.10, .62, scrollMotion));
    return { index, distance, influence, settle, station: stations[index] };
  };

  const samplePathMotion = progress => {
    const before = sampleDivePath(clamp(progress - .007));
    const after = sampleDivePath(clamp(progress + .007));
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const dz = after.z - before.z;
    const horizontal = Math.max(.0001, Math.hypot(dx, dz));
    return {
      dx, dy, dz,
      yaw: clamp(dx * .095, -.82, .82),
      pitch: clamp(Math.atan2(-dy, horizontal), .08, 1.12),
      bank: clamp(-dx * .038, -.34, .34)
    };
  };

  let stageRect = null;
  let journeyTop = 0;
  let journeyTravel = 1;
  let journeyEnd = 1;
  let journeyExitHold = 1;
  let depthImageTravel = 0;

  const refreshJourneyMetrics = () => {
    journeyTop = journey.offsetTop;
    const totalTravel = Math.max(1, journey.offsetHeight - window.innerHeight);
    journeyExitHold = Math.min(window.innerHeight * 1.10, totalTravel * .22);
    journeyTravel = Math.max(1, totalTravel - journeyExitHold);
    journeyEnd = journeyTop + totalTravel;
    stage.dataset.exitHoldPx = String(Math.round(journeyExitHold));
  };

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    // The dashboard starts display:none before login. Never lock the WebGL buffer
    // to 1x1 while its parent is hidden; wait until the real portal size exists.
    if (rect.width < 2 || rect.height < 2) return false;

    stageRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    refreshJourneyMetrics();

    // Three.js recommends limiting drawing-buffer pixel count for heavy scenes.
    // Keep the CSS canvas full-size while rendering internally at a bounded
    // resolution, then let the browser upscale it.
    applyViewportProfile();
    const cssPixels = Math.max(1, rect.width * rect.height);
    const pixelBudgetRatio = Math.sqrt(maxRenderPixels / cssPixels);
    const safePixelRatio = Math.min(
      window.devicePixelRatio || 1,
      renderPixelRatioTarget,
      displayPixelRatioLimit,
      pixelBudgetRatio
    );
    renderer.setPixelRatio(Math.max(.5, safePixelRatio));
    renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    depthImageTravel = Math.max(0, (depthBackdropImage?.offsetHeight || 0) - rect.height);
    stage.dataset.renderPixelRatio = renderer.getPixelRatio().toFixed(2);
    return true;
  };

  const calculateScroll = () => {
    if (journeyTravel < 2) refreshJourneyMetrics();
    const raw = (window.scrollY - journeyTop) / journeyTravel;
    const insideJourney = window.scrollY >= journeyTop && window.scrollY <= journeyEnd;
    scrollProgress = clamp(raw);
    journey.classList.toggle('is-active', insideJourney);
    journey.classList.toggle('is-after', window.scrollY > journeyEnd);
    stage.dataset.exitHoldActive = String(raw >= 1 && insideJourney);
    updateProgressUI(scrollProgress);
  };

  const syncVisibleStage = () => {
    if (!resize()) return;
    refreshStationTargets();
    calculateScroll();
  };

  window.addEventListener('scroll', calculateScroll, { passive: true });
  window.addEventListener('resize', syncVisibleStage, { passive: true });
  window.visualViewport?.addEventListener('resize', syncVisibleStage, { passive: true });

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => syncVisibleStage())
    : null;
  resizeObserver?.observe(stage);

  const dashboardObserver = dashboard && typeof MutationObserver === 'function'
    ? new MutationObserver(() => {
        if (!dashboard.classList.contains('hidden')) requestAnimationFrame(syncVisibleStage);
      })
    : null;
  dashboardObserver?.observe(dashboard, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    markCinematicActivity();
    const rect = stageRect;
    if (!rect || rect.width < 2 || rect.height < 2) return;
    const nextX = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    const nextY = clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1, 1);
    const movement = Math.hypot(nextX - pointer.lastX, nextY - pointer.lastY);
    pointer.activity = clamp(pointer.activity + movement * 1.7, 0, 1);
    pointer.lastX = nextX;
    pointer.lastY = nextY;
    pointer.x = nextX;
    pointer.y = nextY;
  }, { passive: true });

  const animateBubbleField = (points, time, speedMultiplier = 1) => {
    // Keep the full particle count and appearance, but stop rewriting every
    // particle's XYZ buffer on the CPU. The point cloud drifts as a layer.
    if (!points.userData.driftBase) points.userData.driftBase = points.position.clone();
    const base = points.userData.driftBase;
    const rise = points.userData.riseSpeed * speedMultiplier;
    const phase = points.userData.depth * .071 + speedMultiplier * 1.31;
    points.position.x = base.x + Math.sin(time * (.11 + rise * .05) + phase) * .12;
    points.position.y = base.y + Math.sin(time * (.08 + rise * .03) + phase * .7) * .09;
    points.position.z = base.z + Math.cos(time * (.09 + rise * .04) + phase) * .10;
    points.rotation.y = Math.sin(time * .045 + phase) * .045;
    points.rotation.z = Math.cos(time * .052 + phase) * .018;
  };

  const animateMascot = (progress, time, dt) => {
    const data = mascot.userData;
    const path = sampleDivePath(progress);
    const motion = samplePathMotion(progress);
    const travelSign = scrollDirection < -.12 ? -1 : 1;
    const directedMotion = {
      dx: motion.dx * travelSign,
      dy: motion.dy * travelSign,
      dz: motion.dz * travelSign,
      yaw: motion.yaw * travelSign,
      bank: motion.bank * travelSign
    };
    const directedHorizontal = Math.max(.0001, Math.hypot(directedMotion.dx, directedMotion.dz));
    directedMotion.pitch = clamp(Math.atan2(-directedMotion.dy, directedHorizontal), -1.12, 1.12);
    const stationPose = nearestStationPose(progress);
    const stationHold = stationPose.settle;
    const underwater = smoothstep(.225, .29, progress);
    const swim = smoothstep(.255, .34, progress);
    const surface = 1 - smoothstep(.115, .235, progress);
    const anticipation = smoothstep(.105, .14, progress) * (1 - smoothstep(.145, .175, progress));
    const launch = smoothstep(.14, .17, progress) * (1 - smoothstep(.19, .215, progress));
    const airborne = smoothstep(.165, .205, progress) * (1 - smoothstep(.222, .246, progress));
    const waterEntry = smoothstep(.215, .242, progress) * (1 - smoothstep(.255, .31, progress));
    const streamline = smoothstep(.222, .248, progress) * (1 - smoothstep(.29, .34, progress));
    const firstStrokeBurst = smoothstep(.255, .285, progress) * (1 - smoothstep(.34, .39, progress));
    const movementDrive = clamp(scrollMotion * 1.18 + waterEntry * .46 + firstStrokeBurst * .35, 0, 1);
    const propulsion = swim * (1 - stationHold * .94);
    const effort = clamp(.28 + movementDrive * .95, .22, 1) * propulsion;
    const swimPhase = time * (2.55 + effort * 3.9) + progress * 10.5;
    const strokeCycle = ((swimPhase / (Math.PI * 2)) % 1 + 1) % 1;
    const powerStroke = smoothstep(0, .10, strokeCycle) * (1 - smoothstep(.28, .38, strokeCycle));
    const recoveryStroke = smoothstep(.38, .50, strokeCycle) * (1 - smoothstep(.60, .72, strokeCycle));
    const glide = 1 - clamp(powerStroke + recoveryStroke, 0, 1);
    const stroke = powerStroke - recoveryStroke * .62;
    const recovery = recoveryStroke - powerStroke * .28;
    const glideWave = Math.sin(swimPhase * .42);

    const idleBreath = Math.sin(time * 2.05);
    const calmIdle = clamp((surface + stationHold * .82) * (1 - scrollMotion) * (1 - pointer.activity * .72), 0, 1);
    const idleSway = Math.sin(time * .74 + .8) * calmIdle;
    const idleNod = Math.sin(time * .49 + 2.1) * calmIdle;
    const idleFlipperQuirk = Math.sin(time * .93 + 1.4) * calmIdle;
    const idleTailTick = Math.sin(time * .61 + 2.7) * calmIdle;
    const stationBob = stationHold * Math.sin(time * 1.38 + stationPose.index) * .052;
    const idleBob = surface * (Math.sin(time * 1.55) * .035 + Math.sin(time * .63 + 1.2) * .018);
    const pathBob = propulsion * Math.sin(swimPhase * .55) * (.05 + effort * .10);

    mascot.position.set(
      path.x,
      path.y + idleBob + stationBob + pathBob - anticipation * .17,
      path.z
    );

    // Directional body steering. While travelling the torso points into the
    // actual path; when the user settles on a tab station the penguin brakes,
    // rotates upright and presents itself to the viewer.
    const travelHeading = Math.atan2(-directedMotion.dx, directedMotion.dy);
    const entryHeading = lerp(-.55, -2.12, smoothstep(.16, .245, progress));
    const headingBlend = clamp(airborne + waterEntry + propulsion * .85, 0, 1);
    const directionBlend = smoothstep(.08, .30, scrollMotion);
    const forwardPitch = lerp(path.pitch, motion.pitch, .56);
    const swimPitch = lerp(forwardPitch, directedMotion.pitch, directionBlend) + glideWave * effort * .025;
    const swimYaw = directedMotion.yaw * .72 + Math.sin(progress * Math.PI * 4) * propulsion * .055;
    const swimRoll = lerp(path.roll * travelSign, travelHeading, headingBlend) + directedMotion.bank * .26 + glideWave * effort * .035;
    const entryRoll = entryHeading * clamp(airborne + waterEntry, 0, 1);
    const uprightPitch = stationPose.index === 0 ? 0 : .06;
    const uprightYaw = stationPose.index === 0 ? 0 : pointer.smoothX * .045;
    const uprightRoll = 0;
    const surfaceFront = 1 - smoothstep(.11, .22, progress);
    const uprightBlend = Math.max(stationHold, surfaceFront);

    mascot.rotation.x = damp(
      mascot.rotation.x,
      lerp(swimPitch, uprightPitch, uprightBlend) + streamline * .08,
      surfaceFront > .7 ? 12 : 8.8,
      dt
    );
    mascot.rotation.y = damp(
      mascot.rotation.y,
      lerp(swimYaw, uprightYaw, uprightBlend),
      surfaceFront > .7 ? 12 : 8.2,
      dt
    );
    mascot.rotation.z = damp(
      mascot.rotation.z,
      lerp(swimRoll + entryRoll, uprightRoll, uprightBlend),
      surfaceFront > .7 ? 13 : 9.2,
      dt
    );

    if (surfaceFront > .82) {
      mascot.position.x = damp(mascot.position.x, -2.20, 10, dt);
      data.chestRig.rotation.y = damp(data.chestRig.rotation.y, 0, 10, dt);
      data.chestRig.rotation.z = damp(data.chestRig.rotation.z, 0, 10, dt);
    }

    // Chest/spine articulation gives the procedural mesh a bone-like follow
    // through instead of moving as one rigid toy.
    const chestCounterRoll = -mascot.rotation.z * .32;
    data.chestRig.rotation.x = damp(
      data.chestRig.rotation.x,
      anticipation * .24 - launch * .12 - streamline * .08 - effort * stroke * .032 - stationHold * .03
        + idleNod * .035,
      9,
      dt
    );
    data.chestRig.rotation.y = damp(
      data.chestRig.rotation.y,
      pointer.smoothX * (.18 * surface + .11 * stationHold) + directedMotion.yaw * propulsion * .12
        + idleSway * .055,
      6.6,
      dt
    );
    data.chestRig.rotation.z = damp(
      data.chestRig.rotation.z,
      chestCounterRoll + effort * recovery * .035 + idleSway * .028,
      8,
      dt
    );

    // Surface behaviour: breathing, a small weight shift and an occasional
    // preen when the cursor is calm. Pointer activity interrupts the preen.
    const calmSurface = surface * (1 - smoothstep(.05, .35, scrollMotion)) * (1 - pointer.activity);
    const preenClock = time % 17.5;
    const preen = calmSurface * smoothstep(8.2, 9.0, preenClock) * (1 - smoothstep(11.2, 12.2, preenClock));
    const bodyBreath = 1 + surface * idleBreath * .014;
    data.body.scale.set(
      data.bodyBaseScale.x * (bodyBreath + anticipation * .045 - launch * .018),
      data.bodyBaseScale.y * (bodyBreath - anticipation * .085 + launch * .055 + streamline * .035),
      data.bodyBaseScale.z * (bodyBreath - streamline * .018)
    );
    data.belly.scale.set(
      data.bellyBaseScale.x * (1 + surface * idleBreath * .011),
      data.bellyBaseScale.y * (1 + surface * idleBreath * .016 - anticipation * .06),
      data.bellyBaseScale.z
    );

    // Rigid shoulder-driven flippers emulate underwater "flight": strong
    // symmetrical power strokes, controlled recovery, then a glide.
    const flapAmplitude = .26 + effort * .56 + firstStrokeBurst * .18;
    const neutralL = -.48;
    const neutralR = .48;
    const leftSwimZ = -.66 - stroke * flapAmplitude;
    const rightSwimZ = .66 + stroke * flapAmplitude;
    const shoulderSweep = .22 + powerStroke * (.18 + effort * .34) - recoveryStroke * .12;
    const entryTuckL = -.16;
    const entryTuckR = .16;
    const leftTargetZ = lerp(lerp(neutralL - anticipation * .26, leftSwimZ, propulsion), entryTuckL, streamline)
      + idleFlipperQuirk * .045;
    const rightTargetZ = lerp(lerp(neutralR + anticipation * .26, rightSwimZ, propulsion), entryTuckR, streamline)
      - idleFlipperQuirk * .032;
    data.leftFlipper.rotation.z = damp(
      data.leftFlipper.rotation.z,
      leftTargetZ - preen * .72,
      12.5,
      dt
    );
    data.rightFlipper.rotation.z = damp(
      data.rightFlipper.rotation.z,
      rightTargetZ,
      12.5,
      dt
    );
    data.leftFlipper.rotation.x = damp(
      data.leftFlipper.rotation.x,
      lerp(-.10 + anticipation * .34 + launch * .16, shoulderSweep, propulsion)
        + streamline * .42 + preen * .92,
      11.5,
      dt
    );
    data.rightFlipper.rotation.x = damp(
      data.rightFlipper.rotation.x,
      lerp(-.10 + anticipation * .34 + launch * .16, shoulderSweep, propulsion)
        + streamline * .42,
      11.5,
      dt
    );
    data.leftFlipper.rotation.y = damp(
      data.leftFlipper.rotation.y,
      propulsion * (.16 + directedMotion.yaw * .24) + idleFlipperQuirk * .035,
      9,
      dt
    );
    data.rightFlipper.rotation.y = damp(
      data.rightFlipper.rotation.y,
      propulsion * (-.16 + directedMotion.yaw * .24) - idleFlipperQuirk * .025,
      9,
      dt
    );

    // Feet tuck against the body at speed and act as rudders during a turn,
    // matching real penguin steering behaviour rather than kicking constantly.
    const feetTuck = propulsion * (.40 + effort * .16) + streamline * .46;
    const launchKick = launch * -.28;
    const rudder = directedMotion.yaw * propulsion;
    data.footL.rotation.x = damp(
      data.footL.rotation.x,
      launchKick + feetTuck + powerStroke * effort * .10,
      9.5,
      dt
    );
    data.footR.rotation.x = damp(
      data.footR.rotation.x,
      launchKick + feetTuck + powerStroke * effort * .10,
      9.5,
      dt
    );
    data.footL.rotation.y = damp(data.footL.rotation.y, rudder * .48, 8, dt);
    data.footR.rotation.y = damp(data.footR.rotation.y, rudder * .48, 8, dt);
    data.footL.rotation.z = damp(
      data.footL.rotation.z,
      surface * Math.sin(time * 1.2) * .035 + idleTailTick * .018,
      7,
      dt
    );
    data.footR.rotation.z = damp(
      data.footR.rotation.z,
      -surface * Math.sin(time * 1.2) * .035 - idleTailTick * .014,
      7,
      dt
    );

    data.tailRig.rotation.y = damp(data.tailRig.rotation.y, -rudder * .62, 8.5, dt);
    data.tailRig.rotation.x = damp(
      data.tailRig.rotation.x,
      propulsion * recovery * .10,
      7.5,
      dt
    );
    data.tailRig.rotation.z = damp(data.tailRig.rotation.z, directedMotion.bank * -.32 * propulsion + idleTailTick * .045, 7.5, dt);

    // Cursor obsession: eyes lead, head follows, chest follows last. The head
    // also counter-rotates against the swimming body so the gaze stays visually
    // locked on the cursor even during banks and turns.
    const diveFocus = clamp(airborne + waterEntry + streamline * .85, 0, 1);
    const gazeBoost = .92 + stationHold * .20 + surface * .12;
    const requestedYaw = lerp(
      pointer.smoothX * 1.02 * gazeBoost - mascot.rotation.y * .38 + idleSway * .16,
      0,
      diveFocus
    );
    const requestedPitch = lerp(
      -pointer.smoothY * .68 * gazeBoost - mascot.rotation.x * .10 + idleNod * .07,
      travelSign < 0 && propulsion > .2 ? .08 : -.10,
      diveFocus
    );
    const headYaw = clamp(requestedYaw, -.72, .72);
    const headPitch = clamp(requestedPitch + preen * .14, -.46, .40);
    data.headRig.rotation.y = damp(data.headRig.rotation.y, headYaw, 14.5, dt);
    data.headRig.rotation.x = damp(data.headRig.rotation.x, headPitch, 14.5, dt);
    data.headRig.rotation.z = damp(
      data.headRig.rotation.z,
      clamp(pointer.smoothX * -.12 - mascot.rotation.z * .32 + preen * -.09, -.16, .16),
      12,
      dt
    );
    const neckClearance = Math.abs(headPitch) * .12 + anticipation * .035;
    data.headRig.position.y = damp(data.headRig.position.y, data.headRigBase.y + neckClearance, 12, dt);
    data.headRig.position.z = damp(data.headRig.position.z, data.headRigBase.z + Math.max(0, -headPitch) * .13, 12, dt);

    const eyeX = pointer.smoothX * .155;
    const eyeY = pointer.smoothY * .105;
    data.eyeL.position.x = damp(data.eyeL.position.x, data.eyeLBase.x + eyeX, 19, dt);
    data.eyeR.position.x = damp(data.eyeR.position.x, data.eyeRBase.x + eyeX, 19, dt);
    data.eyeL.position.y = damp(data.eyeL.position.y, data.eyeLBase.y + eyeY, 19, dt);
    data.eyeR.position.y = damp(data.eyeR.position.y, data.eyeRBase.y + eyeY, 19, dt);

    const alert = pointer.activity;
    const eyeWiden = 1 + alert * .26 + stationHold * .035;
    data.eyeL.scale.x = eyeWiden;
    data.eyeR.scale.x = eyeWiden;
    mascot.scale.x = .92 * (1 + alert * .012);
    mascot.scale.y = .92 * (1 + alert * .024 - effort * .008);
    mascot.scale.z = .92;

    const mouthNow = performance.now();
    const chirping = mouthNow < mascotChirpUntil;
    let chirpOpen = 0;
    if (chirping) {
      mascotChirpTimeline.forEach(beat => {
        if (mouthNow < beat.startMs || mouthNow > beat.endMs) return;
        const opening = smoothstep(beat.startMs, beat.peakMs, mouthNow);
        const closing = 1 - smoothstep(beat.peakMs, beat.endMs, mouthNow);
        chirpOpen = Math.max(chirpOpen, Math.min(opening, closing));
      });
    } else if (mascotChirpTimeline.length) {
      mascotChirpTimeline = [];
    }
    data.beak.scale.set(
      data.beakBaseScale.x,
      data.beakBaseScale.y,
      data.beakBaseScale.z
    );
    data.lowerBeak.scale.set(
      data.lowerBeakBaseScale.x,
      data.lowerBeakBaseScale.y * (1 + chirpOpen * .42),
      data.lowerBeakBaseScale.z
    );
    data.lowerBeak.position.y = -.225 - chirpOpen * .025;

    // When the cursor is actively moving the stare wins over blinking. During
    // calm moments a natural single/double blink cycle resumes.
    const blinkCycle = time % 7.1;
    const blinkWindow = (blinkCycle > 6.91 || (blinkCycle > 6.38 && blinkCycle < 6.48));
    const blink = blinkWindow && alert < .38 ? .055 : 1;
    data.eyeL.scale.y = blink;
    data.eyeR.scale.y = blink;

    // The station itself is a behaviour beat, not just a coordinate.
    if (stationHold > .82 && stationPose.index !== lastSettledStation) {
      lastSettledStation = stationPose.index;
      stage.dataset.mascotBehavior = stationPose.index === 0 ? 'surface-watch' : 'station-hover';
      playMascotChirp(stationPose.index % 3);
    } else if (stationHold < .28 && stationPose.index !== lastSettledStation) {
      stage.dataset.mascotBehavior = propulsion > .2 ? 'swimming' : 'diving';
    }

    mascotTrail.material.opacity = clamp(
      underwater * (powerStroke * .42 + firstStrokeBurst * .32 + effort * .18),
      0,
      .68
    );
    mascotTrail.rotation.y += dt * (1.2 + effort * 2.3);
    mascotTrail.rotation.z = Math.sin(time * 2.4) * .08;
  };

  const animateWorld = (time, dt, progress) => {
    rings.forEach((ring, index) => {
      const distance = Math.abs(progress - stations[Math.min(index + 2, stations.length - 1)].at);
      const proximity = 1 - smoothstep(.03, .15, distance);
      ring.rotation.z = time * (.05 + index * .012);
      const pulse = 1 + Math.sin(time * 1.55 + index * .8) * .035 + proximity * .08;
      ring.scale.setScalar(pulse);
    });
  };

  let worldBudget = 0;
  let bubbleBudget = 0;
  let worldInterval = 1 / 24;
  let bubbleInterval = 1 / 20;
  let perfFrameCount = 0;
  let perfFrameTotalMs = 0;
  let perfGoodWindows = 0;

  const applyPerformanceTier = tier => {
    if (tier === performanceTier && stage.dataset.performanceTier) return;
    performanceTier = tier;

    if (tier === 'reduced') {
      worldInterval = 1 / 10;
      bubbleInterval = 1 / 8;
      renderPixelRatioTarget = .62;
    } else if (tier === 'enhanced') {
      worldInterval = 1 / 20;
      bubbleInterval = 1 / 16;
      renderPixelRatioTarget = .88;
    } else {
      worldInterval = 1 / 15;
      bubbleInterval = 1 / 12;
      renderPixelRatioTarget = .76;
    }

    renderer.shadowMap.enabled = false;
    sun.castShadow = false;

    stage.dataset.performanceTier = tier;
    stage.dataset.renderFpsCap = String(renderFpsCap);
    resize();
  };

  const recordFramePerformance = workMs => {
    // Measure the actual CPU/render work of a drawn frame, not the interval
    // between frames. The cinematic is intentionally capped at 30 FPS, so frame
    // spacing is ~33 ms even when the machine is healthy.
    if (workMs <= 0 || workMs > 80) return;
    perfFrameTotalMs += workMs;
    perfFrameCount += 1;
    if (perfFrameCount < 60) return;

    const averageMs = perfFrameTotalMs / perfFrameCount;
    perfFrameCount = 0;
    perfFrameTotalMs = 0;

    if (averageMs > 24) {
      perfGoodWindows = 0;
      applyPerformanceTier('reduced');
      return;
    }
    if (averageMs > 16) {
      perfGoodWindows = 0;
      applyPerformanceTier('balanced');
      return;
    }

    perfGoodWindows += 1;
    if (perfGoodWindows >= 2 && averageMs < 11) applyPerformanceTier('enhanced');
  };

  applyPerformanceTier('balanced');

  const updateScene = (dt, time) => {
    worldBudget += dt;
    bubbleBudget += dt;
    const progressDelta = scrollProgress - previousRawProgress;
    const rawMotion = Math.abs(progressDelta) / Math.max(.001, dt);
    scrollMotion = damp(scrollMotion, clamp(rawMotion * .55, 0, 1), 7.5, dt);
    if (Math.abs(progressDelta) > .00015) {
      scrollDirection = damp(scrollDirection, progressDelta > 0 ? 1 : -1, 13, dt);
    }
    previousRawProgress = scrollProgress;

    smoothProgress = damp(smoothProgress, scrollProgress, 5.0, dt);
    pointer.smoothX = damp(pointer.smoothX, pointer.x, 13.5, dt);
    pointer.smoothY = damp(pointer.smoothY, pointer.y, 13.5, dt);
    pointer.activity = damp(pointer.activity, 0, 2.6, dt);

    animateMascot(smoothProgress, time, dt);

    // Decouple expensive environment animation from the mascot/camera render.
    // The hero motion can stay responsive while background simulation runs at a
    // lower, fixed cadence that is much kinder to integrated GPUs and work PCs.
    if (worldBudget >= worldInterval) {
      animateWorld(time, worldBudget, smoothProgress);
      worldBudget %= worldInterval;
    }

    const submerged = smoothstep(.20, .30, smoothProgress);
    const stationPose = nearestStationPose(smoothProgress);
    const cameraSettle = stationPose.settle;
    const nowMs = performance.now();
    const calmEnoughToChirp = scrollMotion < .24 || stationPose.settle > .62;
    if (
      nowMs >= nextMascotChirpAt &&
      calmEnoughToChirp &&
      journey.classList.contains('is-active') &&
      !portalSoundMuted()
    ) {
      const depthVariant = smoothProgress < .22
        ? Math.floor(nowMs / 1000) % 3
        : (stationPose.index + Math.floor(nowMs / 3000)) % 5;
      if (!playMascotChirp(depthVariant)) scheduleNextMascotChirp(nowMs, smoothProgress);
    }
    const followHeight = lerp(3.8, mascot.position.y + 4.35, submerged);
    const targetZ = lerp(11.8, 8.6, submerged) + Math.sin(smoothProgress * Math.PI * 2) * .18;
    const targetX = lerp(.8, mascot.position.x * .08, submerged);
    camera.position.x = damp(camera.position.x, targetX + pointer.smoothX * .72, 4.0, dt);
    camera.position.y = damp(camera.position.y, followHeight + pointer.smoothY * .42 + cameraSettle * .14, 3.2, dt);
    camera.position.z = damp(camera.position.z, targetZ + cameraSettle * .35 + pointer.smoothY * .10, 4.6, dt);
    camera.lookAt(
      mascot.position.x * .18 + pointer.smoothX * .33,
      mascot.position.y - lerp(.18, .58, submerged) + pointer.smoothY * .25,
      mascot.position.z
    );

    const soundBand = smoothProgress < .18 ? 0 : smoothProgress < .30 ? 1 : smoothProgress < .60 ? 2 : 3;
    if (soundBand !== lastMascotSoundBand) {
      lastMascotSoundBand = soundBand;
      if (soundBand > 0) playMascotChirp(soundBand - 1);
    }

    // Water entry reads as an event: ring burst at the surface plus a short
    // brightening. The ring is visual-only and cannot interfere with portal UI.
    const splash = smoothstep(.218, .238, smoothProgress) * (1 - smoothstep(.255, .292, smoothProgress));
    if (smoothProgress < .19) splashSoundArmed = true;
    if (smoothProgress > .232 && splashSoundArmed) {
      splashSoundArmed = false;
      playWaterSplash();
    }
    const entryPath = sampleDivePath(.235);
    splashRing.position.x = entryPath.x;
    splashRing.material.opacity = splash * .78;
    splashRing.scale.setScalar(.7 + splash * 2.3);

    setCinematicAudioMix(submerged, journey.classList.contains('is-active'));

    const deepening = smoothstep(.32, .95, smoothProgress);
    if (depthBackdropImage) {
      const depthShift = -depthImageTravel * smoothProgress;
      depthBackdropImage.style.transform =
        `translate3d(-50%,${depthShift.toFixed(1)}px,0) scale(1.035)`;
    }
    scene.fog.density = lerp(.008, .034, submerged) + deepening * .006;
    scene.fog.color.setRGB(
      lerp(.02, .004, deepening),
      lerp(.18, .035, deepening),
      lerp(.30, .10, deepening)
    );
    clearColorScratch.setRGB(
      lerp(.21, .005, submerged),
      lerp(.72, .075, submerged),
      lerp(.93, .15, submerged)
    );
    // Keep the WebGL canvas transparent so the portrait ocean backdrop remains visible.
    // Scene fog/materials still tint the 3D objects; the background image supplies the depth.
    renderer.setClearColor(clearColorScratch, 0);

    if (bubbleBudget >= bubbleInterval) {
      animateBubbleField(bubbles, time, 1);
      animateBubbleField(dust, time, .34);
      animateBubbleField(mascotTrail, time, 1.8);
      bubbleBudget %= bubbleInterval;
    }
    bubbles.material.opacity = lerp(.34, .54, submerged);
    dust.material.opacity = .16 + Math.sin(time * .7) * .035;

    ice.visible = smoothProgress < .42;
    cyanLight.intensity = lerp(6, 14, submerged) + splash * 3.5;
    violetLight.intensity = lerp(2, 11, smoothstep(.45, .85, smoothProgress));
    sun.intensity = lerp(5, 1.7, submerged);
  };

  let firstFrameRendered = false;
  let renderFailed = false;
  let cinematicLoopRunning = false;
  let cinematicTimerId = 0;
  let cinematicRafId = 0;
  let lastInteractionMs = performance.now();

  const cancelCinematicSchedule = () => {
    if (cinematicTimerId) {
      window.clearTimeout(cinematicTimerId);
      cinematicTimerId = 0;
    }
    if (cinematicRafId) {
      window.cancelAnimationFrame(cinematicRafId);
      cinematicRafId = 0;
    }
  };

  const failToFallback = (message) => {
    if (renderFailed) return;
    renderFailed = true;
    cinematicLoopRunning = false;
    cancelCinematicSchedule();
    stopCinematicAudio();
    journey.classList.add('cinematic-fallback');
    stage.classList.remove('is-ready');
    const loading = stage.querySelector('.cinematic-loading');
    if (loading) loading.textContent = message;
  };

  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    failToFallback('3D paused by the browser · cinematic controls remain available');
  }, { once: true });

  const markCinematicActivity = () => {
    lastInteractionMs = performance.now();
    stage.dataset.cinematicIdle = 'active';
    if (cinematicShouldRun()) startCinematicLoop();
  };

  const scheduledFps = () => {
    const activityAgeMs = performance.now() - lastInteractionMs;
    if (activityAgeMs > 3500) return 0;
    return activityAgeMs > 900 ? Math.min(12, renderFpsCap) : renderFpsCap;
  };

  const render = frameTime => {
    if (renderFailed || !cinematicShouldRun()) return;
    const dt = Math.min(clock.getDelta(), .05);
    const time = clock.elapsedTime;
    try {
      if (!firstFrameRendered && !resize()) return;
      const workStart = performance.now();
      updateScene(dt, time);
      renderer.render(scene, camera);
      recordFramePerformance(performance.now() - workStart);
      if (!firstFrameRendered) {
        firstFrameRendered = true;
        stage.classList.add('is-ready');
      }
    } catch (error) {
      console.error('Little Feet cinematic render failed:', error);
      failToFallback('3D could not render · cinematic controls remain available');
    }
  };

  const scheduleCinematicFrame = (immediate = false) => {
    if (!cinematicLoopRunning || renderFailed) return;
    const fps = scheduledFps();
    if (fps <= 0) {
      cinematicLoopRunning = false;
      stage.dataset.cinematicIdle = 'frozen';
      stage.dataset.cinematicRuntime = 'paused';
      stopCinematicAudio();
      return;
    }

    const delayMs = immediate ? 0 : Math.max(0, (1000 / fps) - 1);
    cinematicTimerId = window.setTimeout(() => {
      cinematicTimerId = 0;
      if (!cinematicLoopRunning || renderFailed) return;
      cinematicRafId = window.requestAnimationFrame(frameTime => {
        cinematicRafId = 0;
        if (!cinematicLoopRunning || renderFailed) return;
        render(frameTime);
        if (cinematicLoopRunning) scheduleCinematicFrame(false);
      });
    }, delayMs);
  };

  // Hard runtime gate: when the cinematic is not actually being viewed or the
  // client pauses it, stop every cinematic update completely.
  let journeyInViewport = false;
  let cinematicUserPaused = false;
  try {
    cinematicUserPaused = localStorage.getItem('lf_cinematic_paused') === 'true';
  } catch { /* Storage can be unavailable in locked-down browsers. */ }

  const syncPauseUi = () => {
    journey.classList.toggle('is-user-paused', cinematicUserPaused);
    if (!pauseButton) return;
    pauseButton.setAttribute('aria-pressed', String(cinematicUserPaused));
    pauseButton.textContent = cinematicUserPaused ? 'Resume cinematic' : 'Pause cinematic';
  };

  const cinematicShouldRun = () => {
    const home = document.getElementById('homeTab');
    const dashboardVisible = !dashboard || !dashboard.classList.contains('hidden');
    return !renderFailed &&
      !cinematicUserPaused &&
      !document.hidden &&
      dashboardVisible &&
      Boolean(home?.classList.contains('active')) &&
      journeyInViewport &&
      journey.classList.contains('is-active');
  };

  const stopCinematicLoop = () => {
    cinematicLoopRunning = false;
    cancelCinematicSchedule();
    stage.dataset.cinematicRuntime = 'paused';
    stopCinematicAudio();
    if (activePenguinCallSource) {
      try { activePenguinCallSource.stop(); } catch { /* Already ended. */ }
      activePenguinCallSource = null;
      activePenguinCallUntil = 0;
    }
  };

  const startCinematicLoop = () => {
    if (cinematicLoopRunning || !cinematicShouldRun()) return;
    cinematicLoopRunning = true;
    clock.getDelta();
    stage.dataset.cinematicRuntime = 'running';
    scheduleCinematicFrame(true);
  };

  const syncCinematicRuntime = () => {
    if (cinematicShouldRun()) startCinematicLoop();
    else stopCinematicLoop();
  };

  pauseButton?.addEventListener('click', () => {
    cinematicUserPaused = !cinematicUserPaused;
    try { localStorage.setItem('lf_cinematic_paused', String(cinematicUserPaused)); } catch { /* Optional preference. */ }
    syncPauseUi();
    if (cinematicUserPaused) {
      stopCinematicLoop();
      stage.dataset.cinematicIdle = 'paused-by-user';
    } else {
      markCinematicActivity();
      syncCinematicRuntime();
    }
  });
  syncPauseUi();

  const journeyObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
        journeyInViewport = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
        syncCinematicRuntime();
      }, { threshold: [0, .01] })
    : null;

  if (journeyObserver) {
    journeyObserver.observe(journey);
  } else {
    // Older browsers still get a safe geometry-based fallback.
    const updateJourneyViewportFallback = () => {
      const rect = journey.getBoundingClientRect();
      journeyInViewport = rect.bottom > 0 && rect.top < window.innerHeight;
      syncCinematicRuntime();
    };
    window.addEventListener('scroll', updateJourneyViewportFallback, { passive: true });
    window.addEventListener('resize', updateJourneyViewportFallback, { passive: true });
    updateJourneyViewportFallback();
  }

  const homeTab = document.getElementById('homeTab');
  const homeObserver = homeTab && typeof MutationObserver === 'function'
    ? new MutationObserver(syncCinematicRuntime)
    : null;
  homeObserver?.observe(homeTab, { attributes: true, attributeFilter: ['class'] });

  const runtimeDashboardObserver = dashboard && typeof MutationObserver === 'function'
    ? new MutationObserver(syncCinematicRuntime)
    : null;
  runtimeDashboardObserver?.observe(dashboard, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      clock.getDelta();
      syncVisibleStage();
    }
    syncCinematicRuntime();
  });

  window.addEventListener('scroll', () => {
    markCinematicActivity();
    syncCinematicRuntime();
  }, { passive: true });
  window.addEventListener('resize', () => {
    markCinematicActivity();
    syncCinematicRuntime();
  }, { passive: true });

  syncVisibleStage();
  if (!journeyObserver) syncCinematicRuntime();
  updateCopy(0);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCinematicJourney, { once: true });
else initCinematicJourney();
