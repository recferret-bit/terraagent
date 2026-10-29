# TerraAgent — Simulation & Planet Host Specification

> **Status:** Draft v0.1 (2026-10-29) — for owner review.
> **Parent:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) §9 (simulation), §6 (NATS), §13 (WS), §14 (failover), §15 (tunables) · [`DECISIONS.md`](./DECISIONS.md) D-01, D-02, D-13, D-15
> **Gameplay source:** [`colony-economy-and-buildings-spec.md`](../../colony-economy-and-buildings-spec.md), [`autonomous-colony-spec.md`](../../autonomous-colony-spec.md)
> **Implemented by:** [`TA-06`](../plan/issues/TA-06-simulation-core.md) (`@terra/sim`, lane L2) and [`TA-07`](../plan/issues/TA-07-planet-worker.md) (`@terra/planet-worker`, lane L3)

---

## 1. Purpose

Defines the authoritative planet simulation (`shared/sim`) and how a planet-worker hosts it: determinism rules, the per-tick system pipeline, the command model, state layout, snapshot/hash format, fog-of-war views and deltas, the MVP content set with numbers, the rule engine, and the host (scheduler, leases, snapshots, restore + replay). Rules are numbered so they can be grilled and traced to tests (§13).

Numbers marked **(proposed)** are not in the game-design specs; they are balance placeholders, owner-tunable, and live in data tables (`shared/sim/src/data/*.ts`), never in system code.

---

## 2. Determinism rules (`SIM-D`)

| ID | Rule |
|---|---|
| `SIM-D-01` | `@terra/sim` MUST produce bit-identical state for identical `(initial params, seed, tick-marked command log)` on any Node ≥ 22 and in any browser. |
| `SIM-D-02` | All persisted/hashed state MUST be integers within `±2^53`. Floating-point values are forbidden in state. The canonicalizer used by `hash()` and `snapshot()` MUST throw `SimNonIntegerError` on any non-integer number. |
| `SIM-D-03` | Fixed units (all integers): **resources** in milli-units (`1 unit = 1000 mu`); **energy** in milli-E; **HP** in milli-HP; **percentages** in basis points (`10000 bp = 100 %`); **time** in ticks (`1 s = 10 ticks`, `TICK_MS = 100`); **positions** in sub-tile units (`1 tile = 1024 su`) on top of axial hex `(q, r)`. Spec values like `+1.5 E/s` become `150 milli-E/tick`; `+4.0 Metals/s` becomes `400 mu/tick`. |
| `SIM-D-04` | Arithmetic helpers live in `shared/sim/src/math/fixed.ts`: `mulBp(a, bp)`, `mulDiv(a, b, c)` (floor), `idiv(a, b)` (floor toward −∞), `isqrt(n)`, `clamp`. Division in systems MUST go through these. Trigonometry uses integer lookup tables (`sinTable[4096]`, values in bp). |
| `SIM-D-05` | Randomness only from the planet PRNG: **xoshiro128\*\***, seeded by `splitmix64(planet.seed ^ STREAM_ID)`. Independent streams: `gen` (map generation), `weather`, `hazard`, `fauna`, `ai` (rule-engine tie-breaks), `combat`. Stream states are part of state and of the snapshot. Adding a draw in one stream MUST NOT shift the others. |
| `SIM-D-06` | Iteration order is canonical: entities in ascending `entityId`; colonies in ascending `colonyIndex`; tiles in ascending tile index. Entity ids are monotonic (`meta.nextEntityId`) and **never reused**. `Map`/`Set` may be used only as caches rebuilt from canonical arrays; systems MUST NOT make decisions by iterating an unsorted `Map`/`Set`. |
| `SIM-D-07` | Banned in `shared/sim/src/**` (lint config `@terra/eslint-config/sim`, enforced in `npm run check`): `Date`, `performance`, `Math.random`, `Math.sin/cos/tan/atan2/exp/log/pow/hypot/cbrt`, `setTimeout`, `setInterval`, `queueMicrotask`, `process`, `globalThis`, `crypto`, `async`/`await`, `Promise`, `for…in`, `Object.keys/values/entries` over state objects (use explicit field lists), `JSON.stringify` in hashing paths, `parseFloat`, `toFixed`, float literals outside `src/data/**`, and imports of `node:*`, `fs`, `path`, DOM globals, or any package not in the sim allow-list (`xxhash-wasm`). Implementation: `no-restricted-globals`, `no-restricted-properties`, `no-restricted-syntax`, `import/no-nodejs-modules`, plus the custom rule `terra/no-float-literal` (ignores `src/data/**`). |
| `SIM-D-08` | Data tables (`src/data/**`) MAY be authored in design units with decimals; `compileData()` converts them to integer units at module load and asserts exact conversion (`1.5 E/s → 150` exact, else throw). |
| `SIM-D-09` | Every behaviour change that alters outcomes for an existing log MUST bump `SIM_VERSION` (semver-ish integer). Snapshots record `simVersion`; a worker refuses to restore a snapshot whose `simVersion` differs unless a registered migration exists (`src/codec/migrations/`). Running planets are therefore pinned to the sim version they were created with until migrated (see §11.6). |
| `SIM-D-10` | `npm run sim:determinism -w @terra/sim -- --ticks N --runs R --scenario S` runs scenario `S` R times from scratch, plus once via `snapshot → restore` at a random mid-tick, and fails if any `stateHash` checkpoint differs. It also runs one leg in a different JS realm (`vm.Context`) to catch hidden global state. |

