# Sim gameplay: questions and limitations

W01 gameplay rules in `shared/sim`: landing, HQ, construction (placement, prep, work, occupancy), terraform-basic,
territory claim, dev commands, the units runner / movement / commands, the economy treasury, and `scenarios/`.
Ledger and journal limits are in [`economy-ledger.md`](./economy-ledger.md) (LED-xx). Format: [README](./README.md).

## Terraform

### GP-01 · Terraform jobs are validated only when queued, so one tile can be cleared or broken many times (duplicate yields)

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED (scratch probe: one forest tile queued 5× in one `enqueueTask` and once more in a second order → 6 `obstacleRemoved` events, 30 biomass instead of 5)
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` (`buildJobsFromTiles` 288–327, `enqueueTerraformOrder` 331–407), `shared/sim/src/systems/terraform-basic/work.ts` (`workJob` 78–101, `completeTerraformJob` 26–52)
- **What happens:** `canRunTerraformOpOnTile` runs only at enqueue. Nothing removes duplicate tiles inside one order (the contract allows 256 tiles, duplicates included), nothing rejects a tile that already has a job in another order (manual or linked prep), and `workJob` never re-checks the tile. When the first `clear` / `break` finishes, the next job on the same tile still runs and `completeTerraformJob` credits `terraform.yield` again (5 biomass per Clear, 10 metals per Break) and re-runs `revealSubsurface`. The same gap lets work continue on a tile that changed owner after it was queued (another colony's Hub claimed it, GP-06) or whose terrain was changed by `dev.seed` / `dev.cell`.
- **Why it is like this:** the queue was built for "validate the request, then trust the job list".
- **Workaround / mitigation:** yields are capped by storage (LED-11); each duplicate still costs HQ time and cell energy.
- **To resolve:** de-duplicate `(q, r)` per op at enqueue and reject a tile that already has a pending job of that op for the colony; in `workJob` (or when a job becomes first) re-run `canRunTerraformOpOnTile` and drop the job (no yield) when it no longer applies. Add a spec with a duplicated tile list and with two overlapping orders.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-02 · No limit on queued terraform orders or jobs

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` (`getManualTerraformLaneCount` 246, `enqueueTerraformOrder`), `shared/contracts/src/commands/enqueue-task.ts` (`tiles.max(256)`)
- **What happens:** `getManualTerraformLaneCount` is exported (and re-exported by construction) but nothing calls it outside tests; `enqueueTask` accepts any number of orders of up to 256 tiles each. The whole `terraformTasks` blob is rewritten (in several copies, GP-08) on every work step and every provider reorder, and synced to every client, so its size is bounded only by the ingress rate limit.
- **Why it is like this:** the lane limit of UO-TF-03 was modelled (`countsTowardLaneLimit`) but never enforced.
- **Workaround / mitigation:** ingress token bucket (`rate_limited`).
- **To resolve:** decide the lane limit (UO-TF-03) and the max open jobs per colony; reject with a registered code (e.g. `supply_cap` or a new `queue_full`) in the `enqueueTask` handler. Recommendation: enforce the lane count plus a job cap, and de-duplicate tiles (GP-01).
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-03 · Before its Hub exists a colony may terraform any unclaimed tile on the planet

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` (`canRunTerraformOpOnTile` 110–116, `hasColonyClaimedTerritory` 75–89)
- **What happens:** while the colony owns no tile, every unclaimed tile passes the ownership check, so it can queue Clear / Break (and collect their yields) anywhere, including next to another colony's pod. Once it owns one tile, only own tiles are allowed. `hasColonyClaimedTerritory` also scans the whole owner layer for every tile of every request (up to 256 × tile count per command).
- **Why it is like this:** the HQ must be able to prepare its first Hub site before any territory exists.
- **To resolve:** decide the pre-Hub work area. Recommendation: limit pre-Hub manual terraform to a radius around the colony's landing (data row), keep linked Hub prep as is; cache "has territory" per colony (e.g. on the colony record set by `applyHubCompletionEffects`).
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-04 · Manual terraform always outranks construction

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/units/registry.ts` 16–19 (providers `[terraformProvider, buildProvider]`)
- **What happens:** the terraform provider is asked first and offers any queued job of the colony, manual orders included. A colony with a large manual order never builds its in-progress Hub until every manual job is done (or skipped as unreachable).
- **Why it is like this:** "a site must be prepared before it can be built on" (linked prep), and manual orders share the same provider.
- **To resolve:** decide the priority. Recommendation: linked prep → build → manual terraform, or round-robin by order age.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

## Construction

