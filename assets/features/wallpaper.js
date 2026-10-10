// wallpaper workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function setupWallpaperMode() {
  const noteActivity = (event) => {
    const overlay = document.getElementById('wallpaperOverlay');
    if (overlay?.classList.contains('is-visible')) {
      exitWallpaperMode();
      return;
    }
    resetWallpaperTimer();
  };
  ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'scroll'].forEach(eventName => {
    document.addEventListener(eventName, noteActivity, { passive: eventName !== 'keydown' });
  });
}

function resetWallpaperTimer() {
  clearTimeout(wallpaperIdleTimer);
  const dashboard = document.getElementById('dashboardSection');
  if (!currentUser || !dashboard || dashboard.classList.contains('hidden')) return;
  wallpaperIdleTimer = window.setTimeout(() => startWallpaperMode(), WALLPAPER_IDLE_MS);
}

function startWallpaperMode() {
  const overlay = document.getElementById('wallpaperOverlay');
  if (!currentUser || !overlay) return;
  clearTimeout(wallpaperIdleTimer);
  overlay.classList.add('is-visible');
  overlay.setAttribute('aria-hidden', 'false');
  startWallpaperTheme();
  overlay.querySelector('.wallpaper-exit')?.focus({ preventScroll: true });
}

function exitWallpaperMode() {
  const overlay = document.getElementById('wallpaperOverlay');
  if (!overlay) return;
  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  stopWallpaperTheme();
  resetWallpaperTimer();
}

function startWallpaperTheme() {
  const overlay = document.getElementById('wallpaperOverlay');
  if (!overlay?.classList.contains('is-visible')) return;
  if (portalAudioMuted) {
    updatePortalAudioControls();
    return;
  }
  try {
    if (!wallpaperThemeAudio) {
      wallpaperThemeAudio = new Audio('assets/audio/little-feet-wallpaper.mp3');
      wallpaperThemeAudio.preload = 'auto';
      wallpaperThemeAudio.loop = true;
      wallpaperThemeAudio.volume = 0.55;
    }
    wallpaperThemeAudio.currentTime = 0;
    wallpaperThemeAudio.play().catch(() => {});
    updatePortalAudioControls();
  } catch { /* Wallpaper remains available even when a device has sound disabled. */ }
}

function stopWallpaperTheme() {
  if (!wallpaperThemeAudio) return;
  wallpaperThemeAudio.pause();
  wallpaperThemeAudio.currentTime = 0;
}

function openWallpaperDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('This browser cannot store a custom wallpaper.'));
    const request = indexedDB.open('little-feet-device-assets', 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('wallpapers')) request.result.createObjectStore('wallpapers');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open wallpaper storage.'));
  });
}

async function saveCustomWallpaper(blob) {
  const database = await openWallpaperDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('wallpapers', 'readwrite');
    transaction.objectStore('wallpapers').put(blob, 'active');
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('Unable to save the wallpaper.'));
  });
  database.close();
}

function applyCustomWallpaper(blob) {
  const image = document.getElementById('wallpaperImage');
  const overlay = document.getElementById('wallpaperOverlay');
  if (!image) return;
  if (customWallpaperObjectUrl) URL.revokeObjectURL(customWallpaperObjectUrl);
  customWallpaperObjectUrl = blob ? URL.createObjectURL(blob) : '';
  if (customWallpaperObjectUrl) {
    image.src = customWallpaperObjectUrl;
    overlay?.classList.add('has-custom-wallpaper');
  } else {
    image.removeAttribute('src');
    overlay?.classList.remove('has-custom-wallpaper');
  }
}

function gifDurationMs(buffer) {
  const bytes = new Uint8Array(buffer);
  let total = 0;
  let frames = 0;
  for (let index = 0; index + 6 < bytes.length; index += 1) {
    if (bytes[index] !== 0x21 || bytes[index + 1] !== 0xf9 || bytes[index + 2] !== 0x04) continue;
    const delay = bytes[index + 4] | (bytes[index + 5] << 8);
    total += Math.max(delay * 10, 20);
    frames += 1;
  }
  return frames > 1 ? total : 0;
}

function wallpaperDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The selected file is not a readable image.'));
    };
    image.src = url;
  });
}

async function importCustomWallpaper() {
  const input = document.getElementById('customWallpaperFile');
  const status = document.getElementById('customWallpaperStatus');
  const file = input?.files?.[0];
  if (!file) return alert('Choose a JPG, PNG, WebP, or GIF first.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension) || !file.type.startsWith('image/')) return alert('Use a JPG, PNG, WebP, or GIF wallpaper.');
  if (file.size > CUSTOM_WALLPAPER_MAX_BYTES) return alert('The wallpaper must be 8 MB or smaller.');
  try {
    const dimensions = await wallpaperDimensions(file);
    if (dimensions.width > 3840 || dimensions.height > 2160 || dimensions.width * dimensions.height > 8294400) throw new Error('Use an image no larger than 3840 × 2160 pixels.');
    if (extension === 'gif') {
      const duration = gifDurationMs(await file.arrayBuffer());
      if (duration > CUSTOM_WALLPAPER_MAX_GIF_MS) throw new Error('Animated GIFs must be 8 seconds or shorter.');
    }
    await saveCustomWallpaper(file);
    applyCustomWallpaper(file);
    if (status) status.textContent = `${file.name} is saved on this device and ready to preview.`;
  } catch (error) {
    alert(safeUserFacingError(error, 'Unable to save this wallpaper.'));
  }
}

async function resetCustomWallpaper() {
  try {
    const database = await openWallpaperDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('wallpapers', 'readwrite');
      transaction.objectStore('wallpapers').delete('active');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Unable to restore the default wallpaper.'));
    });
    database.close();
    applyCustomWallpaper(null);
    const input = document.getElementById('customWallpaperFile');
    const status = document.getElementById('customWallpaperStatus');
    if (input) input.value = '';
    if (status) status.textContent = 'The Little Feet northern lights wallpaper is active.';
  } catch (error) {
    alert(safeUserFacingError(error, 'Unable to restore the default wallpaper.'));
  }
}
