/**
 * api.js -- THE ONLY FILE that talks to Supabase. Every tab calls
 * functions from here, never fetch() directly -- that's what keeps "wire
 * in the real backend" a change to ONE file instead of a hunt through
 * every tab.
 *
 * MOCK_BACKEND auto-detects: true whenever SUPABASE_URL/SUPABASE_ANON_KEY
 * are blank, false once both are filled in. Deliberately NOT a manual
 * on/off flag -- shipping an update with real credentials already filled
 * in but the flag still set to mock (or vice versa) is exactly the kind
 * of footgun an auto-detect avoids.
 *
 * ---------------------------------------------------------------------
 * TO GO LIVE: fill in SUPABASE_URL and SUPABASE_ANON_KEY below, then
 * deploy supabase/0075_phone_rpcs.sql (+ 0074/0076, its own
 * dependencies) to your Supabase project first -- these calls will fail
 * immediately/loudly if the RPCs don't exist yet, which is much better
 * than the old placeholder throw-a-generic-error behavior.
 *
 * The anon key is SAFE to put here -- it's meant to be public; every real
 * check happens inside the RPC functions server-side (SECURITY DEFINER +
 * phone_sessions token validation), same as this project's desktop app
 * already works. See the repo README's "Do's and Don'ts" for the full
 * reasoning -- do NOT put the Supabase service-role key here, ever.
 * ---------------------------------------------------------------------
 *
 * UNIFIED ITEM IDENTITY: every function below that deals with "an item"
 * takes/returns a *resolved item* object, not a raw scanned barcode
 * string:
 *   { key, productId, colorSeq, variantId, displayLabel }
 * `key` is what stow/pick/recount/search actually group and match on
 * (see resolveBarcode's own comment for what it is in each mode). This
 * shape is identical in both mock and real mode specifically so nothing
 * above this file (the tab modules) needs to know or care which mode is
 * active -- they always call resolveBarcode() first, then pass the
 * result everywhere else.
 */

const SUPABASE_URL = ''; // e.g. https://xxxx.supabase.co -- blank = mock mode
const SUPABASE_ANON_KEY = ''; // blank = mock mode

const MOCK_BACKEND = !SUPABASE_URL || !SUPABASE_ANON_KEY;

function currentSessionToken() {
  const session = Pairing.getSession();
  if (!session || !session.token) {
    throw new Error('Vincula tu teléfono primero (escanea tu código QR en Turnos y Caja).');
  }
  return session.token;
}

async function callRpc(fnName, params) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fnName, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    // PostgREST puts a raised PL/pgSQL exception's message in .message --
    // that's the actual Spanish error text from the RPC (e.g. "Sólo hay 3
    // en esa ubicación..."), worth surfacing directly rather than a
    // generic "request failed".
    let detail = '';
    try {
      const body = await res.json();
      detail = body && body.message ? body.message : JSON.stringify(body);
    } catch (e) {
      detail = await res.text();
    }
    throw new Error(detail || ('RPC ' + fnName + ' failed (' + res.status + ')'));
  }
  return res.json();
}

// ---- Mock local store --------------------------------------------------

const MOCK_KEY = 'chaotic_storage_mock_v1';

function loadMock() {
  try {
    return JSON.parse(localStorage.getItem(MOCK_KEY)) || { placements: [], movements: [] };
  } catch (e) {
    return { placements: [], movements: [] };
  }
}

function saveMock(store) {
  localStorage.setItem(MOCK_KEY, JSON.stringify(store));
}

function findPlacement(store, key, locationCode) {
  return store.placements.find(function (p) { return p.key === key && p.locationCode === locationCode; });
}

function pushMovement(store, entry) {
  entry.id = 'mock-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  entry.createdAt = new Date().toISOString();
  store.movements.unshift(entry);
  store.movements = store.movements.slice(0, 50); // keep the mock store from growing forever
  return entry;
}

// ---- Item identity resolution -------------------------------------------

/**
 * @param {string} barcode - the raw scanned code.
 * @returns {Promise<{key: string, productId: string|null, colorSeq: number|null, variantId: string|null, displayLabel: string}>}
 */
