# 02 — Mining, cargo and mint authority (F1)

> **Status:** 2026-10-31, grooming reference, pass 2 (legend, precedence and abbreviations: [`README.md`](./README.md)). Scope: planet deposit → colony stock → `cargo.export` (mint) / `cargo.import` (burn), mint caps, idempotency, the exceptions to mint authority, token ids, the supply ledger. Trading of cargo is owned by [`./03-markets-trading-rules.md`](./03-markets-trading-rules.md); adapters, the Intents deposit path, env names, the outbox table and contract suites by [`./06-near-tools-and-adapters.md`](./06-near-tools-and-adapters.md); the treasury burn by [`./05-deed-staking-treasury-bounties.md`](./05-deed-staking-treasury-bounties.md). Balance numbers: [`../economy-balance-simulation.md`](../economy-balance-simulation.md).

## 1. Purpose

Mining is the only source of value in the game loop: extractors, harvesters and terrain ops fill colony storage, and storage caps force the player to *spend, export or lose it* (Balance §2, §7.1). Export at a Trade Hub turns stock into NEP-245 cargo on the colony account ("Cargo in orbit"), which F2 markets and the Guild trade. Import turns cargo back into stock. The server simulation decides every unit that reaches the chain (D-26), and the Trade Hub is the only door (NEAR §1 principle 3).

## 2. Actors and accounts

| Actor | Role in this file | Signs / pays | Source |
|---|---|---|---|
| Server sim (`game` module) | Produces stock, removes it on export, records `pendingMint`, refunds or credits on `cargo.settled` | — | SIM-C-05 |
| `near` module | Writes `chain.cargo_tx` + outbox row, calls `CargoTokenPort`, answers `cargo.settled` | — | NEAR-51, W10-08/09 |
| `minter.terraagent.near` | Only caller of `mt_mint` / `mt_burn` ("the port service account", NEF F1) | relayer pays gas | NEAR-50, NEF F1, NEAR §12 |
| Colony account `{colony}.{name}.terraagent.near` | Holds cargo; NEAR-52 / W10-13 have it sign the import burn with the colony key (Q-02-3) | relayer (NEP-366) | NEAR-52, W10-13 |
| `res.terraagent.near` | The one NEP-245 contract, 10 token ids | — | NEAR-50 |
| Guild NPC accounts | Receive seed cargo minted without stock | owner treasury | NEAR-73, W15-05 |
| Developer | `cargo.grant` (mint without stock), `cargo.cap.reset`, `tradehub.spawn` | — | W10-26 |

## 3. Rules

