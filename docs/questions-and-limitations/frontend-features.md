# Frontend gameplay features: questions and limitations

Gameplay UI features in `frontend/game/features/` (`dev-console`, `hub-placement`, `hud-min`, `landfall`,
`terraform-basic`, `territory-border`, plus `define.ts` / `index.ts`), their specs and CSS, as mounted by the online
flow (`frontend/game/app/online/featureHud.ts`). Rules: D-37 (one placement rule), AGENTS.md §6, the design system in
`frontend/design/css/`. Format: [README](./README.md). Ledger limits are in [`economy-ledger.md`](./economy-ledger.md).

## Terraform brush (`terraform-basic`)

### FF-01 · The terraform brush is never bound to the map in the online game

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED (code trace + headless probe on `/play.html?host=local&scenario=w01`)
- **Area / code:** `frontend/game/features/terraform-basic/index.ts:179-183` (`mountTerraformBasic`),
  `frontend/game/app/online/OnlineSession.ts:192` (`createHud` services), `docs/plan/checks/w01-check.md` step 3
- **What happens:** the brush binds pointer events only to `opts.surface ?? services.surface`. The online session
  passes `canvas` and `pickTile` but never `surface` (nothing in `frontend/game` sets it), so `brush.bindSurface` is
  never called. Selecting **BREAK [B]** and clicking a rock tile sends no `enqueueTask` (probe: zero commands on the
  wire). The menu, hotkeys and overlay render, but no order can be painted on the map. `hub-placement` reads
  `services.surface ?? services.canvas` (`hub-placement/index.ts:152`) and works.
- **Why it is like this:** the feature was built and tested against a fake surface in its spec
  (`terraform-basic.spec.ts:139`); the online wiring was never added.
- **Workaround / mitigation:** none in the UI. The owner check guide step 3 ("select BREAK [B] … break a rock tile")
  cannot be done as written. Only the Hub's linked site prep (Grade) runs terraform jobs.
- **To resolve:** read `services.surface ?? services.canvas` like hub-placement, and fix FF-02 and FF-06 in the same
  change (both are hidden today only because this binding is missing).
- **Found:** 2026-11-01, review (frontend features)

### FF-02 · Every brush stroke and cancel would be sent twice

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED (code trace; not visible today because of FF-01)
- **Area / code:** `frontend/game/features/terraform-basic/BrushController.ts:299-313` (`dispatchEnqueue`),
  `:335-343` (`cancelOrder`); `frontend/game/store/WorldStore.ts:139-145` (`sendCommand`)
- **What happens:** the two dispatch branches are independent `if`s: when the sink has `sendCommand` and a
  `store.sendCommand` that is a different function, both run. The online HUD gives both (`services.sendCommand` =
  `CommandBus.send`, `services.store` = `WorldStore`), and `WorldStore.sendCommand` also does `transport.send({ t:
  'cmd' })`. One stroke = two `enqueueTask` orders (two queued orders, double cell energy), one CANCEL = two
  `cancelTask` (harmless with a real `orderId`, which the second call no longer finds; with the `'active'` wildcard
  fallback the second call cancels the next order). `HubPlacementMenu.dispatch` (`HubPlacementMenu.ts:313-323`) uses
  `else if` and sends once.
- **Why it is like this:** the sink was written for several host shapes (bus, store, in-process host) at once.
- **Workaround / mitigation:** none; masked by FF-01.
- **To resolve:** one channel per command (bus, else store, else host), as in `HubPlacementMenu.dispatch`; extract
  that dispatcher into one helper both features use; add a spec that counts transport `cmd` messages per stroke.
- **Found:** 2026-11-01, review (frontend features)

