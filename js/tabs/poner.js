/**
 * tabs/poner.js -- Stow flow: scan item(s), scan shelf, confirm.
 *
 * IMPLEMENTATION CHOICE WORTH FLAGGING BACK: the original UX spec said
 * both "repeat-scan bumps qty" AND "shelf auto-focuses right after
 * scanning a product" -- those two are in tension (if the very first scan
 * instantly jumps to the shelf panel, there's no window left to repeat-
 * scan the same code for qty). Resolved here as: the Item panel keeps
 * accepting scans (repeat-scan of the SAME model-color bumps its qty; a
 * DIFFERENT one either replaces the current item, or -- with "Seleccionar
 * más" on -- gets added alongside it) until the associate explicitly
 * continues to the Shelf panel, either via the button or by switching
 * "Seleccionar más" back off after batching. No scan silently
 * auto-advances on its own. If this doesn't feel right once tested for
 * real, that's exactly the kind of thing to flag back.
 *
 * Every scan is resolved via api.js's resolveBarcode() first -- "the same
 * item" for repeat-scan/qty-bump purposes means the same (product,
 * color), matched via the resolved item's `key`, NOT the literal barcode
 * string. This means scanning two DIFFERENT sizes of the same model-color
 * back to back correctly bumps the same qty counter (this is the real
 * modelo-color-level behavior the plan describes) -- and each individual
 * scan's variantId still gets collected into scannedVariantIds, so the
 * optional precise layer (stock_placement_scans) ends up with the real
 * per-size breakdown even though the fast qty counter never needed it.
 */

