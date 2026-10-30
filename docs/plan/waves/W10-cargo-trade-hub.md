# W10 — Cargo & Trade Hub (F1, mock)

> **Track:** Economy/NEAR (E) · **Flag:** `W10` · **Tag:** `wave-10` · **Scenario:** `scenarios/w10-cargo-trade-hub.ts` · **E2E:** `e2e/w10.spec.ts`
> **Depends on waves:** W02 (resources, storage caps, construction, queue), W06 (named + colony accounts, key store, relayer, `storage_deposit`, dev chain explorer). Uses W00's outbox and contract harness.
> **Specs:**
> - [`NEAR.md`](../../spec/NEAR.md) §1a, §5 (`NEAR-50..55`), §12, §13, §14
> - [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) F1, §2
> - [`SIMULATION.md`](../../spec/SIMULATION.md) `SIM-C-05` and the cargo commands
> - [`PROTOCOL.md`](../../spec/PROTOCOL.md) `cargo.*`, `cargo.status`
> - [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) `chain.cargo_tx`
> - [`colony-economy-and-buildings-spec.md`](../../game/colony-economy-and-buildings-spec.md) §1 rule 2 (brownout shedding, second group), §3.5 (Trade Hub rows)
> - [`units-orders-and-progression-spec.md`](../../game/units-orders-and-progression-spec.md) §4.5 (`UO-TF-01`), §6.2 (side unlock)
> - [`CLIENT.md`](../../spec/CLIENT.md) §8a
> - Decisions: D-18, D-26, D-30, D-34
>
> **Resources (D-34):** every tradable sub-resource is its own cargo token; the token id is its `ResourceKey` (`metals.t1` … `minerals.t3`, `bio.water`, `bio.biomass`, `bio.t2`, `bio.t3`). Energy is grid power and is never cargo. Imports credit any sub-resource into its family's storage, including T2/T3 tiers the colony cannot mine yet. Trade Hub costs read through the D-34 tier rule. In the steps below, "metals" means `metals.t1` (Iron).
>
> **Owned paths:**
> - server: `backend/app/src/near/cargo/**`, `backend/app/src/near/infrastructure/adapters/mock/cargo*`, `backend/app/src/near/__contract__/cargo.contract.ts`
> - sim: `shared/sim/src/systems/trade/**`, `shared/sim/src/data/trade-hub.ts`, `shared/contracts/src/{commands,events}/cargo.ts`
> - client: `frontend/game/features/cargo/**`
> - kitbash (render engine, D-31: visuals only): `frontend/render/kitbash/archetypes/buildings/trade.ts` (new `building.tradeHub`; none of the existing `building.*` archetypes is a trade port), `frontend/render/kitbash/archetypes/units/shuttle.ts` (new `ship.cargoShuttle`)
> - tests: `scenarios/w10-*.ts`, `e2e/w10.spec.ts`
> - uses from W00 without owning: `CargoTokenPort` (W00-30), mock base (W00-32), outbox + relay (W00-37), contract harness (W00-38)

## Goal

A player builds a **Trade Hub** and **exports** colony stock to "cargo in orbit". The server simulation is the mint authority, so export mints NEP-245 cargo tokens to the colony account through the outbox and the mock `CargoTokenPort`. The player can **import** cargo back into storage, which burns it. Exports are limited by mint caps that act as economic pacing. Everything runs on mocks and feels like a shipping port, not a blockchain.

## Demo story (the e2e in words)

