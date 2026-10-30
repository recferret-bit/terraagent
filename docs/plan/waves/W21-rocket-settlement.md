# W21 — Rocket & Settlement

> **Track:** Gameplay (G), with lobby hooks on Meta · **Flag:** `W21` · **Tag:** `wave-21` · **Scenario:** `scenarios/w21-rocket-settlement.ts` (planet with 3 colonies; colony A at Hub T2, 96 % Living, stock 6 000 each, Terraformer ×3, Processor T1) · **E2E:** `e2e/w21.spec.ts`
> **Depends on waves:** W05 (Living tiles, Terraform %), W11 (`TRANSFER` tickets, planet end), W17 (Hub T2, so the Silo T2 can be built), W20 (Deed, Settled Deed hook W20-15, mock wallet modal), W06 (the claim route of W06-01, also reached through W20). Optional: W08 (Prepare Rocket goal stub W08-20, inherited `unlockStage` W08-07), W09 (`rocket_ready` notification, AW-12 away rule), W12 (Settler achievement, Planets cards), W13 / W18 (open market orders and truces are closed on settle; those hooks run only when the wave is on), W24 (touch), W04 (global-map layer registry for the Rocket panel, W21-06).
> **Specs:** [units spec](../../game/units-orders-and-progression-spec.md) `UO-R-01..04`, `UO-Q-05`, `UO-LC-06/07`, §4.6, AC-17 · [economy spec](../../game/colony-economy-and-buildings-spec.md) §3.6 · [SIMULATION](../../spec/SIMULATION.md) §7.7 · [MATCHMAKING](../../spec/MATCHMAKING.md) `MM-07`, `MM-35`, `MM-47` (`TRANSFER`) · [CONTINUITY](../../spec/CONTINUITY.md) `AW-12` · [NEAR](../../spec/NEAR.md) §2 (claim) · D-18, D-31
> **Owned paths:** `shared/sim/src/systems/{rocket,settlement}/`, `shared/sim/src/data/rocket.ts`, `shared/contracts/src/{commands,events}/rocket.ts`, `frontend/game/features/{rocket,settlement}/`, `backend/app/src/lobby/transfer/`, the existing archetype `frontend/render/kitbash/archetypes/buildings/rocket.ts` (`building.rocket`), the settled mode of `frontend/render/visuals/UnifiedColonyMaterial.ts` (W18 adds the ruin mode)

## Goal

The colony's endgame works end to end. The player terraforms all owned land to Living, builds a Rocket Silo, confirms launch, and leaves a **Settled** colony behind. The rocket carries a Founder Pod (+25 % stock) to a new planet, and the account can be claimed. A planet where every colony has settled ends early. The silo model (`building.rocket`), the retro-flame/ground-dust FX of the descent cinematic and the orbit deploy → drop-pod descent already exist and are reused.

## Demo story (e2e)

