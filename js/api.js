/**
 * api.js -- THE ONLY FILE that talks (or will eventually talk) to
 * Supabase. Every tab calls functions from here, never fetch() directly --
 * that's what keeps "wire in the real backend" a change to ONE file
 * instead of a hunt through every tab.
 *
 * MOCK_BACKEND is true by default. In mock mode, every function below
 * reads/writes a local, localStorage-backed store instead of calling
 * Supabase -- because the real RPCs (stow_item, pick_item,
 * recount_location, search_placements, redeem_phone_pairing) DON'T EXIST
 * YET on the Postgres side (see CHAOTIC_STORAGE_PLAN.md §3.2 and the
 * almacen.rs/bodegas.rs Rust commands this needs Postgres counterparts
 * for). Today's testing is about camera reliability and UX flow, not
 * backend correctness -- that can't be tested until those RPCs exist.
 *
 * Mock item identity is simplified on purpose: the raw scanned barcode
 * STRING is used directly as "the item," rather than resolving it to a
 * real (product_id, color_seq) pair the way the real backend will. There
 * is no product catalog available client-side to resolve against yet.
 * Swapping this out later means: resolve the scanned barcode to
 * product_id/color_seq via its own lookup RPC first, then pass THAT into
 * stowItem/pickItem/recountLocation instead of the raw barcode -- the
 * function signatures below are already shaped to make that swap
 * mechanical (see the "real backend" comment in each function).
 *
 * ---------------------------------------------------------------------
 * HOW TO WIRE IN THE REAL BACKEND ONCE THE RPCs EXIST:
 *   1. Set MOCK_BACKEND = false below.
 *   2. Fill in SUPABASE_URL and SUPABASE_ANON_KEY (see README's "do's and
 *      don'ts" -- the anon key is SAFE to put here, it's meant to be
 *      public; every real check happens inside the RPC functions
 *      server-side, same as this project's desktop app already works).
 *   3. Uncomment the real callRpc(...) line in each function below and
 *      delete its mock implementation above it.
 * ---------------------------------------------------------------------
 */

const MOCK_BACKEND = true;

const SUPABASE_URL = ''; // fill in once wiring the real backend -- e.g. https://xxxx.supabase.co
const SUPABASE_ANON_KEY = ''; // fill in once wiring the real backend -- public-safe, see README

async function callRpc(fnName, params) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('api.js: SUPABASE_URL/SUPABASE_ANON_KEY not set yet.');
  }
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
    const text = await res.text();
    throw new Error('RPC ' + fnName + ' failed (' + res.status + '): ' + text);
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

function findPlacement(store, itemCode, locationCode) {
  return store.placements.find(function (p) { return p.itemCode === itemCode && p.locationCode === locationCode; });
}

function pushMovement(store, entry) {
  entry.id = 'mock-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  entry.createdAt = new Date().toISOString();
  store.movements.unshift(entry);
  store.movements = store.movements.slice(0, 50); // keep the mock store from growing forever
  return entry;
}

// ---- Public API ----------------------------------------------------------

/**
 * @param {{itemCode: string, locationCode: string, qty: number}} args
 * @returns {Promise<{movementId: string, placementQty: number}>}
 */
async function stowItem(args) {
  if (MOCK_BACKEND) {
    const store = loadMock();
    let placement = findPlacement(store, args.itemCode, args.locationCode);
    if (placement) {
      placement.qty += args.qty;
    } else {
      placement = { itemCode: args.itemCode, locationCode: args.locationCode, qty: args.qty };
      store.placements.push(placement);
    }
    const movement = pushMovement(store, {
      direction: 'in', reason: 'stow', itemCode: args.itemCode, locationCode: args.locationCode,
      qty: args.qty, balanceAfter: placement.qty,
    });
    saveMock(store);
    return { movementId: movement.id, placementQty: placement.qty };
  }
  // Real backend:
  // const r = await callRpc('stow_item', { p_session_token: Pairing.getSession().token, p_product_id: args.productId, p_color_seq: args.colorSeq, p_location_code: args.locationCode, p_qty: args.qty });
  // return { movementId: r.movement_id, placementQty: r.placement_qty };
  throw new Error('Real backend not wired yet.');
}

/**
 * @param {{itemCode: string, locationCode: string, qty: number, reason: 'pick_sale'|'pick_courier'}} args
 * @returns {Promise<{movementId: string, placementQty: number}>}
 */
