
import * as THREE from '/vendor/three.module.js';

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
  const x = clamp((value - a) / Math.max(0.0001, b - a));
  return x * x * (3 - 2 * x);
};
const damp = (current, target, lambda, dt) => THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));

const qualityForDevice = () => {
  const memory = Number(navigator.deviceMemory || 8);
  const cores = Number(navigator.hardwareConcurrency || 8);
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  if (narrow || memory <= 4 || cores <= 4) return 'low';
  if (memory <= 8 || cores <= 8) return 'medium';
  return 'high';
};

const canUseWebGL2 = () => {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }));
  } catch {
    return false;
  }
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

function createMascot() {
  const group = new THREE.Group();
  const blue = new THREE.MeshPhysicalMaterial({ color: 0x1267a5, roughness: .34, metalness: .04, clearcoat: .82, clearcoatRoughness: .2 });
  const blueDark = new THREE.MeshPhysicalMaterial({ color: 0x083f74, roughness: .28, clearcoat: .72 });
  const white = new THREE.MeshPhysicalMaterial({ color: 0xf1fbff, roughness: .28, clearcoat: .55 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xffa61b, roughness: .45, metalness: .02 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x87f5ff, roughness: .08, metalness: .18, transmission: .55, transparent: true, opacity: .78, emissive: 0x0b5d79, emissiveIntensity: .35 });
  const black = new THREE.MeshStandardMaterial({ color: 0x06121d, roughness: .22 });

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 32), blue);
  body.scale.set(.92, 1.28, .72);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(.72, 36, 28), white);
  belly.scale.set(.78, 1.08, .38);
  belly.position.set(0, -.13, .55);
  belly.castShadow = true;
  group.add(belly);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.79, 40, 30), blueDark);
  head.position.set(0, 1.12, .03);
  head.scale.set(1, .94, .94);
  head.castShadow = true;
  group.add(head);

  const facePatch = new THREE.Mesh(new THREE.SphereGeometry(.58, 32, 24), white);
  facePatch.scale.set(.88, .82, .28);
  facePatch.position.set(0, 1.07, .63);
  group.add(facePatch);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(.23, .48, 4), orange);
  beak.rotation.x = Math.PI / 2;
  beak.rotation.z = Math.PI / 4;
  beak.position.set(0, .96, 1.02);
  group.add(beak);

  const leftFlipper = new THREE.Mesh(new THREE.CapsuleGeometry(.18, 1.05, 7, 16), blueDark);
  leftFlipper.scale.set(.72, 1, .38);
  leftFlipper.position.set(-.94, -.02, .02);
  leftFlipper.rotation.z = -.48;
  leftFlipper.rotation.x = -.14;
  leftFlipper.castShadow = true;
  const rightFlipper = leftFlipper.clone();
  rightFlipper.position.x = .94;
  rightFlipper.rotation.z = .48;
  group.add(leftFlipper, rightFlipper);

  const eyeGeo = new THREE.SphereGeometry(.105, 18, 14);
  const eyeL = new THREE.Mesh(eyeGeo, black);
  const eyeR = new THREE.Mesh(eyeGeo, black);
  eyeL.position.set(-.24, 1.22, .86);
  eyeR.position.set(.24, 1.22, .86);
  group.add(eyeL, eyeR);

  const ringGeo = new THREE.TorusGeometry(.22, .045, 10, 26);
  const ringL = new THREE.Mesh(ringGeo, glass);
  const ringR = new THREE.Mesh(ringGeo, glass);
  ringL.position.set(-.25, 1.22, .95);
  ringR.position.set(.25, 1.22, .95);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(.18,.055,.055), glass);
  bridge.position.set(0,1.22,.95);
  group.add(ringL, ringR, bridge);

  const footGeo = new THREE.SphereGeometry(.32, 20, 14);
  const footL = new THREE.Mesh(footGeo, orange);
  const footR = new THREE.Mesh(footGeo, orange);
  footL.scale.set(1.2,.24,.72);
  footR.scale.copy(footL.scale);
  footL.position.set(-.38,-1.32,.18);
  footR.position.set(.38,-1.32,.18);
  group.add(footL, footR);

  group.userData = { body, head, leftFlipper, rightFlipper, eyeL, eyeR, footL, footR };
  group.scale.setScalar(.92);
  return group;
}

