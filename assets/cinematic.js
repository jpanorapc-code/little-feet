
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

  const headRig = new THREE.Group();
  headRig.position.set(0, 1.12, .03);
  group.add(headRig);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.79, 40, 30), blueDark);
  head.scale.set(1, .94, .94);
  head.castShadow = true;
  headRig.add(head);

  const facePatch = new THREE.Mesh(new THREE.SphereGeometry(.58, 32, 24), white);
  facePatch.scale.set(.88, .82, .28);
  facePatch.position.set(0, -.05, .60);
  headRig.add(facePatch);

  const beak = new THREE.Mesh(new THREE.ConeGeometry(.23, .48, 4), orange);
  beak.rotation.x = Math.PI / 2;
  beak.rotation.z = Math.PI / 4;
  beak.position.set(0, -.16, .99);
  headRig.add(beak);

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
  eyeL.position.set(-.24, .10, .83);
  eyeR.position.set(.24, .10, .83);
  headRig.add(eyeL, eyeR);

  const ringGeo = new THREE.TorusGeometry(.22, .045, 10, 26);
  const ringL = new THREE.Mesh(ringGeo, glass);
  const ringR = new THREE.Mesh(ringGeo, glass);
  ringL.position.set(-.25, .10, .92);
  ringR.position.set(.25, .10, .92);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(.18,.055,.055), glass);
  bridge.position.set(0,.10,.92);
  headRig.add(ringL, ringR, bridge);

  const footGeo = new THREE.SphereGeometry(.32, 20, 14);
  const footL = new THREE.Mesh(footGeo, orange);
  const footR = new THREE.Mesh(footGeo, orange);
  footL.scale.set(1.2,.24,.72);
  footR.scale.copy(footL.scale);
  footL.position.set(-.38,-1.32,.18);
  footR.position.set(.38,-1.32,.18);
  group.add(footL, footR);

  group.userData = {
    body, belly, head, headRig, beak, leftFlipper, rightFlipper, eyeL, eyeR, footL, footR,
    eyeLBase: eyeL.position.clone(), eyeRBase: eyeR.position.clone(),
    bodyBaseScale: body.scale.clone(), bellyBaseScale: belly.scale.clone(),
    beakBaseScale: beak.scale.clone()
  };
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


function createFishSchool(count, color, accent = 0xffffff) {
  const school = new THREE.Group();
  const bodyMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .9 });
  const accentMaterial = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .72 });
  const bodyGeometry = new THREE.SphereGeometry(.16, 10, 7);
  const tailGeometry = new THREE.ConeGeometry(.13, .28, 3);

  const fish = [];
  for (let index = 0; index < count; index += 1) {
    const swimmer = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.scale.set(1.85, .66, .62);
    const tail = new THREE.Mesh(tailGeometry, accentMaterial);
    tail.position.x = -.34;
    tail.rotation.z = Math.PI / 2;
    tail.scale.set(.95, 1, .7);
    swimmer.add(body, tail);
    const lane = (index % 4) - 1.5;
    const row = Math.floor(index / 4);
    swimmer.position.set(
      -row * .62 - (index % 2) * .22,
      lane * .34 + Math.sin(index * 1.7) * .11,
      Math.sin(index * 2.1) * .65
    );
    const size = .72 + (index % 5) * .055;
    swimmer.scale.setScalar(size);
    swimmer.userData = {
      phase: index * 1.37,
      base: swimmer.position.clone(),
      speed: .85 + (index % 3) * .11
    };
    school.add(swimmer);
    fish.push(swimmer);
  }
  school.userData = { fish, base: new THREE.Vector3(), speed: 1, phase: 0, span: 12 };
  return school;
}