### FF-03 · Terraform validity is re-implemented in the client and has already drifted from the sim (D-37)

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/terraform-basic/BrushController.ts:91-164` (`hasClaimedInTiles`,
  `isOpValidForTerrainPrep`, `planBrushStroke`); sim rule `shared/sim/src/systems/terraform-basic/queue.ts:75-167`
  (`hasColonyClaimedTerritory`, `canRunTerraformOpOnTile`, `resolveTerraformOpForTile`); AGENTS.md §6 "One rule, one
  function"
- **What happens:** the client decides which tiles a stroke can work (owner, "unclaimed only until you own ground",
  Grade/Clear/Break per terrain and prep) with its own copy of the sim rules. They differ already: the sim also counts
  an active Command Hub as "claimed", the client looks only at owned tiles. The client's `queuedCount` /
  `skippedCount` and the status line ("Queued N jobs · M skipped") can disagree with what the host queues. There is
  no parity spec (the hub ghost has one, `placement-parity.spec.ts`).
- **Why it is like this:** the sim functions take `SimState`, so they cannot run on the replica view; the client
  copied them instead of getting a read-only-world variant like `evaluatePlacement`.
- **Workaround / mitigation:** the host re-validates, so only the preview numbers are wrong.
- **To resolve:** move the per-tile rule to a pure function over a read-only world in `shared/sim` (as
  `PlacementWorld` + `evaluatePlacement`), call it from both the handler and the brush, and add a parity spec over
  every tile of a generated planet.
- **Found:** 2026-11-01, review (frontend features)

### FF-04 · The brush can mutate world state directly

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (code); not reached in the online flow (no `state` / `host` service there)
- **Area / code:** `BrushController.ts:314-326` (`enqueueTerraformOrder` on `sink.state ?? sink.host.state`),
  `:344-348` (`cancelTerraformOrder`); `terraform-basic/index.ts:152`
- **What happens:** when the feature is given a `state` or a host whose `pending` count did not change, the brush
  writes the order into the sim state itself instead of sending a command. With `sendCommand` also present it does
  both (send and mutate). `cancelOrder` mutates with the raw `taskId` while it sends `resolvedId` (`:336` vs `:347`),
  so the two paths cancel different orders. AGENTS.md §6: "the client never mutates world state and only sends
  commands".
- **Why it is like this:** a test convenience (in-process `PlanetState`) that stayed in production code.
- **Workaround / mitigation:** the online HUD services carry no `state` / `host`.
- **To resolve:** remove the direct mutation; tests submit through `SimHost.submit` like `placement-data.spec.ts`.
- **Found:** 2026-11-01, review (frontend features)

### FF-05 · The terraform feature always works for colony 0

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (code trace)
- **Area / code:** `terraform-basic/index.ts:149,154,168-175` (colony fixed at mount), `TileOverlay.ts:234`,
  `BrushController.ts:240,333`
- **What happens:** the colony index is read once from `opts.colonyId ?? services.colonyId ?? 0`; the online session
  never sets `services.colonyId`. A player whose colony index is not 0 sees colony 0's terraform orders in the overlay
  and status line, and the client planner (FF-03) treats that player's own tiles as foreign. `hub-placement`,
  `hud-min` and the `ledger` command follow `services.landfall.getOwnerColonyIndex()` instead.
- **Why it is like this:** written and tested with a single colony 0.
- **Workaround / mitigation:** scenario planets seat the first player as colony 0.
- **To resolve:** resolve the colony per call from `services.landfall?.getOwnerColonyIndex()` (one shared helper for
  all features).
- **Found:** 2026-11-01, review (frontend features)

### FF-06 · Left click on the map has three owners and no mode

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED (code trace)
- **Area / code:** `BrushController.ts:373-409` (single mode strokes on every left pointerup, no drag threshold),
  `HubPlacementMenu.ts:394-407` (confirms on left pointerup), `landfall/selection.ts:398-412` (selects the HQ near
  the click)
- **What happens:** all three listen to `button 0` on the same canvas and none consumes the event. Once FF-01 is fixed,
  every left click on the map (selecting the HQ, confirming a Hub site, clicking empty ground) also queues a 1-tile
  terraform order with the selected op (Grade by default), because the brush has no "armed" state.
- **Why it is like this:** each feature was built alone; there is no input arbiter.
- **Workaround / mitigation:** none needed today (FF-01).
- **To resolve:** decide the interaction model. Recommendation: the brush is armed only after choosing an op (button
  or G/C/B) and disarms on Esc / right click, placement mode takes precedence over everything, and one small input
  router hands each pointer event to the active mode only.
- **Found:** 2026-11-01, review (frontend features)

### FF-07 · Terraform hotkeys are global and ignore other modes

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `terraform-basic/TerraformMenu.ts:97-107`
- **What happens:** G/C/B/V/O fire on every keydown in the page (no `e.repeat`, no `isContentEditable` check, also
  while the Hub ghost is open). V and O are both "toggle overlay". The guard list differs from the other handlers
  (`unitControl.ts:38` checks `isContentEditable`, `HubPlacementMenu.ts:206` and this one do not).
- **Why it is like this:** each menu added its own window listener when it was built.
- **Workaround / mitigation:** none.
- **To resolve:** one shared `isTypingTarget(e)` guard and one hotkey table (also lists H, X, Q/E, WASD, F, `` ` ``)
  so conflicts are visible; ignore repeats.