### GP-05 · `placeBuilding` accepts any building name and builds it as a Hub entity with a 1×1 order

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED (scratch probe: `placeBuilding { building: 'pylon' }` on own ground is acked; a later `commandHub` is rejected `site_blocked` / `hubExists`)
- **Area / code:** `shared/contracts/src/commands/place-building.ts` (`building: z.string()`), `shared/sim/src/systems/construction/placement.ts` (`resolvePlacementRule` 137–151, `entityFootprint` 163), `shared/sim/src/systems/construction/index.ts` (`placeBuildingOrder` 175–266, `spawnPendingHubRow` 149–172), `shared/sim/src/systems/construction/occupancy.ts` 16–19
- **What happens:** an unknown `building` gets the default rule (1×1, own territory, `maxPerColony: Infinity`). `placeBuildingOrder` then spawns an entity of kind `ENTITY_KIND.hub` with the Hub's HP and charges the Hub cost (`resolveHubCost`), the order stores `footprint: 1`, but placement occupancy and ground occupancy treat every hub-kind entity as 3×3. Because the entity is hub-kind, the colony's real Command Hub is then refused (`hubExists` → `site_blocked`). Completion skips the Hub effects, so the colony pays 400 resources for nothing and can no longer found itself. Only `tier > 1` is refused; `builderEntityId` is not in the contract, so the builder check is "the colony has a landed HQ".
- **Why it is like this:** W01 has one building; the generic path was a placeholder.
- **To resolve:** reject unknown building kinds (`invalid_args`) in `evaluatePlacement` (one rule, client ghost agrees), or make the contract an enum of known buildings; give each building its own row (cost, HP, kind, footprint) instead of `resolveHubT1Row`.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-06 · A Hub can be placed anywhere on unclaimed land, also right next to another colony's pod

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED (traced; no rule in `evaluateTile` / `colonyBlock`)
- **Area / code:** `shared/sim/src/systems/construction/placement.ts` (`evaluateTile` 176–188, `colonyBlock` 190–201), `shared/sim/src/systems/territory-claim/index.ts` (`claimTerritoryRadius`)
- **What happens:** `allowUnclaimedPlacement: true` and no distance rule: colony A may put its Hub a few tiles from colony B's landing (only landings keep `minLandingSeparation`, D-39). On completion A claims radius 10 first-come; B's starter Hub site and pod surroundings become foreign (`not_own_territory` for B's placement and terraform). B's pending Hub prep on those tiles keeps running because jobs are not re-validated (GP-01).
- **Why it is like this:** the first Hub has to go on unclaimed ground; competition rules are later waves.
- **To resolve:** decide. Recommendation: a Hub must be within N tiles of its own landing / HQ and at least `minLandingSeparation` (or the claim radius) from other colonies' landings and Hubs; enforce it in `evaluatePlacement` so the ghost shows it.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-07 · The construction queue is re-stamped every step while an order waits for resources

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (scratch probe: `constructionQueue.changedAt` equals every tick while `waiting_resources`)
- **Area / code:** `shared/sim/src/systems/construction/index.ts` 434–447 (`stepConstruction`), `shared/sim/src/systems/construction/build.ts` 88–102 (`payConstructionCost`)
- **What happens:** `if (!order.costPaid) { payConstructionCost(...); changed = true; ... }` sets `changed` whether or not anything changed, so `writeConstructionOrders` stamps the whole blob (all colonies' orders, twice, GP-08) every tick until the colony can afford the Hub. A colony that never gets the resources sends the blob in every delta forever.
- **To resolve:** set `changed` only when status / reason / `costPaid` actually change; add a "no delta while idle" spec (like the units book's).
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-08 · Order blobs bypass `setBlob` and carry the same orders several times

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (blob keys after a write: `0, changedAt, value, orders, byColony`)
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` 201–226 (`writeOrdersByColony`), `shared/sim/src/systems/construction/index.ts` 109–116 (`writeConstructionOrders`); readers `queue.ts` 178–199, `shared/sim/src/systems/hq/index.ts` 122–140, `frontend/game/features/terraform-basic/TileOverlay.ts` 77–94, `frontend/game/features/hub-placement/GhostEvaluator.ts` 98–115
- **What happens:** `writeOrdersByColony` assigns `state.blobs.terraformTasks` directly (not `setBlob`) as `{ changedAt, value, ...value }` where `value = { orders, byColony, ...byColony }`: every order is stored six times, and diffs / snapshots send the whole object. `constructionQueue` stores `orders` and `byColony` (two copies). Three readers (two in the sim, one in the client) accept every historical shape (`value ?? blob`, `byColony`, numeric keys, `orders`).
- **Why it is like this:** compatibility with older blob shapes during W01 development.
- **To resolve:** one shape (`setBlob(state, 'terraformTasks', { byColony })`), one reader function exported from the sim and used by HQ view and client, a codec migration for saved planets.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-09 · Order ids are the client's `commandId`, with no uniqueness check

- **Status:** Open
- **Severity:** low
- **Confidence:** PLAUSIBLE (depends on whether ingress de-duplicates `cmd.id`)
- **Area / code:** `shared/sim/src/systems/construction/index.ts` 354 (`orderId: cmd.commandId`), 210, 218 (`${orderId}_prep`); `shared/sim/src/systems/terraform-basic/index.ts` 106; `cancelConstructionOrder` 293–304, `cancelTerraformOrder` 425–433
- **What happens:** construction and terraform orders take the client-chosen command id (≤ 40 chars). A reused id gives two orders with the same `orderId`; lookups (`readyOrder`, `currentJob`, cancel) take the first match. A manual `enqueueTask` sent with command id `X_prep` (or the decimal entity id of a Hub) collides with a Hub's linked prep, and cancelling one removes the other. Cancel also matches by `o.building` (`cancelTask { taskId: 'commandHub' }` cancels the Hub).
- **To resolve:** generate order ids in the sim (`ctx.newEntityId()`-style counter in the blob), keep `commandId` only as a reference; reject an existing id.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-10 · `cancelTask` wildcards cross between construction and terraform; misses are acked; completed orders stay forever

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (traced; the client sends both wildcards)
- **Area / code:** `shared/sim/src/systems/terraform-basic/index.ts` 115–138; `shared/sim/src/systems/construction/index.ts` 283–305 (`cancelConstructionOrder`), 393–394; `shared/sim/src/systems/terraform-basic/queue.ts` 421–424 (`cancelTerraformOrder`); callers `frontend/game/features/terraform-basic/BrushController.ts` 331–332 (default `'active'`), `frontend/game/features/hub-placement/HubPlacementMenu.ts` 345–349 (default `'current'`)
- **What happens:**
  - The ids `''`, `'current'` and `'active'` are wildcards in both cancel functions, and the handler tries construction first, then terraform. The terraform brush's cancel with no stroke sends `'active'`: if the colony has an open Hub order, that order is cancelled (75 % refund, linked prep dropped, entity removed) instead of a terraform order. The Hub menu sends `'current'` when it sees no construction order: with none open (e.g. the Hub is completed), the colony's first terraform order is removed instead.
  - An id that matches nothing (unknown, already completed or another colony's) returns no code, so the host sends `cmd.ack`.
  - Without an id (internal callers; the contract requires `taskId`) `cancelTerraformOrder` removes `list[0]`, which may be a Hub's linked prep, leaving the construction order in `waiting_site` with no prep.
  - Completed construction orders are never removed from `constructionQueue`; every step re-reads and skips them, and they are synced forever (one per colony today, one per building later).
- **To resolve:** drop the wildcards from the protocol (the client names the order), or scope them per lane (a separate kind or an explicit `lane` arg); return `unknown_entity` when nothing matched; never cancel a linked prep order on its own (route it to `cancelConstructionOrder`); prune completed orders (emit the event, keep the result on the entity / colony record).
- **Found:** 2026-11-01, review (sim-gameplay subagent); wildcard fall-through also reported by another reviewer

### GP-11 · Hub storage cap (500) is below the landing pod's cap (600)

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/economy/caps.ts` 13 (`INITIAL_CAPS` metals 600), `shared/sim/src/data/hub.ts` 37 (`storageCapPerFamily: 500`), `shared/sim/src/systems/territory-claim/index.ts` 136–160
- **What happens:** completing the Hub lowers the metals cap from 600 to 500, so Break yields that fitted before the Hub are now lost (LED-11). `INITIAL_CAPS` is also a balance number in code, not a data row.
- **To resolve:** decide whether the Hub may lower a cap; recommendation: caps never go down (`max(current, hub)`) and `INITIAL_CAPS` moves to `hq.startingKit`.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-12 · Status text and status disagree

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/index.ts` 229, 239–243, 455–461; `shared/sim/src/systems/construction/build.ts` 206–211
- **What happens:** an order placed on prepared ground, or one whose site just finished, is `in_progress` with `statusText: 'waiting(site: 9/9)'` until the builder sets `waiting(builder: HQ en route)`. A build paused by a mid-way shortage keeps `status: 'in_progress'` with a `waiting(resources: …)` text (the `blocked(...)` case is LED-13).
- **To resolve:** derive `statusText` from status in one helper; use `waiting_resources` for a paused build.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-30 · Placing a building with too few resources is allowed, except in one special case

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/index.ts` 133–147 (`shouldRejectInsufficientOnPlace`), 185–199; `shared/sim/src/systems/construction/validate.ts` 94–99 (`checkResources`, never passed by the handler)
- **What happens:** an unaffordable Hub is accepted and waits (`waiting_resources`), unless the site still needs prep **and** the colony has exactly 0 `metals.t1`, in which case it is rejected `insufficient_resources`. The check reads `state.colonies[i]?.stock` directly (the sim README names `getColonyStock` the one reader) and its comment says stock is undefined until the first posting, which no longer holds for a landed colony. The client ghost (`evaluatePlacement`) does not apply this rule, so preview and authority can disagree in that one case (D-37).
- **Why it is like this:** a heuristic that prep yields (Break → metals) may make the site affordable.
- **To resolve:** decide the rule. Recommendation: always accept and wait (drop the special case), or always reject when unaffordable through `evaluatePlacement` so the ghost shows it.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-13 · Slot 6 order depends on system ids sorting alphabetically

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/kernel/system.ts` 34, `shared/sim/src/systems/units/index.ts` 23–30 (`constructionProgress`), `shared/sim/src/systems/construction/index.ts` 476–483 (`constructionSite`)
- **What happens:** work progress must run before the site / payment recount in the same slot; this holds only because `'constructionProgress' < 'constructionSite'`. Renaming either id silently swaps them (a site finished this step would start building a step earlier or later).
- **To resolve:** if it ever matters, add an explicit `order` within a slot or a spec that asserts the pipeline order.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-14 · Order and job progress are raw doubles in synced blobs

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/build.ts` 195–203 (`order.progress`), `shared/sim/src/systems/terraform-basic/work.ts` 89–90 (`job.progress`, `job.energyDrawnE`)
- **What happens:** columns are `Math.fround`ed, but blob progress and drawn energy are accumulated doubles and snapped with `1 - 1e-6`. Deterministic across hosts (same arithmetic, MessagePack keeps doubles exactly), but `owedAt(cost, progress)` depends on the exact float sum: a change in `buildTimeS` or `workRate` can move which step pays which slice.
- **To resolve:** if exact pacing matters, keep progress in integer work units (ticks × rate in basis points).
- **Found:** 2026-11-01, review (sim-gameplay subagent)

## HQ and sync

### GP-15 · The HQ blob and every colony record are re-stamped every step, also when nothing changed

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED (scratch probe: idle HQ at full cell, `blobs.hq.changedAt` and `colonies[0].changedAt` equal every tick)
- **Area / code:** `shared/sim/src/systems/hq/index.ts` 400–422 (`stepHq` → `syncHqView` for every HQ every step), 169–220 (`syncHqView` always `setBlob` + `col.changedAt`); also `shared/sim/src/units/movement/orchestrator.ts` 179, `shared/sim/src/systems/terraform-basic/work.ts` 135
- **What happens:** `syncHqView` writes the `hq` blob (a view of every colony's HQ in `byColony`, plus the last-synced HQ at top level) and stamps the colony record unconditionally. `stepHq` calls it for every HQ every tick, so every delta carries the `hq` blob and all colony records on an idle planet; it grows with the number of colonies, and the HQ view duplicates entity columns already in the entity diff.
- **To resolve:** compare the new view with the stored one and stamp only on change (as `UnitBook.flush` does); keep the top-level "last HQ" fields out of the blob.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-16 · `syncHqView` guesses its arguments, and order code writes the HQ's state directly

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/hq/index.ts` 178–186, 211; `resolveHqRow` 95–107; `shared/sim/src/systems/construction/build.ts` 209, 214–216, 234–235; `shared/sim/src/systems/construction/index.ts` 325–332; `shared/sim/src/systems/terraform-basic/queue.ts` 441–450
- **What happens:** when `row` is not an HQ row but `tick` happens to be a valid HQ row index, `syncHqView` uses `tick` as the row and stamps with `state.meta.tick` (the previous tick, which a diff from that tick misses). `resolveHqRow` likewise accepts a row or an id and falls back to any row. Separately, construction / cancel code sets the HQ's `state` / `progress` / `targetQ/R` itself, beside the runner's `setUnitActivity`, so the HQ's displayed state depends on which system wrote last.
- **To resolve:** one signature (`syncHqView(state, row, tick, data)`), no swapped-argument fallback; let the units runner own unit state and have work report progress only.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-17 · Vision supports 8 colonies

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/hq/index.ts` 74 (`owner >= 8` returns), `shared/sim/src/systems/dev/index.ts` 150 (`dev.reveal` clamps to bit 7)
- **What happens:** `explored` is a `u8` bit mask, so colony index ≥ 8 never reveals anything and `dev.reveal` for it sets colony 7's bit. Nothing stops a ninth colony from landing.
- **To resolve:** is 8 the colony cap per planet? Recommendation: yes for now; enforce it in the landing planner (a reject code) and widen the layer when the cap grows.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

## Units

### GP-18 · Planet-level commands (`colonyIndex: null`) mean "colony 0" in some handlers and "any colony" in others

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (scratch probe: `placeBuilding` with `colonyIndex: null` creates an order for colony 0)
- **Area / code:** `shared/sim/src/systems/units/handlers.ts` 28 (owner check skipped when null), `shared/sim/src/systems/construction/index.ts` 340, `shared/sim/src/systems/terraform-basic/index.ts` 94, 119, `shared/sim/src/systems/dev/index.ts` 31–36 (`resolveColonyIndex`), all reading a legacy `cmd.colony` that is not in `SimCommandV1`
- **What happens:** with no colony, `moveUnit` / `stopUnit` may drive any colony's unit, while `placeBuilding` / `enqueueTask` / `cancelTask` / dev handlers act as colony 0. Client ingress gives seated players their colony, so today only scenarios, system and dev sources hit this; an unseated dev client (non-production) acts on colony 0.
- **To resolve:** one helper: player kinds reject `not_own_colony` when `colonyIndex` is null; dev / system kinds take the colony from args explicitly; drop `cmd.colony`.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-19 · Handlers parse fields the contract forbids

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/index.ts` 44–88 (`allowUnclaimed`, `taskId`, `orderId`, `autoPrepare`, top-level `op` / `q` / `r`), `shared/sim/src/systems/construction/index.ts` 83–98 (`buildingKind` / `kind` / `archetype`, `builderEntityId` / `entityId` / `unitId`), `shared/sim/src/systems/units/handlers.ts` 32–44 (`unitId`, `to`)
- **What happens:** the handlers accept aliases and options that the zod contracts (`strictObject`) reject at ingress. `allowUnclaimed: true` in `enqueueTask` would bypass the territory rule; it is safe only because every client command goes through `precheckClientCommand` first. Any internal caller (scenarios, tests, a future module) that submits a command directly can use them.
- **To resolve:** parse with the contract schema inside the handler (or drop the aliases), and keep `allowUnclaimed` an internal option of `enqueueTerraformOrder`, never a command arg.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-20 · `attack` and the combat system have no caller in W01; some reject codes are not registered

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/units/commands/attack.ts` 20–25 (`cannot_attack`, `invalid_target`), `shared/sim/src/systems/units/index.ts` 32–40 (`combat`, slot 10), `shared/sim/src/systems/dev/index.ts` 141 (`no_hq`), `shared/contracts/src/errors/index.ts` (`REJECT_CODES`)
- **What happens:** no handler or system issues `attack`; `combat` runs every step for nothing. The codes `cannot_attack`, `invalid_target`, `no_hq` are not in `REJECT_CODES`; both hosts turn them into `internal` + detail. `attack.validate` allows attacking any other owner's entity (pods, Hubs) with no raid / truce rules.
- **To resolve:** register the codes (or map to `invalid_args` / `unknown_entity`), and add the protection rules before an attack command is exposed.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-21 · Unreachable auto work is retried every `retryBlockedS` with no back-off

- **Status:** Open
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `shared/sim/src/units/runner.ts` 54–69 (`finish` → `skip` until `tick + retryTicks`), `shared/sim/src/units/mobility.ts` 48, `shared/sim/src/grid/pathQueue.ts` (planet-wide 2 000 expansions per step)
- **What happens:** a failed auto job is skipped for 5 s, then searched again; the provider picks the next nearest non-skipped job, which may also fail. A failed search on a large planet explores everything reachable (~10 k expansions, ~5 steps of the planet budget). An order with many unreachable tiles (an island forest, tiles behind water) keeps the FIFO path queue busy and delays every other colony's moves.
- **To resolve:** exponential back-off per job key, and a per-colony share of the path budget (or skip the whole order after N failures).
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-22 · Per-step cost: providers and commands deep-copy every colony's orders; occupancy is rebuilt per call

- **Status:** Open
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `shared/sim/src/systems/terraform-basic/work.ts` 104–109, 160–180 (`readOrdersByColony` copies all colonies' orders), `shared/sim/src/systems/construction/work.ts` 19–23, 58–67, `shared/sim/src/grid/pathProfiles.ts` 16–25 (`occupiedTiles` per `pathBlockedFor` call), `shared/sim/src/units/approach.ts` 31–38
- **What happens:** each unit with auto work copies the whole terraform blob 2–4 times per step (propose, execute, work, HQ view) and the construction blob 2 times; `pathBlockedFor` loops all entities and builds a footprint set on every call (moveUnit, every `approach`, every locomotion step). Fine for one HQ per colony, grows as units × orders × colonies.
- **To resolve:** read each blob once per step (a step-scoped cache like `UnitBook`), cache footprints per `meta.pathEpoch`.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-23 · A destroyed Hub still blocks movement but not placement

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (not reachable in W01: nothing damages a Hub)
- **Area / code:** `shared/sim/src/systems/construction/occupancy.ts` 16–19 (every hub-kind row), `shared/sim/src/systems/construction/placement.ts` 164–171 (`isAlive` filter)
- **What happens:** ground occupancy ignores HP / `inert`, placement skips dead entities, so a new Hub may be placed over a dead Hub's footprint while units still route around it.
- **To resolve:** one "occupies ground" predicate shared by both.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

## Economy

### GP-24 · A credit to an unknown colony index creates placeholder colonies

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/economy/treasury.ts` 195 (`checkMove` only checks integer ≥ 0), `shared/sim/src/economy/store.ts` 27–37 (`writeColonyStock` → `ensureColonyRecord`), `shared/sim/src/kernel/colonies.ts` 10–22; `shared/sim/README.md` ("bad colony indices … are rejected")
- **What happens:** `treasury.add({ colony: 5 })` on a one-colony planet creates colonies 1–5 as `founding` records; a huge index loops pushing records. Only `dev.grant` guards against it. Gameplay callers pass existing colonies today; `system.spawnColony` also derives an unbounded index from `col_<n>` or `colonyIndex` args (`shared/sim/src/systems/landing/index.ts` 261–274).
- **To resolve:** reject `invalid_amount` (bad colony) in `checkMove` when `state.colonies[i]` does not exist, except for the landing credit; bound colony indices in the landing planner (see GP-17).
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-25 · Balance numbers in code and sentinel unit guessing

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/build.ts` 46–51 (cost 200/100/50/50), 55–63 (`resolveHubBuildTimeS` compares with 30 and 150), 70 (7500), 198 (`workRate || 1.5`), 227 (`hp ?? 1500`); `shared/sim/src/systems/construction/index.ts` 203, 238 (footprint `isHub ? 3 : 1`); `shared/sim/src/systems/landing/index.ts` 58 (cargo), 69–76 (`resolveDescentTicks`), 190 (pod HP 500); `shared/sim/src/systems/terraform-basic/queue.ts` 65–66; `shared/sim/src/systems/hq/index.ts` 294–296; `shared/sim/src/units/mobility.ts` 43–48; `shared/sim/src/systems/territory-claim/index.ts` 135–140; `shared/sim/src/economy/caps.ts` 13; data rows `hub.ts`, `hq.ts`, `ops-basic.ts`
- **What happens:** every resolver falls back to literals that copy the data rows, and several rows carry the same number two or three times (`buildS` / `designBuildS` / `buildTimeS`, `podDescentS` / `designPodDescentS`, `timeS` / `baseTimeS` / `designSeconds`, `energy` / `energyCostE`, three recharge-rate fields). Which copy wins is decided by sentinels: `resolveHubBuildTimeS` treats a value equal to the default (30 s / 150 ticks) as "not overridden"; `resolveDescentTicks` treats `podDescentS == designPodDescentS` as "still in seconds", so an override `podDescentS: 1.2` (6 ticks, equal to the design 6) lands after 30 ticks. `opsBasic.timeS` is converted to ticks but never read, so overriding it has no effect.
- **Why it is like this:** compiled (tick) and design (second) values coexist so UI bills can show seconds.
- **To resolve:** one field per number (compiled ticks, plus the design value only where the UI needs it), resolvers that throw on a missing row instead of a literal fallback, no sentinel comparisons.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

## Landing and dev commands

### GP-26 · `dev.land` edge cases: all pods moved to one tile, silent ack, contract mismatch

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/dev/land.ts` 17–35, 47–68; `docs/dev/DEV_TOOLS.md` 69 (`land`); `scenarios/w01-landfall.ts` 38; `shared/contracts/src/commands/dev-land.ts`
- **What happens:** with `colonyIndex: null` and `(q, r)`, every undeployed pod is validated against the others' old positions and then all are moved to the same tile. Without `(q, r)` on a colony whose pod already deployed, the command is acked with no effect, while DEV_TOOLS says `land` rejects `already_landed`. DEV_TOOLS also says `land` deposits the cargo; the cargo is credited when the pod is created (`spawnColonyLanding`). The `w01-auto-place` scenario sends `{ colonyId: 0 }`, which the strict `dev.land` contract would reject; the scenario API skips zod.
- **To resolve:** require one colony; return `already_landed` when nothing is left to land; fix the doc line; make the scenario API validate args with the contract.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-27 · Dev commands fall back to another colony's HQ, and `dev.seed` leaves orders on new ground

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/dev/index.ts` 38–55 (`findHqRow`), 101–113 (`dev.teleport`), 135–144 (`dev.cell`), 159–187 (`dev.seed`), 66 (vision radius 9 literal)
- **What happens:** when the caller's colony has no HQ, `findHqRow` picks the first HQ of any colony, so `tp` / `cell` act on someone else's HQ; `dev.teleport { id }` moves any entity regardless of owner and onto any tile (water included). `dev.seed` replaces the ground but keeps entities, construction and terraform orders, so old jobs run on the new terrain (and credit yields, GP-01). Dev-only and outside production.
- **To resolve:** return `unknown_entity` instead of falling back; have `dev.seed` drop orders (or reject when any exist).
- **Found:** 2026-11-01, review (sim-gameplay subagent)

## Code quality and tests

### GP-28 · Duplicated helpers and dead exports

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** terraform-order readers (`shared/sim/src/systems/terraform-basic/queue.ts` 178, `shared/sim/src/systems/hq/index.ts` 122, `frontend/game/features/terraform-basic/TileOverlay.ts` 77); cell-energy math (`hq/index.ts` 148–166 duplicates 358–397); footprints (`construction/validate.ts` 42–46 duplicates `placement.ts` 154–160); "colony's HQ / Hub" scans (`validate.ts` 49–73, `queue.ts` 75–89 and 228–238, `dev/index.ts` 38–55); `syncHqView` / `getHqView` build the same view twice (`hq/index.ts` 191–209, 231–249); `territory-claim` `normalizeClaimOpts` and `validateHubPlacement` keep a second positional signature; colony colour palette (`shared/sim/src/kernel/colonies.ts` 4 `DEFAULT_COLONY_COLORS` is copied in `frontend/render/planets/hex/territoryBorder.ts` 18–25 under the same name); resource aliases (`shared/sim/src/systems/dev/index.ts` 24–29 and `frontend/game/features/dev-console/commands.ts`)
- **What happens:** the same rule lives in two or three places (AGENTS.md "no copy/paste"). Dead or test-only: `findAliveColonyHqRow` (no caller), `validateHubPlacement`, `hasColonyHub`, `computeSitePrepBill`, `getHubFootprintTiles` (tests only; it is `getBuildingFootprintTiles(q, r, 3)`), `checkResources` path of `validateBuildingPlacement` (no production caller), `IssueOpts.queue` (tests only), `territory-claim` module with no systems or handlers. The sim's `RESOURCE_ALIASES` in `dev.grant` never matches: the `dev.grant` contract types `resource` as `ResourceKey`, so `metals` is rejected `invalid_args` at ingress; the dev console maps aliases itself before sending. The two colour palettes can drift: a colony created by `ensureColonyRecord` gets the sim's colour, while the border renderer picks from its own copy by index.
- **To resolve:** extract one reader / view builder / "find colony unit" helper; delete or move test-only helpers into `test/`; delete the sim's alias map; move the colony palette to `shared/contracts` (or `shared/config`) so sim and render import the same list (render may not import `shared/sim` internals).
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-29 · Untested paths

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (v8 coverage over `systems/`, `units/`, `economy/`: 91.8 % statements, 79.7 % branches)
- **Area / code:** `construction/build.ts` 207–211 (build paused by a shortage mid-way), `construction/validate.ts` 95–97, `construction/index.ts` 417, 443; `terraform-basic/index.ts` 123, 136 (cancel with a bad id / no id); `units/movement/orchestrator.ts` 159–162 (entity removed with a live route); `landing/index.ts` 266–273 (`col_<n>` colony ids); `dev/land.ts` null-colony branch; `shared/sim/test/systems/prepared-ground.property.spec.ts` 346–355 (leftover `console.log` with timing)
- **What happens:** the mid-build shortage path (HQ goes idle, order keeps `in_progress`) and every case in GP-01, GP-05, GP-07, GP-10, GP-15 have no spec.
- **To resolve:** add specs for those cases; drop the timing log.
- **Found:** 2026-11-01, review (sim-gameplay subagent)

### GP-31 · Sim rejects carry only a code, never a detail

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/kernel/commands.ts` 15, 26–31 (`CommandHandler` returns a string, `CommandOutcome` has no `detail`), `shared/sim/src/systems/construction/index.ts` 360 (drops `validation.block`), `frontend/game/features/hub-placement/HubPlacementMenu.ts` 298, 326–327
- **What happens:** a handler can only return a reject code. The placement handler knows the exact cause (`trees`, `uneven`, `hubExists`, `waiting(resources: metals.t1 120/200)`), but the host sends only `terrain_unbuildable` / `site_blocked` / `insufficient_resources`; hosts add a `detail` only when they rewrite an unregistered code to `internal`. The Hub menu shows `detail ?? code`, so a server rejection reads "site blocked" instead of the `placementBlockText` the ghost shows. Same for terraform skips (`firstReject`) and treasury codes.
- **To resolve:** let handlers return `{ code, detail? }` (and keep `string` for compatibility), carry `detail` in `CommandOutcome`, and pass `placementBlockText(block)` from `placeBuilding`.
- **Found:** 2026-11-01, review (sim-gameplay subagent), from another reviewer's report

### GP-32 · Terraform rules have no read-only form; the client re-implements them

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` 75–176 (`hasColonyClaimedTerritory`, `canRunTerraformOpOnTile`, `resolveTerraformOpForTile` take `SimState`); copies in `frontend/game/features/terraform-basic/BrushController.ts` 91–105 (`hasClaimedInTiles`, `isOpValidForTerrainPrep`), 117–160 (`planBrushStroke`)
- **What happens:** placement has one pure rule over a read-only world (`evaluatePlacement` + `PlacementWorld`, D-37); terraform does not. The brush preview re-implements the owner rule, the auto-op choice and the terrain / prep check over the replica view. They already differ: the sim also counts an active own Hub as "claimed" (`hasColonyClaimedTerritory`), and with no tile layers the client falls back to queueing every tile with the selected op. A change in one copy makes the preview and the authority disagree. `BrushController.cancelOrder` 345–347 also calls the sim's `cancelTerraformOrder` on the client's state (cross-area: the client must not mutate world state).
- **To resolve:** one `evaluateTerraform(world, opts)` over a read-only `TerraformWorld` (terrain, prep, owner, plus "colony has territory"), used by the `enqueueTask` handler and the brush; a parity spec like placement's.
- **Found:** 2026-11-01, review (sim-gameplay subagent), from another reviewer's report

## Cross-area findings (added by the lead)

### GP-33 · `dev.seed` replaces the ground but keeps owner, explored, anchors and grace

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/dev/index.ts` (~L163-185, `copyLayers`)
- **What happens:** only terrain/prep/deposit/richness/height/sub-layers are copied from the regenerated planet; territory `owner`, `explored`, `anchors` and `graceUntil` stay from the old ground, so claims and fog no longer match the new map.
- **To resolve:** reset (or deliberately keep and document) those layers; add a test.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)

### GP-34 · Terraform op → terrain mapping is hard-coded although the data rows describe it

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts:118-136`; `shared/sim/src/data/ops-basic.ts` (`fromTerrain`, `toTerrain`, `toPrep`)
- **What happens:** the rows carry the mapping but no code reads it (see also XC-01/XC-15 data fields without a reader); tuning them changes nothing.
- **To resolve:** read the mapping from the rows, or delete the fields.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)

### GP-35 · Small duplicated tile helpers; one tile write without a tick

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/hq/index.ts:74-91` (`revealVision` re-implements `markTileExplored` bit logic); `shared/sim/src/systems/territory-claim/index.ts:108` (`setTileOwner(...)` without `tick`)
- **What happens:** two copies of the explored-bit rule can drift; a tile write without a tick is not stamped for `diffSince` unless something else stamps the tile in the same step.
- **To resolve:** call `markTileExplored`; pass `opts.tick` (and a test that the claimed ring appears in a client diff).
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)

### GP-36 · Every colony's orders, units and HQ state are sent to every client

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** blobs `units`, `unitMotion`, `pathQueue`, `terraformTasks`, `constructionQueue`, `hq` (`shared/sim/src/host/diff.ts` sends blobs whole)
- **What happens:** a client sees other colonies' build plans, queues and unit paths (no fog of war for blob state); only hidden tile layers are stripped (`forClient`).
- **To resolve:** decide whether W01 needs per-colony filtering (a `forClient(colony)` blob filter) or accepts it until fog of war is built. Recommendation: accept for W01, record the rule in SIMULATION.md, filter when fog of war lands.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)

### GP-37 · The scenario API bypasses command validation

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `scenarios/_loader.ts` (`apiFor` submits straight to the host); `scenarios/w01-landfall.ts:38` sends `dev.land { colonyId: 0 }`
- **What happens:** scenario commands skip the zod contract check that every real client command passes, so a scenario can rely on args the server would reject (the strict `dev.land` contract has no `colonyId`).
- **To resolve:** validate scenario commands with the same contract parser (`shared/contracts` command schemas) and fix the args.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
