/* =============================================================================
   Research background: a live fine tree — the classifier that won the thesis.

   Of the bank of classifiers run over the correlation-network features, the
   one that reached 91.7% was a fine tree: a CART decision tree allowed up to a
   hundred splits, so it grows deep and lopsided, pure branches stopping early
   and mixed ones splitting on until they run out of samples. That is what is
   drawn — not a diagram of a tree but a tree grown the way CART grows one, on
   fake data shaped like the real features.

   Three things move. The tree grows, root first, each split branching out of
   its parent a beat after the level above. Observations arrive at the root and
   are routed down — left or right at every split — to a leaf, which flashes
   the regime it predicts. And every so often the estimation window rolls: a
   subtree is pruned back to its parent and regrown as a different fit.
   ========================================================================== */

(function () {
  "use strict";
  if (!window.FZViz) return;

  /* ---------- Tunables ---------------------------------------------------- */

  var D = 7;             // maximum depth — the "certain degree" a fine tree is held to
  var N = 480;           // observations at the root
  var MINLEAF = 4;       // CART minimum leaf size; what actually stops most branches
  var LEAF_PX = 9;       // canvas pixels per leaf, which sets the leaf budget
  var STAGGER = 0.42;    // seconds between one level branching and the next
  var GROW = 0.55;       // seconds for one edge to extend
  var RETRACT = 0.5;     // seconds for a pruned edge to withdraw
  var REFIT_LO = 9, REFIT_HI = 14;   // seconds between window rolls
  var ARRIVE = 1.7;      // seconds between observations reaching the root
  var EDGE_T = 0.24;     // seconds for an observation to travel one edge

  /* The thesis's own feature set: the topology of the minimum spanning tree
     and the moments of index returns. Ranges are only there to put plausible
     numbers on the split rule. */
  var FEATURES = [
    { name: "kruskal stress",  lo: 0.08, hi: 0.60 },
    { name: "density",         lo: 0.04, hi: 0.40 },
    { name: "max degree",      lo: 3,    hi: 12,  int: true },
    { name: "mean degree",     lo: 1.7,  hi: 2.6 },
    { name: "in-component",    lo: 2,    hi: 9,   int: true },
    { name: "return skew",     lo: -1.4, hi: 0.9 },
    { name: "return kurtosis", lo: 2.5,  hi: 8.5 },
    { name: "return variance", lo: 0.2,  hi: 3.1 }
  ];

  /* ---------- State ------------------------------------------------------- */

  var root = null;
  var nodes = [];        // pre-order, so a parent always precedes its children
  var walkers = [];      // observations in flight
  var prune = null;      // the subtree currently being regrown, if any
  var lastT = 0, nextRefit = 0, nextArrive = 0;
  var pt = [0, 0];       // scratch for bezier points

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function gini(p) { return 2 * p * (1 - p); }

  /* ---------- Geometry ---------------------------------------------------- */

  /* Same rule as the other backgrounds: placed against the harness's
     measurement of the real text box, so it holds wherever the copy reflows.
     Unlike the cloud and the sheet, though, a tree is a bounded object — its
     leaves are its edge — so the box stays inside the canvas rather than
     bleeding off it. */
  function plotRect(env) {
    // On a narrow screen the tree is a figure above the copy, not a backdrop
    // beside it. The harness says which and hands over the box.
    if (env.mode === "band") return window.FZViz.bandRect(env, 1.45);
    var W = env.W, H = env.H;
    if (W < 760 || H < 260) return null;
    var k = env.keepOut;
    var edge = k ? k.x + k.w : W * 0.62;
    var x = Math.max(W * 0.54, edge + 56);
    var w = W - 40 - x;
    if (w < 240) return null;
    // Height from the shallow band above the paper card, which is opaque and
    // starts about a sixth of the way down a section that runs long past it.
    return { x: x, y: 40, w: w, h: Math.min(H * 0.095, w / 1.15, 380) };
  }

  /* ---------- The tree ---------------------------------------------------- */

  function node(parent, n, p) {
    return {
      parent: parent,
      depth: parent ? parent.depth + 1 : 0,
      n: n,                    // observations reaching this node
      p: p,                    // share of them that are bull regimes
      left: null, right: null,
      feat: -1, thr: 0,
      f: 0.5,                  // share sent left
      x: 0, y: 0, tx: 0, ty: 0,
      born: 0, cutAt: 0,       // when its edge starts growing / withdrawing
      lit: 0, flash: 0
    };
  }

  function canSplit(v) {
    return v.depth < D && v.n >= 2 * MINLEAF && gini(v.p) > 0.06;
  }

  /* One CART split. A feature and a threshold in its range, a share of the
     observations sent left, and the two children's bull fractions pushed apart
     while their weighted mean is preserved — which is what a real split does
     to class purity, and why a tree gets purer as it gets deeper. */
  function split(v, tBase, baseDepth) {
    var fi = (v.parent && v.parent.feat >= 0 && Math.random() < 0.3)
      ? v.parent.feat                                  // trees reuse features
      : (Math.random() * FEATURES.length) | 0;
    var F = FEATURES[fi];
    var f = rnd(0.28, 0.72);
    var g = rnd(0.14, 0.42) * (Math.random() < 0.5 ? 1 : -1);
    var nL = Math.max(MINLEAF, Math.round(v.n * f));
    var nR = Math.max(MINLEAF, v.n - nL);

    v.feat = fi;
    v.thr = F.lo + (F.hi - F.lo) * rnd(0.2, 0.8);
    v.f = nL / (nL + nR);
    v.left = node(v, nL, clamp(v.p - g * (1 - f), 0.02, 0.98));
    v.right = node(v, nR, clamp(v.p + g * f, 0.02, 0.98));

    var lvl = v.depth + 1 - baseDepth;
    v.left.born = tBase + lvl * STAGGER + rnd(0, STAGGER * 0.6);
    v.right.born = tBase + lvl * STAGGER + rnd(0, STAGGER * 0.6);
    // Branches spread out of the parent rather than dropping in from wherever
    // the layout will put them.
    v.left.x = v.right.x = v.x;
    v.left.y = v.right.y = v.y;
  }

  /* Grow a subtree under `sub` to a leaf budget. Best-first — the largest,
     most mixed node splits next — which is what makes a fitted tree lopsided:
     a pure branch stops at depth two while a mixed one runs to the limit. */
  function grow(sub, budget, tBase) {
    var open = canSplit(sub) ? [sub] : [];
    var count = 1;
    while (open.length && count < budget) {
      var bi = 0, bs = -1;
      for (var i = 0; i < open.length; i++) {
        var s = open[i].n * gini(open[i].p);
        if (s > bs) { bs = s; bi = i; }
      }
      var v = open.splice(bi, 1)[0];
      split(v, tBase, sub.depth);
      count++;
      if (canSplit(v.left)) open.push(v.left);
      if (canSplit(v.right)) open.push(v.right);
    }
  }

  function collect() {
    nodes.length = 0;
    (function walk(v) {
      nodes.push(v);
      if (v.left) { walk(v.left); walk(v.right); }
    })(root);
  }

  function leavesUnder(v) {
    return v.left ? leavesUnder(v.left) + leavesUnder(v.right) : 1;
  }

  function deepestUnder(v) {
    return v.left ? Math.max(deepestUnder(v.left), deepestUnder(v.right)) : v.depth;
  }

  /* ---------- Layout ------------------------------------------------------ */

  /* Leaves evenly across the box in tree order, every split centred over its
     children, depth down the box. Targets only: positions ease toward them, so
     a regrown subtree with a different leaf count makes the rest of the tree
     move over rather than jump. */
  function layout(R) {
    var i, L = 0, deepest = 0;
    for (i = 0; i < nodes.length; i++) {
      if (!nodes[i].left) L++;
      if (nodes[i].depth > deepest) deepest = nodes[i].depth;
    }
    var x0 = R.x + 8, x1 = R.x + R.w - 8;
    var yTop = R.y + 20, yBot = R.y + R.h - 12;
    var dy = (yBot - yTop) / Math.max(deepest, 3);

    // Reversed pre-order puts every child before its parent.
    var slot = L - 1;
    for (i = nodes.length - 1; i >= 0; i--) {
      var v = nodes[i];
      v.ty = yTop + v.depth * dy;
      if (!v.left) {
        v.tx = L > 1 ? x0 + (x1 - x0) * (slot / (L - 1)) : (x0 + x1) / 2;
        slot--;
      } else {
        v.tx = (v.left.tx + v.right.tx) / 2;
      }
    }
  }

  function ease(k) {
    for (var i = 0; i < nodes.length; i++) {
      var v = nodes[i];
      v.x += (v.tx - v.x) * k;
      v.y += (v.ty - v.y) * k;
    }
  }

  /* ---------- Life -------------------------------------------------------- */

  /* How much of the edge into `v` is there: growing out of its parent, or
     withdrawing back into it. */
  function grown(v, t, reduced) {
    if (reduced) return 1;
    if (v.cutAt) return clamp(1 - (t - v.cutAt) / RETRACT, 0, 1);
    return clamp((t - v.born) / GROW, 0, 1);
  }

  /* The window rolls: a subtree a level or three down is cut back to its
     parent, deepest branches first, and regrown from that node. */
  function startPrune(t) {
    var pick = [];
    for (var i = 0; i < nodes.length; i++) {
      var v = nodes[i];
      if (v.left && v.depth >= 1 && v.depth <= 3 && leavesUnder(v) >= 3) pick.push(v);
    }
    if (!pick.length) return;
    var sub = pick[(Math.random() * pick.length) | 0];
    var deep = deepestUnder(sub);

    (function cut(v) {
      if (!v.left) return;
      v.left.cutAt = v.right.cutAt = t + (deep - v.depth - 1) * 0.09;
      cut(v.left); cut(v.right);
    })(sub);

    // Anything routed into the subtree has nowhere to go.
    for (i = walkers.length - 1; i >= 0; i--) {
      if (walkers[i].path.indexOf(sub) >= 0) walkers.splice(i, 1);
    }

    prune = {
      node: sub,
      swapAt: t + (deep - sub.depth - 1) * 0.09 + RETRACT + 0.05,
      budget: Math.max(2, leavesUnder(sub) + Math.round(rnd(-3, 4)))
    };
  }

  function finishPrune(t) {
    var sub = prune.node;
    sub.left = sub.right = null;
    sub.feat = -1;
    grow(sub, prune.budget, t);
    collect();
    prune = null;
    nextRefit = t + rnd(REFIT_LO, REFIT_HI);
  }

  /* One observation: routed from the root, left or right at each split in
     proportion to the split, as far as the grown tree goes. */
  function spawn(t) {
    var path = [root], v = root;
    while (v.left) {
      var c = Math.random() < v.f ? v.left : v.right;
      if (grown(c, t, false) < 1) break;
      path.push(c);
      v = c;
    }
    if (path.length < 2) return;
    path[1].lit = 1;
    walkers.push({ path: path, i: 0, u: 0 });
  }

  function advance(dt) {
    for (var k = walkers.length - 1; k >= 0; k--) {
      var w = walkers[k];
      w.u += dt / EDGE_T;
      while (w.u >= 1) {
        w.u -= 1;
        w.i++;
        if (w.i >= w.path.length - 1) {
          var leaf = w.path[w.path.length - 1];
          leaf.flash = 1;
          leaf.lit = 1;
          walkers.splice(k, 1);
          break;
        }
        w.path[w.i + 1].lit = 1;
      }
    }
  }

  function decay(dt) {
    var kl = Math.exp(-dt * 2.4), kf = Math.exp(-dt * 2.2);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].lit *= kl;
      nodes[i].flash *= kf;
    }
  }

  /* ---------- Draw -------------------------------------------------------- */

  /* A point on the link from P to C: a cubic with vertical tangents, so every
     branch leaves its parent straight down and arrives at its child the same
     way — the way a drawn tree does. */
  function bez(P, C, u, out) {
    var ym = (P.y + C.y) / 2, v = 1 - u;
    var a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    out[0] = (a + b) * P.x + (c + d) * C.x;
    out[1] = a * P.y + (b + c) * ym + d * C.y;
    return out;
  }

  function draw(env, R, t) {
    var ctx = env.ctx;
    // Deep navy on white needs more alpha than pale blue on near-black.
    var boost = env.light ? 1.4 : 1;
    var i, v, g, P;

    /* --- edges, graded by depth and weighted by sample count -------------- */
    /* The trunk carries the tree and the fine structure fades toward the
       leaves; a routed observation lights the edges it takes. */
    for (i = 1; i < nodes.length; i++) {
      v = nodes[i];
      g = grown(v, t, env.reduced);
      if (g <= 0) continue;
      P = v.parent;

      ctx.strokeStyle = env.rgba("accent",
        (0.16 + 0.30 * (1 - v.depth / D)) * boost + v.lit * 0.45);
      ctx.lineWidth = 0.5 + 1.8 * Math.sqrt(v.n / N);
      ctx.beginPath();
      ctx.moveTo(P.x, P.y);
      if (g >= 1) {
        var ym = (P.y + v.y) / 2;
        ctx.bezierCurveTo(P.x, ym, v.x, ym, v.x, v.y);
      } else {
        for (var s = 1; s <= 8; s++) {
          bez(P, v, g * s / 8, pt);
          ctx.lineTo(pt[0], pt[1]);
        }
      }
      ctx.stroke();
    }

    /* --- nodes ------------------------------------------------------------ */
    ctx.fillStyle = env.rgba("accent-hi", 0.6 * boost);
    ctx.beginPath();
    ctx.arc(root.x, root.y, 2.2, 0, 6.2832);
    ctx.fill();

    for (i = 1; i < nodes.length; i++) {
      v = nodes[i];
      g = grown(v, t, env.reduced);
      if (g <= 0) continue;

      if (g < 1) {
        // The growing tip.
        bez(v.parent, v, g, pt);
        ctx.fillStyle = env.rgba("accent-hi", 0.5 * boost);
        ctx.beginPath();
        ctx.arc(pt[0], pt[1], 1.4, 0, 6.2832);
        ctx.fill();
        continue;
      }

      if (v.left) {
        // A split.
        ctx.fillStyle = env.rgba("accent-hi", (0.32 + v.lit * 0.5) * boost);
        ctx.beginPath();
        ctx.arc(v.x, v.y, 1.4, 0, 6.2832);
        ctx.fill();
        continue;
      }

      // A leaf: bull filled, bear a ring — the two classes told apart by form,
      // since the palette is one hue. Purer leaves read stronger.
      var purity = v.p >= 0.5 ? v.p : 1 - v.p;
      var r = 2 + v.flash * 3;
      var a = (0.40 + 0.50 * purity) * boost + v.flash * 0.3;
      ctx.beginPath();
      ctx.arc(v.x, v.y, r, 0, 6.2832);
      if (v.p >= 0.5) {
        ctx.fillStyle = env.rgba("accent-hi", a);
        ctx.fill();
      } else {
        ctx.strokeStyle = env.rgba("accent-2", a);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    /* --- observations in flight ------------------------------------------- */
    for (i = 0; i < walkers.length; i++) {
      var w = walkers[i];
      bez(w.path[w.i], w.path[w.i + 1], w.u, pt);
      ctx.fillStyle = env.rgba("accent-hi", 0.13 * boost);
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 8, 0, 6.2832);
      ctx.fill();
      ctx.fillStyle = env.rgba("accent-hi", 0.92 * boost);
      ctx.beginPath();
      ctx.arc(pt[0], pt[1], 2.4, 0, 6.2832);
      ctx.fill();
    }

    /* Keep the tree off the copy. Measured against the real text box, so it
       genuinely is not there rather than being washed out behind it. */
    window.FZViz.softErase(ctx, env.keepOut, 12, 54);

    /* --- the one label: the regime a leaf has just called ----------------- */
    if (R.w > 360) {
      ctx.font = '500 8px "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = "center";
      for (i = 1; i < nodes.length; i++) {
        v = nodes[i];
        if (v.left || v.flash < 0.05) continue;
        ctx.fillStyle = env.rgba("accent-hi", v.flash * 0.75 * boost);
        ctx.fillText(v.p >= 0.5 ? "BULL" : "BEAR", v.x, v.y + 13);
      }
      ctx.textAlign = "start";
    }
  }

  /* ---------- Spec -------------------------------------------------------- */

  window.FZViz.mount("finetree", {
    seed: function (env) {
      var R = plotRect(env);
      root = node(null, N, 0.56);
      root.born = env.t;
      // The leaf budget follows the width on show, so a wide screen gets a
      // full fine tree and a phone band gets one that still has room to read.
      grow(root, R ? clamp(Math.round(R.w / LEAF_PX), 18, 60) : 40, env.t);
      collect();
      if (R) { layout(R); ease(1); }

      walkers.length = 0;
      prune = null;
      lastT = env.t;
      nextArrive = env.t + 2.5;
      nextRefit = env.t + D * STAGGER + rnd(REFIT_LO, REFIT_HI);
    },

    frame: function (env) {
      var R = plotRect(env);
      if (!R) return;            // no room to draw is no reason to simulate
      var t = env.t;
      var dt = t - lastT;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      lastT = t;

      if (!env.reduced) {
        if (!prune && t >= nextRefit) startPrune(t);
        if (prune && t >= prune.swapAt) finishPrune(t);
        if (!prune && t >= nextArrive) {
          spawn(t);
          nextArrive = t + ARRIVE * rnd(0.8, 1.25);
        }
        advance(dt);
        decay(dt);
      }

      layout(R);
      ease(env.reduced ? 1 : 1 - Math.exp(-dt * 6));
      draw(env, R, t);
    }
  });
})();
