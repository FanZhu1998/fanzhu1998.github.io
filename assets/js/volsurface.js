/* =============================================================================
   Toolkit-section background: a live implied volatility surface.

   The surface is the pricing dictionary. Every option on the book is looked up
   against it, so its shape carries the two things the market is actually
   quoting: a skew across strike, and a term structure across expiry.

   Built with SSVI — the surface form of Gatheral's stochastic-volatility-
   inspired parameterisation — rather than an arbitrary curved mesh, because it
   is what a surface is genuinely fitted with and it stays roughly arbitrage
   sane by construction:

     w(k, theta) = theta/2 . ( 1 + rho.phi.k + sqrt((phi.k + rho)^2 + 1 - rho^2) )
     phi(theta)  = eta / theta^gamma
     sigma(k, T) = sqrt( w / T )

   where k = log(K/F) and theta is the at-the-money total variance for that
   expiry. At k = 0 the bracket collapses to 2 and w = theta exactly, so the ATM
   line of the surface is the term structure by construction, not by accident.

   THE STRIKE RANGE IS THE WHOLE PICTURE. A real surface is quoted across
   moneyness of roughly 0.5 to 3 — log-moneyness of about -1.1 to +0.5 — and
   that width is where the skew ridge actually lives. Plot a narrow +/-20% band
   instead and SSVI is very nearly linear across it: the result is a tilted
   plane, which is what a surface is emphatically not. The wing is the point.

   What the parameters do, and what you are watching change:

     theta(T)  the ATM term structure. Contango in calm markets, inverted when
               the front end gets bid.
     rho       the skew. Negative for equity, steepening under stress; this is
               why one wing towers over the other instead of a symmetric bowl.
     eta,gamma how fast the skew flattens as expiry lengthens. gamma near 0.44
               reproduces the usual 1/sqrt(T) decay, which is what makes the
               ridge a ridge — tall at the front, collapsing out the back.

   Maturities are spaced geometrically, because the curvature lives at the short
   end and a linear grid wastes its resolution at the back.

   The animation is the surface itself. The parameters drift on incommensurate
   sines, so the skew leans and relaxes, the term structure rolls between
   contango and inversion, and the ridge builds and decays. Nothing sweeps
   across it — the shape is the motion.

   Drawn as a wireframe in axonometric projection rather than a filled mesh: it
   matches the line language of the other three backgrounds, costs about thirty
   strokes instead of a few hundred fills, and depth reads fine from grading the
   lines by distance with the boundary picked out.

   Cost: ~300 grid points, each a sqrt, plus one pow per expiry. A couple of
   thousand flops a frame — nothing worth caching.
   ========================================================================== */