- **Found:** 2026-11-01, review (frontend features)

### FF-08 · The overlay recomputes and rebuilds its DOM on every view, even when hidden

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `terraform-basic/TileOverlay.ts:135-152,278-332`, `index.ts:158-166`
- **What happens:** each view (5 Hz, more with prediction) scans every tile's prep and recreates up to 32 chip
  elements while the overlay is hidden. `extractColonyOrders` drops orders with zero remaining jobs, so the `'DONE'`
  label branch (`:302`) never shows.
- **Why it is like this:** the overlay was written as a pure function of the view, recomputed on each update.
- **Workaround / mitigation:** the chip list is capped at 32.
- **To resolve:** skip work while hidden; diff chips; drop the dead branch or keep finished orders.
- **Found:** 2026-11-01, review (frontend features)

### FF-09 · Terraform CANCEL after a stroke cancels nothing

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (code trace)
- **Area / code:** `TerraformMenu.ts:82-86`, `BrushController.ts:241,300,332`
- **What happens:** the button is enabled by `lastStroke`, and when the overlay shows no active order it sends the
  client-made id `tf_stroke_N`. The `enqueueTask` sent over the bus carries no task id, so the host never knows that
  id and the cancel is a silent no-op.
- **Why it is like this:** the client invents a task id for its own summary, but the bus command does not carry it.
- **Workaround / mitigation:** none; cancelling an order shown in the overlay uses the host id.
- **To resolve:** cancel by the host's `orderId` from the view only; disable the button when there is none.
- **Found:** 2026-11-01, review (frontend features)

## Hub placement (`hub-placement`)

### FF-10 · Right-click to cancel the Hub ghost also sends the HQ walking there

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (headless probe: right click during placement → ghost closed and one `moveUnit` sent)
- **Area / code:** `HubPlacementMenu.ts:394-413` (pointerup button 2 / contextmenu → `cancelPlacement`),
  `landfall/selection.ts:402-418` (same events → `orderMove`)
- **What happens:** both controllers listen on the same canvas. "Right-click cancels placement" also orders the
  selected HQ (selected by default, `autoSelect`) to the clicked tile.
- **Why it is like this:** each controller binds the canvas on its own; there is no input arbiter (FF-06).
- **Workaround / mitigation:** press Esc or the CANCEL button instead of right clicking.
- **To resolve:** while placement is active, the placement controller consumes right clicks (part of the input
  router in FF-06), or landfall ignores clicks while `services.hubPlacement.isPlacementActive()`.
- **Found:** 2026-11-01, review (frontend features)

### FF-11 · Esc cancels the ghost or also pauses, depending on listener order

- **Status:** Open
- **Severity:** medium
- **Confidence:** PLAUSIBLE (order traced in a headless probe; the double action was not reproduced on `?host=local`)
- **Area / code:** `HubPlacementMenu.ts:202-215`, `OnlineSession.ts:329-342` (`bindKeys`),
  `app/online/viewportHelper.ts:24-31` (`isEscapeBlockedByHudOverlay`), `featureHud.ts:40,64-91` (remount)
- **What happens:** both are window `keydown` listeners. The pause handler asks the DOM whether the ghost is open.
  If the ghost's listener runs first, it has already closed the ghost, the check says "not blocked" and the game
  pauses too. The first mount registers the ghost's listener **before** `bindKeys` (probe), so Esc in placement
  would cancel and pause; it works today only because `FeatureHud` remounts all features after `welcome` (flags
  update), which re-registers the ghost's listener after the session's.
