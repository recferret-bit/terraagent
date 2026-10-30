# W21 — Rocket & Settlement

**Goal.** The colony's endgame works end to end. The player terraforms all owned land to Living, builds a Rocket Silo, confirms launch, and leaves a **Settled** colony behind. The rocket carries a Founder Pod (+25 % stock) to a new planet, and the account can be claimed. A planet where every colony has settled ends early.

**Demo story.**
1. Load the near-complete colony: Hub T2, 96 % Living, stock for the silo. Build the Rocket Silo T2. → "Prepare Rocket" goal card shows `Living 312 / 325`, with an overlay highlighting the 13 missing tiles.
2. Click Launch. → Rejected `launch_gate`, and the overlay pulses.
3. Let terraformers finish (warp). → Launch enabled. Click Launch, then confirm (`AW-12`). → 30 s countdown with VFX; the rocket lifts off.
4. The colony turns **Settled**: buildings freeze with a monument tint, and enemy units cannot target them (dev spawn).
5. The lobby offers a new planet; join it. → A Founder Pod lands with 125 % starting stock.
6. On the old planet, the other two colonies also settle (dev). → The planet ends early (`MM-07`).
7. On `/me`, "Claim account" runs the mock claim flow. → The account shows "claimed".

**Depends on:**
- W17: Hub T2, so the Silo T2 can be built.
- W20: Deed; settled-colony staking hook.
- W11: lobby re-placement, planet end.
- W05: Living tiles and the Terraform %.

Optional: W08 (Prepare Rocket goal card), W09 (`rocketReady` notification), W12 (Star Settler achievement, profile planets list).
**Track:** Gameplay (G), with lobby hooks on Meta. **Owned paths:**
- `shared/sim/src/systems/{rocket,settlement}/`
- `shared/sim/src/data/rocket.ts`
- `client/src/features/{rocket,settlement}/`
- `backend/app/src/lobby/transfer/`
- kitbash `.../buildings/rocket-silo.ts`

**Flag:** `W21` · **Scenario:** `scenarios/w21-rocket-settlement.ts` (planet with 3 colonies; colony A at Hub T2, 96 % Living, stock 6 000 each, Terraformer ×3, Processor T1) · **Tag:** `wave-21`

## Features covered

