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

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/sim/src/systems/economy/ledger.ts` (`creditResource`, `debitCost`, `refundCost`), `shared/sim/src/systems/production/index.ts`, `shared/sim/src/systems/harvest/`, `shared/sim/src/systems/terraform-basic/{dismantleAndWork,workJobs}.ts` (W02 `work` / `dismantle` jobs), `tests/scenarios/_loader.ts`
- **Also (terraform rework, 2026-11-02):** the player's terraform yields now take this path too. The Terraform dock only sends `op: 'work'` (and `dismantle`), whose jobs credit Trees `+15 Biomass` / Rock `+8 Metals, +4 Minerals` with `creditResource` (`stepGroundWorkJob`), pay repairs with `payProgressiveSlice` and refund dismantles / cancelled jobs with `refundCost`; the W01 `grade` / `clear` / `break` path posted its yield through the treasury as `terraform.yield` (`terraform-basic/work.ts`). So terraform yields and the stock a t2/t3 deposit found by terraforming later pays out are no longer journaled.
- **Why the work path was not moved to the treasury (terraform rework review, 2026-11-02):** W02 harvest and extractor production credit fractional stock every tick through `creditResource` (a Harvester adds `0.025` per tick), so `col.stock` becomes non-integer. Once a key is fractional, `ColonyTreasury.add` rejects every credit on it (`treasury.ts:125` checks `isMajor(stock[key] + v)` → `invalid_amount` / balance overflow). That would silently drop `terraform.yield` (W01 order path), `construction.refund` and dev grants with a `treasuryRejected` warning in any game where a Harvester or Extractor has run. `clampToCaps` also subtracts fractional stock from the family room, so the credited fit and the overflow can be fractional, which `transferLegs` cannot post. And there are two cap models: the treasury uses `getColonyCaps(state)` (`initialCaps` / `col.caps`), `economy/ledger.ts` `creditResource` the W02 `colony.caps` with its own room rule. So work-job yields, repair costs and dismantle / cancel refunds stay on the W02 helpers, unjournaled, until production posts whole units (an accumulator) or the ledger uses fixed-point units.
- **What happens:** W01's `ColonyTreasury` (`shared/sim/src/economy/treasury.ts`) records whole-unit double-entry postings (`StepResult.postings` → `PlanetJournal`), whereas W02's `economy/ledger.ts` mutates `colony.stock` directly (including fractional per-tick Extractor production such as `0.2 metals.t1`/tick and `37.5` demolish refunds). Scenario setup (`tests/scenarios/_loader.ts`) seeds `PlanetJournal.openingPostings` when a scenario pre-populates `colony.stock` without postings, but runtime W02 `creditResource`/`debitCost`/`refundCost` calls do not emit `LedgerPosting`s, so `PlanetJournal` balances will diverge from `colony.stock` once W02 extractors, harvesters, or queues run.
- **Why it is like this:** `@terra/ledger` enforces whole-unit integer leg amounts (`Number.isSafeInteger`), while W02 extractor output (`1.0/s` = `0.2/tick`) and 50 % / 75 % refunds operate on fractional floats in `colony.stock`.
- **Workaround / mitigation:** `MinimalHud.wholeStock` floors stock for display; scenario loader bridges initial `colony.stock` into `setupPostings`.
- **Seen on the dev server (economy review, 2026-11-03):** every restart logs `ledger/state mismatch on restore of <planet>: the journal does not explain col.stock` for any planet where a Harvester or Extractor ran. Example `pl_01M6EG80PWJJA4Y2N5RHFET9ER` (w02 scenario, one Harvester): ledger `metals.t1 400 / minerals.t1 250 / bio.biomass 150` (the scenario's opening postings, 1 journal row) vs state `500 / 500 / 350`; the snapshot's `production.produced` (`540 / 515 / 355`) shows the gap is exactly the unposted Harvester credits, clamped at the 500 family cap. The same snapshot shows float dust from the fractional credits (`production.capped.metals 3.2e-11`, `produced['minerals.t1'] 515.0000000000043`). After such drift a later whole-unit treasury withdraw (W01 construction spend) can also be refused by the journal (`ledger drift … insufficient_funds`), because the journal never saw the credits. The log is expected until this entry is resolved; it is not a separate bug.
- **To resolve:** either scale `@terra/ledger` units to fixed-point (e.g. basis points / milli-units) or accumulate fractional production in a sub-unit accumulator and route whole-unit credits/debits through `ColonyTreasury`.
- **Found:** 2026-11-02, W01→W02 merge review