1. Open `/play.html?scenario=w10` → a logged-in colony at S2 with 900 `metals.t1` stock, an online Trade Hub T1, and powered storage.
2. Click the Trade Hub → the **Trade Hub panel** opens on Export, showing "Cargo in orbit: 0".
3. Export **300 metals** → stock drops by 300 immediately, a shuttle launches from the hub, and a "Loading cargo…" chip shows (mock latency).
4. After settlement → "Cargo in orbit: 300 metals". `/dev/chain/` shows an `mt_mint` of token `metals.t1` to the colony account by `minter`.
5. Export another 300 metals within the same minute at T1 throughput (250/min) → the request is clamped or rejected with "Port throughput reached, next slot in 34 s" (`mint_cap`). Dev console `cargo.cap.reset <colony>` clears it.
6. Import **200 metals** → a shuttle lands, the stock rises by 200 after the burn settles, and in-orbit drops to 100.
7. Dev console `near.mock.fail cargo 1.0`, then export 50 metals → after retries the export fails, the 50 metals are **refunded** to storage, and a toast explains it. `near.mock.fail cargo 0` restores it.
8. Cut power so the hub is shed (dev console `addLoad 500`, or `time night`) → the Export button disables with "Trade Hub offline".
9. Run `TA_WAVES=..09 npm run dev:restart` and reload `/play.html?scenario=w10` → the Trade Hub disappears from the Construction menu, the existing hub is inert and hidden, and no cargo commands are accepted (`wave_disabled`).

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1–9 (no shuttle launch/land VFX). `W10-30` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** the cargo shuttle archetype and VFX, history rows (W12 history is post), send-to-account (stretch W10-31), the rocket carry-over hook.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

