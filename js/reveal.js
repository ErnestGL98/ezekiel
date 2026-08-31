/* ============================================================
   SOFT REVEAL — each photo fades up once, as it first comes into view
   ============================================================

   The styling is entirely in the stylesheet, under .js-reveal. All this
   file does is decide WHEN each item has arrived, and hand it .is-in.

   The .js-reveal class is added by a small inline script in the page
   head, not here. A deferred script runs after the first paint, so
   hiding the images from here would show them and then snatch them
   away. That inline block also removes the class after a few seconds if
   this file never loads, which is what stops a failed request leaving
   the whole grid invisible.
   ============================================================ */

(function () {
  'use strict';

  // Tells the failsafe in the head that this file did arrive.
  window.__revealReady = true;

  // Belt to the head script's braces. scrollRestoration: 'manual' already
  // stops the browser putting you back where you were, but layout on this
  // page settles late — lazy images, three video elements — and a late
  // shift can still nudge the position. Skipped when there's a hash, so a
  // link to a section still works.
  if (!location.hash) window.scrollTo(0, 0);

  if (!document.documentElement.classList.contains('js-reveal')) return;

  // Every photo and clip in the grid. The tile rather than just its
  // frame, so a shoot's name rises with its picture instead of sitting
  // there over an empty space.
  var targets = document.querySelectorAll('.tile, .media, .pair__item');
  if (!targets.length) {
    document.documentElement.classList.remove('js-reveal');
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    var n = 0;
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;

      // Stagger whatever arrives in the same batch, so a row of three
      // lands as a ripple rather than a single slab. Capped, or the last
      // one in a long row would still be waiting well after it is on
      // screen — which reads as a bug, not as a flourish.
      entry.target.style.transitionDelay = Math.min(n * 90, 270) + 'ms';
      entry.target.classList.add('is-in');
      n++;

      // Once each. Nothing here fades back out on the way past.
      io.unobserve(entry.target);
    });
  }, {
    // A little way in from the bottom edge, so an item starts its fade
    // after it has properly entered rather than the instant it clips the
    // very bottom of the window.
    rootMargin: '0px 0px -8% 0px',
    threshold: 0.08
  });

  Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
})();