async function resolveBarcode(barcode) {
  if (MOCK_BACKEND) {
    // Synthetic identity: the raw barcode stands in for a real
    // (product_id, color_seq) pair, since there's no product catalog
    // available client-side to resolve against in mock mode. `key` still
    // works the same way it does in real mode (grouping/matching), it's
    // just built from the raw code instead of a real UUID pair.
    return {
      key: barcode, productId: null, colorSeq: null, variantId: null, displayLabel: barcode,
    };
  }
  const rows = await callRpc('resolve_barcode', { p_session_token: currentSessionToken(), p_barcode: barcode });
  const r = rows[0];
  if (!r) throw new Error('Código no reconocido: ' + barcode);
  return {
    key: r.product_id + '::' + r.color_seq,
    productId: r.product_id,
    colorSeq: r.color_seq,
    variantId: r.variant_id,
    displayLabel: r.style_name + ' -- ' + r.real_color + ' (' + r.size_label + ')',
  };
}

// ---- Public API ----------------------------------------------------------

/**
 * @param {{item: object, locationCode: string, qty: number, scannedVariantIds?: string[]}} args
 * @returns {Promise<{movementId: string, placementQty: number}>}
 */
async function stowItem(args) {
  if (MOCK_BACKEND) {
    const store = loadMock();
    let placement = findPlacement(store, args.item.key, args.locationCode);
    if (placement) {
      placement.qty += args.qty;
    } else {
      placement = { key: args.item.key, displayLabel: args.item.displayLabel, locationCode: args.locationCode, qty: args.qty };
      store.placements.push(placement);
    }
    const movement = pushMovement(store, {
      direction: 'in', reason: 'stow', key: args.item.key, displayLabel: args.item.displayLabel,
      locationCode: args.locationCode, qty: args.qty, balanceAfter: placement.qty,
    });
    saveMock(store);
    return { movementId: movement.id, placementQty: placement.qty };
  }
  const r = await callRpc('stow_item', {
    p_session_token: currentSessionToken(),
    p_product_id: args.item.productId,
    p_color_seq: args.item.colorSeq,
    p_location_code: args.locationCode,
    p_qty: args.qty,
    p_scanned_variant_ids: args.scannedVariantIds || [],
  });
  const row = r[0];
  return { movementId: row.movement_id, placementQty: row.placement_qty };
}

/**
 * @param {{item: object, locationCode: string, qty: number, reason: 'pick_sale'|'pick_courier', scannedVariantIds?: string[]}} args
 * @returns {Promise<{movementId: string, placementQty: number}>}
 */
async function pickItem(args) {
  if (MOCK_BACKEND) {
    const store = loadMock();
    const placement = findPlacement(store, args.item.key, args.locationCode);
    const current = placement ? placement.qty : 0;
    if (args.qty > current) {
      throw new Error('Sólo hay ' + current + ' en esa ubicación; no se pueden tomar ' + args.qty + '.');
    }
    const newQty = current - args.qty;
    if (newQty === 0) {
      store.placements = store.placements.filter(function (p) { return p !== placement; });
    } else {
      placement.qty = newQty;
    }
    const movement = pushMovement(store, {
      direction: 'out', reason: args.reason, key: args.item.key, displayLabel: args.item.displayLabel,
      locationCode: args.locationCode, qty: args.qty, balanceAfter: newQty,
    });
    saveMock(store);
    return { movementId: movement.id, placementQty: newQty };
  }
  const r = await callRpc('pick_item', {
    p_session_token: currentSessionToken(),
    p_product_id: args.item.productId,
    p_color_seq: args.item.colorSeq,
    p_location_code: args.locationCode,
    p_qty: args.qty,
    p_reason: args.reason,
    p_scanned_variant_ids: args.scannedVariantIds || [],
  });
  const row = r[0];
  return { movementId: row.movement_id, placementQty: row.placement_qty };
}

/**
 * @param {{locationCode: string, counted: Array<{item: object, qty: number}>}} args
 * @returns {Promise<{variances: Array<{key: string, displayLabel: string, expected: number, found: number}>}>}
 */
