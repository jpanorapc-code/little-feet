
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
const SCENE_DETAIL = 'medium';

const sharedGeometry = {};
const getSharedGeometry = (key, factory) => {
  if (!sharedGeometry[key]) sharedGeometry[key] = factory();
  return sharedGeometry[key];
};

function createMicroReliefTexture(kind = 'feather') {
  const size = kind === 'ice' ? 128 : 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;

  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const grain =
        Math.sin(x * .73 + y * .19) * .38 +
        Math.cos(x * .17 - y * .91) * .31 +
        Math.sin((x + y) * .41) * .19;
      const streak = kind === 'feather'
        ? Math.sin((x * .42) + (y * 1.12)) * .16
        : Math.sin(x * .13 + y * .07) * .10;
      const value = Math.round(clamp(.54 + grain * .17 + streak, .18, .88) * 255);
      image.data[index] = value;
      image.data[index + 1] = value;
      image.data[index + 2] = value;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  if (kind === 'ice') {
    context.strokeStyle = 'rgba(245,255,255,.22)';
    context.lineWidth = 1;
    for (let line = 0; line < 11; line += 1) {
      const y = (line * 17 + 9) % size;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, (y + 15 + line * 3) % size);
      context.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (kind === 'water') texture.repeat.set(7.5, 7.5);
  else texture.repeat.set(kind === 'ice' ? 3.5 : 6.5, kind === 'ice' ? 3.5 : 8.5);
  texture.needsUpdate = true;
  return texture;
}

const FISH_SPRITE_SRC = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/38/Alosa_alosa.png/330px-Alosa_alosa.png';

const fishSchoolLayouts = [
  [
    [3, 34, 88, .72, -4, .92, 0.0],
    [15, 18, 112, .84, 2, .84, -.6],
    [28, 42, 76, .64, -2, .76, -1.1],
    [39, 12, 126, .90, 4, .90, -1.8],
    [51, 32, 98, .78, -3, .82, -2.4],
    [63, 8, 118, .86, 3, .88, -3.0],
    [74, 43, 82, .68, -4, .74, -3.7],
    [84, 20, 106, .81, 1, .86, -4.3],
    [22, 62, 96, .75, 3, .80, -4.9],
    [44, 67, 74, .62, -2, .70, -5.5],
    [66, 63, 104, .79, 2, .82, -6.1],
    [89, 57, 68, .58, -3, .68, -6.7]
  ],
  [
    [4, 28, 78, .66, 3, .70, -1.0],
    [18, 52, 108, .82, -2, .82, -1.7],
    [31, 20, 90, .72, 4, .76, -2.4],
    [45, 44, 124, .88, -3, .88, -3.1],
    [60, 16, 84, .68, 2, .72, -3.8],
    [73, 50, 102, .78, -4, .80, -4.5],
    [86, 27, 72, .60, 3, .66, -5.2],
    [25, 73, 82, .67, -1, .70, -5.9],
    [54, 70, 96, .74, 2, .76, -6.6],
    [79, 72, 70, .58, -2, .64, -7.3]
  ]
];

function populateFishSchools(root = document) {
  const schools = [...root.querySelectorAll('.cinematic-fish-2d')];
  schools.forEach((school, schoolIndex) => {
    if (school.dataset.fishPopulated === 'true') return;
    const layout = fishSchoolLayouts[schoolIndex] || fishSchoolLayouts[0];

    layout.forEach(([x, y, width, scale, tilt, opacity, delay], fishIndex) => {
      const fish = document.createElement('img');
      fish.className = 'cinematic-fish-sprite';
      fish.src = FISH_SPRITE_SRC;
      fish.alt = '';
      fish.setAttribute('aria-hidden', 'true');
      fish.decoding = 'async';
      fish.loading = 'lazy';
      fish.draggable = false;
      fish.style.setProperty('--fish-x', x + '%');
      fish.style.setProperty('--fish-y', y + '%');
      fish.style.setProperty('--fish-width', width + 'px');
      fish.style.setProperty('--fish-scale', String(scale));
      fish.style.setProperty('--fish-tilt', tilt + 'deg');
      fish.style.setProperty('--fish-opacity', String(opacity));
      fish.style.setProperty('--fish-delay', delay + 's');
      fish.style.setProperty('--fish-phase', String(fishIndex % 4));
      school.appendChild(fish);
    });

    school.dataset.fishPopulated = 'true';
  });
}

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

function addFeatherVertexColors(geometry, light = 0x2389c6, dark = 0x0a4b78, variation = .10) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const lightColor = new THREE.Color(light);
  const darkColor = new THREE.Color(dark);
  const color = new THREE.Color();

  for (let index = 0; index < pos.count; index += 1) {
    const x = pos.getX(index);
    const y = pos.getY(index);
    const z = pos.getZ(index);
    const grain =
      Math.sin(x * 13.7 + y * 7.1) * .42 +
      Math.cos(z * 17.3 - y * 11.9) * .34 +
      Math.sin((x + z) * 23.1) * .24;
    const t = clamp(.50 + grain * variation, .08, .92);
    color.copy(darkColor).lerp(lightColor, t);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function createPearBodyGeometry() {
  const profile = [
    new THREE.Vector2(.30, -1.04),
    new THREE.Vector2(.58, -.94),
    new THREE.Vector2(.77, -.70),
    new THREE.Vector2(.88, -.38),
    new THREE.Vector2(.91, -.06),
    new THREE.Vector2(.86, .28),
    new THREE.Vector2(.76, .58),
    new THREE.Vector2(.62, .82),
    new THREE.Vector2(.44, .98)
  ];
  const geometry = new THREE.LatheGeometry(profile, 40);
  geometry.scale(1, 1.08, .88);
  geometry.computeVertexNormals();
  return addFeatherVertexColors(geometry, 0x278fca, 0x0b4e7d, .15);
}

function createFlipperGeometry() {
  const geometry = new THREE.SphereGeometry(.48, 24, 18);
  const attr = geometry.attributes.position;
  for (let i = 0; i < attr.count; i += 1) {
    let x = attr.getX(i);
    let y = attr.getY(i);
    let z = attr.getZ(i);
    const taper = 1 - Math.max(-.4, y) * .30;
    x *= .48 * taper;
    y *= 1.16;
    z *= .30;
    x += Math.sign(x || 1) * Math.max(0, -.15 - y) * .08;
    attr.setXYZ(i, x, y, z);
  }
  attr.needsUpdate = true;
  geometry.computeVertexNormals();
  return addFeatherVertexColors(geometry, 0x176fa8, 0x06375f, .12);
}

function createWebbedFootGeometry() {
  // Three overlapping flattened toes read much closer to the reference than
  // the old orange oval while staying extremely cheap.
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0xf3a31f, roughness: .70, metalness: 0
  });
  [-.20, 0, .20].forEach((x, index) => {
    const toe = new THREE.Mesh(new THREE.SphereGeometry(.22, 16, 10), material);
    toe.scale.set(index === 1 ? 1.20 : 1.0, .24, index === 1 ? .92 : .82);
    toe.position.set(x, 0, index === 1 ? .05 : 0);
    toe.rotation.z = x * -.28;
    group.add(toe);
  });
  return group;
}

