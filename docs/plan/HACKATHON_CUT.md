# Hackathon Cut — 14-day solo build (NEAR Hackathon, 2026-11-01 → 11-14)

> **2026-10-30: option B taken.** Every hackathon wave keeps its contracts, its core vertical slice and its e2e, tagged per issue in the `H` column of [`waves/`](./waves/). Each wave file has a **Hackathon slice** section: the demo steps its e2e tags `@hack`, and what is deferred. Generated numbers and start order: [`HACKATHON_SCHEDULE.md`](./HACKATHON_SCHEDULE.md) (`python3 scripts/plan/index_waves.py --write`).
>
> | Set | Issues | Effort (units) | Critical path (units) |
> |---|---|---|---|
> | **H** must | 384 | ≈ 294 | 21.5 |
> | H+ stretch | 61 more | ≈ 45 more | — |
> | H2 real NEAR (after the D10 gate) | 21 | ≈ 16 | — |
>
> One **unit** = one M issue (S = ½). The earlier "≈ 185 agent-days" for option B was a guess; tagging every issue gives **≈ 294**, because the issues are already fine-grained and most of each wave is its core. It fits **only if agents are fast**: with 12 parallel agents the `H` set takes 29 units of wall-clock, so each agent must close **≥ 2.2 units a day** (an M issue, reviewed and merged, in ≲ 3.5 h). At 1 unit/agent/day it does not fit at any agent count, because the critical path alone is 21.5 units. §3 has the pace check and the drop order.
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

## 1. Two phases

| Phase | Days | What | Why |
|---|---|---|---|
| **Phase 1: everything on mocks** | D1–D13 (the `H` set) | Game core, battle v1, player page and achievements, minimap and global map, and **all of F1–F8 behind the real ports with Postgres mock adapters** (D-30) | No chain work sits on the critical path. The economy features (F5, F1, F2, F3, F4) are playable by D10. The mocks have real-shaped receipts, errors, latency and failures, so the UI handles pending and failed states from day one |
| **Phase 2: swap to real adapters** | From D10, on extra agents, only if the D10 gate passes (the `H2` rows of W23) | `NEAR_ADAPTER_<PORT>` from `mock` to `testnet`/`mainnet`, one port at a time, in the order **F5 (`IdentityPort`, `RelayerPort`) → F1 (`CargoTokenPort`) → F2 (`IntentsPort`, mainnet, `dry: true` / `simulate_intents` first)**. A port goes real only when its **contract suite** passes against the real adapter | Shows real NEAR usage for judging without risking the game. Every other port (Agent wallet, Deed/Badge, Staking, Treasury, Escrow, Chain read) **stays mocked**. The README has a mock/real table |

The demo can run on mocks in production on purpose: `NEAR_ALLOW_MOCK_IN_PROD=true`, per NEAR.md §1a.

## 2. What ships (the `H` set)

