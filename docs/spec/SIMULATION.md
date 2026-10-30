# TerraAgent — Simulation & Planet Host Specification

> **Status:** v0.2 (2026-10-30). This is the **simplified server simulation** (D-24): one app, sim in `worker_threads`, reproducible but not bit-exact, snapshot + coarse fast-run on restart, full state to clients, and no anti-cheat checks (D-25). The earlier deterministic, lease-based host is summarised in §15 as Future.
> **Parent:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) §9, §14, §15 · [`DECISIONS.md`](./DECISIONS.md) D-16, D-17, D-18, D-21, D-24, D-25
> **Gameplay source:** [`docs/game/colony-economy-and-buildings-spec.md`](../game/colony-economy-and-buildings-spec.md), [`docs/game/units-orders-and-progression-spec.md`](../game/units-orders-and-progression-spec.md), [`docs/game/autonomous-colony-spec.md`](../game/autonomous-colony-spec.md)
> **Implemented by:** [`TA-06`](../plan/issues/TA-06-simulation-core.md) / [`TA-14`](../plan/issues/TA-14-units-orders-progression.md) (`@terra/sim`) and [`TA-07`](../plan/issues/TA-07-planet-worker.md) (the `game` module host)

---

## 1. Purpose

This spec defines:
- the planet simulation (`shared/sim`): reproducibility rules, the per-step system pipeline with `dt`, the command model, state layout and snapshots;
- state sync to clients (engine snapshot + engine diffs, D-31) and the three hosts of the one engine: server, client replica with prediction, browser local host (§6a);
- the MVP content set with numbers, and the rule engine;
- how the `game` module hosts the sim: thread pool, active and coarse stepping, snapshots, and restart fast-run.

Rules are numbered so they can be traced to tests (§13).

Numbers marked **(proposed)** are not in the game-design specs. They are owner-tunable balance placeholders and live in data tables (`shared/sim/src/data/*.ts`), never in system code. Every data row can be overridden at runtime for playtests (D-35, `SIM-G-DATA` in §7).

---

## 2. Reproducibility rules (`SIM-D`)

The sim must be **reproducible in tests**: same seed + same commands at the same steps, on the same runtime, give the same result. **Bit-exact cross-runtime determinism is not required** (D-24). There is no durable command log, no replay and no state hash.

| ID | Rule |
|---|---|
| `SIM-D-01` | Same `(initial params, seed, command list per step)` on the same Node version gives the same state. This is used by unit tests, scenarios and the balance duel harness. |
| `SIM-D-02` | **Floats are allowed** in state. Use plain numbers with design units: resources in units, energy in E, HP in HP, time in seconds. |
| `SIM-D-03` | **Time.** One sim **tick** = `TICK_MS` = 200 ms of game time (5 TPS). `step(state, commands, dt)` advances `dt` ticks at once: `dt = 1` on active planets, `dt = 5` on empty planets (coarse, §11). Every rate in the data tables is per second. `compileData()` converts table durations and rates. Durations in §7–§10 written as "N ticks" come from the 100 ms draft: read them as **N × 0.1 s of game time**, and `compileData()` converts them. |
| `SIM-D-04` | **Randomness** comes only from the planet PRNG: xoshiro128\*\* seeded per stream (`gen`, `weather`, `hazard`, `fauna`, `ai`, `combat`). Stream states are part of the snapshot. `Math.random` is banned in `shared/sim/src/**`. |
| `SIM-D-05` | **Iteration order** is fixed: entities in ascending `entityId`, colonies in ascending `colonyIndex`. Entity ids are monotonic. |
| `SIM-D-06` | **Purity.** The sim reads no wall clock, network or presence. Presence enters as a command (`system.presence`). Banned in `shared/sim/src/**`: `Date`, `performance`, `setTimeout`, `process`, `fs`, DOM globals, `async`. Lint rule `@terra/eslint-config/sim`. |
| `SIM-D-07` | **Versioning.** `SIM_VERSION` is stored in snapshots. Restoring an older snapshot needs a registered migration (`src/codec/migrations/`), or the planet is restored best-effort with a warning. |

---

## 3. Step pipeline (`SIM-T`)

`step(state, commands, dt)` applies the commands, then advances `dt` ticks of game time through the systems in a fixed order. It mutates `state` and returns `events` and `stats`.

| # | System | Notes |
|---|---|---|
| 0 | `commands` | Apply this step's commands in arrival order. Game-rule validation here; failures emit `cmd.rejected {commandId, code}` (§4). |
| 1 | `environment` | Day/night, weather, storms (advance by `dt`). |
| 2 | `hazards` | Lightning and meteors. Probability per step scales with `dt`. |
| 3 | `fauna` | Nest spawns, aggro, movement. |
| 4 | `ruleEngine` | Each colony is evaluated once per second of game time, staggered by colony index. On coarse steps (`dt = 5`) every colony runs once. |
| 5 | `units` | Dispatch from order lanes, path requests (budgeted A\*), movement × `dt`. |
| 6 | `construction` | Build, upgrade, repair and terraform progress × `dt`. |
| 7 | `power` | Rebuild the grid graph if dirty; per-component balance; pylon flow and overload (§7.4); brownout shedding. |
| 8 | `production` | Extractors, fuel upkeep, storage caps × `dt`. |
| 9 | `factories` | Unit production queues, supply cap. |
| 10 | `combat` | Damage = DPS × multiplier × `dt × TICK_MS`. On coarse steps, fights resolve in larger chunks; accepted (D-24). |
| 11 | `territory` | Claims, anchor removal, grace reverts. |
| 12 | `progression` | Stages, launch gate, rocket, score. |
| 13 | `lifecycle` | Elimination, settlement, planet end flags. |
| 14 | `finalize` | `tick += dt`; mark changed entities for the next delta. |

