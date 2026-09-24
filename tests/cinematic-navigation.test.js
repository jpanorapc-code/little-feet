
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const cinematic = fs.readFileSync(path.join(root, 'assets', 'cinematic.js'), 'utf8');
const cinematicLoader = fs.readFileSync(path.join(root, 'assets', 'cinematic-loader.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'assets', 'cinematic.css'), 'utf8');

assert.match(server, /three\.module\.js': 'https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.186\.0\/build\/three\.module\.js'/);
assert.match(server, /three\.core\.js': 'https:\/\/cdn\.jsdelivr\.net\/npm\/three@0\.186\.0\/build\/three\.core\.js'/);
assert.match(page, /href="\/assets\/cinematic\.css\?v=20260924-cinematic-v3"/);
assert.match(page, /src="\/assets\/cinematic-loader\.js\?v=20260924-cinematic-v3" defer/);
assert.doesNotMatch(page, /type="module" src="\/assets\/cinematic\.js/);
assert.match(page, /id="littleFeetCinematicJourney"/);
assert.match(page, /id="littleFeetCinematicCanvas"/);

assert.match(cinematic, /import \* as THREE from '\/vendor\/three\.module\.js'/);
assert.match(cinematic, /prefers-reduced-motion: reduce/);
assert.match(cinematic, /canUseWebGL2/);
assert.match(cinematic, /qualityForDevice/);
assert.match(cinematic, /typeof window\.openWorkspace === 'function'/);
assert.match(cinematic, /accessibleNavTarget/);
assert.match(cinematic, /document\.hidden/);
assert.match(cinematic, /CylinderGeometry\(3\.45, 3\.05, \.62/);
assert.match(cinematic, /camera\.position\.set\(\.8, 3\.8, 11\.8\)/);
assert.match(cinematic, /firstFrameRendered/);
assert.match(cinematic, /webglcontextlost/);
assert.match(cinematic, /cinematic render failed/);
assert.match(cinematic, /dashboardSection/);
assert.match(cinematic, /rect\.width < 2 \|\| rect\.height < 2/);
assert.match(cinematic, /ResizeObserver/);
assert.match(cinematic, /MutationObserver/);
assert.match(cinematic, /dashboard\.classList\.contains\('hidden'\)/);
assert.match(cinematic, /refreshStationTargets/);
assert.match(cinematic, /diveKeyframes/);
assert.match(cinematic, /sampleDivePath/);
assert.match(cinematic, /mascot\.position\.y \+ 4\.25/);
assert.match(cinematic, /headRig/);
assert.match(cinematic, /eyeLBase/);
assert.match(cinematic, /playMascotChirp/);
assert.match(cinematic, /lf_portal_audio_muted_last/);
assert.match(cinematic, /journey\.classList\.toggle\('is-active'/);
assert.match(styles, /cinematic-journey\.is-active \.cinematic-stage/);
assert.match(styles, /width: calc\(100vw - 260px\)/);
assert.match(styles, /#homeTab\.tab-content\.active/);
assert.match(styles, /transform: none !important/);
assert.doesNotMatch(cinematic, /fetch\(/);
assert.doesNotMatch(cinematic, /innerHTML\s*=/);

assert.match(cinematicLoader, /dashboardSection/);
assert.match(cinematicLoader, /dashboard\.classList\.contains\('hidden'\)/);
assert.match(cinematicLoader, /MutationObserver/);
assert.match(cinematicLoader, /import\('\/assets\/cinematic\.js\?v=20260924-cinematic-v3'\)/);
assert.match(cinematicLoader, /cinematic-fallback/);
assert.doesNotMatch(cinematicLoader, /fetch\(/);
assert.doesNotMatch(cinematicLoader, /innerHTML\s*=/);

assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(styles, /\.cinematic-fallback/);
assert.match(styles, /backdrop-filter/);

console.log('Cinematic navigation regression test passed.');
