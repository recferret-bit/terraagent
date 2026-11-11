# Hackathon Cut — NEAR Hackathon Vertical Slice (2026-11-01 → 11-14)

> **NEAR Hackathon Vertical Slice Revision (2026-11-09):**
> - **Postponed Waves (`POSTPONED`, 0 `H` issues):** `W14` (Fortify), `W17` (Second Tier S5–S7), `W19` (Air & Endgame S8–S10), `W21` (Rocket & Settlement), `W24` (Mobile, PWA & Landing), and `W27` (450-Sector Streaming).
> - **Skip All Tier 2/3:** All Tier 2/3 buildings, resources (`metals.t2/t3`, `minerals.t2/t3`, `bio.t2/t3`), units (`tank`, `artillery`, `radar`, `multitask`, `brute`, aircraft), and stages (`S5–S10`) are deferred to post-hackathon.
> - **Ready to Land Now (3 Open Waves):** `W11` (Planet Foundations, `28/28`), `W13` (Markets & Trading Bot API, `63/63`), `W16` (AI Director, `49/49`).
> - **Remaining Active Vertical Slice Build Queue (7 Waves):** `W09` (Offline & Notifications, `25 H`) → `W15` (Guild & Agent Wallets, `33 H`) → `W18` (PvP & Diplomacy, `28 H`) → `W20` (Colony Deed & Staking settled at Stage 4 / 100% Living Planet, `27 H`) → `W22` (Treasury DAO & Bounties with Tier-1 `robot.recon` mercenaries, `37 H`) → `W23` (`NEAR_MODE=mock|testnet|devnet` Switch & Real Testnet/Devnet Adapters, `45 H`) → `W25` (Launch Ops & Submission, `16 H`).
> - **100% Working Mocked + Feature Flag / Switch to Real NEAR Testnet/Devnet:** Every game economy, AI Director (`AI_PROVIDER=mock|zai` with `AI_LIVE=1`), offline play (`NOTIFY_ADAPTER=mock|live|webpush|telegram`), and all 11 Web3 ports work 100% end-to-end under `NEAR_MODE=mock` and switch cleanly to real NEAR testnet/devnet via `NEAR_MODE=testnet|devnet` (or per-port `NEAR_ADAPTER_<PORT>=mock|testnet|devnet|mainnet`).
>
> | Set | Issues | Effort (units) | Critical path (units) |
> |---|---|---|---|
> | **H** Vertical Slice | 623 | ≈ 477.0 | 23.0 |
> | H+ stretch | 52 more | ≈ 35.5 more | — |
> | H2 public mainnet cash pilot | 3 | ≈ 3.0 | — |
> | Postponed (`W14, W17, W19, W21, W24, W27`) | 0 `H` (230 `-`) | — | — |
>
> Generated numbers and start order: [`HACKATHON_SCHEDULE.md`](./HACKATHON_SCHEDULE.md) (`python3 scripts/plan/index_waves.py --write`).
>
> **Decisions:**
> - [`D-24`](../spec/DECISIONS.md): one app + simplified server sim
> - `D-25`: no anti-cheat, no anti-bot
> - `D-26`: NEAR features F1–F8, cargo open in beta
> - `D-27`: this plan
> - `D-28`: battle v1
> - `D-29`: player page, achievements, XP, minimap + global map
> - `D-30`: ports & adapters; **all NEAR features mocked in phase 1**
>
> **Specs:**
> - [`../game/units-orders-and-progression-spec.md`](../game/units-orders-and-progression-spec.md): units, ground prep, walls, stages, battle v1 (§5.2–5.5)
> - [`../game/near-economy-features-spec.md`](../game/near-economy-features-spec.md): F1–F8
> - [`../spec/NEAR.md`](../spec/NEAR.md) §1a: ports, mocks, contract suites
> - [`../game/player-profile-and-achievements-spec.md`](../game/player-profile-and-achievements-spec.md): `/me`, 20 × 3 achievements, XP
> - [`../spec/CLIENT.md`](../spec/CLIENT.md) §8b: minimap, global map, range rings, projectiles
> - [`../game/colony-economy-and-buildings-spec.md`](../game/colony-economy-and-buildings-spec.md): building numbers
>
> **Team:** solo developer + AI agents. **Track:** 09 Games With Real Economies (+ 07 Agent Economy, 05 AI Swarms; + 10 / 12 if F6 / F7 ship with a real adapter or a convincing mock demo).
> **Rule of the cut:** the economy is the gameplay. Every wave that lands is a working, tested app you can click. Everything not tagged `H`/`H2` in [`waves/`](./waves/) is the post-hackathon plan.