---

## 3. Tick pipeline (`SIM-T`)

`step(state, commands)` advances **exactly one tick** and mutates `state` in place (returns the same reference plus `events` and `stats`). Order of systems is fixed and part of `SIM_VERSION`:

| # | System | File | Notes |
|---|---|---|---|
| 0 | `commands` | `systems/commands.ts` | Apply this tick's commands in ascending `seq`. Semantic validation here; failures emit `cmd.rejected {seq, code}` (§4.3). |
| 1 | `environment` | `systems/environment.ts` | Day/night phase, weather (wind factor), storm state. |
| 2 | `hazards` | `systems/hazards.ts` | Lightning strikes, meteor impacts (PRNG `hazard`). W4. |
| 3 | `fauna` | `systems/fauna.ts` | Nest spawns, aggro, movement intents (PRNG `fauna`). W4. |
| 4 | `ruleEngine` | `systems/rule-engine.ts` | Each colony evaluated every 10 ticks, staggered: colony `i` runs when `tick % 10 == i * 2`. Produces tasks. |
| 5 | `robots` | `systems/robots.ts` | Task assignment, path requests (budgeted A\*), movement. |
| 6 | `construction` | `systems/construction.ts` | Build/upgrade/repair progress, completion, demolition. |
| 7 | `power` | `systems/power.ts` | Rebuild grid graph if dirty, per-component balance, capacitors, brownout shedding. |
| 8 | `production` | `systems/production.ts` | Extractors, fuel upkeep, storage caps, robot harvesting credit. |
| 9 | `factories` | `systems/factories.ts` | Robot build queues, supply cap. |
| 10 | `combat` | `systems/combat.ts` | Turrets, combat bots, fauna attacks, raids; damage; destruction (PRNG `combat` for target tie-breaks). |
| 11 | `territory` | `systems/territory.ts` | Claims on completion, anchor removal, 600-tick grace reverts. |
| 12 | `progression` | `systems/progression.ts` | Rocket silo progress/launch, colony score every 600 ticks. W4. |
| 13 | `lifecycle` | `systems/lifecycle.ts` | Colony elimination / departure, planet-wide end flags. |
| 14 | `finalize` | `kernel/finalize.ts` | `tick += 1`; on `tick % 100 == 0` compute `stateHash` into `meta.lastHash` and emit `hash.checkpoint`. |

- `SIM-T-01` Systems not yet implemented are registered as no-ops so the order (and therefore `SIM_VERSION`) only changes when a system gains behaviour.
- `SIM-T-02` A system MUST NOT read wall-clock, presence, or connection state. Anything presence-dependent enters as a command (`core.presence` published by the worker, §4).
- `SIM-T-03` Per-tick hard budget inside the sim: A\* node expansions ≤ `2000` per planet per tick; overflow requests wait in a FIFO (`state.pathQueue`) — deterministic.

---

## 4. Command model (`SIM-C`)

### 4.1 Shape

```ts
// shared/contracts/src/sim/commands.ts (owned by lead; sim consumes)
type SimCommandV1 = {
  seq: number;              // JetStream stream sequence of the command message (canonical order)
  tick: number;             // tick at which it is applied (from the tick marker, §4.2)
  colonyIndex: number | null; // null = planet-level (system/admin)
  source: 'player' | 'ai' | 'trade' | 'admin' | 'system';
  commandId: string;        // idempotency key (Nats-Msg-Id), e.g. `${colonyId}:${clientCmdId}`
  kind: SimCommandKind;
  args: unknown;            // zod-validated per kind at worker ingress
};
```

| Kind | Source(s) | Args (summary) | Semantic validation (sim) |
|---|---|---|---|
| `setPriorities` | player, ai | `{economy, expand, defense, rocket}` each `0..100` | colony active |
| `enqueueTask` | player, ai | `{task: 'build'\|'upgrade'\|'repair'\|'clear'\|'buildRobot'\|'raid'\|'launchRocket', …}` | per task (territory, resources, tier unlocked, target exists) |
| `cancelTask` | player | `{taskId}` | task owned by colony |
| `placeBuilding` | player | `{building, tier, q, r, rotation}` | footprint on own territory, free, terrain buildable, resources reservable |
| `upgradeBuilding` | player | `{entityId}` | owned, next tier enabled, +1 ring free & owned, Δcost reservable |
| `demolish` | player | `{entityId}` | owned, not Command Hub |
| `setAutopilot` | player | `Autopilot` (PROTOCOL) — player preference only; the away toggle is `core.presence` | — |
| `ai.directive` | ai | `DirectiveV1` (see `AI_ORCHESTRATOR.md`) | clamp weights, drop invalid intents individually |
| `trade.commit` | trade | `{tradeId, deltas: {metals?, minerals?, petroleum?, water?}}` | colony has Trade Hub T1 online; negative deltas covered; positive clamped to cap (overflow lost, reported) |
| `core.spawnColony` | core | `{colonyId, playerId, spawnSlot, startingStock?, kit}` | slot free, planet not ended |
| `core.retireColony` | core | `{colonyId, reason}` | — |
| `core.end` | core | `{reason}` | — |
| `core.seal` | core | `{reason}` | — (informational; admission is enforced by core) |
| `core.presence` | core (worker on presence change) | `{colonyId, away}` | switches autopilot policy (CONTINUITY `CT-12`, `AW-*`) |
| `core.arrive` | core | `{colonyId, playerId, carriedResources, founderTier}` | rocket transfer arrival (TA-06.10) |
| `trade.offer` / `trade.respond` / `trade.offerReceived` | near (trade saga), ai via directive | see NEAR.md §7 | Trade Hub T1 online; reserves the giving side |
| `trade.revert` / `trade.release` | near (trade saga) | `{tradeId, leg}` | undo an applied leg / drop a reservation |

