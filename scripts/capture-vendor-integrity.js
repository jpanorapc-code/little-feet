'use strict';

const crypto = require('node:crypto');


const fs = require('node:fs');

const index = fs.readFileSync('index.html', 'utf8');
const inlinePattern = new RegExp('<script(?![^>]*\\\\bsrc=)[^>]*>([\\\\s\\\\S]*?)<\\\\/script>', 'gi');
const inlineBlocks = [...index.matchAll(inlinePattern)].map(match => match[1]);
inlineBlocks.forEach((block, index) => {
  const sha256 = crypto.createHash('sha256').update(Buffer.from(block, 'utf8')).digest('base64');
  console.log(JSON.stringify({ name: `inline-script-${index}`, bytes: Buffer.byteLength(block), sha256: `sha256-${sha256}` }));
});

const targets = [
  ['leaflet-css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'],
  ['markercluster-css', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css'],
  ['markercluster-default-css', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'],
  ['xlsx-js', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'],
  ['qrcode-js', 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js'],
  ['leaflet-js', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'],
  ['leaflet-markercluster-js', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'],
  ['three-module-js', 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js'],
  ['three-core-js', 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.core.js']
];

(async () => {
  for (const [name, url] of targets) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`${name} HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const sha256 = crypto.createHash('sha256').update(buffer).digest('base64');
    const sha384 = crypto.createHash('sha384').update(buffer).digest('base64');
    console.log(JSON.stringify({ name, bytes: buffer.length, sha256: `sha256-${sha256}`, sha384: `sha384-${sha384}` }));
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
