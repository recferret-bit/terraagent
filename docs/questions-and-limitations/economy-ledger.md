# Economy and ledger: questions and limitations

Colony resources (D-34): the sim treasury (`shared/sim/src/economy/`), the double-entry library (`shared/ledger/`),
the host journal `PlanetJournal` (`shared/sim/src/host/journal.ts`), the server journal
(`backend/app/src/game/ledger/`, table `world.ledger_entry`), the browser host journal
(`frontend/game/store/local/`), and seating/landing (`backend/app/src/core/home/`,
`shared/sim/src/systems/landing/`). Spec: [`SIMULATION.md`](../spec/SIMULATION.md) SIM-S-03. Format: [README](./README.md).

## Server journal

### LED-01 · Unwritten journal rows accumulate in memory during a database outage

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/game/ledger/planet-ledger.service.ts` (`persist`, retry loop)
- **What happens:** when Postgres is unreachable, every planet's queued journal rows stay in server memory and the
  write is retried with backoff (100 ms doubling up to `RETRY_MAX_MS` = 30 s) until it succeeds. A long outage grows
  memory by every posting of every loaded planet.
- **Why it is like this:** the owner's rule is that journal rows are never dropped.
- **Workaround / mitigation:** failures are logged at error level with the row count; recovery is logged.
- **To resolve:** spill queued rows to local disk past a size limit, or pause the planet's simulation while its
  journal cannot be written.
- **Found:** 2026-11-01, ledger session (server agent report)

### LED-02 · A restore that fails for a non-outage reason retries forever and holds that planet's writes

- **Status:** Accepted (by design)
- **Area / code:** `planet-ledger.service.ts` (restore job)
- **What happens:** the restore (`deleteAfter` + `balancesThrough`) is retried every ≤ 30 s, and no row of that
  planet is written until it succeeds. If it can never succeed (e.g. a corrupt `legs` value makes the SQL sum fail),
  the planet's journal writes wait until shutdown, and the dev `ledger` route answers 503 `LEDGER_UNAVAILABLE`.
- **Why it is like this:** writing before stale rows of a lost timeline are deleted would let those stale rows win
  (`skipDuplicates`), which silently corrupts the journal.
- **Workaround / mitigation:** each failed attempt is logged with the error.
- **To resolve:** classify errors (transient vs permanent) and on a permanent one quarantine the bad rows or stop
  the planet with an alert.
- **Found:** 2026-11-01, review fix (H2)

### LED-03 · Restore sums every journal row up to the save point

- **Status:** Accepted
- **Area / code:** `backend/app/src/game/ledger/prisma-ledger-store.ts` (`balancesThrough`)
- **What happens:** each planet load runs one SQL aggregate over all of that planet's rows with `tick ≤ T`. The
  work in Postgres grows with the planet's age (no rows travel to Node).
- **Why it is like this:** the owner chose SQL sums over row-by-row replay; it is fast enough for current planets.
- **To resolve:** store a balance checkpoint `(planetId, tick, balances, count)` with each snapshot and sum only the
  rows after it.
- **Found:** 2026-11-01, owner decision

### LED-04 · Refused postings are still stored as rows

- **Status:** Accepted
- **Area / code:** `planet-ledger.service.ts` (`record`), `PlanetJournal.record`
- **What happens:** a posting the in-memory journal refuses (sim/journal drift) is logged as drift but its row is
  still written, and it gets no in-memory `seq`. After a drift the dev route's in-memory numbering and the DB row
  numbers (`recent`) differ, and a later restore from SQL sums includes the refused row (the reconcile against
  `col.stock` then logs the mismatch).
- **Why it is like this:** the sim's `col.stock` is the truth; the DB keeps exactly what the sim produced so the
  drift can be investigated.
- **To resolve:** a `refused` column on `ledger_entry`, excluded from sums and numbering.
- **Found:** 2026-11-01, server agent report

### LED-05 · Shutdown snapshots are skipped for planets with unwritten rows

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/game/persistence/snapshot.service.ts` (`write`), `planet-ledger.service.ts`
  (`SHUTDOWN_WAIT_MS` = 10 s)
- **What happens:** if the journal could not be written within 10 s at shutdown, no shutdown snapshot is saved for
  that planet; the next boot restores its previous snapshot and the progress since then is lost.
- **Why it is like this:** a snapshot ahead of its journal would restore stock the journal cannot explain.
- **Found:** 2026-11-01, review fix (L1)

### LED-06 · Planets whose snapshots are all corrupt, or written by a newer build, stay unloaded ("held")

- **Status:** Resolved (review-fix round 2026-11-01)
- **Area / code:** `snapshot.service.ts` (`restoreAll`, `restoreOne`, `loadNew`)
- **What happens:** such a planet is never regenerated or wiped automatically (that would delete its history); it
  stays unloaded, and seating a player there answers 409 `seat_rejected` / `host_unavailable`. Only dev planets
  (`pl_dev*`) from an older world generator or sim version are wiped and regenerated (`wipeDevPlanet`). Scenario and
  other planets with an unrestorable sim version are held the same way and logged on every boot.
- **Why it is like this:** a fresh load used to wipe the journal of a planet that still had snapshots (review H1).
- **Workaround / mitigation:** delete the planet's snapshot rows (or reset the worktree DB with `npm run db:reset`)
  to let it start fresh.
- **To resolve:** decide whether old non-dev planets should be wiped automatically on a sim-version bump, or get a
  dev route/console command to wipe one held planet. Recommendation: a dev-only `planet.wipe <id>` command.
