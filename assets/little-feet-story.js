(function () {
  'use strict';

  const pages = [
    ['A quiet night','In a little room beneath the northern lights, the young penguin slept soundly.'],
    ['He wakes','A pale glow crept across the dark room. He opened his eyes and listened to the quiet North Pole.'],
    ['A new morning','He sat up as dawn brushed the snow in blue and gold.'],
    ['Villages far away','From his window he could see warm village lights scattered across the frozen land.'],
    ['A long way to go','Snow and ice lay between the villages. Even a short visit could take all day.'],
    ['A thought takes shape','He wondered if there was a way to bring the faraway villages closer.'],
    ['Back to the workshop','He hurried to his little workshop and began to sketch.'],
    ['The first plan','On a piece of parchment, he drew a route through the snow.'],
    ['A small snow courier','He built a tiny machine to carry notes over the drifts.'],
    ['Sputter, stop','The little machine rattled, rolled a few steps, then sank into the snow.'],
    ['They laughed','Some villagers laughed at his failed invention. Their words stung.'],
    ['A lonely evening','That night he sat beside the broken parts and wondered whether to stop.'],
    ['Try once more','By morning he was building again, this time with canvas wings and a hopeful heart.'],
    ['A gentle crash','The flying contraption wobbled and dropped into a soft snowbank. He was safe.'],
    ['Learn from the pieces','He studied every bent part and found what had gone wrong.'],
    ['A better plan','He drew a network of small links that could connect every village.'],
    ['A lantern that could talk','He built a simple device to send a signal across the snow.'],
    ['The first signal','One lantern glowed. The penguin waited, holding his breath.'],
    ['A light answers','A lantern blinked back from the next village. His message had arrived.'],
    ['The first link','He and his neighbors made one dependable connection between their homes.'],
    ['The network grows','One by one, more villages joined the glowing route.'],
    ['Helping hands','The villagers who once laughed came to help him build and mend.'],
    ['Little Feet','They named the growing invention Little Feet: small steps that brought everyone together.'],
    ['Connected at last','Now messages, learning, plans, and supplies could travel between every village.'],
    ['A brighter North Pole','At sunrise, the penguin looked out over the connected villages. His little idea had brought them together.']
  ];

  function init() {
    const book = document.querySelector('#portalTour .lf-storybook');
    const spread = book?.querySelector('.lf-story-spread');
    const image = book?.querySelector('.lf-story-illustration');
    const title = book?.querySelector('.lf-story-heading');
    const copy = book?.querySelector('.lf-story-copy');
    const count = book?.querySelector('.lf-story-page-count');
    const cover = book?.querySelector('.lf-story-cover');
    const close = book?.querySelector('.lf-story-close');
    const back = book?.querySelector('.lf-story-arrow-left');
    const next = book?.querySelector('.lf-story-arrow-right');
    const turn = book?.querySelector('.lf-story-turn');
    if (!book || !spread || !image || !title || !copy || !count || !cover || !close || !back || !next || !turn) return;

    let pageIndex = 0;
    let opened = false;
    let busy = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function openBook() {
      if (opened || busy) return;
      opened = true;
      if (typeof portalTourTimer !== 'undefined') window.clearInterval(portalTourTimer);
      if (reducedMotion) { book.classList.add('is-open'); return; }
      busy = true;
      book.classList.add('is-opening');
      window.setTimeout(() => { book.classList.remove('is-opening'); book.classList.add('is-open'); busy = false; }, 760);
    }
    function closeBook() {
      if (!opened || busy) return;
      opened = false;
      if (reducedMotion) { book.classList.remove('is-open'); cover.focus(); return; }
      busy = true;
      book.classList.remove('is-open');
      book.classList.add('is-closing');
      window.setTimeout(() => { book.classList.remove('is-closing'); busy = false; cover.focus(); }, 760);
    }
    function render(direction) {
      const priorSpread = spread.cloneNode(true);
      priorSpread.querySelector('.lf-story-turn')?.remove();
      priorSpread.className = 'lf-story-turn-snapshot';
      image.src = `/assets/4k/little-feet-pages/page-${String(pageIndex + 1).padStart(2, '0')}.webp?v=20261027-parchment-art-v1`;
      image.alt = `Illustration for page ${pageIndex + 1}: ${pages[pageIndex][0]}`;
      title.textContent = pages[pageIndex][0];
      copy.textContent = pages[pageIndex][1];
      count.textContent = `Page ${pageIndex + 1} of ${pages.length}`;
      back.disabled = pageIndex === 0;
      next.disabled = pageIndex === pages.length - 1;
      if (!direction || reducedMotion) return;
      turn.classList.toggle('is-backward', direction === 'backward');
      const leaf = document.createElement('div');
      leaf.className = `lf-story-turn-leaf ${direction}`;
      leaf.innerHTML = '<span class="lf-story-turn-back" aria-hidden="true"></span>';
      const old = document.createElement('div');
      old.className = 'lf-story-turn-front';
      old.append(priorSpread); leaf.append(old); turn.replaceChildren(leaf);
      requestAnimationFrame(() => leaf.classList.add('is-turning'));
      busy = true; back.disabled = true; next.disabled = true;
      window.setTimeout(() => { turn.replaceChildren(); busy = false; back.disabled = pageIndex === 0; next.disabled = pageIndex === pages.length - 1; }, 760);
    }
    function move(delta) {
      if (!opened || busy) return;
      const candidate = pageIndex + delta;
      if (candidate < 0 || candidate >= pages.length) return;
      pageIndex = candidate;
      render(delta > 0 ? 'forward' : 'backward');
    }

    book.closest('#portalTour').addEventListener('mouseleave', event => { if (opened) event.stopImmediatePropagation(); }, true);
    book.closest('#portalTour').addEventListener('focusout', event => { if (opened) event.stopImmediatePropagation(); }, true);
    cover.addEventListener('click', openBook);
    close.addEventListener('click', closeBook);
    back.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    book.addEventListener('keydown', event => {
      if (event.key === 'Escape' && opened) { closeBook(); return; }
      if (!opened || busy) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    });
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