| # | Rule | Status | Source |
|---|---|---|---|
| R02-1 | The server sim is the only mint authority: cargo is minted only from simulated stock exported at a Trade Hub; no client claim mints | Decided | NEAR §1 p.2, D-26, NEF §2, PROTOCOL §7, MP §1 |
| R02-2 | `cargo.export` is the only path from sim stock to the chain | Decided | SIM-C-05 |
| R02-3 | Each spawn slot gets, within 12 tiles, ≥ 1 metals, 1 minerals and 1 oil deposit (richness 9 000–12 000 bp) and a buildable 7×7 area; metals within r8 | Decided (value proposed) | SIM §10; W01-06, W01-07 (H) |
| R02-4 | Planet modifiers on richness: Desert Metals/Minerals +15 %, Ocean Bio +20 % / Metals −15 %, Temperate Minerals +15 %; Water Extractor ×0.5 on Desert. The hackathon generates `temperate` only | Decided (value proposed) | D-33, econ §3 "Planet modifiers", SIM §10, D-27; W05-17 (—) |
| R02-5 | A meteor has a 30 % chance to create a new deposit | Decided (value proposed) | SIM §7.6; W05-16 (—) |
| R02-6 | Extractors must cover their deposit; output = table rate × richness × `ECONOMY_RATE_SCALE`, only while powered; halts at the family cap | Decided | econ §3.4, SIM §7.1, W02-08 (H) |
| R02-7 | Harvesters take the nearest surface deposit of the most-needed family, T1 only, credited straight to storage (no hauling); Clear/Break give lump yields (+5 `bio.biomass`, +10 `metals.t1`) | Planned | W02-12 (H), W01-13 (H), SIM §7.2 |
| R02-8 | Three families (Metals, Minerals, Bio), 10 sub-resources keyed by `ResourceKey`; Energy is grid power, not a family | Decided | D-34, SIM-G-RES |
| R02-9 | T2 output needs colony Terraform ≥ 30 % and ≥ 50 % Irrigated/Living in the deposit ring (r2); T3 needs ≥ 70 % and ≥ 50 % Living; split 70/30 and 50/30/20; Mk tier scales rate only | Decided (value proposed) | D-34, econ §3.0; W05-34 (H) |
| R02-10 | Bio sources: Water Extractor → `bio.water`; Harvester → `bio.biomass` (+ `bio.t3` on Living under T3 gates, marked proposed in econ §3.0); Petroleum Well → `bio.t2` only under T2 gates | Decided | D-34, econ §3.0; W03-30 (H+) |
| R02-11 | One storage cap per family, shared by its sub-resources (sum rule marked proposed); Command Hub T1 +500 / T2 +1 500, Depot +1 000 / 3 500 / 12 000 to all three families | Decided | econ §1 rule 4, §3.5; SIM §7.1; W02-02 (H) |
| R02-12 | One NEP-245 contract `res.terraagent.near`; token id = `ResourceKey` (10 ids); 18 decimals; Energy is not a token | Decided | NEAR-50, D-34, PROTOCOL §4.5 |
| R02-13 | `mt_mint` / `mt_burn` are callable only by `minter.*`; a non-minter call fails `NEAR_UNAUTHORIZED_MINTER` (mock) | Decided | NEAR-50, NEF F1; W10-10 (H), W23-17 (H2) |
| R02-14 | Transfers are unrestricted in beta | Decided | NEAR-50, D-26 |
| R02-15 | T1 tokens trade from day one; a colony can import T2/T3 it cannot mine; only colonies that mine a tier can mint it (re-export of imported T2/T3 from stock is not addressed, Q-02-15) | Decided | NEAR-50, NEF F1 |
| R02-16 | Trade Hub T1/T2/T3 rows (2×2/3×3/4×4, throughput 250/900/3 500 per min), costs read through the D-34 tier rule; footprint must be Prepared; Trade Hub T1 required for trades | Decided | econ §3.5, D-19, SIM §7.1; W10-02 (H) |
| R02-17 | Unlock: first `neighborContact` at ≥ S2, or first Guild visit, or S5; demo flag `TRADE_HUB_AT_S2` | Decided | units §6.2 side unlock; W10-03 (H) |
| R02-18 | The hub is online only when powered and not shed; brownout shed group 2 takes it offline; export then fails `hub_offline` | Decided | econ §1 rule 2; W10-04, W10-22 (H) |
| R02-19 | Export checks own colony, ≥ 1 online hub, stock ≥ amount, caps; removes stock in the same step; records `pendingMint {ref, resource, amount, exportSeq}` | Decided | NEAR-51, SIM-C-05; W10-05 (H) |
| R02-20 | `cargo.settled {ok:true}` clears `pendingMint`; `{ok:false}` (after retries) refunds the stock | Decided | NEAR-51, PROTOCOL §10 |
| R02-21 | A failed mint refunds even above the storage cap (one-time overflow) | Planned | W10-07 (H) · spec gap (W13 note) |
| R02-22 | Throughput cap: per-colony export ≤ Trade Hub throughput (NEAR-53); W10-06 reads it as a rolling 60 s window ≤ the sum of online hubs, W10-04 keeps a meter per hub (Q-02-5) | Decided | NEAR-53; W10-04, W10-06 (H) |
| R02-23 | Daily cap per colony per sub-resource, `CARGO_MINT_CAP_PER_DAY`, default 20 000; the UTC-day boundary is stated only in W10-06 | Decided (value proposed) | NEAR-53, NEAR §12; W10-06 (H) |
| R02-24 | Over a cap → `mint_cap {retryInS}`; caps are economic pacing, not security | Decided | NEAR-53, NEAR §1 p.5, D-26 |
| R02-25 | Every chain write goes to an outbox row written in the same Postgres transaction as the game change, with a deterministic `opId` (`cargo-export:{colonyId}:{exportSeq}`, `cargo-import:{colonyId}:{importSeq}`). Table name differs across sources → Q-06-15 | Decided | NEAR §1a rule 6; code: `shared/db/prisma/chain-outbox.prisma` (W00-37); W10-08, W10-13 (H) |
| R02-26 | Real adapter: the mint memo carries `opId`; the relay checks for an existing receipt before a retry | Planned | W23-19 (H2) |
| R02-27 | Import burns from the colony account; on final the sim credits stock capped by storage, overflow stays in orbit | Decided | NEAR-52 |
| R02-28 | Import clamps to free storage at request time, reserves incoming capacity, releases it on failure; `insufficient_cargo` before any burn | Planned | W10-12, W10-13 (H) |
| R02-29 | "In orbit" = colony account + free verifier balance; import withdraws from the verifier first | Planned | W13-16 (H) → [03](./03-markets-trading-rules.md) R03-35 |
| R02-30 | Rocket carry-over: cargo stays on the colony account and follows the player; `system.arrive` lists it (post-hackathon) | Decided | NEAR-54; W10-15 (—) |
| R02-31 | Exception: Guild NPC initial cargo is minted by `minter` without sim stock; no amount in any row | Decided | NEAR-73; W15-05 (H), W23-28 (—) |
| R02-32 | Exception: dev `cargo.grant` mints without stock; the dev console is off in production builds | Planned | W10-26 (H); DEV_TOOLS intro |
| R02-33 | Exception: mock → real migration re-mints mock balances on chain | Planned | W23-41 (—) |
| R02-34 | Cargo enters the verifier by `mt_batch_transfer_call` to `intents.near`, balance id `nep245:res.terraagent.near:<ResourceKey>` (docs [X2][X3], 2026-10-31, not yet tested by a call); NEAR-55, W23-17, W23-21 and W23-38 say `mt_transfer_call` | Conflict | Conflict → Q-06-1 (owner 06, R06-6) |
| R02-35 | No anti-cheat / anti-bot; cargo open (swappable for NEAR/USDC) in beta; farm-bot value extraction is an accepted risk | Decided | D-25, D-26 |
| R02-36 | Mock adapter: Postgres ledger, `mock:` hashes, 300–1 500 ms latency, injectable failure (`near.mock.fail cargo <rate>`; code: `NEAR_MOCK_INJECTED_FAILURE` in `backend/app/src/near/domain/errors.ts`) | Decided | NEAR §1a rule 4; W10-10 (H), W06-25 |
| R02-37 | Real F1 only in H2 after the D10 gate and the green F5 suite: the cargo suite on testnet, then a mainnet smoke (mint and burn 1 unit) | Decided | D-27, NEAR §12; W23-18, W23-20 (H2) |
| R02-38 | Daily mint cap 10 000 instead of 20 000 | Proposed | Balance §8, Review C8, Pivot Bet B |
| R02-39 | Storage caps per sub-resource (T1 = family cap, T2/T3 = half) | Proposed | Balance §8 |
| R02-40 | T2/T3 gate as 100 / 230 Living tiles (count, not share); Petroleum Well unlock at S4; Clear yield 25 biomass | Proposed | Balance §8 |
| R02-41 | Guild T2 restock +300 per T2 sub-resource per NPC per day (a further mint without stock if done by `minter`) | Proposed | Balance §7.2, §8 |
| R02-42 | Starting kit 400 / 300 / 200 / 150 | Proposed | Balance §8 |
| R02-43 | Starting kit: SIM §7.3 `400 / 250 / 150 / 150` (OWNER_TASKS R11 picks it; fits the 500 cap) vs W01-09 `600 / 350 / 200 / 200` | Conflict | Conflict → Q-02-19 |
| R02-44 | The ten-NEP-141 fallback is not needed per the Intents docs | Proposed | 06 R06-8, Q-06-4 |
| R02-45 | The economy touches the chain at one door, the Trade Hub; production, combat and terraforming stay in the sim | Decided | NEAR §1 p.3, NEF §1 |
| R02-46 | Deposits never deplete: no depletion rule exists in SIMULATION, econ or W02/W03 | Gap | Q-02-20 |
| R02-47 | Harvester on Living ground +0.5 biomass/s from S4 (`bio.t3` still only at T3) | Proposed | Balance §8 |
| R02-48 | Carry-over amount: NEAR-54 moves all in-orbit cargo; WP §8 says "part of the cargo"; W21-13 gives pod stock ×1.25 (750/437/250/250 = 1.25 × the W01-09 kit) | Conflict | Conflict → Q-02-21; W21-12, W21-13 (—) |
| R02-49 | When NEAR or the verifier is unreachable, cargo commands are rejected `market_unavailable`; an export accepted before that settles async through the outbox. Landed code has `NEAR_UNAVAILABLE` (503, "retry with the same opId") | Decided | NEAR §1 p.4, PROTOCOL §10; code: `backend/app/src/near/domain/errors.ts` |
| R02-50 | Adapter env: code key is `NEAR_ADAPTER_CARGO_TOKEN`; W10-10 (binding), W10-29, W23-01 (acceptance), W23 demo step 2 and W23-42 write `NEAR_ADAPTER_CARGO` (fail-closed: the wrong name silently selects mock) | Conflict | Conflict → Q-06-11; code: `backend/app/src/near/infrastructure/adapter-selection.ts` |
| R02-51 | Mock ledger tables: code has `mock_chain_balance` (+ `mock_chain_receipt`); W10-10 names `mock_chain_mt_balance`, `mock_chain_mt_event` | Conflict | Conflict → Q-02-22; code: `shared/db/prisma/mock-chain.prisma` |
| R02-52 | W10 demo step 3 and W10-05 export 300 at a T1 hub (250/min); W10-06 rejects anything over 250 in the window | Conflict | Conflict → Q-02-18 |
| R02-53 | Burn is minter-only (R02-13), yet the import burn (NEAR-52), the proposed Guild off-planet sale (Balance §7.2) and the treasury project burn (MP §0) start from non-minter accounts | Conflict | Conflict → Q-02-3, Q-05-11 |