(function () {
  "use strict";

  if (!window.FZViz) return;

  /* ---------- Tunables ---------------------------------------------------- */

  var NK = 22;          // strike samples across a slice
  var NT = 12;          // expiry slices
  var NB = 1;           // regional hump riding on the SSVI base
  var KSTEP = 2;        // draw every Nth strike line, for a squarer mesh
  var GAMMA = 0.44;     // SSVI skew-decay exponent; ~1/sqrt(T) flattening

  /* log(K/F). u = 0 is the put wing, which is the tall one, and it projects to
     the far corner — so the ridge rises into empty space above the sheet
     instead of across it. Put the ridge near the viewer and a wireframe of a
     surface this tall folds over itself into a tangle. */
  var KLO = -1.10, KHI = 0.50;
  var TMIN = 0.06, TMAX = 2.2;     // years
  var ZGAMMA = 0.65;   // display curve on the vertical, see PY()

  /* ---------- State ------------------------------------------------------- */

  var Ts = new Float64Array(NT);
  var vol = new Float64Array(NK * NT);
  var gx = new Float64Array(NK * NT);
  var gy = new Float64Array(NK * NT);

  var par = { rho: -0.6, eta: 1.0, atm: 0.17, slope: 0.04 };
  var ph = null;

  /* Local bumps. SSVI on its own is monotone in strike, so it gives one tall
     wing and leaves the rest of the sheet very nearly a plane. Real surfaces
     are not that clean — event vol at a particular expiry, structured-product
     flow parked at a particular strike and the rest of the supply-and-demand
     mess all show up as localised humps and dips riding on the fitted base,
     and they move. These are that, approximated: a few Gaussians in
     (strike, log-expiry) whose centres and amplitudes drift. The amplitude
     crosses zero, so they surface and subside rather than sliding around.

     The Gaussian is separable, so each bump costs NT + NK exponentials a frame
     rather than NT * NK — 117 instead of 924 across the three. */
  var bmp = [];
  var bRow = new Float64Array(NB * NT);
  var bCol = new Float64Array(NB * NK);
  var bAmp = new Float64Array(NB);

  // Vol range on show, eased. Target and current are separate and the easing
  // runs every frame — easing on a slower cadence makes the whole frame step
  // rather than move, which reads as a wobble.
  var lo = 0.12, hi = 0.5, loT = 0.12, hiT = 0.5, ready = false;
  var EASE = 0.03;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function osc(t, a, w, p) { return a * Math.sin(t * w + p); }

  /* ---------- Geometry ---------------------------------------------------- */

  /* Same rule as the other backgrounds: the surface is erased where the copy
     sits, so it starts from the harness's measurement of the real text box
     rather than a fraction eyeballed at one width, and it runs past the right
     edge so the long-expiry corner bleeds rather than ending on a cut.

     Most of the box height goes to the vertical axis rather than the footprint
     — a surface with a shallow z range reads as a tilted plane however curved
     it really is. */
  function plotRect(env) {
    // On a narrow screen the surface is a figure above the copy, not a backdrop
    // beside it. The harness says which and hands over the box, held square:
    // the footprint depth is tied to the width, so a box wider than it is tall
    // would run the near corner off the bottom — and a wide surface reads flat.
    if (env.mode === "band") return window.FZViz.bandRect(env, 1.0);
    var W = env.W, H = env.H;
    if (W < 760 || H < 260) return null;
    var k = env.keepOut;
    var edge = k ? k.x + k.w : W * 0.54;
    var x = Math.max(W * 0.46, edge + 62);

    /* Roughly half the clear band rather than all of it. A surface stretched
       to fill the width reads as flat however curved it is — the eye takes a
       wide, shallow footprint as a plane seen edge-on. Narrow it and the same
       geometry reads as depth. Leaving the width unspent also carries the
       chart back toward the middle of the page. */
    var avail = W * 0.99 - x;
    var w = avail * 0.55;
    if (w < 200) w = Math.min(200, avail);
    if (w > 330) w = 330;
    if (w < 180) return null;

    // Height comes from the band above the toolkit grid, not from the width,
    // so narrowing the chart does not flatten it as well.
    return { x: x, y: 0, w: w, h: Math.min(H * 0.165, 300) };
  }

  /* ---------- Seed -------------------------------------------------------- */

  function seed() {
    // Geometric spacing: the curvature lives at the short end, and a linear
    // grid spends its resolution at the back where the surface is flat.
    var g = Math.pow(TMAX / TMIN, 1 / (NT - 1));
    for (var j = 0; j < NT; j++) Ts[j] = TMIN * Math.pow(g, j);

    ph = {
      a: rnd(0, 6.283), b: rnd(0, 6.283), c: rnd(0, 6.283), d: rnd(0, 6.283),
      wa: rnd(0.075, 0.130), wb: rnd(0.060, 0.105),
      // Slow: the base is the backdrop, the humps are the event.
      wc: rnd(0.045, 0.080), wd: rnd(0.038, 0.070)
    };

    /* Two regional humps, and they stay where they are. Letting the centres
       drift is what made the sheet roll and wave like a flag: the relief
       travelled across it, so every part of the surface was always moving.
       Pinned and pulsed instead, each hump swells and subsides over its own
       patch while the rest of the sheet holds still — which is how a surface
       actually behaves. A name gets bid for a fortnight around one expiry and
       the rest of the book does not move with it.

       Because the centres are fixed, the Gaussian factors are constants: they
       are computed once here and never again, so the humps cost two sines a
       frame rather than NT + NK exponentials. */
    var spot = [
      { k: 0.42, t: 0.30 }       // mid strike, front third of the curve
    ];

    bmp = [];
    for (var b = 0; b < NB; b++) {
      var ck = spot[b].k + rnd(-0.04, 0.04);
      var ct = spot[b].t + rnd(-0.04, 0.04);
      /* Wide on purpose. A narrow Gaussian on a smooth sheet is a spike poking
         through a tarpaulin — crude, and it reads as an artefact rather than as
         vol. Spread over most of the strike axis it becomes a swell the surface
         carries, which is both more elegant and closer to what a bid for a
         region of the book actually does to the quotes. */
      var sk = rnd(0.20, 0.25);
      var st = rnd(0.25, 0.31);

      bmp.push({
        amp: rnd(0.170, 0.215),
        // A full breath in about six seconds. Slower than this and nobody
        // waits long enough to notice the surface is alive at all.
        w: rnd(0.95, 1.15),
        p: rnd(0, 6.283)
      });

      var dk2 = 2 * sk * sk, dt2 = 2 * st * st, q;
      for (q = 0; q < NT; q++) {
        var dt = q / (NT - 1) - ct;
        bRow[b * NT + q] = Math.exp(-dt * dt / dt2);
      }
      for (q = 0; q < NK; q++) {
        var dk = q / (NK - 1) - ck;
        bCol[b * NK + q] = Math.exp(-dk * dk / dk2);
      }
    }
    ready = false;
  }

  /* ---------- Per-frame model --------------------------------------------- */

  function kAt(u) { return KLO + (KHI - KLO) * u; }

  /* Implied vol at one (k, T) from the SSVI slice for that expiry. */
  function sigma(k, T, theta, phi) {
    var pk = phi * k;
    var r = par.rho;
    var w = 0.5 * theta * (1 + r * pk + Math.sqrt((pk + r) * (pk + r) + 1 - r * r));
    return w > 0 ? Math.sqrt(w / T) : 0;
  }

  function thetaOf(T) {
    // ATM term structure: a level plus a slope that saturates, so the front end
    // moves more than the back the way it does in the quotes.
    var s = par.atm + par.slope * (1 - Math.exp(-T / 0.55));
    if (s < 0.05) s = 0.05;
    return s * s * T;
  }

  function build(t) {
    /* The stress dial, and the whole of the animation. Calm is contango and a
       shallow skew; stress bids the front end until the term structure inverts
       and the skew steepens into a wall. Two incommensurate sines so the shape
       never settles into a visible loop. */
    var stress = 0.5 + 0.40 * Math.sin(t * 0.085) + 0.15 * Math.sin(t * 0.047 + 1.9);
    if (stress < 0) stress = 0; else if (stress > 1) stress = 1;

    par.atm = 0.135 + 0.085 * stress + osc(t, 0.018, ph.wa, ph.a);
    par.slope = 0.060 * (1 - 2 * stress) + osc(t, 0.014, ph.wb, ph.b);
    /* Held off the extremes on purpose. Drive rho hard negative and the call
       wing goes dead flat, which is most of the sheet — a moderate skew keeps
       both wings lifting and leaves a smile rather than a ramp. */
    /* Both held off the extremes on purpose. Drive rho hard negative and the
       call wing goes dead flat, which is most of the sheet; keep it moderate
       and lift eta instead and every slice is a skewed smile with both wings
       rising, which is relief across the whole surface rather than one tall
       corner and a plane behind it. */
    par.rho = -0.30 - 0.30 * stress + osc(t, 0.09, ph.wc, ph.c);
    if (par.rho < -0.80) par.rho = -0.80;
    par.eta = 1.55 + osc(t, 0.45, ph.wd, ph.d);
    if (par.eta < 0.55) par.eta = 0.55;

    var i, j, b, mn = 1e9, mx = -1e9;

    /* The hump is pinned, so only its height changes: the shape factors were
       precomputed at seed and all that is left per frame is one cosine.

       A raised cosine with a floor under it, not a plain sine: the hump breathes
       between a third of its height and full rather than swinging through zero
       into a pit and back. It is always there, which is what keeps the surface
       from flattening off to bare SSVI at the bottom of every cycle. */
    for (b = 0; b < NB; b++) {
      bAmp[b] = bmp[b].amp *
        (0.35 + 0.65 * (0.5 - 0.5 * Math.cos(t * bmp[b].w + bmp[b].p)));
    }

    for (j = 0; j < NT; j++) {
      var T = Ts[j];
      var th = thetaOf(T);
      var phi = par.eta / Math.pow(th, GAMMA);
      for (i = 0; i < NK; i++) {
        var s = sigma(kAt(i / (NK - 1)), T, th, phi);
        for (b = 0; b < NB; b++) s += bAmp[b] * bRow[b * NT + j] * bCol[b * NK + i];
        // Four bumps can in principle pile up on one another; clamp so a rare
        // coincidence cannot spike the sheet and squash everything else via the
        // range normalisation.
        if (s < 0.03) s = 0.03; else if (s > 0.95) s = 0.95;
        vol[j * NK + i] = s;
        if (s < mn) mn = s;
        if (s > mx) mx = s;
      }
    }

    var pad = (mx - mn) * 0.06 + 0.004;
    loT = mn - pad;
    hiT = mx + pad;
    if (!ready) { lo = loT; hi = hiT; ready = true; }
    lo += (loT - lo) * EASE;
    hi += (hiT - hi) * EASE;
  }

  /* ---------- Draw -------------------------------------------------------- */

  function edge(ctx, xs, ys, start, step, count) {
    ctx.beginPath();
    for (var q = 0; q < count; q++) {
      var n = start + q * step;
      q ? ctx.lineTo(xs[n], ys[n]) : ctx.moveTo(xs[n], ys[n]);
    }
    ctx.stroke();
  }

  function draw(env, R) {
    var ctx = env.ctx;
    // Deep navy on white needs more alpha than pale blue on near-black.
    var boost = env.light ? 1.4 : 1;

    /* Proportions are a balance, not a maximisation. Too little vertical and
       the surface reads as a tilted plane; too little footprint and the mesh
       folds through itself, because a tall surface in axonometric needs depth
       separation to stay legible.

       The footprint depth is tied to its width rather than to the box, so the
       base stays a proper isometric diamond at any box shape; only the vertical
       axis takes the extra height. */
    var SX = R.w * 0.46;
    var SY = SX * 0.42;
    var SZ = R.h * 0.46;
    var cx = R.x + R.w * 0.50;
    // Sat low enough that the ridge keeps clear of the fixed nav overhead and
    // the near corner still lands above the fade into the toolkit grid.
    var cy = R.y + R.h * 0.60;
    var span = Math.max(hi - lo, 1e-6);

    function PX(u, v) { return cx + (v - u) * SX; }
    /* The vertical carries a mild display curve. A real surface has a huge
       dynamic range — the short-dated wing can be five times the long-dated
       ATM — and mapping that linearly spends the whole axis on one corner and
       presses everything else flat against the floor. The exponent lifts the
       body of the sheet without flattening the wall. */
    function PY(u, v, s) {
      var z = (s - lo) / span;
      if (z < 0) z = 0; else if (z > 1) z = 1;
      return cy + (v + u) * SY - Math.pow(z, ZGAMMA) * SZ;
    }

    var i, j, n;

    ctx.save();
    ctx.beginPath();
    ctx.rect(R.x - 2, R.y - 2, R.w + 4, R.h + 4);
    ctx.clip();

    /* --- the frame: floor and three axes, all one weight ------------------ */
    ctx.strokeStyle = env.rgba("muted", 0.18 * boost);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PX(0, 0), cy);
    ctx.lineTo(PX(1, 0), cy + SY);
    ctx.lineTo(PX(1, 1), cy + 2 * SY);
    ctx.lineTo(PX(0, 1), cy + SY);
    ctx.closePath();
    ctx.stroke();

    /* Three axes off the near-left corner: implied vol rising, strike and
       expiry running away along the base. That corner is the call wing at the
       short end, which is the low corner of the surface, so the axes sit in
       clear space rather than buried under the skew wall. No ticks and no
       labels — the shape is the point, not the numbers. Same stroke as the
       floor, so the whole frame reads as one object. */
    var ox = PX(1, 0), oy = cy + SY;
    ctx.beginPath();
    ctx.moveTo(ox, oy); ctx.lineTo(ox, oy - SZ);                  // implied vol
    ctx.moveTo(ox, oy); ctx.lineTo(PX(0, 0), cy);                 // strike
    ctx.moveTo(ox, oy); ctx.lineTo(PX(1, 1), cy + 2 * SY);        // expiry
    ctx.stroke();

    /* --- project the grid once -------------------------------------------- */
    for (j = 0; j < NT; j++) {
      var v = j / (NT - 1);
      for (i = 0; i < NK; i++) {
        n = j * NK + i;
        gx[n] = PX(i / (NK - 1), v);
        gy[n] = PY(i / (NK - 1), v, vol[n]);
      }
    }

    /* --- the mesh, graded by depth ---------------------------------------- */
    ctx.lineWidth = 1;

    // Constant-expiry lines: the smile at each maturity.
    for (j = 0; j < NT; j++) {
      var vj = j / (NT - 1);
      ctx.strokeStyle = env.rgba("accent", (0.12 + 0.20 * ((vj + 0.5) / 1.5)) * boost);
      ctx.beginPath();
      for (i = 0; i < NK; i++) {
        n = j * NK + i;
        i ? ctx.lineTo(gx[n], gy[n]) : ctx.moveTo(gx[n], gy[n]);
      }
      ctx.stroke();
    }

    // Constant-strike lines: the term structure at each strike.
    for (i = 0; i < NK; i += KSTEP) {
      var ui = i / (NK - 1);
      ctx.strokeStyle = env.rgba("accent-2", (0.10 + 0.17 * ((ui + 0.5) / 1.5)) * boost);
      ctx.beginPath();
      for (j = 0; j < NT; j++) {
        n = j * NK + i;
        j ? ctx.lineTo(gx[n], gy[n]) : ctx.moveTo(gx[n], gy[n]);
      }
      ctx.stroke();
    }

    /* --- the boundary, which is what gives a wireframe its edge ------------ */
    ctx.strokeStyle = env.rgba("accent-hi", 0.50 * boost);
    ctx.lineWidth = 1.5;

    edge(ctx, gx, gy, 0, 1, NK);                    // front expiry
    edge(ctx, gx, gy, (NT - 1) * NK, 1, NK);        // back expiry
    edge(ctx, gx, gy, 0, NK, NT);                   // call wing
    edge(ctx, gx, gy, NK - 1, NK, NT);              // put wing — the ridge

    ctx.restore();

    /* Keep the surface off the copy. Measured against the real text box, so it
       genuinely is not there rather than being washed out behind it. */
    window.FZViz.softErase(ctx, env.keepOut, 12, 54);
  }

  /* ---------- Spec -------------------------------------------------------- */

  window.FZViz.mount("volsurface", {
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