function createMantaRay(color = 0x77d9ff) {
  const group = new THREE.Group();
  const material = new THREE.MeshPhysicalMaterial({
    color,
    emissive: color,
    emissiveIntensity: .7,
    roughness: .28,
    transparent: true,
    opacity: .78,
    clearcoat: .7,
    side: THREE.DoubleSide
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(.48, 18, 12), material);
  body.scale.set(1.35, .32, 1.7);
  group.add(body);

  const makeWing = side => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(side * 1.35, .34, side * 2.15, -.05);
    shape.quadraticCurveTo(side * 1.15, -.62, 0, -.18);
    shape.lineTo(0, 0);
    const wing = new THREE.Mesh(new THREE.ShapeGeometry(shape, 10), material);
    wing.rotation.x = -Math.PI / 2;
    return wing;
  };
  const wingL = makeWing(-1);
  const wingR = makeWing(1);
  group.add(wingL, wingR);

  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, -.65),
    new THREE.Vector3(.03, -.02, -1.55),
    new THREE.Vector3(-.05, .01, -2.65)
  ]);
  const tail = new THREE.Mesh(
    new THREE.TubeGeometry(tailCurve, 18, .025, 6, false),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .5 })
  );
  group.add(tail);
  group.userData = { wingL, wingR, baseScale: group.scale.clone(), phase: 0, speed: .18 };
  return group;
}

function createKelpPatch(count, color = 0x2cffb5) {
  const patch = new THREE.Group();
  const fronds = [];
  for (let index = 0; index < count; index += 1) {
    const height = 2.7 + (index % 5) * .6;
    const x = (index - (count - 1) / 2) * .62;
    const z = Math.sin(index * 1.9) * 1.5;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(.12 * Math.sin(index), height * .34, 0),
      new THREE.Vector3(-.15 * Math.cos(index * 1.3), height * .69, .03),
      new THREE.Vector3(.12 * Math.sin(index * .7), height, 0)
    ]);
    const frond = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 18, .035 + (index % 3) * .008, 6, false),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: .8,
        roughness: .45,
        transparent: true,
        opacity: .72
      })
    );
    frond.position.set(x, 0, z);
    frond.userData.phase = index * .83;
    patch.add(frond);
    fronds.push(frond);
  }
  patch.userData.fronds = fronds;
  return patch;
}

function createGlowReef(color = 0x42f5e9, accent = 0x9768ff) {
  const group = new THREE.Group();
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x063a54,
    roughness: .78,
    metalness: .08
  });
  const glowMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: accent,
    emissiveIntensity: 2.2,
    roughness: .32
  });

  for (let index = 0; index < 11; index += 1) {
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(.55 + (index % 4) * .18, 1), baseMaterial);
    rock.scale.y = .45 + (index % 3) * .16;
    rock.position.set((index - 5) * .72, Math.sin(index * 2.2) * .18, Math.cos(index * 1.7) * 1.25);
    group.add(rock);

    if (index % 2 === 0) {
      const coral = new THREE.Mesh(new THREE.CylinderGeometry(.05, .11, .8 + (index % 3) * .28, 8), glowMaterial);
      coral.position.set(rock.position.x, .5 + (index % 3) * .16, rock.position.z);
      coral.rotation.z = (index - 5) * .035;
      group.add(coral);
    }
  }
  const light = new THREE.PointLight(color, 5.5, 9, 2);
  light.position.set(0, 1.2, 0);
  group.add(light);
  group.userData = { light, baseIntensity: light.intensity };
  return group;
}