> Authoritative kind names: [`PROTOCOL.md`](./PROTOCOL.md) `CommandKind`.

- `SIM-C-01` Schema validation (zod, `@terra/contracts`) happens at the worker ingress; the sim re-checks only **semantic** validity at the application tick, because state may have changed since ingress.
- `SIM-C-02` Rejections never throw. They emit `cmd.rejected {commandId, seq, code}` with codes: `invalid_args`, `colony_inactive`, `not_owner`, `not_own_territory`, `site_blocked`, `terrain_unbuildable`, `insufficient_resources`, `tier_locked`, `supply_cap`, `unknown_entity`, `no_trade_hub`, `raid_protected`, `planet_ended`.
- `SIM-C-03` Resources for `placeBuilding`/`upgradeBuilding`/`buildRobot` are **deducted at acceptance** (reserved into the construction site); cancel refunds 75 %, demolish refunds 50 % of the building's total cost **(proposed)**. In-place upgrade costs `Cost(Tn+1) − Cost(Tn)` per the economy spec §1.1.
- `SIM-C-04` Task precedence inside a colony queue: `player` tasks > `ai` directive tasks > autonomous rule-engine tasks; FIFO within each class; at most `50` queued tasks per colony (oldest autonomous tasks dropped first).

### 4.2 Tick tick marking & the durable log

- `SIM-C-05` Every command — from WS ingress, core, AI, NEAR — is first published to JetStream subject `{ns}.planet.{planetId}.cmd` (stream `{NS}_PLANET_CMDS`). The stream sequence is `seq`.
- `SIM-C-06` The owning worker consumes the subject in order. At the start of computing tick `t` it takes all received-but-unapplied commands (contiguous `seq` range) and applies them at tick `t`.
- `SIM-C-07` For every tick that applied ≥ 1 command, and in any case every `100` ticks, the worker publishes a **tick marker** `{planetId, tick, lastCmdSeq, count, leaseEpoch, stateHash?}` (hash present on `tick % 100 == 0`) to `{ns}.planet.{planetId}.tick` in the **same stream**. Landed in ARCHITECTURE §6.1; schema and rules in [`PROTOCOL.md`](./PROTOCOL.md) `NT-11`/`NT-13`.
- `SIM-C-08` A client/producer is acked (`cmd.ack {id, appliedAtTick}`) only after the tick marker covering it is durable (JetStream PubAck). Therefore every acked command is replayed at exactly the same tick after failover (RPO = 0 acked commands, bit-exact up to the last durable tick marker). Unstamped commands found in the stream during restore are applied at the first live tick after replay.
- `SIM-C-09` Replay rule: starting from snapshot `(tick T0, lastAppliedSeq S0)`, for each tick marker in order with `tick ≥ T0` and `leaseEpoch ≤ restoringEpoch`, step ticks up to `marker.tick`, applying commands `(prevUpToSeq, lastCmdSeq]` at `tick marker.tick`; verify `stateHash` where present. A hash mismatch aborts restore and marks the planet `FAULTED` (§11.5).
- `SIM-C-10` Lost game time: ticks after the last durable tick marker (≤ 100 ticks = 10 s) are recomputed; downtime itself is **not** fast-forwarded — the planet resumes from the last durably marked tick. Planet wall-clock lifecycle (seal/end) is owned by core and unaffected.

---

## 5. State layout (`SIM-S`)

Custom Structure-of-Arrays store (`shared/sim/src/ecs/store.ts`), inspired by bitECS but without global worlds or id recycling (bitECS rejected: global module state and recycled ids break `SIM-D-06` and snapshotting).