## 4. Flows

**Export, happy path.** Player picks family → tier → amount (slider bounded by stock and caps, W10-21) → `cargo.export` → sim validates (R02-19) and removes stock in the step → `cargoExported` → `near` writes `chain.cargo_tx` (EXPORT, PENDING) + outbox row in one transaction (W10-08) → relay calls `CargoTokenPort.mint(colonyAccount, resource, amount)` via the relayer (W10-09) → final → `cargo_tx=FINAL`, `cargo.settled{ok:true}` → `pendingMint` cleared → `cargo.status` push, "Cargo in orbit: Metals · Iron 300" (W10-14, W10-20).

**Export, failure paths.**
1. No hub / hub shed → `no_trade_hub` / `hub_offline`; button disabled (W10-22).
2. Stock short → `insufficient_stock` (W10-01; SIM-C-02 lists only `insufficient_resources`, Q-02-7).
3. Rolling 60 s or daily cap exceeded → `mint_cap {retryInS}`, toast with countdown (W10-06, W10-22). Demo step 5 says "clamped or rejected"; W10-06 says rejected (Q-02-8). The demo's first export of 300 already exceeds T1's 250 (Q-02-18).
4. Mint fails after the outbox base's last retry → `cargo_tx=FAILED`, `cargo.settled{ok:false}` → stock refunded even above storage cap, `cargoRefunded`, toast (W10-07, W10-09).
5. App killed between mint and settle → relay replays with the same `opId`, no second mint, one `cargo.settled` (W10-09, W23-19).
6. App killed after the outbox row is committed but before the next sim snapshot → sim restores a snapshot without the export (SIM-H-07, ≤ 60 s lost) while the outbox still mints (Q-02-1).
7. NEAR or the verifier unreachable → NEAR §1 p.4 and PROTOCOL §10 agree: the command is rejected `market_unavailable`, gameplay continues; an export accepted earlier stays in the outbox and settles when the chain returns (R02-49). Open: how "unreachable" is detected before accepting, and W10-01 does not list the code (Q-02-6).

