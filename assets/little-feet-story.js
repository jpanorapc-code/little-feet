(function () {
  'use strict';

  const pages = [
    ['A quiet night', 'In a little room beneath the northern lights, the young penguin slept soundly.', 'The workshop dream'],
    ['A tiny stir', 'A faint glow crept across the dark room. Beneath the blanket, one little foot twitched.', 'A new morning'],
    ['He wakes', 'He opened his eyes and listened. The whole North Pole was still asleep.', 'Beyond the window'],
    ['The first light', 'He sat up as dawn brushed the snow in pale blue and gold.', 'A world apart'],
    ['Villages far away', 'From his window he could see warm village lights, scattered across the frozen land.', 'A thought begins'],
    ['A long way to go', 'Snow and ice lay between every village. A simple visit could take all day.', 'Could it be easier?'],
    ['Down to the snow', 'He pulled on his scarf, stepped outside, and looked toward the distant homes.', 'Back to the workshop'],
    ['A sketch on parchment', 'At his workbench, he drew a way for the villages to reach one another.', 'The first invention'],
    ['A little snow courier', 'He built a tiny machine to carry notes over the drifts.', 'Ready for a test'],
    ['Sputter, stop', 'The machine rattled bravely, rolled a few steps, then sank into the snow.', 'The laughter'],
    ['They laughed', 'The villagers laughed at his broken invention. Their words stung more than the cold.', 'A lonely evening'],
    ['A quiet workshop', 'That night he sat alone beside the pieces, wondering if he should stop.', 'Try once more'],
    ['A flying idea', 'By morning he had built wings from canvas, wood, and a little hope.', 'Up, up…'],
    ['Back in a snowbank', 'The wings wobbled and dropped him into a soft snowbank. He was safe, but the project had failed.', 'Look closely'],
    ['The parts had a clue', 'Instead of throwing everything away, he studied each bent piece and learned why it failed.', 'A better plan'],
    ['Lines between homes', 'He drew a new plan: small connections joining every village into one helpful network.', 'A message machine'],
    ['A lantern that could talk', 'He built a simple device to send a message from one workshop to another.', 'First test'],
    ['A tiny green light', 'Across the snow, a lantern blinked back. His message had reached the next village.', 'It works!'],
    ['The first link', 'The penguin and his neighbors made one dependable path between their homes.', 'More neighbors join'],
    ['The network grows', 'Each village added a link, until the glowing paths stretched across the North Pole.', 'The laughter changes'],
    ['Lending a hand', 'The villagers who once laughed came to help build, mend, and connect the routes.', 'Little Feet'],
    ['A name for the idea', 'They called the growing invention Little Feet: small steps that could bring everyone together.', 'Every village'],
    ['Connected at last', 'Soon every village could reach the others across the snowy north.', 'Sharing what matters'],
    ['A place to help each other', 'Messages, learning, plans, and supplies could travel where they were needed.', 'His dream comes true'],
    ['A brighter North Pole', 'At sunrise, the penguin looked out over the connected villages. His little idea had brought them together.' , 'The End']
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
    if (!book || !spread || !image || !title || !copy || !count || !cover || !close || !back || !next) return;

    let pageIndex = 0;
    let isOpen = false;
    let isAnimating = false;
    const motionOff = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const openBook = () => {
      if (isOpen || isAnimating) return;
      isOpen = true;
      if (motionOff) { book.classList.add('is-open'); return; }
      isAnimating = true;
      book.classList.add('is-opening');
      window.setTimeout(() => { book.classList.remove('is-opening'); book.classList.add('is-open'); isAnimating = false; }, 820);
    };
    const closeBook = () => {
      if (!isOpen || isAnimating) return;
      isOpen = false;
      if (motionOff) { book.classList.remove('is-open'); return; }
      isAnimating = true;
      book.classList.remove('is-open');
      book.classList.add('is-closing');
      window.setTimeout(() => { book.classList.remove('is-closing'); isAnimating = false; cover.focus(); }, 820);
    };
    cover.addEventListener('click', openBook);
    close.addEventListener('click', closeBook);
    const render = direction => {
      const page = pages[pageIndex];
      spread.classList.remove('is-turning');
      void spread.offsetWidth;
      spread.classList.add('is-turning');
      image.src = `/assets/4k/little-feet-pages/page-${String(pageIndex + 1).padStart(2, '0')}.webp`;
      image.alt = `${page[0]} — illustrated Little Feet storybook page ${pageIndex + 1}`;
      title.textContent = page[0];
      copy.textContent = page[1];
      count.textContent = `${pageIndex + 1} / ${pages.length} · ${page[2]}`;
      book.dataset.page = String(pageIndex + 1);
      back.disabled = pageIndex === 0;
      next.disabled = pageIndex === pages.length - 1;
      spread.dataset.direction = direction;
    };

    back.addEventListener('click', () => { if (pageIndex > 0) { pageIndex -= 1; render('back'); } });
    next.addEventListener('click', () => { if (pageIndex < pages.length - 1) { pageIndex += 1; render('forward'); } });
    book.addEventListener('keydown', event => {
      if (event.key === 'Escape' && isOpen) { closeBook(); return; }
      if (!isOpen || isAnimating) return;
      if (event.key === 'ArrowLeft' && pageIndex > 0) { pageIndex -= 1; render('back'); back.focus(); }
      if (event.key === 'ArrowRight' && pageIndex < pages.length - 1) { pageIndex += 1; render('forward'); next.focus(); }
    });
    render('forward');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