```ts
interface PlanetState {
  meta: {
    simVersion: number; planetId: string; planetType: 'temperate' | 'desert';
    seed: string /* u64 hex */; tick: number; nextEntityId: number;
    lastAppliedSeq: number; lastHash: string; rng: Record<RngStream, Uint32Array /*4*/>;
    ended: boolean;
  };
  grid: {                        // hex, radius R, tile index = axialToIndex(q, r)
    radius: number;              // 56 (proposed) → 9 577 tiles
    terrain: Uint8Array;         // plain | rock | forest | water | dune | crater
    deposit: Uint8Array;         // none | metals | minerals | petroleum | water
    richnessBp: Uint16Array;     // 5000..15000
    owner: Int8Array;            // colonyIndex or -1
    anchors: Uint8Array;         // count of friendly anchoring buildings
    graceUntil: Int32Array;      // tick at which an un-anchored tile reverts, 0 = none
    explored: Uint8Array;        // bitmask per colony (5 bits)
  };
  colonies: ColonyState[];       // index = colonyIndex (0..PLANET_CAPACITY-1)
  entities: {                    // SoA, dense, sorted by id
    id: Uint32Array; kind: Uint8Array; owner: Int8Array; tier: Uint8Array;
    q: Int16Array; r: Int16Array; x: Int32Array; y: Int32Array; /* su */
    hp: Int32Array; hpMax: Int32Array; state: Uint8Array; progress: Int32Array;
    // component-specific columns live in typed sub-stores keyed by dense index
  };
  power: { components: …; dirty: boolean };
  tasks: TaskQueue[];            // per colony
  pathQueue: PathRequest[];
  hazards: ActiveHazard[]; fauna: NestState[];
}

interface ColonyState {
  colonyId: string; playerId: string; status: 'active' | 'critical' | 'eliminated' | 'departed' | 'retired';
  resources: { metals, minerals, petroleum, water: number };   // mu
  caps: { storage: number; supply: number }; supplyUsed: number;
  energy: { lastNet: number; deficitTicks: number };            // milli-E
  priorities: { economy, expand, defense, rocket: number };      // 0..100
  autopilot: 'player' | 'away';
  directive: { weightsBp: …; intents: …; expiresAt: number } | null;
  raidProtectedUntil: number; criticalSince: number; score: number;
}
```

- `SIM-S-01` `snapshot(state) → Uint8Array` and `restore(bytes) → PlanetState` round-trip exactly: `hash(restore(snapshot(s))) === hash(s)` (property test over 1 000 random states).
- `SIM-S-02` Snapshot binary format **TASN v1**: header `magic "TASN" | u16 formatVersion | u16 simVersion | u64 tick | u32 epoch | u64 lastAppliedSeq | u64 stateHash | u32 sectionCount`, then sections `[u16 id | u32 byteLength | bytes]` (little-endian typed arrays, UTF-8 string table for ids). Uncompressed; the snapshot store (TA-03.3) compresses (gzip level 6). Target ≤ 512 KB compressed at MVP scale.
- `SIM-S-03` `hash(state)` = **xxHash64** (`xxhash-wasm`, isomorphic) over the canonical section bytes excluding the header's hash field; hex string. Computed every 100 ticks in `finalize` and on `snapshot()`.

---

## 6. Fog-of-war view & deltas (`SIM-V`)

- `SIM-V-01` `view(state, colonyIndex) → ColonyViewV1` contains: own colony (resources, caps, supply, energy, priorities, autopilot, task queue, all own entities); tiles explored by the colony (terrain, deposit, owner); **foreign/fauna entities only within current vision**: own territory + radius `6` around own buildings, `5` around own robots, `20` around Beacon T2 **(proposed except T2 beacon = spec)**. Foreign entities expose `id, kind, tier, owner, q, r, x, y, hpPct`; never resources or tasks.
- `SIM-V-02` `diff(prevView, state, colonyIndex) → ViewDeltaV1 { fromTick, toTick, ops[] }` with ops:
  - `{o: 'e+', e: EntityView}` entity entered view · `{o: 'e~', id, f: Partial<EntityView>}` changed fields only · `{o: 'e-', id, why: 'destroyed' | 'out_of_view'}`
  - `{o: 't', tiles: [index, terrain, deposit, owner][]}` tile changes · `{o: 'x', tiles: number[]}` newly explored
  - `{o: 'c', f: Partial<ColonyView>}` own colony fields · `{o: 'q', tasks}` task queue replaced when changed
  - `{o: 'ev', events: PlayerEventV1[]}` player-visible events since `fromTick`
- `SIM-V-03` Movement fields (`x, y`) are always included for moving entities in view so the client can interpolate (`tick` on the envelope); static entities send `e~` only on change.
- `SIM-V-04` `diff` cost MUST be O(entities in view), using per-entity `changedAt` ticks rather than deep comparison. Contract change request (lead): `ColonyViewV1`, `EntityViewV1`, `ViewDeltaV1` schemas in `@terra/contracts/ws`.

---

## 7. MVP content (`SIM-G`) — per D-15

All numbers from `colony-economy-and-buildings-spec.md` unless marked **(proposed)**. Unit conversion per `SIM-D-03` happens in `compileData()`.

### 7.1 Buildings enabled in MVP

