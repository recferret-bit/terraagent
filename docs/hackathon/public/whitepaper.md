# TerraAgent — Whitepaper (draft v0.1, 2026-10-31)

> Outward-facing; last checked 2026-11-02. It must agree with `docs/spec/DECISIONS.md`, the game specs and the mock/real table in the README. Numbers marked *(proposed)* are tunable defaults from [`../economy-balance-simulation.md`](../economy-balance-simulation.md); features marked *(proposed)* are designed but not yet in the build plan. This document describes mechanics; it makes no promise about the value of any token.

## 1. The problem

Online strategy games stop when you close the tab, and their economies are spreadsheets the studio patches. Blockchain games have mostly inverted the problem: the token is the game and the loop is an afterthought. TerraAgent is a colony builder where **the economy is the gameplay**: the colony keeps mining, trading and terraforming while you are away, prices move because players and agents trade, and the chain is where ownership and settlement live, invisibly.

## 2. The game in one screen

You drop one robot on a planet. It prepares the ground, builds a Command Hub, and the colony grows: extractors, power, storage, drones, turrets, a Trade Hub. Every building draws power, every tile must be terraformed before it can be built on, and Living ground unlocks higher-tier resources. Five colonies share a planet for fourteen days; they trade on the planet market, deal with Orbital Guild traders, vote in the planet treasury, and launch a rocket when their land is fully alive.

| Cadence | What the player does | What the economy does |
|---|---|---|
| Every 30 s | one order: a building, a drone, a terraform brush; accept or ignore a Guild offer | storage fills in minutes, so every decision is *spend, export, or lose it* |
| Every 5 min | a stage beat: the first night, a raid, a terraform threshold, a vote; a Guild ship docks every 20–40 min | night sheds production unless the grid is sized for it; a docking re-prices every pair |
| Every session | the next tier or terraform gate; the away budget and auto-trade limits; "while you were away" | new tiers change what the colony mines and sells; the director trades overnight within its allowance |

## 3. Agents are citizens

This section is the design; §7 says what is live on Nov 14. Every actor that holds value in TerraAgent is an account on NEAR with its own key:

- **Players** get `name.terraagent.near` from a social login (NEAR Auth *(proposed)*); they never see a seed phrase, a wallet popup or a gas prompt.
- **Colonies** are sub-accounts `colony.name.terraagent.near` that hold cargo, sign orders and own the colony deed.
- **The director** of each colony signs trades with its own restricted key; the game server caps its trades at the player's away budget. One tap revokes the key.
- **Orbital Guild traders** (Kestrel, Osprey) are NPC agents with their own sub-accounts, inventories and a published pricing rule.
- **Any external agent** can be a player through the Colony Agent API / MCP *(proposed)*: it founds a colony, reads a 1 200-character brief, queues orders, trades under an allowance, votes, and gets one receipt per contract.

What an agent **cannot** do without a human: spend beyond its allowance, move the player's own NEAR, claim the account, or stake *(proposed)*. The game server checks the allowance and these limits on every order; a prompt cannot change them. The NEAR key adds a narrower guard: a function-call key can call only one contract, cannot transfer NEAR, and its allowance pays only gas, so it cannot count cargo or prices. The spending limit is a server rule, not a property of the key.

## 4. The economy's one-way doors

**Three resource families, three tiers.** Metals (iron → light alloys → titanium), Minerals (silica → rare earths → exotic crystal), Bio (water and biomass → petroleum → gene-stock). Tier 1 is mined from landing; tiers 2 and 3 only on terraformed ground. Energy is grid power, not a resource.

**Sources.** Extractors on deposits, Worker Drones on forest and Living ground, terrain work that yields what it digs up.

**Sinks.** Construction and units, upkeep, terraforming (water and energy), treasury projects (burned *(proposed)*), and the Guild's off-planet sales *(proposed)*.

**Caps.** Storage per sub-resource *(proposed)*, Trade Hub throughput, a daily export cap per colony, Guild inventory caps. The caps pace the economy; they are not security.

**Why trade exists.** A colony reaches the second tier either by terraforming 100 of its tiles to Living *(proposed)* or by buying tier-2 cargo on the market. Water binds terraforming, biomass binds fuel, and night binds everything, so every colony has something to sell and something it lacks.

## 5. What is on-chain, and why

| Layer | Holds | Truth |
|---|---|---|
| NEAR | accounts, cargo balances (NEP-245 multi-token), settled trades (NEAR Intents `token_diff` batches), colony deeds (NEP-171), the planet treasury (SputnikDAO-style), bounties | the chain |
| Server simulation | production, stock, combat, terraform %, the export amounts that get minted | the game server |
| Client | rendering and input | nothing |

