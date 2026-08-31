/* ============================================================
   THE MUSIC PLAYER — fixed bottom-left of the PORTFOLIO page
   ============================================================

   WHAT IT DOES
   Plays Ezekiel's own tracks. "Empty Childhood" always opens; the other
   five are shuffled fresh on every load. Transport buttons, a scrubbable
   timeline, and the track name underneath it.

   THE HOME PAGE DELIBERATELY HAS NONE OF THIS. No player, no script, no
   audio — it doesn't even load this file. Everything that makes a sound
   or an effect lives on the portfolio page and nowhere else.

   TWO THINGS WORTH KNOWING BEFORE CHANGING ANYTHING

   1. The playlist is not in here. It's audio/tracks.json, written by
      tools/build_audio.py. Adding a song means dropping a WAV in
      Music/Zeek Site and re-running that script — no code to edit.

   2. Browsers refuse to let a page make a sound before the visitor has
      interacted with it. So this tries to play on load, and if it's
      turned down, it waits and starts on the first click or key press —
      including the speaker in the header, which drives it deliberately.
      Everything is built up front either way, so the player is on screen
      and pausable from the very first frame; nobody should hear a sound
      they can't immediately find the source of.
   ============================================================ */

(function () {
  'use strict';

  var root = document.querySelector('.player');
  if (!root) return;

  var els = {
    prev:   root.querySelector('.player__prev'),
    toggle: root.querySelector('.player__toggle'),
    next:   root.querySelector('.player__next'),
    mute:   root.querySelector('.player__mute'),
    bar:    root.querySelector('.player__bar'),
    fill:   root.querySelector('.player__fill'),
    title:  root.querySelector('.player__title'),
    time:   root.querySelector('.player__time')
  };

  // Sits under the page rather than on top of it. This is amplitude, not
  // decibels, so the scale is not linear to the ear: 0.55 is about 5dB
  // down from full. Each further step wants to be a RATIO, not a fixed
  // subtraction — 0.45 is the next ~2dB, 0.35 the one after. Taking off a
  // flat 0.1 each time makes the steps sound bigger and bigger as the
  // number gets smaller.
  var VOLUME = 0.55;

  var audio = new Audio();
  audio.preload = 'metadata';   // don't pull down a 5MB track until asked
  // Set once on the element, so it survives every track change — volume
  // belongs to the player, not to the file loaded into it.
  audio.volume = VOLUME;

  var queue = [];               // the shuffled playlist
  var at = 0;                   // index into it
  var scrubbing = false;

  /* ---------- the playlist ---------- */

  // Fisher-Yates. Every position gets an equal chance, which the
  // "sort by random" one-liner does NOT give you — that one leans towards
  // leaving things near where they started.
  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = list[i]; list[i] = list[j]; list[j] = t;
    }
    return list;
  }

  // A way to ask the page what the player is doing, in the same spirit as
  // ezekielAudio() in glitch.js. Run  ezekielMusic()  in the console.
  window.ezekielMusic = function () {
    return {
      order: queue.map(function (t) { return t.title; }),
      playing: queue[at] ? queue[at].title : null,
      position: Math.round(audio.currentTime) + 's',
      paused: audio.paused,
      muted: audio.muted,
      volume: audio.volume,
      pausedByVisitor: userPaused
    };
  };

  /* ---------- painting ---------- */

  function mmss(secs) {
    if (!isFinite(secs) || secs < 0) secs = 0;
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function paintProgress() {
    var track = queue[at];
    if (!track) return;
    // audio.duration is NaN until the metadata arrives, so fall back to
    // the length the build script measured — that way the timeline is
    // the right length from the first frame instead of snapping later.
    var total = isFinite(audio.duration) ? audio.duration : track.duration;
    var now = audio.currentTime;
    var pct = total ? (now / total) * 100 : 0;
    els.fill.style.width = pct + '%';
    els.time.textContent = mmss(now) + ' / ' + mmss(total);
    els.bar.setAttribute('aria-valuenow', Math.round(now));
    els.bar.setAttribute('aria-valuemax', Math.round(total) || 0);
    els.bar.setAttribute('aria-valuetext',
      mmss(now) + ' of ' + mmss(total) + ', ' + track.title);
  }

  function paintToggle() {
    var playing = !audio.paused;
    els.toggle.setAttribute('aria-pressed', String(playing));
    els.toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    root.classList.toggle('is-playing', playing);
  }

  function paintMute() {
    els.mute.setAttribute('aria-pressed', String(!audio.muted));
    els.mute.setAttribute('aria-label', audio.muted ? 'Unmute music'
                                                    : 'Mute music');
    root.classList.toggle('is-muted', audio.muted);
  }

  /* ---------- transport ---------- */

  function load(index, andPlay) {
    at = (index + queue.length) % queue.length;   // wraps both ways
    var track = queue[at];
    audio.src = track.src;
    els.title.textContent = track.title;
    paintProgress();
    if (andPlay) start();
  }

  // play() returns a promise that REJECTS when the browser blocks it.
  // Unhandled, that shows up as an error in the console and the UI is left
  // claiming to be playing when it isn't, so it's caught either way.
  function start() {
    var p = audio.play();
    if (p && p.catch) {
      p.catch(function () { paintToggle(); waitForGesture(); });
    }
  }

  function toggle() {
    if (audio.paused) start(); else audio.pause();
  }

  function step(by) {
    // Standard behaviour, and the reason "previous" isn't just at-1: once
    // you're a few seconds in, the first press restarts the track and only
    // a second press goes back.
    if (by < 0 && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    load(at + by, true);
  }

  /* ---------- the first gesture ---------- */

  // Armed only if autoplay was refused. One shot: it plays, then takes
  // itself off every event it was listening to. It also stands down for
  // good if the visitor presses pause in the meantime — starting music
  // under someone who has just told it not to would be obnoxious.
  var armed = false;
  var GESTURES = ['pointerdown', 'keydown', 'touchstart'];

  function onGesture() {
    disarm();
    if (!userPaused) start();
  }

  function waitForGesture() {
    if (armed || userPaused) return;
    armed = true;
    GESTURES.forEach(function (ev) {
      window.addEventListener(ev, onGesture, { passive: true, once: true });
    });
  }

  function disarm() {
    armed = false;
    GESTURES.forEach(function (ev) {
      window.removeEventListener(ev, onGesture);
    });
  }

  var userPaused = false;

  /* ---------- scrubbing ---------- */

  function seekTo(clientX) {
    var r = els.bar.getBoundingClientRect();
    var frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    var track = queue[at];
    var total = isFinite(audio.duration) ? audio.duration
                                         : (track ? track.duration : 0);
    if (total) audio.currentTime = frac * total;
    paintProgress();
  }

  els.bar.addEventListener('pointerdown', function (e) {
    scrubbing = true;
    // Capture means the drag keeps working after the pointer leaves the
    // bar, which it will — the bar is a few pixels tall.
    els.bar.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  });

  els.bar.addEventListener('pointermove', function (e) {
    if (scrubbing) seekTo(e.clientX);
  });

  function endScrub(e) {
    if (!scrubbing) return;
    scrubbing = false;
    if (els.bar.hasPointerCapture(e.pointerId)) {
      els.bar.releasePointerCapture(e.pointerId);
    }
  }
  els.bar.addEventListener('pointerup', endScrub);
  els.bar.addEventListener('pointercancel', endScrub);

  // Keyboard: the bar is a real slider, so arrows nudge and Home/End jump.
  els.bar.addEventListener('keydown', function (e) {
    var total = isFinite(audio.duration) ? audio.duration : 0;
    var step5 = 5;
    if (e.key === 'ArrowRight')      audio.currentTime += step5;
    else if (e.key === 'ArrowLeft')  audio.currentTime -= step5;
    else if (e.key === 'Home')       audio.currentTime = 0;
    else if (e.key === 'End')        audio.currentTime = Math.max(0, total - 1);
    else return;
    e.preventDefault();
    paintProgress();
  });

  /* ---------- wiring ---------- */

  els.toggle.addEventListener('click', function () {
    userPaused = !audio.paused;    // about to pause = they asked for quiet
    if (userPaused) disarm();
    toggle();
  });
  els.prev.addEventListener('click', function () { step(-1); });
  els.next.addEventListener('click', function () { step(1); });
  els.mute.addEventListener('click', function () {
    audio.muted = !audio.muted;
    paintMute();
  });

  // The speaker in the page header, when there is one. Browsers won't let
  // a page start audio on load, so that click is often the first moment
  // music is allowed to play at all — which is exactly why it drives it.
  // Symmetrical on purpose: switching sound off pauses the music too,
  // rather than leaving it running under a header that says muted.
  window.addEventListener('ezekiel:sound', function (e) {
    var on = e.detail && e.detail.on;
    disarm();
    userPaused = !on;
    if (on) start(); else audio.pause();
  });

  audio.addEventListener('timeupdate', function () {
    if (!scrubbing) paintProgress();
  });
  audio.addEventListener('loadedmetadata', paintProgress);
  audio.addEventListener('play', paintToggle);
  audio.addEventListener('pause', paintToggle);
  audio.addEventListener('ended', function () { load(at + 1, true); });

  // A track that won't load shouldn't strand the player on it forever.
  audio.addEventListener('error', function () {
    if (queue.length > 1) load(at + 1, !audio.paused);
  });

  /* ---------- go ---------- */

  fetch('audio/tracks.json')
    .then(function (r) { return r.json(); })
    .then(function (tracks) {
      if (!tracks || !tracks.length) return;

      // The first track is pinned by the build script and stays put; only
      // the tail is shuffled, so every load opens on Empty Childhood and
      // never repeats the same order after it.
      //
      // Nothing is remembered between loads. That was here to carry the
      // music from the home page to the portfolio, and the home page no
      // longer has a player — keeping it would have meant the portfolio
      // sometimes opening mid-track on something else.
      queue = [tracks[0]].concat(shuffle(tracks.slice(1)));
      load(0, false);
      start();

      paintToggle();
      paintMute();
      root.hidden = false;       // only ever shown once it can actually play
    })
    .catch(function () { /* no playlist: the page is simply silent */ });
})();