| Building | Tier | Size | Build | Cost M/Min/Pet/W | Drain E/s | HP | Effect |
|---|---|---|---|---|---|---|---|
| Command Hub | T1 | 3×3 | 30 s (0 s at spawn) | 200/100/50/50 | −5 | 1 500 | Claim R 10; storage +500; supply +10; **Founder Core +8 E/s (proposed)**; acts as a pylon (span 6) |
| Command Hub | T2 | 4×4 | 75 s | 600/350/200/150 | −14 | 3 800 | Claim R 15; storage +1 500; supply +25 |
| Territory Claim Beacon | T1 | 1×1 | 18 s | 80/40/0/10 | −4 | 400 | Claim R 8 |
| Territory Claim Beacon | T2 | 2×2 | 42 s | 220/140/40/30 | −11 | 1 100 | Claim R 14; vision R 20 |
| Power Line Pylon | T1 | 1×1 | 4 s | 15/5/0/0 | −0.5 | 120 | Span 6; max load 80 E/s (**not enforced in MVP**, §7.4) |
| Energy Capacitor Bank | T1 | 2×2 | 16 s | 70/60/10/10 | −1.5 | 450 | Stores 1 500 E; discharge ≤ 30 E/s |
| Coal/Oil Thermal Plant | T1 | 2×2 | 15 s | 80/20/20/10 | −3 | 450 **(proposed HP)** | +28 gross; consumes 1.5 Pet/s; pollution +1 |
| Wind Turbine | T1 | 2×2 | 14 s | 70/35/5/0 | −1 | 400 **(proposed HP)** | +16 gross × wind factor 50–140 % |
| Solar Collector | T1 | 2×2 | 18 s | 60/75/10/5 | −1 | 400 **(proposed HP)** | +21 gross × daylight; 0 at night; +35 % on Desert |
| Solar Collector | T2 | 3×3 | 40 s | 160/220/35/15 | −3 | 1 000 **(proposed HP)** | +63 gross, same modifiers |
| Metals Extractor | T1 / T2 | 2×2 / 3×3 | 14 s / 34 s | 65/20/0/10 · 180/75/25/30 | −6 / −18 | 500 / 1 350 | +4.0 / +12.5 Metals/s × richness (must cover a metals deposit) |
| Minerals Quarry | T1 / T2 | 2×2 / 3×3 | 16 s / 38 s | 75/30/5/15 · 210/95/35/45 | −8 / −22 | 500 / 1 350 | +3.0 / +9.5 Minerals/s × richness |
| Petroleum Well & Refinery | T1 / T2 | 2×2 / 3×3 | 20 s / 45 s | 90/45/15/20 · 250/140/50/60 | −10 / −28 | 450 / 1 200 | +2.5 / +8.0 Pet/s × richness |
| Water Extractor | T1 | 2×2 | 15 s | 60/35/10/0 | −7 | 480 | +3.5 Water/s (×0.5 Desert); no deposit needed |
| Resource Supply Depot | T1 | 2×2 | 12 s | 60/25/10/0 | −2 | 600 | Storage +1 000 (M, Min, Pet, W) |
| Drone Control Array | T1 | 1×1 | 14 s | 55/45/10/5 | −5 | 350 | Supply +8 |
| Robotics Factory | T1 | 3×3 | 25 s | 120/70/30/20 | −10 | 800 | Builds T1 robots |
| Autocannon Turret | T1 | 1×1 | 12 s | 55/20/10/0 | −3 | 450 | Range 8; 18 DPS; −0.2 Metals/s while firing |
| Inter-Colony Trade Hub | T1 | 2×2 | 22 s | 100/80/30/10 | −6 | 650 | Required for `trade.commit`; ≤ 250 units/min — *outside the D-15 list; added for TA-10.5, owner to confirm* |
| Interplanetary Rocket Silo (Lander) | T2 | 4×4 | 210 s | 1 800/1 600/1 400/700 | −120 | 4 800 | Launches Founder Pod (+25 % starting stock on next planet) — *only rocket tier in MVP; owner to confirm* |

"Mine" in D-15 is interpreted as the three deposit extractors (Metals, Minerals, Petroleum). Everything else in the economy spec stays in the data tables with `enabled: false`.

### 7.2 Robots (T1 only)

> **Superseded if D-16 is accepted:** roster, lanes, queue, combat matrix, starting kit and threat scaling move to [`units-orders-and-progression-spec.md`](../../units-orders-and-progression-spec.md); that spec's §7 lists every rule in this file that changes.

| Robot | Build | Cost M/Min/Pet/W | Supply | Drain E/s | HP | Speed **(proposed)** | Capability |
|---|---|---|---|---|---|---|---|
| Miner / Harvester | 10 s | 40/15/5/0 | 1 | −1.5 | 160 | 1.5 tiles/s | +2.0 res/s from a surface deposit tile; clears forest/rock (yields 20 Metals per clear, proposed) |
| Builder / Repair | 12 s | 45/25/10/0 | 1 | −2.0 | 150 | 1.5 tiles/s | Build/repair rate 1.0×; repairs severed pylons |
| Combat / Raider | 14 s | 55/30/15/0 | 1 | −2.5 | 240 | 2.5 tiles/s | 14 DPS, range 4 (proposed); nest clearing, raids |

Logistics are abstract in MVP: harvested/extracted resources are credited directly to colony storage (no hauling). Robots draw their drain from the Hub's grid component; if that component is in deficit, robots operate at 50 % speed and work rate **(proposed)**.

### 7.3 Starting kit **(proposed)**

Command Hub T1 (instant), 1 Builder (the founder robot), 1 Miner; stock `400 M / 250 Min / 150 Pet / 150 W` (base storage 500 from the Hub). Founder Pod arrivals get stock × 1.25 (spec §3.6). Raid protection for `72 000` ticks (2 h) after founding.

### 7.4 Power grid rules (`SIM-G-PWR`)