- `SIM-T-01` Systems not yet implemented are registered as no-ops, so the order stays fixed.
- `SIM-T-02` Per-step budget: A\* node expansions ≤ 2 000 per planet per step. Overflow requests wait in a FIFO (`state.pathQueue`).

---

## 4. Command model (`SIM-C`)

```ts
// shared/contracts/src/sim/commands.ts
type SimCommandV1 = {
  colonyIndex: number | null;   // null = planet-level (system/admin)
  source: 'player' | 'ai' | 'near' | 'admin' | 'system';
  commandId: string;            // client or module id, echoed in ack/reject
  kind: SimCommandKind;         // authoritative list: PROTOCOL.md CommandKind
  args: unknown;                // zod-validated per kind on the main thread
};
```

Command kinds (summary; arguments in PROTOCOL.md):

| Group | Kinds | Source |
|---|---|---|
| Colony control | `setPriorities`, `enqueueTask` (build / upgrade / repair / terraform / buildUnit / queueGoal / raid / launchRocket), `cancelTask`, `placeBuilding`, `upgradeBuilding`, `demolish`, `setAutopilot`, `setAwayBudget`, `setHarvestWeights`, `setStance`, `attackMove`, `setRally` | player, ai |
| AI | `ai.directive` (DirectiveV1/v2) | ai |
| Cargo & market (D-26) | `cargo.export {resource, amount}` (moves stock to "in orbit" pending mint), `cargo.import {resource, amount}` (credited after the burn confirms), `cargo.settled {ref, ok}`, `market.reserve` / `market.release` / `market.settled {tradeId, deltas}` | player, ai, near |
| Diplomacy & bounties | `diplomacy.proposeTruce` / `respondTruce` / `cancelTruce`, `bounty.post` / `bounty.claim` / `bounty.paid` | player, ai, near |
| System | `system.spawnColony`, `system.retireColony`, `system.seal`, `system.end`, `system.presence {colonyId, away}`, `system.arrive` | lobby, game |

- `SIM-C-01` **Validation (D-25).** Exactly three checks:
  - the zod schema, on the main thread;
  - **the command controls only the sender's own colony** (`colonyIndex` is derived from the authenticated player, never taken from the client);
  - game rules in the `commands` system (territory, prepared ground, resources, tier, stage, supply, newcomer shield, truce).
  There are no rate limits, plausibility checks or anti-cheat checks.
- `SIM-C-02` Rejections never throw. They emit `cmd.rejected {commandId, code}`. Codes: `invalid_args`, `colony_inactive`, `not_own_territory`, `site_blocked`, `terrain_unbuildable`, `insufficient_resources`, `tier_locked`, `worker_tier_locked`, `stage_locked`, `supply_cap`, `unknown_entity`, `no_trade_hub`, `raid_protected`, `truce_active`, `would_isolate`, `launch_gate`, `mint_cap`, `planet_ended`.
- `SIM-C-03` **Payment.** Orders are paid when work starts (units spec `UO-Q-01`). Cancelling in progress refunds 75 %; demolish refunds 50 %. In-place upgrades cost the Δ.
- `SIM-C-04` Queue precedence and limits follow units spec §4.4.
- `SIM-C-05` **Cargo export** is the only path from sim stock to the chain. The sim removes the stock and records a `pendingMint`. The `near` module mints and answers with `cargo.settled`; a failed mint refunds the stock. Exports obey `CARGO_MINT_CAP_PER_DAY` and the Trade Hub throughput (`mint_cap`) as **economic pacing** (D-26).

---

## 5. State layout (`SIM-S`)

A structure-of-arrays entity store (`shared/sim/src/ecs/store.ts`) with no id recycling.

```ts
type PlanetType = 'desert' | 'ocean' | 'temperate';             // D-33; client look: desert→dune, ocean→oceanForest, temperate→forestRock
type ResourceFamily = 'metals' | 'minerals' | 'bio';             // D-34; one storage cap per family
type ResourceKey =                                               // D-34; the 10 stored sub-resources (energy is grid power, not stock)
  | 'metals.t1' | 'metals.t2' | 'metals.t3'
  | 'minerals.t1' | 'minerals.t2' | 'minerals.t3'
  | 'bio.water' | 'bio.biomass' | 'bio.t2' | 'bio.t3';

interface PlanetState {
  meta: { simVersion: number; planetId: string; planetType: PlanetType;
          seed: string; tick: number; nextEntityId: number; rng: Record<RngStream, Uint32Array>;
          ended: boolean; };
  grid: { radius: number; terrain: Uint8Array; prep: Uint8Array; deposit: Uint8Array;
          richness: Float32Array; owner: Int8Array; anchors: Uint8Array; graceUntil: Float64Array;
          explored: Uint8Array /* kept for client-side fog, not used for filtering */ };
  colonies: ColonyState[];   // ColonyState.stock: Record<ResourceKey, number>; ColonyState.caps: Record<ResourceFamily, number>
  entities: { id: Uint32Array; kind: Uint8Array; owner: Int8Array; tier: Uint8Array;
              q: Int16Array; r: Int16Array; x: Float32Array; y: Float32Array;
              hp: Float32Array; hpMax: Float32Array; state: Uint8Array; progress: Float32Array;
              changedAt: Uint32Array; };
  power: { components: …; dirty: boolean };
  lanes: OrderLanes[]; goals: HqGoal[][]; pathQueue: PathRequest[];
  hazards: ActiveHazard[]; fauna: NestState[]; truces: Truce[]; pendingCargo: PendingCargo[];
}
```

