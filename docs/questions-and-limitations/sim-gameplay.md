# Sim gameplay: questions and limitations

W01 gameplay rules in `shared/sim`: landing, HQ, construction (placement, prep, work, occupancy), terraform-basic,
territory claim, dev commands, the units runner / movement / commands, the economy treasury, and `tests/scenarios/`.
Ledger and journal limits are in [`economy-ledger.md`](./economy-ledger.md) (LED-xx). Format: [README](./README.md).

## Terraform

### GP-01 · Terraform jobs are validated only when queued, so one tile can be cleared or broken many times (duplicate yields)

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** high
- **Confidence:** CONFIRMED (scratch probe: one forest tile queued 5× in one `enqueueTask` and once more in a second order → 6 `obstacleRemoved` events, 30 biomass instead of 5)
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` (`buildJobsFromTiles` 288–327, `enqueueTerraformOrder` 331–407), `shared/sim/src/systems/terraform-basic/work.ts` (`workJob` 78–101, `completeTerraformJob` 26–52)
- **What happens:** `canRunTerraformOpOnTile` runs only at enqueue. Nothing removes duplicate tiles inside one order (the contract allows 256 tiles, duplicates included), nothing rejects a tile that already has a job in another order (manual or linked prep), and `workJob` never re-checks the tile. When the first `clear` / `break` finishes, the next job on the same tile still runs and `completeTerraformJob` credits `terraform.yield` again (5 biomass per Clear, 10 metals per Break) and re-runs `revealSubsurface`. The same gap lets work continue on a tile that changed owner after it was queued (another colony's Hub claimed it, GP-06) or whose terrain was changed by `dev.seed` / `dev.cell`.
- **Why it is like this:** the queue was built for "validate the request, then trust the job list".
- **Workaround / mitigation:** yields are capped by storage (LED-11); each duplicate still costs HQ time and cell energy.
- **To resolve:** de-duplicate `(q, r)` per op at enqueue and reject a tile that already has a pending job of that op for the colony; in `workJob` (or when a job becomes first) re-run `canRunTerraformOpOnTile` and drop the job (no yield) when it no longer applies. Add a spec with a duplicated tile list and with two overlapping orders.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** one pure rule `evaluateTerraform` (`terraform-basic/rules.ts`) plans each `(op, q, r)` once per colony: duplicates in a request and jobs already queued in any of the colony's orders are skipped (`skippedCount`); `terraform-basic/work.ts` re-checks a job with the same rule (and the order's own `allowUnclaimed`) when it is picked and right before it completes, and drops it without work or yield when the tile changed (worked by another order, re-generated, claimed). Tests `shared/sim/test/systems/terraform-rules.spec.ts` › GP-01 (the probe: 5× one forest tile + a second order → 1 `obstacleRemoved`, 5 biomass; a tile changed before completion → no yield; a tile claimed by another colony → dropped).

### GP-02 · No limit on queued terraform orders or jobs

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` (`getManualTerraformLaneCount` 246, `enqueueTerraformOrder`), `shared/contracts/src/commands/enqueue-task.ts` (`tiles.max(256)`)
- **What happens:** `getManualTerraformLaneCount` is exported (and re-exported by construction) but nothing calls it outside tests; `enqueueTask` accepts any number of orders of up to 256 tiles each. The whole `terraformTasks` blob is rewritten (in several copies, GP-08) on every work step and every provider reorder, and synced to every client, so its size is bounded only by the ingress rate limit.
- **Why it is like this:** the lane limit of UO-TF-03 was modelled (`countsTowardLaneLimit`) but never enforced.
- **Workaround / mitigation:** ingress token bucket (`rate_limited`).
- **To resolve:** decide the lane limit (UO-TF-03) and the max open jobs per colony; reject with a registered code (e.g. `supply_cap` or a new `queue_full`) in the `enqueueTask` handler. Recommendation: enforce the lane count plus a job cap, and de-duplicate tiles (GP-01).
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** recommendation applied with numbers as data rows the owner can tune: `hq.t1.terraformMaxOrders` (16 open manual orders; a Hub's linked prep does not count) and `hq.t1.terraformMaxJobs` (1024 queued jobs over all orders); over either `enqueueTask` is refused with the new registered code `queue_full`. Tile de-duplication: GP-01. Tests `terraform-rules.spec.ts` › GP-02.

### GP-03 · Before its Hub exists a colony may terraform any unclaimed tile on the planet

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` (`canRunTerraformOpOnTile` 110–116, `hasColonyClaimedTerritory` 75–89)
- **What happens:** while the colony owns no tile, every unclaimed tile passes the ownership check, so it can queue Clear / Break (and collect their yields) anywhere, including next to another colony's pod. Once it owns one tile, only own tiles are allowed. `hasColonyClaimedTerritory` also scans the whole owner layer for every tile of every request (up to 256 × tile count per command).
- **Why it is like this:** the HQ must be able to prepare its first Hub site before any territory exists.
- **To resolve:** decide the pre-Hub work area. Recommendation: limit pre-Hub manual terraform to a radius around the colony's landing (data row), keep linked Hub prep as is; cache "has territory" per colony (e.g. on the colony record set by `applyHubCompletionEffects`).
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** recommendation applied: before the colony owns territory, manual terraform of unclaimed tiles is limited to `hq.startingKit.preHubTerraformRadius` (10, the Hub claim radius) of the colony's pod; linked Hub prep keeps `allowUnclaimed`. "Has territory" is computed once per request / job check (`terraformWorldFrom`), not per tile. A colony without a pod (tests that spawn an HQ directly) has no radius limit. The radius is the owner's to tune. Test `terraform-rules.spec.ts` › GP-03.

### GP-04 · Manual terraform always outranks construction

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/units/registry.ts` 16–19 (providers `[terraformProvider, buildProvider]`)
- **What happens:** the terraform provider is asked first and offers any queued job of the colony, manual orders included. A colony with a large manual order never builds its in-progress Hub until every manual job is done (or skipped as unreachable).
- **Why it is like this:** "a site must be prepared before it can be built on" (linked prep), and manual orders share the same provider.
- **To resolve:** decide the priority. Recommendation: linked prep → build → manual terraform, or round-robin by order age.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** recommendation applied: providers are asked linked prep → construction → manual terraform (`linkedPrepProvider`, `buildProvider`, `terraformProvider` in `systems/units/registry.ts`). Test `construction-orders.spec.ts` › GP-04 (a ready Hub is built while a 15-tile manual order waits).

## Construction

### GP-05 · `placeBuilding` accepts any building name and builds it as a Hub entity with a 1×1 order

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** high
- **Confidence:** CONFIRMED (scratch probe: `placeBuilding { building: 'pylon' }` on own ground is acked; a later `commandHub` is rejected `site_blocked` / `hubExists`)
- **Area / code:** `shared/contracts/src/commands/place-building.ts` (`building: z.string()`), `shared/sim/src/systems/construction/placement.ts` (`resolvePlacementRule` 137–151, `entityFootprint` 163), `shared/sim/src/systems/construction/index.ts` (`placeBuildingOrder` 175–266, `spawnPendingHubRow` 149–172), `shared/sim/src/systems/construction/occupancy.ts` 16–19
- **What happens:** an unknown `building` gets the default rule (1×1, own territory, `maxPerColony: Infinity`). `placeBuildingOrder` then spawns an entity of kind `ENTITY_KIND.hub` with the Hub's HP and charges the Hub cost (`resolveHubCost`), the order stores `footprint: 1`, but placement occupancy and ground occupancy treat every hub-kind entity as 3×3. Because the entity is hub-kind, the colony's real Command Hub is then refused (`hubExists` → `site_blocked`). Completion skips the Hub effects, so the colony pays 400 resources for nothing and can no longer found itself. Only `tier > 1` is refused; `builderEntityId` is not in the contract, so the builder check is "the colony has a landed HQ".
- **Why it is like this:** W01 has one building; the generic path was a placeholder.
- **To resolve:** reject unknown building kinds (`invalid_args`) in `evaluatePlacement` (one rule, client ghost agrees), or make the contract an enum of known buildings; give each building its own row (cost, HP, kind, footprint) instead of `resolveHubT1Row`.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `evaluatePlacement` refuses a building the data does not know (`resolveBuildingRow`: the Hub row's `building` / `archetype` names) with block `unknownBuilding` → `invalid_args` (ghost and handler agree, detail `unknown building`); the generic 1×1 default rule is gone, the order takes footprint / HP / name from the building's row. Tests `construction-orders.spec.ts` › GP-05 (`pylon` refused, real Hub still placeable), `hub-placement.spec.ts`.

### GP-06 · A Hub can be placed anywhere on unclaimed land, also right next to another colony's pod

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED (traced; no rule in `evaluateTile` / `colonyBlock`)
- **Area / code:** `shared/sim/src/systems/construction/placement.ts` (`evaluateTile` 176–188, `colonyBlock` 190–201), `shared/sim/src/systems/territory-claim/index.ts` (`claimTerritoryRadius`)
- **What happens:** `allowUnclaimedPlacement: true` and no distance rule: colony A may put its Hub a few tiles from colony B's landing (only landings keep `minLandingSeparation`, D-39). On completion A claims radius 10 first-come; B's starter Hub site and pod surroundings become foreign (`not_own_territory` for B's placement and terraform). B's pending Hub prep on those tiles keeps running because jobs are not re-validated (GP-01).
- **Why it is like this:** the first Hub has to go on unclaimed ground; competition rules are later waves.
- **To resolve:** decide. Recommendation: a Hub must be within N tiles of its own landing / HQ and at least `minLandingSeparation` (or the claim radius) from other colonies' landings and Hubs; enforce it in `evaluatePlacement` so the ghost shows it.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Done (review-fix round 2026-11-01, conservative variant of the recommendation):** in `evaluatePlacement` (so the ghost shows it) a Hub must be within `hq.startingKit.hubMaxDistFromLanding` (12) of its own pod (`farFromLanding`) and not closer to another colony's pod or Hub than to its own pod (`nearOtherColony`), both `site_blocked`. The Voronoi-style rule was chosen instead of "≥ `minLandingSeparation` from other landings" because that would refuse the guaranteed starter site (up to 3 tiles from the own pod; landings are only 6 apart). Still for the owner: the distances. Test `construction-orders.spec.ts` › GP-06.

### GP-07 · The construction queue is re-stamped every step while an order waits for resources

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (scratch probe: `constructionQueue.changedAt` equals every tick while `waiting_resources`)
- **Area / code:** `shared/sim/src/systems/construction/index.ts` 434–447 (`stepConstruction`), `shared/sim/src/systems/construction/build.ts` 88–102 (`payConstructionCost`)
- **What happens:** `if (!order.costPaid) { payConstructionCost(...); changed = true; ... }` sets `changed` whether or not anything changed, so `writeConstructionOrders` stamps the whole blob (all colonies' orders, twice, GP-08) every tick until the colony can afford the Hub. A colony that never gets the resources sends the blob in every delta forever.
- **To resolve:** set `changed` only when status / reason / `costPaid` actually change; add a "no delta while idle" spec (like the units book's).
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `construction/site.ts` sets an order's status through `setOrderStatus` (returns whether anything changed) and writes the queue only on a real change. Test `construction-orders.spec.ts` › "an order waiting for resources is written once".

### GP-08 · Order blobs bypass `setBlob` and carry the same orders several times

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (blob keys after a write: `0, changedAt, value, orders, byColony`)
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` 201–226 (`writeOrdersByColony`), `shared/sim/src/systems/construction/index.ts` 109–116 (`writeConstructionOrders`); readers `queue.ts` 178–199, `shared/sim/src/systems/hq/index.ts` 122–140, `frontend/game/features/terraform-basic/TileOverlay.ts` 77–94, `frontend/game/features/hub-placement/GhostEvaluator.ts` 98–115
- **What happens:** `writeOrdersByColony` assigns `state.blobs.terraformTasks` directly (not `setBlob`) as `{ changedAt, value, ...value }` where `value = { orders, byColony, ...byColony }`: every order is stored six times, and diffs / snapshots send the whole object. `constructionQueue` stores `orders` and `byColony` (two copies). Three readers (two in the sim, one in the client) accept every historical shape (`value ?? blob`, `byColony`, numeric keys, `orders`).
- **Why it is like this:** compatibility with older blob shapes during W01 development.
- **To resolve:** one shape (`setBlob(state, 'terraformTasks', { byColony })`), one reader function exported from the sim and used by HQ view and client, a codec migration for saved planets.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `terraformTasks = { byColony }` and `constructionQueue = { orders }`, both through `setBlob`; one reader each (`terraformOrdersOf`, `constructionOrdersOf`, usable on view blobs) used by the HQ view and the sim. Saved planets need no codec migration: the old terraform value also had `byColony` and the old construction value `orders`; the extra keys go on the next write. The client copies (`TileOverlay.extractColonyOrders`, `GhostEvaluator.extractOrdersFromBlobs`) still accept the old shapes and should switch to the sim readers (FRONTEND-FEATURES). Test `construction-orders.spec.ts` › GP-08.

### GP-09 · Order ids are the client's `commandId`, with no uniqueness check

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** PLAUSIBLE (depends on whether ingress de-duplicates `cmd.id`)
- **Area / code:** `shared/sim/src/systems/construction/index.ts` 354 (`orderId: cmd.commandId`), 210, 218 (`${orderId}_prep`); `shared/sim/src/systems/terraform-basic/index.ts` 106; `cancelConstructionOrder` 293–304, `cancelTerraformOrder` 425–433
- **What happens:** construction and terraform orders take the client-chosen command id (≤ 40 chars). A reused id gives two orders with the same `orderId`; lookups (`readyOrder`, `currentJob`, cancel) take the first match. A manual `enqueueTask` sent with command id `X_prep` (or the decimal entity id of a Hub) collides with a Hub's linked prep, and cancelling one removes the other. Cancel also matches by `o.building` (`cancelTask { taskId: 'commandHub' }` cancels the Hub).
- **To resolve:** generate order ids in the sim (`ctx.newEntityId()`-style counter in the blob), keep `commandId` only as a reference; reject an existing id.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** order ids are sim-made (`tf#<n>`, `build#<n>`, linked prep `build#<n>/prep`; counter `blobs.orderSeq`); the client's command id is kept as `taskId` and may name only one open order of the colony (a reused id is `invalid_args`); cancel matches by building name is gone. Test `terraform-rules.spec.ts` › GP-09 / GP-10.

### GP-10 · `cancelTask` wildcards cross between construction and terraform; misses are acked; completed orders stay forever

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `cancelTask` cancels in its own lane: an order id, a task id or a building's entity id; `'active'` = the colony's first manual terraform order, `'current'` = its open construction order, never crossing lanes; a Hub's linked prep is routed to the Hub's construction order; no match → `unknown_entity`; no id-less `list[0]` path. Completed construction orders leave the queue (the result is the active building and the colony record). Contract for the client (FRONTEND-FEATURES): keep sending `'active'` from the brush and `'current'` from the Hub menu, or (better) the order's `orderId` / your own command id; expect `unknown_entity` when nothing matches. Tests `terraform-rules.spec.ts` › GP-09 / GP-10, `hub-construction.spec.ts`.

### GP-11 · Hub storage cap (500) is below the landing pod's cap (600)

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/economy/caps.ts` 13 (`INITIAL_CAPS` metals 600), `shared/sim/src/data/hub.ts` 37 (`storageCapPerFamily: 500`), `shared/sim/src/systems/territory-claim/index.ts` 136–160
- **What happens:** completing the Hub lowers the metals cap from 600 to 500, so Break yields that fitted before the Hub are now lost (LED-11). `INITIAL_CAPS` is also a balance number in code, not a data row.
- **To resolve:** decide whether the Hub may lower a cap; recommendation: caps never go down (`max(current, hub)`) and `INITIAL_CAPS` moves to `hq.startingKit`.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** recommendation applied: Hub completion sets each family cap to `max(current, hub.t1.storageCapPerFamily)` (metals stay 600), and the pre-Hub caps are a data row `hq.startingKit.storageCaps` (`initialCaps(data)`; `INITIAL_CAPS` removed). Tests `territory-claim.spec.ts` (caps 600/500/500 after the Hub), `catalog.spec.ts` › initialCaps.

### GP-12 · Status text and status disagree

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/index.ts` 229, 239–243, 455–461; `shared/sim/src/systems/construction/build.ts` 206–211
- **What happens:** an order placed on prepared ground, or one whose site just finished, is `in_progress` with `statusText: 'waiting(site: 9/9)'` until the builder sets `waiting(builder: HQ en route)`. A build paused by a mid-way shortage keeps `status: 'in_progress'` with a `waiting(resources: …)` text (the `blocked(...)` case is LED-13).
- **To resolve:** derive `statusText` from status in one helper; use `waiting_resources` for a paused build.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `statusTextOf` / `setOrderStatus` (`construction/orders.ts`) derive the text from the status; a site that finishes goes `in_progress` with text `in_progress`; a build that runs short mid-way is `waiting_resources` (remembers the slice it waits on in `waitingFor`, HQ freed) and resumes once stock covers it. Tests `construction-orders.spec.ts` › "a build paused by a shortage …", `hub-placement.spec.ts`, `linked-prep.spec.ts`.

### GP-30 · Placing a building with too few resources is allowed, except in one special case

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/index.ts` 133–147 (`shouldRejectInsufficientOnPlace`), 185–199; `shared/sim/src/systems/construction/validate.ts` 94–99 (`checkResources`, never passed by the handler)
- **What happens:** an unaffordable Hub is accepted and waits (`waiting_resources`), unless the site still needs prep **and** the colony has exactly 0 `metals.t1`, in which case it is rejected `insufficient_resources`. The check reads `state.colonies[i]?.stock` directly (the sim README names `getColonyStock` the one reader) and its comment says stock is undefined until the first posting, which no longer holds for a landed colony. The client ghost (`evaluatePlacement`) does not apply this rule, so preview and authority can disagree in that one case (D-37).
- **Why it is like this:** a heuristic that prep yields (Break → metals) may make the site affordable.
- **To resolve:** decide the rule. Recommendation: always accept and wait (drop the special case), or always reject when unaffordable through `evaluatePlacement` so the ghost shows it.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** recommendation applied ("always accept and wait"): `shouldRejectInsufficientOnPlace` and the `checkResources` option are gone; an unaffordable Hub is accepted and waits in `waiting_site` / `waiting_resources`, the ghost and the handler agree. Covered by `construction-orders.spec.ts` (waiting order) and `hub-construction.spec.ts`.

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

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED (scratch probe: idle HQ at full cell, `blobs.hq.changedAt` and `colonies[0].changedAt` equal every tick)
- **Area / code:** `shared/sim/src/systems/hq/index.ts` 400–422 (`stepHq` → `syncHqView` for every HQ every step), 169–220 (`syncHqView` always `setBlob` + `col.changedAt`); also `shared/sim/src/units/movement/orchestrator.ts` 179, `shared/sim/src/systems/terraform-basic/work.ts` 135
- **What happens:** `syncHqView` writes the `hq` blob (a view of every colony's HQ in `byColony`, plus the last-synced HQ at top level) and stamps the colony record unconditionally. `stepHq` calls it for every HQ every tick, so every delta carries the `hq` blob and all colony records on an idle planet; it grows with the number of colonies, and the HQ view duplicates entity columns already in the entity diff.
- **To resolve:** compare the new view with the stored one and stamp only on change (as `UnitBook.flush` does); keep the top-level "last HQ" fields out of the blob.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `syncHqView` (`systems/hq/view.ts`) builds the view and writes `blobs.hq.byColony[owner]` and the colony record only when it differs from the stored one; the top-level "last HQ" fields are gone (the blob is `{ byColony }`); a full cell is not rewritten either. Test `construction-orders.spec.ts` › GP-15.

### GP-16 · `syncHqView` guesses its arguments, and order code writes the HQ's state directly

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/hq/index.ts` 178–186, 211; `resolveHqRow` 95–107; `shared/sim/src/systems/construction/build.ts` 209, 214–216, 234–235; `shared/sim/src/systems/construction/index.ts` 325–332; `shared/sim/src/systems/terraform-basic/queue.ts` 441–450
- **What happens:** when `row` is not an HQ row but `tick` happens to be a valid HQ row index, `syncHqView` uses `tick` as the row and stamps with `state.meta.tick` (the previous tick, which a diff from that tick misses). `resolveHqRow` likewise accepts a row or an id and falls back to any row. Separately, construction / cancel code sets the HQ's `state` / `progress` / `targetQ/R` itself, beside the runner's `setUnitActivity`, so the HQ's displayed state depends on which system wrote last.
- **To resolve:** one signature (`syncHqView(state, row, tick, data)`), no swapped-argument fallback; let the units runner own unit state and have work report progress only.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `syncHqView(state, row, tick, data)` only (no swapped-argument fallback); `resolveHqRow` accepts an HQ row or returns -1. Construction, cancel and terraform code no longer write the HQ's state: the `build` / `terraform` unit commands set it through `setUnitActivity`, build code only reports progress. Covered by the existing hub-construction / terraform specs (HQ idle after cancel / completion).

### GP-17 · Vision supports 8 colonies

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/hq/index.ts` 74 (`owner >= 8` returns), `shared/sim/src/systems/dev/index.ts` 150 (`dev.reveal` clamps to bit 7)
- **What happens:** `explored` is a `u8` bit mask, so colony index ≥ 8 never reveals anything and `dev.reveal` for it sets colony 7's bit. Nothing stops a ninth colony from landing.
- **To resolve:** is 8 the colony cap per planet? Recommendation: yes for now; enforce it in the landing planner (a reject code) and widen the layer when the cap grows.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** recommendation applied: `MAX_COLONIES_PER_PLANET = 8` in `systems/landing`; a landing for colony index ≥ 8 is refused with the new registered code `planet_full`; `dev.reveal` refuses such an index. Widen `explored` before raising it. Test `landing-rules.spec.ts` › GP-17.

## Units

### GP-18 · Planet-level commands (`colonyIndex: null`) mean "colony 0" in some handlers and "any colony" in others

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (scratch probe: `placeBuilding` with `colonyIndex: null` creates an order for colony 0)
- **Area / code:** `shared/sim/src/systems/units/handlers.ts` 28 (owner check skipped when null), `shared/sim/src/systems/construction/index.ts` 340, `shared/sim/src/systems/terraform-basic/index.ts` 94, 119, `shared/sim/src/systems/dev/index.ts` 31–36 (`resolveColonyIndex`), all reading a legacy `cmd.colony` that is not in `SimCommandV1`
- **What happens:** with no colony, `moveUnit` / `stopUnit` may drive any colony's unit, while `placeBuilding` / `enqueueTask` / `cancelTask` / dev handlers act as colony 0. Client ingress gives seated players their colony, so today only scenarios, system and dev sources hit this; an unseated dev client (non-production) acts on colony 0.
- **To resolve:** one helper: player kinds reject `not_own_colony` when `colonyIndex` is null; dev / system kinds take the colony from args explicitly; drop `cmd.colony`.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `commandColony(cmd)` (`systems/command.ts`): player and dev colony-scoped handlers act for `cmd.colonyIndex` and reject `not_own_colony` without one; `system.spawnColony` takes its colony from `colonyIndex` / args explicitly; the legacy `cmd.colony` is no longer read. Tests `terraform-rules.spec.ts` › GP-18 / GP-19, `dev.spec.ts` › GP-18, `hq.spec.ts`.

### GP-19 · Handlers parse fields the contract forbids

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/index.ts` 44–88 (`allowUnclaimed`, `taskId`, `orderId`, `autoPrepare`, top-level `op` / `q` / `r`), `shared/sim/src/systems/construction/index.ts` 83–98 (`buildingKind` / `kind` / `archetype`, `builderEntityId` / `entityId` / `unitId`), `shared/sim/src/systems/units/handlers.ts` 32–44 (`unitId`, `to`)
- **What happens:** the handlers accept aliases and options that the zod contracts (`strictObject`) reject at ingress. `allowUnclaimed: true` in `enqueueTask` would bypass the territory rule; it is safe only because every client command goes through `precheckClientCommand` first. Any internal caller (scenarios, tests, a future module) that submits a command directly can use them.
- **To resolve:** parse with the contract schema inside the handler (or drop the aliases), and keep `allowUnclaimed` an internal option of `enqueueTerraformOrder`, never a command arg.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** handlers parse `args` with the command's contract (`parseArgs`): `enqueueTask`, `cancelTask`, `placeBuilding`, `moveUnit`, `stopUnit`, `dev.grant`, `dev.cell`, `dev.land`, `landPod`; aliases and `allowUnclaimed` are gone (`allowUnclaimed` is an internal option of `enqueueTerraformOrder`). `system.spawnColony` stays lenient (module-only, other areas' tests send partial args). Tests `terraform-rules.spec.ts` › GP-18 / GP-19, `hq.spec.ts`.

### GP-20 · `attack` and the combat system have no caller in W01; some reject codes are not registered

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/units/commands/attack.ts` 20–25 (`cannot_attack`, `invalid_target`), `shared/sim/src/systems/units/index.ts` 32–40 (`combat`, slot 10), `shared/sim/src/systems/dev/index.ts` 141 (`no_hq`), `shared/contracts/src/errors/index.ts` (`REJECT_CODES`)
- **What happens:** no handler or system issues `attack`; `combat` runs every step for nothing. The codes `cannot_attack`, `invalid_target`, `no_hq` are not in `REJECT_CODES`; both hosts turn them into `internal` + detail. `attack.validate` allows attacking any other owner's entity (pods, Hubs) with no raid / truce rules.
- **To resolve:** register the codes (or map to `invalid_args` / `unknown_entity`), and add the protection rules before an attack command is exposed.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `attack` rejects with registered codes only (`invalid_args`, `unknown_entity`); `dev.cell` without an HQ is `unknown_entity` (no `no_hq`). The combat slot stays (cheap; later waves use it); the protection rules are documented on `attackCommand` as a precondition for exposing it. Test `units/commands.spec.ts`.

### GP-21 · Unreachable auto work is retried every `retryBlockedS` with no back-off

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `shared/sim/src/units/runner.ts` 54–69 (`finish` → `skip` until `tick + retryTicks`), `shared/sim/src/units/mobility.ts` 48, `shared/sim/src/grid/pathQueue.ts` (planet-wide 2 000 expansions per step)
- **What happens:** a failed auto job is skipped for 5 s, then searched again; the provider picks the next nearest non-skipped job, which may also fail. A failed search on a large planet explores everything reachable (~10 k expansions, ~5 steps of the planet budget). An order with many unreachable tiles (an island forest, tiles behind water) keeps the FIFO path queue busy and delays every other colony's moves.
- **To resolve:** exponential back-off per job key, and a per-colony share of the path budget (or skip the whole order after N failures).
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** failed auto work backs off per job key: skip `retryBlockedS` × 2^(n−1) up to `hq.t1.retryBlockedMaxS` (60 s); the failure count is cleared when the command succeeds and when nothing is left on hold (`units/runner.ts`, `UnitRecord.fails`). Not done: a per-colony share of the path budget (`grid/pathQueue.ts`, SIM-ENGINE area); the back-off already cuts repeated failed searches. Test `units/backoff.spec.ts` (25, 50, 100 ticks).

### GP-22 · Per-step cost: providers and commands deep-copy every colony's orders; occupancy is rebuilt per call

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `shared/sim/src/systems/terraform-basic/work.ts` 104–109, 160–180 (`readOrdersByColony` copies all colonies' orders), `shared/sim/src/systems/construction/work.ts` 19–23, 58–67, `shared/sim/src/grid/pathProfiles.ts` 16–25 (`occupiedTiles` per `pathBlockedFor` call), `shared/sim/src/units/approach.ts` 31–38
- **What happens:** each unit with auto work copies the whole terraform blob 2–4 times per step (propose, execute, work, HQ view) and the construction blob 2 times; `pathBlockedFor` loops all entities and builds a footprint set on every call (moveUnit, every `approach`, every locomotion step). Fine for one HQ per colony, grows as units × orders × colonies.
- **To resolve:** read each blob once per step (a step-scoped cache like `UnitBook`), cache footprints per `meta.pathEpoch`.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** providers and commands read the queues read-only (no copy) and copy only the own colony's orders when they change them (`readColonyOrders` / `writeColonyOrders`); `buildingFootprints` caches the footprint lists per state and recomputes only when the set of occupying buildings changes. Existing specs green; `prepared-ground.property.spec.ts` (500 random logs) unchanged.

### GP-23 · A destroyed Hub still blocks movement but not placement

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (not reachable in W01: nothing damages a Hub)
- **Area / code:** `shared/sim/src/systems/construction/occupancy.ts` 16–19 (every hub-kind row), `shared/sim/src/systems/construction/placement.ts` 164–171 (`isAlive` filter)
- **What happens:** ground occupancy ignores HP / `inert`, placement skips dead entities, so a new Hub may be placed over a dead Hub's footprint while units still route around it.
- **To resolve:** one "occupies ground" predicate shared by both.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** one predicate `occupiesGround` (alive building) used by placement (`occupiedTiles`) and ground occupancy (`construction/occupancy.ts`). Test `construction-orders.spec.ts` › GP-23.

## Economy

### GP-24 · A credit to an unknown colony index creates placeholder colonies

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/economy/treasury.ts` 195 (`checkMove` only checks integer ≥ 0), `shared/sim/src/economy/store.ts` 27–37 (`writeColonyStock` → `ensureColonyRecord`), `shared/sim/src/kernel/colonies.ts` 10–22; `shared/sim/README.md` ("bad colony indices … are rejected")
- **What happens:** `treasury.add({ colony: 5 })` on a one-colony planet creates colonies 1–5 as `founding` records; a huge index loops pushing records. Only `dev.grant` guards against it. Gameplay callers pass existing colonies today; `system.spawnColony` also derives an unbounded index from `col_<n>` or `colonyIndex` args (`shared/sim/src/systems/landing/index.ts` 261–274).
- **To resolve:** reject `invalid_amount` (bad colony) in `checkMove` when `state.colonies[i]` does not exist, except for the landing credit; bound colony indices in the landing planner (see GP-17).
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `treasury.add` / `withdraw` refuse a colony index without a record (`invalid_amount`, `detail: 'unknown colony'`); records come from landing, `spawnHqUnit` and admin seeding (`setColonyStock`); `system.spawnColony` indices are bounded by `planet_full` (GP-17). Tests `treasury.spec.ts` › GP-24, `landing-rules.spec.ts` › GP-17.

### GP-25 · Balance numbers in code and sentinel unit guessing

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/build.ts` 46–51 (cost 200/100/50/50), 55–63 (`resolveHubBuildTimeS` compares with 30 and 150), 70 (7500), 198 (`workRate || 1.5`), 227 (`hp ?? 1500`); `shared/sim/src/systems/construction/index.ts` 203, 238 (footprint `isHub ? 3 : 1`); `shared/sim/src/systems/landing/index.ts` 58 (cargo), 69–76 (`resolveDescentTicks`), 190 (pod HP 500); `shared/sim/src/systems/terraform-basic/queue.ts` 65–66; `shared/sim/src/systems/hq/index.ts` 294–296; `shared/sim/src/units/mobility.ts` 43–48; `shared/sim/src/systems/territory-claim/index.ts` 135–140; `shared/sim/src/economy/caps.ts` 13; data rows `hub.ts`, `hq.ts`, `ops-basic.ts`
- **What happens:** every resolver falls back to literals that copy the data rows, and several rows carry the same number two or three times (`buildS` / `designBuildS` / `buildTimeS`, `podDescentS` / `designPodDescentS`, `timeS` / `baseTimeS` / `designSeconds`, `energy` / `energyCostE`, three recharge-rate fields). Which copy wins is decided by sentinels: `resolveHubBuildTimeS` treats a value equal to the default (30 s / 150 ticks) as "not overridden"; `resolveDescentTicks` treats `podDescentS == designPodDescentS` as "still in seconds", so an override `podDescentS: 1.2` (6 ticks, equal to the design 6) lands after 30 ticks. `opsBasic.timeS` is converted to ticks but never read, so overriding it has no effect.
- **Why it is like this:** compiled (tick) and design (second) values coexist so UI bills can show seconds.
- **To resolve:** one field per number (compiled ticks, plus the design value only where the UI needs it), resolvers that throw on a missing row instead of a literal fallback, no sentinel comparisons.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** see XC-01 / XC-02: one field per value, `systems/rows.ts` (`w01Row`, `rowNum` throw on a missing row / field), compiled ticks converted back only for display; no sentinel comparisons (`resolveHubBuildTimeS` = `ticksToSeconds(buildS)`, `resolveDescentTicks` = `podDescentS` ticks); pod HP is `hq.startingKit.podHp`; `opsBasic.timeS` is read. `hq`, `hub`, `opsBasic` are in the "every field is read" check (`test/data/generation-data.spec.ts`).

## Landing and dev commands

### GP-26 · `dev.land` edge cases: all pods moved to one tile, silent ack, contract mismatch

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/dev/land.ts` 17–35, 47–68; `docs/dev/DEV_TOOLS.md` 69 (`land`); `tests/scenarios/w01-landfall.ts` 38; `shared/contracts/src/commands/dev-land.ts`
- **What happens:** with `colonyIndex: null` and `(q, r)`, every undeployed pod is validated against the others' old positions and then all are moved to the same tile. Without `(q, r)` on a colony whose pod already deployed, the command is acked with no effect, while DEV_TOOLS says `land` rejects `already_landed`. DEV_TOOLS also says `land` deposits the cargo; the cargo is credited when the pod is created (`spawnColonyLanding`). The `w01-auto-place` scenario sends `{ colonyId: 0 }`, which the strict `dev.land` contract would reject; the scenario API skips zod.
- **To resolve:** require one colony; return `already_landed` when nothing is left to land; fix the doc line; make the scenario API validate args with the contract.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** `dev.land` acts for the caller's colony only (`not_own_colony` without one), parses its contract (`{ q?, r? }`), returns `already_landed` when the pod is open (also without `(q, r)`); DEV_TOOLS `land` line corrected (cargo is credited when the pod is created); the scenario sends `dev.land {}` for colony 0 through the validating scenario API (GP-37). Tests `landing-rules.spec.ts`, `tests/scenarios/test/loader.spec.ts`.

### GP-27 · Dev commands fall back to another colony's HQ, and `dev.seed` leaves orders on new ground

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/dev/index.ts` 38–55 (`findHqRow`), 101–113 (`dev.teleport`), 135–144 (`dev.cell`), 159–187 (`dev.seed`), 66 (vision radius 9 literal)
- **What happens:** when the caller's colony has no HQ, `findHqRow` picks the first HQ of any colony, so `tp` / `cell` act on someone else's HQ; `dev.teleport { id }` moves any entity regardless of owner and onto any tile (water included). `dev.seed` replaces the ground but keeps entities, construction and terraform orders, so old jobs run on the new terrain (and credit yields, GP-01). Dev-only and outside production.
- **To resolve:** return `unknown_entity` instead of falling back; have `dev.seed` drop orders (or reject when any exist).
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** no HQ fallback: `tp` / `cell` without an own HQ are `unknown_entity`; `dev.teleport { id }` refuses another colony's entity (`not_own_colony`); vision radius from `hq.t1.viewRadius`; `dev.seed` cancels every construction order (refund rules) and drops every terraform order. Tests `dev.spec.ts` › GP-27, GP-27 / GP-33.

## Code quality and tests

### GP-28 · Duplicated helpers and dead exports

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** terraform-order readers (`shared/sim/src/systems/terraform-basic/queue.ts` 178, `shared/sim/src/systems/hq/index.ts` 122, `frontend/game/features/terraform-basic/TileOverlay.ts` 77); cell-energy math (`hq/index.ts` 148–166 duplicates 358–397); footprints (`construction/validate.ts` 42–46 duplicates `placement.ts` 154–160); "colony's HQ / Hub" scans (`validate.ts` 49–73, `queue.ts` 75–89 and 228–238, `dev/index.ts` 38–55); `syncHqView` / `getHqView` build the same view twice (`hq/index.ts` 191–209, 231–249); `territory-claim` `normalizeClaimOpts` and `validateHubPlacement` keep a second positional signature; colony colour palette (`shared/sim/src/kernel/colonies.ts` 4 `DEFAULT_COLONY_COLORS` is copied in `frontend/render/planets/hex/territoryBorder.ts` 18–25 under the same name); resource aliases (`shared/sim/src/systems/dev/index.ts` 24–29 and `frontend/game/features/dev-console/commands.ts`)
- **What happens:** the same rule lives in two or three places (AGENTS.md "no copy/paste"). Dead or test-only: `findAliveColonyHqRow` (no caller), `validateHubPlacement`, `hasColonyHub`, `computeSitePrepBill`, `getHubFootprintTiles` (tests only; it is `getBuildingFootprintTiles(q, r, 3)`), `checkResources` path of `validateBuildingPlacement` (no production caller), `IssueOpts.queue` (tests only), `territory-claim` module with no systems or handlers. The sim's `RESOURCE_ALIASES` in `dev.grant` never matches: the `dev.grant` contract types `resource` as `ResourceKey`, so `metals` is rejected `invalid_args` at ingress; the dev console maps aliases itself before sending. The two colour palettes can drift: a colony created by `ensureColonyRecord` gets the sim's colour, while the border renderer picks from its own copy by index.
- **To resolve:** extract one reader / view builder / "find colony unit" helper; delete or move test-only helpers into `test/`; delete the sim's alias map; move the colony palette to `shared/contracts` (or `shared/config`) so sim and render import the same list (render may not import `shared/sim` internals).
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** one terraform-order reader (`terraformOrdersOf`), one HQ view builder, one cell-demand formula (`stepDemand`), one "find the colony's HQ / Hub" scan (`systems/find.ts`), `getHubFootprintTiles` = `getBuildingFootprintTiles` with the Hub row footprint, `hasColonyHub` one line (both kept: client and gen specs use them); removed `findAliveColonyHqRow`, `validateHubPlacement`, `computeSitePrepBill`, the `checkResources` path, `RESOURCE_ALIASES`, the positional `claimTerritoryRadius` signature. The colony palette lives in `@terra/contracts/tiles/codes`; `kernel/colonies.ts` re-exports it (render already imports it). Left: `IssueOpts.queue` (a runner feature, shift-queue, no player input yet); the client's own order readers (FRONTEND-FEATURES should use `terraformOrdersOf` / `constructionOrdersOf`).

### GP-29 · Untested paths

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (v8 coverage over `systems/`, `units/`, `economy/`: 91.8 % statements, 79.7 % branches)
- **Area / code:** `construction/build.ts` 207–211 (build paused by a shortage mid-way), `construction/validate.ts` 95–97, `construction/index.ts` 417, 443; `terraform-basic/index.ts` 123, 136 (cancel with a bad id / no id); `units/movement/orchestrator.ts` 159–162 (entity removed with a live route); `landing/index.ts` 266–273 (`col_<n>` colony ids); `dev/land.ts` null-colony branch; `shared/sim/test/systems/prepared-ground.property.spec.ts` 346–355 (leftover `console.log` with timing)
- **What happens:** the mid-build shortage path (HQ goes idle, order keeps `in_progress`) and every case in GP-01, GP-05, GP-07, GP-10, GP-15 have no spec.
- **To resolve:** add specs for those cases; drop the timing log.
- **Found:** 2026-11-01, review (sim-gameplay subagent)
- **Fix:** specs for GP-01, GP-05, GP-07, GP-10, GP-12 (mid-build shortage), GP-15, cancel with a bad id, `col_<n>` landing ids, a unit removed with a live route (`units/removed-unit.spec.ts`), `dev.land` without a colony; the timing `console.log` is gone from `prepared-ground.property.spec.ts`.

### GP-31 · Sim rejects carry only a code, never a detail

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/kernel/commands.ts` 15, 26–31 (`CommandHandler` returns a string, `CommandOutcome` has no `detail`), `shared/sim/src/systems/construction/index.ts` 360 (drops `validation.block`), `frontend/game/features/hub-placement/HubPlacementMenu.ts` 298, 326–327
- **What happens:** a handler can only return a reject code. The placement handler knows the exact cause (`trees`, `uneven`, `hubExists`, `waiting(resources: metals.t1 120/200)`), but the host sends only `terrain_unbuildable` / `site_blocked` / `insufficient_resources`; hosts add a `detail` only when they rewrite an unregistered code to `internal`. The Hub menu shows `detail ?? code`, so a server rejection reads "site blocked" instead of the `placementBlockText` the ghost shows. Same for terraform skips (`firstReject`) and treasury codes.
- **To resolve:** let handlers return `{ code, detail? }` (and keep `string` for compatibility), carry `detail` in `CommandOutcome`, and pass `placementBlockText(block)` from `placeBuilding`.
- **Found:** 2026-11-01, review (sim-gameplay subagent), from another reviewer's report
- **Fix (sim side):** a handler may return `{ code, detail }` (`CommandReject` in `kernel/commands.ts`), `CommandOutcome` carries `detail`, and `placeBuilding` passes `placementBlockText(block)`. Hosts must copy `outcome.detail` into `cmd.reject.detail` (BACKEND: `planet-host`; FRONTEND-APP: `LocalHostCore`). Test `construction-orders.spec.ts` › GP-31.
- **Fix (server host, final pass 2026-11-01):** `PlanetHost` copies `outcome.detail` into its `reject` message (`thread/protocol.ts`), `GamePlanets` carries it in the command outcome, and `SimCommandIngress` sends it as `cmd.reject.detail` (cut to `REJECT_DETAIL_MAX` = 200, the contract's limit, `shared/contracts/src/ws/server.ts`); the client already shows `detail`. Tests `backend/app/test/game/planet-down.spec.ts` › "passes a handler's reject detail on a normal step (GP-31)", `test/ws/ingress-colony.spec.ts` › "passes the sim's reject detail to the client…". The browser host (`LocalHostCore`) is FRONTEND-APP's.

### GP-32 · Terraform rules have no read-only form; the client re-implements them

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts` 75–176 (`hasColonyClaimedTerritory`, `canRunTerraformOpOnTile`, `resolveTerraformOpForTile` take `SimState`); copies in `frontend/game/features/terraform-basic/BrushController.ts` 91–105 (`hasClaimedInTiles`, `isOpValidForTerrainPrep`), 117–160 (`planBrushStroke`)
- **What happens:** placement has one pure rule over a read-only world (`evaluatePlacement` + `PlacementWorld`, D-37); terraform does not. The brush preview re-implements the owner rule, the auto-op choice and the terrain / prep check over the replica view. They already differ: the sim also counts an active own Hub as "claimed" (`hasColonyClaimedTerritory`), and with no tile layers the client falls back to queueing every tile with the selected op. A change in one copy makes the preview and the authority disagree. `BrushController.cancelOrder` 345–347 also calls the sim's `cancelTerraformOrder` on the client's state (cross-area: the client must not mutate world state).
- **To resolve:** one `evaluateTerraform(world, opts)` over a read-only `TerraformWorld` (terrain, prep, owner, plus "colony has territory"), used by the `enqueueTask` handler and the brush; a parity spec like placement's.
- **Found:** 2026-11-01, review (sim-gameplay subagent), from another reviewer's report
- **Fix (sim side):** `evaluateTerraform` / `evaluateTerraformTile` / `resolveTerraformTileOp` over a read-only `TerraformWorld` (`terraformWorldFrom(placementWorld, colony, data)`, `terraform-basic/rules.ts`), used by the `enqueueTask` handler and the job re-check; parity test `terraform-rules.spec.ts` › GP-32 (plan = queued jobs). The brush (`BrushController` / `planner.ts`) must call it with its ghost `PlacementWorld` and stop calling sim mutators (FRONTEND-FEATURES).

## Cross-area findings (added by the lead)

### GP-33 · `dev.seed` replaces the ground but keeps owner, explored, anchors and grace

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/dev/index.ts` (~L163-185, `copyLayers`)
- **What happens:** only terrain/prep/deposit/richness/height/sub-layers are copied from the regenerated planet; territory `owner`, `explored`, `anchors` and `graceUntil` stay from the old ground, so claims and fog no longer match the new map.
- **To resolve:** reset (or deliberately keep and document) those layers; add a test.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Fix:** `dev.seed` also takes `owner`, `explored`, `anchors`, `graceUntil` from the regenerated planet (reset), then active Hubs claim again and HQs / pods reveal their surroundings. Test `dev.spec.ts` › GP-27 / GP-33.

### GP-34 · Terraform op → terrain mapping is hard-coded although the data rows describe it

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/queue.ts:118-136`; `shared/sim/src/data/ops-basic.ts` (`fromTerrain`, `toTerrain`, `toPrep`)
- **What happens:** the rows carry the mapping but no code reads it (see also XC-01/XC-15 data fields without a reader); tuning them changes nothing.
- **To resolve:** read the mapping from the rows, or delete the fields.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Fix:** `getTerraformOpSpec` reads `fromTerrain` / `toTerrain` / `toPrep`; the op check, the auto-op choice, job completion and the prep planner use them. Test `terraform-rules.spec.ts` › "a tuned opsBasic row changes the tile rule".

### GP-35 · Small duplicated tile helpers; one tile write without a tick

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/hq/index.ts:74-91` (`revealVision` re-implements `markTileExplored` bit logic); `shared/sim/src/systems/territory-claim/index.ts:108` (`setTileOwner(...)` without `tick`)
- **What happens:** two copies of the explored-bit rule can drift; a tile write without a tick is not stamped for `diffSince` unless something else stamps the tile in the same step.
- **To resolve:** call `markTileExplored`; pass `opts.tick` (and a test that the claimed ring appears in a client diff).
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Fix:** `revealVision` calls `markTileExplored` (only for tiles not yet explored); `claimTerritoryRadius` always passes a tick (defaults to `meta.tick`). Covered by `territory-claim.spec.ts` (331 claimed tiles in the client diff).

### GP-36 · Every colony's orders, units and HQ state are sent to every client

- **Status:** Accepted (by design)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** blobs `units`, `unitMotion`, `pathQueue`, `terraformTasks`, `constructionQueue`, `hq` (`shared/sim/src/host/diff.ts` sends blobs whole)
- **What happens:** a client sees other colonies' build plans, queues and unit paths (no fog of war for blob state); only hidden tile layers are stripped (`forClient`).
- **To resolve:** decide whether W01 needs per-colony filtering (a `forClient(colony)` blob filter) or accepts it until fog of war is built. Recommendation: accept for W01, record the rule in SIMULATION.md, filter when fog of war lands.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Done (review-fix round 2026-11-01):** recommendation applied: accepted for W01 and recorded as `SIM-V-06` in `docs/spec/SIMULATION.md` §6 (order / unit / HQ blobs are not per colony until fog of war adds a `forClient(colony)` blob filter). Stays open for the fog-of-war wave.

### GP-37 · The scenario API bypasses command validation

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `tests/scenarios/_loader.ts` (`apiFor` submits straight to the host); `tests/scenarios/w01-landfall.ts:38` sends `dev.land { colonyId: 0 }`
- **What happens:** scenario commands skip the zod contract check that every real client command passes, so a scenario can rely on args the server would reject (the strict `dev.land` contract has no `colonyId`).
- **To resolve:** validate scenario commands with the same contract parser (`shared/contracts` command schemas) and fix the args.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Fix:** the scenario API parses args with the command contract before submitting (`parseCommandArgs`) and takes an optional colony (`api.command(kind, args, colonyIndex?)`); `w01-auto-place` sends `dev.land {}` for colony 0. Test `tests/scenarios/test/loader.spec.ts` › GP-37.

## Found in the review-fix round

### GP-38 · Ground occupancy uses the default Hub footprint, placement the tuned one

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (by reading; no tune of `hub.t1.footprint` exists today)
- **Area / code:** `shared/sim/src/systems/construction/occupancy.ts` (`buildingFootprints` → `entityFootprint(kind)` without data), `shared/sim/src/grid/pathProfiles.ts` (`GroundOccupancy = (state) => …` gets no compiled data)
- **What happens:** placement reads `hub.t1.footprint` from the step's (possibly tuned) data; the ground-movement footprint reads it from the W01 defaults, because the occupancy callback only receives the state. With `tune hub.t1.footprint 5`, units would walk through the outer ring of a 5×5 Hub that placement treats as occupied.
- **Why it is like this:** the occupancy registry in `grid/pathProfiles.ts` (SIM-ENGINE area) has no data parameter.
- **Workaround / mitigation:** the footprint is not tuned in W01; every planet uses 3.
- **To resolve:** pass the compiled data to `GroundOccupancy` (or store the footprint on the entity) so both read the same number.
- **Found:** 2026-11-01, review-fix round (SIM-GAMEPLAY)
- **Fix:** `GroundOccupancy` takes the step's compiled data (`(state, data?)`), `pathBlockedFor` / `pathBlockersFor` pass it from every caller (`ctx.data`: path queue, movement orchestrator, approach, `moveUnit`), and `buildingFootprints` sizes footprints with `entityFootprint(kind, data)` (the size is part of its cache key). Files `shared/sim/src/grid/pathProfiles.ts`, `grid/pathQueue.ts`, `systems/construction/occupancy.ts`, `units/approach.ts`, `units/movement/orchestrator.ts`, `systems/units/handlers.ts`. Test `construction-orders.spec.ts` › "GP-38: ground movement blocks the tuned Hub footprint…".

### GP-39 · `landPod` lets a player open the pod at the client animation's end

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/landing/index.ts` (`landPod`), `shared/contracts/src/commands/land-pod.ts`, `hq.startingKit.podLandMinS` (5 s) vs `podDescentS` (6 s)
- **What happens:** the production-allowed player command `landPod` (FA-08) opens the caller's pod once it has descended `podLandMinS`, so a colony that sends it lands 1 s before one that waits for `podDescentS`. Asked earlier, the pod opens at the minimum; there is no way to skip more.
- **Why it is like this:** the client's touchdown animation lasts 5 s and production refuses `dev.land`; the minimum keeps the server authoritative over the descent.
- **To resolve:** if the owner wants one descent time, set `podDescentS` = `podLandMinS` (or drop `landPod`).
- **Found:** 2026-11-01, review-fix round (SIM-GAMEPLAY, for FA-08)

### GP-40 · `setPlanetTime` is open to any seated colony on a shared planet

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/time/index.ts` (`setPlanetTime`), `shared/contracts/src/commands/set-planet-time.ts`, `frontend/game/app/online/dayNightSync.ts`
- **What happens:** any seated player on a planet can adjust `timeOfDay`, `realHoursPerDay` or `timeScale` in the `F8` `DAY/NIGHT` tab, which dispatches `setPlanetTime` and updates the authoritative planet solar clock (`state.blobs.planetTime`) for all players on that planet.
- **Why it is like this:** the task specifies that the `F8` shader dialog's day/night parameters (`timeOfDay`, `realHoursPerDay`, `timeScale`) stay synchronized between client and server across both singleplayer and multiplayer.
- **Workaround / mitigation:** unseated clients use `dev.time` (gated by `dev: true`, refused in production); command rate is throttled (`<= 8 Hz`) on the client.
- **To resolve:** when competitive multiplayer waves land, gate `setPlanetTime` behind planet owner/admin privileges or move it to `dev: true`.
- **Found:** 2026-11-02, day/night review round (SIM-GAMEPLAY)


### GP-41 · Terraform resource find: odds, family and richness

- **Status:** Accepted (owner, 2026-11-02)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/data/terraform-finds.ts` (row `terraformFinds.deposit`; file constant `TERRAFORM_RESOURCE_SPAWN`), `shared/sim/src/systems/terraform-basic/resourceSpawn.ts`, `shared/sim/src/systems/dev/spawnDeposit.ts`
- **What happens:** every finished terraform hex with no deposit after the buried-deposit reveal (and no unit on it) rolls 1%; a hit puts a full deposit (`richnessBp` 10000) on the hex, tier t1 50% / t2 35% / t3 15%, family uniform over metals / minerals / oil. Fixed yields and the buried reveal are kept. A found deposit makes the hex unbuildable and impassable again (deposit rule) and, depleted, stays as rubble like any deposit (owner). A Worker Drone T1 or Extractor on it pays the tier. Data without the W02 row gives chance 0 (W01 planets never roll).
- **Why it is like this:** the owner asked for 60 / 35 / 15 (110%) and chose 50 / 35 / 15; uniform family and rubble on depletion confirmed by the owner.
- **Workaround / mitigation:** `tune terraformFinds.deposit.chance 1` and the dev command `spawndeposit <q> <r> <family> <tier>` make finds checkable.
- **Found:** 2026-11-02, terraform rework

### GP-42 · The resource-find roll is predictable by a modified client

- **Status:** Accepted (by design, for now)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/resourceSpawn.ts`, `shared/sim/src/kernel/rng.ts`
- **What happens:** the roll draws `ctx.rng('misc')`; every client receives every stream state, so a modified client can know whether the next finished hex will spawn a deposit. Client prediction runs the same draw, but its hidden `subDeposit` layer is zero-filled, so a predicted completion could briefly show a different reveal / find; completions are far beyond the 25-tick prediction lead, so this is practically never seen.
- **Why it is like this:** no server-only stream exists yet (rng.ts header: the first system whose draws must stay hidden gets one).
- **To resolve:** give the roll a server-only stream seeded with `meta.worldSalt` and stripped from client payloads.
- **Found:** 2026-11-02, terraform rework

### GP-43 · Terraform chain: rough edges

- **Status:** Resolved in part (terraform rework review 2026-11-02); the items under "Still open" stay
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/{chain,workTile,workOrder,workSystem,dismantleAndWork}.ts`, `shared/sim/src/systems/units/registry.ts`
- **Fixed:** the clicked tile follows the chain's territory rule (`classifyGroundWorkTile` with `terraformOwnershipBlock`, footprints, anchors, deposits); unreachable follow-ups are skipped silently (owner), only the clicked hex reports `no_path`; a REPAIR for a chaining worker queues behind its current hex and the chain resumes; providers and dispatch skip workers with a work job (`unlessOnWorkJob`); the direct task form and `enqueueTerraformOrder(op: 'work')` go through `enqueueWorkOrder`; no find under a unit; an uneven tile that stays uneven after levelling is not re-picked forever (it was an infinite loop); completion re-checks the tile (GP-01: foreign, building, anchor, already done → dropped with no yield); command / chain ids never overwrite another job; `cancelTask <cmdId>` cancels a multi-tile order and its chain.
- **Still open:**
  - ~~Skipped tiles stay skipped for the whole chain~~ Resolved (2026-11-03): an unreachable follow-up is retried after the chain's next finished tile; the chain now works outward from the clicked tile (`chainOrigin`, closest first) instead of from the last tile, so it no longer drifts far from the order.
  - The chain ignores tiles already queued in W01 manual orders (the completion re-check prevents a double yield, but a walk is wasted).
  - `cancelTask <root>~n` cancels only that job; the chain ends because nothing is left.
  - A Worker Drone T1 in a chain does not harvest.
- **Found:** 2026-11-02, terraform rework

### GP-44 · `work` completion events do not match their schemas

- **Status:** Resolved (terraform rework review 2026-11-02)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/workSystem.ts`
- **What happened:** `obstacleRemoved` was emitted with `op: 'work'`, `tilePrepared` with an `op` key its schema lacks, no `groundRevealed`, no `playerId`; the backend progression counter counted rocks as "clear".
- **Fix:** forest → `obstacleRemoved` `clear`, rock → `break`, others → `tilePrepared`, plus `groundRevealed`; all carry `colonyWho` (with `playerId`). Test `terraform-work-guards.spec.ts` validates every work-path event against its contract schema.
- **Found:** 2026-11-02, terraform rework

### GP-45 · Player work jobs (TERRAFORM / REPAIR) draw no energy

- **Status:** Resolved (owner: colony grid, 2026-11-02)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/{workJobs,workSystem}.ts`, `shared/sim/src/systems/power-core/{workLoad,shedding,index}.ts`
- **What happened:** work jobs carried an energy cost from `TERRAFORM_TIME_TABLE` but nothing drew it, so continuous terraforming was free and a brownout did not throttle it (`UO-TF-02`, shed group 1). The W01 order path draws from the HQ power cell; a Worker Drone T1 has no cell.
- **Fix:** the owner picked the colony grid, for the HQ Drone and the Worker Drone T1 alike. Each worker's current job draws `energyCost / work time` (`workJobDrawPerS`: `durationTicks × TICK_MS`, e.g. forest 8 E / 12 s ≈ 0.67 E/s; repair 0) while the worker is at the job (walking draws nothing). The power core (`collectWorkLoad`) adds it to `rawDemand` as shed candidates in the group whose `categories` list `terraformOp` (`shedGroup1`), so jobs go before factories and extractors (newest worker first). A shed job is listed in `ColonyPowerSummary.shedWorkJobIds`, its worker's entity state is not touched; the next step the work-jobs system holds it at `waiting` / `power` with its progress kept, and it resumes (and its chain goes on) once the grid carries it again. The summary gains `workDemand` (drawn after shedding; `buildingDemand` excludes it); the `power` dev command prints `work:` and the paused jobs; the power widget's demand includes it; the TERRAFORM status line shows `waiting (power)`. Test `terraform-work-power.spec.ts`.
- **Still open:** before the Command Hub there is no grid (supply 0), so pre-Hub work jobs stay unmetered (free) as before; an HQ-cell fallback was not built. Balance: a Hub-only colony has +3 E/s spare, so one terraform job fits, but with a few Worker Drones (T1) or an Extractor the job pauses until a Solar is up (and at night). `TERRAFORM_TIME_TABLE` documents its ticks as 20 Hz while the sim runs at 5 Hz (`TICK_MS` 200), so the real work time (and the draw) uses `durationTicks × 0.2 s`.
- **Found:** 2026-11-02, terraform rework review

### GP-46 · The direct-task `enqueueTask` form uses `cmd.colonyIndex ?? 0`

- **Status:** Resolved (W02 audit 2026-11-02)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/queue/index.ts` (`enqueueTaskHandler`, `cancelTaskHandler`, `reorderTaskHandler`), `shared/sim/src/systems/terraform-basic/index.ts` (`cancelTask`)
- **What happens:** the `task` form of `enqueueTask` (and `cancelTask { taskId: 'all' }` / `reorderTask`) fell back to colony 0 when a command had no colony instead of rejecting `not_own_colony` like `commandColony` does.
- **Fix:** `enqueueTaskHandler`, `cancelTaskHandler`, `reorderTaskHandler`, and the W02 branch of `cancelTask` all check `commandColony(cmd)` first. Test `terraform-work-guards.spec.ts` › GP-46.
- **Also (W02 review round 1, 2f1f2c1):** `setHarvestWeights` (`shared/sim/src/systems/harvest/index.ts`, `setHarvestWeightsHandler`) read the same fallback; it now takes `commandColony(cmd)` too. Test `shared/sim/test/systems/w02-review-fixes.spec.ts` › "setHarvestWeights needs the command colony (GP-46 class)".
- **Found:** 2026-11-02, terraform rework review

### GP-47 · `anchors` meant both "territory claim count" and "a building stands here"

- **Status:** Resolved (anchors-occupancy fix, 2026-11-02); the items under "Still open" stay
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/layers.ts` (`anchors`), `shared/sim/src/systems/economy/construction.ts`, `shared/sim/src/systems/terraform-basic/workTile.ts`, `shared/sim/src/systems/harvest/{adjacency,index}.ts`, `shared/sim/src/systems/units/handlers.ts` (`moveUnit`), `frontend/game/features/construction-menu/PlacementGhost.ts`
- **What happened:** `claimTerritoryRadius` adds 1 to `anchors` on every tile a Hub claims (W01-17, `SIMULATION.md` territory), while W02 construction set `anchors = 1` under a footprint, read `anchors !== 0` as "tile occupied" and set it to 0 on demolish; TERRAFORM `work`, harvest stand/target tiles and `moveUnit` onto a deposit read it the same way, and so did the client placement ghost. Once a real Command Hub completed, every tile of its territory looked occupied: W02 builds waited on `site (tile occupied)`, TERRAFORM was refused, Worker Drones (T1) found no deposit or stand tile, and a demolish zeroed the territory count of its tiles. The `w02` scenario seeds territory without anchors, so it never showed.
- **Fix:** `anchors` is territory only. Building occupancy is `occupiedGroundTiles(state, data)` (`systems/construction/occupancy.ts`, the union of the cached `buildingFootprints`, i.e. `occupiesGround` + `entityFootprint`, the rule placement and path profiles already use). Construction checks it (validation runs before the new entity is inserted) and no longer writes `anchors`; `classifyGroundWorkTile`, the harvest scan (built once per system run and passed down) and `moveUnit` use it; `buildingFootprintTiles` (workTile) is replaced by it; the client ghost marks only entity footprints and queued builds. Path profiles / `bumpPathEpoch` never read `anchors`. Test `territory-anchors-occupancy.spec.ts` (real W01 Hub claim, then build, TERRAFORM, harvest and demolish inside territory).
- **Still open:**
  - No save migration. Nothing in the sim reads `anchors` for a decision today (no grace/loss system yet; `dev.seed` resets it), so pre-fix saves that carry `anchors = 1` under a building outside territory, or `0` under a demolished building inside it, are harmless until a territory-loss system reads the count. That system should recompute `anchors` from the alive anchor buildings on load instead of trusting the stored value.
  - ~~Two territory claims~~ Resolved (same review): the W02 `claimHubTerritory` now calls `claimTerritoryRadius` (owner + anchor count, frozen foreign borders).
  - Footprint sizes come from two places: occupancy uses `entityFootprint` (Extractor / Solar hard-coded 2, Hub from `hub.t1.footprint`, square, no rotation) while W02 construction lays out tiles from the row's `footprintW` / `footprintD` and `rot`. They agree for today's square footprints and drift if a row changes.
- **Found:** 2026-11-02, code reading during the W02 wave

### GP-48 · W02 construction built through trees, rock, slopes and holes

- **Status:** Resolved (2f1f2c1); the item under "Still open" stays
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/economy/{construction,siteTerrain}.ts`, `shared/sim/src/systems/queue/index.ts` (`enqueueQueueTask`), `frontend/game/features/construction-menu/PlacementGhost.ts`
- **What happened:** the W02 build path (Extractor, Solar via `enqueueTask { kind: 'build' }`) only refused deep water and ridges. `startBuildingConstruction` then forced every footprint tile to `TERRAIN.flat`, and the ghost billed "clear + prepare" and showed green, so buildings stood on forest. This contradicted D-37 (the Hub path through `evaluatePlacement` was already correct).
- **Fix:** one terrain rule (`geoBuildBlock` via `footprintTerrainBlock`) at all three layers: the client ghost goes red with the reason; `enqueueTask` rejects `terrain_unbuildable` up front; `startBuildingConstruction` rechecks (queue entries waiting from before, dev paths) and no longer rewrites terrain. Tests in `construction.spec.ts` and `placement-ghost.spec.ts`.
- **Still open:** flat but unprepared ground is still graded automatically by the build (D-37 "after at most a Grade"). If "prepared first" must be mandatory for W02 buildings too, that is an owner decision. ~~The W02 path also does not yet run the `uneven` footprint-spread check of `evaluatePlacement`; it flattens heights above 0.15 m instead.~~ Resolved (2f1f2c1): W02 rows go through `evaluatePlacement` (`economy/siteTerrain.ts` `buildingSiteBlock`, D-37), so a queued W02 build is rejected on an uneven tile or a footprint whose height spread exceeds `MAX_FOOTPRINT_SPREAD_M` (0.6 m, `grid/geo.ts`) instead of being flattened. Only an `instant` build (scenario setup) still levels heights above 0.15 m (`startBuildingConstruction`). The owner may prefer flattening: see GP-55.
- **Found:** 2026-11-03, owner screenshot of a ghost on trees

### GP-49 · Dismantling the landed pod (wreck): gated on a finished Hub, no refund

- **Status:** Open (owner decisions)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/dismantleAndWork.ts` (`colonyHasActiveHub`, pod branch), `frontend/game/features/terraform-basic/{planner,primaryOps}.ts`
- **What happened / decision:** `DISMANTLE` now removes the colony's landed pod (never one still descending). The pod is the colony's reference before its Hub stands (`terraformWorldFrom` pre-Hub radius, `landingBlock` Hub distance read the pod entity), so the dismantle is refused (`site_blocked`; client: `pod_needed`, "Build the Command Hub first") until the colony has an active Hub or Command Hub. On a hex shared with the HQ Drone the pod ranks before the HQ. Nothing is refunded: the pod has no build cost (a scrap yield would be a balance row).
- **Still open:** (1) should the player get a salvage refund? (2) if the pod must be removable before the Hub, those two rules must read `blobs.landingPods` / `landingHistory` instead of the entity. (3) The removal is instant (like other `dismantle` ops), with no work job or wreck-fade animation; `PodTouchdownFx.podDismantleProgress` is only the egress retraction.
- **Found:** 2026-11-03, owner request

### GP-50 · A restored planet with a Worker Drone T1 crashed on its first step (`reading 'entityId'` of null)

- **Status:** Resolved (2f1f2c1)
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/harvest/unit.ts` (`syncWorkerView`, `withoutUnitView`), `shared/sim/src/systems/terraform-basic/dismantleAndWork.ts` (unit dismantle)
- **What happened:** `syncWorkerView` added an index alias to the `col.workers` array (`list[entityId] = view`). A Worker Drone T1 with entity id 3 turned a one-element list into a sparse `[view, , , view]`. Live, `filter` skips holes, so nothing showed. The snapshot codec saves holes as `null`, so the first step after a restore (server restart, `?host=local` reload) threw in `filter((u) => u.entityId …)`. Dev server log: `planet pl_01M6EG80PWJJA4Y2N5RHFET9ER went down (step_failed): step to tick 91022 failed: Cannot read properties of null (reading 'entityId')`; its saved `col.workers` was `[3, null, null, 3]`. Dismantling a unit ran `delete col.workers[entityId]`, which made the same kind of hole and left the unit's view in both lists.
- **Fix:** both lists stay dense, one view per unit, matched by `entityId` (`withoutUnitView`; it also drops non-object entries, so already saved snapshots heal on their first step). Unit dismantle filters both lists the same way. Readers (`frontend/game/features/landfall/selectionHelpers.ts`) already search arrays by `entityId`. Test `shared/sim/test/systems/worker-snapshot.spec.ts` (snapshot round trip, plus a saved planet with null holes). The saved dev snapshot of `pl_01M6EG80…` now steps.
- **Found:** 2026-11-03, dev server log, economy review

### GP-51 · HQ fast recharge: suspended in a group-3 brownout now, but never counted as grid load

- **Status:** Resolved (7e901d5): the HQ cell is now the grid's first store; the fast recharge is paid from grid surplus only (a surplus sink, never a load), so `hqFastRechargeShed`, `cellFastRechargeShedGroup` and the `hqFastRecharge` shed category are unused (see GP-67)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/hq/cell.ts` (`rechargePerTick`, `fastRechargeShed`), `shared/sim/src/systems/power-core/shedding.ts` (`hqFastRechargeShed`), `hq.t1.cellFastRechargeShedGroup`; `UO-HQ-06`, W01-11, W02-06
- **What happened:** the power core computed `ColonyPowerSummary.hqFastRechargeShed` but nothing read it, so the HQ cell kept recharging at 20 E/s next to an active Hub during a brownout that shed group 3. Now `rechargePerTick` falls back to the 3 E/s self rate while the colony's stored power summary has `hqFastRechargeShed`. `hq` sorts before `power.core` in slot 7, so the HQ reads the previous step's verdict (a one-step lag, the same on every host). Without the W02 power system there is no summary and the old rule applies. Test `shared/sim/test/systems/power-extractor-brownout.spec.ts`.
- **Still open (owner):** the spec says the fast recharge "counts as grid load in shed group 3", but it is never added to `rawDemand`. Counting 20 E/s against a Hub-only grid (+8 / −5) would shed it at once in every early colony. Effect today: a Hub-only colony with one Extractor is always in a group-3 brownout, so the HQ recharges at 3 E/s until a Solar carries the Extractor. Any deficit still left when shedding reaches group 3 suspends it, also one made only of unshed load: a Hub-only colony with three Worker Drones (T1) (5 + 4.5 > 8 E/s) sheds nothing visible, but its HQ recharges at 3 E/s. Recommendation: count the fast recharge only while the cell is below its maximum, as `fast − self` E/s, and shed it in group 3 like an Extractor, or keep it free and drop the sentence from the spec.
- **Found:** 2026-11-03, economy review (owner report "built an extractor, energy still 200/200")

### GP-52 · Worker Drones (T1) draw grid power but a brownout never stops them

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/power-core/index.ts` (`evaluateColonyPower`, worker branch), `shared/sim/src/systems/harvest/index.ts` (`production.harvest`), `economyT1Basic.shedGroup1..4` categories
- **What happens:** each Worker Drone T1 adds 1.5 E/s (0.75 E/s idle) to `unitDemand`, but it is never a shed candidate and `production.harvest` has no power gate, so in a deficit the extractors are shed while Worker Drones (T1) keep mining. No shed group lists units, so this matches the data.
- **To resolve:** decide whether units take part in shedding (a unit category in a group, then gate `production.harvest` on `offlineBrownout`) or keep units always on and leave the drain as information only.
- **Found:** 2026-11-03, economy review

## Found in the W02 review (rounds 1–2)

### GP-53 · Day length: the W02 docs say 20 min, the solar clock runs 15 min; the `dayCycle` row is not read

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/data/time.ts` (row `time.cycle`), `shared/sim/src/data/economy-t1-basic.ts` (row `dayCycle`), `shared/sim/src/systems/environment/index.ts` (`SUNSET_HOUR`, `getSunriseHour`, `computeEnvironmentAtHour`, `dayLengthTicksFor`), `shared/sim/src/systems/time/index.ts` (`computePlanetTimeAtTick`, `DEFAULT_DAWN_HOUR` / `DEFAULT_DUSK_HOUR`), `frontend/game/app/online/dayNightSync.ts`; `docs/plan/waves/W02-first-light.md` (feature row 3, W02-04), `docs/spec/SIMULATION.md` §7.6
- **What happens:** since review round 1 the W02 environment (`environment.dayCycle`, slot 1) has no day counter of its own: it reads the hour of the authoritative planet solar clock (`blobs.planetTime`). One 24 h day therefore lasts `time.cycle.realHoursPerDay` 0.25 h = **15 real minutes** (4 500 ticks at `timeScale` 1), while the W02 wave doc (row 3, W02-04) asks for a **20 min** day. `economyT1Basic.dayCycle.dayLengthS` 1200 (20 min, also `designDayLengthS`) and `dayCycle.sunriseHour` 6 are read by no sim code (`dayLengthS` only by `shared/sim/test/data/w02-data.spec.ts`). The clock and the environment also use two day windows:
  - environment (power, Solar output, phase `day` / `night`): night starts at `SUNSET_HOUR` 18:00 on every planet type and lasts `nightShare` of 24 h (`nightShareByPlanetType`: temperate 45 % → sunrise 04:48; desert / ocean 40 % → 03:36). Daylight is 1 from sunrise and falls by smoothstep over the last 15 % of the day to 0 at sunset.
  - planet time view (`computePlanetTimeAtTick`: `phase`, `daylight`, `isNight`, which `dayNightSync.ts` feeds the viewport sun and lights): `time.cycle.dawnHour` 5.5 / `duskHour` 18.5, the same on every planet type.
  So on a temperate planet the sim says "day" from 04:48 while the 3D scene is dark until 05:30, and the sim's night starts 30 game min before the scene's dusk. New planets start at `time.cycle.startHour` 09:00. From `skipnight` (06:00) night falls 12 game hours later, 7.5 real minutes at the 15 min day.
- **Why it is like this:** round 1 made the planet solar clock the one clock (CLAUDE.md "Authoritative planetary solar clock") so the HUD clock, the environment and the viewport cannot drift; the 15 min default of `time.cycle` (W00) won over the 20 min of the W02 row. `SIMULATION.md` §7.6 already lists both numbers (15 min W01 `time.cycle`, 20 min for the W10 weather split).
- **Workaround / mitigation:** `PLANET_DAY_HOURS`, `setPlanetTime`, `dev.time` and `tune time.cycle.realHoursPerDay 0.3333` give a 20 min day today.
- **To resolve (owner):** pick the day length (15 or 20 min) and one day window (sunset 18:00 + night share per type, or dawn 5.5 / dusk 18.5), set `time.cycle` to it, make the planet time view and the environment use the same window, and delete the losing fields (`dayCycle.dayLengthS` / `designDayLengthS` / `sunriseHour`, or the `dawnHour` / `duskHour` pair). Then align the wave doc and §7.6. Recommendation: keep `time.cycle` as the single source and derive dawn/dusk from the night share. See WE-30 for the unread rows.
- **Found:** 2026-11-03, W02 review round 1 (sim agent)

### GP-54 · W02 buildings may stand on unclaimed ground

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/placement.ts` (`economyPlacementRule`: `allowUnclaimed: true`; `evaluateTile`), `shared/sim/src/systems/economy/construction.ts` (`enqueueLinkedPrep`)
- **What happens:** every W02 building row (Metals Extractor, Solar) gets a placement rule with `allowUnclaimed: true`, so an Extractor or Solar may be placed on any unclaimed tile of the planet; only another colony's territory is refused (`foreign`). Its linked prep inherits the flag, so the HQ grades unclaimed tiles for it. The Command Hub keeps its own rule (`hub.t1.allowUnclaimedPlacement`, distance to the pod).
- **Why it is like this:** the W02 build path always allowed it; round 1 kept the behaviour when it moved W02 rows onto `evaluatePlacement` (D-37).
- **To resolve (owner):** must W02 buildings stand inside the colony's own territory (`allowUnclaimed: false`, then `unclaimed` → `not_own_territory`), or is building outside the border (deposits beyond the claim) intended? Recommendation: require own territory, as a building outside it claims nothing and cannot be defended by territory rules later.
- **Found:** 2026-11-03, W02 review round 1 (sim agent)

### GP-55 · W02 builds reject uneven ground instead of flattening it

- **Status:** Resolved (W05-09, 2026-11-04): when W05 linked prep is active (`opsBasic.level` compiled), unprepared footprint tiles may have mild height spread and are levelled to adjacent flat ground when their linked `grade` / `level` / `fill` / `reclaim` sub-job completes (`levelToAdjacentFlat`); waves `..01`–`..04` keep the `uneven` reject so earlier wave suites are unchanged
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/economy/siteTerrain.ts` (`buildingSiteBlock`), `shared/sim/src/systems/construction/placement.ts` (`evaluateTile` `uneven`, `footprintSpread`), `shared/sim/src/grid/geo.ts` (`MAX_FOOTPRINT_SPREAD_M` 0.6 m), `shared/sim/src/systems/economy/construction.ts` (`startBuildingConstruction`, `instant` branch)
- **What happens:** since round 1 an Extractor or Solar on an uneven tile, or on a footprint whose height spread exceeds 0.6 m, is rejected (`enqueueTask` up front, again when the queue starts it) like the Hub. Before, the W02 path levelled heights above 0.15 m. Only `instant` builds (scenario setup) still level the footprint. See GP-48.
- **Why it is like this:** D-37: one placement rule for every building; the client ghost shows the same verdict.
- **To resolve (owner):** Resolved in W05-09 by allowing linked prep (`Grade` / `Level`) to level mild uneven footprints when W05 is active (`opsBasic.level` in `data`), while preserving the `uneven` reject for `..01`–`..04`.
- **Found:** 2026-11-03, W02 review round 1 (sim agent)

### GP-56 · The contract's queue precedence words do not match the sim's; the mapping is a guess

- **Status:** Question for the owner (security part Resolved (58956ab))
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/contracts/src/commands/enqueue-task.ts` (`precedence: 'explicit' | 'autoSitePrep' | 'queued' | 'standing'`), `shared/sim/src/systems/queue/wait.ts` (`CONTRACT_PRECEDENCE`, `TRUSTED_SOURCES`, `enqueueAuthority`), `shared/sim/src/systems/queue/types.ts` (`PRECEDENCE_RANK` system 3 > player 2 > auto 1), `shared/sim/src/systems/queue/index.ts` (`enqueueTaskHandler`, `enqueueQueueTask`)
- **What happens:** the contract names four precedence words, the queue sorts by three others. Round 1 made unknown words fall back to `player` (they used to sort as `NaN`). Round 2 maps them: `explicit` / `queued` → `player`, `standing` → `auto`, `autoSitePrep` → `system` (the sim's own words are accepted too). Round 2 also closed a hole: any player could send `costOverride` (a free building) or `system` precedence (jump the queue). Now only sources `dev`, `system` and `admin` may set either; any other source is capped at `player` (it may lower its own entry to `auto`) and its `costOverride` is dropped. Test `shared/sim/test/systems/w02-review-fixes.spec.ts` › "enqueueTask authority (round 2)…".
- **Why it is like this:** the contract came from the units spec (§4.4), the queue from the W02 sim; nobody defined how one maps to the other.
- **To resolve (owner):** confirm the mapping (in particular whether `autoSitePrep` should outrank a player's explicit order), or replace the contract enum with the sim's three words.
- **Found:** 2026-11-03, W02 review rounds 1–2 (sim agent)

### GP-57 · An Extractor on a depleted deposit stays active, draws 6 E/s and produces nothing

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/production/index.ts` (`extractorProductionSystem`, `checkExtractorDepositCoverage`), `shared/sim/src/systems/power-core/index.ts` (extractor branch, `powerDrainPerS` 6)
- **What happens:** once every metals tile under an Extractor reaches richness 0, `checkExtractorDepositCoverage` returns `covered: false` and production skips it silently. Its entity state stays `active`, so the power core keeps counting its 6 E/s and it can still cause or deepen a brownout. Nothing tells the player the deposit is used up.
- **To resolve (owner):** should a depleted Extractor go offline (a new state, no drain, shown in the inspector), or stay as is until the player dismantles it? Recommendation: an offline state with no drain and an inspector line.
- **Found:** 2026-11-03, W02 review round 1 (sim agent)

### GP-58 · Dispatch v1: pull-based, one builder per colony, one W02 build at a time

- **Status:** Accepted (by design, W02)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/work.ts` (`buildProvider`), `shared/sim/src/systems/economy/buildJob.ts`, `shared/sim/src/systems/queue/index.ts` (`tryStartQueueEntry`, `activeInLane`), `shared/sim/src/systems/dispatch/index.ts` (`selectWorkerForDispatch`, `dispatchJob`, `dispatch.manager`)
- **What happens:** W02-16 is built in round 2 (58956ab) as a pull: the HQ's `build` work provider takes the colony's oldest W01 order ready for work, else its oldest W02 job ready for work, walks into reach and works it through the W01 `build` command; Worker Drone T1 builds tier ≤ 1 and terraforms except deep water. With one builder (the HQ) per colony the "nearest idle eligible worker, lowest tier on ties" rule of `UO-D-03` is trivially met, and pre-empting auto work for a player-precedence job is not implemented in the providers. `selectWorkerForDispatch` and `dispatchJob` have no caller outside tests; `dispatch.manager` (slot 5) only prunes `blobs.dispatch` records of idle or gone workers. `dispatchJob`'s Worker Drone T1 branch (`dispatch/index.ts` ~181/183) would rewrite the tile's terrain to forest / rock before assigning a Clear / Break, a state write no rule allows. The construction lane also starts one W02 build per colony at a time: a second build entry waits `waiting: worker` (`activeInLane`), gets no building entity, no ghost on the map and no linked prep until the first one finishes. This is a lane rule, not a builder count: a second builder would not change it.
- **Why it is like this:** the hackathon cut: one builder per colony in W02; Worker Drone T2 (W03) adds deep water and build tier ≤ 2.
- **To resolve:** when a colony can have several builders, let the lane start one entry per free builder, move the pull into `selectWorkerForDispatch` (or delete it), add pre-emption, and drop the terrain write from `dispatchJob`.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)

### GP-59 · Worker eligibility is hard-coded; the data rows that describe it are not read

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/dispatch/eligibility.ts` (`isWorkerEligibleForJob`, `canDoWork`, `colonyHasEligibleWorker`), `shared/sim/src/data/hq.ts` (`hq.t1.maxBuildTier`), `shared/sim/src/data/units-workers-basic.ts` (`t1` / `t2` / `t3`; `maxBuildTier` and `allowedTerraformOps`), `shared/sim/src/host/view.ts`, `shared/sim/src/systems/harvest/unit.ts`
- **What happens:** which unit may build, prep a site or terraform is decided by entity kind in code: the HQ builds up to its `tier` column and runs every op; Worker Drone T1 harvests, builds tier ≤ 1 and terraforms except deep water. T2 adds deep water and build tier ≤ 2. T3 builds tier ≤ 3. They are one unit (`worker`), rows `t1` / `t2` / `t3`. `hq.t1.maxBuildTier` is read nowhere (reserved in `generation-data.spec.ts`), `unitsWorkersBasic.t1.maxBuildTier` is only copied into the client views (`host/view.ts`, `syncWorkerView`), and `allowedTerraformOps` is read nowhere; it also lacks `work`, which the code allows. A `tune` of these fields changes nothing.
- **To resolve:** read `maxBuildTier` / `allowedTerraformOps` from the unit's row in `isWorkerEligibleForJob` (rows `t1` / `t2` / `t3`), or delete the fields.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)

### GP-60 · A W02 site can stall without a specific status

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/economy/buildJob.ts` (`siteState`, `stepBuildingSites`), `shared/sim/src/systems/economy/construction.ts` (`enqueueLinkedPrep`), `shared/sim/src/systems/queue/step.ts` (`BUILD_WAIT_DETAIL`), `shared/sim/src/systems/hq/cell.ts`
- **What happens:** a W02 job whose footprint is not fully prepared waits `site` (`waiting: site (prep n/4)`) until the linked prep order finishes it. Nothing re-creates the prep order: when a prep job is dropped while its tile is still unprepared (the GP-01 re-check drops a job whose tile changed, e.g. claimed by another colony or turned into an obstacle by `dev.seed`), or the order is removed some other way while the building stays, the job waits `site` forever. The same is true of the W01 Hub path. Prep also stops while the HQ cell is empty (each Grade costs 20 E from the cell; the `w02` scenario starts with a 200 E cell, two 2×2 buildings need 8 Grades = 160 E), and the queue entry still only says `waiting: site (prep n/4)`.
- **To resolve:** in `stepBuildingSites`, re-enqueue linked prep for unprepared tiles when the job has no live prep order; give the entry a `site (HQ energy)` detail when the prep waits for the cell.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)

### GP-61 · The queue's ETA fallback hard-codes production rates

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/queue/wait.ts` (income estimate used by `computeResourceWaitState`)
- **What happens:** when a colony has no production ledger rate, the resource-wait ETA guesses income from literals: `1.0 × richness` per active Extractor and `0.5` per harvesting Worker Drone T1 (or `0.5` per idle / moving Worker Drone T1). The rows say otherwise (Extractor `outputPerS` 4.0 × 0.25 = 1.0, Worker Drone T1 `harvestRatePerS` 2.0 × 0.25 = 0.5 today) and a `tune` is not seen. Since round 1 the normal path reads `colony.production.incomePerS`, so the fallback runs only for colonies without a production ledger.
- **To resolve:** read the rates from the compiled rows, or drop the fallback and show `(no ETA)`.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)

### GP-62 · Two Worker Drone T1 production paths write `col.unitQueue`

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/queue/index.ts` (`saveQueueEntries`, slot 4 `queue.manager`), `shared/sim/src/systems/queue/step.ts` (`finishUnit`, `buildUnit` entries), `shared/sim/src/systems/factories-hub/index.ts` (`saveAllEntries`, `enqueueHubUnit`, slot 9 `factories.hub`)
- **What happens:** the Units lane of the W02 queue (`enqueueTask { buildUnit }`) builds Worker Drones (T1) in `queue/step.ts`, and the older `factories-hub` system has its own queue and production loop. Both write the colony's `col.unitQueue` view (slot 4 and slot 9), so one can overwrite what the other wrote in the same step. `enqueueHubUnit` has no live caller: the Units menu calls it only through an optional session hook that only `units-menu.spec.ts` supplies. Cancel paths still read both (`cancelAllColonyTasks` → `getHubUnitQueue`).
- **To resolve:** keep one Units-lane implementation (the queue), delete `enqueueHubUnit` and the factories-hub queue, or make factories-hub the queue's producer only. See XC-28.
- **Found:** 2026-11-03, W02 review round 1 (sim agent)

### GP-63 · Every waiting build entry runs the full placement rule each scan

- **Status:** Open (watch)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/queue/index.ts` (`tryStartQueueEntry` → `startBuildingConstruction`), `shared/sim/src/systems/economy/siteTerrain.ts` (`buildingSiteBlock` → `evaluatePlacement`, `placementWorldFromState`)
- **What happens:** since round 1 a W02 build entry that reaches its start (stock and lane free) runs `evaluatePlacement` (with a fresh placement world and occupancy set) every scan; an entry that keeps waiting on `site` repeats it every step. Cheap for one colony, not measured for many.
- **To resolve:** measure with the economy planet of `sim:bench` (W02-33, still a stub, see XC-31); if it shows, cache the verdict per entry until `pathEpoch` / the footprint tiles change.
- **Found:** 2026-11-03, W02 review round 1 (sim agent)

### GP-64 · Deposit richness above 100 % is lost as the deposit depletes

- **Status:** Accepted (by design, owner comment in code)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/production/index.ts` (`normalizeRichness`)
- **What happens:** richness in basis points above 10 000 gives an output multiplier (`raw / 10000`, up to ~1.38); at or below 10 000 bp the multiplier is 1.0 until the tile is empty. Extraction lowers the stored richness, so a rich deposit loses its bonus once it falls to 10 000 bp and then runs at 1.0× to the end.
- **Why it is like this:** the comment in `normalizeRichness` keeps the rate at 1.0× while finite deposits deplete; the bonus is meant as an early boost.
- **To resolve:** nothing unless the owner wants the bonus to last (store the initial richness separately).
- **Found:** 2026-11-03, W02 review round 1 (sim agent)

### GP-65 · Stockpile counts dev grants and terraform yields as production

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/economy/ledger.ts` (`creditResource`, `opts.produced`), callers in `systems/dev/index.ts` (`fill`, grants), `systems/terraform-basic/workSystem.ts`, `systems/harvest/index.ts` (`completeWorkerWorkJob`), `backend/app/src/game/thread/production-batches.ts`
- **What happens:** `production.produced` grows on every `creditResource` call except refunds (`refundCost` passes `produced: false`). Dev `fill` / grant commands and TERRAFORM / Worker Drone T1 work-job yields therefore count as produced, and the W02-28 `resourceProduced` batches (Stockpile progression) include them, not only Extractor and Worker Drone T1 output.
- **To resolve:** pass `produced: false` from dev grants (and from terraform yields if Stockpile should count only extraction), or split the counter by source.
- **Found:** 2026-11-03, W02 review round 1 (backend agent)

## W08 Stages & HQ Goals

### GP-66 · W08 H-scope cut: S5–S10 runtime triggers, threat scaling hooks, and late-stage goal breakdowns are deferred to H+ / F

- **Status:** Accepted (by design, W08 H-scope cut)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/progression/` (`index.ts`, `threatStage.ts`, `unlockStage.ts`, `threat.ts`), `shared/sim/src/systems/goals/breakdown.ts`, `shared/sim/src/systems/rule-engine/automate.ts`; `docs/plan/waves/W08-stages-goals.md` §3
- **What happens:**
  - `S0`–`S4` runtime stage triggers (`Command Hub T1`, `extractor + generator`, `3 buildings + 2 workers` + `fauna` safety override, `HQ T2 || 6 buildings + 1 defense` + `hazard` safety override) are evaluated at 1 Hz; `S5`–`S10` data rows exist in `shared/sim/src/data/stages.ts` (`W08-02`) and can be set via `dev.stage`, while their runtime evaluators (`W08-05`) and unbuilt-wave row tags (`W08-14`) wait for `H+` / `F` waves (`W03`–`W05`, `W07`, `W09`–`W11`, `W23`).
  - `Establish Colony`, `Grow Economy`, and `Secure Power` break down into concrete `OrderQueue` tasks (`W08-17`). The remaining 6 goal kinds (`defend_colony`, `expand_border`, `upgrade_hq`, `terraform_area`, `prepare_for_hazard`, `build_rocket`) can be queued, reordered, and cancelled in the HQ goal queue (`W08-16`), while their task breakdowns and budget-ceiling reservations (`W08-18`–`W08-20`) are deferred to `H+` / `F`.
  - `UnlockStage` and `ThreatStage` are tracked separately in the sim (`W08-06`, `W08-08`, `W08-09`); persisting `UnlockStage` in `player_profiles` across planets (`W08-07`), early-raid protection scaling (`W08-15`), `S4+` automation hooks (`W08-26`), and `priorityPresets.ts` (`W08-29`) are deferred to `H+` / `F`.
- **Why it is like this:** `docs/plan/waves/W08-stages-goals.md` scopes W08 to the 20 `H`-tagged issues so W08 ships cleanly before `W03`–`W05`, `W07`, and `W12` land.
- **Workaround / mitigation:** `dev.stage` (`stage set <0..10>`, `stage trigger <fauna|hazard>`, `stage skip-dwell`) and `dev.autopilot` allow testing any stage or override directly.
- **To resolve:** implement `W08-05`, `W08-07`, `W08-14`, `W08-15`, `W08-18`–`W08-20`, `W08-26`, `W08-29`, `W08-31`, `W08-32` when their target waves (`W03`–`W05`, `W07`, `W09`–`W12`, `W23`) land.
- **Found:** 2026-11-03, W08 wave implementation (lead)

### GP-67 · W08 goals expose missing production capabilities instead of claiming completion

- **Status:** Open (owning-wave work specified)
- **Area / code:** `shared/sim/src/systems/goals/{executors,growth,breakdown}.ts`; [progression contract](../plan/W08-PROGRESSION-CONTRACT.md)
- **What happens:** Grow Metals now bypasses unavailable storage placement, creates real production orders and reads the production ledger. An idle unit, capped stock or unpowered extractor no longer counts as output. Secure Power uses actual night output; +10 E/s cannot complete with the current solar-only construction catalog. Water growth is unavailable because the current harvest path cannot produce water. Unsupported goal kinds reject with `wave_disabled` instead of taking a slot and doing nothing. Existing saved unsupported goals explain the missing executor and can be cancelled.
- **Why it is like this:** W03 owns storage/night generators/resource extractors; W07 and later waves own combat, expansion, tech and rocket actions. W08 does not implement those waves. Goal executor registration is now the availability gate.
- **Workaround / mitigation:** active goals show action/wait reasons. Spend full storage, supply missing resources, clear a valid site or cancel a blocked goal. Automatic Worker Drones follow the active resource goal without changing saved weights; manual assignments remain authoritative. Goals no longer create a fallback metals deposit in the live world.
- **To resolve:** owning waves must implement the acceptance tests and tutorial chain in the progression contract, including storage growth, actual positive night output, Water extraction, finite-resource/reachability handling and budget ceilings (W08-20, still deferred). Current budget values remain metadata, not enforced spending ceilings.
- **Found:** 2026-11-03, W08 owner fixes. Supersedes GP-66's claim that unfinished goals are intentionally queueable.

### GP-68 · The HQ cell is the grid's first energy store (night brownout fix)

- **Status:** Accepted (by design, 7e901d5)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/power-core/hqCell.ts`, `evaluate.ts`, `shared/sim/src/systems/hq/cell.ts` (`hqCellGridLinked`), `hq.t1.cellGridDischargePerS`
- **What happens:** Owner report: "all works by day, all dies at night". The grid only used Capacitor Banks as storage and ignored the HQ cell, so at sunset group 3 was shed at once. Now, in the Hub's component, a deficit draws the HQ cell first (≤ 30 E/s), then the banks; surplus refills the cell first (≤ 20 E/s within 6 tiles of the Hub, else 3 E/s), then the banks. Shedding starts only when the stores can't cover the deficit. Once a Hub is built the free HQ self-recharge stops (it would be a free generator); with a deficit and an empty cell, HQ terraform progress drops to 0 — the 3 E/s trickle remains only before the Hub.
- **Why it is like this:** A store that sits in the top bar should be the store the grid uses; the order cell → banks keeps the visible chip honest.
- **Workaround / mitigation:** `cell <n>` sets it; the hover shows `Stored: ±N E/s`.
- **To resolve:** Owner: confirm the order and the 30 / 20 / 3 E/s caps.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### GP-69 · Energy retune: founder core 16 instead of a bigger cell

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** data rows `shared/sim/src/data/hub.ts`, `grid.ts`, `economy-t1-basic.ts`, `units-workers-basic.ts`, `hq.ts`
- **What happens:** Owner feedback #3 ("too much energy"): every consumer costs more (Extractor −8, Quarry −10, Water −9, Well −12, Depot −3, Capacitor −2, Pylon −2.5, Worker Drone T1 −2/−1, Worker Drone T2 −3; Solar net 13, Wind 12). To keep the W03 start alive through most of a night with the 800 E cell, the Hub founder core rose from +8 to +16 (drain −5 → −7). W03 start: day net about +10, night about −3 (cell lasts ~267 s with working Worker Drones (T1), the whole night when they idle); one more Extractor + Quarry browns out in under a minute at night. The W02 night-brownout demo no longer happens with one Extractor (+1 at night).
- **Why it is like this:** The alternative, a bigger `hq.t1.cellCapacity`, needs the scenarios' hard-coded `cell` / `cellMax` changed too.
- **Workaround / mitigation:** All numbers are data rows and `tune`-able.
- **To resolve:** Owner: keep founder 16, or lower it and raise the cell capacity. Also: the `hqFastRechargeShed` / `cellFastRechargeShedGroup` fields are dead and `docs/game/colony-economy-and-buildings-spec.md` §2.2 ("fast recharge counts as group-3 load") is outdated — remove both.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### GP-70 · Power zones: rule, radii and what counts

- **Status:** Question for the owner (radii)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/construction/powerZone.ts`, `placement.ts` (`evaluatePlacement`), `power-core/graph.ts`; `hub.t1.powerZoneRadius` 6, `grid.pylon.powerZoneRadius` 5
- **What happens:** Owner feedback #4 (Protoss-style pylons): with the W03 grid on (gated on the `grid.pylon` row) every building except the Command Hub must have its whole footprint inside the union of zones, else `outside_power_zone`; pylons too, which is how the network extends. Built, under-construction and queued pylons count for placement (so a chain can be queued in one go), only built ones power, so a building in an unfinished pylon's zone shows `offline: no grid` until it finishes. Cancelling or losing a Hub or pylon strands the buildings in its zone: unstarted orders wait `site (outside the power zone)`, built ones go `offline: no grid`, nothing is removed. W02-only planets place anywhere as before. `enqueueQueueTask` without `data` (internal / tests) skips the check at enqueue; it runs again when the order starts. The graph fallback "no Hub and no relays → everything powered" remains, reachable only through scenario / dev spawns.
- **Why it is like this:** One field per source replaced `pylonSpan`, `attachRadius` and `dayCycle.pylonAttachRadius`; the graph uses the same zones so anything placeable is powered once its relays are built.
- **Workaround / mitigation:** The zone is drawn while a building ghost is armed.
- **To resolve:** Owner: tune the radii (6 / 5 picked by the agent).
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### GP-71 · Dismantle is a timed work job; open details

- **Status:** Accepted (by design, 7795d3d)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/terraform-basic/dismantleAndWork.ts`, the dismantle job files next to it, `shared/sim/src/data/work-crew.ts`
- **What happens:** Owner feedback #6: a Worker Drone T2 (else the HQ) walks to the building and takes it apart in 0.5 × build time, refunding 50 % step by step. Details: the building goes offline at order time (before the worker arrives), so dismantling a pylon splits the network at once; a cancel at ≥ 80 % leaves 1 HP and triggers a critical auto-repair; a dismantle takes a construction-lane slot from order time (with only the HQ, a queued build waits on `worker`); units are still recycled instantly (50 %) and the pod wreck is scrapped; the `demolish` command is still instant (unused by the client, a second path); multi-tile dismantles can't be cancelled by command id (job ids lack `chainRootId`; the client sends single tiles); no `buildingDismantled` event contract exists.
- **Why it is like this:** Dismantle reuses the repair work-job machinery (`blobs.workJobs`), not a second worker path.
- **Workaround / mitigation:** Cancel via CANCEL JOB on the building or the queue chip.
- **To resolve:** Route `demolish` through the job or remove it; add a `buildingDismantled` event if a client needs it.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### GP-72 · Crew speed-up and auto-help

- **Status:** Accepted (by design, 7795d3d)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `workCrew.crew` (`helperEfficiency` 0.6, `maxCrew` 4, `autoHelpRadius` 12), `workCrew.repair.costRate` 0.4
- **What happens:** Owner feedback #9: the k-th worker on a job adds `0.6^k` of its rate (1/2/3 Worker Drones on a Solar site: 93 → 60 → 50 ticks, same 60 metals), payment and refunds follow progress so a crew costs what one worker costs. Repair costs 0.4 × cost × missing HP share and waits on `resources` at zero stock. Any idle Worker Drone T2 within 12 hexes joins an open repair or dismantle — including one the player parked — and can't take builds until that job ends; the HQ and Worker Drones (T1) never auto-help.
- **Why it is like this:** Diminishing returns stop a swarm from making work instant.
- **Workaround / mitigation:** Give that Worker Drone another order to pull it off.
- **To resolve:** Owner: confirm that auto-help may grab parked Builders.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### GP-73 · Unit supply: open details

- **Status:** Question for the owner (depot power)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/supply/`, `hub.t1.supplyProvided` 10, `grid.supplyDepot.supplyProvided` 8, `hub.t1.supplyCapMax` 200
- **What happens:** Owner feedback #2: supply is one module (`computeColonySupply`, `checkUnitSupply`, system `supply.sync` → `colony.supply`). A depot's supply counts only while it is finished and powered (same rule as storage caps): a browned-out depot drops the cap, units can sit over it, and production pauses. The `supply_cap` reject applies to every `enqueueTask` source — a future AI / HQ path would be rejected instead of queued (internal `enqueueQueueTask` callers still wait). The legacy `hubProduction` lane is still registered next to the queue `units` lane and supply counts reservations from both. `REJECT_TEXT_BY_KIND.enqueueTask.invalid_args` says "Invalid terraform order" even for an unknown unit.
- **Why it is like this:** Matching storage caps keeps one "active provider" rule (`isActiveCapacityProvider`).
- **Workaround / mitigation:** Keep the depot inside a powered zone; the HQ cell now carries nights.
- **To resolve:** Owner: should depot supply ignore power? Remove the legacy Hub lane; word the unknown-unit reject.
- **Found:** 2026-11-04, W03 owner-feedback pass (lead + parallel agents)

### GP-74 · A building at 0 HP stays as an active wreck when W07 is off; removed to Prepared ground when W07 is on

- **Status:** Resolved for W07+ (`wave/w07-first-contact`) / Open for `TA_WAVES=..03`
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/dev/w03.ts` (`devDamage`), `shared/sim/src/systems/combat/damage.ts` (`applyDamage`), `shared/sim/src/systems/terraform-basic/autoRepair.ts`, power graph
- **What happens:** With `W07` enabled, `damage <entity> 100` delegates to `applyDamage`, removing the building at 0 HP, converting its footprint tiles to `PREP.prepared`, and emitting `buildingDestroyed`. When `W07` is off (`TA_WAVES=..03`), `dev.damage` preserves the W03 unit-test behavior (`w03-dev-commands.spec.ts`) of clamping HP to `0` without removing the entity.
- **Why it is like this:** Destruction / wreck removal is introduced by W07-02 (`UO-C`, `UO-TF-04`), while `w03-dev-commands.spec.ts` explicitly asserts `hp === 0` on a W03-only pipeline.
- **Workaround / mitigation:** Enable `W07` (the default `all` wave set) for full building destruction and Prepared pad conversion.
- **To resolve:** If W03-only runs also want 0-HP removal, update `w03-dev-commands.spec.ts` to expect entity removal at 100% damage.
- **Found:** 2026-11-04, W03 owner-feedback pass; updated in W07 (`wave/w07-first-contact`).

### GP-75 · `dismantle` wire form is rejected by the contract

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/contracts/src/commands/enqueue-task.ts`, the sim dismantle handler
- **What happens:** `enqueueTask {task:{kind:'dismantle', entityId}}` is rejected `invalid_args` by the wire contract though the sim handler and its docstring accept it; only `{kind:'terraform', op:'dismantle', q, r}` (what the client sends) gets through.
- **Why it is like this:** The client never sends the entity form.
- **Workaround / mitigation:** Use the terraform op form.
- **To resolve:** Add the entity form to the contract or drop it from the handler.
- **Found:** 2026-11-04, W03 owner-feedback pass (e2e update)

### GP-76 · `addLoad` without an entity id lands on one branch and drains the stores colony-wide

- **Status:** Accepted (dev tool)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `power-core/evaluate.ts` (`getComponentSyntheticLoad`), dev `addLoad`
- **What happens:** With the HQ cell as the grid store, `addLoad 85` (overload demo) also drains the cell and capacitors (800 → 11 E in one run), so later steps start with an empty store.
- **Why it is like this:** Synthetic load is real demand.
- **Workaround / mitigation:** Run `cell 800` after an `addLoad` demo; the e2e runs the night step on a fresh colony.
- **To resolve:** —
- **Found:** 2026-11-04, W03 owner-feedback pass (e2e update)

### GP-77 · Unified extractor compatibility and mixed deposits

- **Status:** Accepted (owner feedback, 2026-11-04)
- **Area / code:** `systems/construction/placement.ts`, `systems/production/index.ts`, construction catalog
- **What happens:** New Resource Extractors use the existing metalsExtractor entity kind on either metals or minerals. A footprint covering both mines metals first, then minerals when metals are exhausted. Existing quarry entities remain supported in saved worlds and legacy commands.
- **Why it is like this:** One player-facing building without invalidating existing saves. Both resources use the extractor's cost and production rate; crystals tint its model violet.
- **Workaround / mitigation:** Place over a single resource to choose the output explicitly.
- **To resolve:** A future save migration can retire the legacy quarry kind if needed.
- **Found:** 2026-11-04, owner feedback implementation.

### GP-78 · Wind uses three-minute simulation windows

- **Status:** Accepted (owner feedback, 2026-11-04)
- **Area / code:** `systems/power-core/windAndCap.ts`, `data/grid.ts`
- **What happens:** Planet-wide deterministic low/medium/high wind holds for 900 ticks (three simulated minutes), multiplying net turbine output by 25%/100%/150%. Consecutive windows may pick the same level. Warp accelerates the windows.
- **Why it is like this:** Authoritative simulation time keeps replicas, electricity and environmental animation aligned.
- **Workaround / mitigation:** HUD names the current level and percentage.
- **To resolve:** Tune `windResampleTicks` if longer weather windows are desired.
- **Found:** 2026-11-04, owner feedback implementation.

### GP-79 · Pre-landing W03 builder save identity

- **Status:** Accepted (integration compatibility)
- **Area / code:** `ecs/columns.ts`, `systems/progression/types.ts`
- **What happens:** Builder uses kind 50 (the existing progression unit code); kind 8 remains the already-landed Trade Hub. A development snapshot made on the unlanded W03 branch with a kind-8 builder is not compatible with the merged registry.
- **Why it is like this:** Both branches independently allocated kind 8. Preserving the landed Trade Hub ID avoids changing existing main saves. The live grid kinds now also replace W08's placeholder building codes.
- **Workaround / mitigation:** Start a fresh W03 scenario after landing. Existing main saves keep Trade Hub identity. No database or saved world is automatically deleted.
- **To resolve:** If an old W03 development world must be recovered, migrate its kind-8 builders using that snapshot's branch provenance before loading it.
- **Found:** 2026-11-04, full merge review.


### GP-80 · W07 hive fauna implementation and provisional balance

- **Status:** Resolved (`wave/w07-first-contact`, 2026-11-04; balance defaults remain tunable via `tune`)
- **Area / code:** `shared/sim/src/data/{weapons,combat-units,fauna}.ts`, `shared/sim/src/systems/{combat,fauna,progression}/`, `frontend/render/kitbash/archetypes/units/bugs/`, `frontend/playground/fauna/`
- **What happens:** Implemented the three neutral insect species (`blackAnt`, `blueBeetle`, `greenSpitter`) and species-specific `3×3` hives (`hiveBlackAnt`, `hiveBlueBeetle`, `hiveGreenSpitter`), passive/aggressive state transitions, bounded 3-wave episodes with cooldowns, deterministic `FaunaDirectiveV1` replication + checkpoints, six validated kitbash models, and four playground hive-life fixtures. W08 `systems/progression/threat.ts` (`computeRaidWaveComposition`) now reconciles with the species threat-budget registry (`speciesComposition`) while keeping legacy `skitter`/`brute` fields for W08 callers.
- **Why it is like this:** Follows the [Hive fauna contract](../game/fauna-hives-spec.md) and OWNER_TASKS defaults (`B2` view radii, `B4` air targeting, `B7` Laser Tower T1 at S3, `B8` footprints, `B9` stance radii, `B10` no ammo/laser spike in battle v1, `B11` bite cadence). Blue beetle armor is represented as higher plain HP (`420`) and chitin plating rather than a damage-reduction multiplier.
- **Workaround / mitigation:** Every combat and fauna number is in `shared/sim/src/data/{weapons,combat-units,fauna}.ts` and live-tunable via `tune`.
- **To resolve:** Owner playtest of the starting balance rows; W07-26 (CI duel harness port of `docs/game/tools/battle_duels.py`) is `H+` and deferred per `docs/plan/waves/W07-first-contact.md` §"Hackathon slice".
- **Found:** 2026-11-04, owner fauna redesign; resolved in W07 (`wave/w07-first-contact`).

### GP-81 · W07-26 CI duel harness (`shared/sim/test/duels.spec.ts`) is deferred (`H+`)

- **Status:** Accepted (by design, hackathon slice)
- **Area / code:** `docs/plan/waves/W07-first-contact.md` §"Hackathon slice", `docs/game/tools/battle_duels.py`
- **What happens:** The ground-triangle CI duel suite (`W07-26`, `H+`) is deferred from the W07 hackathon slice; the Python duel harness in `docs/game/tools/battle_duels.py` and the unit/combat/fauna suites (`w07-combat-stats.spec.ts`, `w07-combat-fauna.spec.ts`, `w07-projectiles.spec.ts`, `w07-aoe.spec.ts`, `w07-lasers.spec.ts`, `w07-evasive.spec.ts`, `w07-layers.spec.ts`, `w07-vision.spec.ts`, `w07-targeting.spec.ts`, `w07-stances.spec.ts`) cover the battle v1 mechanics today.
- **Why it is like this:** Explicit hackathon cut in `docs/plan/waves/W07-first-contact.md`; real Tank/Artillery rows land in W17-26 and air rows in W19-27.
- **Workaround / mitigation:** Use `spawnUnit recon|demoTank|demoArtillery` and `hitDebug on` in `/play.html?scenario=w07` or run the unit suites.
- **To resolve:** Land `W07-26` (`shared/sim/test/duels.spec.ts`) when `H+` issues open or alongside W17-26.
- **Found:** 2026-11-04, W07 wave execution.

### GP-82 · Hive-life firing range locks every shooter onto the lowest id and deals no damage

- **Status:** Resolved (shooting-gallery and battle-orchestrator change)
- **Area / code:** `shared/sim/src/systems/combat/firingRange.ts`, `damage.ts` (`isCombatDryFire`), `frontend/playground/content/faunaFiringRange.ts`
- **What happens:** Playground modes `turrets`, `units`, and `bugs` set `blobs.firingRange` and `blobs.combatDryFire` on a real radius-8 planet and step the combat and fauna systems. Dry fire makes `applyDamage` apply 0, so shots and bites still emit and never destroy the target. Every turret, or every battle unit, or every bug, aims at the lowest living entity id of the other side. A turret that loses that bug to range goes quiet instead of picking another. Tank and artillery both draw `robot.combat`. A hive scene also shows the playground hex sample, which is now entirely flat prepared ground with no deposits and no colony border.
- **Why it is like this:** The range is a dry run of the game's own fire and walk code. Lowest id keeps the shot deterministic. The hex sample used to be a class-and-deposit diorama; hive life needed one terraformed field.
- **Workaround / mitigation:** Turn dry fire off and the same shot reduces HP (`w07-firing-range.spec.ts`). Passive and aggressive hive scenes still use the cosmetic wander stepper, with the mesh easing toward the logical pose.
- **Resolution:** `gallery` now combines the turret and unit modes, assigns one fixed bug to each shooter, and holds both sides stationary. `BattleOrchestrator` runs units, defenses, fauna weapons and one impact pass on every host. Old URL modes redirect to the gallery. Dry fire remains intentional; the separate `bugs` mode retains its attack preview. Shared tank/artillery geometry is tracked in RN-70.
- **Found:** 2026-11-05, playground hive-life pass.

### GP-83 · A together march walks slower than each member's data speed

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/units/movement/orchestrator.ts` (`marchSpeed`), `shared/sim/src/systems/units/groupHandler.ts`, `docs/spec/SIMULATION.md` (SIM-M-01)
- **What happens:** `moveGroup` with `pace: "together"` freezes every member at the slowest member's `speedPerTick` for that order. A faster unit takes shorter steps than its data row. The cached `mobileStats` object is not written. Default pace is each unit's own speed.
- **Why it is like this:** SIM-M-01 says movement is at the unit's data speed. The no-teleport checks only forbid going faster, so a slower group pace stays inside them. The frozen number is how a mixed group stays together without a second mover.
- **Workaround / mitigation:** Omit `pace` (or send `"own"`) and each kind keeps its own speed.
- **To resolve:** If the owner wants the spec sentence to allow a group pace, add that sentence next to SIM-M-01.
- **Found:** 2026-11-05, group-march implementation.

### GP-84 · Units in a march may share a tile while they walk

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/units/movement/groupMarch.ts`, `shared/sim/src/grid/flowField.ts`
- **What happens:** The shared field does not treat other units as obstacles. Two members can stand on the same hex on the way. After the march, each fitted member occupies a different slot.
- **Why it is like this:** Making units into costs would break the shared field and the snapshot replay. Distinct tiles are reserved only at the destination.
- **Workaround / mitigation:** The arrival check in `group-march.spec.ts` requires 50 distinct final tiles.
- **To resolve:** A later change could reserve the slot disk only, still without physics steering.
- **Found:** 2026-11-05, group-march implementation.

### GP-85 · A member who leaves does not speed the together march back up

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/units/movement/groupMarch.ts` (`marchSpeed` copied onto each motion at issue)
- **What happens:** `stopUnit` or a later `moveUnit` detaches that one unit. Everyone else keeps the speed frozen when the order was given, even if the slowest member was the one who left.
- **Why it is like this:** Recomputing the minimum mid-order would change steps that a restored snapshot has already replayed.
- **Workaround / mitigation:** Send a new `moveGroup` to pick a new pace.
- **To resolve:** Only if a live pace is required. It would have to be plain data on the march and covered by the restore test.
- **Found:** 2026-11-05, group-march implementation.

### GP-86 · The long leg of a group march is one shared corridor

- **Status:** Resolved (group seating, 2026-11-06)
- **Area / code:** `shared/sim/src/units/movement/slots.ts` (`assignSlots`, `leaveCorridor`), `shared/sim/src/units/movement/groupMarch.ts` (`pathToSlot`)
- **What happens:** Seats used to be handed out by entity id, ring 0 first, and every outside member walked to the anchor before stepping out to that seat. A unit from the middle of the group could be sent to the rim and then walk back out through the units arriving behind it.
- **Why it is like this:** One reverse Dijkstra still builds the long leg. The seat is now the tile that keeps the unit's offset from the group centre, and the member leaves the corridor at the closest tile with a clear line to that seat.
- **Workaround / mitigation:** When that line is blocked, the member still follows the corridor to the anchor and takes the disk path around the blockage.
- **Resolution:** Open ground no longer funnels the group onto the anchor and back out. The blocked-line fallback remains, because a second private search per unit would not fit the expansion budget.
- **Found:** 2026-11-05, group-march implementation. Seating reported as chaos on 2026-11-06.

### GP-87 · Melee, ranged, and attack approach bands still disagree

- **Status:** Resolved (2026-11-07 working-tree review fixes; commit pending)
- **Area / code:** `shared/sim/src/systems/fauna/step.ts`, `shared/sim/src/units/commands/attack.ts`
- **What happens:** Fauna melee stops at distance 1. Ranged fauna use `floor(range) - 1`. The generic attack command uses the full weapon range. A dispatched wave and the live chase can also differ by the target's footprint pad. `moveGroup` does not change any of these.
- **Why it is like this:** The group march only assigns move slots. Combat approach was left as it stood.
- **Workaround / mitigation:** None for combat spacing. Group move orders are exact slot tiles (`minDist` 0, `maxDist` 0).
- **To resolve:** Pick one band rule for melee, ranged chase, and the attack command, and cover it with a time-sampled position test.
- **Found:** 2026-11-05, movement research.
- **Resolution:** Shared combatApproachBand and footprintAttackRange now serve live fauna chase, waves, directives, provocation, generic attacks and playground combat. Sampled ant/spitter approaches against a real 3×3 hub remain at the same valid edge over 100 ticks.

### GP-88 · Weapon cooldown rounding changes configured battle rates

- **Status:** Resolved (2026-11-07 working-tree cadence fix; commit pending)
- **Area / code:** `shared/sim/src/systems/combat/weaponFire.ts:10`, `turrets.ts`, `stanceHelpers.ts`
- **What happens:** At 5 TPS, rounding `5 / ratePerS` makes the Recon/Autocannon 2/s rows fire every 3 ticks (1.667/s), while Laser Tower 4/s fires every tick (5/s). Their sustained damage differs from W07-13 by −16.7% and +25%.
- **Why it is like this:** The firing scheduler stores an integer cooldown without retaining fractional cadence.
- **Workaround / mitigation:** None; data snapshots passing do not prove sustained rates.
- **To resolve:** Accumulate fractional shot credit or deadlines and test sustained shot counts through the production combat system.
- **Found:** 2026-11-06, W07 full-branch review; direct production-helper probe.
- **Fix:** Fractional firing deadlines retain cadence at 5 TPS; production tests verify 20 Recon/Autocannon shots and 40 laser shots over 10 seconds. Zero rate disables fire. Maximum remains one shot per tick (5/s).

### GP-89 · Group local routes survive terrain invalidation

- **Status:** Resolved (2026-11-07 working-tree review fixes; commit pending)
- **Area / code:** `shared/sim/src/units/movement/groupMarch.ts:197` (`pathToSlot`, `replanGroupMember`)
- **What happens:** A member starting inside the destination disk retains `slot.local`. After an intermediate tile becomes rock, replanning returns that same original route, even after a replacement field is solved. A 20-HQ group initially at (1,0), ordered around (0,0), leaves member 12 stuck at (1,-1) for 100 ticks when (0,-1) becomes rock; its destination (0,-2) remains reachable.
- **Why it is like this:** `pathToSlot` returns cached `slot.local` before validating it against current terrain or rebuilding from the member's current position.
- **Workaround / mitigation:** Issue a fresh move order after the terrain change.
- **To resolve:** Invalidate/rebuild local seating paths on blockage and epoch change; add coverage for members initially inside the destination disk.
- **Found:** 2026-11-06, W07 full-branch review, executable SimHost probe.
- **Resolution:** Local seating routes are rebuilt from the current position against current terrain. A blocked destination fails explicitly; a reachable destination routes around a new rock. The 20-member regression advances 120 individual ticks and checks all reachable assigned slots.

### GP-90 · Demand-based autopilot preserves previously accepted orders

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/systems/rule-engine/automate.ts`, `needs.ts`
- **What happens:** Priorities now weight observed shortages instead of manufacturing power/expansion/defense demand. Wind and thermal generation count toward night supply; battery discharge does not. Already accepted orders, including old excess wind orders, finish normally. Explicit feasible Secure Power goals complete and stay complete.
- **Why it is like this:** Correcting future decisions must not silently cancel paid player or goal work.
- **Workaround / mitigation:** Cancel any unwanted existing queue entries manually. Matching queued work is reused before another automatic order is added.
- **To resolve:** No automatic queue purge planned; generation forecasts remain heuristic (AI-02).
- **Found:** 2026-11-06, owner report of endless default-priority turbines.

### GP-91 · Combat Lab tunes types across the planet

- **Status:** Accepted (by design)
- **Area / code:** `frontend/game/features/combat-tuning/`, `shared/sim/src/host/tunedHealth.ts`
- **What happens:** F6 edits affect every current and future entity of a type across all colonies on this planet. Health changes preserve remaining HP percentage. Weapon rate is capped at 5/s; insect attack intervals use 0.2-second steps with animation minimums (ant 0.8s, beetle/spitter 1s). Demo tank/artillery expose weapon settings only because they have no normal production health row.
- **Why it is like this:** Uses the existing authoritative planet balance overrides and 5 TPS simulation. Type-wide tuning was the recommended default; individual-instance editing was not requested in reply to clarification.
- **Workaround / mitigation:** Export JSON for reusable balance overrides. Reload values after other players tune. The existing console `tune reset` restores file/scenario values; no broad reset button is added to the combat panel.
- **To resolve:** Add individual-instance overrides only if required; support higher firing rates with explicit multi-shot scheduling.
- **Found:** 2026-11-07, combat tuning and armored scout request.

## W05 Shape the Land

### GP-92 · W05-09 re-opens D-37 for linked site prep (`Level`, `Fill`, `Reclaim`, `Deep Reclaim`, `Clear`, `Break`)

- **Status:** Accepted (by design, W05-09)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/grid/geo.ts` (`geoBuildBlock`), `shared/sim/src/systems/construction/{prep,placement}.ts`, `shared/sim/src/systems/economy/siteTerrain.ts`, `shared/sim/src/systems/terraform-basic/ops.ts` (`SITE_PREP_TERRAFORM_OPS`, `opForTerrain`)
- **What happens:** W05-09 re-opens D-37 per terrain class when W05 data (`opsBasic.level`) is active: `TERRAIN.forest` (`clear` + `grade`), `TERRAIN.rock` (`break` + `grade`), `TERRAIN.slope` (`level` + `grade`), `TERRAIN.hole` (`fill` + `grade`), and `TERRAIN.shallow` (`reclaim` + `grade`) become linked-prep-able in `geoBuildBlock` and `planPrepJobs` under one shared rule (`evaluatePlacement` + `planPrepJobs`). `TERRAIN.deep` (`deepReclaim` + `grade`) is linked-prep-able only when the colony has an alive Worker Drone tier ≥ 2, or the HQ; otherwise it remains blocked (`water`). `PREP.ridge` and `PREP.moat` remain `terrain_unbuildable` (`ridge`). When `TA_WAVES=..01..04` (or `data` is omitted in W01 unit specs), `linkedPrep` is `false` so W01–W04 `terrain_unbuildable` placement checks remain unchanged.
- **Why it is like this:** Keeps one shared `evaluatePlacement` + `planPrepJobs` rule across server, local host, and client construction ghost while preserving W01–W04 wave compatibility (`--waves ..04`).
- **Workaround / mitigation:** None needed; `cancelTask` on either the build or its linked prep cancels both and refunds `50 %` of spent resources.
- **To resolve:** —
- **Found:** 2026-11-04, W05-09 implementation.

### GP-93 · Worker drone tiers share lanes; the op list on the row is still not read

- **Status:** Resolved (worker unit id, this change)
- **Area / code:** `shared/sim/src/data/units-workers-basic.ts` (rows `t1` / `t2` / `t3`), `shared/sim/src/systems/dispatch/eligibility.ts`
- **What happens:** There is one produced unit, `worker` (`ENTITY_KIND.worker`). T1, T2 and T3 are rows of `unitsWorkersBasic`, not kinds `harvester`, `builder` and `terraformer`. The command is `buildUnit { unit: 'worker', tier: 1|2|3 }`. T1 harvests, builds tier ≤ 1 and terraforms except deep water (mesh `robot.miner`). T2 adds deep water and build tier ≤ 2 (mesh `robot.builder`). T3 builds tier ≤ 3 (mesh `robot.builder`). The `grid.builder` and `terraform.terraformer` unit rows are removed. `allowedTerraformOps` / `maxBuildTier` still not being read at runtime stays GP-59.
- **Why it is like this:** The three ids and the duplicate tables were the same drone. Keeping them made the menu and the spawner disagree.
- **Workaround / mitigation:** None. Edit `unitsWorkersBasic` only.
- **To resolve:** Done for the ids and the duplicate rows.
- **Found:** 2026-11-06, worker-drone production change. Resolved in this change.

### GP-94 · A TERRAFORM click keeps reclaiming every reachable water tile, not only the pond

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/systems/terraform-basic/chain.ts` (`isChainObstacle`), `groundWorkRule.ts` (`evaluateGroundWorkTile`)
- **What happens:** shallow water (and deep water, once the colony has a worker of `deepReclaim`'s tier) is a chain obstacle, the same way forest is. One `work` order walks outward from the clicked hex and reclaims every such tile the colony may terraform, not only the connected pond. A locked deep tile is skipped; it does not cancel the shallow tiles of the same stroke.
- **Why it is like this:** the owner asked for the forest rule (retry an interior tile after the next finished hex, work from a passable neighbour, reach unchanged). A pond-only flood fill would be a second chain.
- **Workaround / mitigation:** `moveUnit`, `stopUnit` or another TERRAFORM order for that worker ends the chain. Before a T2 worker exists, deep water is `worker_tier_locked` and is left in place.
- **To resolve:** if one click should stop at the shore of the clicked pond, limit the chain to that connected component.
- **Found:** 2026-11-06, lake terraform fix

### GP-95 · Some building rows are outside the stage table the build menu now reads

- **Status:** Open
- **Area / code:** `shared/sim/src/data/terraform.ts` (`territoryBeacon`, `hydro`, `hazardShield`, `lightningRod`), `shared/sim/src/data/trade-hub.ts` (`t1.unlockStage`), `shared/sim/src/data/grid.ts` (`mineralsQuarry`), `shared/sim/src/systems/progression/validate.ts` (`resolveItemUnlockStage`), `frontend/game/features/construction-menu/catalog.ts`
- **What happens:** The build menu locks a card with `resolveItemUnlockStage`, the same value `placeBuilding` checks. Catalog buildings therefore cannot show as placeable and then return `stage_locked`. Four W05 rows still carry their own `unlockStage` (Territory Beacon 4, Hydro 2, Hazard Shield 4, Lightning Rod 2) but are not in `STAGE_TABLE_ROWS` and not in the build catalog, so `resolveItemUnlockStage` returns 0 and placement does not stage-lock them. Trade Hub T1's row stays at 2 because W10 tests assert that number; the stage table lists `tradeHub` at S4, and with W10 on both the menu and `checkItemUnlockStage` use `evaluateTradeHubUnlock` instead. Minerals Quarry stays off the menu and off the S2 toast (GP-77: it shares the Resource Extractor card).
- **Why it is like this:** Adding the W05 rows to the stage table would name them on the stage toast while the player still cannot place them. Changing the Trade Hub row would fail the W10 data tests. The quarry card was an owner decision, not a stage.
- **Workaround / mitigation:** Those four buildings are not build-menu cards, so the Power Pylon failure mode (card enabled, placement rejected) does not apply. Worker drone tiers stay on GP-93: the units menu still reads the row, because every tier shares the item id `worker`.
- **To resolve:** When a catalog can place Territory Beacon, Hydro, Hazard Shield or Lightning Rod, add that id to the stage that matches its row. Leave Trade Hub T1's row number to W10.
- **Found:** 2026-11-06, build-menu stage audit.

### GP-96 · DISMANTLE is offered before the stage table unlocks it

- **Status:** Open
- **Area / code:** `frontend/game/features/terraform-basic/TerraformMenu.ts` (`PRIMARY_OP_DEFS`), `shared/sim/src/data/stages.ts` (S2 orders include `dismantle`), `shared/sim/src/systems/progression/validate.ts`
- **What happens:** The Terraform dock shows DISMANTLE whenever W02 is on. It does not read the stage table. `enqueueTask` for `dismantle` is `stage_locked` until S2, the same reject the Power Pylon card used to hide.
- **Why it is like this:** This change wired the build catalog to `resolveItemUnlockStage`. The terraform dock is still wave-gated only. Level, fill, reclaim, irrigate and seed are not separate buttons; they run inside the TERRAFORM chain.
- **Workaround / mitigation:** The host rejects the order. The button stays clickable.
- **To resolve:** Grey DISMANTLE until `resolveItemUnlockStage('dismantle')` (S2), the same way build cards grey.
- **Found:** 2026-11-06, build-menu stage audit.

### GP-97 · A dune `work` job clears a fixed 5-wide disc, then the chain continues

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/systems/terraform-basic/duneFootprint.ts`, `groundWorkRule.ts` (`evaluateGroundWorkTile`), `workSystem.ts` (`completeGroundWork`), `frontend/game/features/terraform-basic/TargetHighlight3D.ts`
- **What happens:** Desert sand is `slope` on a height field, so one flattened hex does not remove a mound. A TERRAFORM `work` job on slope now takes five times the slope row (400 ticks, 20 s, 60 E; the time-table row itself stays 80 ticks / 12 E) and, on completion, sets every slope hex within hex distance 2 to flat, prepared, and one height: the lowest flat tile on the ring just outside the disc, or 0 when that ring is still dune. Rock, forest, water, holes, deposits and tiles under a building are left. The Level order is still one tile. The chain then walks outward, so one click keeps clearing the dune sea one disc at a time. The selection hex is dark blue, transparent, and depth-tested, so a unit or a dune crest in front of it covers it. Water usually writes no depth, so a lakebed hex can still show through the surface.
- **Why it is like this:** The owner asked for a slower job that removes a 5×5 of dune, with the client and the host sharing one rule. The 5× multiplier, the build-plane fallback, and leaving rock caps on the break path are defaults. Stopping the chain at the first disc would be a second chain rule (GP-94).
- **Workaround / mitigation:** `moveUnit`, `stopUnit` or another order for that worker ends the chain after the current disc. A rock cap inside the disc is a separate break.
- **To resolve:** Confirm the 5× time, whether a rock cap inside the disc should fall with the sand, and whether one click should stop after that disc instead of walking the erg.
- **Found:** 2026-11-06, dune terraform fix.

### GP-98 · Hex-tile deposit rule: checked when a deposit appears, not afterwards; scenario and dev exceptions

- **Status:** Open
- **Area / code:** `shared/sim/src/grid/subsurface.ts` (`revealSubsurface`, `revealAroundChanged`, `systems/terraform-basic/{work,workSystem,duneFootprint,resourceSpawn}.ts`, `systems/dev/spawnDeposit.ts`, `systems/goals/sites.ts`, `tests/scenarios/w05-shape-the-land.ts`)
- **What happens:** D-45 is enforced when a deposit appears (generation, reveal, terraform find). Nothing re-buries a visible deposit whose neighbour later becomes wild (ridge/moat op, building linked prep, runtime `clearPodBlastZone` / `ensureStarterHubSpace`), and those paths do not trigger a reveal on tiles they make hex; the buried deposit appears at the next terraform next to it. Defaults picked: buried oil under natural Flat also appears when a neighbour is terraformed, and the W01 prep ops reveal too. Exceptions: the `w05` scenario hand-places its 2×2 minerals quarry deposit on slope + crater at `(4, 0)` (W05 check step 3, linked prep on a deposit site), `dev.spawndeposit` and `ensureStarterMetalsDeposit` (test grids) write deposits anywhere. The renderer still levels the ground under a deposit on a slope (`computeEffectiveHeights` `hasDeposit`), so those keep their small shelf.
- **Why it is like this:** One rule at the points where a deposit becomes visible; the exceptions are fixtures and cheats the W05 check guide and e2e rely on.
- **Workaround / mitigation:** —
- **To resolve:** Owner: should the `w05` quarry site move to open ground (step 3 then demos linked prep on a non-deposit building)? Then drop the renderer's `hasDeposit` levelling and make `dev.spawndeposit` reject wild tiles.
- **Found:** 2026-11-06, hex-tile rule (D-45), lead + parallel agents

### GP-99 · Wild ground is worked from the walkable edge inward (E1–E3): open edges

- **Status:** Open
- **Area / code:** `shared/sim/src/systems/terraform-basic/chain.ts` (`chainStandRule`, `pickNextChainTile`), `workSystem.ts` (`approachJob`), `unreachable.ts` (`reportNoPath`), `workJobs.ts` (`workReach`), `work.ts` (`reachOf`)
- **What happens:** A clicked dune / tree with no tile the worker may stand on within its reach no longer ends the order with `no_path` (the W02 rule, `chain.ts` old `seq === 0` line): the chain works the nearest obstacle that has a stand and moves inward (E1–E3 in `chain.ts`). This also applies to forests (a tree deep inside a forest is now cleared from the forest edge). Open edges: (a) if the clicked tile never gets a stand (island beyond deep water) but the chain finds other work, the HQ clears the nearest workable tile and the player gets no `no_path`; (b) the stand check is local (a non-blocked tile within reach), not a path test: walled-in pockets are still caught by the skip-on-path-fail, one failed search each; (c) HQ reach is defined twice: `workReach` (hard-coded 2, `workJobs.ts`) and `terraformReachTiles` (data, `mobility.ts`); E1 uses `workReach` because the goal band does; (d) the W01 `terraformTasks` path (`work.ts`, `reachOf`) has no E1–E3: linked prep or auto-terraform on wild dunes would hit the old wall.
- **Why it is like this:** Owner 2026-11-06: a hill beyond the one non-hex row next to the grid was "impossible to terraform" (the HQ's `ground` profile cannot stand on slope or uneven Flat, its goal band is 1–2 hexes from the clicked disc centre).
- **Workaround / mitigation:** —
- **To resolve:** Decide (a) (report `no_path` for the clicked tile while the chain goes on?); read reach from data once; give the W01 path the same chain.
- **Found:** 2026-11-06, W05 owner pass (terraform agent)

### GP-100 · R4 plane joining: seams where two natural planes meet; old pads keep their steps

- **Status:** Open
- **Area / code:** `shared/sim/src/grid/hexTile.ts` (`joinPlaneHeight`), `systems/terraform-basic/duneFootprint.ts` (`dunePadHeight`, `flattenDuneFootprint`), `work.ts` (`levelToAdjacentFlat`)
- **What happens:** A dune disc takes the plane of the nearest hex tiles (≤ 12 rings), else the open ground beside it, else 0, and levels all open ground inside it. Flattening outward from the landing pad leaves no gap in the grid; flattening in a random order leaves ~2–7 % of worked open ground off the grid, where two natural level areas 0.06–0.3 m apart meet (a real step under R2). Ground flattened before this change keeps its old steps (no migration).
- **Why it is like this:** One plane rule; merging two existing planes would move ground the player did not work.
- **Workaround / mitigation:** Work dunes outward from the grid; a new disc over a seam re-levels the open ground inside it.
- **To resolve:** Owner: should a disc that touches two planes pull the smaller one onto the larger (beyond the disc)?
- **Found:** 2026-11-06, W05 owner pass (lead)

### GP-101 · Irrigate and Seed have no player path since the one TERRAFORM button

- **Status:** Question for the owner
- **Area / code:** `frontend/game/features/terraform-basic/planner.ts` (TERRAFORM sends `work` + `intent: 'terraform'`), `shared/sim/src/systems/terraform-basic/groundWorkRule.ts` (`finishedLevelFlat`), `chain.ts` (`isChainObstacle`), `workSystem.ts` (`completeGroundWork`)
- **What happens:** The TERRAFORM button sends one `work` order; on Prepared, Irrigated or Living ground the host answers `already_terraformed`. The work chain stops at level Flat + Prepared and `WorkJobRecord` has no growth-ladder op, so Irrigate and Seed (W05-07) run only through a raw `enqueueTask { terraform: { op: 'irrigate' | 'seed' } }`. `tests/e2e/w05.spec.ts` step 5 sends those commands directly. Living land, Terraform % growth and the D-34 tier gate cannot be reached by a player in the UI.
- **Why it is like this:** The uncommitted owner pass removed the client growth ladder ("the button does not climb into Irrigate or Seed"); docs elsewhere still say Irrigate/Seed run inside the TERRAFORM chain.
- **Workaround / mitigation:** Dev console / scenarios (`w05-tiers`) seed Living ground.
- **To resolve:** Owner: (a) restore the ladder on the button (host-side: a growth job mode after Prepared, priced from the `irrigate`/`seed` rows), or (b) add a separate GROW button that sends the explicit ops. Recommendation: (b), because a mis-click on Prepared ground no longer costs water.
- **Found:** 2026-11-07, W05 full review (lead + audit agent)

### GP-102 · TERRAFORM dock work is priced from a second time table

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/systems/terraform-basic/groundWorkRule.ts` (`timedGroundWork`), `TERRAFORM_TIME_TABLE`, op rows in `shared/sim/src/data/ops-basic.ts`
- **What happens:** Dock work on slope / hole / forest / rock uses `TERRAFORM_TIME_TABLE` (slope 4 s, 12 E, no resource cost; a dune disc ×5); water uses its `reclaim` / `deepReclaim` rows. The W05-03/04 acceptance numbers (Level 8 s / 60 E / 2 Min, Fill 10 s / 100 E / 10 M + 5 Min) hold only for an explicit `op: 'level' | 'fill'` order and for linked prep.
- **Why it is like this:** The dock was built on W02's time table before the W05 rows existed.
- **To resolve:** Owner: price dock slope/hole/forest/rock from the `level`/`fill`/`clear`/`break` rows (one source), or keep the cheaper dock and amend W05-03/04.
- **Found:** 2026-11-07, W05 full review (terraform agent)

### GP-103 · deepReclaim data row does not match W05-06

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/data/ops-basic.ts` (`deepReclaim`), `shared/sim/test/data/w05-data.spec.ts:70`
- **What happens:** The row says 20 s / 350 E / 35 M + 20 Min and Deep → **Flat**; the wave task and `UO-TF` say 28 s / 400 E / 40 M + 20 Min and Deep → **Shallow**. It came in with the W05-01 data commit (317de2f) with no rationale.
- **Why it is like this:** Not recorded. Deep → Flat lets the one TERRAFORM click finish a deep hex in one job.
- **To resolve:** Owner picks. Deep → Shallow works as is for linked prep (`planPrepJobs` follows `toTerrain`), but the dock needs a terrain-aware `completeGroundWork` and a `chainGiveUp` exception in `continueWorkChain`.
- **Found:** 2026-11-07, W05 full review (terraform agent)

### GP-104 · The dock refuses level ground left at prep `flat`

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/systems/terraform-basic/groundWorkRule.ts` (`finishedLevelFlat`)
- **What happens:** `finishedLevelFlat` counts `PREP.flat` as finished, so level ground that an explicit Clear/Break left at prep `flat` (not Prepared) gets `already_terraformed` from the dock and is never graded by it; the same tile at prep `wild` is graded.
- **Why it is like this:** Deliberate in the owner's specs (`w05-terraform-menu.spec.ts` "level flat (flat, prepared, irrigated, living) queues nothing", `terraform-parity.spec.ts`), but linked site prep counts the same tile as needing `Grade`, and the check guide says "plain ground → grade". The `w05` scenario's quarry hex `(5, 1)` is prep `flat`: the prep bill grades it, the dock says `Already terraformed`. `tests/e2e/w05.spec.ts` @hack 14 now works the crater `(4, 1)` instead.
- **To resolve:** Owner: one rule for "done" ground. Recommendation: treat prep `flat` like `wild` in `evaluateGroundWorkTile` (grade it) and update the two specs.
- **Found:** 2026-11-07, W05 full review (terraform agent; lead e2e)

### GP-105 · Living move bonus is read from two data rows

- **Status:** Open
- **Area / code:** `shared/sim/src/grid/tileModel.ts` (`lookupLivingMoveBp`)
- **What happens:** The +10 % Living move bonus reads both `terrain.temperate.livingMoveMult` and `terraformConfig.livingMoveSpeedBonus`; tuning one row may not change the speed.
- **To resolve:** Keep one row (recommend `terraformConfig.livingMoveSpeedBonus`) and derive the other.
- **Found:** 2026-11-07, W05 full review (terraform agent)

### GP-106 · Saved planets from before the Worker unification are not migrated

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/codec/`, `kernel/constants` (`SIM_VERSION`), `ENTITY_KIND`, colony `workers`, path profile `worker`
- **What happens:** Entity kinds 50/51 (Builder, Terraformer) were removed, `col.harvesters`/`builders` became `col.workers`, path profile `harvester` became `worker` and `buildUnit.unit` is `worker` + `tier`. `SIM_VERSION` was not bumped and no migration exists: a saved planet from before restores with orphan kind-50/51 rows and stale lists.
- **Why it is like this:** Dev planets are recreated anyway (`GEN_VERSION` 10), and no production saves exist yet.
- **To resolve:** Before any real save matters: `SIM_VERSION = 3` with a 2→3 migration (kind 50 → worker tier 2, 51 → worker tier 3, `harvesters` → `workers`, path profile and queued `buildUnit` renames).
- **Found:** 2026-11-07, W05 full review (sim-units agent)

### GP-107 · Bio tiers (W05-35) are not built

- **Status:** Open
- **Area / code:** `shared/sim/src/systems/production/tierGate.ts`, `systems/harvest/`
- **What happens:** A Worker Drone on Living ground in a colony with T3 open credits no `bio.t3` (gene-stock). Not in the H slice.
- **To resolve:** W05-35 after the hackathon.
- **Found:** 2026-11-07, W05 full review (sim-units agent)

### GP-108 · The colony AI switch is wave-gated to W08

- **Status:** Question for the owner
- **Area / code:** `shared/contracts` (`setAiEnabled`, `wave: 'W08'`), `shared/sim/src/systems/goals/ai.ts`
- **What happens:** `setAiEnabled` (contract, handler) is `wave: 'W08'`, like the goals system and the client HQ goals panel that holds the toggle, so it is consistent: the toggle shows and works only with W08 on (the default dev stack), not in `?scenario=w05` (`..05`, where the W08 colony AI does not run anyway). It shipped in this W05 branch (commit d8c5fe1).
- **To resolve:** Owner: confirm W08 is intended (recommended), or move the flag to W05.
- **Found:** 2026-11-07, W05 full review (sim-units agent)

### GP-109 · The TERRAFORM chain works on into neighbouring deep water

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/systems/terraform-basic/workSystem.ts` (`continueWorkChain`), `chain.ts`
- **What happens:** After the 6 shallow lake hexes of `?scenario=w05` are reclaimed, the chain continues into the adjacent deep hex `(-4, 2)` once a T2+ worker exists, spending the `deepReclaim` cost the player never clicked. Now that dock completions update Terraform % (this review), the reclaimed deep hex joins the denominator (`412 → 413`); `tests/e2e/w05.spec.ts` step 5 accepts either value.
- **To resolve:** Owner: should the chain stop at deep water (only a direct click reclaims it), like it stops at Prepared ground?
- **Found:** 2026-11-07, W05 full review (lead, e2e)

### GP-110 · An idle Worker Drone leaves a player move destination at once to harvest

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/systems/harvest/index.ts` (`standingHarvestAssignSystem`: `st === idle && !cur.playerAssigned` → retarget), `systems/units/handlers.ts` (`moveUnit`)
- **What happens:** After the Worker unification every Worker Drone (T1–T3) auto-harvests when idle, the old Harvester rule. A worker the player moves to an empty tile arrives and, the next tick, walks off to the nearest deposit; before, Builder/Terraformer drones stayed where they were sent. `tests/e2e/w05.spec.ts` step 5 now watches every view for the arrival instead of polling the position.
- **To resolve:** Owner: should a player `move` hold the worker at its destination (e.g. set the unit's `holdUntil`, or a "parked" flag cleared by the next order)? Recommendation: hold until the next order, like an RTS.
- **Found:** 2026-11-07, W05 full review (lead, e2e)

### GP-111 · Irrigate and Seed uncover buried deposits on the meadow

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/systems/terraform-basic/work.ts` (`emitRevealed` → `revealAroundChanged`, `grid/subsurface.ts`)
- **What happens:** Every completed terraform op, including Irrigate and Seed, reveals buried deposits on the tile and its neighbours (D-45). In `?scenario=w05` seeding the 10 meadow hexes turns 7 of them into metals deposits (`(0..2, 3)`, `(-1..2, 4)`), so workers can no longer be moved onto them (`site_blocked`) and the Living land is lost to deposits. `tests/e2e/w05.spec.ts` step 5 now picks a Living hex without a deposit.
- **To resolve:** Owner: should growth ops (Irrigate/Seed) reveal? Recommendation: reveal only on ops that change terrain or level (clear/break/level/fill/reclaim/grade).
- **Found:** 2026-11-07, W05 full review (lead, e2e)

### GP-112 · Wave 5 weather hazards are triggered exclusively via console commands and F8 Weather Lab (no background scheduler)

- **Status:** Deliberate trade-off (owner request 2026-11-07)
- **Area / code:** `shared/sim/src/systems/weather/`, `frontend/game/features/weather/`, `frontend/render/weather/`, `frontend/render/ui/visualLabWeatherWidget.ts`
- **What happens:** Per owner direction, Wave 5 weather effects (`meteor`, `twister`, `lightning`, `storm`, `rain`) run without a background random scheduler or hazard orchestrator. They are triggered on demand via dev console commands (`meteor [q r]`, `twister [q r] [dirDeg]`, `lightning [q r] [+ rain]`, `storm [on|off]`, `rain [none|minor|heavy|0..1]`) or via the `F8` Visual Shader Lab → `WEATHER` tab. `weatherSystem` (`slot: 5`, `wave: 'W05'`) only steps active console-spawned twisters and expires lightning electrical overload timers (`overloadUntilByEntity`).
- **Why it is like this:** Simplified by explicit owner request so weather hazards are deterministic, inspectable on demand, and never interrupt gameplay unprompted.
- **Found:** 2026-11-07, W05 weather implementation

## W13 Regional Markets

### GP-113 · Legacy leaked open-order refs are healed lazily, not migrated

- **Status:** Resolved for new orders (SIM-LEAK fix); Open for already-persisted colonies (trade-off)
- **Area / code:** `shared/sim/src/systems/trade/market-lifecycle.ts` (`endOrder`, `applyFill`, `healLeakedSlots`), `module-commands.ts`
- **What happens:** Before the fix a filled USDC-paid buy kept its `market.openOrders[ref]` forever (no reservation, so no `market.release`), and 20 of them blocked `market.placeOrder` with `order_limit`. Now every release reason ends the slot and a fill ends it once `filled >= amount`. Colonies persisted earlier still hold leaked refs: orders written by `market.reserve` now carry `filled`, legacy ones do not. When the limit is reached, `healLeakedSlots` drops the oldest refs with no reservation and no `filled` counter until a slot is free.
- **Why it is like this:** The sim mirror cannot tell a leaked ref from a genuinely open legacy USDC buy (both have an empty reservation); the DB is authoritative and the backend does not push a prune.
- **Workaround / mitigation:** A genuinely open legacy USDC order loses only its HUD mirror entry (a player cancel of it may answer `unknown_order` until the next reserve). New orders are unaffected.
- **To resolve:** Optional: a backend one-shot that re-sends `market.reserve` for open DB orders after deploy, or drop the heal once no pre-fix colony remains.
- **Found:** 2026-11-08, real-sim integration agent (SIM-LEAK).

### GP-114 · Away policy pipeline gate uses a static baseline view until economy spend sites wire session spend

- **Status:** Partially Resolved (pipeline gate wired in W09-12; dynamic view tracked in GP-115)
- **Area / code:** `shared/sim/src/systems/away/gate.ts`, `shared/sim/src/systems/away/policy.ts`, `shared/sim/src/systems/director/overlay.ts` (`awayGuardPoints`)
- **What happens:** `awayPolicy` allows AW-01..07, a player command, an opted-in raid, and a defensive shot. Everything else an away actor tries is `reject` with `away_policy` and a rule id. A priority step is the landed director guard, 10 points (`awayGuardBp` 1000). `gateAwayCommand` in the command pipeline calls that function for `ai`, `bot`, `near` and `system` commands once the colony session is open or the presence blob says away. `player`, `dev`, `admin` and `system.*` pass.
- **Why it is like this:** W09-09 and W09-10 land the pure function and its table tests; W09-12 wires the rejection counter and pipeline gate (`gateAwayCommand`). The slider step is already 10 in `setPriorities` and in the W16 overlay.
- **Workaround / mitigation:** Open the away session (or set the presence blob via `system.presence`) before expecting rejects. `away_policy_rejections_total` increments on the main thread when a reject arrives; the label `actor` is `auto` because the reject message carries the rule in `detail`, not the source.
- **To resolve:** Economy spend sites (`GP-115`) can populate dynamic baseline/loss lists and session spend when invoking `awayPolicy`. Leave the 10-point step unless the owner wants a 1-point band.
- **Found:** 2026-11-09, W09-09, updated W09-10, W09-12

### GP-115 · Away session spend is a function the economy spend sites do not call yet

- **Status:** Open
- **Area / code:** `shared/sim/src/systems/away/session.ts` (`chargeAwaySpend`, `openAwaySession`)
- **What happens:** Automated spend stops at the session percent, defense and repair do not, and `awayBudgetExhausted` fires once per family. Nothing in construction, production, or the command pipeline calls `chargeAwaySpend` yet, so a live automated build does not move the counter.
- **Why it is like this:** Those spend sites belong to earlier waves. W09-11 adds the one accounting function instead of editing each of them. W09-12's pipeline gate is the place that should call it for an automated command that carries a cost.
- **Workaround / mitigation:** `awayPolicy` already rejects an extractor whose view says session spend is at the cap. The view's `stock.spent` has to be filled from `chargeAwaySpend` by the caller.
- **To resolve:** W09-12 (or the economy spend path) calls `openAwaySession` when `system.presence` goes away and `chargeAwaySpend` before an automated debit.
- **Found:** 2026-11-09, W09-11
