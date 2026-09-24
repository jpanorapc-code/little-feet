
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
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const renderPixels = Math.max(1, window.innerWidth) * Math.max(1, window.innerHeight) * dpr * dpr;
  if (narrow || memory <= 4 || cores <= 4 || renderPixels > 5_000_000) return 'low';
  if (memory < 12 || cores < 10 || renderPixels > 2_600_000) return 'medium';
  return 'high';
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

  // Articulated mascot rig. The meshes stay procedural, but the hierarchy
  // behaves like a compact skeleton: chest -> head/shoulders, hips -> feet, tail.
  const chestRig = new THREE.Group();
  chestRig.position.set(0, .26, 0);
  group.add(chestRig);

  const headRig = new THREE.Group();
  // Keep a real neck gap above the torso. The previous lower pivot let strong
  // cursor pitch drive the skull through the chest mesh.
  headRig.position.set(0, 1.15, .07);
  chestRig.add(headRig);

  const head = new THREE.Mesh(new THREE.SphereGeometry(.79, 40, 30), blueDark);
  head.scale.set(1, .94, .94);
  head.castShadow = true;
  headRig.add(head);

  const facePatch = new THREE.Mesh(new THREE.SphereGeometry(.58, 32, 24), white);
  facePatch.scale.set(.88, .82, .28);
  facePatch.position.set(0, -.05, .60);
  headRig.add(facePatch);

  // Two-piece beak: wide at the face, short in profile, with a darker lower
  // mandible. This avoids the old diamond/cone mouth that looked detached.
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(.18, .42, 4, 1, false),
    orange
  );
  beak.rotation.x = Math.PI / 2;
  beak.scale.set(1.38, .64, .92);
  beak.position.set(0, -.16, .96);
  headRig.add(beak);

  const lowerBeak = new THREE.Mesh(
    new THREE.SphereGeometry(.16, 18, 10),
    new THREE.MeshStandardMaterial({ color: 0xd97a12, roughness: .52, metalness: .01 })
  );
  lowerBeak.scale.set(1.15, .34, .58);
  lowerBeak.position.set(0, -.225, .92);
  headRig.add(lowerBeak);

  const leftShoulder = new THREE.Group();
  leftShoulder.position.set(-.78, .22, .02);
  const rightShoulder = new THREE.Group();
  rightShoulder.position.set(.78, .22, .02);
  chestRig.add(leftShoulder, rightShoulder);

  const flipperGeometry = new THREE.CapsuleGeometry(.18, 1.05, 7, 16);
  const leftFlipperMesh = new THREE.Mesh(flipperGeometry, blueDark);
  leftFlipperMesh.scale.set(.72, 1, .38);
  leftFlipperMesh.position.set(-.16, -.50, 0);
  leftFlipperMesh.castShadow = true;
  leftShoulder.add(leftFlipperMesh);

  const rightFlipperMesh = new THREE.Mesh(flipperGeometry, blueDark);
  rightFlipperMesh.scale.set(.72, 1, .38);
  rightFlipperMesh.position.set(.16, -.50, 0);
  rightFlipperMesh.castShadow = true;
  rightShoulder.add(rightFlipperMesh);

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
  const leftHip = new THREE.Group();
  const rightHip = new THREE.Group();
  leftHip.position.set(-.38, -1.05, .18);
  rightHip.position.set(.38, -1.05, .18);
  group.add(leftHip, rightHip);

  const footLMesh = new THREE.Mesh(footGeo, orange);
  const footRMesh = new THREE.Mesh(footGeo, orange);
  footLMesh.scale.set(1.2,.24,.72);
  footRMesh.scale.copy(footLMesh.scale);
  footLMesh.position.set(0,-.27,0);
  footRMesh.position.set(0,-.27,0);
  leftHip.add(footLMesh);
  rightHip.add(footRMesh);

  const tailRig = new THREE.Group();
  tailRig.position.set(0, -.82, -.54);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(.25, .62, 5), blueDark);
  tail.rotation.x = Math.PI / 2;
  tail.scale.set(1.05, 1, .35);
  tail.position.z = -.18;
  tailRig.add(tail);
  group.add(tailRig);

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
  const points = new THREE.Points(geometry, material);
  points.userData = {
    basePositions: Float32Array.from(positions),
    depth,
    riseSpeed: .55 + Math.random() * .45
  };
  return points;
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

  // Fish are visually identical geometry repeated many times. Instancing keeps
  // every fish while collapsing the school to two draw calls: bodies + tails.
  const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, count);
  const tails = new THREE.InstancedMesh(tailGeometry, accentMaterial, count);
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tails.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  school.add(bodies, tails);

  const fish = [];
  for (let index = 0; index < count; index += 1) {
    const lane = (index % 4) - 1.5;
    const row = Math.floor(index / 4);
    const base = new THREE.Vector3(
      -row * .62 - (index % 2) * .22,
      lane * .34 + Math.sin(index * 1.7) * .11,
      Math.sin(index * 2.1) * .65
    );
    fish.push({
      phase: index * 1.37,
      base,
      speed: .85 + (index % 3) * .11,
      size: .72 + (index % 5) * .055,
      position: base.clone(),
      rotationY: 0,
      rotationZ: 0
    });
  }
  school.userData = {
    fish, bodies, tails,
    base: new THREE.Vector3(), speed: 1, phase: 0, span: 12,
    matrixObject: new THREE.Object3D()
  };
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

  const rockGeometry = new THREE.IcosahedronGeometry(1, 1);
  const coralGeometry = new THREE.CylinderGeometry(.05, .11, 1, 8);
  const rocks = new THREE.InstancedMesh(rockGeometry, baseMaterial, 11);
  const coralCount = 6;
  const corals = new THREE.InstancedMesh(coralGeometry, glowMaterial, coralCount);
  const object = new THREE.Object3D();
  let coralIndex = 0;

  for (let index = 0; index < 11; index += 1) {
    const radius = .55 + (index % 4) * .18;
    const x = (index - 5) * .72;
    const y = Math.sin(index * 2.2) * .18;
    const z = Math.cos(index * 1.7) * 1.25;
    object.position.set(x, y, z);
    object.rotation.set(0, 0, 0);
    object.scale.set(radius, radius * (.45 + (index % 3) * .16), radius);
    object.updateMatrix();
    rocks.setMatrixAt(index, object.matrix);

    if (index % 2 === 0) {
      const height = .8 + (index % 3) * .28;
      object.position.set(x, .5 + (index % 3) * .16, z);
      object.rotation.set(0, 0, (index - 5) * .035);
      object.scale.set(1, height, 1);
      object.updateMatrix();
      corals.setMatrixAt(coralIndex, object.matrix);
      coralIndex += 1;
    }
  }
  group.add(rocks, corals);

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


