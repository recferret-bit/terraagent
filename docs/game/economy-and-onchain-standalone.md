# TerraAgent — Game Economy & On-Chain Features (Standalone Summary)

> **Revised 2026-11-04:** owner-approved database-managed economy and reproducible AI experiments. W13 is a mock delivery; real-money sustainability still requires calibration and player evidence. Historical effort/calendar figures below predate this expanded scope.

> **Status:** 2026-10-30. A self-contained summary for backlog grooming: it can be read without the rest of the repo. Numbers marked *(proposed)* are tunable defaults, not settled balance. Every balance number lives in data tables and can be changed at runtime during playtests without a rebuild.

## 1. Context

- **Game:** an autonomous colony builder. The player drops a robot on a planet; the colony mines, builds, defends, terraforms and trades mostly on its own, around the clock, including while the player is away.
- **Target:** NEAR Hackathon, track **"Games With Real Economies — the economy is the gameplay"**, with secondary tracks Agent Economy and AI Swarms (plus NFTs and Social Money if those features ship). The dev window is **2026-11-01 → 2026-11-14 23:59 UTC**: one developer plus AI agents.
- **What the track asks for, and our answer:**

| Track asks for | Our answer |
|---|---|
| NPCs with wallets | **Orbital Guild** NPC traders with their own NEAR accounts, inventories and pricing |
| Player-owned markets | Every **Trade Hub** is a market stall its owner runs and earns fees from; trades settle on NEAR Intents |
| Economies that evolve without a dev patch | Guild prices follow trade history; a per-planet **treasury** funds projects that players vote on |
| Players never notice the chain (bonus) | Social login, named accounts, gas-free transactions; tokens are shown as "cargo", deals as "contracts" |
| NEP-245 (hint tag) | One multi-token contract holds every resource on every planet |

- **Build state today:** nothing in this document is built. Only a client-side visual prototype exists (planet picker, descent cinematic, colony diorama, a static resource bar). The simulation, server and all NEAR code are still to come.
- **Two phases.** Phase 1 runs **every NEAR feature on mock adapters**: database-backed fakes with realistic receipts, errors, latency and failures. Phase 2 swaps them for real NEAR one feature at a time, and only if the core game is on schedule by day 10 of the hackathon. Only login/accounts, cargo tokens and markets can go real during the hackathon; everything else stays mocked in the demo, and the README must say which is which.

## 2. Principles and trust boundary

1. **Players never notice the chain.** Guest play first, then social login. The app holds the keys that sign gameplay transactions, and our relayer pays the gas. No "wallet", "gas" or "transaction" wording in the UI. A wallet only appears if the player chooses to take custody of an account, or to stake.
2. **The server simulation is the mint authority.** Tokens are minted only from simulated stock that a colony exports at its Trade Hub, and burned when imported back. A modified client cannot invent production.
3. **One door to the chain: the Trade Hub.** Production, combat and terraforming stay in the simulation. Cargo, markets, NPC traders, deeds, the treasury and bounties live on-chain.
4. **Gameplay never waits for the chain**, except for a trade's own settlement. Mint, burn and settlement run as background jobs. If NEAR is unreachable, market and cargo actions return "market unavailable" and the planet keeps running.
5. **No anti-cheat and no anti-bot machinery.** Multi-accounting and farm bots can play for value. **Cargo is open in beta**: it can be swapped for NEAR or USDC. Mint caps exist as economic pacing, not as security. This risk is accepted for beta. *Amended by D-45 (2026-11-07): bots are first-class traders on the W13 exchange through the bot API `/v1/trade/*` (actor kind `bot`) with per-key allowances, kill switch and rate limits; there is still no identity verification. A fill is organic only for `player`/`bot` pairs of different colonies and owners.*
6. **No real money paid out by the game.** Staking yield comes from validators, on the player's own NEAR. The treasury and bounties move only tokens that players already hold. *(The Guild's NEAR float may conflict with this; see open question Q1.)*
7. **NEAR Intents is mainnet-only.** There is no testnet, so real testing uses dedicated dev accounts, tiny amounts and dry-run simulation first.

| Layer | Holds | Source of truth |
|---|---|---|
| On-chain | Accounts, token balances, settled trades, deeds, treasury, staking | NEAR (our contracts + `intents.near`) |
| Server simulation | Production, stock, combat, terraform %, export amounts | The game server (one Node app + Postgres) |
| Client | Rendering and inputs | Nothing |

## 3. In-game resource model