async function recountLocation(args) {
  if (MOCK_BACKEND) {
    const store = loadMock();
    const variances = [];
    const countedKeys = new Set();

    args.counted.forEach(function (line) {
      countedKeys.add(line.item.key);
      const placement = findPlacement(store, line.item.key, args.locationCode);
      const prevQty = placement ? placement.qty : 0;
      if (prevQty === line.qty) return; // no variance

      variances.push({ key: line.item.key, displayLabel: line.item.displayLabel, expected: prevQty, found: line.qty });
      if (line.qty === 0) {
        if (placement) store.placements = store.placements.filter(function (p) { return p !== placement; });
      } else if (placement) {
        placement.qty = line.qty;
      } else {
        store.placements.push({ key: line.item.key, displayLabel: line.item.displayLabel, locationCode: args.locationCode, qty: line.qty });
      }
      pushMovement(store, {
        direction: line.qty > prevQty ? 'in' : 'out', reason: 'recount_adjustment',
        key: line.item.key, displayLabel: line.item.displayLabel, locationCode: args.locationCode,
        qty: Math.abs(line.qty - prevQty), balanceAfter: line.qty,
      });
    });

    // Anything on record at this location that wasn't rescanned at all --
    // implicitly zeroed, same "a recount is authoritative for the whole
    // location" rule the real recount_location already implements.
    store.placements
      .filter(function (p) { return p.locationCode === args.locationCode && !countedKeys.has(p.key); })
      .forEach(function (p) {
        variances.push({ key: p.key, displayLabel: p.displayLabel, expected: p.qty, found: 0 });
        pushMovement(store, {
          direction: 'out', reason: 'recount_adjustment', key: p.key, displayLabel: p.displayLabel,
          locationCode: args.locationCode, qty: p.qty, balanceAfter: 0,
        });
      });
    store.placements = store.placements.filter(function (p) { return !(p.locationCode === args.locationCode && !countedKeys.has(p.key)); });

    saveMock(store);
    return { variances: variances };
  }

  const payload = args.counted.map(function (line) {
    return { product_id: line.item.productId, color_seq: line.item.colorSeq, counted_qty: line.qty };
  });
  const rows = await callRpc('recount_location', {
    p_session_token: currentSessionToken(),
    p_location_code: args.locationCode,
    p_counted: payload,
  });
  // Real RPC only returns product_id/color_seq for each variance, not a
  // display label (it never had the scanned item objects to draw one
  // from) -- the caller (contar.js) is expected to build its own label
  // from whatever it already has on hand for each counted line.
  return {
    variances: rows.map(function (r) {
      return { key: r.out_product_id + '::' + r.out_color_seq, productId: r.out_product_id, colorSeq: r.out_color_seq, expected: r.out_expected, found: r.out_found };
    }),
  };
}

/**
 * @param {{item: object, includeOtherBranches?: boolean}} args
 * @returns {Promise<Array<{locationCode: string, qty: number}>>}
 */
async function searchItem(args) {
  if (MOCK_BACKEND) {
    const store = loadMock();
    return store.placements
      .filter(function (p) { return p.key === args.item.key; })
      .map(function (p) { return { locationCode: p.locationCode, qty: p.qty }; })
      .sort(function (a, b) { return b.qty - a.qty; }); // qty-only ranking in mock mode -- the real
      // backend ranks by proximity through the bodega hierarchy first (§3.5 of the plan); that
      // signal doesn't exist in this flat mock store, so this is a deliberately simpler stand-in.
  }
  const rows = await callRpc('search_placements', {
    p_session_token: currentSessionToken(),
    p_product_id: args.item.productId,
    p_color_seq: args.item.colorSeq,
    p_include_other_branches: args.includeOtherBranches || false,
  });
  return rows.map(function (r) { return { locationCode: r.location_code, qty: r.qty }; });
}

/**
 * @param {number} [limit]
 */
function listRecentMovements(limit) {
  // Local-only, deliberately, in BOTH modes -- this is a same-device,
  // same-session "what did I just do" convenience list (§3.3 of the
  // plan's "last 10, scrollable" requirement), not meant to reflect
  // every device's activity. Real cross-device history lives in
  // location_movements itself, queryable later if a dedicated screen for
  // it is ever built -- this function was never meant to be that screen.
  const store = loadMock();
  return store.movements.slice(0, limit || 10);
}

/**
 * @param {string} locationCode
 * @returns {Array<{key: string, displayLabel: string, qty: number}>}
 */
function getLocationContents(locationCode) {
  // Mock-only helper (used by Poner's "show what's already on this
  // shelf" display) -- the real backend doesn't have an equivalent RPC
  // yet, since nothing asked for one until Poner's own UX design. Falls
  // back to an empty list in real mode rather than erroring, so the UI
  // degrades gracefully instead of blocking the stow flow entirely.
  if (!MOCK_BACKEND) return [];
  const store = loadMock();
  return store.placements
    .filter(function (p) { return p.locationCode === locationCode; })
    .map(function (p) { return { key: p.key, displayLabel: p.displayLabel, qty: p.qty }; });
}