- `SIM-S-01` `snapshot(state) → Uint8Array`: MessagePack of the state (typed arrays as binary), gzip-compressed by the host. `restore(bytes)` round-trips (property test: `restore(snapshot(s))` deep-equals `s`). Target ≤ 512 KB compressed.
- `SIM-S-02` No state hash (D-24).

---

## 6. State sync to clients (`SIM-V`)

- `SIM-V-01` **Full state, no fog filtering (D-25).** On join, the client receives the **engine snapshot** (`snapshot()`, the shared codec, D-31): every colony, entity, tile, lane and PRNG stream. The client loads it into its own engine and draws fog-of-war from `grid.explored` and its own vision.
- `SIM-V-02` **Deltas are engine diffs.** Every `1 / DELTA_HZ` s the host emits one delta per planet: `{fromTick, toTick, diff: diffSince(fromTick), events}`. The diff holds changed entity rows (from `changedAt`), created and removed entities, tile changes, colony records, order lanes and goals, and PRNG stream states. It is **the same for every socket on that planet** (built once, broadcast as one binary frame).
- `SIM-V-03` `applyDiff(diff)` on a replica at `fromTick` gives a state deep-equal to the server's at `toTick`. Views for rendering and the HUD come from the engine's `view()` on the client, not from the wire.
- `SIM-V-04` Delta cost is O(changed entities). There are no per-socket diffs.
- `SIM-V-05` A wave that adds state registers which fields are synced; it does not write delta code. Server-private fields do not exist (D-25).

## 6a. One engine, three hosts (`SIM-X`) — D-31

| Host | Where | Authority | Used for |
|---|---|---|---|
| **Server** | `game` module, worker threads (§11) | yes | every online planet |
| **Client replica + prediction** | browser Web Worker (CLIENT §7) | no | rendering the server state at tick T exactly, and predicting the player's own commands ahead of it |
| **Local host** | the same Web Worker, `?host=local` | yes, locally | single-player testing and sim-only e2e runs without the app or Postgres |

- `SIM-X-01` **One API.** All hosts use `SimHost`: `load(snapshot)`, `step(dt)`, `submit(cmd)`, `snapshot()`, `diffSince(tick)`, `applyDiff(diff)`, `clone()`, `view()`, `events`. Hosts own clocks, timers and I/O; the engine never does (`SIM-D-06`).
- `SIM-X-02` **Every game rule lives in `@terra/sim`.** Server modules and client features call the engine; they do not re-implement rules. Command validation in the engine (game rules) runs identically in every host; the server additionally checks schema and ownership (`WS-20`).
- `SIM-X-03` **Prediction.** The client keeps `confirmed` (the replica at server tick T) and the player's commands not yet applied (`cmd.ack.appliedAtTick` > T). It renders `predicted = clone(confirmed)`, then submits the pending commands at their ticks and steps to the estimated server tick. Each delta: apply to `confirmed`, drop applied commands, rebuild `predicted`. A `cmd.reject` drops the command and shows the reason.
- `SIM-X-04` **Correction.** When the rebuilt prediction moves an entity, the renderer blends to the new position over 150 ms; discrete fields (HP, state, ownership, tiles) snap. Render-only events (projectiles, impacts, VFX) come from `predicted`; player-facing events (toasts, alerts, notifications, achievements) come only from the server.
- `SIM-X-05` **Fallback.** `?predict=0`, or a worker step p95 above 4 ms, turns prediction off: the client renders the replica interpolated 400 ms behind server time.
- `SIM-X-06` **Local host.** Steps at 5 TPS from the worker's timer, accepts commands through `LocalTransport` (same messages as `/ws`), loads scenarios and generator seeds, supports time warp and the dev console, and saves snapshots to IndexedDB. Features that need server modules report `host_unavailable` and are hidden.
- `SIM-X-07` **Parity.** `npm run test:parity` runs each registered scenario with a scripted command log for 600 ticks on Node and in headless Chrome: discrete state must be equal and positions within 0.01 tile. Bit-exact equality is not required (D-24).
- `SIM-X-08` **Versioning.** `welcome` carries `simVersion` and `dataHash` (hash of the compiled data tables for the enabled waves). A client whose engine differs reloads before joining.

---

## 7. MVP content (`SIM-G`) — per D-15

All numbers from `docs/game/colony-economy-and-buildings-spec.md` unless marked **(proposed)**. `compileData()` converts design units and durations (`SIM-D-03`). The unit roster, lanes, ground prep, walls, truces and progression follow [`docs/game/units-orders-and-progression-spec.md`](../game/units-orders-and-progression-spec.md) (D-16, accepted); where §7.2–§7.7 below differ, the units spec wins.

