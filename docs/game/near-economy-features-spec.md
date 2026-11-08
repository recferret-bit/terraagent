# TerraAgent — NEAR Economy Features (Proposal)

> **Owner-approved economy revision (2026-11-04, D-44):** [ECONOMY](../spec/ECONOMY.md) is authoritative for demand, quote-token fees, database profiles and AI experiments. Historical calendar/effort estimates below require reforecasting after the expanded W13/W15 scope.

> **Status:** v0.2 (2026-10-30). **Accepted as D-26.** The owner picked all eight features. Build order and cut line are in D-27 / [`docs/plan/HACKATHON_CUT.md`](../plan/HACKATHON_CUT.md).
> **Target:** NEAR Hackathon, track **09 "Games With Real Economies — the economy is the gameplay"** (dev window 2026-11-01 → 2026-11-14 23:59 UTC).
> **Context:** The simulation stays on the **server**, simplified into one Node app (D-24). There is **no anti-cheat and no anti-bot machinery** (D-25). The game server also acts as the **message bus** that matches market orders.

## 1. What the track asks for (and how we answer)

Track 09 asks for three things: **NPCs with wallets, player-owned markets, and economies that evolve without a dev patch**. It is "judged on the game loop, not the token", with a **bonus if players never notice the chain**. Hint tags: *Agent NPCs, Social login, NEAR Intents, NEP-245*.

| Track phrase | Our answer | Feature |
|---|---|---|
| Economies that touch chain | The **Trade Hub is the only door between the game and the chain**. Exporting cargo mints resource tokens; importing burns them | F1 |
| Player-owned markets | A Trade Hub is a **market the player owns and earns fees from**. Orders settle as NEAR Intents `token_diff` pairs | F2 |
| NPCs with wallets | **Orbital Guild** trader NPCs, which are agents with their own NEAR sub-accounts, inventories and pricing | F3 |
| … and your own agent | The colony's HQ director signs trades while you are away, with a capped key | F4 |
| Economies evolve without a patch | Guild prices and demand follow on-chain trade history, and the planet treasury funds projects players vote on | F3, F7 |
| Players never notice the chain | Social login, named accounts and gas-free meta-transactions. Tokens appear as "cargo"; deals appear as "contracts" | F5 |
| Something the chain gives back | Living Colony Deed NFT, own-NEAR staking, planet treasury, bounties | F6–F8 |
| NEP-245 | One multi-token contract holds every resource on every planet | F1 |

## 2. Trust boundary (server sim, no anti-cheat)

| Layer | What it holds | Who is the truth |
|---|---|---|
| **On-chain truth** | Accounts, token balances, settled trades, deeds, treasury, staking | NEAR (our contracts plus `intents.near`) |
| **Server simulation** | Production, stock, combat, terraform %, the export amounts that get minted | The game server (D-24) |
| **Client** | Rendering and inputs only | Nothing |

- **Mint authority is the server.** Export mints only from simulated stock. A modified client cannot invent production.
- **No anti-cheat or anti-bot checks (D-25).** Multi-accounting and farm bots *can* play for value, and **cargo is open (swappable for NEAR/USDC) in beta (D-26)**. The owner accepts that risk for beta.
- **Mint caps stay as economic pacing:** export ≤ Trade Hub throughput, plus a daily per-colony ceiling. These shape supply and price; they are not security.
- **Real money from the game:** none. Staking yield comes from validators on the player's own NEAR (D-18). Treasury (F7) and bounties (F8) move only tokens that players already hold.
- **Mainnet.** `intents.near` has no testnet. Build with dev accounts, tiny amounts, and `dry: true` quotes.

## 3. Features

Days are hackathon build days for one developer who knows the stack. "Tracks" lists every track a feature also qualifies for; a project may enter several tracks.

