# Hive fauna — Wave 07

> Owner direction: 2026-11-04. This is an implementation contract, not a claim that W07 is built.
> W07 replaces the single hostile Skitter/nest design with three neutral insect species and species-specific hives.
> Integration: [W07](../plan/waves/W07-first-contact.md), [D-43](../spec/DECISIONS.md#d-43--neutral-hive-fauna), [battle rules](./units-orders-and-progression-spec.md#5-battle-system-v1).

## 1. Roster and identity

Fauna belongs to the planet, never a player colony. Every authoritative bug has a species and a home hive. Every hive spawns exactly one species. All three species exist from world generation; raid eligibility does not control whether wildlife exists. Planets eventually get distinct models, but W07 deliberately uses the same six models on all planets through a `(planetType, species, role)` visual registry with shared fallbacks. Gameplay IDs never depend on mesh IDs.

| Species ID | Role / visual direction | Hive archetype | Bug archetype |
|---|---|---|---|
| `blackAnt` | Small charcoal-black ant; narrow waist, six hooked legs, cutting mandibles, angular antennae; fast melee hordes | `fauna.hive.blackAnt`: low crater mound, multiple radial tunnels, trails and brood chambers | `fauna.blackAnt` |
| `blueBeetle` | Huge cobalt beetle; low wide silhouette, overlapping armored plates, heavy forelegs and horn; slow tank | `fauna.hive.blueBeetle`: squat buttressed shell bunker, broad entrance, molted armor plates | `fauna.blueBeetle` |
| `greenSpitter` | Emerald insect; elevated abdomen, wet, veined acid sacs, split secretory mouth; ranged acid shots | `fauna.hive.greenSpitter`: ribbed chimney mound, resin sacs and recessed acid basin | `fauna.greenSpitter` |

Use bold, threatening silhouettes, hooked limbs and biological asymmetry. The owner-approved organic policy (`.agents/skills/procedural-kitbash-3d/references/organic-fauna.md`, 2026-11-05) permits anatomical geometry, procedural color/roughness/normal fields, nonmetallic tissue profiles and bounded soft-sac deformation. Mechanical 60/30/10 palettes, mounted surface greebles and mandatory emissive accents do not apply to these insects or their hives. These are living insects, not robots painted in three colours. Black means readable charcoal with light-catching chitin ridges, not a featureless black silhouette. Tank armor is visible plating and higher HP in battle v1; no damage-reduction matrix is introduced. Acid uses the existing timed projectile/impact rule with a green visual payload; no damage-over-time pool, corrosion or economic subsystem.

Proposed initial tuning (D-35 rows; all distances in tiles, times in simulated seconds):

| Species | HP | Speed | Radius | Attack | Hive population cap | Replenish interval |
|---|---:|---:|---:|---|---:|---:|
| blackAnt | 120 | 2.0 | 0.3 | 8 damage / 1 s, range 1 | 12 | 60 s |
| blueBeetle | 900 | 0.8 | 0.8 | 24 damage / 2 s, range 1 | 3 | 180 s |
| greenSpitter | 180 | 1.4 | 0.4 | 12 damage / 2 s, range 5, projectile speed 4, no splash | 6 | 120 s |

All hives start at 1,500 HP. These numbers are starting proposals, not owner-approved balance. Model scale must agree with gameplay radii. Species, weapons, hive density, cadence and population limits are data rows.

## 2. Exactly two behavior modes

`passive` and `aggressive` are the only behavior modes. Eating, resting, grooming, carrying scraps and tending brood are presentation activities inside passive mode, not extra AI states. No hunger, inventory, food production, nest construction jobs, births economy or LLM decisions.

- **Passive:** idle and short home-area wandering through normal unit orders; the renderer adds small feeding, carrying and building gestures. Neither proximity nor being visible provokes an attack. Player turrets, Hunt and attack-move ignore neutral bugs/hives unless explicitly ordered to attack them. Inspection clearly labels them NEUTRAL.
- **Aggressive:** a hive targets a specific colony and sends bounded waves of its own species. Other colonies stay neutral unless separately provoked. Store colony-scoped aggression records; the hive is aggressive while any record exists. Bugs in an attack cohort carry its target colony. No global hostility flip from one player walking past.
- **Provocation:** a confirmed damaging player attack on a passive bug or hive creates aggression against the responsible colony, even before S3 (the player initiated it). Incidental spotting and passive cosmetic actions never do. No retaliatory chain between unrelated hives.
- **Scheduled pressure:** retain the S3 + 5 min grace period (Factory completion + 5 min with W08 off). Every 10 min, roll `min(1, 0.10 + 0.05 * thermalCount)` per eligible colony. Select a live reachable hive deterministically (distance, then ID); a successful roll establishes aggression and one wave, not an unbounded spawn loop. Existing aggression does not multiply rolls.
- **Bounded episode:** proposed default: at most 3 waves per aggression episode, 60 s minimum between waves and at most one active cohort per hive/colony pair. After the last cohort resolves, clear the record and return surviving residents home. Further damage may renew the episode but cannot bypass cooldowns or population caps. Colony loss/disconnect are distinct: disconnect does not cancel attacks, colony elimination does.
- **Population:** dispatch living residents; do not create free units to fill a wave. Reserve dispatched residents against the hive cap until dead/returned. Spawn at a legal entrance through `placeSpawnedEntity`; if blocked or at cap, postpone one spawn without an accumulated burst. Newborns start passive until assigned to a wave.
- **Wave budget:** `min(12, 2 + threatStage + thermalCount)` threat points. Ant costs 1, beetle 4, spitter 2; send at most `floor(budget / cost)` available residents. If none fit, skip. All three species can raid in W07; later Brute/Drifter additions must extend this registry, not overwrite it.
- **Target/movement:** issue attacks toward reachable structures of the target colony, nearest distance then stable entity ID. Use the units runner, shared pathfinding and locomotion; no position writes in fauna or render systems. Blocked routes wait/repath within the existing budget; after a tunable 300 s timeout return home and report a withdrawal, not an extermination. W14 gate/siege rules extend this behavior.
- **Hive destroyed:** stop replenishment and new waves immediately. Existing attackers finish their current wave; remaining residents stay passive and stop replenishing. Keep a tombstone home ID for surviving bugs and replay history. Emit `nestDestroyed` once for existing achievement consumers with added species/hive metadata.

## 3. Determinism and online transport

A seed alone is insufficient: terrain edits, damage, orders and path scheduling also affect decisions. The backend and browser must execute the same version of `@terra/sim` with the same inputs and tick order. The server remains authoritative for HP, deaths, spawning, mode transitions and raid outcomes.

- Generate hives in `shared/sim/src/gen/world/` on traversable land, outside the existing 25-tile landing exclusions, clear of deposits/structures and with a legal entrance. Reuse the landing/presence model so later landings do not overlap hives. Target total density remains roughly 1 / 400 eligible tiles (desert ×0.7), split between the three species, not tripled. Canonical generation version and stable cell ordering determine IDs. Small maps may have fewer species; the demo guarantees all three by fixtures.
- Use the existing xoshiro seed helpers, with versioned domains keyed by planet seed, hive ID and decision counter. Persist counters/state. No `Math.random`, wall clock, render delta, collection insertion order or secret world salt for replayable fauna decisions. This public randomness is intentionally predictable; it grants no authority to clients.
- Separate gameplay draws from cosmetic draws. Changing quality, culling, particle count or camera visibility must not consume gameplay RNG. Presentation derives activity from `(hiveSeed, bugId, activityEpoch)` and authoritative tick.
- Server records compact tick-stamped directives: `{version, seq, effectiveTick, hiveId, decisionIndex, kind, payload}` for spawn, mode, cohort dispatch/return and target changes. Dispatch carries cohort ID, species, member IDs, target colony and initial objective. Quantized target cells and stable ties remove renderer dependence. Generated server directives are applied once; clients do not independently re-emit them.
- Keep exact authoritative state in server snapshots. Bootstrap/reconnect carries live bugs (HP, position, home, order/path cursor), hive state, RNG counters, pending impacts, active cohorts and last directive sequence. Steady state carries directives plus authoritative combat events and sparse corrections, not every bug transform each tick.
- Extend the existing engine codec/diff path explicitly: omit only reconstructible fauna motion columns from routine wire diffs after replay parity is proven. Keep simulation/change tracking complete on the server. Do not silently strip columns from general snapshots or break normal unit replication. Version the capability with the engine/data version; mismatch requests a fresh compatible snapshot, never speculative replay with different rules.
- Directives are reliable, ordered and idempotent by sequence. Duplicate: ignore; gap: pause fauna prediction and request replay from the retained bounded log or a checkpoint; late: restore checkpoint and replay at the original tick, never apply at receive time. Bound replay memory/work. If shared pathfinding cannot reproduce an order (different queue/terrain), send path/cursor correction; do not hide drift with visual teleportation.
- Proposed correction interval: 5 simulated seconds, plus immediate authoritative combat/death events; batch only changed fauna correction records. This is recovery traffic, not a promise of zero state transfer. `predict=0` still advances a non-speculative replica from accepted directives; it does not need local player-command prediction.
- Test server, browser and local host, restart, reconnect, late/duplicate/missing directives, terrain edits during a wave, hive destruction, multi-colony targeting and disabled W07. Replay identical accepted inputs and compare discrete decisions exactly and positions within the engine's declared numerical tolerance. Independently verify gameplay RNG is unchanged by presentation activity.

## 4. Frontend and playground

Extend the existing renderer, unified material, catalog and instanced unit pipeline. Six real archetypes are mandatory in the W07 slice, not placeholders deferred to later waves. The three shared species remain distinct in silhouette under every biome's weathering. Swarm instances use GPU six-leg tripod gaits and body suspension; jaws/acid sacs use work/attack channels. Particle acid impacts use pooled 3D chunks and the particle validator. Renderer animation never deals damage.

The playground must offer:

- Individual inspection of all three bugs and all three hives, in iso/front/side/top and all three biomes.
- A small hive-life scene per species: deterministic seed, pause/step/reset, passive/aggressive switch, walking/feeding/building gestures, attack target, acid projectile and impact preview, population and wave counters.
- A mixed encounter with all three hive types, using the shared sim fixture in the playground app; `render/` accepts views, never imports sim internals. Aggression controls send dev fixture commands, not direct state/position writes.
- Planned URL controls `faunaScene=blackAnt|blueBeetle|greenSpitter|mixed`, `faunaMode=passive|aggressive`, `faunaSeed=<integer>`; preserve current `inspect`, `biome`, `view`, `work` controls. Register/document controls in DEV_TOOLS when implemented. These URLs are not yet implemented.
- Mode labels and colony-specific threat markers distinguish neutral wildlife from a raid. Selection says home hive, species, mode, target colony and next wave countdown. No fake inventory/build progress UI for cosmetic activity. Use Faction Plate tokens.

## 5. Delivery gates

1. Six models: `validate:models` zero errors/warnings, under 3.5k triangles each, grounded; four-view screenshots in every biome, plus a gait and attack sweep. Do not weaken validator thresholds to permit spines or dark shells.
2. Passive encounter: walk past all three hives; no attacks or auto-fire. Explicitly attack one; only that hive retaliates against the responsible colony.
3. Wave encounter: ant numbers, slow beetle durability and ranged acid are observable; HP/impact results agree in two browser clients and on the server. Destroy hive; no new spawns/waves, no immortal orphan cohort.
4. Persistence/replay: save/reload mid-wave and reconnect a second browser; identities, RNG counters, deaths and pending acid impacts match. Missing/duplicate directives neither duplicate bugs nor omit deaths.
5. Stress: 200 combat units including fauna, 50 projectiles, 6 hives; meet SIM tick budget and measure steady-state wire bytes at ≤15 KB/s per client during the 50-unit encounter (bootstrap excluded). Report actual figures; don't claim order-only sync while still sending every position in the generic diff.
6. W07 off: no fauna generation, directive channels, UI or gameplay effects; existing saves remain loadable. W07 with later waves off still supports all three species.
7. Owner check plays passive life → provocation → three species' waves → destroy hive → reconnect; commit the executed guide to `docs/plan/checks/w07-check.md` when the implementation is ready.
