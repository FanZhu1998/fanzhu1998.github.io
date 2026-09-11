/* =============================================================================
   About-section background: a live mean-variance efficient frontier, drawn
   full bleed behind the copy the way the hero network is.

   Eight assets carry returns from a two-factor covariance model,
   Sigma = gamma * L L' + diag(delta^2), which is positive definite by
   construction, so nothing here can blow up numerically. The loadings, the
   idiosyncratic variances, the expected returns and the systemic weight gamma
   all drift on slow incommensurate sines, so the inputs are never quite the
   same twice — which is the honest part: a frontier is only ever as stable as
   the estimates under it.

   Each frame solves Sigma [a b] = [1 mu] by Gauss-Jordan and reads the closed
   form straight off the standard scalars

     A = 1'a,  B = 1'b,  C = mu'b,  D = AC - B^2
     sigma^2(m) = (A m^2 - 2B m + C) / D
     w(m)       = g + h m,   g = (C a - B b)/D,  h = (A b - B a)/D

   so the curve is the exact minimum-variance hyperbola rather than a fitted
   one, and w(m) gives the real weight vector behind any point on it — which is
   what the scatter is built from. The upper branch is drawn bright because it is the part
   that is actually efficient; the lower branch is drawn dim because it is not.
   A cloud of portfolios fills the interior, brighter the closer each one sits
   to the frontier. The tangency portfolio is solved for against a drifting
   risk-free rate and marked on the curve, but the capital market line through
   it is not drawn: a straight line across the picture fights the curve.

   Watch gamma: as systemic correlation rises the bullet narrows and the
   frontier flattens — diversification stops paying, the same way the hero
   network contracts toward one hub when correlations rise.

   Cost. The scatter is the only expensive part — a few hundred portfolios, each
   a K^2 quadratic form and a fill. It is therefore rendered into an offscreen
   layer a few times a second rather than every frame, and blitted with an
   affine correction that maps the window it was drawn in onto the window
   showing now, so the cloud stays registered to the curve however the view
   drifts. Everything that has to be smooth — the curve, the travelling dot and
   the comet — is a few dozen operations and runs every frame.
   ========================================================================== */