### F1 — Orbital Port: resource tokens (NEP-245) · **2 days**
- **Primitive.** One NEP-245 multi-token contract, `res.terraagent.near`, with **one token id per tradable sub-resource** (D-34), equal to the sim's `ResourceKey`: `metals.t1` (iron), `metals.t2` (light alloys), `metals.t3` (titanium), `minerals.t1` (silica), `minerals.t2` (rare earths), `minerals.t3` (exotic crystal), `bio.water`, `bio.biomass`, `bio.t2` (petroleum / organics), `bio.t3` (gene-stock). Energy is grid power, not a token. Minting and burning are restricted to the port service account.
- **Tiers on the market.** T1 tokens trade from day one. Each sub-resource is its own market pair (F2), so a colony can **buy T2/T3 before it can mine them** (it mines them only after terraforming, economy spec §3.0); only colonies that mine them can export and mint them.
- **Loop.** At a Trade Hub the player taps **Export**: cargo leaves storage, the shuttle VFX plays, and tokens are minted to the colony account. **Import** burns tokens and adds the cargo to storage.
- **Rocket carry-over.** The cargo hold persists across planets.
- **Players see:** "Cargo in orbit: 1 200 iron".
- **Tracks:** 09.

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

### F4 — Colony agent wallet (HQ director signs while you're away) · **1–2 days** (needs F2)
- **Primitive.** The colony account adds a **function-call / intents key with an allowance** that equals the player-set away budget (D-17). The AI director uses it to sign orders under `autoTrade` limits. The player can revoke the key in one tap.
- **Loop.** Hard offline mode: your colony can buy the water it needs, or sell surplus to the Guild, while you sleep.
- **Players see:** "While you were away: Director sold 400 iron to the Guild."
- **Tracks:** 09, 06 (AI Security: function-call keys).

### F5 — Invisible chain: social login, named accounts, gasless · **2 days**
- **Primitive.**
  - Guest play first. **Social login** creates `name.terraagent.near`. The provider is still to be chosen; HOT is a listed hackathon partner, and others must be verified.
  - Colony sub-accounts.
  - **Meta-transactions (NEP-366)** through our relayer, so the player never pays gas or sees a wallet.
  - Account claim (D-18) when the player wants self-custody.
- **Tracks:** 09 (the "players never notice" bonus), 08.

### F6 — Colony Deed: dynamic NFT (NEP-171) + staking · **2 days**
- **Primitive.** An NFT minted when the colony is founded. Its metadata updates on milestones: stage, terraform %, walls, trade volume, truces. At launch the deed becomes a **Settled Deed** and opens **own-NEAR staking** through the colony account (D-18).
- **Players see:** a living colony card that can be shared on X.
- **Tracks:** 09, 10 (NFTs That Do Something).

### F7 — Planet Treasury & Council (DAO) · **3 days** (stretch)
- **Primitive.** A share of market fees flows to a per-planet **SputnikDAO** (or Trezu multisig). Colonies on the planet are members.
- **Loop.** Votes fund planet-wide projects: a meteor shield, a terraform boost, or a Guild visit subsidy. The economy changes without a patch.
- **Tracks:** 09, 12 (Social Money).

### F8 — Bounties & mercenaries · **3 days** (stretch)
- **Primitive.** An escrow contract holds tokens. Posted contracts ("clear the nest near my border: 200 iron") are claimed by players or by **mercenary NPC agents**, which guard offline colonies for pay.
- **Tracks:** 09, 07.

## 4. Owner picks and build order (D-26, D-27)

All eight features are accepted. Solo build order: **F5 → F1 → F2 → F3 → F4** ║ *cut line* ║ **F6 → F7 → F8**. Features after the cut line ship only if the core is done ahead of schedule.

Submission tracks: **09** (main), **07** Agent Economy, **05** AI Swarms; **10** NFTs if F6 ships, **12** Social Money if F7 ships.

## 5. Hackathon reality check

- **Window.** Code counts from **2026-11-01**. Development ends **2026-11-14 23:59 UTC**. The repo must be public with a LICENSE.
- **Baseline disclosure.** The existing prototype in `src/` predates the window and must be disclosed in the README.
- **README.** It must read as "do X → see Y" for the **Claude Code / Codex screening**, and must list libraries and AI-generated code.
- **Demo.** A local-only demo is allowed if it can be reproduced; a hosted demo is a plus. An X post with a video is required.
- **Estimate.** F1–F8 ≈ 20 dev-days against 14, shared with the game itself. The cut line is real.
- **Demo cut.** One app plus server sim (D-24), Temperate only, stages S0–S4 plus terrain walls, F5 → F4 core. Day plan: [`docs/plan/HACKATHON_CUT.md`](../plan/HACKATHON_CUT.md).