- [x] Cargo commands, module commands, push and events; errors — W10-01
- [x] Trade Hub data rows T1 (+ T2/T3 rows, tier-gated) with economy-spec numbers; prep required; shed group 2 — W10-02
- [x] Trade Hub unlock rule (neighbor contact / Guild visit / S5, plus a demo flag) — W10-03
- [x] Trade Hub sim behaviour: online/offline, throughput meter — W10-04
- [x] `cargo.export`: validate, remove stock, `pendingMint` (`SIM-C-05`) — W10-05
- [x] Mint caps: hub throughput (rolling 60 s) + `CARGO_MINT_CAP_PER_DAY` (`NEAR-53`) — W10-06
- [x] `cargo.settled`: finalize or refund (`NEAR-51`) — W10-07
- [x] Export outbox: `chain.cargo_tx` + `chain_outbox` with `opId` idempotency — W10-08
- [x] `cargo-export` handler on the W00-37 outbox relay → `CargoTokenPort.mint`, settle back to the sim — W10-09
- [x] `MockCargoTokenAdapter` implementing the port methods `mint`, `burn`, `balanceOf`, `transfer` with NEP-245 semantics (18 decimals, minter-only, unrestricted transfers in beta) — W10-10
- [x] Cargo contract suite — W10-11
- [x] `cargo.import`: clamp to free storage, reserve capacity, burn, then credit (`NEAR-52`) — W10-12, W10-13
- [x] Cargo balances API + `cargo.status` push — W10-14
- [x] Rocket carry-over hook: balances listed for `system.arrive` (`NEAR-54`) — W10-15
- [x] Intents deposit path is documented as W13 (`NEAR-55`) — W10-29 (docs)
- [x] Trade Hub kitbash archetype (pillars, playground audit) — W10-16
- [x] Cargo shuttle archetype + launch/land VFX — W10-17, W10-18
- [x] Construction-menu entry + placement with prep bill via the registry — W10-19
- [x] Trade Hub panel: Export / Import, in-orbit balances, pending list — W10-20, W10-21
- [x] Pending / failed / cap UX and error-to-toast map — W10-22
- [x] History and event-log rows for exports and imports (fed to the W12 history) — W10-23
- [x] Brownout behaviour: hub offline rejects exports — W10-04, W10-22
- [x] Analytics funnel — W10-24
- [x] Telemetry `cargo_minted_total`, `cargo_burned_total`, `near_tx_total{kind=mint|burn}` — W10-25
- [x] Dev console commands — W10-26
- [x] Mobile acceptance of the Trade Hub panel — W10-27
- [x] Perf: one export or import costs ≤ 0.1 ms per sim step — W10-28
- [x] README mock/real row F1 + env — W10-29
- [x] Flag-off behaviour — W10-30

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W10-01 | Contracts: commands `cargo.export {resource: ResourceKey, amount}` and `cargo.import {resource: ResourceKey, amount}` (D-34; Energy rejected by the schema); module-only `cargo.settled {ref, ok}`; push `cargo.status {colonyId, inOrbit, pending}`; events `cargoExported`, `cargoImported`, `cargoRefunded`; errors `mint_cap`, `insufficient_stock`, `insufficient_cargo`, `storage_full`, `hub_offline`, `no_trade_hub`; flag `W10`. `CargoTokenPort` is W00-30's (`mint`, `burn`, `balanceOf`, `transfer`), not redefined | contract | S | H | W06-01, W00-08, W00-30 | Run `npm run contracts:check` → cargo commands appear in the generated `CommandKind` union, and `cargo.settled` is marked module-only | SIM-C-05, PROTOCOL cargo, NEAR §1a | TA-10.9 (part) |
| W10-02 | Data rows: Inter-Colony Trade Hub T1 (2×2, 22 s, 100/80/30/10, −6 E/s, 650 HP, throughput 250 units/min), T2 (3×3, 50 s, 280/240/95/30, −16 E/s, 1 750 HP, 900/min), T3 (4×4, 110 s, 780/700/280/90, −42 E/s, 4 500 HP, 3 500/min), all `wave: 'W10'`, tier-gated by Hub tier, costs through the D-34 tier rule; shed group 2; footprint must be Prepared | data | S | H | W10-01 | `compileData` with `W10` on → the Construction catalog lists Trade Hub T1 only, with these numbers (catalog test against the economy spec table) | economy §1 rule 2, §3.5; UO-TF-01 | TA-06.4 (part) |
| W10-03 | Trade Hub unlock rule as data: `tradeHub.unlock = neighborContact(≥S2) \| guildVisit \| S5`, plus a demo override `TRADE_HUB_AT_S2=true`, so single-player demos and W15 Guild visits can unlock it | data | S | H | W10-02 | With `TRADE_HUB_AT_S2=false` at S2 and no neighbor → Trade Hub greyed "Unlocks on first contact"; after dev console `contact.fake` → it unlocks | units §6.2 side unlock | — |
| W10-04 | Sim: Trade Hub behaviour: `online` only when powered and not shed; a rolling 60 s throughput meter per hub; brownout shed group 2 takes it offline | sim | S | H | W10-02 | Scenario with a brownout → the hub's `online` flips false while group 2 is shed and true after power returns (sim unit test) | economy §1 rule 2, NEAR-53 | — |
| W10-05 | Sim: `cargo.export` handler: own colony, ≥1 online Trade Hub, stock ≥ amount, caps OK → remove stock, record `pendingMint {ref, resource, amount, exportSeq}`, emit `cargoExported` to the `near` module | sim | M | H | W10-04, W10-06 | Export 300 metals with 900 in stock → stock is 600 in the same step, and the colony has one `pendingMint` with `exportSeq=1` | SIM-C-05, NEAR-51 | TA-10.9 (part) |
| W10-06 | Sim: mint caps: the per-colony export sum over the rolling 60 s window must stay ≤ the sum of online hub throughput; the per-colony per-sub-resource UTC-day counter must stay ≤ `CARGO_MINT_CAP_PER_DAY` (default 20 000); over cap → `mint_cap {retryInS}` | sim | S | H | W10-01 | At T1, export 250 metals and then 10 more in the same minute → the second is rejected `mint_cap` with `retryInS` > 0; the daily counter test hits the cap at 20 000 | NEAR-53, D-26 pacing | — |
| W10-07 | Sim: `cargo.settled` handler: `ok:true` → clear `pendingMint`; `ok:false` → refund stock even above cap (a one-time overflow, so a failed mint never loses goods) and emit `cargoRefunded` | sim | S | H | W10-05 | Inject `cargo.settled{ok:false}` for a 50-metal export → stock rises by exactly 50 even when storage is full, and `cargoRefunded` is emitted | NEAR-51, PROTOCOL failure table | — |
| W10-08 | Server: on `cargoExported` write `chain.cargo_tx` (EXPORT, PENDING) and a `chain_outbox` row with `opId = cargo-export:{colonyId}:{exportSeq}` in one Postgres transaction | server | S | H | W10-05, W00-37 | Emit the same `cargoExported` twice → one `cargo_tx` and one outbox row exist (unique `opId`) | NEAR §1a rule 6, DATA_MODEL `chain.cargo_tx` | TA-10.9 (part) |
| W10-09 | Server: register a `cargo-export` handler on the W00-37 outbox relay (retry/backoff and `opId` idempotency come from the base) that calls `CargoTokenPort.mint(colonyAccount, resource, amount)` via the relayer; on final → `cargo_tx=FINAL` + `cargo.settled{ok:true}`; after the base's last retry fails → `FAILED` + `cargo.settled{ok:false}` | server | S | H | W10-08, W10-10, W00-37 | Kill the app between the mint and the settle, then restart → the mint is not repeated (same `opId`), and the colony receives exactly one `cargo.settled` | NEAR-51, rule 6 | TA-10.9 (part) |
| W10-10 | `MockCargoTokenAdapter` on the W00-32 mock base (Postgres `mock_chain_mt_balance`, `mock_chain_mt_event`) implementing the port methods `mint` / `burn` (only by `minter`), `balanceOf`, `transfer` (unrestricted in beta) with NEP-245 semantics (events named `mt_mint` / `mt_burn` / `mt_transfer`), token ids = the 10 `ResourceKey`s (one per tradable sub-resource, D-34), 18-decimal base units, `storage_deposit` required (from W06-12), `mock:` hashes; binding `NEAR_ADAPTER_CARGO` | server | M | H | W06-10, W10-01, W00-32 | Call `mint` as a non-minter → `NEAR_UNAUTHORIZED_MINTER`; mint 300 `metals.t1` → `balanceOf` returns `300 × 10^18`; transfer to another colony account works | NEAR-50, §1a rule 4 | TA-10.9 (part) |
| W10-11 | Contract suite `cargo.contract.ts` on the W00-38 harness: mint/burn/balance/transfer, minter-only, burn > balance fails, idempotent by `opId`, decimals; runs against the mock in CI; W23-20 runs this same suite against the real adapter | test | S | H | W10-10, W00-38 | `npm run test:contract -- --port cargo` → all cases pass against the mock | NEAR §1a rule 5, §15 | TA-10.8 (part) |
| W10-12 | Sim: `cargo.import`: clamp the amount to free storage at request time, **reserve incoming capacity**, emit `cargoImportRequested`; on `cargo.settled{ok:true}` credit the stock and release the reservation; on failure release only | sim | M | H | W10-04 | Storage has 150 free and the player imports 200 → the request is clamped to 150 with a notice "Only 150 fits", and after settle the stock is +150 | NEAR-52 | TA-10.9 (part) |
| W10-13 | Server: import flow: a `cargo-import` handler on the W00-37 outbox (`opId = cargo-import:{colonyId}:{importSeq}`) → `CargoTokenPort.burn` (colony key via relayer) → `cargo.settled`; `insufficient_cargo` when the in-orbit balance is too small | server | S | H | W10-12, W10-10, W00-37 | Import 200 with only 100 in orbit → rejected `insufficient_cargo` before any burn; import 100 → one `mt_burn` in `/dev/chain` | NEAR-52 | — |
| W10-14 | Server: `GET /v1/near/cargo` (per colony: in orbit, pending export, pending import, today's minted vs cap) and push `cargo.status` on every change | server | S | H | W10-09, W10-13 | After the demo export → the endpoint returns `inOrbit.metals = 300` and `pending = []`, and the client receives one `cargo.status` push | PROTOCOL `cargo.status`, NEAR §13 | — |
| W10-15 | Rocket carry-over hook: `cargoBalancesFor(playerId)` used by `system.arrive` (the W21 consumer) lists every colony account's in-orbit balances; it is a no-op until W21 | server | S |  | W10-14 | Unit test: a player with two colony accounts → the hook returns the summed in-orbit balances per account | NEAR-54 | TA-06.10 (part) |
| W10-16 | New kitbash archetype `building.tradeHub` T1 (no existing `building.*` covers it; reuse the `building.supplyDepot` crate/pad greebles): landing pad, cargo cranes, comm mast as the silhouette breaker, ≥7 parts, 60/30/10 materials, `minY == 0`, < 3.5k tris; built in `frontend/render/kitbash/archetypes/buildings/trade.ts` and registered with one `reg(...)` line in `buildings/index.ts` (explicit list, no auto-discovery); `npm run validate:models -- building.tradeHub` must report 0 errors and 0 warnings | visual | M | H | — | Open `/playground.html?inspect=building.tradeHub` → the 4-view audit passes (iso/front/side/top, minY 0.000, tri count < 3.5k) | AGENTS.md pillars 1, 4 | — |
| W10-17 | New kitbash archetype `ship.cargoShuttle` (small VTOL hauler, ≥7 parts, emissive thrusters; shares hull greebles with the existing `ship.dropPod`), validator 0 errors / 0 warnings | visual | S |  | — | Open `/playground.html?inspect=ship.cargoShuttle` → the 4-view audit passes | AGENTS.md pillar 1 | — |
| W10-18 | VFX: shuttle launch on export and landing on import from the hub pad (instanced, pooled, ≤ 2 s, thruster glow, dust ring); one shuttle per settle, not per unit — reuse `ship.dropPod`/`ship.dropPodShell` and the descent `Flames` + `GroundFX` | visual | S |  | W10-16, W10-17, W10-20 | Export in the demo → a shuttle lifts off the pad and fades into the sky within 2 s; import → one lands | CLIENT §8a | — |
| W10-19 | Client: Construction-menu registration for Trade Hub (category Economy) via the feature registry, with ghost footprint and prep bill (W05/W01 placement UX) and the unlock hint from W10-03 | client | S | H | W10-02, W10-03 | Open Construction → Economy → the Trade Hub tile shows cost, size and the unlock reason; placing it creates a construction order with linked prep | units §4.1, UO-TF-03 | TA-11.8 (part) |
| W10-20 | Client: Trade Hub panel shell (click a hub): Export / Import tabs, in-orbit balances per sub-resource grouped by family ("Cargo in orbit: Metals · Iron 1 200"), hub tier and throughput meter, today's minted vs cap | client | M | H | W10-14 | Click the hub in the demo → the panel shows the in-orbit balances grouped Metals / Minerals / Bio with a row per held sub-resource, the throughput meter, and "Today 300 / 20 000 metals" | CLIENT §8a F1 | — |
| W10-21 | Client: Export and Import forms: resource picker (family, then tier), amount slider bounded by stock or in-orbit balance and by caps or free storage, preview line ("Stock 900 → 600, Orbit 0 → 300"), confirm | client | M | H | W10-20 | Drag the slider past the cap → it stops at the cap and shows the reason; confirming sends exactly one command | NEAR-51, NEAR-52 | — |
| W10-22 | Client: pending, failed and cap UX: "Loading cargo…" and "Unloading…" chips, refund toast, `mint_cap` toast with countdown, `hub_offline` disabled state, an error-code → text map for every W10-01 error | client | S | H | W10-21 | Force each error code via the dev console → each shows its distinct text, and the Export button disables while the hub is shed | PROTOCOL failure table | — |
| W10-23 | History: emit `history.cargo` rows (exported, imported, refunded) to the HUD event log and to the player-history feed consumed by W12 | server | S | H+ | W10-09, W10-13 | Complete the demo → the event log shows "Exported 300 metals to orbit" and "Imported 200 metals", and `GET /v1/me/history` (if W12 is on) contains both | player-profile §1 History | — |
| W10-24 | Analytics: `cargo_export_requested`, `cargo_export_settled`, `cargo_export_failed`, `cargo_import_requested`, `cargo_import_settled`, `mint_cap_hit` | client | S |  | W10-22 | Run the demo story → those events appear with resource and amount props | CLIENT §10 | — |
| W10-25 | Telemetry: `cargo_minted_total{resource}`, `cargo_burned_total{resource}`, `near_tx_total{kind=mint\|burn,result}`, `cargo_refunds_total` | server | S |  | W10-09, W10-13 | After the demo → `/metrics` shows minted metals 300 and burned 200 (in units, not base units) | NEAR §14 | — |
| W10-26 | Dev console: `cargo.grant <colony> <res> <amt>` (mint without stock, dev only), `cargo.cap.reset <colony>`, `tradehub.spawn` (instant online T1 hub); failure injection uses W06-25's `near.mock.fail cargo <rate>` (no cargo-specific fail command) | server | S | H | W10-09, W06-25 | `tradehub.spawn` then `cargo.grant me metals.t1 500` → a hub appears and "Cargo in orbit: Metals · Iron 500" | PRODUCT_WAVES §3 | — |
| W10-27 | Mobile acceptance: the Trade Hub panel opens as a bottom sheet in phone landscape; the slider and buttons are touch-sized | client | S |  | W10-21 | Run the e2e at 844 × 390 with touch → the export and import steps pass | D-22 | — |
| W10-28 | Perf check: the sim cost of export/import commands and the throughput meter ≤ 0.1 ms per step with 10 hubs (bench case added to `sim:bench`) | test | S |  | W10-05, W10-12 | `npm run sim:bench -- --case cargo-10-hubs` → p99 step delta ≤ 0.1 ms | SIMULATION perf budget | — |
| W10-29 | Docs: README "mock vs real" row F1 (`CargoTokenPort` = mock); `ENVS.md` entries `NEAR_ADAPTER_CARGO`, `CARGO_MINT_CAP_PER_DAY`, `TRADE_HUB_AT_S2`; a note that the Intents deposit path (`NEAR-55`) is W13/W23 | docs | S |  | W10-11 | README lists `CargoTokenPort` as "mock", and `ENVS.md` has the three env vars with defaults | NEAR-55, D-27 | — |
| W10-31 | Send cargo to another account (open transfers in beta, D-26): `cargo.transfer {to, resource, amount}` via `CargoTokenPort.transfer` + outbox, recipient picker (colonies on the planet + named account), receipt in history | client | S | H+ | W10-09, W10-21 | Send 50 metals to colony B → B's cargo panel shows +50 and both histories show the transfer | NEAR §5, D-26 | — |
| W10-30 | Wave e2e `e2e/w10.spec.ts` (demo story 1–9, including the flag-off check) + seed scenario `w10-cargo-trade-hub` (logged-in colony at S2, 900 `metals.t1`, an online powered Trade Hub T1, storage room) + tag `wave-10` | test | M | H | W10-01…W10-29 | `npm run e2e -- --waves ..10` → W00–W10 suites pass | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w10.spec.ts` passes, and every earlier wave's e2e still passes.
- `?scenario=w10` loads; `TA_WAVES=..09` hides the Trade Hub, the cargo panel and the cargo commands (`wave_disabled`). Existing hubs are inert, not deleted.
- The cargo contract suite passes on the mock. A restart during an export never double-mints.
- Tag `wave-10` created.
