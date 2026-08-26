/**
 * tabs/buscar.js -- search by typing or scanning; results ranked by qty
 * in this mock build (the real backend ranks by proximity through the
 * bodega hierarchy first, per §3.5 of the plan -- that signal doesn't
 * exist in the flat local mock store, see api.js's own note on this).
 */

const BuscarTab = (function () {
  const scanner = new Scanner('buscarScanner');
  const input = document.getElementById('buscarInput');
  const scanBtn = document.getElementById('buscarScanBtn');
  const scannerWrap = document.getElementById('buscarScannerWrap');
  const cancelBtn = document.getElementById('buscarScanCancel');
  const otrasSucursales = document.getElementById('buscarOtrasSucursales');
  const resultsEl = document.getElementById('buscarResults');

  async function runSearch(code) {
    if (!code || !code.trim()) return;
    resultsEl.innerHTML = '<p class="hint">Buscando…</p>';
    const results = await searchItem({ itemCode: code.trim(), includeOtherBranches: otrasSucursales.checked });
    renderResults(code.trim(), results);
  }

  function renderResults(code, results) {
    if (results.length === 0) {
      resultsEl.innerHTML = '<p class="hint">Sin ubicaciones registradas para "' + escapeHtml_(code) + '".</p>';
      return;
    }
    let html = '';
    results.forEach(function (r) {
      html += '<div class="entry"><strong>' + escapeHtml_(r.locationCode) + '</strong> -- ' + r.qty + ' pza(s)</div>';
    });
    resultsEl.innerHTML = html;
  }

  function escapeHtml_(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') runSearch(input.value);
  });

  scanBtn.addEventListener('click', async function () {
    scannerWrap.classList.remove('hidden');
    await scanner.start(async function (code) {
      input.value = code;
      await scanner.stop();
      scannerWrap.classList.add('hidden');
      runSearch(code);
    });
  });

  cancelBtn.addEventListener('click', async function () {
    await scanner.stop();
    scannerWrap.classList.add('hidden');
  });

  return {
    show: function () {
      resultsEl.innerHTML = '';
    },
    hide: function () {
      scanner.stop();
      scannerWrap.classList.add('hidden');
    },
  };
})();