## 1. Two modes: 100% Mocked + `NEAR_MODE=mock|testnet|devnet` Switch

| Mode | Flag / Env | What | Why |
|---|---|---|---|
| **Mode 1: 100% Working Mocked (Default)** | `NEAR_MODE=mock`, `AI_PROVIDER=mock`, `NOTIFY_ADAPTER=mock` | Complete Tier-1 (`S0–S4`) colony gameplay, battle v1 (`W07`), persistent sector multiplayer (`W11`), `/me` achievements (`W12`), AI Director (`W16`), offline play (`W09`), diplomacy & PvP (`W18`), and **all of F1–F8 (`W06, W10, W12, W13, W15, W20, W22`) behind real ports with Postgres mock adapters** (D-30) | Works 100% deterministically in CI, local dev, and hosted demo without external RPC keys. Mocks produce real-shaped receipts, errors, latency and fault-injection states |
| **Mode 2: Switch to Real NEAR Testnet / Devnet (`W23`)** | `NEAR_MODE=testnet\|devnet` (plus per-port `NEAR_ADAPTER_<PORT>=mock\|testnet\|devnet\|mainnet`) | Single feature flag / switch (`W23`) swaps all 11 NEAR ports (`IdentityPort`, `RelayerPort`, `CargoTokenPort`, `IntentsPort`, `AgentWalletPort`, `DeedNftPort`, `BadgeNftPort`, `StakingPort`, `TreasuryDaoPort`, `EscrowPort`, `ChainReadPort`) to real NEAR testnet/devnet RPC & contracts, verified by the shared port contract suites | Judges and players can toggle between 100% mocked mode and live NEAR testnet/devnet execution via env (`NEAR_MODE=testnet`), runtime config, or dev console (`near.switch all testnet`) without changing any game or UI code |

The demo can run on mocks in production (`NEAR_ALLOW_MOCK_IN_PROD=true`) or on `NEAR_MODE=testnet` (`W23`).

## 2. What ships in the Vertical Slice (22 Active Waves, 6 Postponed)

