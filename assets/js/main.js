/* =============================================================================
   Site chrome: theme toggle, sticky nav, mobile menu, scroll-spy, reveals.
   ========================================================================== */

(function () {
  "use strict";

  var root = document.documentElement;

  /* ---------- Theme ------------------------------------------------------ */

  var STORE = "fz-theme";
  var toggle = document.querySelector("[data-theme-toggle]");

  function defaultTheme() {
    return "dark";
  }

  function activeTheme() {
    return root.getAttribute("data-theme") || defaultTheme();
  }

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem(STORE, theme); } catch (e) {}
    if (toggle) {
      toggle.setAttribute("aria-label", "Switch to " + (theme === "dark" ? "light" : "dark") + " theme");
      toggle.setAttribute("aria-pressed", String(theme === "light"));
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#080e18" : "#f5f8fc");
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: theme } }));
  }

  if (toggle) {
    toggle.addEventListener("click", function () {
      applyTheme(activeTheme() === "dark" ? "light" : "dark");
    });
  }

  // Sync the stored choice on load (the inline head script sets it pre-paint).
  applyTheme(activeTheme());

  /* ---------- Sticky nav ------------------------------------------------- */

  var nav = document.querySelector(".nav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("is-stuck", window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ---------- Mobile menu ------------------------------------------------ */

  var menuBtn = document.querySelector("[data-menu-toggle]");
  var links = document.getElementById("nav-links");

  function closeMenu() {
    if (!links) return;
    links.classList.remove("is-open");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
  }

  if (menuBtn && links) {
    menuBtn.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      menuBtn.setAttribute("aria-expanded", String(open));
    });
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") closeMenu();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });
  }

  /* ---------- Scroll reveal ---------------------------------------------- */

  var revealables = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(revealables, function (el) { el.classList.add("is-in"); });
  } else {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        revealObs.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });

    Array.prototype.forEach.call(revealables, function (el, i) {
      el.style.transitionDelay = Math.min(i % 6, 5) * 55 + "ms";
      revealObs.observe(el);
    });
  }

  /* ---------- Scroll spy -------------------------------------------------- */

  var navAnchors = Array.prototype.slice.call(
    document.querySelectorAll('#nav-links a[href^="#"]')
  );
  var sections = navAnchors
    .map(function (a) { return document.querySelector(a.getAttribute("href")); })
    .filter(Boolean);

  if (sections.length && "IntersectionObserver" in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navAnchors.forEach(function (a) {
          a.setAttribute("aria-current", String(a.getAttribute("href") === "#" + entry.target.id));
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- Email ------------------------------------------------------- */
  /* Assembled at runtime so the address is not sitting in the HTML source for
     scrapers. Degrades to a visible, human-readable address if JS is off. */

  var USER = "fanzhu1998";
  var HOST = ["gmail", "com"].join(".");

  Array.prototype.forEach.call(document.querySelectorAll("[data-mail]"), function (el) {
    var addr = USER + String.fromCharCode(64) + HOST;
    el.setAttribute("href", "mailto:" + addr);
    var label = el.querySelector("[data-mail-text]");
    if (label) label.textContent = addr;
  });

  /* ---------- Year -------------------------------------------------------- */

  var y = document.getElementById("year");
  if (y) y.textContent = String(new Date().getFullYear());
})();