**Three stored families with 10 sub-resources.** The key of each sub-resource is also its token id.

| Family | Tier 1 (from landing) | Tier 2 | Tier 3 |
|---|---|---|---|
| Metals | Iron `metals.t1` | Light alloys `metals.t2` | Titanium `metals.t3` |
| Minerals | Silica `minerals.t1` | Rare earths `minerals.t2` | Exotic crystal `minerals.t3` |
| Bio | Water `bio.water`, Biomass `bio.biomass` | Petroleum / organics `bio.t2` | Gene-stock `bio.t3` |

- **Energy is not a resource and not a token.** It is grid power (E/s), stored only in capacitor banks and carried over a destructible pylon grid. When demand exceeds supply, buildings shut down in a fixed priority order, and the Trade Hub is in the second group to go. **A brownout takes the market stall offline.**
- **Storage caps are per family**, shared by its sub-resources *(proposed)*. A full family halts every source of that family until more storage is built.
- **Tier unlock needs both gates** *(proposed numbers)*:
  - **Tier 2:** colony terraform ≥ **30 %**, and ≥ **50 %** of the tiles within 2 of the extractor terraformed (Irrigated or Living).
  - **Tier 3:** colony terraform ≥ **70 %**, and ≥ **50 %** of those tiles Living.
  - Tier 1 is always produced.
- **Yield split** *(proposed)*: with tier 2 unlocked, output is 70 % T1 / 30 % T2; with tier 3, 50 / 30 / 20. The extractor's own upgrade level changes only its rate.
- **Cost rule:** a T1 building or unit pays in T1. A T2 item pays its metals and minerals 60 % T1 + 40 % T2, and its fuel in petroleum. A T3 item pays 40 / 30 / 30 across tiers, plus 10 % of its metals as gene-stock. Running upkeep (fuel, coolant, terraform water) is paid in T1 *(proposed)*.
- **Why the market matters:** every sub-resource is its own token and market pair, and T1 trades from day one. **A colony can buy T2/T3 before it can mine them.** The Hub upgrade that opens the mid-game costs T2 resources, so the player reaches mid-game either by terraforming or by trading.
- **Planet modifiers:** Desert has +35 % solar, half-rate water extraction and richer metals and minerals; Ocean has richer bio and poorer metals; Temperate has richer minerals. The hackathon demo uses Temperate only.

**Key economic levers**

| Lever | Value |
|---|---|
| Trade Hub export throughput | Tier 1 **250** · Tier 2 **900** · Tier 3 **3 500** units/min |
| Daily mint cap | **20 000** units per sub-resource per colony per UTC day *(proposed)* |
| Trade Hub tier 1 | 2×2 tiles, 22 s build, 100 metals / 80 minerals / 30 fuel / 10 water, −6 E/s, 650 HP |
| Base storage | Command Hub +500 per family; Supply Depot +1 000 / +3 500 / +12 000 by tier |
| Market fee | Buyer quote-token fee: platform 1% plus stall 0–1% (default 1%) |
| Treasury share | 20 % of the platform fee *(proposed)* |

**Where resources come from and go (as designed)**
- **Sources:** extractors, Worker Drones and terrain-shaping yields in the simulation. Exports mint tokens only from stock that already exists. **Mock-only grants:** Guild fixture inventory and dev cargo grants are separately labeled and excluded from organic demand. Real Guild cargo must be purchased or exported from treasury-owned stock.
- **Sinks:** construction and unit costs, running upkeep, terraforming (water), and treasury project costs (where these tokens end up is undefined; Q6).
- **Transfers, not sinks:** market trades, fees to stall owners, the treasury share, bounty escrow.

## 4. Features

**Build order:** Invisible chain → Cargo tokens → Markets → Guild traders → Colony director ║ *cut line* ║ Colony deed → Planet treasury → Bounties. Features after the cut line ship only if the core is ahead of schedule.

**Scope labels used below:** **Must**: in the hackathon cut. **Stretch**: only if time allows. **Later**: after the hackathon.

| # | Feature | Hackathon scope | Rough effort (units*) | Real NEAR in hackathon? |
|---|---|---|---|---|
| F5 | Invisible chain | Must | 12.5 | Possible after day 10 |
| F1 | Cargo tokens | Must | 14.0 | Possible after day 10 |
| F2 | Player markets + database economy experiments | Must | 44.0 | Possible after day 10 (dry-run first, then one tiny real trade) |
| F3 + F4 | Guild traders, colony director | Must | 18.5 | No (mock) |
| F6 | Colony deed (+ staking) | Must, but staking is Later | 8.5 | No (mock) |
| F7 + F8 | Treasury, bounties | Must (reduced) | 15.5 | No (mock) |
| — | Real NEAR swap for F5/F1/F2 | Conditional on technical/economic gates | 16.0 | — |