- **Found:** 2026-11-01, review fix (H1, M5)
- **Fix:** recommendation applied: dev command `planet.wipe {planetId}` (`POST /v1/dev/commands/planet.wipe`, `backend/app/src/dev/planet-wipe.command.ts`) deletes a held (unloaded) planet with its snapshots, ledger rows and colony rows (`SnapshotStore.wipePlanet`, any id; boot still wipes only old dev planets) and drops the colony cache; 409 `PLANET_LOADED` for a loaded planet. Documented in `DEV_TOOLS.md`. Tests `backend/app/test/dev/dev.spec.ts` › "planet.wipe (LED-06)…", `test/game/seat-recovery.spec.ts` › "wipe deletes an unloaded planet…". A dev-console alias is a frontend-features item.

### LED-07 · In-memory journal store keeps at most 20 000 rows per planet

- **Status:** Accepted
- **Area / code:** `backend/app/src/game/ledger/in-memory-ledger-store.ts` (`IN_MEMORY_LEDGER_ROWS`)
- **What happens:** with persistence off (`NODE_ENV=test`, `SNAPSHOTS=off`) older rows are dropped; the dev route's
  older entries disappear. No restore happens without persistence, so balances are unaffected.
- **Found:** 2026-11-01, review fix

## Browser host journal

### LED-08 · The browser journal keeps the last 1024 entries; an unusable saved journal is reopened from stock

- **Status:** Accepted
- **Area / code:** `shared/sim/src/host/journal.ts` (`HOST_JOURNAL_LIMIT`), `frontend/game/store/local/hostJournal.ts`
- **What happens:** `?host=local` saves its journal in the IndexedDB snapshot; older entries fold into opening
  balances. If the saved journal is missing (an older save), malformed or does not reconcile with `col.stock`, each
  colony is reopened with one `ledger.opening` entry by `system:resume`, and `sys:*` totals count only from there.
- **Found:** 2026-11-01, ledger session

## Sim treasury

### LED-09 · A step that throws half-way leaves stock changed but its postings unpublished

- **Status:** Resolved (review-fix round 2026-11-01)
- **Area / code:** `shared/sim/src/kernel/step.ts`; hosts publish `StepResult.postings` only after a completed step
  (`backend/app/src/game/thread/planet-host.ts`, `frontend/game/store/local/LocalHostCore.ts`)
- **What happens:** an exception inside a system after a treasury change mutates `col.stock` but the step's postings
  never reach the journal; the next restore logs a reconcile mismatch.
- **To resolve:** publish postings from the step context as they are recorded, or roll the state back on a failed
  step. Note: the server host does **not** stop a planet whose step threw — it keeps stepping the half-changed state
  and that step's commands are never answered (see [BE-12](./backend-contracts.md)); fix both together.
- **Found:** 2026-11-01, independent review (L3); corrected 2026-11-01 by the backend review
- **Fix (server host, review-fix round 2026-11-01):** the server no longer keeps stepping a planet whose step threw: `PlanetHost.stepPlanet` rejects the step's commands `internal`, drops the planet and posts `planetFailed`; main treats it as down and restores its last snapshot (state and journal roll back together, so the lost postings do not matter there). The status stays with the sim side (SIM-GAMEPLAY: postings of a failed step on the browser host). See BE-12.
- **Fix (sim side):** `step()` wraps a system exception in `StepError` (`kernel/step.ts`) carrying the step's `outcomes`, `postings` and `events` so far; `SimHost.step` clears its queue (applied commands are never re-applied), hands the outcomes and postings to its `onOutcomes` / `onPostings` listeners and rethrows. A host that journals through `onPostings` therefore records what already changed `col.stock`. Host side (BACKEND, BE-12; FRONTEND-APP for `LocalHostCore`): hosts that read `StepResult.postings` instead of the listeners must catch `StepError` and journal `err.postings`, answer `err.outcomes`, then stop or reload the planet. Test `shared/sim/test/economy/failed-step.spec.ts`.
- **Fix (server host, final pass 2026-11-01):** `PlanetHost` journals and answers a `StepError` like `SimHost.step` (postings first, then the outcomes, `internal` for the rest, then `planetFailed`); see BE-12.