**Import, happy path.** `cargo.import` → server checks in-orbit balance (`insufficient_cargo` before any burn) → sim clamps to free family storage ("Only 150 fits") and reserves it, emits `cargoImportRequested` → outbox `cargo-import:{colonyId}:{importSeq}` → `CargoTokenPort.burn` → final → `cargo.settled{ok:true}` → stock credited, reservation released (W10-12, W10-13). From W13: if the account balance is short, withdraw from the verifier first (W13-16, see [03](./03-markets-trading-rules.md)).

**Import, failure paths.** Burn fails → reservation released, no credit (W10-12). Storage full → `storage_full` (W10-01). Chain unreachable → `market_unavailable` (R02-49). Hub shed during a pending import: not specified (Q-02-10).

## 5. Numbers

| Value | Number | Source | Status |
|---|---|---|---|
| Deposit richness | 9 000–12 000 bp; no depletion | SIM §10, W01-06; Q-02-20 | Decided (value proposed) |
| Metals Extractor T1/T2/T3 | +4.0 / 12.5 / 38.0 per s × richness × scale | econ §3.4 | Decided |
| Minerals Quarry T1/T2/T3 | +3.0 / 9.5 / 30.0 per s | econ §3.4 | Decided |
| Petroleum Well T1/T2/T3 | +2.5 / 8.0 / 25.0 `bio.t2`/s, T2 gates only | econ §3.4 | Decided |
| Water Extractor T1/T2/T3 | +3.5 / 11.0 / 34.0 `bio.water`/s (×0.5 Desert) | econ §3.4 | Decided |
| Harvester | 2.0 × scale res/s | W02-12 (H) | Planned |
| Harvester on Living | +0.5 biomass/s from S4 | Balance §8 | Proposed |
| `ECONOMY_RATE_SCALE` | 0.25 (Extractor T1 → 1.0/s) | Balance §1 (citing units §6.4) | Decided |
| Storage | Command Hub T1 +500 / T2 +1 500; Depot +1 000 / 3 500 / 12 000 per family | SIM §7.1, econ §3.5 | Decided |
| Trade Hub throughput | 250 / 900 / 3 500 units per min | econ §3.5, NEAR-53 | Decided |
| Trade Hub T1 | 2×2, 22 s, 100/80/30/10, −6 E/s, 650 HP | econ §3.5, W10-02 | Decided |
| Daily mint cap | 20 000 per sub-resource per colony per day | NEAR §12, W10-06 | Decided (value proposed) |
| Daily mint cap (balance doc) | 10 000 | Balance §8, Review C8, Pivot Bet B (= R02-38) | Proposed |
| Token decimals | 18 | NEAR-50 | Decided |
| Mock latency | 300–1 500 ms | NEAR §1a rule 4 | Decided |
| Mint / burn gas | ≈ 0.0005–0.002 NEAR each, relayer pays | NEAR §12 (estimate; W23-16 measures) | Decided (value proposed) |
| Snapshot cadence | 60 s | SIM-H-06 | Decided |
| Planet supply per week (5 colonies, Model B) | ≈ 1.77 M minted at cap 20 k; ≈ 0.99 M at cap 10 k | Balance §7.2 | Proposed |