function createIceShelf() {
  const group = new THREE.Group();
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(3.45, 3.05, .62, 42, 2),
    new THREE.MeshPhysicalMaterial({
      color: 0xdffcff,
      roughness: .18,
      metalness: .03,
      clearcoat: 1,
      clearcoatRoughness: .08,
      transmission: .12,
      thickness: .7
    })
  );
  top.position.y = .02;
  top.receiveShadow = true;
  top.castShadow = true;
  group.add(top);

  const underside = new THREE.Mesh(
    new THREE.CylinderGeometry(3.0, 2.15, 1.35, 34, 2),
    new THREE.MeshPhysicalMaterial({ color: 0x79c9e9, roughness: .3, clearcoat: .5 })
  );
  underside.position.y = -.88;
  underside.castShadow = true;
  group.add(underside);
  return group;
}

function createWater() {
  const geometry = new THREE.PlaneGeometry(44, 44, 42, 42);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x19aee7,
    transparent: true,
    opacity: .58,
    roughness: .12,
    metalness: .04,
    transmission: .38,
    thickness: .35,
    clearcoat: 1,
    clearcoatRoughness: .05,
    side: THREE.DoubleSide
  });
  const water = new THREE.Mesh(geometry, material);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -.25;
  water.receiveShadow = true;
  water.userData.basePositions = Float32Array.from(geometry.attributes.position.array);
  return water;
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
  return new THREE.Points(geometry, material);
}

function createJellyfish(color = 0x83f8ff, accent = 0x725dff) {
  const group = new THREE.Group();
  const bell = new THREE.Mesh(
    new THREE.SphereGeometry(.88, 30, 20, 0, Math.PI * 2, 0, Math.PI * .56),
    new THREE.MeshPhysicalMaterial({
      color,
      emissive: accent,
      emissiveIntensity: .7,
      transparent: true,
      opacity: .56,
      roughness: .08,
      transmission: .7,
      thickness: .8,
      clearcoat: 1,
      side: THREE.DoubleSide
    })
  );
  bell.scale.y = .72;
  group.add(bell);

  const core = new THREE.PointLight(color, 4.2, 8, 2);
  core.position.y = .05;
  group.add(core);

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const x = Math.cos(angle) * .47;
    const z = Math.sin(angle) * .47;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, -.18, z),
      new THREE.Vector3(x * .72 + Math.sin(i) * .16, -.95, z * .72),
      new THREE.Vector3(x * .45 - Math.cos(i) * .14, -1.85, z * .44),
      new THREE.Vector3(x * .25, -2.65 - (i % 3) * .22, z * .2)
    ]);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 22, .025 + (i % 2) * .011, 7, false),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .45, blending: THREE.AdditiveBlending })
    );
    group.add(tube);
  }
  group.userData.bell = bell;
  return group;
}