- **Why it is like this:** the pause guard reads DOM state written by another listener on the same event.
- **Workaround / mitigation:** the remount after `welcome` happens to reverse the order.
- **To resolve:** the placement handler calls `stopImmediatePropagation()` (or registers in capture phase like the
  dev console), or the pause handler asks `services.hubPlacement.isPlacementActive()` instead of the DOM.
- **Found:** 2026-11-01, review (frontend features)

### FF-12 · Hub cost and HQ speed labels are literals, not the live balance data

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `HubPlacementMenu.ts:44` (`HUB_COST_TEXT = '200 Metals · 100 Minerals · 50 Biomass · 50
  Water'`), `:459` (`(HQ 1.5×)`); data rows `hub.t1.cost`, `hq.t1.workRate` (`shared/sim/src/data/hq.ts:29`);
  `hud-min/MinimalHud.ts:47,382` (`resolveHubCost()` with no data)
- **What happens:** the ghost already evaluates with the host's live data (`store.simData()`, D-35/D-37), but the
  button cost, the bill's speed label and the "Waiting: Metals x/200" toast use defaults. A tuned `hub.t1.cost` or
  `hq.t1.workRate` (overrides, `tune`) shows the old numbers.
- **Why it is like this:** the labels predate the live-data fix that the ghost got (`placement-data.spec.ts`).
- **Workaround / mitigation:** the defaults match the shipped rows.
- **To resolve:** format both from `resolveHubCost(simData)` / the `hq.t1` row; pass `simData` to `handleReject`.
- **Found:** 2026-11-01, review (frontend features)

### FF-13 · CANCEL ORDER stays enabled and its wildcard can cancel a terraform order

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (code trace across client and the `cancelTask` handler)
- **Area / code:** `HubPlacementMenu.ts:295,345-354,470-476`, `GhostEvaluator.ts:288-294`; handler
  `shared/sim/src/systems/terraform-basic/index.ts:125-137`, `construction/index.ts:283-291`
- **What happens:** `lastOrderId` (a local command id) is set at confirm and cleared only by a cancel, so the button
  stays enabled after the host rejected the placement. With no construction order in the view the click sends
  `cancelTask { taskId: 'current' }`; the handler finds no construction order and passes `'current'` to
  `cancelTerraformOrder`, which removes the colony's first terraform order. Separately,
  `extractColonyConstructionOrders` keeps `completed` orders (the sim never prunes them), so after the Hub is built
  the panel shows "commandHub: completed" and the button stays enabled.
- **Why it is like this:** `lastOrderId` was meant to cover the time before the order shows up in the view.
- **Workaround / mitigation:** none.
- **To resolve:** enable the button only for a non-completed host order and always send its `orderId`; clear
  `lastOrderId` on reject; owner question for the sim side: should `cancelTask` with a wildcard ever fall through
  from construction to terraform?
- **Found:** 2026-11-01, review (frontend features)

### FF-14 · The ghost is green before landing; parity is tested only for colony 0 with an HQ

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `GhostEvaluator.ts:228-232` (`resolveRequireBuilder`), `placement.ts:205`,
  `placement-parity.spec.ts:26-56`
- **What happens:** with `requireHq` unset the ghost skips the "landed HQ" check while the colony has no entity, so
  it can be green where the host answers `worker_tier_locked` (`noBuilder`). The parity spec runs only colony 0 with
  an HQ at (0,0): `foreign`, `occupied` (an existing Hub entity through the packed view), `hubExists` and `noBuilder`
  are not compared client vs host.
- **Why it is like this:** a preview before touchdown is wanted; the menu is hidden until the HQ exists
  (`hub-placement/index.ts:158-163`).
- **Workaround / mitigation:** the host re-validates every placement; a mismatch reopens the ghost with the host reason.
- **To resolve:** add parity cases with a second colony, an existing Hub and no HQ.
- **Found:** 2026-11-01, review (frontend features)

### FF-15 · Two hover paths re-evaluate the ghost; magic numbers in the ghost

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `HubPlacementMenu.ts:388-392,448-450` (every canvas `pointermove` → `evaluatePlacement` +
  rebuild of the 9 footprint cells, no same-tile check), `hub-placement/index.ts:224-238` (per-frame pick, deduped);
  `GhostEvaluator.ts:200` (radius fallback `12`), `:308` (search radius `5`); `GhostRig3D.ts:8` (`2 / √3`, `TILE_M`
  re-typed instead of imported)
