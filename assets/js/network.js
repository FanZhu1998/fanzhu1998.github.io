/* =============================================================================
   Hero background: a live correlation network over the 49 Fama–French industry
   portfolios — the object the honors thesis builds from real correlation
   matrices, driven here by a small simulated factor model.

   Correlations come from three factors: a market factor whose weight is lambda,
   a sector factor that carries whatever variance the market factor leaves, and
   a slowly rotating "style" factor that keeps the structure evolving. Lambda is
   driven by a regime process that flips between calm and stress, and stress
   regimes are shorter and more violent than calm ones.

   Correlations become distances the way the thesis does it, d = sqrt(2(1-rho)),
   and the layout is a stress embedding of those distances. So the geometry is
   the correlation structure: when correlations rise the entire network
   physically contracts toward one hub, and when they fall it sprawls back out
   into sector clusters. Onnela et al. measured exactly that on real data — the
   spanning tree shrinks in a crash.

   Each frame draws the faint web of the strongest pairwise correlations, the
   minimum spanning tree over d as the bright backbone, a flash on every edge
   the tree rewires, node radius by MST degree, and a shockwave on a regime
   shift.
   ========================================================================== */

(function () {
  "use strict";

  var canvas = document.getElementById("network");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d", { alpha: true });
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Fama–French 49 industry portfolios, in the library's own order.
  var INDUSTRIES = [
    "Agric", "Food", "Soda", "Beer", "Smoke", "Toys", "Fun", "Books", "Hshld",
    "Clths", "Hlth", "MedEq", "Drugs", "Chems", "Rubbr", "Txtls", "BldMt",
    "Cnstr", "Steel", "FabPr", "Mach", "ElcEq", "Autos", "Aero", "Ships",
    "Guns", "Gold", "Mines", "Coal", "Oil", "Util", "Telcm", "PerSv", "BusSv",
    "Hardw", "Softw", "Chips", "LabEq", "Paper", "Boxes", "Trans", "Whlsl",
    "Rtail", "Meals", "Banks", "Insur", "RlEst", "Fin", "Other"
  ];

  /* Sector of each industry above: 0 consumer/staples, 1 healthcare,
     2 industrials, 3 energy & materials, 4 technology, 5 financials,
     6 services/retail/transport, 7 utilities & telecom. The sector factor is
     what produces visible blocks in a calm regime — and what a stress regime
     drowns out. */
  var SECTOR = [
    0, 0, 0, 0, 0, 0, 6, 6, 0, 0,
    1, 1, 1,
    3, 2, 2, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2,
    3, 3, 3, 3,
    7, 7,
    6, 6,
    4, 4, 4, 4,
    2, 2,
    6, 6, 6, 6,
    5, 5, 5, 5,
    6
  ];

  /* ---------- Tunables ---------------------------------------------------- */

  var RATE = 0.22;       // fraction of each solver step taken per frame
  var SCALE = 0.32;      // distance scale, as a share of the short canvas side
  var MAXWEB = 320;      // hard cap on faint correlation edges drawn
  var STYLE_AMP = 0.30;  // how much the rotating style factor can move a pair

  /* ---------- State ------------------------------------------------------- */

  var nodes = [];
  var n = 0;
  var rho = null;        // Float32Array(n*n) correlation
  var dst = null;        // Float32Array(n*n) sqrt(2(1-rho))
  var flash = null;      // Float32Array(n*n) rewire flash, decays
  var mstNow = null;     // Uint8Array(n*n)
  var mstPrev = null;    // Uint8Array(n*n)
  var edges = [];        // [i, j] pairs currently in the tree
  var inTree = null, best = null, from = null;   // Prim scratch, reused
  var nx = null, ny = null;                      // solver scratch, reused
  var eps = null;        // Float32Array(n*n) fixed per-pair idiosyncrasy

  var webX = new Float32Array(MAXWEB * 4);
  var webB = new Uint8Array(MAXWEB);
  var webN = 0;
  var HIST = 40;
  var hist = new Int32Array(HIST);

  /* A fixed affinity between each pair of sectors, drawn once. Some sectors
     travel together, some pull apart — it is what gives the calm regime a
     shape instead of eight interchangeable blobs. A stressed market scales
     it out of the way. */
  var SECTORS = 8;
  var secAff = new Float32Array(SECTORS * SECTORS);
  (function () {
    for (var g = 0; g < SECTORS; g++) {
      for (var h = g + 1; h < SECTORS; h++) {
        var v = -0.24 + Math.random() * 0.52;
        secAff[g * SECTORS + h] = secAff[h * SECTORS + g] = v;
      }
    }
  })();

  var W = 0, H = 0, dpr = 1, S = 1, sx = 1;
  var running = false, rafId = null, clock = 0, frame = 0;

  // Regime process.
  var lambda = 0.07, lamFrom = 0.07, lamTo = 0.07;
  var shiftT = 1, shiftDur = 200, nextShift = 600;
  var stressed = false, pulse = 0, ring = 1;

  var palette = { edge: "125,171,221", node: "125,171,221", ink: "127,146,169" };

  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    palette.edge = toRgbTriplet(cs.getPropertyValue("--accent")) || palette.edge;
    palette.node = palette.edge;
    palette.ink = toRgbTriplet(cs.getPropertyValue("--muted")) || palette.ink;
  }

  function toRgbTriplet(hex) {
    hex = (hex || "").trim();
    if (hex.charAt(0) !== "#") return null;
    if (hex.length === 4) {
      hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (hex.length !== 7) return null;
    var v = parseInt(hex.slice(1), 16);
    if (isNaN(v)) return null;
    return ((v >> 16) & 255) + "," + ((v >> 8) & 255) + "," + (v & 255);
  }

  function nodeCount() {
    if (W < 620) return 24;
    if (W < 1000) return 34;
    return INDUSTRIES.length;
  }

  function seed() {
    n = nodeCount();
    nodes = new Array(n);

    // Spread the sample across the whole industry list so the sector mix holds
    // at every screen size.
    for (var i = 0; i < n; i++) {
      var src = Math.floor(i * INDUSTRIES.length / n);
      var ang = Math.random() * Math.PI * 2;
      var rad = Math.sqrt(Math.random()) * S * 1.2;
      nodes[i] = {
        name: INDUSTRIES[src],
        sector: SECTOR[src],
        beta: 0.82 + Math.random() * 0.34,   // market beta
        sload: 0.80 + Math.random() * 0.18,  // sector loading
        ph1: Math.random() * 6.283,
        ph2: Math.random() * 6.283,
        w1: 0.13 + Math.random() * 0.20,     // style rotation speed
        w2: 0.13 + Math.random() * 0.20,
        amp: STYLE_AMP * (0.55 + Math.random() * 0.45),
        a: 0, b: 0, u: 0, v: 0,
        x: Math.cos(ang) * rad,
        y: Math.sin(ang) * rad,
        deg: 0
      };
    }

    rho = new Float32Array(n * n);
    dst = new Float32Array(n * n);
    flash = new Float32Array(n * n);
    mstNow = new Uint8Array(n * n);
    mstPrev = new Uint8Array(n * n);
    inTree = new Uint8Array(n);
    best = new Float64Array(n);
    from = new Int32Array(n);
    nx = new Float64Array(n);
    ny = new Float64Array(n);

    // A fixed idiosyncratic term per pair, so a sector is a cluster with real
    // internal structure rather than a blob of interchangeable points.
    eps = new Float32Array(n * n);
    for (i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var e = (Math.random() - 0.5) * 0.20;
        eps[i * n + j] = eps[j * n + i] = e;
      }
    }

    // Pre-settle so the first painted frame is already a network rather than
    // a cloud of points converging, then prime the tree so the first frame
    // does not read every edge as a fresh rewiring and flash all of them.
    for (var k = 0; k < 150; k++) { correlate(); layout(1); }
    mst();
    flash.fill(0);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    W = Math.max(r.width, 1);
    H = Math.max(r.height, 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Distance scale, and a horizontal stretch so a wide hero still fills.
    S = Math.min(W / 1.25, H) * SCALE;
    sx = Math.max(1, Math.min(W / H, 1.6));

    seed();
    if (reduced) { mst(); draw(); }
  }

  /* ---------- Regime ------------------------------------------------------ */

  function regime() {
    frame++;

    if (frame >= nextShift) {
      stressed = !stressed;
      lamFrom = lambda;
      lamTo = stressed ? 0.60 + Math.random() * 0.24 : 0.03 + Math.random() * 0.09;
      shiftT = 0;
      // Stress arrives faster than it leaves.
      shiftDur = stressed ? 90 + Math.random() * 60 : 190 + Math.random() * 120;
      // Stress regimes are the shorter ones, as they are in the data.
      nextShift = frame + Math.round(stressed ? 420 + Math.random() * 420
                                              : 780 + Math.random() * 600);
      pulse = 1;
      ring = 0;
    }

    if (shiftT < 1) {
      shiftT = Math.min(1, shiftT + 1 / shiftDur);
      var e = shiftT * shiftT * (3 - 2 * shiftT);   // smoothstep
      lambda = lamFrom + (lamTo - lamFrom) * e;
    }

    pulse *= 0.977;
    if (ring < 1) ring = Math.min(1, ring + 1 / 95);
  }

  /* ---------- Correlation model ------------------------------------------- */

  function correlate() {
    var i, j;

    for (i = 0; i < n; i++) {
      var p = nodes[i];
      // Market loading takes lambda of the variance; the sector factor gets
      // what is left, so a stressed market genuinely crowds sectors out.
      p.a = Math.min(0.985, p.beta * Math.sqrt(lambda));
      p.b = Math.sqrt(Math.max(0, 1 - p.a * p.a)) * p.sload;
      p.u = Math.cos(clock * p.w1 + p.ph1) * p.amp;
      p.v = Math.sin(clock * p.w2 + p.ph2) * p.amp;
    }

    for (i = 0; i < n; i++) {
      var a = nodes[i];
      rho[i * n + i] = 1;
      for (j = i + 1; j < n; j++) {
        var b = nodes[j];
        var r = a.a * b.a
              + (a.sector === b.sector
                   ? a.b * b.b
                   : secAff[a.sector * SECTORS + b.sector] * (1 - lambda))
              + eps[i * n + j] * (1 - lambda)
              + a.u * b.u + a.v * b.v;
        if (r > 0.985) r = 0.985; else if (r < -0.55) r = -0.55;
        rho[i * n + j] = rho[j * n + i] = r;
        var d = Math.sqrt(2 * (1 - r));
        dst[i * n + j] = dst[j * n + i] = d;
      }
    }
  }

  /* Prim's algorithm over the correlation distances. O(n^2). */
  function mst() {
    var i, j;

    edges.length = 0;
    mstNow.fill(0);
    inTree.fill(0);
    for (i = 0; i < n; i++) { best[i] = Infinity; from[i] = -1; nodes[i].deg = 0; }
    if (n < 2) return;
    best[0] = 0;

    for (var k = 0; k < n; k++) {
      var u = -1, bd = Infinity;
      for (i = 0; i < n; i++) {
        if (!inTree[i] && best[i] < bd) { bd = best[i]; u = i; }
      }
      if (u === -1) break;
      inTree[u] = 1;

      var f = from[u];
      if (f !== -1) {
        edges.push(f, u);
        mstNow[f * n + u] = mstNow[u * n + f] = 1;
        nodes[u].deg++;
        nodes[f].deg++;
        // An edge the tree did not have last frame is a rewiring: flash it.
        if (!mstPrev[f * n + u]) flash[f * n + u] = flash[u * n + f] = 1;
      }

      for (j = 0; j < n; j++) {
        if (inTree[j]) continue;
        var d = dst[u * n + j];
        if (d < best[j]) { best[j] = d; from[j] = u; }
      }
    }

    var swap = mstPrev; mstPrev = mstNow; mstNow = swap;
  }

  /* Threshold that keeps the faint correlation web near a target edge count.
     A stressed market lifts every correlation at once, so the web genuinely
     densifies — the cap is what stops it from becoming a solid block. */
  function webThreshold() {
    var target = Math.min(MAXWEB, Math.round(n * (2.6 + 2.4 * lambda)));
    hist.fill(0);
    var i, j, total = 0;

    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        var r = rho[i * n + j];
        if (r <= 0) continue;
        var b = (r * HIST) | 0;
        if (b >= HIST) b = HIST - 1;
        hist[b]++;
        total++;
      }
    }
    if (!total) return 1;

    var acc = 0;
    for (var k = HIST - 1; k >= 0; k--) {
      acc += hist[k];
      if (acc >= target) return k / HIST;
    }
    return 0;
  }

  /* ---------- Layout ------------------------------------------------------ */

  /* One SMACOF (stress majorisation) sweep. Each node moves toward the point
     that best satisfies its target distance to every other node, weighted
     1/d^2 so the strongest correlations dominate the fit. Taking only a
     fraction of that step per frame is what turns the solver into the
     animation: the layout is always chasing a correlation matrix that has
     already moved on. */
  function layout(rate) {
    var i, j;

    for (i = 0; i < n; i++) {
      var xi = nodes[i].x, yi = nodes[i].y;
      var ax = 0, ay = 0, aw = 0;

      for (j = 0; j < n; j++) {
        if (j === i) continue;
        var tgt = S * dst[i * n + j];
        if (tgt < 1) tgt = 1;
        var xj = nodes[j].x, yj = nodes[j].y;
        var dx = xi - xj, dy = yi - yj;
        var L = Math.sqrt(dx * dx + dy * dy);
        if (L < 0.01) { L = 0.01; dx = 0.01; dy = 0; }
        var w = 1 / (tgt * tgt);
        ax += w * (xj + tgt * dx / L);
        ay += w * (yj + tgt * dy / L);
        aw += w;
      }

      nx[i] = ax / aw;
      ny[i] = ay / aw;
    }

    var mx = 0, my = 0;
    for (i = 0; i < n; i++) {
      var p = nodes[i];
      p.x += (nx[i] - p.x) * rate;
      p.y += (ny[i] - p.y) * rate;
      mx += p.x; my += p.y;
    }

    // The stress solution is translation-invariant, so re-centre every frame.
    mx /= n; my /= n;
    for (i = 0; i < n; i++) { nodes[i].x -= mx; nodes[i].y -= my; }
  }

  /* ---------- Draw -------------------------------------------------------- */

  /* The hero scrim darkens the left third behind the text, so on wide screens
     the network sits right of centre where it can actually be seen. */
  function px(p) { return W * (W >= 1000 ? 0.6 : 0.5) + p.x * sx; }
  function py(p) { return H / 2 + p.y; }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (n < 2) return;

    var boost = 1 + pulse * 0.8;
    var i, j, k;

    /* Faint correlation web, collected once and stroked in three alpha
       buckets so the whole layer costs three paths rather than 300. */
    var thr = webThreshold();
    var span = Math.max(1e-3, 0.985 - thr);
    webN = 0;
    for (i = 0; i < n && webN < MAXWEB; i++) {
      var a = nodes[i];
      for (j = i + 1; j < n && webN < MAXWEB; j++) {
        var r = rho[i * n + j];
        if (r < thr || mstPrev[i * n + j]) continue;
        var b = nodes[j];
        var s = (r - thr) / span;
        var o = webN * 4;
        webX[o] = px(a); webX[o + 1] = py(a);
        webX[o + 2] = px(b); webX[o + 3] = py(b);
        webB[webN] = s > 0.66 ? 2 : (s > 0.33 ? 1 : 0);
        webN++;
      }
    }

    var webAlpha = [0.07, 0.115, 0.175];
    for (k = 0; k < 3; k++) {
      ctx.beginPath();
      for (i = 0; i < webN; i++) {
        if (webB[i] !== k) continue;
        var q = i * 4;
        ctx.moveTo(webX[q], webX[q + 1]);
        ctx.lineTo(webX[q + 2], webX[q + 3]);
      }
      ctx.strokeStyle = "rgba(" + palette.edge + "," + (webAlpha[k] * boost).toFixed(3) + ")";
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    /* The spanning tree: the backbone, brighter where the correlation is
       stronger, and flaring wherever the tree has just rewired. */
    for (k = 0; k < edges.length; k += 2) {
      var ia = edges[k], ib = edges[k + 1];
      var na = nodes[ia], nb = nodes[ib];
      var cr = rho[ia * n + ib];
      var t = Math.max(0, Math.min(1, (cr - 0.25) / 0.7));
      var fl = flash[ia * n + ib];
      var alpha = Math.min(0.85, (0.10 + t * 0.30 + fl * 0.42) * boost);

      ctx.strokeStyle = "rgba(" + palette.edge + "," + alpha.toFixed(3) + ")";
      ctx.lineWidth = 0.55 + t * 0.95 + fl * 1.15;
      ctx.beginPath();
      ctx.moveTo(px(na), py(na));
      ctx.lineTo(px(nb), py(nb));
      ctx.stroke();
    }

    /* Nodes, sized by MST degree — the centrality measure the thesis uses. */
    var hub = 0;
    for (i = 0; i < n; i++) {
      var p = nodes[i];
      if (p.deg > nodes[hub].deg) hub = i;
      var d = Math.min(p.deg, 7);
      var rad = 1.1 + d * 0.42;
      ctx.fillStyle = "rgba(" + palette.node + "," +
        Math.min(0.95, (0.34 + d * 0.075) * boost).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(px(p), py(p), rad, 0, Math.PI * 2);
      ctx.fill();
    }

    /* The dominant hub gets a halo that swells with lambda — in a stressed
       market one node ends up holding the tree together. */
    var hp = nodes[hub];
    var halo = 7 + lambda * 16 + Math.sin(clock * 1.6) * 1.6;
    ctx.strokeStyle = "rgba(" + palette.edge + "," + (0.05 + lambda * 0.11).toFixed(3) + ")";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(px(hp), py(hp), halo, 0, Math.PI * 2);
    ctx.stroke();

    /* Regime shift: a shockwave out of the middle of the network. */
    if (ring < 1) {
      var maxR = Math.hypot(W, H) * 0.55;
      ctx.strokeStyle = "rgba(" + palette.edge + "," + ((1 - ring) * 0.13).toFixed(3) + ")";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, ring * maxR, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* Label the hubs only. */
    if (W >= 860) {
      ctx.font = '500 9px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
      ctx.fillStyle = "rgba(" + palette.ink + ",0.42)";
      for (i = 0; i < n; i++) {
        var q2 = nodes[i];
        if (q2.deg < 5) continue;
        ctx.fillText(q2.name, px(q2) + 1.1 + Math.min(q2.deg, 7) * 0.42 + 4, py(q2) + 3);
      }
    }
  }

  /* ---------- Loop -------------------------------------------------------- */

  function loop() {
    if (!running) return;
    clock += 1 / 60;
    regime();
    correlate();
    layout(RATE);
    for (var i = 0; i < flash.length; i++) flash[i] *= 0.94;
    mst();
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // Only animate while the hero is actually on screen.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      entries[0].isIntersecting ? start() : stop();
    }, { threshold: 0 }).observe(canvas);
  } else {
    start();
  }

  document.addEventListener("visibilitychange", function () {
    document.hidden ? stop() : start();
  });

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(resize, 150);
  });

  document.addEventListener("themechange", function () {
    readPalette();
    if (reduced) draw();
  });

  readPalette();
  resize();
  if (!reduced) start();
})();
