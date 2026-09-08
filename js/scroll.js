/* ============================================================
   WEIGHTED SCROLL — the page carries a little momentum
   ============================================================

   The wheel sets a TARGET; the page eases towards it and settles,
   instead of jumping the moment the wheel moves. Heavier than native,
   and it comes to a stop rather than stopping dead.

   WHY IT MOVES THE REAL SCROLL POSITION

   The usual way to do this is to lock the body and slide a wrapper with
   a transform, which is smoother still — and would break this site.
   A transformed ancestor becomes the containing block for anything
   `position: fixed` inside it, so the header, the music player and the
   lightbox would all start scrolling away with the page. Easing
   window.scrollTo keeps the scrollbar honest, keeps the fixed furniture
   fixed, and keeps the reveal's IntersectionObserver working, because
   the page really is scrolling.

   WHERE IT STANDS ASIDE
   - touch, which already has momentum of its own and resents being told
     otherwise
   - reduced-motion, which is precisely what that setting is for
   - the lightbox, where the wheel means zoom instead
   - ctrl+wheel, which is the browser's own zoom
   - keyboard, scrollbar and anchor jumps: those move the page directly,
     and this follows them rather than fighting them
   ============================================================ */

(function () {
  'use strict';

  // Native momentum on a touchscreen is better than anything reimplemented
  // here, and hijacking it is how scrolling starts to feel broken.
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Fraction of the REMAINING distance covered each frame. This is what
  // makes it decelerate on its own: the gap shrinks every frame, so the
  // movement does too — no timers, no easing curve to pick. Lower is
  // heavier. Below about 0.08 it starts to feel like lag rather than
  // weight, above about 0.2 the weight disappears.
  var EASE = 0.115;

  // A wheel notch in Firefox arrives as "3 lines" rather than a pixel
  // count, and full pages on some setups. Without normalising, the same
  // gesture moves wildly different distances between browsers.
  var LINE = 16;

  var target = window.scrollY;
  var current = target;
  var raf = 0;

  // The last few positions this script asked for. A scroll event reporting
  // any of them is our own write coming back, not somebody else moving the
  // page.
  //
  // Comparing against only the MOST RECENT one is not enough, and getting
  // that wrong is subtle: scroll events are delivered asynchronously and
  // coalesced, so one can arrive describing a position two or three frames
  // old while the animation has already moved on. That reads as an
  // outside interference, the run gets abandoned mid-flight, and the page
  // stops somewhere arbitrary — measured stopping at 69, 529 and 593 on
  // three runs of the same single notch that should have travelled 600.
  var recent = [];

  function limit() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  // The stylesheet sets `html { scroll-behavior: smooth }` so anchor links
  // glide. That has to be switched off while THIS is driving, or the
  // browser animates every position handed to scrollTo — emitting a stream
  // of intermediate positions nobody here asked for, which the listener
  // below then reads as an outside interference and abandons the run on.
  // Two smoothing systems, each smoothing the other's output. It stopped
  // after a single frame.
  //
  // Set for the length of a run rather than per write, which would be a
  // style recalculation every frame, and cleared afterwards so anchors
  // keep their glide.
  function driving(on) {
    document.documentElement.style.scrollBehavior = on ? 'auto' : '';
  }

  function place(y) {
    var to = Math.round(y);
    recent.push(to);
    if (recent.length > 8) recent.shift();
    window.scrollTo(0, to);
  }

  function frame() {
    var gap = target - current;

    // Stop when the remaining distance is under half a pixel; easing
    // towards a target approaches it forever otherwise, and a rAF loop
    // that never ends is a rAF loop that quietly costs battery.
    if (Math.abs(gap) < 0.5) {
      current = target;
      place(current);
      raf = 0;
      driving(false);
      return;
    }

    current += gap * EASE;
    place(current);
    raf = requestAnimationFrame(frame);
  }

  function run() {
    if (!raf) {
      driving(true);
      raf = requestAnimationFrame(frame);
    }
  }

  window.addEventListener('wheel', function (e) {
    // In the lightbox the wheel zooms the photo. Returning before
    // preventDefault leaves that gesture entirely alone.
    if (document.documentElement.classList.contains('is-lightbox')) return;
    if (e.ctrlKey) return;                 // the browser's own zoom

    var d = e.deltaY;
    if (e.deltaMode === 1) d *= LINE;
    else if (e.deltaMode === 2) d *= window.innerHeight;
    if (!d) return;

    e.preventDefault();
    target = Math.min(limit(), Math.max(0, target + d));
    run();
  }, { passive: false });

  // Anything that moved the page WITHOUT going through the wheel — a
  // keyboard, the scrollbar, an anchor, the reveal putting a reloaded
  // page back at the top. Told apart by comparing against the last
  // position this script asked for: if the page is somewhere else, it
  // was someone else, so adopt that position rather than dragging it
  // back to a target that is now meaningless.
  window.addEventListener('scroll', function () {
    var y = Math.round(window.scrollY);
    if (recent.indexOf(y) !== -1) return;     // our own write, arriving late

    // Genuinely somebody else: a keyboard, the scrollbar, an anchor, the
    // reveal putting a reloaded page back at the top. Adopt that position
    // rather than dragging it back to a target that is now meaningless.
    if (raf) { cancelAnimationFrame(raf); raf = 0; driving(false); }
    current = target = y;
    recent.length = 0;
    recent.push(y);
  }, { passive: true });

  window.addEventListener('resize', function () {
    target = Math.min(target, limit());
  });

  // In the same spirit as ezekielAudio() and ezekielMusic(): a way to ask
  // the page what this is actually doing, since "the scroll feels wrong"
  // has several causes that look identical from outside.
  // Run  ezekielScroll()  in the console.
  window.ezekielScroll = function () {
    return {
      target: Math.round(target),
      current: Math.round(current),
      where: Math.round(window.scrollY),
      furthest: limit(),
      moving: !!raf,
      lastWrites: recent.slice()
    };
  };
})();
