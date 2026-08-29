/* ============================================================
   HOVER GLITCH — CRT / VHS tear effect for the portfolio tiles
   ============================================================

   WHAT IT DOES
   Hovering a shoot cover tears it into horizontal bands that jitter
   sideways, fray off the right edge in thinning strands, and rumble.

   WHY IT'S WRITTEN THIS WAY (the short version)

   The effect has to hit the BLACKS of a photo and leave the whites
   alone. CSS can't do that — it has no way to ask "how dark is this
   pixel of the image?" So the glitch is drawn by a small WebGL
   program (a shader), which gets to look at every pixel and decide.

   The shader draws ONLY the glitch, on a transparent canvas laid over
   the real <img>. So the untouched parts aren't a copy of the photo,
   they're the actual photo showing through — highlights stay
   pixel-perfect no matter what.

   One canvas is shared by all the tiles and moved to whichever one is
   hovered, so there's a single WebGL context on the page rather than
   eleven, and it only animates while a tile is actually hovered.

   TUNING — the numbers worth touching are in CONFIG below.
   ============================================================ */

(function () {
  'use strict';

  var CONFIG = {
    tail: 0.42,        // how far past the right edge strands reach,
                       // as a fraction of the image's width
    rowPx: 2.5,        // height of one torn band, in canvas pixels
    density: 0.62,     // fraction of bands glitching at any moment. Higher
                       // than it used to be because each band now only
                       // paints along its own trail rather than the full row.
    shear: 0.20,       // how far bands slide sideways (fraction of width)
    keyLow: 0.10,      // luminance at/below this = full effect (blacks)
    keyHigh: 0.52,     // luminance at/above this = only the floor below
    keyFloor: 0.0,     // how much the highlights still contribute, 0 to 1.
                       // 0 = they don't, which is what keeps the effect
                       // reading as coming out of the shadows only.
    vividFrom: 0.45,   // saturation where a colour starts counting as
    vividTo: 0.72,     // "intense" and becomes eligible regardless of
                       // how bright it is
    vividAmt: 0.85,    // how strongly intense colours qualify, 0 to 1
    skinGuard: 0.95,   // how hard skin tones are protected, 0 to 1
    crush: 7.0,        // colour levels per channel — lower is more crushed
    blockPx: 3.0,      // horizontal pixelation, in pixels
    aberration: 10.5,  // colour-fringe split, in pixels
    volume: 0.24,      // rumble loudness, 0 to 1
    crushLevels: 20,   // steps the waveform is quantised to. Fewer = harsher,
                       // but too few and it lurches rather than rumbles.
    crushHold: 12,     // samples each value is held for. More = coarser.
                       // Together with crushLevels this sets how big a jump
                       // the waveform makes each step: keep it well under
                       // about a third of the signal's own size or it stops
                       // sounding like a rumble and starts sounding broken.
    rumbleHz: 230,     // lowpass cutoff. This is the one that decides how
                       // much of the crunch you actually hear: too low and
                       // the grit is filtered off and it's just a hum.
    drive: 2.8,        // saturation. Generates harmonics of the low rumble
                       // higher up, so small speakers - which cannot
                       // reproduce anything under ~200Hz - still play
                       // something and your ear fills in the rest.
    wander: 0.012      // how fast the noise drifts. THIS is the knob that
                       // decides how low the rumble sits - smaller drifts
                       // more slowly and sits lower. Counter-intuitively,
                       // reducing the bit-crushing alone makes it brighter
                       // rather than deeper, because a coarser hold is
                       // also a slower-moving source.
  };

  // Respect the OS "reduce motion" setting — this effect is exactly the
  // kind of thing that switch exists for.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Hover isn't a thing on touch screens; don't build any of this there.
  if (!window.matchMedia('(hover: hover)').matches) return;

  // Covers, plus the Paris stills. Deliberately NOT the Paris clips —
  // tearing up a playing video reads as a broken player rather than an
  // effect, and it would fight the controls.
  var SELECTOR = '.tile__frame, .media--still';
  var tiles = document.querySelectorAll(SELECTOR);
  if (!tiles.length) return;

  /* ---------- the shader ---------- */

  var VERT = [
    'attribute vec2 aPos;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPos * 0.5 + 0.5;',
    '  gl_Position = vec4(aPos, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec2  uRes;      // canvas size in pixels',
    'uniform float uTime;',
    'uniform float uImgFrac;  // how much of the canvas the photo occupies',
    'uniform float uSeed;',
    'uniform float uRowPx;',
    'uniform float uDensity;',
    'uniform float uShear;',
    'uniform float uKeyLow;',
    'uniform float uKeyHigh;',
    'uniform float uCrush;',
    'uniform float uBlockPx;',
    'uniform float uKeyFloor;',
    'uniform float uAberr;',
    'uniform float uVividFrom;',
    'uniform float uVividTo;',
    'uniform float uVividAmt;',
    'uniform float uSkinGuard;',
    '',
    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    'float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
    '',
    '// hue / saturation / value, so the effect can tell a vivid colour',
    '// apart from a muted one of the same brightness',
    'vec3 rgb2hsv(vec3 c) {',
    '  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);',
    '  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));',
    '  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));',
    '  float d = q.x - min(q.w, q.y);',
    '  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)),',
    '              d / (q.x + 1e-10), q.x);',
    '}',
    '',
    '// HOW MUCH A GIVEN COLOUR IS ALLOWED TO GLITCH.',
    '// One function, used both to choose where a band tears from and to',
    '// shade it, so the two can never disagree about what qualifies.',
    'float eligibility(vec3 c) {',
    '  vec3 hsv = rgb2hsv(c);',
    '  float hue = hsv.x, sat = hsv.y, val = hsv.z;',
    '',
    '  // shadows and blacks: the main source',
    '  float k = 1.0 - smoothstep(uKeyLow, uKeyHigh, luma(c));',
    '',
    '  // intense colour also qualifies, however bright it is — the orange',
    '  // coat, the green mohawk, the tie-dye',
    '  k = max(k, smoothstep(uVividFrom, uVividTo, sat) * uVividAmt);',
    '',
    '  // ...but not skin. Skin sits in a narrow orange-red hue band at only',
    '  // moderate saturation. Vivid oranges share the hue but are far more',
    '  // saturated, and that gap is what separates a jacket from a face.',
    '  float sHue = smoothstep(0.005, 0.02, hue) * (1.0 - smoothstep(0.10, 0.14, hue));',
    '  float sSat = smoothstep(0.08, 0.18, sat) * (1.0 - smoothstep(0.52, 0.70, sat));',
    '  float skin = sHue * sSat * smoothstep(0.12, 0.22, val);',
    '  k *= 1.0 - skin * uSkinGuard;',
    '',
    '  return max(k, uKeyFloor);',
    '}',
    '',
    'void main() {',
    '  vec2 uv = vUv;',
    '',
    '  // --- unstable clock -------------------------------------------',
    '  // Time is chopped into steps rather than flowing smoothly, so the',
    '  // effect stutters and flickers instead of sliding. Two rates beat',
    '  // against each other so the rhythm never settles.',
    '  float slow = floor(uTime * 15.0);',
    '  float fast = floor(uTime * 53.0);',
    '  float flick = hash(vec2(fast, uSeed));',
    '',
    '  // --- horizontal bands -----------------------------------------',
    '  float row  = floor((uv.y * uRes.y) / uRowPx);',
    '  float rRow = hash(vec2(row, slow + uSeed));',
    '',
    '  // x in "image space": 0..1 across the photo, >1 out in the tail',
    '  float ix = uv.x / uImgFrac;',
    '',
    '  // --- how far this band slides ----------------------------------',
    '  float dr = hash(vec2(row, slow * 1.7 + uSeed + 5.0));',
    '  float shear = (dr - 0.35) * uShear * (0.35 + 0.65 * flick);',
    '',
    '  // --- where the tear starts ---------------------------------------',
    '  // The trail has to BEGIN in shadow. Picking the start point at',
    '  // random meant plenty of trails started on white backdrop and',
    '  // streaked out of nowhere, which is what made it look untidy.',
    '  //',
    '  // So probe several points across this row and tear from whichever',
    '  // one most qualifies (see eligibility above — deep shadow, or strong',
    '  // colour, but never skin). Costs a few extra texture reads, and it',
    '  // is what makes the effect look dragged out of the picture rather',
    '  // than sprayed across it.',
    '  float bestX = 0.5;',
    '  float bestE = 0.0;',
    '  for (int i = 0; i < 6; i++) {',
    '    float cx = hash(vec2(row, uSeed + 31.0 + float(i) * 7.3));',
    '    float ce = eligibility(texture2D(uTex, vec2(cx, uv.y)).rgb);',
    '    if (ce > bestE) { bestE = ce; bestX = cx; }',
    '  }',
    '',
    '  // If nothing in this row qualifies — no shadow, no strong colour,',
    '  // just skin or backdrop — the row produces nothing at all, rather',
    '  // than a faint streak out of a highlight.',
    '  float originKey = bestE;',
    '',
    '  // nudge off the exact darkest pixel so the starts do not line up',
    '  float x0 = clamp(bestX + (hash(vec2(row, uSeed + 3.0)) - 0.5) * 0.03, 0.0, 0.92);',
    '',
    '  // --- the trail ---------------------------------------------------',
    '  // From that tear point the band streaks right, carrying on past the',
    '  // edge in one continuous run. Drawing strands only in the strip',
    '  // outside the frame was what made them look like they were crawling',
    '  // out from underneath it — they had nothing to be attached to.',
    '  float far = (1.0 / uImgFrac) - x0;          // distance to the far right',
    '  // most trails are short, a few run the whole way: that spread is',
    '  // what reads as fraying rather than as uniform stripes',
    '  float reach = mix(0.18, far, pow(hash(vec2(row, slow * 0.37 + uSeed + 11.0)), 1.35));',
    '',
    '  float d = ix - x0;                          // distance along the trail',
    '  float onTrail = step(0.0, d) * step(d, reach);',
    '  // thins out along its length, densest at the tear',
    '  float fall = pow(1.0 - clamp(d / max(reach, 0.0001), 0.0, 1.0), 1.4);',
    '',
    '  float active = step(1.0 - uDensity, rRow);',
    '  // rare full-width bursts',
    '  active = max(active, step(0.988, hash(vec2(row * 0.5, fast))));',
    '',
    '  // --- where to read the photo from ------------------------------',
    '  // Content is dragged from the tear point and stretched along the',
    '  // trail, so the streak carries the picture with it instead of being',
    '  // invented once it clears the frame.',
    '  float srcX = x0 + d * 0.20 - shear;',
    '',
    '  // bit-crush horizontally: snap to blocks so it reads as pixels',
    '  float blocks = uRes.x / uBlockPx;',
    '  srcX = floor(srcX * blocks) / blocks;',
    '  vec2 srcUv = clamp(vec2(srcX, uv.y), 0.0, 1.0);',
    '',
    '  // --- the luminance key -----------------------------------------',
    '  // Keyed on the pixel being TORN, not on the pixel it lands on. That',
    '  // is what lets a band of shadow fly across a bright part of the',
    '  // picture: the effect is chosen by where its content came from, so',
    '  // it can overlay highlights instead of being blocked by them.',
    '  vec3 pulled = texture2D(uTex, srcUv).rgb;',
    '  float key = eligibility(pulled);',
    '',
    '  // --- colour ------------------------------------------------------',
    '  // Channel split — red and blue read from either side of green, the',
    '  // giveaway of knackered analogue video. The width breathes with the',
    '  // flicker so the fringing never sits still.',
    '  float ca = (uAberr * (0.45 + 0.85 * flick)) / uRes.x;',
    '  vec3 col = vec3(',
    '    texture2D(uTex, clamp(srcUv + vec2(ca, 0.0), 0.0, 1.0)).r,',
    '    pulled.g,',
    '    texture2D(uTex, clamp(srcUv - vec2(ca, 0.0), 0.0, 1.0)).b',
    '  );',
    '',
    '  // crush the colour depth',
    '  col = floor(col * uCrush + 0.5) / uCrush;',
    '',
    '  // lift the crushed shadows slightly so the tear is visible against',
    '  // near-black, and tint it cold like a bad tape',
    '  col = col * 1.35 + vec3(0.02, 0.03, 0.05);',
    '',
    '  // CRT scanline within each band',
    '  float scan = 0.82 + 0.18 * step(0.5, fract((uv.y * uRes.y) / 3.0));',
    '  col *= scan;',
    '',
    '  // --- final strength ----------------------------------------------',
    '  float a = key * originKey * active * onTrail * fall;',
    '  a *= 0.66 + 0.42 * flick;                 // flicker the whole thing',
    '  a *= step(0.001, uImgFrac);',
    '',
    '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));',
    '}'
  ].join('\n');

  /* ---------- WebGL setup ---------- */

  var canvas = document.createElement('canvas');
  canvas.className = 'glitch-layer';
  var gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false
  });
  if (!gl) return;                       // no WebGL: silently keep the plain site

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('glitch shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('glitch link:', gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  // one full-screen triangle pair
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  var U = {};
  ['uTex', 'uRes', 'uTime', 'uImgFrac', 'uSeed', 'uRowPx', 'uDensity',
   'uShear', 'uKeyLow', 'uKeyHigh', 'uCrush', 'uBlockPx',
   'uKeyFloor', 'uAberr', 'uVividFrom', 'uVividTo', 'uVividAmt',
   'uSkinGuard'].forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
  });

  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.uniform1i(U.uTex, 0);
  gl.uniform1f(U.uRowPx, CONFIG.rowPx);
  gl.uniform1f(U.uDensity, CONFIG.density);
  gl.uniform1f(U.uShear, CONFIG.shear);
  gl.uniform1f(U.uKeyLow, CONFIG.keyLow);
  gl.uniform1f(U.uKeyHigh, CONFIG.keyHigh);
  gl.uniform1f(U.uCrush, CONFIG.crush);
  gl.uniform1f(U.uBlockPx, CONFIG.blockPx);
  gl.uniform1f(U.uKeyFloor, CONFIG.keyFloor);
  gl.uniform1f(U.uAberr, CONFIG.aberration);
  gl.uniform1f(U.uVividFrom, CONFIG.vividFrom);
  gl.uniform1f(U.uVividTo, CONFIG.vividTo);
  gl.uniform1f(U.uVividAmt, CONFIG.vividAmt);
  gl.uniform1f(U.uSkinGuard, CONFIG.skinGuard);

  document.body.appendChild(canvas);
  document.documentElement.classList.add('js-glitch');

  /* ---------- the rumble ---------- */

  var Audio_ = {
    ctx: null, gain: null, ready: false,

    build: function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();

      // Build the rumble by hand rather than loading a file: brown noise
      // (white noise smoothed, which piles energy into the low end), then
      // wrecked on purpose.
      var dur = 3.0;
      var buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      var d = buffer.getChannelData(0);
      var brown = 0, held = 0, countdown = 0;
      var HOLD = CONFIG.crushHold;    // reuse each sample this many times, so
                                      // the sample rate collapses to a few
                                      // hundred Hz — the gritty half of
                                      // "bit-crushed"
      var LEVELS = CONFIG.crushLevels; // quantising the value is the other half
      for (var i = 0; i < d.length; i++) {
        if (countdown <= 0) {
          brown = (brown + CONFIG.wander * (Math.random() * 2 - 1))
                  / (1 + CONFIG.wander);
          held = Math.round(brown * 9.0 * LEVELS) / LEVELS;
          countdown = HOLD;
        }
        countdown--;
        d[i] = Math.max(-1, Math.min(1, held));
      }

      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      // Keeps it a rumble rather than a hiss — but not so tight that it
      // filters off the crunch that makes it sound crushed in the first
      // place. A little resonance at the cutoff gives it some edge.
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = CONFIG.rumbleHz;
      lp.Q.value = 1.3;

      // Drive it into soft saturation. 75% of this rumble's energy sits
      // below 200Hz, which laptop speakers simply cannot move air at, so
      // without this most of the sound never reaches the listener at all.
      // Saturating adds harmonics further up that DO play, and the ear
      // reconstructs the missing fundamental from them.
      var pre = ctx.createGain();
      pre.gain.value = 3.2;
      var shaper = ctx.createWaveShaper();
      var n = 1024, curve = new Float32Array(n);
      for (var j = 0; j < n; j++) {
        var x = (j * 2) / (n - 1) - 1;
        curve[j] = Math.tanh(x * CONFIG.drive);
      }
      shaper.curve = curve;
      shaper.oversample = '2x';

      var hp = ctx.createBiquadFilter();      // clear the inaudible sub
      hp.type = 'highpass';
      hp.frequency.value = 40;

      var gain = ctx.createGain();
      gain.gain.value = 0;

      src.connect(lp); lp.connect(pre); pre.connect(shaper);
      shaper.connect(hp); hp.connect(gain); gain.connect(ctx.destination);
      src.start();

      this.ctx = ctx;
      this.gain = gain;
      this.ready = true;
    },

    // Only ever called from a real click / key press. Browsers refuse to
    // start audio until the person has actually interacted with the page,
    // and hovering does not count — so the context must be BUILT here,
    // inside a genuine gesture, not on hover. Creating it on hover made
    // it born suspended, and a context that starts life blocked is far
    // less reliable to revive afterwards.
    unlock: function () {
      if (!this.ready) this.build();
      if (this.ctx && this.ctx.state === 'suspended') {
        var r = this.ctx.resume();
        if (r && r.catch) r.catch(function () {});
      }
    },

    // Safe to call on hover: nudges an existing context awake, but never
    // creates one, so no context is ever born outside a user gesture.
    resumeIfBuilt: function () {
      if (this.ready && this.ctx.state === 'suspended') {
        var r = this.ctx.resume();
        if (r && r.catch) r.catch(function () {});
      }
    },

    to: function (v, time) {
      if (!this.ready) return;
      var g = this.gain.gain, now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(v, now + time);
    }
  };

  // Keep trying on every interaction until the audio is genuinely running,
  // rather than getting one attempt on the first event. A single try can
  // land at a moment the browser still refuses, and then nothing would ever
  // retry it and the page would stay silent for good.
  var unlockOn = ['pointerdown', 'mousedown', 'click', 'keydown', 'touchstart'];
  function tryUnlock() {
    Audio_.unlock();
    if (Audio_.ctx && Audio_.ctx.state === 'running') {
      unlockOn.forEach(function (ev) { window.removeEventListener(ev, tryUnlock); });
    }
  }
  unlockOn.forEach(function (ev) {
    window.addEventListener(ev, tryUnlock, { passive: true });
  });

  /* ---------- the sound switch ---------- */

  // Sound starts OFF on every single page load, full stop.
  //
  // This used to be remembered between visits, which meant anyone who had
  // ever switched it on arrived to a page that made a noise because of a
  // choice they'd forgotten making — including, of course, on the machine
  // it was being tested on. Being asked again costs one click; being
  // ambushed by sound costs rather more. So the switch applies to the
  // visit you're in and nothing else.
  var muted = true;

  // Clear the preference earlier versions saved, so a stale "on" left in
  // storage can't survive the change. localStorage throws outright in some
  // privacy modes, hence the wrapper.
  try { localStorage.removeItem('ezekiel-sound'); } catch (e) {}

  var toggle = document.querySelector('.sound-toggle');
  var hint = document.querySelector('.sound-hint');
  var hintTimer = 0;

  // "prompt" marks the loud arrival invitation, as opposed to the quiet
  // confirmation shown after the switch is used.
  function showHint(text, ms, prompt) {
    if (!hint) return;
    clearTimeout(hintTimer);
    // Drop the class, force the browser to lay out, then add it back. That
    // restarts the fade even if a hint is already on screen. Done
    // synchronously rather than in requestAnimationFrame, which doesn't
    // run at all in a background tab — the hint would simply never appear.
    hint.classList.remove('is-visible');
    hint.classList.toggle('sound-hint--prompt', !!prompt);
    void hint.offsetWidth;
    hint.textContent = text;
    hint.classList.add('is-visible');
    hintTimer = setTimeout(function () {
      hint.classList.remove('is-visible');
    }, ms);
  }

  function paintToggle() {
    if (!toggle) return;
    toggle.setAttribute('aria-pressed', muted ? 'false' : 'true');
    toggle.setAttribute('aria-label', muted ? 'Turn hover sound on'
                                            : 'Turn hover sound off');
  }
  paintToggle();

  if (toggle) {
    toggle.addEventListener('click', function () {
      muted = !muted;
      paintToggle();

      showHint(muted ? 'Sound off' : 'Sound on', 1800);

      // This click is a real gesture, so it's also the moment we're
      // allowed to create the audio at all.
      if (!muted) Audio_.unlock();

      // React straight away if a tile is under the pointer right now,
      // instead of waiting for the next hover.
      if (active) Audio_.to(muted ? 0 : CONFIG.volume, 0.12);
      else if (muted) Audio_.to(0, 0.12);
    });
  }

  // On arrival, invite the click. Two different reasons to, and the same
  // words cover both: the page now starts muted, and even once it isn't,
  // browsers refuse to let any page make a sound until you've interacted
  // with it. Either way hovering is silent until you click, and without
  // this the page just looks like half the effect is missing.
  setTimeout(function () {
    if (muted || !Audio_.ready) showHint('Click for sound', 6500, true);
  }, 900);

  // A way to ask the page what the audio is actually doing, since "no
  // sound" has several very different causes that look identical.
  // Run  ezekielAudio()  in the browser console.
  window.ezekielAudio = function () {
    var s = {
      mutedByToggle: muted,
      audioBuilt: Audio_.ready,
      state: Audio_.ctx ? Audio_.ctx.state : 'not created yet',
      volumeNow: Audio_.gain ? +Audio_.gain.gain.value.toFixed(3) : null,
      configuredVolume: CONFIG.volume
    };
    s.verdict = muted
      ? 'Muted with the speaker button in the header.'
      : !Audio_.ready
      ? 'No context yet - click anywhere on the page, then hover a photo.'
      : Audio_.ctx.state !== 'running'
        ? 'Blocked by the browser (' + Audio_.ctx.state + '). Click the page.'
        : 'Audio is running. If you still hear nothing, it is the output '
          + 'device or system volume, not the page.';
    return s;
  };

  /* ---------- driving it ---------- */

  var active = null, raf = 0, t0 = 0, seed = 0;

  // Where the picture is actually PAINTED, which is not always the element's
  // own box. A cover fills its frame exactly, but the Paris stills are
  // letterboxed by object-fit: contain inside a box that stays the full
  // half-width — so the element rect includes empty space beside the photo.
  // Laying the effect over that rect would smear it across the gap.
  function paintedRect(el) {
    var r = el.getBoundingClientRect();
    var img = el.querySelector('img');
    if (!img || !img.naturalWidth) return r;
    var cs = getComputedStyle(img);
    if (cs.objectFit !== 'contain') return r;      // cover: fills the box

    var ar = img.naturalWidth / img.naturalHeight;
    var pw = r.width, ph = r.width / ar;
    if (ph > r.height) { ph = r.height; pw = r.height * ar; }

    // object-position computes to percentages for keywords like
    // "left center", which is exactly the fraction of the leftover space
    var pos = cs.objectPosition.split(' ');
    var fx = (parseFloat(pos[0]) || 0) / 100;
    var fy = (parseFloat(pos[1]) || 0) / 100;
    return {
      left: r.left + (r.width - pw) * fx,
      top: r.top + (r.height - ph) * fy,
      width: pw, height: ph
    };
  }

  function size() {
    var r = paintedRect(active);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var cssW = r.width * (1 + CONFIG.tail);
    var w = Math.round(cssW * dpr), h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    canvas.style.width = cssW + 'px';
    canvas.style.height = r.height + 'px';
    canvas.style.transform = 'translate(' + r.left + 'px,' + r.top + 'px)';
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.uRes, w, h);
    gl.uniform1f(U.uImgFrac, 1 / (1 + CONFIG.tail));
  }

  function frame(now) {
    if (!active) return;
    if (!t0) t0 = now;
    size();
    gl.uniform1f(U.uTime, (now - t0) / 1000);
    gl.uniform1f(U.uSeed, seed);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    raf = requestAnimationFrame(frame);
  }

  function enter(frameEl) {
    var img = frameEl.querySelector('img');
    if (!img || !img.complete || !img.naturalWidth) return;

    active = frameEl;
    seed = Math.random() * 100;
    t0 = 0;

    gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (e) {
      active = null;
      return;
    }

    canvas.classList.add('is-on');
    // Deliberately NOT Audio_.unlock() here — hover is not a user gesture,
    // and building the context from one makes it start blocked. The first
    // real click builds it; this only wakes it and rides the fader.
    Audio_.resumeIfBuilt();
    if (!muted) Audio_.to(CONFIG.volume, 0.06);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
  }

  function leave() {
    active = null;
    cancelAnimationFrame(raf);
    canvas.classList.remove('is-on');
    Audio_.to(0, 0.22);
  }

  Array.prototype.forEach.call(tiles, function (f) {
    f.addEventListener('pointerenter', function () { enter(f); });
    f.addEventListener('pointerleave', leave);
  });

  /* ---------- scrolling a photo under the pointer ---------- */

  // pointerenter only fires when the POINTER moves. Scroll the page and the
  // pointer stays perfectly still while the photos slide under it, so the
  // browser considers nothing to have been entered or left — and a photo
  // you scrolled onto sat there dead until you jiggled the mouse.
  //
  // So remember where the pointer is and, whenever the page moves, ask what
  // is under that point now. Scrolling onto a photo starts the effect and
  // scrolling off it ends it, exactly as moving the mouse would.
  var px = -1, py = -1;
  window.addEventListener('pointermove', function (e) {
    px = e.clientX;
    py = e.clientY;
  }, { passive: true });

  // The topmost thing at that point, walked up to the photo containing it —
  // the point usually lands on the <img>, whose parent is what we bound.
  function targetAt(x, y) {
    if (x < 0) return null;                 // pointer hasn't moved yet
    var el = document.elementFromPoint(x, y);
    while (el && el !== document.body) {
      if (el.matches && el.matches(SELECTOR)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function recheck() {
    pending = 0;
    var el = targetAt(px, py);
    if (el === active) return;              // still on the same photo
    if (active) leave();
    // enter() bails on a photo that hasn't finished loading. Nothing is
    // stored in that case, so the next scroll event simply tries again.
    if (el) enter(el);
  }

  // Scroll fires far faster than the screen refreshes, and elementFromPoint
  // forces a layout read, so collapse a burst of events into one check per
  // frame.
  var pending = 0;
  window.addEventListener('scroll', function () {
    if (!pending) pending = requestAnimationFrame(recheck);
  }, { passive: true });

  window.addEventListener('blur', leave);
})();