const PonerTab = (function () {
  const itemScanner = new Scanner('ponerItemScanner');
  const shelfScanner = new Scanner('ponerShelfScanner');

  let currentItem = null; // { item: resolvedItem, qty, scannedVariantIds: string[] }
  let batch = []; // [{ item, qty, scannedVariantIds }] -- only used when "Seleccionar más" is on
  let busy = false; // guards against overlapping scans while resolveBarcode() is in flight

  const itemPanel = document.getElementById('ponerItemPanel');
  const shelfPanel = document.getElementById('ponerShelfPanel');
  const seleccionarMas = document.getElementById('ponerSeleccionarMas');
  const qtyInput = document.getElementById('ponerQty');
  const itemSummary = document.getElementById('ponerItemSummary');
  const batchListEl = document.getElementById('ponerBatchList');
  const continueBtn = document.getElementById('ponerContinueBtn');
  const backBtn = document.getElementById('ponerBackBtn');
  const shelfContentsEl = document.getElementById('ponerShelfContents');
  const recentEl = document.getElementById('ponerRecent');

  function resetItemState() {
    currentItem = null;
    batch = [];
    renderItemSummary();
    renderBatch();
  }

  function renderItemSummary() {
    itemSummary.textContent = currentItem ? (currentItem.item.displayLabel + ' -- cantidad: ' + currentItem.qty) : 'Escanea un artículo…';
    continueBtn.disabled = !currentItem && batch.length === 0;
  }

  function renderBatch() {
    batchListEl.innerHTML = '';
    batch.forEach(function (line) {
      const div = document.createElement('div');
      div.className = 'entry';
      div.textContent = line.item.displayLabel + ' × ' + line.qty;
      batchListEl.appendChild(div);
    });
  }

  async function onItemScan(code) {
    if (busy) return; // a resolveBarcode() call for a previous scan is still in flight -- ignore until it settles
    busy = true;
    try {
      const item = await resolveBarcode(code);
      if (currentItem && currentItem.item.key === item.key) {
        currentItem.qty += 1; // repeat-scan of the same model-color -- bump qty
        if (item.variantId) currentItem.scannedVariantIds.push(item.variantId);
      } else {
        // A different model-color showed up. If we're batching and had a
        // completed current item, park it in the batch before starting
        // the new one; otherwise (non-batch mode) the new scan just
        // replaces whatever was current.
        if (currentItem && seleccionarMas.checked) {
          batch.push(currentItem);
        }
        currentItem = {
          item: item,
          qty: Number(qtyInput.value) > 0 ? Number(qtyInput.value) : 1,
          scannedVariantIds: item.variantId ? [item.variantId] : [],
        };
      }
      renderItemSummary();
      renderBatch();
    } catch (e) {
      itemSummary.textContent = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  function finalizeBatchAndGoToShelf() {
    if (currentItem) {
      batch.push(currentItem);
      currentItem = null;
    }
    if (batch.length === 0) return;
    itemScanner.stop();
    itemPanel.classList.remove('active-panel');
    itemPanel.classList.add('hidden');
    shelfPanel.classList.remove('hidden');
    shelfPanel.classList.add('active-panel');
    shelfScanner.start(onShelfScan);
  }

  seleccionarMas.addEventListener('change', function () {
    // Toggling OFF after batching is the confirmed alternate trigger for
    // "done, move to shelf" -- matches the spec's own "scan a bunch, then
    // press it again [to turn it off]" description.
    if (!seleccionarMas.checked && (currentItem || batch.length > 0)) {
      finalizeBatchAndGoToShelf();
    }
  });

  continueBtn.addEventListener('click', finalizeBatchAndGoToShelf);

  async function onShelfScan(code) {
    await commitBatchToShelf(code);
  }

  async function commitBatchToShelf(locationCode) {
    shelfContentsEl.innerHTML = '<p class="hint">Guardando…</p>';
    try {
      for (const line of batch) {
        await stowItem({ item: line.item, locationCode: locationCode, qty: line.qty, scannedVariantIds: line.scannedVariantIds });
      }
    } catch (e) {
      shelfContentsEl.innerHTML = '<p class="hint" style="color:#e88">' + escapeHtml_(e.message) + '</p>';
      return;
    }
    renderShelfContents(locationCode);
    renderRecent();
    batch = [];
    renderBatch();
  }

  function renderShelfContents(locationCode) {
    const contents = getLocationContents(locationCode);
    let html = '<h3 style="margin:8px 0 4px">Contenido de ' + escapeHtml_(locationCode) + '</h3>';
    if (contents.length === 0) {
      html += '<p class="hint">Vacío (o backend real -- este resumen sólo funciona en modo mock por ahora, ver api.js).</p>';
    } else {
      contents.forEach(function (c) {
        html += '<div class="entry">' + escapeHtml_(c.displayLabel) + ' × ' + c.qty + '</div>';
      });
    }
    shelfContentsEl.innerHTML = html;
  }

  backBtn.addEventListener('click', async function () {
    await shelfScanner.stop();
    shelfPanel.classList.remove('active-panel');
    shelfPanel.classList.add('hidden');
    itemPanel.classList.remove('hidden');
    itemPanel.classList.add('active-panel');
    resetItemState();
    await itemScanner.start(onItemScan);
  });

  function renderRecent() {
    const recent = listRecentMovements(10);
    recentEl.innerHTML = '';
    if (recent.length === 0) {
      recentEl.innerHTML = '<p class="hint">Sin movimientos todavía.</p>';
      return;
    }
    recent.forEach(function (m) {
      const div = document.createElement('div');
      div.className = 'entry';
      const dirLabel = m.direction === 'in' ? 'Colocado' : 'Tomado';
      div.innerHTML = dirLabel + ': ' + escapeHtml_(m.displayLabel) + ' × ' + m.qty + ' en ' + escapeHtml_(m.locationCode)
        + '<div class="meta">' + m.reason + ' -- ' + new Date(m.createdAt).toLocaleTimeString() + '</div>';
      recentEl.appendChild(div);
    });
  }

  function escapeHtml_(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  return {
    show: function () {
      DebugLog.log('PonerTab.show() called');
      itemPanel.classList.add('active-panel');
      itemPanel.classList.remove('hidden');
      shelfPanel.classList.remove('active-panel');
      shelfPanel.classList.add('hidden');
      resetItemState();
      renderRecent();
      DebugLog.log('PonerTab.show() -- calling itemScanner.start()');
      itemScanner.start(onItemScan).catch(function (e) {
        DebugLog.logError('PonerTab.show() -> itemScanner.start()', e);
      });
    },
    hide: function () {
      DebugLog.log('PonerTab.hide() called');
      itemScanner.stop();
      shelfScanner.stop();
    },
  };
})();