\*One unit ≈ one medium-sized issue. When behind schedule, the treasury/bounties wave is dropped 4th and the deed wave 5th. Login, cargo, markets and the Guild are **never dropped**.

### F5 — Invisible chain: social login, named accounts, gasless
- **What it is:**
  - Guest → social login → a named account `{name}.terraagent.near`, shown as "Pilot ID".
  - Each colony gets a sub-account `{colony}.{name}.terraagent.near`.
  - Transactions are signed by app-held keys (encrypted at rest) and submitted gas-free through our relayer.
  - A player can later claim their account for self-custody.
- **Must:** mock Google/X login; account name derivation with collision handling; upgrading a guest keeps all colonies; a colony account on founding; the encrypted key store; the relayer with a receiver allow-list and nonce handling; the first gasless action; "Saving to orbit…" pending, failed and retry UX; a stable error model.
- **Later:** account settings panel, login on a second device, optional wallet link, a lint that keeps chain words out of the UI, analytics, mobile.

### F1 — Orbital Port: cargo tokens (NEP-245)
- **What it is:** one multi-token contract `res.terraagent.near` with 10 token ids (the sub-resource keys). Only our minter account can mint or burn. Transfers are unrestricted in beta.
- **Loop:**
  - **Export:** the player builds a Trade Hub and exports. Stock leaves storage, tokens are minted to the colony account, and the hub shows "Cargo in orbit: 1 200 iron". A failed mint refunds the stock, even above the storage cap.
  - **Import:** tokens are burned and the stock is credited, limited to free storage, which is reserved up front.
- **Caps:** exports over any rolling 60 s ≤ the combined throughput of the colony's online hubs, plus the daily cap per sub-resource. Going over returns "mint cap".
- **Unlock:** the Trade Hub opens on first contact with a neighbor (from stage 2), on the first Guild visit, or at stage 5. A demo flag opens it at stage 2.
- **Idempotency:** every mint carries a deterministic operation id, so a retry can never mint twice.
- **Must:** the Trade Hub (the only new 3D model on the must path), export/import with caps and refunds, the mock token ledger, the hub panel, pending and cap UX.
- **Stretch / Later:** cargo shuttle model and VFX, history rows, sending cargo to another account, carrying cargo to the next planet by rocket.

### F2 — Player markets and database-managed economy (W13)

- USDC is the default quote; resource barter and optional NEAR remain. Mock settlement in W13; real adapters and cash gates in W23.
- Price-time books execute at maker price. Buyer receives full base and pays quote notional plus platform 1% and maker-stall 0–1% (default 1%), regardless of maker/taker role. At 10 USDC notional the buyer pays 10.20, seller receives 10, platform 0.10 and stall 0.10.
- Orders pin fee/policy versions and reserve all principal plus fees. Exact atomic arithmetic, cumulative rounding/minimum notional, partial fills for custodial accounts, all-or-nothing for claimed accounts and same-colony self-trade prevention are required. Ambiguous settlement remains pending until reconciled.
- Fee controls, USDC, matcher tests, accounting reconciliation, telemetry and database profile management are required scope. Resource fees are inventory until sold; mark-to-market estimates are not realized cash revenue.
- Postgres holds immutable typed profiles for production, recipes, resource targets, market and agent policies. Operators clone/edit/validate, compare experiments, activate at an effective tick and roll back; no code deployment or raw SQL is needed. Existing jobs/orders retain their terms.
- Planet/sector profiles configure each resource tier independently: deserts can have abundant silica/iron and scarce exotic crystal, with richer sector exceptions. Every production/discovery path respects pinned endowments.
- Active bases and armies consume recurring logistics supplies. Congestion and route distance raise material costs; depots, local trade and reserve mode reduce them. Market order prices remain unchanged; the player sees the larger supply basket and shortage remedies.
- Demand comes from activity-based consumption, mixed-tier recipes, regional specialization and repeatable optional prestige projects. No new passive absence fee or guaranteed resource price. Current production/repair/queue rules are reused.
- A JSON-schema-driven AI workflow discovers parameters, patches candidates, runs the shared sim with seeded manifests, compares paired/held-out/stress reports and returns explained recommendations. Experiment permissions cannot activate live policies.
- External cargo transfers/imports stay open; our books are planet-local and external-market fee leakage is accepted. Guild transport is not exclusive.
- Public cash activation requires exact accounting, approved economic gates and observed repeat purchases in a bounded player pilot; mock trade volume does not establish demand. Expanded effort replaces the old 3–4-day market estimate.

