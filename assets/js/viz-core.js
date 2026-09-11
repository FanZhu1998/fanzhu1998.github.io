/* =============================================================================
   FZViz — the shared harness behind every canvas background on this site.

   A background visualisation only ever needs to answer one question: "draw one
   frame, at this size, in this palette, at time t". Everything around that
   question is the same every time — device-pixel-ratio sizing, reading the
   theme tokens out of CSS and re-reading them when the theme flips, running
   rAF only while the canvas is actually on screen and the tab is visible,
   honouring prefers-reduced-motion, and debouncing resize. That boilerplate
   lives here once.

   Usage:

     FZViz.mount("frontier", {
       seed:  function (env) { ... },   // optional; first mount + every resize
       frame: function (env) { ... }    // required; draw exactly one frame
     });

   `env` carries ctx, W, H, dpr, t (seconds), frame (count), reduced, a
   `palette` of "r,g,b" triplets keyed by token name, an rgba() helper, and a
   `state` object the spec owns. The canvas is cleared before every frame, so
   a spec only ever draws.

   Adding another background is then: one <canvas id>, one CSS rule, one file
   with seed/frame. Nothing in here needs to change.
   ========================================================================== */

(function (global) {
  "use strict";

  var reduced = !!(global.matchMedia &&
    global.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* Theme tokens worth exposing. Anything here is available to every spec as
     env.palette[name] and env.rgba(name, alpha). */
  var TOKENS = [
    "accent", "accent-2", "accent-hi", "ink", "ink-2", "muted", "page", "surface"
  ];

  var FALLBACK = {
    "accent": "125,171,221",
    "accent-2": "98,138,184",
    "accent-hi": "167,200,238",
    "ink": "232,238,247",
    "ink-2": "167,184,206",
    "muted": "127,146,169",
    "page": "8,14,24",
    "surface": "13,21,35"
  };

  function toTriplet(value) {
    var hex = (value || "").trim();
    if (hex.charAt(0) !== "#") return null;
    if (hex.length === 4) {
      hex = "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (hex.length !== 7) return null;
    var v = parseInt(hex.slice(1), 16);
    if (isNaN(v)) return null;
    return ((v >> 16) & 255) + "," + ((v >> 8) & 255) + "," + (v & 255);
  }

  function readPalette(into) {
    var cs = getComputedStyle(document.documentElement);
    for (var i = 0; i < TOKENS.length; i++) {
      var name = TOKENS[i];
      var v = toTriplet(cs.getPropertyValue("--" + name));
      into[name] = v || into[name] || FALLBACK[name];
    }
    return into;
  }

  /* Which way round the theme is. A dark accent on a light ground needs more
     alpha to carry the same presence as a light accent on a dark one, so every
     spec gets told rather than each one guessing. */
  function isLight(palette) {
    var p = (palette.page || FALLBACK.page).split(",");
    var lum = (0.2126 * +p[0] + 0.7152 * +p[1] + 0.0722 * +p[2]) / 255;
    return lum > 0.5;
  }

  /* Layout position of `el` relative to `root`, walking the offsetParent chain.
     Deliberately not getBoundingClientRect: the section head carries .reveal,
     which holds a translateY until it animates in, and a measurement taken
     before that would be off by the transform. offsetTop/offsetLeft are layout
     values and ignore transforms entirely. */
  function rectWithin(el, root) {
    var x = 0, y = 0, n = el;
    while (n && n !== root) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    if (!n) return null;
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }

  /* Erase a soft-edged rectangle out of whatever has been drawn. Used to keep a
     background off the copy: rather than washing the chart out with a scrim and
     hoping, the visualisation is measured against the real text box and simply
     is not there. Composed from a solid core, four edge gradients and four
     corner gradients, which needs no ctx.filter and so works everywhere.

     The regions are laid out not to overlap, because destination-out compounds
     — overlapping fills would cut a visible seam along the edges. */
  function softErase(ctx, r, pad, feather) {
    if (!r) return;

    var x = r.x - pad, y = r.y - pad;
    var w = r.w + pad * 2, h = r.h + pad * 2;
    var f = feather;
    var g;

    ctx.save();
    ctx.globalCompositeOperation = "destination-out";

    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.fillRect(x, y, w, h);

    g = ctx.createLinearGradient(x, 0, x - f, 0);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(x - f, y, f, h);

    g = ctx.createLinearGradient(x + w, 0, x + w + f, 0);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(x + w, y, f, h);

    g = ctx.createLinearGradient(0, y, 0, y - f);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(x, y - f, w, f);

    g = ctx.createLinearGradient(0, y + h, 0, y + h + f);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(x, y + h, w, f);

    corner(ctx, x, y, -1, -1, f);
    corner(ctx, x + w, y, 1, -1, f);
    corner(ctx, x, y + h, -1, 1, f);
    corner(ctx, x + w, y + h, 1, 1, f);

    ctx.restore();
  }

  function corner(ctx, cx, cy, dx, dy, f) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, f);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(dx < 0 ? cx - f : cx, dy < 0 ? cy - f : cy, f, f);
  }

  function mount(id, spec) {
    var canvas = document.getElementById(id);
    if (!canvas || !canvas.getContext || !spec || typeof spec.frame !== "function") {
      return null;
    }

    var ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return null;

    var env = {
      ctx: ctx,
      canvas: canvas,
      W: 0,
      H: 0,
      dpr: 1,
      t: 0,
      frame: 0,
      reduced: reduced,
      light: false,
      keepOut: null,     // the copy this background must stay clear of
      palette: {},
      state: {},
      rgba: function (name, alpha) {
        var rgb = env.palette[name] || FALLBACK[name] || FALLBACK.accent;
        return "rgba(" + rgb + "," + (alpha < 0 ? 0 : alpha > 1 ? 1 : alpha).toFixed(3) + ")";
      }
    };

    function refreshPalette() {
      readPalette(env.palette);
      env.light = isLight(env.palette);
    }

    refreshPalette();

    var running = false;
    var rafId = null;
    var onScreen = true;

    /* Where the copy sits, in canvas coordinates. Measured rather than guessed
       at in percentages, so it follows the text however it reflows. */
    function measureKeepOut() {
      var head = canvas.parentNode &&
        canvas.parentNode.querySelector(spec.keepOut || ".section__head");
      env.keepOut = head ? rectWithin(head, canvas.parentNode) : null;
    }

    function paint() {
      ctx.clearRect(0, 0, env.W, env.H);
      spec.frame(env);
    }

    function resize(force) {
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(Math.round(rect.width), 1);
      var h = Math.max(Math.round(rect.height), 1);
      var d = Math.min(global.devicePixelRatio || 1, 2);

      // Mobile browsers fire resize when the URL bar hides; re-seeding on that
      // would restart the visualisation mid-scroll for no reason.
      if (!force && w === env.W && h === env.H && d === env.dpr) return;

      env.W = w;
      env.H = h;
      env.dpr = d;
      canvas.width = Math.round(w * d);
      canvas.height = Math.round(h * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);

      measureKeepOut();

      if (typeof spec.seed === "function") spec.seed(env);
      paint();
    }

    /* Real elapsed seconds, not frame counts, so a 120Hz display does not run
       the animation at double speed and a slow one does not crawl. The clamp
       stops a backgrounded tab from jumping the clock when it resumes. */
    var last = 0;

    function loop(now) {
      if (!running) return;
      var dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0)) dt = 1 / 60;
      if (dt > 0.05) dt = 0.05;
      env.t += dt;
      env.frame++;
      paint();
      rafId = global.requestAnimationFrame(loop);
    }

    function start() {
      if (running || reduced || !onScreen || document.hidden) return;
      running = true;
      last = (global.performance && global.performance.now) ? performance.now() : Date.now();
      rafId = global.requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (rafId) global.cancelAnimationFrame(rafId);
      rafId = null;
    }

    if ("IntersectionObserver" in global) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        onScreen ? start() : stop();
      }, { threshold: 0 }).observe(canvas);
    }

    document.addEventListener("visibilitychange", function () {
      document.hidden ? stop() : start();
    });

    var rt;
    global.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(function () { resize(false); }, 150);
    });

    // main.js dispatches this on the theme toggle.
    document.addEventListener("themechange", function () {
      refreshPalette();
      if (!running) paint();
    });

    /* Text measured in ch units moves when the web font swaps in, and the
       charts position themselves against that measurement. Re-take it once the
       fonts have settled, or the keep-out can be left describing the fallback
       font's layout rather than the real one. */
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(function () {
        measureKeepOut();
        if (!running) paint();
      })["catch"](function () {});
    }

    resize(true);
    start();

    return { start: start, stop: stop, env: env };
  }

  global.FZViz = { mount: mount, reduced: reduced, softErase: softErase };
})(window);