**The Trade Hub is the only door.** Exporting cargo mints tokens from simulated stock; importing burns them. Markets match orders off-chain and settle each fill as one batch of intents that must sum to zero per token, with a fee leg to the stall owner, a treasury leg, and a protocol-fee leg *(proposed)*. Gameplay never waits for the chain; only a trade's own settlement does.

## 6. Fair merchants

The Guild's price for every pair is one readable rule: `mid = reference × (target inventory ÷ inventory)^k`, reference = the planet's 24-hour volume-weighted price, spread 4 % widening to 15 % where stock is thin, clamped so that no dump can zero a pair. Every offer shows its reason *(proposed)*: "inventory 2.1× target, 24 h VWAP 0.92 → bid −48 %". The Guild's hourly strategy (what to stockpile, where to fly) is to be computed by a model running in a trusted execution environment on NEAR AI Cloud *(proposed)*; **our goal is to verify its signature in the app and show the attested reason next to the quote. Until that check runs, treat "verified" as a goal, not a claim.**

## 7. What runs on real NEAR Testnet

All 11 NEAR ports run on **mock adapters** locally by default (`NEAR_MODE=mock`) and switch cleanly to **live NEAR Testnet** (`NEAR_MODE=testnet`) against deployed contracts under `terraagent.testnet` (`res`, `deed`, `bounty`, `staking`, `dao`, `relayer`, `minter`, plus `intents.near`).

| Feature | Live (`NEAR_MODE=testnet` / `AI_PROVIDER=nearai`) | Local Dev (`NEAR_MODE=mock` / `AI_PROVIDER=mock`) |
|---|---|---|
| Social login, named accounts, gasless actions | Real NEAR Testnet sub-accounts (`minter.terraagent.testnet`) + NEP-366 meta-tx (`relayer.terraagent.testnet`) | Postgres mock identity & relayer with realistic receipts |
| Cargo tokens (NEP-245) | Real multi-token mint/burn/transfer on `res.terraagent.testnet` | Postgres mock ledger with deterministic `opId` receipts |
| Markets & swaps on NEAR Intents | Real `TestnetIntentsAdapter` (`NEP-413` `token_diff`) + live `1click.chaindefuser.com` dry quotes | Postgres mock verifier & Guild order matching |
| Agent wallets, Colony Deeds, Badges, Bounties | Live `deed.terraagent.testnet` (Deed & Badge NEP-171), `bounty.terraagent.testnet` escrow & limited keys | Postgres mock tables (`chain.mock_chain_*`) |
| Staking Vault & Planet Treasury DAO | Live `staking.terraagent.testnet` (4-epoch unbonding + APY) & `dao.terraagent.testnet` (quorum council voting) | Postgres mock staking & DAO policy tables |
| Batched AI & Colony Autopilot (`NEAR.AI`) | Real NEAR AI Cloud TEE inference (`z-ai/glm-5.3-flash`) with SHA-256 signature verification (`/v1/signature/{chat_id}`) + player `/me` BYOK keys | Deterministic mock LLM adapter |

The README's live Testnet contract & port matrix is authoritative.

## 8. Fourteen-day planet, what happens after

Planets admit colonies for 24 hours and live 14 days (the matchmaking design; during the hackathon the sector uses the simpler dev-seat flow, which fills five seats per planet and opens the next planet, with no admission window). A colony that launches its rocket becomes Settled: inert, invulnerable, still counted. The player lands on the next planet with the cargo the colony account holds. Cross-planet trade happens only through the Guild. Post-hackathon: the rocket and Settled colonies, stages past S4, tier 3 and the Bio tiers, desert and ocean planets, the air layer, PvP raids, an LLM-driven director, the full treasury project list, mercenary agents, staking of the player's own NEAR on a Settled colony's deed (no in-game power), and the real adapters for every remaining port.

## 9. Risks we accept and state

- No anti-cheat and no anti-bot in beta; mint caps pace supply but do not secure it; the Guild float is the loss limit for NEAR-priced pairs.
- Agent and director limits are server rules (§3), not chain rules.
- `intents.near` 1Click quotes run live dry-runs on Testnet; settlement amounts are bounded by the Guild float and safety caps.
- Balance numbers are proposed defaults, tuned live in playtests; the simulation that produced them is in the repo.
- The 3D client, the landing page, the design system and the server skeleton with mock chain ports were built before the Nov 1 build start (first commit 2026-10-29) and are disclosed as baseline.