function createDepthMist(count, zNear, zFar, color, size, opacity) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - .5) * 42;
    positions[index * 3 + 1] = -Math.random() * 44 + 3;
    positions[index * 3 + 2] = -(zNear + Math.random() * Math.max(.1, zFar - zNear));
    phases[index] = Math.random() * Math.PI * 2;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  points.userData.basePositions = Float32Array.from(positions);
  return points;
}

function createDepthTerrace(y, z, width, color, accent, quality) {
  const group = new THREE.Group();
  group.position.set(0, y, z);

  const silhouette = new THREE.MeshStandardMaterial({
    color,
    emissive: accent,
    emissiveIntensity: .10,
    roughness: .9,
    metalness: .02,
    transparent: true,
    opacity: .88
  });
  const glow = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: .24,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });

  const rockCount = quality === 'high' ? 15 : quality === 'medium' ? 11 : 7;
  const beaconCount = Math.ceil(rockCount / 3);
  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), silhouette, rockCount);
  const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), glow, beaconCount);
  const object = new THREE.Object3D();
  let beaconIndex = 0;

  for (let index = 0; index < rockCount; index += 1) {
    const normalized = rockCount <= 1 ? 0 : index / (rockCount - 1);
    const x = (normalized - .5) * width;
    const y = Math.sin(index * 1.9) * .34;
    const z = Math.cos(index * 1.37) * 1.9;
    const radius = .8 + (index % 4) * .32;

    object.position.set(x, y, z);
    object.rotation.set(index * .11, index * .27, index * .07);
    object.scale.set(
      radius * (1.2 + (index % 3) * .35),
      radius * (.65 + (index % 5) * .24),
      radius * (.9 + (index % 4) * .22)
    );
    object.updateMatrix();
    rocks.setMatrixAt(index, object.matrix);

    if (index % 3 === 0) {
      const beaconRadius = .10 + (index % 2) * .04;
      object.position.set(x + Math.sin(index) * .35, .75 + (index % 4) * .3, z + .15);
      object.rotation.set(0, 0, 0);
      object.scale.setScalar(beaconRadius);
      object.updateMatrix();
      beacons.setMatrixAt(beaconIndex, object.matrix);
      beaconIndex += 1;
    }
  }
  group.add(rocks, beacons);

  group.userData.baseX = group.position.x;
  group.userData.baseY = group.position.y;
  group.userData.baseZ = group.position.z;
  return group;
}

