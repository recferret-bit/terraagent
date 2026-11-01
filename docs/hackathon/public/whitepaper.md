# TerraAgent — Whitepaper (draft v0.1, 2026-10-31)

> Outward-facing. It must agree with `docs/spec/DECISIONS.md`, the game specs and the mock/real table in the README. Numbers marked *(proposed)* are tunable defaults from [`../economy-balance-simulation.md`](../economy-balance-simulation.md). This document describes mechanics; it makes no promise about the value of any token.

## 1. The problem

Online strategy games stop when you close the tab, and their economies are spreadsheets the studio patches. Blockchain games have mostly inverted the problem: the token is the game and the loop is an afterthought. TerraAgent is a colony builder where **the economy is the gameplay**: the colony keeps mining, trading and terraforming while you are away, prices move because players and agents trade, and the chain is where ownership and settlement live, invisibly.

## 2. The game in one screen

You drop one robot on a planet. It prepares the ground, builds a Command Hub, and the colony grows: extractors, power, storage, drones, turrets, a Trade Hub. Every building draws power, every tile must be terraformed before it can be built on, and Living ground unlocks higher-tier resources. Five colonies share a planet for fourteen days; they trade on the planet market, deal with Orbital Guild traders, vote in the planet treasury, and launch a rocket when their land is fully alive.

| Cadence | What the player does | What the economy does |
|---|---|---|
| Every 30 s | one order: a building, a drone, a terraform brush; accept or ignore a Guild offer | storage fills in minutes, so every decision is *spend, export, or lose it* |
| Every 5 min | a stage beat: the first night, a raid, a Guild docking, a terraform threshold, a vote | night sheds production unless the grid is sized for it; a docking re-prices every pair |
| Every session | the next tier or terraform gate; the away budget and auto-trade limits; "while you were away" | new tiers change what the colony mines and sells; the director trades overnight within its allowance |

## 3. Agents are citizens

This section is the design; §7 says what is live on Nov 14. Every actor that holds value in TerraAgent is an account on NEAR with its own key:

- **Players** get `name.terraagent.near` from a social login (NEAR Auth); they never see a seed phrase, a wallet popup or a gas prompt.
- **Colonies** are sub-accounts `colony.name.terraagent.near` that hold cargo, sign orders and own the colony deed.
- **The director** of each colony signs trades with a restricted key whose allowance is the player's away budget. One tap revokes it.
- **Orbital Guild traders** (Kestrel, Osprey) are NPC agents with their own sub-accounts, inventories and a published pricing rule.
- **Any external agent** can be a player through the Colony Agent API / MCP: it founds a colony, reads a 1 200-character brief, queues orders, trades under an allowance, votes, and gets one receipt per contract.

What an agent **cannot** do without a human: spend beyond its allowance, move the player's own NEAR, claim the account, or stake. The allowance, the revoke and the limits are enforced by the key, not by a prompt.

## 4. The economy's one-way doors

**Three resource families, three tiers.** Metals (iron → light alloys → titanium), Minerals (silica → rare earths → exotic crystal), Bio (water and biomass → petroleum → gene-stock). Tier 1 is mined from landing; tiers 2 and 3 only on terraformed ground. Energy is grid power, not a resource.

**Sources.** Extractors on deposits, harvesters on forest and Living ground, terrain work that yields what it digs up.

**Sinks.** Construction and units, upkeep, terraforming (water and energy), treasury projects (burned), and the Guild's off-planet sales *(proposed)*.

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

The Guild's price for every pair is one readable rule: `mid = reference × (target inventory ÷ inventory)^k`, reference = the planet's 24-hour volume-weighted price, spread 4 % widening to 15 % where stock is thin, clamped so that no dump can zero a pair. Every offer shows its reason: "inventory 2.1× target, 24 h VWAP 0.92 → bid −48 %". The Guild's hourly strategy (what to stockpile, where to fly) is computed by a model running in a trusted execution environment on NEAR AI Cloud; **our goal is to verify its signature in the app and show the attested reason next to the quote. Until that check runs, treat "verified" as a goal, not a claim.**

## 7. What runs on real NEAR on Nov 14

| Feature | Real | Mock |
|---|---|---|
| Social login, named accounts, gasless actions | planned real (NEAR Auth, NEP-366 relayer) | fallback: server-created custodial accounts |
| Cargo tokens (NEP-245) | planned real | mock ledger with real-shaped receipts |
| Markets on NEAR Intents | planned real for one small trade, dry-run first; NEAR-priced pairs bounded by a 10 NEAR Guild float *(proposed)* | mock verifier |
| Guild wallets, director key | mock | mock |
| Colony Agent API / MCP (external agents as players) | planned (server-side, no chain adapter needed); agents sign through the colony's custodial key under its allowance | — |
| Deed, treasury, bounties | mock | mock |

The README's mock/real table is authoritative; if they differ, the README wins.

## 8. Fourteen-day planet, what happens after

Planets admit colonies for 24 hours and live 14 days (the matchmaking design; during the hackathon the sector uses the simpler dev-seat flow, which fills five seats per planet and opens the next planet, with no admission window). A colony that launches its rocket becomes Settled: inert, invulnerable, still counted. The player lands on the next planet with part of the cargo. Cross-planet trade happens only through the Guild. Post-hackathon: desert and ocean planets, the air layer, walls, PvP raids, the full treasury project list, mercenary agents, staking of the player's own NEAR on a Settled colony's deed (no in-game power), and the real adapters for every remaining port.

## 9. Risks we accept and state

- No anti-cheat and no anti-bot in beta; mint caps pace supply but do not secure it; the Guild float is the loss limit for NEAR-priced pairs.
- `intents.near` is mainnet-only; we test with tiny amounts and dry runs.
- Balance numbers are proposed defaults, tuned live in playtests; the simulation that produced them is in the repo.
- The 3D client predates the hackathon window and is disclosed as baseline.