| Wave | `H` issues · units | Ships in the hackathon | Deferred (H+ or later) |
|---|---|---|---|
| W00 Platform | 50 · 40.5 | Workspaces, NestJS + sim threads, shared engine in the browser (replica, client-side prediction, `?host=local` single-player testing, parity test), WS engine snapshot + diffs, flags, scenarios, dev console, time warp, wave pipeline scripts, snapshots, ports + mock base + outbox + contract harness, chain explorer, e2e harness, CI | State inspector, fault quarantine, i18n, snapshot migrations, bench |
| W01 Landfall | 30 · 21.5 | Guest auth, generator, HQ + power cell, Grade/Clear/Break, linked prep, Command Hub (new archetype), territory, menus, HUD | Drop-pod descent (stretch), Hub auto-placement, touch |
| W02 First Light | 25 · 18.5 | Resources and caps, power v0, brownout, Solar, Extractor, Harvester, queue v1, construction/units menus, resource bar | New archetypes (existing models stand in), day/night lighting |
| W03 The Grid | 14 · 12.5 | Builder, repair, pylon graph with per-pylon load, shedding groups, Thermal, Depot/Quarry/Water/Petroleum, four lanes, dispatch v2, power-line tool, overlay | Wind, Capacitor, demolish, power events |
| W04 Maps | 14 · 8.5 | Minimap (tiles, territory, dots, camera trapezoid, click/drag pan), global map with layer chips | Click-to-fly, selection core, control groups, fog, pings |
| W05 Shape the Land | 17 · 12.5 | Terraformer, Level/Fill/Reclaim, Irrigate/Seed → Living, Terraform %, full generator (Temperate + Desert), terraform menu, Living materials | Beacon, storms, meteors, Hydro, Deep Reclaim |
| W06 Invisible Chain (F5) | 20 · 12.5 | Mock social login, named + colony accounts, key store, mock relayer, first gasless action, pending/retry UX, contract suites | Account settings, second-device login, wallet link |
| W07 First Contact | 25 · 19.0 | Battle v1 (projectiles, lasers, AoE, evasive, layers, view), Factory, Recon, supply, turrets, fauna, raids, stances, rings, projectile VFX | Collapse VFX, new archetypes, CI duel harness |
| W08 Stages & Goals | 20 · 15.5 | Stage engine S0–S4, dwell, unlock gating with greyed menus, stage HUD, HQ goals (3 kinds), rule engine + sliders, lane automation, autopilot | Suggestion cards, overrides, other goal kinds |
| W09 Offline | 14 · 12.5 | Presence, coarse stepping, restart fast-run, away policy, digest + "While you were away", mock notifier + routing | Away settings panel, Web Push, Telegram, hard-mode elimination |
| W10 Cargo (F1) | 21 · 14.5 | Trade Hub (new archetype), export/import with mint caps and refunds, mock NEP-245, panel, contract suite | Shuttle VFX, send-to-account (stretch) |
| W11 Lobby | 10 · 10.0 | Planet list and picker, join via tickets → reservation → spawn | Parties, queue panel, sealing, refill, warm pool |
| W12 Player Page | 17 · 14.0 | `/me` with Pilot, Progress, stats, 20 × 3 flip cards with art, XP and levels, toasts | Planets cards, history, badge minting, titles |
| W13 Markets (F2) | 25 · 18.5 | Order book, matching with partial fills, mock Intents `token_diff` settlement, failure handling, cancel/expiry, market tab, price board | Fee controls (default fee used), extra quote tokens, matcher tests (stretch) |
| W14 Fortify | 17 · 12.5 | Raise Ridge, Dig Moat, Lower, walls block ground units and fauna, Wall Gate, `would_isolate`, wall tool | Line of fire / parapet, meteor breach, gate archetype |
| W15 Guild & Agents (F3, F4) | 21 · 16.0 | Guild NPC wallets, pricing, market making, visits, Guild tab, director key with allowance, autoTrade loop, revoke | Price reaction after fills, guardrails, cross-planet carry |
| W20 Deed (F6) | 10 · 8.5 | Deed NFT (mock) minted on founding, metadata updates, rendered card | Share page, staking (needs W21 Settled colonies) |
| W22 Treasury & Bounties (F7, F8) | 19 · 15.5 | Planet DAO, fee share, proposals + vote + Terraform boost, nest bounties with escrow, board | Meteor shield, mercenaries, other bounty kinds |
| W25 Launch | 15 · 10.5 | Docker, nginx, compose, Cloudflare, secrets, deploy script, backups, README, hosted demo, video, X post, submission | stack:local, dashboards, load/soak, analytics page |

Counts are as of 2026-10-30; the live per-wave numbers are in [`ISSUE_INDEX.md`](./ISSUE_INDEX.md) and change when tags move.