function createMascot() {
  const group = new THREE.Group();
  group.name = 'LittleFeetMascotV3';
  const featherRelief = createMicroReliefTexture('feather');

  const featherBlue = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: .88,
    roughnessMap: featherRelief,
    bumpMap: featherRelief,
    bumpScale: .020,
    metalness: 0
  });
  const featherDark = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: .90,
    roughnessMap: featherRelief,
    bumpMap: featherRelief,
    bumpScale: .018,
    metalness: 0
  });
  const white = new THREE.MeshStandardMaterial({
    color: 0xf6fbfc,
    roughness: .92,
    roughnessMap: featherRelief,
    bumpMap: featherRelief,
    bumpScale: .013,
    metalness: 0
  });
  const orange = new THREE.MeshStandardMaterial({
    color: 0xf3a31f,
    roughness: .70,
    metalness: 0
  });
  const orangeDark = new THREE.MeshStandardMaterial({
    color: 0xc76a10,
    roughness: .74,
    metalness: 0
  });
  const frame = new THREE.MeshStandardMaterial({
    color: 0x112d43,
    roughness: .32,
    metalness: .08
  });
  const lens = new THREE.MeshBasicMaterial({
    color: 0xc9f5ff,
    transparent: true,
    opacity: .12,
    depthWrite: false
  });
  const black = new THREE.MeshStandardMaterial({
    color: 0x020507,
    roughness: .28
  });

  // Chunky reference silhouette: short pear body, broad lower belly.
  const body = new THREE.Mesh(createPearBodyGeometry(), featherBlue);
  body.scale.set(1.02, 1.04, 1.0);
  body.position.y = -.18;
  group.add(body);

  // Large white belly inset into the front, not a second separate torso.
  const belly = new THREE.Mesh(new THREE.SphereGeometry(.78, 30, 22), white);
  belly.scale.set(.86, 1.02, .26);
  belly.position.set(0, -.30, .79);
  group.add(belly);

  const chestRig = new THREE.Bone();
  chestRig.name = 'ChestBone';
  chestRig.position.set(0, .12, 0);
  group.add(chestRig);

  // Head sinks into the shoulders like the Meshy reference: no visible neck.
  const headRig = new THREE.Bone();
  headRig.name = 'HeadBone';
  headRig.position.set(0, .76, .03);
  chestRig.add(headRig);

  const headGeometry = new THREE.SphereGeometry(.82, 34, 26);
  headGeometry.scale(1.03, .96, .94);
  addFeatherVertexColors(headGeometry, 0x176fa8, 0x052f58, .16);
  const head = new THREE.Mesh(headGeometry, featherDark);
  headRig.add(head);

  // Broad heart/cheek mask from the video model.
  const facePatch = new THREE.Mesh(new THREE.SphereGeometry(.65, 28, 20), white);
  facePatch.scale.set(.94, .78, .27);
  facePatch.position.set(0, -.08, .66);
  headRig.add(facePatch);

  const cheekGeo = new THREE.SphereGeometry(.22, 18, 12);
  const cheekL = new THREE.Mesh(cheekGeo, white);
  const cheekR = new THREE.Mesh(cheekGeo, white);
  cheekL.scale.set(1.05, .80, .34);
  cheekR.scale.copy(cheekL.scale);
  cheekL.position.set(-.29, -.01, .71);
  cheekR.position.set(.29, -.01, .71);
  headRig.add(cheekL, cheekR);

  // Eyes sit inside the oversized low-set glasses.
  const eyeGeo = new THREE.SphereGeometry(.105, 18, 14);
  const eyeL = new THREE.Mesh(eyeGeo, black);
  const eyeR = new THREE.Mesh(eyeGeo, black);
  eyeL.position.set(-.24, .10, .82);
  eyeR.position.set(.24, .10, .82);
  headRig.add(eyeL, eyeR);

  const ringGeo = new THREE.TorusGeometry(.27, .052, 10, 30);
  const ringL = new THREE.Mesh(ringGeo, frame);
  const ringR = new THREE.Mesh(ringGeo, frame);
  ringL.position.set(-.28, .08, .94);
  ringR.position.set(.28, .08, .94);

  const lensGeo = new THREE.CircleGeometry(.235, 24);
  const lensL = new THREE.Mesh(lensGeo, lens);
  const lensR = new THREE.Mesh(lensGeo, lens);
  lensL.position.set(-.28, .08, .945);
  lensR.position.set(.28, .08, .945);

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(.18, .055, .045), frame);
  bridge.position.set(0, .08, .945);

  const templeGeo = new THREE.BoxGeometry(.34, .038, .04);
  const templeL = new THREE.Mesh(templeGeo, frame);
  const templeR = new THREE.Mesh(templeGeo, frame);
  templeL.position.set(-.50, .09, .85);
  templeR.position.set(.50, .09, .85);
  templeL.rotation.y = -.24;
  templeR.rotation.y = .24;
  headRig.add(lensL, lensR, ringL, ringR, bridge, templeL, templeR);

  // Larger rounded beak from the video reference.
  const beak = new THREE.Mesh(new THREE.ConeGeometry(.21, .39, 4, 1, false), orange);
  beak.rotation.x = Math.PI / 2;
  beak.rotation.z = Math.PI / 4;
  beak.scale.set(1.52, .68, .92);
  beak.position.set(0, -.18, 1.00);
  headRig.add(beak);

  const lowerBeak = new THREE.Mesh(new THREE.SphereGeometry(.18, 18, 10), orangeDark);
  lowerBeak.scale.set(1.16, .30, .55);
  lowerBeak.position.set(0, -.245, .96);
  headRig.add(lowerBeak);

  // Short thick flippers instead of the old long arms.
  const leftShoulder = new THREE.Bone();
  const rightShoulder = new THREE.Bone();
  leftShoulder.name = 'LeftFlipperBone';
  rightShoulder.name = 'RightFlipperBone';
  leftShoulder.position.set(-.77, .06, -.02);
  rightShoulder.position.set(.77, .06, -.02);
  chestRig.add(leftShoulder, rightShoulder);

  const flipperGeometry = createFlipperGeometry();
  const leftFlipperMesh = new THREE.Mesh(flipperGeometry, featherDark);
  const rightFlipperMesh = new THREE.Mesh(flipperGeometry.clone(), featherDark);
  leftFlipperMesh.scale.set(1.0, .92, 1.0);
  rightFlipperMesh.scale.copy(leftFlipperMesh.scale);
  leftFlipperMesh.position.set(-.03, -.27, -.03);
  rightFlipperMesh.position.set(.03, -.27, -.03);
  leftFlipperMesh.rotation.z = .28;
  rightFlipperMesh.rotation.z = -.28;
  leftShoulder.add(leftFlipperMesh);
  rightShoulder.add(rightFlipperMesh);

  // Big webbed feet, visibly wider than the old oval feet.
  const leftHip = new THREE.Bone();
  const rightHip = new THREE.Bone();
  leftHip.name = 'LeftFootBone';
  rightHip.name = 'RightFootBone';
  leftHip.position.set(-.38, -1.10, .24);
  rightHip.position.set(.38, -1.10, .24);
  group.add(leftHip, rightHip);

  const footLMesh = createWebbedFootGeometry();
  const footRMesh = createWebbedFootGeometry();
  footLMesh.scale.set(1.0, 1.0, 1.0);
  footRMesh.scale.copy(footLMesh.scale);
  footLMesh.rotation.z = -.06;
  footRMesh.rotation.z = .06;
  leftHip.add(footLMesh);
  rightHip.add(footRMesh);

  const tailRig = new THREE.Bone();
  tailRig.name = 'TailBone';
  tailRig.position.set(0, -.82, -.62);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(.25, .52, 5), featherDark);
  tail.rotation.x = Math.PI / 2;
  tail.scale.set(1.0, 1, .42);
  tail.position.z = -.16;
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
    beakBaseScale: beak.scale.clone(), lowerBeakBaseScale: lowerBeak.scale.clone(),
    rigCollision: {
      headPitchMin: -.40, headPitchMax: .34,
      headYaw: .62, flipperMin: .18, flipperMax: 1.12,
      footPitchMin: -.34, footPitchMax: .88
    }
  };

  group.scale.setScalar(.98);
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
  const iceRelief = createMicroReliefTexture('ice');
  const top = new THREE.Mesh(
    roughenIceGeometry(new THREE.CylinderGeometry(3.45, 3.05, .62, 52, 4), .075),
    new THREE.MeshPhysicalMaterial({
      color: 0xe9fbff,
      roughness: .27,
      metalness: .01,
      clearcoat: .84,
      clearcoatRoughness: .16,
      transmission: .12,
      ior: 1.31,
      thickness: .82,
      roughnessMap: iceRelief,
      bumpMap: iceRelief,
      bumpScale: .048
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
      transmission: .06,
      ior: 1.31,
      thickness: 1.1,
      roughnessMap: iceRelief,
      bumpMap: iceRelief,
      bumpScale: .055
    })
  );
  underside.position.y = -.88;
  underside.castShadow = true;
  group.add(underside);
  return group;
}

