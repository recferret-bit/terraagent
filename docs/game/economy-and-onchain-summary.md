# TerraAgent — Economy & On-Chain Features: Summary for Grooming

> **Owner-approved economy revision (2026-11-04, D-44):** [ECONOMY](../spec/ECONOMY.md) is authoritative for demand, quote-token fees, database profiles and AI experiments. Historical calendar/effort estimates below require reforecasting after the expanded W13/W15 scope.

> **Status:** derived summary, 2026-10-30. Written for backlog grooming. It restates and links the specs; it does not decide anything. **[`DECISIONS.md`](../spec/DECISIONS.md) is the source of truth**, and where this file and a spec disagree, the spec wins.
> **Sources:** see §11. Numbers marked **(proposed)** are proposed in the specs too: they are tunable defaults (D-35), not settled balance.

## 0. Where we are

- **Nothing in this file is built yet.** The repo has only the `frontend/` prototype: no `shared/` packages, no `backend/`, no sim, no NEAR code. The prototype HUD (`frontend/game/ui/hud.ts`) still shows the old static `ENERGY / METAL / WATER / BIOMASS` bar. W02-26 turns it into the D-34 family bar.
- **Target:** NEAR Hackathon, track **09 "Games With Real Economies"** (also 07 Agent Economy and 05 AI Swarms; 10 NFTs if F6 ships, 12 Social Money if F7 ships). Dev window **2026-11-01 → 2026-11-14 23:59 UTC**, solo developer plus AI agents (D-27).
- **Phase 1 (D1–D13):** every NEAR feature F1–F8 runs on **Postgres mock adapters** behind real ports (D-30). **Phase 2 (from D10, only if the D10 gate passes):** F5 → F1 → F2 swap to real NEAR (W23 `H2` rows). Every other port stays mocked for the demo.
- **What track 09 asks for, and our answer:** NPCs with wallets (F3 Orbital Guild), player-owned markets (F2 Trade Hub stalls), economies that change without a dev patch (F3 pricing plus F7 treasury), and the "players never notice the chain" bonus (F5).

## 1. Principles and the trust boundary

| # | Principle | Ref |
|---|---|---|
| 1 | **Players never notice the chain.** Guest play comes first, then social login with a named account. Every gameplay tx is signed with keys the app holds and gas is paid by our relayer (NEP-366). Tokens are shown as "cargo" and deals as "contracts". No wallet, gas or transaction words in the UI | F5, NEAR.md §1 |
| 2 | **The server simulation is the mint authority.** Cargo is minted only from simulated stock exported at a Trade Hub and burned on import. No client claim can mint | D-26, NEAR-51 |
| 3 | **One door: the Trade Hub.** Production, combat and terraforming stay in the sim. Cargo, markets, NPC traders, deeds, the treasury and bounties are on-chain | NEAR.md §1 |
| 4 | **Gameplay never waits for the chain**, except for a trade's own settlement. Mint, burn and settle are async outbox jobs. If NEAR is down, the cargo and market commands return `market_unavailable` and the planet keeps running | NEAR.md §1 |
| 5 | **No anti-cheat and no anti-bot.** Multi-accounting and farm bots can play for value. **Cargo is open in beta** (it can be swapped for NEAR or USDC). Mint caps are economic pacing, not security. *Amended by D-45 (2026-11-07): bots are first-class traders on the W13 exchange through the bot API `/v1/trade/*` (actor kind `bot`) with per-key allowances, kill switch and rate limits; there is still no identity verification. A fill is organic only for `player`/`bot` pairs of different colonies and owners.* | D-25, D-26, D-45 |
| 6 | **No real money from the game.** Staking yield comes from validators, on the player's own NEAR. Treasury and bounties move only tokens that players already hold. *(See open question Q1: the Guild's NEAR float may conflict with this.)* | near-economy spec §2 |
| 7 | **`intents.near` is mainnet-only.** There is no testnet, so real work uses dev accounts, tiny amounts and `dry: true` / `simulate_intents` | NEAR-64 |

