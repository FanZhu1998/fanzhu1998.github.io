/* =============================================================================
   Experience-section background: a live delta-gamma sensitivity spider.

   This is the shape of the daily Rates/FX sensitivity run. One curve per risk
   factor, every one of them pinned through the origin, because a sensitivity
   ladder is a *change* in PnL against a *shock* — at zero shock nothing has
   moved, so every factor crosses there. That pinch at the origin with the
   curves fanning out either side is what makes it a spider.

     PnL_f(s) = delta_f . s  +  1/2 gamma_f . s^2  +  1/6 speed_f . s^3

   The first two terms are the delta-gamma approximation the risk engine
   actually reports. The cubic is a deliberate third order addition: a pure
   quadratic is perfectly symmetric about its vertex, and real revaluation
   ladders never are, because gamma itself moves as the shock gets larger.

   Four legs, each a deliberate archetype rather than a random draw, because
   four curves that each say something beat a dozen that blur together:

     STRADDLE   delta ~ 0, gamma strongly positive. The U of a well hedged book
                — flat through the middle, gaining in both wings. The shape
                everyone pictures when they hear "long convexity".

     CUBIC      delta and gamma both ~ 0, third order dominant, so PnL runs as
                s^3: down in one wing, up in the other, flat across the middle.
                That is a book whose convexity changes sign across the shock
                range, which is what asymmetric hedges and barriers do.

     STRUCTURED the complicated one. A delta-gamma base plus three smoothed
                digital terms at drifting strikes, so the ladder picks up
                plateaus and changes of curvature where optionality kicks in.
                Real books with strikes scattered across the range look like
                this, and nothing lower order reproduces it.

   Each leg carries its own tone from the site's accent ramp, which happens to
   have exactly three steps — so the legs are told apart by shade rather than by
   a legend, and the ramp reads as a ramp in both themes.

   A hedge dial drifts slowly from well hedged toward directional and back. It
   moves the structured leg's directional component, which is the honest place
   for it — hedging changes directional exposure, not the convexity you were
   sold. A marker sweeps the shock axis and drops a dot where it cuts each
   curve, the way you would read a ladder off at a given shock, and haloes
   whichever leg is moving most at that shock.

   Cost: four polynomials over sixty samples, plus a handful of tanh calls for
   the structured leg. A few thousand flops a frame, so unlike the frontier's
   scatter there is nothing here worth caching.
   ========================================================================== */