(function () {
  "use strict";

  if (!window.FZViz) return;

  /* ---------- Tunables ---------------------------------------------------- */

  var K = 8;             // assets
  var F = 2;             // factors
  var CLOUD_MAX = 1500;  // allocation ceiling for the scatter
  var CLOUD_AREA = 330;  // one portfolio per this many square px of plot
  var CURVE = 108;       // samples along the frontier
  var SWEEP = 0.075;     // cycles/sec of the dot's travel along the frontier
  var LAYER_EVERY = 7;   // frames between scatter re-renders

  /* ---------- Model state ------------------------------------------------- */

  var mu = new Float64Array(K);
  var sig = new Float64Array(K * K);
  var L = new Float64Array(K * F);
  var del = new Float64Array(K);

  var NC = K + 2;
  var aug = new Float64Array(K * NC);
  var av = new Float64Array(K);   // Sigma^-1 1
  var bv = new Float64Array(K);   // Sigma^-1 mu
  var gv = new Float64Array(K);   // weight intercept
  var hv = new Float64Array(K);   // weight slope


  var asset = [];
  var cn = 0;                                  // active scatter count
  var cfrac = new Float64Array(CLOUD_MAX);     // where along the return band
  var cspr = new Float64Array(CLOUD_MAX);      // how far off the frontier
  var cnz = new Float64Array(CLOUD_MAX * K);   // fixed de-meaned deviation
  var cs = new Float64Array(CLOUD_MAX);        // scatter sigma
  var cm = new Float64Array(CLOUD_MAX);        // scatter mu
  var ce = new Float64Array(CLOUD_MAX);        // scatter efficiency, 0..1
  var tw = new Float64Array(K);                // scratch weights

  // Frontier scalars for the current frame.
  var A = 1, B = 0, C = 0, D = 1, mMv = 0, sMv = 0;
  var rf = 0, mTan = 0, sTan = 0, ok = false;

  /* View window, and the target it eases toward. These are deliberately two
     objects: the target is only recomputed when the scatter is, a few times a
     second, but the easing has to run every single frame. Easing inside the
     scatter refresh instead makes the whole frame — and with it the nose of the
     curve, which is its sharpest feature — step about eight times a second
     rather than move, which reads as a wobble. */
  var view = { x0: 0, x1: 0.3, y0: 0, y1: 0.16, ready: false };
  var vt = { x0: 0, x1: 0.3, y0: 0, y1: 0.16 };
  var EASE = 0.025;

  // Offscreen scatter layer and the window it was drawn in.
  var layer = null, lctx = null;
  var lw = 0, lh = 0, ldpr = 0, lage = 1e9;
  var lview = { x0: 0, x1: 1, y0: 0, y1: 1 };

  function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }

  function gauss() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
  }

  /* ---------- Geometry ---------------------------------------------------- */

  /* The chart runs from behind the tail of the section head out to the right
     edge, the way the hero network runs out from behind the name, with the
     scrim in the stylesheet keeping the copy readable over it.

     The box is kept near 7:4 on purpose. A hyperbola stretched much wider than
     that stops reading as a bullet and turns into a diagonal streak, so the
     chart grows by taking height up to the cards — which are opaque and would
     cover anything drawn under them — rather than by running the full width. */
  function plotRect(env) {
    var W = env.W, H = env.H;
    if (W < 760 || H < 260) return null;
    /* The chart is erased where the copy sits, so the nose and the travelling
       dot — the parts worth seeing — have to start clear of it. That edge is
       taken from the harness's measurement of the real text box rather than a
       fraction eyeballed at one width, so it holds wherever the copy reflows.
       The box still runs past the right edge, so the high-risk tail of the
       cloud bleeds off the canvas instead of ending on a vertical cut. */
    var k = env.keepOut;
    var edge = k ? k.x + k.w : W * 0.64;
    var x = Math.max(W * 0.50, edge + 66);
    var w = W * 1.08 - x;
    if (w < 250) return null;
    // The box starts above the canvas so the top of the bullet bleeds off the
    // edge instead of ending on a hard horizontal cut, and stops just short of
    // the cards.
    var y = H * -0.05;
    return { x: x, y: y, w: w, h: Math.min(H * 0.53, w / 1.35) };
  }

  /* ---------- Seed -------------------------------------------------------- */

  function seedModel(env) {
    asset = [];
    for (var i = 0; i < K; i++) {
      var beta = 0.085 + 0.075 * (i / (K - 1));      // market exposure ladder
      asset.push({
        // Expected return rises with market exposure, plus a little dispersion.
        m0: 0.030 + 1.02 * (beta - 0.085) + rnd(-0.006, 0.010),
        mA: rnd(0.004, 0.011), mW: rnd(0.055, 0.115), mP: rnd(0, 6.283),
        l0: beta, l0A: rnd(0.006, 0.016), l0W: rnd(0.04, 0.09), l0P: rnd(0, 6.283),
        // Style factor, signed, so some pairs genuinely diversify each other.
        l1: 0.062 * Math.cos(6.283 * i / K + 0.7),
        l1A: rnd(0.010, 0.026), l1W: rnd(0.05, 0.10), l1P: rnd(0, 6.283),
        d0: rnd(0.052, 0.098), dA: rnd(0.10, 0.26), dW: rnd(0.06, 0.13), dP: rnd(0, 6.283)
      });
    }

    // Scatter density follows the area on show, so a wide screen does not get
    // a sparse dusting and a small one does not pay for points nobody sees.
    var R = plotRect(env);
    var want = R ? Math.round(R.w * R.h / CLOUD_AREA) : 420;
    cn = Math.max(280, Math.min(CLOUD_MAX, want));

    /* Each scatter point is a frontier portfolio at some target return, pushed
       off the curve by a fixed deviation. The deviation is de-meaned so the
       weights still sum to one exactly — no renormalisation that could blow up
       — and because a zero deviation lands exactly on the curve, the scatter
       has the frontier as its true left boundary. Sampling around equal weight
       instead would never reach the low-return end and the bullet would have
       no nose. */
    for (var p = 0; p < cn; p++) {
      var s = 0, j;
      for (j = 0; j < K; j++) { tw[j] = gauss(); s += tw[j]; }
      s /= K;
      for (j = 0; j < K; j++) cnz[p * K + j] = tw[j] - s;
      cfrac[p] = Math.random();
      cspr[p] = 0.31 * Math.pow(Math.random(), 0.80);
    }
  }

  /* ---------- Per-frame model --------------------------------------------- */

  function build(t) {
    var i, j;

    // Systemic weight on the factor block: the regime dial. Two incommensurate
    // sines so it never settles into an obvious loop.
    var gamma = 1.02 + 0.42 * Math.sin(t * 0.043) + 0.20 * Math.sin(t * 0.017 + 1.3);
    if (gamma < 0.35) gamma = 0.35;

    for (i = 0; i < K; i++) {
      var a = asset[i];
      mu[i] = a.m0 + a.mA * Math.sin(t * a.mW + a.mP);
      L[i * F] = a.l0 + a.l0A * Math.sin(t * a.l0W + a.l0P);
      L[i * F + 1] = a.l1 + a.l1A * Math.sin(t * a.l1W + a.l1P);
      del[i] = a.d0 * (1 + a.dA * Math.sin(t * a.dW + a.dP));
    }

    for (i = 0; i < K; i++) {
      for (j = i; j < K; j++) {
        var v = gamma * (L[i * F] * L[j * F] + L[i * F + 1] * L[j * F + 1]);
        if (i === j) v += del[i] * del[i];
        sig[i * K + j] = v;
        sig[j * K + i] = v;
      }
    }
  }

  /* Gauss-Jordan on [Sigma | 1 | mu] with partial pivoting. K = 8, so this is
     a few hundred flops — nothing next to the scatter it feeds. */
  function solve() {
    var i, j, r, c;

    for (i = 0; i < K; i++) {
      for (j = 0; j < K; j++) aug[i * NC + j] = sig[i * K + j];
      aug[i * NC + K] = 1;
      aug[i * NC + K + 1] = mu[i];
    }

    for (c = 0; c < K; c++) {
      var piv = c, big = Math.abs(aug[c * NC + c]);
      for (r = c + 1; r < K; r++) {
        var m = Math.abs(aug[r * NC + c]);
        if (m > big) { big = m; piv = r; }
      }
      if (big < 1e-13) return false;

      if (piv !== c) {
        for (j = c; j < NC; j++) {
          var tmp = aug[c * NC + j];
          aug[c * NC + j] = aug[piv * NC + j];
          aug[piv * NC + j] = tmp;
        }
      }

      var d = aug[c * NC + c];
      for (j = c; j < NC; j++) aug[c * NC + j] /= d;

      for (r = 0; r < K; r++) {
        if (r === c) continue;
        var f = aug[r * NC + c];
        if (f === 0) continue;
        for (j = c; j < NC; j++) aug[r * NC + j] -= f * aug[c * NC + j];
      }
    }

    for (i = 0; i < K; i++) {
      av[i] = aug[i * NC + K];
      bv[i] = aug[i * NC + K + 1];
    }
    return true;
  }

  function scalars() {
    var i;
    A = 0; B = 0; C = 0;
    for (i = 0; i < K; i++) { A += av[i]; B += bv[i]; C += mu[i] * bv[i]; }
    D = A * C - B * B;
    if (!(A > 1e-9) || !(D > 1e-12)) return false;

    mMv = B / A;
    sMv = Math.sqrt(1 / A);

    for (i = 0; i < K; i++) {
      gv[i] = (C * av[i] - B * bv[i]) / D;
      hv[i] = (A * bv[i] - B * av[i]) / D;
    }
    return true;
  }

  // sigma for a target return m, straight off the closed form.
  function sigmaAt(m) {
    var v = (A * m * m - 2 * B * m + C) / D;
    return v > 0 ? Math.sqrt(v) : 0;
  }

  /* Cheap, every frame: the curve, the markers and the dot all come from here. */
  function core(t) {
    build(t);
    ok = solve() && scalars();
    if (!ok) return;

    // Risk-free rate: drifts, but pinned below the minimum-variance return so
    // the tangency always lands on the efficient branch.
    var target = 0.019 + 0.006 * Math.sin(t * 0.031 + 0.4);
    var cap = mMv - 0.004;
    rf = target < cap ? target : cap;

    var den = B - rf * A;
    if (Math.abs(den) > 1e-10) {
      mTan = (C - rf * B) / den;
      sTan = sigmaAt(mTan);
    } else {
      mTan = mMv; sTan = sMv;
    }
  }

  /* Expensive, a few times a second: the scatter, and the window that frames
     it. */
  function scatter() {
    var i, j, p;
    var muMax = mu[0];
    for (i = 1; i < K; i++) if (mu[i] > muMax) muMax = mu[i];
    var rng = muMax - mMv;
    if (!(rng > 1e-5)) rng = 0.02;

    /* How much of each branch is on show, and so what the silhouette reads as.
       The minimum-variance point is a vertical tangent, so showing the lower
       branch symmetrically turns the nose into a rounded protrusion. Keeping
       the inefficient branch to a sliver leaves a frontier that rises out of
       the bottom left instead, which is both the more elegant shape and the
       one people actually draw. The upper bound is extended to compensate, so
       trimming the band does not stretch the curve vertically and steepen it. */
    var bLo = mMv - 0.06 * rng;
    var bHi = mMv + 1.36 * rng;
    var sMax = sMv;

    for (p = 0; p < cn; p++) {
      var base = p * K;
      var mt = bLo + cfrac[p] * (bHi - bLo);
      var sp = cspr[p];
      var m = 0, v = 0;

      for (i = 0; i < K; i++) tw[i] = gv[i] + hv[i] * mt + sp * cnz[base + i];
      for (i = 0; i < K; i++) {
        var wi = tw[i];
        m += wi * mu[i];
        var row = i * K;
        for (j = 0; j < K; j++) v += wi * tw[j] * sig[row + j];
      }

      var s = v > 0 ? Math.sqrt(v) : 0;
      cm[p] = m;
      cs[p] = s;
      var f = sigmaAt(m);
      ce[p] = s > 1e-9 ? f / s : 0;
      if (s > sMax) sMax = s;
    }

    /* Frame the bullet. The capital market line still starts at the risk-free
       rate; it just enters from off-plot and gets clipped, which is the right
       trade — the interesting geometry is the cloud, not the empty quadrant
       between zero and the minimum-variance point. */
    vt.x0 = Math.max(0, sMv - (sMax - sMv) * 0.10);
    vt.x1 = sMax * 1.03;
    vt.y0 = bLo;
    vt.y1 = bHi;

    if (!view.ready) {
      view.x0 = vt.x0; view.x1 = vt.x1; view.y0 = vt.y0; view.y1 = vt.y1;
      view.ready = true;
    }
  }

  /* Every frame, without exception. The scatter layer is blitted through an
     affine correction onto whatever window is showing now, so cloud and curve
     stay registered no matter how fast or slow this eases. */
  function easeView() {
    if (!view.ready) return;
    view.x0 += (vt.x0 - view.x0) * EASE;
    view.x1 += (vt.x1 - view.x1) * EASE;
    view.y0 += (vt.y0 - view.y0) * EASE;
    view.y1 += (vt.y1 - view.y1) * EASE;
  }

  /* ---------- Scatter layer ----------------------------------------------- */

  function renderLayer(env, R) {
    var w = Math.max(1, Math.ceil(R.w));
    var h = Math.max(1, Math.ceil(R.h));

    if (!layer) {
      layer = document.createElement("canvas");
      lctx = layer.getContext("2d", { alpha: true });
    }
    if (lw !== w || lh !== h || ldpr !== env.dpr) {
      layer.width = Math.round(w * env.dpr);
      layer.height = Math.round(h * env.dpr);
      lw = w; lh = h; ldpr = env.dpr;
    }

    lctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
    lctx.clearRect(0, 0, w, h);

    var spanX = Math.max(view.x1 - view.x0, 1e-6);
    var spanY = Math.max(view.y1 - view.y0, 1e-6);
    var kx = w / spanX, ky = h / spanY;
    var boost = env.light ? 1.4 : 1;

    for (var p = 0; p < cn; p++) {
      var e = ce[p];
      // Near-efficient portfolios read brighter; the deep interior stays
      // legible rather than fading out, or the bullet disappears.
      lctx.fillStyle = env.rgba("accent-hi", (0.14 + 0.26 * e * e) * boost);
      lctx.fillRect(
        (cs[p] - view.x0) * kx - 0.65,
        h - (cm[p] - view.y0) * ky - 0.65,
        1.3, 1.3
      );
    }

    // Remember the window this was drawn in so the blit can correct for drift.
    lview.x0 = view.x0; lview.x1 = view.x1;
    lview.y0 = view.y0; lview.y1 = view.y1;
    lage = 0;
  }

  /* ---------- Draw -------------------------------------------------------- */

  function draw(env, R) {
    var ctx = env.ctx;
    // Deep navy on white needs more alpha than pale blue on near-black.
    var boost = env.light ? 1.4 : 1;

    var spanX = Math.max(view.x1 - view.x0, 1e-6);
    var spanY = Math.max(view.y1 - view.y0, 1e-6);
    var sx = R.w / spanX;
    var sy = R.h / spanY;
    function X(s) { return R.x + (s - view.x0) * sx; }
    function Y(m) { return R.y + R.h - (m - view.y0) * sy; }

    var i;

    ctx.save();
    ctx.beginPath();
    ctx.rect(R.x - 2, R.y - 2, R.w + 4, R.h + 4);
    ctx.clip();

    /* --- the scatter, blitted from its layer ------------------------------ */
    if (layer && lw > 0) {
      ctx.drawImage(
        layer,
        X(lview.x0),
        Y(lview.y1),
        (lview.x1 - lview.x0) * sx,
        (lview.y1 - lview.y0) * sy
      );
    }

    /* The capital market line is deliberately not drawn. It is still solved for
       — the tangency portfolio it touches is marked below — but a straight line
       cutting across the picture fights the curve rather than supporting it,
       and the frontier reads better on its own. */

    /* --- the frontier ----------------------------------------------------- */
    /* The box bleeds off the top of the canvas, so the top of the return band
       is not actually on screen. Cap the dot's travel at what is visible, or
       it spends part of every sweep out of sight. */
    var mTop = view.y0 + (R.y + R.h - 20) / sy;
    if (!(mTop > mMv) || mTop > view.y1) mTop = view.y1;
    var dot = dotReturn(env.t, mTop);

    // Lower (inefficient) branch, deliberately dim.
    ctx.strokeStyle = env.rgba("accent", 0.22 * boost);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (i = 0; i <= CURVE; i++) {
      var ml = view.y0 + (mMv - view.y0) * (i / CURVE);
      var xl = X(sigmaAt(ml)), yl = Y(ml);
      i ? ctx.lineTo(xl, yl) : ctx.moveTo(xl, yl);
    }
    ctx.stroke();

    // Upper (efficient) branch, the bright one.
    ctx.strokeStyle = env.rgba("accent-hi", 0.58 * boost);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (i = 0; i <= CURVE; i++) {
      var mup = mMv + (view.y1 - mMv) * (i / CURVE);
      var xu = X(sigmaAt(mup)), yu = Y(mup);
      i ? ctx.lineTo(xu, yu) : ctx.moveTo(xu, yu);
    }
    ctx.stroke();

    // A comet of brighter segments trailing the dot along the curve.
    var span = mTop - mMv;
    for (i = 0; i < 28; i++) {
      var f0 = i / 28, f1 = (i + 1) / 28;
      var m0 = dot - span * 0.32 * f1;
      var m1 = dot - span * 0.32 * f0;
      if (m1 < mMv) continue;
      if (m0 < mMv) m0 = mMv;
      var fade = (1 - f0) * (1 - f0);
      ctx.strokeStyle = env.rgba("accent-hi", 0.55 * fade * boost);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(X(sigmaAt(m0)), Y(m0));
      ctx.lineTo(X(sigmaAt(m1)), Y(m1));
      ctx.stroke();
    }

    /* --- markers ---------------------------------------------------------- */
    ring(ctx, X(sMv), Y(mMv), 3.6, env.rgba("accent", 0.52 * boost));
    if (sTan > 1e-6) {
      ring(ctx, X(sTan), Y(mTan), 4.8, env.rgba("accent-2", 0.62 * boost));
    }

    /* --- the travelling portfolio ----------------------------------------- */
    var dx = X(sigmaAt(dot)), dy = Y(dot);

    ctx.fillStyle = env.rgba("accent-hi", 0.13 * boost);
    ctx.beginPath();
    ctx.arc(dx, dy, 12, 0, 6.2832);
    ctx.fill();

    ctx.fillStyle = env.rgba("accent-hi", 0.95 * boost);
    ctx.beginPath();
    ctx.arc(dx, dy, 3.1, 0, 6.2832);
    ctx.fill();

    ctx.restore();

    /* Keep the chart off the copy. Measured against the real text box, so the
       curve genuinely is not there rather than being washed out behind it. */
    window.FZViz.softErase(ctx, env.keepOut, 12, 54);
  }

  function ring(ctx, x, y, r, stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.2832);
    ctx.stroke();
  }


  /* Target return of the dot: a smooth sweep up the efficient branch and back,
     easing at both ends because cos does it for free. */
  function dotReturn(t, mTop) {
    var u = 0.5 - 0.5 * Math.cos(t * SWEEP * 6.2832);
    return mMv + (mTop - mMv) * (0.04 + 0.94 * u);
  }

  /* ---------- Spec -------------------------------------------------------- */

  window.FZViz.mount("frontier", {
    seed: function (env) {
      seedModel(env);
      view.ready = false;
      lage = 1e9;
      // One pass is enough: the first scatter() sets the window outright
      // rather than easing into it, so nothing visibly zooms on load.
      core(0);
      if (ok) scatter();
    },

    frame: function (env) {
      var R = plotRect(env);
      if (!R) return;            // no room to draw is no reason to solve

      core(env.t);
      if (!ok) return;

      var refresh = (++lage >= LAYER_EVERY);
      if (refresh) scatter();        // new points, and a new view target
      easeView();                    // every frame, so the frame never steps
      if (refresh) renderLayer(env, R);

      draw(env, R);
    }
  });
})();