- Graph nodes: Hub, pylons, and every powered building. Pylons/Hub link to other pylons/Hub within span (T1: 6 tiles); a building connects if any footprint tile is within **3 tiles (proposed)** of a pylon or the Hub.
- Per connected component: `supply = Σ online generator net output (with daylight/wind/Desert modifiers; thermal only while Pet > 0) + Σ capacitor discharge (≤ max)`; `demand = Σ drains of online consumers (+ robot drain on the Hub's component)`.
- Brownout shedding when `demand > supply`, in the economy spec's order — shed first: Rocket Silo; second: Robotics Factory, Trade Hub; third: extractors, Supply Depot; keep last: Turrets, Beacons, Drone Control Arrays, generators' internal drain. Within a tier, shed newest first (descending `entityId`). Surplus charges capacitors.
- Components without any generator or charged capacitor are fully `OFFLINE`. Severed by pylon destruction → graph marked dirty → recomputed same tick.
- Per-pylon max-load routing is **deferred** (post-MVP); recorded as a known deviation from the economy spec §1.3.

### 7.5 Territory rules (`SIM-G-TER`)

Exactly the economy spec §2: claim on construction completion (radius by tier), unclaimed → claim, same owner → add anchor, foreign → frozen border (never overwritten). Unpowered beacon cannot claim new tiles and takes +25 % damage. Anchor removal → tiles with zero anchors revert after `600` ticks unless re-anchored. All building placement requires own tiles.

### 7.6 Environment, hazards & fauna **(all proposed, owner-tunable)**

| Item | Temperate | Desert |
|---|---|---|
| Day length | 12 000 ticks (20 min): 60 % day, 40 % night; daylight curve from `sinTable` | same |
| Wind factor | resampled every 1 200 ticks, smoothed, 5 000–14 000 bp | same |
| Storms | mean interval 27 000 ticks (45 min), duration 1 800 ticks | sandstorm mean 54 000 ticks; solar −50 % during storm |
| Lightning (storms only) | strike every 200 ticks ± jitter on a random tile within any colony territory, tall-structure weight ×4 for pylons; 300 HP damage | same |
| Meteor | mean interval 36 000 ticks per planet; radius 2 tiles; 400 HP at centre, linear falloff; 30 % chance to create a new deposit | same |
| Fauna species (MVP) | **Skitter swarm** (one species for both types; skin differs): HP 120, 8 DPS melee, speed 2 tiles/s, aggro radius 6 from nest | same |
| Nests | 1 per ~400 tiles outside radius 25 of spawn slots; HP 1 500; spawns 1 Skitter / 900 ticks, max 6 alive per nest | density ×0.7 |
| Raids on colonies | every 6 000 ticks per colony: chance `10 % + 5 % × thermal plants` that the nearest nest sends 3 + ⌊tick/72 000⌋ skitters (cap 12) | same |

### 7.7 Combat, PvP, elimination

- Damage is instant-hit per tick (`DPS × 100` milli-HP per tick); target = nearest hostile in range, tie by lowest `entityId`.
- **Raids (PvP):** `enqueueTask {task: 'raid', targetColonyIndex, q, r}` sends idle combat bots. Combat bots adjacent to a foreign Supply Depot or Hub siphon 1 unit/s of each resource (attacker cap-limited) **(proposed)**. Not allowed against colonies with `raidProtectedUntil > tick` (`raid_protected`).
- **Elimination:** Hub destroyed → colony `critical`; if no Hub is rebuilt within 6 000 ticks, or no Builder exists while critical → `eliminated`: entities become neutral ruins (`owner = -1`, decaying 1 % HP/s), tiles un-anchored (grace applies), event `colonyEliminated`.
- **Departure (rocket):** Rocket Silo T2 complete + `launchRocket` → after 300-tick countdown emit `rocketLaunched {colonyId, carry: {stockMultiplierBp: 12500}}`; colony → `departed` (same ruin rules as elimination). Core re-places the player (TA-08.5 / TA-05).

---

## 8. Rule engine & priorities (`SIM-R`)

- `SIM-R-01` Utility AI per colony every 10 ticks (staggered per §3). It never spends more than it has and only issues tasks the command validator would accept.
- `SIM-R-02` Needs (each scored 0–10 000 bp): `energy` (net balance, deficit ticks, night forecast), `storage` (fill ratio ≥ 85 %), `supply` (used/cap ≥ 90 % and factory idle), `extraction` (per-resource income vs. spend over last 600 ticks), `defense` (threat level = hostiles within 15 tiles + recent damage), `expand` (free buildable owned tiles < 30 or unclaimed deposits within 20 tiles), `repair` (damaged/severed), `rocket` (silo progress affordability).
- `SIM-R-03` Priority sliders scale needs: `score = need × (5 000 + priority × 100) / 10 000`; `repair` and `defense under attack` are floored at 8 000 bp regardless of sliders.
- `SIM-R-04` Directive (`ai.directive`) overrides slider weights for its `ttlTicks` (≤ 18 000) and injects intents as `ai` tasks; it can never exceed resources or bypass validation; expired directives are dropped.
- `SIM-R-05` Site selection is deterministic: candidates scored by distance to Hub/deposit/pylon, ties by tile index; random tie-breaks only from the `ai` stream.
- `SIM-R-06` `away = true` (set by the worker via the `core.presence` command when the player is away — policy in `CONTINUITY.md`, TA-08.2) changes only rule-engine behaviour flags: no new raids are initiated; demolition is not performed; defense floor +1 000 bp. Everything else runs identically, so offline colonies keep growing.