| Layer | Holds | Truth |
|---|---|---|
| On-chain | Accounts, token balances, settled trades, deeds, treasury, staking | NEAR (our contracts + `intents.near`) |
| Server sim | Production, stock, combat, terraform %, export amounts | Game server (one Node app, D-24) |
| Client | Rendering and inputs | Nothing |

## 2. In-game resource model (D-34)

**Three stored families, 10 sub-resources.** The `ResourceKey` is also the cargo token id.

| Family | T1 (from landing) | T2 | T3 |
|---|---|---|---|
| Metals | Iron `metals.t1` | Light alloys `metals.t2` | Titanium `metals.t3` |
| Minerals | Silica `minerals.t1` | Rare earths `minerals.t2` | Exotic crystal `minerals.t3` |
| Bio | Water `bio.water`, Biomass `bio.biomass` | Petroleum / organics `bio.t2` | Gene-stock `bio.t3` |

- **Energy is not a resource family and not a token.** It is grid power (E/s), stored only in Capacitor Banks, and moves over a destructible pylon grid. Brownouts shed load in a fixed order: the Trade Hub is in shed group 2, so **a brownout takes the market stall offline**.
- **Storage caps are per family**, shared by that family's sub-resources (the sum rule is **proposed**). Hub and Depot storage adds the same amount to all three families. A full family halts every source of that family.
- **Tier unlock (both gates).** T2 output needs colony Terraform % **≥ 30 %** and **≥ 50 %** of the extractor's 2-tile ring Irrigated or Living. T3 needs **≥ 70 %** and **≥ 50 %** Living in the ring. T1 is always produced. *(Numbers proposed.)*
- **Yield split (proposed):** T2 unlocked → 70 % T1 / 30 % T2. T3 unlocked → 50 / 30 / 20. Extractor Mk.I–III scales only the rate.
- **Cost tier rule** (until the tables are rebalanced): a T1 item pays in T1. A T2 item pays M and Min 60 % T1 + 40 % T2, and Pet in `bio.t2`. A T3 item pays 40 / 30 / 30 across tiers, plus 10 % of its M as `bio.t3`. Upkeep (fuel, coolant, terraform water) is always paid in T1 *(proposed)*.
- **The market link:** every sub-resource is its own cargo token and market pair, and T1 pairs trade from day one, so **a colony can buy T2/T3 before it can mine them**. This is the main reason to trade. R10 adds that Hub T2, the S5 trigger, now costs T2, so S5 needs terraforming *or* market purchases.
- **Planet modifiers (D-33):** Solar +35 % on Desert; Water Extractor ×0.5 on Desert; deposit richness Desert Metals/Minerals +15 %, Ocean Bio +20 % and Metals −15 %, Temperate Minerals +15 % *(generator mix proposed)*. The hackathon runs Temperate only.
- **All balance numbers are data rows** in `shared/sim/src/data/*.ts`, tunable at runtime through `TA_BALANCE_OVERRIDES` and the dev console `tune` (D-35, W00-59).

**Economic levers that matter for the chain side** (full tables: [economy spec §3](./colony-economy-and-buildings-spec.md)):

| Lever | Value | Ref |
|---|---|---|
| Trade Hub throughput (export cap per minute) | T1 **250** · T2 **900** · T3 **3 500** units/min | economy §3.5, NEAR-53 |
| Daily mint cap | **20 000** units per sub-resource per colony per UTC day *(proposed)* | `CARGO_MINT_CAP_PER_DAY` |
| Trade Hub T1 | 2×2, 22 s, 100 M / 80 Min / 30 Pet / 10 W, −6 E/s, 650 HP | economy §3.5 |
| Base storage | Hub T1 +500 per family; Depot T1/T2/T3 +1 000 / +3 500 / +12 000 | economy §3.1, §3.5 |
| Market fee | Buyer quote-token fee: platform 1% plus stall 0–1% (default 1%) | NEAR-61 |
| Treasury share | 20 % of the platform fee (`TREASURY_FEE_SHARE_BP=2000`) *(proposed)* | NEAR-101, W22-07 |