function createCausticBeams(count = 4) {
  const group = new THREE.Group();
  const beams = [];
  for (let index = 0; index < count; index += 1) {
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(2.4 + index * .55, 16 + index * 1.7, 22, 1, true),
      new THREE.MeshBasicMaterial({
        color: index % 2 ? 0x6cf7ff : 0xc4fbff,
        transparent: true,
        opacity: .035 + index * .008,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    beam.position.set(-7 + index * 4.5, -6 - index * 2.1, -8 - index * 1.3);
    beam.rotation.z = -.16 + index * .08;
    beam.userData.phase = index * 1.4;
    group.add(beam);
    beams.push(beam);
  }
  group.userData.beams = beams;
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
      const availableHeight = Math.max(1, journey.offsetHeight - window.innerHeight);
      window.scrollTo({ top: journey.offsetTop + availableHeight * station.at, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
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
    refreshStationTargets();
    if (index === activeStation) {
      const current = stations[index];
      if (openButton && current) openButton.textContent = 'Open ' + current.target.label;
      return;
    }
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
  const pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0, activity: 0, lastX: 0, lastY: 0 };
  let scrollProgress = 0;
  let smoothProgress = 0;
  let mascotSoundUnlocked = false;
  let lastMascotChirpAt = 0;
  let lastMascotSoundBand = -1;
  let mascotChirpUntil = 0;

  const portalSoundMuted = () => {
    try { return localStorage.getItem('lf_portal_audio_muted_last') === 'true'; }
    catch { return false; }
  };

  const playMascotChirp = (variant = 0) => {
    if (!mascotSoundUnlocked || portalSoundMuted() || document.hidden) return;
    const nowMs = performance.now();
    if (nowMs - lastMascotChirpAt < 1100) return;
    lastMascotChirpAt = nowMs;
    mascotChirpUntil = nowMs + 360;
    try {
      const getContext = typeof window.getPortalAudioContext === 'function' ? window.getPortalAudioContext : null;
      const ctx = getContext ? getContext() : null;
      if (!ctx || ctx.state === 'suspended') return;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.055, ctx.currentTime + .012);
      master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + .32);
      master.connect(ctx.destination);
      const patterns = [[920,1180],[760,1040,1320],[1080,860]];
      const tones = patterns[variant % patterns.length];
      tones.forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + index * .075;
        osc.type = index % 2 ? 'sine' : 'triangle';
        osc.frequency.setValueAtTime(frequency, start);
        osc.frequency.exponentialRampToValueAtTime(frequency * 1.04, start + .06);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(.7, start + .008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + .09);
        osc.connect(gain);
        gain.connect(master);
        osc.start(start);
        osc.stop(start + .11);
      });
    } catch { /* Mascot sound remains optional if a browser blocks Web Audio. */ }
  };

  const unlockMascotSound = () => {
    mascotSoundUnlocked = true;
  };
  stage.addEventListener('pointerdown', unlockMascotSound, { once: true, passive: true });
  stage.addEventListener('keydown', unlockMascotSound, { once: true });

  // A deterministic dive path keeps the mascot tied to the same scroll
  // milestones as the underwater stations instead of letting camera math
  // accidentally make it appear to float upward.
  const diveKeyframes = [
    { at: 0.00, x: -2.15, y:  2.00, z:  0.35, pitch: 0.00, roll:  0.00 },
    { at: 0.11, x: -2.10, y:  2.00, z:  0.35, pitch: 0.00, roll:  0.00 },
    { at: 0.16, x: -1.70, y:  2.55, z:  0.20, pitch: 0.18, roll: -0.18 },
    { at: 0.22, x: -0.65, y:  0.55, z:  0.05, pitch: 0.82, roll: -0.38 },
    { at: 0.27, x:  0.35, y: -1.10, z: -0.10, pitch: 1.02, roll: -0.20 },
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

  const resize = () => {
    const rect = stage.getBoundingClientRect();
    // The dashboard starts display:none before login. Never lock the WebGL buffer
    // to 1x1 while its parent is hidden; wait until the real portal size exists.
    if (rect.width < 2 || rect.height < 2) return false;
    renderer.setSize(Math.round(rect.width), Math.round(rect.height), false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    return true;
  };

  const calculateScroll = () => {
    if (journey.offsetHeight < 2) return;
    const top = journey.offsetTop;
    const travel = Math.max(1, journey.offsetHeight - window.innerHeight);
    const raw = (window.scrollY - top) / travel;
    scrollProgress = clamp(raw);
    journey.classList.toggle('is-active', raw >= 0 && raw <= 1);
    journey.classList.toggle('is-after', raw > 1);
    updateProgressUI(scrollProgress);
  };

  const syncVisibleStage = () => {
    if (!resize()) return;
    refreshStationTargets();
    calculateScroll();
  };

  window.addEventListener('scroll', calculateScroll, { passive: true });
  window.addEventListener('resize', syncVisibleStage, { passive: true });

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
    const rect = stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const nextX = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    const nextY = clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1, 1);
    const movement = Math.hypot(nextX - pointer.lastX, nextY - pointer.lastY);
    pointer.activity = clamp(pointer.activity + movement * 1.7, 0, 1);
    pointer.lastX = nextX;
    pointer.lastY = nextY;
    pointer.x = nextX;
    pointer.y = nextY;
  }, { passive: true });

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

  const animateMascot = (progress, time, dt) => {
    const data = mascot.userData;
    const path = sampleDivePath(progress);
    const underwater = smoothstep(.22, .31, progress);
    const swim = smoothstep(.27, .38, progress);
    const surface = 1 - swim;
    const anticipation = smoothstep(.10, .145, progress) * (1 - smoothstep(.15, .19, progress));
    const entry = smoothstep(.15, .25, progress) * (1 - smoothstep(.26, .34, progress));
    const swimPhase = time * 5.15 + progress * 9.5;
    const swimWave = Math.sin(swimPhase);
    const glideWave = Math.sin(swimPhase * .5);
    const idleBreath = Math.sin(time * 2.15);
    const idleBob = surface * Math.sin(time * 1.7) * .04;

    mascot.position.set(
      path.x,
      path.y + idleBob + swim * Math.sin(swimPhase * .55) * .14 - anticipation * .16,
      path.z
    );
    mascot.rotation.z = path.roll + swim * glideWave * .16 + entry * -.08;
    mascot.rotation.x = path.pitch + swim * Math.sin(swimPhase * .7) * .08 + anticipation * .12;
    mascot.rotation.y = -.24 + swim * Math.sin(progress * Math.PI * 4) * .32;

    // Surface life: breathing, tiny weight shifts, foot wiggles and pre-dive crouch.
    const bodyBreath = 1 + surface * idleBreath * .012;
    data.body.scale.set(
      data.bodyBaseScale.x * (bodyBreath + anticipation * .035),
      data.bodyBaseScale.y * (bodyBreath - anticipation * .07),
      data.bodyBaseScale.z * bodyBreath
    );
    data.belly.scale.set(
      data.bellyBaseScale.x * (1 + surface * idleBreath * .010),
      data.bellyBaseScale.y * (1 + surface * idleBreath * .014 - anticipation * .055),
      data.bellyBaseScale.z
    );

    // Penguin propulsion: strong flipper strokes, recovery, body glide and alternating foot kicks.
    const stroke = Math.sin(swimPhase);
    const recovery = Math.sin(swimPhase + Math.PI * .5);
    const idleFlap = Math.sin(time * 1.35) * .045;
    data.leftFlipper.rotation.z = lerp(-.48 + idleFlap - anticipation * .20, -1.10 + stroke * .52, swim);
    data.rightFlipper.rotation.z = lerp(.48 - idleFlap + anticipation * .20, 1.10 - stroke * .52, swim);
    data.leftFlipper.rotation.x = lerp(-.14 + anticipation * .32, .74 + recovery * .38, swim);
    data.rightFlipper.rotation.x = lerp(-.14 + anticipation * .32, .74 - recovery * .38, swim);
    data.leftFlipper.rotation.y = swim * (.20 + stroke * .24);
    data.rightFlipper.rotation.y = swim * (-.20 - stroke * .24);
    data.footL.rotation.x = surface * Math.sin(time * 1.8) * .035 + swim * (.24 + swimWave * .60);
    data.footR.rotation.x = surface * Math.sin(time * 1.8 + Math.PI) * .035 + swim * (.24 - swimWave * .60);
    data.footL.rotation.z = surface * Math.sin(time * 1.15) * .035;
    data.footR.rotation.z = -data.footL.rotation.z;

    // "You stole my food" tracking: the face turns hard toward the cursor and
    // the pupils push even farther, so the stare is obvious instead of subtle.
    const headYaw = pointer.smoothX * .72;
    const headPitch = -pointer.smoothY * .48 + swim * .035;
    data.headRig.rotation.y = damp(data.headRig.rotation.y, headYaw, 11.5, dt);
    data.headRig.rotation.x = damp(data.headRig.rotation.x, headPitch, 11.5, dt);
    data.headRig.rotation.z = damp(data.headRig.rotation.z, pointer.smoothX * -.11, 10.5, dt);
    const eyeX = pointer.smoothX * .115;
    const eyeY = pointer.smoothY * .078;
    data.eyeL.position.x = damp(data.eyeL.position.x, data.eyeLBase.x + eyeX, 16, dt);
    data.eyeR.position.x = damp(data.eyeR.position.x, data.eyeRBase.x + eyeX, 16, dt);
    data.eyeL.position.y = damp(data.eyeL.position.y, data.eyeLBase.y + eyeY, 16, dt);
    data.eyeR.position.y = damp(data.eyeR.position.y, data.eyeRBase.y + eyeY, 16, dt);

    // Quick alert reaction when the cursor moves: eyes widen and the body gives
    // a tiny "caught you" pop while still respecting the scroll-driven path.
    const alert = pointer.activity;
    const eyeWiden = 1 + alert * .22;
    data.eyeL.scale.x = eyeWiden;
    data.eyeR.scale.x = eyeWiden;
    mascot.scale.x = .92 * (1 + alert * .012);
    mascot.scale.y = .92 * (1 + alert * .022);
    mascot.scale.z = .92;

    const chirping = performance.now() < mascotChirpUntil;
    const beakPulse = chirping ? 1 + Math.sin(time * 34) * .12 : 1;
    data.beak.scale.set(
      data.beakBaseScale.x,
      data.beakBaseScale.y * beakPulse,
      data.beakBaseScale.z * beakPulse
    );

    // Less robotic blinking: a normal blink plus an occasional fast double blink.
    const blinkCycle = time % 6.6;
    const blink = (blinkCycle > 6.43 || (blinkCycle > 5.98 && blinkCycle < 6.08)) ? .06 : 1;
    data.eyeL.scale.y = blink;
    data.eyeR.scale.y = blink;
  };

  const updateScene = (dt, time) => {
    smoothProgress = damp(smoothProgress, scrollProgress, 7.2, dt);
    pointer.smoothX = damp(pointer.smoothX, pointer.x, 10.5, dt);
    pointer.smoothY = damp(pointer.smoothY, pointer.y, 10.5, dt);
    pointer.activity = damp(pointer.activity, 0, 2.8, dt);

    animateMascot(smoothProgress, time, dt);
    updateWater(time);

    const submerged = smoothstep(.20, .30, smoothProgress);
    const followHeight = lerp(3.8, mascot.position.y + 4.25, submerged);
    const targetZ = lerp(11.8, 8.9, submerged) + Math.sin(smoothProgress * Math.PI * 2) * .28;
    const targetX = lerp(.8, mascot.position.x * .10, submerged);
    camera.position.x = damp(camera.position.x, targetX + pointer.smoothX * .72, 4.2, dt);
    // Follow more slowly on Y than the mascot moves. The small lag makes the
    // entry visibly read as a downward dive instead of the camera outrunning it.
    camera.position.y = damp(camera.position.y, followHeight + pointer.smoothY * .5, 3.1, dt);
    camera.position.z = damp(camera.position.z, targetZ, 4.8, dt);
    camera.lookAt(
      mascot.position.x * .20 + pointer.smoothX * .42,
      mascot.position.y - lerp(.2, .65, submerged) + pointer.smoothY * .34,
      mascot.position.z
    );

    const soundBand = smoothProgress < .18 ? 0 : smoothProgress < .30 ? 1 : smoothProgress < .60 ? 2 : 3;
    if (soundBand !== lastMascotSoundBand) {
      lastMascotSoundBand = soundBand;
      if (soundBand > 0) playMascotChirp(soundBand - 1);
    }

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
    const rect = stage.getBoundingClientRect();
    const dashboardVisible = !dashboard || !dashboard.classList.contains('hidden');
    const visible = dashboardVisible &&
      home?.classList.contains('active') &&
      !document.hidden &&
      rect.width >= 2 &&
      rect.height >= 2;
    if (!visible) return;
    try {
      // Resize again immediately before the first visible frame. This covers
      // login transitions even on browsers that delay ResizeObserver delivery.
      if (!firstFrameRendered && !resize()) return;
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
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      clock.getDelta();
      syncVisibleStage();
    }
  });
  syncVisibleStage();
  updateCopy(0);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initCinematicJourney, { once: true });
else initCinematicJourney();
