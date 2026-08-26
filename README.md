# BlueChord -- Bodega (chaotic storage phone app)

Static, no-build-step phone frontend for **Buscar / Poner / Foto / Contar**
-- the chaotic-storage warehouse tool. See `CHAOTIC_STORAGE_PLAN.md` (in the
main BlueChord repo) for the full design this implements.

**This exists on its own, separate repo specifically because GitHub Pages
can't serve it privately on the free tier -- anything here is publicly
viewable by design. Nothing proprietary belongs in this repo. See "Do's
and Don'ts" below before adding anything to it.**

## Status: testable prototype, not production

- **Camera scanning is real** and should work reliably -- that was the
  whole point of building this as its own static site instead of staying
  on Google Apps Script (GAS's `HtmlService` sandbox blocks camera access
  outright; see the commit history / chat this came from for the full
  story of why).
- **The backend is mocked.** `js/api.js` is the ONLY file that talks (or
  will talk) to Supabase, and right now it doesn't -- every stow/pick/
  recount/search call reads and writes a local, per-device
  `localStorage`-backed store instead. The real Postgres RPCs
  (`stow_item`, `pick_item`, `recount_location`, `search_placements`,
  phone-pairing validation) don't exist yet. **What you're testing right
  now is camera reliability and the UX flow, not real data.**
- Photo upload is NOT reimplemented here -- the "Foto" tab is just a
  launcher button for your existing `Upload.gs` deployment (paste its URL
  in on first use). That stays on GAS on purpose; see "Do's and Don'ts."

## Deploying to GitHub Pages

1. Create a **new, separate, public** GitHub repository (not your main
   BlueChord repo -- see below for why). Push everything in this folder
   to it.
2. Repo Settings -> Pages -> Source: "Deploy from a branch" -> pick your
   default branch, folder `/ (root)` -> Save.
3. Wait a minute or two for the first build. GitHub will show you the
   live URL (`https://<your-username>.github.io/<repo-name>/`) once it's
   ready -- also visible any time under Settings -> Pages.
4. Open that URL **on the phone itself**. Camera access needs a real
   device; testing on a desktop webcam tells you nothing useful about
   real-world performance.
5. Grant camera permission when prompted. Try Poner first -- scan a real
   product barcode (Code128/EAN-13/UPC-A/Code39), then scan literally
   anything else as the "shelf" (a second product barcode works fine for
   testing, it doesn't need to be a real location code yet since nothing
   validates that server-side in mock mode).

No account, no secrets, no build step required to get this far -- HTTPS is
automatic and free on `github.io`, which is what actually fixes the camera
problem GAS had.

## Do's and Don'ts

**DO** keep this in its own repo, forever separate from the main
BlueChord/Tauri codebase. GitHub Pages on a free personal account only
publishes from *public* repositories, and even on a paid plan the
*deployed site's own files* are still downloadable/viewable by anyone with
the URL (view-source shows everything, regardless of repo visibility
settings) -- that's true of every static host, not a GitHub-specific gap.
Nothing about your Rust source, database schema, or business logic should
ever be reachable from here.

**DON'T** put the real Supabase **service-role** key anywhere in this
repo, ever, under any circumstance. It is a full-bypass-RLS admin
credential and must never leave a real server.

**DO** put the Supabase **anon** key in `js/api.js` once you wire in the
real backend (see the comment block at the top of that file). This is
safe and expected -- the anon key is *designed* to be public/embedded in
client apps (it's already embedded in your compiled desktop app the same
way). The actual security boundary is never "is the key secret," it's
"does every RPC function correctly validate its caller server-side" --
see `supabase/0038_stock_movement_rpc_hardening.sql` in the main repo for
the exact shape that validation needs to take, and make sure
`stow_item`/`pick_item`/`recount_location`/etc. all follow it before
flipping `MOCK_BACKEND` to `false`.

**DON'T** hardcode a shared secret (like the old "branch token" idea) into
any JS file here expecting it to stay hidden -- it won't, anyone can view
it. Any per-branch or per-user gating has to be a *dynamic* value
(validated server-side against a real row, like the QR-pairing token
already is) never a static string baked into the deployed code.

**DO** keep `js/api.js` as the *only* file that ever calls `fetch()`
against Supabase. Every tab module calls functions from `api.js`, never
the network directly -- that's what keeps "wire in the real backend" a
change to one file instead of a hunt through four tabs.

**DON'T** expect any data entered here right now to still exist once the
real backend is wired in -- the mock store is per-device `localStorage`,
disconnected from anything real, and is expected to just be thrown away.

**DO** test the panel/tab-switching discipline specifically, not just raw
scanning -- switch tabs mid-scan, background the browser mid-scan, lock
the phone mid-scan. The single most important thing to verify is that a
camera stream never gets stuck running/locked when you leave a tab (that
exact failure mode is what killed the GAS version). If you find a way to
get the camera stuck, that's the most valuable possible bug report right
now.

**DON'T** treat the "Vinculado: ..." pairing banner as real security --
it's `localStorage` and URL-parameter mechanics only right now (see
`js/pairing.js`'s own header comment). Nothing checks it server-side yet.

## File map

```
index.html            shell: nav bar + all four tab <section>s
css/style.css          shared dark theme, no animations
js/scanner.js          camera wrapper (html5-qrcode), reusable across tabs
js/pairing.js          phone identity -- localStorage + URL params, NOT real auth yet
js/api.js              the ONLY file that talks to Supabase -- currently mocked
js/app.js              tab routing + the one-camera-at-a-time lifecycle rule
js/tabs/buscar.js       search by typing or scanning
js/tabs/poner.js        stow flow (scan item(s), scan shelf)
js/tabs/contar.js       recount flow (scan shelf, scan every item found)
js/tabs/foto.js         launcher button for your existing Upload.gs
```

## Known rough edges in this first pass (expected, not bugs to report)

- Poner's "auto-advance to shelf after one scan" from the original spec
  was in tension with "repeat-scan bumps quantity" -- resolved as
  "keeps accepting scans until you explicitly continue," documented at
  the top of `js/tabs/poner.js`. Flag it if this doesn't feel right once
  you've tried it.
- Buscar's "otras sucursales" checkbox is present but a no-op in mock mode
  (there's no concept of multiple branches in a single-device local
  store).
- Search results are ranked by quantity only in mock mode. The real
  backend ranks by proximity through the bodega hierarchy first, per the
  plan -- that signal doesn't exist in this flat local store.
- Recount's variance results show inline in the page only. The real
  version flags variances via `notifications`/`owner_notifications`
  server-side, which doesn't exist to call yet.
