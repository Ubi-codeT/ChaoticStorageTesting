/**
 * app.js -- tab routing + lifecycle. Kept deliberately dumb: shows/hides
 * <section> elements and calls each tab module's show()/hide(), nothing
 * fancier (no client-side router library, no animations, per the
 * project's own "practicality over polish" instruction).
 *
 * THE ONE RULE THIS FILE ENFORCES: only one tab's camera may be running
 * at a time. Every tab module MUST stop its own Scanner instance(s) inside
 * hide() -- this file calls hide() on the outgoing tab before show() on
 * the incoming one, every single time, no exceptions, so a stale camera
 * stream never keeps running in the background eating battery/holding the
 * hardware lock (the exact class of bug that made the original GAS PoC
 * "bug out and not reopen the camera").
 */

const TABS = {
  buscar: window.BuscarTab,
  poner: window.PonerTab,
  foto: window.FotoTab,
  contar: window.ContarTab,
};

let currentTab = null;

function switchTab(name) {
  if (name === currentTab) return;
  if (currentTab && TABS[currentTab] && TABS[currentTab].hide) {
    TABS[currentTab].hide();
  }
  document.querySelectorAll('.tab-section').forEach(function (el) { el.classList.add('hidden'); });
  document.querySelectorAll('.nav-btn').forEach(function (el) { el.classList.toggle('active', el.dataset.tab === name); });

  document.getElementById('tab-' + name).classList.remove('hidden');
  currentTab = name;
  if (TABS[name] && TABS[name].show) {
    TABS[name].show();
  }
}

document.querySelectorAll('.nav-btn').forEach(function (btn) {
  btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
});

// Stop whatever camera is running if the page is backgrounded/closed --
// belt-and-suspenders on top of the tab-switch discipline above, since a
// phone locking or the browser being swiped away doesn't go through
// switchTab at all.
document.addEventListener('visibilitychange', function () {
  if (document.hidden && currentTab && TABS[currentTab] && TABS[currentTab].hide) {
    TABS[currentTab].hide();
  }
});

Pairing.init();
switchTab('buscar');