- `SIM-G-DATA` **Balance is data, tunable at runtime (D-35).** Every balance number (costs, HP, DPS, ranges, view radii, timers, rates, thresholds, AI weights) is a row in `shared/sim/src/data/*.ts`, never a constant in system code. `compileData()` merges an optional **overrides file** (`balance.overrides.json`, path from `TA_BALANCE_OVERRIDES`; per planet via the scenario) over the tables. The dev console's `tune <table>.<row>.<field> <value>` / `tune reset` / `tune export` applies a change live to the running planet (server and local host) and records it in the planet's event log. `dataHash` in `welcome` (`SIM-X-08`) covers the overrides, so clients reload the same numbers. Values marked **(proposed)** here and the B1–B13 defaults in `docs/plan/OWNER_TASKS.md` are the starting rows.
- `SIM-G-RES` **Resources (D-34).** Stock is 10 sub-resources keyed by `ResourceKey` (§5) in three families (Metals, Minerals, Bio), each with T1/T2/T3; T2/T3 output needs the terraforming gates of the economy spec §3.0. Storage caps are **per family** (Hub and Depot storage adds to all three; the sub-resources of a family share its cap, proposed). Energy is grid power (E/s), stored only in capacitors.
- **Reading the cost columns in §7.1–§7.3 (D-34 tier rule).** Costs stay written `M/Min/Pet/W` until each table is rebalanced. A **T1** item pays M → `metals.t1`, Min → `minerals.t1`, Pet → `bio.biomass`, W → `bio.water`. A **T2** item pays 60 % of M and Min in T1 and 40 % in T2 of the same family, and its Pet in `bio.t2`. A **T3** item pays 40 % T1, 30 % T2, 30 % T3 of M and Min, Pet in `bio.t2`, plus 10 % of its M as `bio.t3`. W is always `bio.water`. Upkeep per second (fuel, coolant, terraform water) uses the T1 reading (proposed).

### 7.1 Buildings enabled in MVP

| Building | Tier | Size | Build | Cost M/Min/Pet/W | Drain E/s | HP | Effect |
|---|---|---|---|---|---|---|---|
| Command Hub | T1 | 3×3 | 30 s (0 s at spawn) | 200/100/50/50 | −5 | 1 500 | Claim R 10; storage +500 per family; supply +10; **Founder Core +8 E/s (proposed)**; acts as a pylon (span 6) |
| Command Hub | T2 | 4×4 | 75 s | 600/350/200/150 | −14 | 3 800 | Claim R 15; storage +1 500 per family; supply +25 |
| Territory Claim Beacon | T1 | 1×1 | 18 s | 80/40/0/10 | −4 | 400 | Claim R 8 |
| Territory Claim Beacon | T2 | 2×2 | 42 s | 220/140/40/30 | −11 | 1 100 | Claim R 14; vision R 20 |
| Power Line Pylon | T1 | 1×1 | 4 s | 15/5/0/0 | −0.5 | 120 | Span 6; max load 80 E/s (enforced, `SIM-G-PWR`, D-21) |
| Energy Capacitor Bank | T1 | 2×2 | 16 s | 70/60/10/10 | −1.5 | 450 | Stores 1 500 E; discharge ≤ 30 E/s |
| Coal/Oil Thermal Plant | T1 | 2×2 | 15 s | 80/20/20/10 | −3 | 450 **(proposed HP)** | +28 gross; consumes 1.5 `bio.biomass`/s; pollution +1 |
| Wind Turbine | T1 | 2×2 | 14 s | 70/35/5/0 | −1 | 400 **(proposed HP)** | +16 gross × wind factor 50–140 % (storms do not change it, B13) |
| Solar Collector | T1 | 2×2 | 18 s | 60/75/10/5 | −1 | 400 **(proposed HP)** | +21 gross × daylight; 0 at night; +35 % on Desert |
| Solar Collector | T2 | 3×3 | 40 s | 160/220/35/15 | −3 | 1 000 **(proposed HP)** | +63 gross, same modifiers |
| Metals Extractor | T1 / T2 | 2×2 / 3×3 | 14 s / 34 s | 65/20/0/10 · 180/75/25/30 | −6 / −18 | 500 / 1 350 | +4.0 / +12.5 Metals/s × richness (must cover a metals deposit); `metals.t1`, plus T2/T3 shares under the terraforming gates (economy spec §3.0) |
| Minerals Quarry | T1 / T2 | 2×2 / 3×3 | 16 s / 38 s | 75/30/5/15 · 210/95/35/45 | −8 / −22 | 500 / 1 350 | +3.0 / +9.5 Minerals/s × richness; `minerals.t1`, plus T2/T3 shares under the gates |
| Petroleum Well & Refinery | T1 / T2 | 2×2 / 3×3 | 20 s / 45 s | 90/45/15/20 · 250/140/50/60 | −10 / −28 | 450 / 1 200 | +2.5 / +8.0 `bio.t2`/s × richness on an oil deposit, **only under the T2 gates** (0 before) |
| Water Extractor | T1 | 2×2 | 15 s | 60/35/10/0 | −7 | 480 | +3.5 `bio.water`/s (×0.5 Desert); no deposit needed |
| Resource Supply Depot | T1 | 2×2 | 12 s | 60/25/10/0 | −2 | 600 | Storage +1 000 per family (Metals, Minerals, Bio) |
| Drone Control Array | T1 | 1×1 (data; model refit, B8) | 14 s | 55/45/10/5 | −5 | 350 | Supply +8 |
| Robotics Factory | T1 | 3×3 (data; model refit, B8) | 25 s | 120/70/30/20 | −10 | 800 | Builds T1 robots |
| Autocannon Turret | T1 | 1×1 | 12 s | 55/20/10/0 | −3 | 450 | Range 8; 18 DPS; hits ground and air; no ammo drain in battle v1 (B10) |
| Inter-Colony Trade Hub | T1 | 2×2 | 22 s | 100/80/30/10 | −6 | 650 | Required for trades (owner-confirmed 2026-10-29; truces do not need it); ≤ 250 units/min |
| Interplanetary Rocket Silo (Lander) | T2 | 4×4 | 210 s | 1 800/1 600/1 400/700 | −120 | 4 800 | Launches Founder Pod (+25 % starting stock on next planet) — the only rocket tier in MVP. Launch gate: the colony's own territory is 100 % Living (D-18, §7.7) |