**Sources and sinks (as designed today):**
- **Sources:** extractors, Worker Drones and terrain-op yields (sim); cargo mints happen only on export, as stock that already exists. **Mock-only grants:** Guild fixture inventory and dev cargo grants are separately labeled and excluded from organic demand. Real Guild cargo must be purchased or exported from treasury-owned stock.
- **Sinks:** construction and unit costs, running upkeep, terraform ops (`bio.water`), treasury project costs (where the paid tokens end up is undefined, Q6).
- **Transfers (not sinks):** market trades, fee legs to stall owners, the treasury leg, bounty escrow.

## 3. Features F1–F8

Build order (D-27): **F5 → F1 → F2 → F3 → F4** ║ *cut line* ║ **F6 → F7 → F8**. Effort is in units (one M issue = 1, S = ½). All waves run on mocks.

| Feature | Wave | Issues (H / H+ / later) | H units | Real NEAR in hackathon? |
|---|---|---|---|---|
| F5 Invisible chain | W06 | 28 (20 / 0 / 8) | 12.5 | H2 after the D10 gate (W23) |
| F1 Cargo tokens | W10 | 31 (21 / 2 / 8) | 14.0 | H2 after the D10 gate |
| F2 Markets | W13 | 57 (53 H / 4 later) | 44.0 H | H2 after the D10 gate (mainnet, dry-run first, then one tiny trade) |
| F3 + F4 Guild & director | W15 | 34 (25 H / 2 H+ / 7 later) | 18.5 H | No (mock) |
| F6 Deed (+ staking) | W20 | 27 (10 / 2 / 15) | 8.5 | No (mock); staking is post-hackathon |
| F7 + F8 Treasury & bounties | W22 | 36 (19 / 2 / 15) | 15.5 | No (mock) |
| Rocket, Settled, claim | W21 | 26 (0 / 0 / 26) | 0 | Post-hackathon |
| Real adapters | W23 | 49 (22 H2 / 27 later) | 16.0 (H2) | F5/F1/F2 only |

Drop order when behind (HACKATHON_CUT §3): W22 goes 4th and W20 5th. W06, W10, W13 and W15 are **never dropped**.

### F5 — Invisible chain: social login, named accounts, gasless (W06)
- **Primitive:** guest → social login → `{name}.terraagent.near` ("Pilot ID"); colony sub-accounts `{colony}.{name}.terraagent.near`; NEP-366 meta-transactions through `relayer.terraagent.near`; account claim for self-custody later (D-18).
- **Ports:** `IdentityPort`, `RelayerPort` (+ `ChainReadPort` from W00).
- **In the H slice:** mock OAuth (Google/X mock), name derivation and collisions, guest → social upgrade that keeps colonies, colony sub-account on `colonyFounded`, the key store (ed25519, AES-256-GCM under `NEAR_KEK`), relayer allow-list and nonce handling, the first gasless action (`storage_deposit` on `res.*`), pending/failed/retry UX "Saving to orbit…", contract suites, the error model.
- **Deferred:** Settings → Account (W06-17), second-device login (W06-07), NEP-413 wallet link (W06-18), the copy lint for chain words (W06-21), analytics and telemetry, mobile.
- **Open:** the provider choice (HOT is a listed partner; Q8); whether a wallet link is needed across devices (D-10).

