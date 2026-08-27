/**
 * tabs/contar.js -- location recount: scan the shelf, then scan every
 * item physically found in it (repeat-scan bumps qty, same convention as
 * Poner -- matched by resolved item `key`, i.e. model-color, not the
 * literal barcode, same reasoning as poner.js), then apply --
 * recountLocation() is authoritative for the whole location, so anything
 * not rescanned here gets implicitly corrected to zero server-side (see
 * almacen.rs::recount_location_core's own doc comment -- this tab is just
 * the UI for that same rule).
 */

const ContarTab = (function () {
  const shelfScanner = new Scanner('contarShelfScanner');
  const itemScanner = new Scanner('contarItemScanner');

  const shelfPanel = document.getElementById('contarShelfPanel');
  const itemsPanel = document.getElementById('contarItemsPanel');
  const countedListEl = document.getElementById('contarCountedList');
  const applyBtn = document.getElementById('contarApplyBtn');
  const cancelBtn = document.getElementById('contarCancelBtn');
  const resultEl = document.getElementById('contarResult');

  let currentLocationCode = null;
  let counted = {}; // key -> { item: resolvedItem, qty }
  let busy = false;

  function renderCounted() {
    countedListEl.innerHTML = '';
    const keys = Object.keys(counted);
    if (keys.length === 0) {
      countedListEl.innerHTML = '<p class="hint">Nada escaneado todavía.</p>';
      return;
    }
    keys.forEach(function (key) {
      const div = document.createElement('div');
      div.className = 'entry';
      div.textContent = counted[key].item.displayLabel + ' × ' + counted[key].qty;
      countedListEl.appendChild(div);
    });
  }

  async function onShelfScan(code) {
    currentLocationCode = code;
    counted = {};
    await shelfScanner.stop();
    shelfPanel.classList.add('hidden');
    shelfPanel.classList.remove('active-panel');
    itemsPanel.classList.remove('hidden');
    itemsPanel.classList.add('active-panel');
    resultEl.innerHTML = '';
    renderCounted();
    await itemScanner.start(onItemScan);
  }

  async function onItemScan(code) {
    if (busy) return;
    busy = true;
    try {
      const item = await resolveBarcode(code);
      if (counted[item.key]) {
        counted[item.key].qty += 1;
      } else {
        counted[item.key] = { item: item, qty: 1 };
      }
      renderCounted();
    } catch (e) {
      countedListEl.innerHTML = '<p class="hint" style="color:#e88">' + escapeHtml_(e.message) + '</p>';
    } finally {
      busy = false;
    }
  }

  applyBtn.addEventListener('click', async function () {
    await itemScanner.stop();
    const lines = Object.keys(counted).map(function (key) { return { item: counted[key].item, qty: counted[key].qty }; });
    resultEl.innerHTML = '<p class="hint">Aplicando…</p>';
    try {
      const result = await recountLocation({ locationCode: currentLocationCode, counted: lines });
      renderResult(result.variances);
    } catch (e) {
      resultEl.innerHTML = '<p class="hint" style="color:#e88">' + escapeHtml_(e.message) + '</p>';
    }
  });

  function renderResult(variances) {
    if (variances.length === 0) {
      resultEl.innerHTML = '<p class="hint" style="color:#8e8">Todo coincide -- sin diferencias.</p>';
    } else {
      let html = '<h3 style="margin:8px 0 4px">Diferencias encontradas</h3>';
      variances.forEach(function (v) {
        // Real backend only returns product_id/color_seq, no display
        // label (see api.js's own note) -- fall back to whatever we had
        // on hand from the counted set for that key, since we scanned it
        // ourselves this same session; only a truly implicit-zeroed line
        // (something the system had on record that we never rescanned at
        // all) has no local label to fall back to.
        const label = (counted[v.key] && counted[v.key].item.displayLabel) || v.displayLabel || v.key;
        html += '<div class="entry variance-row">' + escapeHtml_(label) + ': se esperaban ' + v.expected + ', se encontraron ' + v.found + '</div>';
      });
      // §16 of the plan: real variance flagging goes to
      // notifications/owner_notifications server-side once that framework
      // exists -- this build only ever shows it locally, right here,
      // right now.
      resultEl.innerHTML = html;
    }
    resetToShelfPanel();
  }

  cancelBtn.addEventListener('click', async function () {
    await itemScanner.stop();
    resetToShelfPanel();
  });

  function resetToShelfPanel() {
    itemsPanel.classList.add('hidden');
    itemsPanel.classList.remove('active-panel');
    shelfPanel.classList.remove('hidden');
    shelfPanel.classList.add('active-panel');
    currentLocationCode = null;
    counted = {};
    shelfScanner.start(onShelfScan);
  }

  function escapeHtml_(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  return {
    show: function () {
      resultEl.innerHTML = '';
      resetToShelfPanel();
    },
    hide: function () {
      shelfScanner.stop();
      itemScanner.stop();
    },
  };
})();