"Mine" in D-15 is interpreted as the three deposit extractors (Metals Extractor, Minerals Quarry, Petroleum Well on oil deposits). Everything else in the economy spec stays in the data tables with `enabled: false`.

### 7.2 Robots (T1 only)

> **Superseded (D-16 accepted):** roster, lanes, queue, combat matrix, starting kit and threat scaling are in [`docs/game/units-orders-and-progression-spec.md`](../game/units-orders-and-progression-spec.md); this table is history.

| Robot | Build | Cost M/Min/Pet/W | Supply | Drain E/s | HP | Speed **(proposed)** | Capability |
|---|---|---|---|---|---|---|---|
| Miner / Harvester | 10 s | 40/15/5/0 | 1 | −1.5 | 160 | 1.5 tiles/s | +2.0 res/s from a surface deposit tile; clears forest/rock (yields 20 Metals per clear, proposed) |
| Builder / Repair | 12 s | 45/25/10/0 | 1 | −2.0 | 150 | 1.5 tiles/s | Build/repair rate 1.0×; repairs severed pylons |
| Combat / Raider | 14 s | 55/30/15/0 | 1 | −2.5 | 240 | 2.5 tiles/s | 14 DPS, range 4 (proposed); nest clearing, raids |

Logistics are abstract in MVP: harvested/extracted resources are credited directly to colony storage (no hauling). Robots draw their drain from the Hub's grid component; if that component is in deficit, robots operate at 50 % speed and work rate **(proposed)**.

### 7.3 Starting kit **(proposed)**

Command Hub T1 (instant), 1 Builder (the founder robot), 1 Miner; stock `metals.t1 400 / minerals.t1 250 / bio.biomass 150 / bio.water 150`, every T2/T3 key 0 (base storage 500 per family from the Hub). Founder Pod arrivals get stock × 1.25 (spec §3.6). Raid protection for `72 000` ticks (2 h) after founding.

### 7.4 Power grid rules (`SIM-G-PWR`)

- Graph nodes: Hub, pylons, and every powered building. Pylons/Hub link to other pylons/Hub within span (T1: 6 tiles); a building connects if any footprint tile is within **3 tiles (proposed)** of a pylon or the Hub.
- Per connected component: `supply = Σ online generator net output (with daylight/wind/Desert modifiers; thermal only while `bio.biomass` > 0) + Σ capacitor discharge (≤ max)`; `demand = Σ drains of online consumers (+ robot drain on the Hub's component)`.
- Brownout shedding when `demand > supply`, in the economy spec's order — shed first: Rocket Silo; second: Robotics Factory, Trade Hub; third: extractors, Supply Depot; keep last: Turrets, Beacons, Drone Control Arrays, generators' internal drain. Within a tier, shed newest first (descending `entityId`). Surplus charges capacitors.
- Components without any generator or charged capacitor are fully `OFFLINE`. Severed by pylon destruction → graph marked dirty → recomputed same tick.
- **Per-pylon max load is enforced in MVP (D-21)**, using the economy spec §1.3 capacities: Pylon T1 80 E/s, T2 300 E/s, T3 1 200 E/s. The Command Hub acts as a pylon with a 150 E/s max load **(proposed)**.
  - **Flow model (deterministic):** per connected component, build a BFS spanning tree rooted at the generator with the highest net output (ties go to the lowest `entityId`). Neighbours are visited in ascending `entityId`. Every consumer and generator attaches to its nearest pylon or Hub (ties go to the lowest `entityId`).
  - A pylon's flow is the absolute net power of its subtree: attached and downstream drains minus generation and capacitor discharge inside the subtree.
  - **Overload:** if a pylon's flow exceeds its max load, its subtree is an over-capacity **branch**. Consumers in that branch are shed in the brownout order above (newest first within a group) until the flow fits. Shed consumers show `offline: overload`. Other branches are unaffected.
  - The tree is rebuilt when the graph is dirty. Flows are re-evaluated every 10 ticks (staggered per colony).
  - Event `powerOverload {pylonId}` is debounced to 600 ticks. The rule engine's `energy` need adds a `capacity` term that suggests a T2 relay or a second line.

### 7.5 Territory rules (`SIM-G-TER`)

Exactly the economy spec §2: claim on construction completion (radius by tier), unclaimed → claim, same owner → add anchor, foreign → frozen border (never overwritten). Unpowered beacon cannot claim new tiles and takes +25 % damage. Anchor removal → tiles with zero anchors revert after `600` ticks unless re-anchored. All building placement requires own tiles.

> **D-16 (accepted):** placement also requires every footprint tile to be **Prepared** (terraformed). Terrain classes, the 8 terraform ops and their energy draw, linked prep orders, meteor holes and the spawn guarantee are in [`docs/game/units-orders-and-progression-spec.md`](../game/units-orders-and-progression-spec.md) §4.5.

### 7.6 Environment, hazards & fauna **(all proposed, owner-tunable)**

> **Pressure level: hard (D-17).** At default difficulty, an unattended colony **can be eliminated** by fauna, hazards or other players; the player is notified (CONTINUITY §5a). Stage-scaled raid sizes, Brute and Drifter species, meteor timing and wall rules are in `docs/game/units-orders-and-progression-spec.md` §6.3 and §4.8, and they supersede the raid row below. The "must survive a night offline" goal is dropped. What the tests guarantee instead is that the colony **defends itself sensibly** (AC-03 in the units spec), not that it survives.