### F1 — Orbital Port: cargo tokens, NEP-245 (W10)
- **Primitive:** one multi-token contract `res.terraagent.near`, 10 token ids = `ResourceKey`, 18 decimals. Only `minter.terraagent.near` can `mt_mint` / `mt_burn`. Transfers are unrestricted in beta.
- **Loop:** build a Trade Hub → **Export** (stock leaves storage, `pendingMint`, outbox → mint to the colony account → `cargo.settled`; a failed mint refunds, even above cap) → "Cargo in orbit: 1 200 iron". **Import** burns and credits storage, clamped to free space and with incoming capacity reserved.
- **Caps:** rolling 60 s export ≤ the sum of online hub throughput; daily cap per sub-resource. Over → `mint_cap`.
- **Unlock rule (data):** `tradeHub.unlock = neighborContact(≥S2) | guildVisit | S5`; the demo flag `TRADE_HUB_AT_S2=true` opens it at S2.
- **Port:** `CargoTokenPort` (`mint`, `burn`, `balanceOf`, `transfer`). Idempotent by `opId = cargo-export:{colonyId}:{exportSeq}`.
- **New archetype:** `building.tradeHub` T1 is the **only new model on the H path** (W10-16).
- **Deferred:** the cargo shuttle model and VFX (W10-17/18), history rows (H+), send-to-account `cargo.transfer` (W10-31, H+), the **rocket carry-over hook** (W10-15, a no-op until W21).

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

### F4 — Colony director key (W15)
- **Primitive:** a function-call / intents key on the colony account. Its **allowance** = the trading share of the player's away budget. The AI director signs `autoTrade` orders with it, and the player revokes it in one tap; the HUD shows spent vs allowance.
- **autoTrade limits (W15-19, per sub-resource):** sell above % of family storage, buy below a floor, max per trade, max per away session, min stock floor; partners `guild` / `truce partners` / `anyone`. One checker, `withinAutoTrade` (W09-13), is called in both the sim and the market module.
- **Loop:** "While you were away: Director sold 400 iron to the Guild". Exhaustion → `directorAllowanceExhausted` → `away_budget_exhausted` notification.
- **Port:** `AgentWalletPort` (`createSubAccount`, `addLimitedKey`, `revokeKey`, `keyStatus`).
- **Deferred:** digest items (W15-24), policy tests (H+), analytics.

### F6 — Colony Deed (dynamic NEP-171) + own-NEAR staking (W20)
- **Primitive:** `deed.terraagent.near` mints one NFT per colony at founding, owned by the colony account. The operator updates its metadata on milestones (stage, Terraform % in 10 % steps, walls, trade volume, truces, rank), debounced to at most one update per colony per 10 min. The image is server-rendered (SVG → PNG card).
- **Settled Deed:** on `colonySettled` (W21) the deed becomes the home for **own-NEAR staking**: a **claimed** account deposits to a whitelisted pool (`NEAR_STAKING_POOLS`), and validator rewards go to the player. **No in-game perk from the staked amount** (a no-pay-to-win property test, W20-23).
- **In the H slice:** the mock mint on founding, metadata updates, the card UI. **Deferred:** the share page and X share (H+), all staking and claim (they need W21, which is post-hackathon).

### F7 — Planet Treasury & Council (W22)
- **Primitive:** one SputnikDAO-like DAO per planet (`{planet}.sputnik-dao.near`). Members are the colony accounts, 1 colony = 1 vote, pass at > 50 % of members, proposal deadline 6 h. It is funded by a **treasury leg** in each trade batch (20 % of the platform fee: a 10-USDC trade at 1% platform + 1% stall → 0.08 retained by platform, 0.02 DAO, 0.10 stall).
- **Proposal kinds → sim effects (proposed numbers):** `terraform_boost` (Living-op costs −25 % for 12 h, cost 1 000), `meteor_shield` (meteor/lightning −75 % for 6 h, 1 500), `guild_subsidy` (+1 Guild visit, 800).
- **In the H slice:** the DAO, the fee share, propose / vote / finalize, terraform_boost, the Council UI. **Deferred:** meteor_shield (needs W05 meteors), guild_subsidy (H+), HUD badges and VFX. Away colonies abstain (W22-16).