Balance context: at T1 throughput (360 000/day) the daily cap binds after ≈ 80 min of saturated export; one Extractor T1 makes 86 400 metals/day (Balance §7.1). **Pivot season** (Pivot "The living season"): five 5-colony dev planets, so five independent supplies. The Guild is the only cross-planet route (NEAR-72), but its carry is post-hackathon (W15-10 (—)), so in the season nothing bridges them unless the off-planet sale row (Balance §7.2) is added.

## 6. On-chain vs app vs sim

| State | Lives in | Truth |
|---|---|---|
| Deposits, richness, stock, storage caps, tier gates, `pendingMint`, import reservation, cap counters (W10-06 is a sim issue) | sim state (snapshots) | server sim |
| `chain.cargo_tx`, outbox row (name → Q-06-15) | Postgres | app |
| Cargo balances on the colony account | `res.terraagent.near` (mock: `mock_chain_balance`, R02-51) | chain |
| Cargo deposited in the verifier | `intents.near` | chain ([03](./03-markets-trading-rules.md)) |
| In-orbit view | `GET /v1/near/cargo`, `cargo.status` push | read model (W10-14) |

### Supply ledger (every mint and burn path)

| Path | Direction | Signer | Cap | Status | Source |
|---|---|---|---|---|---|
| Export at a Trade Hub | mint | `minter` | hub throughput + daily cap | Decided | NEAR-51, NEAR-53; W10-09 (H) |
| Guild seed inventory | mint | `minter` | "capped in size", no number | Decided | NEAR-73; W15-05 (H) |
| Dev `cargo.grant` | mint | `minter` via port | none (dev only) | Planned | W10-26 (H) |
| Mock → real migration | mint | `minter` | equals mock balance | Planned | W23-41 (—) |
| Guild T2 restock | mint (if by `minter`) | unstated | +300 / T2 key / NPC / day | Proposed | Balance §8 |
| Import at a Trade Hub | burn | `minter` (NEAR-50) vs colony key (NEAR-52) | free storage | Conflict | Q-02-3 |
| Guild off-planet sale | burn or hold (unstated) | Guild key cannot `mt_burn` | 10 % of stock per visit | Proposed | Balance §7.2 |
| Treasury project cost | burn | DAO cannot `mt_burn` | project cost | Proposed | MP §0; 05 R05-46, Q-05-11 |

Market trades, fee legs, the treasury leg and bounty escrow are transfers, not sinks (owned by 03 and 05). Only the export path carries a cap tied to production; the Guild seed and restock are unbounded by any row (Q-02-13).

## 7. Wave map