| Item | Temperate (`forestRock`) | Desert (`dune`) | Ocean (`oceanForest`) |
|---|---|---|---|
| Day length | 12 000 ticks (20 min): **55 % day, 45 % night** (cold nights, D-33); daylight curve from `sinTable` | 12 000 ticks: 60 % day, 40 % night | as Desert |
| Wind factor | resampled every 1 200 ticks, smoothed, 5 000–14 000 bp; **storms do not change it** (B13, proposed, tunable D-35) | same | same |
| Storms | mean interval 27 000 ticks (45 min), duration 1 800 ticks | sandstorm mean 54 000 ticks; solar −50 % during storm | **×1.5 as frequent** (D-33): mean 18 000 ticks, duration 1 800 ticks |
| Lightning (storms only) | strike every 200 ticks ± jitter on a random tile within any colony territory, tall-structure weight ×4 for pylons; 300 HP damage | same | same |
| Meteor | mean interval 36 000 ticks per planet; radius 2 tiles; 400 HP at centre, linear falloff; 30 % chance to create a new deposit | same | same |
| Fauna species (MVP) | **Skitter swarm** (one species for every type; skin differs): HP 120, 8 DPS melee, speed 2 tiles/s, aggro radius 6 from nest | same | same |
| Nests | 1 per ~400 tiles outside radius 25 of spawn slots; HP 1 500; spawns 1 Skitter / 900 ticks, max 6 alive per nest | density ×0.7 | same as Temperate |
| Raids on colonies | every 6 000 ticks per colony: chance `10 % + 5 % × thermal plants` that the nearest nest sends 3 + ⌊tick/72 000⌋ skitters (cap 12) | same | same |
| Production modifiers | Minerals deposits richness +15 % | Metals and Minerals richness +15 %; Water Extractor ×0.5; Solar +35 % | Bio deposits richness +20 %; Metals −15 % |

### 7.7 Combat, PvP, elimination

- Damage is instant-hit per step (`DPS × dt × TICK_MS`); target = nearest hostile in range, tie by lowest `entityId`.
- **Raids (PvP):** `enqueueTask {task: 'raid', targetColonyIndex, q, r}` sends idle combat bots. Combat bots adjacent to a foreign Supply Depot or Hub siphon 1 unit/s of each resource (attacker cap-limited) **(proposed)**. Not allowed against colonies with `raidProtectedUntil > tick` (`raid_protected`).
- **Elimination:** Hub destroyed → colony `critical`; if no Hub is rebuilt within 6 000 ticks, or the HQ drone is also lost (`UO-HQ-04`) → `eliminated`: entities become neutral ruins (`owner = -1`, decaying 1 % HP/s), tiles un-anchored (grace applies), event `colonyEliminated`.
- **Departure (rocket):** Rocket Silo T2 complete + `launchRocket` → after 300-tick countdown emit `rocketLaunched {colonyId, carry: {stockMultiplierBp: 12500}}`; colony → **`settled`** (D-18). The `lobby` module re-places the player (TA-08.5 / TA-05).
  - **Launch gate (D-18):** `launchRocket` is rejected (`launch_gate`) unless the colony's own territory is 100 % Living. Wall, Deep Water and building-footprint tiles are excluded, as in units spec `UO-TF-06`.
  - **Settled colony:** stays on the planet as an inert, invulnerable entity group. It keeps its tiles and its frozen border (anchors are never removed, so there is no grace revert). It runs no systems: no power, production, robots, combat or rule engine, so it has no tick cost. It cannot be raided or targeted. It still counts toward planet score and occupancy.
  - Settled status is the precondition for the player's NEAR staking flow (NEAR.md, D-18). The sim only emits `colonySettled {colonyId, terraformBp, ownedTiles}`.

---

## 8. Rule engine & priorities (`SIM-R`)

- `SIM-R-01` Utility AI per colony once per second of game time (staggered per §3). It never spends more than it has and only issues tasks the command validator would accept.
- `SIM-R-02` Needs (each scored 0–10 000 bp): `energy` (net balance, deficit ticks, night forecast), `storage` (fill ratio ≥ 85 %), `supply` (used/cap ≥ 90 % and factory idle), `extraction` (per-resource income vs. spend over last 600 ticks), `defense` (threat level = hostiles within 15 tiles + recent damage), `expand` (free buildable owned tiles < 30 or unclaimed deposits within 20 tiles), `repair` (damaged/severed), `rocket` (silo progress affordability).
- `SIM-R-03` Priority sliders scale needs: `score = need × (5 000 + priority × 100) / 10 000`; `repair` and `defense under attack` are floored at 8 000 bp regardless of sliders.
- `SIM-R-04` Directive (`ai.directive`) overrides slider weights for its `ttlTicks` (≤ 18 000) and injects intents as `ai` tasks; it can never exceed resources or bypass validation; expired directives are dropped.
- `SIM-R-05` Site selection is deterministic: candidates scored by distance to Hub/deposit/pylon, ties by tile index; random tie-breaks only from the `ai` stream.
- `SIM-R-06` `away = true` (set by the `game` module via the `system.presence` command when the player is away; policy in `CONTINUITY.md`) changes only rule-engine behaviour flags: no new raids are initiated; demolition is not performed; defense floor +1 000 bp. Everything else runs identically, so offline colonies keep growing.

---

## 9. Significant events (`SIM-E`)

`step()` returns `events: SimEventV1[]`. The host forwards significant ones to the in-process event bus (`planet.event`), which feeds `ai`, `notify`, `near` and the away digest.