- **What happens:** online both paths run; each pointer move does a full placement evaluation and DOM rebuild. The
  H key has no `e.repeat` guard, so holding it runs `findValidHubSiteNearHq` (≈90 evaluations) per repeat.
- **Why it is like this:** the per-frame pick was added for the 3D ghost while the DOM path stayed for tests.
- **Workaround / mitigation:** none needed at current map sizes.
- **To resolve:** keep only the renderer's deduped path; import `TILE_M` from `@terra/render/planets/hex`; name the
  search radius (or put it in `hub.t1`).
- **Found:** 2026-11-01, review (frontend features)

### FF-16 · GhostRig3D leaks the archetype material

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `GhostRig3D.ts:45-58,90-94`; `frontend/render/kitbash/catalog.ts:56-64`
- **What happens:** `createArchetypeMesh` makes a new unified material per call; `tint()` replaces it with the ghost
  materials and the original is never disposed, and the old body is dropped without disposal on a biome change. The
  geometry is shared from the catalog cache (must not be disposed). `tint()` also traverses the body every frame.
- **Why it is like this:** the ghost reuses the real archetype mesh and swaps its material.
- **Workaround / mitigation:** small: one material per biome change.
- **To resolve:** dispose the replaced material once; tint only when validity changes.
- **Found:** 2026-11-01, review (frontend features)

### FF-17 · A host reject loses its cause in the ghost

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `HubPlacementMenu.ts:326-327`; `backend/app/src/ws/sim-command-ingress.ts:119-121`; the sim
  returns only a `RejectCode`