### F3 — Funded Orbital Guild traders (W15)

- NPC wallets own finite cargo and quote cash. Real initial cargo is purchased or exported from treasury-owned sim stock; mock seed grants are labeled fixtures. Every cash allocation is explicit; no automatic replenishment.
- Shared deterministic inventory pricing uses eligible finalized history, staleness/volume/concentration checks, bounded spreads and fee-inclusive reservations. Cash bids pause when references are unreliable; bounded temporary bootstrap prices are disclosed subsidies.
- Database policies impose per-NPC and global cash/inventory/spend/loss caps with a kill switch. Counters survive restart. Post-fill re-quoting, guardrails, allowance tests and stress reports are required scope.
- Player directors forecast shortages and sell surplus within floors, effective-price limits, outstanding-order reservations and session budgets. Signing alone does not spend principal; settlement does. Revoke cannot undo an already irreversible submission.
- Guild routes provide transport alongside external cargo mobility; optional LLM routing suggestions remain within deterministic checks. NPC purchases spend funded money, not new outside demand.

### F4 — Colony director key
- **What it is:** a restricted key on the colony account whose **allowance** equals the trading share of the player's away budget. The colony's AI director signs trades with it within the player's auto-trade limits. The player revokes it with one tap, and the HUD shows spent vs allowance.
- **Auto-trade limits, per sub-resource:**
  - sell above X % of family storage; buy below a floor;
  - max per trade; max per away session; minimum stock floor;
  - partners: Guild only, truce partners, or anyone.
  - One shared check runs in both the simulation and the market module.
- **Loop:** "While you were away: Director sold 400 iron to the Guild". When the allowance runs out, the director stops and the player is notified.
- **Later:** entries in the away digest, policy tests, analytics.

### F6 — Colony Deed (dynamic NFT, NEP-171) + own-NEAR staking
- **What it is:**
  - One NFT per colony, minted at founding and owned by the colony account.
  - The metadata updates on milestones (stage, terraform % in 10 % steps, walls, trade volume, truces, rank), at most once per 10 min per colony.
  - The card image is rendered by the server and can be shared.
- **Settled Deed and staking:**
  - When a colony launches its rocket and is left behind as a **Settled** colony, its deed becomes the place for staking the player's **own** NEAR with a whitelisted validator. The rewards come from the validator, not from us.
  - The player must have claimed the account first.
  - Staking gives **no in-game advantage**; a property test checks this.
- **Must:** the mock mint on founding, metadata updates, the deed card UI.
- **Stretch / Later:** the public share page and X share, all staking and account claiming (they depend on the rocket and Settled colonies, which are Later).

### F7 — Planet Treasury & Council (DAO)
- **What it is:**
  - One DAO per planet, SputnikDAO-like. Its members are the planet's colony accounts.
  - Voting: 1 colony = 1 vote; a proposal passes at > 50 % of members; proposals close after 6 h.
  - Funding: a treasury leg in every trade, worth 20 % of the platform fee. Example: a 10-USDC trade at 1% platform + 1% stall → 0.08 retained by platform, 0.02 treasury, 0.10 stall.
- **Projects → simulation effects** *(proposed numbers)*:

| Project | Effect | Cost |
|---|---|---|
| Terraform boost | Living-ground terraform costs −25 % for 12 h | 1 000 |
| Meteor shield | Meteor and lightning rates −75 % for 6 h | 1 500 |
| Guild subsidy | One extra Guild visit | 800 |

- **Must:** the DAO, the fee share, propose / vote / finalize, the terraform boost, the Council UI. Away colonies abstain.
- **Stretch / Later:** the meteor shield (needs meteors in the game), the Guild subsidy, HUD badges and visual effects.

### F8 — Bounties & mercenaries
- **What it is:**
  - An escrow contract holds cargo or NEAR for a posted target: clear a nest, defend an area, or deliver units.
  - When the simulation reports the target met, the escrow is released to the claimer.
  - Limits: at most 3 active bounties per colony; each expires in 2–48 h.