| Event | Severity | Trigger / debounce |
|---|---|---|
| `colonyFounded` | info | `spawnColony` applied |
| `underAttack` | critical | hostile damage to a colony entity; debounce 60 s per colony |
| `buildingDestroyed` | warn | any own building destroyed |
| `powerSevered` / `powerOverload` | warn | component split / pylon over max load (`powerOverload` debounced to 600 ticks, as §7.4) |
| `energyCollapse` | critical | colony brownout ≥ 30 s |
| `resourceShortage` | warn → critical | resource < 5 % of cap with negative net over 60 s |
| `hazardStrike` | info / warn | lightning or meteor hit on the colony |
| `neighborContact` / `territoryCollision` | info | first foreign entity seen / first frozen border |
| `raidStarted` / `raidRepelled` | warn | raid begins / all raiders dead |
| `rocketReady` / `rocketLaunched` / `colonySettled` | info | silo complete / launch / settled |
| `colonyCritical` / `colonyEliminated` | critical | units spec `UO-HQ-04` |
| `cargoExportRequested` / `marketOrderMatched` / `truceSigned` / `bountyCompleted` | info | inputs for the `near` module (D-26) |
| `cmd.rejected` | — | routed to the issuing socket or module only |

---

## 10. Planet generation (`SIM-GEN`)

`createPlanet({planetId, type, seed, capacity})` — hex radius 56 **(proposed)**; `capacity` spawn slots on a ring of radius 32 at equal angles + `gen`-stream jitter ±3 tiles; each slot guaranteed within 12 tiles: ≥ 1 metals, 1 minerals, 1 oil deposit (richness 9 000–12 000 bp) and buildable 7×7 area. Terrain from value-noise on the `gen` stream. Mix per type (D-33, **proposed**):
- `temperate`: forest 20 %, water 6 %, rock 8 %; Minerals deposits richness +15 %.
- `desert`: slope 30 % (dunes, drawn as sand), rock 12 %, water 1 %; Metals and Minerals deposits richness +15 %; Water Extractor ×0.5.
- `ocean`: water 35 % (shallow 20 %, deep 15 %), forest 30 %, rock 5 %; Bio (oil) deposits richness +20 %; Metals −15 %; storms ×1.5 frequency (§7.6).

Hackathon (D-27): only `temperate` is generated; `desert` and `ocean` are post-hackathon (W05). Same `(type, seed)` ⇒ identical planet (golden test).

Terrain classes, spawn guarantee and terrain mix follow units spec §4.5 (`UO-TF-09`).

---

## 11. Host model (`SIM-H`) — `game` module

### 11.1 Thread pool
- `SIM-H-01` The `game` module starts `SIM_THREADS = cores − 1` `worker_threads` (3 on the launch host). Each owns a disjoint set of planets: `hash(planetId) % SIM_THREADS`. Planet state never leaves its thread, except as snapshot bytes, deltas and events.
- `SIM-H-02` The main thread validates commands (§4) and posts them to the owning thread. Threads post deltas, events and snapshots back. Each thread runs one drift-free loop: planets carry `nextDueMs`, and the thread steps every due planet once per pass.

### 11.2 Active and coarse stepping
- `SIM-H-03` **Active planet** (≥ 1 connected player socket): step `dt = 1` every `TICK_MS` (200 ms). Deltas go out at `DELTA_HZ` (5 Hz).
- `SIM-H-04` **Empty planet**: step `dt = COARSE_DT` (5) every `COARSE_STEP_MS` (1 s). No deltas are built. Events still go to the bus (notifications, AI, digest). A join switches the planet to active at its next step. The last leave switches it to coarse after `AWAY_AFTER_S`.
- `SIM-H-05` A planet more than 5 steps behind its due time steps at most 5 times per pass and raises `ta_game_tick_lag_steps`.

### 11.3 Snapshots
- `SIM-H-06` Every `SNAPSHOT_EVERY_S` (60 s) per planet, staggered. Also on seal, end and graceful shutdown. Encoding happens on the sim thread; compression and the Postgres write happen async on the main thread. At most one in-flight write per planet; a newer snapshot replaces a queued one.

### 11.4 Restart and fast-run
- `SIM-H-07` On app start, every live planet:
  1. loads its latest snapshot;
  2. computes the missed wall-clock time `gap = now − snapshot.savedAt`;
  3. **fast-runs** `min(gap, RESTART_FASTRUN_MAX_H)` of game time in coarse steps (`dt = 5`), as fast as the thread allows and yielding between planets;
  4. resumes normal stepping.
  Any gap beyond the cap is not simulated. Player actions after the last snapshot are lost (≤ 60 s), which is accepted (D-24).
- `SIM-H-08` **Fault quarantine.** An exception in `step()` for planet P: stop P, log, emit `planetFaulted`, keep the other planets running. One automatic retry from the latest snapshot. If it faults again it stays `FAULTED` until an admin acts.

---

## 12. Performance budget (`SIM-P`)

MVP scale per planet: 5 colonies, ≤ 300 units, ≤ 400 buildings, ≤ 60 fauna, ~9 600 tiles.

| Metric | Target |
|---|---|
| `step(dt=1)` mean / p99 | ≤ 1.5 ms / ≤ 3 ms |
| `step(dt=5)` p99 (coarse) | ≤ 5 ms |
| `snapshot()` for `welcome` (D-31) | ≤ 10 ms; ≤ 1 MB before compression |
| Client sim worker step (D-31) | p95 ≤ 4 ms on an iPhone 13-class phone at MVP scale; above it prediction switches off |
| Delta build per planet | ≤ 1 ms per 200 ms |
| `snapshot()` encode | ≤ 10 ms; ≤ 512 KB compressed |
| Memory per planet | ≤ 40 MB |
| 3 sim threads | ≥ 60 planets with ≤ 20 active at a time and ≥ 40 % headroom per thread |

