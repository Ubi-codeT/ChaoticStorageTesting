/**
 * debug.js -- TEMPORARY diagnostic tooling, loaded first, before
 * everything else. Exists purely to answer "why isn't the camera
 * prompting" without needing USB-cable console access on the phone
 * itself -- every log line shows up directly on the page.
 *
 * Remove this file (and the panel it renders) once camera scanning is
 * confirmed working reliably -- it's not meant to ship long-term, it's
 * scaffolding for exactly this debugging session.
 */

const DebugLog = (function () {
  const lines = [];

  function render() {
    const panel = document.getElementById('debugLogPanel');
    if (!panel) return; // panel not in the DOM yet -- render() gets called again once it is
    panel.textContent = lines.join('\n');
    panel.scrollTop = panel.scrollHeight;
  }

  function log(msg, data) {
    const ts = new Date().toISOString().split('T')[1].replace('Z', '');
    let line = '[' + ts + '] ' + msg;
    if (data !== undefined) {
      try { line += ' :: ' + JSON.stringify(data); }
      catch (e) { line += ' :: (no serializable, ' + String(data) + ')'; }
    }
    lines.push(line);
    // Also to the real console, for anyone who DOES have it open.
    console.log(line);
    render();
  }

  function logError(context, err) {
    log('ERROR in ' + context, {
      name: err && err.name,
      message: err && err.message,
      stack: err && err.stack ? String(err.stack).split('\n').slice(0, 3).join(' | ') : undefined,
    });
  }

  return { log: log, logError: logError, render: render };
})();

// Catch anything uncaught, anywhere -- a safety net in case something
// throws outside the specific spots already wrapped with DebugLog calls.
// Capture phase (the `true` below) matters here: resource-load failures
// (a <script src> 404ing, for example) fire an `error` event that does
// NOT bubble, so a normal bubble-phase listener never sees them -- which
// is exactly the gap that let js/tabs/*.js fail silently before this was
// added. Capture-phase listeners on window DO see those.
window.addEventListener('error', function (e) {
  if (e.target && e.target !== window && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK' || e.target.tagName === 'IMG')) {
    DebugLog.log('RESOURCE LOAD FAILED', { tag: e.target.tagName, src: e.target.src || e.target.href });
    return;
  }
  DebugLog.log('window.onerror', { message: e.message, filename: e.filename, lineno: e.lineno });
}, true);
window.addEventListener('unhandledrejection', function (e) {
  DebugLog.log('unhandledrejection', { reason: e.reason && (e.reason.message || String(e.reason)) });
});

// ---- Environment/capability dump -- runs immediately, before anything
// tries to touch the camera. This is the single most useful section --
// it answers most of "why isn't this working" before we even get to the
// scanner code. ----
(function envDump() {
  // Bump this string every time this file changes and gets redeployed --
  // the fastest possible check for "am I actually looking at fresh code
  // or a cached/stale page" the next time something looks wrong. If a
  // reported log doesn't show the version you just pushed, that's a
  // caching problem, not a code problem.
  DebugLog.log('DEBUG BUILD', '2026-08-26-d (TABS bare-identifier fix)');
  DebugLog.log('debug.js loaded');
  DebugLog.log('location', { href: location.href, protocol: location.protocol });
  DebugLog.log('isSecureContext', window.isSecureContext);
  DebugLog.log('userAgent', navigator.userAgent);
  DebugLog.log('typeof Html5Qrcode', typeof window.Html5Qrcode);
  DebugLog.log('typeof Html5QrcodeSupportedFormats', typeof window.Html5QrcodeSupportedFormats);
  DebugLog.log('navigator.mediaDevices exists', !!navigator.mediaDevices);
  DebugLog.log('getUserMedia exists', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));

  // THE single most likely culprit given "no prompt, no visible error":
  // if this origin already has camera permission recorded as "denied"
  // (e.g. from testing the earlier broken version), the browser will
  // never show a prompt again -- it just silently refuses, every time,
  // until the site's permission is manually reset in browser settings.
  // "granted"/"denied" here means something already decided this before
  // we even asked; "prompt" means it SHOULD still ask normally.
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'camera' })
      .then(function (status) {
        DebugLog.log('camera permission state', status.state);
        status.onchange = function () { DebugLog.log('camera permission state CHANGED', status.state); };
      })
      .catch(function (e) { DebugLog.logError('permissions.query(camera)', e); });
  } else {
    DebugLog.log('navigator.permissions.query not supported on this browser -- cannot check state ahead of time');
  }

  // Second most useful check: does this device even report a camera at
  // all? An empty list here means getUserMedia will fail with
  // NotFoundError regardless of permission.
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices()
      .then(function (devices) {
        const cams = devices.filter(function (d) { return d.kind === 'videoinput'; });
        DebugLog.log('videoinput devices found', cams.length);
        cams.forEach(function (c, i) {
          // label is usually blank until permission is granted at least
          // once -- an empty label is normal/expected before that, not a bug.
          DebugLog.log('  camera ' + i, { label: c.label || '(sin nombre -- normal antes de dar permiso)', deviceId: c.deviceId ? c.deviceId.slice(0, 8) + '…' : null });
        });
      })
      .catch(function (e) { DebugLog.logError('enumerateDevices', e); });
  }
})();