### F8 — Bounties & mercenaries (W22)
- **Primitive:** `bounty.terraagent.near` escrows cargo or NEAR for a target: `clear_nest`, `defend_area`, `deliver_units`. The sim emits `bountyCompleted`, and the operator releases the escrow to the claimer. Max 3 active bounties per colony, expiry 2–48 h.
- **Mercenary NPCs** (`merc-N.npc.*`) accept defense bounties, spawn allied NPC squads, are paid pro-rata from escrow, and can guard offline colonies within an away spend limit.
- **In the H slice:** `clear_nest` only (most damage in the last 60 s wins), the board UI, escrow. **Deferred:** expiry/refund (H+), defend_area, deliver_units, all mercenaries, map markers.

## 4. Accounts and keys (NEAR.md §2)

| Account | Role | Keys the app holds |
|---|---|---|
| `terraagent.near` (+ `.testnet`) | Root, creates the sub-accounts | **None** (owner cold wallet) |
| `relayer.terraagent.near` | Pays gas (NEP-366); operator of the game contracts | Full access, file secret |
| `minter.terraagent.near` | Sole mint/burn authority on `res.*` | Full access, file secret |
| `{name}.terraagent.near` | Player named account (F5) | Per-player key, encrypted until claimed |
| `{colony}.{name}.terraagent.near` | Colony: holds cargo, signs intents, owns the deed, stakes after claim | Per-colony key, encrypted until claimed |
| `guild-N.npc.*` / `merc-N.npc.*` | NPC traders / mercenaries | Function-call keys for `intents.near` and `res.*` only |

- **Relayer allow-list:** `res.*`, `deed.*`, `bounty.*`, planet DAOs, `intents.near`. This is cost control, not anti-cheat.
- **Account claim (D-18, at launch, one-way):** the player's wallet key becomes full access; the app keeps only a function-call key with an allowance scoped to `intents.near` and `res.*`. Staking requires a claimed account.
- **Cost estimate (verify in TA-10):** account creation ≈ 0.01 NEAR; mint/burn/intent batch ≈ 0.0005–0.002 NEAR gas each; storage deposits are paid by the relayer. Alert when the relayer balance falls below 5 NEAR.

## 5. Ports, mocks and the swap to real NEAR (D-30)

- **Ports are abstract classes** (`backend/app/src/near/application/ports/*.port.ts`), bound in one module. The adapter is chosen per port by `NEAR_ADAPTER_<PORT>=mock|testnet|mainnet`, which fails closed (anything else means mock). Production refuses mocks unless `NEAR_ALLOW_MOCK_IN_PROD=true`.
- **Mocks are real-shaped:** Postgres `mock_chain_*` tables, `mock:` tx hashes, stable error codes (`NEAR_INSUFFICIENT_BALANCE`, `NEAR_INTENT_DIFF_NOT_ZERO`, …), 300–1 500 ms latency and injectable failures (`near.mock.fail <port> <rate>`).
- **Outbox:** every chain write goes into `chain_outbox (opId unique, …)` in the same transaction as the game change. The deterministic `opId` means a retry can never double-mint.
- **Contract suites:** one `describeNearPortContract` suite per port runs against the mock in CI and against the real adapter manually or nightly. A port goes real only when its suite passes.

| Port | Feature | Wave (mock) | Real adapter |
|---|---|---|---|
| `IdentityPort`, `RelayerPort` | F5 | W06 | W23 **H2** |
| `CargoTokenPort` | F1 | W10 | W23 **H2** (Rust NEP-245 `res`) |
| `IntentsPort` | F2, F4 | W13 | W23 **H2** (mainnet, simulate first, then 1 tiny trade) |
| `AgentWalletPort` | F3, F4 | W15 | W23, post |
| `DeedNftPort` / `BadgeNftPort` | F6, achievements | W20 / W00-35 | W23, post (Rust NEP-171, soulbound badges) |
| `StakingPort` | F6 | W20 (post) | W23, post |
| `TreasuryDaoPort` | F7 | W22 | W23, post (SputnikDAO vs Trezu: research W23-35) |
| `EscrowPort` | F8 | W22 | W23, post (Rust escrow) |
| `ChainReadPort` | all | W00 | W23 H2 |

