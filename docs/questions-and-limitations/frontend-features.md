# Frontend gameplay features: questions and limitations

Gameplay UI features in `frontend/game/features/` (`dev-console`, `hub-placement`, `hud-min`, `identity`, `landfall`,
`terraform-basic`, `territory-border`, plus `define.ts` / `index.ts`), their specs and CSS, as mounted by the online
flow (`frontend/game/app/online/featureHud.ts`). Rules: D-37 (one placement rule), AGENTS.md §6, the design system in
`frontend/design/css/`. Format: [README](./README.md). Ledger limits are in [`economy-ledger.md`](./economy-ledger.md).

## Terraform brush (`terraform-basic`)

### FF-01 · The terraform brush is never bound to the map in the online game

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `mountTerraformBasic` binds `opts.surface ?? services.surface ?? services.canvas` (the session now provides `surface`, FRONTEND-APP); `terraform-basic/index.ts`. Test `terraform-basic.spec.ts` › "online services without `surface`: the brush binds to `services.canvas` and an armed click sends one order". Check guide step 3 updated (arm with BREAK [B], left-click the rock tile).
- **Found:** 2026-11-01, review (frontend features)

### FF-02 · Every brush stroke and cancel would be sent twice

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** one dispatcher `dispatchCommand` (`features/shared/commandDispatch.ts`: bus, else store, else in-process host) used by the brush and the Hub menu; `BrushController.ts`, `HubPlacementMenu.ts`. Test `terraform-basic.spec.ts` › "one stroke and one cancel go through exactly one channel even when the bus and the store are both given".
- **Found:** 2026-11-01, review (frontend features)

### FF-03 · Terraform validity is re-implemented in the client and has already drifted from the sim (D-37)

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the brush preview `planBrushStroke` (`terraform-basic/planner.ts`) runs the sim's read-only rule `evaluateTerraform(terraformWorldFrom(viewPlacementWorld(view)))` (added by SIM-GAMEPLAY for GP-32) with the host's pending jobs and live data; the client copies (`hasClaimedInTiles`, `isOpValidForTerrainPrep`) are gone. The one remaining mirror is the handler's auto-prepare line (`op === 'grade' && tiles > 1`, `hostAutoPrepares`), which the sim does not export. Parity spec `terraform-parity.spec.ts` (every tile × every op on desert / ocean / temperate, before and after territory, plus a multi-tile Grade stroke previewing exactly the host's jobs).
- **Found:** 2026-11-01, review (frontend features)

### FF-04 · The brush can mutate world state directly

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the brush never calls `enqueueTerraformOrder` / `cancelTerraformOrder`: an in-process host gets `submit` (same handler as the server), the `state` option and `services.state` are removed; `BrushController.ts`, `terraform-basic/index.ts`, `hub-placement/index.ts`. Test `terraform-basic.spec.ts` › "never writes the host state: with a command bus the in-process host sees no order and no submit" (the acceptance spec now also submits through `SimHost.submit`).
- **Found:** 2026-11-01, review (frontend features)

### FF-05 · The terraform feature always works for colony 0

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** one helper `ownColonyIndex(services, override)` (`features/shared/colony.ts`: override, else `landfall.getOwnerColonyIndex()`, else `services.colonyId`) read per call by the brush, the overlay and the Hub menu. Test `terraform-basic.spec.ts` › "works for the player colony from landfall, not colony 0 (FF-05)".
- **Found:** 2026-11-01, review (frontend features)

### FF-06 · Left click on the map has three owners and no mode

- **Status:** Resolved (review-fix round 2026-11-01) — recommendation applied
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
- **Fix:** the brush is armed only by choosing an op (button or G/C/B) and disarms on Esc, a right click or a second click on the armed op; one input arbiter `bindExclusivePointer` (`features/shared/pointer.ts`) gives an active mode (placement ghost, armed brush) the map clicks in the capture phase and stops them, so HQ selection / orders (bubble listeners) never see them; a press that began in a mode ends in it whatever order the browser fires `contextmenu` / `pointerup`. Placement takes precedence (the brush is blocked while `hubPlacement.isPlacementActive()`). An owned press captures the pointer and is released on `pointercancel` / `lostpointercapture`, so a press released off the canvas never swallows a later click. Tests `terraform-basic.spec.ts` › "Brush input: armed mode, one owner per click" (incl. "a press released off the canvas (pointercancel) does not swallow the next click once disarmed"); verified in headless Chrome on `/play.html?host=local&scenario=w01`.
- **Found:** 2026-11-01, review (frontend features)

