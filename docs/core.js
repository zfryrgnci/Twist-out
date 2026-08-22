/* Twist Out - pure logic. No canvas, no DOM, no timers.
 *
 * Ropes run between pins and start crossed over each other. Drag the pins
 * around until no rope crosses another. That is the whole game, and it is an
 * old and very good one: it is the planar-embedding problem, which is why it
 * stays interesting at twenty pins when most puzzle mechanics have run out of
 * ideas by ten.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERY LEVEL IS SOLVABLE
 *
 * The layout is built the other way round from the way it is played. First a
 * set of pin positions is scattered, then ropes are added one at a time,
 * shortest first, and a rope is only kept if it crosses nothing already there
 * and passes no third pin. So the finished arrangement is crossing-free before
 * the player ever sees it - that arrangement is the answer.
 *
 * Then the pins are shuffled *among those same positions*. The player is
 * therefore always looking at a set of slots that is known to work, and at
 * worst can put every pin back in its place. A puzzle with a guaranteed
 * answer, and usually many others, because most tangles have more than one way
 * out.
 *
 * Shuffling among the original slots rather than throwing pins anywhere also
 * keeps the board evenly spread. Random scattering piles pins into a corner,
 * and a tangle you cannot see is not a puzzle, it is a mess.
 *
 * The claim is checked rather than trusted: the solution coordinates are
 * played back through the public moveNode() API and the level has to report
 * itself solved.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TwistCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-9;
  /* A pin resting on a rope it is not attached to looks exactly like a
   * crossing, so it counts as one. Without this the game can be "won" by
   * parking pins on top of ropes to hide the tangle. */
  var PIN_ON_ROPE = 0.026;

  function mkRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ------------------------------------------------------------------ */
  /* geometry                                                            */
  /* ------------------------------------------------------------------ */

  function orient(a, b, c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

  function onSeg(a, b, p) {
    return Math.min(a.x, b.x) - EPS <= p.x && p.x <= Math.max(a.x, b.x) + EPS &&
           Math.min(a.y, b.y) - EPS <= p.y && p.y <= Math.max(a.y, b.y) + EPS;
  }

  function segDist(a, b, p) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    if (len2 < EPS) return Math.hypot(p.x - a.x, p.y - a.y);
    var t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /* True when two rope segments visibly cross. Sharing a pin is not a crossing
   * - ropes are supposed to meet at pins - but two ropes lying along the same
   * line are, because on screen one disappears into the other. */
  function segCross(p1, p2, p3, p4, shared) {
    var d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2);
    var d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);

    var collinear = Math.abs(d1) < EPS && Math.abs(d2) < EPS &&
                    Math.abs(d3) < EPS && Math.abs(d4) < EPS;
    if (collinear) {
      /* Overlap of more than a single point. For ropes that share a pin, the
       * shared point alone is fine; anything past it means one lies on top of
       * the other. */
      var pts = [p1, p2, p3, p4];
      var along = Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y)
        ? function (p) { return p.x; } : function (p) { return p.y; };
      var a0 = Math.min(along(p1), along(p2)), a1 = Math.max(along(p1), along(p2));
      var b0 = Math.min(along(p3), along(p4)), b1 = Math.max(along(p3), along(p4));
      var lo = Math.max(a0, b0), hi = Math.min(a1, b1);
      return (hi - lo) > 1e-6;
    }
    if (shared) return false;

    if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
        ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;

    /* Touching cases: an endpoint sitting exactly on the other segment. */
    if (Math.abs(d1) < EPS && onSeg(p3, p4, p1)) return true;
    if (Math.abs(d2) < EPS && onSeg(p3, p4, p2)) return true;
    if (Math.abs(d3) < EPS && onSeg(p1, p2, p3)) return true;
    if (Math.abs(d4) < EPS && onSeg(p1, p2, p4)) return true;
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* state queries                                                       */
  /* ------------------------------------------------------------------ */

  function edgeTangled(st) {
    var m = st.edges.length;
    var flags = new Array(m);
    for (var i = 0; i < m; i++) flags[i] = false;

    for (var a = 0; a < m; a++) {
      var e1 = st.edges[a];
      var p1 = st.pos[e1[0]], p2 = st.pos[e1[1]];
      for (var b = a + 1; b < m; b++) {
        var e2 = st.edges[b];
        var shared = e1[0] === e2[0] || e1[0] === e2[1] || e1[1] === e2[0] || e1[1] === e2[1];
        if (segCross(p1, p2, st.pos[e2[0]], st.pos[e2[1]], shared)) {
          flags[a] = true; flags[b] = true;
        }
      }
      /* A pin sitting on this rope counts too. */
      for (var v = 0; v < st.pos.length; v++) {
        if (v === e1[0] || v === e1[1]) continue;
        if (segDist(p1, p2, st.pos[v]) < PIN_ON_ROPE) { flags[a] = true; break; }
      }
    }
    return flags;
  }

  /* Which edge pairs share a pin never changes for a level, so working it out
   * inside the counting loop meant recomputing a constant a few hundred
   * thousand times per solver run. Cached on first use. */
  function pairTable(st) {
    if (st._pairs) return st._pairs;
    var m = st.edges.length, pairs = [];
    for (var a = 0; a < m; a++) {
      for (var b = a + 1; b < m; b++) {
        var e1 = st.edges[a], e2 = st.edges[b];
        pairs.push(a, b, (e1[0] === e2[0] || e1[0] === e2[1] ||
                          e1[1] === e2[0] || e1[1] === e2[1]) ? 1 : 0);
      }
    }
    st._pairs = pairs;
    return pairs;
  }

  var PIN_ON_ROPE2 = PIN_ON_ROPE * PIN_ON_ROPE;

  /* Squared distance from a pin to a rope. Math.hypot is correct and slow, and
   * this runs about a million times per level build; nothing here needs the
   * square root. */
  function segDist2(ax, ay, bx, by, px, py) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 < EPS ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var qx = px - (ax + t * dx), qy = py - (ay + t * dy);
    return qx * qx + qy * qy;
  }

  function crossings(st) {
    var n = 0, m = st.edges.length, pos = st.pos, edges = st.edges;
    var pairs = pairTable(st);
    for (var i = 0; i < pairs.length; i += 3) {
      var e1 = edges[pairs[i]], e2 = edges[pairs[i + 1]];
      if (segCross(pos[e1[0]], pos[e1[1]], pos[e2[0]], pos[e2[1]], pairs[i + 2] === 1)) n++;
    }
    var np = pos.length;
    for (var a = 0; a < m; a++) {
      var e = edges[a], p1 = pos[e[0]], p2 = pos[e[1]];
      for (var v = 0; v < np; v++) {
        if (v === e[0] || v === e[1]) continue;
        if (segDist2(p1.x, p1.y, p2.x, p2.y, pos[v].x, pos[v].y) < PIN_ON_ROPE2) n++;
      }
    }
    return n;
  }

  function solved(st) { return crossings(st) === 0; }

  /* ------------------------------------------------------------------ */
  /* mutation                                                            */
  /* ------------------------------------------------------------------ */

  var MARGIN = 0.045;

  function moveNode(st, i, x, y) {
    if (st.status !== 'play') return { ok: false, reason: 'over' };
    if (typeof i !== 'number' || !isFinite(i) || i !== Math.floor(i) ||
        i < 0 || i >= st.pos.length) return { ok: false, reason: 'nosuch' };
    if (!isFinite(x) || !isFinite(y)) return { ok: false, reason: 'nan' };

    var nx = clamp(x, MARGIN, 1 - MARGIN);
    var ny = clamp(y, MARGIN, 1 - MARGIN);
    var p = st.pos[i];
    var moved = Math.hypot(nx - p.x, ny - p.y) > 1e-6;
    p.x = nx; p.y = ny;
    if (!moved) return { ok: true, moved: false, solved: false };

    if (solved(st)) {
      st.status = 'won';
      return { ok: true, moved: true, solved: true };
    }
    return { ok: true, moved: true, solved: false };
  }

  /* Moves have to cost something.
   *
   * The first version counted moves and showed the count next to a par, and
   * that was all it did - so a wrong move was free, and a player reached level
   * nineteen having fumbled the whole way with nothing ever telling him he was
   * playing badly. A number on screen that never bites is decoration.
   *
   * Every level is winnable inside its budget by construction: putting each
   * displaced pin back where it belongs takes exactly `par` drags, and the
   * budget is always par plus slack. So running out is always the player's
   * doing, never the level's. */
  function beginDrag(st, i) {
    if (typeof i !== 'number' || i < 0 || i >= st.pos.length) return;
    st._grab = { i: i, x: st.pos[i].x, y: st.pos[i].y };
  }

  function endDrag(st, i) {
    var g = st._grab;
    st._grab = null;
    if (st.status !== 'play') return { counted: false };
    if (!g || g.i !== i) return { counted: false };
    /* A pin nudged by a pixel is not a decision, and charging for it would
     * make the budget feel arbitrary. */
    if (Math.hypot(st.pos[i].x - g.x, st.pos[i].y - g.y) < 0.02) return { counted: false };

    st.moves++;
    if (st.moves >= st.budget && !solved(st)) {
      st.status = 'lost';
      return { counted: true, lost: true };
    }
    return { counted: true, lost: false };
  }

  function movesLeft(st) { return Math.max(0, st.budget - st.moves); }

  /* The rewarded-ad booster, and the reason a failed level is worth money
   * rather than just being a dead end. Capped, because a budget you can extend
   * forever is not a budget. */
  function addMoves(st, n) {
    if (st.extraGrants >= 2) return { ok: false, reason: 'max' };
    if (st.status === 'won') return { ok: false, reason: 'over' };
    st.extraGrants++;
    st.budget += (n || 5);
    if (st.status === 'lost') st.status = 'play';
    return { ok: true, budget: st.budget };
  }

  /* How much slack over the shortest possible solution. Generous while the
   * player is still learning what the game wants, tight enough later that
   * flailing runs out. */
  function budgetFor(level, par) {
    var L = Math.max(1, level | 0);
    return par + clamp(Math.round(8 - L * 0.06), 3, 8);
  }

  /* The hint, and the reason this game needs no solver gate.
   *
   * Screw Out can be played into a dead end, so there it genuinely matters
   * that something other than the construction order can win. Here nothing is
   * irreversible, there is no timer and no move limit - the only real risk is
   * a player who cannot see the way out and gives up. So the guarantee worth
   * making is a different one: that a stuck player can always finish.
   *
   * Each hint puts one pin where it belongs and, if something is already
   * sitting there, sends that one to the vacated spot. A pin placed this way
   * can only be moved again by the player, so the count of correctly placed
   * pins never goes down and every hint raises it by at least one. Enough
   * hints therefore always reach the answer - at most one per pin. */
  function hint(st) {
    if (st.status !== 'play') return { ok: false, reason: 'over' };
    var n = st.pos.length;
    var worst = -1, worstD = 1e-5;
    for (var i = 0; i < n; i++) {
      var d = Math.hypot(st.pos[i].x - st.solution[i].x, st.pos[i].y - st.solution[i].y);
      if (d > worstD) { worstD = d; worst = i; }
    }
    if (worst < 0) return { ok: false, reason: 'already placed' };

    var target = st.solution[worst];
    var from = { x: st.pos[worst].x, y: st.pos[worst].y };

    /* Whoever is standing on the target slot has to go somewhere, and the spot
     * we just vacated is the one place we know is free. */
    var occupant = -1;
    for (var j = 0; j < n; j++) {
      if (j === worst) continue;
      if (Math.hypot(st.pos[j].x - target.x, st.pos[j].y - target.y) < 1e-4) { occupant = j; break; }
    }
    st.pos[worst] = { x: target.x, y: target.y };
    if (occupant >= 0) st.pos[occupant] = from;

    st.hints++;
    if (solved(st)) st.status = 'won';
    return { ok: true, pin: worst, occupant: occupant, solved: st.status === 'won' };
  }

  function snapshot(st) {
    return JSON.parse(JSON.stringify({
      pos: st.pos, edges: st.edges, moves: st.moves,
      budget: st.budget, status: st.status
    }));
  }

  /* ------------------------------------------------------------------ */
  /* generator                                                           */
  /* ------------------------------------------------------------------ */

  /* Points spread with a crude dart-throwing rule. Evenly spaced pins make a
   * readable tangle; clustered pins make ropes that are impossible to tell
   * apart no matter how correct the maths underneath is. */
  function scatter(rnd, n, minDist) {
    var pts = [], guard = 0;
    while (pts.length < n && guard++ < n * 400) {
      var p = { x: MARGIN + rnd() * (1 - 2 * MARGIN), y: MARGIN + rnd() * (1 - 2 * MARGIN) };
      var okp = true;
      for (var i = 0; i < pts.length; i++) {
        if (Math.hypot(pts[i].x - p.x, pts[i].y - p.y) < minDist) { okp = false; break; }
      }
      if (okp) pts.push(p);
    }
    return pts;
  }

  function buildPlanar(rnd, pts, maxEdges) {
    var n = pts.length;
    var cand = [];
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        cand.push({ a: i, b: j, d: Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) });
      }
    }
    /* Short ropes first. Long ropes reach across the board, cross everything,
     * and get rejected anyway - and the few that survive look like mistakes. */
    cand.sort(function (p, q) { return p.d - q.d; });

    var edges = [];
    function crossesExisting(a, b) {
      var p1 = pts[a], p2 = pts[b];
      for (var k = 0; k < edges.length; k++) {
        var e = edges[k];
        var shared = e[0] === a || e[0] === b || e[1] === a || e[1] === b;
        if (segCross(p1, p2, pts[e[0]], pts[e[1]], shared)) return true;
      }
      /* Keep a rope clear of pins it does not belong to, or the finished
       * layout would already read as tangled. */
      for (var v = 0; v < n; v++) {
        if (v === a || v === b) continue;
        if (segDist(p1, p2, pts[v]) < PIN_ON_ROPE * 1.6) return true;
      }
      return false;
    }

    for (var c = 0; c < cand.length && edges.length < maxEdges; c++) {
      var e2 = cand[c];
      if (rnd() < 0.14) continue;            /* skip a few, so it is not always the same skeleton */
      if (crossesExisting(e2.a, e2.b)) continue;
      edges.push([e2.a, e2.b]);
    }

    /* Connect anything left stranded, otherwise a lone pin has nothing to do
     * and the player is hunting for a piece that never mattered. */
    var parent = [];
    for (var u = 0; u < n; u++) parent.push(u);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function uni(x, y) { var rx = find(x), ry = find(y); if (rx !== ry) { parent[rx] = ry; return true; } return false; }
    edges.forEach(function (e) { uni(e[0], e[1]); });

    for (var c2 = 0; c2 < cand.length; c2++) {
      var e3 = cand[c2];
      if (find(e3.a) === find(e3.b)) continue;
      if (crossesExisting(e3.a, e3.b)) continue;
      edges.push([e3.a, e3.b]);
      uni(e3.a, e3.b);
    }

    var root = find(0), connected = true;
    for (var v2 = 1; v2 < n; v2++) if (find(v2) !== root) connected = false;
    return connected ? edges : null;
  }

  function config(level) {
    var L = Math.max(1, level | 0);
    /* Pins grow slowly. Twenty pins is already a serious tangle on a phone;
     * past that the ropes get too thin to tell apart and difficulty turns into
     * eyesight. */
    var pins = Math.round(clamp(4 + L * 0.26, 4, 16));
    var density = clamp(1.35 + L * 0.010, 1.35, 1.85);   /* ropes per pin */
    return {
      pins: pins,
      maxEdges: Math.round(pins * density),
      minDist: clamp(0.30 - pins * 0.009, 0.115, 0.30),
      /* How thoroughly the pins get shuffled. This is the difficulty dial that
       * actually matters: the same graph is trivial or brutal depending on how
       * far the start is from any untangled arrangement. */
      scramble: clamp(0.35 + L * 0.022, 0.35, 1)
    };
  }

  function generate(level, seed, tweak) {
    var cfg = config(level);
    if (tweak && tweak.scramble !== undefined) cfg.scramble = clamp(tweak.scramble, 0.2, 1);

    for (var attempt = 0; attempt < 160; attempt++) {
      var rnd = mkRng((seed || 1) * 6971 + attempt * 96731 + level * 37);
      var pts = scatter(rnd, cfg.pins, cfg.minDist);
      if (pts.length < cfg.pins) continue;

      /* Stretch the cloud to fill the board. Dart-throwing leaves a random
       * amount of unused margin, and a tangle huddled in one corner wastes
       * most of the screen and shrinks the pins for no reason. */
      var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      pts.forEach(function (p) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      });
      var spanX = Math.max(1e-6, maxX - minX), spanY = Math.max(1e-6, maxY - minY);
      var lo = MARGIN, hi = 1 - MARGIN;
      pts.forEach(function (p) {
        p.x = lo + (p.x - minX) / spanX * (hi - lo);
        p.y = lo + (p.y - minY) / spanY * (hi - lo);
      });

      var edges = buildPlanar(rnd, pts, cfg.maxEdges);
      if (!edges || edges.length < cfg.pins) continue;

      var probe = { pos: pts.map(function (p) { return { x: p.x, y: p.y }; }), edges: edges, status: 'play', moves: 0 };
      if (crossings(probe) !== 0) continue;   /* the answer must genuinely be an answer */

      /* Shuffle pins among the solution slots. How many get displaced is the
       * difficulty dial. */
      var idx = [];
      for (var i = 0; i < pts.length; i++) idx.push(i);
      var howMany = Math.max(2, Math.round(pts.length * cfg.scramble));
      var chosen = idx.slice();
      for (var s = chosen.length - 1; s > 0; s--) {
        var j = (rnd() * (s + 1)) | 0, t = chosen[s]; chosen[s] = chosen[j]; chosen[j] = t;
      }
      chosen = chosen.slice(0, howMany);
      var rotated = chosen.slice();
      for (var s2 = rotated.length - 1; s2 > 0; s2--) {
        var j2 = (rnd() * (s2 + 1)) | 0, t2 = rotated[s2]; rotated[s2] = rotated[j2]; rotated[j2] = t2;
      }
      var start = pts.map(function (p) { return { x: p.x, y: p.y }; });
      var displaced = 0;
      for (var k = 0; k < chosen.length; k++) {
        start[chosen[k]] = { x: pts[rotated[k]].x, y: pts[rotated[k]].y };
        if (chosen[k] !== rotated[k]) displaced++;
      }
      if (displaced < 2) continue;

      var st0 = { pos: start.map(function (p) { return { x: p.x, y: p.y }; }), edges: edges, status: 'play', moves: 0 };
      var startCross = crossings(st0);
      if (startCross === 0) continue;         /* a level that starts solved is not a level */

      var lv = {
        level: level,
        edges: edges,
        solution: pts.map(function (p) { return { x: +p.x.toFixed(4), y: +p.y.toFixed(4) }; }),
        start: start.map(function (p) { return { x: +p.x.toFixed(4), y: +p.y.toFixed(4) }; }),
        par: Math.max(2, displaced)
      };

      /* Play the answer back through the public API. If the level does not
       * report itself solved, the level does not ship. */
      var check = instantiate(lv);
      for (var v = 0; v < lv.solution.length; v++) {
        moveNode(check, v, lv.solution[v].x, lv.solution[v].y);
      }
      if (check.status !== 'won') continue;

      lv.stats = {
        pins: pts.length, ropes: edges.length,
        startCrossings: startCross, displaced: displaced
      };
      return lv;
    }
    return null;
  }

  function instantiate(level) {
    return {
      level: level.level,
      edges: level.edges.map(function (e) { return [e[0], e[1]]; }),
      pos: level.start.map(function (p) { return { x: p.x, y: p.y }; }),
      solution: level.solution.map(function (p) { return { x: p.x, y: p.y }; }),
      par: level.par,
      budget: budgetFor(level.level, level.par),
      moves: 0,
      hints: 0,
      extraGrants: 0,
      _grab: null,
      status: 'play'
    };
  }

  /* ------------------------------------------------------------------ */
  /* difficulty, measured                                                */
  /* ------------------------------------------------------------------ */

  /* A solver that never saw the answer.
   *
   * The first attempt at this was "drag the worst pin somewhere random that
   * looks better", which stopped solving anything at all past ten pins and
   * took two minutes per level. It was measuring the solver, not the puzzle.
   *
   * This one swaps pairs of pins, which is both far stronger and a fair model
   * of how the game is actually played - nobody drags a pin to an empty patch
   * of board, they notice two pins are on each other's side and trade them.
   * Hill-climbing on swaps, with a kick when it stalls. */
  /* Annealing rather than hill-climbing.
   *
   * The first version scanned every pair and took the best swap, kicking
   * randomly when nothing improved. It got stuck constantly - at twenty pins
   * it failed on nearly half the boards - because untangling has enormous
   * plateaus where no single swap helps and you have to go through a worse
   * arrangement to reach a better one. Annealing accepts those on purpose, and
   * because it tries one random swap per step instead of scanning all of them
   * it is also an order of magnitude cheaper per step. */
  function solveBySwaps(level, seed, budget) {
    var rnd = mkRng(seed);
    var st = instantiate(level);
    st.budget = Infinity;   /* measuring the board, not the player's allowance */
    var n = st.pos.length;
    budget = budget || (4000 + n * 700);
    var cur = crossings(st);
    var moves = 0;
    var T0 = Math.max(1.2, cur * 0.10), T1 = 0.03;
    var ratio = T1 / T0;

    for (var step = 0; step < budget && cur > 0; step++) {
      var T = T0 * Math.pow(ratio, step / budget);
      var i = (rnd() * n) | 0, j = (rnd() * n) | 0;
      if (i === j) continue;
      var pi = st.pos[i], pj = st.pos[j];
      st.pos[i] = pj; st.pos[j] = pi;
      var got = crossings(st);
      var d = got - cur;
      if (d <= 0 || rnd() < Math.exp(-d / T)) {
        cur = got; moves++;
      } else {
        st.pos[i] = pi; st.pos[j] = pj;
      }
    }
    return { won: cur === 0, moves: moves };
  }

  function robust(level, tries, seed) {
    for (var i = 0; i < tries; i++) {
      if (solveBySwaps(level, (seed || 1) + i * 811).won) return true;
    }
    return false;
  }

  /* Difficulty here is how tangled the board starts, measured per rope so that
   * it means the same thing on a five-rope board and a thirty-seven-rope one.
   * This is cheap and it is honest - unlike a "how often does a bot win"
   * figure produced by a bot too weak to win anything. */
  function targetTangle(L) {
    return clamp(0.25 + L * 0.042, 0.25, 1.95);
  }

  function generateTuned(level, seed, opts) {
    opts = opts || {};
    var K = opts.candidates || 10;
    var gateTries = opts.gate === undefined ? 2 : opts.gate;
    var want = targetTangle(level);
    var pool = [];
    for (var k = 0; k < K; k++) {
      var f = K > 1 ? k / (K - 1) : 0.5;
      var base = config(level).scramble;
      var lv = generate(level, (seed || 1) + k * 3457, { scramble: base * (0.5 + 0.85 * f) });
      if (!lv) continue;
      lv.stats.tangle = lv.stats.startCrossings / lv.stats.ropes;
      pool.push({ lv: lv, cost: Math.abs(lv.stats.tangle - want) });
    }
    if (!pool.length) return null;
    pool.sort(function (a, b) { return a.cost - b.cost; });
    if (!gateTries) return pool[0].lv;

    /* Take the closest to target that a solver which never saw the answer can
     * also untangle. The witness already proves an answer exists; this proves
     * the answer is findable, which is a different and more useful claim.
     * Gating only the shortlist rather than every candidate keeps the build
     * from spending a minute a level on boards it is going to discard. */
    for (var i = 0; i < Math.min(pool.length, 2); i++) {
      if (robust(pool[i].lv, gateTries, 60013 + level * 7)) {
        pool[i].lv.stats.gated = true;
        return pool[i].lv;
      }
    }
    return pool[0].lv;
  }

  return {
    MARGIN: MARGIN, PIN_ON_ROPE: PIN_ON_ROPE,
    mkRng: mkRng, segCross: segCross, segDist: segDist,
    crossings: crossings, edgeTangled: edgeTangled, solved: solved,
    moveNode: moveNode, beginDrag: beginDrag, endDrag: endDrag,
    movesLeft: movesLeft, addMoves: addMoves, budgetFor: budgetFor,
    hint: hint, snapshot: snapshot,
    config: config, generate: generate, generateTuned: generateTuned,
    instantiate: instantiate, solveBySwaps: solveBySwaps, robust: robust,
    targetTangle: targetTangle
  };
}));
