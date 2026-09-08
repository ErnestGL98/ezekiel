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

  /* ---------- zoom and pan ---------- */

  var MAX = 6;              // any further and a 1200px file is just mush
  var scale = 1, tx = 0, ty = 0;

  function paint() {
    img.style.transform =
      'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) ' +
      'scale(' + scale.toFixed(4) + ')';
    box.classList.toggle('is-zoomed', scale > 1.01);
  }

  // Keep the photo covering the box it started in. Transform-origin is
  // the centre, so the travel either way is half of what the scaling
  // added — past that you would be dragging the picture off its own
  // frame and panning into empty space.
  function clampPan() {
    var w = img.offsetWidth, h = img.offsetHeight;
    var maxX = Math.max(0, (w * scale - w) / 2);
    var maxY = Math.max(0, (h * scale - h) / 2);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
  }

  function resetZoom() {
    scale = 1; tx = 0; ty = 0;
    paint();
  }

  // Zoom ABOUT A POINT rather than the middle: whatever is under the
  // cursor stays under the cursor. Zooming from the centre means
  // constantly dragging back to whatever you were actually looking at.
  function zoomAt(clientX, clientY, factor) {
    var was = scale;
    scale = Math.min(MAX, Math.max(1, scale * factor));
    if (scale === was) return;

    var r = img.getBoundingClientRect();
    var dx = clientX - (r.left + r.width / 2);
    var dy = clientY - (r.top + r.height / 2);
    var k = scale / was;
    tx -= dx * (k - 1);
    ty -= dy * (k - 1);

    if (scale === 1) { tx = 0; ty = 0; }   // snap back square when fully out
    clampPan();
    paint();
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
    resetZoom();                 // a new photo starts square, never mid-zoom
    img.src = shots[at].src;
    img.alt = shots[at].alt;
    count.textContent = (at + 1) + ' / ' + shots.length;
    warm(at);
  }

  function open(i) {
    openedFrom = document.activeElement;
    resetZoom();
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
  // aiming at the picture would throw you out of it. A drag that ends over
  // the backdrop is not a click on it either — releasing a pan outside the
  // photo would otherwise shut the whole thing.
  box.addEventListener('click', function (e) {
    if (dragged) { dragged = false; return; }
    if (e.target === box) close();
  });

  /* ---------- the mouse ---------- */

  box.addEventListener('wheel', function (e) {
    e.preventDefault();          // js/scroll.js has already stood aside

    var d = e.deltaY;
    if (e.deltaMode === 1) d *= 16;          // Firefox reports lines
    else if (e.deltaMode === 2) d *= 400;    // and some report pages

    // Proportional to the gesture, and a RATIO rather than a fixed step:
    // one notch of a mouse wheel arrives as a single large delta while a
    // trackpad sends a stream of small ones, and both should feel like
    // the same amount of zoom. Multiplying is also what makes 1x to 2x
    // feel like 4x to 8x, which adding never does.
    zoomAt(e.clientX, e.clientY, Math.exp(-d * 0.0016));
  }, { passive: false });

  img.addEventListener('dblclick', function (e) {
    e.preventDefault();
    if (scale > 1.01) resetZoom();
    else zoomAt(e.clientX, e.clientY, 3);
  });

  var dragging = false, dragged = false;
  var startX = 0, startY = 0, fromX = 0, fromY = 0;

  img.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') return;    // touch is handled below
    if (scale <= 1.01) return;                // nothing to pan yet
    dragging = true; dragged = false;
    startX = e.clientX; startY = e.clientY;
    fromX = tx; fromY = ty;
    img.setPointerCapture(e.pointerId);
    e.preventDefault();                       // don't drag the image as a file
  });

  img.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged = true;
    tx = fromX + dx;
    ty = fromY + dy;
    clampPan();
    paint();
  });

  ['pointerup', 'pointercancel'].forEach(function (name) {
    img.addEventListener(name, function (e) {
      if (!dragging) return;
      dragging = false;
      if (img.releasePointerCapture) {
        try { img.releasePointerCapture(e.pointerId); } catch (err) {}
      }
    });
  });

  document.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    // Escape backs out of a zoom first, and only closes once the photo is
    // square again — the same key doing the least destructive thing first.
    if (e.key === 'Escape') { if (scale > 1.01) resetZoom(); else close(); }
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

  /* ---------- fingers ---------- */

  // One finger means two different things depending on how far in you
  // are: flip to the next photo when the picture fits, move the picture
  // when it doesn't. Two fingers always mean pinch.
  var x0 = null, y0 = null;
  var pinchFrom = 0, pinchScale = 1;

  function spread(t) {
    var dx = t[0].clientX - t[1].clientX;
    var dy = t[0].clientY - t[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function midpoint(t) {
    return [(t[0].clientX + t[1].clientX) / 2,
            (t[0].clientY + t[1].clientY) / 2];
  }

  box.addEventListener('touchstart', function (e) {
    if (e.touches.length === 2) {
      pinchFrom = spread(e.touches);
      pinchScale = scale;
      x0 = y0 = null;                  // a pinch is never a swipe
    } else if (e.touches.length === 1) {
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      fromX = tx; fromY = ty;
    }
  }, { passive: true });

  box.addEventListener('touchmove', function (e) {
    if (e.touches.length === 2 && pinchFrom) {
      e.preventDefault();
      var mid = midpoint(e.touches);
      var want = pinchScale * (spread(e.touches) / pinchFrom);
      zoomAt(mid[0], mid[1], Math.min(MAX, Math.max(1, want)) / scale);
      return;
    }
    // Panning only once there is something to pan; below that the finger
    // is still free to mean "next photo".
    if (e.touches.length === 1 && scale > 1.01 && x0 !== null) {
      e.preventDefault();
      tx = fromX + (e.touches[0].clientX - x0);
      ty = fromY + (e.touches[0].clientY - y0);
      clampPan();
      paint();
    }
  }, { passive: false });

  box.addEventListener('touchend', function (e) {
    if (e.touches.length === 0) pinchFrom = 0;
    if (x0 === null || scale > 1.01) { x0 = y0 = null; return; }
    var dx = e.changedTouches[0].clientX - x0;
    var dy = e.changedTouches[0].clientY - y0;
    // Horizontal only, and only past a threshold, so a tap or a stray
    // vertical drag is never read as a flip.
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      show(dx < 0 ? at + 1 : at - 1);
    }
    x0 = y0 = null;
  }, { passive: true });
})();
