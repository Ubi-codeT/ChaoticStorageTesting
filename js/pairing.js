/**
 * pairing.js -- phone identity, per CHAOTIC_STORAGE_PLAN.md §3.2.
 *
 * NOT REAL YET -- this is client-side mechanics only:
 *   - reading a token/user/branch out of the URL (what scanning the real
 *     QR code from "Turnos y Caja" would produce once that screen exists)
 *   - remembering it in localStorage across visits (confirmed: once per
 *     device, this phone belongs to one person)
 *   - a banner showing who/where you're paired as
 *
 * What's MISSING, on purpose, until the Supabase side exists: this never
 * actually validates the token against a real `phone_sessions` row, never
 * checks `expires_at`/`revoked` server-side, and never confirms the token
 * hasn't been superseded by a newer one for the same user. Every one of
 * those checks belongs INSIDE the SECURITY DEFINER RPCs on the Supabase
 * side (see CHAOTIC_STORAGE_PLAN.md §3.2 and
 * supabase/0038_stock_movement_rpc_hardening.sql for the shape that
 * validation needs to take) -- never trust anything this file says about
 * "am I paired" as real security, it's UI convenience only, exactly the
 * same posture this project's own Session/SessionPublic split already
 * uses on the desktop app (see state.rs's own comments on that).
 */

const Pairing = (function () {
  const STORAGE_KEY = 'chaotic_storage_pairing_v1';

  function readFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('pair');
    if (!token) return null;
    return {
      token: token,
      userName: params.get('user') || '(sin nombre)',
      branchName: params.get('branch') || '(sin sucursal)',
      branchId: params.get('branchId') || null,
      // Real expiry comes from the server (phone_sessions.expires_at, 4h
      // from issue per the confirmed reminder-window decision elsewhere
      // in this project). Stamping a LOCAL 4h clock here too so the UI
      // banner can at least show "hace X" / prompt a re-scan on its own,
      // even though the real enforcement is server-side regardless.
      pairedAt: new Date().toISOString(),
    };
  }

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  function save(session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  function clear() {
    localStorage.removeItem(STORAGE_KEY);
  }

  function init() {
    const fromUrl = readFromUrl();
    if (fromUrl) {
      save(fromUrl);
      // Strip the pairing params from the visible URL so they don't sit
      // in browser history / get accidentally shared via a copied link --
      // same reasoning Manifest.gs/Upload.gs's own token-in-URL handling
      // never had to deal with (those tokens are typed once into the app
      // settings, not carried in a shareable link).
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    }
    render();
  }

  function render() {
    const banner = document.getElementById('pairingBanner');
    const session = load();
    if (!session) {
      banner.textContent = 'Sin vincular -- toca para escanear tu código QR en Turnos y Caja.';
      banner.className = 'pairing-banner unpaired';
      return;
    }
    banner.textContent = 'Vinculado: ' + session.userName + ' @ ' + session.branchName + ' (toca para cambiar)';
    banner.className = 'pairing-banner paired';
  }

  function showRepairPrompt() {
    const session = load();
    const msg = session
      ? '¿Olvidar la sesión actual (' + session.userName + ' @ ' + session.branchName + ')? Tendrás que escanear tu QR de nuevo.'
      : 'Escanea tu código QR desde Turnos y Caja en la PC para vincular este teléfono.';
    if (session && confirm(msg)) {
      clear();
      render();
    } else if (!session) {
      alert(msg);
    }
  }

  function getSession() {
    return load();
  }

  return { init: init, getSession: getSession, showRepairPrompt: showRepairPrompt };
})();
