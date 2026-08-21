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
    rowPx: 4.0,        // height of one torn band, in pixels
    density: 0.40,     // fraction of bands glitching at any moment
    shear: 0.16,       // how far bands slide sideways (fraction of width)
    keyLow: 0.10,      // luminance at/below this = full effect (blacks)
    keyHigh: 0.34,     // luminance at/above this = no effect (highlights)
    crush: 7.0,        // colour levels per channel — lower is more crushed
    blockPx: 3.0,      // horizontal pixelation, in pixels
    volume: 0.13       // rumble loudness, 0 to 1
  };

  // Respect the OS "reduce motion" setting — this effect is exactly the
  // kind of thing that switch exists for.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Hover isn't a thing on touch screens; don't build any of this there.
  if (!window.matchMedia('(hover: hover)').matches) return;

  var tiles = document.querySelectorAll('.tile__frame');
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
    '',
    'float hash(vec2 p) {',
    '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    'float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }',
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
    '  float tailX = max(0.0, ix - 1.0);          // 0 at the edge, grows right',
    '',
    '  // --- fraying ---------------------------------------------------',
    '  // Each band gets its own reach. Raising a 0..1 random to a power',
    '  // makes most bands short and a few long, which is what reads as',
    '  // strands rather than a solid block.',
    '  float reach = pow(hash(vec2(row, slow * 0.37 + uSeed + 11.0)), 1.9);',
    '  float tailMax = reach * (1.0 / uImgFrac - 1.0);',
    '  float tailFall = 1.0 - smoothstep(0.0, max(tailMax, 0.0001), tailX);',
    '',
    '  // Density: packed tight where the strands leave the picture, thinning',
    '  // to scattered threads further out. This is what reads as frayed',
    '  // rather than as a rectangle of noise stuck to the side.',
    '  float dens;',
    '  if (ix <= 1.0) {',
    '    dens = uDensity;',
    '  } else {',
    '    float nearEdge = 1.0 - smoothstep(0.0, 0.22, tailX);',
    '    dens = mix(uDensity * 0.30, min(0.90, uDensity * 2.1), nearEdge) * tailFall;',
    '  }',
    '  float active = step(1.0 - dens, rRow);',
    '  // rare full-width bursts',
    '  active = max(active, step(0.988, hash(vec2(row * 0.5, fast))));',
    '',
    '  // --- how far this band slides ----------------------------------',
    '  float dr = hash(vec2(row, slow * 1.7 + uSeed + 5.0));',
    '  float shear = (dr - 0.35) * uShear * (0.35 + 0.65 * flick);',
    '',
    '  // --- where to read the photo from ------------------------------',
    '  float srcX;',
    '  if (ix <= 1.0) {',
    '    srcX = ix - shear;',
    '  } else {',
    '    // Out past the edge there is no photo to read, so each band tears',
    '    // a slice out of its own row and drags it outward.',
    '    //',
    '    // It picks the DARKEST of three candidate slices. Grabbing at',
    '    // random mostly lands on bright areas, whose key is zero, so the',
    '    // strands never appear. Biasing towards the dark part of the row',
    '    // is what makes them tear out of the shadows the way they should.',
    '    float g1 = hash(vec2(row, uSeed + 3.0));',
    '    float g2 = hash(vec2(row, uSeed + 7.0));',
    '    float g3 = hash(vec2(row, uSeed + 13.0));',
    '    float l1 = luma(texture2D(uTex, vec2(g1, uv.y)).rgb);',
    '    float l2 = luma(texture2D(uTex, vec2(g2, uv.y)).rgb);',
    '    float l3 = luma(texture2D(uTex, vec2(g3, uv.y)).rgb);',
    '    float grab = (l1 < l2) ? ((l1 < l3) ? g1 : g3) : ((l2 < l3) ? g2 : g3);',
    '    // drift the grab point as it travels so the strand has texture',
    '    // rather than being one flat bar of colour',
    '    srcX = grab + tailX * 0.22 - shear;',
    '  }',
    '',
    '  // bit-crush horizontally: snap to blocks so it reads as pixels',
    '  float blocks = uRes.x / uBlockPx;',
    '  srcX = floor(srcX * blocks) / blocks;',
    '  vec2 srcUv = clamp(vec2(srcX, uv.y), 0.0, 1.0);',
    '',
    '  // --- the luminance key -----------------------------------------',
    '  // Read the ORIGINAL pixel at this spot (not the displaced one) so',
    '  // the decision "is this area dark enough to glitch" follows the',
    '  // picture as composed. Inside the tail there is no original, so',
    '  // fall back to whatever got dragged out there.',
    '  vec3 here = texture2D(uTex, clamp(vec2(ix, uv.y), 0.0, 1.0)).rgb;',
    '  vec3 pulled = texture2D(uTex, srcUv).rgb;',
    '  float L = (ix <= 1.0) ? luma(here) : luma(pulled);',
    '',
    '  // 1 in the blacks, 0 in the highlights, steep through the mids',
    '  float key = 1.0 - smoothstep(uKeyLow, uKeyHigh, L);',
    '',
    '  // --- colour ------------------------------------------------------',
    '  // slight channel split, the giveaway of knackered analogue video',
    '  float ca = 2.5 / uRes.x;',
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
    '  float scan = 0.82 + 0.18 * step(0.5, fract((uv.y * uRes.y) / (uRowPx * 0.5)));',
    '  col *= scan;',
    '',
    '  // --- final strength ----------------------------------------------',
    '  float a = key * active;',
    '  a *= mix(1.0, tailFall, step(1.0, ix));   // fade out along the tail',
    '  a *= 0.55 + 0.45 * flick;                 // flicker the whole thing',
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
   'uShear', 'uKeyLow', 'uKeyHigh', 'uCrush', 'uBlockPx'].forEach(function (n) {
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
      var HOLD = 96;      // reuse each sample this many times => the sample
                          // rate collapses to a few hundred Hz, which is the
                          // gritty half of "bit-crushed"
      var LEVELS = 10;    // and quantising the value is the other half
      for (var i = 0; i < d.length; i++) {
        if (countdown <= 0) {
          brown = (brown + 0.022 * (Math.random() * 2 - 1)) / 1.022;
          held = Math.round(brown * 9.0 * LEVELS) / LEVELS;
          countdown = HOLD;
        }
        countdown--;
        d[i] = Math.max(-1, Math.min(1, held));
      }

      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      var lp = ctx.createBiquadFilter();      // keep it a rumble, not a hiss
      lp.type = 'lowpass';
      lp.frequency.value = 130;
      lp.Q.value = 0.9;

      var hp = ctx.createBiquadFilter();      // clear the inaudible sub
      hp.type = 'highpass';
      hp.frequency.value = 28;

      var gain = ctx.createGain();
      gain.gain.value = 0;

      src.connect(lp); lp.connect(hp); hp.connect(gain); gain.connect(ctx.destination);
      src.start();

      this.ctx = ctx;
      this.gain = gain;
      this.ready = true;
    },

    // Browsers refuse to start audio until the person has actually
    // interacted with the page — hovering doesn't count as interaction,
    // so the first hover before any click stays silent by design.
    unlock: function () {
      if (!this.ready) this.build();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    to: function (v, time) {
      if (!this.ready) return;
      var g = this.gain.gain, now = this.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(v, now + time);
    }
  };

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function () { Audio_.unlock(); }, { once: true, passive: true });
  });

  /* ---------- driving it ---------- */

  var active = null, raf = 0, t0 = 0, seed = 0;

  function size() {
    var r = active.getBoundingClientRect();
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
    Audio_.unlock();
    Audio_.to(CONFIG.volume, 0.06);
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

  // If the page moves under the pointer, drop the effect rather than
  // leaving the canvas stranded somewhere it doesn't belong.
  window.addEventListener('scroll', function () { if (active) leave(); }, { passive: true });
  window.addEventListener('blur', leave);
})();