### LED-10 · `unrecorded` / `treasuryCtx` without a step ctx silently discard postings

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/economy/treasury.ts`
- **What happens:** a treasury call outside `step()` (tests, seeding with `setColonyStock`) changes `col.stock`
  without any journal entry. No production path does this today; a future one would create stock the journal cannot
  explain.
- **Workaround / mitigation:** rule in `shared/sim/README.md` (economy section); hosts reconcile on restore.
- **Found:** 2026-11-01, independent review (L4)

### LED-11 · Capped overflow is lost, and only terraform yields are capped

- **Status:** Resolved (review-fix round 2026-11-01)
- **Area / code:** `shared/sim/src/economy/caps.ts`, `systems/terraform-basic/work.ts`
- **What happens:** a terraform yield over the family cap is credited only up to the cap; the rest disappears (no
  posting, reported as `obstacleRemoved.data.overflow`). Landing cargo, construction refunds and dev grants are not
  capped (cargo is the pod's hold, refunds return what was paid, grant is a dev tool), so a colony can sit above
  its cap after a refund.
- **To resolve:** decide with W02-02 (`production.capped` stat): keep losing overflow, or post it to a `sys:overflow`
  account so the journal shows it. Recommendation: post it, it costs one leg and makes the loss auditable.
- **Found:** 2026-11-01, review fix (M2)
- **Fix:** recommendation applied: the capped part of a credit is posted in the same entry from the reason's counter account to `sys:overflow` (`OVERFLOW_ACCOUNT`, `economy/treasury.ts`), also when nothing fits (a posting with only the overflow legs, `col.stock` untouched); `obstacleRemoved.data.overflow` still reports it. Tests `treasury.spec.ts` › clampToCap (LED-11), `gameplay-guards.spec.ts` › "a Break at full metals …".

### LED-12 · Refused credits are only visible in server logs

- **Status:** Resolved (review-fix round 2026-11-01)
- **Area / code:** `shared/contracts/src/events/treasury-rejected.ts`, `shared/sim/src/economy/report.ts`
- **What happens:** a refused terraform yield or construction refund emits a `treasuryRejected` warn event with a
  server audience; players are not told.
- **To resolve:** decide whether players should see it (toast) or only operators. Recommendation: operators only;
  it can only happen with broken data, which is now rejected at compile/tune time.
- **Found:** 2026-11-01, review fix (M1)
- **Fix:** recommendation applied: refused credits stay operator-only (`treasuryRejected`, server audience); they can only come from broken data, which compile / tune now reject. No player toast.

### LED-13 · Orders saved before integer validation can stay `blocked(...)`

- **Status:** Accepted
- **Area / code:** `shared/sim/src/systems/construction/build.ts`
- **What happens:** a construction order whose stored cost has a fraction (only possible in saves made before the
  whole-unit validation) shows `blocked(invalid_amount…)` and never completes; nothing repairs it.
- **Workaround / mitigation:** SIM_VERSION 2 and the DB reset wiped such saves; cancel the order to recover.
- **Found:** 2026-11-01, review fix
- **Note (review-fix round 2026-11-01):** such an order now goes `waiting_resources` with `waitingReason` `blocked(…)` and frees the builder (GP-12) instead of keeping the HQ retrying it every step; it still never completes (cancel to recover).

## Seating and landing

### LED-14 · Refused landing sites are remembered only until the server restarts

- **Status:** Resolved (review-fix round 2026-11-01)
- **Area / code:** `backend/app/src/core/home/home.service.ts` (refused sites, exhausted planets)
- **What happens:** after a restart the first seats may retry sites the sim already refused (the sim's landing
  history refuses them again, so no harm, just extra round-trips). Worst case per `/me/home` request:
  `SEAT_PLANETS` (2) × `SEAT_ATTEMPTS` (8) sites, each a row insert, a sim round-trip and a rollback.
- **To resolve:** let the server ask the sim for the next landing site (`nextLandingSite` on the live state) instead
  of guessing from DB rows.
- **Found:** 2026-11-01, review fix (M3)
- **Fix:** recommendation applied: the server asks the planet's sim for the next landing site (`landingSite` thread request → `nextLandingSite` on the live state) instead of guessing from DB rows; nothing is remembered per process, so a restart retries nothing. A planet whose sim answers `landing_site_taken` is marked full; a colony index the sim already landed (`already_landed`) is skipped. Files: `backend/app/src/core/home/home.service.ts`, `backend/app/src/game/home-landing-host.ts`, `backend/app/src/game/thread/{protocol,planet-host}.ts`; tests `test/unit/home-seat-reject.spec.ts` › "HomeService seats where the planet's sim says (LED-14)", `test/game/seat-recovery.spec.ts` › "PlanetHost answers landingSite from the live sim (LED-14)".

### LED-15 · A landing acked after the 15 s seat timeout leaves a sim colony without a DB row

- **Status:** Resolved (review-fix round 2026-11-01)
- **Area / code:** `backend/app/src/game/seat-colony.ts` (`SEAT_LANDING_TIMEOUT_MS`), `game.module.ts`
- **What happens:** the seat is rolled back as `host_unavailable`, but if the sim applies the landing afterwards the
  colony exists in the sim with no player row; it is only logged as an error. That colony index is then reported
  `already_landed` to the next seat on that planet.
- **To resolve:** on a late ack, remove the colony in the sim (an admin `colony.remove` command) or re-create the row.
- **Found:** 2026-11-01, review fix (M4)
- **Fix:** a late ack goes to `HomeService.adoptLateLanding`: when the player still has no colony the rolled-back row is written again (same id, index and site), so the next `/me/home` answers that colony; otherwise its colony index is marked landed and never offered again (later seats also skip an index the sim reports `already_landed`). Files: `backend/app/src/game/seat-colony.ts` (`gameSeatHost`), `core/home/home.service.ts`; test `test/unit/home-seat-reject.spec.ts` › "HomeService.adoptLateLanding (LED-15)".

### LED-16 · W02 `economy/ledger.ts` mutates `colony.stock` directly with fractional tick increments without emitting `@terra/ledger` postings

- **Status:** Resolved (W13-41, `ae25ebd`; rounding rules in LED-23)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/economy/ledger.ts` (`creditResource`, `debitCost`, `refundCost`), `shared/sim/src/systems/production/index.ts`, `shared/sim/src/systems/harvest/`, `shared/sim/src/systems/terraform-basic/{dismantleAndWork,workJobs}.ts` (W02 `work` / `dismantle` jobs), `tests/scenarios/_loader.ts`
- **Also (terraform rework, 2026-11-02):** the player's terraform yields now take this path too. The Terraform dock only sends `op: 'work'` (and `dismantle`), whose jobs credit Trees `+15 Biomass` / Rock `+8 Metals, +4 Minerals` with `creditResource` (`stepGroundWorkJob`), pay repairs with `payProgressiveSlice` and refund dismantles / cancelled jobs with `refundCost`; the W01 `grade` / `clear` / `break` path posted its yield through the treasury as `terraform.yield` (`terraform-basic/work.ts`). So terraform yields and the stock a t2/t3 deposit found by terraforming later pays out are no longer journaled.
- **Why the work path was not moved to the treasury (terraform rework review, 2026-11-02):** W02 harvest and extractor production credit fractional stock every tick through `creditResource` (a Harvester adds `0.1` per tick: `unitsWorkersBasic.harvester.harvestRatePerS` 2.0 × `ECONOMY_RATE_SCALE` 0.25 = 0.5/s at 5 Hz; corrected in the W02 review, the entry said `0.025`), so `col.stock` becomes non-integer. Once a key is fractional, `ColonyTreasury.add` rejects every credit on it (`treasury.ts:125` checks `isMajor(stock[key] + v)` → `invalid_amount` / balance overflow). That would silently drop `terraform.yield` (W01 order path), `construction.refund` and dev grants with a `treasuryRejected` warning in any game where a Harvester or Extractor has run. `clampToCaps` also subtracts fractional stock from the family room, so the credited fit and the overflow can be fractional, which `transferLegs` cannot post. And there are two cap models: the treasury uses `getColonyCaps(state)` (`initialCaps` / `col.caps`), `economy/ledger.ts` `creditResource` the W02 `colony.caps` with its own room rule. So work-job yields, repair costs and dismantle / cancel refunds stay on the W02 helpers, unjournaled, until production posts whole units (an accumulator) or the ledger uses fixed-point units.
- **What happens:** W01's `ColonyTreasury` (`shared/sim/src/economy/treasury.ts`) records whole-unit double-entry postings (`StepResult.postings` → `PlanetJournal`), whereas W02's `economy/ledger.ts` mutates `colony.stock` directly (including fractional per-tick Extractor production such as `0.2 metals.t1`/tick and `37.5` demolish refunds). Scenario setup (`tests/scenarios/_loader.ts`) seeds `PlanetJournal.openingPostings` when a scenario pre-populates `colony.stock` without postings, but runtime W02 `creditResource`/`debitCost`/`refundCost` calls do not emit `LedgerPosting`s, so `PlanetJournal` balances will diverge from `colony.stock` once W02 extractors, harvesters, or queues run.
- **Why it is like this:** `@terra/ledger` enforces whole-unit integer leg amounts (`Number.isSafeInteger`), while W02 extractor output (`1.0/s` = `0.2/tick`) and 50 % refunds operate on fractional floats in `colony.stock`.
- **Workaround / mitigation:** `MinimalHud.wholeStock` floors stock for display; scenario loader bridges initial `colony.stock` into `setupPostings`.
- **Seen on the dev server (economy review, 2026-11-03):** every restart logs `ledger/state mismatch on restore of <planet>: the journal does not explain col.stock` for any planet where a Harvester or Extractor ran. Example `pl_01M6EG80PWJJA4Y2N5RHFET9ER` (w02 scenario, one Harvester): ledger `metals.t1 400 / minerals.t1 250 / bio.biomass 150` (the scenario's opening postings, 1 journal row) vs state `500 / 500 / 350`; the snapshot's `production.produced` (`540 / 515 / 355`) shows the gap is exactly the unposted Harvester credits, clamped at the 500 family cap. The same snapshot shows float dust from the fractional credits (`production.capped.metals 3.2e-11`, `produced['minerals.t1'] 515.0000000000043`). After such drift a later whole-unit treasury withdraw (W01 construction spend) can also be refused by the journal (`ledger drift … insufficient_funds`), because the journal never saw the credits. The log is expected until this entry is resolved; it is not a separate bug.
- **W02 production bypasses the treasury and the journal (W02 review round 1, 2026-11-03):** Extractor output (`production.extractors`, `extractTiered` → `creditResource`) and Harvester output (`production.harvest`) write `col.stock` and `production.produced` directly; no posting is made. The catalog reason `production.tick` (`shared/sim/src/economy/reasons.ts`, counter `sys:world`) exists, but nothing posts it, although `SIMULATION.md` SIM-S-03 says production credits through it with `clampToCap`. The W02-28 Stockpile batches therefore read `production.produced` (BE-28), not the journal. W02 cancel / demolish refunds are 50 % (`CANCEL_REFUND_RATE`, rows' `cancelRefundRatio` / `demolishRefundRatio`) and capped (LED-17).
- **To resolve:** either scale `@terra/ledger` units to fixed-point (e.g. basis points / milli-units) or accumulate fractional production in a sub-unit accumulator and route whole-unit credits/debits through `ColonyTreasury` (production as `production.tick` with `clampToCap`, as SIM-S-03 describes).
- **Found:** 2026-11-02, W01→W02 merge review; extended 2026-11-03, W02 review round 1 (backend agent / audit)


### LED-17 · W02 refunds are clamped at the storage cap; W01 refunds are not

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/economy/ledger.ts` (`refundCost` → `creditResource`), `shared/sim/src/systems/queue/cancel.ts` (`refundEntrySpent`, `CANCEL_IN_PROGRESS_REFUND_RATIO`), `shared/sim/src/systems/economy/construction.ts` (`cancelBuildingConstruction`, demolish), `shared/sim/src/systems/terraform-basic/dismantleAndWork.ts` (dismantle refund); W01 `shared/sim/src/systems/construction/build.ts` (`refundCancelledConstruction`, "Uncapped")
- **What happens:** a W02 refund (cancelled queue entry or building job, demolish, dismantle) goes through `creditResource`, which credits only what fits under the family cap and counts the rest in `production.capped`. A W01 Hub cancel refund goes through the treasury uncapped ("a refund returns part of what the colony paid, which already fitted"; LED-11). So cancelling a W02 build while that family's storage is full returns nothing of the paid share (owner check: cancel at full storage, then look at the stock).
- **Why it is like this:** W02 refunds reuse the W02 credit helper, which always clamps (LED-16).
- **To resolve (owner):** should W02 refunds ignore the cap like W01 ones (a `creditResource` option that skips the clamp), or should both clamp? Recommendation: uncapped, as the paid amount already fitted.
- **Found:** 2026-11-03, W02 review round 2 (sim agent)


### LED-18 · W13 economy implementation and empirical calibration remain outstanding

- **Status:** Open
- **Area / code:** [ECONOMY](../spec/ECONOMY.md), [W13](../plan/waves/W13-markets.md), W15/W23, LED-16.
- **What happens:** The owner accepted the resource-demand, quote-fee, funded-bot and database/experiment design on 2026-11-04. This change updates plans/specs; migrations, profile tools, recurring project/transport mechanics and experiment commands are not implemented by this documentation task. No measured demand evidence yet establishes durable prices or public cash readiness.
- **Why it is like this:** W13-36–49 define the implementation and mock evidence; W15 adds actual bot-policy runs; W23 requires a bounded player pilot before public cash activation. Fee defaults (1% platform, 0–1% stall) are accepted starting settings; consumption coefficients, risk budgets and economic gate thresholds need calibration. Regional 20–30% delivered-cost advantage is a hypothesis.
- **Workaround / mitigation:** Keep real cash disabled absent evidence. Use actual shared rules, immutable profile hashes, paired/held-out seeds and versioned assumptions; flag incomplete/insufficient data. Reconcile LED-16 before cash. No mock result or assumption is a promise of income.
- **To resolve:** Implement the assigned issues, verify database lifecycle and exact accounting, run all baseline/stress cases and a real-player pilot against predeclared thresholds, and record the approved activation/evidence. New scope requires calendar reforecasting; historical hackathon dates are not reconfirmed.
- **Accepted trade-off (D-44):** Unrestricted external cargo transfers/imports can bypass platform fees and reduce geographic spreads. Guild transport is nonexclusive. Do not add hidden transfer taxes; model external fee leakage and import demand explicitly. No anti-bot identity checks are introduced.
- **Found:** 2026-11-04, W13 grooming; revised after owner requested adoption, database management and AI simulation support.


### LED-19 · Regional scarcity and logistics coefficients need integrated calibration

- **Status:** Open
- **Area / code:** [ECONOMY](../spec/ECONOMY.md) sections 2.1–2.3 and 9; W11-46, W13-50–57, W15, W27.
- **What happens:** The owner requested planet/sector main-resource settings and higher operating supply/logistics costs for large bases/armies. The plan now defines regional inheritance, unified production-source policy, congestion/distance costs and readiness/shortage rules. This documentation does not implement them or change existing world reserves. The example abundance weights, alpha 0.25, 2.5 cap, readiness factors and 50% minimum combat service are uncalibrated starting fixtures.
- **Why it is like this:** Per-tier scarcity must survive extractors, terraform finds and starter guarantees. Costs must encourage trade/logistics investment while preserving small-colony viability and reasonable combat. Persistent world endowments cannot be replaced by simply editing a live profile.
- **Workaround / mitigation:** Pin existing endowment hashes; preview new generation in isolated fixtures, use audited runtime changes only for future production/service windows. Measure specialists and base/army curves with the shared engine before activation. Label all proposed coefficients and forecast uncertainty in reports.
- **To resolve:** Implement the assigned tasks, choose measured regional supply and cost/shortage targets, test every production path plus power/depot loss, away operation, reserve cycling and cross-sector/streaming replay. Explicit migration of occupied-world endowments remains outside this task and requires its own value-preserving plan.
- **Accepted trade-off:** Logistics capacity is colony-owned; multiple genuinely separate colonies may reduce congestion and trade with one another. No human-identity aggregation or new anti-bot programme is implied. Model the cost of separate bases and transport and report the residual avoidance; do not claim a guaranteed empire-size tax. The combat service floor permits reduced operations after shortage and must be evaluated for resource-free combat incentives.
- **Found:** 2026-11-04, owner-requested regional trade and logistics grooming.


### LED-20 · W13 contract defaults: total-quote prices, whole-unit resource atoms, sim-first market commands

- **Status:** Accepted (by design); proposed defaults, owner may change
- **Area / code:** `shared/contracts/src/market/` (`MarketPrice`, `MARKET_TOKENS`), `shared/contracts/src/commands/market-*.ts`, `backend/app/src/core/command-prechecks.ts`, `shared/sim/src/data/market.ts`.
- **What happens:** (1) `market.placeOrder.price` is the **total** quote amount for the order's full base `amount` ("300 water for 10 USDC" = `amount 300, price {USDC, "10000000"}`); the unit limit price is the exact rational `price.amount / amount`, compared by cross-multiplication. (2) Market atomic units are USDC micro (6), NEAR yocto (24) and **whole units** for resources (base lot 1, barter quotes and fees floor to whole units: a 1 % fee on 7 units is 0); the mock verifier stores resources in NEP-245 chain base units (×10^18) and converts at the adapter boundary. (3) Every client market command goes to the planet sim first (Hub online, size, TTL, fee range); the sim emits `marketOrderRequested` / `marketCancelRequested` / `marketHubFeeSet` and the market module acts on them in Postgres, answering with `market.reserve` / `market.release` / `market.settled` (whole-unit resource deltas only: USDC/NEAR never enter the sim). Checks that need server state (verifier balances, open-order count) run as a synchronous `CommandPrechecks` precheck before the sim, and again under lock afterwards; a change between the two is reported by `marketOrderRejected`.
- **Why it is like this:** "300 water for 10 USDC" is not an integer per-unit tick (10 USDC / 300 = 0.0333…), and ECONOMY §3 requires exact rational prices. Whole-unit resources match sim stock and cargo import/export (W10). Sim-first keeps D-31 (every client command through the engine, `wave_disabled` for free) and the W10 event → module pattern; the precheck seam gives a synchronous reject without a second command path.
- **Workaround / mitigation:** Display rounding never changes ledger amounts. A sim-accepted order lost by an app crash before the module handles the event never reserves anything (the sim mirror only changes on `market.reserve`).
- **To resolve:** Owner may prefer per-unit tick prices or fractional resource atoms; both are contract changes in `shared/contracts/src/market/`. The legacy `tradeHub` rows' `marketFeeMinBp/MaxBp/DefaultBp` (50/300/100) predate D-44 and are superseded by `market.policy` (0–100 bp, default 100); W13-03 reconciles them.
- **Found:** 2026-11-04, W13-01 (wave lead).


### LED-21 · W13 market defaults taken by the implementation (sim mirror, matcher, fees, place order)

- **Status:** Accepted (by design); proposed defaults, owner may change
- **Area / code:** `shared/sim/src/systems/trade/` (`market-state.ts`, `place-order.ts`, `module-commands.ts`, `market-matcher.ts`, `market-fees.ts`, `market-batch.ts`), `backend/app/src/market/{book,orders,matching,settlement}/`.
- **What happens:**
  - Sim (W13-10): module commands arrive with a non-player source (`system`/`near`); a player sending one is `not_authorized`. Orders are counted against `order_limit` only once the server reserved them (`openOrders`); `requested` and `openOrders` are bounded (4 × limit, oldest evicted), `settledTrades` keeps the last 64 ids for replay dedupe. A repeated `market.reserve` for one ref replaces the reservation. A `stallId`/`hubId` the colony does not own is `invalid_args`.
  - Matching (W13-11): policies are compatible only with equal `platformFeeBp` and `policyVersion`; the maker's stall rate must be ≤ the buyer's `maxStallFeeBp` (no maximum tolerates 0 bp only). An all-or-nothing incoming order that cannot complete rests unfilled; a resting all-or-nothing maker is skipped unless taken in full; matching is greedy (no backtracking).
  - Fees (W13-12): notional rounds cumulatively per maker order, fees cumulatively per buyer order and `(quote, bp, beneficiary, policyVersion)` bucket. When the buyer is the maker, its own stall earns the stall fee, so the aggregated leg nets out while attribution still shows the charge. The W22 treasury allocation is a per-fill floor of the platform fee (not cumulative).
  - Place order (W13-09): an advisory lock on the colony account serializes a colony's orders; claimed accounts get all-or-nothing, custodial partial. Policy terms come from the compiled active profile.
- **Why it is like this:** Smallest rules that satisfy ECONOMY §3 exactly; each is a pure function with tests (`npm test -- market-matcher`).
- **To resolve:** owner review of AON resting semantics and whether a buyer without an explicit maximum should accept the policy's stall maximum.
- **Found:** 2026-11-05, W13 build (wave lead, from subagent reports).

### LED-22 · W13 economy profile defaults (registry bounds, revisions, boot fallback)

- **Status:** Accepted (by design) / Question for the owner (bounds)
- **Area / code:** `shared/sim/src/economy/params/`, `shared/contracts/src/economy/`, `shared/db/src/economy/`, `backend/app/src/economy/`, `shared/db/seeds/0002_economy_baseline.ts`.
- **What happens:** Parameter bounds are conservative design limits chosen by the implementer, not owner-approved values; per-resource policy defaults are uniform calibration hypotheses. `ProfilePatch.expectedVersion` is the draft's `revision` (CAS). Region and logistics sections were JSONB until W13-50. The baseline seed uses `bootstrap.*` source/consumer/cohort ids. `policyVersion` is a fixed one-value enum (a new market policy version needs a new registered value). Per-pair `ProfileContent.marketPolicies[]` overrides are not applied yet: pairs derive from the `market` table rows. `parseTunePath` (dev `tune`) cannot address dotted row ids such as `market.quote.USDC.tickAtomic`; the profile path parser can.
- **Why it is like this:** W13-36–38 deliver the mechanism; calibration is LED-18/19.
- **To resolve:** owner approves bounds and calibration ranges; extend `tune` paths if dev tuning of dotted rows is wanted.
- **Found:** 2026-11-05, W13-36/37/38/03.

### LED-23 · W13 whole-unit stock: rounding rules and residual accumulator (resolves LED-16)

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/economy/residual.ts`, `shared/sim/src/systems/economy/ledger.ts`, `shared/sim/src/kernel/ledgerSink.ts`, `shared/sim/src/codec/migrations/wholeStock.ts` (SIM_VERSION 2 → 3).
- **What happens:** each resource's exact value is `stock × 10^6 + residual` micro-units; amounts convert by round-half-away-from-zero; whole parts post through `ColonyTreasury` (journal now explains `col.stock`), fractions stay in `col.residual`. A 50 % refund of 75 is 37 whole + 0.5 residual. Old snapshots migrate value-preservingly (12.75 → 12 + 0.75). Value including the residual can sit < 1 unit above the cap (whole stock never exceeds it); `production.produced/capped` count whole units; sub-micro remainders of per-tick rates round away; `col.residual` is synced to clients (harmless). `settleCargoImport` and `handleImportSettled` still duplicate settle logic. Dev `fill`/`drainfuel` now post as `dev.grant`.
- **To resolve:** dedupe the two import-settle paths in a later cargo cleanup.
- **Found:** 2026-11-05, W13-41.

### LED-24 · W13 mock Intents and cargo-import specifics

- **Status:** Accepted (by design); W23 verifies against the real verifier
- **Area / code:** `backend/app/src/near/intents/nep413-token-diff.ts`, `near/infrastructure/adapters/mock/intents*`, `near/cargo/{cargo-import-outbox,free-verifier.service}.ts`, `application/outbox/`.
- **What happens:** The NEP-413 `token_diff` payload follows NEAR Intents as known at build time (recipient `intents.near`, 32-byte base64 nonce, ISO deadline, sorted diff keys, sha256 over borsh, `ed25519:<b58>`); W23 must check it against the live verifier. Signatures verify against the signer's registered key (`near_colony_account`), not a key carried on the intent. Nonces are random when not supplied. `IntentsBalanceReadPort` is deliberately outside the 13-port env list (follows `NEAR_ADAPTER_INTENTS`). The contract suite's write cases are mock-only; a real run needs `CONTRACT_INTENTS_SIGNER` and only simulates. Import auto-withdraw assumes the verifier balance sits on the colony's own account; the new outbox `payload.dependsOn` defers a row until its dependency is DONE. The mock faucet records its funding note in `mock_chain_intent` (`actorKind: fixture`, `organic: false`).
- **Found:** 2026-11-05, W13-04/05/06/07/16/17.


### LED-25 · W13 settlement, recovery and order lifecycle defaults

- **Status:** Accepted (by design); owner may change
- **Area / code:** `backend/app/src/market/{settlement,orders,board,api,progression,telemetry}/`.
- **What happens:**
  - Settlement calls `IntentsPort.execute` straight from the outbox row `trade:{tradeId}` (like cargo, no `RelayerPort` wrapper). Each batch signs an intent for every account in its legs, so platform/treasury/seed-bot accounts get custodial keys from `MarketAccountsBootstrap` (non-production only).
  - Recovery (W13-14): a final chain error rolls the fill back and re-checks funds; a partly filled order that cannot reacquire funds ends `CANCELLED`. Relay errors that are neither final codes nor `NEAR_UNAVAILABLE` stay PENDING until the outbox row is DEAD, then become `UNKNOWN` (quarantined; reconciler at boot and every 30 s re-executes with the same opId). Undoing a fill's fee bucket by subtraction can leave rounding dust on a later fill's already-fixed fee.
  - Cancel/expiry (W13-15): TTL follows planet time by integrating the warp factor in memory (resets on app restart, where wall-clock `expiresAt` still applies); sweep every 30 s. A cancel of an unknown/foreign order answers `market.release {reason:'rejected', code:'unknown_order'}`.
  - Place order (W13-09/13): `ref` is unique per planet (`orderIdOf(planetId, ref)`, migration 0014); in-flight deposits are counted so concurrent orders don't over-deposit.
  - `market.book` and `market.trade` pushes go to the whole planet room (no per-socket `market` topic tracking yet). `GET /v1/market` falls back to the caller's first colony account when it has no order on that planet.
  - Price board (W13-18): `last`/change/volume/candles use all FINAL trades; only VWAP and eligible volume use organic trades; a counterparty above the weight cap withholds the reference (`concentrated`); same-player colonies are not merged. Limits (window 24 h, ≥ 3 organic trades / 10 units / 3 counterparties, cap 4000 bp, move 5000 bp, stale 1 h) are data rows (`market.board`).
  - Progression (W13-27): Port Authority counts one "fee unit" per started whole display unit of fee (a 0.10 USDC fee = 1), so the demo reaches +3 only over three fee-earning fills, and many tiny fees can farm it (bounded by minimum notional). A crash between FINAL and the fact write loses that fact.
  - Telemetry (W13-29): money metrics are doubles (exact below 2^53); counters reset on restart; no `npc` series until NPC orders exist.
  - Client (W13-23/24): the toast says plain "USDC", the Contracts list badge says "MOCK USDC"; there is no separate client event log (Contracts rows are it); a third-party stall owner gets no history row; the sparkline plots one point per FINAL trade (max 30, even spacing).
- **To resolve:** per-socket topic subscriptions; durable fact outbox for progression; owner review of the fee-unit definition.
- **Found:** 2026-11-05, W13-13/14/15/18/19/23/24/27/29.

### LED-26 · W13 regional endowments and logistics: what is wired and what is not

- **Status:** Open (partly); calibration in LED-19
- **Area / code:** `shared/sim/src/economy/regions/`, `shared/sim/src/gen/world/regionalDeposits.ts`, `shared/sim/src/systems/logistics/`, `shared/sim/src/economy/logistics/`, `shared/sim/src/data/{regions,logistics}.ts`.
- **What happens:**
  - Regions (W13-50/51): one binding wins per level (highest priority; equal priority = ambiguous); region content comes from the most specific layer that defines any; main-resource badge must match weight × mean reserve × yield; essential access = water, `metals.t1`, `minerals.t1` with starter guarantee > 0 and yield > 0. `GEN_VERSION` is not bumped: a W13 world is identified by its region pin (`regionGenVersion: 1`), and generation without a region is unchanged. Not implemented: `starterGuarantee` placement, eligible source kinds / tier shares, per-sector regions (one planet region pre-W11), runtime re-activation by a host. `yieldShare` / the "20 % crystal share" in `data/resources.ts` are dead data. Default `bio.water` renewal is 12 600 units per sim hour (implementer's choice), split equally across active water extractors. Clearing yields floor to whole units.
  - Logistics (W13-52/53/54): the service domain is the colony; unit readiness maps from entity state; only routed entities count in L/u; postings carry no `ref` (dedupe by the window key); thermal fuel is excluded by having no logistics row; extractors halt when supply is unavailable after grace; a returned reserve uses `clampToCap` (can overflow at full storage); terraform/dismantle/clear work rates are not scaled yet; the HQ drone has no logistics row; W07 combat is not in this tree (pure `combatServiceFactor` + `withSuppliedCadence` hook only) and the W09 away budget hook is a no-op. Re-entering reserve while deploying does not refund the activation cost.
- **Update (W13-57):** regions are now wired: every new planet created with W13 on (server thread, scenario loader, `?host=local`) is pinned through one rule `regionForNewPlanet` (`shared/sim/src/economy/regions/creation.ts`); restored planets are never re-pinned. Parity compares ignore the pin's `context.planetId`, which each host mints itself. Spawned idle units weigh 25 % of a working unit, so ~20 are needed to push a hub-only colony past u = 1.
- **To resolve:** sector pins with W11/W27, the remaining work-rate paths, starter guarantees.
- **Found:** 2026-11-05, W13-50..54.

### LED-27 · W13 experiments, jobs, CLI and stress suite defaults

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/economy/experiments/`, `backend/app/src/economy/experiments/`, `scripts/economy/`, `tests/economy/`.
- **What happens:** The world is fixed per scenario and the seed drives only the behaviour PRNG; runs are serial (`maxWorkers` not parallel in the runner; the job service uses `TA_ECONOMY_EXPERIMENT_WORKERS`). `incomplete` exits 4; a gate with `insufficient_data` counts as a failing seed. Job run leases live in `experiment_run.hashes.lease`. CLI: every 4xx (including 401/403) exits 2; `profile clone --name` is stored as the version rationale (no named-profile create route); `recommend` auto-finds the baseline as the latest completed experiment of the parent profile with the same scenarios/seeds and never activates. Stress suite: external venue leakage is modelled as an exogenous inventory inflow (no platform-fee accounting), related-account exclusion is a metric split, only `exogenousInflow` shocks exist, the Guild (W15) case is a counterfactual label that can never pass. All coefficients and demand inputs are labelled assumptions; no mock result is evidence of real demand.
- **Found:** 2026-11-05, W13-44..48.


### LED-28 · W13 client, analytics, fixtures and demo-story deviations

- **Status:** Accepted (by design) / Open where noted
- **Area / code:** `frontend/game/features/market/**`, `backend/app/src/market/{api,analytics,dev}/`, `tests/e2e/w13.spec.ts`, `tests/scenarios/w13-markets.ts`.
- **What happens:**
  - Account resolution: one resolver (`market/orders/market-colonies.ts`) maps a scenario colony to `col_<index>` (the account `cargo.export` mints to) and a real colony to its row id + player; on a real planet whose sim colony id differs from the row id both paths converge only through the player's account fallback.
  - The `market.book` push is a leading + trailing 1 Hz throttle per pair (W13-19's "one push for 5 orders" became "the last push of the second carries all 5") so an ask shows < 1 s after the ack.
  - Order form (W13-21): the max stall fee is entered in bp (default `stallFeeDefaultBp`); network cost is a labelled mock 0; sells show no fees (the buyer pays them); the client also blocks a total below `minNotional`; `marketOrderRejected` is matched to a submit within 15 s (events carry no colony filter on the client). Stall section (W13-22): valuation covers USDC pairs only; no push for realized earnings (refresh on snapshot/ack). Supply & trade (W13-55): the view reads default compiled rows (live `tune` of `market.*`/`grid` is not reflected), "produce locally" knows only T1 extractor rows, reserve relief needs a load figure the view does not pass yet, safety stock only for held resources.
  - Analytics (W13-28): cohort consumption is not implemented (explicit "not available" string); the 10 % fee-leakage figure is a labelled assumption; repeat buyers count trades; the client `market_trade_settled` event assumes one colony per client.
  - Fixtures: the w13 scenario funds `col_0`/`col_1` accounts, which are shared across scenario planets in one database, so loading a second w13 planet adds fixture balances on top.
  - Demo step 8 ("inject a final settlement failure: balances stay unchanged, orders recover atomically") behaves as follows with `near.mock.fail intents 1`: the matched trade stays `UNKNOWN` (funds locked, nothing credited) until the reconciler re-executes it after the rate is reset (~30 s), then exactly one FINAL trade appears. Definite failures (rollback + re-match) and the outcome-unknown control are covered by backend integration specs, not by a dev route.
- Docs (W13-02): the SVG fee diagrams in `docs/hackathon/public/near-features.html` and `money.html` still draw pre-D-44 numbers (notes added, drawings not redone); historical hackathon docs keep old 0–3 % figures under D-44 banners.
- **Found:** 2026-11-05, W13-02/19..28/35/55.
