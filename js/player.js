/* ============================================================
   THE MUSIC PLAYER — fixed bottom-left of the PORTFOLIO page
   ============================================================

   WHAT IT DOES
   Plays Ezekiel's own tracks. "Empty Childhood" always opens; the other
   five are shuffled fresh on every load. Transport buttons, a scrubbable
   timeline, and the track name underneath it.

   IT RUNS ON THE PORTFOLIO AND ON EVERY GALLERY, and carries its queue
   and position between them, so opening a shoot does not restart the
   playlist. A refresh or a direct load DOES start over — see
   arrivedFromTheSite() for how the two are told apart.

   THE HOME PAGE DELIBERATELY HAS NONE OF THIS. No player, no script, no
   audio — it does not even load this file.

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
    vol:    root.querySelector('.player__volume'),
    volFill: root.querySelector('.player__volume-fill'),
    fill:   root.querySelector('.player__fill'),
    title:  root.querySelector('.player__title'),
    time:   root.querySelector('.player__time')
  };

  // Sits under the page rather than on top of it. This is amplitude, not
  // decibels, so the scale is not linear to the ear: 0.45 is about 7dB
  // down from full. Each further step wants to be a RATIO, not a fixed
  // subtraction — 0.36 is the next ~2dB, 0.29 the one after. Taking off a
  // flat 0.1 each time makes the steps sound bigger and bigger as the
  // number gets smaller.
  var VOLUME = 0.45;

  // What un-muting returns to, and what dragging the slider to nothing and
  // back returns to. Without it, mute-then-unmute on a slider left at zero
  // would come back silent and look broken.
  var lastVolume = VOLUME;

  var audio = new Audio();
  audio.preload = 'metadata';   // don't pull down a 5MB track until asked
  // Set once on the element, so it survives every track change — volume
  // belongs to the player, not to the file loaded into it.
  audio.volume = VOLUME;

  var carriedIn = false;        // did this page pick up an existing queue
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

  /* ---------- carrying the music between pages ---------- */

  // sessionStorage, not local: it lives as long as the tab, so it can
  // carry a queue from the portfolio into a gallery and back without
  // remembering anything about you tomorrow.
  var STORE = 'ezekiel-music';
  var pendingSeek = 0;

  function save() {
    try {
      sessionStorage.setItem(STORE, JSON.stringify({
        queue: queue, at: at, time: audio.currentTime,
        muted: audio.muted, volume: audio.volume, playing: !audio.paused
      }));
    } catch (e) {}
  }

  // Resume ONLY when this page was arrived at from elsewhere on the site.
  // A refresh or a direct load starts the playlist over — that is what
  // "the site opens with Empty Childhood" means — while following a link
  // into a shoot and back is one continuous visit and shouldn't restart
  // anything. performance's navigation type is what separates a reload
  // from a real navigation; the referrer is what says it came from here.
  function arrivedFromTheSite() {
    try {
      var nav = performance.getEntriesByType &&
                performance.getEntriesByType('navigation')[0];
      if (nav && nav.type === 'reload') return false;
      if (!document.referrer) return false;
      return new URL(document.referrer).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function restore() {
    try {
      var s = JSON.parse(sessionStorage.getItem(STORE));
      if (s && s.queue && s.queue.length) return s;
    } catch (e) {}
    return null;
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
      unmutedVideos: Array.prototype.filter.call(
        document.querySelectorAll('video'), audible).length,
      pausedByVideo: pausedByVideo,
      carriedFromLastPage: carriedIn,
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

  function paintVolume() {
    // Muted reads as empty rather than as "still at 45%": the crossed-out
    // speaker and a half-full slider next to each other would contradict
    // one another.
    var pct = audio.muted ? 0 : audio.volume * 100;
    els.volFill.style.width = pct + '%';
    els.vol.setAttribute('aria-valuenow', Math.round(pct));
    els.vol.setAttribute('aria-valuetext', Math.round(pct) + '%');
  }

  function setVolume(frac) {
    frac = Math.min(1, Math.max(0, frac));
    audio.volume = frac;
    // Dragging it to nothing IS muting, and dragging up from nothing is
    // unmuting — otherwise the slider and the button would disagree.
    audio.muted = frac === 0;
    if (frac > 0) lastVolume = frac;
    paintVolume();
    paintMute();
    save();
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
    save();
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

  function seekTo(frac) {
    var track = queue[at];
    var total = isFinite(audio.duration) ? audio.duration
                                         : (track ? track.duration : 0);
    if (total) audio.currentTime = frac * total;
    paintProgress();
  }

  // Both tracks behave identically: press anywhere on one to jump there,
  // then keep dragging even after the pointer has left it — which it will,
  // since the track is three pixels tall. Pointer capture is what keeps
  // the events coming once it has.
  function dragTrack(el, onFrac, onStart, onEnd) {
    var down = false;
    function fracAt(e) {
      var r = el.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    }
    el.addEventListener('pointerdown', function (e) {
      down = true;
      if (onStart) onStart();
      el.setPointerCapture(e.pointerId);
      onFrac(fracAt(e));
    });
    el.addEventListener('pointermove', function (e) {
      if (down) onFrac(fracAt(e));
    });
    function up(e) {
      if (!down) return;
      down = false;
      if (onEnd) onEnd();
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    }
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  dragTrack(els.bar, seekTo,
            function () { scrubbing = true; },
            function () { scrubbing = false; });

  dragTrack(els.vol, setVolume);

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

  els.vol.addEventListener('keydown', function (e) {
    var v = audio.muted ? 0 : audio.volume;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp')        setVolume(v + 0.05);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')  setVolume(v - 0.05);
    else if (e.key === 'Home')                                setVolume(0);
    else if (e.key === 'End')                                 setVolume(1);
    else return;
    e.preventDefault();
  });

  /* ---------- wiring ---------- */

  els.toggle.addEventListener('click', function () {
    userPaused = !audio.paused;    // about to pause = they asked for quiet
    pausedByVideo = false;         // their choice outranks the clip's now
    if (userPaused) disarm();
    toggle();
  });
  els.prev.addEventListener('click', function () { step(-1); });
  els.next.addEventListener('click', function () { step(1); });
  els.mute.addEventListener('click', function () {
    audio.muted = !audio.muted;
    // Coming back from a slider dragged to zero would otherwise unmute
    // into silence, which reads as a broken button.
    if (!audio.muted && audio.volume === 0) audio.volume = lastVolume || VOLUME;
    paintMute();
    paintVolume();
    save();
  });

  /* ---------- a video being watched wins ---------- */

  // NOT "a video is playing". The clips on this page autoplay muted as
  // moving stills, so that is true of every one of them from the moment it
  // scrolls into view — hanging the music off it would silence the site on
  // load. Being UNMUTED is the real signal: it is the only moment two
  // pieces of audio would actually fight.
  function audible(v) {
    return !v.muted && v.volume > 0;
  }

  // Remembers whether the music stopped because of a clip or because the
  // visitor said so. Without the distinction, re-muting a clip would drag
  // the music back on top of someone who had deliberately paused it.
  var pausedByVideo = false;

  function checkVideos() {
    var busy = false;
    for (var i = 0; i < videos.length; i++) {
      if (audible(videos[i])) { busy = true; break; }
    }

    if (busy) {
      if (!audio.paused) {
        pausedByVideo = true;
        disarm();           // the first-gesture fallback must not undo this
        audio.pause();
      }
    } else if (pausedByVideo) {
      pausedByVideo = false;
      if (!userPaused) start();
    }
  }

  // Going fullscreen means settling in to watch, so the clip unmutes
  // itself — which then trips the check above and stops the music. Done
  // here rather than by muting the music, so the clip's own control still
  // shows the truth about its state.
  function wentFullscreen(v) {
    if (v.muted) v.muted = false;   // fires volumechange -> checkVideos
    else checkVideos();
  }

  var videos = document.querySelectorAll('video');

  Array.prototype.forEach.call(videos, function (v) {
    v.addEventListener('volumechange', checkVideos);
    // iOS Safari doesn't use the Fullscreen API for video at all — it has
    // its own pair of events on the element instead.
    v.addEventListener('webkitbeginfullscreen', function () { wentFullscreen(v); });
  });

  ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (name) {
    document.addEventListener(name, function () {
      var el = document.fullscreenElement || document.webkitFullscreenElement;
      if (!el) return;                        // that was an exit, not an entry
      var v = el.tagName === 'VIDEO' ? el
            : (el.querySelector ? el.querySelector('video') : null);
      if (v) wentFullscreen(v);
    });
  });

  // Written on a timer rather than on every timeupdate, which fires
  // several times a second, and once more on the way out.
  setInterval(function () { if (!audio.paused) save(); }, 2000);
  window.addEventListener('pagehide', save);

  // The speaker in the page header, when there is one. Browsers won't let
  // a page start audio on load, so that click is often the first moment
  // music is allowed to play at all — which is exactly why it drives it.
  // Symmetrical on purpose: switching sound off pauses the music too,
  // rather than leaving it running under a header that says muted.
  window.addEventListener('ezekiel:sound', function (e) {
    var on = e.detail && e.detail.on;
    disarm();
    pausedByVideo = false;
    userPaused = !on;
    if (on) start(); else audio.pause();
  });

  audio.addEventListener('timeupdate', function () {
    if (!scrubbing) paintProgress();
  });
  audio.addEventListener('loadedmetadata', function () {
    // Seeking before the metadata arrives does not stick, so a position
    // carried from the previous page is held until the file knows how
    // long it is.
    if (pendingSeek) {
      audio.currentTime = pendingSeek;
      pendingSeek = 0;
    }
    paintProgress();
  });
  audio.addEventListener('play', function () { paintToggle(); save(); });
  audio.addEventListener('pause', function () { paintToggle(); save(); });
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

      var carried = arrivedFromTheSite() ? restore() : null;

      carriedIn = !!carried;
      if (carried) {
        // Same visit, another page: pick the needle up where it was.
        queue = carried.queue;
        audio.muted = !!carried.muted;
        if (typeof carried.volume === 'number') audio.volume = carried.volume;
        if (audio.volume > 0) lastVolume = audio.volume;
        pendingSeek = carried.time || 0;
        load(carried.at, false);
        if (carried.playing) start(); else userPaused = true;
      } else {
        // The first track is pinned by the build script and stays put;
        // only the tail is shuffled, so a fresh visit opens on Empty
        // Childhood and never repeats the same order after it.
        queue = [tracks[0]].concat(shuffle(tracks.slice(1)));
        load(0, false);
        start();
      }

      paintToggle();
      paintMute();
      paintVolume();
      root.hidden = false;       // only ever shown once it can actually play
    })
    .catch(function () { /* no playlist: the page is simply silent */ });
})();
