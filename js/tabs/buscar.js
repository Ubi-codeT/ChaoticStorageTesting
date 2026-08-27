/**
 * tabs/buscar.js -- search by typing or scanning; results ranked by qty
 * in mock mode (the real backend ranks by proximity through the bodega
 * hierarchy first, per §3.5 of the plan -- that signal doesn't exist in
 * the flat local mock store, see api.js's own note on this).
 *
 * Typed search is inherently different from scanned search: a scan
 * resolves to one exact model-color via resolveBarcode(). Typed text has
 * no such resolution available (no product-name-search RPC exists yet --
 * see the note in runSearchByText below) -- so for now, typed input only
 * produces useful results in mock mode (where it's treated as a synthetic
 * identity, same as a scan would be). Flagged clearly in the UI in real
 * mode rather than silently returning nothing.
 */

const BuscarTab = (function () {
  const scanner = new Scanner('buscarScanner');
  const input = document.getElementById('buscarInput');
  const scanBtn = document.getElementById('buscarScanBtn');
  const scannerWrap = document.getElementById('buscarScannerWrap');
  const cancelBtn = document.getElementById('buscarScanCancel');
  const otrasSucursales = document.getElementById('buscarOtrasSucursales');
  const resultsEl = document.getElementById('buscarResults');

  async function runSearchByScan(code) {
    resultsEl.innerHTML = '<p class="hint">Buscando…</p>';
    try {
      const item = await resolveBarcode(code);
      const results = await searchItem({ item: item, includeOtherBranches: otrasSucursales.checked });
      renderResults(item.displayLabel, results);
    } catch (e) {
      resultsEl.innerHTML = '<p class="hint" style="color:#e88">' + escapeHtml_(e.message) + '</p>';
    }
  }

  async function runSearchByText(text) {
    if (!text || !text.trim()) return;
    resultsEl.innerHTML = '<p class="hint">Buscando…</p>';
    if (!MOCK_BACKEND) {
      // No product-name-search RPC exists yet (only resolve_barcode, which
      // needs an exact barcode, not free text) -- rather than pretend this
      // works, say so plainly. Scanning still works fine in real mode.
      resultsEl.innerHTML = '<p class="hint" style="color:#e88">La búsqueda por texto todavía no está conectada al backend real -- usa "Escanear" por ahora.</p>';
      return;
    }
    try {
      const item = await resolveBarcode(text.trim()); // mock mode only -- synthetic identity from raw text
      const results = await searchItem({ item: item, includeOtherBranches: otrasSucursales.checked });
      renderResults(item.displayLabel, results);
    } catch (e) {
      resultsEl.innerHTML = '<p class="hint" style="color:#e88">' + escapeHtml_(e.message) + '</p>';
    }
  }

  function renderResults(label, results) {
    if (results.length === 0) {
      resultsEl.innerHTML = '<p class="hint">Sin ubicaciones registradas para "' + escapeHtml_(label) + '".</p>';
      return;
    }
    let html = '<p class="hint">' + escapeHtml_(label) + '</p>';
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
    if (e.key === 'Enter') runSearchByText(input.value);
  });

  scanBtn.addEventListener('click', async function () {
    scannerWrap.classList.remove('hidden');
    await scanner.start(async function (code) {
      input.value = code;
      await scanner.stop();
      scannerWrap.classList.add('hidden');
      runSearchByScan(code);
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