---

## 9. Significant events (`SIM-E`)

`step()` returns `events: SimEventV1[]`. The worker forwards *significant* ones to `{ns}.planet.{id}.evt.{type}` (TA-07.7). Kinds and severities:

| Event | Severity | Trigger / debounce |
|---|---|---|
| `colonyFounded` | info | `spawnColony` applied |
| `underAttack` | critical | hostile damage to colony entity; debounce 600 ticks per colony |
| `buildingDestroyed` | warn | any own building destroyed |
| `powerSevered` | warn | component split leaves consumers offline |
| `energyCollapse` | critical | colony brownout ≥ 300 consecutive ticks |
| `resourceShortage` | warn → critical | resource < 5 % of cap with negative net over 600 ticks (critical if Pet/energy blocks generation) |
| `hazardStrike` | info / warn | lightning / meteor hit on colony |
| `neighborContact` | info | first foreign entity seen by a colony |
| `territoryCollision` | info | first frozen border between two colonies |
| `raidStarted` / `raidRepelled` | warn | raid task begins / all raiders dead |
| `rocketReady` / `rocketLaunched` | info | silo complete / launch |
| `colonyCritical` / `colonyEliminated` | critical | §7.7 |
| `cmd.rejected` | — | internal, routed to the issuing socket/producer only |
| `hash.checkpoint` | — | internal, every 100 ticks |

Contract change request (lead): `SimEventV1` / `PlanetEventV1` kind union in `@terra/contracts`.

---

## 10. Planet generation (`SIM-GEN`)

`createPlanet({planetId, type, seed, capacity})` — hex radius 56 **(proposed)**; `capacity` spawn slots on a ring of radius 32 at equal angles + `gen`-stream jitter ±3 tiles; each slot guaranteed within 12 tiles: ≥ 1 metals, 1 minerals, 1 petroleum deposit (richness 9 000–12 000 bp) and buildable 7×7 area. Terrain from integer value-noise (hashing, no trig). Temperate: forest 20 %, water 6 %, rock 8 %. Desert: dune 30 %, rock 12 %, water 1 %, metals/minerals richness +15 %. Same `(type, seed)` ⇒ identical planet (golden hash test).

---

## 11. Worker host model (`SIM-H`)

### 11.1 Scheduler
- `SIM-H-01` One Node event loop hosts up to `WORKER_MAX_PLANETS` (50) planets. Each planet has `nextDueMs = startMs + phaseMs + tick × TICK_MS`, where `phaseMs = (slotIndex × TICK_MS) / WORKER_MAX_PLANETS` spreads load.
- `SIM-H-02` The host loop wakes at the earliest `nextDueMs` (`setTimeout` + `setImmediate` yield between planets), steps every due planet once per pass, and never sleeps while any planet is behind. A planet more than `5` ticks behind steps at most 5 ticks per pass (catch-up) and raises `ta_worker_tick_lag_ticks`. Drift-free: due times derive from tick count, not from "previous tick + 100 ms".
- `SIM-H-03` Ticks are never skipped or merged (determinism). Overload is handled by lag + load shedding (§11.7), not by dropping work.

### 11.2 Lease
- Acquire with KV `create(planetId, {workerId, epoch, since})` (fails if present). `epoch` comes from core's `assignPlanet` (core increments `planet.leaseEpoch` in Postgres), renewed every 5 s via `update(key, value, lastRevision)`; TTL 15 s (ARCHITECTURE §6.2).
- Renewal failure ⇒ stop ticking that planet **immediately**, drop its in-memory state, close its sockets `4009 lease_lost`. Epoch fences writes: snapshot inserts and tick markers carry `leaseEpoch`; the snapshot store rejects `epoch < max(epoch)` for the planet.

### 11.3 Snapshot cadence
- Every `SNAPSHOT_EVERY_TICKS` (300) ticks, staggered (`tick % 300 == slotIndex % 300`), plus on seal/end/unload/drain. Encoding is synchronous at the tick boundary (budget ≤ 5 ms); compression and the Postgres write are async off the tick path. If a write is still in flight when the next is due, the newer replaces the queued one (never two concurrent writes per planet).

### 11.4 Restore + replay
1. Load latest snapshot (highest `tick`, `epoch ≤ mine`) → `restore` → recompute hash == header hash.
2. Read `{NS}_PLANET_CMDS` for this planet from `lastAppliedSeq + 1`, apply tick markers per `SIM-C-09` verifying checkpoint hashes.
3. Re-subscribe live from the last seq, apply unmarked leftovers at the next tick, start the scheduler. Target: restore ≤ 5 s for a 30 s replay window; total failover RTO ≤ 30 s (ARCHITECTURE §14).

### 11.5 Fault quarantine
- An exception inside `step()` for planet P: catch, stop P's ticking, emit `planetFaulted` event + metric, keep other planets running. One automatic retry: restore from latest snapshot + replay; because the sim is deterministic, a reproducing crash at the same tick marks P `FAULTED` permanently (no retry loop) and pages ops; non-reproducing crashes (host bug) resume.