function createStaticWaterSurface() {
  // Cheap visible water: one two-triangle plane, no shader, no CPU vertex animation.
  // A tiny generated bump texture gives it readable ripples without reviving the old GPU-heavy water.
  const relief = createMicroReliefTexture('water');
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x1599c7,
    roughness: .22,
    roughnessMap: relief,
    bumpMap: relief,
    bumpScale: .055,
    metalness: 0,
    clearcoat: .72,
    clearcoatRoughness: .18,
    transmission: .08,
    transparent: true,
    opacity: .54,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const surface = new THREE.Mesh(
    getSharedGeometry('surfaceWaterPlane', () => new THREE.PlaneGeometry(64, 64, 1, 1)),
    material
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = -.28;
  surface.renderOrder = -1;
  surface.userData.relief = relief;
  return surface;
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
  const outerMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 6.0,
    roughness: .10,
    metalness: .12
  });
  const ring = new THREE.Mesh(
    getSharedGeometry('stationRingOuter', () => new THREE.TorusGeometry(2.15, .062, 12, 80)),
    outerMaterial
  );
  ring.rotation.y = Math.PI / 2.25;

  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xe8ffff,
    transparent: true,
    opacity: .76,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const inner = new THREE.Mesh(
    getSharedGeometry('stationRingInner', () => new THREE.TorusGeometry(1.52, .029, 10, 72)),
    innerMaterial
  );
  inner.rotation.copy(ring.rotation);

  const halo = new THREE.Mesh(
    getSharedGeometry('stationRingHalo', () => new THREE.TorusGeometry(2.18, .15, 10, 72)),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: .14,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  halo.rotation.copy(ring.rotation);

  // One cheap point light per station gives the ring actual local emission.
  // No shadows: the glow affects the mascot/ice without recreating the old GPU-heavy scene.
  const glow = new THREE.PointLight(color, 2.2, 8.5, 2);
  glow.position.set(0, 0, .65);
  glow.castShadow = false;

  group.add(halo, ring, inner, glow);
  group.userData = { ring, inner, halo, glow };
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

  populateFishSchools(stage);

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
    refreshJourneyMetrics();
    const destination = journeyTop + journey.offsetHeight + 14;
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

    const submergedVisual = smoothstep(.205, .292, progress);
    const deepVisual = smoothstep(.32, .95, progress);
    stage.style.setProperty('--surface-air-opacity', (1 - submergedVisual).toFixed(3));
    stage.style.setProperty('--depth-dim', deepVisual.toFixed(3));
    stage.style.setProperty('--neon-boost', deepVisual.toFixed(3));
    stage.style.setProperty('--panel-glow', clamp(.10 + deepVisual * .90).toFixed(3));
    stage.style.setProperty('--water-opacity', clamp(.58 + submergedVisual * .34).toFixed(3));
    stage.dataset.depthVisual = deepVisual.toFixed(3);

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
  let renderPixelRatioTarget = .68;
  let maxRenderPixels = 1152 * 648;
  let displayPixelRatioLimit = .78;
  let renderFpsCap = 24;
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
      maxRenderPixels = 1152 * 648;
      displayPixelRatioLimit = .88;
    }

    stage.dataset.viewportClass = viewportProfile.name;
    stage.dataset.viewportCss = `${viewportProfile.viewportWidth}x${viewportProfile.viewportHeight}`;
    stage.dataset.devicePixelRatio = viewportProfile.dpr.toFixed(2);
  };

  const fpsCapForRefresh = hz => {
    if (!Number.isFinite(hz) || hz <= 0) return 24;
    if (hz < 28) return Math.max(15, Math.min(24, Math.round(hz)));
    if (hz < 38) return 24;
    if (hz < 56) return Math.max(18, Math.min(24, Math.round(hz / 2)));
    return 24;
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
    antialias: false,
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
  stage.dataset.compressionProfile = 'safe-webgl-v16-static-water-depth-glow';

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

  const waterSurface = createStaticWaterSurface();
  scene.add(waterSurface);
  stage.dataset.waterModel = 'single-plane-bump-v1';

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
  stage.dataset.swimSource = 'little-feet-mascot-v3';
  stage.dataset.mascotModel = 'video-reference-v3';

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

  // Lightweight collision volumes keep the hero clear of the iceberg and
  // station portals without adding a physics engine.
  const resolveSceneCollision = (position, progress) => {
    const corrected = { ...position };

    // During launch, never let the body cut through the solid ice volume.
    if (progress > .13 && progress < .30 && corrected.y < 1.55 && corrected.y > -1.75) {
      const dx = corrected.x - ice.position.x;
      const dz = corrected.z - ice.position.z;
      const radial = Math.hypot(dx, dz);
      const minRadius = 3.62;
      if (radial < minRadius) {
        const scale = minRadius / Math.max(.001, radial);
        corrected.x = ice.position.x + dx * scale;
        corrected.z = ice.position.z + dz * scale;
      }
    }

    // Keep the mascot in front of each luminous station ring instead of
    // allowing a ring plane to slice through the body at a station hold.
    ringData.forEach(item => {
      const distance2d = Math.hypot(corrected.x - item.x, corrected.y - item.y);
      if (distance2d < 2.45) corrected.z = Math.max(corrected.z, -.55);
    });

    return corrected;
  };
  stage.dataset.collisionProfile = 'bone-limits-scene-spheres-v1';

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
    const journeyRect = journey.getBoundingClientRect();
    journeyTop = window.scrollY + journeyRect.top;
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
    if (cinematicUserPaused) {
      journey.classList.remove('is-active', 'is-after');
      stage.dataset.exitHoldActive = 'false';
      return;
    }
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

    const collisionSafePath = resolveSceneCollision({
      x: path.x,
      y: path.y + idleBob + stationBob + pathBob - anticipation * .17,
      z: path.z
    }, progress);
    mascot.position.set(collisionSafePath.x, collisionSafePath.y, collisionSafePath.z);

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
    const headYaw = clamp(requestedYaw, -data.rigCollision.headYaw, data.rigCollision.headYaw);
    const headPitch = clamp(
      requestedPitch + preen * .14,
      data.rigCollision.headPitchMin,
      data.rigCollision.headPitchMax
    );
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

    // Final joint limits are the procedural rig's self-collision guard.
    // They stop the head, flippers, feet and tail from folding through the torso.
    data.leftFlipper.rotation.z = clamp(
      data.leftFlipper.rotation.z,
      -data.rigCollision.flipperMax,
      -data.rigCollision.flipperMin
    );
    data.rightFlipper.rotation.z = clamp(
      data.rightFlipper.rotation.z,
      data.rigCollision.flipperMin,
      data.rigCollision.flipperMax
    );
    data.leftFlipper.rotation.x = clamp(data.leftFlipper.rotation.x, -.18, 1.05);
    data.rightFlipper.rotation.x = clamp(data.rightFlipper.rotation.x, -.18, 1.05);
    data.footL.rotation.x = clamp(data.footL.rotation.x, data.rigCollision.footPitchMin, data.rigCollision.footPitchMax);
    data.footR.rotation.x = clamp(data.footR.rotation.x, data.rigCollision.footPitchMin, data.rigCollision.footPitchMax);
    data.tailRig.rotation.x = clamp(data.tailRig.rotation.x, -.18, .24);
    data.tailRig.rotation.y = clamp(data.tailRig.rotation.y, -.42, .42);

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
    const deepGlow = smoothstep(.30, .95, progress);

    // Move only the bump texture coordinates. Geometry stays static.
    if (waterSurface.userData.relief) {
      waterSurface.userData.relief.offset.x = (time * .010) % 1;
      waterSurface.userData.relief.offset.y = (time * .006) % 1;
    }
    const waterFade = smoothstep(.18, .34, progress);
    waterSurface.material.opacity = lerp(.56, .06, waterFade);
    waterSurface.visible = progress < .40;
    rings.forEach((ring, index) => {
      const distance = Math.abs(progress - stations[Math.min(index + 2, stations.length - 1)].at);
      const proximity = 1 - smoothstep(.03, .15, distance);
      ring.rotation.z = time * (.05 + index * .012);
      const pulse = 1 + Math.sin(time * 1.55 + index * .8) * .035 + proximity * .08;
      ring.scale.setScalar(pulse);

      const depthBoost = deepGlow * (1.5 + index * .55);
      ring.userData.ring.material.emissiveIntensity = 5.2 + depthBoost * 2.6 + proximity * 4.2;
      ring.userData.inner.material.opacity = clamp(.58 + deepGlow * .22 + proximity * .18, .58, .98);
      ring.userData.halo.material.opacity = clamp(.10 + deepGlow * .16 + proximity * .20, .10, .42);
      ring.userData.glow.intensity = 1.8 + depthBoost * 1.15 + proximity * 3.2;
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
      renderPixelRatioTarget = .56;
    } else if (tier === 'enhanced') {
      worldInterval = 1 / 20;
      bubbleInterval = 1 / 16;
      renderPixelRatioTarget = .76;
    } else {
      worldInterval = 1 / 15;
      bubbleInterval = 1 / 12;
      renderPixelRatioTarget = .66;
    }

    renderer.shadowMap.enabled = false;
    sun.castShadow = false;

    stage.dataset.performanceTier = tier;
    stage.dataset.renderFpsCap = String(renderFpsCap);
    resize();
  };

  const recordFramePerformance = workMs => {
    // Measure the actual CPU/render work of a drawn frame, not the interval
    // between frames. The cinematic is intentionally capped near 24 FPS, so frame
    // spacing is ~42 ms even when the machine is healthy.
    if (workMs <= 0 || workMs > 80) return;
    perfFrameTotalMs += workMs;
    perfFrameCount += 1;
    if (perfFrameCount < 24) return;

    const averageMs = perfFrameTotalMs / perfFrameCount;
    perfFrameCount = 0;
    perfFrameTotalMs = 0;

    if (averageMs > 20) {
      perfGoodWindows = 0;
      applyPerformanceTier('reduced');
      return;
    }
    if (averageMs > 13) {
      perfGoodWindows = 0;
      applyPerformanceTier('balanced');
      return;
    }

    perfGoodWindows += 1;
    if (perfGoodWindows >= 3 && averageMs < 9) applyPerformanceTier('enhanced');
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
    // Surface water stays behind the ice and fades once the camera is submerged.
    waterSurface.position.y = -.28 + Math.sin(time * .55) * .008;
    ambient.intensity = lerp(2.2, .62, deepening);
    cyanLight.intensity = lerp(7.5, 5.2, deepening) + splash * 3.5;
    violetLight.intensity = lerp(1.8, 14.5, smoothstep(.42, .92, smoothProgress));
    sun.intensity = lerp(5, .58, deepening);
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
  let pausedScrollProgress = null;
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
    const wasPaused = cinematicUserPaused;
    cinematicUserPaused = !cinematicUserPaused;
    try { localStorage.setItem('lf_cinematic_paused', String(cinematicUserPaused)); } catch { /* Optional preference. */ }

    if (cinematicUserPaused) {
      pausedScrollProgress = scrollProgress;
      stopCinematicLoop();
      stage.dataset.cinematicIdle = 'paused-by-user';
      syncPauseUi();
      calculateScroll();
      return;
    }

    syncPauseUi();
    refreshJourneyMetrics();
    if (wasPaused && pausedScrollProgress !== null) {
      const resumeProgress = clamp(pausedScrollProgress);
      pausedScrollProgress = null;
      window.scrollTo({ top: journeyTop + journeyTravel * resumeProgress, behavior: 'auto' });
    }
    calculateScroll();
    markCinematicActivity();
    syncCinematicRuntime();
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