async function pickItem(args) {
  if (MOCK_BACKEND) {
    const store = loadMock();
    const placement = findPlacement(store, args.itemCode, args.locationCode);
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
      direction: 'out', reason: args.reason, itemCode: args.itemCode, locationCode: args.locationCode,
      qty: args.qty, balanceAfter: newQty,
    });
    saveMock(store);
    return { movementId: movement.id, placementQty: newQty };
  }
  // Real backend:
  // const r = await callRpc('pick_item', { p_session_token: Pairing.getSession().token, p_product_id: args.productId, p_color_seq: args.colorSeq, p_location_code: args.locationCode, p_qty: args.qty, p_reason: args.reason });
  // return { movementId: r.movement_id, placementQty: r.placement_qty };
  throw new Error('Real backend not wired yet.');
}

/**
 * @param {{locationCode: string, counted: Array<{itemCode: string, qty: number}>}} args
 * @returns {Promise<{variances: Array<{itemCode: string, expected: number, found: number}>}>}
 */
async function recountLocation(args) {
  if (MOCK_BACKEND) {
    const store = loadMock();
    const variances = [];
    const countedCodes = new Set();

    args.counted.forEach(function (line) {
      countedCodes.add(line.itemCode);
      const placement = findPlacement(store, line.itemCode, args.locationCode);
      const prevQty = placement ? placement.qty : 0;
      if (prevQty === line.qty) return; // no variance

      variances.push({ itemCode: line.itemCode, expected: prevQty, found: line.qty });
      if (line.qty === 0) {
        if (placement) store.placements = store.placements.filter(function (p) { return p !== placement; });
      } else if (placement) {
        placement.qty = line.qty;
      } else {
        store.placements.push({ itemCode: line.itemCode, locationCode: args.locationCode, qty: line.qty });
      }
      pushMovement(store, {
        direction: line.qty > prevQty ? 'in' : 'out', reason: 'recount_adjustment',
        itemCode: line.itemCode, locationCode: args.locationCode, qty: Math.abs(line.qty - prevQty), balanceAfter: line.qty,
      });
    });

    // Anything on record at this location that wasn't rescanned at all --
    // implicitly zeroed, same "a recount is authoritative for the whole
    // location" rule the real recount_location_core already implements.
    store.placements
      .filter(function (p) { return p.locationCode === args.locationCode && !countedCodes.has(p.itemCode); })
      .forEach(function (p) {
        variances.push({ itemCode: p.itemCode, expected: p.qty, found: 0 });
        pushMovement(store, {
          direction: 'out', reason: 'recount_adjustment', itemCode: p.itemCode,
          locationCode: args.locationCode, qty: p.qty, balanceAfter: 0,
        });
      });
    store.placements = store.placements.filter(function (p) { return !(p.locationCode === args.locationCode && !countedCodes.has(p.itemCode)); });

    saveMock(store);
    return { variances: variances };
  }
  // Real backend:
  // return callRpc('recount_location', { p_session_token: Pairing.getSession().token, p_location_code: args.locationCode, p_counted: args.counted });
  throw new Error('Real backend not wired yet.');
}

/**
 * @param {{itemCode: string}} args
 * @returns {Promise<Array<{locationCode: string, qty: number}>>}
 */
async function searchItem(args) {
  if (MOCK_BACKEND) {
    const store = loadMock();
    return store.placements
      .filter(function (p) { return p.itemCode === args.itemCode; })
      .map(function (p) { return { locationCode: p.locationCode, qty: p.qty }; })
      .sort(function (a, b) { return b.qty - a.qty; }); // qty-only ranking in mock mode -- the real
      // backend ranks by proximity through the bodega hierarchy first (§3.5 of the plan); that
      // signal doesn't exist in this flat mock store, so this is a deliberately simpler stand-in.
  }
  // Real backend:
  // return callRpc('search_placements', { p_session_token: Pairing.getSession().token, p_item_code: args.itemCode, p_include_other_branches: args.includeOtherBranches || false });
  throw new Error('Real backend not wired yet.');
}

/**
 * @param {number} [limit]
 */
function listRecentMovements(limit) {
  const store = loadMock();
  return store.movements.slice(0, limit || 10);
}

/**
 * @param {string} locationCode
 * @returns {Array<{itemCode: string, qty: number}>}
 */
function getLocationContents(locationCode) {
  const store = loadMock();
  return store.placements
    .filter(function (p) { return p.locationCode === locationCode; })
    .map(function (p) { return { itemCode: p.itemCode, qty: p.qty }; });
}