W16 (AI director) is not in the cut: the W08 rule engine and autopilot carry the autonomy. Kitbash rule: new archetypes only for the hero silhouettes (Command Hub, Trade Hub, Guild ship); everything else uses an existing archetype until its H+ row lands.

**Reuse, don't rebuild.**
- `frontend/game/app/Gameplay.ts` already has an RTS camera, click-to-move and a seeded starter colony.
- `src/kitbash/` holds the robot and fauna archetypes, `src/planets/surface/` the terrain, and `src/ui/hud.ts` a HUD.
- `frontend/design/css/tokens.css` has the Faction Plate tokens for `/me`.

The prototype predates the window, so the README must disclose it as **pre-window baseline** (hackathon rule Q-002).

## 3. Pace, checkpoints and the drop order

**Default setup:** 12 parallel agents. The schedule's start order (HACKATHON_SCHEDULE §3) is the queue: an idle agent takes the first ready `H` issue; when its wave has no ready `H` issue, it takes an `H+` issue of the same wave.

**Pace check (D2 evening, then daily).** Pace = units merged ÷ agent-days used. Target **≥ 2.2** with 12 agents (≥ 1.8 with 16). The critical path (HACKATHON_SCHEDULE §2) runs through W00 → W01 → W02 → W03 → W05 → W14 → the video; give those issues the first agent and the first review.

**Checkpoints at target pace** (wave e2e green with `--hack`; units from HACKATHON_SCHEDULE §4 ÷ 2.2):

| End of | Waves green |
|---|---|
| D5 | W00, W01, W06 |
| D8 | W02, W10, W13, W03 |
| D10 | W05, W07, W12, W15, W04, W08 (**D10 gate**) |
| D12 | W09, W14, W20, W22, W11 |
| D13 | W25 hosted demo, video; D14 submit by 20:00 UTC |

**D10 gate.** If W00–W08, W10, W12, W13 and W15 are green with `--hack`, start the `H2` rows (F5 → F1 → F2 real) on 2 extra agents. If not, skip phase 2 and ship on mocks (`NEAR_ALLOW_MOCK_IN_PROD=true`; the README says so).