### FF-07 · Terraform hotkeys are global and ignore other modes

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** one `isHotkeyPress` / `isTypingTarget` guard and the `HOTKEYS` table (`features/shared/hotkeys.ts`, lists G C B V H Esc X Q E WASD F `` ` ``); the terraform keys ignore auto-repeat, text fields (incl. contenteditable) and an open Hub ghost; `O` no longer duplicates `V`. Test `terraform-basic.spec.ts` › "hotkeys ignore auto-repeat, text fields and an open Hub ghost; V toggles the overlay". `app/online/viewportHelper.ts` `isEditableTarget` (FRONTEND-APP) is a second copy of the guard: see the report. Follow-up: the copies are gone, see `frontend-app.md` FA-34.
- **Found:** 2026-11-01, review (frontend features)

### FF-08 · The overlay recomputes and rebuilds its DOM on every view, even when hidden

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `terraform-basic/TileOverlay.ts:135-152,278-332`, `index.ts:158-166`
- **What happens:** each view (5 Hz, more with prediction) scans every tile's prep and recreates up to 32 chip
  elements while the overlay is hidden. `extractColonyOrders` drops orders with zero remaining jobs, so the `'DONE'`
  label branch (`:302`) never shows.
- **Why it is like this:** the overlay was written as a pure function of the view, recomputed on each update.
- **Workaround / mitigation:** the chip list is capped at 32.
- **To resolve:** skip work while hidden; diff chips; drop the dead branch or keep finished orders.
- **Fix:** while hidden a view only refreshes the active order (`activeOrderOf`), the full state is computed on demand, chips are reused (no rebuild), the dead `'DONE'` branch is gone; `TileOverlay.ts`. Test `terraform-basic.spec.ts` › "keeps the active order current but builds no chips until shown; chips are reused between views".
- **Found:** 2026-11-01, review (frontend features)

### FF-09 · Terraform CANCEL after a stroke cancels nothing

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (code trace)
- **Area / code:** `TerraformMenu.ts:82-86`, `BrushController.ts:241,300,332`
- **What happens:** the button is enabled by `lastStroke`, and when the overlay shows no active order it sends the
  client-made id `tf_stroke_N`. The `enqueueTask` sent over the bus carries no task id, so the host never knows that
  id and the cancel is a silent no-op.
- **Why it is like this:** the client invents a task id for its own summary, but the bus command does not carry it.
- **Workaround / mitigation:** none; cancelling an order shown in the overlay uses the host id.
- **To resolve:** cancel by the host's `orderId` from the view only; disable the button when there is none.
- **Fix:** CANCEL sends only the host `orderId` of the active order in the view and is disabled when there is none; the client stroke id (`strokeId`) never goes on the wire. Test `terraform-basic.spec.ts` › "CANCEL is disabled until the host order is in the view and then cancels that order by its host id".
- **Found:** 2026-11-01, review (frontend features)

## Hub placement (`hub-placement`)

### FF-10 · Right-click to cancel the Hub ghost also sends the HQ walking there

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the placement controller binds through `bindExclusivePointer` (capture phase + `stopImmediatePropagation` while placing), so a right click / context menu cancels the ghost and never reaches `LandfallController`. Test `hub-placement-input.spec.ts` › "a right click cancels the ghost and never reaches the HQ order listener, in either browser event order".
- **Found:** 2026-11-01, review (frontend features)

### FF-11 · Esc cancels the ghost or also pauses, depending on listener order

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the placement Esc handler is a capture-phase window listener that calls `stopImmediatePropagation()` (same for the armed brush), so the session's pause handler never sees it, whatever the registration order (the FA-29 remount no longer reorders them). Tests `hub-placement-input.spec.ts` › "Esc closes the ghost without also pausing, whatever the listener order", `terraform-basic.spec.ts` (Esc disarm).
- **Found:** 2026-11-01, review (frontend features)

### FF-12 · Hub cost and HQ speed labels are literals, not the live balance data

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** button cost `formatCost(resolveHubCost(simData))` and the bill's `HQ n×` from `resolveHqT1Row(simData).workRate`; the HUD's shortfall uses `resolveHubCost(store.simData())` for `placeBuilding`; `HubPlacementMenu.ts`, `HubPlacementView.ts`, `hud-min/MinimalHud.ts`. Tests `hub-placement-input.spec.ts` › "the button cost and the HQ speed come from the tuned hub.t1 / hq.t1 rows", `hud-min.spec.ts` › "a shortfall is measured against the command it belongs to and the live hub.t1 cost".
- **Found:** 2026-11-01, review (frontend features)

### FF-13 · CANCEL ORDER stays enabled and its wildcard can cancel a terraform order

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `lastOrderId` is gone: CANCEL ORDER is enabled only for an open host order (`extractColonyConstructionOrders` now drops `completed` and `cancelled`) and always sends that order's id; no `'current'` wildcard. The sim side (wildcards never cross lanes, misses reject `unknown_entity`) was fixed by SIM-GAMEPLAY (GP-10). Tests `hub-placement-input.spec.ts` › "after a host reject there is no order to cancel…", "a completed Hub order is history…".
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
- **Fix (test only, behaviour unchanged):** `placement-parity.spec.ts` › "client and host agree on every tile for the Hub owner and for a colony with no HQ" compares `evaluatePlacement` on the replica view and the host state for colony 0 (with its Hub standing: `hubExists`, `occupied`) and colony 1 (no HQ: `noBuilder`), review-fix round 2026-11-01. The pre-landing green ghost stays by design.
- **Found:** 2026-11-01, review (frontend features)

### FF-15 · Two hover paths re-evaluate the ghost; magic numbers in the ghost

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the DOM `pointermove` hover path is gone; the only hover path is the renderer (`hub-placement/ghostRenderer.ts`), which picks when the pointer moves (and every `GHOST_IDLE_PICK_MS` = 150 ms while it rests) and re-evaluates only on a new tile; the footprint cells are rebuilt only when they change; H ignores auto-repeat; `TILE_M` imported from `@terra/render/planets/hex`; search radius `HUB_SITE_SEARCH_RADIUS`; the `12` radius fallback is derived from the tile count. Test `hub-placement-input.spec.ts` › "picks the tile under the pointer when it moves (not every frame)…".
- **Found:** 2026-11-01, review (frontend features)

### FF-16 · GhostRig3D leaks the archetype material

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `GhostRig3D.ts:45-58,90-94`; `frontend/render/kitbash/catalog.ts:56-64`
- **What happens:** `createArchetypeMesh` makes a new unified material per call; `tint()` replaces it with the ghost
  materials and the original is never disposed, and the old body is dropped without disposal on a biome change. The
  geometry is shared from the catalog cache (must not be disposed). `tint()` also traverses the body every frame.
- **Why it is like this:** the ghost reuses the real archetype mesh and swaps its material.
- **Workaround / mitigation:** small: one material per biome change.
- **To resolve:** dispose the replaced material once; tint only when validity changes.
- **Fix:** `GhostRig3D.tint(valid)` swaps materials only when the validity changes and disposes the archetype's own material when it is replaced (the catalog geometry is never disposed). Covered by the existing `hub-placement.spec.ts` › "3D placement ghost".
- **Found:** 2026-11-01, review (frontend features)

### FF-17 · A host reject loses its cause in the ghost

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** on a host reject the ghost re-evaluates the site on the newest view and shows its own block text when it agrees with the host code, else the host detail / code; `HubPlacementMenu.onServerReject`. Test `hub-placement-input.spec.ts` › "a bare host code is replaced by the ghost block text once the newer view shows the same cause".
- **Found:** 2026-11-01, review (frontend features)

### FF-18 · hub-placement leftovers

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** CSS merged into one set of rules (`hub-placement.css`); unused `billEl` / `cancelBtn` dropped; the menu is split into the controller `HubPlacementMenu.ts` (≈260 lines) and the DOM part `HubPlacementView.ts`; the 3D renderer moved to `ghostRenderer.ts`.
- **Found:** 2026-11-01, review (frontend features)

## Shared code across features

### FF-19 · A test-only DOM shim ships in production code, twice

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** both `dom.ts` shims are deleted; feature specs that need a DOM run under jsdom (`// @vitest-environment jsdom`, no vitest config change) with real `MouseEvent` / `KeyboardEvent`; the spec `FakeElement` copies in `hud-min.spec.ts` and `landfall.spec.ts` are gone (`landfall-scene.spec.ts` keeps the 3D tests in Node); `makeDiv` / `makeBtn` / `setDataAttr` live in `features/shared/dom.ts`. `app/online/bootFlow.spec.ts` (FRONTEND-APP) still has its own `FakeElement`: see XC-05.
- **Found:** 2026-11-01, review (frontend features)

### FF-20 · View parsing and input helpers are copied between features

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** entity rows read with `forEachEntity` / `EntityRow` from `viewCodec.ts` (GhostEvaluator, landfall); one `viewColony` (`shared/colony.ts`) and one HQ reader `extractHqFromView` (`shared/hqView.ts`) used by the HUD cell and the HQ panel; one pointer-to-tile helper `resolvePointerTile` (`shared/pointer.ts`) for placement, brush and landfall; one keyboard guard (`shared/hotkeys.ts`); one `InProcessHost` interface (`shared/commandDispatch.ts`); one `clampPct` (`shared/dom.ts`); one view → `PlacementWorld` adapter (`shared/placementWorld.ts`) for the ghost and the brush.
- **Found:** 2026-11-01, review (frontend features)

## HUD top bar and toasts (`hud-min`)

### FF-21 · The top bar is not a chamfered plate (undefined tokens)

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the bar's backdrop uses the `.plate-sm` polygon with `--ta-chamfer-s`; the narrow-screen size uses `--ta-fs-label`; the raw toast shadow is gone (it was clipped by the `.plate-sm` clip-path anyway). Token check: `features/shared/designTokens.spec.ts` (every `var(--ta-*)` in feature CSS exists in `frontend/design/css`; no `border-radius`, no hard-coded design-system font).
- **Found:** 2026-11-01, review (frontend features)

### FF-22 · Reject toasts: wrong shortfall, misleading texts, no compile-time coverage of reject codes

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `REJECT_TEXT: Record<RejectCode | 'timeout' | 'not_connected', string>` (it caught the new `queue_full` / `planet_full`), kind-specific wording in `REJECT_TEXT_BY_KIND` (`invalid_args`, `worker_tier_locked`, `queue_full`); the shortfall line only with the command's real cost (Hub: live `hub.t1.cost`), else `Waiting: Insufficient resources`; one toast per reject cause (the transport's kind-less toast is updated by the menu's verdict); one resource-label table `RESOURCE_LABELS` (`shared/resources.ts`) for HUD, toast and menu; `hud-min/rejectText.ts`. Tests `hud-min.spec.ts` (acceptance through the command bus and the menu; "every RejectCode has its own text"; per-kind texts).
- **Follow-up (final pass 2026-11-01, GP-30):** the sim never rejects for cost any more (an unaffordable Hub is accepted and waits in `waiting_resources`), so the shortfall line ("Waiting: Metals 0/200") and its cost lookup (`costOfKind`, `formatRejectToast`'s `stock` / `cost` arguments, `MinimalHud.getColonyStock`) are removed as dead code; `insufficient_resources` keeps its generic text. The W01-29 acceptance test now places an unaffordable Hub on a real host: no reject toast, the Hub panel reads `commandHub: waiting(resources: metals.t1 0/200)` (`hud-min.spec.ts` › "acceptance: a Hub placed without enough resources is accepted and waits (GP-30)…"). The FF-12 live-cost labels (button cost, HQ speed) are unchanged.
- **Found:** 2026-11-01, review (frontend features)

### FF-23 · Magic numbers in the HUD and HQ panel

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** clock from `TICKS_PER_SECOND`; HUD and panel show `—` until a view carries the value (no `800 / 800 E` / `900 / 900` placeholders); missing maxima come from the `hq.t1` row (live data when the store has it); `extractHqFromView` returns `null` instead of inventing entity id 1. Tests `hud-min.spec.ts` › "shows placeholders until the first view…", `landfall.spec.ts` › "a view with HQ metadata but no entity id names no HQ".
- **Later (2026-11-03, econ-sync review, left as is):** `shared/hqView.ts` (`extractHqFromView`, `cell: extras.cell ?? meta?.cell ?? cellMax`) still shows a **full** cell when a packed client view has the HQ entity but no `col.hq` / `blobs.hq` record (the packed entity buffer has no `cell` column). The sim writes `col.hq` on the HQ's first step (`syncHqView` from `stepHq`), so this lasts at most one view; showing `—` would need `HqStatusView.cell` to become optional for both panels.
- **Found:** 2026-11-01, review (frontend features)

### FF-24 · HUD accessibility basics

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `MinimalHud.ts:167-169,353-377`, `:205-249`; `hud-min/hudIcons.ts`
- **What happens:** the toast container has no `role="status"` / `aria-live`, so rejects are not announced. Toasts
  are clickable `div`s (no keyboard dismiss). Metals, Minerals and Supply show an icon and a number only, named by
  `title` (Bio has an sr-only label). The HQ select badge has no `aria-pressed`.
- **Why it is like this:** not part of the W01 acceptance.
- **Workaround / mitigation:** tooltips on hover.
- **To resolve:** `aria-live="polite"` on the container, sr-only names for every stock, `aria-pressed` on the badge.
- **Fix:** toast container `role="status"` + `aria-live="polite"`; toasts are `<button>`s (click / Enter dismiss); every stock and the power cell have an sr-only name; the HQ badge carries `aria-pressed`. Tests `hud-min.spec.ts` › "announces toasts politely…", `landfall.spec.ts` (aria-pressed).
- **Found:** 2026-11-01, review (frontend features)

### FF-25 · Dead code in the HUD and the features root

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (grep: no importer; `tsc --noUnusedLocals`)
- **Area / code:** `frontend/game/features/define.ts`, `frontend/game/features/index.ts` (the registry loads
  `features/*/index.ts` by glob; nothing imports these two); `MinimalHud.ts:138` (`latestTick` written, never read),
  `MinimalHud.ts:15` (`sendCommand` option unused); toast timers are not cleared on `dispose`
- **What happens:** two barrel files and a few members nobody reads; pending toast timers fire after `dispose` and remove detached nodes (harmless).
- **Why it is like this:** left from earlier iterations.
- **Workaround / mitigation:** none needed.
- **To resolve:** delete the two barrels and the unused members.
- **Fix:** `features/define.ts` and `features/index.ts` deleted; `latestTick`, the `sendCommand` option and the unused `onCommandOutcome` / `notifyCommandResult` removed; toast timers are tracked and cleared on `dispose`. Test `hud-min.spec.ts` › "dispose clears pending toast timers".
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

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `landfall/selection.ts:64-69`; `shared/sim/src/ecs/columns.ts:41-50`
- **What happens:** the literal `3` is `ENTITY_STATE.descending`, not a construction state; `waiting` (7) and
  `active` (5) show as `idle`. Today descending HQs are filtered out before the call, so only the exported helper is
  wrong.
- **Why it is like this:** state code `3` was probably meant as a construction state before `ENTITY_STATE` was final.
- **Workaround / mitigation:** none needed today.
- **To resolve:** drop the literal; map `waiting` explicitly (e.g. "waiting").
- **Fix:** no literal `3`: `hqJobFromStateCode` maps moving / working / constructing and `waiting` → `'waiting'` (panel type `HqPanelJob = HqJob | 'waiting'`), anything else (descending included) → idle. Test `landfall.spec.ts` › "maps every entity state the panel can see…".
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
- **Partly done (review-fix round 2026-11-01):** the unused view-sync path (`syncTerritoryBordersFromView`, and its zero-height fallback) is removed: `update()` only re-applies the pattern to the current terrain (`services.hexTerrain`, a live getter from the session, e.g. after a planet change) and refreshes the label; the choice is persisted per browser (`localStorage` `terra.borderHatch`) and applied on mount; `border-hatch` stays in the console. There is no settings / accessibility menu yet, so the `BORDER: SOLID / HATCH` button stays in the top-right HUD (conservative variant); moving it waits for that menu. `territory-border/index.ts`; tests `territory-border.spec.ts` ("update() never redraws the ground", "remembers the hatch choice per browser").
- **Found:** 2026-11-01, review (frontend features)

## Dev console commands (`dev-console`)

### FF-29 · Resource aliases are copied from the sim

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the sim copy is gone (SIM-GAMEPLAY); the console's aliases are derived from the one label table (`RESOURCE_ALIASES` in `shared/resources.ts`: lower-cased one-word labels). Test `dev-console.spec.ts` › "grant accepts the one resource alias table".
- **Found:** 2026-11-01, review (frontend features)

### FF-30 · `tp` and `land` accept more than DEV_TOOLS documents; partial coordinates are ignored

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `dev-console/commands.ts:68-95`; `docs/dev/DEV_TOOLS.md:68-69`
- **What happens:** help says `tp [id] <q> <r>` and `land [q r]`; DEV_TOOLS lists only `tp <q> <r>` and `land`.
  `land 5` (one coordinate) silently lands on the default slot. `tp` parses with `numArg`, so `tp 1.5 2` reaches the
  host and comes back as `invalid_args` instead of the console's own "must be a whole number".
- **Why it is like this:** the forms were added to the commands after the doc line was written.
- **Workaround / mitigation:** none.
- **To resolve:** document the id / coordinate forms; reject a single coordinate; use `intArg` for tiles.
- **Fix:** `tp` parses id / q / r with `intArg`, `land` rejects a single coordinate and non-integers; help and DEV_TOOLS document `tp [id] <q> <r>` and `land [q r]`. Tests in `dev-console.spec.ts` (`tp`, `land`).
- **Found:** 2026-11-01, review (frontend features)

## Cross-area findings (added by the lead)

### FF-31 · Two feature stylesheets hard-code the mono font

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/**/netstats.css`, `frontend/game/**/tick.css` (`font-family: 'IBM Plex Mono'`)
- **What happens:** they bypass `--ta-font-mono` from the design tokens, so a font change in the design system misses them.
- **To resolve:** use `var(--ta-font-mono)`.
- **Fix:** `netstats.css`, `tick.css`, `flags.css`, `warp.css` use `var(--ta-font-mono)` / `var(--ta-font-display)`; guarded by `designTokens.spec.ts`.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)

### FF-32 · Net stats "last correction" is never updated since the W00 entity layer was retired

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (grep: `recordCorrection` has no caller)
- **Area / code:** `frontend/game/net/netStats.ts:13` (`recordCorrection`), formerly called by `features/entities/EntityLayer.ts` (deleted for XC-07); `app/online/EntityMeshes.ts` / `entityMotion.ts` (the one renderer now)
- **What happens:** the dev net-stats overlay shows "last correction in tiles" = 0 forever: `EntityMeshes` follows confirmed / predicted poses with its own `MotionTrack` and does not report the size of a correction.
- **Why it is like this:** the W00 layer was the only renderer that measured corrections (its `PoseBlender`); retiring it (XC-07, owner recommendation) removed the only caller.
- **Workaround / mitigation:** rollbacks are still counted; DEV_TOOLS says the field is always 0.
- **To resolve:** (FRONTEND-APP) have `EntityMeshes` report the jump of a predicted pose that the confirmed view moves (`netStats.recordCorrection(tiles)`), or drop the field.
- **Found:** 2026-11-01, review-fix round (frontend features, XC-07 follow-up)
- **Fix (final pass 2026-11-01):** `MotionTrack.push` returns how far it moved a sample it replaced at the same tick (a predicted pose the confirmed view overrides; 0 for a new or identical sample); `EntityMeshes.syncView` reports the largest one of a view through `onCorrection`, which `createUnitControl` wires to `netStats.recordCorrection` (next to `recordRollback`). Tests `entityMotion.spec.ts` › "push reports how far a same-tick sample was corrected…", `landfall-scene.spec.ts` › "FF-32: net stats correction from the renderer", `OnlineSession.lifecycle.spec.ts` › "FF-32: a pose correction of the renderer reaches the net stats overlay figure".

### FF-33 · An area brush over more than 256 tiles is sent and rejected as a whole

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (contract `enqueueTask.terraform.tiles` max 256)
- **Area / code:** `frontend/game/features/terraform-basic/BrushController.ts` (`strokeArea`), `shared/contracts/src/commands/enqueue-task.ts`
- **What happens:** a drag box larger than 256 tiles (e.g. 17 × 16) is sent as one command; the host rejects it `invalid_args` and the toast says `Rejected: Invalid terraform order`. The preview line still counts the box's jobs.
- **Why it is like this:** the brush has no size limit of its own and the contract's limit is not exported as a constant.
- **Workaround / mitigation:** drag smaller boxes.
- **To resolve:** validate the args with `parseCommandArgs('enqueueTask', …)` before sending (or export the limit) and show "Area too large" in the status line without sending.
- **Fix:** the brush validates its args with `parseCommandArgs('enqueueTask', …)` before sending; a box over the limit is not sent and the status line reads `Area too large: N tiles, nothing sent`; `BrushController.ts`, `TerraformMenu.ts`. Test `terraform-basic.spec.ts` › "a box larger than one command may carry is not sent".
- **Found:** 2026-11-01, review-fix round (frontend features)

## W02 First Light review fixes (`hud-min`, `resources-hud`, `construction-menu`, `units-menu`, `queue-panel`, `landfall`)

### FF-34 · Duplicate top resource headers and clipped hover tier breakdowns

- **Status:** Resolved (W02 review-fix 2026-11-02)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/hud-min/MinimalHud.ts`, `frontend/game/features/hud-min/resourceBreakdown.ts`, `frontend/game/features/resources-hud/index.ts`, `frontend/game/features/resources-hud/resources-hud.css`
- **What happens:** both `hud-min` and `resources-hud` registered a `top-center` HUD panel, stacking two resource headers; `MinimalHud` lacked tier breakdown popovers and `.ta-resources-hud` had a direct `clip-path: polygon(...)` that clipped its `position: absolute; top: calc(100% + 6px)` `.ta-res-chip__breakdown` popover.
- **Fix:** `resources-hud/index.ts` exports `hud: []` (keeping `ResourcesHud` exported for unit tests with its chamfer moved to `::before`), and `MinimalHud` (`hud-min`) is the single tight-to-top resource header (`ta-hud-min ta-resources-hud`) with unclipped `.ta-res-chip__breakdown` popovers showing per-tier stocks plus live `Income: +X/s`, `Spending: -Y/s`, and `Net: +Z/s` (`resourceBreakdown.ts`).
- **Found:** 2026-11-02, owner review (W02)

### FF-35 · Overloaded left/right HUD panels consolidated into a collapsible tabbed Command Dock

- **Status:** Resolved (W02 review-fix 2026-11-02)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/core/hud/CommandDock.ts`, `frontend/game/core/hud/HudRoot.ts`, `frontend/game/core/hud/hud.css`, `frontend/game/features/hub-placement/index.ts`
- **What happens:** `construction-menu`, `units-menu`, `terraform-basic`, and `queue-panel` stacked separately across `bottom-left` and `bottom-right`.
- **Fix:** `CommandDock` mounts those panels into one collapsible (`HIDE` / `SHOW`) tabbed `.ta-command-dock` in `bottom-left` with `BUILD [B]`, `PRODUCTION [U]`, `TERRAFORM [T]`, and `QUEUE` tabs; `hub-placement`'s W01 HUD panel is suppressed when `W02` is active.
- **Found:** 2026-11-02, owner review (W02)

### FF-36 · Building and unit cards rebuilt via `replaceChildren()` on every 5 Hz view tick

- **Status:** Resolved (W02 review-fix 2026-11-02)
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/construction-menu/ConstructionMenu.ts`, `frontend/game/features/units-menu/UnitsMenu.ts`, `frontend/game/features/queue-panel/QueuePanel.ts`
- **What happens:** calling `replaceChildren()` on every `update(view)` destroyed `<button>` elements between `pointerdown` and `pointerup`, flashing `:hover` orange and swallowing single clicks.
- **Fix:** `ConstructionMenu`, `UnitsMenu`, and `QueuePanel` retain card/lane DOM elements across updates and mutate attributes/text in place; `ConstructionMenu` also handles left-button `pointerdown` with click deduplication.
- **Found:** 2026-11-02, owner review (W02)

### FF-37 · Solar Array (`waiting: site (tile occupied)`) and Metal Extractor map placement & doubled error text

- **Status:** Resolved (W02 review-fix 2026-11-02)
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/construction-menu/PlacementGhost.ts`, `frontend/game/features/construction-menu/ghostRenderer.ts`, `frontend/game/features/construction-menu/index.ts`, `frontend/game/features/construction-menu/construction-menu.css`
- **What happens:** `PlacementGhostController` had no 3D ghost renderer, no map `pointermove`/click binding, and `evaluatePlacementGhost` did not check tile occupancy (`entities` / `tiles.anchors` / queued builds), so `solar` queued at `(0, 0)` (occupied by the Command Hub) and waited on `site (tile occupied)`, while `metalsExtractor` could not be placed on ore on the map and showed `'must cover a metals deposit'` twice.
- **Fix:** added `collectOccupiedTileIndices`, `findValidPlacementSite` (snapping initial ghost to the nearest valid free or `DEPOSIT.metals` site), 2×2 deposit-anchor offset snapping on hover, `construction-ghost-3d` (`ghostRenderer.ts`), `bindExclusivePointer` map click/right-click handling, and hid `.ta-placement-ghost__deposit[data-covered='false']` in CSS so the rejection reason renders once.
- **Later:** `collectOccupiedTileIndices` no longer reads `tiles.anchors` (the territory claim count, not occupancy): see `sim-gameplay.md` GP-47.
- **Found:** 2026-11-02, owner review (W02)

### FF-38 · Selected unit / building bar layout, empty-ground deselect, Harvester selection, and 3D unit health bars

- **Status:** Resolved (W02 review-fix 2026-11-02)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/landfall/HqPanel.ts`, `frontend/game/features/landfall/selection.ts`, `frontend/game/features/landfall/landfall.css`, `frontend/game/app/online/unitHealthBars.ts`, `frontend/game/app/online/EntityMeshes.ts`, `shared/sim/src/systems/harvest/index.ts`
- **What happens:** the selection card sat in `top-left` even with nothing selected, clicking empty ground did not deselect, Harvester robots (`ENTITY_KIND.harvester`) could not be selected or commanded (auto-harvest immediately overwrote player moves), and units had no 3D health bars.
- **Fix:** moved `.ta-hq-panel` to a compact horizontal bottom-center bar (`hidden` when nothing is selected, with a multi-select unit grid slot + count badge ready for future box/Shift multi-selection), added empty-ground deselection, enabled Harvester & building selection + `moveUnit`/`stopUnit` orders (with `standingHarvestAssignSystem` yielding to active/queued `UnitBook` orders), and added `UnitHealthBars` (`unit-health-bars`) rendering a single camera-aligned 3D health bar sized to unit width above each unit.
- **Found:** 2026-11-02, owner review (W02)

### FF-39 · Units walking or spawning inside buildings and Solar Arrays working at night

- **Status:** Resolved (W02 review-fix 2026-11-02)
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/placement.ts`, `shared/sim/src/grid/pathProfiles.ts`, `shared/sim/src/units/mobility.ts`, `shared/sim/src/systems/units/handlers.ts`, `shared/sim/src/systems/factories-hub/index.ts`, `shared/sim/src/systems/queue/index.ts`, `shared/sim/src/systems/economy/construction.ts`, `shared/sim/src/systems/power-core/index.ts`, `frontend/game/features/landfall/selection.ts`
- **What happens:** `OCCUPYING_KINDS` only included `commandHub`, `ENTITY_KIND.harvester` used `profile: 'none'`, `queueSystem` spawned completed Harvesters at `(0, 0)` inside the Command Hub, `moveUnit` and `LandfallController.orderMove` allowed targeting building footprint tiles, and Solar Arrays did not record `offline: night` at night.
- **Fix:** added `metalsExtractor` and `solar` to `OCCUPYING_KINDS`, added the `'harvester'` path profile blocking building footprints and water/holes/ridges, rejected `moveUnit` onto any building tile on both server (`handlers.ts`) and client (`selection.ts`), routed `queueSystem` unit completions through `spawnHarvesterAtHubEdge`, evacuated units standing on newly placed building footprints, and marked Solar Arrays `offline: night` (`0` generation) when `phase === 'night' || daylight <= 0.001`.
- **Found:** 2026-11-02, owner review (W02)


### FF-40 · CANCEL JOB on a unit card: repair jobs and shared-order scope

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/landfall/{HqPanel,selectionHelpers}.ts`, `shared/sim/src/systems/queue/cancel.ts`
- **What happens:** CANCEL JOB is shown for any busy unit and whenever the unit's current/queued command is `terraform` or it owns a work job (`unitHasTerraformJob`); it sends `cancelTask { taskId: 'harvester:<id>' }`, which now also removes the terraform order the unit works on (a Hub's linked prep cancels its construction order). There is no repair job in the sim, so none is detected. Cancelling removes the whole order (all its tiles), not only the unit's current tile, and other units on the same order stop too.
- **Found:** 2026-11-02, W02 review


### FF-41 · WORK on a tree an HQ Drone cannot walk next to ends with a no-path toast; no pre-check, no tree-by-tree approach

- **Status:** Resolved (terraform rework 2026-11-02: the owner chose auto-chaining; a TERRAFORM click on a forest edge now eats the clump tree by tree, nearest first, GP-43)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/{dismantleAndWork,unreachable}.ts`, `frontend/game/features/terraform-basic/BrushController.ts`
- **What happened:** the HQ Drone uses the `ground` path profile (forest blocks it) and must stand within 2 tiles of the work tile. A tree inside a forest clump has no walkable tile in that band, so the path request failed and `workJobsSystem` re-requested it every few ticks forever: the order was accepted (`ok`) and nothing ever happened. Trees on the edge of a clump, or reached by a Harvester (profile `harvester` crosses forest), worked.
- **Now:** a work job whose route to the band fails is dropped and the worker's `lastFailure` is set to `no_path` (the existing unit-failure toast). Test: `shared/sim/test/systems/work-forest-click.spec.ts`.
- **Left open:** the client still sends the click (no reachability pre-check at enqueue, so no immediate reject); the player has to clear a clump from its edge inward or build a Harvester. Owner decision: let the drone fly over trees, or stand off further, or auto-chain the edge trees.
- **Brush notes:** (obsolete) Ctrl+click multi-add, the hover hex marker and the area brush were removed in the terraform rework (FF-42).
- **Found:** 2026-11-02, owner review (W02)

### FF-42 · Terraform dialog rework: TERRAFORM [G] / REPAIR [R] / DISMANTLE [Z]

- **Status:** Accepted (owner, 2026-11-02)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/terraform-basic/{TerraformMenu,BrushController,primaryOps,groundPreview,referenceTables,workStatus,resourceFound}.ts`, `frontend/game/features/shared/{hotkeys,pointer,depositLabel}.ts`, `frontend/game/core/hud/CommandDock.ts`, `frontend/game/features/landfall/{HqPanel,selectionHelpers}.ts`
- **What happens:** three buttons, TERRAFORM on top; each click sends one `enqueueTask { terraform: { op: 'work' | 'dismantle', intent?, tiles: [{q,r}], workerId? } }` and disarms the tool; the sim chains terraform (GP-43). Ctrl+click multi-add, the area brush, the 3D hover marker and brushed-tile marks are gone; the S0 grade/clear/break hotkeys are dropped (`strokeTile(q, r, { op })` still sends them from code). G / R / Z arm only while the Terraform tab is open (no invisible armed tool); right-click disarms and passes through to the map. The preview uses the sim's own helpers (parity test against `enqueueWorkAtTile` on every tile). Host rejects are matched to the brush's own command. A `resourceSpawned` toast and a deposit tier on the deposit card announce finds; reference tables read sim data.
- **Defaults picked:** `F` is the camera follow-HQ key, so TERRAFORM is `G`; `R` is shared with the ghost rotate (the brush is blocked while a ghost is up); DISMANTLE moved from `X` to `Z` and `X` only stops the unit (owner). `workerId` is sent only for a selected own, alive HQ Drone / Harvester.
- **To resolve:** the plan's area brush (W01-27, W05-20, units spec §4.5 menu row) comes back in W05.
- **Found:** 2026-11-02, terraform rework

### FF-43 · `Q` toggles both the queue panel and the camera rotation

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/queue-panel/QueuePanel.ts:123`, `frontend/game/app/RTSCamera.ts`, `frontend/game/features/shared/hotkeys.ts`
- **What happens:** pressing `Q` collapses / expands the queue lane and rotates the camera left at the same time.
- **Why it is like this:** older than the terraform rework; found in its review, behaviour left unchanged.
- **To resolve:** owner picks one meaning for `Q` (queue panel has a mouse toggle; the camera has `Q`/`E` as a pair).
- **Found:** 2026-11-02, terraform rework review

### FF-44 · The client keeps its own copy of entity base costs for REPAIR / DISMANTLE previews

- **Status:** Resolved (terraform rework review 2026-11-02: `getEntityBaseBuildCost` is exported from `@terra/sim` and `planner.resolveEntityBaseCost` reads it with the store's sim data; the client table is gone)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/terraform-basic/planner.ts` (`resolveEntityBaseCost`), `shared/sim/src/systems/terraform-basic/dismantleAndWork.ts` (`getEntityBaseBuildCost`, not exported)
- **What happens:** the REPAIR cost / DISMANTLE refund shown in the status line come from a partial client cost table (its Solar 60/30 differs from the data row 60/75/10/5); the host charges the real cost.
- **To resolve:** export `getEntityBaseBuildCost` from `@terra/sim` and read it with the store's sim data.
- **Found:** 2026-11-02, terraform rework review


### FF-45 · `/play.html?planet=<kind>&skip=1` boots with no terrain

- **Status:** Open
- **Severity:** medium
- **Confidence:** PLAUSIBLE
- **Area / code:** `frontend/game/main.ts` / `frontend/game/app/online/` boot path (not investigated)
- **What happens:** the prototype jump-in URL from CLAUDE.md ("Game flow QA") shows a grey haze and no planet surface on all three planets; it seems to wait for the online flow. Seen by the wind and water agents in headless Chrome while checking the 2026-11-02 water rework; it was already like this before those changes.
- **Workaround / mitigation:** use `/play.html?host=local&scenario=w02` or `/playground.html?hexterrain=1&biome=oceanForest` / `?surface=1` for visual checks.
- **To resolve:** find which boot step the `skip=1` prototype path now depends on, or update CLAUDE.md if the prototype path is retired.
- **Found:** 2026-11-02, water rework (wind / water agents)

### FF-46 · The grid widget hid a shed consumer's draw, read colony 0, and its brownout banner was barely legible

- **Status:** Resolved (2f1f2c1)
- **Severity:** high
- **Confidence:** CONFIRMED (headless probe on `?host=local&scenario=w02` and `?scenario=w02`)
- **Area / code:** `frontend/game/features/power-hud/PowerHud.ts` (`update`, `updatePowerReadout`, `updateBrownout`,
  `findTargetEntity`), `frontend/game/features/hud-min/resourceBreakdown.ts` (`renderPowerBreakdown`),
  `frontend/game/features/shared/power.ts` (new: `readColonyPower`, `gridBalance`), `power-hud/power-hud.css`
- **What happens:** with only the Command Hub (+8 supply, −5 drain) an Extractor (−6) is shed at once
  (`rawDemand 11 > supply 8` → `offlineBrownout`). The sim's `demand` / `net` are post-shed, so the widget kept showing
  `+8 / −5 E/s · +3 E/s` in green and the Extractor's −6 E/s never appeared anywhere; next to the HQ cell chip
  (`200 / 200 E`, FF-47) the owner read "energy is still full". The widget also read `colonies[0]` /
  `blobs.power.byColony[0]` whatever the player's seat (a guest on `pl_dev` is colony 1+), its fallback inspector
  took the first building of any colony, it hard-coded the entity stride `12`, the banner named "group 3" even when
  nothing was shed, and the banner background was a 20 % raw-rgba red over the 3D terrain.
- **Fix (2f1f2c1):** one reader `readColonyPower(view, ownColonyIndex(...))` (`features/shared/power.ts`) for the
  brownout banner and the top-bar breakdown; `gridBalance` reports **requested** demand (`rawDemand`), the shed E/s
  and the net against the requested demand. The top-right `+8 / −11 E/s` balance widget described in the first
  version of this fix is gone (FF-50 removed it on the owner's request). The grid numbers now live in two places: the
  energy chip's hover in the top bar (`resourceBreakdown.ts` `renderPowerBreakdown`: `HQ Cell: 200 / 200 E`,
  `Income (Supply): +8 E/s`, `Spending (Demand): −11 E/s`, `Net: −3 E/s`, and a `Brownout: 6 E/s offline` line shown
  only while consumers are shed), and the brownout banner top right (`PowerHud.updateBrownout`:
  `BROWNOUT — SHEDDING GROUP n · 6 E/s OFFLINE`, or `BROWNOUT — DEMAND OVER SUPPLY` with no shed group; background the
  plate tinted with `--ta-fault`, opaque). Inspector rows via `forEachEntity`, own colony only. Tests
  `power-hud.spec.ts`, `hud-min.spec.ts` › "Top-bar power breakdown…", `shared/power.spec.ts`; e2e `w02.spec.ts`
  step 1 (hover `+8` / `−5` / `+3` with no shed consumer).
- **Default chosen (owner may change):** `Spending (Demand)` is requested demand, not the post-shed demand the grid
  actually carries; the alternative is `−5 E/s (6 shed)`.
- **Left:** the prototype `GameHud` (`frontend/game/ui/hud.ts:96,103-105`, `?planet=` path) still reads `colonies[0]`
  and `byColony[0]`: FF-60.
- **Found:** 2026-11-03, owner report ("extractor spends 6 E/s, energy is still 200/200"), econ-sync review

### FF-47 · The top bar's energy chip is the HQ drone's power cell, not the colony grid

- **Status:** Resolved (7e901d5): the chip is now truthfully the colony's first energy store and drains at night (GP-66)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/hud-min/MinimalHud.ts` (constructor `cellEl`, `update`),
  `frontend/game/features/shared/hqView.ts` (`extractHqFromView`)
- **What happens:** the only energy number in the top resource bar is `⚡ 200 / 200 E` (W02 scenario; 800 elsewhere):
  the HQ cell, a store that only terraform work draws (`shared/sim/src/systems/hq/cell.ts`). Buildings draw grid flow
  (E/s, `colony-economy-and-buildings-spec.md` §2), which since FF-50 is shown only in this chip's hover and the brownout banner (the top-right widget's balance bar was removed on the owner's request). Building or shedding an
  Extractor never moves the top-bar number, so it reads as "energy is full" during a brownout. The chip says what it is
  only in its tooltip / screen-reader label.
- **Why it is like this:** W01 had no grid; the cell chip predates power-core (W02).
- **Workaround / mitigation:** its hover breakdown now shows the grid (`Spending (Demand)`, `Brownout: N E/s offline`,
  `Net`), and the brownout banner names the offline E/s (FF-46). ~~the top-right widget shows the deficit~~ removed (FF-50).
- **To resolve (owner pick):** (a) keep the cell, but label it `CELL` with the HQ icon so it does not read as colony
  energy; (b) replace it with the grid balance (`+8 / −11 E/s`, red in a brownout) and leave the cell to the HQ panel;
  (c) show both, grid first. Recommendation: (b), the cell is a unit stat already shown in the HQ panel.
- **Owner decision pending (W02 review round 1, 2026-11-03):** kept as is in 2f1f2c1 and 58956ab: the chip is still
  the HQ cell (`MinimalHud` `cellEl`, `data-testid="hud-hq-cell"`), and the e2e (`tests/e2e/w02.spec.ts` step 1) and the
  W02 check guide read the grid balance from its hover. This is an explicit owner pick for the W02 owner check; FF-50's
  trade-off (no always-visible grid number) depends on the same answer.
- **Found:** 2026-11-03, econ-sync review

### FF-48 · An Extractor on a Hub-only grid is shed at once; nothing says so before it is placed

- **Status:** Resolved (7e901d5): after the retune one Extractor fits a Hub-only grid (+9 E/s headroom)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/construction-menu/catalog.ts` (`formatPower`), `ConstructionMenu.ts`;
  balance in `shared/sim/src/data/hub.ts` (`founderCoreGenPerS 8`, `powerDrainPerS 5`) and
  `shared/sim/src/data/economy-t1-basic.ts` (`metalsExtractor.powerDrainPerS 6`)
- **What happens:** the Hub leaves +3 E/s headroom; the first Extractor (−6 E/s) completes, goes `offline: brownout`
  and never produces until a Solar Array is built. The build card shows `−6 E/s` but not the colony's headroom, so the
  player pays 65/20/10 for a building that is off from the first tick. The W02 e2e story builds Solar first.
- **Why it is like this:** by the balance rows; the client only shows sim numbers.
- **To resolve (owner pick):** (a) intended: add a hint on the card / ghost such as `grid short by 3 E/s` from the
  current `col.power` (display only); (b) rebalance so one Extractor runs on the Hub alone (sim data change).
- **Found:** 2026-11-03, econ-sync review

### FF-50 · Top-right power widget bar removed; planet time of day moved into the top resource bar; deposit card de-duplicated

- **Status:** Open (owner request 2026-11-03; one follow-up for the owner)
- **Severity:** low
- **Confidence:** CONFIRMED (specs + headless screenshots)
- **Area / code:** `frontend/game/features/hud-min/MinimalHud.ts` (`daytimeEl`, `renderDaytime`), `hud-min.css`
  (`.ta-hud-min__daytime*`), `frontend/game/features/shared/daytime.ts` (new: `readDaytime`),
  `frontend/game/features/power-hud/PowerHud.ts` + `power-hud.css` (bar, clock and balance removed),
  `frontend/game/features/landfall/HqPanel.ts` (`renderDeposit`) + `landfall.css`, `tests/e2e/w02.spec.ts`
- **What changed:** (1) the top-right plate (`☀ 06:27 100%` + `+8 / −5 E/s +3 E/s`) is gone; the planet clock
  (sun / moon, `HH:MM`, daylight %) is a chip in the top bar right after the energy chip, before the session clock;
  it reads the player's colony power summary (`phase`, `clockText`, `daylight`), else `blobs.environment`. The brownout
  banner and the building inspector stay in the top-right slot (shown only when relevant). (2) The selected-deposit
  card showed its stage twice (orange count badge + footer) and its reserves twice (`DEPOSIT RESERVES` key and a
  `DEPOSIT RESERVES: 500 / 500 LEFT` value in a fixed 96 px column, which overflowed into the footer coordinates):
  it now shows the stage once (footer), `RESERVES` / `500 / 500`, and the stat column grows with its text.
- **Trade-off / question:** with the balance bar gone, the colony grid balance (`+supply / −demand E/s`, the deficit)
  has no always-visible number: it is in the energy chip's hover and in the brownout banner. Together with FF-47
  (the chip shows the HQ cell), option (b) there, the grid balance in the chip, would restore it.
- **Found:** 2026-11-03, owner HUD request

### FF-49 · The power widget's inspector ignores the player's selection

- **Status:** Resolved (2f1f2c1)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/power-hud/PowerHud.ts` (`selectEntity`, `updateBuildingInspector`),
  `power-hud/index.ts` (`GameView.selectedEntityId` declared, never set)
- **What happens:** nothing calls `PowerHud.selectEntity` and no view carries `selectedEntityId`, so the inspector
  shows the first shed building (or nothing). Clicking a building shows its state in the bottom selection bar
  (`landfall/selectionHelpers.ts`, incl. `offline: brownout`), not here.
- **To resolve:** either wire it to `services.landfall.onChange` or drop the inspector's selection path and keep it as
  a "shed buildings" list.
- **Found:** 2026-11-03, econ-sync review
- **Fix (2f1f2c1):** `PowerHud.bindSelection` subscribes to `services.landfall.onChange` on the first `update` that
  sees the landfall service: a selected own building is inspected, else the first shed one (units are ignored). Open
  for the owner: the inspector now repeats what the bottom selection bar already shows for that building (state incl.
  `offline: brownout`); keep both, or drop one. The subscription is made once and goes stale if the landfall feature
  remounts: FF-58.

## W02 review rounds 1–2 (2026-11-03)

### FF-51 · `?waves=..01` still shows W02 pieces in the dock and the 3D view

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED (code trace; reported by the frontend agent, round 1)
- **Area / code:** `frontend/game/core/hud/CommandDock.ts:30` (`hub-placement` gets the BUILD tab when W02 is off), `frontend/game/features/terraform-basic/index.ts:251` (`wave: 'W01'`, but holds the terraform rework of FF-42: TERRAFORM `work`, REPAIR, DISMANTLE, reference rows), `frontend/game/features/hud-min/MinimalHud.ts` (`bindHoverPopover` tier popovers), `frontend/game/app/online/EntityMeshes.ts:49-57,120` (`archetypeForKind`: harvester → `robot.miner`; `WorkParticleSystem`), `frontend/game/app/online/OnlineSession.ts:124,168` (only the health bars are gated by `W02`; `bindOnlineDayNightSync` is not), `frontend/render/lighting/` projector rigs; `docs/plan/PRODUCT_WAVES.md:22` (repair is a W03 row)
- **What happens:** round 1 gated the W02 HUD, the terraform R/Z keys, health bars and the W02 dev commands behind the `W02` flag, but a `?waves=..01` client still shows: the Command Dock itself (it hosts the W01 Hub menu and the Terraform tab, where W01 had separate panels); the reworked TERRAFORM tool (`work` instead of W01's GRADE / CLEAR / BREAK, plus the reference rows); the per-tier popovers on the resource chips; work particles and hand lasers; the projector light rigs; the day/night binding of the scene to the planet clock; and Harvester meshes when a `..01` client meets a W02 host. REPAIR ships in W02 although `PRODUCT_WAVES.md` puts repair in W03.
- **Why it is like this:** these pieces replaced W01 code in place (no W01 variant left to fall back to) or are render systems with no flag input.
- **Workaround / mitigation:** the W01 e2e suite runs with `?waves=..01` and passes; the W02 suite's step 10 checks the gated UI (planet clock, grid lines, Production tab, W02 build cards, power widget).
- **To resolve:** owner decides what `..01` must look like. Recommendation: accept the dock, the terraform rework, the render systems and the popovers as the new W01 look (they change no rule), and only move REPAIR behind `W03` (or update `PRODUCT_WAVES.md` to say it ships in W02).
- **Found:** 2026-11-03, W02 review round 1 (frontend agent)

### FF-52 · Construction ghost leftovers: occupancy rule of its own, pending tiles never cleared, ghost survives tab switches; Hub ghost rig copied

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/construction-menu/PlacementGhost.ts:199` (`pendingIndices`), `:297-312` (`start`), `:350-357` (`confirm`), `:125-140` (`evaluatePlacementGhost`), `frontend/game/features/construction-menu/ghostContext.ts:101-132` (`collectOccupiedTileIndices`), `frontend/game/core/hud/CommandDock.ts` (tab switch), `frontend/game/features/hub-placement/GhostRig3D.ts:48-60` (`ensureBody`) vs `frontend/game/features/construction-menu/ghostRenderer.ts` (`ConstructionGhostRig3D`); sim rule `shared/sim/src/systems/construction/placement.ts` (`evaluatePlacement`, D-37)
- **What happens:**
  1. **Occupancy is the client's, not the sim's:** `collectOccupiedTileIndices` marks the footprints of live entities (Hub 3×3, Extractor / Solar 2×2, pod 1 tile) and of every queued `build` task of every colony; when any footprint tile is in that set, `evaluatePlacementGhost` skips `evaluatePlacement` and answers `tile occupied` itself. Where the client's footprints differ from the sim's occupancy (a unit kind added later, a pod the sim no longer counts, a queued task the host already dropped), the ghost and the host disagree.
  2. **`pendingIndices` never shrinks:** every confirmed site adds its tiles and nothing removes them, so after a build is cancelled or rejected the auto-site search in `start` still avoids those tiles for the rest of the session.
  3. **Tab switch keeps the ghost:** switching the dock from BUILD to another tab hides the menu but does not cancel an active ghost; it stays on the map and still owns left / right clicks (`bindExclusivePointer`).
  4. **Hub ghost rig:** `GhostRig3D` (Hub, W01 path) removes the archetype's projector rig without disposing it (the construction ghost does since 2f1f2c1), and its body / material / tint code is a near copy of `ConstructionGhostRig3D`.
- **Fixed meanwhile:** the auto-site search cost (`findValidPlacementSite`, ~440 sim evaluations per click, 93 ms) is ~5.6 ms since the ghost context is built once per action (`ghostContext.ts`, 58956ab); the ghost uses the store's compiled overrides and centres the search on the own HQ (58956ab).
- **Why it is like this:** the ghost had to show queued sites before the host's view carries them; the two rigs were built in different waves.
- **Workaround / mitigation:** the host re-validates every `enqueueTask`; a wrong green ghost ends in a reject toast.
- **To resolve:** feed queued builds to the sim rule (a `PlacementWorld` with pending footprints) instead of a client occupancy short-cut; drop a pending tile when its order leaves the view; cancel the ghost when the BUILD tab is left; one ghost-rig class for both menus that disposes the projector rig.
- **Found:** 2026-11-03, W02 review rounds 1 and 2 (frontend agent)

### FF-53 · Hotkey leftovers: dead B / U handlers in the menus, camera keys ignore modifiers

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/construction-menu/ConstructionMenu.ts:68-77` (`B`), `frontend/game/features/units-menu/UnitsMenu.ts:116-125` (`U`), `frontend/game/core/hud/CommandDock.ts:160-172` (`handleKeyDown`, capture phase, `stopImmediatePropagation`), `frontend/game/app/RTSCamera.ts:37-38`, `frontend/game/features/shared/hotkeys.ts` (`isHotkeyPress`, FF-07 / FA-34)
- **What happens:** the dock's capture-phase handler takes `B` / `U` / `T` and stops the event, so the menus' own window `keydown` handlers for `B` / `U` never run inside the dock; they only act in a standalone mount and still carry their own copy of the typing guard (no auto-repeat or modifier check), the copy FA-34 removed elsewhere. `RTSCamera` skips keys only when the target is an `INPUT` (not a textarea / contenteditable) and ignores modifiers, so `Ctrl+W` / `Cmd+Q` / `Ctrl+E` also pan or rotate the camera.
- **Why it is like this:** the menus predate the dock; the camera predates the shared guard.
- **Workaround / mitigation:** none needed inside the dock.
- **To resolve:** delete the menu handlers (the dock owns B / U); use `isHotkeyPress` in `RTSCamera`.
- **Found:** 2026-11-03, W02 review round 1 (frontend agent)

### FF-54 · The Solar reference row always shows the temperate output

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/terraform-basic/referenceTables.ts:59` (`computeSolarOutputPerS(1, 'temperate', data)`)
- **What happens:** the reference table's `Solar Array (Day)` row computes the output for a temperate planet whatever planet the player is on, so on a desert or ocean planet the row and the real Solar income differ.
- **Why it is like this:** the table has no planet type input.
- **Workaround / mitigation:** the energy chip's hover shows the real `Income (Supply)`.
- **To resolve:** pass the view's planet type into the reference rows.
- **Found:** 2026-11-03, W02 review round 1 (frontend agent)

### FF-55 · Server-only events reach the client's event stream

- **Status:** Open (harmless today)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/contracts/src/events/resource-produced.ts:9` (`audience: 'server'`), `frontend/game/store/WorldStore.ts:208-211` (`delta.events` emitted to `onServerEvents` unfiltered), consumer `frontend/game/features/terraform-basic/resourceFound.ts`; server side: `backend-contracts.md` (rooms forward every known kind)
- **What happens:** `resourceProduced` (a 60 s production batch meant for the progression consumer) arrives in `delta.events` and is passed to every `onServerEvents` listener. Today the only listener switches on the event kind and ignores unknown kinds, so nothing shows.
- **Why it is like this:** neither the server nor the client filters by the contract's `audience`.
- **Workaround / mitigation:** listeners ignore kinds they do not know.
- **To resolve:** filter `audience: 'server'` events on the server (preferred) or in `WorldStore` before emitting.
- **Found:** 2026-11-03, W02 review round 1 (frontend agent, backend agent)

### FF-56 · The W02 e2e step 1 hover depends on nothing covering the energy chip at 1280×720

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (test code); not seen failing
- **Area / code:** `tests/e2e/w02.spec.ts:96-101` (`energy.hover()` on `[data-testid="hud-hq-cell"]`, then reads the popover lines), `tests/e2e/playwright.config.ts:23` (`viewport: 1280×720`)
- **What happens:** the step hovers the top-bar chip with a real pointer move; if another HUD element (a toast, the brownout banner, a wider top bar) overlaps the chip at that size, the hover lands elsewhere and the popover assertions fail for a layout reason.
- **Why it is like this:** the test drives the UI as a player would.
- **Workaround / mitigation:** none needed while the top bar fits.
- **To resolve:** assert the chip is not covered before hovering (or open the popover through its `data-open` attribute in a second, non-pointer check).
- **Found:** 2026-11-03, W02 review round 2 (frontend agent)

### FF-57 · Health-bar billboard turns one draw late and per camera

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (code); not noticed in play
- **Area / code:** `frontend/game/app/online/unitHealthBars.ts:79-89` (`faceCameraBeforeRender` on the backing plate)
- **What happens:** the bar group is turned to the camera in the plate's `onBeforeRender`. Parts of the bar drawn before the plate in the same pass use last frame's rotation, so after a Q / E camera turn they lag one frame; a second camera rendering the scene (shadow pass, another viewport) turns the group again for its own view.
- **Why it is like this:** a cheap billboard with no per-frame scene walk.
- **Workaround / mitigation:** the lag is one frame and the bars are small.
- **To resolve:** set the group's rotation once per frame from the main camera in `UnitHealthBars.sync` (or use a sprite / screen-space bar).
- **Found:** 2026-11-03, W02 review round 2 (frontend agent)

### FF-58 · The power widget subscribes to the selection once and goes stale on a remount

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (code)
- **Area / code:** `frontend/game/features/power-hud/PowerHud.ts:111-117` (`bindSelection`), `:207-209` (`dispose`); FF-49
- **What happens:** `bindSelection` subscribes to the first `services.landfall` it sees and never again (`offSelection` set). If the landfall feature is re-mounted (a flag change that re-mounts features, FA-29) while `PowerHud` stays, the widget listens to the old controller and stops following the selection.
- **Why it is like this:** the landfall panel may mount after the power widget, so the binding is lazy and one-shot.
- **Workaround / mitigation:** features re-mount together when the feature set changes, which disposes `PowerHud` too.
- **To resolve:** re-bind when `services.landfall` is a different object than the one subscribed to.
- **Found:** 2026-11-03, W02 review round 2 (frontend agent)

### FF-59 · Dead or test-only feature code: `ResourcesHud`, `QueuePanel.bindSimState`

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (grep: no production caller)
- **Area / code:** `frontend/game/features/resources-hud/index.ts:10` (`hud: []`), `ResourcesHud.ts:112,166` (`colonies[0]`, `byColony[0]`), `resources-hud.css:96-109` (raw `rgba` colours); `frontend/game/features/queue-panel/QueuePanel.ts:170-181` (`bindSimState`, `enqueue` → `enqueueQueueTask(simState, …)`), used only by `queue-panel.spec.ts`
- **What happens:** since FF-34 the `resources-hud` feature mounts nothing; `ResourcesHud` stays exported for its unit tests and still reads colony 0 and uses raw `rgba` colours instead of design tokens. `QueuePanel.bindSimState` / `enqueue` write a `PlanetState` directly (the client must only send commands, AGENTS §6); only specs call them.
- **Why it is like this:** leftovers of the first W02 HUD iteration kept for their specs.
- **Workaround / mitigation:** unreachable in the game.
- **To resolve:** delete `ResourcesHud` (and its CSS) and move `QueuePanel`'s spec to a host `submit`, then delete `bindSimState` / `enqueue`.
- **Found:** 2026-11-03, W02 review round 1 (frontend agent)

### FF-60 · Prototype `GameHud` reads colony 0

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/ui/hud.ts:96` (`colonies[0]`), `:103-105` (`byColony[0]`); FF-46
- **What happens:** the prototype HUD of the `?planet=` path takes stock, caps, production and power from the first colony, not the player's. The prototype path is single-colony today, so the numbers are right there.
- **Why it is like this:** left over when FF-46 moved the online HUD to `readColonyPower(view, ownColonyIndex(…))`.
- **Workaround / mitigation:** single colony on the prototype path.
- **To resolve:** use `viewColony` / `readColonyPower` with the own colony, or retire the prototype HUD with the prototype path (FF-45).
- **Found:** 2026-11-03, econ-sync review / W02 review round 1 (frontend agent)

### FF-61 · Console `time`: registered twice, split across two channels, a bare `time` may set noon

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (code trace)
- **Area / code:** `frontend/game/features/warp/index.ts:35-80` (`timeCommand`, feature `warp`, `devCommands: [warp, timeCommand]`), `frontend/game/features/devtools/index.ts:79,175` (`const time = timeCommand`, listed again in `devtools`); `frontend/game/dev/console/runner.ts:19-22` (duplicate names: the same object is skipped silently); `frontend/game/store/local/LocalHostCore.ts:330-356` (`devTime`); `frontend/game/app/online/featureHud.ts:80` (default `devServer: httpDevServer()`); sim `shared/sim/src/systems/environment/index.ts:122` (`hourForTimeSpec`), `systems/time/index.ts:280`
- **What happens:**
  1. **Registered twice:** both W00 features `warp` and `devtools` list the same `timeCommand`; the runner keeps the first and skips the second without a warning (same object), so it works, but the command has two owners.
  2. **Two channels:** named presets (`night`, `morning`, `noon`, `dusk`, `midnight`, `day` alone) and `HH:MM` go through the sim command `dev.time { target }`; a bare hour (`time 7`), `time day <realHours>`, `time scale <k>` and a bare `time` (print) go through the dev route `devServer('time')` (the game server's route, or the local host's `devTime` on `?host=local` and the dev fallback). The sim's `hourForTimeSpec` already reads a bare hour (`'7'`), so `time 7` does not need the dev route. Without any `devServer` service those forms answer `host_unavailable`.
  3. **Bare `time` without a dev server:** the branch `first === undefined && !ctx.services.devServer` sends `dev.time { target: 'day' }`, i.e. sets 12:00 instead of printing the clock. In the online flow `FeatureHud` always provides a `devServer` (HTTP by default, the local host's on `?host=local`), so this branch is reached only by a host that has no dev server (specs, a future host).
- **Why it is like this:** `time` grew from a dev-route command (W00) into the solar clock (`dev.time`) without merging the two paths.
- **Workaround / mitigation:** all forms work on the server flow and on `?host=local`.
- **To resolve:** register `time` in one feature; send a bare hour as `dev.time { target }`; make a bare `time` print the clock from the view (`blobs.planetTime` / colony power summary) instead of setting it. Update `docs/dev/DEV_TOOLS.md` with the split if it stays.
- **Found:** 2026-11-03, W02 review round 2 (lead)

## W06 Invisible Chain

These entries were FF-34 and FF-35 on `wave/w06-invisible-chain`. W02 landed FF-34..FF-61 on `main` first, so the W06 entries continue at FF-62.

### FF-62 · Social login does not reauth the open socket

- **Status:** Accepted (by design)
- **Area / code:** `frontend/game/app/online/pilotBridge.ts` (`loginSocial`), `frontend/game/app/online/guestBoot.ts` (`applyLinkedSession`), `frontend/game/net/WsTransport.ts` (`reauth`)
- **What happens:** **Save progress** replaces `GuestBootTarget.accessToken` (and the boot object, in place) with the `POST /v1/auth/social` token and updates the chip, with no reload. The socket that is already open keeps the guest JWT until `WsTransport`'s existing renewal timer calls `refresh()` and sends `reauth`. Login itself does not send `reauth`.
- **Why it is like this:** `reauth` is private to the transport. A guest bearer upgrades that same player, so the open socket stays the right colony. The new token is what the next `hello`, the next `reauth`, and later `Authorization` headers use.
- **Workaround / mitigation:** the social response also sets the refresh cookie, so the renewal timer rotates onto the linked session. The chip and `pilot.view().accessToken` already show the new token.
- **To resolve:** only if a linked token must be on the socket immediately — add a session push for `reauth`. Not needed while the upgrade keeps the player id.
- **Found:** 2026-11-02, W06-15

### FF-63 · A reload shows Guest pilot again

- **Status:** Resolved (W06-06)
- **Area / code:** `frontend/game/features/identity/PilotChip.ts`, `frontend/game/app/online/bootOnline.ts` (`bootAuthAndHome`, `readAccountId`), `backend/app/src/core/auth/auth.service.ts` (`guestLogin`)
- **What happens:** linking in this page updates the chip to `Pilot ID <accountId>` with no reload. The next page load boots with `POST /v1/auth/guest`. Before W06-06 that answer was always `isGuest: true` and had no `accountId`, so the chip read `Guest pilot` again until the pilot saved progress once more.
- **Why it is like this:** W06-15 only required the in-page handoff. Guest login did not return the pilot id, and the chip has nowhere else to read it. Nothing is written to `localStorage`.
- **Workaround / mitigation:** the server still has the upgraded player (same device secret).
- **To resolve:** have guest/refresh return `accountId` when the player is already linked, and have the chip render `Pilot ID` from that boot field.
- **Fix:** the guest auth response now carries `isGuest: false` and top-level `accountId` when the player has a `social_identity` row. `readAccountId` already reads that field, and `isGuest` is `player.isGuest !== false`, so a reload shows `Pilot ID …`. The chip was not rewritten. Refresh of a linked player returns the same two fields.
- **Found:** 2026-11-02, W06-15

## W04 Maps & Camera (2026-11-03)

### FF-64 · W04 Maps & Camera deferred scope (tags F / L) and analytical frustum fallback

- **Status:** Accepted (by wave scope `docs/plan/waves/W04-maps-camera.md`)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/maps/`, `frontend/game/features/maps/index.ts`, `docs/plan/waves/W04-maps-camera.md`
- **Update (2026-11-04, W03 merge review):** the Resources layer shipped in W04 (`MAP_LAYER_META.resources`), so W04-17 is no longer deferred; the Power map layer assigned to W03 does not exist (no `power` id in `shared/contracts/src/maps/index.ts`) — see FF-67.
- **What happens:**
  1. **Deferred W04 issues (tags `F` and `L`):** per `docs/plan/waves/W04-maps-camera.md`, the 14 `H`-tagged issues (`W04-01`, `W04-03..05`, `W04-07`, `W04-09..11`, `W04-13..16`, `W04-22`, `W04-33`) ship in this wave. The `F` and `L` issues — `W04-02` (server `alertPing` emission; schema `alertPingEvent` is already registered in `shared/contracts/src/events/alert-ping.ts`), `W04-06` (separate three-state fog overlay pass; unexplored tiles are already painted `--ta-void` in `tileColors.ts`), `W04-08` (`alertPing` expanding ring + `Space` jump), `W04-12` (`Space` jump to last alert), `W04-17..20` (Resources, Power, Threats, Walls, Market map layers for W03/W05/W07/W08/W10/W11), `W04-21` (global map click-to-pan), and `W04-23..32` (unit follow ring, box-drag lasso, control groups `1..9`, double-tap, `Tab` sub-selection, `Home` key, touch pinch/pan) — remain scheduled for their respective full/launch waves and demo steps 6–9 are marked deferred in `docs/plan/checks/w04-check.md`.
  2. **Analytical frustum fallback in `cameraTrapezoid.ts`:** `computeCameraTrapezoid` projects the 4 NDC screen corners onto the ground plane via `projectFrustumRaysToGround(camera, groundY, dist * 3.5)`; when no `THREE.PerspectiveCamera` is provided (e.g. unit specs passing explicit `{ targetX, targetZ, yaw, dist }`) or a near-horizon ray does not intersect within `3.5 × dist`, it falls back to `computeAnalyticalWorldCorners`.
- **Why it is like this:** hackathon scope (`H`) focuses on the 180 px minimap, incremental hex raster cache, unit/building dots, camera trapezoid, minimap click/drag pan, and fullscreen global map (`M`) with `Territory`, `Terrain`, and `Units` layers.
- **Workaround / mitigation:** none needed for `H` scope.
- **To resolve:** implement `F` and `L` issues when those waves / tags are opened.
- **Found:** 2026-11-03, W04 wave lead

### FF-65 · Global map shows nothing around the planet (no neighbouring sectors)

- **Status:** Accepted (W11 atlas adaptation; W27 streaming)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `MapsController.drawGlobalMap`, `frontend/game/maps/global-map.css`
- **What happens:** the global map (an 80 % pop-up over the blurred scene) has bounded pan and 0.35×–8× zoom, but the area around the planet is the dialog's flat translucent fill. The decorative hex lattice that used to fill it was removed at the owner's request (it read as "blurred hexagons"). The current map consumes one dense hex disk; it has no gameplay-atlas neighbour data to draw; the `Resources` layer shows only the visible `deposit` layer of explored tiles (never the hidden `subDeposit`).
- **Why it is like this:** W04 shipped a dense small-world map. W11 now owns the small connected atlas and map adaptation; W27 adds hierarchical summaries and streaming.
- **Workaround / mitigation:** none needed; `RESET [0]` recenters on the planet.
- **To resolve:** W11-37/-39/-42 adapts coordinate lookup, owner cache width and viewer exploration; W27-26/-27 adds bounded summaries/detail caches. Follow [the source-reviewed map handoff](../plan/MAP_EXTENSION_HANDOFF.md), including picking, cache invalidation and input regressions. No decorative neighbour lattice.
- **Review update:** 2026-11-04: `PlanetRasterEntry.owner` is still `Int8Array`; map layers index a complete radius-based disk and normal updates scan dense arrays. These are explicit implementation gates, not fixed by this planning update.
- **Found:** 2026-11-03, W04 map fixes

## W10 Cargo & Trade Hub (2026-11-03)

### FF-66 · W10 Cargo & Trade Hub deferred scope (dedicated shuttle model, history, analytics/telemetry, mobile, send-to-account) and T1 250/min throughput in demo step 3

- **Status:** Accepted (by wave scope `docs/plan/waves/W10-cargo-trade-hub.md`)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/data/trade-hub.ts`, `shared/sim/src/systems/cargo/`, `frontend/game/features/trade-hub/`, `tests/e2e/w10.spec.ts`, `docs/plan/waves/W10-cargo-trade-hub.md`
- **What happens:**
  1. **Deferred W10 issues (non-`H` and `H+`):** per `docs/plan/waves/W10-cargo-trade-hub.md` (§ Hackathon slice), the 21 `H`-tagged issues (`W10-01..14`, `W10-16`, `W10-19..22`, `W10-26`, `W10-30`) ship in this wave. `W10-15` (rocket carry-over hook for W21), `W10-23` (`H+` history/event-log rows for W12), `W10-24..25` (analytics funnel & Prometheus cargo telemetry), `W10-27..29` (mobile bottom sheet, `sim:bench` case, `ENVS.md` docs), and `W10-31` (`H+` send-to-account `cargo.transfer`) remain deferred.
  2. **T1 throughput (`250/min`) vs Demo Story step 3 prose (`300`):** `docs/plan/waves/W10-cargo-trade-hub.md` Demo Story step 3 says "Export 300 metals" while step 5 says "at T1 throughput (250/min)", and both `colony-economy-and-buildings-spec.md` §3.5 and `W10-02` / `W10-06` define a single online T1 Trade Hub's rolling 60-second throughput cap as `250 units/min`. Accordingly, a single T1 Trade Hub bounds a single export to `250` (`metals.t1`: `900 → 650` on export, `0 → 250` in orbit, then `150` imported back to `800` stock and `100` in orbit).
- **Why it is like this:** `W10-02` and `W10-06` enforce the economy spec's `250/min` T1 throughput cap (`TRADE_HUB_THROUGHPUT_PER_MIN[1] = 250`).
- **Workaround / mitigation:** `tests/e2e/w10.spec.ts` and `docs/plan/checks/w10-check.md` use `250` for the T1 export and `150` for the import (leaving the same `100` in orbit as the `300 − 200` prose).
- **To resolve:** implement the non-`H` / `H+` issues when their waves open.
- **Found:** 2026-11-03, W10 wave lead

### FF-67 · Cargo flights reuse the colony pod and are cosmetic

- **Status:** Accepted (W10 fixes, 2026-11-04)
- **Area / code:** `frontend/game/features/trade-hub/CargoFlights.ts`, `frontend/render/visuals/space/CargoFlight.ts`
- **What happens:** accepted exports launch a pod and settled imports land one at the Trade Hub. The flight reuses `ship.dropPod` and the existing retro-engine shader; no separate cargo-shuttle archetype is introduced. Settlement and the rolling export allowance follow authoritative sim state, independently of the six-second visual flight.
- **Why it is like this:** reuse preserves the established renderer and keeps financial settlement independent of frame rate or a closed browser. The previous FF-66 launch/land deferral is resolved by this change; the dedicated shuttle design remains deferred.
- **Workaround / mitigation:** the panel shows authoritative balances, pending transfers and errors; reconnecting does not replay past flights.
- **To resolve:** introduce a dedicated cargo-shuttle design when distinct spacecraft silhouettes are needed.
- **Found:** 2026-11-04, W10 fixes.

### FF-68 · Fix trading-spot shuttle animation

- **Status:** Open
- **Area / code:** `frontend/game/features/trade-hub/CargoFlights.ts`, `frontend/render/visuals/space/CargoFlight.ts`, Trade Hub cargo pad.
- **What happens:** the owner requested a follow-up fix for the trading-spot shuttle animation after checking W10. The current launch/landing implementation remains in place; its animation is not considered finished.
- **Why it is like this:** the owner explicitly chose to record this remaining issue and land W10, deferring the animation fix.
- **Workaround / mitigation:** export/import settlement and throughput use authoritative simulation state independently of the cosmetic flight (FF-67).
- **To resolve:** reproduce the animation at the Trade Hub during exports and imports, correct its launch/landing behavior and pad alignment as needed, then visually verify both directions with the owner.
- **Found:** 2026-11-04, owner review and instruction to land W10 with this follow-up open.

## W12 Player Page & Achievements

### FF-69 · `/play.html?scenario=w12` and `/me.html` share the dev pilot session via `localStorage` (`ta_active_pilot`) and `?as=`

- **Status:** Accepted (by design)
- **Area / code:** `frontend/game/features/achievements/activePilot.ts` (`ActivePilotTracker`), `frontend/game/features/achievements/devCommands.ts`, `frontend/game/pages/me/api.ts`, `backend/app/src/profile/me-auth.ts`
- **What happens:** Opening `/play.html?scenario=w12` (or passing `?as=<handle>`) locks `ActivePilotTracker` to `playerId = pr_dev_<handle>` (default `pr_dev_w12`) and `accessToken = dev:<handle>` (`dev:w12`), persists that record to `localStorage` (`ta_active_pilot`), and calls `profile.seed_w12` once so the pilot's W12 baseline is seeded. Opening `/me.html` in a second tab reads `?as=` (or `ta_active_pilot` from `localStorage`, or falls back to `pr_dev_w12` on the server in non-production) so dev console commands (`fact add`, `xp add`, `profile reset`) in the game tab and reloads of `/me.html` always address the same pilot. In-game achievement/level-up toasts (`W12-27`) are triggered both by server events on `WorldStore` and directly by the `fact add` / `xp add` dev console commands (`W12-31`), because dev command HTTP responses return synchronously without a separate non-sim socket push (BE-40).
- **Why it is like this:** `?scenario=w12` joins `/ws` with a dev token whose hash-derived `ready.playerId` (`devPlayerId('w12')`) would otherwise differ from `/me.html`'s default dev pilot id (`pr_dev_w12`), and the websocket only forwards sim events (`rooms.ts`).
- **Workaround / mitigation:** `ProgressionDevCommand` also mirrors `fact.add`, `xp.add`, `profile.reset`, and `profile.seed_w12` onto `pr_dev_w12` whenever a different dev player id is used.
- **To resolve:** When a non-sim player websocket channel lands (BE-40), push `achievement.earned` and `xp.levelUp` over that socket for non-sim progression sources as well.
- **Found:** 2026-11-03, W12

## W08 Stages & HQ Goals

### FF-70 · W08 H-scope cut: Goal progress drawer, slider-impact preview, and `/me.html` UnlockStage profile view are deferred

- **Status:** Accepted (by design, W08 H-scope cut)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/goals/GoalsPanel.ts`, `frontend/game/features/priorities/PrioritiesPanel.ts`, `tests/e2e/w08.spec.ts` (`7b` skipped); `docs/plan/waves/W08-stages-goals.md` §1 & §3
- **What happens:**
  - `GoalsPanel` shows each goal's status badge, progress bar (`pct% (stepsCompleted/stepsTotal)`), budget share, reorder buttons (`▲`/`▼` + drag-and-drop), and cancel button (`✕`, which cancels non-started child tasks in the sim). The expandable per-child-order drawer (`W08-22`, `H+`) and the slider-impact preview bar (`W08-28`, `H+`) are not rendered in the `H` cut.
  - Demo step 7b (`/me.html` showing `UnlockStage: S4` across worlds) is marked `test.skip` in `tests/e2e/w08.spec.ts` because `/me.html` is built in `W12 Accounts & Profiles`.
- **Why it is like this:** `docs/plan/waves/W08-stages-goals.md` defers `W08-22` and `W08-28` to `H+` and `/me.html` to `W12`.
- **Workaround / mitigation:** child tasks are visible in the Order Queue panel (`QueuePanel`) and in `window.__online.store.latest.colonies[0].queue`; `unlockStage` vs `threatStage` is exposed on `colonies[0]` and verified in `tests/e2e/w08.spec.ts` step 6.
- **To resolve:** implement `W08-22` and `W08-28` in `H+`. W12 has now landed `/me.html`; enable and verify W08’s cross-wave step 7b during FF-72 (it remains skipped in the W08 browser suite).
- **Found:** 2026-11-03, W08 wave implementation (lead)

### FF-71 · Stage navigation replays lessons; later mechanics remain previews

- **Status:** Accepted (W08 owner follow-up interpretation)
- **Area / code:** `frontend/game/features/stages/{StageTrackHud,guide}.ts`, `frontend/game/features/goals/HqPanel.ts`
- **What happens:** Clickable stage segments browse all S0–S10 guides; they never roll back the simulation, earned unlocks or threat. New-stage notices last 30 seconds with a visible timer. Replay has no timer. The compact Goals header opens the tracker; its minus button closes it completely and suppresses automatic notices until reopened. Goals and Priorities share tabs, with state preserved when switching. Unimplemented tutorial suggestions are disabled and describe future-wave prerequisites.
- **Why it is like this:** interpreting “navigate back” as reviewing tutorial stages preserves world progress and irreversible gameplay. S5–S10 require future-wave mechanics, so their guides explicitly say Preview rather than claiming a playable lesson today.
- **Workaround / mitigation:** Click the highlighted current stage to return to its guide; the dev-only `stage set` command still changes simulated stage for testing.
- **To resolve:** extend each guide and executable suggestion when its owning wave lands, following the [progression contract](../plan/W08-PROGRESSION-CONTRACT.md).
- **Found:** 2026-11-03, W08 owner fixes.


### FF-72 · Full W08 Recheck

- **Status:** Open (owner requested; landing is not acceptance of all W08 behavior)
- **Area / code:** `frontend/game/features/{stages,goals,priorities}/`, `shared/sim/src/systems/{progression,goals,rule-engine}/`, [W08 owner guide](../plan/checks/w08-check.md), [progression contract](../plan/W08-PROGRESSION-CONTRACT.md).
- **What happens:** the owner reports that W08 still has issues and explicitly requests a full recheck after landing. Exact remaining failures have not yet been enumerated; targeted automated passes do not close this report.
- **Why it is like this:** W08 was reviewed in a limited wave stack, while W04 maps, W10 cargo and W12 persistent progression have since landed. The latest small UI revision removes Previous / Next / Current and Show / Hide guide, moves the stage tracker behind a compact Goals header, and makes minus close it. The ambiguous “dialog” was interpreted as the S0–S10 tracker; confirm this layout with the owner during recheck.
- **Workaround / mitigation:** use the owner guide and a fresh scenario for reproduction; record URL, enabled waves, host, stage, goal parameters, console output and expected/actual behavior for each failure. Existing detailed boundaries remain in FF-70 / FF-71 and GP-67. The merged server browser run passes all six runnable W08 checks; the W08-to-profile persistence check remains skipped and must be enabled during this recheck.
- **To resolve:** run the full checklist on both server and browser hosts with the current merged stack, then record individual reproducible failures, fix them and obtain owner confirmation. Cover:
  1. Compact Goals header placement, click/open/minus/close, pointer and keyboard input, small viewports, and unobstructed tick/resource/map controls.
  2. Every S0–S10 segment, 30-second automatic notice, manual untimed replay, Dismiss, hidden-state behavior and real stage/unlock/threat preservation.
  3. Establish Colony and Grow Economy end to end: actual paid orders, walking workers, measured Metals/Minerals/Biomass production, storage/resources/power blockers, resume, cancel/reorder, queue limits and reload.
  4. Secure Power across day/night, unsupported goals and Water extraction, budget values and the still-deferred spending ceilings (GP-67).
  5. All five priorities and autopilot need scores (bp), suggestion/auto transitions, manual-order protection, safety overrides and future diplomacy/combat integration obligations.
  6. Tutorial continuity beyond S4, dwell/trigger rules, wave-off behavior, Trade Hub contact/S2/S5 access, and W12 UnlockStage/profile persistence across reload and colony transitions.
- **Found:** 2026-11-04, owner review: “full W8 Recheck, it has issues.”

### FF-73 · Power-zone highlight only while a building ghost is armed

- **Status:** Accepted (by design, dabc102)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/construction-menu/powerZoneOverlay.ts`
- **What happens:** The blue zone fill + outline shows only while a non-Hub building ghost is armed; there is no always-on display and none on the Hub placement ghost; hexes are flat per tile at tile height.
- **Why it is like this:** Keeps the scene clean outside placement.
- **Workaround / mitigation:** Arm any building card (B) to see the zones.
- **To resolve:** Add a toggle (or the map Power layer, FF-74) if the owner wants it always visible.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### FF-74 · No Power layer on the minimap / global map

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/contracts/src/maps/index.ts` (`MAP_LAYER_IDS`), `frontend/game/maps/layers/`
- **What happens:** The W04 plan assigned a Power map layer to W03; W03 is merged with no `power` layer id, so zones, pylons and brownouts are not on the maps.
- **Why it is like this:** Out of the W03 owner-feedback scope.
- **Workaround / mitigation:** Building squares (incl. pylons) are drawn on the minimap.
- **To resolve:** Add a `power` layer: zones tinted, shed buildings marked.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### FF-75 · Power HUD shows CONSTRUCTING for a building being dismantled

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/features/power-hud/PowerHud.ts` (~line 56)
- **What happens:** A dismantle puts the building back into the `constructing` state with falling progress; the power inspector labels it CONSTRUCTING, the selection inspector and queue chip say "Dismantling n%".
- **Why it is like this:** The power HUD reads the entity state only.
- **Workaround / mitigation:** The queue chip and selection panel are correct.
- **To resolve:** Read the colony work jobs and say DISMANTLING.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### FF-76 · Game hotkeys are quiet while the global map or the pause dialog is open

- **Status:** Accepted (by design, 2489c56)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/core/input/gameInputBlock.ts` and its callers (CommandDock, ConstructionMenu, UnitsMenu, QueuePanel, PlacementGhost, terraform, unit control)
- **What happens:** W04 review: B/U/T, ghost R / right-click, H, G/R/Z and X used to act behind the open map. One guard now blocks them while the map or pause dialog holds the block; the map's own keys and the dev console ignore it. The camera trapezoid updates at ≤ 4 Hz while panning with WASD (scheduler), minimap drag stays immediate. The ghost right-click guard has no unit spec (checked in the browser).
- **Why it is like this:** One shared guard instead of scattered checks.
- **Workaround / mitigation:** —
- **To resolve:** Add a PlacementGhost spec for the right-click guard.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### FF-77 · Minimap owner codes −2 / −3 exist only on the client

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/maps/entityDots.ts`, `shared/sim/src/world/presence.ts` (`presenceRoleOf`)
- **What happens:** The sim defines only owner −1 (unowned); −2 (fauna) and −3 (Guild) exist only in `entityDots.ts`, and no fauna kind is registered. Also `presenceRoleOf` treats every kind ≥ hub as `structure`, so Harvesters (7) and Builders (8) count as structures for presence / AI; nothing calls `registerPresenceRole`.
- **Why it is like this:** Found by the W04 review; outside the map fix scope.
- **Workaround / mitigation:** Unowned entities draw neutral steel.
- **To resolve:** Define owner codes in contracts; register presence roles for unit kinds.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### FF-78 · Bottom-left dock vs the W06 pilot chip; top-left slot stacks above other slots

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `frontend/game/maps/minimap.css` (dock body budget `calc(100vh - 460px)`), `frontend/game/core/hud/hud.css` (top-left slot `z-index: 1`)
- **What happens:** At 1280×720 the expanded Command Dock over the minimap reached the W06 pilot chip and caught its clicks (fixed in bce78bc by a tighter budget and lifting the top-left slot). At phone landscape 844×390 with W06 on, the dock (y 77–294) still overlaps the pilot chip (y 57–115). Side effect of the fix: the top-left slot now stacks above every other HUD slot.
- **Why it is like this:** The bottom-left slot holds both the dock and the W04 minimap.
- **Workaround / mitigation:** Collapse the dock (`Q`) on small screens.
- **To resolve:** A HUD layout budget per breakpoint that reserves the top-left plate.
- **Found:** 2026-11-04, W03 owner-feedback pass (e2e update)

### FF-79 · Resource counters expand beyond four digits

- **Status:** Accepted (explicit owner request, 2026-11-04)
- **Area / code:** `frontend/game/features/hud-min/MinimalHud.ts`, `hud-min.css`
- **What happens:** Stock totals, caps and bio subtotals use four zero-padded digits with tabular numerals. Values above 9999 expand to their full number; hover retains the readable resource breakdown.
- **Why it is like this:** Avoids width changes during ordinary production while preserving large quantities without abbreviation.
- **Workaround / mitigation:** None needed.
- **To resolve:** No change planned.
- **Found:** 2026-11-04, owner feedback implementation.

### FF-80 · Owner-feedback gameplay smoke check did not receive a local simulation view

- **Status:** Open (verification limitation)
- **Area / code:** `frontend/game/app/online/OnlineSession.ts`, browser local host startup
- **What happens:** During this change's headless Chrome check, `/play.html?host=local&scenario=w03&planet=dune&skip=1` connected a streaming transport but stayed on “Deploying drop pod…” without a simulation view. A retry with native graphics and 120 seconds of waiting also did not reach gameplay. This does not establish the cause or whether normal interactive play is affected.
- **Why it is like this:** Startup cause was not determined in this pass. The full regression suite passes, including local-host lifecycle tests.
- **Workaround / mitigation:** Four-view model checks across all three biomes and a connected Hub/extractor/turbine/capacitor grid were inspected in the working playground. Placement, cap arithmetic, extractor output, wind windows and cable direction/clearance have automated regression checks.
- **To resolve:** Repeat the owner-feedback story in an interactive local session and trace local worker boot if it reproduces. Construction continuity and minimap selection still need that interactive confirmation.
- **Found:** 2026-11-04, owner-feedback visual QA.

- **FF-80 follow-up (2026-11-04, stack restart):** Restarted the w03 frontend/backend and verified the server-backed `http://127.0.0.1:5273/play.html?scenario=w03&skip=1` reaches gameplay with advancing ticks and no page errors. Invalid-placement toast and wind placement limits were exercised there. The original browser-local startup observation remains open; use the server-backed URL for the owner check.

### FF-81 · Landscape HUD reserves space for the expanded selection strip

- **Status:** Accepted (merged W03/W04 regression fix)
- **Area / code:** `frontend/game/maps/minimap.css`
- **What happens:** At phone landscape sizes, the dock and minimap sit above the selection strip. The build list has a shorter scrollable viewport so controls remain clear of the top HUD and selected unit.
- **Why it is like this:** The merged multi-selection strip can be 154 px tall, exceeding the earlier 76 px allowance.
- **Workaround / mitigation:** Scroll the build list to reach lower cards; desktop sizing is unchanged.
- **To resolve:** Revisit the landscape layout when adding more selection details.
- **Found:** 2026-11-04, full merged browser suite at 844 × 390.

### FF-82 · W07-28 combat analytics events are deferred from the hackathon slice

- **Status:** Accepted (by design, hackathon slice)
- **Area / code:** `docs/plan/waves/W07-first-contact.md` (`W07-28`), `frontend/game/features/combat/`
- **What happens:** The combat HUD (`CombatLog`, screen-edge alert pings, HP bars) and backend progression facts (`faunaKilled`, `nestDestroyed`, `raidRepelled`) are active in W07, while the client analytics batch events (`first_combat_unit`, `first_raid`, `first_raid_repelled`, `first_nest_cleared`, `first_building_lost` in `W07-28`, blank `H` column) are deferred until post-hackathon analytics waves.
- **Why it is like this:** `W07-28` is outside the `H` hackathon slice in `docs/plan/waves/W07-first-contact.md`.
- **Workaround / mitigation:** Progression facts and combat log entries record raid repels, unit/building losses, and nest clears.
- **To resolve:** Implement `W07-28` in `frontend/game/features/combat/` when post-hackathon analytics issues run.
- **Found:** 2026-11-04, W07 wave execution.