- **Mercenary NPCs** have their own accounts. They accept defense contracts, spawn allied squads, are paid pro-rata from escrow, and can guard offline colonies within an away spending limit.
- **Must:** "clear a nest" bounties only (the colony that did the most damage in the last 60 s wins), the bounty board, escrow.
- **Stretch / Later:** expiry and refunds, defend and deliver bounties, all mercenaries, map markers.

## 5. Accounts and keys

| Account | Role | Keys the app holds |
|---|---|---|
| `terraagent.near` (+ `.testnet`) | Root; creates the sub-accounts | **None** (owner's cold wallet) |
| `relayer.terraagent.near` | Pays gas; operator of the game contracts | Full access, file secret |
| `minter.terraagent.near` | The only account that can mint or burn cargo | Full access, file secret |
| `{name}.terraagent.near` | Player's named account | Per-player key, encrypted, until claimed |
| `{colony}.{name}.terraagent.near` | Colony: holds cargo, signs orders, owns the deed, stakes after claim | Per-colony key, encrypted, until claimed |
| `guild-N.npc.*` / `merc-N.npc.*` | NPC traders / mercenaries | Restricted keys for Intents and cargo only |

- **Relayer allow-list:** only our cargo, deed, bounty and DAO contracts, plus `intents.near`. This is for cost control, not anti-cheat.
- **Account claim (one-way):**
  - The player's wallet key becomes the full-access key, and the app's full-access key is removed.
  - The app keeps only a restricted key with an allowance, scoped to Intents and cargo, so gameplay keeps working but the game can no longer move the player's NEAR.
  - Staking requires a claimed account.
- **Cost estimate (to verify):**
  - account creation ≈ 0.01 NEAR;
  - each mint, burn or trade batch ≈ 0.0005–0.002 NEAR in gas, paid by the relayer, which also covers storage deposits;
  - alert when the relayer balance falls below 5 NEAR.

## 6. Mock-first architecture

- **Ports and adapters:**
  - Game code depends only on abstract interfaces (ports), one per NEAR capability: identity, relayer, cargo token, intents, agent wallet, deed/badge NFT, staking, treasury DAO, escrow, chain read.
  - Each port has a mock and a real adapter, chosen per port by an environment variable. It **fails closed**: anything except an exact "testnet" or "mainnet" selects the mock.
  - Production refuses mocks unless they are explicitly allowed, so the demo can run on mocks on purpose.
- **Realistic mocks:**
  - the mock state lives in database tables;
  - fake transaction hashes have a `mock:` prefix;
  - error codes are the same stable ones the real adapter returns;
  - latency is 300–1 500 ms, with injectable failure rates, so the pending and failed UI states get exercised from day one.
- **Outbox:** every chain write is recorded in the same database transaction as the game change and carries a deterministic operation id. A retry can never double-mint.
- **Shared contract tests:** one test suite per port runs against the mock in CI and against the real adapter manually or nightly. A port goes real only when its suite passes against the real adapter, and it can be rolled back to the mock with one setting.
- **Swap order:** identity + relayer → cargo → intents (dry-run first) → agent wallets → deed → treasury → escrow.
- **Day-10 gate:** if the core game and the login, cargo, market and Guild features are green by day 10, two extra agents start the real swap for login, cargo and markets. If not, the demo ships on mocks and the README says so.

## 7. Off-chain economy hooks

- **Away budget:**
  - The player sets it as a % of stock per family. Defaults: 40 % per automated action, 60 % per away session.
  - Spending on defense and repair is never capped.
  - **Hard mode:** colonies can be destroyed while the player is away.
- **Auto-trade:** ships in the first release, with the limits listed under F4. A trade offer outside the limits notifies the player instead.
- **"Negotiate" goal:** the colony HQ places trade offers within give/want bounds and a budget. It needs neighbor contact and a Trade Hub. It will hook into the market after the hackathon.
- **Achievements:** Merchant (5 / 50 / 500 trades), Port Authority (stall fees earned: 100 / 1 000 / 10 000), Guild Contact (5 / 50 / 250 Guild trades). XP is cosmetic only. Earned tiers can be minted as non-transferable badge NFTs (mocked).
- **Rocket and Settled colonies (Later):**
  - Launch requires the colony's own territory to be 100 % Living.
  - The colony left behind becomes Settled: inert and invulnerable, it still counts for score and stays a treasury member without the right to propose.
  - The new colony gets +25 % starting stock, and in-orbit cargo follows the player to the new planet.

## 8. Open questions and gaps

Type: **Owner** = needs an owner decision · **Spec** = a design gap or inconsistency the team can fix · **Verify** = check in the external docs.

| # | Type | Question / gap | Current state or proposed default |
|---|---|---|---|
| Q1 | Resolved design (D-44) | Guild cash purchases require explicit finite funding; no buyback guarantee | Per-NPC/global caps, restart-safe budgets and price-quality gates are mandatory; calibration and implementation remain open |
| Q2 | Resolved design (D-44) | Real Guild funding has no stockless mint exception; mock grants are fixtures | W15-05 and cash gates enforce accounting and isolation |
| Q3 | Owner | Open cargo + no anti-bot = real-value extraction in beta | Accepted for beta, with mint caps as pacing. Consider a legal note alongside the staking review |
| Q4 | Resolved design (D-44) | Buyer quote-token fees and order policy snapshots replace old fee proposals | NEAR and the economy contract now specify settlement and recovery; implementation is W13 |
| Q5 | Spec | Several port methods used by the plan are missing from the spec's port table (key status, deed lookup, staking pool list/withdraw/position, DAO member add/remove/lookup, escrow lookup) | Add them to the spec |
| Q6 | Spec | **Where do treasury project costs go?** Burned (a real sink) or sent somewhere? "Cost 1 000 cargo-equivalent" names no token and no conversion | Undefined |
| Q7 | Planned (D-44) | Transport now has a metered recipe shared by sim and experiments | W13-43 defines actual service consumption; no charge on external wallet transfers |
| Q8 | Owner | Social-login provider for the real login (NEAR named-account support, mobile redirect, cost). **Needed by 2026-11-11** | HOT is a listed hackathon partner. Fallback: server-created custodial named accounts |
| Q9 | Owner | Is a wallet link needed to keep a colony across devices, or is guest + "Save progress" enough? | Open |
| Q10 | Verify | How cargo tokens are deposited into `intents.near`, and its token-id format. If multi-token deposits are not supported, fall back to 10 single tokens (NEP-141) | Check before the cargo contract is written |
| Q11 | Verify | The 1Click API for NEAR/USDC swaps (0.2 % fee without a partner key) | Check; the owner may register a partner key |
| Q12 | Owner | Mainnet dev accounts with a small NEAR balance, plus the cargo-contract deployer. **Needed by 2026-11-12** for real cargo and markets | Not done |
| Q13 | Owner | Proposed balance: mint cap 20 000/day, platform fee 1%, stall max 1%, treasury share 20 %, Guild spread and caps, project costs | Use the defaults; tune in playtests |
| Q14 | Spec | The Petroleum Well (it yields only tier-2 petroleum) unlocks at stage 2 but produces nothing before terraform ≥ 30 % | Proposed: move its unlock to stage 5 |
| Q15 | Spec | The Hub tier-2 upgrade now costs tier-2 resources, so the mid-game pacing table is stale; the market becomes part of the path to mid-game | Accept; re-run pacing in playtests |
| Q16 | Owner | Staking: who governs the validator whitelist, a legal review of the staking copy, the testnet → mainnet pool list | After the hackathon; no staking in the demo |
| Q17 | Spec | The units spec still says the "Negotiate" goal uses the old trade saga, which NEAR Intents replaced | Update the reference |
| Q18 | Spec | Cargo carry-over to the next planet is promised for cargo tokens, but it depends on the rocket, which is Later | Not in the demo |
| Q19 | Owner | Cross-planet trade happens only through the Guild, and actually carrying goods is Later. In the demo the Guild sells only its starting stock, and the "sector economy" is one planet | Accept for the demo, or promote carrying to Stretch |
| Q20 | Resolved plan (D-44) | USDC, stall controls and matcher tests are required | W13-17/22/31 promoted to H |
| Q21 | Spec | The treasury and deed depend on lifecycle events (planet creation, elimination, settling). Some of these come from waves that may be dropped or are Later | A lazy-create fallback exists; check it in the treasury end-to-end test |

## 9. Rough schedule (at the target pace)

| By end of hackathon day | Economy work green |
|---|---|
| 5 | Invisible chain (login, accounts, relayer) |
| 8 | Cargo tokens, markets |
| 10 | Guild traders and director (**day-10 gate** → start the real-NEAR swap) |
| 12 | Colony deed, treasury and bounties |
| 13–14 | Hosted demo, video, X post, submission (stating real vs mock) |
