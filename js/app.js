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

// BUG FOUND AND FIXED: this used to read window.BuscarTab/window.PonerTab/
// etc. Each tabs/*.js file exports with `const XTab = (...)();` -- and
// `const`/`let` at a classic <script>'s top level deliberately never
// attach to `window` (that's the whole point of `const` over `var`, by
// ES6 design). The bare identifiers (BuscarTab, PonerTab, ...) ARE shared
// correctly across <script> tags in the same document though -- which is
// exactly why Pairing.init() worked fine two lines below this while this
// object was silently building itself full of undefined -- app.js calls
// `Pairing.init()` by its bare name, never `window.Pairing`. Same fix
// applies here: reference the bare names directly.
const TABS = {
  buscar: BuscarTab,
  poner: PonerTab,
  foto: FotoTab,
  contar: ContarTab,
};

// If any tab module's own IIFE threw an error while loading (e.g. a typo,
// a missing element it expected to find), window.XTab would simply never
// get assigned -- and TABS[name] && TABS[name].show below would then just
// silently skip calling show() with NO error at all. Checking for that
// explicitly here rather than letting it fail silently.
Object.keys(TABS).forEach(function (key) {
  DebugLog.log('TABS.' + key + ' registered?', !!TABS[key]);
  if (!TABS[key]) {
    DebugLog.log('WARNING: window.' + key.charAt(0).toUpperCase() + key.slice(1) + 'Tab is undefined -- that tab\'s own script likely threw an error while loading. Check above in this log for an earlier error from that file.');
  }
});

let currentTab = null;

function switchTab(name) {
  DebugLog.log('switchTab called', name);
  if (name === currentTab) {
    DebugLog.log('switchTab -- already on this tab, no-op');
    return;
  }
  if (currentTab && TABS[currentTab] && TABS[currentTab].hide) {
    DebugLog.log('switchTab -- hiding previous tab', currentTab);
    TABS[currentTab].hide();
  }
  document.querySelectorAll('.tab-section').forEach(function (el) { el.classList.add('hidden'); });
  document.querySelectorAll('.nav-btn').forEach(function (el) { el.classList.toggle('active', el.dataset.tab === name); });

  document.getElementById('tab-' + name).classList.remove('hidden');
  currentTab = name;
  if (TABS[name] && TABS[name].show) {
    DebugLog.log('switchTab -- calling show() for', name);
    TABS[name].show();
  } else {
    DebugLog.log('switchTab -- NO show() to call for ' + name + ' (module missing or has no show method)');
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

DebugLog.log('app.js -- calling Pairing.init()');
try {
  Pairing.init();
  DebugLog.log('app.js -- Pairing.init() done, calling switchTab(buscar)');
} catch (e) {
  DebugLog.logError('Pairing.init()', e);
  DebugLog.log('app.js -- Pairing.init() THREW -- calling switchTab(buscar) anyway so the app doesn\'t stay fully blank');
}
switchTab('buscar');
DebugLog.log('app.js -- init sequence complete');