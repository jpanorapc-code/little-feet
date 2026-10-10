(() => {
  'use strict';
  const images = [...document.querySelectorAll('.portal-tour-image[data-src]')];
  const reveal = image => {
    image.src = image.dataset.src;
    image.removeAttribute('data-src');
  };
  if (!('IntersectionObserver' in window)) { images.forEach(reveal); return; }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      reveal(entry.target);
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '300px 0px' });
  images.forEach(image => observer.observe(image));
})();