`npm run sim:bench` measures these on the `mvp-scale` scenario. The load test confirms `MAX_ACTIVE_PLANETS`.

---

## 13. Test matrix

| Rule | Test | Task |
|---|---|---|
| `SIM-D-01/04/05` | `shared/sim/test/reproducible.spec.ts` (same seed + commands → same state) | TA-06.1 |
| `SIM-D-06` | lint fixture `test/lint/banned-apis.fixture.ts` must fail `eslint` | TA-06.1 |
| `SIM-D-03`, `SIM-H-04` | `test/kernel/coarse-dt.spec.ts` (production, timers and hazards scale with `dt`; coarse vs fine within tolerance over 1 h) | TA-06.1 |
| `SIM-GEN` | `test/gen/planet-golden.spec.ts` | TA-06.2 |
| `SIM-S-01` | `test/codec/roundtrip.property.spec.ts` | TA-06.9 |
| `SIM-V-01..05` | `test/view/full-state.spec.ts`, `test/view/delta.spec.ts` (replica deep-equal after `applyDiff`) | TA-06.9, W00-24 |
| `SIM-X-01..08` | `test/host/sim-host.spec.ts`, `npm run test:parity`, client `prediction.spec.ts` | W00-54 … W00-58 |
| `SIM-G-TER` | `test/systems/territory.spec.ts` | TA-06.3 |
| `SIM-C-01..05`, §7.1 | `test/systems/commands.spec.ts`, `test/data/catalog.spec.ts`, `test/systems/cargo.spec.ts` | TA-06.4, TA-14 |
| `SIM-G-PWR` | `test/systems/power.spec.ts` (severing, shedding order, capacitors, pylon overload) | TA-06.5, TA-06.12 |
| `SIM-R-01..06` | `test/systems/rule-engine.spec.ts`, scenario `unattended` | TA-06.7 |
| §7.6–§7.7 | hazards, fauna, progression, raids, settlement specs | TA-06.8, 06.10, 06.11, 06.13 |
| `SIM-H-01..08` | `backend/app/test/game/{thread-pool,coarse,snapshot,restart-fastrun,quarantine}.spec.ts` | TA-07 |
| `SIM-P` | `npm run sim:bench`, load test | TA-13.5 |

---

## 14. Owner decisions (2026-10-29 / 2026-10-30)

| # | Question | Decision | Ref | Consequence for this spec |
|---|---|---|---|---|
| 1 | Founder Core +8 E/s on the Hub | **Keep** | D-16 | §7.1 Hub row unchanged |
| 2 | Rocket tier and the colony left behind | Silo T2 only; the colony becomes **Settled** (not ruins); launch needs 100 % Living own territory | D-18 | §7.7 Departure; event `colonySettled`, reject code `launch_gate` |
| 3 | Trade Hub T1 required for trades | **Yes** (truces don't need it) | — | §7.1 Trade Hub row confirmed |
| 4 | Fauna/hazard pressure on unattended colonies | **Hard**: unattended colonies can be eliminated; the player is notified | D-17 | §7.6 note; numbers in units spec §6.3 |
| 5 | Per-pylon max load | **Enforced in MVP** | D-21 | §7.4 flow model and overload shedding |
| 6 | Failover downtime | ~~Fast-forwarded by catch-up~~ → **restart fast-run from snapshot** | D-20 → D-24 | §11.4 |
| 7 | Server simulation, simplified | **Yes**: one app, thread pool, 5 TPS active / coarse when empty, floats, no replay | D-24 | §2–§6, §11, §12 rewritten |
| 8 | Anti-cheat / anti-bot | **None**: zod + own-colony + game rules only; full state to clients | D-25 | `SIM-C-01`, §6 |
| 9 | NEAR economy | Cargo export/import, market reservations, bounties enter the sim as commands | D-26 | §4 command groups, `SIM-C-05` |
| 10 | Planet types | `desert` / `ocean` / `temperate`, one-to-one with the landing worlds | D-33 | §5 `PlanetType`, §7.6 Ocean column, §10 mix |
| 11 | Resources | Metals / Minerals / Bio × T1–T3, unlocked by terraforming; Energy is grid power | D-34 | §5 `ResourceKey`, `SIM-G-RES`, §7.1–§7.3 cost reading, storage per family |
| 12 | Balance tuning | Data rows + overrides file + dev `tune` | D-35 | `SIM-G-DATA` |
| 13 | `powerOverload` debounce | 600 ticks in §7.4 and §9 (under `SIM-D-03` that is 60 s of game time) | R8 | §9 row |

Follow-up design needed:
- Settled colonies and the planet `ENDED` condition: resolved in MATCHMAKING `MM-07`. An all-settled planet ends early (proposed).

---

## 15. Future: deterministic distributed host (not built now)

Kept for later (ARCHITECTURE §16):
- integer-only, bit-exact sim across runtimes (`SIM-D` v0.1: milli-units, lookup-table trig, banned float literals);
- a JetStream command log with tick markers, so `restore + replay` is exact;
- `stateHash` checkpoints every 100 ticks, worker leases with fencing epochs, catch-up ticking after failover (former D-20);
- per-colony fog-of-war views and diffs on the server;
- replay audits as an anti-cheat option.
