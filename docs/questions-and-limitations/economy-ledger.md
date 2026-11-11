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
- **Why the work path was not moved to the treasury (terraform rework review, 2026-11-02):** W02 harvest and extractor production credit fractional stock every tick through `creditResource` (a Worker Drone T1 adds `0.1` per tick: `unitsWorkersBasic.t1.harvestRatePerS` 2.0 × `ECONOMY_RATE_SCALE` 0.25 = 0.5/s at 5 Hz; corrected in the W02 review, the entry said `0.025`), so `col.stock` becomes non-integer. Once a key is fractional, `ColonyTreasury.add` rejects every credit on it (`treasury.ts:125` checks `isMajor(stock[key] + v)` → `invalid_amount` / balance overflow). That would silently drop `terraform.yield` (W01 order path), `construction.refund` and dev grants with a `treasuryRejected` warning in any game where a Worker Drone T1 or Extractor has run. `clampToCaps` also subtracts fractional stock from the family room, so the credited fit and the overflow can be fractional, which `transferLegs` cannot post. And there are two cap models: the treasury uses `getColonyCaps(state)` (`initialCaps` / `col.caps`), `economy/ledger.ts` `creditResource` the W02 `colony.caps` with its own room rule. So work-job yields, repair costs and dismantle / cancel refunds stay on the W02 helpers, unjournaled, until production posts whole units (an accumulator) or the ledger uses fixed-point units.
- **What happens:** W01's `ColonyTreasury` (`shared/sim/src/economy/treasury.ts`) records whole-unit double-entry postings (`StepResult.postings` → `PlanetJournal`), whereas W02's `economy/ledger.ts` mutates `colony.stock` directly (including fractional per-tick Extractor production such as `0.2 metals.t1`/tick and `37.5` demolish refunds). Scenario setup (`tests/scenarios/_loader.ts`) seeds `PlanetJournal.openingPostings` when a scenario pre-populates `colony.stock` without postings, but runtime W02 `creditResource`/`debitCost`/`refundCost` calls do not emit `LedgerPosting`s, so `PlanetJournal` balances will diverge from `colony.stock` once W02 extractors, Worker Drones, or queues run.
- **Why it is like this:** `@terra/ledger` enforces whole-unit integer leg amounts (`Number.isSafeInteger`), while W02 extractor output (`1.0/s` = `0.2/tick`) and 50 % refunds operate on fractional floats in `colony.stock`.
- **Workaround / mitigation:** `MinimalHud.wholeStock` floors stock for display; scenario loader bridges initial `colony.stock` into `setupPostings`.
- **Seen on the dev server (economy review, 2026-11-03):** every restart logs `ledger/state mismatch on restore of <planet>: the journal does not explain col.stock` for any planet where a Worker Drone T1 or Extractor ran. Example `pl_01M6EG80PWJJA4Y2N5RHFET9ER` (w02 scenario, one Worker Drone T1): ledger `metals.t1 400 / minerals.t1 250 / bio.biomass 150` (the scenario's opening postings, 1 journal row) vs state `500 / 500 / 350`; the snapshot's `production.produced` (`540 / 515 / 355`) shows the gap is exactly the unposted Worker Drone T1 credits, clamped at the 500 family cap. The same snapshot shows float dust from the fractional credits (`production.capped.metals 3.2e-11`, `produced['minerals.t1'] 515.0000000000043`). After such drift a later whole-unit treasury withdraw (W01 construction spend) can also be refused by the journal (`ledger drift … insufficient_funds`), because the journal never saw the credits. The log is expected until this entry is resolved; it is not a separate bug.
- **W02 production bypasses the treasury and the journal (W02 review round 1, 2026-11-03):** Extractor output (`production.extractors`, `extractTiered` → `creditResource`) and Worker Drone T1 output (`production.harvest`) write `col.stock` and `production.produced` directly; no posting is made. The catalog reason `production.tick` (`shared/sim/src/economy/reasons.ts`, counter `sys:world`) exists, but nothing posts it, although `SIMULATION.md` SIM-S-03 says production credits through it with `clampToCap`. The W02-28 Stockpile batches therefore read `production.produced` (BE-28), not the journal. W02 cancel / demolish refunds are 50 % (`CANCEL_REFUND_RATE`, rows' `cancelRefundRatio` / `demolishRefundRatio`) and capped (LED-17).
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
- **Update (2026-11-07):** the legacy `tradeHub` `marketFee*Bp` rows no longer exist in code: Resolved.


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
- **Update (2026-11-07):** the barter-buy reservation now uses the sim's `maxBuyerSpend` (floor) everywhere (Resolved). Still an owner decision: whether a buyer without an explicit maximum may accept up to the policy stall maximum (the code now defaults the maximum to the policy ceiling in the REST path, see `matching.exchange.int.spec.ts`), and how a RESTING all-or-nothing order should behave when a smaller taker arrives (today: skipped, taken only in full).


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
- **To resolve:** Per-socket topics: Resolved (2026-11-07, `market.subscribe` / `market.unsubscribe`; a socket that never subscribes still gets all pairs; clients re-subscribe after reconnect). Progression facts: Resolved (boot + 5-minute replay of FINAL trades without a receipt, 60 s grace, 7-day window; replayed facts carry `atTick` 0). Still open: owner review of the fee-unit definition.
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
- HUD (wave lead, owner check): the feature `menus` are declared but not rendered by the HUD, so the market panels are launched from the Supply & trade bar (BOARD, CONTRACTS, SHOW), which sits in the bottom-right stack under an open Trade Hub panel; an open Price board in the bottom-left stack pushes the command dock up; the Supply & trade panel can overlap the Goals panel at 1440×900; the order preview names resources by key (`bio.water`). The economy operator API (`/v1/economy/*`) stays available with `TA_WAVES=..12` (operator tool; gameplay commands, market REST, faucet and HUD are off). The Survey Array project needs `minerals.t2`, which the w13 scenario colony lacks (grant it, or buy it on the market).
- Docs (W13-02): the SVG fee diagrams in `docs/hackathon/public/near-features.html` and `money.html` still draw pre-D-44 numbers (notes added, drawings not redone); historical hackathon docs keep old 0–3 % figures under D-44 banners.
- **Found:** 2026-11-05, W13-02/19..28/35/55.


### LED-29 · W13 bot/agent trading API, organic rule and quote agents (D-45)

- **Status:** Accepted (by design); defaults taken by the wave lead, owner may change
- **Area / code:** `shared/contracts/src/market/trade-api.ts`, `backend/app/src/market/{trade,board,settlement/organic.ts}`, `shared/sim/src/systems/trade/{command-source.ts,agent/}`, `shared/sim/src/economy/experiments/behaviors/demand-agents-*.ts`, [D-45](../spec/DECISIONS.md), [PROTOCOL §8a](../spec/PROTOCOL.md).
- **What happens:**
  - Bots and humans trade on one book through `/v1/trade/*` (API key = actor `bot`; session or `?as=` = actor `player`). Both go through the same sim reservation, `PlaceOrderService`, matcher and settlement; there is no second path.
  - **Organic rule (default taken, the owner never answered):** a fill is organic when both sides are `player` or `bot`, different colonies AND different owner ids. Same owner (also two bots of one person), fixture, subsidy, npc and guild fills never count. A null owner counts as different. Without this change a bot-only market could never establish a reference price (VWAP stays null, Guild quotes never start). Whether a bot consumes what it buys is NOT verified at settlement; it is a hypothesis to calibrate (LED-18) and bot demand can be fake demand.
  - Per-key allowance (persisted, restart-safe): open orders (default 10), order notional (100 mock USDC), daily budget (1000 mock USDC, UTC day), allowed pairs, price band vs the organic VWAP (skipped while no reference exists), kill switch (also cancels unsubmitted requests and resting orders). The daily budget is a SPEND cap (open and pending orders in full, ended orders what they filled), not a profit-and-loss loss budget. The rate limiter is in memory per process.
  - The LLM never types a free price: `GET /v1/trade/agent/quote` runs the deterministic `quoteColony` (need, walk-away price, own-cost floor, inventory-skew mid, spreads, hard limits, reason codes). An external bot that calls `POST /orders` can still send any price; the allowance and price band bound it, they do not make it economically sensible.
  - Quote library defaults (`market.agent.*`: k = 1/2, epsilon 10, clamp 0.5..2, spreads 200 bp) are calibration hypotheses. A missing, stale or thin reference pauses bids only; asks fall back to the own-cost floor; unmeasured transport pauses both. Subsidy-priced (bootstrap) trades are never organic, so a market that only has bootstrap trades cannot set its own organic reference: it needs organic trades or an operator-funded bounded bootstrap.
  - The REST API answers after matching: 201 with fills, 202 pending after a 4 s wait (the order still completes). Order-to-request linking uses `commandId` first and falls back to colony + exact terms. Do not drive one colony with a key and a game session at the same time with identical orders.
  - Dev bots (`POST /v1/dev/trade/bots`) need an existing sim seat; they are labelled fixture-funded.
- **Open:** (1) the depth preview in Supply & trade reads only the visible levels (`bookDepthLevels`, 10): it cannot exclude own asks or makers above the buyer's maximum stall fee; (2) the sell-side depth walk (`walkBids`) is built but no UI uses it; (3) `market.seed` bot ladder (mid 0.40 USDC) and `referencePriceAtomic 250000` are fixture/assumption values, never demand; (4) real cash stays off until the W23 pilot (LED-18).
- **Found:** 2026-11-07, W13 exchange pass (D-45).


### LED-30 · W13 exchange test suite: coverage limits and known residuals

- **Status:** Accepted (by design) / Open where noted
- **Area / code:** `shared/sim/test/exchange/`, `backend/app/test/exchange/`, `backend/app/src/market/settlement/batch.exchange.spec.ts`.
- **What happens:**
  - Unit/property suite (202 tests, seeded PRNG loops; `fast-check` is not a dependency) and a Postgres integration suite on the DB-backed mock NEAR chain (101 tests) with deterministic fault injection (`near.mock.fault`). The REST path is tested against a stand-in planet sim that applies the real lot/TTL/fee/min-notional rules; the real sim is covered by the unit suite and the w13 e2e.
  - Bugs the suite found and that are fixed: maxStallFeeBp accepted NaN/fractions (crashed the step); platform and stall fee buckets collided when both pay one account; malformed price/amount threw out of the precheck; concurrent crossing orders deadlocked the matcher (Postgres 40P01, now a per-pair advisory lock + retry); a re-match after a FAILED trade reused the trade id and left both orders FILLED without settlement; expired makers still filled before the 30 s sweep; the buy reservation rounded fees up while the sim floors them (now one function); the kill switch did not cancel resting orders.
  - Residual: after a rolled-back fill the paid fee rows can be 1 atomic unit per bucket below an unsplit run, because a later committed fill stays priced against the old cumulative; fixing it means re-pricing a committed fill.
  - During an UNKNOWN trade after `fail_after` free funds are conservative (counted twice); `fail_before` only retries and goes UNKNOWN when DEAD, order restoration comes from `insufficient_funds`; `market-deposit:` faults are not covered (the faucet credits the verifier directly); `planParties` converts amounts with `Number()` (exact below 2^53, resource totals are far below).
  - Under 16 concurrent REST places some answer 202 after the 4 s wait on a loaded machine (CPU-bound signing in the match transaction); they complete.
- **Found:** 2026-11-07, W13 exchange pass.


### LED-31 · W13 hardening round (security review, real-sim and UI tests): what changed, what is left

- **Status:** Accepted (by design) / Open where noted
- **Area / code:** `backend/app/src/market/trade/**`, `backend/app/src/market/api/**`, `shared/sim/src/systems/trade/{market-lifecycle,module-commands}.ts`, `backend/app/test/{exchange-real,review}/`, `tests/e2e/w13*.ts`, `tests/scenarios/w13-markets-multi.ts`.
- **What happens:**
  - **Security review fixes:** key management and revoke are session-only (a read-only key could revoke siblings); at most 20 active keys per owner (`key_limit` 409) sharing an owner-wide bucket of 100/s (burst 200); 5 SSE streams per caller (`too_many_streams` 429) and revoke closes them; public book/board reads no longer cache per probed planet; numeric/path ids are validated (`invalid_request` 400, NUL bytes included) and internal errors never leak DB text (generic `internal` + request id); the order-expiry sweep survives one failing release; a cancel without Idempotency-Key can be retried after a rejection; carried-over open orders count towards `dailyBudget`; release/cancel by `ref` is planet-scoped; `colonyRef` is an HMAC keyed by `TA_COLONY_REF_SECRET` (random per process if unset, refs then change on restart; production logs a warning); public routes have a per-IP bucket (`TA_TRADE_PUBLIC_RPS` / `TA_TRADE_PUBLIC_BURST`, default 30/s, burst 90; failed key lookups 1/s burst 20; the IP is `req.ip`, set `proxy trust via `TA_TRUST_PROXY`, otherwise callers behind one proxy share a bucket); all 429/503 carry `Retry-After`; placements are capped in flight (`TA_TRADE_MAX_INFLIGHT`, default floor(pool/2)-1, queue wait `TA_TRADE_QUEUE_WAIT_MS` 8000, then 503 `server_busy`; pool `TA_DB_POOL_SIZE` 20); idempotent rejections replay `details` (migration `0018_w13_trade_error_details`).
  - **Organic rule in production:** a fill with a missing owner id is NOT organic when `NODE_ENV=production` (fail closed); outside production a missing owner counts as different so dev scenario seats work. A session identity without a colony gets `no_colony` (409); the seat-0 fallback applies only to `?as=<name>` / `dev:<name>` dev identities, never in production. The stall `GET` right after a `PUT` returns the new fee (15 s read-your-write).
  - **SIM-LEAK (Resolved):** a filled USDC-paid buy reserved no resource, so its open-order ref was never removed and after 20 filled buys the colony was refused with `order_limit` forever. `market-lifecycle.ts` now ends an order's slot on any end reason (filled via a `filled` counter, cancelled, expired, rejected, settlement failed). Already-leaked colonies self-heal when they hit the limit (oldest refs without `filled` and without a reservation are dropped; a legacy USDC buy that is genuinely still open loses its HUD mirror entry and a cancel of it may answer `unknown_order`; see GP-81).
  - **Trade page:** the All pairs panel used one request per pair (110 calls per load) and tripped the per-IP limit itself; it now uses `GET /v1/trade/overview/:planetId` (one request, capped at 500 rows). A page load makes 16 requests; idle makes none.
  - **Tests:** real-sim integration (`exchange-real`: rails, faults, per-socket topics over a real WebSocket, progression replay on real Postgres, a seeded soak of 3 seeds x 300 steps with chain faults, no invariant break), review specs, a 59-step w13 e2e (trade page UI 9f-9r with real clicks, bot API 9f-1..22, multi-colony reference price 9f-1b/7b/22b on scenario `w13m` with 4 owners), plus the e2e freezes the solar clock at noon.
- **Open:**
  - **Night power (design question for the owner):** a game day is 15 real minutes; at night Solar stops and a Solar-only colony's Trade Hub goes `hub_offline` ("Trade Hub is unpowered"). Trading simply stops at night unless the colony has batteries or other power. The e2e freezes the clock (`time {timeOfDay:12,timeScale:0}`); players are not protected.
  - **`stale_reference` is nearly unreachable:** the board hides the VWAP at `stalenessS` 3600 s and the quote agent pauses at `referenceMaxAgeS` 3600 s, so a stale reference normally reads `no_reference`. If they are meant to differ, the board limit should be larger.
  - A dev-funded bot (faucet credits the verifier only) has no in-orbit mirror in the sim, so its sells are refused `insufficient_cargo`; the e2e grants the mirror with `dev.cargoGrant`. `dev.cargoGrant` with a non-existent colony index creates a sparse colony and crashed the planet thread once (dev only).
  - The daily budget is a spend cap per UTC day plus carried-over open exposure, not a loss budget; the per-key rate limiter and per-IP buckets are in memory per process; with no `TA_TRUST_PROXY` configured all callers behind one proxy share a bucket.
  - `colonyRef` refs change on restart unless `TA_COLONY_REF_SECRET` is set.
  - Pool-gate spec guards regressions only (it also passes with a larger cap in the harness); the real protection is observed in the e2e burst (9f-18).
- **Found:** 2026-11-08, W13 hardening round.

### LED-45 · W15 Guild mock policy: cash off, seeded visit gap, copied spreads

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/data/guild.ts`, `shared/sim/src/systems/trade/guild/policy.ts`, `shared/db/seeds/0003_guild_policy.ts`, NEAR-71..73
- **What happens:** Guild roster and quote numbers live in the `guild` data table (wave `W15`) and are registered on the W13 parameter registry. Profile `guild@1` stores that document (baseline parameters plus one agent policy per NPC). It is not activated, so `baseline@1` stays the live market profile. Real cash bids stay off (`cashEnabled` 0). The per-NPC NEAR float cap is 5 and the global cap is 10; each NPC's `cashLimitAtomic` is 5 NEAR in yocto, and nothing spends it while cash is off. The dock window is 720 seconds. The visit gap is one seeded number, 1800 seconds (30 minutes), not the 20–40 minute band in the balance notes. Half-spreads and the other quote fields start equal to `market.agent` (200 bp, k = 1/2, epsilon 10, clamp 0.5×–2×), so `guildAgentParams` still matches the W13 library. `thinHalfSpreadBp` (1500) is outside `AgentParams`; `quoteGuild` reads it (LED-46). The kill switch defaults off. Each Tier-1 target is 2500 whole units and the inventory cap is 5000. Per-order exposure, global exposure and daily loss/spend atomics (`1000000000`, `10000000000`, `1000000000`, `5000000000`) are on the same scale as `maxOrderQuoteAtomic` and are not enforced here. The route is the token `loop-local` (one planet) because planet ids are not known at compile time. Roster ids are `kestrel` and `vanguard` (the wave text). Older hackathon notes say Osprey; that name is not seeded. Pair lists are data rows, not registry parameters, so a profile patch cannot add a T2 or T3 pair. `minEligibleTrades` (3) is stored; `quoteColony` still uses `minReferenceVolume` and `referenceMaxAgeS`.
- **Why it is like this:** W15-02 asked for these as hypotheses pending calibration, with real cash disabled, and for quotes to go through the W13 library rather than a second pricer. Funding enforcement is W15-12. Provisioning is LED-34. The market-maker loop is W15-08. The ship is W15-14.
- **Workaround / mitigation:** Change a registered `guild.*` field with a new profile version or a balance override. Recompile and the same `quoteColony` call prices off the new spread. `TA_WAVES=..14` drops the rows.
- **To resolve:** Confirm the 1800 s visit gap (against a 20–40 min band), the 2500 targets, the exposure atomics, and whether `guild@1` should ever replace `baseline@1` as the active profile. Confirm `vanguard` against the older Osprey name.
- **Found:** 2026-11-10, W15-02

### LED-46 · Guild thin-side spread uses the target, not 25% of it

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/systems/trade/guild/quote.ts` (`guildQuoteParams`), `shared/sim/src/data/guild.ts` (`thinHalfSpreadBp`)
- **What happens:** `quoteGuild` calls `quoteColony` with the guild policy. Inventory below the NPC target widens the ask half-spread to `max(askHalfSpreadBp, thinHalfSpreadBp)` (default 1500 bp, 15% of mid). Inventory above the target widens the bid the same way. Exactly at the target, both sides stay at 200 bp. `cashEnabled` 0 passes a zero USDC/NEAR balance into the library, so a cash bid pauses with the library's reason (`no_cash`, unless the reference is already `stale_reference` or `thin_reference`). Barter keeps its quote-resource balance. Guild, fixture, subsidy and same-owner fills stay non-organic in the existing `isOrganicFill` predicate; the price board then leaves them out of VWAP, and a missing reference is not replaced with a price.
- **Why it is like this:** W15-06 requires the W13 library and a widen when inventory is below the target, including the corner where one unit below widens and the target does not. R04-10 instead widens only below 25% of target, from a 4% full spread up to 15%. That 25% line is not a policy field. Base half-spreads stay 200 bp so `guildAgentParams` still matches `market.agent` (LED-45). Widening the bid above target is the other thin side, so a purchase that crosses the target widens the bid.
- **Workaround / mitigation:** Set `guild.policy.thinHalfSpreadBp` equal to the base half-spread to turn widening off. Cash bids stay off while `cashEnabled` is 0. `compileData` still applies the table default when an older profile document omits the new field. The idempotent `guild@1` seed does not rewrite an already stored version.
- **To resolve:** Confirm the threshold is the target (not 25% of it), that 1500 bp is the thin side's distance from mid, and that inventory above target should widen the bid.
- **Found:** 2026-11-10, W15-06

### LED-34 · W15 Guild provisioning: one subsidy allocation, fixture cargo only, no silent refill

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/market/guild/`, `shared/db/prisma/guild.prisma`, `chain.guild_npc`, NEAR-70, NEAR-73
- **What happens:** With W15 on, boot gives each roster NPC (`kestrel`, `vanguard`) one sub-account `guild-N.npc.terraagent.mock`, one limited key (`ed25519:guild-<id>`, receiver `intents.near` only), one W13 trade API key (`ownerId` `guild:<id>`, label `guild-npc`), and one allocation id `guild-alloc:{policyVersion}:{npcId}` (today `guild-alloc:guild-mock-1:kestrel` and `guild-alloc:guild-mock-1:vanguard`). The quote budget is the per-NPC NEAR float in yocto (`npcNearFloatCap` 5), and the two NPCs together use the whole global float (10 NEAR). `cash_enabled` is stored as 0; a policy with cash on is refused (`cash_on`) rather than turning bids on. Spend and loss start at 0 and a second boot does not write them. `refill` returns the same row and does not raise the quote budget or the key's NEAR allowance. Mock cargo is not created at boot. `allocateFixtureCargo` with amount 0 writes nothing; a positive amount appends an `inventory_cache` line labelled `fixture` with `organic: false` and does not credit the verifier or the treasury. W15 off (`TA_WAVES` without W15) returns without writing. A database error during boot is logged and skipped so the rest of the app still starts.
- **Why it is like this:** W15-05 asked for an explicit finite allocation and forbade silent minting and silent refill. Real treasury cargo is purchased or exported later; this issue has no stock export and no purchase. The wallet port allows one receiver per key, so the key is `intents.near` and not also `res.*`. The trade-key table stores only a hash, so the bearer secret is not kept; later orders have to use `trade_key_id` inside the service. W13's key auth still reports actor kind `bot` for any bearer; the guild row's `actor_kind` is `npc`, and that is what a guild order must send. The key's `planet_id` is the route token `loop-local` because planet ids are not known until a visit (W15-09). The market-maker loop and the visit scheduler are later issues.
- **Workaround / mitigation:** Do not call `refill` expecting a larger budget. Do not treat `inventory_cache` as verifier cargo. Operator top-up is `topUp` on the funding book (LED-35), not `refill` and not this boot path. `TA_WAVES=..14` provisions nothing. Guild orders are placed as actor kind `npc` with `trade_key_id` inside the maker (LED-38), not through the bearer path.
- **To resolve:** Decide whether a service-owned key must keep its bearer secret, whether the limited key also needs a `res.*` receiver, and which planet id the key should carry once visits exist.
- **Found:** 2026-11-10, W15-05

### LED-35 · Guild funding book: explicit top-up, cash pause, kill delegates to W13

- **Status:** Question for the owner
- **Area / code:** `backend/app/src/market/guild/funding/`, `chain.guild_funding`, `GuildFundingService.topUp`, `GuildKillSwitch.killGuild`, NEAR-73
- **What happens:** The first read or reserve for an npc inserts one `guild_funding` row whose cash cap is that npc's existing `quote_budget_atomic` (5 NEAR in yocto) and whose inventory cap is `inventoryCapUnits` (5000). The `global` row is the sum of those seeds. A second boot does not add to either cap. `reserve` holds cash or inventory on the npc and on `global`; if the two together would pass either cap, one reserve returns `funding_cap` and writes nothing. `release` and `consume` clamp at zero, so reserved and spent never go negative. `consume` only moves units that were reserved. `allowQuote` does not reserve and does not call `topUp`. A cash buy returns `cash_paused` when `cashEnabled` is not 1, or the reference age is above `referenceMaxAgeS`, or eligible volume is under `minReferenceVolume` (exact age and exact volume still pass). An inventory bid or ask still passes while `stock` covers the size and the inventory book has room. `topUp(allocationId, amount)` adds `amount` to that npc's cash cap, the global cash cap, and `guild_npc.quote_budget_atomic`. It does not change the limited-key NEAR allowance, the W13 key daily budget, or `spend_atomic` / `loss_atomic`. `killGuild` sets `killed` (so `allowQuote` returns `killed`) and then calls `TradeKeysService.kill` for that npc's trade key, which sets the W13 kill switch and cancels unsubmitted requests. The maker (LED-38) is what reserves before a quote and releases on cancel; this book still does not place orders by itself.
- **Why it is like this:** W15-12 layers funding on W13-59 and forbids a second allowance, kill switch, or automatic refill. The W15-05 subsidy is the starting allocation; copying it once is not a refill. Cash stays off in the seeded policy, so cash bids pause until a policy turns cash on and the reference is fresh and deep enough. An explicit top-up is allowed to take the global cash cap above the seeded 10 NEAR, because the operator added funds. `allowQuote` is a preview; the row lock in `reserve` is what concurrent quotes cannot pass.
- **Workaround / mitigation:** Call `topUp` to add cash. Do not expect boot, `refill`, or `allowQuote` to raise a cap. Do not expect a cash bid while `cashEnabled` is 0. After `killGuild`, quotes stay paused until something clears `killed` (nothing in this issue does). W15 off does not write funding rows.
- **To resolve:** Should `topUp` also raise the mock limited-key NEAR allowance, or only this book and `quote_budget_atomic`? Should an operator top-up be refused once the seeded global float (10 NEAR) is reached? The maker now `reserve`s before place and `release`s on cancel (LED-38). A matched guild fill `consume`s the filled portion of that hold at match time, not when the intent reaches FINAL (LED-41). Resting guild orders are cancelled on the server book; the sim slot is not held (LED-38).
- **Found:** 2026-11-10, W15-12

### LED-36 · Guild visits loop one planet on a pinned clock; offers stay empty

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/market/guild/visit/`, `chain.guild_visit`, `WsGateway.broadcastGuildArrived`
- **What happens:** The seed is the policy version (`guild-mock-1`), mixed with the NPC id and the planet id. The dock is `dockWindowS` (720_000 ms) and the gap is `visitGapS` (1_800_000 ms). After `departAt` the phase is `enroute` until the next arrival. With the roster route `loop-local`, that next arrival is the same planet. A row is only the dock: en route is the absence of an open row. `offers` is filled by W15-11 when the maker has resting quotes (LED-40); without that source it stays `[]`. `scheduleExtraVisit(planetId)` inserts one `kind=extra` row for kestrel (the first roster NPC) at the guild clock and does not move cadence arrivals. A dock of 0 ms throws `zero_visit`. W15 off writes nothing and pushes nothing. The first tick does not backfill docks that already ended. A later tick catches up at most 8 missed cadence windows per NPC; older ones are dropped. `advance` pins that planet's clock at the given instant (it does not keep running). The live sweep uses wall time. Sim `warp k` does not speed the guild clock, so a client countdown against `departAt` stays on wall time. The same NPC can be docked on two loaded planets at once, because each planet loops locally. Cargo is one cache on the NPC row (LED-39), not a second route. Visit rows do not reference `guild_npc`. A second tick of a window hits the deterministic id `gv:{npc}:{planet}:{arrive}` and does not insert or push `guild.arrived` again. `guild.departed` is pushed once, when `status` moves from `docked` to `departed`.
- **Why it is like this:** W15-09 asked for a deterministic schedule, an en-route gap, and one extra visit for W22. Planet ids are not in the data table (LED-34). The client contract says `departAt` is unix ms, so the schedule is not run on the sim warp clock.
- **Workaround / mitigation:** Call `advance(planetId, toMs)` to step the clock in tests. `TA_WAVES` without W15 stores nothing. An extra visit's `departed` uses the same `shipId` as kestrel's cadence visit; nothing in this issue labels it as a subsidy.
- **To resolve:** Decide whether `warp k` should shorten the dock, whether an extra visit should be a different ship, and whether a long outage should backfill more than 8 windows. A single ship position across planets is still open (LED-39). Offers are LED-40.
- **Found:** 2026-11-10, W15-09

### LED-37 · `GUILD_ENABLED` and `GUILD_NPC_COUNT` are not read

- **Status:** Accepted (by design)
- **Area / code:** `docs/dev/ENVS.md`, `shared/sim/src/data/guild.ts`, `shared/sim/src/systems/trade/guild/policy.ts` (`readRoster`), `backend/app/src/market/guild/guild-provision.service.ts` (`flags.has('W15')`)
- **What happens:** Nothing in the process reads `GUILD_ENABLED` or `GUILD_NPC_COUNT`. Setting either does not change quotes, the roster, or provisioning. The guild runs when `TA_WAVES` includes `W15` (default `all`). `readRoster` accepts only the data rows `kestrel` and `vanguard`, in that order, and throws otherwise. `quoteGuild` does not take a count. `NEAR_ADAPTER_AGENT_WALLET` is read: unset is `mock`; `testnet`, `devnet`, or `mainnet` fails boot because only `MockAgentWalletAdapter` is registered (BE-71).
- **Why it is like this:** W15-32 asked for those two names in `ENVS.md`. A reader that nothing in the quote path calls would be a fake switch. The wave flag and the data table are the controls that exist.
- **Workaround / mitigation:** Turn the guild off with `TA_WAVES` that omits `W15` (for example `..14`). The roster stays those two ids until the table changes.
- **To resolve:** If an operator count is required, add a reader that provisioning and `readRoster` both honour, without a second pricer. Until then the names stay documented as unread.
- **Found:** 2026-11-10, W15-32

### LED-38 · Guild maker rests barter quotes on the server book, not through the sim place path

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/market/guild/maker/`, `shared/sim/src/systems/trade/guild/match.ts` (`sameGuild`), `shared/sim/src/systems/trade/market-matcher.ts`
- **What happens:** On `guild.arrived` the maker reads `GET /v1/trade/overview/:planetId` once (the in-process `TradeReadService.overview`, not one book call per pair). It then calls `quoteGuild` for four Tier-1 barter books: `metals.t1/minerals.t1`, `minerals.t1/bio.water`, `bio.water/bio.biomass`, `bio.biomass/metals.t1`. Each side the library returns becomes one `chain.market_order` row with `actor_kind` `npc`, `colony_id` the npc id, and `signed_terms.source` `bot` plus `tradeKeyId`. A null bid or ask is not given a price. USDC and NEAR bids stay paused while `cashEnabled` is 0. `allowQuote` then `reserve` run before the insert; `funding_cap`, `killed`, `inventory_short` and a W13 allowance rejection skip that side. `topUp` is not called. The same depart time does not insert a second resting order. `guild.departed` and `killGuild` cancel the npc's open rows and `release` the hold. `matchIncoming` skips a fill when both orders are `npc` or `guild`. A player order can still cross a guild order. After that fill commits, `onGuildFill` writes the cache, `consume`s the filled portion of the hold, and replaces the quote (LED-41). `recordFill` still only writes the cache. W15 off places nothing.
- **Why it is like this:** W13's `market.placeOrder` stamps actor kind `bot` when the command source is `bot`, and `player` otherwise. The bearer path does the same. LED-34 says a guild order must be `npc` and must use `trade_key_id` inside the service, so the maker writes the book row itself. The overview has no age and no organic VWAP: a present `last` is treated as age 0 and `volume24h` is the eligible volume; the walk-away and own unit cost are that same last price, and transport is 0. A missing last is not replaced, so both sides pause. The NPC has no planet colony, so there is no sim open-order slot for `market-lifecycle` to release. `OrderRelease` still emits `market.release`; the sim rejects it when the colony is absent. The stall on the row is the NPC account (Q-03-6 is unchanged). New trade keys store the four barter pair ids as well as the USDC pairs. The allowance check also unions those barter ids, so a key created before this change can still rest them. The key's kill switch, notional, open-order cap, daily budget and price band are unchanged.
- **Workaround / mitigation:** Dock with fixture cargo on both resources of a pair and an overview `last` if both sides should rest. Cancel is `guild.departed` or `killGuild`. Do not read actor kind `bot` on these rows. Do not expect the sim order list to show the slot.
- **To resolve:** If guild orders must reserve in-orbit cargo, give the NPC a colony and submit `market.placeOrder` with an actor kind the sim does not rewrite to `bot`. If the reference must be the organic VWAP, extend the overview (or one board read) with age and VWAP instead of `last`. Decide Q-03-6 (who receives the stall fee) before settlement of these rows matters.
- **Found:** 2026-11-10, W15-08

### LED-39 · Guild cargo is one fixture cache on the NPC, not a route and not a fill hook

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/market/guild/inventory.ts` (`applyFill`, `stockOf`), `GuildMakerService.recordFill`, `chain.guild_npc.inventory_cache`, `maker/plan.ts` (`freeUnits`)
- **What happens:** The cache is `{ label: 'fixture', organic: false, lines: [{ resource, amount, label: 'fixture', organic: false, source: 'mock-grant' }] }`. Lines of one resource are summed. A guild sell (a player buy) decreases that sum; a guild buy increases it. A sell larger than the stock is refused and the row is not written, so the amount never goes negative. A successful fill replaces that resource's lines with one line of the new total and leaves other resources. The planet id is an argument only: it is not stored, and planet B reads the same row as planet A. Departure cancels resting orders and does not clear the cache. The next dock, including the one-planet `loop-local` return, sets `inventory` and `freeUnits` from that sum, so the ask size is the stock capped by `maxOrderUnits` (100). Zero stock makes `quoteGuild` return `no_surplus` and the funding gate return `inventory_short`, so no ask is rested. W15 off (`recordFill` or `onGuildFill` while the wave is off) does not write. The match path calls `onGuildFill` after the fill commits (LED-41). A carried stock far below the 2500 target widens the ask (1500 bp) and lifts the mid (scarcity clamp 2×); the seeded key band is 5000 bp, so that ask can be skipped as `price_out_of_band` even though the library priced it. The cache can rise above `inventoryCapUnits` (5000). `source` stays `mock-grant`, so a purchase is not distinguishable from a fixture grant and is still not verifier cargo (LED-34).
- **Why it is like this:** W15-10 asked for cargo to travel with the ship without requiring W11. The visit clock already loops one planet per loaded world (LED-36) and can dock the same NPC on two planets at once. This issue stores one bag on the NPC instead of adding a ship position. The matcher itself stays pure; `onGuildFill` applies the fill after the match transaction commits (LED-41). The reader (`inventoryOf`) drops a line whose source is not `mock-grant`, so the carried line keeps that source.
- **Workaround / mitigation:** Call `recordFill` with the guild side after a player fill. Do not read a per-planet cache. A stock at or near the 2500 target stays inside the 5000 bp band, so that ask still rests. `TA_WAVES` without W15 does not change the row.
- **To resolve:** Decide whether a scarce ask may exceed the 5000 bp band. Decide whether one NPC may be docked on two planets at once. A source other than `mock-grant` needs `inventoryOf` to keep the line. Match-time consume does not unwind if the intent later fails (LED-41).
- **Found:** 2026-11-10, W15-10

### LED-40 · Curated Guild offers cross one NPC quote; the id is `gof:{orderId}:{quoteSeq}`

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/market/guild/offers/`, `shared/sim/src/systems/trade/accept-guild-offer.ts`, `guild.arrived`
- **What happens:** Each `guild.arrived` lists at most 6 offers from that ship's resting NPC quotes. Per pair and side the better price is kept (a player buy keeps the lower ask, a player sell the higher bid). The cap then keeps the first 6 in pair order, then player action `buy` before `sell`, and drops the rest. The amount is the base still resting. The price is the cargo total for that amount; platform and stall fees are added by the W13 batch. The offer id is `gof:{orderId}:{quoteSeq}`. `quoteSeq` is stored on the order's `signedTerms` and starts at 0. `bumpQuoteSeq` increments it, so the old id returns `offer_expired` with detail `new price <token> <atomic>` (the new cargo total). A departed ship, a cancelled quote, or an unknown id is `offer_expired` without that price. Accept inserts a player taker for the remaining size and runs `matchIncoming` against only that NPC order, then `SettlementFillsHook` (one `intent_trade`, actor kind `npc` on the Guild side, `organic` false). It does not call `market.placeOrder`, so it does not take a sim open-order slot and does not check a Trade Hub (Q-03-21 is still open). W15 off rejects the command `wave_disabled` before the handler runs. Outside production the player, the NPC and the platform get a custodial signing key if they lack one, because the Guild limited key is not a `token_diff` signer (LED-34). The relay still needs verifier balances; fixture cargo is not deposited, so a batch with an empty NPC verifier fails `NEAR_INSUFFICIENT_BALANCE`. A fill consumes the hold and replaces that quote (LED-41). The old offer id is `offer_expired` because that order is cancelled or filled; the new row's `quoteSeq` is one higher. A re-quote does not push `guild.arrived` again. The local host acks the command and does not settle. Two accepts that both pass the precheck can both ack; the row lock lets only one fill.
- **Why it is like this:** The quote book lives in Postgres, so the sim only acks and emits `guildOfferAcceptRequested`. Ranking across different resources has no shared price, so the extra offers are dropped in a stable pair order instead of a made-up value. Minting verifier cargo for the NPC would break the no-silent-mint rule.
- **Workaround / mitigation:** Seed the verifier before the relay if the trade must reach FINAL. Call `bumpQuoteSeq` (or replace the order) to expire an id. `TA_WAVES` without W15 rejects the command and places no offers.
- **To resolve:** Decide Q-03-21 (Trade Hub required or not). Deposit the NPC's reserved cargo to the verifier as part of settlement, or teach the signer to use the Guild key. Push a fresh `guild.arrived` after a re-quote if the docked offers must update without a new visit.
- **Found:** 2026-11-10, W15-11

### LED-41 · A guild fill re-quotes in the same turn, not when the intent is FINAL

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/market/guild/maker/guild-maker.service.ts` (`onGuildFill`, `onMatched`), `backend/app/src/market/orders/place-order.service.ts` (`matchAndSettle`), `backend/app/src/market/guild/offers/accept-guild-offer.service.ts`, `shared/sim/src/systems/trade/guild/quote.ts` (`quoteGuild`)
- **What happens:** After a guild fill commits, one in-process queue per NPC writes the cargo cache, `consume`s the filled share of that order's funding hold (never more than was reserved), cancels the quote if it is still open, and rests a new quote from `quoteGuild` with the new inventory. Cash, inventory and the stored loss ceiling are checked again before the new bid (`allowQuote`, the W13 allowance, and `lossAtomic` against `dailyLossAtomic`). The new row's `quoteSeq` is the old one plus one, so `gof:{oldOrderId}:{oldSeq}` is `offer_expired`. A non-positive amount does not write and does not re-quote. W15 off does nothing. Two fills of one NPC cannot both read the old cache: the second waits for the first. Seeded metals at the 2500 target, then a buy of 600, moves the 100-unit metals bid from 194 to 152 minerals. `quoteColony` itself bids lower at the higher inventory; inventory above the target also widens the bid through the existing `thinHalfSpreadBp` (1500). There is no second pricer.
- **Why it is like this:** The 1 second budget is the synchronous call after the match, not a timer and not the relay. FINAL can fail later, and this path does not unwind the cache or the consumed hold. Only the filled side is replaced; the other side keeps its price until it fills or the ship leaves. A fill does not post a realized loss, so the loss ceiling bites only when `lossAtomic` was already at `dailyLossAtomic`. The resting lot stays `maxOrderUnits` (100); recording 600 still adds 600 to the cache. A re-quote does not push `guild.arrived` again.
- **Workaround / mitigation:** Call `onGuildFill` for a guild leg. `recordFill` still only writes cargo and does not re-quote. `TA_WAVES` without W15 skips the turn. A loss already at the ceiling cancels the old bid and does not rest a new one.
- **To resolve:** If a failed intent must restore the cache and the hold, undo them in the same recovery transaction. If both sides should move together, re-quote the pair rather than the filled side. Post a realized loss into `lossAtomic` if that ceiling should bite after a bad fill. Push `guild.arrived` again if the docked offer list must change without a new visit.
- **Found:** 2026-11-10, W15-07

### LED-42 · Guild metrics scrape the cache and the funding book; PnL does not mark inventory

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/market/guild/telemetry/samples.ts` (`guildGaugeSamples`), `backend/app/src/market/guild/telemetry/guild-metrics.ts`, `backend/app/src/market/guild/maker/guild-maker.service.ts` (`gate`), `GET /v1/metrics`
- **What happens:** Each scrape reads `chain.guild_npc` and `chain.guild_funding` and does not write. A restart does not reset the gauges. `guild_inventory{npc,resource}` is whole units. Tier-1 resources with no cache line are 0. An npc id that is not in the table has no series. A sell of 600 from 1400 metals leaves the next scrape at 800, because `recordFill` writes the cache and the scrape reads that row. `guild_cash_atomic` is cap − reserved − spent, or the quote budget when that npc has no funding row yet. `npc=global` is the guild-wide book, not an NPC. `guild_pnl_realized_atomic` is minus `loss_atomic`. A fill does not write `loss_atomic` (LED-41), so a trade leaves realized PnL at 0. `guild_pnl_conservative_atomic` is the same number: these rows have no price, so inventory is marked at 0 and unrealized gains are not added. That is not a cash haircut. `guild_exposure_outstanding_atomic` is the still-reserved cash or inventory, including `global`. `guild_subsidy_allocation_atomic` is `quote_budget_atomic` and is not reduced by spend. `guild_reference_quality` is 0 for every stored NPC. Reference age and eligible volume are not on these tables. `guild_quote_rejected_total` counts `funding_cap`, `killed`, `cash_paused` and `inventory_short` when the maker's gate returns them. Other skip reasons are not counted. The counter is process memory and resets on restart. Amounts above 2^53 are doubles, same as the W13 money gauges. The headless experiment runner does not load these tables; it can call `guildGaugeSamples` with the same row shape, and W15-29 does not yet. A `guild_npc` row that fails the fixture/subsidy check throws from the repository, and that scrape shows no guild gauges. `/v1/metrics` still returns.
- **Why it is like this:** A scrape is restart-safe and does not add a second writer beside the cache. Without a stored price, a conservative mark must not invent an inventory gain. The four counted reasons are the funding gate's pause codes. The experiment runner has no `guild_npc` rows, so this issue does not invent samples for it.
- **Workaround / mitigation:** Read `guild_inventory` for cargo after a fill. Do not treat the PnL gauges or `guild_reference_quality` as a mark-to-market. Rejection totals are since process start only.
- **To resolve:** Post `loss_atomic` on a fill if realized PnL should move (LED-41). Store a reference snapshot if quality should leave 0. Have a later issue call `guildGaugeSamples` (W15-29 does not; LED-44). Decide whether unvalued inventory should omit the conservative series instead of marking it at 0.
- **Found:** 2026-11-11, W15-27

### LED-43 · The 60-planet guild re-quote bench does not measure live host CPU

- **Status:** Open
- **Area / code:** `shared/sim/test/systems/guild-requote-bench.spec.ts` (`guild-60-planets`), `shared/sim/src/systems/trade/guild/quote.ts` (`quoteGuild`), `backend/app/src/market/guild/maker/plan.ts` (`planQuotes`). `npm run bench` (`scripts/economy/bench.ts`) is the W13 matcher only. `scripts/dev/sim-bench.mjs` is still a stub.
- **What happens:** W15-33 asks for 2 NPCs on 60 planets to re-quote within 1 s of a fill and to use under 5% of one core. The bench builds 60 synthetic books in memory (kestrel and vanguard alternating, four Tier-1 barter pairs on each) and times `quoteGuild` on that plan. It asserts the total is under 1000 ms. It does not open Postgres, does not boot 60 planet hosts, and does not sample CPU%. A live re-quote also writes the cargo cache, consumes the funding hold, and inserts orders. Those steps are outside this timer.
- **Why it is like this:** Sixty live Postgres planets are not a default unit test. The number CI can check is the pure re-quote, which is the part that has to stay under 1 s.
- **Workaround / mitigation:** `npx vitest run shared/sim/test/systems/guild-requote-bench.spec.ts`. The log line is `guild-60-planets re-quote <ms> ms`. That wall time is one core of `quoteGuild` only.
- **To resolve:** When a 60-planet host can run, measure CPU% of the maker re-quote (cache, funding, insert, and `quoteGuild`) and keep p99 ≤ 1 s and CPU < 5%.
- **Found:** 2026-11-11, W15-33

### LED-44 · W15-29 guild pricing replay is 20 quotes, not the W13-48 stress suite

- **Status:** Accepted (by design)
- **Area / code:** `shared/sim/src/economy/experiments/guild-pricing.ts` (`replayGuildPricing`), `shared/sim/src/economy/experiments/behaviors/guild-pricing.ts`, `tests/economy/scenarios/guild-pricing.json`, `shared/sim/test/systems/guild-stress.spec.ts`
- **What happens:** Seed 101 runs 20 steps. Each step calls `quoteGuild` on the compiled `guild` policy (`quoteColony` is that function). Inventory is the NPC target. The reference price is null, so the bid pauses (`no_reference` / `no_cash` while `cashEnabled` is 0). The ask's unit cost is the largest whole-unit cost whose reserve-margin ask still fits in `perOrderExposureAtomic`. That cost is not an observed price and not a buyer. Rested ask notionals are summed. The next ask that would pass `globalExposureAtomic` is `funding_cap` and is not added. Exposure after every step stays at or under that cap. Loss stays `0`, which is within `dailyLossAtomic`, because a fill does not post a loss (LED-41). The one recorded guild fill has actor kind `npc` and `organic` false, so `boardRow` classifies it `fixture` and leaves VWAP null. The same seed returns the same quote amounts. The behaviour id `guild-pricing` is one line on the W13 behaviour list. The scenario id is the JSON file the runner already loads. The behaviour does not place colony orders.
- **Why it is like this:** The full W15-29 list does not finish in a unit test. This slice proves the exposure cap on real quotes without inventing a demand curve.
- **Workaround / mitigation:** Re-run `npx vitest run shared/sim/test/systems/guild-stress.spec.ts`. Do not read the result as player demand or as cash approval. The runner still credits the manifest buyer budget onto the w13 host; this behaviour does not spend it (`summary.trades` stays 0, `demandQuotes` stays 0).
- **To resolve:** The full W13-48 / W15-29 suite is still not here: regional specialists, local and remote suppliers, growing army logistics, depot loss, reserve cycling, self-supply versus buy, thin prices, output shocks, buyer-budget shocks, new-colony shocks, restart, held-out seeds, and paired-seed comparison. `guildGaugeSamples` is not called (LED-42). NEAR float caps are not drawn because cash is off.
- **Found:** 2026-11-11, W15-29
### LED-32 · Mercenary squad prices are a proposed default

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/data/mercenary.ts`
- **What happens:** With W22 on, the roster is three NPC accounts. Light (`merc-1.npc.terraagent.mock`) is 4 × `robot.recon` at 100 `metals.t1` per game-hour. Heavy (`merc-2.npc.terraagent.mock`) is 6 × `robot.recon` at 200 `metals.t1` per game-hour. Reserve (`merc-3.npc.terraagent.mock`) matches the light squad and the light price. There is no Tank or Artillery row while W17 is postponed.
- **Why it is like this:** W22-27 names the squad sizes and the `merc-N.npc.terraagent.mock` accounts, but not the price. W22-02 records this proposed price so later hire code reads the table instead of a constant.
- **Workaround / mitigation:** `tune mercenary.<light|heavy|reserve>.pricePerGameHour` changes the price. The value must stay a whole number of a known resource.
- **To resolve:** Owner confirms or replaces the 100 / 200 `metals.t1` per game-hour prices, and whether the third account should stay a second light squad.
- **Found:** 2026-11-10, W22-02

### LED-33 · Mercenary funding cap is a proposed default

- **Status:** Question for the owner
- **Area / code:** `shared/sim/src/data/mercenary.ts` (`fundingCap`), `backend/app/src/near/mercenary/accounts.service.ts`
- **What happens:** Each roster row carries `fundingCap` of 10000 `metals.t1`. W22-27 does not mint that balance. The number is the most that NPC may be paid. There is still no Tank or Artillery row.
- **Why it is like this:** W22-27 requires a finite cap per NPC (NEAR-73) and the table had no cap column. 10000 `metals.t1` is the proposed default, same status as the LED-32 prices.
- **Workaround / mitigation:** `tune mercenary.<light|heavy|reserve>.fundingCap` changes the ceiling. The value must stay a whole number of a known resource. Boot does not credit the account.
- **To resolve:** Owner confirms or replaces 10000 `metals.t1`, and whether the cap is per resource or one shared pool.
- **Found:** 2026-11-10, W22-27