| Wave | `H` issues · units | Status | Ships in the Vertical Slice | Postponed / Deferred |
|---|---|---|---|---|
| W00 Platform | 51 · 41.0 | Landed | Workspaces, NestJS + sim threads, shared engine (`?host=local` + parity), WS snapshot + diffs, flags, scenarios, dev console, outbox, contract harness, e2e harness | Fault quarantine, i18n, snapshot migrations |
| W26 Sites | 10 · 9.0 | Landed | nginx + four compose files, eight `terraagent.fun` hosts, `stack:local`, `deploy` over SSH | TLS, Cloudflare |
| W01 Landfall | 31 · 23.0 | Landed | Guest auth, `temperate` generator, HQ + power cell, Grade/Clear/Break, Command Hub, territory, HUD | Descent sync stretch |
| W02 First Light | 25 · 18.5 | Landed | Tier-1 resources (`metals, minerals, oil, bio`), Solar, Extractor, Worker Drone, queue v1, Command Dock | — |
| W06 Invisible Chain (F5) | 20 · 12.5 | Landed | Social login, named + colony accounts, key store, gasless relayer, pending/retry UX, contract suites | — |
| W10 Cargo (F1) | 21 · 14.0 | Landed | Trade Hub (`building.tradePad`), export/import with mint caps and refunds, NEP-245 cargo tokens, contract suite | — |
| W03 The Grid | 15 · 12.0 | Landed | Repair, pylon graph with load, shedding groups, Thermal, Depot / Quarry / Water Extractor, four lanes, power-line tool | — |
| W07 First Contact | 31 · 22.5 | Landed | Three insect species & hives, battle v1, Factory, Recon, Turret, supply, flow-field march, `F6` Combat Lab | — |
| W05 Shape the Land | 16 · 11.0 | Landed | Auto per-hex Terraform / Repair / Dismantle tool, Level/Fill/Reclaim/Irrigate/Seed → Living, Terraform %, `desert` & `ocean` planets, weather/storms/water reflections | Tier 2/3 resources skipped |
| W04 Maps | 14 · 8.5 | Landed | Minimap, global planet map (`M`) with layers, camera polish | — |
| W08 Stages & Goals | 20 · 15.5 | Landed | Stage engine `S0–S4`, dwell, unlock gating, stage HUD, HQ goals, rule-engine autopilot + priority sliders | Stages `S5–S10` skipped |
| W12 Player Page | 18 · 14.5 | Landed | `/me` with Pilot, Progress, stats, 20 × 3 achievement flip cards, XP and levels, badge outbox | — |
| W11 Planet Foundations | 28 · 24.5 | **Ready to Land** | Three persistent small sector worlds, atomic admission, parties/resume, pinned saves, border-crossing play | W27 450-sector streaming postponed |
| W13 Markets & Bot API (F2) | 63 · 53.0 | **Ready to Land** | USDC and barter orderbooks, fees, Intents settlement, regional profiles, recurring consumption, AI experiments, external trading bot API (`/v1/trade/*`, D-45) | — |
| W16 AI Director | 49 · 40.0 | **Ready to Land** | Director worker (`AI_PROVIDER=mock\|zai`), private MCP, durable queue, W08 goals, Conservative/Risky skills, security, W11 context, HUD rationale & away story | — |
| W09 Offline | 25 · 19.5 | **Active Queue** | Presence, coarse stepping, restart fast-run, away policy & budget, digest + "While you were away", `NOTIFY_ADAPTER=mock\|live\|webpush\|telegram` (Web Push + Telegram) | — |
| W15 Guild & Agents (F3, F4) | 33 · 27.5 | **Active Queue** | Orbital Guild NPC traders with wallets, quotes & trade, colony director function-call key with allowance, `autoTrade`, risk/requote guards | — |
| W18 PvP & Diplomacy | 28 · 21.5 | **Active Queue** | Colony raids, newcomer shield, colony critical/elimination, HQ reprint, truces, Oathbreaker mark, AI raid opt-in | — |
| W20 Deed & Staking (F6) | 27 · 19.5 | **Active Queue** | Dynamic Colony Deed NFT (NEP-171) minted on founding, milestone updates, settled at Stage 4 (`100% Living Planet`), share page, own-NEAR staking + NEP-413 claim | No W21 Rocket dependency |
| W22 Treasury & Bounties (F7, F8) | 37 · 27.5 | **Active Queue** | Planet treasury DAO, fee share, proposals + votes + projects (Terraform boost, Meteor shield), bounty escrow, Tier-1 `robot.recon` mercenary squads | — |
| W23 Real NEAR Switch (`NEAR_MODE`) | 45 · 34.0 | **Active Queue** | Unified `NEAR_MODE=mock\|testnet\|devnet\|mainnet` feature flag + per-port `NEAR_ADAPTER_<PORT>` override; real NEAR testnet/devnet contracts & adapters across all 11 NEAR ports | 3 `H2` issues for public mainnet cash pilot |
| W25 Launch | 16 · 10.5 | **Active Queue** | Env & CSP guards, backups, restart smoke, `/v1/metrics` coverage, README + `npm run ports:table` + `e2e:readme`, hosted demo, video, X post, submission | Load/soak, rollback pipeline |
| **W14 Fortify** | 0 `H` | **POSTPONED** | — | Postponed out of Vertical Slice |
| **W17 Second Tier (S5–S7)** | 0 `H` | **POSTPONED** | — | Postponed out of Vertical Slice (Tier 2 skipped) |
| **W19 Air & Endgame (S8–S10)** | 0 `H` | **POSTPONED** | — | Postponed out of Vertical Slice (Tier 3 / Air skipped) |
| **W21 Rocket & Settlement** | 0 `H` | **POSTPONED** | — | Postponed out of Vertical Slice |
| **W24 Mobile, PWA & Landing** | 0 `H` | **POSTPONED** | — | Postponed out of Vertical Slice |
| **W27 Planet Scale & Streaming** | 0 `H` | **POSTPONED** | — | Postponed out of Vertical Slice |

