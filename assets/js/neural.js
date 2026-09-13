/* =============================================================================
   Toolkit background, second head: a neural network, training.

   A small multilayer perceptron — seven features in, three hidden layers, two
   regimes out — and it is genuinely trained, on fake data shaped like the
   regime problem: online gradient descent, one sample at a time, cross-entropy
   on a softmax. What is drawn is the two passes that make up one step.
   Forward, a sample's activations travel left to right along the weights,
   every connection carrying a pulse as bright as the signal on it, until the
   output layer calls the regime. Backward, the error travels right to left the
   same way, and then the weights move — so the web of connections visibly
   redraws as the network learns. Every so often the data-generating regime
   changes, the loss jumps, and it has to learn again; it never settles.

   The toolkit section's chart, beside "What I reach for." — the place the
   volatility surface held while it was on the page. It began life as an inner
   chart beside the education head; if the surface ever comes back, that form
   still works: put the canvas right before its head with .section__viz--inner
   and name the head through spec.keepOut ("#neural + .section__head").
   ========================================================================== */

(function () {
  "use strict";
  if (!window.FZViz) return;

  /* ---------- Tunables ---------------------------------------------------- */

  var SIZES = [7, 10, 8, 5, 2];   // features in, three hidden layers, two regimes out
  var LR = 0.09;                  // learning rate, online
  var SILENT = 4;                 // steps taken quietly per animated one, so the loss moves at watchable speed
  var NOISE = 0.75;               // feature noise around the class means
  var SHIFT_LO = 40, SHIFT_HI = 70;   // samples between regime changes
  var WSCALE = 1.1;               // |weight| that reads as a full-strength connection
  var FWD_T = 0.30;               // seconds for a signal to cross one layer, forward
  var HOLD_T = 0.35;              // seconds the call is held at the output
  var BWD_T = 0.30;               // seconds for the error to cross one layer, back
  var REST_T = 0.45;              // seconds between steps
  var TAIL = 0.08;                // length of a pulse's tail, as a share of its connection

  // Alpha and width of a resting connection, by strength bucket.
  var EA = [0.06, 0.12, 0.20, 0.30];
  var EW = [0.45, 0.60, 0.80, 1.05];
  // Alpha of a travelling pulse, by strength bucket.
  var PA = [0.30, 0.58, 0.92];

  /* ---------- State ------------------------------------------------------- */

  var L = SIZES.length;
  var Wt = [], Bs = [];           // Wt[l]: SIZES[l+1] x SIZES[l], row-major; Bs[l]: SIZES[l+1]
  var act = [], delta = [];       // the pass in progress
  var shown = [], target = [], flash = [];   // what the nodes display
  var fact = [], bact = [];       // the connections carrying a visible pulse this pass, per transition
  var px = [], py = [];           // node positions
  var rad = 3;
  var lay = { x: -1, y: -1, w: -1, h: -1 };
  var buckets = [];               // edge lists by tone and strength, rebuilt after every update

  var x = new Float64Array(SIZES[0]);
  var mu = new Float64Array(SIZES[0]);
  var y = 0, prob = [0.5, 0.5];
  var untilShift = 0, lossEma = 0.69, passLoss = 0;
  var phase = "rest", pt = 0, li = 0, lastT = 0;

  var l, k;
  for (l = 0; l < L; l++) {
    act.push(new Float64Array(SIZES[l]));
    delta.push(new Float64Array(SIZES[l]));
    shown.push(new Float64Array(SIZES[l]));
    target.push(new Float64Array(SIZES[l]));
    flash.push(new Float64Array(SIZES[l]));
    px.push(new Float64Array(SIZES[l]));
    py.push(new Float64Array(SIZES[l]));
  }
  for (l = 0; l < L - 1; l++) {
    Wt.push(new Float64Array(SIZES[l + 1] * SIZES[l]));
    Bs.push(new Float64Array(SIZES[l + 1]));
    fact.push([]);
    bact.push([]);
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function gauss() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
  }

  /* ---------- Geometry ---------------------------------------------------- */

  /* Beside its head, the way the other charts sit beside theirs, and bounded
     like the tree: the layers are the edge of the thing. The box runs from the
     top of the canvas down to just past the head, which is where the toolkit
     grid starts — and, since it is placed against the head rather than the
     section, the same rule holds wherever the canvas is mounted. */
  function plotRect(env) {
    // On a narrow screen the network is a figure between the grid and the
    // head, not a backdrop beside it. The harness says which.
    if (env.mode === "band") return window.FZViz.bandRect(env, 1.6);
    var W = env.W, H = env.H;
    var kk = env.keepOut;
    if (!kk || W < 760 || H < 200) return null;
    var xx = kk.x + kk.w + 56;
    var w = Math.min(W - 40 - xx, 520);
    if (w < 240) return null;
    var yy = 12;
    var h = Math.min(kk.y + kk.h + 36 - yy, H - yy - 8);
    if (h < 150) return null;
    return { x: xx, y: yy, w: w, h: h };
  }

  /* Layers evenly across the box, nodes centred in each. */
  function layout(R) {
    if (R.x === lay.x && R.y === lay.y && R.w === lay.w && R.h === lay.h) return;
    lay.x = R.x; lay.y = R.y; lay.w = R.w; lay.h = R.h;

    var padL = 10, padR = 10, padY = 10;
    var maxN = 0;
    for (var q = 0; q < L; q++) if (SIZES[q] > maxN) maxN = SIZES[q];
    var sp = Math.min((R.h - 2 * padY) / (maxN - 1), 30);
    rad = clamp(sp * 0.17, 1.8, 3.4);

    for (q = 0; q < L; q++) {
      var xl = R.x + padL + (R.w - padL - padR) * q / (L - 1);
      var n = SIZES[q];
      for (var i = 0; i < n; i++) {
        px[q][i] = xl;
        py[q][i] = R.y + R.h / 2 + (i - (n - 1) / 2) * sp;
      }
    }
  }

  /* ---------- The network ------------------------------------------------- */

  function initWeights() {
    for (var q = 0; q < L - 1; q++) {
      var sd = 0.9 / Math.sqrt(SIZES[q]);
      for (var i = 0; i < Wt[q].length; i++) Wt[q][i] = gauss() * sd;
      for (i = 0; i < Bs[q].length; i++) Bs[q][i] = 0;
    }
  }

  /* The data: two regimes, each a direction in feature space, plus noise. A
     new regime is a new direction — what the network knew stops being true. */
  function newRegime() {
    for (var i = 0; i < SIZES[0]; i++) mu[i] = rnd(-1, 1);
    untilShift = Math.round(rnd(SHIFT_LO, SHIFT_HI));
  }

  function sampleX() {
    y = Math.random() < 0.5 ? 1 : 0;
    var s = y ? 1 : -1;
    for (var i = 0; i < SIZES[0]; i++) x[i] = s * mu[i] + gauss() * NOISE;
  }

  function forward() {
    act[0].set(x);
    for (var q = 0; q < L - 1; q++) {
      var nin = SIZES[q], nout = SIZES[q + 1], Wl = Wt[q], ain = act[q], aout = act[q + 1];
      for (var j = 0; j < nout; j++) {
        var z = Bs[q][j], row = j * nin;
        for (var i = 0; i < nin; i++) z += Wl[row + i] * ain[i];
        aout[j] = q === L - 2 ? z : Math.tanh(z);
      }
    }
    var o = act[L - 1], m = o[0] > o[1] ? o[0] : o[1];
    var e0 = Math.exp(o[0] - m), e1 = Math.exp(o[1] - m);
    prob[0] = e0 / (e0 + e1);
    prob[1] = e1 / (e0 + e1);
    return -Math.log(prob[y] > 1e-9 ? prob[y] : 1e-9);
  }

  /* The error at every layer, from the weights as they are. The update itself
     is a separate step, because on screen it has to wait for the pass. */
  function backward() {
    delta[L - 1][0] = prob[0] - (y === 0 ? 1 : 0);
    delta[L - 1][1] = prob[1] - (y === 1 ? 1 : 0);
    for (var q = L - 2; q >= 1; q--) {
      var nin = SIZES[q], nout = SIZES[q + 1], Wl = Wt[q];
      for (var i = 0; i < nin; i++) {
        var d = 0;
        for (var j = 0; j < nout; j++) d += Wl[j * nin + i] * delta[q + 1][j];
        var a = act[q][i];
        delta[q][i] = d * (1 - a * a);
      }
    }
  }

  function applyGrads() {
    for (var q = 0; q < L - 1; q++) {
      var nin = SIZES[q], nout = SIZES[q + 1], Wl = Wt[q];
      for (var j = 0; j < nout; j++) {
        var dj = LR * delta[q + 1][j], row = j * nin;
        for (var i = 0; i < nin; i++) Wl[row + i] -= dj * act[q][i];
        Bs[q][j] -= dj;
      }
    }
  }

  function learn(loss) {
    lossEma += (loss - lossEma) * 0.12;
    if (--untilShift <= 0) newRegime();
  }

  // One whole step, unseen.
  function quietStep() {
    sampleX();
    var loss = forward();
    backward();
    applyGrads();
    learn(loss);
  }

  /* Connections sorted into eight paths — two tones by sign, four weights by
     strength — so the resting web costs eight strokes a frame, not two
     hundred. Rebuilt whenever the weights change. */
  function rebucket() {
    buckets.length = 0;
    for (var b = 0; b < 8; b++) buckets.push([]);
    for (var q = 0; q < L - 1; q++) {
      var nin = SIZES[q], nout = SIZES[q + 1], Wl = Wt[q];
      for (var j = 0; j < nout; j++) {
        for (var i = 0; i < nin; i++) {
          var w = Wl[j * nin + i];
          var s = Math.abs(w) / WSCALE;
          if (s > 0.999) s = 0.999;
          buckets[(w < 0 ? 4 : 0) + ((s * 4) | 0)].push(q, i, j);
        }
      }
    }
  }

  /* ---------- The pass on show -------------------------------------------- */

  function norm(q, v) {
    if (q === 0) return clamp((v / 2 + 1) / 2, 0, 1);      // a feature
    if (q === L - 1) return v;                             // a probability
    return (v + 1) / 2;                                    // a tanh unit
  }

  // The signal on one connection: activation times weight going forward,
  // error times weight coming back.
  function sig(q, i, j, back) {
    var w = Wt[q][j * SIZES[q] + i];
    return back ? Math.abs(delta[q + 1][j] * w) : Math.abs(act[q][i] * w);
  }

  /* Which connections carry a visible pulse across one transition: for every
     unit of the far layer, those carrying at least half of the strongest
     signal into it (forward) or out of it (back) — two or three each, as a
     rule. A wave over the paths that matter, not a flash of everything; each
     pulse graded against the strongest signal of the whole layer. */
  function select(q, back) {
    var nin = SIZES[q], nout = SIZES[q + 1];
    var out = [], mx = 1e-9, i, j, s;
    for (j = 0; j < nout; j++) {
      for (i = 0; i < nin; i++) { s = sig(q, i, j, back); if (s > mx) mx = s; }
    }
    for (j = 0; j < nout; j++) {
      var m = 1e-9;
      for (i = 0; i < nin; i++) { s = sig(q, i, j, back); if (s > m) m = s; }
      for (i = 0; i < nin; i++) {
        s = sig(q, i, j, back);
        if (s < 0.55 * m) continue;
        var a = s / mx;
        out.push(i, j, a < 0.4 ? 0 : a < 0.7 ? 1 : 2);
      }
    }
    return out;
  }

  function beginPass() {
    sampleX();
    passLoss = forward();
    backward();
    for (var q = 0; q < L - 1; q++) {
      fact[q] = select(q, false);
      bact[q] = select(q, true);
    }
    arrive(0);
  }

  // The signal reaches layer q: its units take the sample's activations.
  function arrive(q) {
    var src = q === L - 1 ? prob : act[q];
    for (var i = 0; i < SIZES[q]; i++) target[q][i] = norm(q, src[i]);
  }

  // The error reaches layer q.
  function flashLayer(q) {
    for (var i = 0; i < SIZES[q]; i++) flash[q][i] = 1;
  }

  function endPass() {
    applyGrads();
    learn(passLoss);
    for (var s = 0; s < SILENT; s++) quietStep();
    rebucket();
  }

  function settle(dt, reduced) {
    var ke = reduced ? 1 : 1 - Math.exp(-dt * 9);
    var kf = reduced ? 0 : Math.exp(-dt * 3.2);
    for (var q = 0; q < L; q++) {
      for (var i = 0; i < SIZES[q]; i++) {
        shown[q][i] += (target[q][i] - shown[q][i]) * ke;
        flash[q][i] *= kf;
      }
    }
  }

  /* ---------- Draw -------------------------------------------------------- */

  /* The pulses crossing one transition: a bead with a short tail on each of
     the selected connections, as bright as the signal it carries. Backward
     runs the other way. Three strength buckets, a stroke and a fill each. */
  function pulses(env, q, u, back, tone) {
    var ctx = env.ctx;
    var boost = env.light ? 1.4 : 1;
    var list = back ? bact[q] : fact[q];
    var u0 = u - TAIL;
    if (u0 < 0) u0 = 0;

    ctx.lineWidth = 1;
    for (var b = 0; b < 3; b++) {
      var k, i, j, x0, y0, x1, y1, bx, by;
      ctx.strokeStyle = env.rgba(tone, PA[b] * 0.55 * boost);
      ctx.beginPath();
      for (k = 0; k < list.length; k += 3) {
        if (list[k + 2] !== b) continue;
        i = list[k]; j = list[k + 1];
        if (back) { x0 = px[q + 1][j]; y0 = py[q + 1][j]; x1 = px[q][i]; y1 = py[q][i]; }
        else      { x0 = px[q][i];     y0 = py[q][i];     x1 = px[q + 1][j]; y1 = py[q + 1][j]; }
        ctx.moveTo(x0 + (x1 - x0) * u0, y0 + (y1 - y0) * u0);
        ctx.lineTo(x0 + (x1 - x0) * u,  y0 + (y1 - y0) * u);
      }
      ctx.stroke();

      ctx.fillStyle = env.rgba(tone, PA[b] * boost);
      ctx.beginPath();
      for (k = 0; k < list.length; k += 3) {
        if (list[k + 2] !== b) continue;
        i = list[k]; j = list[k + 1];
        if (back) { x0 = px[q + 1][j]; y0 = py[q + 1][j]; x1 = px[q][i]; y1 = py[q][i]; }
        else      { x0 = px[q][i];     y0 = py[q][i];     x1 = px[q + 1][j]; y1 = py[q + 1][j]; }
        bx = x0 + (x1 - x0) * u; by = y0 + (y1 - y0) * u;
        ctx.moveTo(bx + 1.7, by);
        ctx.arc(bx, by, 1.7, 0, 6.2832);
      }
      ctx.fill();
    }
  }

  function draw(env, R) {
    var ctx = env.ctx;
    // Deep navy on white needs more alpha than pale blue on near-black.
    var boost = env.light ? 1.4 : 1;
    var q, i, b;

    /* --- the resting web: every connection, by sign and strength ----------- */
    for (b = 0; b < 8; b++) {
      var list = buckets[b];
      if (!list || !list.length) continue;
      ctx.strokeStyle = env.rgba(b < 4 ? "accent" : "accent-2", EA[b & 3] * boost);
      ctx.lineWidth = EW[b & 3];
      ctx.beginPath();
      for (i = 0; i < list.length; i += 3) {
        var ql = list[i], a = list[i + 1], c = list[i + 2];
        ctx.moveTo(px[ql][a], py[ql][a]);
        ctx.lineTo(px[ql + 1][c], py[ql + 1][c]);
      }
      ctx.stroke();
    }

    /* --- the pass in flight --------------------------------------------- */
    if (phase === "fwd") pulses(env, li, pt / FWD_T, false, "accent-hi");
    if (phase === "bwd") pulses(env, li, pt / BWD_T, true, "accent-2");

    /* --- units: a ring, filled by activation, flaring when the error lands - */
    for (q = 0; q < L; q++) {
      var r = rad + (q === L - 1 ? 1 : 0);
      for (i = 0; i < SIZES[q]; i++) {
        var fl = flash[q][i];
        ctx.beginPath();
        ctx.arc(px[q][i], py[q][i], r + fl * 1.6, 0, 6.2832);
        ctx.fillStyle = env.rgba("accent-hi", (0.10 + 0.75 * shown[q][i]) * boost);
        ctx.fill();
        ctx.strokeStyle = env.rgba("accent", (0.42 + fl * 0.5) * boost);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    /* Keep the network off the copy. Measured against the real text box, so it
       genuinely is not there rather than being washed out behind it. No labels:
       the passes are the point, and the output unit that fills is the call. */
    window.FZViz.softErase(ctx, env.keepOut, 12, 54);
  }

  /* ---------- Spec -------------------------------------------------------- */

  window.FZViz.mount("neural", {
    seed: function (env) {
      initWeights();
      newRegime();
      lossEma = 0.69;
      lay.x = -1;
      phase = "rest";
      pt = 0;
      lastT = env.t;
      for (var q = 0; q < L; q++) {
        shown[q].fill(0);
        target[q].fill(0);
        flash[q].fill(0);
      }
      // One settled frame under reduced motion: a network that has learned,
      // showing one sample. Otherwise the untrained network showing one, so
      // the units are not empty until the first pass.
      if (env.reduced) for (var s = 0; s < 60; s++) quietStep();
      sampleX();
      forward();
      for (q = 0; q < L; q++) {
        arrive(q);
        shown[q].set(target[q]);
      }
      rebucket();
    },

    frame: function (env) {
      var R = plotRect(env);
      if (!R) return;            // no room to draw is no reason to train
      layout(R);

      var t = env.t;
      var dt = t - lastT;
      if (!(dt > 0) || dt > 0.1) dt = 1 / 60;
      lastT = t;

      if (!env.reduced) {
        pt += dt;
        if (phase === "rest" && pt >= REST_T) {
          beginPass();
          phase = "fwd"; li = 0; pt = 0;
        } else if (phase === "fwd" && pt >= FWD_T) {
          arrive(++li);
          pt = 0;
          if (li >= L - 1) phase = "hold";
        } else if (phase === "hold" && pt >= HOLD_T) {
          phase = "bwd"; li = L - 2; pt = 0;
        } else if (phase === "bwd" && pt >= BWD_T) {
          flashLayer(li--);
          pt = 0;
          if (li < 0) { endPass(); phase = "rest"; }
        }
      }

      settle(dt, env.reduced);
      draw(env, R);
    }
  });
})();