function createStationRing(color) {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.15, .055, 12, 80),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 4.2, roughness: .16, metalness: .3 })
  );
  ring.rotation.y = Math.PI / 2.25;
  const inner = new THREE.Mesh(
    new THREE.TorusGeometry(1.52, .024, 10, 72),
    new THREE.MeshBasicMaterial({ color: 0xd7ffff, transparent: true, opacity: .62, blending: THREE.AdditiveBlending })
  );
  inner.rotation.copy(ring.rotation);
  group.add(ring, inner);
  return group;
}

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
  if (!journey || !stage || !canvas || !title || !kicker || !copy || !progressBar || !depthLabel || !stopContainer) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stations = stationBlueprints.map(station => ({ ...station, target: accessibleNavTarget(station.candidates) }));

  stopContainer.replaceChildren(...stations.map((station, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cinematic-stop';
    button.textContent = station.target.label;
    button.dataset.station = String(index);
    button.addEventListener('click', () => {
      const availableHeight = Math.max(1, journey.offsetHeight - window.innerHeight);
      window.scrollTo({ top: journey.offsetTop + availableHeight * station.at, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    });
    return button;
  }));

  const openButton = document.getElementById('cinematicOpenCurrent');
  openButton?.addEventListener('click', () => {
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
    const depth = progress < .22 ? 'Surface' : Math.round((progress - .18) * 42) + ' m below';
    depthLabel.textContent = depth;
    let nearest = 0;
    let distance = Infinity;
    stations.forEach((station, index) => {
      const candidate = Math.abs(progress - station.at);
      if (candidate < distance) { distance = candidate; nearest = index; }
    });
    updateCopy(nearest);
  };

  if (reduceMotion.matches || !canUseWebGL2()) {
    journey.classList.add('cinematic-fallback');
    stage.querySelector('.cinematic-loading').textContent = reduceMotion.matches ? 'Reduced motion mode · cinematic controls remain available' : '3D unavailable · cinematic controls remain available';
    updateProgressUI(0);
    return;
  }

  const quality = qualityForDevice();
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: quality !== 'low',
      powerPreference: quality === 'low' ? 'low-power' : 'high-performance'
    });
  } catch {
    journey.classList.add('cinematic-fallback');
    stage.querySelector('.cinematic-loading').textContent = '3D unavailable · cinematic controls remain available';
    return;
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.75 : quality === 'medium' ? 1.35 : 1));

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x052b4a, .018);

  const camera = new THREE.PerspectiveCamera(48, 1, .1, 130);
  // Keep the opening frame wide enough to show the mascot and the ice edge together.
  camera.position.set(.8, 3.8, 11.8);
  camera.lookAt(-1.35, 1.55, 0);

  const ambient = new THREE.HemisphereLight(0xc8fbff, 0x031226, 2.2);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 4.4);
  sun.position.set(-8, 12, 8);
  sun.castShadow = quality !== 'low';
  if (sun.castShadow) {
    sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
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
  ice.position.set(-2.2, .18, -.25);
  scene.add(ice);

  const water = createWater();
  scene.add(water);

  const mascot = createMascot();
  mascot.position.set(-2.15, 2.0, .35);
  mascot.rotation.y = -.24;
  scene.add(mascot);

  const bubbleCount = quality === 'high' ? 800 : quality === 'medium' ? 480 : 240;
  const bubbles = createBubbles(bubbleCount, 26, 42, quality === 'high' ? .075 : .09);
  bubbles.position.y = -.7;
  scene.add(bubbles);

  const dust = createBubbles(Math.round(bubbleCount * .42), 35, 52, .035);
  dust.material.color.setHex(0x70c6ff);
  dust.material.opacity = .2;
  dust.position.y = -2;
  scene.add(dust);

  const jellyA = createJellyfish(0x8afff7, 0x1668ff);
  jellyA.position.set(5.3, -8.5, -2.5);
  jellyA.scale.setScalar(.75);
  scene.add(jellyA);
  const jellyB = createJellyfish(0xff79e7, 0x7b4dff);
  jellyB.position.set(-5.1, -20.2, -1.7);
  jellyB.scale.setScalar(1.05);
  scene.add(jellyB);
  const jellyC = createJellyfish(0xb9ff64, 0x16b8b1);
  jellyC.position.set(4.2, -30.2, -3);
  jellyC.scale.setScalar(.62);
  scene.add(jellyC);

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

  const floorGlow = new THREE.Mesh(
    new THREE.CircleGeometry(18, 64),
    new THREE.MeshBasicMaterial({ color: 0x083d66, transparent: true, opacity: .34, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = -38;
  scene.add(floorGlow);

  const clock = new THREE.Clock();
  const pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0 };
  let scrollProgress = 0;
  let smoothProgress = 0;

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const calculateScroll = () => {
    const top = journey.offsetTop;
    const travel = Math.max(1, journey.offsetHeight - window.innerHeight);
    scrollProgress = clamp((window.scrollY - top) / travel);
    updateProgressUI(scrollProgress);
  };

  window.addEventListener('scroll', calculateScroll, { passive: true });
  window.addEventListener('resize', () => { resize(); calculateScroll(); }, { passive: true });
  stage.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    const rect = stage.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }, { passive: true });
  stage.addEventListener('pointerleave', () => { pointer.x = 0; pointer.y = 0; }, { passive: true });

  const updateWater = (time) => {
    const attr = water.geometry.attributes.position;
    const base = water.userData.basePositions;
    const stride = attr.itemSize;
    for (let i = 0; i < attr.count; i += 1) {
      const offset = i * stride;
      const x = base[offset];
      const y = base[offset + 1];
      attr.array[offset + 2] = Math.sin(x * .72 + time * 1.25) * .055 + Math.cos(y * .56 + time * .9) * .042;
    }
    attr.needsUpdate = true;
    water.geometry.computeVertexNormals();
  };

  const animateMascot = (progress, time) => {
    const data = mascot.userData;
    const dive = smoothstep(.12, .31, progress);
    const underwater = smoothstep(.24, .98, progress);
    const swimWave = Math.sin(time * 3.5);
    const xPath = -2.15 + dive * 3.6 + Math.sin(progress * Math.PI * 5) * 1.7 * underwater;
    const ySurface = 2.0 + Math.sin(time * 1.7) * .035;
    const jumpArc = Math.sin(dive * Math.PI) * 2.7;
    const yPath = lerp(ySurface + jumpArc, 1.05 - progress * 35.5, underwater);
    mascot.position.set(xPath, yPath, Math.sin(progress * Math.PI * 4) * .5);
    mascot.rotation.z = -dive * .62 + underwater * Math.sin(time * 1.15) * .12;
    mascot.rotation.x = underwater * (.82 + Math.sin(time * 1.7) * .08);
    mascot.rotation.y = -.24 + underwater * Math.sin(progress * Math.PI * 4) * .28;

    data.leftFlipper.rotation.z = -.48 + Math.sin(time * (underwater ? 5.2 : 1.9)) * (underwater ? .72 : .09);
    data.rightFlipper.rotation.z = .48 - Math.sin(time * (underwater ? 5.2 : 1.9)) * (underwater ? .72 : .09);
    data.leftFlipper.rotation.x = -.14 + underwater * .9;
    data.rightFlipper.rotation.x = -.14 + underwater * .9;
    data.footL.rotation.x = underwater * (swimWave * .5);
    data.footR.rotation.x = underwater * (-swimWave * .5);

    const blink = (time % 4.8) > 4.68 ? .08 : 1;
    data.eyeL.scale.y = blink;
    data.eyeR.scale.y = blink;
  };

  const updateScene = (dt, time) => {
    smoothProgress = damp(smoothProgress, scrollProgress, 7.2, dt);
    pointer.smoothX = damp(pointer.smoothX, pointer.x, 4.4, dt);
    pointer.smoothY = damp(pointer.smoothY, pointer.y, 4.4, dt);

    animateMascot(smoothProgress, time);
    updateWater(time);

    const submerged = smoothstep(.19, .34, smoothProgress);
    const targetY = lerp(3.8, 2.4 - smoothProgress * 34.6, submerged);
    const targetZ = lerp(11.8, 8.1, submerged) + Math.sin(smoothProgress * Math.PI * 2) * .45;
    const targetX = lerp(.8, Math.sin(smoothProgress * Math.PI * 4) * 1.35, submerged);
    camera.position.x = damp(camera.position.x, targetX + pointer.smoothX * 1.05, 5.2, dt);
    camera.position.y = damp(camera.position.y, targetY + pointer.smoothY * .5, 5.2, dt);
    camera.position.z = damp(camera.position.z, targetZ, 5.2, dt);
    camera.lookAt(
      mascot.position.x * .62 + pointer.smoothX * .55,
      mascot.position.y - .2 + pointer.smoothY * .34,
      mascot.position.z
    );

    scene.fog.density = lerp(.008, .027, submerged);
    renderer.setClearColor(new THREE.Color().setRGB(
      lerp(.21, .005, submerged),
      lerp(.72, .075, submerged),
      lerp(.93, .15, submerged)
    ), 1);

    bubbles.rotation.y = time * .018;
    dust.rotation.y = -time * .012;
    [jellyA, jellyB, jellyC].forEach((jelly, index) => {
      jelly.rotation.y = time * (.08 + index * .025) + index;
      jelly.position.x += Math.sin(time * .55 + index * 2) * .0008;
      const pulse = 1 + Math.sin(time * 1.55 + index) * .055;
      jelly.userData.bell.scale.set(pulse, .72 / pulse, pulse);
    });
    rings.forEach((ring, index) => {
      ring.rotation.z = time * (.055 + index * .012);
      const pulse = 1 + Math.sin(time * 1.6 + index * .8) * .035;
      ring.scale.setScalar(pulse);
    });

    ice.visible = smoothProgress < .48;
    water.material.opacity = lerp(.58, .23, submerged);
    cyanLight.intensity = lerp(6, 14, submerged);
    violetLight.intensity = lerp(2, 11, smoothstep(.45, .85, smoothProgress));
    sun.intensity = lerp(5, 1.7, submerged);
  };

  let firstFrameRendered = false;
  let renderFailed = false;
  const failToFallback = (message) => {
    if (renderFailed) return;
    renderFailed = true;
    renderer.setAnimationLoop(null);
    journey.classList.add('cinematic-fallback');
    stage.classList.remove('is-ready');
    const loading = stage.querySelector('.cinematic-loading');
    if (loading) loading.textContent = message;
  };

  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    failToFallback('3D paused by the browser · cinematic controls remain available');
  }, { once: true });

  const render = () => {
    if (renderFailed) return;
    const dt = Math.min(clock.getDelta(), .05);
    const time = clock.elapsedTime;
    const home = document.getElementById('homeTab');
    const visible = home?.classList.contains('active') && !document.hidden;
    if (!visible) return;
    try {
      updateScene(dt, time);
      renderer.render(scene, camera);
      if (!firstFrameRendered) {
        firstFrameRendered = true;
        stage.classList.add('is-ready');
      }
    } catch (error) {
      console.error('Little Feet cinematic render failed:', error);
      failToFallback('3D could not render · cinematic controls remain available');
    }
  };

  renderer.setAnimationLoop(render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });
  resize();
  calculateScroll();
  updateCopy(0);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCinematicJourney, { once: true });
else initCinematicJourney();
