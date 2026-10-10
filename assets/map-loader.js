(() => {
  'use strict';
  let pending;
  const styles = [
    ['https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H'],
    ['https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css', 'sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO+BR5Csr6Dhqq+nZs59P0pPKQJkEV'],
    ['https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css', 'sha384-wgw+aLYNQ7dlhK47ZPK7FRACiq7ROZwgFNg0m04avm4CaXS+Z9Y7nMu8yNjBKYC+']
  ];
  const load = (tag, url, integrity) => new Promise((resolve, reject) => {
    const element = document.createElement(tag);
    if (tag === 'link') { element.rel = 'stylesheet'; element.href = url; element.integrity = integrity; element.crossOrigin = 'anonymous'; }
    else { element.src = url; element.async = true; }
    const timeout = setTimeout(() => fail(), 20000);
    const fail = () => { clearTimeout(timeout); element.remove(); reject(new Error('Map resources could not be loaded. Please check your connection and try again.')); };
    element.onload = () => { clearTimeout(timeout); resolve(element); };
    element.onerror = fail;
    document.head.append(element);
  });
  let loadedStyles = false;
  const loadStyles = async () => {
    if (loadedStyles) return;
    const results = await Promise.allSettled(styles.map(([url, integrity]) => load('link', url, integrity)));
    if (results.some(result => result.status === 'rejected')) {
      results.forEach(result => { if (result.status === 'fulfilled') result.value.remove(); });
      throw new Error('Map styles could not be loaded. Please check your connection and try again.');
    }
    loadedStyles = true;
  };
  window.loadLittleFeetMap = () => {
    if (pending) return pending;
    pending = Promise.allSettled([
      loadStyles(),
      (async () => {
        if (!window.L) await load('script', '/vendor/leaflet.js');
        if (!window.L?.markerClusterGroup) await load('script', '/vendor/leaflet-markercluster.js');
      })()
    ]).then(results => {
      const failure = results.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      if (!window.L?.markerClusterGroup) throw new Error('Map resources are unavailable. Please try again.');
    }).catch(error => { pending = undefined; throw error; });
    return pending;
  };
})();
