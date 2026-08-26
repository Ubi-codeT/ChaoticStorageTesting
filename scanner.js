/**
 * scanner.js -- thin wrapper around html5-qrcode for programmatic
 * start/stop control, embedded into custom UI (unlike the GAS PoC, which
 * used the library's pre-built Html5QrcodeScanner widget -- that widget
 * renders its own start/stop/camera-picker chrome, which is great for a
 * single-purpose test page but wrong for embedding a scanner into three
 * different tabs of a real app with our own surrounding UI).
 *
 * Version pinned deliberately (not @latest) -- see CameraScanPoC.gs's own
 * header comment for exactly why that matters; that lesson carries over
 * here unchanged.
 *
 * IMPORTANT LIFECYCLE RULE: only one Scanner instance may have an active
 * camera stream at a time across the whole app. app.js's tab-switching
 * logic is responsible for calling .stop() on whatever scanner was
 * running before showing a different tab -- this file does not enforce
 * that itself, it just does what it's told.
 */

class Scanner {
  /**
   * @param {string} elementId - id of an empty <div> the camera view renders into.
   * @param {object} opts
   * @param {number} [opts.cooldownMs] - minimum time before the SAME code
   *   is accepted again. This is the single most important tunable in this
   *   whole file -- a camera sees the same code on every decoded frame
   *   while it's in view (see the GAS PoC's own comment on why), so
   *   without this, holding the phone over one barcode for two seconds
   *   would fire dozens of times. 1200ms is a starting guess, not a
   *   validated number -- adjust based on what actually feels right once
   *   this is being tested on a real phone against real product labels.
   */
  constructor(elementId, opts) {
    opts = opts || {};
    this.elementId = elementId;
    this.cooldownMs = opts.cooldownMs !== undefined ? opts.cooldownMs : 1200;
    // Guarded: if the CDN script failed to load, Html5QrcodeSupportedFormats
    // won't exist, and referencing it here would throw at CONSTRUCTION time
    // -- which runs at page load for every tab (each tab file creates its
    // Scanner instances immediately), so one CDN failure would silently
    // break the ENTIRE app (tab switching included), not just camera
    // features. Deferring the failure to .start() instead -- which already
    // catches errors and writes them visibly into the scanner element --
    // means everything else still works even if scanning itself can't.
    this.formats = opts.formats || (typeof Html5QrcodeSupportedFormats !== 'undefined' ? [
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.CODE_39,
    ] : []);
    this.html5Qrcode = null;
    this.lastByCode = {};
    this.running = false;
  }

  /**
   * @param {(code: string, format: string) => void} onScan
   */
  async start(onScan) {
    if (this.running) {
      DebugLog.log('Scanner.start(' + this.elementId + ') -- already running, no-op');
      return;
    }
    DebugLog.log('Scanner.start(' + this.elementId + ') -- begin');
    const el = document.getElementById(this.elementId);
    if (!el) {
      DebugLog.log('Scanner.start(' + this.elementId + ') -- ELEMENT NOT FOUND');
      throw new Error('Scanner: no element with id ' + this.elementId);
    }
    el.classList.remove('hidden');

    const config = { fps: 10, qrbox: { width: 260, height: 140 } };

    try {
      DebugLog.log('Scanner.start(' + this.elementId + ') -- constructing Html5Qrcode');
      this.html5Qrcode = new Html5Qrcode(this.elementId, { formatsToSupport: this.formats, verbose: false });
      DebugLog.log('Scanner.start(' + this.elementId + ') -- calling html5Qrcode.start() (this is what should trigger the permission prompt)');
      await this.html5Qrcode.start(
        { facingMode: 'environment' },
        config,
        (decodedText, decodedResult) => {
          const now = performance.now();
          const lastAt = this.lastByCode[decodedText];
          if (lastAt !== undefined && (now - lastAt) < this.cooldownMs) {
            return; // still cooling down on this exact code
          }
          this.lastByCode[decodedText] = now;
          const format = (decodedResult && decodedResult.result && decodedResult.result.format && decodedResult.result.format.formatName) || '?';
          DebugLog.log('Scanner(' + this.elementId + ') -- decoded', { code: decodedText, format: format });
          beep_();
          onScan(decodedText, format);
        },
        function onFrameFailure() {
          // Fires continuously for "no code in this frame" -- expected,
          // deliberately not logged (would spam every frame).
        }
      );
      this.running = true;
      DebugLog.log('Scanner.start(' + this.elementId + ') -- SUCCESS, camera running');
    } catch (e) {
      // e.name here is the single most diagnostic thing in this whole
      // file -- NotAllowedError means permission was denied (possibly
      // silently, if this origin already has "denied" recorded from
      // testing the earlier broken version -- browsers don't re-prompt
      // in that case, they just reject immediately, which is
      // indistinguishable from "nothing happened" without this log).
      // NotFoundError means no camera device was found at all.
      DebugLog.logError('Scanner.start(' + this.elementId + ')', e);
      el.textContent = 'No se pudo abrir la cámara: ' + (e && e.message ? e.message : e) + (e && e.name ? ' [' + e.name + ']' : '');
      throw e;
    }
  }

  async stop() {
    if (!this.running || !this.html5Qrcode) return;
    try {
      await this.html5Qrcode.stop();
      this.html5Qrcode.clear();
    } catch (e) {
      // Already stopped/torn down -- non-fatal either way, we're trying
      // to reach "definitely not running" regardless of how we got here.
    }
    this.running = false;
    this.html5Qrcode = null;
  }
}

function beep_() {
  // Same short Web Audio tone as both earlier PoCs -- no external sound
  // file needed. Kept here (not per-tab) so every scan across the whole
  // app sounds identical.
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) { /* non-fatal -- some browsers refuse AudioContext before a user gesture */ }
}