**Drop order when behind** (move a wave's `H` rows to `H+`, rerun the script; units saved):
1. All `H+` work stops (agents stay on `H`).
2. W11 Lobby (10.0): the W01 dev-seat flow stays.
3. W14 Fortify (12.5).
4. W22 Treasury & Bounties (15.5).
5. W20 Deed (8.5).
6. W09 Offline (12.5): coarse stepping and restart stay in W00/W09-03.
7. W04 Maps (8.5).

Never dropped: W00–W03, W05–W07 (the playable colony and battle), W06, W10, W13, W15 (the economy the judges score), W12 (achievements), W25 submission, the contract suites and the README run.

**Review and merge: the wave development pipeline** ([`PRODUCT_WAVES.md`](./PRODUCT_WAVES.md) §7). Each wave lives in its own branch and worktree. Issues merge into their wave branch automatically when the gates are green (typecheck, unit, contract suites, the wave's `@hack` e2e), so there is no per-issue human review. The owner does **one manual check per wave** — 19 hackathon waves, about 1.5 a day — and only then does the wave merge into `main`, get tagged, lose its worktree and branch, and `main` gets pushed. A wave the owner has not checked yet can still be stacked on by the waves that need it, so the check does not stall the critical path; it does gate the landing order.

### Submission form checklist (D14)

- [ ] Project name: **TerraAgent**
- [ ] Team lead, email, team size: **solo**
- [ ] Tracks: **09** Games With Real Economies, **07** Agent Economy, **05** AI Swarms; add **10** NFTs if F6 is shown, **12** Social Money if F7 is shown (say in the description which features run on real NEAR and which on mocks)
- [ ] Prize payout: a **mainnet** NEAR wallet (the team's own)
- [ ] Repository link (public) and demo post link (X)
- [ ] Description, 20–2 000 characters: "autonomous colony builder where the economy is the gameplay", with NPC traders with wallets, player-owned markets on NEAR Intents, NEP-245 cargo, and an invisible chain
- [ ] Optional website (hosted demo URL)

## 4. Post-hackathon

Every issue tagged `H+` (if not reached) or blank in [`waves/`](./waves/), plus W16–W19, W21, W23 (except `H2`) and W24. In feature terms:

- **Stages S5–S10:** Hub T2/T3, Multitask drones, T2/T3 buildings, Terraforming Processor, Rocket Silo, launch gate and **Settled colonies** (TA-06.10, TA-06.13).
- **Combat triangle:** Tank, Artillery, Mobile Radar, Brute fauna, PvP raids, newcomer shield (TA-14.4 full, TA-06.11).
- **Air layer:** Aero Hangar, Anti-Air, Air Recon, Fighter, Gunship, Bomber, Drifter fauna.
- **Truces** and the Oathbreaker mark (TA-14.6 diplomacy part).
- Matchmaking queue UI, warm pool, **party tickets**, 2 h seat refill (TA-05.x).
- **Notifications:** Web Push + Telegram (TA-08.7, TA-11.10).
- Full **hard offline mode** UX: away budget HUD, LLM away story (TA-08.6, TA-08.3).
- **Mobile** landscape fullscreen gameplay (TA-11.9); **live landing diorama** (TA-12.3).
- **Real adapters for the remaining ports:**
  - `AgentWalletPort`, `TreasuryDaoPort`, `EscrowPort` (TA-10.13);
  - `DeedNftPort` / `BadgeNftPort` (TA-10.4);
  - `StakingPort` + account claim (TA-10.7);
  - NEP-413 wallet link (TA-10.2).
- **AI director** with an LLM (W16); deed share page and **staking** (W20); **mercenaries** and the meteor shield (W22); badge minting, history and titles (W12).
- **Future architecture (D-24):** separate services, NATS, multi-host workers with leases, deterministic replay / failover audits, anti-cheat. The obsolete tasks are listed in [`README.md`](./README.md).
- Observability dashboards, load and soak tests, E2E journeys (TA-13.x).

## 5. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Scope:** the `H` set is ≈ 294 units against 13 build days | Waves late in the value order miss the window | Measured pace from D2 (§3), the drop order in §3, review only where it matters; every wave that lands is still a working app, and the D10 gate allows shipping on mocks |
| **Judges want real NEAR usage** | All-mock looks weaker for track 09 | Phase 2 swaps F5 → F1 → F2. The README and the description state the mock/real table honestly. The contract suites show the swap is real, not a stub |
| **NEAR Intents is mainnet-only** (no testnet) | Real funds while debugging | Mocks in phase 1. In phase 2: `dry: true` and `simulate_intents` first, then a single tiny trade between our own dev colonies |
| **Social-login provider** not chosen | Real F5 (after the D10 gate) stalls | The mock `IdentityPort` carries phase 1. The owner picks a provider before D10 (HOT is a listed partner). **Fallback:** server-created named sub-accounts with custodial keys |
| **Mock ≠ real behaviour** | Phase 2 swap breaks the game | One contract suite per port, run against both. The mock simulates latency, failures and stable error codes (NEAR.md §1a) |
| **Battle v1 projectile timing at 5 TPS** | Impact times quantised to 200 ms; hit checks feel off | Store `impactAt` in seconds and resolve in the first step past it. The client animates on wall time. The duel harness runs at the same tick rate |
| Mint authority + open cargo (D-26) with no anti-bot (D-25) | Farm bots extract value in beta | Mint caps as pacing; accepted for beta; said in the README |
| Coarse ticking for empty planets | Combat on unattended colonies is coarser | Accepted (D-24); raid results go into the away digest |
| The judges' AI screening runs the README | A README that doesn't match the build scores low | The D13 clean-clone README run is part of "done" |
