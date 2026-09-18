/* =============================================================================
   Research interactions: a compact heatmap view for narrow screens.

   The full matrix remains in the HTML and is the no-JavaScript fallback. On a
   phone, this module reveals a labeled selector and shows one estimation window
   at a time; wider layouts always restore all rows.
   ========================================================================== */

(function () {
  "use strict";

  var select = document.querySelector("[data-heatmap-select]");
  var rows = Array.prototype.slice.call(document.querySelectorAll("[data-heatmap-row]"));
  if (!select || !rows.length || !window.matchMedia) return;

  var control = select.closest(".hm-control");
  var compact = window.matchMedia("(max-width: 720px)");

  function render() {
    var isCompact = compact.matches;
    if (control) control.hidden = !isCompact;
    select.disabled = !isCompact;

    rows.forEach(function (row) {
      row.hidden = isCompact && row.getAttribute("data-heatmap-row") !== select.value;
    });
  }

  select.addEventListener("change", render);
  if (compact.addEventListener) compact.addEventListener("change", render);
  else if (compact.addListener) compact.addListener(render);
  render();
})();