**Reuse, don't rebuild** (inventory of 2026-10-30; layout per D-32).
- **Game prototype (`frontend/game/`, client-only, no sim):** orbital world picker, drop-pod descent cinematic, colony diorama with RTS camera, hero click-to-move, a decorative starter colony, a static resource bar (energy/metal/water/biomass; becomes the D-34 family bar in W02-26, vanilla DOM per D-36), pause menu. The *visuals* are reused as they are; the *rules* (movement, colony, resources) move into `@terra/sim` (D-31) and drive these views.
- **Render engine (`frontend/render/`):** kitbash archetypes `building.{commandHub, solar, wind, capacitor, coalGen, pylon, mine, waterPump, supplyDepot, turret, roboticsFactory, droneArray, claimBeacon, rocket}`, `robot.{hero, miner, builder, combat}`, `fauna.{skitter, drifter}`, `resource.{metal, crystal, oil}Deposit`, `ship.{carrier, dropPod}`; terrain/water, unified material, planet globe with terraform stages, orbit stage + deploy, `PlanetaryLightingSystem` (day/night) and `LightningStrikeSystem` (both not yet wired), CRT overlay.
- **Landing (`frontend/landing/`):** orbit-stage hero, hex colony canvas, planet cards (the three D-33 worlds: Kharon Dunes `desert`, Thalassa Verde `ocean`, Granite Hollow `temperate`), resource viewer (its five tabs become Metals / Minerals / Bio / Energy in W24-36, H+), roadmap, road-to-market board.
- **Design system (`frontend/design/`):** Faction Plate tokens and components for `/me` and every HUD.

The prototype predates the window, so the README must disclose it as **pre-window baseline** (hackathon rule Q-002).

## 3. Execution Order, Checkpoints and the Drop Order

**Default setup:** 12 parallel agents. The schedule's start order (HACKATHON_SCHEDULE §3) is the queue: an idle agent takes the first ready `H` issue; when its wave has no ready `H` issue, it takes an `H+` issue of the same wave.

**Critical path (HACKATHON_SCHEDULE §2):** runs through the active Tier-1 Vertical Slice (`W00 → W01 → W06 → W10 → W13 → W15 → W22 → W25`, plus `W09 → W18 → W25` and `W20 → W23 → W25`; `W14, W17, W19, W21, W24, W27` are postponed).

**Vertical Slice Wave Execution Order:**

| Phase | Waves |
|---|---|
| **Landed Spine & Core (12 waves)** | `W00, W26, W01, W02, W06, W10, W03, W07, W05, W04, W08, W12` |
| **Ready to Land Next (3 open waves)** | `W11` (Planet Foundations, `28/28`) → `W13` (Markets & Trading Bot API, `63/63`) → `W16` (AI Director, `49/49`) |
| **Remaining Active Vertical Slice Queue (7 waves)** | `W09` (Offline & Notifications) → `W15` (Guild & Agent Wallets) → `W18` (PvP & Diplomacy) → `W20` (Colony Deed & Staking) → `W22` (Treasury DAO & Bounties) → `W23` (`NEAR_MODE` Switch & Real Testnet/Devnet Adapters) → `W25` (Launch Ops & Submission) |
| **Postponed Waves (6 waves, `0 H`)** | `W14` (Fortify), `W17` (Second Tier S5–S7), `W19` (Air & Endgame S8–S10), `W21` (Rocket & Settlement), `W24` (Mobile, PWA & Landing), `W27` (450-Sector Streaming) |