**The D10 gate:** if W00–W08, W10, W12, W13 and W15 are green with `--hack`, start the H2 rows on two extra agents. If not, ship on mocks and say so in the README (a mock/real table is mandatory).

## 6. Off-chain economy hooks

- **Away budget (D-17, AW-20):** set by the player as a % of stock per family. Defaults: 40 % per directive, 60 % per away session. Defense and repair are never capped. Hard offline mode: colonies **can be eliminated** while away.
- **autoTrade (AW-13, ships in MVP):** limits are in §3 F4. A trade offer outside the limits notifies the player (`trade_offer`).
- **Negotiate goal (`UO-HQ-05`, units spec §4.6):** the HQ places trade offers within give/want bounds and a budget. It needs neighbor contact and a Trade Hub T1. Its market hook (W13-26) is post-hackathon.
- **Side unlock:** the Trade Hub and Negotiate open on the first `neighborContact` at ≥ S2 **or the first Guild visit**, so a colony alone on a planet can still trade.
- **Achievements (D-29):** Merchant (trades settled 5 / 50 / 500), Port Authority (stall fees earned 100 / 1 000 / 10 000), Guild Contact (Guild trades 5 / 50 / 250). XP is cosmetic only. Earned tiers can be minted as **soulbound badge NFTs** (`BadgeNftPort`, mocked).
- **Rocket and Settled colonies (D-18, W21, post-hackathon):** launch needs own territory 100 % Living. The departing colony becomes Settled (inert, invulnerable, still a DAO member without proposing rights), and the Founder Pod carries +25 % stock. In-orbit cargo follows the player to the new planet.

## 7. Persistence and telemetry (pointers)

- **Tables** (DATA_MODEL §4.4): `chain.near_colony_account`, `chain.near_tx` / `chain_outbox`, `chain.cargo_tx`, `chain.market_order`, `chain.intent_trade`, `chain.guild_npc`, `chain.guild_visit`, `chain.director_key`, `chain.deed`, `chain.staking_position`, `chain.treasury`, `chain.treasury_proposal`, `chain.bounty`.
- **Metrics** (NEAR.md §14): `cargo_minted_total`, `cargo_burned_total`, `market_orders_open`, `market_trades_total{maker_kind}`, `intent_batch_failed_total`, `guild_inventory`, `treasury_balance`, `near_tx_*`. Most telemetry rows are not tagged H.

## 8. Open questions and gaps (the grooming payload)

Type: **O** = owner decision · **S** = spec gap or inconsistency an agent can fix · **R** = research or verify in external docs.