**W10 card.** Deps: W02 (resources, storage caps, construction), W06 (accounts, relayer, `storage_deposit`), W00 outbox + contract harness · `@hack` demo steps 1–9 (no shuttle launch/land VFX; W10-30 tags them) · DoD: `e2e/w10.spec.ts` and every earlier e2e pass; `TA_WAVES=..09` hides hub, panel and commands (`wave_disabled`); cargo contract suite passes on the mock; a restart during an export never double-mints; tag `wave-10`.
**W23 F1 card.** Deps: W23-16 relayer suite green on the real chain (F5 gate), W23-04 accounts and keys · demo step 2 (export 1 metal → real NEP-245 mint, nearblocks link) · gate: the port goes real only after W23-20 is green; W23-20 is the F1 gate before any F2 swap; tag `wave-23-cargo`.

| Issue | H | Rule(s) | Note |
|---|---|---|---|
| W10-01 contracts, errors | H | R02-19, R02-24, R02-28, R02-49 | error names differ from SIM-C-02 (Q-02-7); no `market_unavailable` (Q-02-6) |
| W10-02 Trade Hub rows | H | R02-16 | |
| W10-03 unlock rule | H | R02-17 | default of `TRADE_HUB_AT_S2` unstated (Q-02-12) |
| W10-04 online/offline, meter | H | R02-18, R02-22 | "meter per hub" vs "sum" (Q-02-5) |
| W10-05 export handler | H | R02-19 | acceptance exports 300 at T1 (Q-02-18) |
| W10-06 mint caps | H | R02-22, R02-23, R02-24 | UTC day in the sim vs SIM-D-06 (Q-02-4) |
| W10-07 settle / refund | H | R02-20, R02-21 | |
| W10-08 cargo_tx + outbox | H | R02-25 | |
| W10-09 relay handler | H | R02-25, R02-20 | |
| W10-10 mock adapter | H | R02-12, R02-13, R02-14, R02-36, R02-50 | table names vs landed schema (R02-51); binding `NEAR_ADAPTER_CARGO` (R02-50) |
| W10-11 contract suite | H | R02-13, R02-25 | reused by W23-20 |
| W10-12 import (sim) | H | R02-27, R02-28 | pre-burn clamp vs NEAR-52 overflow-in-orbit |
| W10-13 import (server) | H | R02-28, R02-53 | burn signer (Q-02-3) |
| W10-14 balances API + push | H | R02-29 (account part) | |
| W10-15 carry-over hook | — | R02-30, R02-48 | no-op until W21 |
| W10-16 `building.tradeHub` | H | — (visual) | |
| W10-17 `ship.cargoShuttle` | — | — (visual) | |
| W10-18 shuttle VFX | — | — (visual) | |
| W10-19 Construction entry | H | R02-16, R02-17 | |
| W10-20 panel shell | H | R02-23 (display) | |
| W10-21 export/import forms | H | R02-22, R02-28 | |
| W10-22 pending/failed/cap UX | H | R02-18, R02-24 | |
| W10-23 history rows | H+ | — | |
| W10-24 analytics | — | — | |
| W10-25 telemetry | — | — | |
| W10-26 dev console | H | R02-32 | `cargo.grant` against a real adapter (Q-02-2) |
| W10-27 mobile | — | — | |
| W10-28 perf | — | — | |
| W10-29 docs, envs | — | R02-50 | writes `NEAR_ADAPTER_CARGO` (Q-06-11); `ENVS.md` does not exist yet |
| W10-31 `cargo.transfer` | H+ | R02-14 | listed before W10-30 in the table |
| W10-30 e2e + scenario | H | all H rows | |
| W23-02 network matrix | H2 | R02-37 | |
| W23-16 relayer suite (F5 gate) | H2 | R02-37 | |
| W23-17 Rust `res` contract | H2 | R02-12, R02-13, R02-14, R02-34 | must implement `mt_batch_transfer_call` (Q-06-1) |
| W23-18 deploy `res` | H2 | R02-12, R02-37 | "`mt_metadata` returns the 4 tokens" vs 10 ids (Q-06-4) |
| W23-19 real `CargoTokenPort` | H2 | R02-25, R02-26 | |
| W23-20 cargo suite real + mainnet smoke | H2 | R02-37 | |
| W23-21 verify deposit path | H2 | R02-34, R02-44 | `mt_transfer_call` and "4 NEP-141 tokens" text (Q-06-1, Q-06-4) |
| W23-28 NPC funding, initial cargo | — | R02-31 | |
| W23-41 mock → real migration | — | R02-33 | |
| W23-42 rollback to mock | — | R02-50 | uses `NEAR_ADAPTER_CARGO` |
| Upstream mining: W01-06/07/13, W02-02/08/11/12, W03-11 (H); W03-30 (H+); W05-34 (H); W05-16, W05-17 (—); W06-12 `storage_deposit` (H); W15-05 (H); W13-16 (H); W21-12/13 (—) | | R02-3..R02-11, R02-29, R02-31, R02-48 | |