| Spec item | Issues |
|---|---|
| Rocket Silo T2 Lander (4×4, 210 s, 1 800/1 600/1 400/700, −120 E/s, 4 800 HP), shed group 1; MVP silo tier only | W21-02 |
| Silo cost > storage cap → `waiting(storage)` hint (`UO-Q-05`) | W21-03 |
| Launch gate: 100 % Living, excluding walls, deep water and footprints (`UO-R-01`, SIM `launch_gate`) | W21-04 |
| HUD `Living n / m` + missing-tiles overlay | W21-05, W21-06 |
| Launch requires explicit player confirmation; never while away (`AW-12`) | W21-07 |
| Countdown 300 ticks (30 s), `rocketReady` / `rocketLaunched` events | W21-08 |
| Settled colony: inert, invulnerable, frozen border (no grace revert), no systems, counts for score and occupancy, seat kept, truces end, trades closed (`UO-R-02`, `UO-R-04`, SIM §7.7) | W21-09, W21-10 |
| `colonySettled {colonyId, terraformBp, ownedTiles}` → Deed becomes Settled Deed, staking available (W20) | W21-11 |
| Carry-over: `carry.stockMultiplierBp = 12 500`, Founder Pod on a new planet via lobby re-placement | W21-12, W21-13 |
| `unlockStage` inherited on the new planet (`UO-LC-06`) | W21-13 |
| All-settled planet ends early (`MM-07`) | W21-14 |
| Account claim flow, mock `IdentityPort.claimAccount` (D-18) | W21-15, W21-16 |
| Prepare Rocket goal: Terraform Zone over all land + silo + stockpile; done when gate met (§4.6) | W21-17 |
| Rule engine `rocket` need; autopilot never launches (`AW-12`, `UO-LC-07`) | W21-17 |
| Achievement event: Star Settler; XP "Colony Settled" +500 | W21-18 |
| Notifications: `rocketReady` (consumed by W09) | W21-19 |
| Visuals: silo kitbash, launch VFX (smoke column, plume, camera shake), settled monument tint | W21-20, W21-21, W21-22 |
| Analytics: `silo_built`, `launch_gate_blocked`, `rocket_launched`, `colony_settled`, `account_claimed` | W21-23 |
| Dev console: `setLiving <pct>`, `settle <colony>`, `launch` | W21-24 |
| Touch: launch confirm + overlay in landscape | W21-25 |
| Tests: AC-17 (gate + inert settled) | W21-26 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W21-01 | Contracts & data: building `rocketSilo` T2 row, command `launchRocket`, events `rocketReady/rocketLaunched/colonySettled`, colony state `settled`, reject `launch_gate`, flag `W21` | contract | M |  | W17-01 | `npm run contracts:check` passes; `TA_WAVES=..20` hides the silo row | SIM §7.7, econ §3.6 | TA-06.10, TA-06.13 |
| W21-02 | Sim: Rocket Silo T2 construction (Hub T2 + T2 worker), shed group 1, `rocketReady` on completion | sim | S |  | W21-01 | Build silo with a Multitask T2 → on completion `rocketReady` emitted | econ §3.6 | TA-06.10 |
| W21-03 | Sim: silo cost exceeds storage cap → `waiting(storage)` with Depot hint | sim | S |  | W21-02, W02-14 | Queue silo with 1 500 cap → entry shows `waiting: storage (build Supply Depot)` | `UO-Q-05` | TA-14.2 |
| W21-04 | Sim: launch gate — count owned tiles excluding walls / deep water / footprints; reject `launch_gate` | sim | M |  | W21-01, W05-19 | `launchRocket` at 96 % Living → `cmd.rejected launch_gate`; at 100 % → accepted | `UO-R-01`, AC-17 | TA-06.13 |
| W21-05 | Server/view: expose `livingTiles / gateTiles` and missing tile list in colony state delta | server | S |  | W21-04 | Inspector shows `gate: {living: 312, total: 325, missing: [13 tiles]}` | `UO-R-01` | TA-06.13 |
| W21-06 | Client: HUD `Living n / m` chip + missing-tiles overlay (pulsing outline) on map and in 3D | client | M |  | W21-05, W04-13 | Open the Rocket panel → chip "Living 312 / 325" and 13 tiles pulse orange on the map | `UO-R-01` | TA-14.8 |
| W21-07 | Client + sim: launch confirmation dialog; launch only via player command (`AW-12`, away policy) | client | S |  | W21-04 | Click Launch → confirm dialog; directive `launchRocket` from AI → rejected `away_policy` | `AW-12` | TA-08.6 |
| W21-08 | Sim: 30 s countdown, cancel during countdown, `rocketLaunched {carry}` | sim | S |  | W21-07 | Confirm launch → countdown 30 s; cancel at 10 s → silo back to ready | SIM §7.7 | TA-06.10 |
| W21-09 | Sim: Settled state — stop all systems for the colony, mark entities invulnerable and untargetable, keep anchors (no grace revert) | sim | M |  | W21-08 | After launch, dev-spawned enemy units ignore the colony; tiles stay owned after 10 min | `UO-R-02`, SIM §7.7 | TA-06.13 |
| W21-10 | Sim: settled side effects — end truces, close trade orders, keep seat/occupancy, zero tick cost | sim | S |  | W21-09, W18-13, W13-15 | Settle with an active truce → `truceEnded`; open market orders → cancelled with refund | `UO-R-04` | TA-06.13 |
| W21-11 | Server: `colonySettled` → Deed becomes Settled Deed, enables staking panel (via W20 ports) | server | S |  | W21-09, W20-15 | Settle → mock DeedNftPort metadata shows `settled: true`, staking button appears on `/me` | D-18, NEAR §9 | TA-10.12 |
| W21-12 | Server: transfer saga — lobby receives `rocketLaunched`, re-places the player (same type or picker), creates Founder Pod spawn with `carry` | server | M |  | W21-08, W11-03 | Launch → lobby shows "Choose your next planet" with the carry summary | SIM §7.7, MATCHMAKING | TA-06.10, TA-08.5 |
| W21-13 | Sim: Founder Pod arrival — starting stock × 1.25, inherited `unlockStage` | sim | S |  | W21-12 | Join new planet → pod stock 750/437/250/250 and the stage track shows the inherited unlocks | `UO-LC-06`, econ §3.6 | TA-06.10 |
| W21-14 | Server: all-settled planet ends early (MM-07), planet `ENDED`, players notified | server | S |  | W21-09, W11-03 | Settle all 3 colonies (dev) → planet state `ENDED` within one sweeper pass | MM-07 | TA-05.4 |
| W21-15 | Server: account claim flow on mock `IdentityPort.claimAccount` (add player key, drop game key) | server | M |  | W06-05 | `POST /me/claim` → mock receipt `mock:…`, account `claimed: true` | D-18, NEAR §2 | TA-10.7 |
| W21-16 | Client: "Claim account" panel on `/me` (explains self-custody, mock wallet connect) | client | S |  | W21-15, W12-13 | Click Claim → mock flow completes and the Pilot card shows "Self-custody" | D-18 | TA-10.7 |
| W21-17 | Sim: Prepare Rocket goal (Terraform Zone over all land, silo, stockpile; done when gate met) + rule-engine `rocket` need (never launches) | sim | M |  | W21-04, W08-16 | Accept Prepare Rocket → terraform orders cover missing tiles; when gate met → goal done, no auto-launch | §4.6, `UO-LC-07` | TA-14.6 |
| W21-18 | Achievement + XP events: `settler` +1 and XP +500 on `colonySettled` | sim | S |  | W21-09 | Settle → progression receives `settler` and an XpLedger row `colony-settled:{colonyId}` | player spec §2–3 | — |
| W21-19 | Notification mapping: `rocketReady`, `colonySettled` | server | S |  | W21-02, W09-21 | Silo completes while away → mock notifier gets "Rocket ready" | D-17 | TA-08.7 |
| W21-20 | Kitbash `building.rocketSilo` (4×4, gantry silhouette breaker, rocket inside) + audit | visual | M |  | — | Playground inspect passes 4-view audit, < 3.5k tris | Pillar 1 | TA-14.9 |
| W21-21 | VFX: launch — smoke column, engine plume (HDR emissive ≥ 3.0, bloom), camera shake, rocket ascent | visual | M |  | W21-20 | Launch → plume blooms, rocket leaves view in ~8 s | Pillar 4 | — |
| W21-22 | Visual: settled monument tint (desaturate + gold rim via Unifier Shader) | visual | S |  | W21-09 | Settled colony renders with gold rim and no animations | Pillar 3 | — |
| W21-23 | Analytics `silo_built`, `launch_gate_blocked`, `rocket_launched`, `colony_settled`, `account_claimed` | client | S |  | W00-44 | Run the demo → 5 events recorded | CLIENT §10 | — |
| W21-24 | Dev console `setLiving <pct>`, `settle <colony>`, `launch` | client | S |  | W00-40 | `setLiving 100` → gate chip shows full and Launch enabled | PRODUCT_WAVES §3 | — |
| W21-25 | Touch: launch confirm and overlay in landscape | client | S |  | W24-11 | On 844×390, tap Launch → confirm → countdown works | D-22 | — |
| W21-26 | Test: AC-17 — launch rejected below 100 %, settled colony takes no damage and runs no systems | test | M |  | W21-04, W21-09 | `npm run test -w @terra/sim -- settlement` passes | AC-17 | TA-14.7 |
| W21-27 | Wave e2e `e2e/w21.spec.ts` + scenario `w21-rocket-settlement` + tag `wave-21` | test | M |  | all W21 | `npm run e2e -- --waves ..21` passes the demo; `TA_WAVES=..20` hides the silo and Rocket panel | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w21.spec.ts` and all earlier suites pass.
- The scenario loads.
- With the flag off: no silo, no launch, no settled state.
- AC-17 passes.
- The transfer saga works with mock ports.
- Tag `wave-21` is created.
