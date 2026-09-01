/* ============================================================
   LIGHTBOX — click a photo to see it big
   ============================================================

   Every gallery page loads this. It reads whatever is in .gallery, so
   adding a shoot needs nothing here.

   NO EFFECTS IN HERE, deliberately. The glitch and the reveal are for
   the grid; once a photo is the only thing on screen, the photo is the
   point. The glitch is told to stand down while this is open rather than
   just being covered over — see the class on <html> below, which
   glitch.js checks.

   The markup is built here rather than sitting in eleven HTML files, so
   there is one copy of it and the pages cannot drift apart.
   ============================================================ */

(function () {
  'use strict';

  var figures = Array.prototype.slice.call(
    document.querySelectorAll('.gallery .shot'));
  if (!figures.length) return;

  var shots = figures.map(function (fig) {
    var img = fig.querySelector('img');
    return { src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' };
  });

  var at = 0;
  var openedFrom = null;        // what to give focus back to on close

  /* ---------- the overlay ---------- */

  var box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', 'Photo viewer');
  box.hidden = true;
  box.innerHTML =
    '<button class="lightbox__close" type="button" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>' +
    '</button>' +
    '<button class="lightbox__nav lightbox__prev" type="button" aria-label="Previous photo">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4L7 12l8 8"/></svg>' +
    '</button>' +
    '<img class="lightbox__img" alt="">' +
    '<button class="lightbox__nav lightbox__next" type="button" aria-label="Next photo">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4l8 8-8 8"/></svg>' +
    '</button>' +
    '<p class="lightbox__count" aria-live="polite"></p>';
  document.body.appendChild(box);

  var img = box.querySelector('.lightbox__img');
  var count = box.querySelector('.lightbox__count');
  var closeBtn = box.querySelector('.lightbox__close');
  var prevBtn = box.querySelector('.lightbox__prev');
  var nextBtn = box.querySelector('.lightbox__next');

  // With one photo there is nowhere to flip to, so the arrows would only
  // be furniture.
  if (shots.length < 2) {
    prevBtn.hidden = true;
    nextBtn.hidden = true;
  }

  /* ---------- showing one ---------- */

  // Fetch the neighbours in the background so flipping doesn't blink.
  function warm(i) {
    [i - 1, i + 1].forEach(function (n) {
      var s = shots[(n + shots.length) % shots.length];
      if (s) { var p = new Image(); p.src = s.src; }
    });
  }

  function show(i) {
    at = (i + shots.length) % shots.length;     // wraps both ways
    img.src = shots[at].src;
    img.alt = shots[at].alt;
    count.textContent = (at + 1) + ' / ' + shots.length;
    warm(at);
  }

  function open(i) {
    openedFrom = document.activeElement;
    show(i);
    box.hidden = false;
    // A frame between unhiding and the class, or the fade has nothing to
    // animate from — the element was display:none a moment ago.
    requestAnimationFrame(function () {
      box.classList.add('is-on');
    });
    // Tells glitch.js to stand down, and stops the page behind scrolling.
    document.documentElement.classList.add('is-lightbox');
    closeBtn.focus();
  }

  function close() {
    box.classList.remove('is-on');
    document.documentElement.classList.remove('is-lightbox');
    // Hide only once the fade is done, so it doesn't vanish mid-transition.
    setTimeout(function () {
      if (!box.classList.contains('is-on')) {
        box.hidden = true;
        img.removeAttribute('src');       // let the memory go
      }
    }, 260);
    if (openedFrom && openedFrom.focus) openedFrom.focus();
  }

  /* ---------- wiring ---------- */

  figures.forEach(function (fig, i) {
    // Made operable here rather than in eleven HTML files. A figure is not
    // focusable or clickable on its own, so it is given the role and the
    // keys a button would have.
    fig.setAttribute('role', 'button');
    fig.setAttribute('tabindex', '0');
    fig.setAttribute('aria-label', 'Open photo ' + (i + 1) +
                                   ' of ' + shots.length);
    fig.addEventListener('click', function () { open(i); });
    fig.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(i);
      }
    });
  });

  prevBtn.addEventListener('click', function (e) { e.stopPropagation(); show(at - 1); });
  nextBtn.addEventListener('click', function (e) { e.stopPropagation(); show(at + 1); });
  closeBtn.addEventListener('click', close);

  // Clicking the backdrop closes; clicking the photo itself does not, or
  // aiming at the picture would throw you out of it.
  box.addEventListener('click', function (e) {
    if (e.target === box) close();
  });

  document.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(at - 1);
    else if (e.key === 'ArrowRight') show(at + 1);
    else if (e.key === 'Tab') {
      // Keep Tab inside the dialog while it is open.
      var stops = [closeBtn, prevBtn, nextBtn].filter(function (b) { return !b.hidden; });
      var i = stops.indexOf(document.activeElement);
      var next = e.shiftKey ? i - 1 : i + 1;
      e.preventDefault();
      stops[(next + stops.length) % stops.length].focus();
      return;
    } else return;
    e.preventDefault();
  });

  // Swipe, because on a phone that is what a hand does first. Horizontal
  // only, and only past a threshold, so a scroll or a tap is never read
  // as a flip.
  var x0 = null, y0 = null;
  box.addEventListener('touchstart', function (e) {
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
  }, { passive: true });

  box.addEventListener('touchend', function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    var dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      show(dx < 0 ? at + 1 : at - 1);
    }
    x0 = y0 = null;
  }, { passive: true });
})();