**Rules with no issue:** R02-38..R02-42, R02-47 (Proposed, no wave row changes the defaults); Guild T2 restock (R02-41) and off-planet sale; a deposit depletion rule (R02-46); a prod guard that blocks `cargo.grant` when the cargo adapter is real (R02-32 relies on the general "console off in production builds").

**Issues that contradict a spec:** W01-09 starting kit (R02-43); W23-18 / W23-21 "4 tokens" vs NEAR-50's 10 (Q-06-4); W10-13 burn by colony key vs NEAR-50 / NEF F1 / W10-10 minter-only (Q-02-3); W10-06 UTC-day counter in the sim vs SIM-D-06 (Q-02-4); W10-01 error codes vs SIM-C-02 (Q-02-7); W10-10 mock tables vs landed schema (R02-51); W10-29 / W23 env name vs code (R02-50).

**Hackathon scope note:** W03-30 Petroleum Well (H+) and the W05 slice ("T3, Bio tiers … stretch") mean `bio.t2`, `bio.t3`, `metals.t3`, `minerals.t3` are not mineable in the H demo, so those tokens exist only through the Guild seed (R02-31).

## 8. Open questions

| # | Question | Proposed default / note | Source |
|---|---|---|---|
| Q-02-1 | Snapshot rollback vs outbox: the outbox commits per export, but sim state is snapshotted every 60 s and lost on crash. After a restart the stock is back, the mint still runs, and `exportSeq` may repeat, so a later export's `opId` can collide with the already-minted one and be deduplicated. How is `exportSeq` kept monotonic and the stock removal made durable? | Store `exportSeq` / `importSeq` outside the sim, or snapshot on every export | NEAR §1a rule 6, SIM-H-06/07, W10-08 |
| Q-02-2 | `cargo.grant` mints without stock. W23 demo step 2 runs real cargo under `npm run dev:restart`, where the console is on. Must `cargo.grant` refuse when the cargo adapter is real? | Yes, refuse on a real adapter | W10-26, DEV_TOOLS |
| Q-02-3 | Who signs `mt_burn` on import: `minter` only (NEAR-50, NEF F1 "minting and burning are restricted to the port service account", W10-10) or the colony key via the relayer (NEAR-52, W10-13)? The same question decides the Guild sink and the treasury burn (R02-53, → Q-05-11) Also: the DAO holds cargo but `minter.*` is the sole burn authority on `res.*`: transfer to `minter` then `mt_burn`, or a DAO action; does W22-09 burn or only debit? (absorbs Q-05-11) | — | NEAR-50 vs NEAR-52 |
| Q-02-4 | The daily cap is a "UTC-day counter" in the sim (W10-06), but the sim reads no wall clock (SIM-D-06), and DATA_MODEL puts a "daily mint-cap counter per colony" on `chain.cargo_tx`. Where does it live, how does the sim learn the day boundary, and is "rolling 60 s" game time or wall time under warp? | — | W10-06, SIM-D-06, DATA_MODEL §4.4.1 |
| Q-02-5 | Throughput: one hub (NEAR-53), the sum of online hubs (W10-06) or per hub (W10-04)? Do imports and market fills consume it (econ §3.5 words it as a trade cap)? | Sum of online hubs, exports only | NEAR-53, W10-04/06, econ §3.5 |
| Q-02-6 | How is "unreachable" detected before an export is accepted, and should W10-01 add `market_unavailable` (or map the landed `NEAR_UNAVAILABLE`)? | Add the code to W10-01; accepted exports keep settling async | NEAR §1 p.4, PROTOCOL §10, W10-01 |
| Q-02-7 | Error names: W10-01 `insufficient_stock`, `insufficient_cargo`, `storage_full`, `hub_offline` are not in SIM-C-02 | Add them to SIM-C-02 | W10-01, SIM-C-02 |
| Q-02-8 | Over-cap export: clamp or reject? | Reject (W10-06); client slider clamps (W10-21) | W10 demo step 5 |
| Q-02-9 | Closed → Q-06-1 (deposit method) and Q-06-4 ("4 tokens", fallback) | — | [06](./06-near-tools-and-adapters.md) |
| Q-02-10 | Does a failed mint return its amount to the daily and 60 s counters? Does an import need an online hub? What happens to a pending import when the hub is shed? | — | W10-06/07/12 |
| Q-02-11 | Closed → Q-06-15 (outbox table name) | — | — |
| Q-02-12 | Default of `TRADE_HUB_AT_S2` (W10-03 only shows `false`; `ENVS.md` does not exist yet) | — | W10-03, W10-29 |
| Q-02-13 | Do Guild seed mints (and the proposed T2 restock) count against any supply budget or cap? Seed amounts are not in any row | — | NEAR-73, W15-05, Balance §8 |
| Q-02-14 | Stock is float (SIM-D-02); tokens are `numeric(40,0)` base units. Must export/import amounts be integers, and how is rounding done? | Integer units only | SIM-D-02, DATA_MODEL §4.4.1 |
| Q-02-15 | With per-sub-resource caps (R02-39), does import clamp to the sub-resource cap? Does an import reservation count against the cap that halts production? May imported T2/T3 be re-exported (NEF F1 says only miners export them)? | — | Balance §8, W10-12, NEF F1 |
| Q-02-16 | Carry-over (R02-30) is in the F1 promise but post-hackathon; say so in the demo | Not in the demo story | NEAR-54, W10-15 |
| Q-02-17 | Trade Hub T2 "lower transport fuel fee", T3 "orbital drop pod delivery" have no mechanic | Throughput only | econ §3.5 |
| Q-02-18 | W10 demo step 3 and W10-05 export 300 at a T1 hub (250/min); W10-06 rejects it. Lower the demo export, seed a T2 hub, or count the window differently? | Export 200 in step 3, 100 more in step 5 | W10 demo, W10-05, W10-06 |
| Q-02-19 | Which starting kit ships: W01-09 600/350/200/200 (600 > Hub cap 500), SIM §7.3 / R11 400/250/150/150, or Balance §8 400/300/200/150? | SIM §7.3 (spec wins) until the owner takes Balance §8 | R02-42, R02-43 |
| Q-02-20 | Do deposits deplete? No rule says so; meteors only add deposits | No depletion (state it in SIM §10) | SIM §7.6, §10 |
| Q-02-21 | Carry-over: all in-orbit cargo (NEAR-54), "part of the cargo" (WP §8), and is W21-13's 750/437/250/250 (1.25 × the W01-09 kit) stock or cargo? | All cargo stays on the account (NEAR-54); fix WP §8 and W21-13's base | NEAR-54, WP §8, W21-13 |
| Q-02-22 | W10-10 names `mock_chain_mt_balance` / `mock_chain_mt_event`; the landed schema has `mock_chain_balance` / `mock_chain_receipt`. Reuse or migrate? | Reuse the landed tables; fix W10-10 | W10-10, `shared/db/prisma/mock-chain.prisma` |

