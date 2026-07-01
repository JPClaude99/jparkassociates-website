/* ============================================================
   J PARK & ASSOCIATES — shared nav sidebar (subpages)
   The homepage's sidebar is driven from scroll-cinematic.js so it
   can coordinate with Lenis and the cinematic snap lock; every other
   page loads this standalone controller instead. Keep the behavior
   in sync with initSidebar() there.
   ============================================================ */
(function () {
  "use strict";

  var toggle = document.getElementById("nav-toggle");
  var sidebar = document.getElementById("sidebar");
  var scrim = document.getElementById("sidebar-scrim");
  var closeBtn = document.getElementById("sidebar-close");
  if (!toggle || !sidebar || !scrim) return;

  var isOpen = false;
  var lastFocus = null;

  function focusable() {
    return [].slice.call(sidebar.querySelectorAll("a[href], button"));
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    lastFocus = document.activeElement;
    sidebar.classList.add("is-open");
    scrim.classList.add("is-open");
    toggle.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    sidebar.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    var f = closeBtn || focusable()[0];
    if (f) f.focus();
  }

  function close(restoreFocus) {
    if (!isOpen) return;
    isOpen = false;
    sidebar.classList.remove("is-open");
    scrim.classList.remove("is-open");
    toggle.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    sidebar.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
    if (restoreFocus !== false && lastFocus) lastFocus.focus();
  }

  toggle.addEventListener("click", function () { isOpen ? close() : open(); });
  scrim.addEventListener("click", function () { close(); });
  if (closeBtn) closeBtn.addEventListener("click", function () { close(); });

  /* Navigating away closes the menu; don't yank focus back mid-navigation. */
  sidebar.querySelectorAll("a[href]").forEach(function (a) {
    a.addEventListener("click", function () { close(false); });
  });

  document.addEventListener("keydown", function (e) {
    if (!isOpen) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") {
      var f = focusable();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
})();