function createDepthBackdrop(quality) {
  const root = new THREE.Group();
  const far = new THREE.Group();
  const mid = new THREE.Group();
  const near = new THREE.Group();
  root.add(far, mid, near);

  const farMist = createDepthMist(
    quality === 'high' ? 460 : quality === 'medium' ? 240 : 140,
    24, 48, 0x6fd8ff, quality === 'high' ? .055 : .07, .18
  );
  const midMist = createDepthMist(
    quality === 'high' ? 280 : quality === 'medium' ? 150 : 90,
    11, 23, 0x72fff0, quality === 'high' ? .07 : .085, .22
  );
  const nearMist = createDepthMist(
    quality === 'high' ? 110 : quality === 'medium' ? 60 : 36,
    4, 10, 0xc8fbff, quality === 'high' ? .10 : .12, .16
  );
  far.add(farMist);
  mid.add(midMist);
  near.add(nearMist);

  const terraceSpecs = [
    { y: -6.5, z: -30, width: 30, color: 0x052c49, accent: 0x1f6f91 },
    { y: -15.2, z: -34, width: 34, color: 0x04273f, accent: 0x295a8c },
    { y: -24.8, z: -38, width: 38, color: 0x031f34, accent: 0x394c86 },
    { y: -35.4, z: -42, width: 42, color: 0x021726, accent: 0x513e7f }
  ];
  const terraces = terraceSpecs.map(spec =>
    createDepthTerrace(spec.y, spec.z, spec.width, spec.color, spec.accent, quality)
  );
  terraces.forEach(terrace => far.add(terrace));

  const hazeMaterial = new THREE.MeshBasicMaterial({
    color: 0x0a5d7d,
    transparent: true,
    opacity: .055,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const hazePlanes = [];
  [-13, -23, -33].forEach((y, index) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(44, 11), hazeMaterial.clone());
    plane.position.set(0, y, -18 - index * 8);
    plane.material.opacity = .045 + index * .012;
    far.add(plane);
    hazePlanes.push(plane);
  });

  root.userData = { far, mid, near, farMist, midMist, nearMist, terraces, hazePlanes };
  return root;
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

  const quality = qualityForDevice();
  let renderer;
  let rendererError = null;
  const rendererOptions = {
    canvas,
    alpha: true,
    antialias: quality !== 'low',
    powerPreference: quality === 'low' ? 'low-power' : 'high-performance'
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
  stage.dataset.cinematicBatching = 'instanced-v1';

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = quality === 'high';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.3 : 1));

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
  sun.castShadow = quality === 'high';
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
  ice.position.set(-2.2, .18, -.25);
  scene.add(ice);

  const water = createWater();
  scene.add(water);

  const mascot = createMascot();
  mascot.position.set(-2.15, 2.0, .35);
  mascot.rotation.y = 0;
  scene.add(mascot);

  // The uploaded Riley Penguin.blend contains one real 40-frame swim action.
  // We extracted only its authored bone-motion deltas into a tiny same-origin
  // JSON file so the browser can use the real motion now without shipping a
  // .blend file or waiting for the final GLB/FBX pipeline.
  let sourceSwimAction = null;
  fetch('/assets/penguin-swim-action.json?v=20260924-swim-v1', { cache: 'force-cache' })
    .then(response => {
      if (!response.ok) throw new Error(`swim action HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      if (data?.schema !== 'little-feet-penguin-action-v1' || !data?.bones || !data?.mapping) {
        throw new Error('swim action schema mismatch');
      }
      sourceSwimAction = data;
      stage.dataset.swimSource = 'uploaded-riley-action';
    })
    .catch(error => {
      console.warn('Little Feet source swim action unavailable; keeping procedural fallback.', error);
      stage.dataset.swimSource = 'procedural-fallback';
    });

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

  const depthBackdrop = createDepthBackdrop(quality);
  scene.add(depthBackdrop);

  // Layered autonomous sea life. These live entirely inside the cinematic
  // scene and never touch portal data/navigation state.
  const fishPerSchool = quality === 'high' ? 13 : quality === 'medium' ? 8 : 5;
  const fishSchools = [
    createFishSchool(fishPerSchool, 0x62fff4, 0xe8ffff),
    createFishSchool(Math.max(5, fishPerSchool - 2), 0xff76dd, 0xffd7f6),
    createFishSchool(Math.max(5, fishPerSchool - 3), 0xbaff57, 0xf4ffd3),
    createFishSchool(Math.max(4, fishPerSchool - 5), 0x55b9ff, 0xbde9ff)
  ];
  const schoolSpecs = [
    { x: -7.4, y: -6.4, z: -5.8, speed: .72, phase: .2, span: 15 },
    { x:  6.8, y: -13.7, z: -7.2, speed: .54, phase: 2.1, span: 18 },
    { x: -6.2, y: -23.2, z: -6.5, speed: .62, phase: 4.0, span: 17 },
    { x:  5.8, y: -31.0, z: -8.0, speed: .48, phase: 5.4, span: 16 }
  ];
  fishSchools.forEach((school, index) => {
    const spec = schoolSpecs[index];
    school.position.set(spec.x, spec.y, spec.z);
    school.userData.base.copy(school.position);
    school.userData.speed = spec.speed;
    school.userData.phase = spec.phase;
    school.userData.span = spec.span;
    scene.add(school);
  });

  const mantaA = createMantaRay(0x69dcff);
  mantaA.position.set(-10, -11.7, -10);
  mantaA.scale.setScalar(.75);
  mantaA.userData.phase = .4;
  mantaA.userData.speed = .17;
  mantaA.userData.base = mantaA.position.clone();
  scene.add(mantaA);

  const mantaB = createMantaRay(0xa16dff);
  mantaB.position.set(9.5, -27.2, -11.5);
  mantaB.scale.setScalar(.54);
  mantaB.userData.phase = 3.3;
  mantaB.userData.speed = -.13;
  mantaB.userData.base = mantaB.position.clone();
  if (quality !== 'low') scene.add(mantaB);

  const kelpA = createKelpPatch(quality === 'high' ? 16 : quality === 'medium' ? 10 : 6, 0x38ffc4);
  kelpA.position.set(-5.5, -37.7, -5.8);
  scene.add(kelpA);
  const kelpB = createKelpPatch(quality === 'high' ? 13 : quality === 'medium' ? 8 : 5, 0x6ad8ff);
  kelpB.position.set(5.6, -37.6, -7.4);
  kelpB.scale.setScalar(.86);
  scene.add(kelpB);

  const reefA = createGlowReef(0x55fff2, 0x1768ff);
  reefA.position.set(-5.4, -37.8, -5.8);
  scene.add(reefA);
  const reefB = createGlowReef(0xff75df, 0x684cff);
  reefB.position.set(5.7, -37.85, -7.7);
  reefB.scale.setScalar(.82);
  scene.add(reefB);

  const extraJellies = [];
  if (quality !== 'low') {
    const jellyD = createJellyfish(0x62d9ff, 0x3477ff);
    jellyD.position.set(-7.4, -12.4, -7.5);
    jellyD.scale.setScalar(.48);
    scene.add(jellyD);
    extraJellies.push(jellyD);

    const jellyE = createJellyfish(0xffa7ed, 0x993cff);
    jellyE.position.set(7.2, -25.7, -6.8);
    jellyE.scale.setScalar(.58);
    scene.add(jellyE);
    extraJellies.push(jellyE);

    if (quality === 'high') {
      const jellyF = createJellyfish(0xbfff79, 0x2cfcc0);
      jellyF.position.set(-1.8, -33.1, -9.2);
      jellyF.scale.setScalar(.43);
      scene.add(jellyF);
      extraJellies.push(jellyF);
    }
  }

  const causticBeams = createCausticBeams(quality === 'high' ? 5 : quality === 'medium' ? 4 : 3);
  scene.add(causticBeams);

  const clock = new THREE.Clock();
  const pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0, activity: 0, lastX: 0, lastY: 0 };
  let scrollProgress = 0;
  let smoothProgress = 0;
  let previousRawProgress = 0;
  let scrollMotion = 0;
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

  const portalSoundMuted = () => {
    if (typeof window.isPortalAudioMuted === 'function') return window.isPortalAudioMuted();
    try { return localStorage.getItem('lf_portal_audio_muted_last') === 'true'; }
    catch { return false; }
  };

  const portalIntroThemePlaying = () => {
    try {
      return typeof window.isPortalIntroThemePlaying === 'function'
        ? window.isPortalIntroThemePlaying()
        : false;
    } catch {
      return false;
    }
  };

  const stopPortalIntroTheme = () => {
    try {
      if (typeof window.stopPortalIntroTheme === 'function') window.stopPortalIntroTheme();
    } catch { /* Intro handoff is optional. */ }
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
    const muted = portalSoundMuted() || portalIntroThemePlaying() || !audible || document.hidden;
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

  const scheduleNextMascotChirp = (nowMs = performance.now(), progress = smoothProgress) => {
    const underwater = progress > .28;
    const minGap = underwater ? 7600 : 4800;
    const variation = underwater ? 7600 : 6200;
    nextMascotChirpAt = nowMs + minGap + Math.random() * variation;
  };

  const playMascotChirp = (variant = 0) => {
    if (!mascotSoundUnlocked || portalSoundMuted() || portalIntroThemePlaying() || document.hidden) return false;
    const nowMs = performance.now();
    if (nowMs - lastMascotChirpAt < 900) return false;

    const ctx = portalContext();
    if (!ctx || ctx.state !== 'running') return false;

    const patterns = [
      [760, 1040, 880],
      [690, 930, 1180, 980],
      [860, 720, 970],
      [820, 1080],
      [710, 860, 760, 1020, 890]
    ];
    const tones = patterns[variant % patterns.length];
    const beatTimeline = [];
    let finalEnd = 0;

    try {
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.105, ctx.currentTime + .012);
      master.connect(ctx.destination);

      tones.forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const harmonic = ctx.createOscillator();
        const gain = ctx.createGain();
        const harmonicGain = ctx.createGain();
        const offset = index * .092;
        const start = ctx.currentTime + offset;
        const length = .105 + (index % 2) * .028;
        const end = offset + length;
        finalEnd = Math.max(finalEnd, end);
        beatTimeline.push({
          startMs: nowMs + offset * 1000,
          peakMs: nowMs + (offset + .025) * 1000,
          endMs: nowMs + end * 1000
        });

        osc.type = 'triangle';
        harmonic.type = 'sine';
        osc.frequency.setValueAtTime(frequency * .94, start);
        osc.frequency.exponentialRampToValueAtTime(frequency * 1.07, start + length);
        harmonic.frequency.setValueAtTime(frequency * 2.02, start);

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(.82, start + .01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
        harmonicGain.gain.setValueAtTime(0.0001, start);
        harmonicGain.gain.exponentialRampToValueAtTime(.14, start + .012);
        harmonicGain.gain.exponentialRampToValueAtTime(0.0001, start + length * .9);

        osc.connect(gain); gain.connect(master);
        harmonic.connect(harmonicGain); harmonicGain.connect(master);
        osc.start(start); harmonic.start(start);
        osc.stop(start + length + .02); harmonic.stop(start + length + .02);
      });

      master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + finalEnd + .07);
      lastMascotChirpAt = nowMs;
      mascotChirpTimeline = beatTimeline;
      mascotChirpUntil = nowMs + (finalEnd + .08) * 1000;
      scheduleNextMascotChirp(nowMs, smoothProgress);
      return true;
    } catch {
      mascotChirpTimeline = [];
      mascotChirpUntil = 0;
      return false;
    }
  };

  const playWaterSplash = () => {
    if (!mascotSoundUnlocked || portalSoundMuted() || portalIntroThemePlaying() || document.hidden) return;
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
      }).catch(() => {});
    } else if (mascotSoundUnlocked) {
      ensureCinematicAudio();
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

  window.addEventListener('littlefeet:introthemechange', event => {
    const active = Boolean(event.detail?.active);
    if (!active) unlockMascotSound();
    setCinematicAudioMix(
      smoothProgress > .225 ? 1 : 0,
      !active && !portalSoundMuted() && journey.classList.contains('is-active')
    );
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
    if (raw > .012 && portalIntroThemePlaying()) stopPortalIntroTheme();
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

  let waterUpdateCount = 0;
  const updateWater = (time, refreshNormals = false) => {
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
    waterUpdateCount += 1;
    // Vertex-normal recomputation is one of the most expensive CPU steps in this
    // scene. The waves are deliberately shallow, so refreshing roughly twice per
    // second keeps the lighting alive without burning a full CPU pass every few
    // frames on integrated GPUs.
    if (refreshNormals || waterUpdateCount % 30 === 0) water.geometry.computeVertexNormals();
  };

  const sampleSourceSwimBone = (boneName, cycle) => {
    const action = sourceSwimAction;
    const keys = action?.bones?.[boneName]?.rotationDeltaEulerXYZ;
    if (!Array.isArray(keys) || keys.length < 2) return [0, 0, 0];

    const frameStart = Number(action.source?.frameStart ?? 0);
    const frameEnd = Number(action.source?.frameEnd ?? 40);
    const span = Math.max(1, frameEnd - frameStart);
    const wrapped = ((cycle % 1) + 1) % 1;
    const frame = frameStart + wrapped * span;

    for (let index = 0; index < keys.length - 1; index += 1) {
      const from = keys[index];
      const to = keys[index + 1];
      if (frame > to.frame) continue;
      const local = smoothstep(from.frame, to.frame, frame);
      return [
        lerp(from.euler[0], to.euler[0], local),
        lerp(from.euler[1], to.euler[1], local),
        lerp(from.euler[2], to.euler[2], local)
      ];
    }
    return keys[keys.length - 1].euler.slice(0, 3);
  };

  const animateBubbleField = (points, time, speedMultiplier = 1) => {
    const attr = points.geometry.attributes.position;
    const seeds = points.geometry.attributes.seed;
    const base = points.userData.basePositions;
    const depth = Math.max(.1, points.userData.depth || 1);
    const rise = points.userData.riseSpeed * speedMultiplier;
    for (let index = 0; index < attr.count; index += 1) {
      const offset = index * 3;
      const seed = seeds.array[index];
      const cycle = (seed + time * rise * .035) % 1;
      attr.array[offset] = base[offset] + Math.sin(time * .55 + seed * 12) * .035;
      attr.array[offset + 1] = -cycle * depth;
      attr.array[offset + 2] = base[offset + 2] + Math.cos(time * .47 + seed * 10) * .035;
    }
    attr.needsUpdate = true;
  };

  const animateMascot = (progress, time, dt) => {
    const data = mascot.userData;
    const path = sampleDivePath(progress);
    const motion = samplePathMotion(progress);
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

    const sourceMap = sourceSwimAction?.mapping;
    const sourceBlend = sourceSwimAction
      ? clamp(propulsion * (1 - streamline) * (1 - stationHold * .92) * 1.12, 0, 1)
      : 0;
    const sourceBodyLower = sourceMap ? sampleSourceSwimBone(sourceMap.bodyLower, strokeCycle) : [0, 0, 0];
    const sourceBodyUpper = sourceMap ? sampleSourceSwimBone(sourceMap.bodyUpper, strokeCycle) : [0, 0, 0];
    const sourceChest = sourceMap ? sampleSourceSwimBone(sourceMap.chestHead, strokeCycle) : [0, 0, 0];
    const sourceRightRoot = sourceMap ? sampleSourceSwimBone(sourceMap.rightFlipperRoot, strokeCycle) : [0, 0, 0];
    const sourceRightTip = sourceMap ? sampleSourceSwimBone(sourceMap.rightFlipperTip, strokeCycle) : [0, 0, 0];
    const sourceLeftRoot = sourceMap ? sampleSourceSwimBone(sourceMap.leftFlipperRoot, strokeCycle) : [0, 0, 0];
    const sourceLeftTip = sourceMap ? sampleSourceSwimBone(sourceMap.leftFlipperTip, strokeCycle) : [0, 0, 0];
    const sourceUpperRight = sourceMap ? sampleSourceSwimBone(sourceMap.upperRight, strokeCycle) : [0, 0, 0];
    const sourceUpperLeft = sourceMap ? sampleSourceSwimBone(sourceMap.upperLeft, strokeCycle) : [0, 0, 0];
    const idleBreath = Math.sin(time * 2.05);
    const stationBob = stationHold * Math.sin(time * 1.38 + stationPose.index) * .045;
    const idleBob = surface * Math.sin(time * 1.55) * .035;
    const pathBob = propulsion * Math.sin(swimPhase * .55) * (.05 + effort * .10);

    mascot.position.set(
      path.x,
      path.y + idleBob + stationBob + pathBob - anticipation * .17,
      path.z
    );

    // Directional body steering. While travelling the torso points into the
    // actual path; when the user settles on a tab station the penguin brakes,
    // rotates upright and presents itself to the viewer.
    const travelHeading = Math.atan2(-motion.dx, motion.dy);
    const entryHeading = lerp(-.55, -2.12, smoothstep(.16, .245, progress));
    const headingBlend = clamp(airborne + waterEntry + propulsion * .85, 0, 1);
    const swimPitch = lerp(path.pitch, motion.pitch, .56) + glideWave * effort * .025;
    const swimYaw = motion.yaw * .72 + Math.sin(progress * Math.PI * 4) * propulsion * .055;
    const swimRoll = lerp(path.roll, travelHeading, headingBlend) + motion.bank * .26 + glideWave * effort * .035;
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
        + sourceBlend * (sourceBodyUpper[0] * .42 + sourceChest[0] * .22),
      9,
      dt
    );
    data.chestRig.rotation.y = damp(
      data.chestRig.rotation.y,
      pointer.smoothX * (.18 * surface + .11 * stationHold) + motion.yaw * propulsion * .12,
      6.6,
      dt
    );
    data.chestRig.rotation.z = damp(
      data.chestRig.rotation.z,
      chestCounterRoll + effort * recovery * .035,
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

    // Preserve the Little Feet mascot mesh, but let the uploaded Riley action
    // drive the torso with its authored body wave instead of only influencing
    // the shoulders. When the source action is unavailable these damp to zero.
    const authoredBodyPitch = sourceBlend * (sourceBodyLower[0] * .26 + sourceBodyUpper[0] * .34);
    const authoredBodyYaw = sourceBlend * (sourceBodyLower[1] * .24 + sourceChest[1] * .20);
    const authoredBodyRoll = sourceBlend * (sourceBodyLower[2] * .34 + sourceChest[2] * .26);
    data.body.rotation.x = damp(data.body.rotation.x, authoredBodyPitch, 9.5, dt);
    data.body.rotation.y = damp(data.body.rotation.y, authoredBodyYaw, 9.5, dt);
    data.body.rotation.z = damp(data.body.rotation.z, authoredBodyRoll, 9.5, dt);
    data.belly.rotation.x = damp(data.belly.rotation.x, authoredBodyPitch * .72, 9, dt);
    data.belly.rotation.y = damp(data.belly.rotation.y, authoredBodyYaw * .62, 9, dt);
    data.belly.rotation.z = damp(data.belly.rotation.z, authoredBodyRoll * .72, 9, dt);

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
    const authoredLeftZ = sourceBlend * (sourceLeftRoot[0] * .52 + sourceLeftTip[2] * .16);
    const authoredRightZ = sourceBlend * (-sourceRightRoot[0] * .52 + sourceRightTip[2] * .16);
    const authoredLeftSweep = sourceBlend * (-sourceLeftRoot[0] * .50 + Math.abs(sourceLeftTip[0]) * .10);
    const authoredRightSweep = sourceBlend * (-sourceRightRoot[0] * .50 + Math.abs(sourceRightTip[0]) * .10);
    const leftTargetZ = lerp(lerp(neutralL - anticipation * .26, leftSwimZ, propulsion), entryTuckL, streamline) + authoredLeftZ;
    const rightTargetZ = lerp(lerp(neutralR + anticipation * .26, rightSwimZ, propulsion), entryTuckR, streamline) + authoredRightZ;
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
        + streamline * .42 + preen * .92 + authoredLeftSweep,
      11.5,
      dt
    );
    data.rightFlipper.rotation.x = damp(
      data.rightFlipper.rotation.x,
      lerp(-.10 + anticipation * .34 + launch * .16, shoulderSweep, propulsion)
        + streamline * .42 + authoredRightSweep,
      11.5,
      dt
    );
    data.leftFlipper.rotation.y = damp(
      data.leftFlipper.rotation.y,
      propulsion * (.16 + motion.yaw * .24) + sourceBlend * sourceLeftRoot[1] * .24,
      9,
      dt
    );
    data.rightFlipper.rotation.y = damp(
      data.rightFlipper.rotation.y,
      propulsion * (-.16 + motion.yaw * .24) + sourceBlend * sourceRightRoot[1] * .24,
      9,
      dt
    );

    // The uploaded rig has a second animated flipper segment on each side.
    // Map those authored tip rotations onto the visible capsule children so the
    // stroke bends through the whole flipper instead of pivoting at one joint.
    data.leftFlipperMesh.rotation.x = damp(data.leftFlipperMesh.rotation.x, sourceBlend * sourceLeftTip[0] * .88, 12.5, dt);
    data.leftFlipperMesh.rotation.y = damp(data.leftFlipperMesh.rotation.y, sourceBlend * sourceLeftTip[1] * .78, 12.5, dt);
    data.leftFlipperMesh.rotation.z = damp(data.leftFlipperMesh.rotation.z, sourceBlend * sourceLeftTip[2] * .90, 12.5, dt);
    data.rightFlipperMesh.rotation.x = damp(data.rightFlipperMesh.rotation.x, sourceBlend * sourceRightTip[0] * .88, 12.5, dt);
    data.rightFlipperMesh.rotation.y = damp(data.rightFlipperMesh.rotation.y, sourceBlend * sourceRightTip[1] * .78, 12.5, dt);
    data.rightFlipperMesh.rotation.z = damp(data.rightFlipperMesh.rotation.z, sourceBlend * sourceRightTip[2] * .90, 12.5, dt);

    // Feet tuck against the body at speed and act as rudders during a turn,
    // matching real penguin steering behaviour rather than kicking constantly.
    const feetTuck = propulsion * (.40 + effort * .16) + streamline * .46;
    const launchKick = launch * -.28;
    const rudder = motion.yaw * propulsion;
    data.footL.rotation.x = damp(
      data.footL.rotation.x,
      launchKick + feetTuck + powerStroke * effort * .10 + sourceBlend * sourceUpperLeft[0] * .34,
      9.5,
      dt
    );
    data.footR.rotation.x = damp(
      data.footR.rotation.x,
      launchKick + feetTuck + powerStroke * effort * .10 + sourceBlend * sourceUpperRight[0] * .34,
      9.5,
      dt
    );
    data.footL.rotation.y = damp(data.footL.rotation.y, rudder * .48 + sourceBlend * sourceUpperLeft[1] * .24, 8, dt);
    data.footR.rotation.y = damp(data.footR.rotation.y, rudder * .48 + sourceBlend * sourceUpperRight[1] * .24, 8, dt);
    data.footL.rotation.z = damp(
      data.footL.rotation.z,
      surface * Math.sin(time * 1.2) * .035 + sourceBlend * sourceUpperLeft[2] * .28,
      7,
      dt
    );
    data.footR.rotation.z = damp(
      data.footR.rotation.z,
      -surface * Math.sin(time * 1.2) * .035 + sourceBlend * sourceUpperRight[2] * .28,
      7,
      dt
    );

    data.tailRig.rotation.y = damp(data.tailRig.rotation.y, -rudder * .62, 8.5, dt);
    data.tailRig.rotation.x = damp(
      data.tailRig.rotation.x,
      propulsion * recovery * .10 + sourceBlend * sourceBodyLower[0] * .34,
      7.5,
      dt
    );
    data.tailRig.rotation.z = damp(data.tailRig.rotation.z, motion.bank * -.32 * propulsion, 7.5, dt);

    // Cursor obsession: eyes lead, head follows, chest follows last. The head
    // also counter-rotates against the swimming body so the gaze stays visually
    // locked on the cursor even during banks and turns.
    const diveFocus = clamp(airborne + waterEntry + streamline * .85, 0, 1);
    const gazeBoost = .92 + stationHold * .20 + surface * .12;
    const requestedYaw = lerp(pointer.smoothX * 1.02 * gazeBoost - mascot.rotation.y * .38, 0, diveFocus);
    const requestedPitch = lerp(-pointer.smoothY * .68 * gazeBoost - mascot.rotation.x * .10, -.10, diveFocus);
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
    fishSchools.forEach((school, schoolIndex) => {
      const data = school.userData;
      const wave = time * data.speed + data.phase;
      const direction = Math.cos(wave) >= 0 ? 1 : -1;
      school.position.x = data.base.x + Math.sin(wave) * data.span * .55;
      school.position.y = data.base.y + Math.sin(wave * .43 + schoolIndex) * .52;
      school.position.z = data.base.z + Math.cos(wave * .62) * 1.15;

      // Schools react to the mascot instead of behaving like looping wallpaper.
      const avoidX = school.position.x - mascot.position.x;
      const avoidY = school.position.y - mascot.position.y;
      const avoidZ = school.position.z - mascot.position.z;
      const avoidDistance = Math.max(.001, Math.hypot(avoidX, avoidY, avoidZ));
      const panicTarget = 1 - smoothstep(3.0, 7.0, avoidDistance);
      data.panic = damp(data.panic || 0, panicTarget, 5.5, dt);
      if (data.panic > .001) {
        const force = data.panic * 1.25;
        school.position.x += (avoidX / avoidDistance) * force;
        school.position.y += (avoidY / avoidDistance) * force * .42;
        school.position.z += (avoidZ / avoidDistance) * force * .55;
      }

      school.rotation.y = damp(school.rotation.y, direction > 0 ? 0 : Math.PI, 3.4 + data.panic * 5, dt);
      const matrixObject = data.matrixObject;
      data.fish.forEach((fishData, fishIndex) => {
        const flutter = time * ((5.2 + data.panic * 5.8) * fishData.speed) + fishData.phase;
        fishData.position.set(
          fishData.base.x + Math.sin(flutter * .31) * (.10 + data.panic * .14),
          fishData.base.y + Math.sin(flutter) * (.06 + data.panic * .11),
          fishData.base.z + Math.cos(flutter * .67) * (.08 + data.panic * .12)
        );
        fishData.rotationZ = Math.sin(flutter) * (.08 + data.panic * .12);
        fishData.rotationY = Math.sin(flutter * .52) * (.05 + data.panic * .08);

        matrixObject.position.copy(fishData.position);
        matrixObject.rotation.set(0, fishData.rotationY, fishData.rotationZ);
        matrixObject.scale.set(1.85 * fishData.size, .66 * fishData.size, .62 * fishData.size);
        matrixObject.updateMatrix();
        data.bodies.setMatrixAt(fishIndex, matrixObject.matrix);

        matrixObject.position.set(
          fishData.position.x - .34 * Math.cos(fishData.rotationY) * fishData.size,
          fishData.position.y,
          fishData.position.z + .34 * Math.sin(fishData.rotationY) * fishData.size
        );
        matrixObject.rotation.set(0, fishData.rotationY, Math.PI / 2 + fishData.rotationZ);
        matrixObject.scale.set(.95 * fishData.size, fishData.size, .7 * fishData.size);
        matrixObject.updateMatrix();
        data.tails.setMatrixAt(fishIndex, matrixObject.matrix);
      });
      data.bodies.instanceMatrix.needsUpdate = true;
      data.tails.instanceMatrix.needsUpdate = true;
    });

    [mantaA, mantaB].forEach((manta, index) => {
      if (!manta.parent) return;
      const data = manta.userData;
      const phase = time * Math.abs(data.speed) + data.phase;
      const direction = data.speed >= 0 ? 1 : -1;
      manta.position.x = data.base.x + Math.sin(phase) * 10.5;
      manta.position.y = data.base.y + Math.sin(phase * .48 + index) * .75;
      manta.position.z = data.base.z + Math.cos(phase * .36) * 1.4;
      manta.rotation.y = direction > 0 ? 0 : Math.PI;
      const wingBeat = Math.sin(time * 1.65 + index);
      data.wingL.rotation.z = wingBeat * .18;
      data.wingR.rotation.z = -wingBeat * .18;
      manta.rotation.z = Math.sin(phase * .55) * .06;
    });

    [kelpA, kelpB].forEach((patch, patchIndex) => {
      patch.userData.fronds.forEach((frond, index) => {
        frond.rotation.z = Math.sin(time * .72 + frond.userData.phase + patchIndex) * (.045 + (index % 3) * .01);
        frond.rotation.x = Math.cos(time * .54 + frond.userData.phase) * .018;
      });
    });

    [reefA, reefB].forEach((reef, index) => {
      reef.userData.light.intensity = reef.userData.baseIntensity * (1 + Math.sin(time * 1.15 + index * 1.9) * .24);
      reef.scale.y = 1 + Math.sin(time * .72 + index) * .018;
    });

    const allJellies = [jellyA, jellyB, jellyC, ...extraJellies];
    allJellies.forEach((jelly, index) => {
      if (!jelly.userData.basePosition) jelly.userData.basePosition = jelly.position.clone();
      const base = jelly.userData.basePosition;
      jelly.rotation.y = time * (.07 + index * .018) + index;
      jelly.position.x = base.x + Math.sin(time * .48 + index * 1.7) * (.22 + index * .015);
      jelly.position.y = base.y + Math.sin(time * .62 + index) * .18;
      const pulse = 1 + Math.sin(time * 1.45 + index) * .065;
      jelly.userData.bell.scale.set(pulse, .72 / pulse, pulse);
    });

    causticBeams.userData.beams.forEach((beam, index) => {
      beam.rotation.z = -.16 + index * .08 + Math.sin(time * .23 + beam.userData.phase) * .055;
      beam.material.opacity = .032 + index * .006 + Math.sin(time * .65 + index) * .008;
    });

    // Depth is reinforced by three independent parallax planes. Near particles
    // respond most to camera/pointer motion, while the far reef barely moves.
    const depthData = depthBackdrop.userData;
    depthData.far.position.x = pointer.smoothX * .22;
    depthData.far.position.y = pointer.smoothY * .10;
    depthData.mid.position.x = pointer.smoothX * .52;
    depthData.mid.position.y = pointer.smoothY * .20;
    depthData.near.position.x = pointer.smoothX * .92;
    depthData.near.position.y = pointer.smoothY * .34;

    // Keep the depth mist alive without rewriting hundreds of particle vertices
    // every update. Moving each particle layer as a whole preserves parallax and
    // drift while leaving the static GPU buffers untouched.
    [depthData.farMist, depthData.midMist, depthData.nearMist].forEach((mist, layerIndex) => {
      const drift = [.035, .065, .11][layerIndex];
      const phase = layerIndex * 1.73;
      mist.position.x = Math.sin(time * drift + phase) * (.18 + layerIndex * .12);
      mist.position.y = Math.cos(time * drift * .72 + phase) * (.10 + layerIndex * .08);
      mist.rotation.z = Math.sin(time * drift * .42 + phase) * (.0015 + layerIndex * .0012);
    });

    rings.forEach((ring, index) => {
      const distance = Math.abs(progress - stations[Math.min(index + 2, stations.length - 1)].at);
      const proximity = 1 - smoothstep(.03, .15, distance);
      ring.rotation.z = time * (.05 + index * .012);
      const pulse = 1 + Math.sin(time * 1.55 + index * .8) * .035 + proximity * .08;
      ring.scale.setScalar(pulse);
    });
  };

  let waterBudget = 0;
  let worldBudget = 0;
  let bubbleBudget = 0;
  const waterInterval = quality === 'high' ? 1 / 18 : quality === 'medium' ? 1 / 12 : 1 / 10;
  const worldInterval = quality === 'high' ? 1 / 30 : quality === 'medium' ? 1 / 20 : 1 / 15;
  const bubbleInterval = quality === 'high' ? 1 / 24 : quality === 'medium' ? 1 / 16 : 1 / 12;

  const updateScene = (dt, time) => {
    waterBudget += dt;
    worldBudget += dt;
    bubbleBudget += dt;
    const rawMotion = Math.abs(scrollProgress - previousRawProgress) / Math.max(.001, dt);
    scrollMotion = damp(scrollMotion, clamp(rawMotion * .55, 0, 1), 7.5, dt);
    previousRawProgress = scrollProgress;

    smoothProgress = damp(smoothProgress, scrollProgress, 7.2, dt);
    pointer.smoothX = damp(pointer.smoothX, pointer.x, 13.5, dt);
    pointer.smoothY = damp(pointer.smoothY, pointer.y, 13.5, dt);
    pointer.activity = damp(pointer.activity, 0, 2.6, dt);

    animateMascot(smoothProgress, time, dt);

    // Decouple expensive environment animation from the mascot/camera render.
    // The hero motion can stay responsive while background simulation runs at a
    // lower, fixed cadence that is much kinder to integrated GPUs and work PCs.
    if (waterBudget >= waterInterval) {
      updateWater(time);
      waterBudget %= waterInterval;
    }
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
      !portalSoundMuted() &&
      !portalIntroThemePlaying()
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
    scene.fog.density = lerp(.008, .034, submerged) + deepening * .006;
    scene.fog.color.setRGB(
      lerp(.02, .004, deepening),
      lerp(.18, .035, deepening),
      lerp(.30, .10, deepening)
    );
    renderer.setClearColor(new THREE.Color().setRGB(
      lerp(.21, .005, submerged),
      lerp(.72, .075, submerged),
      lerp(.93, .15, submerged)
    ), 1);

    if (bubbleBudget >= bubbleInterval) {
      animateBubbleField(bubbles, time, 1);
      animateBubbleField(dust, time, .34);
      animateBubbleField(mascotTrail, time, 1.8);
      bubbles.rotation.y = time * .018;
      dust.rotation.y = -time * .012;
      bubbleBudget %= bubbleInterval;
    }
    bubbles.material.opacity = lerp(.34, .54, submerged);
    dust.material.opacity = .16 + Math.sin(time * .7) * .035;

    ice.visible = smoothProgress < .42;
    water.material.opacity = lerp(.58, .23, submerged);
    cyanLight.intensity = lerp(6, 14, submerged) + splash * 3.5;
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