## 9. Grill questions

- **W01/W02:** Which starting kit ships (Q-02-19)? Does W02-02 clamp a 600 kit to the 500 cap? Do deposits deplete (Q-02-20)?
- **W03/W05:** With W03-30 at H+ and Bio/T3 tiers deferred, which tokens can a demo colony mint? Is the W05-34 gate a share or a Living-tile count (R02-40)? Harvester on Living (R02-47)?
- **W10:** Answer Q-02-1 (snapshot vs outbox) before W10-05/08 start. Who signs the burn (Q-02-3)? Where does the daily counter live (Q-02-4)? Sum or per hub (Q-02-5)? Which error set, including `market_unavailable` (Q-02-6, Q-02-7)? Is the cap default 20 000 or 10 000? Does the demo's 300 export pass at T1 (Q-02-18)?
- **W10-10:** Use the landed `mock_chain_balance` / `mock_chain_receipt` or add `mock_chain_mt_*` tables (Q-02-22)?
- **W10-26 / W10-29:** What stops `cargo.grant` against a real adapter (Q-02-2)? Which env name goes into `ENVS.md` (Q-06-11)?
- **W13:** Is the in-orbit definition (R02-29) the only place a verifier balance enters F1, and does `cargo.import` still reserve storage when it withdraws first?
- **W15:** How much does each Guild seed mint, and is it capped (Q-02-13)? Does a T2 restock mint, and does the off-planet sale burn (R02-53)?
- **W21:** Which carry-over rule holds (Q-02-21)?
- **W22:** Who burns the treasury project cost if burn is minter-only (Q-05-11)?
- **W23:** Does W23-17 implement `mt_batch_transfer_call` (Q-06-1)? Fix "4 tokens" in W23-18 / W23-21 (Q-06-4). Does W23-19's receipt check cover the Q-02-1 case? Do the demo steps use `NEAR_ADAPTER_CARGO_TOKEN` (Q-06-11)?