### 11.6 Versioning
- Planets are pinned to `simVersion`. A worker build supports `SIM_VERSIONS_SUPPORTED` (current + previous) via side-by-side sim bundles or registered migrations; core places a planet only on workers supporting its version (advertised in `{ns}_workers.version`).

### 11.7 Load shedding
- If `tick_duration` p99 over 60 s exceeds the budget (§12) or lag > 20 ticks for 30 s: mark `load: 'high'` in `{ns}_workers` (scheduler stops placing planets there), reduce delta rate to 2 Hz for that worker's sockets; if lag > 100 ticks for 60 s, request core to move the newest planet away (`drain` of one planet).

---

## 12. Performance budget (`SIM-P`)

MVP scale per planet: 5 colonies, ≤ 300 robots, ≤ 400 buildings, ≤ 60 fauna, 9 577 tiles.

| Metric | Target |
|---|---|
| `step()` mean | ≤ 1.0 ms |
| `step()` p99 | ≤ 2.0 ms |
| `step()` max (any tick, incl. grid rebuild) | ≤ 10 ms |
| `view()` full (welcome) | ≤ 5 ms |
| `diff()` per socket per 200 ms | ≤ 0.3 ms |
| `snapshot()` encode | ≤ 5 ms; ≤ 512 KB compressed |
| Memory per planet | ≤ 40 MB |
| Worker (50 planets) | mean ≤ 50 % of one core for sim; ≥ 40 % left for WS/deltas/NATS |

The `sim:bench` script (`shared/sim/scripts/bench.ts`) measures these on the `mvp-scale` scenario; TA-13.5 confirms them end-to-end and sets `WORKER_MAX_PLANETS`.

---

## 13. Test matrix

| Rule | Test | Task |
|---|---|---|
| `SIM-D-01/10` | `shared/sim/test/determinism.spec.ts`, `npm run sim:determinism` | TA-06.1 |
| `SIM-D-02/03/04` | `test/math/fixed.spec.ts`, `test/kernel/integer-state.spec.ts` | TA-06.1 |
| `SIM-D-05` | `test/kernel/rng-streams.spec.ts` (stream independence) | TA-06.1 |
| `SIM-D-07` | lint fixture `test/lint/banned-apis.fixture.ts` must fail `eslint` | TA-06.1 |
| `SIM-GEN` | `test/gen/planet-golden.spec.ts` | TA-06.2 |
| `SIM-S-01/02/03` | `test/codec/roundtrip.property.spec.ts`, `test/codec/tasn-format.spec.ts` | TA-06.9 |
| `SIM-V-01..04` | `test/view/fog.spec.ts`, `test/view/diff.spec.ts` | TA-06.9 |
| `SIM-G-TER` | `test/systems/territory.spec.ts` (frozen border, grace revert) | TA-06.3 |
| `SIM-C-02/03`, §7.1 | `test/systems/construction.spec.ts`, `test/data/catalog.spec.ts` | TA-06.4 |
| `SIM-G-PWR` | `test/systems/power.spec.ts` (severing, shedding order, capacitors) | TA-06.5 |
| §7.2, `SIM-T-03` | `test/systems/robots.spec.ts`, `test/systems/pathfinding-budget.spec.ts` | TA-06.6 |
| `SIM-R-01..06` | `test/systems/rule-engine.spec.ts`, scenario `unattended-24h-compressed` | TA-06.7 |
| §7.6 | `test/systems/hazards.spec.ts`, `test/systems/fauna.spec.ts` | TA-06.8 |
| §7.7 rocket | `test/systems/progression.spec.ts` | TA-06.10 |
| §7.7 raids | `test/systems/raids.spec.ts` | TA-06.11 |
| `SIM-C-05..10`, §11.4 | `backend/planet-worker/test/integration/restore-replay.int.spec.ts` | TA-07.4, TA-07.6 |
| `SIM-H-01..03` | `backend/planet-worker/test/host/scheduler.spec.ts` | TA-07.2 |
| §11.2 | `backend/planet-worker/test/integration/lease.int.spec.ts` | TA-07.5 |
| §11.5 | `backend/planet-worker/test/host/quarantine.spec.ts` | TA-07.2 |
| §11.7, `SIM-P` | `npm run sim:bench`, worker metrics test | TA-07.8, TA-13.5 |

---

## 14. Open questions for the owner

1. **Founder Core +8 E/s** on the Hub (without it the starting colony has negative power until the first generator). Alternative: start with a prebuilt Solar T1 + Capacitor T1.
2. **Rocket in MVP = Silo T2 (Lander) only**, and the departing colony becomes ruins. Alternative: the old colony stays AI-run ("legacy colony") — more fun, more cost.
3. **Trade Hub T1** as a requirement for trades (economy spec says yes; D-15 list omits it).
4. **Fauna/hazard numbers** in §7.6 are placeholders; please confirm the intended pressure level for unattended colonies (they must survive a night offline at default difficulty).
5. **Per-pylon max load** deferred — acceptable for MVP?
6. **No downtime fast-forward** on failover (`SIM-C-10`): planet game time loses ≤ RTO per failover. OK?