**Drop order if time-constrained** (move a wave's `H` rows to `H+`, rerun `python3 scripts/plan/index_waves.py --write`):
1. All `H+` and `H2` work stops (agents stay on `H`).
2. `W23` real testnet adapters for late ports (`TreasuryDaoPort`, `EscrowPort`, `StakingPort`) while keeping `NEAR_MODE` switch + F5/F1/F2/F3/F4/F6.
3. `W22` Mercenary NPC auto-hire edge cases.
4. `W18` Diplomacy notice/Oathbreaker polish.

Never dropped: `W00–W13`, `W15`, `W16`, `W20`, `W22` core DAO/bounties, `W23` `NEAR_MODE=mock|testnet|devnet` switch, `W26` hosting, `W25` submission, the contract suites, full-game server E2E suites, and the README run.

**Review and merge: the wave development pipeline** ([`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md) §7). Each wave lives in its own branch and worktree. Issues merge into their wave branch automatically when the gates are green (typecheck, unit, integration, contract suites, the wave's `@hack` e2e), so there is no per-issue human review. The owner does **one manual check per wave** — 22 active vertical slice waves — and only then does the wave merge into `main`, get tagged, lose its worktree and branch, and `main` gets pushed. A wave opens only after every wave it depends on has landed in `main` (no stacking on unchecked waves).

### Submission form checklist (D14)

- [ ] Project name: **TerraAgent**
- [ ] Team lead, email, team size: **solo**
- [ ] Tracks: `["games", "agents", "swarms"]` (**09** Games With Real Economies, **07** Agent Economy, **05** AI Swarms — omit `social` `12` and `nfts` `10` per track brief rules)
- [ ] Prize payout: a **mainnet** NEAR wallet (the team's own)
- [ ] Repository link (public) and demo post link (X, with attached video tagging `@NEARProtocol` + `#NEARHackathon`)
- [ ] Description (`idea`, 20–2 000 characters): "autonomous colony builder where the economy is the gameplay", including hosted demo URL `https://play.terraagent.fun`, NPC traders & Rival AI colonies with wallets, NEAR Intents quotes, NEP-245 cargo, NEP-171 Colony Deed, Bounty Escrow, NEAR AI Cloud Director, and `NEAR_MODE=mock|testnet`
- [ ] **LEAVE `website` OMITTED / EMPTY (`""`)**: in `POST /api/applications`, `website` is a **spam-trap honeypot** — any non-empty value auto-rejects the submission!

## 4. Postponed to Post-Hackathon (`W14, W17, W19, W21, W24, W27` & All Tier 2/3)

Every issue in the 6 postponed waves (`W14`, `W17`, `W19`, `W21`, `W24`, `W27`), plus any `H+` / `H2` / blank rows in active waves:

- **All Tier 2 / Tier 3 Content (`W17`, `W19`):** Stages `S5–S10`, Hub T2/T3, Multitask drones, T2/T3 buildings (`Refinery`, `Biolab`, `Fusion`, `Terraforming Processor`), T2/T3 resources (`metals.t2/t3`, `minerals.t2/t3`, `bio.t2/t3`), Tank, Artillery, Mobile Radar, Brute fauna, Aero Hangar, Anti-Air, Air Recon, Fighter, Gunship, Bomber, Drifter fauna.
- **Fortifications (`W14`):** Walls, gates, `openToPartners` gate traversal, shield domes, hazard shields, territory beacons.
- **Rocket & Settlement (`W21`):** Rocket Silo T2, 4-stage rocket assembly, launch cinematic (Colony Deeds in `W20` settle at Stage 4 / `100% Living Planet` instead).
- **Mobile, PWA & Landing (`W24`):** Phone landscape touch UI, PWA service worker, live landing-page 3D colony preview.
- **450-Sector Planet Streaming (`W27`):** 450-sector planet streaming and cross-worker ghost strips (`W11`'s 3 persistent sector worlds cover the hackathon vertical slice).
- **Public Mainnet Cash Pilot (`W23` `H2`):** `W23-24`, `W23-48`, `W23-49` (live mainnet USDC cash activation beyond technical smoke and testnet/devnet).
- **Future architecture (D-24):** separate services, NATS, multi-host workers with leases, deterministic replay / failover audits, anti-cheat.

## 5. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Scope:** the `H` set is ≈ 312 units against 13 build days | Waves late in the value order miss the window | Measured pace from D2 (§3), the drop order in §3, review only where it matters; every wave that lands is still a working app, and the D10 gate allows shipping on mocks |
| **Judges want real NEAR usage** | All-mock looks weaker for track 09 | Phase 2 swaps F5 → F1 → F2. The README and the description state the mock/real table honestly. The contract suites show the swap is real, not a stub |
| **NEAR Intents is mainnet-only** (no testnet) | Real funds while debugging | Mocks in phase 1. In phase 2: `dry: true` and `simulate_intents` first, then a single tiny trade between our own dev colonies |
| **Social-login provider** not chosen | Real F5 (after the D10 gate) stalls | The mock `IdentityPort` carries phase 1. The owner picks a provider before D10 (HOT is a listed partner). **Fallback:** server-created named sub-accounts with custodial keys |
| **Mock ≠ real behaviour** | Phase 2 swap breaks the game | One contract suite per port, run against both. The mock simulates latency, failures and stable error codes (NEAR.md §1a) |
| **Battle v1 projectile timing at 5 TPS** | Impact times quantised to 200 ms; hit checks feel off | Store `impactAt` in seconds and resolve in the first step past it. The client animates on wall time. The duel harness runs at the same tick rate |
| Mint authority + open cargo (D-26) with no anti-bot (D-25) | Farm bots extract value in beta | Mint caps as pacing; accepted for beta; said in the README |
| Coarse ticking for empty planets | Combat on unattended colonies is coarser | Accepted (D-24); raid results go into the away digest |
| The judges' AI screening runs the README | A README that doesn't match the build scores low | The D13 clean-clone README run is part of "done" |