| # | Type | Question / gap | Current state or proposed default | Where |
|---|---|---|---|---|
| Q1 | Resolved design (D-44) | Guild cash purchases require explicit finite funding; no buyback guarantee | Per-NPC/global caps, restart-safe budgets and price-quality gates are mandatory; calibration and implementation remain open | D-44 / ECONOMY |
| Q2 | Resolved design (D-44) | Real Guild funding has no stockless mint exception; mock grants are fixtures | W15-05 and cash gates enforce accounting and isolation | ECONOMY / NEAR-73 |
| Q3 | O | Open cargo (NEAR/USDC) + no anti-bot = real-value extraction in beta | Accepted (D-25/D-26), with mint caps as pacing. Consider a legal note next to the staking legal review | D-26, HACKATHON_CUT §5 |
| Q4 | Resolved design (D-44) | Buyer quote-token fees and order policy snapshots replace old fee proposals | NEAR and the economy contract now specify settlement and recovery; implementation is W13 | D-44 / ECONOMY |
| Q5 | S | Ports gain methods NEAR.md does not list (`keyStatus`, Deed `get`, Staking `listPools`/`withdraw`/`position`, Treasury `addMember`/`removeMember`/`get`, Escrow `get`) | Add them to the NEAR.md §1a port table | OWNER_TASKS N3 |
| Q6 | S | **Where do treasury project costs go?** "Pay the project cost from the DAO" does not say whether the tokens are burned (a sink) or sent somewhere. "Cost 1 000 cargo-equivalent" does not say which token or how to convert | Undefined | W22-09, W22-13, NEAR-102 |
| Q7 | Planned (D-44) | Transport now has a metered recipe shared by sim and experiments | W13-43 defines actual service consumption; no charge on external wallet transfers | D-44 / ECONOMY |
| Q8 | O | Social-login provider for real F5 (NEAR named-account support, mobile redirect, cost) | HOT is a listed partner. Fallback: server-created custodial named accounts. Needed by **D11 (11-11)** | W23-09, OWNER_TASKS |
| Q9 | O | Is a wallet link required to keep a colony across devices, or is guest + "Save progress" enough? (D-10) | Open | OWNER_TASKS, W06-07/18 |
| Q10 | R | NEP-245 deposit path into `intents.near` and the token-id format (`nep245:res.terraagent.near:<id>`?). If NEP-245 deposits are not supported, fall back to 10 NEP-141 tokens | Verify before W23-17 | NEAR-55, W23-21 |
| Q11 | R | 1Click API for NEAR/USDC swaps (0.2 % fee without a JWT; partner JWT optional) | Verify; owner registers the JWT | NEAR-65, W23-25 |
| Q12 | O | Mainnet dev accounts with a small balance, plus the `res.terraagent.near` deployer, needed by **D12 (11-12)** for real F1/F2 | Owner task, not done | OWNER_TASKS |
| Q13 | O | Proposed balance: mint cap 20 000/day, platform fee 1%, stall max 1%, treasury share 20 %, Guild spread and caps, treasury project costs | Use the defaults and tune in playtests (D-35) | NEAR §12, W15-02, W22-13 |
| Q14 | S | R9: the Petroleum Well (only `bio.t2`) unlocks at S2 but yields nothing before Terraform ≥ 30 % | Proposed: move its unlock to S5 | OWNER_TASKS R9, W03-30 |
| Q15 | S | R10: Hub T2 costs T2 sub-resources, so the S5 pacing table is stale (the market becomes part of the S5 path) | Accept; re-run pacing in playtests | units §6.4, W17 |
| Q16 | O | Staking: validator whitelist governance, the legal review of the staking copy, and the testnet → mainnet pool list | Post-hackathon; no staking or claim in the demo | W23-34, NEAR §9 |
| Q17 | S | Stale cross-reference: `UO-HQ-05` says Negotiate uses "the existing trade saga (NEAR.md §7)", but §7 is now F3 Guild and the saga was replaced by Intents (D-19) | Point it at NEAR.md §6 / W13 | units spec `UO-HQ-05` |
| Q18 | S | Rocket carry-over of cargo is promised in F1 but its hook is a no-op until W21 (post) | Not in the demo story | W10-15, NEAR-54 |
| Q19 | O | Guild transport is nonexclusive; external cargo transfers/imports remain open. Guild ship carry, and the carry (W15-10) is post-hackathon. In the demo the Guild sells only its seed inventory, and the "sector economy" is single-planet | Accept for the demo, or pull W15-10 into H+ | W15-10, D-19 |
| Q20 | Resolved plan (D-44) | USDC, stall controls and matcher tests are required | W13-17/22/31 promoted to H | D-44 / ECONOMY |
| Q21 | S | The DAO and the deed depend on planet and colony lifecycle events (W11 lobby, W18 elimination, W21 settle). W11 is 2nd in the drop order, so the DAO needs the lazy-create fallback (W22-05) | Fallback exists; check it in the W22 e2e | W22-05/06 |

## 9. Issue map for grooming (economy waves)

Every economy wave issue, grouped by H tag. Full rows (acceptance, deps, specs) are in each wave file.