1. Open `/play.html?scenario=w21`: the near-complete colony (Hub T2, 96 % Living, stock for the silo). Construction menu → build the Rocket Silo T2. → The Rocket panel shows `Living 312 / 325`, with an overlay highlighting the 13 missing tiles.
2. Click Launch in the Rocket panel. → Rejected `launch_gate`, and the overlay pulses.
3. Dev console `warp 20` until terraformers finish (or `setLiving 100`). → Launch enabled. Click Launch, then confirm (`AW-12`; `launch` in the console does the same). → 30 s countdown with VFX; the rocket lifts off.
4. The colony turns **Settled**: buildings freeze with a monument tint, and enemy units cannot target them (dev console `spawnUnit <id> 3 enemy`).
5. The orbital picker offers a new planet with the carry summary; join it. → The existing orbit deploy and drop-pod descent play, and the Founder Pod lands with 125 % starting stock.
6. On the old planet, run `settle <colony>` for the other two colonies. → The planet ends early (`MM-07`, W11-04's sweeper).
7. Open `/me.html` → "Claim account" runs the mock claim flow. → The account shows "claimed".
8. Run `TA_WAVES=..20 npm run dev:restart` and reload `/play.html?scenario=w21` → no silo, no launch, no settled state.

## Features covered

| Spec item | Issues |
|---|---|
| Rocket Silo T2 Lander (4×4, 210 s, 1 800/1 600/1 400/700, −120 E/s, 4 800 HP), shed group 1; MVP silo tier only | W21-02 |
| Silo cost > storage cap → `waiting(storage)` hint (`UO-Q-05`) | W21-03 |
| Launch gate: 100 % Living, excluding walls, deep water and footprints (`UO-R-01`, SIM `launch_gate`) | W21-04 |
| Launch-gate view (`Living n / m`, missing tiles) + chip and missing-tiles pulse on top of W05-22's Living overlay | W21-05, W21-06 |
| Launch requires explicit player confirmation (in-app modal); never while away (`AW-12`, enforced by W09-10's `awayPolicy`) | W21-07 |
| Countdown 30 s of game time (`compileData` converts), `rocketReady` / `rocketLaunched` events | W21-08 |
| Settled colony: inert, invulnerable, frozen border (no grace revert), no systems, counts for score and occupancy, seat kept, truces end, trades closed (`UO-R-02`, `UO-R-04`, SIM §7.7) | W21-09, W21-10 |
| `colonySettled {colonyId, terraformBp, ownedTiles}` → Deed becomes Settled Deed, staking available: W20-15 consumes the event (W21-11 dropped as a duplicate); asserted by the e2e | W21-27 |
| Carry-over: `carry.stockMultiplierBp = 12 500`, Founder Pod on a new planet via a `TRANSFER` ticket (W11-12) | W21-12, W21-13 |
| `unlockStage` inherited on the new planet (`UO-LC-06`, account value from W08-07) | W21-13 |
| All-settled planet ends early (`MM-07`): W11-04's sweeper owns the rule; this wave writes the settled status it reads | W21-14 |
| Account claim flow, mock `IdentityPort.claimAccount` (D-18) | W21-15, W21-16 |
| Prepare Rocket goal: Terraform Zone over all land + silo + stockpile; done when gate met (§4.6) | W21-17 |
| Rule engine `rocket` need; autopilot never launches (`AW-12`, `UO-LC-07`) | W21-17 |
| Achievement event: Star Settler (the +500 XP milestone is W12-06) | W21-18 |
| Notifications: `rocket_ready` (kind already routed by W09-21) | W21-19 |
| Visuals: bind the existing `building.rocket` model as the silo, launch VFX from the descent FX (plume, dust, camera shake), settled monument tint | W21-20, W21-21, W21-22 |
| Analytics: `silo_built`, `launch_gate_blocked`, `rocket_launched`, `colony_settled`, `account_claimed` | W21-23 |
| Dev console: `setLiving <pct>`, `settle <colony>`, `launch` | W21-24 |
| Touch: launch confirm + overlay in landscape | W21-25 |
| Tests: AC-17 (gate + inert settled) | W21-26 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W21-01 | Contracts & data: building `rocketSilo` T2 row, command `launchRocket`, events `rocketReady/rocketLaunched/colonySettled`, colony state `settled`, reject `launch_gate`, flag `W21` | contract | M |  | W17-01 | Run `npm test -w @terra/contracts` → the new kinds parse strictly, and `compileData()` with `TA_WAVES=..20` has no silo row | SIM §7.7, econ §3.6 | TA-06.10, TA-06.13 |
| W21-02 | Sim: Rocket Silo T2 construction (Hub T2 + T2 worker), shed group 1, `rocketReady` on completion | sim | S |  | W21-01 | Build silo with a Multitask T2 → on completion `rocketReady` emitted | econ §3.6 | TA-06.10 |
| W21-03 | Sim: silo cost exceeds storage cap → `waiting(storage)` with Depot hint | sim | S |  | W21-02, W02-14 | Queue silo with 1 500 cap → entry shows `waiting: storage (build Supply Depot)` | `UO-Q-05` | TA-14.2 |
| W21-04 | Sim: launch gate — count owned tiles excluding walls / deep water / footprints; reject `launch_gate` | sim | M |  | W21-01, W05-10 | `launchRocket` at 96 % Living → `cmd.rejected launch_gate`; at 100 % → accepted | `UO-R-01`, AC-17 | TA-06.13 |
| W21-05 | Sim: launch-gate view — `view()` exposes `launchGate {living, total, missing[]}` for the colony, registered as a synced field (no hand-written delta, D-31) | sim | S |  | W21-04 | Open the state inspector on colony A → `launchGate: {living: 312, total: 325, missing: [13 tiles]}` | `UO-R-01`, D-31 | TA-06.13 |
| W21-06 | Client: Rocket panel chip `Living n / m` + pulsing outline on the missing tiles, drawn on top of W05-22's Living overlay in 3D and as a global-map layer (W04-15 registry) | client | S |  | W21-05, W05-22, W04-15 | Open the Rocket panel → chip "Living 312 / 325" and 13 tiles pulse orange in the 3D view | `UO-R-01` | TA-14.8 |
| W21-07 | Client: launch confirmation as an in-app modal (no native dialog, `CL-12`); only the Confirm button sends `launchRocket` (the AI/away rejection is W09-10's `AW-12` rule) | client | S |  | W21-04 | Click Launch → the confirm modal opens; Confirm → `launchRocket` is acked | `AW-12`, `CL-12` | TA-08.6 |
| W21-08 | Sim: 30 s countdown, cancel during countdown, `rocketLaunched {carry}` | sim | S |  | W21-04 | Send `launchRocket` → countdown 30 s; cancel at 10 s → silo back to ready | SIM §7.7 | TA-06.10 |
| W21-09 | Sim: Settled state — stop all systems for the colony, mark entities invulnerable and untargetable, keep anchors (no grace revert) | sim | M |  | W21-08 | After launch, dev-spawned enemy units ignore the colony; tiles stay owned after 10 min | `UO-R-02`, SIM §7.7 | TA-06.13 |
| W21-10 | Sim: settled side effects — end truces (W18 on), close trade orders (W13 on), keep seat/occupancy, zero tick cost | sim | S |  | W21-09, W18-13, W13-15 | Settle with an active truce → `truceEnded`; open market orders → cancelled with refund | `UO-R-04` | TA-06.13 |
| W21-12 | Server: transfer — on `rocketLaunched` the lobby enqueues a `TRANSFER` ticket (priority 10) with `carryOver` for that player; W11-12 places it and the spawn saga passes `carryOver` to `game.spawnColony` | server | M |  | W21-08, W11-10, W11-12, W11-13 | Launch → the picker shows "Choose your next planet" with the carry summary, and the open ticket has mode `TRANSFER` | SIM §7.7, `MM-35`, `MM-47` | TA-06.10, TA-08.5 |
| W21-13 | Sim: Founder Pod arrival — starting stock × 1.25, `unlockStage` from the account (W08-07); the client plays the existing orbit deploy + drop-pod descent (`frontend/render/orbit/deploy/`, `frontend/game/descent/`) | sim | S |  | W21-12, W08-07 | Join the new planet → pod stock 750/437/250/250 and the stage track shows the inherited unlocks | `UO-LC-06`, econ §3.6 | TA-06.10 |
| W21-14 | Server: on `colonySettled` set the lobby colony row to `SETTLED` (W11-04's sweeper then ends an all-settled planet) and notify the planet's players | server | S |  | W21-09, W11-04 | Settle all 3 colonies (dev) → planet state `ENDED` within one sweeper pass | `MM-07` | TA-05.4 |
| W21-15 | Server: account claim on mock `IdentityPort.claimAccount` (add player key, drop game key) behind W06-17's `POST /v1/near/claim` stub | server | M |  | W06-01, W06-05 | `POST /v1/near/claim` → a `mock:` receipt and the account shows `claimed: true` | D-18, NEAR §2 | TA-10.7 |
| W21-16 | Client: enable W06-17's "Take custody" button and add a Claim panel to the `/me` Pilot section (explains self-custody, W20-22 mock wallet modal) | client | S |  | W21-15, W12-13, W20-22 | Click Claim on `/me` → the mock flow completes and the Pilot card shows "Self-custody" | D-18 | TA-10.7 |
| W21-17 | Sim: Prepare Rocket goal body for W08-20's stub (Terraform Zone over all land, silo, stockpile; done when gate met) + rule-engine `rocket` need (never launches) | sim | M |  | W21-04, W08-16, W08-20 | Accept Prepare Rocket → terraform orders cover the missing tiles; when the gate is met → goal done and no auto-launch | §4.6, `UO-LC-07` | TA-14.6 |
| W21-18 | Progression event `settler` +1 on `colonySettled` (W12-06 grants the +500 milestone XP) | sim | S |  | W21-09, W12-01 | Settle → the progression bus receives `{family:'settler', delta:1}` | player spec §2–3 | — |
| W21-19 | Server: map `rocketReady` to the `rocket_ready` kind that W09-21 already routes | server | S |  | W21-02, W09-21 | Silo completes while away → the mock notifier holds one `rocket_ready` row | D-17, `CT-36` | TA-08.7 |
| W21-20 | Visual: bind the existing `building.rocket` archetype (rocket on gantry, 3×3) as the Rocket Silo view, centred on the 4×4 footprint by the renderer (no model edit, so no new validator run) | visual | S |  | W21-01 | Build a silo in `?scenario=w21` → the rocket-on-gantry model stands centred on the 4×4 site with `minY 0.000` | Pillar 1 | TA-14.9 |
| W21-21 | VFX: launch — reuse the descent's `frontend/game/descent/fx/Flames.ts` (HDR plume, bloom) and `GroundFX.ts` (dust column) and `CameraRig` shake, plus a scripted rocket ascent | visual | S |  | W21-20 | Launch → the plume blooms and the rocket leaves the view in about 8 s | Pillar 4 | — |
| W21-22 | Visual: settled monument tint as a mode of `frontend/render/visuals/UnifiedColonyMaterial.ts` (desaturate + gold rim), animations stopped | visual | S |  | W21-09 | Settle → the colony renders with a gold rim and no animations | Pillar 3 | — |
| W21-23 | Analytics `silo_built`, `launch_gate_blocked`, `rocket_launched`, `colony_settled`, `account_claimed` | client | S |  | W00-44 | Run the demo → 5 events recorded | CLIENT §10 | — |
| W21-24 | Dev console `setLiving <pct>`, `settle <colony>`, `launch` | client | S |  | W00-40 | `setLiving 100` → gate chip shows full and Launch enabled | PRODUCT_WAVES §3 | — |
| W21-25 | Touch: launch confirm and overlay in landscape | client | S |  | W24-11 | On 844×390, tap Launch → confirm → countdown works | D-22 | — |
| W21-26 | Test: AC-17 — launch rejected below 100 %, settled colony takes no damage and runs no systems | test | M |  | W21-04, W21-09 | `npm run test -w @terra/sim -- settlement` passes | AC-17 | TA-14.7 |
| W21-27 | Wave e2e `e2e/w21.spec.ts` + scenario `w21-rocket-settlement` + tag `wave-21` | test | M |  | all W21 | `npm run e2e -- --waves ..21` → the demo story passes (incl. the Settled Deed of W20-15), and every earlier suite passes | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w21.spec.ts` and all earlier suites pass.
- The scenario loads.
- With the flag off: no silo, no launch, no settled state.
- AC-17 passes.
- The transfer saga works with mock ports.
- Tag `wave-21` is created.
