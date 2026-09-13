/* =============================================================================
   Building background: the pipeline, as a Sankey — with the validation nodes
   drawn as the matrices of checks they are.

   Records enter from four sources on the left, pass through two validation
   matrices, flow on to reconciliation, rebalancing and analytics, and out to
   the dashboard, the advisor email and the trade file; what fails validation
   is diverted, thin, to an exceptions queue and on to review. Widths are
   volumes, and the volumes drift, so the whole diagram breathes.

   The workflow is the animation. Every couple of seconds a batch enters and
   is carried through as a stream of packets. When it reaches a validation
   matrix the checks run cell by cell, a few fail and are flagged, and the
   batch splits — the passes on, the failures off to the queue. Batches
   overlap, so several stages run at once, which is what a pipeline is.
   ========================================================================== */

(function () {
  "use strict";
  if (!window.FZViz) return;

  /* ---------- Tunables ---------------------------------------------------- */

  var BATCH_T = 2.2;     // seconds between batches entering
  var S0 = 0.9;          // seconds: sources to validation
  var SC = 0.6;          // seconds: the scan
  var S1 = 0.9;          // seconds: validation to processing
  var S2 = 0.9;          // seconds: processing to outputs
  var TOTAL = S0 + SC + S1 + S2;
  var PD = 0.3;          // packets per unit of volume
  var SPREAD = 0.3;      // how far a batch strings out along a link, as a share of it
  var MAXP = 16;         // packets per link, at most
  var CELL = 6;          // matrix cell pitch, px — smaller reads as a dotted bar, not a grid
  var MAXR = 40;         // matrix rows, at most
  var BAR = 4;           // node bar width, px
  var MW = 4 * CELL - 1.5;   // matrix node width: four checks across

  /* The pipeline. Names are documentation — nothing is labelled on screen. */
  var NODES = [
    { c: 0, name: "holdings" },
    { c: 0, name: "benchmarks" },
    { c: 0, name: "prices" },
    { c: 0, name: "corporate actions" },
    { c: 1, name: "validate", matrix: true },
    { c: 1, name: "validate", matrix: true },
    { c: 2, name: "reconcile" },
    { c: 2, name: "rebalance" },
    { c: 2, name: "analytics" },
    { c: 2, name: "exceptions" },
    { c: 3, name: "dashboard" },
    { c: 3, name: "email" },
    { c: 3, name: "trades" },
    { c: 3, name: "review" }
  ];
  var EXC = 9;           // the exceptions queue

  // [source, target, base volume], grouped by source, targets ascending, so
  // the ports stack without crossing on either side.
  var LINKS = [
    [0, 4, 30], [1, 4, 26], [2, 5, 34], [3, 5, 12],
    [4, 6, 32], [4, 7, 21], [4, EXC, 3],
    [5, 7, 14], [5, 8, 30], [5, EXC, 2],
    [6, 10, 20], [6, 11, 12],
    [7, 11, 10], [7, 12, 25],
    [8, 10, 18], [8, 11, 12],
    [EXC, 13, 5]
  ];

  /* ---------- State ------------------------------------------------------- */

  var NN = NODES.length, NL = LINKS.length;
  var vol = new Float64Array(NL), lw = new Float64Array(NL), lp = new Float64Array(NL);
  var lx0 = new Float64Array(NL), ly0 = new Float64Array(NL);
  var lx1 = new Float64Array(NL), ly1 = new Float64Array(NL), lth = new Float64Array(NL);
  var pph = new Float64Array(NL * MAXP), plat = new Float64Array(NL * MAXP);
  var nin = new Float64Array(NN), nout = new Float64Array(NN), val = new Float64Array(NN);
  var nx = new Float64Array(NN), ny = new Float64Array(NN), nh = new Float64Array(NN), nw = new Float64Array(NN);
  var outOff = new Float64Array(NN), inOff = new Float64Array(NN);
  var flash = new Float64Array(NN);
  var mat = [
    { scanAt: -1e9, fail: new Uint8Array(MAXR * 4) },
    { scanAt: -1e9, fail: new Uint8Array(MAXR * 4) }
  ];
  var batches = [];
  var nextBatch = 0, lastT = 0;
  var pt = [0, 0];

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Share of checks failing at matrix m: drifts between two and eight percent.
  function failRate(m, t) { return 0.05 + 0.03 * Math.sin(t * 0.11 + m * 2.1); }

  /* ---------- Geometry ---------------------------------------------------- */

  /* Beside the head, bounded like the tree and the network: the outputs are
     the right edge of the thing, so the box stays inside the canvas. It runs
     from the top of the section to just past the head, above the cards. */
  function plotRect(env) {
    // On a narrow screen the pipeline is a figure above the copy, not a
    // backdrop beside it. The harness says which.
    if (env.mode === "band") return window.FZViz.bandRect(env, 1.6);
    var W = env.W, H = env.H;
    if (W < 760 || H < 260) return null;
    var k = env.keepOut;
    var edge = k ? k.x + k.w : W * 0.62;
    var x = Math.max(W * 0.54, edge + 56);
    var w = Math.min(W - 40 - x, 620);
    if (w < 240) return null;
    var y = 20;
    var bottom = k ? k.y + k.h + 40 : H * 0.3;
    var h = Math.min(bottom - y, w / 1.3, 360);
    if (h < 150) return null;
    return { x: x, y: y, w: w, h: h };
  }

  /* ---------- Layout ------------------------------------------------------ */

  /* A Sankey every frame: volumes from their drift, node heights from the
     volumes on one common scale, nodes stacked and centred in each column,
     ports stacked on each node in link order. Seventeen links; nothing here
     is worth caching. */
  function layout(R, t) {
    var i, r, c, L;

    for (r = 0; r < NL; r++) {
      L = LINKS[r];
      var v = L[2] * (1 + 0.18 * Math.sin(t * lw[r] + lp[r]));
      // The exceptions carry the fail rate, not a drift of their own.
      if (L[1] === EXC) v = L[2] * failRate(L[0] - 4, t) / 0.05;
      vol[r] = v;
    }

    nin.fill(0); nout.fill(0);
    for (r = 0; r < NL; r++) { nout[LINKS[r][0]] += vol[r]; nin[LINKS[r][1]] += vol[r]; }
    for (i = 0; i < NN; i++) val[i] = nin[i] > nout[i] ? nin[i] : nout[i];

    var gap = clamp(R.h * 0.06, 6, 18);
    var scale = 1e9, total, n;
    for (c = 0; c < 4; c++) {
      total = 0; n = 0;
      for (i = 0; i < NN; i++) if (NODES[i].c === c) { total += val[i]; n++; }
      var s = (R.h - gap * (n - 1)) / total;
      if (s < scale) scale = s;
    }

    for (c = 0; c < 4; c++) {
      total = 0; n = 0;
      for (i = 0; i < NN; i++) if (NODES[i].c === c) { total += val[i]; n++; }
      var y = R.y + (R.h - (total * scale + gap * (n - 1))) / 2;
      var x = R.x + (R.w - BAR) * c / 3;
      if (c === 1) x -= (MW - BAR) / 2;
      for (i = 0; i < NN; i++) {
        if (NODES[i].c !== c) continue;
        nx[i] = x;
        ny[i] = y;
        nh[i] = val[i] * scale;
        nw[i] = NODES[i].matrix ? MW : BAR;
        y += nh[i] + gap;
      }
    }

    outOff.fill(0); inOff.fill(0);
    for (r = 0; r < NL; r++) {
      L = LINKS[r];
      var th = vol[r] * scale;
      lx0[r] = nx[L[0]] + nw[L[0]];
      ly0[r] = ny[L[0]] + outOff[L[0]];
      lx1[r] = nx[L[1]];
      ly1[r] = ny[L[1]] + inOff[L[1]];
      lth[r] = th;
      outOff[L[0]] += th;
      inOff[L[1]] += th;
    }
  }

  /* A point on link r: u along it, f across it. The two edges of a ribbon
     are the same cubic shifted by the thickness, so across is a plain offset. */
  function along(r, u, f, out) {
    var v = 1 - u, cx = (lx0[r] + lx1[r]) / 2;
    var a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    out[0] = a * lx0[r] + (b + c) * cx + d * lx1[r];
    out[1] = (a + b) * ly0[r] + (c + d) * ly1[r] + f * lth[r];
    return out;
  }

  /* ---------- The workflow ------------------------------------------------ */

  function scan(at) {
    for (var m = 0; m < 2; m++) {
      var M = mat[m], rate = failRate(m, at);
      M.scanAt = at;
      for (var k = 0; k < M.fail.length; k++) M.fail[k] = Math.random() < rate ? 1 : 0;
    }
  }

  function flashColumn(c) {
    for (var i = 0; i < NN; i++) if (NODES[i].c === c) flash[i] = 1;
  }

  function advance(t, dt) {
    if (t >= nextBatch) {
      batches.push({ t0: t, fired: 0 });
      nextBatch = t + BATCH_T;
    }
    for (var k = batches.length - 1; k >= 0; k--) {
      var b = batches[k], a = t - b.t0;
      if (b.fired < 1 && a >= S0) { scan(b.t0 + S0); flashColumn(1); b.fired = 1; }
      if (b.fired < 2 && a >= S0 + SC + S1) { flashColumn(2); b.fired = 2; }
      if (b.fired < 3 && a >= TOTAL) { flashColumn(3); b.fired = 3; batches.splice(k, 1); }
    }
    var kf = Math.exp(-dt * 3);
    for (var i = 0; i < NN; i++) flash[i] *= kf;
  }

  /* ---------- Draw -------------------------------------------------------- */

  function ribbon(ctx, r, th) {
    var cx = (lx0[r] + lx1[r]) / 2;
    ctx.moveTo(lx0[r], ly0[r]);
    ctx.bezierCurveTo(cx, ly0[r], cx, ly1[r], lx1[r], ly1[r]);
    ctx.lineTo(lx1[r], ly1[r] + th);
    ctx.bezierCurveTo(cx, ly1[r] + th, cx, ly0[r] + th, lx0[r], ly0[r] + th);
    ctx.closePath();
  }

  function matrix(env, i, m, t) {
    var ctx = env.ctx;
    var boost = env.light ? 1.4 : 1;
    var M = mat[m];
    var rows = clamp(Math.floor(nh[i] / CELL), 2, MAXR);
    var n = rows * 4;
    var top = ny[i] + (nh[i] - rows * CELL) / 2 + 0.75;
    var side = CELL - 1.5;

    for (var k = 0; k < n; k++) {
      var x = nx[i] + (k & 3) * CELL, y = top + (k >> 2) * CELL;
      var age = t - (M.scanAt + (k / n) * SC);
      if (age < 0) {
        // Not reached yet this scan: idle.
        ctx.fillStyle = env.rgba("accent", 0.16 * boost);
        ctx.fillRect(x, y, side, side);
      } else if (M.fail[k]) {
        // Flagged: hollow, and it stays that way until the next scan.
        ctx.strokeStyle = env.rgba("accent-hi", (0.35 + 0.5 * Math.exp(-age * 0.5)) * boost);
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, side - 1, side - 1);
      } else {
        // Passed: a pulse that settles to checked.
        ctx.fillStyle = env.rgba("accent-hi", (0.22 + 0.62 * Math.exp(-age * 1.1)) * boost);
        ctx.fillRect(x, y, side, side);
      }
    }
  }

  function draw(env, R, t) {
    var ctx = env.ctx;
    // Deep navy on white needs more alpha than pale blue on near-black.
    var boost = env.light ? 1.4 : 1;
    var i, r, k;

    /* --- the ribbons: volumes, faint fill and a crisp edge ----------------- */
    for (r = 0; r < NL; r++) {
      var exc = LINKS[r][1] === EXC || LINKS[r][0] === EXC;
      var th = lth[r] < 1.2 ? 1.2 : lth[r];
      ctx.beginPath();
      ribbon(ctx, r, th);
      ctx.fillStyle = env.rgba(exc ? "muted" : "accent", 0.10 * boost);
      ctx.fill();
      ctx.strokeStyle = env.rgba(exc ? "muted" : "accent", 0.20 * boost);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    /* --- the nodes: bars, and the validation matrices --------------------- */
    for (i = 0; i < NN; i++) {
      if (NODES[i].matrix) { matrix(env, i, i - 4, t); continue; }
      ctx.fillStyle = env.rgba("accent-hi", (0.50 + flash[i] * 0.45) * boost);
      ctx.fillRect(nx[i], ny[i], BAR, nh[i]);
    }

    /* --- the batches in flight, as packets --------------------------------- */
    ctx.fillStyle = env.rgba("accent-hi", 0.85 * boost);
    ctx.beginPath();
    for (k = 0; k < batches.length; k++) {
      var a = t - batches[k].t0, col, us;
      if (a < S0)                 { col = 0; us = a / S0; }
      else if (a < S0 + SC)       { continue; }                       // in the matrix
      else if (a < S0 + SC + S1)  { col = 1; us = (a - S0 - SC) / S1; }
      else if (a < TOTAL)         { col = 2; us = (a - S0 - SC - S1) / S2; }
      else continue;

      for (r = 0; r < NL; r++) {
        if (NODES[LINKS[r][0]].c !== col) continue;
        var n = Math.round(vol[r] * PD);
        if (n < 1) n = 1; else if (n > MAXP) n = MAXP;
        for (i = 0; i < n; i++) {
          var u = (us - pph[r * MAXP + i]) / (1 - SPREAD);
          if (u <= 0 || u >= 1) continue;
          along(r, u, plat[r * MAXP + i], pt);
          ctx.moveTo(pt[0] + 1.3, pt[1]);
          ctx.arc(pt[0], pt[1], 1.3, 0, 6.2832);
        }
      }
    }
    ctx.fill();

    /* Keep the pipeline off the copy. Measured against the real text box, so
       it genuinely is not there rather than being washed out behind it. */
    window.FZViz.softErase(ctx, env.keepOut, 12, 54);
  }

  /* ---------- Spec -------------------------------------------------------- */

  window.FZViz.mount("pipeline", {
    seed: function (env) {
      var r, i;
      for (r = 0; r < NL; r++) {
        lw[r] = rnd(0.05, 0.11);
        lp[r] = rnd(0, 6.283);
        // Where each packet rides in its stream: how far behind the front,
        // and how far across the ribbon.
        for (i = 0; i < MAXP; i++) {
          pph[r * MAXP + i] = rnd(0, SPREAD);
          plat[r * MAXP + i] = rnd(0.12, 0.88);
        }
      }
      flash.fill(0);
      batches.length = 0;
      lastT = env.t;
      nextBatch = env.t + 0.6;
      // A scan a moment ago, so the matrices read as checked from the first
      // frame — and as the settled frame under reduced motion.
      scan(env.t - 1.0);
    },

    frame: function (env) {
      var R = plotRect(env);
      if (!R) return;            // no room to draw is no reason to run the batches
      var t = env.t;
      var dt = t - lastT;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      lastT = t;

      if (!env.reduced) advance(t, dt);
      layout(R, t);
      draw(env, R, t);
    }
  });
})();
