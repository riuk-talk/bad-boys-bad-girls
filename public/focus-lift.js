// WCAG 2.4.11 (focus not obscured): what takes the focus under the sticky tab bar of the member
// pages ([data-tab-bar]) is brought above it, by exactly the part it hides.
//
// Loaded by the root layout as a plain script, so it works from the first moment of every page,
// before React hydrates (CI n° 117: WebKit reveals a textarea's caret just at the bottom of the
// screen, under the bar, ignoring scroll-padding and scroll-margin; on a slow page nothing was
// there yet to lift it). Installed once per document: client-side navigation keeps it.
//
// WebKit runs its own focus scroll after the event, at a moment that varies, so the focused
// element is checked at every frame for 600 ms. Focus that enters an iframe (the Turnstile
// widget, CI n° 116) gives the page no focusin: the window loses the focus instead, and the element
// holding the iframe is checked the same way. Leaving the window for another one changes nothing.
(function () {
  if (window.__focusLift) return;
  window.__focusLift = true;

  var watched = null;
  var until = 0;
  var frame = 0;

  function lift(target) {
    var bar = document.querySelector("[data-tab-bar]");
    if (!bar || bar.contains(target) || !target.isConnected) return;
    var hidden = target.getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
    if (hidden > 0) window.scrollBy(0, hidden + 8);
  }

  function tick() {
    frame = 0;
    if (!watched || document.activeElement !== watched || performance.now() > until) return;
    lift(watched);
    frame = requestAnimationFrame(tick);
  }

  function watch(target) {
    watched = target;
    until = performance.now() + 600;
    lift(target);
    if (!frame) frame = requestAnimationFrame(tick);
  }

  document.addEventListener("focusin", function (event) {
    if (event.target instanceof HTMLElement) watch(event.target);
  });

  window.addEventListener("blur", function () {
    requestAnimationFrame(function () {
      var active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      if (active.tagName === "IFRAME" || active.closest("[data-captcha-widget]")) watch(active);
    });
  });
})();