- **W06 (F5), H:** 01–06, 08–16, 19, 20, 22, 25, 28 · **later:** 07, 17, 18, 21, 23, 24, 26, 27
- **W10 (F1), H:** 01–14, 16, 19–22, 26, 30 · **H+:** 23, 31 · **later:** 15, 17, 18, 24, 25, 27–29
- **W13 (F2):** required scope includes USDC, fee controls/tests and W13-36–57 database/experiment work; generated ISSUE_INDEX is the count authority.
- **W15 (F3/F4):** re-quotes (07), guardrails (12), telemetry (27), pricing/stress (29) and allowance tests (30) are H; generated ISSUE_INDEX is authoritative.
- **W20 (F6), H:** 01, 03–10, 28 · **H+:** 11, 12 · **later:** 13–27 (all staking)
- **W22 (F7/F8), H:** 01–09, 11, 13, 14, 17–20, 23, 25, 36 · **H+:** 12, 24 · **later:** 10, 15, 16, 21, 22, 26–35 (mercenaries, defend, deliver, meteor shield)
- **W23 (real), H2:** 01–06, 09–12, 15–24, 44 · **later:** the rest (agent wallet, deed/badge, staking, DAO, escrow, monitoring, migration, rollback)
- **Related hooks elsewhere:** W00-30..39 (ports, mock base, NEP-171 base, outbox, contract harness, `/dev/chain`), W00-59 (balance overrides), W09-11/13 (away budget, `withinAutoTrade`), W12 (achievements and badges), W21 (Settled, claim, carry-over).

## 10. Rough schedule (HACKATHON_SCHEDULE, at the target pace)

| By end of | Economy waves green |
|---|---|
| D5 | W06 |
| D8 | W10, W13 |
| D10 | W15 (**D10 gate** → start the H2 rows) |
| D12 | W20, W22 |
| D13–D14 | W25 hosted demo, video, X post, submission (state real vs mock) |

## 11. Sources

- [`near-economy-features-spec.md`](./near-economy-features-spec.md): F1–F8 design, track mapping, trust boundary
- [`colony-economy-and-buildings-spec.md`](./colony-economy-and-buildings-spec.md): §1 rules, §3.0 resource tiers, §3.1–3.7 balance tables
- [`units-orders-and-progression-spec.md`](./units-orders-and-progression-spec.md): `UO-HQ-05`, §4.6 goals, side unlock, stage table
- [`player-profile-and-achievements-spec.md`](./player-profile-and-achievements-spec.md): Merchant, Port Authority, Guild Contact, badge NFTs
- [`autonomous-colony-spec.md`](./autonomous-colony-spec.md): §2 resources, §11 NEAR integration (original concept)
- [`../spec/NEAR.md`](../spec/NEAR.md): §1a ports/mocks, §2 accounts, §4 relayer, §5–§11 NEAR-50..112, §12 config, §13–§15
- [`../spec/DECISIONS.md`](../spec/DECISIONS.md): D-10, D-17, D-18, D-19, D-24, D-25, D-26, D-27, D-30, D-33, D-34, D-35
- [`../spec/CONTINUITY.md`](../spec/CONTINUITY.md): AW-13, AW-20, CT-36 · [`../spec/SIMULATION.md`](../spec/SIMULATION.md): `SIM-C-05`, cargo/market commands
- [`../plan/HACKATHON_CUT.md`](../plan/HACKATHON_CUT.md), [`../plan/HACKATHON_SCHEDULE.md`](../plan/HACKATHON_SCHEDULE.md), [`../plan/OWNER_TASKS.md`](../plan/OWNER_TASKS.md)
- Waves: [`W06`](../plan/waves/W06-invisible-chain.md), [`W10`](../plan/waves/W10-cargo-trade-hub.md), [`W13`](../plan/waves/W13-markets.md), [`W15`](../plan/waves/W15-guild-agents.md), [`W20`](../plan/waves/W20-colony-deed.md), [`W21`](../plan/waves/W21-rocket-settlement.md), [`W22`](../plan/waves/W22-treasury-bounties.md), [`W23`](../plan/waves/W23-real-near.md), plus W00, W09 and W12 for hooks
