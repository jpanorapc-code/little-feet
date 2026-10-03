const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const partsDir = path.join(root, 'assets', 'video', 'hq-source');
const outputPath = path.join(root, 'assets', 'video', 'little-feet-login-wallpaper.mp4');
const expectedSize = 4492743;
const expectedSha256 = 'a808688aa37d39546239ff427cdf564c78d4a1f1ebfa4dbb45b313ad775dadfc';

const partNames = Array.from({ length: 6 }, (_, index) =>
  `login-wallpaper-hq.part${String(index + 1).padStart(2, '0')}.b64`
);
const partPaths = partNames.map(name => path.join(partsDir, name));

if (!partPaths.every(filePath => fs.existsSync(filePath))) {
  console.warn('HQ login wallpaper source chunks are incomplete; keeping repository fallback video.');
  process.exit(0);
}

const encoded = partPaths
  .map(filePath => fs.readFileSync(filePath, 'utf8'))
  .join('')
  .replace(/\s+/g, '');

const video = Buffer.from(encoded, 'base64');
const sha256 = crypto.createHash('sha256').update(video).digest('hex');

if (video.length !== expectedSize || sha256 !== expectedSha256) {
  throw new Error(
    `HQ login wallpaper integrity check failed (size=${video.length}, sha256=${sha256}).`
  );
}

fs.writeFileSync(outputPath, video);
console.log(
  `Restored HQ login wallpaper (${video.length} bytes, 1920x1080 @ 30fps source).`
);
