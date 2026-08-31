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

  // The banner first, then every photo and clip in the grid. The tile
  // rather than just its frame, so a shoot's name rises with its picture
  // instead of sitting there over an empty space.
  var targets = document.querySelectorAll('.banner, .tile, .media, .pair__item');
  if (!targets.length) {
    document.documentElement.classList.remove('js-reveal');
    return;
  }

  // Don't fade a thing in before its picture has arrived: an empty box
  // fading up and then popping its image in is worse than a fade that
  // starts a moment later. Capped, so a photo that never loads at all
  // can't hold its tile hidden for good.
  function whenPictured(el, go) {
    var img = el.querySelector('img');
    if (!img || img.complete) return go();
    var done = false;
    var once = function () { if (!done) { done = true; go(); } };
    img.addEventListener('load', once, { once: true });
    img.addEventListener('error', once, { once: true });
    setTimeout(once, 1200);
  }

  var io = new IntersectionObserver(function (entries) {
    // Sorted top-to-bottom rather than taken in the order the observer
    // hands them over, which isn't specified. This is what guarantees the
    // banner leads and each row ripples downward instead of the stagger
    // landing in whatever order the browser felt like.
    var arriving = entries.filter(function (e) { return e.isIntersecting; })
      .sort(function (a, b) {
        return (a.boundingClientRect.top - b.boundingClientRect.top) ||
               (a.boundingClientRect.left - b.boundingClientRect.left);
      });

    // The banner needs a real head start, not merely to be first in the
    // queue. It runs longer than the covers do, so starting a stagger step
    // ahead left it at almost exactly their opacity the whole way down —
    // measured 0.77 against 0.79. Anything arriving alongside it waits a
    // beat, and only then does the row ripple in behind it.
    var LEAD = 250;
    var afterBanner = false;

    arriving.forEach(function (entry, n) {
      var isBanner = entry.target.classList.contains('banner');
      if (isBanner) afterBanner = true;

      // Stagger whatever arrives together, so a row of three lands as a
      // ripple rather than a single slab. Capped, or the last one in a
      // long row would still be waiting well after it is on screen —
      // which reads as a bug, not as a flourish.
      entry.target.style.transitionDelay =
        (Math.min(n * 90, 270) + (afterBanner && !isBanner ? LEAD : 0)) + 'ms';
      whenPictured(entry.target, function () {
        entry.target.classList.add('is-in');
      });

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
