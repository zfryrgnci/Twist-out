/* Twist Out - rendering and input.
 *
 * One canvas, nothing layered on top of it, for the same reason as the other
 * games in this portfolio: a sibling once shipped unplayable because an
 * invisible positioned element covered the board and ate every drag, and its
 * tests all passed because they drove the engine instead of the glass.
 *
 * The one interaction decision worth writing down: a grabbed pin keeps the
 * offset it had from the finger at the moment it was grabbed, rather than
 * snapping to the finger's centre. Snapping feels like the pin jumps out from
 * under you, and on a phone the finger then covers the exact spot you are
 * trying to judge.
 */
(function () {
  'use strict';

  var C = window.TwistCore;
  var cv = document.getElementById('c');
  var ctx = cv.getContext('2d');

  var G = {
    W: 0, H: 0, dpr: 1, sx: 0, sw: 0,
    st: null, level: 1,
    bx: 0, by: 0, bs: 0,       /* board square in screen space */
    drag: null,
    t: 0, screen: 'play', overlayT: 0,
    winT: 0, buttons: [], pulse: []
  };

  var mem = {};
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
  function load(k, d) {
    try { var v = localStorage.getItem(k); return v === null ? d : v; }
    catch (e) { return k in mem ? mem[k] : d; }
  }

  /* ------------------------------------------------------------------ */
  var Audio2 = (function () {
    var actx = null, muted = load('to_mute', '0') === '1';
    function ac() {
      if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = false; } }
      return actx;
    }
    function blip(freq, dur, type, vol) {
      if (muted) return;
      var a = ac(); if (!a) return;
      try {
        if (a.state === 'suspended') a.resume();
        var o = a.createOscillator(), g = a.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, a.currentTime);
        g.gain.setValueAtTime(vol || 0.07, a.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
        o.connect(g); g.connect(a.destination);
        o.start(); o.stop(a.currentTime + dur);
      } catch (e) {}
    }
    return {
      grab: function () { blip(420, 0.06, 'sine', 0.05); },
      drop: function () { blip(320, 0.08, 'triangle', 0.05); },
      untangle: function () { blip(880, 0.1, 'sine', 0.07); },
      win: function () { [660, 880, 1100, 1320].forEach(function (f, i) { setTimeout(function () { blip(f, 0.22, 'sine', 0.08); }, i * 100); }); },
      lose: function () { [420, 330, 250].forEach(function (f, i) { setTimeout(function () { blip(f, 0.24, 'sine', 0.07); }, i * 130); }); },
      hint: function () { blip(1200, 0.14, 'sine', 0.07); },
      toggle: function () { muted = !muted; store('to_mute', muted ? '1' : '0'); return muted; },
      muted: function () { return muted; }
    };
  }());

  var Ads = {
    interstitial: function () {
      try { if (window.AndroidBridge && AndroidBridge.showInterstitial) AndroidBridge.showInterstitial(); } catch (e) {}
    },
    rewarded: function (cb) {
      Ads._cb = cb;
      try { if (window.AndroidBridge && AndroidBridge.showRewarded) { AndroidBridge.showRewarded(); return; } } catch (e) {}
      cb(true);
    }
  };
  window.TwistOut = {
    onRewardEarned: function () { if (Ads._cb) { var f = Ads._cb; Ads._cb = null; f(true); } },
    onRewardFailed: function () { if (Ads._cb) { var f = Ads._cb; Ads._cb = null; f(false); } }
  };

  /* ------------------------------------------------------------------ */
  function resize() {
    G.W = window.innerWidth; G.H = window.innerHeight;
    G.dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(G.W * G.dpr);
    cv.height = Math.round(G.H * G.dpr);
    cv.style.width = G.W + 'px';
    cv.style.height = G.H + 'px';
    ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    G.sw = Math.min(G.W, G.H * 0.62, 600);
    G.sx = (G.W - G.sw) / 2;
    layout();
  }

  var TOPBAR = 0, FOOT = 0;

  function layout() {
    TOPBAR = Math.max(54, G.H * 0.085);
    FOOT = Math.max(64, G.H * 0.10);
    var availH = G.H - TOPBAR - FOOT - G.sw * 0.05;
    /* The board does not have to be square. Crossings are preserved by any
     * affine map, so stretching the unit square to fill the space available
     * cannot change a single answer - it just makes the pins bigger and uses
     * the screen. Capped at 1:1.35 so a tall phone does not turn every tangle
     * into a vertical smear. */
    G.bw = G.sw * 0.96;
    G.bh = Math.min(availH, G.bw * 1.35);
    G.bs = Math.min(G.bw, G.bh);
    G.bx = G.sx + (G.sw - G.bw) / 2;
    G.by = TOPBAR + (availH - G.bh) / 2 + G.sw * 0.025;
  }

  function toScreen(p) { return { x: G.bx + p.x * G.bw, y: G.by + p.y * G.bh }; }
  function toBoard(x, y) { return { x: (x - G.bx) / G.bw, y: (y - G.by) / G.bh }; }
  function pinR() { return Math.max(9, G.bs * 0.036); }

  /* ------------------------------------------------------------------ */
  function levelData(n) {
    var pack = window.TWIST_LEVELS;
    if (pack && pack[n - 1]) return pack[n - 1];
    return C.generateTuned(n, 77000 + n, { candidates: 4, gate: 0 }) || C.generate(n, 77000 + n);
  }

  function startLevel(n) {
    G.level = n;
    G.st = C.instantiate(levelData(n));
    G.screen = 'play';
    G.overlayT = 0; G.winT = 0; G.drag = null; G.pulse = [];
    store('to_level', String(n));
    G.tangled = C.edgeTangled(G.st);
    G.crossings = C.crossings(G.st);
    layout();
  }

  function nextLevel() {
    var n = G.level + 1;
    if (n % 3 === 1 && n > 3) Ads.interstitial();
    startLevel(n);
  }

  function refreshTangle() {
    var before = G.crossings;
    G.tangled = C.edgeTangled(G.st);
    G.crossings = C.crossings(G.st);
    if (G.crossings < before) Audio2.untangle();
  }

  /* ------------------------------------------------------------------ */
  /* Pins can end up stacked - the answer slots are a shuffle of the starting
   * slots, so putting one pin home routinely parks it exactly where another
   * one is standing. Picking simply the nearest then breaks: two pins at the
   * same point are equally near, and the finger gets whichever the loop
   * happened to see first, which is the one buried underneath. Pins are
   * painted in index order, so among everything under the finger the highest
   * index is the one on top - and the one the player believes they touched. */
  function hitPin(px, py) {
    var st = G.st, best = -1, bestD = 1e9;
    var r = pinR() * 2.4;   /* generous: a pin is small and a fingertip is not */
    var slack = pinR() * 0.9;
    for (var i = 0; i < st.pos.length; i++) {
      var s = toScreen(st.pos[i]);
      var d = Math.hypot(s.x - px, s.y - py);
      if (d > r) continue;
      if (best < 0 || d < bestD - slack) { bestD = d; best = i; }
      else if (d < bestD + slack) { if (d < bestD) bestD = d; best = i; }
    }
    return best;
  }

  function onPress(px, py) {
    for (var i = 0; i < G.buttons.length; i++) {
      var b = G.buttons[i];
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) { b.fn(); return true; }
    }
    if (G.screen !== 'play') return false;
    var id = hitPin(px, py);
    if (id < 0) return false;
    var s = toScreen(G.st.pos[id]);
    /* Keep the grab offset: the pin should not leap to the centre of a finger
     * that grabbed its edge. */
    G.drag = { id: id, ox: s.x - px, oy: s.y - py };
    C.beginDrag(G.st, id);
    Audio2.grab();
    return true;
  }

  function onMove(px, py) {
    if (!G.drag || G.screen !== 'play') return;
    var b = toBoard(px + G.drag.ox, py + G.drag.oy);
    C.moveNode(G.st, G.drag.id, b.x, b.y);
    refreshTangle();
    if (G.st.status === 'won' && G.screen === 'play') winNow();
  }

  function onRelease() {
    if (!G.drag) return;
    var r = C.endDrag(G.st, G.drag.id);
    G.drag = null;
    Audio2.drop();
    refreshTangle();
    if (G.st.status === 'won' && G.screen === 'play') winNow();
    else if (r && r.lost && G.screen === 'play') loseNow();
  }

  function loseNow() {
    G.screen = 'lost'; G.overlayT = 0;
    Audio2.lose();
    G.fails = (G.fails || 0) + 1;
    /* An interstitial on every other failure. Every failure would be a toll
     * booth; never would leave the one moment the player is most willing to
     * watch something unused. */
    if (G.fails % 2 === 0) Ads.interstitial();
  }

  function winNow() {
    G.screen = 'winanim'; G.winT = 0;
    Audio2.win();
    var best = parseInt(load('to_best', '1'), 10) || 1;
    if (G.level + 1 > best) store('to_best', String(G.level + 1));
  }

  function toStage(cx, cy) {
    var r = cv.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  }

  cv.addEventListener('touchstart', function (e) {
    if (e.cancelable) e.preventDefault();
    var t = e.changedTouches[0], p = toStage(t.clientX, t.clientY);
    onPress(p.x, p.y);
  }, { passive: false });
  cv.addEventListener('touchmove', function (e) {
    if (e.cancelable) e.preventDefault();
    var t = e.changedTouches[0], p = toStage(t.clientX, t.clientY);
    onMove(p.x, p.y);
  }, { passive: false });
  cv.addEventListener('touchend', function (e) {
    if (e.cancelable) e.preventDefault();
    onRelease();
  }, { passive: false });
  cv.addEventListener('touchcancel', function () { onRelease(); });

  cv.addEventListener('mousedown', function (e) { var p = toStage(e.clientX, e.clientY); onPress(p.x, p.y); });
  window.addEventListener('mousemove', function (e) { var p = toStage(e.clientX, e.clientY); onMove(p.x, p.y); });
  window.addEventListener('mouseup', onRelease);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 60); });

  /* ------------------------------------------------------------------ */
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function text(s, x, y, size, colour, align, weight) {
    ctx.font = (weight || '800') + ' ' + size + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = colour; ctx.fillText(s, x, y);
  }
  function button(x, y, w, h, label, fill, fn, size) {
    rr(x, y + h * 0.08, w, h, h * 0.3); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill();
    rr(x, y, w, h, h * 0.3);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, fill[0]); g.addColorStop(1, fill[1]);
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
    text(label, x + w / 2, y + h / 2, size || Math.round(h * 0.36), '#fff');
    G.buttons.push({ x: x, y: y, w: w, h: h, fn: fn });
  }

  var ROPE_BAD = ['#ff6b6b', '#c62f3f'];
  var ROPE_OK = ['#4fd6a0', '#1d9b70'];
  var ROPE_WIN = ['#ffd75e', '#e0a010'];

  /* A rope, not a line: dark casing, coloured body, and a run of short
   * diagonal ticks that read as twist. Without the ticks the board looks like
   * a wiring diagram. */
  function drawRope(a, b, colours, w) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    ctx.save();
    ctx.lineCap = 'round';

    ctx.strokeStyle = 'rgba(30,45,60,0.22)';
    ctx.lineWidth = w + 5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y + 2); ctx.lineTo(b.x, b.y + 2); ctx.stroke();

    ctx.strokeStyle = colours[1];
    ctx.lineWidth = w + 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    ctx.strokeStyle = colours[0];
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    var ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    var step = w * 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = Math.max(1, w * 0.24);
    ctx.beginPath();
    for (var d = step * 0.5; d < len - step * 0.3; d += step) {
      var cx = a.x + ux * d, cy = a.y + uy * d;
      ctx.moveTo(cx - nx * w * 0.34 - ux * w * 0.24, cy - ny * w * 0.34 - uy * w * 0.24);
      ctx.lineTo(cx + nx * w * 0.34 + ux * w * 0.24, cy + ny * w * 0.34 + uy * w * 0.24);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawPin(p, r, held, idx) {
    ctx.save();
    ctx.beginPath(); ctx.arc(p.x, p.y + r * 0.22, r, 0, 6.2832);
    ctx.fillStyle = 'rgba(25,40,55,0.28)'; ctx.fill();

    var hue = (idx * 47) % 360;
    var g = ctx.createRadialGradient(p.x - r * 0.35, p.y - r * 0.4, r * 0.12, p.x, p.y, r);
    g.addColorStop(0, 'hsl(' + hue + ',85%,72%)');
    g.addColorStop(1, 'hsl(' + hue + ',70%,45%)');
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832);
    ctx.fillStyle = g; ctx.fill();

    ctx.lineWidth = Math.max(1.5, r * 0.20);
    ctx.strokeStyle = held ? '#ffffff' : 'rgba(255,255,255,0.65)';
    ctx.stroke();

    ctx.beginPath(); ctx.arc(p.x - r * 0.3, p.y - r * 0.34, r * 0.26, 0, 6.2832);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  function draw(dt) {
    G.t += dt;
    G.buttons = [];
    var st = G.st;

    var bg = ctx.createLinearGradient(0, 0, 0, G.H);
    bg.addColorStop(0, '#f6e9d2'); bg.addColorStop(0.5, '#f2dfc2'); bg.addColorStop(1, '#e8cfa8');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, G.W, G.H);

    /* board mat */
    rr(G.bx - G.bs * 0.03, G.by - G.bs * 0.03, G.bw + G.bs * 0.06, G.bh + G.bs * 0.06, G.bs * 0.06);
    ctx.fillStyle = 'rgba(255,255,255,0.42)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(150,110,70,0.28)'; ctx.stroke();

    drawTopBar();

    var win = G.screen === 'winanim' || G.screen === 'won';
    var w = Math.max(4, G.bs * 0.020);
    for (var e = 0; e < st.edges.length; e++) {
      var a = toScreen(st.pos[st.edges[e][0]]);
      var b = toScreen(st.pos[st.edges[e][1]]);
      var col = win ? ROPE_WIN : (G.tangled[e] ? ROPE_BAD : ROPE_OK);
      drawRope(a, b, col, w);
    }

    var r = pinR();
    for (var i = 0; i < st.pos.length; i++) {
      var held = G.drag && G.drag.id === i;
      var pop = win ? 1 + Math.sin(G.t * 6 + i) * 0.12 : 1;
      drawPin(toScreen(st.pos[i]), r * (held ? 1.35 : 1) * pop, held, i);
    }

    drawFooter();

    if (G.screen === 'winanim') {
      G.winT += dt;
      if (G.winT > 0.75) { G.screen = 'won'; G.overlayT = 0; }
    }
    if (G.screen === 'won' || G.screen === 'lost') drawOverlay(dt);
  }

  function drawTopBar() {
    var y = G.H * 0.018, h = TOPBAR - y - 8;
    rr(G.sx + G.sw * 0.03, y, G.sw * 0.94, h, h * 0.32);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fill();
    text('LEVEL ' + G.level, G.sx + G.sw * 0.5, y + h * 0.36, Math.round(h * 0.36), '#5a3d22');
    var left = G.crossings;
    text(left === 0 ? 'UNTANGLED!' : left + ' crossing' + (left === 1 ? '' : 's') + ' left',
         G.sx + G.sw * 0.5, y + h * 0.74, Math.round(h * 0.26),
         left === 0 ? '#1d9b70' : '#b4503c', 'center', '700');

    var bs = h * 0.56;
    button(G.sx + G.sw * 0.055, y + (h - bs) / 2, bs, bs, Audio2.muted() ? '🔇' : '🔊',
           ['#ffd35c', '#f0a92b'], function () { Audio2.toggle(); }, Math.round(bs * 0.48));
    button(G.sx + G.sw * 0.945 - bs, y + (h - bs) / 2, bs, bs, '↻',
           ['#8fd6ff', '#3f9fe0'], function () { startLevel(G.level); }, Math.round(bs * 0.52));
  }

  function drawFooter() {
    var h = FOOT * 0.62;
    var y = G.H - FOOT + (FOOT - h) / 2 - G.H * 0.008;
    var bw = G.sw * 0.42;

    button(G.sx + G.sw * 0.06, y, bw, h, 'HINT', ['#ffcf5c', '#e8a010'], function () {
      if (G.screen !== 'play') return;
      Ads.rewarded(function (granted) {
        if (!granted) return;
        var r = C.hint(G.st);
        if (r.ok) {
          Audio2.hint();
          refreshTangle();
          if (G.st.status === 'won') winNow();
        }
      });
    });

    var mx = G.sx + G.sw * 0.94 - bw;
    var left = C.movesLeft(G.st);
    var tight = left <= 3;
    rr(mx, y, bw, h, h * 0.3);
    ctx.fillStyle = tight ? 'rgba(255,150,140,0.6)' : 'rgba(255,255,255,0.55)';
    ctx.fill();
    if (tight) { ctx.lineWidth = 2.5; ctx.strokeStyle = '#e04b4b'; ctx.stroke(); }
    /* Moves remaining, not moves spent. The old readout showed a count against
     * a par that cost nothing, so it read as trivia; this one is the thing the
     * player is about to run out of. */
    text('MOVES  ' + left, mx + bw / 2, y + h / 2,
         Math.round(h * 0.32), tight ? '#7a1d1d' : '#5a3d22', 'center', '700');
  }

  function stars() {
    var m = G.st.moves, p = G.st.par;
    if (m <= p) return 3;
    if (m <= Math.ceil(p * 1.7)) return 2;
    return 1;
  }

  function drawOverlay(dt) {
    /* A panel is modal: it owns the input while it is up. Without this the
     * HINT button in the footer stayed hit-testable underneath it, which is
     * the same class of bug as an invisible element over the board - what the
     * player can touch stops matching what they can see. */
    G.buttons = [];
    G.overlayT += dt;
    var k = Math.min(1, G.overlayT / 0.32);
    ctx.fillStyle = 'rgba(20,30,45,' + (0.74 * k) + ')';
    ctx.fillRect(0, 0, G.W, G.H);

    var w = Math.min(G.sw * 0.84, 380), h = w * 0.9;
    var x = G.W / 2 - w / 2, y = G.H / 2 - h / 2 - G.H * 0.02;
    var c = 1.70158, s = 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2);
    ctx.save();
    ctx.translate(G.W / 2, G.H / 2 - G.H * 0.02); ctx.scale(s, s);
    ctx.translate(-G.W / 2, -(G.H / 2 - G.H * 0.02));

    rr(x, y, w, h, w * 0.09);
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#f2f7ff');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(70,110,150,0.3)'; ctx.stroke();

    var won = G.screen === 'won';
    text(won ? 'UNTANGLED!' : 'OUT OF MOVES', G.W / 2, y + h * 0.17,
         w * (won ? 0.11 : 0.095), won ? '#1d9b70' : '#d9483b');

    if (!won) {
      text(G.crossings + ' crossing' + (G.crossings === 1 ? '' : 's') + ' still tangled',
           G.W / 2, y + h * 0.32, w * 0.058, '#5b7186', 'center', '600');
      var bw2 = w * 0.72, bh2 = h * 0.16;
      var canBuy = G.st.extraGrants < 2;
      button(G.W / 2 - bw2 / 2, y + h * 0.50, bw2, bh2,
             canBuy ? '+5 MOVES  (AD)' : 'NO MORE MOVES',
             canBuy ? ['#ffcf5c', '#e8a010'] : ['#c9d3da', '#9fb0bb'],
             function () {
               if (!canBuy) return;
               Ads.rewarded(function (granted) {
                 if (!granted) return;
                 if (C.addMoves(G.st, 5).ok) { G.screen = 'play'; G.overlayT = 0; }
               });
             });
      button(G.W / 2 - bw2 / 2, y + h * 0.72, bw2, bh2, 'TRY AGAIN', ['#8fd6ff', '#3f9fe0'],
             function () { startLevel(G.level); });
      ctx.restore();
      return;
    }

    var n = stars(), sr = w * 0.072;
    for (var i = 0; i < 3; i++) {
      var sx2 = G.W / 2 + (i - 1) * sr * 2.6, sy = y + h * 0.34;
      ctx.beginPath();
      for (var p2 = 0; p2 < 10; p2++) {
        var ang = -Math.PI / 2 + p2 * Math.PI / 5;
        var rad = p2 % 2 ? sr * 0.45 : sr;
        ctx[p2 ? 'lineTo' : 'moveTo'](sx2 + Math.cos(ang) * rad, sy + Math.sin(ang) * rad);
      }
      ctx.closePath();
      ctx.fillStyle = i < n ? '#ffc93c' : 'rgba(0,0,0,0.12)';
      ctx.fill();
      if (i < n) { ctx.lineWidth = 2; ctx.strokeStyle = '#e09b0c'; ctx.stroke(); }
    }
    text(G.st.moves + ' moves' + (G.st.hints ? '  ·  ' + G.st.hints + ' hint' + (G.st.hints > 1 ? 's' : '') : ''),
         G.W / 2, y + h * 0.50, w * 0.058, '#5b7186', 'center', '600');

    var bw = w * 0.72, bh = h * 0.16;
    button(G.W / 2 - bw / 2, y + h * 0.60, bw, bh, 'NEXT LEVEL', ['#54dd86', '#22a35a'], nextLevel);
    button(G.W / 2 - bw / 2, y + h * 0.80, bw, bh, 'REPLAY', ['#8fd6ff', '#3f9fe0'],
           function () { startLevel(G.level); });
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
    last = ts;
    draw(dt);
    requestAnimationFrame(frame);
  }

  resize();
  startLevel(parseInt(load('to_level', '1'), 10) || 1);
  requestAnimationFrame(frame);

  window.__game = G;
  window.__core = C;
  window.__startLevel = startLevel;
}());