- **What happens:** when the host refuses a placement the ghost accepted, the reason line shows the code with
  underscores replaced ("terrain unbuildable") instead of the block text the ghost itself shows ("trees", "uneven
  ground"), because `cmd.reject` carries no detail for sim rejects.
- **Why it is like this:** sim command handlers return a bare `RejectCode`.
- **Workaround / mitigation:** the ghost turns red on the right site.
- **To resolve:** re-run `evaluateHubGhost` on the newer view and prefer its `reasonText` when it agrees with the
  host's code; or let the sim return `placementBlockText` as the detail.
- **Found:** 2026-11-01, review (frontend features)

### FF-18 · hub-placement leftovers

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (`npx tsc --noUnusedLocals`)
- **Area / code:** `hub-placement.css:1-110` vs `:127-173` (`.ta-hub-ghost`, `__grid`, `__tile`, `.ta-hub-bill`
  defined twice; the first blocks are mostly overridden), `HubPlacementMenu.ts:71,78` (`billEl`, `cancelBtn` never
  read), `HubPlacementMenu.ts` is 499 lines (one under the limit)
- **What happens:** leftover CSS blocks and unused members; the menu is at the file limit, so any addition must split it first.
- **Why it is like this:** the compact card layout was appended as overrides instead of replacing the first layout.
- **Workaround / mitigation:** none needed.
- **To resolve:** merge the CSS blocks; drop the fields; split the menu's DOM building into a part before the next
  addition.
- **Found:** 2026-11-01, review (frontend features)

## Shared code across features

### FF-19 · A test-only DOM shim ships in production code, twice

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `hub-placement/dom.ts:1-260` and `terraform-basic/dom.ts:1-238` (`MiniElement`, `ensureDom`, near
  identical; `diff` shows formatting and one early-return difference), called from production constructors
  (`HubPlacementMenu.ts:96`, `TerraformMenu.ts:26`, `TileOverlay.ts:235`, `mountTerraformBasic`); two more fake DOMs
  in specs (`landfall/landfall.spec.ts:14`, `hud-min/hud-min.spec.ts:16`) and one in `app/online/bootFlow.spec.ts:12`
- **What happens:** ≈500 lines of copied test scaffolding sit in the app bundle and run a `typeof document` check on
  every mount. Each fake DOM supports a different subset of the API, so specs pass against behaviour a browser does
  not have (e.g. `MiniElement.click()` honours `disabled`, `dispatchEvent` ignores bubbling).
- **Why it is like this:** specs run in plain Node without a DOM environment.
- **Workaround / mitigation:** the browser path skips the shim (`document` exists).
- **To resolve:** run feature specs in `environment: 'happy-dom'` (or `jsdom`) in `frontend/game/vitest.config.ts`
  and delete the shims; if a shim stays, one copy under a test-only folder.
- **Found:** 2026-11-01, review (frontend features)

### FF-20 · View parsing and input helpers are copied between features

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** packed entity offsets `o+1 … o+10` hand-written in `GhostEvaluator.ts:128-139` and
  `landfall/selection.ts:95-107` (`viewCodec.ts` exports only `ENTITY_STRIDE`); HQ cell extraction in
  `MinimalHud.ts:92-113` and `selection.ts:139-201` (different fallbacks); colony lookup `find(c.index === i) ??
  colonies[i]` in four places; `resolveCoord` (event detail → pick → `data-q/r`) in `HubPlacementMenu.ts:368-386`,
  `BrushController.ts:357-371`, `selection.ts:390-396`; typing-target guard in five handlers; two different
  `SimHostLike` interfaces (`hub-placement/index.ts:51`, `terraform-basic/index.ts:58`); bar percentage clamp in
  `HqPanel.ts:3` and `MinimalHud.ts:339`
- **What happens:** a change to the view layout or the pick contract has to be repeated by hand; the copies already
  differ (e.g. `isContentEditable`).
- **Why it is like this:** each feature was built in its own issue branch.
- **Workaround / mitigation:** none.
- **To resolve:** named entity offsets (or a `readEntity(view, i)`) in `viewCodec.ts`; one `viewColony(view, i)` and
  one `hqStatus(view, i)` used by HUD and panel; one pointer-to-tile helper; one keyboard guard.
- **Found:** 2026-11-01, review (frontend features)

## HUD top bar and toasts (`hud-min`)

### FF-21 · The top bar is not a chamfered plate (undefined tokens)

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (computed `clip-path` is `none` on both the bar and its `::before` in Chrome)
- **Area / code:** `hud-min/hud-min.css:9,18,33-40,49`; tokens `frontend/design/css/tokens.css:65-68`
- **What happens:** `.ta-hud-min.plate-sm { clip-path: none }` removes the design-system chamfer, and the
  replacement `::before` polygon uses `--ta-cut-sm`, which does not exist (`--ta-chamfer-s` does), so the whole
  `clip-path` is invalid and the backdrop is a plain rectangle. Its corners would also be top-right / bottom-left,
  the mirror of `.plate`. `--ta-fs-micro` (narrow screens) is undefined too, so that font-size falls back to inherit.
  `box-shadow: 0 4px 16px rgba(0,0,0,0.4)` on toasts (`:202`) is a raw colour instead of a token.
- **Why it is like this:** the tokens look like names from an older token set.
- **Workaround / mitigation:** none; the bar is still readable.
- **To resolve:** use `--ta-chamfer-s` with the `.plate-sm` polygon, a defined label size, a shadow token; add a CSS
  token-existence check (grep of `var(--ta-*)` against `tokens.css`) to `check:structure` or a spec.
- **Found:** 2026-11-01, review (frontend features)

### FF-22 · Reject toasts: wrong shortfall, misleading texts, no compile-time coverage of reject codes

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `hud-min/MinimalHud.ts:43-90` (`formatRejectToast`), `:379-385` (`handleReject`),
  `:282-288` (transport path); `shared/contracts/src/errors/index.ts:4-13` (`REJECT_CODES`)
- **What happens:**
  - `insufficient_resources` is always measured against the Hub cost: `handleReject` passes `undefined` for non-hub
    kinds and the default parameter turns that back into `resolveHubCost()`; the transport path passes no `cmd` and
    is treated as a Hub. A shortfall on any other command shows "Waiting: Metals x/200".
  - `KNOWN` wins over `detail`, and its texts are placement-specific: `invalid_args` → "Invalid placement" also for
    `moveUnit`, `enqueueTask`, landing and dev commands; `worker_tier_locked` → "Requires HQ" also for `builderBusy`.
  - `KNOWN` is `Record<string, string>`: `unknown_kind`, `not_own_colony`, `stage_locked`, `raid_protected`,
    `would_isolate`, `launch_gate`, `mint_cap`, `market_unavailable`, `planet_ended`, `host_unavailable`, `internal`
    fall back to the capitalised code with nobody noticing a missing text.
  - Shortfall labels (`Metals`, `Minerals`, `Biomass`, `Water`) are matched by key prefix here and spelled again in
    the hub cost literal (FF-12) and the HUD titles.
- **Why it is like this:** the toast was written for the Hub acceptance case first (W01-29).
- **Workaround / mitigation:** the Hub case, the main W01 flow, is right.
- **To resolve:** type the table `Record<RejectCode, string>` (client-only `timeout` / `not_connected` beside it);
  pass the real cost per command kind (or no shortfall line when unknown); per-kind wording for `invalid_args`; one
  resource-label table shared by HUD, toast and menu.
- **Found:** 2026-11-01, review (frontend features)

### FF-23 · Magic numbers in the HUD and HQ panel

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (the `entityId` fallback effect is PLAUSIBLE)
- **Area / code:** `MinimalHud.ts:23` (`tick / 5`; `TICKS_PER_SECOND` is exported by `@terra/sim`), `:107,110,112`
  and `selection.ts:179,181` (`800` cell, `900` hull defaults), `MinimalHud.ts:214,223,232,268` and
  `HqPanel.ts:59,79` (placeholder `0 / 500`, `800 / 800 E`, `900 / 900`), `selection.ts:185` (`entityId` fallback
  `1`), `selection.ts:67` (`stateCode === 3`, see FF-27)
- **What happens:** before the first view the HUD shows a full 800 E cell; a tuned `hq.t1` or tick rate shows wrong
  numbers. If a view carries HQ metadata but no HQ entity, the panel's HQ gets id 1 and a right click would send
  `moveUnit { entityId: 1 }`.
- **Why it is like this:** the defaults mirror the W01 rows so the panel looks complete before data arrives.
- **Workaround / mitigation:** the first view replaces them.
- **To resolve:** read rates and maxima from the sim constants / compiled data; render "—" until a view arrives;
  return `null` instead of inventing an entity id.
- **Found:** 2026-11-01, review (frontend features)

### FF-24 · HUD accessibility basics

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `MinimalHud.ts:167-169,353-377`, `:205-249`; `hud-min/hudIcons.ts`
- **What happens:** the toast container has no `role="status"` / `aria-live`, so rejects are not announced. Toasts
  are clickable `div`s (no keyboard dismiss). Metals, Minerals and Supply show an icon and a number only, named by
  `title` (Bio has an sr-only label). The HQ select badge has no `aria-pressed`.
- **Why it is like this:** not part of the W01 acceptance.
- **Workaround / mitigation:** tooltips on hover.
- **To resolve:** `aria-live="polite"` on the container, sr-only names for every stock, `aria-pressed` on the badge.
- **Found:** 2026-11-01, review (frontend features)

### FF-25 · Dead code in the HUD and the features root

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (grep: no importer; `tsc --noUnusedLocals`)
- **Area / code:** `frontend/game/features/define.ts`, `frontend/game/features/index.ts` (the registry loads
  `features/*/index.ts` by glob; nothing imports these two); `MinimalHud.ts:138` (`latestTick` written, never read),
  `MinimalHud.ts:15` (`sendCommand` option unused); toast timers are not cleared on `dispose`
- **What happens:** two barrel files and a few members nobody reads; pending toast timers fire after `dispose` and remove detached nodes (harmless).
- **Why it is like this:** left from earlier iterations.
- **Workaround / mitigation:** none needed.
- **To resolve:** delete the two barrels and the unused members.
- **Found:** 2026-11-01, review (frontend features)

## HQ selection and orders (`landfall`)

### FF-26 · A second right click on the same tile within 400 ms is dropped

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `landfall/selection.ts:213-214,380-388` (`RIGHT_CLICK_DEDUPE_MS`, `Date.now()`)
- **What happens:** browsers fire `contextmenu` and `pointerup` for one right click, so the pair is collapsed by tile
  and time. A real double click on the same tile sends one order. The clock is wall time, so a spec that fires two
  clicks needs fake timers.
- **Why it is like this:** one click must be one order (the HQ stepped back and forth otherwise, check guide step 4).
- **Workaround / mitigation:** a different tile, or a click after 400 ms, is a new order.
- **To resolve:** nothing to change; use fake timers in any spec that fires two right clicks.
- **Found:** 2026-11-01, review (frontend features)

### FF-27 · `hqJobFromStateCode` maps the descending state to "constructing"

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `landfall/selection.ts:64-69`; `shared/sim/src/ecs/columns.ts:41-50`
- **What happens:** the literal `3` is `ENTITY_STATE.descending`, not a construction state; `waiting` (7) and
  `active` (5) show as `idle`. Today descending HQs are filtered out before the call, so only the exported helper is
  wrong.
- **Why it is like this:** state code `3` was probably meant as a construction state before `ENTITY_STATE` was final.
- **Workaround / mitigation:** none needed today.
- **To resolve:** drop the literal; map `waiting` explicitly (e.g. "waiting").
- **Found:** 2026-11-01, review (frontend features)

## Territory border (`territory-border`)

### FF-28 · The border feature's view sync is never used in the game; the toggle is a permanent HUD button

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED (wiring); the height effect is PLAUSIBLE
- **Area / code:** `territory-border/index.ts:68-84,150-154` (`update` needs `services.hexTerrain`, never set by
  `OnlineSession`), `:77` (missing heights become a zero array), `:42-66` (colour-blind mode is module-global state
  in `@terra/render/planets/hex`)
- **What happens:** `update()` is a no-op in the game (the session updates the terrain itself). If a caller did pass a
  terrain and a view without `height`, the terrain would be redrawn flat. The colour-blind choice is not persisted and
  lives in a render-module global. The "BORDER: SOLID / HATCH" button sits in the top-right HUD at all times.
- **Why it is like this:** the feature was written to drive the terrain itself; the session later took over terrain updates.
- **Workaround / mitigation:** none needed.
- **To resolve:** remove the unused sync path (or wire it and drop the zero-height fallback). Question: should the
  hatch toggle move to a settings / accessibility menu and persist per player? Recommendation: yes, keep
  `border-hatch` in the console.
- **Found:** 2026-11-01, review (frontend features)

## Dev console commands (`dev-console`)

### FF-29 · Resource aliases are copied from the sim

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (copy); the sim copy being unreachable is PLAUSIBLE
- **Area / code:** `dev-console/commands.ts:9-14`, `shared/sim/src/systems/dev/index.ts:24-29`;
  contract `shared/contracts/src/commands/dev-grant.ts` (`resource: ResourceKey`)
- **What happens:** the same `RESOURCE_ALIASES` table exists in both places. The contract validates `resource` as a
  `ResourceKey` before the handler runs, so the sim's alias lookup can only see canonical keys.
- **Why it is like this:** the console needed the aliases before a shared table existed.
- **Workaround / mitigation:** none needed.
- **To resolve:** export one alias table from `@terra/sim` (or `@terra/contracts`) and use it in the console; drop
  the sim copy.
- **Found:** 2026-11-01, review (frontend features)

### FF-30 · `tp` and `land` accept more than DEV_TOOLS documents; partial coordinates are ignored

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `dev-console/commands.ts:68-95`; `docs/dev/DEV_TOOLS.md:68-69`
- **What happens:** help says `tp [id] <q> <r>` and `land [q r]`; DEV_TOOLS lists only `tp <q> <r>` and `land`.
  `land 5` (one coordinate) silently lands on the default slot. `tp` parses with `numArg`, so `tp 1.5 2` reaches the
  host and comes back as `invalid_args` instead of the console's own "must be a whole number".
- **Why it is like this:** the forms were added to the commands after the doc line was written.
- **Workaround / mitigation:** none.
- **To resolve:** document the id / coordinate forms; reject a single coordinate; use `intArg` for tiles.
- **Found:** 2026-11-01, review (frontend features)

## Cross-area findings (added by the lead)

### FF-31 · Two feature stylesheets hard-code the mono font

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/**/netstats.css`, `frontend/game/**/tick.css` (`font-family: 'IBM Plex Mono'`)
- **What happens:** they bypass `--ta-font-mono` from the design tokens, so a font change in the design system misses them.
- **To resolve:** use `var(--ta-font-mono)`.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