(function () {
  "use strict";

  if (!window.FZViz) return;

  /* ---------- Tunables ---------------------------------------------------- */

  var NF = 3;          // legs: straddle, cubic, structured
  var CPX = 2;         // index of the structured leg
  var SAMP = 60;       // samples along the shock axis
  var SWEEP = 0.055;   // cycles/sec of the shock marker
  var BP = 100;        // shock axis runs +/- this many basis points

  /* One tone of the accent ramp per leg. The ramp runs light-to-dim in the dark
     theme and dark-to-light in the light one, so it reads as an ordered ramp
     either way; the alphas lift the dimmer end so all three carry equally. */
  var TONE = ["accent-hi", "accent", "accent-2"];
  var ALPHA = [0.52, 0.56, 0.62];

  /* ---------- State ------------------------------------------------------- */

  var ph = [];                              // fixed phases, one bag per leg
  var co = [];                              // {d,g,v} for this frame
  var opt = [];                             // smoothed digitals on the structured leg
  var optZero = 0;                          // their value at s = 0, so it stays pinned
  var curve = new Float64Array(NF * SAMP);

  // PnL half-range on show, eased. Target and current are separate and the
  // easing runs every frame — easing on a slower cadence makes the whole frame
  // step rather than move, which reads as a wobble.
  var span = 1, spanT = 1, ready = false;
  var EASE = 0.03;

  function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
  function osc(t, a, w, p) { return a * Math.sin(t * w + p); }

  /* ---------- Geometry ---------------------------------------------------- */

  /* The sheet fans out from behind the tail of the section head, mirroring the
     frontier in the section above: the box runs past the top and right of the
     canvas so the curves bleed off those edges rather than ending on hard cuts,
     and the origin — the pinch every curve passes through — sits in the clear
     air to the right of the copy where it can be seen.

     The right wing carries the chart, since the left one runs back behind the
     copy, so the box only just overruns the right edge — push it much further
     and the wing extremes, which is where the convexity actually shows, end up
     off canvas and all that is left on screen is the flat middle. */
  function plotRect(env) {
    // On a narrow screen the sheet is a figure above the copy, not a backdrop
    // beside it. The harness says which and hands over the box; the spider is
    // wider than it is tall, so it may take most of the band.
    if (env.mode === "band") return window.FZViz.bandRect(env, 1.7);
    var W = env.W, H = env.H;
    if (W < 760 || H < 260) return null;
    /* Placed against the harness's measurement of the real text box rather than
       a fraction eyeballed at one width, so it holds wherever the copy reflows.
       The origin — the pinch every leg passes through — sits partway into the
       clear air past the copy; the left wing runs back and dissolves into the
       text edge, the right one bleeds off the canvas. */
    var k = env.keepOut;
    var edge = k ? k.x + k.w : W * 0.64;
    var cx = edge + (W - edge) * 0.50;
    var half = Math.min(cx - edge + 64, W * 1.06 - cx);
    if (half < 140) return null;
    var x = cx - half;
    var w = half * 2;
    /* Lifted slightly, because the section fades the chart out before the
       timeline starts and the deepest part of the short-gamma leg is exactly
       what would otherwise dissolve into it. */
    var y = H * -0.02;
    return { x: x, y: y, w: w, h: Math.min(H * 0.32, w / 1.45) };
  }

  /* ---------- Seed -------------------------------------------------------- */

  function seed() {
    ph = [];
    co = [];
    for (var i = 0; i < NF; i++) {
      ph.push({
        a: rnd(0, 6.283), b: rnd(0, 6.283), c: rnd(0, 6.283),
        wa: rnd(0.038, 0.075), wb: rnd(0.031, 0.062), wc: rnd(0.044, 0.081)
      });
      co.push({ d: 0, g: 0, v: 0 });
    }

    // Three smoothed digitals for the structured leg: fixed sign and width,
    // strikes that drift across the shock range so the kinks migrate.
    opt = [];
    for (var j = 0; j < 3; j++) {
      opt.push({
        amp: rnd(0.16, 0.30) * (j === 1 ? -1 : 1),
        k0: -0.45 + j * 0.45,
        kA: rnd(0.14, 0.26), kW: rnd(0.035, 0.07), kP: rnd(0, 6.283),
        wid: rnd(0.10, 0.20),
        k: 0
      });
    }
    ready = false;
  }

  /* ---------- Per-frame model --------------------------------------------- */

  function coeffs(t) {
    /* The hedge dial. Near 1 the book is hedged and directional exposure is
       squeezed out; near 0 it comes back. Two incommensurate sines so it never
       loops visibly. */
    var hedge = 0.52 + 0.40 * Math.sin(t * 0.037) + 0.15 * Math.sin(t * 0.019 + 2.1);
    if (hedge < 0.04) hedge = 0.04;
    if (hedge > 0.99) hedge = 0.99;
    var open = 0.10 + 0.90 * (1 - hedge);

    var p;

    // 0 — STRADDLE. Delta held near zero so it stays a U whatever the dial
    // does; only the convexity breathes. Never exactly delta neutral, because
    // nothing ever is.
    p = ph[0];
    co[0].d = osc(t, 0.07, p.wa, p.a);
    co[0].g = 1.12 + osc(t, 0.26, p.wb, p.b);
    co[0].v = osc(t, 0.12, p.wc, p.c);

    // 1 — CUBIC. Delta and gamma near zero, third order dominant, so the leg
    // runs as s^3: flat across the middle, opposite signs in the two wings.
    p = ph[1];
    co[1].d = osc(t, 0.06, p.wa, p.a);
    co[1].g = osc(t, 0.10, p.wb, p.b);
    co[1].v = 3.5 + osc(t, 0.85, p.wc, p.c);

    // 2 — STRUCTURED. A modest base; the character comes from the digitals.
    // Its directional component is what the hedge dial actually moves.
    p = ph[2];
    co[2].d = (0.30 + osc(t, 0.26, p.wa, p.a)) * open;
    co[2].g = -0.30 + osc(t, 0.34, p.wb, p.b);
    co[2].v = osc(t, 1.10, p.wc, p.c);
    for (var j = 0; j < 3; j++) {
      var o = opt[j];
      o.k = o.k0 + osc(t, o.kA, o.kW, o.kP);
    }
    optZero = digitals(0);

  }

  function digitals(s) {
    var v = 0;
    for (var j = 0; j < 3; j++) {
      var o = opt[j];
      v += o.amp * Math.tanh((s - o.k) / o.wid);
    }
    return v;
  }

  /* PnL of one leg at an arbitrary shock. The structured leg has its digitals
     re-based to zero so every curve still passes through the origin. */
  function pnlAt(i, s) {
    var c = co[i];
    var v = c.d * s + 0.5 * c.g * s * s + c.v * s * s * s / 6;
    if (i === CPX) v += digitals(s) - optZero;
    return v;
  }

  function build(t) {
    coeffs(t);

    var i, k, peak = 1e-6;
    for (k = 0; k < SAMP; k++) {
      var s = -1 + 2 * k / (SAMP - 1);
      for (i = 0; i < NF; i++) {
        var v = pnlAt(i, s);
        curve[i * SAMP + k] = v;
        var a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
    }

    spanT = peak * 1.10;
    if (!ready) { span = spanT; ready = true; }
    span += (spanT - span) * EASE;
  }

  /* ---------- Draw -------------------------------------------------------- */

  function draw(env, R) {
    var ctx = env.ctx;
    // Deep navy on white needs more alpha than pale blue on near-black.
    var boost = env.light ? 1.4 : 1;

    var cx = R.x + R.w / 2;                 // shock = 0
    var cy = R.y + R.h / 2;                 // PnL = 0
    var sx = R.w / 2;                       // per unit shock
    var sy = (R.h / 2) / Math.max(span, 1e-9);

    function X(s) { return cx + s * sx; }
    function Y(v) { return cy - v * sy; }

    var i, k;

    ctx.save();
    ctx.beginPath();
    ctx.rect(R.x - 2, R.y - 2, R.w + 4, R.h + 4);
    ctx.clip();

    /* --- the zero axes, which are the structure of the thing -------------- */
    /* No ticks on either axis, matching the surface in the toolkit section:
       the shape is the point, and the sweep marker already reads the shock
       off in basis points. */
    ctx.strokeStyle = env.rgba("muted", 0.20 * boost);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(R.x, cy); ctx.lineTo(R.x + R.w, cy);
    ctx.moveTo(cx, R.y); ctx.lineTo(cx, R.y + R.h);
    ctx.stroke();

    /* --- the legs, one tone of the accent ramp each ----------------------- */
    ctx.lineWidth = 1.5;
    for (i = 0; i < NF; i++) {
      ctx.strokeStyle = env.rgba(TONE[i], ALPHA[i] * boost);
      ctx.beginPath();
      for (k = 0; k < SAMP; k++) {
        var s = -1 + 2 * k / (SAMP - 1);
        var px = X(s), py = Y(curve[i * SAMP + k]);
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.stroke();
    }

    /* --- the shock marker, read off the way a ladder is ------------------- */
    var shock = Math.sin(env.t * SWEEP * 6.2832);
    var mx = X(shock);

    ctx.strokeStyle = env.rgba("accent-hi", 0.22 * boost);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx, R.y);
    ctx.lineTo(mx, R.y + R.h);
    ctx.stroke();

    // Halo whichever leg is moving most at this shock — the one that would get
    // asked about first.
    var big = 0, bigV = -1;
    for (i = 0; i < NF; i++) {
      var av = Math.abs(pnlAt(i, shock));
      if (av > bigV) { bigV = av; big = i; }
    }

    for (i = 0; i < NF; i++) {
      var dy = Y(pnlAt(i, shock));
      if (i === big) {
        ctx.fillStyle = env.rgba("accent-hi", 0.13 * boost);
        ctx.beginPath();
        ctx.arc(mx, dy, 10, 0, 6.2832);
        ctx.fill();
      }
      ctx.fillStyle = env.rgba(TONE[i], (i === big ? 0.95 : 0.72) * boost);
      ctx.beginPath();
      ctx.arc(mx, dy, i === big ? 2.9 : 2.2, 0, 6.2832);
      ctx.fill();
    }

    ctx.restore();

    /* Keep the sheet off the copy. Measured against the real text box, so the
       curves genuinely are not there rather than being washed out behind it. */
    window.FZViz.softErase(ctx, env.keepOut, 12, 54);

    /* --- labels, kept to the two that say what the axes are --------------- */
    if (R.w > 420) {
      ctx.font = '500 8px "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = env.rgba("muted", 0.46 * boost);
      ctx.fillText("Δ PnL", cx + 8, R.y + 22);
      var bp = Math.round(shock * BP);
      ctx.fillText((bp > 0 ? "+" : "") + bp + " BP", mx + 6, cy + 15);
    }
  }

  /* ---------- Spec -------------------------------------------------------- */

  window.FZViz.mount("sensitivity", {
    seed: function () {
      seed();
      build(0);
    },

    frame: function (env) {
      var R = plotRect(env);
      if (!R) return;            // no room to draw is no reason to solve
      build(env.t);
      draw(env, R);
    }
  });
})();
